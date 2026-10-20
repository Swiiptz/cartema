-- CARTEMA — succès à paliers, récompenses relevées, bonus de fin de missions (validés le 20/10/2026).
--  * Séries : les succès d'une même famille (boosters ouverts, visages découverts, finitions,
--    marché, amis, échanges) forment une série à paliers Bronze, Argent, Or, Platine. Chaque palier
--    reste un succès distinct (total, récompense, classement) ; l'interface les regroupe en une carte.
--    Les paliers supérieurs de l'or et du sang cessent d'être secrets pour rejoindre leur série.
--  * Récompenses de succès plus généreuses. Les succès ne se gagnent qu'une fois ; ceux qu'un
--    second compte pourrait faciliter (amis, échanges, ventes) restent modérés.
--  * Bonus de missions : toutes les missions du jour réclamées = 1 booster ; toutes celles de la
--    semaine = 4 boosters. Versé une seule fois par période (clé primaire).

alter table public.achievements
  add column series text,
  add column series_label text,
  add column tier smallint check (tier between 1 and 5);

insert into public.achievements (code, label, description, secret, metric, target, reward_deniers, reward_boosters, title, sort) values
  ('packs_500', 'Grand ritualiste', 'Ouvrir 500 boosters.', false, 'open_boosters', 500, 0, 0, 'Grand ritualiste', 35),
  ('gold_5', 'Reflets dorés', 'Obtenir cinq personnages différents en finition Dorée.', false, 'finish_gold', 5, 0, 0, null, 101),
  ('blood_5', 'Rivière de sang', 'Obtenir cinq personnages différents en finition Sanglante.', false, 'finish_blood', 5, 0, 0, 'Rivière de sang', 112),
  ('merchant_20', 'Marchand', 'Vendre 20 cartes au marché.', false, 'market_sell', 20, 0, 0, null, 121),
  ('merchant_50', 'Grand négociant', 'Vendre 50 cartes au marché.', false, 'market_sell', 50, 0, 0, 'Grand négociant', 122),
  ('friends_1', 'Premier lien', 'Avoir un ami.', false, 'friends', 1, 0, 0, null, 129),
  ('friends_10', 'Cour', 'Avoir 10 amis.', false, 'friends', 10, 0, 0, 'Maître de cour', 131),
  ('trade_5', 'Pacte scellé', 'Conclure 5 échanges.', false, 'trade_done', 5, 0, 0, null, 141),
  ('trade_20', 'Faiseur de pactes', 'Conclure 20 échanges.', false, 'trade_done', 20, 0, 0, 'Faiseur de pactes', 142)
on conflict (code) do nothing;

update public.achievements a
   set series = v.series, series_label = v.series_label, tier = v.tier,
       reward_deniers = v.deniers, reward_boosters = v.boosters, secret = false, sort = v.sort
  from (values
    ('first_pack',  'packs',    'Rituels',              1,   50, 1,  10),
    ('packs_25',    'packs',    'Rituels',              2,  200, 1,  20),
    ('packs_100',   'packs',    'Rituels',              3,  700, 3,  30),
    ('packs_500',   'packs',    'Rituels',              4, 2500, 8,  35),
    ('faces_10',    'faces',    'Visages découverts',   1,  100, 1,  40),
    ('faces_50',    'faces',    'Visages découverts',   2,  400, 2,  50),
    ('faces_100',   'faces',    'Visages découverts',   3, 1200, 4,  60),
    ('faces_200',   'faces',    'Visages découverts',   4, 2500, 8,  70),
    ('gold_1',      'gold',     'Éclats d’or',          1,  200, 1, 100),
    ('gold_5',      'gold',     'Éclats d’or',          2,  500, 2, 101),
    ('gold_10',     'gold',     'Éclats d’or',          3, 1500, 4, 102),
    ('blood_1',     'blood',    'Sang versé',           1,  500, 1, 110),
    ('blood_3',     'blood',    'Sang versé',           2, 1000, 2, 111),
    ('blood_5',     'blood',    'Sang versé',           3, 3000, 6, 112),
    ('merchant_5',  'merchant', 'Négoce',               1,  200, 0, 120),
    ('merchant_20', 'merchant', 'Négoce',               2,  400, 1, 121),
    ('merchant_50', 'merchant', 'Négoce',               3, 1000, 3, 122),
    ('friends_1',   'friends',  'Coterie',              1,   50, 0, 129),
    ('friends_3',   'friends',  'Coterie',              2,  100, 0, 130),
    ('friends_10',  'friends',  'Coterie',              3,  250, 1, 131),
    ('trade_1',     'trade',    'Pactes',               1,  100, 0, 140),
    ('trade_5',     'trade',    'Pactes',               2,  250, 1, 141),
    ('trade_20',    'trade',    'Pactes',               3,  500, 1, 142)
  ) as v(code, series, series_label, tier, deniers, boosters, sort)
 where a.code = v.code;

