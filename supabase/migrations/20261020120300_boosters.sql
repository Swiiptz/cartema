-- CARTEMA — boucle booster : crédits gratuits, boutique, ouverture atomique, album.

-- ---------------------------------------------------------------- aléa cryptographique
-- Entier uniforme dans [0, p_n[ par échantillonnage avec rejet (pas de biais modulo).
create function private.random_below(p_n bigint) returns bigint
language plpgsql volatile set search_path = '' as $$
declare
  v_bytes bytea;
  v_value bigint;
  v_limit bigint;
begin
  if p_n is null or p_n < 1 or p_n > 4294967296 then
    raise exception 'random_below: borne invalide %', p_n;
  end if;
  v_limit := 4294967296 - (4294967296 % p_n);
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_value := (get_byte(v_bytes, 0)::bigint << 24) | (get_byte(v_bytes, 1)::bigint << 16)
             | (get_byte(v_bytes, 2)::bigint << 8) | get_byte(v_bytes, 3)::bigint;
    if v_value < v_limit then
      return v_value % p_n;
    end if;
  end loop;
end $$;

create function private.pick_weighted(p_table jsonb) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_roll bigint := private.random_below(100000);
  v_acc bigint := 0;
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_table) loop
    v_acc := v_acc + (v_item->>'weight')::bigint;
    if v_roll < v_acc then
      return v_item->>'value';
    end if;
  end loop;
  raise exception 'invalid_weights: table non normalisée';
end $$;

-- ---------------------------------------------------------------- portefeuille
-- Seul point d'écriture des soldes. Idempotent : une clé déjà appliquée renvoie
-- le solde courant sans rien réécrire.
create function private.apply_wallet_delta(
  p_owner uuid, p_delta bigint, p_kind text, p_ref_type text, p_ref_id uuid, p_key text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_balance bigint;
begin
  select w.balance into v_balance from public.wallets w where w.owner_id = p_owner for update;
  if not found then
    raise exception 'wallet_missing';
  end if;
  if exists (select 1 from public.wallet_ledger l where l.owner_id = p_owner and l.idempotency_key = p_key) then
    return v_balance;
  end if;
  if v_balance + p_delta < 0 then
    raise exception 'insufficient_funds' using hint = format('Solde %s, requis %s', v_balance, -p_delta);
  end if;
  v_balance := v_balance + p_delta;
  update public.wallets set balance = v_balance, updated_at = now() where owner_id = p_owner;
  insert into public.wallet_ledger (owner_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key)
    values (p_owner, p_delta, v_balance, p_kind, p_ref_type, p_ref_id, p_key);
  return v_balance;
end $$;

-- ---------------------------------------------------------------- boosters gratuits
-- Rattrapage paresseux et idempotent : chaque créneau 06 h / 18 h Paris n'est traité
-- qu'une fois (verrou de ligne + free_synced_until + index unique par créneau).
-- Les gains au-delà de la capacité sont perdus (CDC §4).
create function private.sync_free_boosters(p_owner uuid, p_at timestamptz default now())
returns public.booster_balances language plpgsql security definer set search_path = '' as $$
declare
  v_row public.booster_balances;
  v_capacity integer := ((private.active_settings()).settings->>'free_booster_capacity')::int;
  v_slot timestamptz;
begin
  select * into v_row from public.booster_balances b where b.owner_id = p_owner for update;
  if not found then
    raise exception 'booster_balance_missing';
  end if;
  for v_slot in select s from private.free_slots_between(v_row.free_synced_until, p_at) s loop
    if v_row.free_count < v_capacity then
      v_row.free_count := v_row.free_count + 1;
      insert into public.booster_grants (owner_id, source, pool, quantity, slot_at)
        values (p_owner, 'free_slot', 'free', 1, v_slot);
    end if;
    v_row.free_synced_until := v_slot;
  end loop;
  update public.booster_balances
     set free_count = v_row.free_count, free_synced_until = v_row.free_synced_until, updated_at = now()
   where owner_id = p_owner
   returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------- état du joueur
create function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role, 'created_at', p.created_at)
                from public.profiles p where p.id = v_uid),
    'balance', (select w.balance from public.wallets w where w.owner_id = v_uid),
    'boosters', jsonb_build_object(
      'free', v_boosters.free_count,
      'purchased', v_boosters.purchased_count,
      'free_capacity', (v_settings->>'free_booster_capacity')::int,
      'next_free_at', (select min(s) from private.free_slots_between(now(), now() + interval '1 day') s)),
    'booster_offers', v_settings->'booster_offers',
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix,
               'cover_path', e.cover_path, 'openable', private.edition_is_complete(e.id)) order by e.created_at)
      from public.editions e
      where e.packs_enabled and e.archived_at is null), '[]'::jsonb)
  );
