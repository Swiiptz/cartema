-- CARTEMA — versions d'illustration protégées au recyclage (décision de Swiiptz, 26/10/2026).
-- « Recycler les doublons » prenait les exemplaires Standard au-delà du plus ancien, sans regarder la version :
-- 76 versions (alternatives et anciennes officielles) recyclées depuis le 22/10, dont une trentaine dans des lots
-- de doublons (ex. Barthélémy Duchemin « Version alternative » de Sisiiii, lot de 106 le 22/10).
-- Une version d'illustration est désormais traitée comme une finition rare (Dorée, Sanglante) :
--  * jamais prise par le recyclage des doublons, et elle ne compte pas comme l'exemplaire gardé ;
--  * recycler à la main demande la même confirmation (confirm_special_finish).

-- Recyclage rapide : uniquement les Standards non verrouillées en illustration officielle, en gardant p_keep
-- exemplaires par personnage (les plus anciens). Ne touche jamais aux finitions spéciales ni aux versions.
create or replace function private.duplicate_standards(p_owner uuid, p_keep integer) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select i.id, row_number() over (partition by i.character_id order by i.acquired_at, i.id) as rank
      from public.inventory_items i join public.characters c on c.id = i.character_id
     where i.owner_id = p_owner and i.recycled_at is null and i.finish = 'Standard' and i.art_id is null
       and not i.locked and i.reserved_kind is null and not c.is_unique
  ) ranked where rank > greatest(p_keep, 0)
$$;

create or replace function public.recycle_cards(p_instance_ids uuid[], p_request_id uuid, p_confirm_special boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings public.economy_settings := private.active_settings();
  v_ids uuid[];
  v_op public.recycling_operations;
  v_items jsonb;
  v_total bigint;
  v_balance bigint;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_op from public.recycling_operations where owner_id = v_uid and request_id = p_request_id;
  if found then
    return jsonb_build_object('operation_id', v_op.id, 'total', v_op.total, 'count', jsonb_array_length(v_op.items),
      'balance', (select balance from public.wallets where owner_id = v_uid), 'replayed', true);
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_instance_ids) x where x is not null;
  if v_ids is null then raise exception 'nothing_to_recycle'; end if;
  if cardinality(v_ids) > 500 then raise exception 'too_many_cards'; end if;

  -- Verrou des exemplaires : deux recyclages, ventes ou cadeaux concurrents sont sérialisés.
  perform 1 from public.inventory_items where id = any (v_ids) for update;
  if (select count(*) from public.inventory_items i
       where i.id = any (v_ids) and i.owner_id = v_uid and i.recycled_at is null) <> cardinality(v_ids) then
    raise exception 'not_owned';
  end if;
  if exists (select 1 from public.inventory_items i where i.id = any (v_ids) and i.locked) then
    raise exception 'card_locked';
  end if;
  if exists (select 1 from public.inventory_items i where i.id = any (v_ids) and i.reserved_kind is not null) then
    raise exception 'card_reserved';
  end if;
  if exists (select 1 from public.inventory_items i join public.characters c on c.id = i.character_id
              where i.id = any (v_ids) and c.is_unique) then
    raise exception 'unique_indestructible';
  end if;
  if not coalesce(p_confirm_special, false)
     and exists (select 1 from public.inventory_items i where i.id = any (v_ids) and (i.finish <> 'Standard' or i.art_id is not null)) then
    raise exception 'confirm_special_finish';
  end if;

  select jsonb_agg(jsonb_build_object('instance_id', i.id, 'character_id', c.id, 'rarity', c.rarity, 'finish', i.finish,
           'value', private.recycle_value(c.rarity, i.finish, v_settings.settings))),
         sum(private.recycle_value(c.rarity, i.finish, v_settings.settings))
    into v_items, v_total
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.id = any (v_ids);

  insert into public.recycling_operations (owner_id, request_id, items, total, settings_version)
    values (v_uid, p_request_id, v_items, v_total, v_settings.version)
    returning * into v_op;
  update public.inventory_items set recycled_at = now() where id = any (v_ids);
  v_balance := private.apply_wallet_delta(v_uid, v_total, 'recycle', 'recycling_operation', v_op.id, 'recycle:' || v_op.id);
  return jsonb_build_object('operation_id', v_op.id, 'total', v_total, 'count', cardinality(v_ids),
    'balance', v_balance, 'replayed', false);
end $$;
