-- CARTEMA — invariants métier garantis par la base (triggers) et configuration initiale.

-- ---------------------------------------------------------------- tables de poids
-- Format : [{"value": "Rare", "weight": 55000}, ...] ; total exact 100 000.
create function private.assert_weight_table(p_table jsonb, p_allowed text[], p_label text)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_total bigint := 0;
  v_item jsonb;
  v_seen text[] := '{}';
begin
  if jsonb_typeof(p_table) <> 'array' or jsonb_array_length(p_table) = 0 then
    raise exception 'invalid_weights: % vide ou mal formé', p_label;
  end if;
  for v_item in select * from jsonb_array_elements(p_table) loop
    if jsonb_typeof(v_item->'weight') <> 'number'
       or (v_item->>'weight')::numeric <> trunc((v_item->>'weight')::numeric)
       or (v_item->>'weight')::bigint <= 0 then
      raise exception 'invalid_weights: % poids non entier positif', p_label;
    end if;
    if not (v_item->>'value' = any (p_allowed)) then
      raise exception 'invalid_weights: % valeur interdite %', p_label, v_item->>'value';
    end if;
    if v_item->>'value' = any (v_seen) then
      raise exception 'invalid_weights: % valeur répétée %', p_label, v_item->>'value';
    end if;
    v_seen := v_seen || (v_item->>'value');
    v_total := v_total + (v_item->>'weight')::bigint;
  end loop;
  if v_total <> 100000 then
    raise exception 'invalid_weights: % total % au lieu de 100000', p_label, v_total;
  end if;
end $$;

create function private.pack_rulesets_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_all text[] := enum_range(null::public.rarity)::text[];
  i integer;
begin
  if tg_op = 'UPDATE' then
    -- Une version appliquée à des tirages ne change jamais : seule l'activation bascule.
    if (new.version, new.slots, new.finishes) is distinct from (old.version, old.slots, old.finishes) then
      raise exception 'immutable_ruleset: créer une nouvelle version';
    end if;
    return new;
  end if;
  if jsonb_typeof(new.slots) <> 'array' or jsonb_array_length(new.slots) <> 5 then
    raise exception 'invalid_weights: 5 emplacements requis';
  end if;
  for i in 0..3 loop
    perform private.assert_weight_table(new.slots->i, v_all, format('emplacement %s', i + 1));
  end loop;
  -- 5e emplacement : garantie Rare ou mieux (CDC §4).
  perform private.assert_weight_table(new.slots->4, array['Rare','Très rare','Épique','Légendaire','Mythique'], 'emplacement 5');
  perform private.assert_weight_table(new.finishes, enum_range(null::public.finish)::text[], 'finitions');
  return new;
end $$;
create trigger pack_rulesets_guard before insert or update on public.pack_rulesets
  for each row execute function private.pack_rulesets_guard();

create function private.economy_settings_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
begin
  if tg_op = 'UPDATE' and new.settings is distinct from old.settings then
    raise exception 'immutable_settings: créer une nouvelle version';
  end if;
  foreach k in array array['booster_offers','free_booster_capacity','welcome_free_boosters','discovery_reward'] loop
    if not new.settings ? k then
      raise exception 'invalid_settings: clé % manquante', k;
    end if;
  end loop;
  if exists (select 1 from jsonb_each(new.settings->'booster_offers') o
             where o.key !~ '^[1-9][0-9]*$' or jsonb_typeof(o.value) <> 'number' or (o.value)::text::numeric <= 0) then
    raise exception 'invalid_settings: offres de boosters invalides';
  end if;
  if (new.settings->>'free_booster_capacity')::int < 1
     or (new.settings->>'welcome_free_boosters')::int < 0
     or (new.settings->>'welcome_free_boosters')::int > (new.settings->>'free_booster_capacity')::int
     or (new.settings->>'discovery_reward')::int < 0 then
    raise exception 'invalid_settings: valeurs hors bornes';
  end if;
  return new;
end $$;
create trigger economy_settings_guard before insert or update on public.economy_settings
  for each row execute function private.economy_settings_guard();

create function private.active_ruleset() returns public.pack_rulesets
language sql stable set search_path = '' as $$
  select * from public.pack_rulesets where active
$$;

create function private.active_settings() returns public.economy_settings
language sql stable set search_path = '' as $$
  select * from public.economy_settings where active
$$;

