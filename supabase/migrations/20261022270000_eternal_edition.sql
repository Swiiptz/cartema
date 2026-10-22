-- CARTEMA — édition Éternelle (ETER) et sixième carte (22/10/2026).
--  * Une édition marquée « éternelle » ne s'ouvre jamais directement (ses boosters restent fermés) :
--    ses cartes tombent seulement en sixième carte.
--  * Sixième carte : dans un God booster, ou dans un booster d'une édition qui a l'option « Éternelle »,
--    une rareté est tirée avec la table de la 5e carte ; si l'édition éternelle a une carte publiée de
--    cette rareté, elle s'ajoute au booster. Sinon, pas de sixième carte : avec seulement une Mythique
--    éternelle, la chance est celle d'une Mythique.
--  * Une édition éternelle n'a pas de succès de collection (impossible à compléter par les boosters).

alter table public.editions add column eternal boolean not null default false;
alter table public.editions add column eternal_drops boolean not null default false;
alter table public.pack_opening_cards drop constraint if exists pack_opening_cards_position_check;
alter table public.pack_opening_cards add constraint pack_opening_cards_position_check check (position between 1 and 6);

-- Une édition éternelle ne peut pas ouvrir ses propres boosters.
create function private.guard_eternal_edition() returns trigger
language plpgsql set search_path = '' as $f$
begin
  if new.eternal and new.packs_enabled then raise exception 'eternal_edition'; end if;
  return new;
end $f$;
create trigger editions_eternal_guard before insert or update on public.editions
  for each row execute function private.guard_eternal_edition();

create or replace function public.open_booster(p_edition_id uuid, p_request_id uuid, p_pool text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_balance public.booster_balances;
  v_existing uuid;
  v_edition public.editions;
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

  v_god := coalesce(v_god_cfg.odds, 0) > 0 and private.random_below(v_god_cfg.odds) = 0;
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
      v_rarity := private.pick_weighted(v_ruleset.slots->(case when v_god and v_pos >= 5 - v_god_cfg.rare_slots then 4 else v_pos - 1 end))::public.rarity;
      select array_agg(c.id order by c.id) into v_candidates
        from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity and not c.is_unique;
      if v_candidates is null then
        -- Jamais de repli vers une autre rareté ou édition (CDC §4).
        raise exception 'edition_incomplete';
      end if;
      v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
      if v_god then
        v_finish := case when private.random_below(10000) < round(v_god_cfg.blood_pct * 100) then 'Sanglante' else 'Dorée' end;
        v_art := private.pick_alternate_art(v_character, v_alt_odds, v_god_cfg.alt_odds);
      else
        v_finish := private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish;
        v_art := private.pick_alternate_art(v_character, v_alt_odds);
      end if;
    end if;

    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id, art_id)
      values (v_uid, v_character, v_finish, v_opening_id, v_art)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish, art_id)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish, v_art);

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
  -- tirée comme la 5e carte ; si l'édition éternelle a une carte de cette rareté, elle s'ajoute.
  if v_god or v_edition.eternal_drops then
    v_rarity := private.pick_weighted(v_ruleset.slots->4)::public.rarity;
    select array_agg(c.id order by c.id) into v_eternal
      from public.characters c join public.editions e on e.id = c.edition_id
     where e.eternal and e.archived_at is null and c.status = 'published' and not c.is_unique and c.rarity = v_rarity;
    if v_eternal is not null then
      v_character := v_eternal[1 + private.random_below(cardinality(v_eternal))];
      v_finish := case when v_god then 'Dorée'
                       else private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish end;
      insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id)
        values (v_uid, v_character, v_finish, v_opening_id) returning id into v_instance;
      insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish)
        values (v_opening_id, 6, v_instance, v_character, v_rarity, v_finish);
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

