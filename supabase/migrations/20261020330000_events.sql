-- CARTEMA — événements (périodes spéciales réglées par l'administrateur).
-- Effets cumulables d'un événement, appliqués seulement entre son début et sa fin :
--  * finitions plus fréquentes : poids Dorée et Sanglante multipliés (×1 à ×5), Standard réduit
--    d'autant ; la table de tirage figée par version n'est pas modifiée, l'ouverture garde la
--    trace de l'événement (pack_openings.event_id) ;
--  * Deniers multipliés (×1 à ×3) sur le bonus de connexion et les récompenses de missions ;
--  * boosters offerts : à récupérer une fois par joueur pendant l'événement ;
--  * boosters gratuits plus fréquents : créneaux supplémentaires toutes les N heures (1, 2, 3, 4,
--    6, 8 ou 12 h, alignés sur 06 h, heure de Paris), en plus de 06 h et 18 h, toujours dans la
--    limite de la réserve.
-- Si plusieurs événements se chevauchent, le multiplicateur le plus fort et l'intervalle le plus
-- court s'appliquent. Toute création, modification ou annulation est inscrite au journal.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  finish_multiplier numeric(3, 1) not null default 1 check (finish_multiplier between 1 and 5),
  deniers_multiplier numeric(3, 1) not null default 1 check (deniers_multiplier between 1 and 3),
  bonus_boosters integer not null default 0 check (bonus_boosters between 0 and 10),
  free_interval_hours integer check (free_interval_hours in (1, 2, 3, 4, 6, 8, 12)),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at)
);
create index events_period_ix on public.events (starts_at, ends_at) where cancelled_at is null;
alter table public.events enable row level security;

