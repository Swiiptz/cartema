-- CARTEMA — classement de saison (décision de Swiiptz, 25/10/2026), prévu pour le set 2.
--  * Une saison dure le temps d'un set : l'admin la démarre (admin_start_season) et la clôt (admin_end_season).
--    Sans saison démarrée, rien n'apparaît côté joueurs (get_season_leaderboard renvoie null) : c'est
--    l'interrupteur jusqu'au lancement du set 2.
--  * Points de saison, calculés à la volée sur la période : +1 par visage découvert, +10 par succès débloqué
--    (+5 par palier au-delà du premier), +2 par mission quotidienne et +5 par mission hebdomadaire réclamées.
--    Pas de points pour les cartes tirées (la chance ne décide pas du classement).
--  * Distribution (une seule fois, saison close) : barème par place en Deniers et boosters, titre « Champion de
--    la saison » pour les 3 premiers (succès personnalisé « season:<id> »). Le classement actuel ne change pas.

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  rewards jsonb not null default '{"places":[{"from":1,"to":1,"deniers":5000,"boosters":12},{"from":2,"to":2,"deniers":3000,"boosters":8},{"from":3,"to":3,"deniers":2000,"boosters":5},{"from":4,"to":10,"deniers":800,"boosters":3}],"others":{"deniers":100,"boosters":0}}'::jsonb,
  rewarded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
-- Une seule saison ouverte à la fois.
create unique index seasons_one_open on public.seasons ((true)) where ends_at is null;
alter table public.seasons enable row level security;

-- Classement d'une saison : points de chaque joueur sur la période (une seule passe par source).
create function private.season_ranking(p_season uuid)
returns table (owner_id uuid, handle text, faces bigint, achievements bigint, missions bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  with s as (select starts_at, coalesce(ends_at, now()) as ends_at from public.seasons where id = p_season),
  f as (select d.owner_id, count(*) as n from public.discoveries d, s
         where d.first_seen_at >= s.starts_at and d.first_seen_at < s.ends_at group by d.owner_id),
  a as (select u.owner_id, count(*) as n, sum(10 + 5 * greatest(coalesce(ac.tier, 1) - 1, 0)) as pts
          from public.achievement_unlocks u join public.achievements ac on ac.code = u.code, s
         where u.unlocked_at >= s.starts_at and u.unlocked_at < s.ends_at and u.code not like 'season:%'
         group by u.owner_id),
  m as (select x.owner_id, count(*) as n, sum(case when x.kind = 'weekly' then 5 else 2 end) as pts
          from public.mission_assignments x, s
         where x.claimed_at >= s.starts_at and x.claimed_at < s.ends_at group by x.owner_id),
  t as (select p.id as owner_id, p.handle,
               coalesce(f.n, 0) as faces, coalesce(a.n, 0) as achievements, coalesce(m.n, 0) as missions,
               (coalesce(f.n, 0) + coalesce(a.pts, 0) + coalesce(m.pts, 0))::bigint as points
          from public.profiles p
          left join f on f.owner_id = p.id left join a on a.owner_id = p.id left join m on m.owner_id = p.id
         where p.handle is not null and p.suspended_at is null and (f.n is not null or a.n is not null or m.n is not null))
  select t.owner_id, t.handle, t.faces, t.achievements, t.missions, t.points, rank() over (order by t.points desc) as place
    from t where t.points > 0
$$;
revoke execute on function private.season_ranking(uuid) from public, anon, authenticated;

-- Saison en cours, ou la dernière close depuis moins de 30 jours ; null s'il n'y en a pas.
create function public.get_season_leaderboard(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_season public.seasons;
begin
  select * into v_season from public.seasons
   where ends_at is null or ends_at > now() - interval '30 days'
   order by (ends_at is null) desc, ends_at desc limit 1;
  if v_season.id is null then return null; end if;
  return (with r as materialized (select * from private.season_ranking(v_season.id))
    select jsonb_build_object(
      'season', jsonb_build_object('id', v_season.id, 'name', v_season.name, 'starts_at', v_season.starts_at,
                                   'ends_at', v_season.ends_at, 'open', v_season.ends_at is null,
                                   'rewarded', v_season.rewarded_at is not null, 'rewards', v_season.rewards),
      'top', coalesce((select jsonb_agg(jsonb_build_object('position', x.place, 'handle', x.handle, 'points', x.points,
                          'faces', x.faces, 'achievements', x.achievements, 'missions', x.missions, 'me', x.owner_id = v_uid)
                          order by x.place, x.handle)
                       from (select * from r order by place, handle limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb),
      'me', (select jsonb_build_object('position', r.place, 'points', r.points) from r where r.owner_id = v_uid)));
end $$;
revoke execute on function public.get_season_leaderboard(integer) from public, anon;
grant execute on function public.get_season_leaderboard(integer) to authenticated;

create function public.admin_seasons() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'rewards', s.rewards, 'rewarded_at', s.rewarded_at,
      'players', (select count(*) from private.season_ranking(s.id))) order by s.starts_at desc)
    from public.seasons s), '[]'::jsonb);
