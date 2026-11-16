-- CARTEMA — signatures en PNG seulement (16/11/2026, set 2).
-- Le site trace ou importe la signature, vérifie le fond transparent et la taille, la rogne et l'envoie en PNG.
-- Le serveur refuse désormais toute contribution « signature » dont le fichier n'est pas un .png (png_required).
-- Reprise de 20261028100000_credit_on_versions (même signature : droits inchangés).

create or replace function public.submit_card_feedback(p_code text, p_kind text, p_message text, p_image_path text default null,
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
  -- Signature : PNG seulement. Le site vérifie la transparence et la taille, puis envoie toujours un PNG rogné.
  if p_kind = 'signature' and lower(p_image_path) !~ '\.png$' then raise exception 'png_required'; end if;
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