create or replace function private.sync_set_achievements() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (code, label, description, category, edition_id, clan_id, metric, target, reward_deniers, sort)
    select 'set:' || e.prefix || ':clan:' || cl.id, cl.name || ' au complet',
           'Découvrir tous les personnages ' || cl.name || ' de l’édition ' || e.name || '.',
           'collection', e.id, cl.id, 'set_clan', 1, 150, 1000
      from public.editions e
      join (select distinct edition_id, clan_id from public.characters where status = 'published' and clan_id is not null and not is_unique) x
        on x.edition_id = e.id
      join public.clans cl on cl.id = x.clan_id
     where e.album_published and e.archived_at is null and not e.eternal
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, rarity, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':rarity:' || r.rarity::text,
           'Toutes les ' || case r.rarity when 'Commun' then 'Communes' when 'Peu commun' then 'Peu communes' when 'Rare' then 'Rares'
             when 'Très rare' then 'Très rares' when 'Épique' then 'Épiques' when 'Légendaire' then 'Légendaires' else 'Mythiques' end,
           'Découvrir tous les personnages ' || r.rarity::text || ' de l’édition ' || e.name || '.',
           'collection', e.id, r.rarity, 'set_rarity', 1, 0, 0,
           case when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null and not e.eternal
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', 'Maître de ' || e.name, 'Découvrir toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 8000, 12, 'Maître de ' || e.name, 800
      from public.editions e
     where e.album_published and e.archived_at is null and not e.eternal
       and exists (select 1 from public.characters c where c.edition_id = e.id and c.status = 'published')
  on conflict (code) do nothing;
  -- Récompenses proportionnelles à la taille du groupe, recalculées à chaque synchronisation pour
  -- suivre les cartes ajoutées : chaque déblocage verse la valeur du moment.
  update public.achievements a
     set reward_deniers = greatest(100, 25 * n.cards), reward_boosters = greatest(1, n.cards / 5)
    from (select c2.edition_id, c2.clan_id, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique and c2.clan_id is not null
           group by c2.edition_id, c2.clan_id) n
   where a.category = 'collection' and a.metric = 'set_clan' and n.edition_id = a.edition_id and n.clan_id = a.clan_id
     and (a.reward_deniers, a.reward_boosters) is distinct from (greatest(100, 25 * n.cards), greatest(1, n.cards / 5));
  update public.achievements a
     set reward_deniers = n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                            when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
         reward_boosters = greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end,
                                    n.cards / 10)
    from (select c2.edition_id, c2.rarity, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique group by c2.edition_id, c2.rarity) n
   where a.category = 'collection' and a.metric = 'set_rarity' and n.edition_id = a.edition_id and n.rarity = a.rarity
     and (a.reward_deniers, a.reward_boosters) is distinct from (
           n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                     when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
           greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end, n.cards / 10));
  update public.achievements set reward_deniers = 8000, reward_boosters = 12
   where category = 'collection' and metric = 'set_all' and (reward_deniers, reward_boosters) is distinct from (8000, 12);
end $$;

-- Admin : édition éternelle, et option « sixième carte éternelle » sur les boosters d'une édition.
create function public.admin_set_edition_eternal(p_id uuid, p_eternal boolean, p_eternal_drops boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $f$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.editions;
begin
  select * into v_before from public.editions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.editions set eternal = coalesce(p_eternal, false), eternal_drops = coalesce(p_eternal_drops, false),
                             packs_enabled = case when coalesce(p_eternal, false) then false else packs_enabled end
   where id = p_id;
  perform private.audit(v_admin, 'edition_eternal', p_id, v_reason,
    jsonb_build_object('eternal', v_before.eternal, 'eternal_drops', v_before.eternal_drops),
    jsonb_build_object('eternal', p_eternal, 'eternal_drops', p_eternal_drops));
end $f$;

-- Catalogue d'administration : options éternelles des éditions.
create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers,
        'eternal', e.eternal, 'eternal_drops', e.eternal_drops,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

revoke execute on function private.guard_eternal_edition() from public, anon, authenticated;
revoke execute on function public.admin_set_edition_eternal(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.admin_set_edition_eternal(uuid, boolean, boolean, text) to authenticated;
