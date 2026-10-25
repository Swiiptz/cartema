-- CARTEMA — cartes signées (idée de Swiiptz, 25/10/2026).
--  * La personne qui joue un personnage envoie sa signature (image transparente) par une contribution
--    « signature » ; l'admin vérifie que c'est bien son personnage, publie l'image dans le stockage public
--    (illustrations) puis l'enregistre (admin_set_signature, characters.signature_path).
--  * Ensuite, chaque exemplaire tiré de ce personnage a une chance sur signed_odds (25 par défaut, Économie,
--    0 = jamais) d'être signé (inventory_items.signed, pack_opening_cards.signed), toutes finitions. La carte
--    unique n'est jamais signée.
--  * La signature suit l'exemplaire (card_json, opening_result, get_inventory : signed, signature).

alter table public.card_submissions drop constraint card_submissions_kind_check;
alter table public.card_submissions add constraint card_submissions_kind_check
  check (kind in ('info', 'illustration', 'credit', 'ambiance', 'signature'));
alter table public.card_submissions add constraint card_submissions_signature_image check (kind <> 'signature' or image_path is not null);
alter table public.characters add column signature_path text;
alter table public.inventory_items add column signed boolean not null default false;
alter table public.pack_opening_cards add column signed boolean not null default false;

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"signed_odds": 25}'::jsonb
    from public.economy_settings;

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
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct', 'trade_tax_pct', 'trade_weekly_deniers_cap', 'trade_daily_limit', 'gift_daily_limit', 'trade_cooldown_hours',
                 'streak_booster_every', 'streak_booster_count', 'pity_epic_every', 'pity_legend_every', 'signed_odds') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000], "trade_cooldown_hours": [0, 720],
      "streak_booster_every": [0, 60], "streak_booster_count": [0, 10],
      "pity_epic_every": [0, 1000], "pity_legend_every": [0, 10000],
      "signed_odds": [0, 100000]}'::jsonb) loop
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
    'mission_bonus_weekly', v_new->'mission_bonus_weekly', 'alternate_art_odds', v_new->'alternate_art_odds',
    'buyer_tax_pct', v_new->'buyer_tax_pct', 'bid_refund_tax_pct', v_new->'bid_refund_tax_pct',
    'trade_tax_pct', v_new->'trade_tax_pct', 'trade_weekly_deniers_cap', v_new->'trade_weekly_deniers_cap',
    'trade_daily_limit', v_new->'trade_daily_limit', 'gift_daily_limit', v_new->'gift_daily_limit', 'trade_cooldown_hours', v_new->'trade_cooldown_hours',
    'streak_booster_every', v_new->'streak_booster_every', 'streak_booster_count', v_new->'streak_booster_count',
    'pity_epic_every', v_new->'pity_epic_every', 'pity_legend_every', v_new->'pity_legend_every',
    'signed_odds', v_new->'signed_odds'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

create or replace function public.submit_card_feedback(p_code text, p_kind text, p_message text, p_image_path text default null,
                                            p_credit_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_character uuid := private.character_by_code(p_code);
  v_id uuid;
begin
  if v_character is null then raise exception 'not_found'; end if;
  -- On ne propose rien sur une carte jamais vue (son identité resterait cachée à l'auteur).
  if not exists (select 1 from public.discoveries where owner_id = v_uid and character_id = v_character) then raise exception 'not_discovered'; end if;
  if p_kind not in ('info', 'illustration', 'credit', 'ambiance', 'signature') then raise exception 'invalid_kind'; end if;
  -- Texte d'ambiance : 10 à 200 caractères.
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) < 10 then raise exception 'message_required'; end if;
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) > 200 then raise exception 'too_long'; end if;
  if p_kind = 'credit' and length(trim(coalesce(p_credit_name, ''))) not between 2 and 80 then raise exception 'credit_required'; end if;
  if p_kind = 'info' and length(trim(coalesce(p_message, ''))) < 5 then raise exception 'message_required'; end if;
  if p_kind in ('illustration', 'signature') and (p_image_path is null or split_part(p_image_path, '/', 1) <> v_uid::text or p_image_path like '%..%') then
    raise exception 'image_required';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.card_submissions where owner_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_submissions';
  end if;
  insert into public.card_submissions (owner_id, character_id, kind, message, image_path, credit_name)
    values (v_uid, v_character, p_kind, left(trim(coalesce(p_message, '')), 1500), case when p_kind in ('illustration', 'signature') then p_image_path end,
            nullif(trim(coalesce(p_credit_name, '')), ''))
    on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'already_submitted'; end if;
  perform private.notify((select id from public.profiles where role = 'admin' limit 1), 'submission_received',
    jsonb_build_object('from', private.handle_of(v_uid), 'kind', p_kind,
                       'card', (select name from public.characters where id = v_character)));
  return v_id;
end $$;

