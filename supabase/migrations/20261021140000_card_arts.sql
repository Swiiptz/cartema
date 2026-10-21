-- CARTEMA — versions d'illustration (demande du 21/10/2026).
--  * Changement d'illustration officielle : l'ancienne devient une version « d'origine » (legacy).
--    Les exemplaires possédés à ce moment la gardent ; les tirages suivants ont la nouvelle.
--    Un simple recadrage (même fichier) ne crée pas de version.
--  * Versions alternatives (ex. dessins faits à la main) : ajoutées par l'administrateur, tirées
--    avec une chance globale « 1 sur N » (réglage alternate_art_odds, 500 par défaut, 0 = jamais)
--    chaque fois que le personnage est tiré ; la version est choisie au hasard parmi les actives.
--    La finition est tirée indépendamment. Jamais pour la carte unique.
--  * L'exemplaire porte sa version (inventory_items.art_id, null = illustration officielle du
--    moment) ; elle le suit dans le marché, les échanges, les cadeaux et la vitrine.
--  * Crédits : nom de l'artiste de l'illustration officielle (characters.art_credit) et de chaque
--    version (card_arts.credit), affiché dans la fiche de la carte ; une nouvelle illustration
--    officielle repart sans crédit tant qu'il n'est pas renseigné.

create table public.card_arts (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id),
  kind text not null check (kind in ('legacy', 'alternate')),
  label text not null check (length(trim(label)) > 0),
  art_path text not null,
  art_meta jsonb not null default '{}'::jsonb,
  credit text check (credit is null or length(credit) <= 80),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index card_arts_character_ix on public.card_arts (character_id) where active;
alter table public.card_arts enable row level security;

alter table public.characters add column art_credit text check (art_credit is null or length(art_credit) <= 80);
alter table public.inventory_items add column art_id uuid references public.card_arts(id);
alter table public.pack_opening_cards add column art_id uuid references public.card_arts(id);

-- Réglage global de la chance des versions alternatives.
update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"alternate_art_odds": 500}'::jsonb
    from public.economy_settings;

-- ---------------------------------------------------------------- changement d'illustration
create function private.on_character_art_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_art uuid;
  v_count integer;
begin
  if old.art_path is not null and new.art_path is distinct from old.art_path then
    v_count := (select count(*) from public.card_arts where character_id = old.id and kind = 'legacy');
    insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, active)
      values (old.id, 'legacy', case when v_count = 0 then 'Illustration d’origine' else 'Ancienne illustration ' || (v_count + 1) end,
              old.art_path, coalesce(old.art_meta, '{}'::jsonb), old.art_credit, false)
      returning id into v_art;
    -- Les exemplaires possédés gardent l'illustration qu'ils avaient.
    update public.inventory_items set art_id = v_art
     where character_id = old.id and art_id is null and recycled_at is null;
    -- Le crédit appartenait à l'ancienne image, sauf s'il est changé dans la même opération.
    if new.art_credit is not distinct from old.art_credit then new.art_credit := null; end if;
  end if;
  return new;
end $$;
create trigger characters_art_versions before update of art_path on public.characters
  for each row execute function private.on_character_art_change();

-- ---------------------------------------------------------------- administration des versions
create function public.admin_card_arts(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'label', a.label, 'art_path', a.art_path,
      'art_meta', a.art_meta, 'credit', a.credit, 'active', a.active, 'created_at', a.created_at,
      'owned', (select count(*) from public.inventory_items i where i.art_id = a.id and i.recycled_at is null)) order by a.created_at)
    from public.card_arts a where a.character_id = p_character_id), '[]'::jsonb);
end $$;

create function public.admin_add_card_art(p_character_id uuid, p_art_path text, p_art_meta jsonb, p_label text, p_reason text,
                                          p_credit text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_id uuid;
begin
  perform private.assert_art(p_art_path, p_art_meta);
  if p_art_path is null then raise exception 'invalid_art_path'; end if;
  if not exists (select 1 from public.characters where id = p_character_id and not is_unique) then raise exception 'not_found'; end if;
  insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, created_by)
    values (p_character_id, 'alternate', coalesce(nullif(trim(p_label), ''), 'Version alternative'), p_art_path, coalesce(p_art_meta, '{}'::jsonb),
            nullif(trim(coalesce(p_credit, '')), ''), v_admin)
    returning id into v_id;
  perform private.audit(v_admin, 'art_alternate_add', p_character_id, v_reason, null, jsonb_build_object('art', v_id, 'label', p_label));
  return v_id;
