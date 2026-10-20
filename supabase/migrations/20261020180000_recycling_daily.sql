-- CARTEMA — recyclage des exemplaires, verrouillage manuel et bonus de connexion quotidien.
-- Valeurs (CDC §5) : Commun 5, Peu commun 15, Rare 40, Très rare 90, Épique 200, Légendaire 750,
-- Mythique 3 000 Deniers ; Dorée ×3, Sanglante ×10 (economy_settings, versionnées).
-- Un exemplaire recyclé n'est pas supprimé : l'historique des ouvertures le référence.
-- Il est marqué recycled_at et disparaît de l'inventaire ; la découverte reste acquise.

alter table public.inventory_items add column recycled_at timestamptz;
create index inventory_active_ix on public.inventory_items (owner_id, character_id, finish) where recycled_at is null;

-- Un exemplaire recyclé est figé (irréversible, ni verrou ni réservation possibles).
create function private.inventory_recycled_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.recycled_at is not null and new is distinct from old then
    raise exception 'recycled_item';
  end if;
  if new.recycled_at is not null and old.recycled_at is null and (new.locked or new.reserved_kind is not null) then
    raise exception 'card_locked';
  end if;
  return new;
end $$;
create trigger inventory_recycled_guard before update on public.inventory_items
  for each row execute function private.inventory_recycled_guard();

create table public.recycling_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  items jsonb not null,
  total bigint not null check (total > 0),
  settings_version integer not null references public.economy_settings(version),
  created_at timestamptz not null default now(),
  unique (owner_id, request_id)
);
alter table public.recycling_operations enable row level security;
grant select on public.recycling_operations to authenticated;
create policy own_recycling on public.recycling_operations for select to authenticated using (owner_id = auth.uid());

create function private.recycle_value(p_rarity public.rarity, p_finish public.finish, p_settings jsonb)
returns bigint language sql immutable set search_path = '' as $$
  select (p_settings->'recycle_values'->>p_rarity::text)::bigint
       * coalesce((p_settings->'finish_multipliers'->>p_finish::text)::bigint, 1)
$$;

-- Recyclage explicite d'exemplaires choisis. Irréversible, atomique, idempotent par p_request_id.
-- Les finitions Dorée/Sanglante exigent p_confirm_special (confirmation explicite, CDC §5).
create function public.recycle_cards(p_instance_ids uuid[], p_request_id uuid, p_confirm_special boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings public.economy_settings := private.active_settings();
  v_ids uuid[];
  v_op public.recycling_operations;
  v_items jsonb;
  v_total bigint;
  v_balance bigint;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_op from public.recycling_operations where owner_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('operation_id', v_op.id, 'total', v_op.total, 'count', jsonb_array_length(v_op.items),
      'balance', (select balance from public.wallets where owner_id = v_uid), 'replayed', true);
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_instance_ids) x where x is not null;
  if v_ids is null then raise exception 'nothing_to_recycle'; end if;
  if cardinality(v_ids) > 500 then raise exception 'too_many_cards'; end if;

  -- Verrou des exemplaires : deux recyclages, ventes ou cadeaux concurrents sont sérialisés.
  perform 1 from public.inventory_items where id = any (v_ids) for update;
  if (select count(*) from public.inventory_items i
       where i.id = any (v_ids) and i.owner_id = v_uid and i.recycled_at is null) <> cardinality(v_ids) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from public.inventory_items i where i.id = any (v_ids) and i.locked) then
    raise exception 'card_locked';
  end if;
  if exists (select 1 from public.inventory_items i where i.id = any (v_ids) and i.reserved_kind is not null) then
    raise exception 'card_reserved';
  end if;
  if exists (select 1 from public.inventory_items i join public.characters c on c.id = i.character_id
              where i.id = any (v_ids) and c.is_unique) then
    raise exception 'unique_indestructible';
  end if;
  if not coalesce(p_confirm_special, false)
     and exists (select 1 from public.inventory_items i where i.id = any (v_ids) and i.finish <> 'Standard') then
    raise exception 'confirm_special_finish';
  end if;

  select jsonb_agg(jsonb_build_object('instance_id', i.id, 'character_id', c.id, 'rarity', c.rarity, 'finish', i.finish,
           'value', private.recycle_value(c.rarity, i.finish, v_settings.settings))),
         sum(private.recycle_value(c.rarity, i.finish, v_settings.settings))
    into v_items, v_total
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.id = any (v_ids);

  insert into public.recycling_operations (owner_id, request_id, items, total, settings_version)
    values (v_uid, p_request_id, v_items, v_total, v_settings.version)
    returning * into v_op;
  update public.inventory_items set recycled_at = now() where id = any (v_ids);
  v_balance := private.apply_wallet_delta(v_uid, v_total, 'recycle', 'recycling_operation', v_op.id, 'recycle:' || v_op.id);
  return jsonb_build_object('operation_id', v_op.id, 'total', v_total, 'count', cardinality(v_ids),
    'balance', v_balance, 'replayed', false);
end $$;

-- Recyclage rapide : uniquement les Standards non verrouillées, en gardant p_keep exemplaires
-- Standard par personnage (les plus anciens). Ne touche jamais aux finitions spéciales.
create function private.duplicate_standards(p_owner uuid, p_keep integer) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select i.id, row_number() over (partition by i.character_id order by i.acquired_at, i.id) as rank
      from public.inventory_items i join public.characters c on c.id = i.character_id
     where i.owner_id = p_owner and i.recycled_at is null and i.finish = 'Standard'
       and not i.locked and i.reserved_kind is null and not c.is_unique
  ) ranked where rank > greatest(p_keep, 0)
