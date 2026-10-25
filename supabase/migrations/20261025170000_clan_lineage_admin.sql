-- CARTEMA — lignée d'un nouveau clan depuis l'admin (25/10/2026). admin_set_clan_lineage crée (ou met à jour) le
-- succès « Lignée <clan> » avec son titre ; récompense calculée comme en octobre (clans de 10 membres ou plus :
-- 60 Deniers et 1/5 de booster par membre), recalculée à chaque enregistrement. Renommer le clan renomme sa lignée.
-- admin_catalog renvoie le titre de lignée de chaque clan.

create or replace function public.admin_save_clan(p_id uuid, p_name text, p_symbol_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before public.clans;
  v_after public.clans;
begin
  if p_id is null then
    insert into public.clans (name, symbol_key) values (trim(p_name), nullif(trim(p_symbol_key), ''))
      returning * into v_after;
  else
    select * into v_before from public.clans where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update public.clans set name = trim(p_name), symbol_key = nullif(trim(p_symbol_key), '')
      where id = p_id returning * into v_after;
  end if;
  -- Lignée du clan : son nom suit celui du clan.
  if p_id is not null then
    update public.achievements set label = 'Lignée ' || v_after.name,
           description = 'Posséder tous les membres du clan ' || v_after.name || ', toutes éditions confondues. Le titre se perd si l’un d’eux quitte votre collection.'
     where code = 'lineage:' || v_after.id;
  end if;
  perform private.audit(v_admin, case when p_id is null then 'clan_create' else 'clan_update' end, v_after.id,
    'Gestion du catalogue', to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
exception when unique_violation then
  raise exception 'clan_taken';
end $$;

create function public.admin_set_clan_lineage(p_clan_id uuid, p_title text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_clan public.clans;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_members integer;
  v_code text;
begin
  if v_title is null or length(v_title) > 60 then raise exception 'invalid_title'; end if;
  select * into v_clan from public.clans where id = p_clan_id;
  if not found then raise exception 'not_found'; end if;
  v_code := 'lineage:' || v_clan.id;
  select count(*) into v_members from public.characters c join public.editions e on e.id = c.edition_id
   where c.clan_id = v_clan.id and c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null and not e.eternal;
  insert into public.achievements (code, label, description, category, metric, target, clan_id, title, reward_deniers, reward_boosters, sort)
    values (v_code, 'Lignée ' || v_clan.name,
            'Posséder tous les membres du clan ' || v_clan.name || ', toutes éditions confondues. Le titre se perd si l’un d’eux quitte votre collection.',
            'general', 'clan_lineage', 1, v_clan.id, v_title,
            case when v_members >= 10 then (round(v_members * 60 / 100.0) * 100)::bigint else 0 end,
            case when v_members >= 10 then v_members / 5 else 0 end,
            950)
  on conflict (code) do update set title = excluded.title, label = excluded.label, description = excluded.description,
    reward_deniers = excluded.reward_deniers, reward_boosters = excluded.reward_boosters;
  perform private.audit(v_admin, 'clan_lineage', v_clan.id, v_reason, null, jsonb_build_object('title', v_title, 'members', v_members));
  return v_code;
end $$;
revoke execute on function public.admin_set_clan_lineage(uuid, text, text) from public, anon;
grant execute on function public.admin_set_clan_lineage(uuid, text, text) to authenticated;

create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers,
        'eternal', e.eternal, 'eternal_drops', e.eternal_drops,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key,
        'lineage_title', (select a.title from public.achievements a where a.code = 'lineage:' || c.id)) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit, 'art_ai', c.art_ai,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;
