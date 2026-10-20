-- CARTEMA — back-office : RPC réservées à l'administrateur unique, toutes journalisées.
-- Le rôle admin n'est jamais attribuable par le client (voir docs/BACKEND.md).

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if not private.is_admin(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create function private.audit(p_actor uuid, p_action text, p_target uuid, p_reason text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;
  insert into public.admin_audit_logs (actor_id, target_id, action, reason, before_state, after_state)
    values (p_actor, p_target, p_action, trim(p_reason), p_before, p_after);
end $$;

-- Chemin d'illustration accepté : fichier local du site ou bucket public « illustrations » d'un projet Supabase.
create function private.assert_art(p_path text, p_meta jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_path is not null and p_path !~ '^(/illustrations/[A-Za-z0-9._/-]+|https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/illustrations/[A-Za-z0-9._/-]+)$'
     or p_path like '%..%' then
    raise exception 'invalid_art_path';
  end if;
  if jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object'
     or coalesce(p_meta->>'layout', 'portrait') not in ('portrait', 'full', 'cover')
     or (p_meta ? 'offsetY' and (jsonb_typeof(p_meta->'offsetY') <> 'number' or abs((p_meta->>'offsetY')::numeric) > 40)) then
    raise exception 'invalid_art_meta';
  end if;
end $$;

-- ---------------------------------------------------------------- lecture
create function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- éditions
create function public.admin_save_edition(p_id uuid, p_name text, p_prefix text, p_album_published boolean, p_cover_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before public.editions;
  v_after public.editions;
begin
  perform private.assert_art(p_cover_path, '{}'::jsonb);
  if p_id is null then
    insert into public.editions (name, prefix, album_published, cover_path)
      values (trim(p_name), upper(trim(p_prefix)), coalesce(p_album_published, false), p_cover_path)
      returning * into v_after;
  else
    select * into v_before from public.editions where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update public.editions set name = trim(p_name), prefix = upper(trim(p_prefix)),
        album_published = coalesce(p_album_published, album_published), cover_path = p_cover_path
      where id = p_id returning * into v_after;
  end if;
  perform private.audit(v_admin, case when p_id is null then 'edition_create' else 'edition_update' end, v_after.id,
    'Gestion du catalogue', to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
exception when unique_violation then
  raise exception 'prefix_taken';
end $$;

create function public.admin_set_packs(p_edition_id uuid, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before public.editions;
begin
  select * into v_before from public.editions where id = p_edition_id for update;
  if not found then raise exception 'not_found'; end if;
  -- Le trigger editions_guard refuse l'activation d'une édition incomplète ou archivée.
  update public.editions set packs_enabled = p_enabled where id = p_edition_id;
  perform private.audit(v_admin, case when p_enabled then 'packs_enable' else 'packs_disable' end, p_edition_id,
    p_reason, jsonb_build_object('packs_enabled', v_before.packs_enabled), jsonb_build_object('packs_enabled', p_enabled));
end $$;

-- Jamais de suppression : une édition se retire par archivage (CDC §3).
create function public.admin_archive_edition(p_edition_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
begin
  update public.editions set packs_enabled = false, archived_at = coalesce(archived_at, now())
   where id = p_edition_id;
  if not found then raise exception 'not_found'; end if;
  perform private.audit(v_admin, 'edition_archive', p_edition_id, p_reason, null, null);
end $$;

-- ---------------------------------------------------------------- clans
create function public.admin_save_clan(p_id uuid, p_name text, p_symbol_key text default null)
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
  perform private.audit(v_admin, case when p_id is null then 'clan_create' else 'clan_update' end, v_after.id,
    'Gestion du catalogue', to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
exception when unique_violation then
  raise exception 'clan_taken';
end $$;

-- ---------------------------------------------------------------- personnages
-- Création toujours en brouillon ; publication par admin_set_character_status.
create function public.admin_save_character(
  p_id uuid, p_edition_id uuid, p_number integer, p_name text, p_role_title text,
  p_clan_id uuid, p_rarity public.rarity, p_art_path text, p_art_meta jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before public.characters;
  v_after public.characters;
begin
  perform private.assert_art(p_art_path, p_art_meta);
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name_required'; end if;
  if p_id is null then
    insert into public.characters (edition_id, number, name, role_title, clan_id, rarity, art_path, art_meta, created_by)
      values (p_edition_id, p_number, trim(p_name), trim(coalesce(p_role_title, '')), p_clan_id, p_rarity,
              p_art_path, coalesce(p_art_meta, '{}'::jsonb), v_admin)
      returning * into v_after;
  else
    select * into v_before from public.characters where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    -- Édition, numéro et rareté restent figés (trigger characters_guard).
    update public.characters set edition_id = p_edition_id, number = p_number, rarity = p_rarity,
        name = trim(p_name), role_title = trim(coalesce(p_role_title, '')), clan_id = p_clan_id,
        art_path = p_art_path, art_meta = coalesce(p_art_meta, '{}'::jsonb)
      where id = p_id returning * into v_after;
  end if;
  perform private.audit(v_admin, case when p_id is null then 'character_create' else 'character_update' end, v_after.id,
    'Gestion du catalogue', to_jsonb(v_before), to_jsonb(v_after));
  return v_after.id;
exception when unique_violation then
  raise exception 'number_taken';
end $$;

create function public.admin_set_character_status(p_id uuid, p_status public.publication_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_before public.characters;
begin
  select * into v_before from public.characters where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_status = 'draft' and v_before.published_at is not null then
    -- Une carte déjà publiée a pu être tirée : on l'archive, on ne la remet pas en brouillon.
    raise exception 'already_published';
  end if;
  update public.characters set status = p_status where id = p_id;
  perform private.audit(v_admin, 'character_' || p_status::text, p_id, p_reason,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------- droits
revoke execute on all functions in schema public, private from public, anon, authenticated;
grant execute on function
  public.set_handle(text),
  public.get_player_state(),
  public.buy_boosters(integer, uuid),
  public.open_booster(uuid, uuid, text),
  public.get_opening(uuid),
  public.get_album(uuid),
  public.admin_catalog(),
  public.admin_save_edition(uuid, text, text, boolean, text),
  public.admin_set_packs(uuid, boolean, text),
  public.admin_archive_edition(uuid, text),
  public.admin_save_clan(uuid, text, text),
  public.admin_save_character(uuid, uuid, integer, text, text, uuid, public.rarity, text, jsonb),
  public.admin_set_character_status(uuid, public.publication_status, text)
to authenticated;

-- Les politiques de stockage s'évaluent avec le rôle du visiteur : seul is_admin lui est accessible.
grant usage on schema private to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------- stockage des illustrations
-- Bucket public en lecture ; écriture réservée à l'administrateur. Ignoré hors Supabase (tests PGlite).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('illustrations', 'illustrations', true, 15728640, array['image/png', 'image/webp', 'image/jpeg'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  execute $p$create policy illustrations_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'illustrations' and private.is_admin())$p$;
  execute $p$create policy illustrations_admin_update on storage.objects for update to authenticated
    using (bucket_id = 'illustrations' and private.is_admin())$p$;
  execute $p$create policy illustrations_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'illustrations' and private.is_admin())$p$;
end $$;
