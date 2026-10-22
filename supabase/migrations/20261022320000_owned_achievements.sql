-- CARTEMA — succès de cartes : il faut posséder les cartes au moment du déblocage (décision du
-- 22/10/2026). Concerne les sets (clan, rareté, édition complète) et les groupes de personnages
-- (succès personnalisés conditionnels, avec ou sans finition). Un exemplaire compte tant qu'il est au
-- joueur, même en vente ou engagé dans un échange ; recyclé ou retiré, il ne compte plus.
-- Un succès débloqué reste acquis, y compris ceux débloqués avant ce changement. Les succès de
-- découverte (visages, éclats d'or, sang versé…) et le classement restent fondés sur les découvertes.
-- get_achievements renvoie owned_rule et, pour un set à 5 cartes ou moins du but, la liste des cartes
-- manquantes (nom seulement si la carte a été découverte).

create or replace function private.owns_card(p_owner uuid, p_character uuid, p_finish public.finish default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inventory_items i
                  where i.owner_id = p_owner and i.character_id = p_character
                    and i.recycled_at is null and i.removed_at is null
                    and (p_finish is null or i.finish = p_finish))
$$;
revoke execute on function private.owns_card(uuid, uuid, public.finish) from public, anon, authenticated;

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
      select count(*) filter (where private.owns_card(p_owner, rc.id, f.finish)),
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
      'description', case when a.category = 'custom' and u.code is null then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'series', a.series, 'series_label', a.series_label, 'tier', a.tier,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'owned_rule', a.metric in ('set_clan', 'set_rarity', 'set_all', 'characters'),
      'progress', case when u.code is not null then coalesce(st.target, a.target) when a.metric = 'manual' then 0
                       else least(st.progress, st.target) end,
      'target', case when a.metric = 'manual' then 1 else coalesce(st.target, a.target) end,
      'unlocked_at', u.unlocked_at, 'reason', u.reason)
      -- Set presque complet : les cartes qui manquent (nom si découverte, sinon seulement le numéro).
      || case when u.code is null and a.metric in ('set_clan', 'set_rarity', 'set_all')
                   and st.target - st.progress between 1 and 5 then jsonb_build_object('missing', (
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