end $$;
grant execute on function public.get_player_state() to authenticated;

-- ---------------------------------------------------------------- boutique
-- Décision : les boosters achetés ne sont pas liés à une édition ; l'édition est
-- choisie à l'ouverture, comme pour les gratuits. L'achat exige qu'au moins une
-- édition soit ouvrable, l'ouverture revérifie l'édition choisie.
create function public.buy_boosters(p_quantity integer, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings public.economy_settings := private.active_settings();
  v_price bigint;
  v_order public.shop_orders;
  v_balance bigint;
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;
  -- Verrou du compteur avant toute lecture : sérialise les achats d'un même joueur.
  perform 1 from public.booster_balances where owner_id = v_uid for update;

  select * into v_order from public.shop_orders where owner_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'replayed', true,
      'balance', (select balance from public.wallets where owner_id = v_uid),
      'purchased', (select purchased_count from public.booster_balances where owner_id = v_uid));
  end if;

  v_price := (v_settings.settings->'booster_offers'->>p_quantity::text)::bigint;
  if v_price is null then
    raise exception 'invalid_offer';
  end if;
  if not exists (select 1 from public.editions e
                 where e.packs_enabled and e.archived_at is null and private.edition_is_complete(e.id)) then
    raise exception 'no_openable_edition';
  end if;

  insert into public.shop_orders (owner_id, quantity, price, settings_version, request_id)
    values (v_uid, p_quantity, v_price, v_settings.version, p_request_id)
    returning * into v_order;
  v_balance := private.apply_wallet_delta(v_uid, -v_price, 'shop_booster', 'shop_order', v_order.id,
                                          'shop:' || v_order.id);
  update public.booster_balances set purchased_count = purchased_count + p_quantity, updated_at = now()
   where owner_id = v_uid;
  insert into public.booster_grants (owner_id, source, pool, quantity, ref_id)
    values (v_uid, 'shop', 'purchased', p_quantity, v_order.id);

  return jsonb_build_object('order_id', v_order.id, 'replayed', false, 'balance', v_balance,
    'purchased', (select purchased_count from public.booster_balances where owner_id = v_uid));
end $$;
grant execute on function public.buy_boosters(integer, uuid) to authenticated;

-- ---------------------------------------------------------------- ouverture
create function private.opening_result(p_opening_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'opening_id', o.id,
    'edition_id', o.edition_id,
    'ruleset_version', r.version,
    'pool', o.pool,
    'created_at', o.created_at,
    'cards', (
      select jsonb_agg(jsonb_build_object(
        'position', pc.position,
        'instance_id', pc.instance_id,
        'character_id', c.id,
        'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
        'number', c.number,
        'name', c.name,
        'role_title', c.role_title,
        'clan', cl.name,
        'rarity', pc.rarity,
        'finish', pc.finish,
        'art_path', c.art_path,
        'art_meta', c.art_meta,
        'silhouette_key', c.silhouette_key) order by pc.position)
      from public.pack_opening_cards pc
      join public.characters c on c.id = pc.character_id
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      where pc.opening_id = o.id))
  from public.pack_openings o
  join public.pack_rulesets r on r.id = o.ruleset_id
  where o.id = p_opening_id
$$;