-- ---------------------------------------------------------------- ledger immuable
create function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Seule exception : suppression en cascade d'un compte (droit à l'effacement).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'immutable_history: % est en ajout seul', tg_table_name;
end $$;
create trigger wallet_ledger_append_only before update or delete on public.wallet_ledger
  for each row execute function private.forbid_mutation();
create trigger pack_opening_cards_append_only before update or delete on public.pack_opening_cards
  for each row execute function private.forbid_mutation();
create trigger admin_audit_logs_append_only before update or delete on public.admin_audit_logs
  for each row execute function private.forbid_mutation();
create trigger discoveries_append_only before update or delete on public.discoveries
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------- catalogue
create function private.edition_is_complete(p_edition_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select count(distinct c.rarity) = cardinality(enum_range(null::public.rarity))
  from public.characters c
  where c.edition_id = p_edition_id and c.status = 'published'
$$;

create function private.characters_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Silhouette tirée une seule fois puis persistée (CDC §3).
    if new.silhouette_key is null then
      select s.key into new.silhouette_key from public.silhouettes s
      where s.active order by gen_random_uuid() limit 1;
    end if;
  else
    if new.id <> old.id or new.edition_id <> old.edition_id
       or new.number <> old.number or new.rarity <> old.rarity then
      raise exception 'immutable_character: identifiant, édition, numéro et rareté sont fixes';
    end if;
    if new.silhouette_key is distinct from old.silhouette_key and old.silhouette_key is not null then
      raise exception 'immutable_character: silhouette déjà attribuée';
    end if;
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger characters_guard before insert or update on public.characters
  for each row execute function private.characters_guard();

create function private.editions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.packs_enabled and (tg_op = 'INSERT' or not old.packs_enabled) then
    if new.archived_at is not null then
      raise exception 'edition_archived';
    end if;
    if not private.edition_is_complete(new.id) then
      raise exception 'edition_incomplete: les 7 raretés doivent avoir une carte publiée';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.prefix <> old.prefix
     and exists (select 1 from public.characters c where c.edition_id = new.id) then
    raise exception 'immutable_edition: préfixe figé dès la première carte';
  end if;
  return new;
end $$;
create trigger editions_guard before insert or update on public.editions
  for each row execute function private.editions_guard();

-- ---------------------------------------------------------------- configuration initiale (non personnelle)
insert into public.silhouettes (key, label) values
  ('gravure-0','Silhouette 1'),('gravure-1','Silhouette 2'),('gravure-2','Silhouette 3'),
  ('gravure-3','Silhouette 4'),('gravure-4','Silhouette 5'),('gravure-5','Silhouette 6');

-- Emplacements 1–4 : valeurs de travail PROVISOIRES (CDC §4), à confirmer.
-- Emplacement 5 et finitions : validés.
insert into public.pack_rulesets (version, active, notes, slots, finishes) values (1, true,
  'Emplacements 1–4 provisoires (non validés) ; emplacement 5 et finitions validés.',
  '[
    [{"value":"Commun","weight":70000},{"value":"Peu commun","weight":30000}],
    [{"value":"Commun","weight":70000},{"value":"Peu commun","weight":30000}],
    [{"value":"Commun","weight":70000},{"value":"Peu commun","weight":30000}],
    [{"value":"Peu commun","weight":75000},{"value":"Rare","weight":20000},{"value":"Épique","weight":5000}],
    [{"value":"Rare","weight":55000},{"value":"Très rare","weight":37000},{"value":"Épique","weight":6000},{"value":"Légendaire","weight":1900},{"value":"Mythique","weight":100}]
  ]'::jsonb,
  '[{"value":"Standard","weight":98000},{"value":"Dorée","weight":1800},{"value":"Sanglante","weight":200}]'::jsonb);

-- welcome_free_boosters et discovery_reward : propositions à paramétrer (CDC §6, §13).
insert into public.economy_settings (version, active, settings) values (1, true, '{
  "booster_offers": {"1": 500, "3": 1400, "10": 4500},
  "free_booster_capacity": 6,
  "welcome_free_boosters": 0,
  "discovery_reward": 10,
  "daily_login_reward": 25,
  "recycle_values": {"Commun": 5, "Peu commun": 15, "Rare": 40, "Très rare": 90, "Épique": 200, "Légendaire": 750, "Mythique": 3000},
  "finish_multipliers": {"Standard": 1, "Dorée": 3, "Sanglante": 10},
  "market_commission_pct": 5
}'::jsonb);
