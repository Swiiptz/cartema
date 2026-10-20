-- CARTEMA — amis, cadeaux de cartes et échanges (CDC §6, §7).
-- Cadeaux : cartes uniquement, entre amis, acceptation obligatoire, retour au refus ou à
-- l'expiration (48 h proposé, à valider), sans commission.
-- Échanges : entre amis (choix de cartes dans la collection de l'autre), 10 cartes maximum par
-- partie, Deniers optionnels, contre-propositions, expiration 48 h, sans commission. Les cartes
-- et Deniers du proposant sont réservés ; ceux du destinataire sont vérifiés à l'acceptation.
-- Toutes les transactions entre joueurs respectent la règle des 24 premières heures.

-- ---------------------------------------------------------------- amis
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_key on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
alter table public.friendships enable row level security;
grant select on public.friendships to authenticated;
create policy own_friendships on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create function private.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships
                  where status = 'accepted'
                    and least(requester_id, addressee_id) = least(p_a, p_b)
                    and greatest(requester_id, addressee_id) = greatest(p_a, p_b))
$$;

create function public.send_friend_request(p_handle text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_target uuid;
  v_existing public.friendships;
begin
  select id into v_target from public.profiles where lower(handle) = lower(trim(p_handle)) and suspended_at is null;
  if v_target is null then raise exception 'player_not_found'; end if;
  if v_target = v_uid then raise exception 'self_request'; end if;
  select * into v_existing from public.friendships
   where least(requester_id, addressee_id) = least(v_uid, v_target)
     and greatest(requester_id, addressee_id) = greatest(v_uid, v_target) for update;
  if found then
    if v_existing.status = 'accepted' then raise exception 'already_friends'; end if;
    if v_existing.requester_id = v_uid then raise exception 'request_pending'; end if;
    -- Demande croisée : l'autre joueur nous avait déjà invités, on accepte.
    update public.friendships set status = 'accepted', accepted_at = now() where id = v_existing.id;
    return 'accepted';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (v_uid, v_target);
  return 'sent';
end $$;

create function public.respond_friend_request(p_request_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where id = p_request_id and addressee_id = v_uid and status = 'pending';
  else
    delete from public.friendships where id = p_request_id and addressee_id = v_uid and status = 'pending';
  end if;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Retire un ami, annule une demande envoyée ou refuse une demande reçue.
create function public.remove_friend(p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  delete from public.friendships
   where least(requester_id, addressee_id) = least(v_uid, p_profile_id)
     and greatest(requester_id, addressee_id) = greatest(v_uid, p_profile_id);
  if not found then raise exception 'not_found'; end if;
end $$;

create function public.get_friends() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('profile_id', p.id, 'handle', p.handle, 'since', f.accepted_at,
        'discovered', (select count(*) from public.discoveries d where d.owner_id = p.id)) order by lower(p.handle))
      from public.friendships f join public.profiles p on p.id = case when f.requester_id = v_uid then f.addressee_id else f.requester_id end
      where f.status = 'accepted' and (f.requester_id = v_uid or f.addressee_id = v_uid)), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('request_id', f.id, 'profile_id', p.id, 'handle', p.handle, 'created_at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.id = f.requester_id
      where f.status = 'pending' and f.addressee_id = v_uid), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('request_id', f.id, 'profile_id', p.id, 'handle', p.handle, 'created_at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.id = f.addressee_id
      where f.status = 'pending' and f.requester_id = v_uid), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- outils communs
create function private.card_json(p_character uuid, p_finish public.finish, p_instance uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('instance_id', p_instance, 'finish', p_finish,
    'character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
    'name', c.name, 'role_title', c.role_title, 'clan', cl.name, 'rarity', c.rarity, 'unique', c.is_unique,
    'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key)
  from public.characters c join public.editions e on e.id = c.edition_id left join public.clans cl on cl.id = c.clan_id
  where c.id = p_character
$$;

-- Exemplaires échangeables d'un joueur : non verrouillés, non réservés, non recyclés.
create function private.tradeable_items(p_owner uuid, p_ids uuid[]) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.inventory_items
   where id = any (p_ids) and owner_id = p_owner and recycled_at is null and not locked and reserved_kind is null
$$;

create function private.transfer_item(p_instance uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.inventory_items;
begin
  update public.inventory_items
     set owner_id = p_to, reserved_kind = null, reserved_ref = null, locked = false, acquired_at = now()
   where id = p_instance returning * into v_item;
  perform private.record_acquisition(p_to, v_item.character_id, v_item.finish);
end $$;

create function private.release_items(p_ref uuid) returns void
language sql security definer set search_path = '' as $$
  update public.inventory_items set reserved_kind = null, reserved_ref = null where reserved_ref = p_ref
$$;

-- ---------------------------------------------------------------- cadeaux
create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  instance_id uuid not null references public.inventory_items(id),
  character_id uuid not null references public.characters(id),
  finish public.finish not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  unique (sender_id, request_id)
);
create index gifts_pending_ix on public.gifts (expires_at) where status = 'pending';
alter table public.gifts enable row level security;
grant select on public.gifts to authenticated;
create policy own_gifts on public.gifts for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());

create function public.send_gift(p_recipient_id uuid, p_instance_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_item public.inventory_items;
  v_gift public.gifts;
  v_hours integer := coalesce(((private.active_settings()).settings->>'gift_expiry_hours')::integer, 48);
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_gift from public.gifts where sender_id = v_uid and request_id = p_request_id;
  if found then return jsonb_build_object('gift_id', v_gift.id, 'replayed', true); end if;
  if not private.are_friends(v_uid, p_recipient_id) then raise exception 'not_friends'; end if;
  select * into v_item from public.inventory_items where id = p_instance_id for update;
  if not found or v_item.owner_id <> v_uid or v_item.recycled_at is not null then raise exception 'not_owned'; end if;
  if v_item.locked then raise exception 'card_locked'; end if;
  if v_item.reserved_kind is not null then raise exception 'card_reserved'; end if;
  insert into public.gifts (sender_id, recipient_id, instance_id, character_id, finish, request_id, expires_at)
    values (v_uid, p_recipient_id, v_item.id, v_item.character_id, v_item.finish, p_request_id,
            now() + make_interval(hours => v_hours))
    returning * into v_gift;
  update public.inventory_items set reserved_kind = 'gift', reserved_ref = v_gift.id where id = v_item.id;
  return jsonb_build_object('gift_id', v_gift.id, 'expires_at', v_gift.expires_at, 'replayed', false);
end $$;

create function public.respond_gift(p_gift_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := case when p_accept then private.require_trader() else private.require_player() end;
  v_gift public.gifts;
begin
  select * into v_gift from public.gifts where id = p_gift_id and recipient_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_gift.status <> 'pending' or v_gift.expires_at <= now() then raise exception 'gift_unavailable'; end if;
  if p_accept then
    perform private.transfer_item(v_gift.instance_id, v_uid);
    update public.gifts set status = 'accepted', closed_at = now() where id = v_gift.id;
  else
    perform private.release_items(v_gift.id);
    update public.gifts set status = 'declined', closed_at = now() where id = v_gift.id;
  end if;
  return jsonb_build_object('gift_id', v_gift.id, 'status', case when p_accept then 'accepted' else 'declined' end);
end $$;

create function public.cancel_gift(p_gift_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  update public.gifts set status = 'cancelled', closed_at = now()
   where id = p_gift_id and sender_id = v_uid and status = 'pending';
  if not found then raise exception 'gift_unavailable'; end if;
  perform private.release_items(p_gift_id);
end $$;

-- ---------------------------------------------------------------- échanges
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  proposer_deniers bigint not null default 0 check (proposer_deniers >= 0),
  recipient_deniers bigint not null default 0 check (recipient_deniers >= 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'countered')),
  parent_id uuid references public.trades(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  unique (proposer_id, request_id),
  check (proposer_id <> recipient_id)
);
create index trades_pending_ix on public.trades (expires_at) where status = 'pending';
create table public.trade_items (
  trade_id uuid not null references public.trades(id) on delete cascade,
  instance_id uuid not null references public.inventory_items(id),
  side text not null check (side in ('proposer', 'recipient')),
  character_id uuid not null references public.characters(id),
  finish public.finish not null,
  primary key (trade_id, instance_id)
);
alter table public.trades enable row level security;
alter table public.trade_items enable row level security;
grant select on public.trades, public.trade_items to authenticated;
create policy own_trades on public.trades for select to authenticated using (proposer_id = auth.uid() or recipient_id = auth.uid());
create policy own_trade_items on public.trade_items for select to authenticated
  using (exists (select 1 from public.trades t where t.id = trade_id and (t.proposer_id = auth.uid() or t.recipient_id = auth.uid())));

-- Clôture sans transfert : libère les cartes et rend les Deniers bloqués du proposant.
create function private.close_trade(p_trade public.trades, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.release_items(p_trade.id);
  if p_trade.proposer_deniers > 0 then
    perform private.apply_wallet_delta(p_trade.proposer_id, p_trade.proposer_deniers, 'trade_refund', 'trade',
                                       p_trade.id, 'trade-refund:' || p_trade.id);
  end if;
  update public.trades set status = p_status, closed_at = now() where id = p_trade.id;
end $$;

-- Proposition (ou contre-proposition si p_parent_id : l'offre reçue est close et les rôles s'inversent).
create function public.propose_trade(p_recipient_id uuid, p_give uuid[], p_take uuid[],
                                     p_give_deniers bigint, p_take_deniers bigint, p_request_id uuid,
                                     p_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_trader();
  v_trade public.trades;
  v_parent public.trades;
  v_give uuid[] := coalesce((select array_agg(distinct x) from unnest(p_give) x where x is not null), '{}');
  v_take uuid[] := coalesce((select array_agg(distinct x) from unnest(p_take) x where x is not null), '{}');
  v_hours integer := coalesce(((private.active_settings()).settings->>'trade_expiry_hours')::integer, 48);
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_trade from public.trades where proposer_id = v_uid and request_id = p_request_id;
  if found then return jsonb_build_object('trade_id', v_trade.id, 'replayed', true); end if;
  if not private.are_friends(v_uid, p_recipient_id) then raise exception 'not_friends'; end if;
  if cardinality(v_give) > 10 or cardinality(v_take) > 10 then raise exception 'too_many_cards'; end if;
  if cardinality(v_give) + cardinality(v_take) = 0 then raise exception 'empty_trade'; end if;
  if coalesce(p_give_deniers, 0) < 0 or coalesce(p_take_deniers, 0) < 0 then raise exception 'invalid_price'; end if;

  if p_parent_id is not null then
    select * into v_parent from public.trades where id = p_parent_id for update;
    if not found or v_parent.recipient_id <> v_uid or v_parent.proposer_id <> p_recipient_id
       or v_parent.status <> 'pending' then
      raise exception 'trade_unavailable';
    end if;
    perform private.close_trade(v_parent, 'countered');
  end if;

  perform 1 from public.inventory_items where id = any (v_give || v_take) for update;
  if private.tradeable_items(v_uid, v_give) <> cardinality(v_give) then raise exception 'card_unavailable'; end if;
  if private.tradeable_items(p_recipient_id, v_take) <> cardinality(v_take) then raise exception 'card_unavailable'; end if;

  insert into public.trades (proposer_id, recipient_id, proposer_deniers, recipient_deniers, parent_id, request_id, expires_at)
    values (v_uid, p_recipient_id, coalesce(p_give_deniers, 0), coalesce(p_take_deniers, 0), p_parent_id, p_request_id,
            now() + make_interval(hours => v_hours))
    returning * into v_trade;
  insert into public.trade_items (trade_id, instance_id, side, character_id, finish)
    select v_trade.id, i.id, case when i.owner_id = v_uid then 'proposer' else 'recipient' end, i.character_id, i.finish
      from public.inventory_items i where i.id = any (v_give || v_take);
  update public.inventory_items set reserved_kind = 'trade', reserved_ref = v_trade.id where id = any (v_give);
  if v_trade.proposer_deniers > 0 then
    perform private.apply_wallet_delta(v_uid, -v_trade.proposer_deniers, 'trade_hold', 'trade', v_trade.id,
                                       'trade-hold:' || v_trade.id);
  end if;
  return jsonb_build_object('trade_id', v_trade.id, 'expires_at', v_trade.expires_at, 'replayed', false);
end $$;

create function public.respond_trade(p_trade_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := case when p_accept then private.require_trader() else private.require_player() end;
  v_trade public.trades;
  v_take uuid[];
  v_item uuid;
begin
  select * into v_trade from public.trades where id = p_trade_id and recipient_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_trade.status <> 'pending' or v_trade.expires_at <= now() then raise exception 'trade_unavailable'; end if;
  if not p_accept then
    perform private.close_trade(v_trade, 'declined');
    return jsonb_build_object('trade_id', v_trade.id, 'status', 'declined');
  end if;

  select array_agg(instance_id) into v_take from public.trade_items where trade_id = v_trade.id and side = 'recipient';
  perform 1 from public.inventory_items i join public.trade_items t on t.instance_id = i.id
   where t.trade_id = v_trade.id for update of i;
  if v_take is not null and private.tradeable_items(v_uid, v_take) <> cardinality(v_take) then
    raise exception 'card_unavailable';
  end if;
  if exists (select 1 from public.trade_items t join public.inventory_items i on i.id = t.instance_id
              where t.trade_id = v_trade.id and t.side = 'proposer'
                and (i.owner_id <> v_trade.proposer_id or i.reserved_ref is distinct from v_trade.id)) then
    raise exception 'card_unavailable';
  end if;

  -- Deniers : ceux du destinataire sont débités maintenant, ceux du proposant étaient bloqués.
  if v_trade.recipient_deniers > 0 then
    perform private.apply_wallet_delta(v_uid, -v_trade.recipient_deniers, 'trade_payment', 'trade', v_trade.id,
                                       'trade-pay:' || v_trade.id);
    perform private.apply_wallet_delta(v_trade.proposer_id, v_trade.recipient_deniers, 'trade_receipt', 'trade',
                                       v_trade.id, 'trade-receipt-p:' || v_trade.id);
  end if;
  if v_trade.proposer_deniers > 0 then
    perform private.apply_wallet_delta(v_uid, v_trade.proposer_deniers, 'trade_receipt', 'trade', v_trade.id,
                                       'trade-receipt-r:' || v_trade.id);
  end if;
  for v_item in select instance_id from public.trade_items where trade_id = v_trade.id and side = 'proposer' loop
    perform private.transfer_item(v_item, v_uid);
  end loop;
  for v_item in select instance_id from public.trade_items where trade_id = v_trade.id and side = 'recipient' loop
    perform private.transfer_item(v_item, v_trade.proposer_id);
  end loop;
  update public.trades set status = 'accepted', closed_at = now() where id = v_trade.id;
  return jsonb_build_object('trade_id', v_trade.id, 'status', 'accepted');
end $$;

create function public.cancel_trade(p_trade_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_trade public.trades;
begin
  select * into v_trade from public.trades where id = p_trade_id and proposer_id = v_uid for update;
  if not found or v_trade.status <> 'pending' then raise exception 'trade_unavailable'; end if;
  perform private.close_trade(v_trade, 'cancelled');
end $$;

-- ---------------------------------------------------------------- expirations
create function private.expire_social() returns integer
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
  return v_count;
end $$;

-- ---------------------------------------------------------------- lectures
create function public.get_friend_cards(p_friend_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if p_friend_id <> v_uid and not private.are_friends(v_uid, p_friend_id) then raise exception 'not_friends'; end if;
  return coalesce((select jsonb_agg(private.card_json(i.character_id, i.finish, i.id) order by c.number, i.finish)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = p_friend_id and i.recycled_at is null and not i.locked and i.reserved_kind is null), '[]'::jsonb);
end $$;

create function public.get_social() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.expire_social();
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

-- État du joueur : ajoute le nombre de demandes, cadeaux et échanges en attente.
create or replace function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_daily bigint := private.claim_daily_reward(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'balance', (select w.balance from public.wallets w where w.owner_id = v_uid),
    'boosters', jsonb_build_object(
      'free', v_boosters.free_count,
      'purchased', v_boosters.purchased_count,
      'free_capacity', (v_settings->>'free_booster_capacity')::int,
      'next_free_at', (select min(s) from private.free_slots_between(now(), now() + interval '1 day') s)),
    'booster_offers', v_settings->'booster_offers',
    'daily_reward', v_daily,
    'social_pending', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'),
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix,
               'cover_path', e.cover_path, 'openable', private.edition_is_complete(e.id)) order by e.created_at)
      from public.editions e
      where e.packs_enabled and e.archived_at is null), '[]'::jsonb)
  );
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cartema-expire-social', '*/5 * * * *', 'select private.expire_social()');
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
  public.send_friend_request(text), public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.get_friends(), public.send_gift(uuid, uuid, uuid), public.respond_gift(uuid, boolean), public.cancel_gift(uuid),
  public.propose_trade(uuid, uuid[], uuid[], bigint, bigint, uuid, uuid), public.respond_trade(uuid, boolean),
  public.cancel_trade(uuid), public.get_friend_cards(uuid), public.get_social(),
  public.admin_catalog(), public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text), public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text),
  public.admin_publish_drafts(uuid, text), public.admin_set_unique(uuid, boolean, text)
to authenticated;
