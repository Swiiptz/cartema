-- CARTEMA — validation des probabilités par l'administrateur (21/10/2026) : la table de tirage active
-- est confirmée telle quelle (emplacements 1–3 : Commun 70 % / Peu commun 30 % ; emplacement 4 :
-- Peu commun 75 % / Rare 20 % / Épique 5 % ; emplacement 5 et finitions déjà validés).
-- Les valeurs ne changent pas : seule la note de version est mise à jour, et l'action journalisée.

update public.pack_rulesets
   set notes = 'Probabilités validées par l’administrateur le 21/10/2026 (emplacements 1 à 5 et finitions).'
 where active;

insert into public.admin_audit_logs (actor_id, target_id, action, reason, after_state)
  select (select id from public.profiles where role = 'admin' limit 1), r.id, 'ruleset_validate',
         'Validation des probabilités des emplacements 1 à 4', jsonb_build_object('version', r.version)
    from public.pack_rulesets r where r.active;
