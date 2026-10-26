-- CARTEMA — classement d'un concours pour l'admin (26/10/2026). Depuis 20261026210000_contest_results,
-- get_contest_leaderboard ne renvoie plus rien une fois le concours clos : Admin › Concours affichait
-- « Personne n'a de point » avant la distribution. admin_contest_ranking renvoie le classement détaillé
-- (places serrées) de n'importe quel concours, ouvert ou clos.

create function public.admin_contest_ranking(p_contest_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('position', r.place, 'handle', r.handle, 'leads', r.leads,
      'selected', r.selected, 'real', r.drawings, 'points', r.points, 'me', r.author_id = v_uid) order by r.place, r.handle)
    from private.contest_places(p_contest_id) r), '[]'::jsonb);
end $$;
revoke execute on function public.admin_contest_ranking(uuid) from public, anon;
grant execute on function public.admin_contest_ranking(uuid) to authenticated;
