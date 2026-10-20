-- CARTEMA — notifications dans le site (CDC : notifications et préférences).
-- Générées par déclencheurs sur les tables métier : aucune fonction existante n'est modifiée et
-- chaque événement produit au plus une notification par destinataire.
--  * amis : demande reçue, demande acceptée ;
--  * cadeaux et échanges : cadeau reçu / accepté / refusé, échange proposé (ou contre-proposé),
--    accepté, refusé ;
--  * marché : vente conclue, enchère dépassée, enchère remportée, enchère close sans offre ;
--  * succès : succès débloqué.
-- Préférences par catégorie (friends, social, market, achievements), toutes actives par défaut.
-- Les notifications lues de plus de 60 jours sont purgées à la lecture.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_owner_ix on public.notifications (owner_id, created_at desc);
create index notifications_unread_ix on public.notifications (owner_id) where read_at is null;
alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
create policy own_notifications on public.notifications for select to authenticated using (owner_id = (select auth.uid()));

alter table public.profiles add column notification_prefs jsonb not null default '{}'::jsonb;

create function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('friend_request', 'friend_accepted') then 'friends'
    when p_kind in ('gift_received', 'gift_answered', 'trade_received', 'trade_answered') then 'social'
    when p_kind in ('listing_sold', 'outbid', 'auction_won', 'auction_unsold') then 'market'
    else 'achievements' end
$$;

create function private.notify(p_owner uuid, p_kind text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null then return; end if;
  if coalesce(((select notification_prefs from public.profiles where id = p_owner)
               ->> private.notification_category(p_kind))::boolean, true) then
    insert into public.notifications (owner_id, kind, payload) values (p_owner, p_kind, p_payload);
  end if;
end $$;

create function private.handle_of(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select handle from public.profiles where id = p_id
$$;

create function private.card_label(p_character uuid, p_finish public.finish) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('card', c.name, 'finish', p_finish, 'unique', c.is_unique)
    from public.characters c where c.id = p_character
$$;

-- ---------------------------------------------------------------- déclencheurs
create function private.on_friendship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.notify(new.addressee_id, 'friend_request', jsonb_build_object('from', private.handle_of(new.requester_id)));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform private.notify(new.requester_id, 'friend_accepted', jsonb_build_object('from', private.handle_of(new.addressee_id)));
  end if;
  return null;
end $$;
create trigger notify_friendship after insert or update on public.friendships for each row execute function private.on_friendship();

create function private.on_gift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.recipient_id, 'gift_received',
      private.card_label(new.character_id, new.finish) || jsonb_build_object('from', private.handle_of(new.sender_id)));
  elsif old.status = 'pending' and new.status in ('accepted', 'declined') then
    perform private.notify(new.sender_id, 'gift_answered',
      private.card_label(new.character_id, new.finish) || jsonb_build_object('from', private.handle_of(new.recipient_id), 'status', new.status));
  end if;
  return null;
end $$;
create trigger notify_gift after insert or update on public.gifts for each row execute function private.on_gift();

create function private.on_trade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.recipient_id, 'trade_received',
      jsonb_build_object('from', private.handle_of(new.proposer_id), 'counter', new.parent_id is not null));
  elsif old.status = 'pending' and new.status in ('accepted', 'declined') then
    perform private.notify(new.proposer_id, 'trade_answered',
      jsonb_build_object('from', private.handle_of(new.recipient_id), 'status', new.status));
  end if;
  return null;
end $$;
create trigger notify_trade after insert or update on public.trades for each row execute function private.on_trade();

create function private.on_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_card jsonb := private.card_label(new.character_id, new.finish);
begin
  -- Enchère dépassée : l'ancien meilleur enchérisseur est prévenu (pas s'il relance lui-même).
  if new.kind = 'auction' and new.status = 'active' and old.current_bidder is not null
     and new.current_bidder is distinct from old.current_bidder then
    perform private.notify(old.current_bidder, 'outbid', v_card || jsonb_build_object('amount', new.current_bid));
  end if;
  if old.status = 'active' and new.status = 'sold' then
    perform private.notify(new.seller_id, 'listing_sold', v_card || jsonb_build_object(
      'price', coalesce(new.current_bid, new.price), 'auction', new.kind = 'auction', 'buyer', private.handle_of(new.buyer_id)));
    if new.kind = 'auction' then
      perform private.notify(new.buyer_id, 'auction_won', v_card || jsonb_build_object('price', new.current_bid));
    end if;
  elsif old.status = 'active' and new.status = 'expired' then
    perform private.notify(new.seller_id, 'auction_unsold', v_card);
  end if;
  return null;
end $$;
create trigger notify_listing after update on public.listings for each row execute function private.on_listing();

create function private.on_achievement_unlock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.owner_id, 'achievement', (select jsonb_build_object('label', a.label, 'code', a.code,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title, 'reason', new.reason)
    from public.achievements a where a.code = new.code));
  return null;
end $$;
create trigger notify_achievement after insert on public.achievement_unlocks for each row execute function private.on_achievement_unlock();

-- ---------------------------------------------------------------- lecture
create function public.get_notifications(p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  delete from public.notifications where owner_id = v_uid and read_at < now() - interval '60 days';
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

create function public.get_unread_count() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return (select count(*) from public.notifications where owner_id = v_uid and read_at is null);
end $$;

-- Sans identifiants : tout marquer comme lu.
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  update public.notifications set read_at = now()
   where owner_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
  return (select count(*) from public.notifications where owner_id = v_uid and read_at is null);
end $$;

create function public.set_notification_prefs(p_prefs jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_clean jsonb;
begin
  select coalesce(jsonb_object_agg(k, (p_prefs->>k)::boolean), '{}'::jsonb) into v_clean
    from unnest(array['friends', 'social', 'market', 'achievements']) k
   where p_prefs ? k and jsonb_typeof(p_prefs->k) = 'boolean';
  update public.profiles set notification_prefs = notification_prefs || v_clean where id = v_uid;
end $$;

revoke execute on function private.notification_category(text), private.notify(uuid, text, jsonb), private.handle_of(uuid),
  private.card_label(uuid, public.finish), private.on_friendship(), private.on_gift(), private.on_trade(),
  private.on_listing(), private.on_achievement_unlock() from public, anon, authenticated;
revoke execute on function public.get_notifications(integer), public.get_unread_count(),
  public.mark_notifications_read(uuid[]), public.set_notification_prefs(jsonb) from public, anon;
grant execute on function public.get_notifications(integer), public.get_unread_count(),
  public.mark_notifications_read(uuid[]), public.set_notification_prefs(jsonb) to authenticated;
