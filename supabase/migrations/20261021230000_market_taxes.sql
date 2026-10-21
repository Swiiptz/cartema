-- CARTEMA — taxes du marché (décision du 21/10/2026), en plus de la commission vendeur de 5 % :
--  * taxe acheteur (buyer_tax_pct, 5 %) : l'acheteur paie prix + taxe, à prix fixe comme aux enchères ;
--    pour une enchère, la taxe est mise de côté avec la mise (pas de surprise à la clôture) ;
--  * taxe sur le remboursement d'une mise dépassée (bid_refund_tax_pct, 5 % de la mise) : la mise de
--    côté est rendue moins cette taxe.
-- Arrondi à l'unité inférieure, comme la commission. Les taxes sont détruites (sortie de Deniers).
-- Les mises déjà placées avant cette version gardent les anciennes règles (taxed = false).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"buyer_tax_pct": 5, "bid_refund_tax_pct": 5}'::jsonb
    from public.economy_settings;

alter table public.bids add column hold bigint, add column buyer_tax bigint not null default 0,
  add column refund_tax bigint not null default 0, add column taxed boolean not null default false;
update public.bids set hold = amount where hold is null;
alter table public.bids alter column hold set not null;
alter table public.listings add column buyer_tax bigint not null default 0 check (buyer_tax >= 0);

create function private.market_tax(p_amount bigint, p_key text) returns bigint
language sql stable security definer set search_path = '' as $$
  select floor(p_amount * coalesce(((private.active_settings()).settings->>p_key)::numeric, 0) / 100)::bigint
$$;

