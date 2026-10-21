-- CARTEMA — contenu des événements (CDC §7 : missions et récompenses dédiées, cartes événementielles
-- qui rejoignent ensuite l'édition, défis communautaires ; classement propre à l'événement).
--  * Missions d'événement : mesurées sur la période de l'événement, réclamables jusqu'à 48 h après
--    la fin, récompense en Deniers et / ou boosters, une seule fois par joueur.
--  * Cartes d'événement : personnages en brouillon rattachés à l'événement, publiés automatiquement
--    à son début (tâche planifiée), puis définitivement dans leur édition ; mention dans la fiche.
--  * Défi communautaire : total de tous les joueurs sur la période ; s'il atteint l'objectif à la fin,
--    chaque participant (au moins 1 sur la mesure) reçoit la récompense.
--  * Classement : joueurs ayant au moins 1 sur la mesure, récompenses pour les 3 premières places
--    (ex aequo récompensés à égalité).
--  * Clôture automatique et unique (settled_at) : versements idempotents et notifiés.
-- Mesures possibles : celles des missions (private.metric_value), comptées sur la période.

alter table public.events
  add column community_metric text, add column community_target integer check (community_target > 0),
  add column community_reward_deniers bigint not null default 0 check (community_reward_deniers >= 0),
  add column community_reward_boosters integer not null default 0 check (community_reward_boosters between 0 and 20),
  add column leaderboard_metric text,
  add column leaderboard_rewards jsonb not null default '[]'::jsonb,
  add column cards_published_at timestamptz,
  add column settled_at timestamptz;

alter table public.characters add column event_id uuid references public.events(id);

create table public.event_missions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  metric text not null,
  target integer not null check (target > 0),
  reward_deniers bigint not null default 0 check (reward_deniers between 0 and 100000),
  reward_boosters integer not null default 0 check (reward_boosters between 0 and 20),
  sort integer not null default 0
);
create table public.event_mission_claims (
  mission_id uuid not null references public.event_missions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (mission_id, owner_id)
);
create table public.event_rewards (
  event_id uuid not null references public.events(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('community', 'podium')),
  rank integer,
  deniers bigint not null default 0,
  boosters integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, owner_id, kind)
);
alter table public.event_missions enable row level security;
alter table public.event_mission_claims enable row level security;
alter table public.event_rewards enable row level security;

create function private.event_metric_allowed(p_metric text) returns boolean
language sql immutable set search_path = '' as $$
  select p_metric in ('open_boosters', 'open_days', 'discover', 'discover_days', 'rare_pull', 'very_rare_pull', 'epic_pull',
                      'recycle', 'market_sell', 'market_buy', 'market_list', 'auction_bid', 'trade_done', 'gift_send', 'daily_login')
$$;

-- Valeur d'un joueur sur la période écoulée de l'événement.
create function private.event_value(p_owner uuid, p_event public.events, p_metric text) returns bigint
language sql stable security definer set search_path = '' as $$
  select private.metric_value(p_owner, p_metric, p_event.starts_at, least(now(), p_event.ends_at))
$$;

-- Scores de tous les joueurs (au moins 1) sur une mesure de l'événement.
create function private.event_scores(p_event public.events, p_metric text)
returns table (owner_id uuid, score bigint) language sql stable security definer set search_path = '' as $$
  select x.id, x.score from (
    select p.id, private.event_value(p.id, p_event, p_metric) as score
      from public.profiles p where p.handle is not null and p.suspended_at is null and p.created_at < p_event.ends_at) x
   where x.score > 0
$$;

-- Versement d'une récompense d'événement (Deniers et boosters), une seule fois par clé.
create function private.event_pay(p_owner uuid, p_deniers bigint, p_boosters integer, p_key text, p_ref uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_deniers, 0) > 0 then
    perform private.apply_wallet_delta(p_owner, p_deniers, 'event_reward', 'event', p_ref, p_key);
  end if;
  if coalesce(p_boosters, 0) > 0 then
    update public.booster_balances set purchased_count = purchased_count + p_boosters, updated_at = now() where owner_id = p_owner;
    insert into public.booster_grants (owner_id, source, pool, quantity, ref_id) values (p_owner, 'reward', 'purchased', p_boosters, p_ref);
  end if;
end $$;

-- ---------------------------------------------------------------- tâche planifiée
-- Publie les cartes des événements commencés et clôture les événements terminés (idempotent).
create function private.run_events() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events;
  v_total bigint;
  v_row record;
  v_reward jsonb;
  v_done integer := 0;
