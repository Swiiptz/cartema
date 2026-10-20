-- CARTEMA — marché à prix fixe (CDC §6).
-- Prix libre, achat immédiat, commission 5 % (floor) prélevée sur le revenu du vendeur et détruite.
-- Transactions entre joueurs interdites pendant les 24 premières heures du compte (CDC §2, §6).
-- L'exemplaire mis en vente est réservé : il ne peut être ni recyclé, ni offert, ni revendu ailleurs.

create function private.require_trader() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.transactions_blocked_at is not null then
    raise exception 'transactions_blocked';
  end if;
  if v_profile.created_at > now() - interval '24 hours' then
    raise exception 'account_too_new' using hint = format('Disponible le %s',
      to_char((v_profile.created_at + interval '24 hours') at time zone 'Europe/Paris', 'DD/MM à HH24:MI'));
  end if;
  return v_uid;
end $$;

-- Découverte (et récompense unique) lors de toute acquisition hors booster.
create function private.record_acquisition(p_owner uuid, p_character uuid, p_finish public.finish) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_reward bigint := coalesce(((private.active_settings()).settings->>'discovery_reward')::bigint, 0);
  v_new boolean;
begin
  insert into public.discoveries (owner_id, character_id) values (p_owner, p_character) on conflict do nothing;
  v_new := found;
  insert into public.finish_discoveries (owner_id, character_id, finish) values (p_owner, p_character, p_finish)
    on conflict do nothing;
  if v_new and v_reward > 0 then
    perform private.apply_wallet_delta(p_owner, v_reward, 'discovery_reward', 'character', p_character,
                                       'discovery:' || p_character);
  end if;
  return v_new;
end $$;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  instance_id uuid not null references public.inventory_items(id),
  character_id uuid not null references public.characters(id),
  finish public.finish not null,
  price bigint not null check (price between 1 and 10000000),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id uuid references public.profiles(id) on delete set null,
  commission bigint check (commission >= 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (seller_id, request_id)
);
create unique index listings_active_instance on public.listings (instance_id) where status = 'active';
create index listings_active_ix on public.listings (created_at desc) where status = 'active';
create index listings_seller_ix on public.listings (seller_id, created_at desc);

alter table public.listings enable row level security;
grant select on public.listings to authenticated;
create policy read_listings on public.listings for select to authenticated
  using (status = 'active' or seller_id = auth.uid() or buyer_id = auth.uid());

create function private.commission(p_price bigint) returns bigint
language sql stable set search_path = '' as $$
  select floor(p_price * coalesce(((private.active_settings()).settings->>'market_commission_pct')::numeric, 5) / 100)::bigint
$$;

