-- CARTEMA — Concours CAM 1, correction de Swiiptz (26/10/2026).
-- Ennoia (CAM-076) : le dessin de ValVic devient l'illustration officielle ; celui de Jojo devient une version
-- alternative de la ligne « Jojo », avec son crédit. Chaque exemplaire garde l'image qu'il affiche aujourd'hui :
--  * le déclencheur characters_art_versions range l'officielle remplacée (Jojo) dans une nouvelle version et
--    y déplace les exemplaires officiels non recyclés ;
--  * les exemplaires de la version de ValVic non recyclés repassent sur l'officielle ; cette version, désormais en
--    double de l'officielle, est désactivée (les exemplaires recyclés, figés, la gardent).
-- Inscriptions du concours inversées (point plein des deux côtés, comme avant).
-- Violette (CAM-011) : le dessin de ValVic est coché « vrai dessin » (case oubliée).
-- Sans effet si les données ne sont pas dans cet état (base de test, migration rejouée).

do $$
declare
  v_char constant uuid := '7b25325f-b81e-4481-9706-df7e9f68441c';
  v_old constant uuid := '2f0e12b5-25b9-496c-9c20-6ff5531f8c03';
  v_jojo_entry constant uuid := 'c2fd4c5c-778b-498b-b72b-2a26767849fc';
  v_valvic_entry constant uuid := 'ca7013ff-1a0d-4095-b016-42a9a6244fed';
  v_c public.characters;
  v_l public.card_arts;
  v_new uuid;
  v_moved integer;
  v_admin uuid;
begin
  select * into v_c from public.characters where id = v_char for update;
  select * into v_l from public.card_arts where id = v_old and character_id = v_char and active for update;
  if v_c.id is null or v_l.id is null or v_c.art_path is null or v_c.art_path = v_l.art_path then return; end if;

  update public.characters set art_path = v_l.art_path, art_meta = v_l.art_meta, art_credit = v_l.credit where id = v_char;
  select id into v_new from public.card_arts
   where character_id = v_char and art_path = v_c.art_path and id <> v_old order by created_at desc limit 1;
  update public.card_arts set kind = 'alternate', label = 'Jojo', credit = v_c.art_credit, active = true
   where id = v_new;

  update public.inventory_items set art_id = null where art_id = v_old and recycled_at is null;
  get diagnostics v_moved = row_count;
  update public.card_arts set active = false where id = v_old;

  update public.contest_entries set selected = 'alternate', line_label = 'Jojo', half_point = false
   where id = v_jojo_entry and selected = 'main';
  update public.contest_entries set selected = 'main', line_label = null, half_point = false
   where id = v_valvic_entry and selected = 'alternate';

  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is not null then
    perform private.audit(v_admin, 'card_art_swap', v_char, 'Ennoia : le dessin de ValVic devient l’officielle, celui de Jojo passe dans la ligne Jojo',
      jsonb_build_object('official', v_c.art_path, 'credit', v_c.art_credit, 'alternate', v_old),
      jsonb_build_object('official', v_l.art_path, 'alternate', v_new, 'copies_back_to_official', v_moved));
  end if;
end $$;

update public.contest_entries set real_drawing = true
 where id = '14f5c4a5-b02c-40b3-b697-ce5569afc9b3' and not real_drawing;
