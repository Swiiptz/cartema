-- CARTEMA — équilibrage validé par l'utilisateur le 20/10/2026 :
--  * 3 boosters gratuits de bienvenue (nouvelle version des réglages économiques) ;
--  * récompenses des succès de collection proportionnelles à la taille du clan ou de la rareté ;
--  * classement par nombre de succès, puis par personnages découverts (écart au CDC §7 décidé
--    par l'utilisateur).

update public.economy_settings set active = false where active;
insert into public.economy_settings (version, active, settings)
  select max(version) + 1, true, (select settings from public.economy_settings order by version desc limit 1)
                                 || '{"welcome_free_boosters": 3}'::jsonb
    from public.economy_settings;

create or replace function private.sync_set_achievements() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievements (code, label, description, category, edition_id, clan_id, metric, target, reward_deniers, sort)
    select 'set:' || e.prefix || ':clan:' || cl.id, cl.name || ' au complet',
           'Découvrir tous les personnages ' || cl.name || ' de l’édition ' || e.name || '.',
           'collection', e.id, cl.id, 'set_clan', 1, 150, 1000
      from public.editions e
      join (select distinct edition_id, clan_id from public.characters where status = 'published' and clan_id is not null and not is_unique) x
        on x.edition_id = e.id
      join public.clans cl on cl.id = x.clan_id
     where e.album_published and e.archived_at is null
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, rarity, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':rarity:' || r.rarity::text,
           'Toutes les ' || case r.rarity when 'Commun' then 'Communes' when 'Peu commun' then 'Peu communes' when 'Rare' then 'Rares'
             when 'Très rare' then 'Très rares' when 'Épique' then 'Épiques' when 'Légendaire' then 'Légendaires' else 'Mythiques' end,
           'Découvrir tous les personnages ' || r.rarity::text || ' de l’édition ' || e.name || '.',
           'collection', e.id, r.rarity, 'set_rarity', 1,
           case r.rarity when 'Commun' then 100 when 'Peu commun' then 150 when 'Rare' then 250 when 'Très rare' then 400
                         when 'Épique' then 500 when 'Légendaire' then 800 else 1500 end,
           case when r.rarity in ('Légendaire', 'Mythique') then 1 else 0 end,
           case when r.rarity = 'Mythique' then 'Gardien des mythes' end,
           900 + array_position(enum_range(null::public.rarity), r.rarity)
      from public.editions e
      join (select distinct edition_id, rarity from public.characters where status = 'published' and not is_unique) r on r.edition_id = e.id
     where e.album_published and e.archived_at is null
  on conflict (code) do nothing;
  insert into public.achievements (code, label, description, category, edition_id, metric, target, reward_deniers, reward_boosters, title, sort)
    select 'set:' || e.prefix || ':all', 'Maître de ' || e.name, 'Découvrir toutes les cartes de l’édition ' || e.name || '.',
           'collection', e.id, 'set_all', 1, 3000, 5, 'Maître de ' || e.name, 800
      from public.editions e
     where e.album_published and e.archived_at is null
       and exists (select 1 from public.characters c where c.edition_id = e.id and c.status = 'published')
  on conflict (code) do nothing;
  -- Récompenses proportionnelles à la taille du groupe (clan : 10 Deniers par carte, minimum 50 ;
  -- rareté : barème par carte). Recalculées à chaque synchronisation pour suivre les cartes
  -- ajoutées : chaque déblocage verse la valeur du moment, les versements passés ne changent pas.
  update public.achievements a
     set reward_deniers = greatest(50, 10 * (select count(*) from public.characters c
                                               where c.edition_id = a.edition_id and c.clan_id = a.clan_id
                                                 and c.status = 'published' and not c.is_unique))
   where a.category = 'collection' and a.metric = 'set_clan';
  update public.achievements a
     set reward_deniers = (select count(*) from public.characters c
                            where c.edition_id = a.edition_id and c.rarity = a.rarity
                              and c.status = 'published' and not c.is_unique)
                        * case a.rarity when 'Commun' then 3 when 'Peu commun' then 5 when 'Rare' then 10
                            when 'Très rare' then 20 when 'Épique' then 30 when 'Légendaire' then 60 else 200 end,
         reward_boosters = case when a.rarity in ('Légendaire', 'Mythique') then 1 else 0 end
   where a.category = 'collection' and a.metric = 'set_rarity';
end $$;

create or replace function public.get_leaderboard(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  -- Classement par succès obtenus, puis personnages découverts, puis ancienneté du dernier gain.
  return (with scores as (
      select p.id, p.handle, p.title,
             (select count(*) from public.achievement_unlocks u where u.owner_id = p.id) as achievements,
             (select count(*) from public.discoveries d where d.owner_id = p.id) as faces,
             greatest((select max(unlocked_at) from public.achievement_unlocks u where u.owner_id = p.id),
                      (select max(first_seen_at) from public.discoveries d where d.owner_id = p.id)) as reached
        from public.profiles p
       where p.handle is not null and p.suspended_at is null),
    ranked as (select *, rank() over (order by achievements desc, faces desc) as position
                 from scores where achievements > 0 or faces > 0)
    select jsonb_build_object(
      'top', coalesce((select jsonb_agg(jsonb_build_object('position', position, 'handle', handle, 'title', title,
                 'score', achievements, 'achievements', achievements, 'faces', faces, 'me', id = v_uid) order by position, reached)
               from (select * from ranked order by position, reached limit least(greatest(p_limit, 1), 200)) t), '[]'::jsonb),
      'me', (select jsonb_build_object('position', position, 'score', achievements, 'achievements', achievements, 'faces', faces)
               from ranked where id = v_uid),
      'total_achievements', (select count(*) from public.achievements where category <> 'custom'),
      'total_characters', (select count(*) from public.characters c join public.editions e on e.id = c.edition_id
                            where c.status = 'published' and e.album_published and e.archived_at is null)));
end $$;
