-- CARTEMA — Deniers dans les échanges (décision du 21/10/2026) : un échange pouvait servir de don
-- d'argent gratuit (1 carte commune + 5 000 Deniers contre rien), idéal pour vider des comptes
-- secondaires vers un compte principal.
--  * trade_tax_pct (5 %) : prélevé sur les Deniers reçus dans un échange, arrondi à l'unité inférieure,
--    détruit (sortie de Deniers), comme les taxes du marché ;
--  * trade_weekly_deniers_cap (2 000) : Deniers qu'un joueur peut recevoir par échange sur 7 jours
--    glissants (montant avant taxe), 0 = sans plafond. Vérifié à la proposition (pour prévenir tôt)
--    et à l'acceptation (contrôle qui fait foi).
-- Les cartes, elles, restent libres : cadeaux et échanges sans Deniers ne sont pas touchés.

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"trade_tax_pct": 5, "trade_weekly_deniers_cap": 2000}'::jsonb
    from public.economy_settings;

alter table public.trades add column proposer_tax bigint not null default 0, add column recipient_tax bigint not null default 0;
comment on column public.trades.proposer_tax is 'Taxe retenue sur les Deniers reçus par le proposant.';
comment on column public.trades.recipient_tax is 'Taxe retenue sur les Deniers reçus par le destinataire.';

-- Deniers reçus par échange sur les 7 derniers jours (avant taxe).
create function private.trade_received_week(p_owner uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when recipient_id = p_owner then proposer_deniers else recipient_deniers end), 0)::bigint
    from public.trades
   where status = 'accepted' and closed_at > now() - interval '7 days'
     and (recipient_id = p_owner or proposer_id = p_owner)
$$;

-- Lève trade_deniers_cap si p_owner dépasserait son plafond en recevant p_amount de plus.
create function private.assert_trade_cap(p_owner uuid, p_amount bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cap bigint := coalesce(((private.active_settings()).settings->>'trade_weekly_deniers_cap')::bigint, 0);
begin
  if p_amount > 0 and v_cap > 0 and private.trade_received_week(p_owner) + p_amount > v_cap then
    raise exception 'trade_deniers_cap' using detail = v_cap::text;
  end if;
end $$;

-- À la proposition (et contre-proposition) : prévenir avant de bloquer les Deniers.
create function private.trades_check_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_trade_cap(new.recipient_id, new.proposer_deniers);
  perform private.assert_trade_cap(new.proposer_id, new.recipient_deniers);
  return new;
end $$;
create trigger trades_check_cap before insert on public.trades for each row execute function private.trades_check_cap();

create or replace function public.respond_trade(p_trade_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := case when p_accept then private.require_trader() else private.require_player() end;
  v_trade public.trades;
  v_take uuid[];
  v_item uuid;
  v_ptax bigint;
  v_rtax bigint;
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

  -- Plafond hebdomadaire : contrôle qui fait foi, au moment du transfert.
  perform private.assert_trade_cap(v_uid, v_trade.proposer_deniers);
  perform private.assert_trade_cap(v_trade.proposer_id, v_trade.recipient_deniers);
  -- Deniers : ceux du destinataire sont débités maintenant, ceux du proposant étaient bloqués.
  -- Chacun reçoit le montant moins la taxe d'échange.
  v_ptax := private.market_tax(v_trade.recipient_deniers, 'trade_tax_pct');
  v_rtax := private.market_tax(v_trade.proposer_deniers, 'trade_tax_pct');
  if v_trade.recipient_deniers > 0 then
    perform private.apply_wallet_delta(v_uid, -v_trade.recipient_deniers, 'trade_payment', 'trade', v_trade.id,
                                       'trade-pay:' || v_trade.id);
    if v_trade.recipient_deniers - v_ptax > 0 then
      perform private.apply_wallet_delta(v_trade.proposer_id, v_trade.recipient_deniers - v_ptax, 'trade_receipt', 'trade',
                                         v_trade.id, 'trade-receipt-p:' || v_trade.id);
    end if;
  end if;
  if v_trade.proposer_deniers - v_rtax > 0 then
    perform private.apply_wallet_delta(v_uid, v_trade.proposer_deniers - v_rtax, 'trade_receipt', 'trade', v_trade.id,
                                       'trade-receipt-r:' || v_trade.id);
  end if;
  for v_item in select instance_id from public.trade_items where trade_id = v_trade.id and side = 'proposer' loop
    perform private.transfer_item(v_item, v_uid);
  end loop;
  for v_item in select instance_id from public.trade_items where trade_id = v_trade.id and side = 'recipient' loop
    perform private.transfer_item(v_item, v_trade.proposer_id);
  end loop;
  update public.trades set status = 'accepted', closed_at = now(), proposer_tax = v_ptax, recipient_tax = v_rtax where id = v_trade.id;
  return jsonb_build_object('trade_id', v_trade.id, 'status', 'accepted');
end $$;

create or replace function public.get_trade_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
  v_verified boolean := private.is_verified(v_uid);
begin
  select * into v_profile from public.profiles where id = v_uid;
  return jsonb_build_object(
    'allowed', v_profile.transactions_blocked_at is null and (v_verified or v_profile.created_at <= now() - interval '24 hours'),
    'verified', v_verified,
    'blocked', v_profile.transactions_blocked_at is not null,
    'available_at', case when not v_verified and v_profile.created_at > now() - interval '24 hours' then v_profile.created_at + interval '24 hours' end,
    'commission_pct', coalesce(((private.active_settings()).settings->>'market_commission_pct')::numeric, 5),
    'trade_tax_pct', coalesce(((private.active_settings()).settings->>'trade_tax_pct')::numeric, 0),
    'trade_cap', coalesce(((private.active_settings()).settings->>'trade_weekly_deniers_cap')::bigint, 0),
    'trade_received_week', private.trade_received_week(v_uid));
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
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct', 'trade_tax_pct', 'trade_weekly_deniers_cap') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000]}'::jsonb) loop
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
    'trade_tax_pct', v_new->'trade_tax_pct', 'trade_weekly_deniers_cap', v_new->'trade_weekly_deniers_cap'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

revoke execute on function private.trade_received_week(uuid), private.assert_trade_cap(uuid, bigint), private.trades_check_cap()
  from public, anon, authenticated;
