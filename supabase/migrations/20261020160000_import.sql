-- CARTEMA — import initial du catalogue (Google Sheets) et publication groupée.

-- Traçabilité de la source : une ligne du fichier ne peut créer qu'un personnage (dédoublonnage
-- d'un import relancé). `lore` garde les colonnes non affichées sur la carte (praxis, état, statut…).
alter table public.characters
  add column source_ref text,
  add column lore jsonb not null default '{}'::jsonb;
create unique index characters_source_ref_key on public.characters (source_ref) where source_ref is not null;

-- Publication de tous les brouillons d'une édition en une fois, avec un seul motif.
create function public.admin_publish_drafts(p_edition_id uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_count integer;
begin
  if not exists (select 1 from public.editions where id = p_edition_id and archived_at is null) then
    raise exception 'not_found';
  end if;
  with published as (
    update public.characters set status = 'published'
     where edition_id = p_edition_id and status = 'draft'
     returning id)
  select count(*) into v_count from published;
  perform private.audit(v_admin, 'characters_publish_drafts', p_edition_id, p_reason,
    null, jsonb_build_object('published', v_count));
  return v_count;
end $$;

revoke execute on function public.admin_publish_drafts(uuid, text) from public, anon;
grant execute on function public.admin_publish_drafts(uuid, text) to authenticated;
