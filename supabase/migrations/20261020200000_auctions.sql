-- CARTEMA — enchères (CDC §6).
-- Durées 12/24/48/72 h ; surenchère minimale +10 sous 500, +25 de 500 à moins de 2 000, +50 au-delà.
-- Les Deniers du meilleur enchérisseur sont débités (séquestre) ; le précédent est remboursé
-- atomiquement. Une mise dans les 2 dernières minutes repousse la fin à 2 minutes après elle.
-- Clôture idempotente : par pg_cron chaque minute (Supabase) et à chaque consultation du marché.

alter table public.listings
  add column kind text not null default 'fixed' check (kind in ('fixed', 'auction')),
  add column ends_at timestamptz,
  add column current_bid bigint check (current_bid > 0),
  add column current_bidder uuid references public.profiles(id) on delete set null,
  add column bid_count integer not null default 0,
  add constraint listings_auction_end check ((kind = 'auction') = (ends_at is not null));
alter table public.listings drop constraint listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('active', 'sold', 'cancelled', 'expired'));
create index listings_auction_end_ix on public.listings (ends_at) where status = 'active' and kind = 'auction';

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  bidder_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  request_id uuid not null,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bidder_id, request_id)
);
create index bids_listing_ix on public.bids (listing_id, created_at desc);
alter table public.bids enable row level security;
grant select on public.bids to authenticated;
create policy own_bids on public.bids for select to authenticated using (bidder_id = auth.uid());

