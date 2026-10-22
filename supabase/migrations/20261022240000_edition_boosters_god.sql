-- CARTEMA — boosters par édition et God booster (22/10/2026, préparation du set ANE).
--  * Chaque édition a son sachet (thème), ses prix (booster_offers ; vide = prix généraux) et peut
--    être annoncée en « Soon » (teaser) : seul son nom et son sachet sont montrés, jamais ses cartes.
--  * Réserve : boosters gratuits et récompenses (purchased_count) restent ouvrables sur n'importe
--    quelle édition ; les boosters achetés en boutique sont rangés par édition (booster_edition_balances).
--    À l'ouverture : gratuits d'abord, puis ceux de l'édition, puis les récompenses.
--  * God booster : à chaque ouverture, une chance « 1 sur N » (god_booster_settings, réglable en admin).
--    Toutes ses cartes sont au moins Dorées (une part en Sanglante), les versions alternatives tombent
--    bien plus souvent et les dernières cartes avant la 5e suivent la table de la 5e (Rare ou mieux).

alter table public.editions add column teaser boolean not null default false;
alter table public.editions add column booster_theme text not null default 'camarilla'
  check (booster_theme in ('camarilla', 'alpes', 'sabbat', 'independant', 'gold'));
alter table public.editions add column booster_offers jsonb;

create table public.booster_edition_balances (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  edition_id uuid not null references public.editions(id),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, edition_id)
);
alter table public.booster_edition_balances enable row level security;

alter table public.shop_orders add column edition_id uuid references public.editions(id);
alter table public.booster_grants add column edition_id uuid references public.editions(id);
alter table public.pack_openings drop constraint if exists pack_openings_pool_check;
alter table public.pack_openings add constraint pack_openings_pool_check check (pool in ('free', 'purchased', 'edition'));
alter table public.pack_openings add column god boolean not null default false;

create table public.god_booster_settings (
  id boolean primary key default true check (id),
  odds integer not null default 1000 check (odds between 0 and 1000000),
  blood_pct numeric not null default 10 check (blood_pct between 0 and 100),
  alt_odds integer not null default 20 check (alt_odds between 0 and 1000000),
  rare_slots integer not null default 2 check (rare_slots between 0 and 4),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.god_booster_settings default values;
alter table public.god_booster_settings enable row level security;

-- Prix d'une édition : les siens, sinon les prix généraux.
create function private.edition_offers(p_edition_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select e.booster_offers from public.editions e where e.id = p_edition_id),
                  (private.active_settings()).settings->'booster_offers')
$$;

