-- CARTEMA — liste « Il vous manque » plus discrète et succès secret « Famille recomposée » (22/10/2026).
--  * La liste des cartes manquantes d'un set n'apparaît plus que si la moitié du set est déjà possédée
--    (en plus de « 5 cartes ou moins ») : un set à 0/4 ne liste plus ses cartes. Le site regroupe les
--    cartes jamais découvertes en une seule pastille.
--  * « Famille recomposée » (secret, chronique) : posséder Alina (CAM-052), Malyen (CAM-088) et Lily
--    (CAM-150, la Malkavienne ; CAM-151 est une autre Lily). Ciblées par numéro ; rien n'est créé si
--    une des cartes manque (bases de test).

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
      'owned_rule', a.metric in ('set_clan', 'set_rarity', 'set_all', 'characters'),
      'progress', case when u.code is not null then coalesce(st.target, a.target) when a.metric = 'manual' then 0
                       else least(st.progress, st.target) end,
      'target', case when a.metric = 'manual' then 1 else coalesce(st.target, a.target) end,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
      -- Set presque complet : les cartes qui manquent (nom si découverte, sinon seulement le numéro),
      -- seulement quand la moitié du set est déjà possédée.
      || case when u.code is null and a.metric in ('set_clan', 'set_rarity', 'set_all')
                   and st.target - st.progress between 1 and 5 and st.progress * 2 >= st.target then jsonb_build_object('missing', (
           select jsonb_agg(jsonb_build_object(
                    'name', case when exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = c.id)
                                 then c.name end,
                    'code', e.prefix || '-' || lpad(c.number::text, 3, '0')) order by c.number)
             from public.characters c
            where c.edition_id = a.edition_id and c.status = 'published' and not c.is_unique
              and (a.metric <> 'set_clan' or c.clan_id = a.clan_id)
              and (a.metric <> 'set_rarity' or c.rarity = a.rarity)
              and not private.owns_card(v_uid, c.id)))
         else '{}'::jsonb end
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

do $$
declare
  v_ids uuid[];
begin
  select array_agg(c.id order by c.number) into v_ids
    from public.characters c join public.editions e on e.id = c.edition_id
   where e.prefix = 'CAM' and c.number in (52, 88, 150);
  if coalesce(cardinality(v_ids), 0) = 3 then
    insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                     reward_deniers, reward_boosters, title, sort)
      values ('chronicle:famille', 'Famille recomposée', 'Avoir réuni Alina, Malyen et Lily.', true, 'custom', 'characters', 1, v_ids,
              500, 2, 'Famille recomposée', 508)
    on conflict (code) do nothing;
  end if;
end $$;
