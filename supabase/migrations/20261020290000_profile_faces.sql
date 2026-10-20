-- CARTEMA — profil public : visages découverts comptés sur les éditions actives (hors carte unique),
-- comme le total affiché à côté (l'édition d'essai archivée n'est plus comptée).

create or replace function public.get_profile(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_p public.profiles;
  v_self boolean;
  v_relation text;
  v_visible boolean;
  v_achievements bigint;
  v_faces bigint;
begin
  select * into v_p from public.profiles where lower(handle) = lower(trim(p_handle)) and suspended_at is null;
  if not found then raise exception 'player_not_found'; end if;
  v_self := v_p.id = v_uid;
  select case when v_self then 'self'
              when f.status = 'accepted' then 'friends'
              when f.status = 'pending' and f.requester_id = v_uid then 'pending_out'
              when f.status = 'pending' then 'pending_in'
              else 'none' end
    into v_relation
    from (select 1) one
    left join public.friendships f
      on least(f.requester_id, f.addressee_id) = least(v_uid, v_p.id)
     and greatest(f.requester_id, f.addressee_id) = greatest(v_uid, v_p.id)
     and f.status in ('accepted', 'pending');
  v_visible := v_self or v_p.visibility = 'public' or (v_p.visibility = 'friends' and v_relation = 'friends');
  v_achievements := (select count(*) from public.achievement_unlocks where owner_id = v_p.id);
  v_faces := (select count(*) from public.discoveries where owner_id = v_p.id);
  return jsonb_build_object(
    'profile_id', v_p.id, 'handle', v_p.handle, 'title', v_p.title, 'created_at', v_p.created_at,
    'relation', v_relation, 'visible', v_visible,
    'settings', case when v_self then jsonb_build_object('visibility', v_p.visibility, 'show_stats', v_p.show_stats) end,
    'showcase', case when v_visible then coalesce((
        select jsonb_agg(private.card_json(i.character_id, i.finish, i.id) order by s.pos)
          from unnest(v_p.showcase) with ordinality s(item_id, pos)
          join public.inventory_items i on i.id = s.item_id and i.owner_id = v_p.id and i.recycled_at is null), '[]'::jsonb) end,
    'stats', case when v_visible and (v_self or v_p.show_stats) then jsonb_build_object(
        'faces', (select count(*) from public.discoveries d join public.characters c on c.id = d.character_id
                   join public.editions e on e.id = c.edition_id
                  where d.owner_id = v_p.id and c.status = 'published' and not c.is_unique
                    and e.album_published and e.archived_at is null),
        'total_characters', (select count(*) from public.characters c join public.editions e on e.id = c.edition_id
                              where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null),
        'achievements', v_achievements,
        'gold', (select count(*) from public.finish_discoveries where owner_id = v_p.id and finish = 'Dorée'),
        'blood', (select count(*) from public.finish_discoveries where owner_id = v_p.id and finish = 'Sanglante'),
        'position', 1 + (select count(*) from public.profiles o
                          where o.handle is not null and o.suspended_at is null and o.id <> v_p.id
                            and ((select count(*) from public.achievement_unlocks u where u.owner_id = o.id),
                                 (select count(*) from public.discoveries d where d.owner_id = o.id))
                                > (v_achievements, v_faces))) end,
    'recent', case when v_visible and (v_self or v_p.show_stats) then coalesce((
        select jsonb_agg(jsonb_build_object('label', r.label, 'unlocked_at', r.unlocked_at, 'tier', r.tier) order by r.unlocked_at desc)
          from (select a.label, a.tier, u.unlocked_at from public.achievement_unlocks u join public.achievements a on a.code = u.code
                 where u.owner_id = v_p.id and not a.secret order by u.unlocked_at desc limit 4) r), '[]'::jsonb) end);
end $$;