-- Version tirée : p_cap plafonne la chance « 1 sur N » (God booster) ; une ligne à 0 reste « jamais ».
drop function private.pick_alternate_art(uuid, integer);
create function private.pick_alternate_art(p_character uuid, p_global_odds integer, p_cap integer default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_line record;
begin
  for v_line in
    -- Une ligne réglée à 0 ne tombe jamais ; sinon le plafond (God booster) rend la chance meilleure.
    select a.label, count(*)::int as n,
           case when l.odds = 0 then 0
                when coalesce(p_cap, 0) > 0 then least(coalesce(nullif(coalesce(l.odds, p_global_odds, 0), 0), p_cap), p_cap)
                else coalesce(l.odds, p_global_odds, 0) end as odds
      from public.card_arts a
      left join public.card_art_lines l on l.label = a.label
     where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and coalesce(l.active, true)
     group by a.label, l.odds
     order by random()
  loop
    if v_line.odds > 0 and private.random_below(v_line.odds) = 0 then
      return (select a.id from public.card_arts a
               where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and a.label = v_line.label
               order by a.id offset private.random_below(v_line.n) limit 1);
    end if;
  end loop;
  return null;
end $$;

-- Ouverture : reprise de open_booster (20261022160000_art_lines), avec la réserve par édition et le God booster.
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
  v_edition_left integer := 0;
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

  v_god := coalesce(v_god_cfg.odds, 0) > 0 and private.random_below(v_god_cfg.odds) = 0;
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
      v_rarity := private.pick_weighted(v_ruleset.slots->(case when v_god and v_pos >= 5 - v_god_cfg.rare_slots then 4 else v_pos - 1 end))::public.rarity;
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

-- Achat en boutique : au prix de l'édition choisie, rangé dans sa réserve. Sans édition (anciennes
-- pages encore ouvertes) : prix généraux, réserve partagée, comme avant.
drop function public.buy_boosters(integer, uuid);
create function public.buy_boosters(p_quantity integer, p_request_id uuid, p_edition_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings public.economy_settings := private.active_settings();
  v_price bigint;
  v_order public.shop_orders;
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;
  -- Verrou du compteur avant toute lecture : sérialise les achats d'un même joueur.
  perform 1 from public.booster_balances where owner_id = v_uid for update;

  select * into v_order from public.shop_orders where owner_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'replayed', true,
      'balance', (select balance from public.wallets where owner_id = v_uid),
      'purchased', (select purchased_count from public.booster_balances where owner_id = v_uid));
  end if;

  if p_edition_id is null then
    v_price := (v_settings.settings->'booster_offers'->>p_quantity::text)::bigint;
    if not exists (select 1 from public.editions e
                   where e.packs_enabled and e.archived_at is null and private.edition_is_complete(e.id)) then
      raise exception 'no_openable_edition';
    end if;
  else
    if not exists (select 1 from public.editions e where e.id = p_edition_id and e.packs_enabled
                   and e.archived_at is null and private.edition_is_complete(e.id)) then
      raise exception 'edition_unavailable';
    end if;
    v_price := (private.edition_offers(p_edition_id)->>p_quantity::text)::bigint;
  end if;
  if v_price is null or v_price <= 0 then
    raise exception 'invalid_offer';
  end if;

  insert into public.shop_orders (owner_id, quantity, price, settings_version, request_id, edition_id)
    values (v_uid, p_quantity, v_price, v_settings.version, p_request_id, p_edition_id)
    returning * into v_order;
  perform private.apply_wallet_delta(v_uid, -v_price, 'shop_booster', 'shop_order', v_order.id, 'shop:' || v_order.id);
  if p_edition_id is null then
    update public.booster_balances set purchased_count = purchased_count + p_quantity, updated_at = now() where owner_id = v_uid;
  else
    insert into public.booster_edition_balances (owner_id, edition_id, count) values (v_uid, p_edition_id, p_quantity)
      on conflict (owner_id, edition_id) do update set count = public.booster_edition_balances.count + excluded.count, updated_at = now();
  end if;
  insert into public.booster_grants (owner_id, source, pool, quantity, ref_id, edition_id)
    values (v_uid, 'shop', 'purchased', p_quantity, v_order.id, p_edition_id);

  return jsonb_build_object('order_id', v_order.id, 'replayed', false,
    'balance', (select balance from public.wallets where owner_id = v_uid),
    'purchased', (select purchased_count from public.booster_balances where owner_id = v_uid),
    'edition_reserve', (select count from public.booster_edition_balances where owner_id = v_uid and edition_id = p_edition_id));
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
    'profile', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role, 'created_at', p.created_at, 'title', p.title)
                from public.profiles p where p.id = v_uid),
    'balance', (select w.balance from public.wallets w where w.owner_id = v_uid),
    'boosters', jsonb_build_object(
      'free', v_boosters.free_count,
      'purchased', v_boosters.purchased_count,
      'free_capacity', (v_settings->>'free_booster_capacity')::int,
      'next_free_at', (select min(s) from private.free_slots_between(now(), now() + interval '1 day') s)),
    'booster_offers', v_settings->'booster_offers',
    'daily_reward', v_daily,
    'missions_ready', (select count(*) from public.mission_assignments a join public.mission_templates t on t.code = a.template_code
                        where a.owner_id = v_uid and a.replaced_at is null and a.claimed_at is null and a.period_end > now()
                          and private.metric_value(v_uid, t.metric, a.period_start, a.period_end) >= t.target),
    'social_pending', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'),
    -- Éditions ouvertes, avec leurs prix et les boosters achetés pour elles ; puis les éditions annoncées
    -- (« Soon ») : leur nom et leur sachet seulement.
    'editions', coalesce((
      select jsonb_agg(x.e order by x.teaser, x.created_at) from (
        select e.created_at, false as teaser,
               jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
                 'openable', private.edition_is_complete(e.id), 'teaser', false, 'theme', e.booster_theme,
                 'offers', private.edition_offers(e.id),
                 'reserve', coalesce((select b.count from public.booster_edition_balances b where b.owner_id = v_uid and b.edition_id = e.id), 0)) as e
          from public.editions e where e.packs_enabled and e.archived_at is null
        union all
        select e.created_at, true,
               jsonb_build_object('id', e.id, 'name', e.name, 'teaser', true, 'openable', false, 'theme', e.booster_theme)
          from public.editions e where e.teaser and not e.packs_enabled and e.archived_at is null) x), '[]'::jsonb)
  );