$$;

create function public.preview_duplicates(p_keep integer default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
  v_ids uuid[] := private.duplicate_standards(v_uid, p_keep);
begin
  return jsonb_build_object('count', cardinality(v_ids),
    'total', coalesce((select sum(private.recycle_value(c.rarity, i.finish, v_settings))
                         from public.inventory_items i join public.characters c on c.id = i.character_id
                        where i.id = any (v_ids)), 0),
    'by_rarity', coalesce((select jsonb_object_agg(r, n) from (
                   select c.rarity::text as r, count(*) as n from public.inventory_items i join public.characters c on c.id = i.character_id
                    where i.id = any (v_ids) group by c.rarity) x), '{}'::jsonb));
end $$;

create function public.recycle_duplicates(p_request_id uuid, p_keep integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_ids uuid[];
begin
  if exists (select 1 from public.recycling_operations where owner_id = v_uid and request_id = p_request_id) then
    return public.recycle_cards('{}', p_request_id, false);
  end if;
  v_ids := private.duplicate_standards(v_uid, p_keep);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('total', 0, 'count', 0, 'replayed', false,
      'balance', (select balance from public.wallets where owner_id = v_uid));
  end if;
  return public.recycle_cards(v_ids, p_request_id, false);
end $$;

-- Verrouillage manuel : un exemplaire verrouillé est exclu du recyclage, des ventes et des cadeaux.
create function public.set_cards_locked(p_instance_ids uuid[], p_locked boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_count integer;
begin
  update public.inventory_items set locked = p_locked
   where id = any (p_instance_ids) and owner_id = v_uid and recycled_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Exemplaires possédés d'un personnage, avec leur valeur de recyclage.
create function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'acquired_at', i.acquired_at, 'unique', c.is_unique,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

-- Bonus de connexion : une fois par jour calendaire Europe/Paris, attribué à la première visite.
create function private.claim_daily_reward(p_owner uuid, p_at timestamptz default now()) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_amount bigint := coalesce(((private.active_settings()).settings->>'daily_login_reward')::bigint, 0);
  v_key text := 'daily:' || ((p_at at time zone 'Europe/Paris')::date)::text;
  v_before bigint;
  v_after bigint;
begin
  if v_amount <= 0 then return 0; end if;
  select balance into v_before from public.wallets where owner_id = p_owner for update;
  if exists (select 1 from public.wallet_ledger where owner_id = p_owner and idempotency_key = v_key) then
    return 0;
  end if;
  v_after := private.apply_wallet_delta(p_owner, v_amount, 'daily_login', null, null, v_key);
  return v_amount;
end $$;

create or replace function public.get_album(p_edition_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((
    select jsonb_agg(card order by edition_created, number)
    from (
      select e.created_at as edition_created, c.number,
        case when d.character_id is not null then jsonb_build_object(
          'character_id', c.id, 'known', true,
          'edition_id', e.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
          'rarity', c.rarity, 'unique', c.is_unique, 'name', c.name, 'role_title', c.role_title, 'clan', cl.name,
          'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key,
          'discovered_at', d.first_seen_at,
          'finishes_seen', (select coalesce(jsonb_agg(fd.finish order by fd.finish), '[]'::jsonb)
                              from public.finish_discoveries fd
                             where fd.owner_id = v_uid and fd.character_id = c.id),
          'owned', (select coalesce(jsonb_object_agg(x.finish, x.n), '{}'::jsonb) from (
                      select i.finish, count(*) as n from public.inventory_items i
                       where i.owner_id = v_uid and i.character_id = c.id and i.recycled_at is null group by i.finish) x))
        else jsonb_build_object(
          'known', false, 'edition_id', e.id,
          'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
          'rarity', c.rarity, 'unique', c.is_unique, 'silhouette_key', c.silhouette_key)
        end as card
      from public.characters c
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.discoveries d on d.character_id = c.id and d.owner_id = v_uid
      where c.status = 'published' and e.album_published and e.archived_at is null
        and (p_edition_id is null or e.id = p_edition_id)
    ) album), '[]'::jsonb);
end $$;

create or replace function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_daily bigint := private.claim_daily_reward(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'balance', (select w.balance from public.wallets w where w.owner_id = v_uid),
    'boosters', jsonb_build_object(
      'free', v_boosters.free_count,
      'purchased', v_boosters.purchased_count,
      'free_capacity', (v_settings->>'free_booster_capacity')::int,
      'next_free_at', (select min(s) from private.free_slots_between(now(), now() + interval '1 day') s)),
    'booster_offers', v_settings->'booster_offers',
    'daily_reward', v_daily,
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix,
               'cover_path', e.cover_path, 'openable', private.edition_is_complete(e.id)) order by e.created_at)
      from public.editions e
      where e.packs_enabled and e.archived_at is null), '[]'::jsonb)
  );
end $$;

revoke execute on all functions in schema public, private from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function
  public.set_handle(text), public.get_player_state(), public.buy_boosters(integer, uuid),
  public.open_booster(uuid, uuid, text), public.get_opening(uuid), public.get_album(uuid),
  public.recycle_cards(uuid[], uuid, boolean), public.recycle_duplicates(uuid, integer),
  public.preview_duplicates(integer), public.set_cards_locked(uuid[], boolean), public.get_inventory(uuid),
  public.admin_catalog(), public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text), public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text),
  public.admin_publish_drafts(uuid, text), public.admin_set_unique(uuid, boolean, text)
to authenticated;
