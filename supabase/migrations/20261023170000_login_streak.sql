-- CARTEMA — série de connexions (décision du 23/10/2026).
--  * Jours de connexion d'affilée, au calendrier de Paris (comme le bonus quotidien) : profiles.login_streak,
--    login_streak_day (dernier jour compté) et login_streak_best. Comptée au premier get_player_state du jour ;
--    un jour sauté la fait repartir à 1.
--  * Tous les streak_booster_every jours (7), streak_booster_count boosters bonus (1) ; 0 = sans booster.
--    Réglables dans Économie.
--  * Succès « Assiduité » sur la meilleure série : 7, 30 et 100 jours.
--  * Rattrapage : séries reconstruites à partir des bonus quotidiens déjà reçus.

alter table public.profiles add column login_streak integer not null default 0;
alter table public.profiles add column login_streak_day date;
alter table public.profiles add column login_streak_best integer not null default 0;

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"streak_booster_every": 7, "streak_booster_count": 1}'::jsonb
    from public.economy_settings;

-- Rattrapage depuis les bonus quotidiens (clé « daily:AAAA-MM-JJ ») : îlots de jours consécutifs.
with d as (select distinct owner_id, substr(idempotency_key, 7)::date as day from public.wallet_ledger
            where kind = 'daily_login' and idempotency_key ~ '^daily:\d{4}-\d{2}-\d{2}$'),
g as (select owner_id, day, day - (row_number() over (partition by owner_id order by day))::int as grp from d),
runs as (select owner_id, grp, max(day) as last_day, count(*)::int as len from g group by owner_id, grp),
agg as (select owner_id, max(len) as best, max(last_day) as last_day,
               (array_agg(len order by last_day desc))[1] as last_len from runs group by owner_id)
update public.profiles p set login_streak_best = a.best, login_streak_day = a.last_day,
       login_streak = case when a.last_day >= (now() at time zone 'Europe/Paris')::date - 1 then a.last_len else 0 end
  from agg a where a.owner_id = p.id;

-- Compte le jour de connexion (une fois par jour, sans verrou si déjà compté) et donne le bonus de série.
-- Renvoie null si le jour est déjà compté.
create function private.touch_login_streak(p_owner uuid, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (p_at at time zone 'Europe/Paris')::date;
  v_settings jsonb := (private.active_settings()).settings;
  v_every integer := coalesce((v_settings->>'streak_booster_every')::int, 0);
  v_count integer := coalesce((v_settings->>'streak_booster_count')::int, 0);
  v_streak integer;
  v_best integer;
  v_boosters integer := 0;
begin
  if exists (select 1 from public.profiles where id = p_owner and login_streak_day = v_today) then return null; end if;
  update public.profiles
     set login_streak = case when login_streak_day = v_today - 1 then login_streak + 1 else 1 end,
         login_streak_best = greatest(login_streak_best, case when login_streak_day = v_today - 1 then login_streak + 1 else 1 end),
         login_streak_day = v_today
   where id = p_owner and login_streak_day is distinct from v_today
   returning login_streak, login_streak_best into v_streak, v_best;
  if not found then return null; end if;
  if v_every > 0 and v_count > 0 and v_streak % v_every = 0 then
    update public.booster_balances set purchased_count = purchased_count + v_count, updated_at = now() where owner_id = p_owner;
    insert into public.booster_grants (owner_id, source, pool, quantity) values (p_owner, 'reward', 'purchased', v_count);
    v_boosters := v_count;
  end if;
  return jsonb_build_object('streak', v_streak, 'best', v_best, 'boosters', v_boosters);
end $$;
revoke execute on function private.touch_login_streak(uuid, timestamptz) from public, anon, authenticated;

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
                 'streak_booster_every', 'streak_booster_count') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000], "trade_cooldown_hours": [0, 720],
      "streak_booster_every": [0, 60], "streak_booster_count": [0, 10]}'::jsonb) loop
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
    'streak_booster_every', v_new->'streak_booster_every', 'streak_booster_count', v_new->'streak_booster_count'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(*) filter (where private.owns_card_art(p_owner, rc.id, f.finish, p_def.required_arts->>rc.id::text)),
             cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        cross join lateral (select (p_def.required_finishes->>rc.id::text)::public.finish as finish) f;
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null
                                               and i.removed_at is null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
  elsif p_def.metric = 'same_card_copies' then
    -- Narcisse : le plus grand nombre d'exemplaires possédés d'un même personnage.
    return query
      select coalesce(max(n.copies), 0), p_def.target::bigint
        from (select count(*) copies from public.inventory_items i
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
               group by i.character_id) n;
  elsif p_def.metric = 'clan_lineage' then
    -- Lignée : tous les membres du clan, toutes éditions publiées (hors uniques, archivées, éternelle).
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c join public.editions e on e.id = c.edition_id
       where c.clan_id = p_def.clan_id and c.status = 'published' and not c.is_unique
         and e.album_published and e.archived_at is null and not e.eternal;
  elsif p_def.metric = 'login_streak' then
    -- Série de connexions : la meilleure série atteinte.
    return query select coalesce((select p.login_streak_best from public.profiles p where p.id = p_owner), 0)::bigint,
                        p_def.target::bigint;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