end $$;

create function public.admin_start_season(p_name text, p_rewards jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_id uuid;
begin
  if exists (select 1 from public.seasons where ends_at is null) then raise exception 'season_open'; end if;
  if p_rewards is not null and (jsonb_typeof(p_rewards->'places') <> 'array' or jsonb_typeof(p_rewards->'others') <> 'object') then
    raise exception 'invalid_offer';
  end if;
  insert into public.seasons (name, created_by) values (trim(p_name), v_admin) returning id into v_id;
  if p_rewards is not null then update public.seasons set rewards = p_rewards where id = v_id; end if;
  perform private.audit(v_admin, 'season_start', v_id, v_reason, null, jsonb_build_object('name', p_name, 'rewards', p_rewards));
  return v_id;
end $$;

create function public.admin_end_season(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
begin
  update public.seasons set ends_at = now() where id = p_id and ends_at is null;
  if not found then raise exception 'not_found'; end if;
  perform private.audit(v_admin, 'season_end', p_id, v_reason, null, null);
end $$;

create function public.admin_reward_season(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_season public.seasons;
  v_row record;
  v_place jsonb;
  v_deniers bigint;
  v_boosters integer;
  v_code text;
  v_count integer := 0;
begin
  select * into v_season from public.seasons where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_season.ends_at is null then raise exception 'season_open'; end if;
  if v_season.rewarded_at is not null then raise exception 'already_granted'; end if;
  -- Titre du podium : succès personnalisé porteur du titre, décerné aux 3 premières places.
  v_code := 'season:' || v_season.id;
  insert into public.achievements (code, label, description, secret, category, metric, target, reward_deniers, reward_boosters, title, sort)
    values (v_code, 'Champion de la saison', 'Sur le podium de la saison « ' || v_season.name || ' ».', false, 'custom', 'manual', 1, 0, 0,
            'Champion de la saison', 610)
    on conflict (code) do nothing;
  for v_row in select * from private.season_ranking(p_id) loop
    v_place := coalesce((select p from jsonb_array_elements(v_season.rewards->'places') p
                          where v_row.place between (p->>'from')::int and (p->>'to')::int limit 1), v_season.rewards->'others');
    v_deniers := coalesce((v_place->>'deniers')::bigint, 0);
    v_boosters := coalesce((v_place->>'boosters')::int, 0);
    if v_deniers > 0 then
      perform private.apply_wallet_delta(v_row.owner_id, v_deniers, 'season_reward', 'season', v_season.id, 'season:' || v_season.id);
    end if;
    if v_boosters > 0 then
      update public.booster_balances set purchased_count = purchased_count + v_boosters, updated_at = now() where owner_id = v_row.owner_id;
      insert into public.booster_grants (owner_id, source, pool, quantity, ref_id) values (v_row.owner_id, 'reward', 'purchased', v_boosters, v_season.id);
    end if;
    if v_row.place <= 3 then
      insert into public.achievement_unlocks (owner_id, code) values (v_row.owner_id, v_code) on conflict do nothing;
    end if;
    perform private.notify(v_row.owner_id, 'season_reward', jsonb_build_object('title', v_season.name, 'position', v_row.place,
      'deniers', v_deniers, 'boosters', v_boosters, 'podium', v_row.place <= 3));
    v_count := v_count + 1;
  end loop;
  update public.seasons set rewarded_at = now() where id = p_id;
  perform private.audit(v_admin, 'season_reward', p_id, v_reason, null, jsonb_build_object('players', v_count));
  return jsonb_build_object('players', v_count);
end $$;

revoke execute on function public.admin_seasons(), public.admin_start_season(text, jsonb, text), public.admin_end_season(uuid, text),
  public.admin_reward_season(uuid, text) from public, anon;
grant execute on function public.admin_seasons(), public.admin_start_season(text, jsonb, text), public.admin_end_season(uuid, text),
  public.admin_reward_season(uuid, text) to authenticated;
