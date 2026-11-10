-- CARTEMA — doléances rapides (10/11/2026, mise à jour d'hiver).
--  * Succès de collection (clan, rareté, édition) : la description dit « Posséder », comme la règle réelle
--    depuis 20261022320000_owned_achievements (doléance : « Maître de la Camarilla » disait « Découvrir »).
--  * Missions de visages : jamais « Découvrir N visages » (ou « N jours ») s'il en reste moins de N à découvrir.

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
           case when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null and not e.eternal
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', 'Maître de ' || e.name, 'Posséder toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 8000, 12, 'Maître de ' || e.name, 800
      from public.editions e
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
                            when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
         reward_boosters = greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end,
                                    n.cards / 10)
    from (select c2.edition_id, c2.rarity, count(*)::int as cards from public.characters c2
           where c2.status = 'published' and not c2.is_unique group by c2.edition_id, c2.rarity) n
   where a.category = 'collection' and a.metric = 'set_rarity' and n.edition_id = a.edition_id and n.rarity = a.rarity
     and (a.reward_deniers, a.reward_boosters) is distinct from (
           n.cards * case a.rarity when 'Commun' then 8 when 'Peu commun' then 12 when 'Rare' then 25
                     when 'Très rare' then 50 when 'Épique' then 80 when 'Légendaire' then 150 else 500 end,
           greatest(case a.rarity when 'Épique' then 2 when 'Légendaire' then 3 when 'Mythique' then 4 else 1 end, n.cards / 10));
  update public.achievements set reward_deniers = 8000, reward_boosters = 12
   where category = 'collection' and metric = 'set_all' and (reward_deniers, reward_boosters) is distinct from (8000, 12);
end $$;

update public.achievements
   set description = regexp_replace(description, '^Découvrir (tous les personnages|toutes les cartes de l’édition) ', 'Posséder \1 ')
 where category = 'collection' and metric in ('set_clan', 'set_rarity', 'set_all') and description like 'Découvrir %';

-- Reprise de 20261026110000_missions_monday_fix, avec le contrôle des visages restants.
create or replace function private.ensure_missions(p_owner uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_missing integer;
  -- Visages encore à découvrir, calculé une fois : une mission « Découvrir N visages » (ou N jours) n'est tirée
  -- que s'il en reste au moins N (doléance du 30/10 : « 4 visages » alors qu'il n'en restait qu'un).
  v_left integer := (select count(*) from public.characters c join public.editions e on e.id = c.edition_id
                      where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null and not e.eternal
                        and not exists (select 1 from public.discoveries d where d.owner_id = p_owner and d.character_id = c.id));
begin
  select period_start, period_end into v_start, v_end from private.mission_period(p_kind);
  perform 1 from public.profiles where id = p_owner for update;
  -- Missions fixes d'abord (jamais remplacées), puis tirage au hasard jusqu'à 3.
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and t.fixed and private.mission_eligible(p_owner, t.requires)
               and (t.metric not in ('discover', 'discover_days') or v_left >= t.target)
  on conflict do nothing;
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and kind = p_kind and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  -- Un seul tirage par objectif (métrique) sur la période, mission remplacée comprise : jamais « 1 visage »
  -- et « 2 visages » le même jour.
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, x.code, p_kind, v_start, v_end
      from (select distinct on (t.metric) t.code
              from public.mission_templates t
             where t.kind = p_kind and t.active and not t.fixed and private.mission_eligible(p_owner, t.requires)
               and (t.metric not in ('discover', 'discover_days') or v_left >= t.target)
               and not exists (select 1 from public.mission_assignments a
                                join public.mission_templates t2 on t2.code = a.template_code
                               where a.owner_id = p_owner and a.kind = p_kind and a.period_start = v_start
                                 and (a.template_code = t.code or t2.metric = t.metric))
             order by t.metric, random()) x
     order by random() limit v_missing;
  -- Repli si les objectifs distincts manquent : compléter avec d'autres missions, sans doublon de mission.
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and kind = p_kind and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and not t.fixed and private.mission_eligible(p_owner, t.requires)
               and (t.metric not in ('discover', 'discover_days') or v_left >= t.target)
       and not exists (select 1 from public.mission_assignments a
                        where a.owner_id = p_owner and a.kind = p_kind and a.period_start = v_start and a.template_code = t.code)
     order by random() limit v_missing;
end $$;