begin
  for v_event in select * from public.events where cancelled_at is null and starts_at <= now() and cards_published_at is null for update skip locked loop
    update public.characters set status = 'published' where event_id = v_event.id and status = 'draft';
    update public.events set cards_published_at = now() where id = v_event.id;
    insert into public.admin_audit_logs (actor_id, target_id, action, reason, after_state)
      values (null, v_event.id, 'event_cards_published', 'Début de l’événement ' || v_event.name,
              jsonb_build_object('cards', (select count(*) from public.characters where event_id = v_event.id)));
    v_done := v_done + 1;
  end loop;
  for v_event in select * from public.events where cancelled_at is null and ends_at <= now() and settled_at is null for update skip locked loop
    -- Défi communautaire.
    if v_event.community_metric is not null and v_event.community_target is not null then
      select coalesce(sum(score), 0) into v_total from private.event_scores(v_event, v_event.community_metric);
      if v_total >= v_event.community_target and (v_event.community_reward_deniers > 0 or v_event.community_reward_boosters > 0) then
        for v_row in select * from private.event_scores(v_event, v_event.community_metric) loop
          insert into public.event_rewards (event_id, owner_id, kind, deniers, boosters)
            values (v_event.id, v_row.owner_id, 'community', v_event.community_reward_deniers, v_event.community_reward_boosters)
            on conflict do nothing;
          if found then
            perform private.event_pay(v_row.owner_id, v_event.community_reward_deniers, v_event.community_reward_boosters,
                                      'event-community:' || v_event.id || ':' || v_row.owner_id, v_event.id);
            perform private.notify(v_row.owner_id, 'event_reward', jsonb_build_object('event', v_event.name, 'kind', 'community',
              'reward_deniers', v_event.community_reward_deniers, 'reward_boosters', v_event.community_reward_boosters));
          end if;
        end loop;
      end if;
    end if;
    -- Podium du classement.
    if v_event.leaderboard_metric is not null and jsonb_array_length(v_event.leaderboard_rewards) > 0 then
      for v_row in select s.owner_id, rank() over (order by s.score desc) as rnk
                     from private.event_scores(v_event, v_event.leaderboard_metric) s loop
        v_reward := v_event.leaderboard_rewards -> (v_row.rnk::int - 1);
        continue when v_row.rnk > 3 or v_reward is null;
        insert into public.event_rewards (event_id, owner_id, kind, rank, deniers, boosters)
          values (v_event.id, v_row.owner_id, 'podium', v_row.rnk, coalesce((v_reward->>'deniers')::bigint, 0), coalesce((v_reward->>'boosters')::int, 0))
          on conflict do nothing;
        if found then
          perform private.event_pay(v_row.owner_id, coalesce((v_reward->>'deniers')::bigint, 0), coalesce((v_reward->>'boosters')::int, 0),
                                    'event-podium:' || v_event.id || ':' || v_row.owner_id, v_event.id);
          perform private.notify(v_row.owner_id, 'event_reward', jsonb_build_object('event', v_event.name, 'kind', 'podium', 'rank', v_row.rnk,
            'reward_deniers', coalesce((v_reward->>'deniers')::bigint, 0), 'reward_boosters', coalesce((v_reward->>'boosters')::int, 0)));
        end if;
      end loop;
    end if;
    update public.events set settled_at = now() where id = v_event.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cartema-events', '* * * * *', 'select private.run_events()');
  end if;
end $$;

