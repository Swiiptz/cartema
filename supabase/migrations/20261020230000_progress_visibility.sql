-- CARTEMA — succès conditionnels secrets visibles comme « succès secret » ; nombre de missions
-- prêtes à réclamer dans l'état du joueur (pastille de navigation).

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
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'progress', least(st.progress, st.target), 'target', st.target,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    cross join lateral private.achievement_state(v_uid, a) st
    -- Personnalisés : les conditionnels sont visibles (secrets masqués), les manuels n'apparaissent
    -- qu'une fois décernés.
    -- Conditionnels secrets : visibles comme « succès secret » (sans nom ni explication).
    where a.category <> 'custom' or u.code is not null or a.metric = 'characters'), '[]'::jsonb);
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
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix,
               'cover_path', e.cover_path, 'openable', private.edition_is_complete(e.id)) order by e.created_at)
      from public.editions e
      where e.packs_enabled and e.archived_at is null), '[]'::jsonb)
  );
end $$;
