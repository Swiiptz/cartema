-- CARTEMA — God booster garanti par joueur (décision du 23/10/2026, remplace la garantie globale du
-- même jour). Chaque joueur a son compteur caché : sa guarantee_every-ième ouverture (2 000 par défaut)
-- depuis son dernier God booster est un God booster. Un God booster tombé avant, par chance, remet le
-- compteur à zéro (« pitié » cachée : rien n'est montré aux joueurs). Le compteur se calcule à partir de
-- pack_openings ; la séquence globale private.pack_opening_seq n'a plus d'usage.
-- Légendaires et Mythiques multipliées (legend_mult, ×5 par défaut) dans les tirages du God booster qui
-- utilisent la table de la 5e carte (cartes 3 à 5 et sixième carte éternelle) ; les autres raretés de la
-- table sont réduites en proportion pour garder un total de 100 000.

comment on column public.god_booster_settings.guarantee_every is
  'God booster garanti à la N-ième ouverture d''un joueur depuis son dernier God booster (0 = sans garantie).';

alter table public.god_booster_settings add column legend_mult integer not null default 5 check (legend_mult between 1 and 20);
comment on column public.god_booster_settings.legend_mult is
  'Multiplicateur des Légendaires et Mythiques dans la table de la 5e carte, pour le God booster seulement.';

-- Table de rareté (total 100 000) : Légendaire et Mythique ×p_mult, les autres réduites en proportion ;
-- l'arrondi va à la première rareté réduite.
create function private.boost_top_rarities(p_table jsonb, p_mult integer) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_top bigint;
  v_rest bigint;
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_sum bigint := 0;
  v_first integer;
  v_i integer := 0;
  v_w bigint;
begin
  if p_mult is null or p_mult <= 1 then return p_table; end if;
  select coalesce(sum((x->>'weight')::bigint) filter (where x->>'value' in ('Légendaire', 'Mythique')), 0) * p_mult,
         coalesce(sum((x->>'weight')::bigint) filter (where x->>'value' not in ('Légendaire', 'Mythique')), 0)
    into v_top, v_rest from jsonb_array_elements(p_table) x;
  if v_top = 0 or v_rest = 0 or v_top >= 100000 then return p_table; end if;
  for v_item in select * from jsonb_array_elements(p_table) loop
    if v_item->>'value' in ('Légendaire', 'Mythique') then
      v_w := (v_item->>'weight')::bigint * p_mult;
    else
      v_w := (v_item->>'weight')::bigint * (100000 - v_top) / v_rest;
      if v_first is null then v_first := v_i; end if;
    end if;
    v_sum := v_sum + v_w;
    v_out := v_out || jsonb_build_array(jsonb_build_object('value', v_item->>'value', 'weight', v_w));
    v_i := v_i + 1;
  end loop;
  return jsonb_set(v_out, array[v_first::text, 'weight'], to_jsonb((v_out->v_first->>'weight')::bigint + 100000 - v_sum));
end $$;
revoke execute on function private.boost_top_rarities(jsonb, integer) from public, anon, authenticated;

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
  v_since bigint;
  v_god_table jsonb;
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
      v_rarity := private.pick_weighted(case when v_god and v_pos >= 5 - v_god_cfg.rare_slots then v_god_table
                                             else v_ruleset.slots->(v_pos - 1) end)::public.rarity;
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
    v_rarity := private.pick_weighted(case when v_god then v_god_table else v_ruleset.slots->4 end)::public.rarity;
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
                                    'guarantee_every', g.guarantee_every, 'legend_mult', g.legend_mult,
                                    -- Les 5 joueurs les plus proches de leur God booster garanti (jamais montré aux joueurs).
                                    'closest', case when g.guarantee_every > 0 then coalesce((
                                      select jsonb_agg(jsonb_build_object('handle', x.handle, 'since', x.since,
                                                                          'remaining', greatest(g.guarantee_every - x.since, 1))
                                                       order by x.since desc, x.handle)
                                        from (select p.handle, count(*) since
                                                from public.pack_openings o
                                                join (select owner_id, max(created_at) filter (where god) last_god
                                                        from public.pack_openings group by owner_id) l on l.owner_id = o.owner_id
                                                join public.profiles p on p.id = o.owner_id
                                               where o.created_at > coalesce(l.last_god, '-infinity'::timestamptz)
                                               group by p.handle order by count(*) desc, p.handle limit 5) x), '[]'::jsonb) end)
            from public.god_booster_settings g);
end $$;

drop function public.admin_save_god_settings(integer, numeric, integer, integer, text, integer);
create function public.admin_save_god_settings(p_odds integer, p_blood_pct numeric, p_alt_odds integer, p_rare_slots integer,
                                               p_reason text, p_guarantee_every integer default null,
                                               p_legend_mult integer default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.god_booster_settings;
begin
  select * into v_before from public.god_booster_settings for update;
  update public.god_booster_settings set odds = p_odds, blood_pct = p_blood_pct, alt_odds = p_alt_odds, rare_slots = p_rare_slots,
                                         guarantee_every = coalesce(p_guarantee_every, guarantee_every),
                                         legend_mult = coalesce(p_legend_mult, legend_mult),
                                         updated_by = v_admin, updated_at = now();
  perform private.audit(v_admin, 'god_settings', null, v_reason,
    jsonb_build_object('odds', v_before.odds, 'blood_pct', v_before.blood_pct, 'alt_odds', v_before.alt_odds, 'rare_slots', v_before.rare_slots,
                       'guarantee_every', v_before.guarantee_every, 'legend_mult', v_before.legend_mult),
    jsonb_build_object('odds', p_odds, 'blood_pct', p_blood_pct, 'alt_odds', p_alt_odds, 'rare_slots', p_rare_slots,
                       'guarantee_every', coalesce(p_guarantee_every, v_before.guarantee_every),
                       'legend_mult', coalesce(p_legend_mult, v_before.legend_mult)));
end $$;
revoke execute on function public.admin_save_god_settings(integer, numeric, integer, integer, text, integer, integer) from public, anon;
grant execute on function public.admin_save_god_settings(integer, numeric, integer, integer, text, integer, integer) to authenticated;

drop sequence private.pack_opening_seq;
