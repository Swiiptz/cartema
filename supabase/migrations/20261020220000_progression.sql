-- CARTEMA — missions, succès, titres et classement (CDC §7).
-- Missions : 3 quotidiennes (renouvelées à 06 h Europe/Paris), 3 hebdomadaires (lundi 06 h),
-- 1 remplacement gratuit par jour, jamais de mission impossible (prérequis vérifiés au tirage).
-- L'avancement est calculé à partir des données réelles de la période : aucun compteur à
-- synchroniser. Récompenses réclamées une seule fois (clé d'idempotence du ledger).
-- Succès visibles et secrets, définitifs, rangés par catégorie :
--  * collection, par édition (générés automatiquement) : chaque clan complet, chaque rareté complète,
--    toutes les cartes de l'édition (le total suit les cartes publiées ; un succès débloqué le reste) ;
--  * personnalisés : créés par l'administrateur, soit conditionnels (débloqués automatiquement en
--    découvrant un groupe de personnages choisi, ex. « LES BRATS!! » = Sirius + Wezen), soit décernés
--    à la main avec motif (événements de GN). Leur explication n'est révélée qu'une fois débloqués ;
--  * généraux : boosters, finitions, marché, amis, et succès secrets.
-- Classement : personnages uniques découverts, historique.
-- Montants et seuils : PROPOSITIONS à valider (CDC §13), modifiables dans les tables.

-- ---------------------------------------------------------------- périodes Europe/Paris
create function private.mission_period(p_kind text, p_at timestamptz default now())
returns table (period_start timestamptz, period_end timestamptz)
language sql stable set search_path = '' as $$
  with local as (select ((p_at at time zone 'Europe/Paris') - interval '6 hours') as t),
  day0 as (select case when p_kind = 'daily' then t::date else date_trunc('week', t)::date end as d from local)
  select ((d + time '06:00') at time zone 'Europe/Paris'),
         (((d + case when p_kind = 'daily' then 1 else 7 end) + time '06:00') at time zone 'Europe/Paris')
  from day0
$$;

-- ---------------------------------------------------------------- définitions
create table public.mission_templates (
  code text primary key,
  kind text not null check (kind in ('daily', 'weekly')),
  label text not null,
  metric text not null,
  target integer not null check (target > 0),
  reward bigint not null check (reward >= 0),
  requires text check (requires in ('trader', 'friends')),
  active boolean not null default true
);

