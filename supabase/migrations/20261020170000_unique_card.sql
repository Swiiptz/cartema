-- CARTEMA — carte unique (Caïn) : un seul exemplaire dans tout le jeu.
-- Règles validées le 20/10/2026 : 1 chance sur 10 000 par booster de son édition, à la place
-- de la 5e carte ; échangeable et vendable, jamais recyclable ni détruite ; tirage secret
-- (aucune annonce, propriétaire non affiché) ; habillage propre à dessiner (finition stockée Standard).

alter table public.characters add column is_unique boolean not null default false;

-- Probabilité « 1 sur N » ; 0 désactive. Ajoutée à la configuration de tirage versionnée.
alter table public.pack_rulesets add column unique_odds integer not null default 10000 check (unique_odds >= 0);

create table public.unique_drops (
  character_id uuid primary key references public.characters(id),
  opening_id uuid not null references public.pack_openings(id),
  first_owner_id uuid references public.profiles(id) on delete set null,
  dropped_at timestamptz not null default now()
);
alter table public.unique_drops enable row level security;
-- Aucune politique ni droit : le registre des tirages uniques reste secret pour tous les joueurs.

-- La probabilité de la carte unique est figée avec le reste de la version de règles.
create or replace function private.pack_rulesets_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_all text[] := enum_range(null::public.rarity)::text[];
  i integer;
begin
  if tg_op = 'UPDATE' then
    -- Une version appliquée à des tirages ne change jamais : seule l'activation bascule.
    if (new.version, new.slots, new.finishes, new.unique_odds) is distinct from (old.version, old.slots, old.finishes, old.unique_odds) then
      raise exception 'immutable_ruleset: créer une nouvelle version';
    end if;
    return new;
  end if;
  if jsonb_typeof(new.slots) <> 'array' or jsonb_array_length(new.slots) <> 5 then
    raise exception 'invalid_weights: 5 emplacements requis';
  end if;
  for i in 0..3 loop
    perform private.assert_weight_table(new.slots->i, v_all, format('emplacement %s', i + 1));
  end loop;
  -- 5e emplacement : garantie Rare ou mieux (CDC §4).
  perform private.assert_weight_table(new.slots->4, array['Rare','Très rare','Épique','Légendaire','Mythique'], 'emplacement 5');
  perform private.assert_weight_table(new.finishes, enum_range(null::public.finish)::text[], 'finitions');
  return new;
end $$;

-- Les cartes uniques ne comptent pas dans les 7 raretés obligatoires.
create or replace function private.edition_is_complete(p_edition_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select count(distinct c.rarity) = cardinality(enum_range(null::public.rarity))
  from public.characters c
  where c.edition_id = p_edition_id and c.status = 'published' and not c.is_unique
$$;

-- Un seul exemplaire possible, jamais détruit (recyclage, correction). Seule exception :
-- suppression en cascade d'un compte (droit à l'effacement).
create function private.unique_card_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.characters c where c.id = new.character_id and c.is_unique)
       and exists (select 1 from public.inventory_items i where i.character_id = new.character_id) then
      raise exception 'unique_already_owned';
    end if;
    return new;
  end if;
  if pg_trigger_depth() <= 1
     and exists (select 1 from public.characters c where c.id = old.character_id and c.is_unique) then
    raise exception 'unique_indestructible';
  end if;
  return old;
end $$;
create trigger inventory_unique_guard before insert or delete on public.inventory_items
  for each row execute function private.unique_card_guard();

-- Le caractère « unique » est figé dès qu'un exemplaire existe.
create function private.unique_flag_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_unique is distinct from old.is_unique
     and exists (select 1 from public.inventory_items i where i.character_id = new.id) then
    raise exception 'immutable_character: carte déjà tirée';
  end if;
  return new;
end $$;
create trigger characters_unique_flag_guard before update of is_unique on public.characters
  for each row execute function private.unique_flag_guard();

