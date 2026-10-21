-- CARTEMA — délai sur les cartes reçues (décision du 22/10/2026). Des joueurs se « prêtaient » des
-- cartes par allers-retours d'échanges en 1 à 2 minutes : la carte comptait comme découverte (album,
-- classement, +10 Deniers, succès) et l'échange faisait progresser les succès d'échange, sans rien
-- échanger vraiment.
-- Une carte reçue par échange ou cadeau ne peut plus être échangée ni offerte pendant
-- trade_cooldown_hours (24 h, 0 = aucun délai, réglable dans Économie). La vente au marché reste
-- possible (taxée, donc sans intérêt pour un prêt).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"trade_cooldown_hours": 24}'::jsonb
    from public.economy_settings;

alter table public.inventory_items add column social_received_at timestamptz;
comment on column public.inventory_items.social_received_at is 'Dernière réception par échange ou cadeau (délai avant de pouvoir la redonner).';

-- Rattrapage : les cartes reçues dans les dernières 24 h et toujours chez le même joueur.
update public.inventory_items i set social_received_at = x.at
  from (select distinct on (instance_id) instance_id, taker, at from (
          select ti.instance_id, case when ti.side = 'proposer' then t.recipient_id else t.proposer_id end taker, t.closed_at at
            from public.trades t join public.trade_items ti on ti.trade_id = t.id
           where t.status = 'accepted' and t.closed_at > now() - interval '24 hours'
          union all
          select g.instance_id, g.recipient_id, g.closed_at from public.gifts g
           where g.status = 'accepted' and g.closed_at > now() - interval '24 hours') s
        order by instance_id, at desc) x
 where i.id = x.instance_id and i.owner_id = x.taker and i.recycled_at is null;

