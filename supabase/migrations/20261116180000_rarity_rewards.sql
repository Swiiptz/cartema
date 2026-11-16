-- CARTEMA — succès « Toutes les … » : Légendaires et Mythiques mieux payées (16/11/2026, décision de Swiiptz).
-- Par carte : Légendaire 150 → 400 Deniers, Mythique 500 → 1 500 ; boosters : 3 → 5 et 4 → 6. Les autres raretés et
-- « Maître de … » ne changent pas. Formule commune : vaut pour Camarilla comme pour l'Appel des Neiges Éternelles
-- (recalculée à la prochaine synchronisation ; un succès déjà débloqué ne rapporte rien de plus).
-- Reprise de 20261116160000_ane_set_titles.

create or replace function private.sync_set_achievements() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (code, label, description, category, edition_id, clan_id, metric, target, reward_deniers, sort)
    select 'set:' || e.prefix || ':clan:' || cl.id, cl.name || ' au complet',
           'Posséder tous les personnages ' || cl.name || ' de l’édition ' || e.name || '.',
           'collection', e.id, cl.id, 'set_clan', 1, 150, 1000
      from public.editions e
      join (select distinct edition_id, clan_id from public.characters where status = 'published' and clan_id is not null and not is_unique) x
        on x.edition_id = e.id
      join public.clans cl on cl.id = x.clan_id
     where e.album_published and e.archived_at is null and not e.eternal
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, rarity, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':rarity:' || r.rarity::text,
           'Toutes les ' || case r.rarity when 'Commun' then 'Communes' when 'Peu commun' then 'Peu communes' when 'Rare' then 'Rares'
             when 'Très rare' then 'Très rares' when 'Épique' then 'Épiques' when 'Légendaire' then 'Légendaires' else 'Mythiques' end,
           'Posséder tous les personnages ' || r.rarity::text || ' de l’édition ' || e.name || '.',
           'collection', e.id, r.rarity, 'set_rarity', 1, 0, 0,
           -- Titres propres à l'Appel des Neiges Éternelles ; ailleurs, seul le titre des Mythiques.
           case when e.prefix = 'ANE' then case r.rarity when 'Commun' then 'Flocon parmi les flocons'
                  when 'Peu commun' then 'Arpenteur des cols' when 'Rare' then 'Chasseur de givre'
                  when 'Très rare' then 'Veilleur des cimes' when 'Épique' then 'Seigneur des avalanches'
                  when 'Légendaire' then 'Légende des glaciers' else 'Gardien des neiges éternelles' end
                when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null and not e.eternal
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', m.label, 'Posséder toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 8000, 12, m.label, 800
      from public.editions e
      -- « Maître de l’Appel… » : élision devant une voyelle.
      cross join lateral (select 'Maître de ' || case when e.name ~* '^[aeiouyàâäéèêëîïôöûüù]' then 'l’' else '' end || e.name as label) m
     where e.album_published and e.archived_at is null and not e.eternal
       and exists (select 1 from public.characters c where c.edition_id = e.id and c.status = 'published')
  on conflict (code) do nothing;
  -- Récompenses proportionnelles à la taille du groupe, recalculées à chaque synchronisation pour
  -- suivre les cartes ajoutées : chaque déblocage verse la valeur du moment.
  update public.achievements a
     set reward_deniers = greatest(100, 25 * n.cards), reward_boosters = greatest(1, n.cards / 5)
    from (select c2.edition_id, c2.clan_id, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique and c2.clan_id is not null
           group by c2.edition_id, c2.clan_id) n
   where a.category = 'collection' and a.metric = 'set_clan' and n.edition_id = a.edition_id and n.clan_id = a.clan_id
     and (a.reward_deniers, a.reward_boosters) is distinct from (greatest(100, 25 * n.cards), greatest(1, n.cards / 5));
  update public.achievements a
     set reward_deniers = n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                            when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 400 else 1500 end,
         reward_boosters = greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 5 when 'Mythique' then 6 else 1 end,
                                    n.cards / 10)
    from (select c2.edition_id, c2.rarity, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique group by c2.edition_id, c2.rarity) n
   where a.category = 'collection' and a.metric = 'set_rarity' and n.edition_id = a.edition_id and n.rarity = a.rarity
     and (a.reward_deniers, a.reward_boosters) is distinct from (
           n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                     when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 400 else 1500 end,
           greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 5 when 'Mythique' then 6 else 1 end, n.cards / 10));
  update public.achievements set reward_deniers = 8000, reward_boosters = 12
   where category = 'collection' and metric = 'set_all' and (reward_deniers, reward_boosters) is distinct from (8000, 12);
end $$;
