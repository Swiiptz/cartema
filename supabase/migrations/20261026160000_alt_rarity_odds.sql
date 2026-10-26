-- CARTEMA — versions alternatives : chance selon la rareté (décision de Swiiptz, 26/10/2026).
-- Une même chance pour toutes les raretés rendait les Épiques et au-delà presque introuvables en version
-- alternative (0 tombée sur 13 891 boosters) : une Épique tombe 19 fois moins qu'une Commune.
--  * alternate_rarity_mult (Économie) : la chance « 1 sur N » d'une ligne est divisée par le multiplicateur de
--    la rareté de la carte tirée. Départ : Commune et Peu commune ×1, Rare ×2, Très rare ×3, Épique ×5,
--    Légendaire ×10, Mythique ×20. Jamais mieux que 1 sur 1.
--  * card_art_lines.rarity_odds : réglage à la main d'une ligne pour une rareté (1 sur N, 0 = jamais), prioritaire
--    sur le multiplicateur. {} = lissage complet par les multiplicateurs (bouton « Lisser »).
--  * Une ligne réglée à 0 ne tombe toujours jamais ; le plafond du God booster s'applique par-dessus.
--  * admin_rename_art_line : renomme une ligne (versions, réglage et dessins du concours qui la citent).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
    || '{"alternate_rarity_mult": {"Commun": 1, "Peu commun": 1, "Rare": 2, "Très rare": 3, "Épique": 5, "Légendaire": 10, "Mythique": 20}}'::jsonb
    from public.economy_settings;

alter table public.card_art_lines add column rarity_odds jsonb not null default '{}'::jsonb;
comment on column public.card_art_lines.rarity_odds is 'Chance « 1 sur N » réglée à la main par rareté (prioritaire sur alternate_rarity_mult) ; {} = lissée.';

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
                 'streak_booster_every', 'streak_booster_count', 'pity_epic_every', 'pity_legend_every', 'signed_odds', 'next_set_features', 'alternate_rarity_mult') then
      raise exception 'unknown_setting' using detail = k;
    end if;
  end loop;
  -- Entiers dans une plage : [clé, minimum, maximum].
  for k, v in select * from jsonb_each('{"daily_login_reward": [0, 10000], "discovery_reward": [0, 10000],
      "welcome_free_boosters": [0, 30], "free_booster_capacity": [1, 30], "market_commission_pct": [0, 50],
      "mission_bonus_daily": [0, 10], "mission_bonus_weekly": [0, 30], "alternate_art_odds": [0, 1000000], "buyer_tax_pct": [0, 30], "bid_refund_tax_pct": [0, 30], "trade_tax_pct": [0, 30], "trade_weekly_deniers_cap": [0, 10000000], "trade_daily_limit": [0, 1000], "gift_daily_limit": [0, 1000], "trade_cooldown_hours": [0, 720],
      "streak_booster_every": [0, 60], "streak_booster_count": [0, 10],
      "pity_epic_every": [0, 1000], "pity_legend_every": [0, 10000],
      "signed_odds": [0, 100000], "next_set_features": [0, 1]}'::jsonb) loop
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
    'signed_odds', v_new->'signed_odds', 'next_set_features', v_new->'next_set_features')
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

-- Chance « 1 sur N » d'une ligne pour une carte de cette rareté (0 = jamais).
create function private.alt_line_odds(p_line_odds integer, p_rarity_odds jsonb, p_global_odds integer, p_rarity text) returns integer
language sql stable security definer set search_path = '' as $$
  select case when p_line_odds = 0 then 0
              when coalesce(p_rarity_odds, '{}'::jsonb) ? p_rarity then (p_rarity_odds->>p_rarity)::int
              when coalesce(p_line_odds, p_global_odds, 0) <= 0 then 0
              else greatest(1, round(coalesce(p_line_odds, p_global_odds)::numeric
                     / coalesce(nullif(((private.active_settings()).settings->'alternate_rarity_mult'->>p_rarity)::numeric, 0), 1)))::int end
$$;

