-- CARTEMA — protéger un personnage, recycler les doublons par rareté (doléances du 29/10, 10/11/2026).
--  * protected_characters : un personnage protégé n'est jamais recyclé, aucun de ses exemplaires, présents ou à venir
--    (déclencheur sur inventory_items : vaut pour la fiche, les doublons et toute autre voie). Le verrou par
--    exemplaire reste, et protège aussi de la vente ; la protection d'un personnage ne touche qu'au recyclage.
--  * set_character_protected(personnage, oui/non) : seulement pour un personnage découvert. get_inventory renvoie « protected ».
--  * preview_duplicates / recycle_duplicates : liste de raretés en option (null = toutes), personnages protégés exclus.

create table public.protected_characters (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  created_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);
alter table public.protected_characters enable row level security;

create function private.guard_protected_recycle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.protected_characters p where p.owner_id = new.owner_id and p.character_id = new.character_id) then
    raise exception 'character_protected';
  end if;
  return new;
end $$;
revoke execute on function private.guard_protected_recycle() from public, anon, authenticated;
create trigger inventory_protected_recycle before update of recycled_at on public.inventory_items
  for each row when (old.recycled_at is null and new.recycled_at is not null) execute function private.guard_protected_recycle();

create function public.set_character_protected(p_character_id uuid, p_protected boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if not exists (select 1 from public.discoveries where owner_id = v_uid and character_id = p_character_id) then
    raise exception 'not_discovered';
  end if;
  if p_protected then
    insert into public.protected_characters (owner_id, character_id) values (v_uid, p_character_id) on conflict do nothing;
  else
    delete from public.protected_characters where owner_id = v_uid and character_id = p_character_id;
  end if;
  return p_protected;
end $$;
revoke execute on function public.set_character_protected(uuid, boolean) from public, anon;
grant execute on function public.set_character_protected(uuid, boolean) to authenticated;

-- Reprise de 20261026170000_recycle_versions : raretés choisies, personnages protégés exclus.
drop function private.duplicate_standards(uuid, integer);
create function private.duplicate_standards(p_owner uuid, p_keep integer, p_rarities public.rarity[] default null) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from (
    select i.id, row_number() over (partition by i.character_id order by i.acquired_at, i.id) as rank
      from public.inventory_items i join public.characters c on c.id = i.character_id
     where i.owner_id = p_owner and i.recycled_at is null and i.finish = 'Standard' and i.art_id is null
       and not i.locked and i.reserved_kind is null and not c.is_unique
       and (p_rarities is null or c.rarity = any (p_rarities))
       and not exists (select 1 from public.protected_characters p where p.owner_id = p_owner and p.character_id = i.character_id)
  ) ranked where rank > greatest(p_keep, 0)
$$;
revoke execute on function private.duplicate_standards(uuid, integer, public.rarity[]) from public, anon, authenticated;

drop function public.preview_duplicates(integer);
create function public.preview_duplicates(p_keep integer default 1, p_rarities public.rarity[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
  v_ids uuid[] := private.duplicate_standards(v_uid, p_keep, p_rarities);
begin
  return jsonb_build_object('count', cardinality(v_ids),
    'total', coalesce((select sum(private.recycle_value(c.rarity, i.finish, v_settings))
                         from public.inventory_items i join public.characters c on c.id = i.character_id
                        where i.id = any (v_ids)), 0),
    'by_rarity', coalesce((select jsonb_object_agg(r, n) from (
                   select c.rarity::text as r, count(*) as n from public.inventory_items i join public.characters c on c.id = i.character_id
                    where i.id = any (v_ids) group by c.rarity) x), '{}'::jsonb));
end $$;

drop function public.recycle_duplicates(uuid, integer);
create function public.recycle_duplicates(p_request_id uuid, p_keep integer default 1, p_rarities public.rarity[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_ids uuid[];
begin
  if exists (select 1 from public.recycling_operations where owner_id = v_uid and request_id = p_request_id) then
    return public.recycle_cards('{}', p_request_id, false);
  end if;
  v_ids := private.duplicate_standards(v_uid, p_keep, p_rarities);
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('total', 0, 'count', 0, 'replayed', false,
      'balance', (select balance from public.wallets where owner_id = v_uid));
  end if;
  return public.recycle_cards(v_ids, p_request_id, false);
end $$;
revoke execute on function public.preview_duplicates(integer, public.rarity[]), public.recycle_duplicates(uuid, integer, public.rarity[]) from public, anon;
grant execute on function public.preview_duplicates(integer, public.rarity[]), public.recycle_duplicates(uuid, integer, public.rarity[]) to authenticated;

-- Reprise de 20261028100000_credit_on_versions : « protected » sur chaque exemplaire.
create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
  v_protected boolean := exists (select 1 from public.protected_characters p where p.owner_id = v_uid and p.character_id = p_character_id);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'protected', v_protected, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind in ('listing', 'auction') then i.reserved_ref end,
      'listing_price', (select coalesce(l.current_bid, l.price) from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'listing_kind', (select l.kind from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique, 'cooldown_until', private.cooldown_until(i.social_received_at),
      'artist_copy', i.artist_until is not null, 'signed', i.signed, 'signature', case when i.signed then c.signature_path end, 'artist_until', case when i.artist_until > now() then i.artist_until end,
      'art_id', i.art_id, 'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;