create table public.event_claims (
  event_id uuid not null references public.events(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  boosters integer not null,
  claimed_at timestamptz not null default now(),
  primary key (event_id, owner_id)
);
alter table public.event_claims enable row level security;
grant select on public.event_claims to authenticated;
create policy own_event_claims on public.event_claims for select to authenticated using (owner_id = (select auth.uid()));

alter table public.pack_openings add column event_id uuid references public.events(id);

create function private.active_events(p_at timestamptz default now()) returns setof public.events
language sql stable security definer set search_path = '' as $$
  select * from public.events where cancelled_at is null and starts_at <= p_at and ends_at > p_at
$$;

-- Table des finitions ajustée : poids rares multipliés, Standard prend le reste (total 100 000).
create function private.event_finishes(p_finishes jsonb, p_multiplier numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_rare bigint := 0;
begin
  if coalesce(p_multiplier, 1) <= 1 then return p_finishes; end if;
  for v_item in select * from jsonb_array_elements(p_finishes) loop
    if v_item->>'value' <> 'Standard' then
      v_rare := v_rare + round((v_item->>'weight')::bigint * p_multiplier);
    end if;
  end loop;
  if v_rare >= 100000 then return p_finishes; end if;
  for v_item in select * from jsonb_array_elements(p_finishes) loop
    v_out := v_out || jsonb_build_array(jsonb_build_object('value', v_item->>'value', 'weight',
      case when v_item->>'value' = 'Standard' then 100000 - v_rare
           else round((v_item->>'weight')::bigint * p_multiplier) end));
  end loop;
  return v_out;
end $$;

create function private.deniers_multiplier(p_at timestamptz default now()) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(max(deniers_multiplier), 1) from private.active_events(p_at)
$$;

-- Créneaux gratuits : 06 h et 18 h, plus ceux des événements à intervalle réduit.
create or replace function private.free_slots_between(p_from timestamptz, p_to timestamptz)
returns setof timestamptz language sql stable security definer set search_path = '' as $$
  select distinct s from (
    select ((d::date + v.t) at time zone 'Europe/Paris') as s
      from generate_series((p_from at time zone 'Europe/Paris')::date,
                           (p_to at time zone 'Europe/Paris')::date,
                           interval '1 day') d
     cross join (values (time '06:00'), (time '18:00')) v(t)
    union
    select x.s from public.events e
     cross join lateral (
       select ((d::date + time '06:00' + make_interval(hours => h)) at time zone 'Europe/Paris') as s
         from generate_series((greatest(p_from, e.starts_at) at time zone 'Europe/Paris')::date - 1,
                              (least(p_to, e.ends_at) at time zone 'Europe/Paris')::date,
                              interval '1 day') d
        cross join generate_series(0, 23, e.free_interval_hours) h) x
     where e.cancelled_at is null and e.free_interval_hours is not null
       and e.starts_at < p_to and e.ends_at > p_from
       and x.s >= e.starts_at and x.s < e.ends_at
  ) y
  where s > p_from and s <= p_to
  order by s
$$;

-- Bonus de connexion multiplié pendant un événement (même clé : versé une fois par jour).
create or replace function private.claim_daily_reward(p_owner uuid, p_at timestamptz default now()) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_amount bigint := round(coalesce(((private.active_settings()).settings->>'daily_login_reward')::bigint, 0)
                           * private.deniers_multiplier(p_at));
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

-- Ouverture : finitions ajustées par l'événement en cours (copie de la version « carte unique »).
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

-- Missions : récompense multipliée par l'événement en cours.
create or replace function public.claim_mission(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_a public.mission_assignments;
  v_t public.mission_templates;
  v_balance bigint;
  v_bonus integer;
  v_reward bigint;
begin
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_a from public.mission_assignments where id = p_assignment_id and owner_id = v_uid for update;
  if not found or v_a.replaced_at is not null then raise exception 'not_found'; end if;
  if v_a.claimed_at is not null then raise exception 'already_claimed'; end if;
  select * into v_t from public.mission_templates where code = v_a.template_code;
  if private.metric_value(v_uid, v_t.metric, v_a.period_start, v_a.period_end) < v_t.target then
    raise exception 'mission_incomplete';
  end if;
  update public.mission_assignments set claimed_at = now() where id = v_a.id;
  -- Récompense multipliée pendant un événement « Deniers ».
  v_reward := round(v_t.reward * private.deniers_multiplier());
  v_balance := case when v_reward > 0
    then private.apply_wallet_delta(v_uid, v_reward, 'mission_reward', 'mission', v_a.id, 'mission:' || v_a.id)
    else (select balance from public.wallets where owner_id = v_uid) end;
  v_bonus := private.grant_mission_bonus(v_uid, v_a.kind, v_a.period_start);
  return jsonb_build_object('reward', v_reward, 'balance', v_balance, 'bonus_boosters', v_bonus);
end $$;

-- ---------------------------------------------------------------- joueurs
create function public.get_events() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'description', e.description,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'active', e.starts_at <= now(),
      'finish_multiplier', e.finish_multiplier, 'deniers_multiplier', e.deniers_multiplier,
      'bonus_boosters', e.bonus_boosters, 'free_interval_hours', e.free_interval_hours,
      'claimed', exists (select 1 from public.event_claims c where c.event_id = e.id and c.owner_id = v_uid))
      order by e.starts_at)
    from public.events e
   where e.cancelled_at is null and e.ends_at > now() and e.starts_at < now() + interval '14 days'), '[]'::jsonb);
end $$;

