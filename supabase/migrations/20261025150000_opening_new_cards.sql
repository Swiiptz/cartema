-- CARTEMA — pastille « Nouveau » à l'ouverture d'un booster (suggestion d'un joueur, 25/10/2026). Chaque carte de la
-- réponse indique si elle a été découverte par cette ouverture : découverte datée de l'ouverture (même
-- transaction), et première occurrence du personnage dans le booster.

create or replace function private.opening_result(p_opening_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'opening_id', o.id,
    'edition_id', o.edition_id,
    'ruleset_version', r.version,
    'pool', o.pool,
    'god', o.god,
    'created_at', o.created_at,
    'cards', (
      select jsonb_agg(jsonb_build_object(
        'position', pc.position,
        'instance_id', pc.instance_id,
        'character_id', c.id,
        'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
        'number', c.number,
        'name', c.name,
        'role_title', c.role_title,
        'clan', cl.name,
        'rarity', pc.rarity,
        'unique', c.is_unique,
        'finish', pc.finish,
        'art_path', coalesce(a.art_path, c.art_path),
        'art_meta', case when a.id is not null then a.art_meta else c.art_meta end,
        'variant', a.label, 'variant_kind', a.kind,
        'silhouette_key', c.silhouette_key,
        -- Découverte par cette ouverture (première occurrence du personnage dans le booster).
        'new', pc.position = (select min(p2.position) from public.pack_opening_cards p2
                               where p2.opening_id = o.id and p2.character_id = c.id)
               and exists (select 1 from public.discoveries d
                            where d.owner_id = o.owner_id and d.character_id = c.id and d.first_seen_at = o.created_at))
        order by pc.position)
      from public.pack_opening_cards pc
      join public.characters c on c.id = pc.character_id
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.card_arts a on a.id = pc.art_id
      where pc.opening_id = o.id))
  from public.pack_openings o
  join public.pack_rulesets r on r.id = o.ruleset_id
  where o.id = p_opening_id
$$;
