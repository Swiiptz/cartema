-- CARTEMA — liste de souhaits (CDC §7 : publique, recherche par finition, alertes de mise en vente,
-- recherche chez les amis dans le respect de leur confidentialité).
--  * Un souhait vise une carte par son numéro (« CAM-097 »), avec ou sans finition précise : on peut
--    souhaiter une carte jamais vue sans rien apprendre de plus que l'album (numéro, rareté).
--    La carte unique n'est jamais souhaitable (elle reste secrète). 60 souhaits au plus.
--  * Liste visible sur le profil, selon la visibilité choisie par son propriétaire. Une carte que le
--    visiteur n'a pas découverte y reste voilée.
--  * Pour son propre compte : annonces en cours (et meilleur prix) et amis qui possèdent un
--    exemplaire disponible (amis au profil non privé).
--  * Alerte « carte souhaitée en vente » à chaque nouvelle annonce (catégorie Marché).

create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  finish public.finish,
  created_at timestamptz not null default now()
);
create unique index wishlists_unique on public.wishlists (owner_id, character_id, finish) nulls not distinct;
create index wishlists_character_ix on public.wishlists (character_id);
alter table public.wishlists enable row level security;
grant select on public.wishlists to authenticated;
create policy own_wishlists on public.wishlists for select to authenticated using (owner_id = (select auth.uid()));

-- Personnage désigné par son numéro d'édition (« CAM-097 »), publié et non unique.
create function private.character_by_code(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.characters c join public.editions e on e.id = c.edition_id
   where upper(e.prefix) = upper(split_part(trim(p_code), '-', 1))
     and c.number = nullif(regexp_replace(split_part(trim(p_code), '-', 2), '\D', '', 'g'), '')::int
     and c.status = 'published' and not c.is_unique and e.archived_at is null
$$;

create function public.set_wish(p_code text, p_finish public.finish default null, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_character uuid := private.character_by_code(p_code);
begin
  if v_character is null then raise exception 'not_found'; end if;
  if not coalesce(p_on, true) then
    delete from public.wishlists where owner_id = v_uid and character_id = v_character and finish is not distinct from p_finish;
    return false;
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.wishlists where owner_id = v_uid) >= 60 then raise exception 'wishlist_full'; end if;
  insert into public.wishlists (owner_id, character_id, finish) values (v_uid, v_character, p_finish) on conflict do nothing;
  return true;
end $$;

-- Liste de souhaits d'un joueur (soi-même si p_handle est vide).
create function public.get_wishlist(p_handle text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_target public.profiles;
  v_self boolean;
begin
  if coalesce(trim(p_handle), '') = '' then
    select * into v_target from public.profiles where id = v_uid;
  else
    select * into v_target from public.profiles where lower(handle) = lower(trim(p_handle)) and suspended_at is null;
    if not found then raise exception 'player_not_found'; end if;
  end if;
  v_self := v_target.id = v_uid;
  if not v_self and not (v_target.visibility = 'public'
                         or (v_target.visibility = 'friends' and private.are_friends(v_uid, v_target.id))) then
    return jsonb_build_object('visible', false, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object('visible', true, 'items', coalesce((select jsonb_agg(item order by x.created_at desc) from (
    select w.created_at,
      jsonb_build_object('code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number, 'rarity', c.rarity,
        'finish', w.finish, 'silhouette_key', c.silhouette_key, 'known', d.character_id is not null)
      || case when d.character_id is not null then jsonb_build_object('character_id', c.id, 'name', c.name,
           'role_title', c.role_title, 'clan', cl.name, 'art_path', c.art_path, 'art_meta', c.art_meta) else '{}'::jsonb end
      || case when v_self then jsonb_build_object(
           'owned', (select count(*) from public.inventory_items i where i.owner_id = v_uid and i.character_id = c.id
                       and i.recycled_at is null and (w.finish is null or i.finish = w.finish)),
           'on_market', (select count(*) from public.listings l where l.character_id = c.id and l.status = 'active'
                           and l.seller_id <> v_uid and (w.finish is null or l.finish = w.finish)),
           'best_price', (select min(case when l.kind = 'auction' then coalesce(l.current_bid, l.price) else l.price end)
                            from public.listings l where l.character_id = c.id and l.status = 'active' and l.kind = 'fixed'
                             and l.seller_id <> v_uid and (w.finish is null or l.finish = w.finish)),
           'friends', coalesce((select jsonb_agg(distinct p.handle) from public.inventory_items i
                                  join public.profiles p on p.id = i.owner_id
                                 where i.character_id = c.id and i.recycled_at is null and not i.locked and i.reserved_kind is null
                                   and (w.finish is null or i.finish = w.finish) and p.visibility <> 'private'
                                   and private.are_friends(v_uid, p.id)), '[]'::jsonb))
         else '{}'::jsonb end as item
      from public.wishlists w
      join public.characters c on c.id = w.character_id
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.discoveries d on d.character_id = c.id and d.owner_id = v_uid
     where w.owner_id = v_target.id and c.status = 'published' and e.archived_at is null) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- alertes de mise en vente
create or replace function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('friend_request', 'friend_accepted') then 'friends'
    when p_kind in ('gift_received', 'gift_answered', 'trade_received', 'trade_answered') then 'social'
    when p_kind in ('listing_sold', 'outbid', 'auction_won', 'auction_unsold', 'wish_listed') then 'market'
    else 'achievements' end
$$;

create function private.on_listing_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_wish record;
begin
  if new.status <> 'active' then return null; end if;
  for v_wish in select distinct w.owner_id, d.character_id is not null as known
                  from public.wishlists w
                  left join public.discoveries d on d.owner_id = w.owner_id and d.character_id = w.character_id
                 where w.character_id = new.character_id and w.owner_id <> new.seller_id
                   and (w.finish is null or w.finish = new.finish) loop
    -- Une carte jamais découverte reste voilée dans l'alerte : seul son numéro est donné.
    perform private.notify(v_wish.owner_id, 'wish_listed', jsonb_build_object(
      'card', case when v_wish.known then (select name from public.characters where id = new.character_id)
                   else (select e.prefix || '-' || lpad(c.number::text, 3, '0') from public.characters c
                           join public.editions e on e.id = c.edition_id where c.id = new.character_id) end,
      'finish', new.finish, 'price', new.price, 'auction', new.kind = 'auction'));
  end loop;
  return null;
end $$;
create trigger notify_wish_listed after insert on public.listings for each row execute function private.on_listing_created();

revoke execute on function private.character_by_code(text), private.on_listing_created() from public, anon, authenticated;
revoke execute on function public.set_wish(text, public.finish, boolean), public.get_wishlist(text) from public, anon;
grant execute on function public.set_wish(text, public.finish, boolean), public.get_wishlist(text) to authenticated;