create table public.mission_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  template_code text not null references public.mission_templates(code),
  kind text not null check (kind in ('daily', 'weekly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  assigned_at timestamptz not null default now(),
  replaced_at timestamptz,
  claimed_at timestamptz,
  unique (owner_id, period_start, template_code)
);
create index mission_assignments_owner_ix on public.mission_assignments (owner_id, period_start);

create table public.achievements (
  code text primary key,
  label text not null,
  description text not null,
  secret boolean not null default false,
  category text not null default 'general' check (category in ('collection', 'general', 'custom')),
  edition_id uuid references public.editions(id),
  clan_id uuid references public.clans(id),
  rarity public.rarity,
  required_characters uuid[],
  metric text not null,
  target integer not null check (target > 0),
  reward_deniers bigint not null default 0 check (reward_deniers >= 0),
  reward_boosters integer not null default 0 check (reward_boosters >= 0),
  title text,
  sort integer not null default 0
);

create table public.achievement_unlocks (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.achievements(code) on update cascade,
  unlocked_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  reason text,
  primary key (owner_id, code)
);

alter table public.profiles add column title text;

alter table public.mission_templates enable row level security;
alter table public.mission_assignments enable row level security;
alter table public.achievements enable row level security;
alter table public.achievement_unlocks enable row level security;
grant select on public.mission_assignments, public.achievement_unlocks to authenticated;
create policy own_missions on public.mission_assignments for select to authenticated using (owner_id = auth.uid());
create policy own_unlocks on public.achievement_unlocks for select to authenticated using (owner_id = auth.uid());
-- Les définitions passent par les RPC : les succès secrets ne doivent pas fuiter.

-- ---------------------------------------------------------------- mesures
-- Valeur d'une mesure pour un joueur sur une fenêtre de temps (toute la vie si p_from est null).
create function private.metric_value(p_owner uuid, p_metric text, p_from timestamptz default null, p_to timestamptz default now())
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(p_from, '-infinity'::timestamptz);
begin
  return case p_metric
    when 'open_boosters' then (select count(*) from public.pack_openings where owner_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'discover' then (select count(*) from public.discoveries where owner_id = p_owner and first_seen_at >= v_from and first_seen_at < p_to)
    when 'rare_pull' then (select count(*) from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
                            where o.owner_id = p_owner and o.created_at >= v_from and o.created_at < p_to and pc.rarity >= 'Rare')
    when 'recycle' then (select coalesce(sum(jsonb_array_length(items)), 0) from public.recycling_operations
                          where owner_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'market_sell' then (select count(*) from public.listings where seller_id = p_owner and status = 'sold' and closed_at >= v_from and closed_at < p_to)
    when 'market_buy' then (select count(*) from public.listings where buyer_id = p_owner and status = 'sold' and closed_at >= v_from and closed_at < p_to)
    when 'gift_send' then (select count(*) from public.gifts where sender_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'trade_done' then (select count(*) from public.trades where (proposer_id = p_owner or recipient_id = p_owner)
                             and status = 'accepted' and closed_at >= v_from and closed_at < p_to)
    when 'daily_login' then (select count(*) from public.wallet_ledger where owner_id = p_owner and kind = 'daily_login'
                              and created_at >= v_from and created_at < p_to)
    when 'auction_bid' then (select count(*) from public.bids where bidder_id = p_owner and created_at >= v_from and created_at < p_to)
    -- Mesures de succès (sur toute la durée).
    when 'finish_gold' then (select count(*) from public.finish_discoveries where owner_id = p_owner and finish = 'Dorée' and first_seen_at >= v_from)
    when 'finish_blood' then (select count(*) from public.finish_discoveries where owner_id = p_owner and finish = 'Sanglante' and first_seen_at >= v_from)
    when 'discover_legendary' then (select count(*) from public.discoveries d join public.characters c on c.id = d.character_id
                                     where d.owner_id = p_owner and c.rarity = 'Légendaire' and not c.is_unique and d.first_seen_at >= v_from)
    when 'discover_mythic' then (select count(*) from public.discoveries d join public.characters c on c.id = d.character_id
                                  where d.owner_id = p_owner and c.rarity = 'Mythique' and not c.is_unique and d.first_seen_at >= v_from)
    when 'discover_unique' then (select count(*) from public.discoveries d join public.characters c on c.id = d.character_id
                                  where d.owner_id = p_owner and c.is_unique)
    when 'friends' then (select count(*) from public.friendships where status = 'accepted' and (requester_id = p_owner or addressee_id = p_owner))
    else 0 end;
end $$;

-- ---------------------------------------------------------------- missions
create function private.mission_eligible(p_owner uuid, p_requires text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_requires
    when 'trader' then exists (select 1 from public.profiles where id = p_owner and transactions_blocked_at is null
                                and created_at <= now() - interval '24 hours')
    when 'friends' then exists (select 1 from public.profiles where id = p_owner and transactions_blocked_at is null
                                 and created_at <= now() - interval '24 hours')
                        and private.metric_value(p_owner, 'friends') > 0
    else true end
$$;

-- Tire les missions manquantes de la période (3 actives), sans doublon ni mission impossible.
create function private.ensure_missions(p_owner uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_missing integer;
begin
  select period_start, period_end into v_start, v_end from private.mission_period(p_kind);
  perform 1 from public.profiles where id = p_owner for update;
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and private.mission_eligible(p_owner, t.requires)
       and not exists (select 1 from public.mission_assignments a
                        where a.owner_id = p_owner and a.period_start = v_start and a.template_code = t.code)
     order by random() limit v_missing;
end $$;

create function private.mission_json(p_a public.mission_assignments) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('assignment_id', p_a.id, 'kind', p_a.kind, 'label', t.label, 'target', t.target,
    'reward', t.reward, 'progress', least(private.metric_value(p_a.owner_id, t.metric, p_a.period_start, p_a.period_end), t.target),
    'claimed', p_a.claimed_at is not null, 'ends_at', p_a.period_end)
  from public.mission_templates t where t.code = p_a.template_code
$$;

create function public.get_missions() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_day timestamptz;
  v_week timestamptz;
begin
  perform private.ensure_missions(v_uid, 'daily');
  perform private.ensure_missions(v_uid, 'weekly');
  select period_start into v_day from private.mission_period('daily');
  select period_start into v_week from private.mission_period('weekly');
  return jsonb_build_object(
    'daily', coalesce((select jsonb_agg(private.mission_json(a) order by a.assigned_at) from public.mission_assignments a
                        where a.owner_id = v_uid and a.period_start = v_day and a.kind = 'daily' and a.replaced_at is null), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(private.mission_json(a) order by a.assigned_at) from public.mission_assignments a
                         where a.owner_id = v_uid and a.period_start = v_week and a.kind = 'weekly' and a.replaced_at is null), '[]'::jsonb),
    'replacement_available', not exists (select 1 from public.mission_assignments
                                          where owner_id = v_uid and replaced_at >= v_day),
    'daily_reset', (select period_end from private.mission_period('daily')),
    'weekly_reset', (select period_end from private.mission_period('weekly')));
end $$;

create function public.claim_mission(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_a public.mission_assignments;
  v_t public.mission_templates;
  v_balance bigint;
begin
  select * into v_a from public.mission_assignments where id = p_assignment_id and owner_id = v_uid for update;
  if not found or v_a.replaced_at is not null then raise exception 'not_found'; end if;
  if v_a.claimed_at is not null then raise exception 'already_claimed'; end if;
  select * into v_t from public.mission_templates where code = v_a.template_code;
  if private.metric_value(v_uid, v_t.metric, v_a.period_start, v_a.period_end) < v_t.target then
    raise exception 'mission_incomplete';
  end if;
  update public.mission_assignments set claimed_at = now() where id = v_a.id;
  v_balance := case when v_t.reward > 0
    then private.apply_wallet_delta(v_uid, v_t.reward, 'mission_reward', 'mission', v_a.id, 'mission:' || v_a.id)
    else (select balance from public.wallets where owner_id = v_uid) end;
  return jsonb_build_object('reward', v_t.reward, 'balance', v_balance);
end $$;

-- Remplacement gratuit : une fois par jour (période quotidienne), mission non réclamée.
create function public.replace_mission(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_a public.mission_assignments;
  v_day timestamptz;
begin
  select period_start into v_day from private.mission_period('daily');
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_a from public.mission_assignments where id = p_assignment_id and owner_id = v_uid for update;
  if not found or v_a.replaced_at is not null or v_a.period_end <= now() then raise exception 'not_found'; end if;
  if v_a.claimed_at is not null then raise exception 'already_claimed'; end if;
  if exists (select 1 from public.mission_assignments where owner_id = v_uid and replaced_at >= v_day) then
    raise exception 'replacement_used';
  end if;
  update public.mission_assignments set replaced_at = now() where id = v_a.id;
  perform private.ensure_missions(v_uid, v_a.kind);
  return public.get_missions();
end $$;

-- ---------------------------------------------------------------- succès
create function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(d.character_id), count(*)
        from public.characters c
        left join public.discoveries d on d.character_id = c.id and d.owner_id = p_owner
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(d.character_id), cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        left join public.discoveries d on d.character_id = rc.id and d.owner_id = p_owner;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

-- Succès de collection de chaque édition publiée : un par clan, un par rareté, un pour l'ensemble.
create function private.sync_set_achievements() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (code, label, description, category, edition_id, clan_id, metric, target, reward_deniers, sort)
    select 'set:' || e.prefix || ':clan:' || cl.id, cl.name || ' au complet',
           'Découvrir tous les personnages ' || cl.name || ' de l’édition ' || e.name || '.',
           'collection', e.id, cl.id, 'set_clan', 1, 150, 1000
      from public.editions e
      join (select distinct edition_id, clan_id from public.characters where status = 'published' and clan_id is not null and not is_unique) x
        on x.edition_id = e.id
      join public.clans cl on cl.id = x.clan_id
     where e.album_published and e.archived_at is null
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, rarity, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':rarity:' || r.rarity::text,
           'Toutes les ' || case r.rarity when 'Commun' then 'Communes' when 'Peu commun' then 'Peu communes' when 'Rare' then 'Rares'
             when 'Très rare' then 'Très rares' when 'Épique' then 'Épiques' when 'Légendaire' then 'Légendaires' else 'Mythiques' end,
           'Découvrir tous les personnages ' || r.rarity::text || ' de l’édition ' || e.name || '.',
           'collection', e.id, r.rarity, 'set_rarity', 1,
           case r.rarity when 'Commun' then 100 when 'Peu commun' then 150 when 'Rare' then 250 when 'Très rare' then 400
                         when 'Épique' then 500 when 'Légendaire' then 800 else 1500 end,
           case when r.rarity in ('Légendaire', 'Mythique') then 1 else 0 end,
           case when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', 'Maître de ' || e.name, 'Découvrir toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 3000, 5, 'Maître de ' || e.name, 800
      from public.editions e
     where e.album_published and e.archived_at is null
       and exists (select 1 from public.characters c where c.edition_id = e.id and c.status = 'published')
  on conflict (code) do nothing;
end $$;

-- Débloque les succès atteints et verse leurs récompenses (une seule fois chacun).
create function private.sync_achievements(p_owner uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.achievements;
  v_state record;
  v_count integer := 0;
begin
  perform private.sync_set_achievements();
  for v_def in select a.* from public.achievements a
                where a.metric <> 'manual'
                  and not exists (select 1 from public.achievement_unlocks u where u.owner_id = p_owner and u.code = a.code) loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    if v_state.target > 0 and v_state.progress >= v_state.target then
      insert into public.achievement_unlocks (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
      if found then
        v_count := v_count + 1;
        if v_def.reward_deniers > 0 then
          perform private.apply_wallet_delta(p_owner, v_def.reward_deniers, 'achievement_reward', 'achievement', null,
                                             'achievement:' || v_def.code);
        end if;
        if v_def.reward_boosters > 0 then
          update public.booster_balances set purchased_count = purchased_count + v_def.reward_boosters, updated_at = now()
           where owner_id = p_owner;
          insert into public.booster_grants (owner_id, source, pool, quantity) values (p_owner, 'reward', 'purchased', v_def.reward_boosters);
        end if;
      end if;
    end if;
  end loop;
  return v_count;
end $$;

-- Succès secrets : intitulé et description masqués tant qu'ils ne sont pas débloqués.
create function public.get_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.sync_achievements(v_uid);
  return coalesce((select jsonb_agg(case when u.code is not null or not a.secret then jsonb_build_object(
      'code', a.code, 'label', a.label, 'secret', a.secret, 'title', a.title,
      'description', case when a.category = 'custom' and u.code is null then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'progress', least(st.progress, st.target), 'target', st.target,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    cross join lateral private.achievement_state(v_uid, a) st
    -- Personnalisés : les conditionnels non secrets sont visibles (avancement sans explication),
    -- les manuels n'apparaissent qu'une fois décernés.
    where a.category <> 'custom' or u.code is not null or (a.metric = 'characters' and not a.secret)), '[]'::jsonb);
end $$;

create function public.set_title(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_title text;
begin
  if p_code is null then
    update public.profiles set title = null where id = v_uid;
    return null;
  end if;
  select a.title into v_title from public.achievements a
    join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
   where a.code = p_code and a.title is not null;
  if v_title is null then raise exception 'title_locked'; end if;
  update public.profiles set title = v_title where id = v_uid;
  return v_title;
end $$;

-- ---------------------------------------------------------------- succès personnalisés (administration)
create function public.admin_save_achievement(p_code text, p_label text, p_description text, p_secret boolean,
                                              p_reward_deniers bigint, p_reward_boosters integer, p_title text,
                                              p_characters uuid[] default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := coalesce(nullif(trim(p_code), ''), 'custom:' || gen_random_uuid());
  v_chars uuid[] := (select array_agg(distinct c.id) from public.characters c where c.id = any (coalesce(p_characters, '{}')));
begin
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'name_required'; end if;
  insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                   reward_deniers, reward_boosters, title, sort)
    values (v_code, trim(p_label), coalesce(trim(p_description), ''), coalesce(p_secret, false), 'custom',
            case when v_chars is null then 'manual' else 'characters' end, 1, v_chars,
            greatest(coalesce(p_reward_deniers, 0), 0), greatest(coalesce(p_reward_boosters, 0), 0), nullif(trim(p_title), ''), 500)
  on conflict (code) do update set label = excluded.label, description = excluded.description, secret = excluded.secret,
    reward_deniers = excluded.reward_deniers, reward_boosters = excluded.reward_boosters, title = excluded.title,
    metric = excluded.metric, required_characters = excluded.required_characters
    where public.achievements.category = 'custom';
  perform private.audit(v_admin, 'achievement_save', null, 'Succès personnalisé ' || trim(p_label), null,
                        jsonb_build_object('code', v_code));
  return v_code;
end $$;

create function public.admin_grant_achievement(p_code text, p_handle text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_def public.achievements;
  v_target uuid;
begin
  select * into v_def from public.achievements where code = p_code and category = 'custom';
  if not found then raise exception 'not_found'; end if;
  if v_def.metric <> 'manual' then raise exception 'conditional_achievement'; end if;
  select id into v_target from public.profiles where lower(handle) = lower(trim(p_handle));
  if v_target is null then raise exception 'player_not_found'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;
  insert into public.achievement_unlocks (owner_id, code, granted_by, reason) values (v_target, p_code, v_admin, trim(p_reason));
  if v_def.reward_deniers > 0 then
    perform private.apply_wallet_delta(v_target, v_def.reward_deniers, 'achievement_reward', 'achievement', null, 'achievement:' || v_def.code);
  end if;
  if v_def.reward_boosters > 0 then
    update public.booster_balances set purchased_count = purchased_count + v_def.reward_boosters, updated_at = now() where owner_id = v_target;
    insert into public.booster_grants (owner_id, source, pool, quantity) values (v_target, 'reward', 'purchased', v_def.reward_boosters);
  end if;
  perform private.audit(v_admin, 'achievement_grant', v_target, p_reason, null, jsonb_build_object('code', p_code));
exception when unique_violation then
  raise exception 'already_granted';
end $$;

create function public.admin_custom_achievements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description,
      'secret', a.secret, 'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title,
      'conditional', a.metric = 'characters',
      'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0')) order by c.number)
                               from public.characters c join public.editions e on e.id = c.edition_id
                              where c.id = any (coalesce(a.required_characters, '{}'))), '[]'::jsonb),
      'holders', (select coalesce(jsonb_agg(p.handle order by u.unlocked_at), '[]'::jsonb)
                    from public.achievement_unlocks u join public.profiles p on p.id = u.owner_id where u.code = a.code))
      order by a.label) from public.achievements a where a.category = 'custom'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- classement
-- Personnages uniques découverts (finitions ignorées), historique : ne diminue jamais.
create function public.get_leaderboard(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return (with scores as (
      select p.id, p.handle, p.title, count(d.character_id) as score, max(d.first_seen_at) as reached
        from public.profiles p join public.discoveries d on d.owner_id = p.id
       where p.handle is not null and p.suspended_at is null
       group by p.id),
    ranked as (select *, rank() over (order by score desc) as position from scores)
    select jsonb_build_object(
      'top', coalesce((select jsonb_agg(jsonb_build_object('position', position, 'handle', handle, 'title', title,
                 'score', score, 'me', id = v_uid) order by position, reached)
               from (select * from ranked order by position, reached limit least(greatest(p_limit, 1), 200)) t), '[]'::jsonb),
      'me', (select jsonb_build_object('position', position, 'score', score) from ranked where id = v_uid),
      'total_characters', (select count(*) from public.characters c join public.editions e on e.id = c.edition_id
                            where c.status = 'published' and e.album_published and e.archived_at is null)));
end $$;

-- ---------------------------------------------------------------- données initiales (propositions)
insert into public.mission_templates (code, kind, label, metric, target, reward, requires) values
  ('d_open_1', 'daily', 'Ouvrir 1 booster', 'open_boosters', 1, 25, null),
  ('d_open_2', 'daily', 'Ouvrir 2 boosters', 'open_boosters', 2, 40, null),
  ('d_discover_1', 'daily', 'Découvrir 1 nouveau visage', 'discover', 1, 30, null),
  ('d_rare_1', 'daily', 'Obtenir 1 carte Rare ou mieux', 'rare_pull', 1, 25, null),
  ('d_recycle_3', 'daily', 'Recycler 3 cartes', 'recycle', 3, 25, null),
  ('d_gift_1', 'daily', 'Offrir une carte à un ami', 'gift_send', 1, 30, 'friends'),
  ('d_market_buy_1', 'daily', 'Acheter une carte au marché', 'market_buy', 1, 30, 'trader'),
  ('d_bid_1', 'daily', 'Enchérir sur une carte', 'auction_bid', 1, 20, 'trader'),
  ('w_open_10', 'weekly', 'Ouvrir 10 boosters', 'open_boosters', 10, 150, null),
  ('w_discover_8', 'weekly', 'Découvrir 8 nouveaux visages', 'discover', 8, 200, null),
  ('w_login_5', 'weekly', 'Venir 5 jours dans la semaine', 'daily_login', 5, 150, null),
  ('w_rare_6', 'weekly', 'Obtenir 6 cartes Rare ou mieux', 'rare_pull', 6, 200, null),
  ('w_recycle_20', 'weekly', 'Recycler 20 cartes', 'recycle', 20, 120, null),
  ('w_trade_1', 'weekly', 'Conclure un échange', 'trade_done', 1, 200, 'friends'),
  ('w_sell_2', 'weekly', 'Vendre 2 cartes au marché', 'market_sell', 2, 150, 'trader');

insert into public.achievements (code, label, description, secret, metric, target, reward_deniers, reward_boosters, title, sort) values
  ('first_pack', 'Premier rituel', 'Ouvrir votre premier booster.', false, 'open_boosters', 1, 25, 0, null, 10),
  ('packs_25', 'Habitué des nuits', 'Ouvrir 25 boosters.', false, 'open_boosters', 25, 100, 0, null, 20),
  ('packs_100', 'Insatiable', 'Ouvrir 100 boosters.', false, 'open_boosters', 100, 300, 1, 'L’Insatiable', 30),
  ('faces_10', 'Premiers visages', 'Découvrir 10 personnages.', false, 'discover', 10, 50, 0, null, 40),
  ('faces_50', 'Archiviste', 'Découvrir 50 personnages.', false, 'discover', 50, 200, 1, 'Archiviste', 50),
  ('faces_100', 'Conservateur', 'Découvrir 100 personnages.', false, 'discover', 100, 500, 2, 'Conservateur', 60),
  ('faces_200', 'Gardien des visages', 'Découvrir 200 personnages.', false, 'discover', 200, 1000, 3, 'Gardien des visages', 70),
  ('legend_1', 'Légende vivante', 'Découvrir un personnage Légendaire.', false, 'discover_legendary', 1, 150, 0, null, 80),
  ('myth_1', 'Mythe', 'Découvrir un personnage Mythique.', false, 'discover_mythic', 1, 400, 0, 'Chasseur de mythes', 90),
  ('gold_1', 'Éclat d’or', 'Obtenir une carte en finition Dorée.', false, 'finish_gold', 1, 100, 0, null, 100),
  ('blood_1', 'Premier sang', 'Obtenir une carte en finition Sanglante.', false, 'finish_blood', 1, 300, 0, 'Saigné', 110),
  ('merchant_5', 'Négociant', 'Vendre 5 cartes au marché.', false, 'market_sell', 5, 150, 0, 'Négociant', 120),
  ('friends_3', 'Coterie', 'Avoir 3 amis.', false, 'friends', 3, 75, 0, null, 130),
  ('trade_1', 'Pacte', 'Conclure votre premier échange.', false, 'trade_done', 1, 100, 0, null, 140),
  ('recycle_100', 'Le Broyeur', 'Recycler 100 cartes.', true, 'recycle', 100, 200, 0, 'Le Broyeur', 200),
  ('blood_3', 'Bain de sang', 'Obtenir trois personnages différents en finition Sanglante.', true, 'finish_blood', 3, 500, 1, 'Bain de sang', 210),
  ('gold_10', 'Trésor du cabinet', 'Obtenir dix personnages différents en finition Dorée.', true, 'finish_gold', 10, 400, 1, null, 220),
  ('unique', 'L’Élu', 'Posséder un jour la carte unique.', true, 'discover_unique', 1, 1000, 0, 'Premier-Né', 230);

-- État du joueur : ajoute le titre porté.
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
    'social_pending', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'),
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
  public.create_listing(uuid, bigint, uuid), public.cancel_listing(uuid), public.buy_listing(uuid),
  public.get_market(public.rarity, public.finish, text, integer, integer), public.get_my_listings(),
  public.get_trade_status(), public.create_auction(uuid, bigint, integer, uuid),
  public.place_bid(uuid, bigint, uuid), public.get_my_bids(),
  public.send_friend_request(text), public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.get_friends(), public.send_gift(uuid, uuid, uuid), public.respond_gift(uuid, boolean), public.cancel_gift(uuid),
  public.propose_trade(uuid, uuid[], uuid[], bigint, bigint, uuid, uuid), public.respond_trade(uuid, boolean),
  public.cancel_trade(uuid), public.get_friend_cards(uuid), public.get_social(),
  public.get_missions(), public.claim_mission(uuid), public.replace_mission(uuid),
  public.get_achievements(), public.set_title(text), public.get_leaderboard(integer),
  public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[]),
  public.admin_grant_achievement(text, text, text), public.admin_custom_achievements(),
  public.admin_catalog(), public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text), public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text),
  public.admin_publish_drafts(uuid, text), public.admin_set_unique(uuid, boolean, text)
to authenticated;
