-- CARTEMA — éditions en préparation invisibles (22/10/2026, préparation du set ANE). Une carte d'une
-- édition dont l'album n'est pas publié ne se retrouve plus par son code (« ANE-001 ») : la liste de
-- souhaits et les propositions de correction répondent « introuvable », comme pour un code inexistant.
-- Les lectures des joueurs (album, succès, classement, marché, profil…) filtraient déjà ces éditions.

create or replace function private.character_by_code(p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.characters c join public.editions e on e.id = c.edition_id
   where upper(e.prefix) = upper(split_part(trim(p_code), '-', 1))
     and c.number = nullif(regexp_replace(split_part(trim(p_code), '-', 2), '\D', '', 'g'), '')::int
     and c.status = 'published' and not c.is_unique and e.archived_at is null and e.album_published
$$;
