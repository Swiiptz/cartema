-- CARTEMA — audit du 22/10/2026 : index des lectures fréquentes et lectures sans écriture.
-- Mesuré en production : lectures complètes répétées de listings (66 M lignes), friendships (12,5 M),
-- trades (7,7 M), gifts (2,3 M), booster_grants (4,5 M). La base est petite mais sa mémoire est
-- saturée : chaque lecture complète évitée allège le swap.
--  * get_social n'expire plus tous les cadeaux et échanges du jeu à chaque ouverture de la page Amis :
--    la tâche cartema-expire-social le fait toutes les 5 minutes (même schéma que l'incident du 22/10).
--  * get_notifications n'efface plus rien : la purge des notifications lues depuis 60 jours passe
--    dans la même tâche planifiée.
-- Aucune règle de jeu ne change.

create index if not exists gifts_sender_ix on public.gifts (sender_id, created_at desc);
create index if not exists gifts_recipient_ix on public.gifts (recipient_id, created_at desc);
create index if not exists trades_proposer_ix on public.trades (proposer_id, created_at desc);
create index if not exists trades_recipient_ix on public.trades (recipient_id, created_at desc);
create index if not exists friendships_addressee_ix on public.friendships (addressee_id);
create index if not exists friendships_requester_ix on public.friendships (requester_id);
-- Prix de référence (10 dernières ventes d'une carte) et offre la moins chère.
create index if not exists listings_sold_card_ix on public.listings (character_id, finish, closed_at desc) where status = 'sold';
-- Offres actives d'une carte, et filtre par clan du marché.
create index if not exists listings_active_card_ix on public.listings (character_id, finish) where status = 'active';
create index if not exists booster_grants_owner_ix on public.booster_grants (owner_id, created_at desc);
-- Page Concours : mes votes et mes dessins.
create index if not exists contest_votes_voter_ix on public.contest_votes (contest_id, voter_id);
create index if not exists contest_entries_author_ix on public.contest_entries (contest_id, author_id);

create or replace function private.expire_social() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_gift public.gifts;
  v_trade public.trades;
begin
  for v_gift in select * from public.gifts where status = 'pending' and expires_at <= now() for update skip locked loop
    perform private.release_items(v_gift.id);
    update public.gifts set status = 'expired', closed_at = now() where id = v_gift.id;
    v_count := v_count + 1;
  end loop;
  for v_trade in select * from public.trades where status = 'pending' and expires_at <= now() for update skip locked loop
    perform private.close_trade(v_trade, 'expired');
    v_count := v_count + 1;
  end loop;
  -- Notifications lues depuis plus de 60 jours (avant : à chaque ouverture de la cloche).
  delete from public.notifications where read_at < now() - interval '60 days';
  return v_count;
end $$;

create or replace function public.get_social() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('gift_id', g.id, 'status', g.status,
        'incoming', g.recipient_id = v_uid,
        'other', (select handle from public.profiles where id = case when g.recipient_id = v_uid then g.sender_id else g.recipient_id end),
        'created_at', g.created_at, 'expires_at', g.expires_at, 'closed_at', g.closed_at,
        'card', private.card_json(g.character_id, g.finish, g.instance_id)) order by g.created_at desc)
      from (select * from public.gifts where (sender_id = v_uid or recipient_id = v_uid)
             and (status = 'pending' or closed_at > now() - interval '14 days') order by created_at desc limit 60) g), '[]'::jsonb),
    'trades', coalesce((select jsonb_agg(jsonb_build_object('trade_id', t.id, 'status', t.status,
        'incoming', t.recipient_id = v_uid,
        'other_id', case when t.recipient_id = v_uid then t.proposer_id else t.recipient_id end,
        'other', (select handle from public.profiles where id = case when t.recipient_id = v_uid then t.proposer_id else t.recipient_id end),
        'proposer_deniers', t.proposer_deniers, 'recipient_deniers', t.recipient_deniers,
        'created_at', t.created_at, 'expires_at', t.expires_at, 'closed_at', t.closed_at,
        'proposer_cards', coalesce((select jsonb_agg(private.card_json(ti.character_id, ti.finish, ti.instance_id))
                                      from public.trade_items ti where ti.trade_id = t.id and ti.side = 'proposer'), '[]'::jsonb),
        'recipient_cards', coalesce((select jsonb_agg(private.card_json(ti.character_id, ti.finish, ti.instance_id))
                                       from public.trade_items ti where ti.trade_id = t.id and ti.side = 'recipient'), '[]'::jsonb))
        order by t.created_at desc)
      from (select * from public.trades where (proposer_id = v_uid or recipient_id = v_uid)
             and (status = 'pending' or closed_at > now() - interval '14 days') order by created_at desc limit 60) t), '[]'::jsonb),
    'pending_count', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending')
                   + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending')
                   + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'));
end $$;

create or replace function public.get_notifications(p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'payload', n.payload,
                 'created_at', n.created_at, 'read', n.read_at is not null) order by n.created_at desc)
               from (select * from public.notifications where owner_id = v_uid
                      order by created_at desc limit least(greatest(coalesce(p_limit, 40), 1), 100)) n), '[]'::jsonb),
    'unread', (select count(*) from public.notifications where owner_id = v_uid and read_at is null),
    'prefs', (select jsonb_build_object(
                'friends', coalesce((notification_prefs->>'friends')::boolean, true),
                'social', coalesce((notification_prefs->>'social')::boolean, true),
                'market', coalesce((notification_prefs->>'market')::boolean, true),
                'achievements', coalesce((notification_prefs->>'achievements')::boolean, true))
              from public.profiles where id = v_uid));
end $$;
