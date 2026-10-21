-- CARTEMA — compte vérifié par Discord (demande du 21/10/2026).
-- Un compte lié à Discord est considéré comme vérifié : le délai de 24 h avant le marché, les
-- cadeaux et les échanges ne s'applique pas. Une identité Discord ne peut être liée qu'à un seul
-- compte (règle de Supabase), ce qui limite les comptes multiples. Badge « Vérifié » sur le profil.

create function private.is_verified(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'discord')
$$;

create or replace function private.require_trader() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.transactions_blocked_at is not null then
    raise exception 'transactions_blocked';
  end if;
  if v_profile.created_at > now() - interval '24 hours' and not private.is_verified(v_uid) then
    raise exception 'account_too_new' using hint = format('Disponible le %s',
      to_char((v_profile.created_at + interval '24 hours') at time zone 'Europe/Paris', 'DD/MM à HH24:MI'));
  end if;
  return v_uid;
end $$;

create or replace function public.get_trade_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
  v_verified boolean := private.is_verified(v_uid);
begin
  select * into v_profile from public.profiles where id = v_uid;
  return jsonb_build_object(
    'allowed', v_profile.transactions_blocked_at is null and (v_verified or v_profile.created_at <= now() - interval '24 hours'),
    'verified', v_verified,
    'blocked', v_profile.transactions_blocked_at is not null,
    'available_at', case when not v_verified and v_profile.created_at > now() - interval '24 hours' then v_profile.created_at + interval '24 hours' end,
    'commission_pct', coalesce(((private.active_settings()).settings->>'market_commission_pct')::numeric, 5));
end $$;

create or replace function private.mission_eligible(p_owner uuid, p_requires text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_requires
    when 'trader' then exists (select 1 from public.profiles where id = p_owner and transactions_blocked_at is null
                                and (created_at <= now() - interval '24 hours' or private.is_verified(p_owner)))
    when 'friends' then exists (select 1 from public.profiles where id = p_owner and transactions_blocked_at is null
                                 and (created_at <= now() - interval '24 hours' or private.is_verified(p_owner)))
                        and private.metric_value(p_owner, 'friends') > 0
    else true end
$$;

-- Profil public : badge « Vérifié » (Discord lié).
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
    'relation', v_relation, 'visible', v_visible, 'verified', private.is_verified(v_p.id),
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
    'featured', coalesce((
        select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description, 'title', a.title,
                 'tier', a.tier, 'series_label', a.series_label, 'rarity', a.rarity, 'category', a.category,
                 'unlocked_at', u.unlocked_at) order by s.pos)
          from unnest(v_p.featured_achievements) with ordinality s(code, pos)
          join public.achievements a on a.code = s.code
          join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_p.id), '[]'::jsonb),
    'recent', case when v_visible and (v_self or v_p.show_stats) then coalesce((
        select jsonb_agg(jsonb_build_object('label', r.label, 'unlocked_at', r.unlocked_at, 'tier', r.tier) order by r.unlocked_at desc)
          from (select a.label, a.tier, u.unlocked_at from public.achievement_unlocks u join public.achievements a on a.code = u.code
                 where u.owner_id = v_p.id and not a.secret order by u.unlocked_at desc limit 4) r), '[]'::jsonb) end);
end $$;

revoke execute on function private.is_verified(uuid) from public, anon, authenticated;
