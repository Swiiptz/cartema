-- CARTEMA — camps (décision du 23/10/2026) : « Team Apo » et « Team Gwen », succès de Camarilla qu'on peut
-- perdre, comme les lignées.
--  * Métrique « faction » : posséder toutes les cartes requises (required_characters) et aucune carte exclue
--    (achievements.excluded_characters). État dans lineage_holds, titre retiré dès que la condition tombe.
--  * Le déclencheur d'inventaire vérifie maintenant aussi les cartes qui arrivent : obtenir la carte interdite
--    fait perdre le camp aussitôt (achat, booster, cadeau, échange). Gain à la passe suivante, comme avant.
--  * Team Apo : Apothicaire (CAM-235) et Isabeau de Marnay (CAM-42), sans Gwen de Quéribus (CAM-21).
--    Team Gwen : Gwen et Isabeau de Marnay, sans l'Apothicaire. Les deux camps s'excluent d'eux-mêmes.

alter table public.achievements add column excluded_characters uuid[] not null default '{}';
comment on column public.achievements.excluded_characters is 'Camp : cartes à ne pas posséder (métrique faction).';

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

create or replace function private.sync_achievement_states(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.achievements;
  v_state record;
  v_states jsonb := '{}'::jsonb;
  v_hold public.lineage_holds;
begin
  perform private.sync_set_achievements();
  for v_def in select a.* from public.achievements a
                where a.metric not in ('manual', 'clan_lineage', 'faction')
                  and not exists (select 1 from public.achievement_unlocks u where u.owner_id = p_owner and u.code = a.code) loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    if v_state.target > 0 and v_state.progress >= v_state.target then
      insert into public.achievement_unlocks (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
      if found then
        perform private.give_achievement_reward(p_owner, v_def);
      end if;
    end if;
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  -- Lignées et camps : recalculés à chaque passe, car ils se gagnent et se perdent.
  for v_def in select a.* from public.achievements a where a.metric in ('clan_lineage', 'faction') loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    select * into v_hold from public.lineage_holds h where h.owner_id = p_owner and h.code = v_def.code;
    if v_state.target > 0 and v_state.progress >= v_state.target then
      if v_hold.owner_id is null then
        insert into public.lineage_holds (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
        if found then perform private.give_achievement_reward(p_owner, v_def); end if;
      elsif v_hold.lost_at is not null then
        update public.lineage_holds set since = now(), lost_at = null where owner_id = p_owner and code = v_def.code;
      end if;
    elsif v_hold.owner_id is not null and v_hold.lost_at is null then
      perform private.lose_lineage(p_owner, v_def.code);
    end if;
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  return v_states;
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
      'owned_rule', a.metric in ('set_clan', 'set_rarity', 'set_all', 'characters', 'clan_lineage', 'faction'),
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

-- Une carte bouge : on revérifie les lignées et camps détenus qui la concernent (propriétaire qui la perd,
-- et propriétaire qui la reçoit, pour une carte exclue).
create or replace function private.on_inventory_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_def public.achievements;
  v_state record;
begin
  foreach v_owner in array array_remove(array[case when tg_op = 'UPDATE' then old.owner_id end,
                                              case when tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id
                                                   then new.owner_id end], null) loop
    for v_def in
      select a.* from public.lineage_holds h
        join public.achievements a on a.code = h.code
        join public.characters c on c.id = new.character_id
       where h.owner_id = v_owner and h.lost_at is null
         and ((a.metric = 'clan_lineage' and a.clan_id = c.clan_id)
              or (a.metric = 'faction' and c.id = any (a.required_characters || a.excluded_characters))) loop
      select * into v_state from private.achievement_state(v_owner, v_def);
      if not (v_state.target > 0 and v_state.progress >= v_state.target) then
        perform private.lose_lineage(v_owner, v_def.code);
      end if;
    end loop;
  end loop;
  return null;
end $$;
create trigger inventory_lineage_gain after insert on public.inventory_items
  for each row execute function private.on_inventory_leave();

do $$
declare
  v_apo uuid;
  v_isa uuid;
  v_gwen uuid;
  v_cam uuid;
begin
  select e.id into v_cam from public.editions e where e.prefix = 'CAM';
  select c.id into v_apo from public.characters c where c.edition_id = v_cam and c.number = 235;
  select c.id into v_isa from public.characters c where c.edition_id = v_cam and c.number = 42;
  select c.id into v_gwen from public.characters c where c.edition_id = v_cam and c.number = 21;
  if v_apo is null or v_isa is null or v_gwen is null then return; end if;
  insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                   excluded_characters, reward_deniers, reward_boosters, title, sort, edition_id) values
    ('chronicle:team-apo', 'Le parti de l’Apothicaire', 'Posséder l’Apothicaire et Isabeau de Marnay, sans Gwen de Quéribus. Le titre se perd si la condition n’est plus remplie.',
     false, 'custom', 'faction', 1, array[v_apo, v_isa], array[v_gwen], 500, 2, 'Team Apo', 520, v_cam),
    ('chronicle:team-gwen', 'Le parti de Gwen', 'Posséder Gwen de Quéribus et Isabeau de Marnay, sans l’Apothicaire. Le titre se perd si la condition n’est plus remplie.',
     false, 'custom', 'faction', 1, array[v_gwen, v_isa], array[v_apo], 500, 2, 'Team Gwen', 521, v_cam)
  on conflict (code) do nothing;
end $$;
