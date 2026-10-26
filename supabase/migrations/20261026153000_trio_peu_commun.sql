-- CARTEMA — « De l'or à la lie » : palier Peu commune oublié (signalé le 26/10/2026). Il devient le palier 2,
-- entre Commune et Rare ; les paliers suivants passent de 2–6 à 3–7. Nom « Deniers souillés »,
-- 1 000 Deniers et 2 boosters, sans titre (décision de Swiiptz du 26/10). Les joueurs qui ont déjà une
-- Peu commune dans ses trois finitions l'obtiendront à leur prochaine visite, avec sa récompense.

alter table public.achievements drop constraint achievements_tier_check;
alter table public.achievements add constraint achievements_tier_check check (tier between 1 and 7);

update public.achievements set tier = tier + 1, sort = sort + 1 where series = 'trio' and tier >= 2;

insert into public.achievements (code, label, description, secret, metric, target, rarity, reward_deniers, reward_boosters, title, sort,
                                 series, series_label, tier) values
  ('trio_peu_commun', 'Deniers souillés', 'Posséder une Peu commune dans ses trois finitions.', false, 'finish_trio', 1, 'Peu commun', 1000, 2, null, 116, 'trio', 'De l’or à la lie', 2)
on conflict (code) do nothing;
