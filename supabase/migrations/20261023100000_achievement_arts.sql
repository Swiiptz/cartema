-- CARTEMA — succès conditionnels sur une version d'illustration, et retrait d'une version partout
-- (décisions du 23/10/2026).
--  * achievements.required_arts : {"<personnage>": "<id de version>" | "alt"}. Le joueur doit posséder un
--    exemplaire de cette version (« alt » : n'importe quelle version alternative ou ancienne officielle),
--    en plus de la finition éventuelle. admin_save_achievement reçoit p_arts en dernier.
--  * admin_retire_card_art : désactive une version (plus de tirage) et la retire des exemplaires possédés,
--    qui reprennent l'illustration officielle (ou la silhouette). Exemple : l'ancienne illustration de
--    Rumpelstilchzen (CAM-050), retirée de l'officielle mais restée « Illustration d'origine ».

alter table public.achievements add column required_arts jsonb not null default '{}'::jsonb;
comment on column public.achievements.required_arts is
  'Version d''illustration exigée par personnage requis : id de card_arts, ou « alt » pour n''importe quelle version alternative.';

create function private.owns_card_art(p_owner uuid, p_character uuid, p_finish public.finish default null, p_art text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inventory_items i
                  where i.owner_id = p_owner and i.character_id = p_character
                    and i.recycled_at is null and i.removed_at is null
                    and (p_finish is null or i.finish = p_finish)
                    and (p_art is null or (p_art = 'alt' and i.art_id is not null) or i.art_id::text = p_art))
$$;
revoke execute on function private.owns_card_art(uuid, uuid, public.finish, text) from public, anon, authenticated;

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(*) filter (where private.owns_card_art(p_owner, rc.id, f.finish, p_def.required_arts->>rc.id::text)),
             cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        cross join lateral (select (p_def.required_finishes->>rc.id::text)::public.finish as finish) f;
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null
                                               and i.removed_at is null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

drop function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid, jsonb);
create function public.admin_save_achievement(p_code text, p_label text, p_description text, p_secret boolean,
                                              p_reward_deniers bigint, p_reward_boosters integer, p_title text,
                                              p_characters uuid[] default null, p_edition_id uuid default null,
                                              p_finishes jsonb default null, p_arts jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := coalesce(nullif(trim(p_code), ''), 'custom:' || gen_random_uuid());
  v_chars uuid[] := (select array_agg(distinct c.id) from public.characters c where c.id = any (coalesce(p_characters, '{}')));
  v_finishes jsonb;
  v_arts jsonb;
begin
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'name_required'; end if;
  if p_edition_id is not null and not exists (select 1 from public.editions where id = p_edition_id) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_finishes, '{}'::jsonb)) f where f.value not in ('Dorée', 'Sanglante')) then
    raise exception 'invalid_finish';
  end if;
  -- Version d'illustration : « alt » (n'importe quelle version alternative) ou une version du personnage.
  if exists (select 1 from jsonb_each_text(coalesce(p_arts, '{}'::jsonb)) a
              where a.value <> 'alt' and not exists (select 1 from public.card_arts ca
                                                     where ca.id::text = a.value and ca.character_id::text = a.key)) then
    raise exception 'invalid_art';
  end if;
  v_arts := coalesce((select jsonb_object_agg(a.key, a.value) from jsonb_each_text(coalesce(p_arts, '{}'::jsonb)) a
                       where a.key = any (select unnest(v_chars)::text)), '{}'::jsonb);
  -- Seulement pour les personnages requis.
  v_finishes := coalesce((select jsonb_object_agg(f.key, f.value) from jsonb_each_text(coalesce(p_finishes, '{}'::jsonb)) f
                           where f.key = any (select unnest(v_chars)::text)), '{}'::jsonb);
  insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                   required_finishes, required_arts, reward_deniers, reward_boosters, title, sort, edition_id)
    values (v_code, trim(p_label), coalesce(trim(p_description), ''), coalesce(p_secret, false), 'custom',
            case when v_chars is null then 'manual' else 'characters' end, 1, v_chars, v_finishes, v_arts,
            greatest(coalesce(p_reward_deniers, 0), 0), greatest(coalesce(p_reward_boosters, 0), 0), nullif(trim(p_title), ''), 500,
            p_edition_id)
  on conflict (code) do update set label = excluded.label, description = excluded.description, secret = excluded.secret,
    reward_deniers = excluded.reward_deniers, reward_boosters = excluded.reward_boosters, title = excluded.title,
    edition_id = excluded.edition_id,
    metric = case when public.achievements.metric in ('manual', 'characters') then excluded.metric else public.achievements.metric end,
    required_characters = case when public.achievements.metric in ('manual', 'characters') then excluded.required_characters
                               else public.achievements.required_characters end,
    required_finishes = case when public.achievements.metric in ('manual', 'characters') then excluded.required_finishes
                             else public.achievements.required_finishes end,
    required_arts = case when public.achievements.metric in ('manual', 'characters') then excluded.required_arts
                         else public.achievements.required_arts end
    where public.achievements.category = 'custom';
  perform private.audit(v_admin, 'achievement_save', null, 'Succès personnalisé ' || trim(p_label), null,
                        jsonb_build_object('code', v_code, 'edition', p_edition_id, 'finishes', v_finishes, 'arts', v_arts));
  return v_code;
end $$;

create or replace function public.admin_custom_achievements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description,
      'secret', a.secret, 'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title,
      'conditional', a.metric = 'characters', 'automatic', a.metric <> 'manual', 'edition', e.name, 'edition_id', a.edition_id,
      'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', ce.prefix || '-' || lpad(c.number::text, 3, '0'),
                                                                  'finish', a.required_finishes->>c.id::text,
                                                                  'art', a.required_arts->>c.id::text,
                                                                  'art_label', case when a.required_arts->>c.id::text = 'alt' then 'version alternative'
                                                                                    else (select ca.label from public.card_arts ca where ca.id::text = a.required_arts->>c.id::text) end)
                                                                  order by c.number)
                               from public.characters c join public.editions ce on ce.id = c.edition_id
                              where c.id = any (coalesce(a.required_characters, '{}'))), '[]'::jsonb),
      'holders', (select coalesce(jsonb_agg(p.handle order by u.unlocked_at), '[]'::jsonb)
                    from public.achievement_unlocks u join public.profiles p on p.id = u.owner_id where u.code = a.code))
      order by a.label) from public.achievements a left join public.editions e on e.id = a.edition_id
     where a.category = 'custom'), '[]'::jsonb);
end $$;

revoke execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid, jsonb, jsonb) from public, anon;
grant execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid, jsonb, jsonb) to authenticated;

create function public.admin_retire_card_art(p_id uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_art public.card_arts;
  v_count integer;
begin
  select * into v_art from public.card_arts where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.card_arts set active = false where id = p_id;
  -- Les exemplaires possédés reprennent l'illustration officielle (les recyclés restent tels quels).
  update public.inventory_items set art_id = null where art_id = p_id and recycled_at is null;
  get diagnostics v_count = row_count;
  perform private.audit(v_admin, 'card_art_retire', v_art.character_id, v_reason,
    jsonb_build_object('art', p_id, 'label', v_art.label), jsonb_build_object('copies', v_count));
  return v_count;
end $$;
revoke execute on function public.admin_retire_card_art(uuid, text) from public, anon;
grant execute on function public.admin_retire_card_art(uuid, text) to authenticated;