create function public.claim_event_bonus(p_event_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_event public.events;
begin
  select * into v_event from private.active_events() where id = p_event_id;
  if not found or v_event.bonus_boosters <= 0 then raise exception 'event_unavailable'; end if;
  perform 1 from public.booster_balances where owner_id = v_uid for update;
  insert into public.event_claims (event_id, owner_id, boosters) values (v_event.id, v_uid, v_event.bonus_boosters)
    on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  update public.booster_balances set purchased_count = purchased_count + v_event.bonus_boosters, updated_at = now()
   where owner_id = v_uid;
  insert into public.booster_grants (owner_id, source, pool, quantity, ref_id)
    values (v_uid, 'reward', 'purchased', v_event.bonus_boosters, v_event.id);
  return v_event.bonus_boosters;
end $$;

-- ---------------------------------------------------------------- administration
create function public.admin_events() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'description', e.description,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'cancelled_at', e.cancelled_at,
      'finish_multiplier', e.finish_multiplier, 'deniers_multiplier', e.deniers_multiplier,
      'bonus_boosters', e.bonus_boosters, 'free_interval_hours', e.free_interval_hours,
      'claims', (select count(*) from public.event_claims c where c.event_id = e.id),
      'openings', (select count(*) from public.pack_openings o where o.event_id = e.id))
      order by e.starts_at desc)
    from (select * from public.events order by starts_at desc limit 50) e), '[]'::jsonb);
end $$;

create function public.admin_save_event(p_id uuid, p_name text, p_description text, p_starts_at timestamptz, p_ends_at timestamptz,
                                        p_finish_multiplier numeric, p_deniers_multiplier numeric, p_bonus_boosters integer,
                                        p_free_interval_hours integer, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.events;
  v_after public.events;
begin
  if p_ends_at <= p_starts_at then raise exception 'invalid_period'; end if;
  if coalesce(p_finish_multiplier, 1) = 1 and coalesce(p_deniers_multiplier, 1) = 1 and coalesce(p_bonus_boosters, 0) = 0
     and p_free_interval_hours is null then
    raise exception 'event_without_effect';
  end if;
  if p_id is null then
    insert into public.events (name, description, starts_at, ends_at, finish_multiplier, deniers_multiplier, bonus_boosters,
                               free_interval_hours, created_by)
      values (trim(p_name), coalesce(trim(p_description), ''), p_starts_at, p_ends_at, coalesce(p_finish_multiplier, 1),
              coalesce(p_deniers_multiplier, 1), coalesce(p_bonus_boosters, 0), p_free_interval_hours, v_admin)
      returning * into v_after;
  else
    select * into v_before from public.events where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_before.cancelled_at is not null or v_before.ends_at <= now() then raise exception 'event_closed'; end if;
    update public.events set name = trim(p_name), description = coalesce(trim(p_description), ''),
           starts_at = p_starts_at, ends_at = p_ends_at, finish_multiplier = coalesce(p_finish_multiplier, 1),
           deniers_multiplier = coalesce(p_deniers_multiplier, 1), bonus_boosters = coalesce(p_bonus_boosters, 0),
           free_interval_hours = p_free_interval_hours
     where id = p_id returning * into v_after;
  end if;
  perform private.audit(v_admin, case when p_id is null then 'event_create' else 'event_update' end, v_after.id, v_reason,
                        case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after));
  return v_after.id;
end $$;

create function public.admin_cancel_event(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_event public.events;
begin
  select * into v_event from public.events where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_event.cancelled_at is not null then return; end if;
  -- Un événement en cours s'arrête maintenant (ses effets passés restent acquis).
  update public.events set cancelled_at = now(), ends_at = least(ends_at, greatest(now(), starts_at + interval '1 second'))
   where id = p_id;
  perform private.audit(v_admin, 'event_cancel', p_id, v_reason, to_jsonb(v_event), null);
end $$;

revoke execute on function private.active_events(timestamptz), private.event_finishes(jsonb, numeric),
  private.deniers_multiplier(timestamptz) from public, anon, authenticated;
revoke execute on function public.get_events(), public.claim_event_bonus(uuid), public.admin_events(),
  public.admin_save_event(uuid, text, text, timestamptz, timestamptz, numeric, numeric, integer, integer, text),
  public.admin_cancel_event(uuid, text) from public, anon;
grant execute on function public.get_events(), public.claim_event_bonus(uuid), public.admin_events(),
  public.admin_save_event(uuid, text, text, timestamptz, timestamptz, numeric, numeric, integer, integer, text),
  public.admin_cancel_event(uuid, text) to authenticated;
