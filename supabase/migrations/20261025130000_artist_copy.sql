-- CARTEMA — exemplaire de l'artiste (décision de Swiiptz, 25/10/2026). La carte offerte à l'auteur d'un dessin
-- retenu au concours est liée 30 jours : ni vente, ni échange, ni don (inventory_items.artist_until), puis libre.
-- La mention « Exemplaire de l'artiste » reste sur l'exemplaire (artist_copy). Recyclage et verrouillage permis.
-- Version alternative offerte en contour classique (la version est déjà rare) ; l'officielle garde sa finition
-- selon la rareté (Sanglante jusqu'aux Très rares, Dorée pour une Épique, classique au-delà).
-- Les dessins de CAM 1 n'étant pas encore choisis, ces règles valent pour CAM 1.

alter table public.inventory_items add column artist_until timestamptz;
comment on column public.inventory_items.artist_until is 'Exemplaire de l''artiste (concours) : lié jusqu''à cette date ; non nul = mention gardée.';

create or replace function public.admin_decide_contest_entry(p_entry_id uuid, p_selected text, p_line_label text, p_real_drawing boolean,
                                                  p_art_path text, p_art_meta jsonb, p_reason text,
                                                  p_half boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_entry public.contest_entries;
  v_contest public.contests;
  v_char public.characters;
  v_art uuid;
  v_finish public.finish;
  v_instance uuid;
begin
  select * into v_entry from public.contest_entries where id = p_entry_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into v_contest from public.contests where id = v_entry.contest_id;
  if v_contest.ends_at > now() then raise exception 'contest_open'; end if;
  if p_selected is not null and p_selected not in ('main', 'alternate') then raise exception 'invalid_kind'; end if;
  if v_entry.selected is not null and p_selected is distinct from v_entry.selected then raise exception 'already_decided'; end if;
  select * into v_char from public.characters where id = v_entry.character_id for update;

  if p_selected is not null and v_entry.selected is null then
    perform private.assert_art(p_art_path, coalesce(p_art_meta, '{}'::jsonb));
    if p_art_path is null then raise exception 'invalid_art_path'; end if;
    if p_selected = 'main' then
      -- Le déclencheur garde l'ancienne illustration sur les exemplaires déjà possédés.
      update public.characters set art_path = p_art_path, art_meta = coalesce(p_art_meta, '{}'::jsonb),
                                   art_credit = (select handle from public.profiles where id = v_entry.author_id)
       where id = v_char.id;
      v_art := null;
    else
      insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, created_by)
        values (v_char.id, 'alternate', coalesce(nullif(trim(p_line_label), ''), 'Version du concours'), p_art_path,
                coalesce(p_art_meta, '{}'::jsonb), (select handle from public.profiles where id = v_entry.author_id), v_admin)
        returning id into v_art;
    end if;
    -- Carte offerte à l'auteur, avec cette illustration.
    v_finish := case when p_selected = 'alternate' then 'Standard'
                     when v_char.rarity in ('Commun', 'Peu commun', 'Rare', 'Très rare') then 'Sanglante'
                     when v_char.rarity = 'Épique' then 'Dorée' else 'Standard' end;
    -- Exemplaire de l'artiste : lié 30 jours (ni vente, ni échange, ni don).
    insert into public.inventory_items (owner_id, character_id, finish, art_id, artist_until)
      values (v_entry.author_id, v_char.id, v_finish, v_art, now() + interval '30 days') returning id into v_instance;
    insert into public.discoveries (owner_id, character_id) values (v_entry.author_id, v_char.id) on conflict do nothing;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (v_entry.author_id, v_char.id, v_finish)
      on conflict do nothing;
    -- Version alternative : point plein ou demi-point (choix de l'admin ; plein si non précisé).
    update public.contest_entries set selected = p_selected, line_label = nullif(trim(p_line_label), ''),
                                      half_point = p_selected = 'alternate' and coalesce(p_half, false),
                                      granted_instance = v_instance, decided_at = now()
     where id = p_entry_id;
    perform private.notify(v_entry.author_id, 'contest_selected', jsonb_build_object(
      'character', v_char.name, 'finish', v_finish, 'label', case when p_selected = 'main' then 'Illustration officielle' else coalesce(nullif(trim(p_line_label), ''), 'Version du concours') end));
  end if;

  update public.contest_entries set real_drawing = coalesce(p_real_drawing, real_drawing), decided_at = coalesce(decided_at, now())
   where id = p_entry_id;
  perform private.audit(v_admin, 'contest_decide', p_entry_id, v_reason, null,
    jsonb_build_object('selected', p_selected, 'line', p_line_label, 'real_drawing', p_real_drawing, 'instance', v_instance,
                       'half', p_half));
  return jsonb_build_object('selected', coalesce(p_selected, v_entry.selected), 'instance', v_instance, 'finish', v_finish);
end $$;

create or replace function private.check_card_cooldown() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz;
  v_artist timestamptz;
begin
  select private.cooldown_until(social_received_at), artist_until into v_until, v_artist
    from public.inventory_items where id = new.instance_id;
  if v_artist > now() then
    raise exception 'artist_copy' using detail = v_artist::text;
  end if;
  if v_until is not null then
    raise exception 'card_cooldown' using detail = v_until::text;
  end if;
  return new;
end $$;

create or replace function public.get_inventory(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_settings jsonb := (private.active_settings()).settings;
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'instance_id', i.id, 'finish', i.finish, 'locked', i.locked, 'reserved', i.reserved_kind is not null,
      'reserved_kind', i.reserved_kind, 'listing_id', case when i.reserved_kind in ('listing', 'auction') then i.reserved_ref end,
      'listing_price', (select coalesce(l.current_bid, l.price) from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'listing_kind', (select l.kind from public.listings l where l.id = i.reserved_ref and l.status = 'active'),
      'acquired_at', i.acquired_at, 'unique', c.is_unique, 'cooldown_until', private.cooldown_until(i.social_received_at),
      'artist_copy', i.artist_until is not null, 'artist_until', case when i.artist_until > now() then i.artist_until end,
      'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

create or replace function public.get_friend_cards(p_friend_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if p_friend_id <> v_uid and not private.are_friends(v_uid, p_friend_id) then raise exception 'not_friends'; end if;
  return coalesce((select jsonb_agg(private.card_json(i.character_id, i.finish, i.id) order by c.number, i.finish)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = p_friend_id and i.recycled_at is null and not i.locked and i.reserved_kind is null
     and private.cooldown_until(i.social_received_at) is null
     and (i.artist_until is null or i.artist_until <= now())
     and (p_friend_id = v_uid or private.card_return_until(i.id, v_uid) is null)), '[]'::jsonb);
end $$;