-- Succès isolés : récompenses relevées, secrets conservés.
update public.achievements set reward_deniers = 300, reward_boosters = 1 where code = 'legend_1';
update public.achievements set reward_deniers = 800, reward_boosters = 2 where code = 'myth_1';
update public.achievements set reward_deniers = 400, reward_boosters = 1 where code = 'recycle_100';
update public.achievements set reward_deniers = 3000, reward_boosters = 5 where code = 'unique';

-- Collection, plus généreuse pour les longues séries : clan = 25 Deniers par carte (minimum 100)
-- et 1 booster par tranche de 5 cartes (minimum 1) ; rareté = barème par carte et boosters selon
-- la rareté et le nombre de cartes ; édition complète = 8 000 Deniers et 12 boosters.
create or replace function private.sync_set_achievements() returns void
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
           'collection', e.id, r.rarity, 'set_rarity', 1, 0, 0,
           case when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', 'Maître de ' || e.name, 'Découvrir toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 8000, 12, 'Maître de ' || e.name, 800
      from public.editions e
     where e.album_published and e.archived_at is null
       and exists (select 1 from public.characters c where c.edition_id = e.id and c.status = 'published')
  on conflict (code) do nothing;
  -- Récompenses proportionnelles à la taille du groupe, recalculées à chaque synchronisation pour
  -- suivre les cartes ajoutées : chaque déblocage verse la valeur du moment.
  update public.achievements a
     set reward_deniers = greatest(100, 25 * n.cards), reward_boosters = greatest(1, n.cards / 5)
    from (select c2.edition_id, c2.clan_id, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique and c2.clan_id is not null
           group by c2.edition_id, c2.clan_id) n
   where a.category = 'collection' and a.metric = 'set_clan' and n.edition_id = a.edition_id and n.clan_id = a.clan_id;
  update public.achievements a
     set reward_deniers = n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                            when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
         reward_boosters = greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end,
                                    n.cards / 10)
    from (select c2.edition_id, c2.rarity, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique group by c2.edition_id, c2.rarity) n
   where a.category = 'collection' and a.metric = 'set_rarity' and n.edition_id = a.edition_id and n.rarity = a.rarity;
  update public.achievements set reward_deniers = 8000, reward_boosters = 12
   where category = 'collection' and metric = 'set_all';
end $$;

