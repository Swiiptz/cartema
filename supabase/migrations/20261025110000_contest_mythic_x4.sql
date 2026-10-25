-- CARTEMA — Mythiques à ×4 au concours de dessin (décision de Swiiptz, 25/10/2026), au lieu de ×3 : pour les
-- concours pas encore distribués (CAM 1, dont la règle écrite est mise à jour) et par défaut pour les suivants.

alter table public.contests alter column mythic_multiplier set default 4;
update public.contests
   set mythic_multiplier = 4,
       rules = replace(rules, 'Mythiques comprises (points ×3 :', 'Mythiques comprises (points ×4 :')
 where rewarded_at is null;