-- Tout ou rien : débit d'un booster, tirage, 5 exemplaires, découvertes, récompenses
-- et historique dans la même transaction. Un même p_request_id renvoie le même
-- résultat sans retirer : l'animation peut être rejouée après un rechargement.
create function public.open_booster(p_edition_id uuid, p_request_id uuid, p_pool text default null)
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

  insert into public.pack_openings (owner_id, edition_id, ruleset_id, pool, request_id)
    values (v_uid, p_edition_id, v_ruleset.id, v_pool, p_request_id)
    returning id into v_opening_id;

  for v_pos in 1..5 loop
    v_rarity := private.pick_weighted(v_ruleset.slots->(v_pos - 1))::public.rarity;
    select array_agg(c.id order by c.id) into v_candidates
      from public.characters c
     where c.edition_id = p_edition_id and c.status = 'published' and c.rarity = v_rarity;
    if v_candidates is null then
      -- Jamais de repli vers une autre rareté ou édition (CDC §4).
      raise exception 'edition_incomplete';
    end if;
    v_character := v_candidates[1 + private.random_below(cardinality(v_candidates))];
    v_finish := private.pick_weighted(v_ruleset.finishes)::public.finish;

    insert into public.inventory_items (owner_id, character_id, finish, origin_opening_id)
      values (v_uid, v_character, v_finish, v_opening_id)
      returning id into v_instance;
    insert into public.pack_opening_cards (opening_id, position, instance_id, character_id, rarity, finish)
      values (v_opening_id, v_pos, v_instance, v_character, v_rarity, v_finish);

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
grant execute on function public.open_booster(uuid, uuid, text) to authenticated;

-- Relecture d'une ouverture passée (reprise d'animation, historique).
create function public.get_opening(p_opening_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if not exists (select 1 from public.pack_openings o where o.id = p_opening_id and o.owner_id = v_uid) then
    raise exception 'not_found';
  end if;
  return private.opening_result(p_opening_id);
end $$;
grant execute on function public.get_opening(uuid) to authenticated;

-- ---------------------------------------------------------------- album
-- Les cartes non découvertes ne renvoient que numéro, rareté et silhouette :
-- aucun nom, clan, fonction ni portrait ne quitte la base.
create function public.get_album(p_edition_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((
    select jsonb_agg(card order by edition_created, number)
    from (
      select e.created_at as edition_created, c.number,
        case when d.character_id is not null then jsonb_build_object(
          'character_id', c.id, 'known', true,
          'edition_id', e.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
          'rarity', c.rarity, 'name', c.name, 'role_title', c.role_title, 'clan', cl.name,
          'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key,
          'discovered_at', d.first_seen_at,
          'finishes_seen', (select coalesce(jsonb_agg(fd.finish order by fd.finish), '[]'::jsonb)
                              from public.finish_discoveries fd
                             where fd.owner_id = v_uid and fd.character_id = c.id),
          'owned', (select coalesce(jsonb_object_agg(x.finish, x.n), '{}'::jsonb) from (
                      select i.finish, count(*) as n from public.inventory_items i
                       where i.owner_id = v_uid and i.character_id = c.id group by i.finish) x))
        else jsonb_build_object(
          'known', false, 'edition_id', e.id,
          'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
          'rarity', c.rarity, 'silhouette_key', c.silhouette_key)
        end as card
      from public.characters c
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.discoveries d on d.character_id = c.id and d.owner_id = v_uid
      where c.status = 'published' and e.album_published and e.archived_at is null
        and (p_edition_id is null or e.id = p_edition_id)
    ) album), '[]'::jsonb);
end $$;
grant execute on function public.get_album(uuid) to authenticated;

-- ---------------------------------------------------------------- verrouillage final des droits
-- Ceinture et bretelles : seules les RPC listées ici sont appelables par un joueur.
revoke execute on all functions in schema public, private from public, anon, authenticated;
grant execute on function
  public.set_handle(text),
  public.get_player_state(),
  public.buy_boosters(integer, uuid),
  public.open_booster(uuid, uuid, text),
  public.get_opening(uuid),
  public.get_album(uuid)
to authenticated;