-- ---------------------------------------------------------------- joueur
create function public.get_event(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_event public.events;
  v_started boolean;
begin
  select * into v_event from public.events where id = p_event_id and cancelled_at is null;
  if not found then raise exception 'event_unavailable'; end if;
  v_started := v_event.starts_at <= now();
  return jsonb_build_object(
    'id', v_event.id, 'name', v_event.name, 'description', v_event.description, 'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
    'active', v_started and v_event.ends_at > now(), 'ended', v_event.ends_at <= now(), 'settled', v_event.settled_at is not null,
    'claim_until', v_event.ends_at + interval '48 hours',
    'finish_multiplier', v_event.finish_multiplier, 'deniers_multiplier', v_event.deniers_multiplier,
    'bonus_boosters', v_event.bonus_boosters, 'free_interval_hours', v_event.free_interval_hours,
    'claimed_bonus', exists (select 1 from public.event_claims c where c.event_id = v_event.id and c.owner_id = v_uid),
    'missions', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'label', m.label, 'target', m.target,
        'reward_deniers', m.reward_deniers, 'reward_boosters', m.reward_boosters,
        'progress', case when v_started then least(private.event_value(v_uid, v_event, m.metric), m.target) else 0 end,
        'claimed', exists (select 1 from public.event_mission_claims c where c.mission_id = m.id and c.owner_id = v_uid))
        order by m.sort, m.label) from public.event_missions m where m.event_id = v_event.id), '[]'::jsonb),
    'community', case when v_event.community_metric is null then null else jsonb_build_object(
        'metric', v_event.community_metric, 'target', v_event.community_target,
        'total', case when v_started then (select coalesce(sum(score), 0) from private.event_scores(v_event, v_event.community_metric)) else 0 end,
        'mine', case when v_started then private.event_value(v_uid, v_event, v_event.community_metric) else 0 end,
        'reward_deniers', v_event.community_reward_deniers, 'reward_boosters', v_event.community_reward_boosters) end,
    'leaderboard', case when v_event.leaderboard_metric is null then null else (
      with ranked as (select s.owner_id, s.score, rank() over (order by s.score desc) as position
                        from private.event_scores(v_event, v_event.leaderboard_metric) s where v_started)
      select jsonb_build_object('metric', v_event.leaderboard_metric, 'rewards', v_event.leaderboard_rewards,
        'top', coalesce((select jsonb_agg(jsonb_build_object('position', r.position, 'handle', p.handle, 'score', r.score, 'me', r.owner_id = v_uid)
                           order by r.position, p.handle) from (select * from ranked order by position limit 10) r
                           join public.profiles p on p.id = r.owner_id), '[]'::jsonb),
        'me', (select jsonb_build_object('position', r.position, 'score', r.score) from ranked r where r.owner_id = v_uid))) end,
    -- Cartes : voilées avant le début ; ensuite comme dans l'album (identité si découverte).
    'cards', coalesce((select jsonb_agg(case when v_started then
          jsonb_build_object('code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'rarity', c.rarity, 'silhouette_key', c.silhouette_key,
            'known', d.character_id is not null)
          || case when d.character_id is not null then jsonb_build_object('name', c.name, 'role_title', c.role_title,
               'clan', (select name from public.clans where id = c.clan_id), 'art_path', c.art_path, 'art_meta', c.art_meta) else '{}'::jsonb end
        else jsonb_build_object('rarity', c.rarity, 'silhouette_key', c.silhouette_key, 'known', false, 'code', '???') end
        order by c.number)
      from public.characters c join public.editions e on e.id = c.edition_id
      left join public.discoveries d on d.character_id = c.id and d.owner_id = v_uid
     where c.event_id = v_event.id and c.status <> 'archived'), '[]'::jsonb),
    'my_rewards', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'rank', r.rank, 'deniers', r.deniers, 'boosters', r.boosters))
      from public.event_rewards r where r.event_id = v_event.id and r.owner_id = v_uid), '[]'::jsonb));
end $$;

create function public.claim_event_mission(p_mission_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_mission public.event_missions;
  v_event public.events;
begin
  select * into v_mission from public.event_missions where id = p_mission_id;
  if not found then raise exception 'not_found'; end if;
  select * into v_event from public.events where id = v_mission.event_id and cancelled_at is null;
  if not found or v_event.starts_at > now() or now() > v_event.ends_at + interval '48 hours' then raise exception 'event_unavailable'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if private.event_value(v_uid, v_event, v_mission.metric) < v_mission.target then raise exception 'mission_incomplete'; end if;
  insert into public.event_mission_claims (mission_id, owner_id) values (v_mission.id, v_uid) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  perform private.event_pay(v_uid, v_mission.reward_deniers, v_mission.reward_boosters, 'event-mission:' || v_mission.id, v_mission.id);
  return jsonb_build_object('reward_deniers', v_mission.reward_deniers, 'reward_boosters', v_mission.reward_boosters);
end $$;

-- ---------------------------------------------------------------- administration
create function public.admin_event_content(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.events;
begin
  perform private.require_admin();
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'missions', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'label', m.label, 'metric', m.metric, 'target', m.target,
        'reward_deniers', m.reward_deniers, 'reward_boosters', m.reward_boosters,
        'claims', (select count(*) from public.event_mission_claims c where c.mission_id = m.id)) order by m.sort, m.label)
      from public.event_missions m where m.event_id = p_event_id), '[]'::jsonb),
    'card_ids', coalesce((select jsonb_agg(c.id order by c.number) from public.characters c where c.event_id = p_event_id), '[]'::jsonb),
    'community', jsonb_build_object('metric', v_event.community_metric, 'target', v_event.community_target,
      'reward_deniers', v_event.community_reward_deniers, 'reward_boosters', v_event.community_reward_boosters),
    'leaderboard', jsonb_build_object('metric', v_event.leaderboard_metric, 'rewards', v_event.leaderboard_rewards),
    'started', v_event.starts_at <= now(), 'settled', v_event.settled_at is not null);
end $$;

