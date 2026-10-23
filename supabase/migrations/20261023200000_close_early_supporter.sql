-- CARTEMA — « Soutien de la première heure » ne s'obtient plus (décision du 23/10/2026). Ceux qui l'ont le
-- gardent, avec son titre ; pour les autres, le succès disparaît (personnalisé manuel non secret : visible
-- seulement une fois décerné). L'admin peut encore le décerner à la main.

update public.achievements set metric = 'manual', secret = false where code = 'chronicle:early';
