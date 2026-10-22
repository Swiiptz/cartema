-- CARTEMA — allègement de « Mes ventes » et « Mes mises » (22/10/2026, après la saturation de 11 h 43).
-- get_my_listings et get_my_bids, appelés à chaque chargement du marché :
--  * ne clôturent plus toutes les enchères échues du jeu à chaque appel (écriture globale qui se
--    bloquait entre joueurs) : la tâche planifiée cartema-close-auctions le fait chaque minute ;
--  * passent par des index (acheteur, enchérisseur) au lieu de relire toute la table ;
--  * Mes ventes : toutes les annonces en cours, et les 50 dernières ventes / achats / retraits
--    (l'historique complet reste dans la page Historique).

create index if not exists listings_buyer_ix on public.listings (buyer_id, closed_at desc) where buyer_id is not null;
create index if not exists listings_seller_closed_ix on public.listings (seller_id, closed_at desc) where status <> 'active';
create index if not exists bids_bidder_ix on public.bids (bidder_id, listing_id);

create or replace function public.get_my_listings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.created_at desc)
    from (select * from public.listings where seller_id = v_uid and status = 'active'
          union all
          select * from (select h.* from (
                           select * from (select * from public.listings where seller_id = v_uid and status <> 'active'
                                           order by closed_at desc nulls last limit 50) s
                           union all
                           select * from (select * from public.listings where buyer_id = v_uid and seller_id <> v_uid
                                           order by closed_at desc nulls last limit 50) b) h
                         order by h.closed_at desc nulls last limit 50) hist) l), '[]'::jsonb);
end $$;

create or replace function public.get_my_bids() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(private.listing_json(l, v_uid) order by l.ends_at)
    from public.listings l
   where l.id in (select b.listing_id from public.bids b where b.bidder_id = v_uid)
     and l.kind = 'auction'
     and (l.status = 'active' or l.closed_at > now() - interval '7 days')), '[]'::jsonb);
end $$;
