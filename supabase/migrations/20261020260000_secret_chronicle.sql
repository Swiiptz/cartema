-- CARTEMA — succès secrets de la chronique (demandés par l'utilisateur le 20/10/2026).
-- Tous apparaissent comme « succès secret » jusqu'au déblocage, y compris les succès manuels
-- secrets (les manuels non secrets restent invisibles tant qu'ils ne sont pas décernés).
--  * groupes de personnages : Pigeons voyageurs, LES BRATS!!, Le Notred, De Marnayed ;
--  * « Le gars a pas compris le principe du jeu » : avoir recyclé au moins une fois chaque carte
--    publiée (hors carte unique) ;
--  * « Soutien de la première heure » : compte créé avant le 21/11/2026 00 h (Paris), soit le
--    premier mois de l'application ;
--  * « Actually 🤓 » : décerné à la main pour une erreur signalée dans une carte.

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
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
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
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
    -- Personnalisés : automatiques et secrets visibles (secrets masqués) ; manuels non secrets
    -- visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric <> 'manual' or a.secret), '[]'::jsonb);
end $$;

-- L'édition depuis l'admin ne doit pas écraser la mesure des succès spéciaux (recyclage, ancienneté).
create or replace function public.admin_save_achievement(p_code text, p_label text, p_description text, p_secret boolean,
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
    metric = case when public.achievements.metric in ('manual', 'characters') then excluded.metric else public.achievements.metric end,
    required_characters = case when public.achievements.metric in ('manual', 'characters') then excluded.required_characters
                               else public.achievements.required_characters end
    where public.achievements.category = 'custom';
  perform private.audit(v_admin, 'achievement_save', null, 'Succès personnalisé ' || trim(p_label), null,
                        jsonb_build_object('code', v_code));
  return v_code;
end $$;

-- Groupes de personnages : créés seulement si tous les personnages existent dans l'édition CAM.
do $$
declare
  v_group record;
  v_ids uuid[];
begin
  for v_group in select * from (values
      ('chronicle:pigeons', 'Pigeons voyageurs', 'Avoir collectionné Gwen de Quéribus, Isabeau de Marnay, Ganord, Rosana, Ary et Alaric Draven.',
       array['Gwen de Quéribus', 'Isabeau de Marnay', 'Ganord', 'Rosana', 'Ary', 'Alaric Draven'], 800::bigint, 3, 'Pigeon voyageur', 501),
      ('chronicle:brats', 'LES BRATS!!!', 'Avoir collectionné Sirius et Wezen.',
       array['Sirius', 'Wezen'], 300::bigint, 1, 'Brat', 502),
      ('chronicle:le-notre', 'Le Notred', 'Avoir collectionné tous les Le Nôtre.',
       array['Lys Le Nôtre', 'Perrette Le Nôtre', 'Werner Le Nôtre'], 500::bigint, 2, 'Le Notred', 503),
      ('chronicle:de-marnay', 'De Marnayed', 'Avoir collectionné tous les De Marnay.',
       array['Isabeau de Marnay', 'Lara de Marnay'], 400::bigint, 2, 'De Marnayed', 504)
    ) as g(code, label, description, names, deniers, boosters, title, sort) loop
    select array_agg(c.id) into v_ids
      from public.characters c join public.editions e on e.id = c.edition_id
     where e.prefix = 'CAM' and c.name = any (v_group.names);
    continue when coalesce(cardinality(v_ids), 0) <> cardinality(v_group.names);
    insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                     reward_deniers, reward_boosters, title, sort)
      values (v_group.code, v_group.label, v_group.description, true, 'custom', 'characters', 1, v_ids,
              v_group.deniers, v_group.boosters, v_group.title, v_group.sort)
    on conflict (code) do nothing;
  end loop;
end $$;

insert into public.achievements (code, label, description, secret, category, metric, target, reward_deniers, reward_boosters, title, sort) values
  ('chronicle:recycle-all', 'Le gars a pas compris le principe du jeu', 'Avoir recyclé au moins une fois chaque carte du jeu (hors Caïn).',
   true, 'custom', 'recycle_all', 1, 3000, 8, 'N’a pas compris le principe', 505),
  ('chronicle:early', 'Soutien de la première heure', 'Avoir rejoint Cartema durant son premier mois.',
   true, 'custom', 'early_supporter', 1, 500, 3, 'Soutien de la première heure', 506),
  ('chronicle:actually', 'Actually 🤓', 'Avoir signalé une erreur dans une carte.',
   true, 'custom', 'manual', 1, 300, 1, 'Actually 🤓', 507)
on conflict (code) do nothing;