create or replace function public.place_bid(p_listing_id uuid, p_amount bigint, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_listing public.listings;
  v_bid public.bids;
  v_prev public.bids;
  v_balance bigint;
  v_tax bigint;
  v_refund bigint;
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

  -- Séquestre : la mise et la taxe acheteur sont mises de côté maintenant.
  v_tax := private.market_tax(p_amount, 'buyer_tax_pct');
  insert into public.bids (listing_id, bidder_id, amount, request_id, hold, buyer_tax, taxed)
    values (v_listing.id, v_uid, p_amount, p_request_id, p_amount + v_tax, v_tax, true) returning * into v_bid;
  v_balance := private.apply_wallet_delta(v_uid, -(p_amount + v_tax), 'bid_hold', 'bid', v_bid.id, 'bid:' || v_bid.id);
  if v_listing.current_bidder is not null then
    select * into v_prev from public.bids
     where listing_id = v_listing.id and bidder_id = v_listing.current_bidder and not refunded
     order by created_at desc limit 1;
    if found then
      -- Mise dépassée : rendue moins la taxe de remboursement (anciennes mises : rendues en entier).
      v_refund := case when v_prev.taxed then private.market_tax(v_prev.amount, 'bid_refund_tax_pct') else 0 end;
      if v_prev.hold - v_refund > 0 then
        perform private.apply_wallet_delta(v_prev.bidder_id, v_prev.hold - v_refund, 'bid_refund', 'bid', v_prev.id, 'refund:' || v_prev.id);
      end if;
      update public.bids set refunded = true, refund_tax = v_refund where id = v_prev.id;
    end if;
  end if;
  update public.listings
     set current_bid = p_amount, current_bidder = v_uid, bid_count = bid_count + 1,
         ends_at = greatest(ends_at, now() + interval '2 minutes')
   where id = v_listing.id
   returning * into v_listing;
  return jsonb_build_object('bid_id', v_bid.id, 'amount', p_amount, 'buyer_tax', v_tax, 'ends_at', v_listing.ends_at,
    'balance', v_balance, 'replayed', false);
end $$;

create or replace function private.settle_auction(p_listing_id uuid) returns text
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
  update public.listings set status = 'sold', buyer_id = v_listing.current_bidder, commission = v_commission, closed_at = now(),
         buyer_tax = coalesce((select b.buyer_tax from public.bids b where b.listing_id = v_listing.id and b.bidder_id = v_listing.current_bidder
                                and not b.refunded order by b.created_at desc limit 1), 0)
   where id = v_listing.id;
  -- La mise gagnante, déjà débitée, reste acquise (séquestre consommé).
  perform private.record_acquisition(v_listing.current_bidder, v_listing.character_id, v_listing.finish);
  return 'sold';
end $$;

create or replace function public.buy_listing(p_listing_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_listing public.listings;
  v_commission bigint;
  v_balance bigint;
  v_new boolean;
  v_tax bigint;
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
  -- L'acheteur paie le prix et la taxe acheteur.
  v_tax := private.market_tax(v_listing.price, 'buyer_tax_pct');
  v_balance := private.apply_wallet_delta(v_uid, -(v_listing.price + v_tax), 'market_purchase', 'listing', v_listing.id,
                                          'buy:' || v_listing.id);
  if v_listing.price - v_commission > 0 then
    perform private.apply_wallet_delta(v_listing.seller_id, v_listing.price - v_commission, 'market_sale', 'listing',
                                       v_listing.id, 'sale:' || v_listing.id);
  end if;
  update public.inventory_items
     set owner_id = v_uid, reserved_kind = null, reserved_ref = null, locked = false, acquired_at = now()
   where id = v_listing.instance_id;
  update public.listings set status = 'sold', buyer_id = v_uid, commission = v_commission, buyer_tax = v_tax, closed_at = now()
   where id = v_listing.id;
  v_new := private.record_acquisition(v_uid, v_listing.character_id, v_listing.finish);
  return jsonb_build_object('listing_id', v_listing.id, 'instance_id', v_listing.instance_id, 'price', v_listing.price,
    'buyer_tax', v_tax, 'balance', (select balance from public.wallets where owner_id = v_uid), 'discovered', v_new, 'replayed', false);
end $$;

create or replace function private.listing_json(p_listing public.listings, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'listing_id', p_listing.id, 'price', p_listing.price, 'status', p_listing.status,
    'net', p_listing.price - private.commission(p_listing.price),
    'buyer_tax', case when p_listing.status = 'active' then private.market_tax(p_listing.price, 'buyer_tax_pct') else p_listing.buyer_tax end,
    'created_at', p_listing.created_at, 'closed_at', p_listing.closed_at,
    'mine', p_listing.seller_id = p_viewer,
    'seller', (select handle from public.profiles where id = p_listing.seller_id),
    'buyer', (select handle from public.profiles where id = p_listing.buyer_id),
    'finish', p_listing.finish, 'kind', p_listing.kind, 'ends_at', p_listing.ends_at,
    'current_bid', p_listing.current_bid, 'bid_count', p_listing.bid_count,
    'min_next_bid', private.min_next_bid(p_listing), 'min_next_tax', private.market_tax(private.min_next_bid(p_listing), 'buyer_tax_pct'), 'leading', p_listing.current_bidder = p_viewer,
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

create or replace function public.get_history(p_category text default 'all', p_before timestamptz default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_cat text := coalesce(p_category, 'all');
  v_items jsonb;
begin
  if v_cat not in ('all', 'boosters', 'market', 'social', 'recycling', 'deniers') then raise exception 'invalid_kind'; end if;
  with events as (
    -- Ouvertures : les 5 exemplaires obtenus, l'édition, la source, la version des règles.
    select o.created_at as at, jsonb_build_object('type', 'opening', 'pool', o.pool, 'edition', e.name,
             'ruleset', r.version, 'event', ev.name,
             'cards', (select jsonb_agg(private.card_brief(pc.character_id, pc.finish)
                         || jsonb_build_object('variant', a.label) order by pc.position)
                         from public.pack_opening_cards pc left join public.card_arts a on a.id = pc.art_id
                        where pc.opening_id = o.id)) as item
      from public.pack_openings o join public.editions e on e.id = o.edition_id
      join public.pack_rulesets r on r.id = o.ruleset_id left join public.events ev on ev.id = o.event_id
     where o.owner_id = v_uid and v_cat in ('all', 'boosters') and o.created_at < v_before
    union all
    -- Achats en boutique.
    select l.created_at, jsonb_build_object('type', 'shop', 'amount', -l.delta)
      from public.wallet_ledger l
     where l.owner_id = v_uid and l.kind = 'shop_booster' and v_cat in ('all', 'boosters') and l.created_at < v_before
    union all
    -- Marché : ventes (prix, commission, net), achats, annonces retirées ou sans offre.
    select coalesce(m.closed_at, m.created_at), jsonb_build_object(
             'type', case when m.seller_id = v_uid then 'sale' else 'purchase' end, 'status', m.status, 'auction', m.kind = 'auction',
             'card', private.card_brief(m.character_id, m.finish), 'price', coalesce(m.current_bid, m.price),
             'commission', m.commission, 'buyer_tax', m.buyer_tax, 'other', private.handle_of(case when m.seller_id = v_uid then m.buyer_id else m.seller_id end))
      from public.listings m
     where (m.seller_id = v_uid or (m.buyer_id = v_uid and m.status = 'sold')) and m.status <> 'active'
       and v_cat in ('all', 'market') and coalesce(m.closed_at, m.created_at) < v_before
    union all
    -- Échanges conclus, refusés, annulés ou expirés.
    select coalesce(t.closed_at, t.created_at), jsonb_build_object('type', 'trade', 'status', t.status,
             'other', private.handle_of(case when t.proposer_id = v_uid then t.recipient_id else t.proposer_id end),
             'proposed', t.proposer_id = v_uid,
             'given', (select coalesce(jsonb_agg(private.card_brief(ti.character_id, ti.finish)), '[]'::jsonb) from public.trade_items ti
                        where ti.trade_id = t.id and ti.side = case when t.proposer_id = v_uid then 'proposer' else 'recipient' end),
             'received', (select coalesce(jsonb_agg(private.card_brief(ti.character_id, ti.finish)), '[]'::jsonb) from public.trade_items ti
                           where ti.trade_id = t.id and ti.side = case when t.proposer_id = v_uid then 'recipient' else 'proposer' end),
             'deniers_given', case when t.proposer_id = v_uid then t.proposer_deniers else t.recipient_deniers end,
             'deniers_received', case when t.proposer_id = v_uid then t.recipient_deniers else t.proposer_deniers end)
      from public.trades t
     where (t.proposer_id = v_uid or t.recipient_id = v_uid) and t.status <> 'pending'
       and v_cat in ('all', 'social') and coalesce(t.closed_at, t.created_at) < v_before
    union all
    -- Cadeaux envoyés et reçus.
    select coalesce(g.closed_at, g.created_at), jsonb_build_object('type', 'gift', 'status', g.status, 'sent', g.sender_id = v_uid,
             'other', private.handle_of(case when g.sender_id = v_uid then g.recipient_id else g.sender_id end),
             'card', private.card_brief(g.character_id, g.finish))
      from public.gifts g
     where (g.sender_id = v_uid or g.recipient_id = v_uid) and g.status <> 'pending'
       and v_cat in ('all', 'social') and coalesce(g.closed_at, g.created_at) < v_before
    union all
    -- Recyclages : cartes et Deniers obtenus.
    select r.created_at, jsonb_build_object('type', 'recycling', 'total', r.total, 'count', jsonb_array_length(r.items),
             'cards', (select jsonb_agg(private.card_brief((x->>'character_id')::uuid, (x->>'finish')::public.finish))
                         from jsonb_array_elements(r.items) x))
      from public.recycling_operations r
     where r.owner_id = v_uid and v_cat in ('all', 'recycling') and r.created_at < v_before
    union all
    -- Tous les mouvements de Deniers (catégorie dédiée uniquement).
    select l.created_at, jsonb_build_object('type', 'ledger', 'kind', l.kind, 'delta', l.delta, 'balance', l.balance_after)
      from public.wallet_ledger l
     where l.owner_id = v_uid and v_cat = 'deniers' and l.created_at < v_before
  )
  select coalesce(jsonb_agg(item || jsonb_build_object('at', at) order by at desc), '[]'::jsonb) into v_items
    from (select * from events order by at desc limit v_limit) x;
  return jsonb_build_object('items', v_items,
    'next', case when jsonb_array_length(v_items) = v_limit then v_items->(v_limit - 1)->>'at' end);
end $$;

create or replace function private.validate_settings(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  r text;
begin
  for k in select jsonb_object_keys(p) loop
    if k not in ('booster_offers', 'daily_login_reward', 'discovery_reward', 'welcome_free_boosters', 'free_booster_capacity',
                 'market_commission_pct', 'mission_bonus_daily', 'mission_bonus_weekly', 'recycle_values', 'finish_multipliers',
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30]}'::jsonb) loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric <> trunc((p->>k)::numeric)
       or (p->>k)::numeric < (v->>0)::numeric or (p->>k)::numeric > (v->>1)::numeric then
      raise exception 'invalid_setting' using detail = k;
    end if;
  end loop;
  if (p->>'welcome_free_boosters')::int > (p->>'free_booster_capacity')::int then -- valeurs déjà contrôlées ci-dessus
    raise exception 'invalid_setting' using detail = 'welcome_free_boosters';
  end if;
  if jsonb_typeof(p->'booster_offers') is distinct from 'object' or not (p->'booster_offers' ? '1') then
    raise exception 'invalid_setting' using detail = 'booster_offers';
  end if;
  for k, v in select * from jsonb_each(p->'booster_offers') loop
    if k !~ '^[1-9][0-9]?$' or jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric <> trunc((v#>>'{}')::numeric)
       or (v#>>'{}')::numeric < 1 or (v#>>'{}')::numeric > 1000000 then
      raise exception 'invalid_setting' using detail = 'booster_offers';
    end if;
  end loop;
  foreach r in array enum_range(null::public.rarity)::text[] loop
    if jsonb_typeof(p->'recycle_values'->r) is distinct from 'number' or (p->'recycle_values'->>r)::numeric < 0
       or (p->'recycle_values'->>r)::numeric > 1000000 or (p->'recycle_values'->>r)::numeric <> trunc((p->'recycle_values'->>r)::numeric) then
      raise exception 'invalid_setting' using detail = 'recycle_values';
    end if;
  end loop;
  if (p->'finish_multipliers'->>'Standard')::numeric is distinct from 1
     or coalesce((p->'finish_multipliers'->>'Dorée')::numeric, 0) not between 1 and 100
     or coalesce((p->'finish_multipliers'->>'Sanglante')::numeric, 0) not between 1 and 100 then
    raise exception 'invalid_setting' using detail = 'finish_multipliers';
  end if;
end $$;

create or replace function public.admin_save_settings(p_changes jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_old public.economy_settings;
  v_new jsonb;
  v_version integer;
begin
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_setting'; end if;
  perform 1 from public.economy_settings for update;
  select * into v_old from public.economy_settings where active;
  v_new := v_old.settings || p_changes;
  perform private.validate_settings(p_changes || jsonb_build_object(
    'welcome_free_boosters', v_new->'welcome_free_boosters', 'free_booster_capacity', v_new->'free_booster_capacity',
    'booster_offers', v_new->'booster_offers', 'recycle_values', v_new->'recycle_values', 'finish_multipliers', v_new->'finish_multipliers',
    'daily_login_reward', v_new->'daily_login_reward', 'discovery_reward', v_new->'discovery_reward',
    'market_commission_pct', v_new->'market_commission_pct', 'mission_bonus_daily', v_new->'mission_bonus_daily',
    'mission_bonus_weekly', v_new->'mission_bonus_weekly', 'alternate_art_odds', v_new->'alternate_art_odds',
    'buyer_tax_pct', v_new->'buyer_tax_pct', 'bid_refund_tax_pct', v_new->'bid_refund_tax_pct'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

revoke execute on function private.market_tax(bigint, text) from public, anon, authenticated;
