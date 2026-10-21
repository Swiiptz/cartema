-- CARTEMA — réglages économiques depuis l'administration (CDC §8 : prix, récompenses, recyclage,
-- pondérations de chaque emplacement, finitions, commission ; confirmation, sommes contrôlées,
-- versionnement ; les paramètres d'un tirage restent dans son historique).
--  * Réglages : chaque enregistrement crée une nouvelle version active (l'ancienne reste consultable).
--    Seules les clés connues sont modifiables, chacune dans une plage raisonnable.
--  * Tirage : chaque enregistrement crée une nouvelle table de tirage ; le garde-fou existant contrôle
--    les sommes (100 000 par emplacement), les raretés autorisées en 5e position et l'immuabilité.
--    Les ouvertures passées gardent la version utilisée (pack_openings.ruleset_id).
--  * Motif obligatoire, journal d'administration avec l'état avant / après.

create function private.validate_settings(p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  r text;
begin
  for k in select jsonb_object_keys(p) loop
    if k not in ('booster_offers', 'daily_login_reward', 'discovery_reward', 'welcome_free_boosters', 'free_booster_capacity',
                 'market_commission_pct', 'mission_bonus_daily', 'mission_bonus_weekly', 'recycle_values', 'finish_multipliers') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30]}'::jsonb) loop
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

create function public.admin_economy() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'settings', (select jsonb_build_object('version', s.version, 'settings', s.settings, 'created_at', s.created_at)
                   from public.economy_settings s where s.active),
    'settings_history', coalesce((select jsonb_agg(jsonb_build_object('version', s.version, 'created_at', s.created_at,
        'by', (select handle from public.profiles where id = s.created_by), 'active', s.active) order by s.version desc)
      from (select * from public.economy_settings order by version desc limit 10) s), '[]'::jsonb),
    'ruleset', (select jsonb_build_object('version', r.version, 'slots', r.slots, 'finishes', r.finishes,
                  'unique_odds', r.unique_odds, 'notes', r.notes, 'created_at', r.created_at)
                  from public.pack_rulesets r where r.active),
    'ruleset_history', coalesce((select jsonb_agg(jsonb_build_object('version', r.version, 'created_at', r.created_at,
        'by', (select handle from public.profiles where id = r.created_by), 'active', r.active, 'notes', r.notes,
        'openings', (select count(*) from public.pack_openings o where o.ruleset_id = r.id)) order by r.version desc)
      from (select * from public.pack_rulesets order by version desc limit 10) r), '[]'::jsonb));
end $$;

-- Modifie les clés fournies ; les autres reprennent la version active.
create function public.admin_save_settings(p_changes jsonb, p_reason text) returns integer
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
    'mission_bonus_weekly', v_new->'mission_bonus_weekly'));
  if v_new = v_old.settings then raise exception 'no_change'; end if;
  v_version := (select max(version) + 1 from public.economy_settings);
  update public.economy_settings set active = false where active;
  insert into public.economy_settings (version, settings, active, created_by) values (v_version, v_new, true, v_admin);
  perform private.audit(v_admin, 'settings_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'settings', v_old.settings),
                        jsonb_build_object('version', v_version, 'settings', v_new));
  return v_version;
end $$;

create function public.admin_save_ruleset(p_slots jsonb, p_finishes jsonb, p_unique_odds integer, p_notes text, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_old public.pack_rulesets;
  v_version integer;
begin
  if p_unique_odds is null or p_unique_odds < 0 or p_unique_odds > 10000000 then raise exception 'invalid_setting' using detail = 'unique_odds'; end if;
  perform 1 from public.pack_rulesets for update;
  select * into v_old from public.pack_rulesets where active;
  if (p_slots, p_finishes, p_unique_odds) is not distinct from (v_old.slots, v_old.finishes, v_old.unique_odds) then
    raise exception 'no_change';
  end if;
  v_version := (select max(version) + 1 from public.pack_rulesets);
  update public.pack_rulesets set active = false where active;
  -- Le garde-fou de la table refuse toute somme ≠ 100 000 ou rareté interdite en 5e position.
  insert into public.pack_rulesets (version, slots, finishes, unique_odds, notes, active, created_by)
    values (v_version, p_slots, p_finishes, p_unique_odds, coalesce(trim(p_notes), ''), true, v_admin);
  perform private.audit(v_admin, 'ruleset_update', null, v_reason,
                        jsonb_build_object('version', v_old.version, 'slots', v_old.slots, 'finishes', v_old.finishes, 'unique_odds', v_old.unique_odds),
                        jsonb_build_object('version', v_version, 'slots', p_slots, 'finishes', p_finishes, 'unique_odds', p_unique_odds));
  return v_version;
end $$;

revoke execute on function private.validate_settings(jsonb) from public, anon, authenticated;
revoke execute on function public.admin_economy(), public.admin_save_settings(jsonb, text),
  public.admin_save_ruleset(jsonb, jsonb, integer, text, text) from public, anon;
grant execute on function public.admin_economy(), public.admin_save_settings(jsonb, text),
  public.admin_save_ruleset(jsonb, jsonb, integer, text, text) to authenticated;
