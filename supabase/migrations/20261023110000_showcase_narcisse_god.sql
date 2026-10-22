-- CARTEMA — vitrine par version, succès Narcisse et God booster garanti (décisions du 23/10/2026).
--  * get_showcase_candidates : une entrée par carte, finition et version d'illustration, avec le nombre
--    d'exemplaires (« copies ») et jusqu'à cinq identifiants (« instances ») : le joueur peut exposer une
--    version alternative et plusieurs exemplaires d'une même carte. set_showcase acceptait déjà des
--    exemplaires distincts ; instance_id reste l'exemplaire par défaut (ancien site).
--  * Succès « Narcisse » : posséder 200 exemplaires d'une même carte. Titre « Narcissique ».
--  * God booster garanti : chaque 2 000e booster ouvert dans le jeu (2 000e, 4 000e…) est un God booster,
--    en plus de la chance habituelle. Compteur : la séquence private.pack_opening_seq, partie du nombre
--    d'ouvertures déjà faites. Réglable par l'administrateur (0 = pas de garantie).

alter table public.god_booster_settings add column guarantee_every integer not null default 2000
  check (guarantee_every between 0 and 1000000);

create sequence private.pack_opening_seq;
select setval('private.pack_opening_seq', greatest((select count(*) from public.pack_openings), 1),
              (select count(*) > 0 from public.pack_openings));

create or replace function public.get_showcase_candidates() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(private.card_json(x.character_id, x.finish, x.ids[1])
                                    || jsonb_build_object('copies', x.copies, 'instances', to_jsonb(x.ids[1:5]))
                                    order by x.prefix, x.number, x.finish, x.art_id nulls first)
    from (select i.character_id, i.finish, i.art_id, c.number, e.prefix, count(*) copies,
                 array_agg(i.id order by i.locked desc, i.acquired_at) ids
            from public.inventory_items i
            join public.characters c on c.id = i.character_id
            join public.editions e on e.id = c.edition_id
           where i.owner_id = v_uid and i.recycled_at is null and i.removed_at is null and e.archived_at is null
           group by i.character_id, i.finish, i.art_id, c.number, e.prefix) x), '[]'::jsonb);
end $$;

insert into public.achievements (code, label, description, secret, metric, target, reward_deniers, reward_boosters, title, sort)
  values ('narcisse', 'Narcisse', 'Posséder 200 exemplaires d’une même carte.', false, 'same_card_copies', 200, 2500, 6,
          'Narcissique', 120)
on conflict (code) do nothing;

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
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

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
  v_rank bigint;
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

  -- Rang de l'ouverture dans tout le jeu : chaque guarantee_every-ième booster est un God booster.
  v_rank := nextval('private.pack_opening_seq');
  v_god := (coalesce(v_god_cfg.guarantee_every, 0) > 0 and v_rank % v_god_cfg.guarantee_every = 0)
           or (coalesce(v_god_cfg.odds, 0) > 0 and private.random_below(v_god_cfg.odds) = 0);
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

create or replace function public.admin_god_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return (select jsonb_build_object('odds', g.odds, 'blood_pct', g.blood_pct, 'alt_odds', g.alt_odds, 'rare_slots', g.rare_slots,
                                    'opened', (select count(*) from public.pack_openings o where o.god),
                                    'guarantee_every', g.guarantee_every, 'total_opened', s.total,
                                    'next_guaranteed', case when g.guarantee_every > 0
                                                            then g.guarantee_every - s.total % g.guarantee_every end)
            from public.god_booster_settings g
            cross join (select case when q.is_called then q.last_value else 0 end total from private.pack_opening_seq q) s);
end $$;

drop function public.admin_save_god_settings(integer, numeric, integer, integer, text);
create function public.admin_save_god_settings(p_odds integer, p_blood_pct numeric, p_alt_odds integer, p_rare_slots integer,
                                               p_reason text, p_guarantee_every integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.god_booster_settings;
begin
  select * into v_before from public.god_booster_settings for update;
  update public.god_booster_settings set odds = p_odds, blood_pct = p_blood_pct, alt_odds = p_alt_odds, rare_slots = p_rare_slots,
                                         guarantee_every = coalesce(p_guarantee_every, guarantee_every),
                                         updated_by = v_admin, updated_at = now();
  perform private.audit(v_admin, 'god_settings', null, v_reason,
    jsonb_build_object('odds', v_before.odds, 'blood_pct', v_before.blood_pct, 'alt_odds', v_before.alt_odds, 'rare_slots', v_before.rare_slots,
                       'guarantee_every', v_before.guarantee_every),
    jsonb_build_object('odds', p_odds, 'blood_pct', p_blood_pct, 'alt_odds', p_alt_odds, 'rare_slots', p_rare_slots,
                       'guarantee_every', coalesce(p_guarantee_every, v_before.guarantee_every)));
end $$;
revoke execute on function public.admin_save_god_settings(integer, numeric, integer, integer, text, integer) from public, anon;
grant execute on function public.admin_save_god_settings(integer, numeric, integer, integer, text, integer) to authenticated;
