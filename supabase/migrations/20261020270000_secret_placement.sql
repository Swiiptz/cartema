-- CARTEMA — rangement des succès secrets de la chronique (demande du 20/10/2026) :
-- les groupes de personnages (Pigeons voyageurs, LES BRATS!!!, Le Notred, De Marnayed) sont
-- rattachés à l'édition Camarilla et s'affichent dans son set ; les autres secrets personnalisés
-- sans édition s'affichent avec les secrets généraux. Le placeholder « succès secret » indique
-- désormais son édition pour être rangé au bon endroit.

update public.achievements a
   set edition_id = e.id
  from public.editions e
 where e.prefix = 'CAM'
   and a.code in ('chronicle:pigeons', 'chronicle:brats', 'chronicle:le-notre', 'chronicle:de-marnay');

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
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null,
                           'edition', e.name, 'edition_prefix', e.prefix) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    cross join lateral private.achievement_state(v_uid, a) st
    -- Personnalisés : automatiques et secrets visibles (secrets masqués) ; manuels non secrets
    -- visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric <> 'manual' or a.secret), '[]'::jsonb);
end $$;
