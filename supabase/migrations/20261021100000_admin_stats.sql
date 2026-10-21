-- CARTEMA — statistiques d'administration (CDC : statistiques).
-- Lecture seule, réservée à l'administrateur. Les journées sont celles de Paris (minuit à minuit).
--  * joueurs : inscrits, nouveaux, actifs (bonus de connexion du jour = au moins une visite) ;
--  * boosters : ouverts (gratuits / achetés), raretés et finitions tirées ;
--  * économie : Deniers en circulation, créés par le jeu, dépensés en boutique, commissions ;
--  * marché et social : ventes, volume, annonces actives, échanges, cadeaux, amitiés ;
--  * séries journalières sur la période demandée (7 à 90 jours) pour les graphiques.

create function public.admin_stats(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_from timestamptz := ((v_today - (v_days - 1)) + time '00:00') at time zone 'Europe/Paris';
  -- Mouvements entre joueurs : ni création ni destruction de Deniers.
  v_transfers text[] := array['market_sale', 'market_purchase', 'auction_sale', 'bid_hold', 'bid_refund',
                              'trade_hold', 'trade_payment', 'trade_receipt', 'trade_refund'];
begin
  perform private.require_admin();
  return jsonb_build_object(
    'days', v_days,
    'players', jsonb_build_object(
      'total', (select count(*) from public.profiles where handle is not null),
      'new', (select count(*) from public.profiles where created_at >= v_from),
      'active_today', (select count(distinct owner_id) from public.wallet_ledger
                        where kind = 'daily_login' and (created_at at time zone 'Europe/Paris')::date = v_today),
      'active_7d', (select count(distinct owner_id) from public.wallet_ledger
                     where kind = 'daily_login' and created_at >= ((v_today - 6) + time '00:00') at time zone 'Europe/Paris'),
      'active_period', (select count(distinct owner_id) from public.wallet_ledger where kind = 'daily_login' and created_at >= v_from),
      'suspended', (select count(*) from public.profiles where suspended_at is not null)),
    'boosters', jsonb_build_object(
      'opened_total', (select count(*) from public.pack_openings),
      'opened_period', (select count(*) from public.pack_openings where created_at >= v_from),
      'free_period', (select count(*) from public.pack_openings where created_at >= v_from and pool = 'free'),
      'purchased_period', (select count(*) from public.pack_openings where created_at >= v_from and pool = 'purchased'),
      'in_reserve', (select coalesce(sum(free_count + purchased_count), 0) from public.booster_balances),
      'rarities', coalesce((select jsonb_object_agg(r, n) from (
          select pc.rarity::text r, count(*) n from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
           where o.created_at >= v_from group by pc.rarity) x), '{}'::jsonb),
      'gold_period', (select count(*) from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
                       where o.created_at >= v_from and pc.finish = 'Dorée'),
      'blood_period', (select count(*) from public.pack_opening_cards pc join public.pack_openings o on o.id = pc.opening_id
                        where o.created_at >= v_from and pc.finish = 'Sanglante'),
      'unique_found', exists (select 1 from public.unique_drops)),
    'economy', jsonb_build_object(
      'circulation', (select coalesce(sum(balance), 0) from public.wallets),
      'created_period', (select coalesce(sum(delta), 0) from public.wallet_ledger
                          where created_at >= v_from and delta > 0 and kind <> all (v_transfers)),
      'shop_period', (select coalesce(-sum(delta), 0) from public.wallet_ledger where created_at >= v_from and kind = 'shop_booster'),
      'commission_period', (select coalesce(sum(commission), 0) from public.listings where status = 'sold' and closed_at >= v_from),
      'sources', coalesce((select jsonb_object_agg(kind, total) from (
          select kind, sum(delta) total from public.wallet_ledger
           where created_at >= v_from and delta > 0 and kind <> all (v_transfers) group by kind) x), '{}'::jsonb)),
    'market', jsonb_build_object(
      'sales_period', (select count(*) from public.listings where status = 'sold' and closed_at >= v_from),
      'volume_period', (select coalesce(sum(coalesce(current_bid, price)), 0) from public.listings where status = 'sold' and closed_at >= v_from),
      'active_fixed', (select count(*) from public.listings where status = 'active' and kind = 'fixed'),
      'active_auctions', (select count(*) from public.listings where status = 'active' and kind = 'auction')),
    'social', jsonb_build_object(
      'friendships', (select count(*) from public.friendships where status = 'accepted'),
      'trades_period', (select count(*) from public.trades where status = 'accepted' and closed_at >= v_from),
      'gifts_period', (select count(*) from public.gifts where status = 'accepted' and closed_at >= v_from),
      'recycled_period', (select coalesce(sum(jsonb_array_length(items)), 0) from public.recycling_operations where created_at >= v_from)),
    'series', (select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'openings', (select count(*) from public.pack_openings o where (o.created_at at time zone 'Europe/Paris')::date = d::date),
        'active', (select count(distinct owner_id) from public.wallet_ledger l
                    where l.kind = 'daily_login' and (l.created_at at time zone 'Europe/Paris')::date = d::date),
        'signups', (select count(*) from public.profiles p where (p.created_at at time zone 'Europe/Paris')::date = d::date))
        order by d)
      from generate_series(v_today - (v_days - 1), v_today, interval '1 day') d),
    'recent_players', coalesce((select jsonb_agg(jsonb_build_object('handle', p.handle, 'created_at', p.created_at) order by p.created_at desc)
      from (select handle, created_at from public.profiles where handle is not null order by created_at desc limit 8) p), '[]'::jsonb));
end $$;

revoke execute on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;
