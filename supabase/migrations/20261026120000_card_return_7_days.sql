-- CARTEMA — retour d'une carte cédée : 7 jours au lieu de 30 (décision de Swiiptz, 26/10/2026).
-- Un exemplaire ne peut plus revenir, pendant 7 jours, à un joueur qui l'a cédé (échange, cadeau, vente au
-- marché). Les déclencheurs et get_friend_cards passent tous par private.card_return_until : seule elle change.
-- Les blocages en cours sont recalculés aussitôt (rien n'est stocké).

-- Date à partir de laquelle l'exemplaire peut revenir à ce joueur, ou null s'il le peut déjà.
create or replace function private.card_return_until(p_instance uuid, p_owner uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.at) + interval '7 days' from (
    select t.closed_at as at from public.trade_items ti join public.trades t on t.id = ti.trade_id
     where ti.instance_id = p_instance and t.status = 'accepted'
       and case ti.side when 'proposer' then t.proposer_id else t.recipient_id end = p_owner
    union all
    select g.closed_at from public.gifts g
     where g.instance_id = p_instance and g.status = 'accepted' and g.sender_id = p_owner
    union all
    select l.closed_at from public.listings l
     where l.instance_id = p_instance and l.status = 'sold' and l.seller_id = p_owner) s
  where s.at > now() - interval '7 days'
$$;
