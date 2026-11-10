-- CARTEMA — thème d'hiver (10/11/2026, mise à jour d'hiver). Réglage Économie winter_theme (0 ou 1, 0 par défaut) :
-- neige légère et touches de Noël sur le site tant qu'il vaut 1, à couper à la fin de la saison. Purement visuel.
-- get_features renvoie aussi « winter » et devient lisible des visiteurs (deux booléens, rien de privé).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"winter_theme": 0}'::jsonb
    from public.economy_settings;

create or replace function public.get_features() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('next_set', private.next_set_on(),
                            'winter', coalesce(((private.active_settings()).settings->>'winter_theme')::int, 0) = 1)
$$;
grant execute on function public.get_features() to anon, authenticated;

-- Reprises de 20261026160000_alt_rarity_odds, avec la clé winter_theme.
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
                 'alternate_art_odds', 'buyer_tax_pct', 'bid_refund_tax_pct', 'trade_tax_pct', 'trade_weekly_deniers_cap', 'trade_daily_limit', 'gift_daily_limit', 'trade_cooldown_hours',
                 'streak_booster_every', 'streak_booster_count', 'pity_epic_every', 'pity_legend_every', 'signed_odds', 'next_set_features', 'alternate_rarity_mult', 'winter_theme') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000], "trade_cooldown_hours": [0, 720],
      "streak_booster_every": [0, 60], "streak_booster_count": [0, 10],
      "pity_epic_every": [0, 1000], "pity_legend_every": [0, 10000],
      "signed_odds": [0, 100000], "next_set_features": [0, 1], "winter_theme": [0, 1]}'::jsonb) loop
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
  -- Versions alternatives : chance multipliée par rareté (toutes les raretés, de 1 à 1 000).
  if p ? 'alternate_rarity_mult' then
    if jsonb_typeof(p->'alternate_rarity_mult') is distinct from 'object' then
      raise exception 'invalid_setting' using detail = 'alternate_rarity_mult';
    end if;
    foreach r in array enum_range(null::public.rarity)::text[] loop
      if jsonb_typeof(p->'alternate_rarity_mult'->r) is distinct from 'number'
         or (p->'alternate_rarity_mult'->>r)::numeric not between 1 and 1000 then
        raise exception 'invalid_setting' using detail = 'alternate_rarity_mult';
      end if;
    end loop;
  end if;
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
    'trade_daily_limit', v_new->'trade_daily_limit', 'gift_daily_limit', v_new->'gift_daily_limit', 'trade_cooldown_hours', v_new->'trade_cooldown_hours',
    'streak_booster_every', v_new->'streak_booster_every', 'streak_booster_count', v_new->'streak_booster_count',
    'pity_epic_every', v_new->'pity_epic_every', 'pity_legend_every', v_new->'pity_legend_every',
    'signed_odds', v_new->'signed_odds', 'next_set_features', v_new->'next_set_features', 'winter_theme', v_new->'winter_theme')
    || case when v_new ? 'alternate_rarity_mult' then jsonb_build_object('alternate_rarity_mult', v_new->'alternate_rarity_mult') else '{}'::jsonb end);
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;
