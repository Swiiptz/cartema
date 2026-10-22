-- CARTEMA — édition annoncée (« Soon ») : son code (ex. ANE) est envoyé avec son nom, pour l'afficher
-- dans le sélecteur de la page Boosters. Toujours rien d'autre : ni cartes, ni prix, ni ouverture.

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
