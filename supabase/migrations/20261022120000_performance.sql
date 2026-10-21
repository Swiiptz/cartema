-- CARTEMA — performances (22/10/2026). Les pages les plus consultées écrivaient et verrouillaient à
-- chaque appel, même sans rien changer : sous charge, les appels simultanés s'attendaient (moyennes de
-- 70 à 300 ms, pointes à 7 s). Aucun changement de règle du jeu :
--  * sync_set_achievements ne réécrit plus les récompenses des succès de collection quand elles sont
--    déjà à jour (ces UPDATE verrouillaient des lignes communes à tous les joueurs) ;
--  * get_achievements calcule la progression une seule fois (au lieu de deux) et plus du tout pour
--    les succès déjà obtenus ;
--  * get_player_state ne verrouille plus le porte-monnaie ni ne réécrit la ligne de boosters quand
--    la récompense du jour est déjà prise et qu'aucun booster gratuit n'est dû ;
--  * get_market ne clôture plus les enchères échues (la tâche planifiée le fait chaque minute) :
--    il les masque en attendant.

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
   where a.category = 'collection' and a.metric = 'set_clan' and n.edition_id = a.edition_id and n.clan_id = a.clan_id
     and (a.reward_deniers, a.reward_boosters) is distinct from (greatest(100, 25 * n.cards), greatest(1, n.cards / 5));
  update public.achievements a
     set reward_deniers = n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                            when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
         reward_boosters = greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end,
                                    n.cards / 10)
    from (select c2.edition_id, c2.rarity, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique group by c2.edition_id, c2.rarity) n
   where a.category = 'collection' and a.metric = 'set_rarity' and n.edition_id = a.edition_id and n.rarity = a.rarity
     and (a.reward_deniers, a.reward_boosters) is distinct from (
           n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                     when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
           greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end, n.cards / 10));
  update public.achievements set reward_deniers = 8000, reward_boosters = 12
   where category = 'collection' and metric = 'set_all' and (reward_deniers, reward_boosters) is distinct from (8000, 12);
end $$;

-- Débloque les succès atteints et renvoie la progression de ceux qui restent à obtenir.
create function private.sync_achievement_states(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.achievements;
  v_state record;
  v_states jsonb := '{}'::jsonb;
begin
  perform private.sync_set_achievements();
  for v_def in select a.* from public.achievements a
                where a.metric <> 'manual'
                  and not exists (select 1 from public.achievement_unlocks u where u.owner_id = p_owner and u.code = a.code) loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    if v_state.target > 0 and v_state.progress >= v_state.target then
      insert into public.achievement_unlocks (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
      if found then
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
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  return v_states;
end $$;

create or replace function private.sync_achievements(p_owner uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_before integer := (select count(*) from public.achievement_unlocks where owner_id = p_owner);
begin
  perform private.sync_achievement_states(p_owner);
  return (select count(*) from public.achievement_unlocks where owner_id = p_owner) - v_before;
end $$;

create or replace function public.get_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_states jsonb;
begin
  -- Une seule passe : débloque et donne la progression des succès restants ; les succès obtenus
  -- ne sont pas recalculés (la progression n'est affichée que pour les succès à obtenir).
  v_states := private.sync_achievement_states(v_uid);
  return coalesce((select jsonb_agg(case when u.code is not null or not a.secret then jsonb_build_object(
      'code', a.code, 'label', a.label, 'secret', a.secret, 'title', a.title,
      'description', case when a.category = 'custom' and u.code is null then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'series', a.series, 'series_label', a.series_label, 'tier', a.tier,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'progress', case when u.code is not null then coalesce(st.target, a.target) when a.metric = 'manual' then 0
                       else least(st.progress, st.target) end,
      'target', case when a.metric = 'manual' then 1 else coalesce(st.target, a.target) end,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null,
                           'edition', e.name, 'edition_prefix', e.prefix) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    left join lateral (select (v_states->a.code->>0)::bigint as progress, (v_states->a.code->>1)::bigint as target) st on true
    -- Personnalisés : automatiques et secrets visibles (secrets masqués) ; manuels non secrets
    -- visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric <> 'manual' or a.secret), '[]'::jsonb);
end $$;

create or replace function private.sync_free_boosters(p_owner uuid, p_at timestamptz default now())
returns public.booster_balances language plpgsql security definer set search_path = '' as $$
declare
  v_row public.booster_balances;
  v_capacity integer := ((private.active_settings()).settings->>'free_booster_capacity')::int;
  v_slot timestamptz;
begin
  -- Chemin rapide : aucun créneau gratuit depuis la dernière synchronisation, rien à écrire.
  select * into v_row from public.booster_balances b where b.owner_id = p_owner;
  if found and not exists (select 1 from private.free_slots_between(v_row.free_synced_until, p_at)) then
    return v_row;
  end if;
  select * into v_row from public.booster_balances b where b.owner_id = p_owner for update;
  if not found then
    raise exception 'booster_balance_missing';
  end if;
  for v_slot in select s from private.free_slots_between(v_row.free_synced_until, p_at) s loop
    if v_row.free_count < v_capacity then
      v_row.free_count := v_row.free_count + 1;
      insert into public.booster_grants (owner_id, source, pool, quantity, slot_at)
        values (p_owner, 'free_slot', 'free', 1, v_slot);
    end if;
    v_row.free_synced_until := v_slot;
  end loop;
  update public.booster_balances
     set free_count = v_row.free_count, free_synced_until = v_row.free_synced_until, updated_at = now()
   where owner_id = p_owner
   returning * into v_row;
  return v_row;
end $$;

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
  -- Déjà prise aujourd'hui : pas de verrou sur le porte-monnaie.
  if exists (select 1 from public.wallet_ledger where owner_id = p_owner and idempotency_key = v_key) then
    return 0;
  end if;
  select balance into v_before from public.wallets where owner_id = p_owner for update;
  if exists (select 1 from public.wallet_ledger where owner_id = p_owner and idempotency_key = v_key) then
    return 0;
  end if;
  v_after := private.apply_wallet_delta(p_owner, v_amount, 'daily_login', null, null, v_key);
  return v_amount;
end $$;

create or replace function public.get_market(p_rarity public.rarity default null, p_finish public.finish default null,
                                  p_query text default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_query text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select l.* from public.listings l join public.characters c on c.id = l.character_id
           where l.status = 'active'
             -- Enchères échues : masquées en attendant leur clôture par la tâche planifiée (chaque minute).
             and (l.kind <> 'auction' or l.ends_at > now())
             and (p_rarity is null or c.rarity = p_rarity)
             and (p_finish is null or l.finish = p_finish)
             and (v_query is null or lower(c.name) like '%' || v_query || '%')
           order by l.created_at desc
           limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) l), '[]'::jsonb);
end $$;

revoke execute on function private.sync_achievement_states(uuid) from public, anon, authenticated;
