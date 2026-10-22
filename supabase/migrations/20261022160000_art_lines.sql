-- CARTEMA — lignes de versions alternatives (22/10/2026). Une ligne regroupe les versions alternatives
-- qui portent le même nom (ex. « Version Paint » sur plusieurs personnages). Pour chaque ligne :
--  * active : désactivée, aucune de ses versions ne tombe plus (les exemplaires possédés la gardent) ;
--  * odds : chance « 1 sur N » propre à la ligne ; vide = réglage global alternate_art_odds, 0 = jamais.
-- Au tirage d'un personnage, chaque ligne qu'il possède est tentée avec sa propre chance, dans un
-- ordre aléatoire ; la première réussie donne la version (au hasard parmi celles de la ligne).
-- Sans réglage de ligne, un personnage qui n'a qu'une ligne se comporte comme avant.

create table public.card_art_lines (
  label text primary key check (length(trim(label)) > 0),
  active boolean not null default true,
  odds integer check (odds is null or odds between 0 and 1000000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.card_art_lines enable row level security;

-- Version alternative tirée pour ce personnage, ou null (illustration officielle).
create function private.pick_alternate_art(p_character uuid, p_global_odds integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_line record;
begin
  for v_line in
    select a.label, coalesce(l.odds, p_global_odds, 0) as odds, count(*)::int as n
      from public.card_arts a
      left join public.card_art_lines l on l.label = a.label
     where a.character_id = p_character and a.kind = 'alternate' and a.active and coalesce(l.active, true)
     group by a.label, l.odds
     order by random()
  loop
    if v_line.odds > 0 and private.random_below(v_line.odds) = 0 then
      return (select a.id from public.card_arts a
               where a.character_id = p_character and a.kind = 'alternate' and a.active and a.label = v_line.label
               order by a.id offset private.random_below(v_line.n) limit 1);
    end if;
  end loop;
  return null;
end $$;

create function public.admin_art_lines() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'global_odds', coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'active', coalesce(l.active, true), 'odds', l.odds,
        'arts', x.arts, 'active_arts', x.active_arts, 'characters', x.characters, 'owned', x.owned) order by x.label)
      from (select a.label, count(*) as arts, count(*) filter (where a.active) as active_arts,
                   count(distinct a.character_id) as characters,
                   (select count(*) from public.inventory_items i join public.card_arts a2 on a2.id = i.art_id
                     where a2.label = a.label and a2.kind = 'alternate' and i.recycled_at is null) as owned
              from public.card_arts a where a.kind = 'alternate' group by a.label) x
      left join public.card_art_lines l on l.label = x.label), '[]'::jsonb));
end $$;

-- p_odds null = chance globale.
create function public.admin_set_art_line(p_label text, p_active boolean, p_odds integer, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.card_art_lines;
begin
  if not exists (select 1 from public.card_arts where label = p_label and kind = 'alternate') then raise exception 'not_found'; end if;
  if p_odds is not null and (p_odds < 0 or p_odds > 1000000) then raise exception 'invalid_odds'; end if;
  select * into v_before from public.card_art_lines where label = p_label for update;
  insert into public.card_art_lines (label, active, odds, updated_by)
    values (p_label, coalesce(p_active, true), p_odds, v_admin)
    on conflict (label) do update set active = excluded.active, odds = excluded.odds,
                                      updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(v_admin, 'art_line', null, v_reason,
    case when v_before.label is not null then jsonb_build_object('label', p_label, 'active', v_before.active, 'odds', v_before.odds) end,
    jsonb_build_object('label', p_label, 'active', coalesce(p_active, true), 'odds', p_odds));
end $$;

-- Tirage : reprise de open_booster (20261021140000_card_arts), seul le choix de la version change.
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

  v_pool := coalesce(p_pool, case when v_balance.free_count > 0 then 'free' else 'purchased' end);
  if v_pool = 'free' and v_balance.free_count > 0 then
    update public.booster_balances set free_count = free_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool = 'purchased' and v_balance.purchased_count > 0 then
    update public.booster_balances set purchased_count = purchased_count - 1, updated_at = now() where owner_id = v_uid;
  elsif v_pool not in ('free', 'purchased') then
    raise exception 'invalid_pool';
  else
    raise exception 'no_booster_available';
  end if;

  -- Événement en cours : finitions rares plus fréquentes (le plus fort s'applique).
  select e.finish_multiplier, e.id into v_finish_multiplier, v_event
    from private.active_events() e where e.finish_multiplier > 1 order by e.finish_multiplier desc limit 1;

  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id, event_id)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id, v_event)
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
      v_rarity := private.pick_weighted(v_ruleset.slots->(v_pos - 1))::public.rarity;
      select array_agg(c.id order by c.id) into v_candidates
        from public.characters c
       where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity and not c.is_unique;
      if v_candidates is null then
        -- Jamais de repli vers une autre rareté ou édition (CDC §4).
        raise exception 'edition_incomplete';
      end if;
      v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
      v_finish := private.pick_weighted(private.event_finishes(v_ruleset.finishes, v_finish_multiplier))::public.finish;
      v_art := private.pick_alternate_art(v_character, v_alt_odds);
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

  return private.opening_result(v_opening_id) || jsonb_build_object('replayed', false);
end $$;

revoke execute on function private.pick_alternate_art(uuid, integer) from public, anon, authenticated;
revoke execute on function public.admin_art_lines(), public.admin_set_art_line(text, boolean, integer, text) from public, anon;
grant execute on function public.admin_art_lines(), public.admin_set_art_line(text, boolean, integer, text) to authenticated;
