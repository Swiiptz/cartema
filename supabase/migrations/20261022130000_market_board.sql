-- CARTEMA — marché amélioré (22/10/2026).
--  * Prix fixe : les annonces d'une même carte (personnage, finition, version d'illustration) sont
--    regroupées, du prix le plus bas au plus haut, avec le nombre d'offres.
--  * Enchères : liste à part, triée par défaut sur la fin la plus proche.
--  * Filtres : rareté, finition, clan, recherche, cartes non découvertes ; tris au choix.
--  * Correctif : une version alternative mise en vente s'affichait avec l'illustration officielle
--    (listing_json construisait la carte sans l'exemplaire) ; elle passe désormais par card_json.
-- get_market reste disponible pour les pages déjà chargées.

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
    'discovered', exists (select 1 from public.discoveries d where d.owner_id = p_viewer and d.character_id = p_listing.character_id),
    'card', private.card_json(p_listing.character_id, p_listing.finish, p_listing.instance_id))
$$;

-- Annonces actives filtrées (enchères échues masquées en attendant leur clôture planifiée).
create function private.market_rows(p_viewer uuid, p_kind text, p_rarity public.rarity, p_finish public.finish,
                                    p_clan_id uuid, p_query text, p_undiscovered boolean)
returns table (id uuid, character_id uuid, finish public.finish, art_id uuid, price bigint, created_at timestamptz,
               ends_at timestamptz, rarity public.rarity, number integer)
language sql stable security definer set search_path = '' as $$
  select l.id, l.character_id, l.finish, i.art_id, coalesce(l.current_bid, l.price), l.created_at, l.ends_at, c.rarity, c.number
    from public.listings l
    join public.characters c on c.id = l.character_id
    join public.inventory_items i on i.id = l.instance_id
   where l.status = 'active' and l.kind = p_kind
     and (l.kind <> 'auction' or l.ends_at > now())
     and (p_rarity is null or c.rarity = p_rarity)
     and (p_finish is null or l.finish = p_finish)
     and (p_clan_id is null or c.clan_id = p_clan_id)
     and (p_query is null or lower(c.name) like '%' || p_query || '%')
     and (not coalesce(p_undiscovered, false)
          or not exists (select 1 from public.discoveries d where d.owner_id = p_viewer and d.character_id = c.id))
$$;

create function public.get_market_board(p_kind text default 'fixed', p_rarity public.rarity default null,
                                        p_finish public.finish default null, p_query text default null,
                                        p_clan_id uuid default null, p_undiscovered boolean default false,
                                        p_sort text default null, p_limit integer default 48, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_query text := nullif(lower(trim(coalesce(p_query, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 48), 1), 120);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_tax numeric := coalesce(((private.active_settings()).settings->>'buyer_tax_pct')::numeric, 0);
  v_items jsonb;
  v_total integer;
begin
  if p_kind not in ('fixed', 'auction') then raise exception 'invalid_kind'; end if;
  if p_sort is not null and p_sort not in ('recent', 'price_asc', 'price_desc', 'rarity', 'ending', 'offers') then
    raise exception 'invalid_sort';
  end if;

  if p_kind = 'auction' then
    select count(*) into v_total from private.market_rows(v_uid, p_kind, p_rarity, p_finish, p_clan_id, v_query, p_undiscovered);
    select coalesce(jsonb_agg(private.listing_json(l, v_uid) order by x.ord), '[]'::jsonb) into v_items
      from (select r.id, row_number() over (order by
               case when coalesce(p_sort, 'ending') = 'ending' then r.ends_at end asc,
               case when p_sort = 'price_asc' then r.price end asc,
               case when p_sort = 'price_desc' then r.price end desc,
               case when p_sort = 'rarity' then r.rarity end desc,
               case when p_sort = 'recent' then r.created_at end desc,
               r.ends_at asc) as ord
              from private.market_rows(v_uid, p_kind, p_rarity, p_finish, p_clan_id, v_query, p_undiscovered) r) x
      join public.listings l on l.id = x.id
     where x.ord > v_offset and x.ord <= v_offset + v_limit;
  else
    -- Une entrée par carte : même personnage, même finition, même version d'illustration.
    with r as materialized (select * from private.market_rows(v_uid, p_kind, p_rarity, p_finish, p_clan_id, v_query, p_undiscovered)),
    g as (
      select r.character_id, r.finish, r.art_id, count(*) as offers, min(r.price) as min_price,
             max(r.created_at) as last_at, min(r.rarity) as rarity, min(r.number) as number,
             (array_agg(r.id order by r.price, r.created_at))[1] as first_id
        from r group by r.character_id, r.finish, r.art_id),
    o as (
      select g.*, row_number() over (order by
               case when p_sort = 'price_asc' then g.min_price end asc,
               case when p_sort = 'price_desc' then g.min_price end desc,
               case when p_sort = 'rarity' then g.rarity end desc,
               case when p_sort = 'offers' then g.offers end desc,
               g.last_at desc, g.number) as ord,
             count(*) over () as total
        from g)
    select coalesce(max(o.total), 0)::integer,
           coalesce(jsonb_agg(jsonb_build_object(
             'key', o.character_id::text || ':' || o.finish::text || ':' || coalesce(o.art_id::text, ''),
             'offers', o.offers, 'min_price', o.min_price,
             'discovered', exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = o.character_id),
             'finish', o.finish,
             'card', private.card_json(o.character_id, o.finish, (select instance_id from public.listings where id = o.first_id)),
             -- Les 12 meilleurs prix ; le premier qui n'est pas à soi est celui de « Acheter ».
             'listings', (select jsonb_agg(jsonb_build_object('listing_id', l.id, 'price', l.price,
                                   'buyer_tax', floor(l.price * v_tax / 100)::bigint,
                                   'seller', p.handle, 'mine', l.seller_id = v_uid, 'created_at', l.created_at)
                                   order by l.price, l.created_at)
                            from (select r.id from r
                                   where r.character_id = o.character_id and r.finish = o.finish
                                     and r.art_id is not distinct from o.art_id
                                   order by r.price, r.created_at limit 12) top
                            join public.listings l on l.id = top.id
                            left join public.profiles p on p.id = l.seller_id))
             order by o.ord) filter (where o.ord > v_offset and o.ord <= v_offset + v_limit), '[]'::jsonb)
      into v_total, v_items
      from o;
  end if;

  return jsonb_build_object('items', v_items, 'total', v_total,
    -- Clans présents parmi les annonces du type choisi, pour le filtre.
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name) order by cl.name)
                         from public.clans cl
                        where exists (select 1 from public.listings l join public.characters c on c.id = l.character_id
                                       where l.status = 'active' and l.kind = p_kind and c.clan_id = cl.id)), '[]'::jsonb));
end $$;

revoke execute on function private.market_rows(uuid, text, public.rarity, public.finish, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.get_market_board(text, public.rarity, public.finish, text, uuid, boolean, text, integer, integer)
  from public, anon;
grant execute on function public.get_market_board(text, public.rarity, public.finish, text, uuid, boolean, text, integer, integer)
  to authenticated;
