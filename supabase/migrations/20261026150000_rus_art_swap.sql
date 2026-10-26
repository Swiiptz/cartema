-- CARTEMA — Rus (CAM-142) : échange des rôles de ses deux illustrations (demande de Swiiptz, 26/10/2026).
-- L'ancienne illustration (« Illustration d'origine ») redevient l'officielle ; celle de soupe (May) devient
-- une version alternative tirable, « Version de soupe (May) », avec son crédit. Chaque exemplaire garde l'image
-- qu'il affiche aujourd'hui :
--  * le déclencheur characters_art_versions range l'officielle remplacée (soupe) dans une nouvelle version et
--    y déplace les exemplaires officiels non recyclés ;
--  * les exemplaires « d'origine » non recyclés repassent sur l'officielle ; l'ancienne version, désormais en
--    double de l'officielle, est désactivée (les exemplaires recyclés, figés, la gardent).
-- Sans effet si Rus n'est pas dans cet état (base de test, migration rejouée).

do $$
declare
  v_char constant uuid := '9567502d-4841-4224-9a74-36bbc91a6fb8';
  v_old constant uuid := 'fe69b3ef-a163-4fbb-9b91-28f675c418c8';
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
  update public.card_arts set kind = 'alternate', label = 'Version de soupe (May)', credit = v_c.art_credit, active = true
   where id = v_new;

  update public.inventory_items set art_id = null where art_id = v_old and recycled_at is null;
  get diagnostics v_moved = row_count;
  update public.card_arts set active = false where id = v_old;

  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is not null then
    perform private.audit(v_admin, 'card_art_swap', v_char, 'Rus : l’ancienne illustration redevient l’officielle',
      jsonb_build_object('official', v_c.art_path, 'credit', v_c.art_credit, 'legacy', v_old),
      jsonb_build_object('official', v_l.art_path, 'alternate', v_new, 'copies_back_to_official', v_moved));
  end if;
end $$;