create function private.bid_increment(p_current bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_current < 500 then 10 when p_current < 2000 then 25 else 50 end::bigint
$$;

create function private.min_next_bid(p_listing public.listings) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_listing.current_bid is null then p_listing.price
              else p_listing.current_bid + private.bid_increment(p_listing.current_bid) end
$$;

create function public.create_auction(p_instance_id uuid, p_start_price bigint, p_hours integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_item public.inventory_items;
  v_listing public.listings;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_listing from public.listings where seller_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('listing_id', v_listing.id, 'ends_at', v_listing.ends_at, 'replayed', true);
  end if;
  if p_hours not in (12, 24, 48, 72) then raise exception 'invalid_duration'; end if;
  if p_start_price is null or p_start_price < 1 or p_start_price > 10000000 then raise exception 'invalid_price'; end if;

  select * into v_item from public.inventory_items where id = p_instance_id for update;
  if not found or v_item.owner_id <> v_uid or v_item.recycled_at is not null then raise exception 'not_owned'; end if;
  if v_item.locked then raise exception 'card_locked'; end if;
  if v_item.reserved_kind is not null then raise exception 'card_reserved'; end if;

  insert into public.listings (seller_id, instance_id, character_id, finish, price, request_id, kind, ends_at)
    values (v_uid, v_item.id, v_item.character_id, v_item.finish, p_start_price, p_request_id, 'auction',
            now() + make_interval(hours => p_hours))
    returning * into v_listing;
  update public.inventory_items set reserved_kind = 'auction', reserved_ref = v_listing.id where id = v_item.id;
  return jsonb_build_object('listing_id', v_listing.id, 'ends_at', v_listing.ends_at, 'replayed', false);
end $$;

create function public.place_bid(p_listing_id uuid, p_amount bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_listing public.listings;
  v_bid public.bids;
  v_prev public.bids;
  v_balance bigint;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_bid from public.bids where bidder_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('bid_id', v_bid.id, 'amount', v_bid.amount, 'replayed', true,
      'balance', (select balance from public.wallets where owner_id = v_uid));
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.kind <> 'auction' or v_listing.status <> 'active' or v_listing.ends_at <= now() then
    raise exception 'auction_closed';
  end if;
  if v_listing.seller_id = v_uid then raise exception 'own_listing'; end if;
  if v_listing.current_bidder = v_uid then raise exception 'already_leading'; end if;
  if p_amount is null or p_amount < private.min_next_bid(v_listing) then
    raise exception 'bid_too_low' using hint = format('Mise minimale : %s', private.min_next_bid(v_listing));
  end if;

  insert into public.bids (listing_id, bidder_id, amount, request_id)
    values (v_listing.id, v_uid, p_amount, p_request_id) returning * into v_bid;
  -- Séquestre : la mise est débitée maintenant, l'enchérisseur dépassé est remboursé.
  v_balance := private.apply_wallet_delta(v_uid, -p_amount, 'bid_hold', 'bid', v_bid.id, 'bid:' || v_bid.id);
  if v_listing.current_bidder is not null then
    select * into v_prev from public.bids
     where listing_id = v_listing.id and bidder_id = v_listing.current_bidder and not refunded
     order by created_at desc limit 1;
    if found then
      perform private.apply_wallet_delta(v_prev.bidder_id, v_prev.amount, 'bid_refund', 'bid', v_prev.id, 'refund:' || v_prev.id);
      update public.bids set refunded = true where id = v_prev.id;
    end if;
  end if;
  update public.listings
     set current_bid = p_amount, current_bidder = v_uid, bid_count = bid_count + 1,
         ends_at = greatest(ends_at, now() + interval '2 minutes')
   where id = v_listing.id
   returning * into v_listing;
  return jsonb_build_object('bid_id', v_bid.id, 'amount', p_amount, 'ends_at', v_listing.ends_at,
    'balance', v_balance, 'replayed', false);
end $$;

-- Clôture d'une enchère échue : idempotente (ne traite que les annonces encore actives).
create function private.settle_auction(p_listing_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
  v_commission bigint;
begin
  select * into v_listing from public.listings where id = p_listing_id for update skip locked;
  if not found or v_listing.kind <> 'auction' or v_listing.status <> 'active' or v_listing.ends_at > now() then
    return 'skipped';
  end if;
  if v_listing.current_bidder is null then
    update public.listings set status = 'expired', closed_at = now() where id = v_listing.id;
    update public.inventory_items set reserved_kind = null, reserved_ref = null
     where id = v_listing.instance_id and reserved_ref = v_listing.id;
    return 'expired';
  end if;
  v_commission := private.commission(v_listing.current_bid);
  if v_listing.current_bid - v_commission > 0 then
    perform private.apply_wallet_delta(v_listing.seller_id, v_listing.current_bid - v_commission, 'auction_sale',
                                       'listing', v_listing.id, 'sale:' || v_listing.id);
  end if;
  update public.inventory_items
     set owner_id = v_listing.current_bidder, reserved_kind = null, reserved_ref = null, locked = false, acquired_at = now()
   where id = v_listing.instance_id;
  update public.listings set status = 'sold', buyer_id = v_listing.current_bidder, commission = v_commission, closed_at = now()
   where id = v_listing.id;
  -- La mise gagnante, déjà débitée, reste acquise (séquestre consommé).
  perform private.record_acquisition(v_listing.current_bidder, v_listing.character_id, v_listing.finish);
  return 'sold';
end $$;

create function private.close_expired_auctions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in select id from public.listings
               where status = 'active' and kind = 'auction' and ends_at <= now()
               order by ends_at limit 200 loop
    if private.settle_auction(v_id) <> 'skipped' then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- Achat immédiat réservé aux annonces à prix fixe.
create function private.assert_fixed(p_listing_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.listings where id = p_listing_id and kind = 'auction') then
    raise exception 'not_fixed_price';
  end if;
end $$;

create function public.get_my_bids() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.close_expired_auctions();
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.ends_at)
    from (select distinct l.* from public.listings l join public.bids b on b.listing_id = l.id
           where b.bidder_id = v_uid and l.kind = 'auction'
             and (l.status = 'active' or l.closed_at > now() - interval '7 days')
           ) l), '[]'::jsonb);
end $$;

create or replace function private.listing_json(p_listing public.listings, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'listing_id', p_listing.id, 'price', p_listing.price, 'status', p_listing.status,
    'net', p_listing.price - private.commission(p_listing.price),
    'created_at', p_listing.created_at, 'closed_at', p_listing.closed_at,
    'mine', p_listing.seller_id = p_viewer,
    'seller', (select handle from public.profiles where id = p_listing.seller_id),
    'buyer', (select handle from public.profiles where id = p_listing.buyer_id),
    'finish', p_listing.finish, 'kind', p_listing.kind, 'ends_at', p_listing.ends_at,
    'current_bid', p_listing.current_bid, 'bid_count', p_listing.bid_count,
    'min_next_bid', private.min_next_bid(p_listing), 'leading', p_listing.current_bidder = p_viewer,
    'won', p_listing.status = 'sold' and p_listing.buyer_id = p_viewer,
    'discovered', exists (select 1 from public.discoveries d where d.owner_id = p_viewer and d.character_id = c.id),
    'card', jsonb_build_object('character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
      'number', c.number, 'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity,
      'unique', c.is_unique, 'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key))
  from public.characters c
  join public.editions e on e.id = c.edition_id
  left join public.clans cl on cl.id = c.clan_id
  where c.id = p_listing.character_id
$$;

create or replace function public.buy_listing(p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_listing public.listings;
  v_commission bigint;
  v_balance bigint;
  v_new boolean;
begin
  perform private.assert_fixed(p_listing_id);
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

create or replace function public.cancel_listing(p_listing_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = p_listing_id for update;
  if not found or v_listing.seller_id <> v_uid then raise exception 'not_found'; end if;
  if v_listing.status <> 'active' then raise exception 'listing_unavailable'; end if;
  -- Une enchère qui a reçu une mise ne peut plus être annulée (les enchérisseurs sont engagés).
  if v_listing.kind = 'auction' and v_listing.current_bidder is not null then raise exception 'auction_has_bids'; end if;
  update public.listings set status = 'cancelled', closed_at = now() where id = p_listing_id;
  update public.inventory_items set reserved_kind = null, reserved_ref = null
   where id = v_listing.instance_id and reserved_ref = p_listing_id;
end $$;

create or replace function public.get_market(p_rarity public.rarity default null, p_finish public.finish default null,
                                  p_query text default null, p_limit integer default 60, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_query text := nullif(lower(trim(coalesce(p_query, ''))), '');
begin
  -- Clôture paresseuse : un marché consulté n'affiche jamais d'enchère échue.
  perform private.close_expired_auctions();
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select l.* from public.listings l join public.characters c on c.id = l.character_id
           where l.status = 'active'
             and (p_rarity is null or c.rarity = p_rarity)
             and (p_finish is null or l.finish = p_finish)
             and (v_query is null or lower(c.name) like '%' || v_query || '%')
           order by l.created_at desc
           limit least(greatest(coalesce(p_limit, 60), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) l), '[]'::jsonb);
end $$;

create or replace function public.get_my_listings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.close_expired_auctions();
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select * from public.listings where seller_id = v_uid or buyer_id = v_uid
           order by created_at desc limit 100) l), '[]'::jsonb);
end $$;

create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind in ('listing', 'auction') then i.reserved_ref end,
      'listing_price', (select coalesce(l.current_bid, l.price) from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'listing_kind', (select l.kind from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

-- Clôture planifiée chaque minute quand pg_cron est disponible (Supabase) ; ignoré ailleurs.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cartema-close-auctions', '* * * * *', 'select private.close_expired_auctions()');
  end if;
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
  public.get_trade_status(), public.create_auction(uuid, bigint, integer, uuid),
  public.place_bid(uuid, bigint, uuid), public.get_my_bids(),
  public.admin_catalog(), public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text), public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text),
  public.admin_publish_drafts(uuid, text), public.admin_set_unique(uuid, boolean, text)
to authenticated;