end $$;

-- Crédit de l'illustration officielle (p_art_id null) ou d'une version ; vide = retirer le crédit.
create function public.admin_set_art_credit(p_character_id uuid, p_art_id uuid, p_credit text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_credit text := nullif(trim(coalesce(p_credit, '')), '');
begin
  if length(v_credit) > 80 then raise exception 'invalid_credit'; end if;
  if p_art_id is null then
    update public.characters set art_credit = v_credit where id = p_character_id;
  else
    update public.card_arts set credit = v_credit where id = p_art_id and character_id = p_character_id;
  end if;
  if not found then raise exception 'not_found'; end if;
  perform private.audit(v_admin, 'art_credit', p_character_id, v_reason, null, jsonb_build_object('art', p_art_id, 'credit', v_credit));
end $$;

-- Une version déjà tirée n'est jamais supprimée : on peut seulement arrêter de la tirer.
create function public.admin_set_card_art_active(p_id uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_art public.card_arts;
begin
  select * into v_art from public.card_arts where id = p_id for update;
  if not found or v_art.kind <> 'alternate' then raise exception 'not_found'; end if;
  update public.card_arts set active = coalesce(p_active, false) where id = p_id;
  perform private.audit(v_admin, case when p_active then 'art_alternate_enable' else 'art_alternate_disable' end,
                        v_art.character_id, v_reason, null, jsonb_build_object('art', p_id));
end $$;

-- Catalogue d'administration : crédit de l'illustration officielle.
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
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- tirage et affichage des versions
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
  v_finish_multiplier numeric;
  v_event uuid;
  v_art uuid;
  -- Chance globale « 1 sur N » d'une version alternative à chaque personnage tiré (0 = jamais).
  v_alt_odds integer := coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0);
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

  -- Événement en cours : finitions rares plus fréquentes (le plus fort s'applique).
  select e.finish_multiplier, e.id into v_finish_multiplier, v_event
    from private.active_events() e where e.finish_multiplier > 1 order by e.finish_multiplier desc limit 1;

  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id, event_id)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id, v_event)
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
      v_art := null;
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
      v_finish := private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish;
      v_art := null;
      if v_alt_odds > 0 and exists (select 1 from public.card_arts a where a.character_id = v_character and a.kind = 'alternate' and a.active)
         and private.random_below(v_alt_odds) = 0 then
        select a.id into v_art from public.card_arts a
         where a.character_id = v_character and a.kind = 'alternate' and a.active
         order by a.id offset private.random_below((select count(*)::int from public.card_arts a2
                                                     where a2.character_id = v_character and a2.kind = 'alternate' and a2.active)) limit 1;
      end if;
    end if;

    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id, art_id)
      values (v_uid, v_character, v_finish, v_opening_id, v_art)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish, art_id)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish, v_art);

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
        'art_path', coalesce(a.art_path, c.art_path),
        'art_meta', case when a.id is not null then a.art_meta else c.art_meta end,
        'variant', a.label, 'variant_kind', a.kind,
        'silhouette_key', c.silhouette_key) order by pc.position)
      from public.pack_opening_cards pc
      join public.characters c on c.id = pc.character_id
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.card_arts a on a.id = pc.art_id
      where pc.opening_id = o.id))
  from public.pack_openings o
  join public.pack_rulesets r on r.id = o.ruleset_id
  where o.id = p_opening_id
$$;

