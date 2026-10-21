-- CARTEMA — surveillance anti-triche (demande du 21/10/2026). Lecture seule, administrateur.
-- Chaque contrôle renvoie : code, gravité (critical = incohérence qui ne devrait jamais arriver,
-- warning = comportement à examiner), titre, explication et lignes trouvées (joueurs concernés).
-- Période des comportements : p_days derniers jours (1 à 90). Les seuils sont volontairement
-- larges : ce sont des pistes à vérifier, pas des sanctions automatiques.

create function private.anomaly(p_code text, p_severity text, p_title text, p_hint text, p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('code', p_code, 'severity', p_severity, 'title', p_title, 'hint', p_hint,
                            'rows', coalesce(p_rows, '[]'::jsonb), 'count', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)))
$$;

create function public.admin_anomalies(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
  v_out jsonb := '[]'::jsonb;
  v_transfers text[] := array['market_sale', 'market_purchase', 'auction_sale', 'bid_hold', 'bid_refund',
                              'trade_hold', 'trade_payment', 'trade_receipt', 'trade_refund'];
begin
  perform private.require_admin();

  -- ======================================================= intégrité (ne doit jamais arriver)
  v_out := v_out || private.anomaly('negative_balance', 'critical', 'Soldes négatifs',
    'Un solde ne peut pas passer sous zéro : signe d’une faille ou d’une correction manuelle.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', w.owner_id, 'detail', w.balance || ' Deniers'))
       from public.wallets w left join public.profiles p on p.id = w.owner_id where w.balance < 0));

  v_out := v_out || private.anomaly('ledger_mismatch', 'critical', 'Solde différent du registre',
    'Le solde doit toujours égaler le dernier solde inscrit au registre des Deniers.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', w.owner_id,
              'detail', 'solde ' || w.balance || ' · registre ' || coalesce(l.balance_after::text, 'vide')))
       from public.wallets w left join public.profiles p on p.id = w.owner_id
       left join lateral (select balance_after from public.wallet_ledger x where x.owner_id = w.owner_id order by x.id desc limit 1) l on true
      where w.balance <> coalesce(l.balance_after, 0)));

  v_out := v_out || private.anomaly('bid_without_hold', 'critical', 'Mises sans prélèvement',
    'Chaque mise doit avoir mis de côté ses Deniers.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', b.bidder_id, 'detail', 'mise de ' || b.amount))
       from public.bids b join public.profiles p on p.id = b.bidder_id
      where not exists (select 1 from public.wallet_ledger l where l.idempotency_key = 'bid:' || b.id)));

  v_out := v_out || private.anomaly('orphan_reservation', 'critical', 'Cartes bloquées sans opération',
    'Carte marquée « en vente / en échange / offerte » alors que l’opération n’est plus en cours : le joueur ne peut plus l’utiliser.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', i.owner_id, 'detail', c.name || ' · ' || i.reserved_kind))
       from public.inventory_items i join public.profiles p on p.id = i.owner_id join public.characters c on c.id = i.character_id
      where i.recycled_at is null and i.reserved_kind is not null
        and not exists (select 1 from public.listings l where l.id = i.reserved_ref and l.status = 'active')
        and not exists (select 1 from public.trades t where t.id = i.reserved_ref and t.status = 'pending')
        and not exists (select 1 from public.gifts g where g.id = i.reserved_ref and g.status = 'pending')));

  v_out := v_out || private.anomaly('unique_duplicate', 'critical', 'Carte unique en plusieurs exemplaires',
    'La carte unique ne doit exister qu’une seule fois dans tout le jeu.',
    (select jsonb_agg(jsonb_build_object('player', null, 'detail', x.name || ' · ' || x.n || ' exemplaires'))
       from (select c.name, count(*) n from public.inventory_items i join public.characters c on c.id = i.character_id
              where c.is_unique group by c.name having count(*) > 1) x));

  v_out := v_out || private.anomaly('booster_overdraw', 'critical', 'Plus de boosters ouverts que reçus',
    'Ouvertures + réserve actuelle doivent égaler les boosters reçus (gratuits, achetés, récompenses, administrateur).',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', x.owner_id,
              'detail', x.opened || ' ouverts + ' || x.left_now || ' en réserve, pour ' || x.granted || ' reçus'))
       from (select b.owner_id, b.free_count + b.purchased_count as left_now,
                    (select count(*) from public.pack_openings o where o.owner_id = b.owner_id) as opened,
                    (select coalesce(sum(g.quantity), 0) from public.booster_grants g where g.owner_id = b.owner_id) as granted
               from public.booster_balances b) x
       join public.profiles p on p.id = x.owner_id
      where x.opened + x.left_now > x.granted));

  -- ======================================================= comportements à examiner
  -- Mêmes deux joueurs qui font sans cesse affaire ensemble (achats, enchères gagnées, échanges, cadeaux).
  v_out := v_out || private.anomaly('pair_concentration', 'warning', 'Duo qui fait beaucoup d’affaires ensemble',
    'Au moins 4 opérations entre les deux mêmes joueurs sur la période : possible compte secondaire qui alimente un compte principal.',
    (select jsonb_agg(jsonb_build_object('player', pa.handle, 'player_id', x.a, 'other', pb.handle, 'other_id', x.b,
              'detail', x.n || ' opérations · ' || x.deniers || ' Deniers vers ' || coalesce(pb.handle, '?')) order by x.n desc)
       from (select a, b, count(*) n, sum(deniers) deniers from (
               select l.seller_id a, l.buyer_id b, coalesce(l.current_bid, l.price) deniers from public.listings l
                where l.status = 'sold' and l.closed_at >= v_from and l.buyer_id is not null
               union all select g.sender_id, g.recipient_id, 0 from public.gifts g where g.status = 'accepted' and g.closed_at >= v_from
               union all select t.proposer_id, t.recipient_id, t.proposer_deniers - t.recipient_deniers from public.trades t
                where t.status = 'accepted' and t.closed_at >= v_from) o
             group by a, b having count(*) >= 4) x
       join public.profiles pa on pa.id = x.a join public.profiles pb on pb.id = x.b));

  -- Ventes à prix aberrant : bien au-dessus de la valeur de recyclage (transfert de Deniers déguisé)
  -- ou presque gratuites pour une carte rare (transfert de carte déguisé).
  v_out := v_out || private.anomaly('price_outlier', 'warning', 'Ventes à prix anormal',
    'Prix plus de 20 fois la valeur de recyclage (Deniers déguisés en vente) ou à 1–5 Deniers pour une Épique ou mieux (cadeau déguisé).',
    (select jsonb_agg(jsonb_build_object('player', ps.handle, 'player_id', l.seller_id, 'other', pb.handle, 'other_id', l.buyer_id,
              'detail', c.name || ' (' || c.rarity || ') vendue ' || coalesce(l.current_bid, l.price) || ' Deniers à ' || coalesce(pb.handle, '?'))
              order by l.closed_at desc)
       from public.listings l join public.characters c on c.id = l.character_id
       join public.profiles ps on ps.id = l.seller_id left join public.profiles pb on pb.id = l.buyer_id
      where l.status = 'sold' and l.closed_at >= v_from
        and (coalesce(l.current_bid, l.price) > 20 * greatest(private.recycle_value(c.rarity, l.finish, (private.active_settings()).settings), 1)
             or (coalesce(l.current_bid, l.price) <= 5 and c.rarity >= 'Épique'))));

  -- Joueur qui reçoit des cartes ou Deniers de plusieurs comptes récents.
  v_out := v_out || private.anomaly('new_account_funnel', 'warning', 'Reçoit des cadeaux de comptes neufs',
    'Au moins 2 comptes de moins de 7 jours lui ont offert des cartes ou fait des échanges à sens unique.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', x.receiver, 'detail', x.n || ' comptes neufs : ' || x.names) order by x.n desc)
       from (select receiver, count(distinct giver) n, string_agg(distinct coalesce(pg.handle, '?'), ', ') names from (
               select g.recipient_id receiver, g.sender_id giver from public.gifts g where g.status = 'accepted' and g.closed_at >= v_from
               union all select t.recipient_id, t.proposer_id from public.trades t where t.status = 'accepted' and t.closed_at >= v_from
                 and not exists (select 1 from public.trade_items ti where ti.trade_id = t.id and ti.side = 'recipient') and t.recipient_deniers = 0) o
             join public.profiles pg on pg.id = o.giver where pg.created_at > now() - interval '7 days'
             group by receiver having count(distinct giver) >= 2) x
       join public.profiles p on p.id = x.receiver));

  -- Enchérisseur qui ne mise que sur les ventes d'un seul vendeur (gonflement des prix).
  v_out := v_out || private.anomaly('shill_bidding', 'warning', 'Mise toujours sur le même vendeur',
    'Au moins 4 mises, toutes sur les enchères d’un même vendeur : possible faux enchérisseur.',
    (select jsonb_agg(jsonb_build_object('player', pb.handle, 'player_id', x.bidder_id, 'other', ps.handle, 'other_id', x.seller_id,
              'detail', x.n || ' mises, toutes chez ' || coalesce(ps.handle, '?')) order by x.n desc)
       from (select b.bidder_id, min(l.seller_id::text)::uuid seller_id, count(*) n from public.bids b join public.listings l on l.id = b.listing_id
              where b.created_at >= v_from group by b.bidder_id having count(*) >= 4 and count(distinct l.seller_id) = 1) x
       join public.profiles pb on pb.id = x.bidder_id join public.profiles ps on ps.id = x.seller_id));

  -- Gains de Deniers créés par le jeu nettement au-dessus des autres joueurs.
  v_out := v_out || private.anomaly('fast_earner', 'warning', 'Gains anormalement rapides',
    'Deniers créés par le jeu (hors ventes et échanges) plus de 3 fois la moyenne des joueurs actifs, et au moins 2 000.',
    (with gains as (select l.owner_id, sum(l.delta) total from public.wallet_ledger l
                     where l.created_at >= v_from and l.delta > 0 and l.kind <> all (v_transfers) group by l.owner_id),
          avg_g as (select avg(total) a from gains)
     select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', g.owner_id, 'detail', '+' || g.total || ' Deniers (moyenne ' || round((select a from avg_g)) || ')')
                      order by g.total desc)
       from gains g join public.profiles p on p.id = g.owner_id
      where g.total >= 2000 and g.total > 3 * (select a from avg_g)));

  -- Rafale d'actions : beaucoup d'achats ou de mises en très peu de temps (script).
  v_out := v_out || private.anomaly('burst', 'warning', 'Rafales d’actions',
    'Plus de 20 achats ou mises dans la même minute : possible script automatique.',
    (select jsonb_agg(jsonb_build_object('player', p.handle, 'player_id', x.owner_id, 'detail', x.n || ' actions le ' ||
              to_char(x.minute_at at time zone 'Europe/Paris', 'DD/MM à HH24:MI')) order by x.n desc)
       from (select owner_id, date_trunc('minute', created_at) minute_at, count(*) n from public.wallet_ledger
              where created_at >= v_from and kind in ('market_purchase', 'bid_hold') group by 1, 2 having count(*) > 20) x
       join public.profiles p on p.id = x.owner_id));

  return jsonb_build_object('generated_at', now(), 'days', least(greatest(coalesce(p_days, 7), 1), 90), 'checks', v_out);
end $$;

revoke execute on function private.anomaly(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_anomalies(integer) from public, anon;
grant execute on function public.admin_anomalies(integer) to authenticated;
