-- CARTEMA — « Exemplaire de l'artiste » visible de tous (demande de Swiiptz, 26/10/2026).
--  * private.card_json renvoie artist_copy pour un exemplaire : marché, enchères, échanges, cadeaux, cartes
--    demandables et vitrine le reçoivent, et le site l'affiche en pastille sur la carte.
--  * get_market_board : l'exemplaire de l'artiste a son entrée à part (clé suffixée « :artiste »), pour que
--    l'acheteur sache ce qu'il achète.

create or replace function private.card_json(p_character uuid, p_finish public.finish, p_instance uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('instance_id', p_instance, 'finish', p_finish,
    'character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
    'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity, 'unique', c.is_unique,
    'art_path', coalesce(a.art_path, c.art_path), 'art_meta', case when a.id is not null then a.art_meta else c.art_meta end,
    'variant', a.label, 'variant_kind', a.kind, 'art_credit', case when a.id is not null then a.credit else c.art_credit end,
    'silhouette_key', c.silhouette_key,
    'signed', coalesce(i.signed, false), 'signature', case when i.signed then c.signature_path end,
    -- Exemplaire offert à l'auteur d'un dessin retenu au concours.
    'artist_copy', coalesce(i.artist_until is not null, false))
  from public.characters c join public.editions e on e.id = c.edition_id left join public.clans cl on cl.id = c.clan_id
  left join public.inventory_items i on i.id = p_instance
  left join public.card_arts a on a.id = i.art_id
  where c.id = p_character
$$;

create or replace function public.get_market_board(p_kind text default 'fixed', p_rarity public.rarity default null,
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
    -- Une entrée par carte : même personnage, même finition, même version d'illustration ; l'exemplaire de
    -- l'artiste a son entrée à part.
    with r as materialized (
      select r.*, l.seller_id = v_uid as mine, coalesce(i.artist_until is not null, false) as artist
        from private.market_rows(v_uid, p_kind, p_rarity, p_finish, p_clan_id, v_query, p_undiscovered) r
        join public.listings l on l.id = r.id
        left join public.inventory_items i on i.id = l.instance_id),
    g as (
      select r.character_id, r.finish, r.art_id, r.artist, count(*) as offers, min(r.price) as min_price, max(r.price) as max_price,
             max(r.created_at) as last_at, min(r.rarity) as rarity, min(r.number) as number,
             (array_agg(r.id order by r.price, r.created_at))[1] as first_id,
             (array_agg(r.id order by r.price, r.created_at) filter (where not r.mine))[1] as best_id
        from r group by r.character_id, r.finish, r.art_id, r.artist),
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
             'key', o.character_id::text || ':' || o.finish::text || ':' || coalesce(o.art_id::text, '') || case when o.artist then ':artiste' else '' end,
             'offers', o.offers, 'min_price', o.min_price, 'max_price', o.max_price,
             'discovered', exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = o.character_id),
             'finish', o.finish,
             'card', private.card_json(o.character_id, o.finish, (select instance_id from public.listings where id = o.first_id)),
             -- Les 12 meilleurs prix.
             'listings', (select jsonb_agg(private.market_offer_json(l, v_uid, v_tax) order by l.price, l.created_at)
                            from (select r.id from r
                                   where r.character_id = o.character_id and r.finish = o.finish
                                     and r.art_id is not distinct from o.art_id and r.artist = o.artist
                                   order by r.price, r.created_at limit 12) top
                            join public.listings l on l.id = top.id),
             -- L'offre du bouton « Acheter » : la moins chère d'un autre joueur.
             'best', (select private.market_offer_json(l, v_uid, v_tax) from public.listings l where l.id = o.best_id))
             order by o.ord) filter (where o.ord > v_offset and o.ord <= v_offset + v_limit), '[]'::jsonb)
      into v_total, v_items
      from o;
  end if;

  return jsonb_build_object('items', v_items, 'total', v_total,
    -- Tous les clans qui ont une carte dans un album publié (même sans annonce : un petit clan comme les
    -- Sethites disparaissait du filtre), avec le nombre d'annonces en cours du type choisi.
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name, 'listings', coalesce(n.listings, 0))
                                        order by cl.name)
                         from public.clans cl
                         left join (select c.clan_id, count(*) listings from public.listings l
                                      join public.characters c on c.id = l.character_id
                                     where l.status = 'active' and l.kind = p_kind group by c.clan_id) n on n.clan_id = cl.id
                        where exists (select 1 from public.characters c join public.editions e on e.id = c.edition_id
                                       where c.clan_id = cl.id and c.status = 'published' and e.album_published
                                         and e.archived_at is null)), '[]'::jsonb));
end $$;