create function public.admin_set_signature(p_character_id uuid, p_path text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before text;
begin
  perform private.assert_art(p_path, '{}'::jsonb);
  select signature_path into v_before from public.characters where id = p_character_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.characters set signature_path = nullif(trim(coalesce(p_path, '')), '') where id = p_character_id;
  perform private.audit(v_admin, 'signature_set', p_character_id, v_reason, jsonb_build_object('signature', v_before),
                        jsonb_build_object('signature', p_path));
end $$;
revoke execute on function public.admin_set_signature(uuid, text, text) from public, anon;
grant execute on function public.admin_set_signature(uuid, text, text) to authenticated;

create or replace function private.card_json(p_character uuid, p_finish public.finish, p_instance uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('instance_id', p_instance, 'finish', p_finish,
    'character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
    'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity, 'unique', c.is_unique,
    'art_path', coalesce(a.art_path, c.art_path), 'art_meta', case when a.id is not null then a.art_meta else c.art_meta end,
    'variant', a.label, 'variant_kind', a.kind, 'art_credit', case when a.id is not null then a.credit else c.art_credit end,
    'silhouette_key', c.silhouette_key,
    'signed', coalesce(i.signed, false), 'signature', case when i.signed then c.signature_path end)
  from public.characters c join public.editions e on e.id = c.edition_id left join public.clans cl on cl.id = c.clan_id
  left join public.inventory_items i on i.id = p_instance
  left join public.card_arts a on a.id = i.art_id
  where c.id = p_character
$$;

create or replace function private.opening_result(p_opening_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'opening_id', o.id,
    'edition_id', o.edition_id,
    'ruleset_version', r.version,
    'pool', o.pool,
    'god', o.god,
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
        'silhouette_key', c.silhouette_key,
        'signed', pc.signed, 'signature', case when pc.signed then c.signature_path end,
        -- Découverte par cette ouverture (première occurrence du personnage dans le booster).
        'new', pc.position = (select min(p2.position) from public.pack_opening_cards p2
                               where p2.opening_id = o.id and p2.character_id = c.id)
               and exists (select 1 from public.discoveries d
                            where d.owner_id = o.owner_id and d.character_id = c.id and d.first_seen_at = o.created_at))
        order by pc.position)
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
      'acquired_at', i.acquired_at, 'unique', c.is_unique, 'cooldown_until', private.cooldown_until(i.social_received_at),
      'artist_copy', i.artist_until is not null, 'signed', i.signed, 'signature', case when i.signed then c.signature_path end, 'artist_until', case when i.artist_until > now() then i.artist_until end,
      'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers,
        'eternal', e.eternal, 'eternal_drops', e.eternal_drops,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key,
        'lineage_title', (select a.title from public.achievements a where a.code = 'lineage:' || c.id)) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit, 'art_ai', c.art_ai, 'signature_path', c.signature_path,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

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
  -- Chance « 1 sur N » par défaut des lignes de versions alternatives (0 = jamais).
  v_alt_odds integer := coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0);
  -- God booster : décidé une fois par ouverture.
  v_god_cfg public.god_booster_settings := (select g from public.god_booster_settings g limit 1);
  v_god boolean := false;
  v_since bigint;
  v_god_table jsonb;
  -- Cartes garanties : raretés imposées à la 5e carte (null = tirage normal).
  v_settings jsonb := (private.active_settings()).settings;
  v_force text[];
  -- Carte signée : une chance sur signed_odds pour un personnage dont la signature est publiée.
  v_signed_odds integer := coalesce((v_settings->>'signed_odds')::int, 0);
  v_signed boolean;
  v_edition_left integer := 0;
  v_eternal uuid[];
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

  -- Gratuits d'abord, puis les boosters achetés pour cette édition, puis les récompenses.
  v_edition_left := coalesce((select count from public.booster_edition_balances where owner_id = v_uid and edition_id = p_edition_id), 0);
  v_pool := coalesce(p_pool, case when v_balance.free_count > 0 then 'free' when v_edition_left > 0 then 'edition' else 'purchased' end);
  if v_pool = 'free' and v_balance.free_count > 0 then
    update public.booster_balances set free_count = free_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool = 'edition' and v_edition_left > 0 then
    update public.booster_edition_balances set count = count - 1, updated_at = now() where owner_id = v_uid and edition_id = p_edition_id;
  elsif v_pool = 'purchased' and v_balance.purchased_count > 0 then
    update public.booster_balances set purchased_count = purchased_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool not in ('free', 'purchased', 'edition') then
    raise exception 'invalid_pool';
  else
    raise exception 'no_booster_available';
  end if;

  -- Événement en cours : finitions rares plus fréquentes (le plus fort s'applique).
  select e.finish_multiplier, e.id into v_finish_multiplier, v_event
    from private.active_events() e where e.finish_multiplier > 1 order by e.finish_multiplier desc limit 1;

  -- Garantie cachée, propre au joueur : sa guarantee_every-ième ouverture depuis son dernier God booster
  -- (tombé par chance ou garanti) est un God booster. Ses ouvertures sont déjà sérialisées par le verrou du solde.
  if coalesce(v_god_cfg.guarantee_every, 0) > 0 then
    select count(*) into v_since from public.pack_openings o
     where o.owner_id = v_uid
       and o.created_at > coalesce((select max(g.created_at) from public.pack_openings g where g.owner_id = v_uid and g.god),
                                   '-infinity'::timestamptz);
  end if;
  v_god := (coalesce(v_god_cfg.guarantee_every, 0) > 0 and v_since + 1 >= v_god_cfg.guarantee_every)
           or (coalesce(v_god_cfg.odds, 0) > 0 and private.random_below(v_god_cfg.odds) = 0);
  if v_god then v_god_table := private.boost_top_rarities(v_ruleset.slots->4, v_god_cfg.legend_mult); end if;
  -- Pitié cachée : la N-ième ouverture sans Légendaire (ou sans Épique) depuis la dernière impose cette rareté
  -- ou mieux à la 5e carte. Compté sur l'historique du joueur (ouvertures déjà sérialisées par le verrou du solde).
  if coalesce((v_settings->>'pity_legend_every')::int, 0) > 0
     and private.openings_without(v_uid, array['Légendaire', 'Mythique']) + 1 >= (v_settings->>'pity_legend_every')::int then
    v_force := array['Légendaire', 'Mythique'];
  elsif coalesce((v_settings->>'pity_epic_every')::int, 0) > 0
     and private.openings_without(v_uid, array['Épique', 'Légendaire', 'Mythique']) + 1 >= (v_settings->>'pity_epic_every')::int then
    v_force := array['Épique', 'Légendaire', 'Mythique'];
  end if;
  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id, event_id, god)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id, v_event, v_god)
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
      -- God booster : les cartes juste avant la 5e suivent la table de la 5e (Rare ou mieux).
      v_rarity := private.pick_weighted(private.restrict_rarities(
                    case when v_god and v_pos >= 5 - v_god_cfg.rare_slots then v_god_table else v_ruleset.slots->(v_pos - 1) end,
                    case when v_pos = 5 then v_force end))::public.rarity;
      select array_agg(c.id order by c.id) into v_candidates
        from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity and not c.is_unique;
      if v_candidates is null then
        -- Jamais de repli vers une autre rareté ou édition (CDC §4).
        raise exception 'edition_incomplete';
      end if;
      v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
      if v_god then
        v_finish := case when private.random_below(10000) < round(v_god_cfg.blood_pct * 100) then 'Sanglante' else 'Dorée' end;
        v_art := private.pick_alternate_art(v_character, v_alt_odds, v_god_cfg.alt_odds);
      else
        v_finish := private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish;
        v_art := private.pick_alternate_art(v_character, v_alt_odds);
      end if;
    end if;

    v_signed := not v_unique_won and v_signed_odds > 0
                and exists (select 1 from public.characters c where c.id = v_character and c.signature_path is not null)
                and private.random_below(v_signed_odds) = 0;
    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id, art_id, signed)
      values (v_uid, v_character, v_finish, v_opening_id, v_art, v_signed)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish, art_id, signed)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish, v_art, v_signed);

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

  -- Sixième carte éternelle : dans un God booster ou un booster d'édition qui l'autorise, une rareté est
  -- tirée comme la 5e carte ; si l'édition éternelle a une carte de cette rareté, elle s'ajoute.
  if v_god or v_edition.eternal_drops then
    v_rarity := private.pick_weighted(case when v_god then v_god_table else v_ruleset.slots->4 end)::public.rarity;
    select array_agg(c.id order by c.id) into v_eternal
      from public.characters c join public.editions e on e.id = c.edition_id
     where e.eternal and e.archived_at is null and c.status = 'published' and not c.is_unique and c.rarity = v_rarity;
    if v_eternal is not null then
      v_character := v_eternal[1 + private.random_below(cardinality(v_eternal))];
      v_finish := case when v_god then 'Dorée'
                       else private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish end;
      insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id)
        values (v_uid, v_character, v_finish, v_opening_id) returning id into v_instance;
      insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish)
        values (v_opening_id, 6, v_instance, v_character, v_rarity, v_finish);
      insert into public.discoveries (owner_id, character_id) values (v_uid, v_character) on conflict do nothing;
      v_new := found;
      insert into public.finish_discoveries (owner_id, character_id, finish) values (v_uid, v_character, v_finish) on conflict do nothing;
      if v_new and v_reward > 0 then
        perform private.apply_wallet_delta(v_uid, v_reward, 'discovery_reward', 'character', v_character, 'discovery:' || v_character);
      end if;
    end if;
  end if;

  return private.opening_result(v_opening_id) || jsonb_build_object('replayed', false);
end $$;
