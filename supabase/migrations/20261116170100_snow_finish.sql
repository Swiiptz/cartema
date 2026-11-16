-- CARTEMA — finition Neige (16/11/2026, décisions de Swiiptz).
--  * Tirée seulement dans les boosters d'une édition « Neige » (editions.snow_finish : ANE) et dans les God
--    boosters de toutes les éditions, avec la chance de la Sanglante : une carte tirée en Standard devient Neige
--    avec la probabilité de la Sanglante (événements compris) ; dans un God booster, Sanglante et Neige ont
--    chacune la part blood_pct, le reste est Dorée.
--  * Rien avant l'ouverture : la Neige ne tombe nulle part tant qu'aucune édition Neige n'a son album publié.
--  * Recyclage au multiplicateur de la Sanglante (pas de réglage propre) ; jamais dans les doublons (Standard seuls).
--  * Succès : achievements.finish et deux métriques, finish_cards (personnages différents possédés dans la
--    finition, édition et rareté facultatives) et finish_rarities (raretés différentes).
-- Reprises : open_booster (20261027120000_god_epic), achievement_state (20261023230000_finish_trio),
-- recycle_value (20261020180000_recycling_daily).

alter table public.editions add column snow_finish boolean not null default false;
comment on column public.editions.snow_finish is 'Finition Neige tirée dans les boosters de cette édition.';
update public.editions set snow_finish = true where prefix = 'ANE';
alter table public.achievements add column finish public.finish;

create function private.god_finish(p_blood_pct numeric, p_snow boolean) returns public.finish
language plpgsql volatile set search_path = '' as $$
declare
  v_roll integer := private.random_below(10000);
  v_part integer := round(p_blood_pct * 100);
begin
  if v_roll < v_part then return 'Sanglante'; end if;
  if p_snow and v_roll < 2 * v_part then return 'Neige'; end if;
  return 'Dorée';
end $$;
revoke execute on function private.god_finish(numeric, boolean) from public, anon, authenticated;

create function private.snow_or(p_finish public.finish, p_weight integer) returns public.finish
language sql volatile set search_path = '' as $$
  select case when p_finish = 'Standard' and p_weight > 0 and private.random_below(100000) < p_weight
              then 'Neige'::public.finish else p_finish end
$$;
revoke execute on function private.snow_or(public.finish, integer) from public, anon, authenticated;

create or replace function private.recycle_value(p_rarity public.rarity, p_finish public.finish, p_settings jsonb)
returns bigint language sql immutable set search_path = '' as $$
  select (p_settings->'recycle_values'->>p_rarity::text)::bigint
       * coalesce((p_settings->'finish_multipliers'->>p_finish::text)::bigint,
                  case when p_finish = 'Neige' then (p_settings->'finish_multipliers'->>'Sanglante')::bigint end, 1)
$$;

