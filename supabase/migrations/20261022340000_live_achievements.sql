-- CARTEMA — succès en direct (22/10/2026). Les succès ne se débloquaient qu'à l'ouverture de la page
-- Progrès. sync_my_achievements les débloque et renvoie seulement ceux obtenus par cet appel : la page
-- Boosters l'appelle une fois, à la fin de la révélation, pour afficher une bannière dorée.
-- Même calcul que get_achievements (private.sync_achievement_states) ; rien n'est renvoyé si aucun
-- succès n'est nouveau.

create function public.sync_my_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.sync_achievement_states(v_uid);
  -- unlocked_at vaut now() (heure de la transaction) pour les succès débloqués par cet appel.
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'title', a.title, 'secret', a.secret,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'series_label', a.series_label, 'tier', a.tier)
      order by a.sort)
    from public.achievement_unlocks u join public.achievements a on a.code = u.code
   where u.owner_id = v_uid and u.unlocked_at = now()), '[]'::jsonb);
end $$;

revoke execute on function public.sync_my_achievements() from public, anon;
grant execute on function public.sync_my_achievements() to authenticated;