-- Remplace le contenu de l'événement : missions, cartes (avant le début), défi et classement
-- (modifiables jusqu'à la fin ; les missions déjà réclamées sont conservées).
create function public.admin_save_event_content(p_event_id uuid, p_missions jsonb, p_card_ids uuid[], p_community jsonb,
                                                p_leaderboard jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_event public.events;
  v_m jsonb;
  v_keep uuid[] := '{}';
  v_i integer := 0;
  v_id uuid;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_event.cancelled_at is not null or v_event.settled_at is not null then raise exception 'event_closed'; end if;
  -- Missions.
  for v_m in select * from jsonb_array_elements(coalesce(p_missions, '[]'::jsonb)) loop
    if not private.event_metric_allowed(v_m->>'metric') then raise exception 'invalid_setting' using detail = 'metric'; end if;
    v_i := v_i + 1;
    if v_m ? 'id' and nullif(v_m->>'id', '') is not null then
      update public.event_missions set label = trim(v_m->>'label'), metric = v_m->>'metric', target = (v_m->>'target')::int,
             reward_deniers = coalesce((v_m->>'reward_deniers')::bigint, 0), reward_boosters = coalesce((v_m->>'reward_boosters')::int, 0), sort = v_i
       where id = (v_m->>'id')::uuid and event_id = p_event_id returning id into v_id;
    else
      insert into public.event_missions (event_id, label, metric, target, reward_deniers, reward_boosters, sort)
        values (p_event_id, trim(v_m->>'label'), v_m->>'metric', (v_m->>'target')::int,
                coalesce((v_m->>'reward_deniers')::bigint, 0), coalesce((v_m->>'reward_boosters')::int, 0), v_i)
        returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.event_missions m where m.event_id = p_event_id and not (m.id = any (v_keep))
    and not exists (select 1 from public.event_mission_claims c where c.mission_id = m.id);
  -- Cartes : seulement des brouillons, et seulement avant le début.
  if v_event.starts_at > now() then
    update public.characters set event_id = null where event_id = p_event_id and status = 'draft' and not (id = any (coalesce(p_card_ids, '{}')));
    if exists (select 1 from public.characters where id = any (coalesce(p_card_ids, '{}')) and (status <> 'draft' or is_unique)) then
      raise exception 'invalid_setting' using detail = 'cards';
    end if;
    update public.characters set event_id = p_event_id where id = any (coalesce(p_card_ids, '{}'));
  elsif coalesce(p_card_ids, '{}') is distinct from coalesce((select array_agg(id order by number) from public.characters where event_id = p_event_id), '{}')
        and cardinality(coalesce(p_card_ids, '{}')) > 0 then
    raise exception 'event_started';
  end if;
  -- Défi et classement.
  if p_community->>'metric' is not null and not private.event_metric_allowed(p_community->>'metric') then raise exception 'invalid_setting' using detail = 'community'; end if;
  if p_leaderboard->>'metric' is not null and not private.event_metric_allowed(p_leaderboard->>'metric') then raise exception 'invalid_setting' using detail = 'leaderboard'; end if;
  if jsonb_array_length(coalesce(p_leaderboard->'rewards', '[]'::jsonb)) > 3 then raise exception 'invalid_setting' using detail = 'leaderboard'; end if;
  update public.events set
    community_metric = nullif(p_community->>'metric', ''), community_target = nullif(p_community->>'target', '')::int,
    community_reward_deniers = coalesce((p_community->>'reward_deniers')::bigint, 0), community_reward_boosters = coalesce((p_community->>'reward_boosters')::int, 0),
    leaderboard_metric = nullif(p_leaderboard->>'metric', ''), leaderboard_rewards = coalesce(p_leaderboard->'rewards', '[]'::jsonb)
   where id = p_event_id;
  if (select community_metric is not null and community_target is null from public.events where id = p_event_id) then
    raise exception 'invalid_setting' using detail = 'community';
  end if;
  perform private.audit(v_admin, 'event_content', p_event_id, v_reason, null, jsonb_build_object('missions', jsonb_array_length(coalesce(p_missions, '[]'::jsonb)),
    'cards', cardinality(coalesce(p_card_ids, '{}')), 'community', p_community, 'leaderboard', p_leaderboard));
end $$;

-- Album : événement d'origine affiché dans la fiche des cartes découvertes.
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
          'event', (select ev.name from public.events ev where ev.id = c.event_id),
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

revoke execute on function private.event_metric_allowed(text), private.event_value(uuid, public.events, text),
  private.event_scores(public.events, text), private.event_pay(uuid, bigint, integer, text, uuid), private.run_events()
  from public, anon, authenticated;
revoke execute on function public.get_event(uuid), public.claim_event_mission(uuid), public.admin_event_content(uuid),
  public.admin_save_event_content(uuid, jsonb, uuid[], jsonb, jsonb, text) from public, anon;
grant execute on function public.get_event(uuid), public.claim_event_mission(uuid), public.admin_event_content(uuid),
  public.admin_save_event_content(uuid, jsonb, uuid[], jsonb, jsonb, text) to authenticated;