create or replace function public.open_booster(p_edition_id uuid, p_request_id uuid, p_pool text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_balance public.booster_balances;
  v_existing uuid;
  v_edition public.editions;
  -- Finition Neige : active dès qu'une édition Neige a son album publié ; chance de la Sanglante.
  v_snow_on boolean;
  v_snow_weight integer := 0;
  v_ruleset public.pack_rulesets := private.active_ruleset();
  v_reward bigint := ((private.active_settings()).settings->>'discovery_reward')::bigint;
  v_pool text;
  v_opening_id uuid;
  v_pos integer;
  v_rarity public.rarity;
  v_finish public.finish;
  v_candidates uuid[];
  v_character uuid;
  v_instance uuid;
  v_new boolean;
  v_unique uuid;
  v_unique_won boolean;
  v_finish_multiplier numeric;
  v_event uuid;
  v_art uuid;
  -- Chance « 1 sur N » par défaut des lignes de versions alternatives (0 = jamais).
  v_alt_odds integer := coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0);
  -- God booster : décidé une fois par ouverture.
  v_god_cfg public.god_booster_settings := (select g from public.god_booster_settings g limit 1);
  v_god boolean := false;
  v_since bigint;
  v_god_table jsonb;
  v_skinned uuid[];
  v_skin_slot boolean;
  v_plain_slot boolean;
  v_slots integer[];
  -- Cartes garanties : raretés imposées à la 5e carte (null = tirage normal).
  v_settings jsonb := (private.active_settings()).settings;
  v_force text[];
  -- Carte signée : une chance sur signed_odds pour un personnage dont la signature est publiée.
  v_signed_odds integer := case when private.next_set_on() then coalesce((v_settings->>'signed_odds')::int, 0) else 0 end;
  v_signed boolean;
  v_edition_left integer := 0;
  v_eternal uuid[];
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;
  -- Verrou du solde : deux ouvertures concurrentes sont sérialisées ici.
  v_balance := private.sync_free_boosters(v_uid);

  select o.id into v_existing from public.pack_openings o
   where o.owner_id = v_uid and o.request_id = p_request_id;
  if found then
    return private.opening_result(v_existing) || jsonb_build_object('replayed', true);
  end if;

  select * into v_edition from public.editions e where e.id = p_edition_id;
  if not found or not v_edition.packs_enabled or v_edition.archived_at is not null then
    raise exception 'edition_unavailable';
  end if;
  if not private.edition_is_complete(p_edition_id) then
    raise exception 'edition_incomplete';
  end if;
  if v_ruleset.id is null then
    raise exception 'no_active_ruleset';
  end if;

  -- Gratuits d'abord, puis les boosters achetés pour cette édition, puis les récompenses.
  v_edition_left := coalesce((select count from public.booster_edition_balances where owner_id = v_uid and edition_id = p_edition_id), 0);
  v_pool := coalesce(p_pool, case when v_balance.free_count > 0 then 'free' when v_edition_left > 0 then 'edition' else 'purchased' end);
  if v_pool = 'free' and v_balance.free_count > 0 then
    update public.booster_balances set free_count = free_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool = 'edition' and v_edition_left > 0 then
    update public.booster_edition_balances set count = count - 1, updated_at = now() where owner_id = v_uid and edition_id = p_edition_id;
  elsif v_pool = 'purchased' and v_balance.purchased_count > 0 then
    update public.booster_balances set purchased_count = purchased_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool not in ('free', 'purchased', 'edition') then
    raise exception 'invalid_pool';
  else
    raise exception 'no_booster_available';
  end if;

  -- Événement en cours : finitions rares plus fréquentes (le plus fort s'applique).
  select e.finish_multiplier, e.id into v_finish_multiplier, v_event
    from private.active_events() e where e.finish_multiplier > 1 order by e.finish_multiplier desc limit 1;
  v_snow_on := exists (select 1 from public.editions e where e.snow_finish and e.album_published and e.archived_at is null);
  if v_snow_on and v_edition.snow_finish then
    v_snow_weight := coalesce((select (x->>'weight')::int from jsonb_array_elements(private.event_finishes(v_ruleset.finishes, v_finish_multiplier)) x
                                where x->>'value' = 'Sanglante'), 0);
  end if;

  -- Garantie cachée, propre au joueur : sa guarantee_every-ième ouverture depuis son dernier God booster
  -- (tombé par chance ou garanti) est un God booster. Ses ouvertures sont déjà sérialisées par le verrou du solde.
  if coalesce(v_god_cfg.guarantee_every, 0) > 0 then
    select count(*) into v_since from public.pack_openings o
     where o.owner_id = v_uid
       and o.created_at > coalesce((select max(g.created_at) from public.pack_openings g where g.owner_id = v_uid and g.god),
                                   '-infinity'::timestamptz);
  end if;
  v_god := (coalesce(v_god_cfg.guarantee_every, 0) > 0 and v_since + 1 >= v_god_cfg.guarantee_every)
           or (coalesce(v_god_cfg.odds, 0) > 0 and private.random_below(v_god_cfg.odds) = 0);
  if v_god then v_god_table := private.boost_top_rarities(v_ruleset.slots->4, v_god_cfg.legend_mult); end if;
  -- God booster : place de chaque carte dans l'ordre des emplacements (sans skin, favorisés, skin garanti),
  -- tirée au hasard pour que les skins tombent sur toutes les raretés.
  if v_god then v_slots := (select array_agg(p order by random()) from generate_series(1, 5) p); end if;
  -- Pitié cachée : la N-ième ouverture sans Légendaire (ou sans Épique) depuis la dernière impose cette rareté
  -- ou mieux à la 5e carte. Compté sur l'historique du joueur (ouvertures déjà sérialisées par le verrou du solde).
  if coalesce((v_settings->>'pity_legend_every')::int, 0) > 0
     and private.openings_without(v_uid, array['Légendaire', 'Mythique']) + 1 >= (v_settings->>'pity_legend_every')::int then
    v_force := array['Légendaire', 'Mythique'];
  elsif coalesce((v_settings->>'pity_epic_every')::int, 0) > 0
     and private.openings_without(v_uid, array['Épique', 'Légendaire', 'Mythique']) + 1 >= (v_settings->>'pity_epic_every')::int then
    v_force := array['Épique', 'Légendaire', 'Mythique'];
  end if;
  -- God booster : au moins une Épique (ou mieux) à la 5e carte, sauf si la pitié impose déjà une Légendaire.
  if v_god and v_force is null then
    v_force := array['Épique', 'Légendaire', 'Mythique'];
  end if;
  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id, event_id, god)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id, v_event, v_god)
    returning id into v_opening_id;

  for v_pos in 1..5 loop
    v_unique_won := false;
    -- Carte unique : à la place de la 5e carte, une chance sur unique_odds, une seule fois
    -- dans tout le jeu. L'insertion dans unique_drops (clé primaire) arbitre deux tirages simultanés.
    if v_pos = 5 and v_ruleset.unique_odds > 0 then
      select c.id into v_unique from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.is_unique
         and not exists (select 1 from public.unique_drops d where d.character_id = c.id)
       order by c.number limit 1;
      if v_unique is not null and private.random_below(v_ruleset.unique_odds) = 0 then
        insert into public.unique_drops (character_id, opening_id, first_owner_id)
          values (v_unique, v_opening_id, v_uid) on conflict do nothing;
        v_unique_won := found;
      end if;
    end if;
    if v_unique_won then
      v_character := v_unique;
      select c.rarity into v_rarity from public.characters c where c.id = v_unique;
      v_finish := 'Standard';
      v_art := null;
    else
      -- God booster : les cartes juste avant la 5e suivent la table de la 5e (Rare ou mieux).
      v_rarity := private.pick_weighted(private.restrict_rarities(
                    case when v_god and v_pos >= 5 - v_god_cfg.rare_slots then v_god_table else v_ruleset.slots->(v_pos - 1) end,
                    case when v_pos = 5 then v_force end))::public.rarity;
      select array_agg(c.id order by c.id) into v_candidates
        from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity and not c.is_unique;
      if v_candidates is null then
        -- Jamais de repli vers une autre rareté ou édition (CDC §4).
        raise exception 'edition_incomplete';
      end if;
      -- God booster : plain_slots cartes n'ont que leur finition, jamais de skin ; skin_slots cartes sont des
      -- cartes à skin, skin garanti ; les autres privilégient les personnages à skin (skin_weight) sans les imposer.
      v_skin_slot := false;
      v_plain_slot := v_god and array_position(v_slots, v_pos) <= v_god_cfg.plain_slots;
      if v_god and not v_plain_slot then
        v_skinned := private.with_skin(v_candidates);
        v_skin_slot := array_position(v_slots, v_pos) > 5 - v_god_cfg.skin_slots and v_skinned is not null;
        v_candidates := case when v_skin_slot then v_skinned
                             else private.skin_weighted(v_candidates, v_skinned, v_god_cfg.skin_weight) end;
      end if;
      v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
      if v_god then
        v_finish := private.god_finish(v_god_cfg.blood_pct, v_snow_on);
        v_art := case when v_plain_slot then null
                      else private.pick_alternate_art(v_character, v_alt_odds, case when v_skin_slot then 1 else v_god_cfg.alt_odds end) end;
      else
        v_finish := private.snow_or(private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish, v_snow_weight);
        v_art := private.pick_alternate_art(v_character, v_alt_odds);
      end if;
    end if;

    v_signed := not v_unique_won and v_signed_odds > 0
                and exists (select 1 from public.characters c where c.id = v_character and c.signature_path is not null)
                and private.random_below(v_signed_odds) = 0;
    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id, art_id, signed)
      values (v_uid, v_character, v_finish, v_opening_id, v_art, v_signed)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish, art_id, signed)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish, v_art, v_signed);

    insert into public.discoveries (owner_id, character_id) values (v_uid, v_character)
      on conflict do nothing;
    v_new := found;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (v_uid, v_character, v_finish)
      on conflict do nothing;
    if v_new and v_reward > 0 then
      perform private.apply_wallet_delta(v_uid, v_reward, 'discovery_reward', 'character', v_character,
                                         'discovery:' || v_character);
    end if;
  end loop;

  -- Sixième carte éternelle : dans un God booster ou un booster d'édition qui l'autorise, une rareté est
  -- tirée comme la 5e carte ; si l'édition éternelle a une carte de cette rareté, elle s'ajoute. Dans un God
  -- booster, elle suit les règles des cartes hors emplacement à skin (elle était toujours Dorée, sans skin).
  if v_god or v_edition.eternal_drops then
    v_rarity := private.pick_weighted(case when v_god then v_god_table else v_ruleset.slots->4 end)::public.rarity;
    select array_agg(c.id order by c.id) into v_eternal
      from public.characters c join public.editions e on e.id = c.edition_id
     where e.eternal and e.archived_at is null and c.status = 'published' and not c.is_unique and c.rarity = v_rarity;
    if v_eternal is not null then
      if v_god then v_eternal := private.skin_weighted(v_eternal, private.with_skin(v_eternal), v_god_cfg.skin_weight); end if;
      v_character := v_eternal[1 + private.random_below(cardinality(v_eternal))];
      v_art := null;
      if v_god then
        v_finish := private.god_finish(v_god_cfg.blood_pct, v_snow_on);
        v_art := private.pick_alternate_art(v_character, v_alt_odds, v_god_cfg.alt_odds);
      else
        v_finish := private.snow_or(private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish, v_snow_weight);
      end if;
      insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id, art_id)
        values (v_uid, v_character, v_finish, v_opening_id, v_art) returning id into v_instance;
      insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish, art_id)
        values (v_opening_id, 6, v_instance, v_character, v_rarity, v_finish, v_art);
      insert into public.discoveries (owner_id, character_id) values (v_uid, v_character) on conflict do nothing;
      v_new := found;
      insert into public.finish_discoveries (owner_id, character_id, finish) values (v_uid, v_character, v_finish) on conflict do nothing;
      if v_new and v_reward > 0 then
        perform private.apply_wallet_delta(v_uid, v_reward, 'discovery_reward', 'character', v_character, 'discovery:' || v_character);
      end if;
    end if;
  end if;

  return private.opening_result(v_opening_id) || jsonb_build_object('replayed', false);