end $$;

-- Boutique et annonce d'une édition (admin) : teaser, sachet, prix (null = prix généraux).
create function public.admin_set_edition_shop(p_id uuid, p_teaser boolean, p_theme text, p_offers jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.editions;
begin
  select * into v_before from public.editions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_offers is not null and (jsonb_typeof(p_offers) <> 'object'
      or exists (select 1 from jsonb_each(p_offers) o where o.key not in ('1', '3', '10')
                   or jsonb_typeof(o.value) <> 'number' or (o.value)::text::numeric <= 0
                   or (o.value)::text::numeric <> floor((o.value)::text::numeric))
      or not (p_offers ? '1')) then
    raise exception 'invalid_offer';
  end if;
  update public.editions set teaser = coalesce(p_teaser, false), booster_theme = coalesce(p_theme, booster_theme),
                             booster_offers = p_offers
   where id = p_id;
  perform private.audit(v_admin, 'edition_shop', p_id, v_reason,
    jsonb_build_object('teaser', v_before.teaser, 'theme', v_before.booster_theme, 'offers', v_before.booster_offers),
    jsonb_build_object('teaser', coalesce(p_teaser, false), 'theme', p_theme, 'offers', p_offers));
end $$;

create function public.admin_god_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('odds', g.odds, 'blood_pct', g.blood_pct, 'alt_odds', g.alt_odds, 'rare_slots', g.rare_slots,
                                    'opened', (select count(*) from public.pack_openings o where o.god))
            from public.god_booster_settings g);
end $$;

create function public.admin_save_god_settings(p_odds integer, p_blood_pct numeric, p_alt_odds integer, p_rare_slots integer,
                                               p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.god_booster_settings;
begin
  select * into v_before from public.god_booster_settings for update;
  update public.god_booster_settings set odds = p_odds, blood_pct = p_blood_pct, alt_odds = p_alt_odds, rare_slots = p_rare_slots,
                                         updated_by = v_admin, updated_at = now();
  perform private.audit(v_admin, 'god_settings', null, v_reason,
    jsonb_build_object('odds', v_before.odds, 'blood_pct', v_before.blood_pct, 'alt_odds', v_before.alt_odds, 'rare_slots', v_before.rare_slots),
    jsonb_build_object('odds', p_odds, 'blood_pct', p_blood_pct, 'alt_odds', p_alt_odds, 'rare_slots', p_rare_slots));
end $$;

revoke execute on function private.edition_offers(uuid), private.pick_alternate_art(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.buy_boosters(integer, uuid, uuid), public.admin_set_edition_shop(uuid, boolean, text, jsonb, text),
  public.admin_god_settings(), public.admin_save_god_settings(integer, numeric, integer, integer, text) from public, anon;
grant execute on function public.buy_boosters(integer, uuid, uuid), public.admin_set_edition_shop(uuid, boolean, text, jsonb, text),
  public.admin_god_settings(), public.admin_save_god_settings(integer, numeric, integer, integer, text) to authenticated;

-- Catalogue d'administration : boutique et annonce des éditions.
create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers,
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
