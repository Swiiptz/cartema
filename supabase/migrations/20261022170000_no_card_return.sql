-- CARTEMA — fin des prêts de cartes (décision du 22/10/2026). Les succès de collection comptent les
-- cartes découvertes une fois : une carte prêtée puis rendue suffisait à les débloquer, et le délai
-- de 24 h ne faisait que retarder le retour.
--  * Un exemplaire ne peut pas revenir, pendant 30 jours, à un joueur qui l'a cédé (échange, cadeau
--    ou vente au marché). Le contrôle porte sur les échanges, les cadeaux, l'achat à prix fixe et les
--    mises ; il casse aussi les boucles à plusieurs amis (A → B → C → A).
--  * Délai après réception : 72 h au lieu de 24 h (trade_cooldown_hours, toujours réglable).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"trade_cooldown_hours": 72}'::jsonb
    from public.economy_settings;

create index if not exists trade_items_instance_ix on public.trade_items (instance_id);
create index if not exists gifts_instance_ix on public.gifts (instance_id);
create index if not exists listings_instance_ix on public.listings (instance_id);

-- Date à partir de laquelle l'exemplaire peut revenir à ce joueur, ou null s'il le peut déjà.
create function private.card_return_until(p_instance uuid, p_owner uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.at) + interval '30 days' from (
    select t.closed_at as at from public.trade_items ti join public.trades t on t.id = ti.trade_id
     where ti.instance_id = p_instance and t.status = 'accepted'
       and case ti.side when 'proposer' then t.proposer_id else t.recipient_id end = p_owner
    union all
    select g.closed_at from public.gifts g
     where g.instance_id = p_instance and g.status = 'accepted' and g.sender_id = p_owner
    union all
    select l.closed_at from public.listings l
     where l.instance_id = p_instance and l.status = 'sold' and l.seller_id = p_owner) s
  where s.at > now() - interval '30 days'
$$;

create function private.assert_card_can_return(p_instance uuid, p_to uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_until timestamptz := private.card_return_until(p_instance, p_to);
begin
  if v_until is not null then
    raise exception 'card_returning' using detail = v_until::text;
  end if;
end $$;

create function private.check_trade_item_return() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_card_can_return(new.instance_id,
    (select case new.side when 'proposer' then t.recipient_id else t.proposer_id end from public.trades t where t.id = new.trade_id));
  return new;
end $$;
create trigger trade_items_return before insert on public.trade_items for each row execute function private.check_trade_item_return();

create function private.check_gift_return() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_card_can_return(new.instance_id, new.recipient_id);
  return new;
end $$;
create trigger gifts_return before insert on public.gifts for each row execute function private.check_gift_return();

-- Enchères : contrôle à la mise, pour que la clôture planifiée n'échoue jamais.
create function private.check_bid_return() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_card_can_return((select l.instance_id from public.listings l where l.id = new.listing_id), new.bidder_id);
  return new;
end $$;
create trigger bids_return before insert on public.bids for each row execute function private.check_bid_return();

create function private.check_purchase_return() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'fixed' and new.status = 'sold' and old.status = 'active' and new.buyer_id is not null then
    perform private.assert_card_can_return(new.instance_id, new.buyer_id);
  end if;
  return new;
end $$;
create trigger listings_purchase_return before update of status on public.listings
  for each row execute function private.check_purchase_return();

-- Cartes d'un ami qu'on peut demander : sans celles qui reviendraient trop tôt.
create or replace function public.get_friend_cards(p_friend_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if p_friend_id <> v_uid and not private.are_friends(v_uid, p_friend_id) then raise exception 'not_friends'; end if;
  return coalesce((select jsonb_agg(private.card_json(i.character_id, i.finish, i.id) order by c.number, i.finish)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = p_friend_id and i.recycled_at is null and not i.locked and i.reserved_kind is null
     and private.cooldown_until(i.social_received_at) is null
     and (p_friend_id = v_uid or private.card_return_until(i.id, v_uid) is null)), '[]'::jsonb);
end $$;

revoke execute on function private.card_return_until(uuid, uuid), private.assert_card_can_return(uuid, uuid),
  private.check_trade_item_return(), private.check_gift_return(), private.check_bid_return(),
  private.check_purchase_return() from public, anon, authenticated;
