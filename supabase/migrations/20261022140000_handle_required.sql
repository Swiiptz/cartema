-- CARTEMA — pseudonyme obligatoire pour les transactions entre joueurs (22/10/2026). Des comptes sans
-- pseudonyme vendaient au marché : l'acheteur voyait « — » comme vendeur. Vendre, acheter, enchérir,
-- échanger et offrir exigent désormais un pseudonyme ; les annonces déjà publiées restent en ligne.

create or replace function private.require_trader() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.handle is null then
    raise exception 'handle_required';
  end if;
  if v_profile.transactions_blocked_at is not null then
    raise exception 'transactions_blocked';
  end if;
  if v_profile.created_at > now() - interval '24 hours' and not private.is_verified(v_uid) then
    raise exception 'account_too_new' using hint = format('Disponible le %s',
      to_char((v_profile.created_at + interval '24 hours') at time zone 'Europe/Paris', 'DD/MM à HH24:MI'));
  end if;
  return v_uid;
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
    'allowed', v_profile.handle is not null and v_profile.transactions_blocked_at is null and (v_verified or v_profile.created_at <= now() - interval '24 hours'),
    'verified', v_verified, 'handle_missing', v_profile.handle is null,
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