create function public.create_listing(p_instance_id uuid, p_price bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_item public.inventory_items;
  v_listing public.listings;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_listing from public.listings where seller_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('listing_id', v_listing.id, 'price', v_listing.price,
      'net', v_listing.price - private.commission(v_listing.price), 'replayed', true);
  end if;
  if p_price is null or p_price < 1 or p_price > 10000000 then raise exception 'invalid_price'; end if;

  select * into v_item from public.inventory_items where id = p_instance_id for update;
  if not found or v_item.owner_id <> v_uid or v_item.recycled_at is not null then raise exception 'not_owned'; end if;
  if v_item.locked then raise exception 'card_locked'; end if;
  if v_item.reserved_kind is not null then raise exception 'card_reserved'; end if;

  insert into public.listings (seller_id, instance_id, character_id, finish, price, request_id)
    values (v_uid, v_item.id, v_item.character_id, v_item.finish, p_price, p_request_id)
    returning * into v_listing;
  update public.inventory_items set reserved_kind = 'listing', reserved_ref = v_listing.id where id = v_item.id;
  return jsonb_build_object('listing_id', v_listing.id, 'price', p_price,
    'net', p_price - private.commission(p_price), 'replayed', false);
end $$;

create function public.cancel_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.seller_id <> v_uid then raise exception 'not_found'; end if;
  if v_listing.status <> 'active' then raise exception 'listing_unavailable'; end if;
  update public.listings set status = 'cancelled', closed_at = now() where id = p_listing_id;
  update public.inventory_items set reserved_kind = null, reserved_ref = null
   where id = v_listing.instance_id and reserved_ref = p_listing_id;
end $$;

-- Achat immédiat : le verrou de l'annonce garantit un seul acheteur ; tout ou rien.
create function public.buy_listing(p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_listing public.listings;
  v_commission bigint;
  v_balance bigint;
  v_new boolean;
begin
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found then raise exception 'listing_unavailable'; end if;
  if v_listing.status = 'sold' and v_listing.buyer_id = v_uid then
    return jsonb_build_object('listing_id', v_listing.id, 'instance_id', v_listing.instance_id, 'price', v_listing.price,
      'balance', (select balance from public.wallets where owner_id = v_uid), 'replayed', true);
  end if;
  if v_listing.status <> 'active' then raise exception 'listing_unavailable'; end if;
  if v_listing.seller_id = v_uid then raise exception 'own_listing'; end if;

  v_commission := private.commission(v_listing.price);
  v_balance := private.apply_wallet_delta(v_uid, -v_listing.price, 'market_purchase', 'listing', v_listing.id,
                                          'buy:' || v_listing.id);
  if v_listing.price - v_commission > 0 then
    perform private.apply_wallet_delta(v_listing.seller_id, v_listing.price - v_commission, 'market_sale', 'listing',
                                       v_listing.id, 'sale:' || v_listing.id);
  end if;
  update public.inventory_items
     set owner_id = v_uid, reserved_kind = null, reserved_ref = null, locked = false, acquired_at = now()
   where id = v_listing.instance_id;
  update public.listings set status = 'sold', buyer_id = v_uid, commission = v_commission, closed_at = now()
   where id = v_listing.id;
  v_new := private.record_acquisition(v_uid, v_listing.character_id, v_listing.finish);
  return jsonb_build_object('listing_id', v_listing.id, 'instance_id', v_listing.instance_id, 'price', v_listing.price,
    'balance', (select balance from public.wallets where owner_id = v_uid), 'discovered', v_new, 'replayed', false);
end $$;

create function private.listing_json(p_listing public.listings, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'listing_id', p_listing.id, 'price', p_listing.price, 'status', p_listing.status,
    'net', p_listing.price - private.commission(p_listing.price),
    'created_at', p_listing.created_at, 'closed_at', p_listing.closed_at,
    'mine', p_listing.seller_id = p_viewer,
    'seller', (select handle from public.profiles where id = p_listing.seller_id),
    'buyer', (select handle from public.profiles where id = p_listing.buyer_id),
    'finish', p_listing.finish,
    'discovered', exists (select 1 from public.discoveries d where d.owner_id = p_viewer and d.character_id = c.id),
    'card', jsonb_build_object('character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
      'number', c.number, 'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity,
      'unique', c.is_unique, 'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key))
  from public.characters c
  join public.editions e on e.id = c.edition_id
  left join public.clans cl on cl.id = c.clan_id
  where c.id = p_listing.character_id
$$;

-- Annonces actives (une annonce montre la carte en clair : le vendeur choisit de la présenter).
create function public.get_market(p_rarity public.rarity default null, p_finish public.finish default null,
                                  p_query text default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_query text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select l.* from public.listings l join public.characters c on c.id = l.character_id
           where l.status = 'active'
             and (p_rarity is null or c.rarity = p_rarity)
             and (p_finish is null or l.finish = p_finish)
             and (v_query is null or lower(c.name) like '%' || v_query || '%')
           order by l.created_at desc
           limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) l), '[]'::jsonb);
end $$;

create function public.get_my_listings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select * from public.listings where seller_id = v_uid or buyer_id = v_uid
           order by created_at desc limit 100) l), '[]'::jsonb);
end $$;

-- Possibilité de transaction du joueur courant (pour l'interface).
create function public.get_trade_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_uid;
  return jsonb_build_object(
    'allowed', v_profile.transactions_blocked_at is null and v_profile.created_at <= now() - interval '24 hours',
    'blocked', v_profile.transactions_blocked_at is not null,
    'available_at', case when v_profile.created_at > now() - interval '24 hours' then v_profile.created_at + interval '24 hours' end,
    'commission_pct', coalesce(((private.active_settings()).settings->>'market_commission_pct')::numeric, 5));
end $$;

-- Détail des exemplaires : indique l'annonce en cours pour pouvoir la retirer.
create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind = 'listing' then i.reserved_ref end,
      'listing_price', (select l.price from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

revoke execute on all functions in schema public, private from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function
  public.set_handle(text), public.get_player_state(), public.buy_boosters(integer, uuid),
  public.open_booster(uuid, uuid, text), public.get_opening(uuid), public.get_album(uuid),
  public.recycle_cards(uuid[], uuid, boolean), public.recycle_duplicates(uuid, integer),
  public.preview_duplicates(integer), public.set_cards_locked(uuid[], boolean), public.get_inventory(uuid),
  public.create_listing(uuid, bigint, uuid), public.cancel_listing(uuid), public.buy_listing(uuid),
  public.get_market(public.rarity, public.finish, text, integer, integer), public.get_my_listings(),
  public.get_trade_status(),
  public.admin_catalog(), public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text), public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text),
  public.admin_publish_drafts(uuid, text), public.admin_set_unique(uuid, boolean, text)
to authenticated;
