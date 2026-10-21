-- CARTEMA — cadrage « plein cadre » (full art) : l'illustration couvre toute la carte, cadre et
-- texte par-dessus. Autorisé pour l'illustration officielle et pour les versions d'illustration ;
-- le cadrage d'une version existante est modifiable (journalisé).

create or replace function private.assert_art(p_path text, p_meta jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_path is not null and p_path !~ '^(/illustrations/[A-Za-z0-9._/-]+|https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/illustrations/[A-Za-z0-9._/-]+)$'
     or p_path like '%..%' then
    raise exception 'invalid_art_path';
  end if;
  if jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object'
     or coalesce(p_meta->>'layout', 'portrait') not in ('portrait', 'full', 'cover', 'fullart')
     or (p_meta ? 'offsetY' and (jsonb_typeof(p_meta->'offsetY') <> 'number' or abs((p_meta->>'offsetY')::numeric) > 40)) then
    raise exception 'invalid_art_meta';
  end if;
end $$;

create function public.admin_set_card_art_meta(p_id uuid, p_meta jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_art public.card_arts;
begin
  select * into v_art from public.card_arts where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  perform private.assert_art(v_art.art_path, v_art.art_meta || coalesce(p_meta, '{}'::jsonb));
  update public.card_arts set art_meta = art_meta || coalesce(p_meta, '{}'::jsonb) where id = p_id;
  perform private.audit(v_admin, 'art_meta', v_art.character_id, v_reason, jsonb_build_object('art', p_id, 'meta', v_art.art_meta),
                        jsonb_build_object('art', p_id, 'meta', v_art.art_meta || coalesce(p_meta, '{}'::jsonb)));
end $$;

revoke execute on function public.admin_set_card_art_meta(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_set_card_art_meta(uuid, jsonb, text) to authenticated;