create or replace function private.card_json(p_character uuid, p_finish public.finish, p_instance uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('instance_id', p_instance, 'finish', p_finish,
    'character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
    'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity, 'unique', c.is_unique,
    'art_path', coalesce(a.art_path, c.art_path), 'art_meta', case when a.id is not null then a.art_meta else c.art_meta end,
    'variant', a.label, 'variant_kind', a.kind, 'art_credit', case when a.id is not null then a.credit else c.art_credit end,
    'silhouette_key', c.silhouette_key)
  from public.characters c join public.editions e on e.id = c.edition_id left join public.clans cl on cl.id = c.clan_id
  left join public.inventory_items i on i.id = p_instance
  left join public.card_arts a on a.id = i.art_id
  where c.id = p_character
$$;

create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind in ('listing', 'auction') then i.reserved_ref end,
      'listing_price', (select coalesce(l.current_bid, l.price) from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'listing_kind', (select l.kind from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique,
      'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
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
          'art_credit', c.art_credit,
          'variants', (select coalesce(jsonb_agg(jsonb_build_object('label', v.label, 'kind', v.kind, 'art_path', v.art_path,
                           'art_meta', v.art_meta, 'credit', v.credit, 'count', v.n) order by v.label), '[]'::jsonb) from (
                         select a.label, a.kind, a.art_path, a.art_meta, a.credit, count(*) n from public.inventory_items i
                           join public.card_arts a on a.id = i.art_id
                          where i.owner_id = v_uid and i.character_id = c.id and i.recycled_at is null
                          group by a.id, a.label, a.kind, a.art_path, a.art_meta, a.credit) v),
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

-- Réglage de la chance des versions alternatives.
create or replace function private.validate_settings(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  r text;
begin
  for k in select jsonb_object_keys(p) loop
    if k not in ('booster_offers', 'daily_login_reward', 'discovery_reward', 'welcome_free_boosters', 'free_booster_capacity',
                 'market_commission_pct', 'mission_bonus_daily', 'mission_bonus_weekly', 'recycle_values', 'finish_multipliers',
                 'alternate_art_odds') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000]}'::jsonb) loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric <> trunc((p->>k)::numeric)
       or (p->>k)::numeric < (v->>0)::numeric or (p->>k)::numeric > (v->>1)::numeric then
      raise exception 'invalid_setting' using detail = k;
    end if;
  end loop;
  if (p->>'welcome_free_boosters')::int > (p->>'free_booster_capacity')::int then -- valeurs déjà contrôlées ci-dessus
    raise exception 'invalid_setting' using detail = 'welcome_free_boosters';
  end if;
  if jsonb_typeof(p->'booster_offers') is distinct from 'object' or not (p->'booster_offers' ? '1') then
    raise exception 'invalid_setting' using detail = 'booster_offers';
  end if;
  for k, v in select * from jsonb_each(p->'booster_offers') loop
    if k !~ '^[1-9][0-9]?$' or jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric <> trunc((v#>>'{}')::numeric)
       or (v#>>'{}')::numeric < 1 or (v#>>'{}')::numeric > 1000000 then
      raise exception 'invalid_setting' using detail = 'booster_offers';
    end if;
  end loop;
  foreach r in array enum_range(null::public.rarity)::text[] loop
    if jsonb_typeof(p->'recycle_values'->r) is distinct from 'number' or (p->'recycle_values'->>r)::numeric < 0
       or (p->'recycle_values'->>r)::numeric > 1000000 or (p->'recycle_values'->>r)::numeric <> trunc((p->'recycle_values'->>r)::numeric) then
      raise exception 'invalid_setting' using detail = 'recycle_values';
    end if;
  end loop;
  if (p->'finish_multipliers'->>'Standard')::numeric is distinct from 1
     or coalesce((p->'finish_multipliers'->>'Dorée')::numeric, 0) not between 1 and 100
     or coalesce((p->'finish_multipliers'->>'Sanglante')::numeric, 0) not between 1 and 100 then
    raise exception 'invalid_setting' using detail = 'finish_multipliers';
  end if;
end $$;

create or replace function public.admin_save_settings(p_changes jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_old public.economy_settings;
  v_new jsonb;
  v_version integer;
begin
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_setting'; end if;
  perform 1 from public.economy_settings for update;
  select * into v_old from public.economy_settings where active;
  v_new := v_old.settings || p_changes;
  perform private.validate_settings(p_changes || jsonb_build_object(
    'welcome_free_boosters', v_new->'welcome_free_boosters', 'free_booster_capacity', v_new->'free_booster_capacity',
    'booster_offers', v_new->'booster_offers', 'recycle_values', v_new->'recycle_values', 'finish_multipliers', v_new->'finish_multipliers',
    'daily_login_reward', v_new->'daily_login_reward', 'discovery_reward', v_new->'discovery_reward',
    'market_commission_pct', v_new->'market_commission_pct', 'mission_bonus_daily', v_new->'mission_bonus_daily',
    'mission_bonus_weekly', v_new->'mission_bonus_weekly', 'alternate_art_odds', v_new->'alternate_art_odds'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

revoke execute on function private.on_character_art_change() from public, anon, authenticated;
revoke execute on function public.admin_card_arts(uuid), public.admin_add_card_art(uuid, text, jsonb, text, text, text),
  public.admin_set_card_art_active(uuid, boolean, text), public.admin_set_art_credit(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_card_arts(uuid), public.admin_add_card_art(uuid, text, jsonb, text, text, text),
  public.admin_set_card_art_active(uuid, boolean, text), public.admin_set_art_credit(uuid, uuid, text, text) to authenticated;
