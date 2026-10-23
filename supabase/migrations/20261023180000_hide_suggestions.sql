-- CARTEMA — masquer une doléance pour l'admin seul (demande du 23/10/2026). La doléance quitte les listes
-- de l'admin (filtre « Masquées » pour la retrouver) sans changer de statut ni prévenir son auteur, qui la
-- voit toujours comme avant. Rien n'est ajouté à suggestion_json : l'information reste côté admin.

alter table public.suggestions add column admin_hidden_at timestamptz;
comment on column public.suggestions.admin_hidden_at is 'Masquée dans les listes de l''admin (invisible pour les joueurs).';

create or replace function public.admin_suggestions(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
begin
  -- « hidden » : les doléances masquées ; sinon les autres, filtrées par statut.
  return coalesce((select jsonb_agg(private.suggestion_json(s, v_admin) order by (s.status = 'new') desc, s.created_at desc)
    from (select * from public.suggestions
           where case when p_status = 'hidden' then admin_hidden_at is not null
                      else admin_hidden_at is null and (p_status is null or status = p_status) end
           order by created_at desc limit 200) s), '[]'::jsonb);
end $$;

create function public.admin_hide_suggestion(p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
begin
  update public.suggestions set admin_hidden_at = case when p_hidden then coalesce(admin_hidden_at, now()) end where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform private.audit(v_admin, 'suggestion_hide', p_id, case when p_hidden then 'Doléance masquée' else 'Doléance réaffichée' end,
                        null, jsonb_build_object('hidden', p_hidden));
end $$;
revoke execute on function public.admin_hide_suggestion(uuid, boolean) from public, anon;
grant execute on function public.admin_hide_suggestion(uuid, boolean) to authenticated;
