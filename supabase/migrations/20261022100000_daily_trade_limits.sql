-- CARTEMA — limites quotidiennes des échanges et cadeaux (décision du 22/10/2026), contre le
-- transfert massif de cartes depuis des comptes secondaires. Journée de jeu : 06 h → 06 h Europe/Paris
-- (private.game_day). 0 = sans limite. Réglables dans admin › Économie.
--  * trade_daily_limit (5) : échanges conclus par joueur et par jour, compté pour les deux parties ;
--    vérifié à la proposition (prévenir tôt) et à l'acceptation (contrôle qui fait foi) ;
--  * gift_daily_limit (5) : cadeaux envoyés par jour (à l'envoi) et cadeaux reçus par jour (à
--    l'acceptation) — un compte principal ne peut pas aspirer les cartes de plusieurs comptes.
-- Les déclencheurs lèvent l'erreur dans la même transaction : rien n'est réservé ni transféré.

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"trade_daily_limit": 5, "gift_daily_limit": 5}'::jsonb
    from public.economy_settings;

create function private.daily_limit(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(((private.active_settings()).settings->>p_key)::int, 0)
$$;

-- Échanges conclus aujourd'hui par le joueur (comme proposant ou destinataire).
create function private.trades_today(p_owner uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.trades
   where status = 'accepted' and closed_at > now() - interval '2 days'
     and private.game_day(closed_at) = private.game_day(now())
     and (proposer_id = p_owner or recipient_id = p_owner)
$$;

-- Cadeaux envoyés (p_sent) ou reçus et acceptés (not p_sent) aujourd'hui.
create function private.gifts_today(p_owner uuid, p_sent boolean) returns integer
language sql stable security definer set search_path = '' as $$
  select case when p_sent then
    (select count(*)::int from public.gifts
      where sender_id = p_owner and created_at > now() - interval '2 days'
        and private.game_day(created_at) = private.game_day(now()))
  else
    (select count(*)::int from public.gifts
      where recipient_id = p_owner and status = 'accepted' and closed_at > now() - interval '2 days'
        and private.game_day(closed_at) = private.game_day(now()))
  end
$$;

create function private.trades_check_daily() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := private.daily_limit('trade_daily_limit');
begin
  if v_limit > 0 and (tg_op = 'INSERT' or (new.status = 'accepted' and old.status <> 'accepted')) then
    if private.trades_today(new.proposer_id) >= v_limit or private.trades_today(new.recipient_id) >= v_limit then
      raise exception 'trade_daily_limit' using detail = v_limit::text;
    end if;
  end if;
  return new;
end $$;
create trigger trades_check_daily before insert or update of status on public.trades
  for each row execute function private.trades_check_daily();

create function private.gifts_check_daily() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := private.daily_limit('gift_daily_limit');
begin
  if v_limit > 0 then
    if tg_op = 'INSERT' and private.gifts_today(new.sender_id, true) >= v_limit then
      raise exception 'gift_daily_limit' using detail = v_limit::text;
    end if;
    if tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted'
       and private.gifts_today(new.recipient_id, false) >= v_limit then
      raise exception 'gift_received_limit' using detail = v_limit::text;
    end if;
  end if;
  return new;
end $$;
create trigger gifts_check_daily before insert or update of status on public.gifts
  for each row execute function private.gifts_check_daily();

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
    'trade_received_week', private.trade_received_week(v_uid),
    'trade_daily_limit', private.daily_limit('trade_daily_limit'), 'trades_today', private.trades_today(v_uid),
    'gift_daily_limit', private.daily_limit('gift_daily_limit'), 'gifts_sent_today', private.gifts_today(v_uid, true),
    'gifts_received_today', private.gifts_today(v_uid, false));
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
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct', 'trade_tax_pct', 'trade_weekly_deniers_cap', 'trade_daily_limit', 'gift_daily_limit') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000]}'::jsonb) loop
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
    'trade_daily_limit', v_new->'trade_daily_limit', 'gift_daily_limit', v_new->'gift_daily_limit'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

revoke execute on function private.daily_limit(text), private.trades_today(uuid), private.gifts_today(uuid, boolean),
  private.trades_check_daily(), private.gifts_check_daily() from public, anon, authenticated;
