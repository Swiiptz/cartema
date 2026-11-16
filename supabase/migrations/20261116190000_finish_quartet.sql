-- CARTEMA — trophées « Sang, or et givre » (16/11/2026, demande de Swiiptz) : sur le modèle de « De l'or à la lie »,
-- un palier par rareté, une même carte de l'Appel des Neiges Éternelles possédée dans ses quatre finitions
-- (Standard, Dorée, Sanglante, Neige). Métrique finish_quartet. Secrets jusqu'à l'ouverture d'ANE (à rendre
-- visibles dans Admin › Succès). Récompenses un peu au-dessus de « De l'or à la lie » : une Neige en plus.
-- Reprise de achievement_state (20261116170100_snow_finish).

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
  elsif p_def.metric in ('finish_cards', 'finish_rarities') then
    -- Cartes possédées dans une finition (édition et rareté facultatives) : personnages différents, ou raretés différentes.
    return query
      select case when p_def.metric = 'finish_cards' then count(distinct i.character_id) else count(distinct c.rarity) end::bigint,
             p_def.target::bigint
        from public.inventory_items i join public.characters c on c.id = i.character_id
       where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null and i.finish = p_def.finish
         and (p_def.edition_id is null or c.edition_id = p_def.edition_id) and (p_def.rarity is null or c.rarity = p_def.rarity);
  elsif p_def.metric = 'finish_quartet' then
    -- Une même carte de cette rareté (édition facultative) possédée dans les quatre finitions.
    return query
      select least(count(*), 1)::bigint, 1::bigint
        from (select i.character_id from public.inventory_items i
                join public.characters c on c.id = i.character_id
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
                 and c.rarity = coalesce(p_def.rarity, 'Commun') and (p_def.edition_id is null or c.edition_id = p_def.edition_id)
               group by i.character_id having count(distinct i.finish) = 4) t;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

insert into public.achievements (code, label, description, secret, metric, target, rarity, edition_id, reward_deniers, reward_boosters, title, sort,
                                 series, series_label, tier)
  select v.code, v.label, v.description, true, 'finish_quartet', 1, v.rarity::public.rarity, e.id, v.den, v.boo, v.title, v.sort,
         'quartet', 'Sang, or et givre', v.tier
    from public.editions e,
         (values ('quartet_commun', 'Premier givre', 'Posséder une Commune de l’Appel des Neiges Éternelles dans ses quatre finitions : classique, Dorée, Sanglante et Neige.', 'Commun', 600, 1, null, 121, 1),
                 ('quartet_peu_commun', 'Gel matinal', 'Posséder une Peu commune de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Peu commun', 1200, 2, null, 122, 2),
                 ('quartet_rare', 'Poudreuse', 'Posséder une Rare de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Rare', 2000, 4, null, 123, 3),
                 ('quartet_tres_rare', 'Blizzard', 'Posséder une Très rare de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Très rare', 3000, 6, null, 124, 4),
                 ('quartet_epique', 'Congère d’or', 'Posséder une Épique de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Épique', 5000, 10, 'Congère d’or', 125, 5),
                 ('quartet_legendaire', 'Glacier ensanglanté', 'Posséder une Légendaire de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Légendaire', 10000, 18, 'Glacier ensanglanté', 126, 6),
                 ('quartet_mythique', 'Sang, or et givre', 'Posséder une Mythique de l’Appel des Neiges Éternelles dans ses quatre finitions.', 'Mythique', 18000, 30, 'Sang, or et givre', 127, 7))
         as v(code, label, description, rarity, den, boo, title, sort, tier)
   where e.prefix = 'ANE'
on conflict (code) do nothing;
