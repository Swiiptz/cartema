-- CARTEMA — demande de crédit sur une version d'illustration (décision de Swiiptz, 28/10/2026). Un joueur peut
-- demander le crédit d'une version alternative (ou d'une ancienne illustration) qu'il possède ou a possédée, pas
-- seulement de l'illustration officielle. L'admin voit la version dans la demande et pose le crédit sur elle
-- (admin_set_art_credit avec l'identifiant de la version, déjà en place).
--  * card_submissions.art_id : version visée (null = illustration officielle).
--  * Une demande en attente par personnage, sorte ET version : officielle et version peuvent attendre ensemble.
--  * get_inventory donne l'identifiant de la version de chaque exemplaire (choix de la version dans le formulaire).

alter table public.card_submissions add column art_id uuid references public.card_arts(id);
comment on column public.card_submissions.art_id is 'Version d''illustration visée par une demande de crédit (null = officielle).';
drop index public.card_submissions_pending;
create unique index card_submissions_pending on public.card_submissions
  (owner_id, character_id, kind, coalesce(art_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';

drop function public.submit_card_feedback(text, text, text, text, text);
create function public.submit_card_feedback(p_code text, p_kind text, p_message text, p_image_path text default null,
                                            p_credit_name text default null, p_art_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_character uuid := private.character_by_code(p_code);
  v_id uuid;
begin
  if v_character is null then raise exception 'not_found'; end if;
  -- On ne propose rien sur une carte jamais vue (son identité resterait cachée à l'auteur).
  if not exists (select 1 from public.discoveries where owner_id = v_uid and character_id = v_character) then raise exception 'not_discovered'; end if;
  if p_kind not in ('info', 'illustration', 'credit', 'ambiance', 'signature') then raise exception 'invalid_kind'; end if;
  if p_kind in ('ambiance', 'signature') and not private.next_set_on() then raise exception 'feature_locked'; end if;
  -- Texte d'ambiance : 10 à 200 caractères.
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) < 10 then raise exception 'message_required'; end if;
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) > 200 then raise exception 'too_long'; end if;
  if p_kind = 'credit' and length(trim(coalesce(p_credit_name, ''))) not between 2 and 80 then raise exception 'credit_required'; end if;
  -- Version d'illustration visée (demande de crédit seulement) : une version de ce personnage, que le joueur a
  -- possédée au moins une fois.
  if p_art_id is not null then
    if p_kind <> 'credit' then raise exception 'invalid_kind'; end if;
    if not exists (select 1 from public.card_arts where id = p_art_id and character_id = v_character and kind in ('alternate', 'legacy')) then
      raise exception 'not_found';
    end if;
    if not exists (select 1 from public.inventory_items where owner_id = v_uid and art_id = p_art_id) then raise exception 'version_not_owned'; end if;
  end if;
  if p_kind = 'info' and length(trim(coalesce(p_message, ''))) < 5 then raise exception 'message_required'; end if;
  if p_kind in ('illustration', 'signature') and (p_image_path is null or split_part(p_image_path, '/', 1) <> v_uid::text or p_image_path like '%..%') then
    raise exception 'image_required';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.card_submissions where owner_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_submissions';
  end if;
  insert into public.card_submissions (owner_id, character_id, kind, message, image_path, credit_name, art_id)
    values (v_uid, v_character, p_kind, left(trim(coalesce(p_message, '')), 1500), case when p_kind in ('illustration', 'signature') then p_image_path end,
            nullif(trim(coalesce(p_credit_name, '')), ''), p_art_id)
    on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'already_submitted'; end if;
  perform private.notify((select id from public.profiles where role = 'admin' limit 1), 'submission_received',
    jsonb_build_object('from', private.handle_of(v_uid), 'kind', p_kind,
                       'card', (select name from public.characters where id = v_character)));
  return v_id;
end $$;

create or replace function public.admin_submissions(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'message', s.message,
      'image_path', s.image_path, 'credit_name', s.credit_name, 'art_credit', c.art_credit,
      'art_id', s.art_id, 'version', a.label, 'version_art_path', a.art_path, 'version_credit', a.credit, 'created_at', s.created_at, 'decided_at', s.decided_at, 'admin_note', s.admin_note,
      'reward_deniers', s.reward_deniers, 'reward_boosters', s.reward_boosters,
      'author', (select handle from public.profiles where id = s.owner_id),
      'character_id', c.id, 'name', c.name, 'number', c.number, 'prefix', e.prefix, 'rarity', c.rarity,
      'role_title', c.role_title, 'clan', (select name from public.clans where id = c.clan_id),
      'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key) order by s.created_at desc)
    from (select * from public.card_submissions where p_status = 'all' or status = p_status order by created_at desc limit 100) s
    join public.characters c on c.id = s.character_id join public.editions e on e.id = c.edition_id
    left join public.card_arts a on a.id = s.art_id), '[]'::jsonb);
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
      'artist_copy', i.artist_until is not null, 'signed', i.signed, 'signature', case when i.signed then c.signature_path end, 'artist_until', case when i.artist_until > now() then i.artist_until end,
      'art_id', i.art_id, 'variant', a.label, 'variant_kind', a.kind, 'variant_art', a.art_path, 'variant_meta', a.art_meta,
      'value', case when c.is_unique then 0 else private.recycle_value(c.rarity, i.finish, v_settings) end)
      order by i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
    left join public.card_arts a on a.id = i.art_id
   where i.owner_id = v_uid and i.character_id = p_character_id and i.recycled_at is null), '[]'::jsonb);
end $$;

revoke execute on function public.submit_card_feedback(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.submit_card_feedback(text, text, text, text, text, uuid) to authenticated;