-- Version alternative tirée pour ce personnage, ou null (illustration officielle).
create or replace function private.pick_alternate_art(p_character uuid, p_global_odds integer, p_cap integer default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rarity text := (select rarity::text from public.characters where id = p_character);
  v_line record;
begin
  for v_line in
    -- Chance selon la rareté ; une ligne (ou une rareté) réglée à 0 ne tombe jamais ; sinon le plafond (God
    -- booster) rend la chance meilleure.
    select x.label, x.n,
           case when x.explicit_zero then 0
                when coalesce(p_cap, 0) > 0 then least(coalesce(nullif(x.odds, 0), p_cap), p_cap)
                else x.odds end as odds
      from (select a.label, count(*)::int as n,
                   private.alt_line_odds(l.odds, l.rarity_odds, p_global_odds, v_rarity) as odds,
                   coalesce(l.odds = 0 or (l.rarity_odds ? v_rarity and (l.rarity_odds->>v_rarity)::int = 0), false) as explicit_zero
              from public.card_arts a
              left join public.card_art_lines l on l.label = a.label
             where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and coalesce(l.active, true)
             group by a.label, l.odds, l.rarity_odds) x
     order by random()
  loop
    if v_line.odds > 0 and private.random_below(v_line.odds) = 0 then
      return (select a.id from public.card_arts a
               where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and a.label = v_line.label
               order by a.id offset private.random_below(v_line.n) limit 1);
    end if;
  end loop;
  return null;
end $$;

-- Lignes de versions : alternatives et anciennes officielles, avec le détail de leurs cartes.
create or replace function public.admin_art_lines() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'global_odds', coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0),
    'rarity_mult', coalesce((private.active_settings()).settings->'alternate_rarity_mult', '{}'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'legacy', x.legacy, 'active', coalesce(l.active, true), 'odds', l.odds,
        'rarity_odds', coalesce(l.rarity_odds, '{}'::jsonb),
        'arts', x.arts, 'active_arts', x.active_arts, 'characters', x.characters, 'owned', x.owned,
        'cards', (select jsonb_agg(jsonb_build_object('art_id', a.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
                                                      'name', c.name, 'rarity', c.rarity, 'art_path', a.art_path, 'active', a.active,
                                                      'owned', (select count(*) from public.inventory_items i
                                                                 where i.art_id = a.id and i.recycled_at is null))
                                   order by e.prefix, c.number)
                    from public.card_arts a join public.characters c on c.id = a.character_id join public.editions e on e.id = c.edition_id
                   where a.kind in ('alternate', 'legacy') and a.label = x.label)) order by x.legacy, x.label)
      from (select a.label, bool_and(a.kind = 'legacy') as legacy, count(*) as arts, count(*) filter (where a.active) as active_arts,
                   count(distinct a.character_id) as characters,
                   (select count(*) from public.inventory_items i join public.card_arts a2 on a2.id = i.art_id
                     where a2.label = a.label and a2.kind in ('alternate', 'legacy') and i.recycled_at is null) as owned
              from public.card_arts a where a.kind in ('alternate', 'legacy') group by a.label) x
      left join public.card_art_lines l on l.label = x.label), '[]'::jsonb));
end $$;

drop function public.admin_set_art_line(text, boolean, integer, text);
-- p_odds null = chance globale.
create function public.admin_set_art_line(p_label text, p_active boolean, p_odds integer, p_reason text,
                                         p_rarity_odds jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.card_art_lines;
begin
  if not exists (select 1 from public.card_arts where label = p_label and kind in ('alternate', 'legacy')) then
    raise exception 'not_found';
  end if;
  if p_odds is not null and (p_odds < 0 or p_odds > 1000000) then raise exception 'invalid_odds'; end if;
  -- Réglage à la main par rareté : null = inchangé, {} = aucun (lissage par les multiplicateurs).
  if p_rarity_odds is not null and (jsonb_typeof(p_rarity_odds) <> 'object' or exists (
       select 1 from jsonb_each(p_rarity_odds) x
        where x.key <> all (enum_range(null::public.rarity)::text[]) or jsonb_typeof(x.value) <> 'number'
           or (x.value#>>'{}')::numeric <> trunc((x.value#>>'{}')::numeric)
           or (x.value#>>'{}')::numeric not between 0 and 1000000)) then
    raise exception 'invalid_odds';
  end if;
  select * into v_before from public.card_art_lines where label = p_label for update;
  insert into public.card_art_lines (label, active, odds, rarity_odds, updated_by)
    values (p_label, coalesce(p_active, true), p_odds, coalesce(p_rarity_odds, '{}'::jsonb), v_admin)
    on conflict (label) do update set active = excluded.active, odds = excluded.odds,
                                      rarity_odds = coalesce(p_rarity_odds, public.card_art_lines.rarity_odds),
                                      updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(v_admin, 'art_line', null, v_reason,
    case when v_before.label is not null then jsonb_build_object('label', p_label, 'active', v_before.active, 'odds', v_before.odds, 'rarity_odds', v_before.rarity_odds) end,
    jsonb_build_object('label', p_label, 'active', coalesce(p_active, true), 'odds', p_odds, 'rarity_odds', p_rarity_odds));
end $$;

-- Renomme une ligne : ses versions, son réglage et les dessins du concours qui la citent.
create function public.admin_rename_art_line(p_label text, p_new_label text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_new text := trim(coalesce(p_new_label, ''));
  v_count integer;
begin
  if v_new = '' or length(v_new) > 80 then raise exception 'invalid_label'; end if;
  if v_new = p_label then raise exception 'no_change'; end if;
  if exists (select 1 from public.card_arts where label = v_new and kind in ('alternate', 'legacy'))
     or exists (select 1 from public.card_art_lines where label = v_new) then
    raise exception 'line_exists';
  end if;
  update public.card_arts set label = v_new where label = p_label and kind in ('alternate', 'legacy');
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'not_found'; end if;
  update public.card_art_lines set label = v_new, updated_by = v_admin, updated_at = now() where label = p_label;
  update public.contest_entries set line_label = v_new where line_label = p_label;
  perform private.audit(v_admin, 'art_line_rename', null, v_reason, jsonb_build_object('label', p_label),
                        jsonb_build_object('label', v_new, 'arts', v_count));
end $$;

revoke execute on function private.alt_line_odds(integer, jsonb, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_set_art_line(text, boolean, integer, text, jsonb),
  public.admin_rename_art_line(text, text, text) from public, anon;
grant execute on function public.admin_set_art_line(text, boolean, integer, text, jsonb),
  public.admin_rename_art_line(text, text, text) to authenticated;
