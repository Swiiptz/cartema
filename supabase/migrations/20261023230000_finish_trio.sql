-- CARTEMA — succès à paliers « De l'or à la lie » (décision du 23/10/2026) : posséder une carte dans ses trois
-- finitions (Standard, Dorée, Sanglante), un palier par rareté : Commune, Rare, Très rare, Épique, Légendaire, Mythique
-- (une carte de cette rareté exactement : chaque palier est indépendant). Il faut posséder les trois
-- exemplaires au moment du déblocage ; le succès reste acquis ensuite. Récompenses calées sur « Fleuve de sang »
-- (10 Sanglantes différentes : 6 000 Deniers, 12 boosters) ; une Sanglante tombe sur 0,2 % des cartes.

-- Six paliers pour cette série (une rareté par palier, Peu commune exceptée).
alter table public.achievements drop constraint achievements_tier_check;
alter table public.achievements add constraint achievements_tier_check check (tier between 1 and 6);

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
  elsif p_def.metric = 'faction' then
    -- Camp : posséder les cartes requises, sans aucune carte exclue (sinon il en manque toujours une).
    return query
      select case when exists (select 1 from unnest(p_def.excluded_characters) x(id) where private.owns_card(p_owner, x.id))
                  then least(s.n, greatest(cardinality(p_def.required_characters) - 1, 0)) else s.n end,
             cardinality(p_def.required_characters)::bigint
        from (select count(*) filter (where private.owns_card(p_owner, rc.id)) n
                from unnest(p_def.required_characters) rc(id)) s;
  elsif p_def.metric = 'finish_trio' then
    -- De l'or à la lie : une carte de cette rareté exactement, possédée en Standard, en Dorée et en Sanglante.
    return query
      select least(count(*), 1)::bigint, 1::bigint
        from (select i.character_id from public.inventory_items i
                join public.characters c on c.id = i.character_id
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
                 and c.rarity = coalesce(p_def.rarity, 'Commun')
               group by i.character_id having count(distinct i.finish) = 3) t;
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
      -- Un camp montre toujours sa condition (il ne s'obtient jamais pour de bon).
      'description', case when a.category = 'custom' and u.code is null and a.metric <> 'faction' then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'series', a.series, 'series_label', a.series_label, 'tier', a.tier,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'owned_rule', a.metric in ('set_clan', 'set_rarity', 'set_all', 'characters', 'clan_lineage', 'faction', 'finish_trio'),
      'progress', case when u.code is not null then coalesce(st.target, a.target) when a.metric = 'manual' then 0
                       else least(st.progress, st.target) end,
      'target', case when a.metric = 'manual' then 1 else coalesce(st.target, a.target) end,
      'unlocked_at', case when a.metric in ('clan_lineage', 'faction') then case when h.lost_at is null then h.since end else u.unlocked_at end,
      'reason', u.reason)
      -- Lignée : détenue tant que le clan reste complet ; récompense déjà reçue si la ligne existe.
      || case when a.metric in ('clan_lineage', 'faction') then jsonb_build_object('lineage', true, 'lost_at', h.lost_at,
                                                                      'reward_claimed', h.owner_id is not null,
                                                                      'faction', a.metric = 'faction')
              else '{}'::jsonb end
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
      -- Lignée non détenue et presque complète : les membres qui manquent, toutes éditions confondues.
      || case when a.metric = 'clan_lineage' and (h.owner_id is null or h.lost_at is not null)
                   and st.target - st.progress between 1 and 5 and st.progress * 2 >= st.target then jsonb_build_object('missing', (
           select jsonb_agg(jsonb_build_object(
                    'name', case when exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = c.id)
                                 then c.name end,
                    'code', ce.prefix || '-' || lpad(c.number::text, 3, '0')) order by ce.prefix, c.number)
             from public.characters c join public.editions ce on ce.id = c.edition_id
            where c.clan_id = a.clan_id and c.status = 'published' and not c.is_unique
              and ce.album_published and ce.archived_at is null and not ce.eternal
              and not private.owns_card(v_uid, c.id)))
         else '{}'::jsonb end
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null,
                           'edition', e.name, 'edition_prefix', e.prefix) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    left join public.lineage_holds h on h.code = a.code and h.owner_id = v_uid
    left join lateral (select (v_states->a.code->>0)::bigint as progress, (v_states->a.code->>1)::bigint as target) st on true
    -- Personnalisés : automatiques et secrets visibles (secrets masqués) ; manuels non secrets
    -- visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric <> 'manual' or a.secret), '[]'::jsonb);
end $$;

create or replace function public.sync_my_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.sync_achievement_states(v_uid);
  -- unlocked_at vaut now() (heure de la transaction) pour les succès débloqués par cet appel.
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'title', a.title, 'secret', a.secret,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'series_label', a.series_label, 'tier', a.tier, 'rarity', a.rarity)
      -- Lignée retrouvée : pas de nouvelle récompense.
      || case when x.lineage then jsonb_build_object('lineage', true) else '{}'::jsonb end
      || case when x.lineage and x.again then jsonb_build_object('reward_deniers', 0, 'reward_boosters', 0) else '{}'::jsonb end
      order by a.sort)
    from (select u.code, false lineage, false again from public.achievement_unlocks u where u.owner_id = v_uid and u.unlocked_at = now()
          union all
          -- Lignée gagnée ou retrouvée par cet appel.
          select h.code, true, h.first_at < now()
            from public.lineage_holds h where h.owner_id = v_uid and h.since = now() and h.lost_at is null) x
    join public.achievements a on a.code = x.code), '[]'::jsonb);
end $$;

insert into public.achievements (code, label, description, secret, metric, target, rarity, reward_deniers, reward_boosters, title, sort,
                                 series, series_label, tier) values
  ('trio_commun', 'Argent sale', 'Posséder une Commune dans ses trois finitions : classique, Dorée et Sanglante.', false, 'finish_trio', 1, 'Commun', 500, 1, null, 115, 'trio', 'De l’or à la lie', 1),
  ('trio_rare', 'Monnaie de sang', 'Posséder une Rare dans ses trois finitions.', false, 'finish_trio', 1, 'Rare', 1500, 3, null, 116, 'trio', 'De l’or à la lie', 2),
  ('trio_tres_rare', 'Pacte de sang', 'Posséder une Très rare dans ses trois finitions.', false, 'finish_trio', 1, 'Très rare', 2500, 5, null, 117, 'trio', 'De l’or à la lie', 3),
  ('trio_epique', 'Or et sang', 'Posséder une Épique dans ses trois finitions.', false, 'finish_trio', 1, 'Épique', 4000, 8, 'Argent sale', 118, 'trio', 'De l’or à la lie', 4),
  ('trio_legendaire', 'Trésor maudit', 'Posséder une Légendaire dans ses trois finitions.', false, 'finish_trio', 1, 'Légendaire', 8000, 15, 'Trésor maudit', 119, 'trio', 'De l’or à la lie', 5),
  ('trio_mythique', 'De l’or à la lie', 'Posséder une Mythique dans ses trois finitions.', false, 'finish_trio', 1, 'Mythique', 15000, 25, 'De l’or à la lie', 120, 'trio', 'De l’or à la lie', 6)
on conflict (code) do nothing;
