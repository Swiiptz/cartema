-- CARTEMA — exemplaire de l'artiste sans délai (décision de Swiiptz, 26/10/2026). La carte offerte à l'auteur
-- d'un dessin retenu au concours n'est plus liée 30 jours : elle se vend, s'échange et s'offre tout de suite.
-- La mention « Exemplaire de l'artiste » reste (artist_until non nul, mais déjà passé : check_card_cooldown
-- et get_friend_cards ne bloquent que si artist_until > now()).

-- Exemplaires déjà offerts et encore liés : libérés dès maintenant.
update public.inventory_items set artist_until = now() where artist_until > now();

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
    -- Exemplaire de l'artiste : mention gardée (artist_until non nul), sans délai.
    insert into public.inventory_items (owner_id, character_id, finish, art_id, artist_until)
      values (v_entry.author_id, v_char.id, v_finish, v_art, now()) returning id into v_instance;
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