-- Fin du délai d'une carte, ou null si elle est libre.
create function private.cooldown_until(p_received timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p_received is not null and v.h > 0 and p_received + make_interval(hours => v.h) > now()
              then p_received + make_interval(hours => v.h) end
    from (select coalesce(((private.active_settings()).settings->>'trade_cooldown_hours')::int, 0) h) v
$$;

create or replace function private.transfer_item(p_instance uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.inventory_items;
begin
  update public.inventory_items
     set owner_id = p_to, reserved_kind = null, reserved_ref = null, locked = false, acquired_at = now(),
         social_received_at = now()
   where id = p_instance returning * into v_item;
  perform private.record_acquisition(p_to, v_item.character_id, v_item.finish);
end $$;

-- Contrôle à l'ajout d'une carte dans un échange (proposition ou contre-proposition) et à l'envoi d'un cadeau.
create function private.check_card_cooldown() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz;
begin
  select private.cooldown_until(social_received_at) into v_until from public.inventory_items where id = new.instance_id;
  if v_until is not null then
    raise exception 'card_cooldown' using detail = v_until::text;
  end if;
  return new;
end $$;
create trigger trade_items_cooldown before insert on public.trade_items for each row execute function private.check_card_cooldown();
create trigger gifts_cooldown before insert on public.gifts for each row execute function private.check_card_cooldown();

create or replace function public.get_friend_cards(p_friend_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if p_friend_id <> v_uid and not private.are_friends(v_uid, p_friend_id) then raise exception 'not_friends'; end if;
  return coalesce((select jsonb_agg(private.card_json(i.character_id, i.finish, i.id) order by c.number, i.finish)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = p_friend_id and i.recycled_at is null and not i.locked and i.reserved_kind is null
     and private.cooldown_until(i.social_received_at) is null), '[]'::jsonb);
end $$;

create or replace function private.validate_settings(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  r text;
begin
  for k in select jsonb_object_keys(p) loop
    if k not in ('booster_offers', 'daily_login_reward', 'discovery_reward', 'welcome_free_boosters', 'free_booster_capacity',
                 'market_commission_pct', 'mission_bonus_daily', 'mission_bonus_weekly', 'recycle_values', 'finish_multipliers',
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct', 'trade_tax_pct', 'trade_weekly_deniers_cap', 'trade_daily_limit', 'gift_daily_limit', 'trade_cooldown_hours') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000], "trade_cooldown_hours": [0, 720]}'::jsonb) loop
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric <> trunc((p->>k)::numeric)
       or (p->>k)::numeric < (v->>0)::numeric or (p->>k)::numeric > (v->>1)::numeric then
      raise exception 'invalid_setting' using detail = k;
    end if;
  end loop;
  if (p->>'welcome_free_boosters')::int > (p->>'free_booster_capacity')::int then -- valeurs déjà contrôlées ci-dessus
    raise exception 'invalid_setting' using detail = 'welcome_free_boosters';
  end if;
  if jsonb_typeof(p->'booster_offers') is distinct from 'object' or not (p->'booster_offers' ? '1') then
    raise exception 'invalid_setting' using detail = 'booster_offers';
  end if;
  for k, v in select * from jsonb_each(p->'booster_offers') loop
    if k !~ '^[1-9][0-9]?$' or jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric <> trunc((v#>>'{}')::numeric)
       or (v#>>'{}')::numeric < 1 or (v#>>'{}')::numeric > 1000000 then
      raise exception 'invalid_setting' using detail = 'booster_offers';
    end if;
  end loop;
  foreach r in array enum_range(null::public.rarity)::text[] loop
    if jsonb_typeof(p->'recycle_values'->r) is distinct from 'number' or (p->'recycle_values'->>r)::numeric < 0
       or (p->'recycle_values'->>r)::numeric > 1000000 or (p->'recycle_values'->>r)::numeric <> trunc((p->'recycle_values'->>r)::numeric) then
      raise exception 'invalid_setting' using detail = 'recycle_values';
    end if;
  end loop;
  if (p->'finish_multipliers'->>'Standard')::numeric is distinct from 1
     or coalesce((p->'finish_multipliers'->>'Dorée')::numeric, 0) not between 1 and 100
     or coalesce((p->'finish_multipliers'->>'Sanglante')::numeric, 0) not between 1 and 100 then
    raise exception 'invalid_setting' using detail = 'finish_multipliers';
  end if;
end $$;

create or replace function public.admin_save_settings(p_changes jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_old public.economy_settings;
  v_new jsonb;
  v_version integer;
begin
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_setting'; end if;
  perform 1 from public.economy_settings for update;
  select * into v_old from public.economy_settings where active;
  v_new := v_old.settings || p_changes;
  perform private.validate_settings(p_changes || jsonb_build_object(
    'welcome_free_boosters', v_new->'welcome_free_boosters', 'free_booster_capacity', v_new->'free_booster_capacity',
    'booster_offers', v_new->'booster_offers', 'recycle_values', v_new->'recycle_values', 'finish_multipliers', v_new->'finish_multipliers',
    'daily_login_reward', v_new->'daily_login_reward', 'discovery_reward', v_new->'discovery_reward',
    'market_commission_pct', v_new->'market_commission_pct', 'mission_bonus_daily', v_new->'mission_bonus_daily',
    'mission_bonus_weekly', v_new->'mission_bonus_weekly', 'alternate_art_odds', v_new->'alternate_art_odds',
    'buyer_tax_pct', v_new->'buyer_tax_pct', 'bid_refund_tax_pct', v_new->'bid_refund_tax_pct',
    'trade_tax_pct', v_new->'trade_tax_pct', 'trade_weekly_deniers_cap', v_new->'trade_weekly_deniers_cap',
    'trade_daily_limit', v_new->'trade_daily_limit', 'gift_daily_limit', v_new->'gift_daily_limit', 'trade_cooldown_hours', v_new->'trade_cooldown_hours'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind in ('listing', 'auction') then i.reserved_ref end,
      'listing_price', (select coalesce(l.current_bid, l.price) from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'listing_kind', (select l.kind from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique, 'cooldown_until', private.cooldown_until(i.social_received_at),
      'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

revoke execute on function private.cooldown_until(timestamptz), private.check_card_cooldown() from public, anon, authenticated;