create function public.admin_set_unique(p_id uuid, p_unique boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before boolean;
begin
  select is_unique into v_before from public.characters where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.characters set is_unique = p_unique where id = p_id;
  perform private.audit(v_admin, 'character_unique', p_id, p_reason,
    jsonb_build_object('is_unique', v_before), jsonb_build_object('is_unique', p_unique));
end $$;

create or replace function private.opening_result(p_opening_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'opening_id', o.id,
    'edition_id', o.edition_id,
    'ruleset_version', r.version,
    'pool', o.pool,
    'created_at', o.created_at,
    'cards', (
      select jsonb_agg(jsonb_build_object(
        'position', pc.position,
        'instance_id', pc.instance_id,
        'character_id', c.id,
        'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
        'number', c.number,
        'name', c.name,
        'role_title', c.role_title,
        'clan', cl.name,
        'rarity', pc.rarity,
        'unique', c.is_unique,
        'finish', pc.finish,
        'art_path', c.art_path,
        'art_meta', c.art_meta,
        'silhouette_key', c.silhouette_key) order by pc.position)
      from public.pack_opening_cards pc
      join public.characters c on c.id = pc.character_id
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      where pc.opening_id = o.id))
  from public.pack_openings o
  join public.pack_rulesets r on r.id = o.ruleset_id
  where o.id = p_opening_id
$$;

create or replace function public.open_booster(p_edition_id uuid, p_request_id uuid, p_pool text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_balance public.booster_balances;
  v_existing uuid;
  v_edition public.editions;
  v_ruleset public.pack_rulesets := private.active_ruleset();
  v_reward bigint := ((private.active_settings()).settings->>'discovery_reward')::bigint;
  v_pool text;
  v_opening_id uuid;
  v_pos integer;
  v_rarity public.rarity;
  v_finish public.finish;
  v_candidates uuid[];
  v_character uuid;
  v_instance uuid;
  v_new boolean;
  v_unique uuid;
  v_unique_won boolean;
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;
  -- Verrou du solde : deux ouvertures concurrentes sont sérialisées ici.
  v_balance := private.sync_free_boosters(v_uid);

  select o.id into v_existing from public.pack_openings o
   where o.owner_id = v_uid and o.request_id = p_request_id;
  if found then
    return private.opening_result(v_existing) || jsonb_build_object('replayed', true);
  end if;

  select * into v_edition from public.editions e where e.id = p_edition_id;
  if not found or not v_edition.packs_enabled or v_edition.archived_at is not null then
    raise exception 'edition_unavailable';
  end if;
  if not private.edition_is_complete(p_edition_id) then
    raise exception 'edition_incomplete';
  end if;
  if v_ruleset.id is null then
    raise exception 'no_active_ruleset';
  end if;

  v_pool := coalesce(p_pool, case when v_balance.free_count > 0 then 'free' else 'purchased' end);
  if v_pool = 'free' and v_balance.free_count > 0 then
    update public.booster_balances set free_count = free_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool = 'purchased' and v_balance.purchased_count > 0 then
    update public.booster_balances set purchased_count = purchased_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool not in ('free', 'purchased') then
    raise exception 'invalid_pool';
  else
    raise exception 'no_booster_available';
  end if;

  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id)
    returning id into v_opening_id;

  for v_pos in 1..5 loop
    v_unique_won := false;
    -- Carte unique : à la place de la 5e carte, une chance sur unique_odds, une seule fois
    -- dans tout le jeu. L'insertion dans unique_drops (clé primaire) arbitre deux tirages simultanés.
    if v_pos = 5 and v_ruleset.unique_odds > 0 then
      select c.id into v_unique from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.is_unique
         and not exists (select 1 from public.unique_drops d where d.character_id = c.id)
       order by c.number limit 1;
      if v_unique is not null and private.random_below(v_ruleset.unique_odds) = 0 then
        insert into public.unique_drops (character_id, opening_id, first_owner_id)
          values (v_unique, v_opening_id, v_uid) on conflict do nothing;
        v_unique_won := found;
      end if;
    end if;
    if v_unique_won then
      v_character := v_unique;
      select c.rarity into v_rarity from public.characters c where c.id = v_unique;
      v_finish := 'Standard';
    else
      v_rarity := private.pick_weighted(v_ruleset.slots->(v_pos - 1))::public.rarity;
      select array_agg(c.id order by c.id) into v_candidates
        from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity and not c.is_unique;
      if v_candidates is null then
        -- Jamais de repli vers une autre rareté ou édition (CDC §4).
        raise exception 'edition_incomplete';
      end if;
      v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
      v_finish := private.pick_weighted(v_ruleset.finishes)::public.finish;
    end if;

    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id)
      values (v_uid, v_character, v_finish, v_opening_id)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish);

    insert into public.discoveries (owner_id, character_id) values (v_uid, v_character)
      on conflict do nothing;
    v_new := found;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (v_uid, v_character, v_finish)
      on conflict do nothing;
    if v_new and v_reward > 0 then
      perform private.apply_wallet_delta(v_uid, v_reward, 'discovery_reward', 'character', v_character,
                                         'discovery:' || v_character);
    end if;
  end loop;

  return private.opening_result(v_opening_id) || jsonb_build_object('replayed', false);
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
                       where i.owner_id = v_uid and i.character_id = c.id group by i.finish) x))
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

create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

revoke execute on function public.admin_set_unique(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_unique(uuid, boolean, text) to authenticated;