create or replace function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_daily bigint := private.claim_daily_reward(v_uid);
  v_streak jsonb := private.touch_login_streak(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
  v_every integer := coalesce((v_settings->>'streak_booster_every')::int, 0);
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
    -- Série de connexions : jours d'affilée, meilleure série, et boosters gagnés par cet appel.
    'streak', (select jsonb_build_object('current', p.login_streak, 'best', p.login_streak_best, 'every', v_every,
                                         'count', coalesce((v_settings->>'streak_booster_count')::int, 0),
                                         'next_bonus_in', case when v_every > 0 then v_every - p.login_streak % v_every end)
                 from public.profiles p where p.id = v_uid),
    'streak_reward', coalesce((v_streak->>'boosters')::int, 0),
    -- Concours d'illustrations ouvert : pour la bannière du site.
    'contest', (select jsonb_build_object('id', c.id, 'title', c.title, 'ends_at', c.ends_at)
                  from public.contests c where c.starts_at <= now() and c.ends_at > now() order by c.ends_at limit 1),
    -- Concours annoncé : le prochain qui commence dans les 14 jours (annonce de l'accueil).
    'contest_next', (select jsonb_build_object('id', c.id, 'title', c.title, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
                       'edition', (select e.name from public.editions e where e.id = c.edition_id))
                  from public.contests c where c.starts_at > now() and c.starts_at <= now() + interval '14 days'
                 order by c.starts_at limit 1),
    'missions_ready', (select count(*) from public.mission_assignments a join public.mission_templates t on t.code = a.template_code
                        where a.owner_id = v_uid and a.replaced_at is null and a.claimed_at is null and a.period_end > now()
                          and private.metric_value(v_uid, t.metric, a.period_start, a.period_end) >= t.target),
    'social_pending', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'),
    -- Éditions ouvertes, avec leurs prix et les boosters achetés pour elles ; puis les éditions annoncées
    -- (« Soon ») : leur nom, leur code et leur sachet seulement.
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
               jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix, 'teaser', true, 'openable', false, 'theme', e.booster_theme)
          from public.editions e where e.teaser and not e.packs_enabled and e.archived_at is null) x), '[]'::jsonb)
  );
end $$;

insert into public.achievements (code, label, description, secret, metric, target, reward_deniers, reward_boosters, title, sort,
                                 series, series_label, tier) values
  ('streak_7', 'Habitué', 'Venir 7 jours d’affilée.', false, 'login_streak', 7, 300, 1, null, 130, 'streak', 'Assiduité', 1),
  ('streak_30', 'Fidèle', 'Venir 30 jours d’affilée.', false, 'login_streak', 30, 1500, 5, 'Fidèle de la nuit', 131, 'streak', 'Assiduité', 2),
  ('streak_100', 'Éternel retour', 'Venir 100 jours d’affilée.', false, 'login_streak', 100, 5000, 12, 'Éternel retour', 132, 'streak', 'Assiduité', 3)
on conflict (code) do nothing;