end $$;

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(*) filter (where private.owns_card_art(p_owner, rc.id, f.finish, p_def.required_arts->>rc.id::text)),
             cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        cross join lateral (select (p_def.required_finishes->>rc.id::text)::public.finish as finish) f;
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null
                                               and i.removed_at is null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
  elsif p_def.metric = 'same_card_copies' then
    -- Narcisse : le plus grand nombre d'exemplaires possédés d'un même personnage.
    return query
      select coalesce(max(n.copies), 0), p_def.target::bigint
        from (select count(*) copies from public.inventory_items i
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
               group by i.character_id) n;
  elsif p_def.metric = 'clan_lineage' then
    -- Lignée : tous les membres du clan, toutes éditions publiées (hors uniques, archivées, éternelle).
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c join public.editions e on e.id = c.edition_id
       where c.clan_id = p_def.clan_id and c.status = 'published' and not c.is_unique
         and e.album_published and e.archived_at is null and not e.eternal;
  elsif p_def.metric = 'faction' then
    -- Camp : posséder les cartes requises, sans aucune carte exclue (sinon il en manque toujours une).
    return query
      select case when exists (select 1 from unnest(p_def.excluded_characters) x(id) where private.owns_card(p_owner, x.id))
                  then least(s.n, greatest(cardinality(p_def.required_characters) - 1, 0)) else s.n end,
             cardinality(p_def.required_characters)::bigint
        from (select count(*) filter (where private.owns_card(p_owner, rc.id)) n
                from unnest(p_def.required_characters) rc(id)) s;
  elsif p_def.metric = 'finish_trio' then
    -- De l'or à la lie : une carte de cette rareté exactement, possédée en Standard, en Dorée et en Sanglante.
    return query
      select least(count(*), 1)::bigint, 1::bigint
        from (select i.character_id from public.inventory_items i
                join public.characters c on c.id = i.character_id
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
                 and c.rarity = coalesce(p_def.rarity, 'Commun')
               group by i.character_id having count(distinct i.finish) = 3) t;
  elsif p_def.metric = 'login_streak' then
    -- Série de connexions : la meilleure série atteinte.
    return query select coalesce((select p.login_streak_best from public.profiles p where p.id = p_owner), 0)::bigint,
                        p_def.target::bigint;
  elsif p_def.metric in ('finish_cards', 'finish_rarities') then
    -- Cartes possédées dans une finition (édition et rareté facultatives) : personnages différents, ou raretés différentes.
    return query
      select case when p_def.metric = 'finish_cards' then count(distinct i.character_id) else count(distinct c.rarity) end::bigint,
             p_def.target::bigint
        from public.inventory_items i join public.characters c on c.id = i.character_id
       where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null and i.finish = p_def.finish
         and (p_def.edition_id is null or c.edition_id = p_def.edition_id) and (p_def.rarity is null or c.rarity = p_def.rarity);
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;