create or replace function public.get_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.sync_achievements(v_uid);
  return coalesce((select jsonb_agg(case when u.code is not null or not a.secret then jsonb_build_object(
      'code', a.code, 'label', a.label, 'secret', a.secret, 'title', a.title,
      'description', case when a.category = 'custom' and u.code is null then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'series', a.series, 'series_label', a.series_label, 'tier', a.tier,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'progress', least(st.progress, st.target), 'target', st.target,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    cross join lateral private.achievement_state(v_uid, a) st
    -- Personnalisés : conditionnels visibles (secrets masqués), manuels visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric = 'characters'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- bonus de missions
update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"mission_bonus_daily": 1, "mission_bonus_weekly": 4}'::jsonb
    from public.economy_settings;

create table public.mission_bonuses (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  period_start timestamptz not null,
  boosters integer not null check (boosters >= 0),
  claimed_at timestamptz not null default now(),
  primary key (owner_id, kind, period_start)
);
alter table public.mission_bonuses enable row level security;
create policy mission_bonuses_own on public.mission_bonuses for select to authenticated using (owner_id = (select auth.uid()));
grant select on public.mission_bonuses to authenticated;

-- Verse le bonus si toutes les missions actives de la période sont réclamées (une seule fois).
create function private.grant_mission_bonus(p_owner uuid, p_kind text, p_start timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_qty integer := coalesce(((private.active_settings()).settings->>('mission_bonus_' || p_kind))::int, 0);
begin
  if v_qty <= 0 or exists (select 1 from public.mission_assignments
                            where owner_id = p_owner and kind = p_kind and period_start = p_start
                              and replaced_at is null and claimed_at is null) then
    return 0;
  end if;
  insert into public.mission_bonuses (owner_id, kind, period_start, boosters) values (p_owner, p_kind, p_start, v_qty)
    on conflict do nothing;
  if not found then return 0; end if;
  update public.booster_balances set purchased_count = purchased_count + v_qty, updated_at = now() where owner_id = p_owner;
  insert into public.booster_grants (owner_id, source, pool, quantity) values (p_owner, 'reward', 'purchased', v_qty);
  return v_qty;
end $$;

create or replace function public.claim_mission(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_a public.mission_assignments;
  v_t public.mission_templates;
  v_balance bigint;
  v_bonus integer;
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
  v_balance := case when v_t.reward > 0
    then private.apply_wallet_delta(v_uid, v_t.reward, 'mission_reward', 'mission', v_a.id, 'mission:' || v_a.id)
    else (select balance from public.wallets where owner_id = v_uid) end;
  v_bonus := private.grant_mission_bonus(v_uid, v_a.kind, v_a.period_start);
  return jsonb_build_object('reward', v_t.reward, 'balance', v_balance, 'bonus_boosters', v_bonus);
end $$;

create or replace function public.get_missions() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_day timestamptz;
  v_week timestamptz;
  v_settings jsonb := (private.active_settings()).settings;
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
    'daily_bonus', jsonb_build_object('boosters', coalesce((v_settings->>'mission_bonus_daily')::int, 0),
      'claimed', exists (select 1 from public.mission_bonuses where owner_id = v_uid and kind = 'daily' and period_start = v_day)),
    'weekly_bonus', jsonb_build_object('boosters', coalesce((v_settings->>'mission_bonus_weekly')::int, 0),
      'claimed', exists (select 1 from public.mission_bonuses where owner_id = v_uid and kind = 'weekly' and period_start = v_week)),
    'replacement_available', not exists (select 1 from public.mission_assignments
                                          where owner_id = v_uid and replaced_at >= v_day),
    'daily_reset', (select period_end from private.mission_period('daily')),
    'weekly_reset', (select period_end from private.mission_period('weekly')));
end $$;

-- ---------------------------------------------------------------- missions hebdomadaires étalées
-- Missions hebdomadaires plus longues : gros volumes (le rythme des boosters gratuits étale l'effort)
-- ou actions répétées sur plusieurs jours. Catalogue élargi pour varier les tirages.
-- « Venir 5 jours » est fixe : toujours tirée, jamais remplaçable.
create function private.game_day(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$
  select ((p_at at time zone 'Europe/Paris') - interval '6 hours')::date
$$;

create or replace function private.metric_value(p_owner uuid, p_metric text, p_from timestamptz default null, p_to timestamptz default now())
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
    -- Missions hebdomadaires : nombre de jours (06 h – 06 h, heure de Paris) où l'action a eu lieu.
    when 'open_days' then (select count(distinct private.game_day(created_at)) from public.pack_openings
                            where owner_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'discover_days' then (select count(distinct private.game_day(first_seen_at)) from public.discoveries
                                where owner_id = p_owner and first_seen_at >= v_from and first_seen_at < p_to)
    when 'rare_days' then (select count(distinct private.game_day(o.created_at)) from public.pack_opening_cards pc
                            join public.pack_openings o on o.id = pc.opening_id
                            where o.owner_id = p_owner and o.created_at >= v_from and o.created_at < p_to and pc.rarity >= 'Rare')
    when 'recycle_days' then (select count(distinct private.game_day(created_at)) from public.recycling_operations
                               where owner_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'sell_days' then (select count(distinct private.game_day(closed_at)) from public.listings
                            where seller_id = p_owner and status = 'sold' and closed_at >= v_from and closed_at < p_to)
    when 'gift_days' then (select count(distinct private.game_day(created_at)) from public.gifts
                            where sender_id = p_owner and created_at >= v_from and created_at < p_to)
    when 'very_rare_pull' then (select count(*) from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
                                 where o.owner_id = p_owner and o.created_at >= v_from and o.created_at < p_to and pc.rarity >= 'Très rare')
    when 'epic_pull' then (select count(*) from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
                            where o.owner_id = p_owner and o.created_at >= v_from and o.created_at < p_to and pc.rarity >= 'Épique')
    when 'market_list' then (select count(*) from public.listings where seller_id = p_owner and created_at >= v_from and created_at < p_to)
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

alter table public.mission_templates add column fixed boolean not null default false;

update public.mission_templates set active = false where kind = 'weekly' and code <> 'w_login_5';
update public.mission_templates set fixed = true, reward = 250 where code = 'w_login_5';
insert into public.mission_templates (code, kind, label, metric, target, reward, requires) values
  ('d_open_3', 'daily', 'Ouvrir 3 boosters', 'open_boosters', 3, 50, null),
  ('d_discover_2', 'daily', 'Découvrir 2 nouveaux visages', 'discover', 2, 50, null),
  ('d_veryrare_1', 'daily', 'Obtenir une carte Très rare ou mieux', 'very_rare_pull', 1, 40, null),
  ('d_recycle_8', 'daily', 'Recycler 8 cartes', 'recycle', 8, 40, null),
  ('d_list_1', 'daily', 'Mettre une carte en vente', 'market_list', 1, 25, 'trader'),
  ('w_open_days_5', 'weekly', 'Ouvrir un booster 5 jours différents', 'open_days', 5, 250, null),
  ('w_discover_days_4', 'weekly', 'Découvrir un nouveau visage 4 jours différents', 'discover_days', 4, 300, null),
  ('w_open_25', 'weekly', 'Ouvrir 25 boosters', 'open_boosters', 25, 300, null),
  ('w_discover_15', 'weekly', 'Découvrir 15 nouveaux visages', 'discover', 15, 350, null),
  ('w_rare_15', 'weekly', 'Obtenir 15 cartes Rare ou mieux', 'rare_pull', 15, 250, null),
  ('w_veryrare_5', 'weekly', 'Obtenir 5 cartes Très rare ou mieux', 'very_rare_pull', 5, 300, null),
  ('w_epic_1', 'weekly', 'Obtenir une carte Épique ou mieux', 'epic_pull', 1, 300, null),
  ('w_recycle_60', 'weekly', 'Recycler 60 cartes', 'recycle', 60, 200, null),
  ('w_recycle_days_3', 'weekly', 'Recycler des cartes 3 jours différents', 'recycle_days', 3, 150, null),
  ('w_sell_6', 'weekly', 'Vendre 6 cartes au marché', 'market_sell', 6, 300, 'trader'),
  ('w_buy_3', 'weekly', 'Acheter 3 cartes au marché', 'market_buy', 3, 200, 'trader'),
  ('w_bid_5', 'weekly', 'Placer 5 enchères', 'auction_bid', 5, 200, 'trader'),
  ('w_gift_days_3', 'weekly', 'Offrir une carte 3 jours différents', 'gift_days', 3, 250, 'friends'),
  ('w_trade_2', 'weekly', 'Conclure 2 échanges', 'trade_done', 2, 300, 'friends')
on conflict (code) do nothing;

-- La semaine en cours est retirée avec les nouvelles règles (missions non réclamées seulement).
delete from public.mission_assignments a
 using public.mission_templates t
 where t.code = a.template_code and a.kind = 'weekly' and a.claimed_at is null and a.period_end > now() and not t.active;

create or replace function private.ensure_missions(p_owner uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_missing integer;
begin
  select period_start, period_end into v_start, v_end from private.mission_period(p_kind);
  perform 1 from public.profiles where id = p_owner for update;
  -- Missions fixes d'abord (jamais remplacées), puis tirage au hasard jusqu'à 3.
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and t.fixed and private.mission_eligible(p_owner, t.requires)
  on conflict do nothing;
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and not t.fixed and private.mission_eligible(p_owner, t.requires)
       and not exists (select 1 from public.mission_assignments a
                        where a.owner_id = p_owner and a.period_start = v_start and a.template_code = t.code)
     order by random() limit v_missing;
end $$;

create or replace function private.mission_json(p_a public.mission_assignments) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('assignment_id', p_a.id, 'kind', p_a.kind, 'label', t.label, 'target', t.target,
    'reward', t.reward, 'progress', least(private.metric_value(p_a.owner_id, t.metric, p_a.period_start, p_a.period_end), t.target),
    'claimed', p_a.claimed_at is not null, 'ends_at', p_a.period_end, 'replaceable', not t.fixed)
  from public.mission_templates t where t.code = p_a.template_code
$$;

create or replace function public.replace_mission(p_assignment_id uuid) returns jsonb
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
  if (select fixed from public.mission_templates where code = v_a.template_code) then raise exception 'not_replaceable'; end if;
  if exists (select 1 from public.mission_assignments where owner_id = v_uid and replaced_at >= v_day) then
    raise exception 'replacement_used';
  end if;
  update public.mission_assignments set replaced_at = now() where id = v_a.id;
  perform private.ensure_missions(v_uid, v_a.kind);
  return public.get_missions();
end $$;

revoke execute on function private.grant_mission_bonus(uuid, text, timestamptz), private.game_day(timestamptz)
  from public, anon, authenticated;
