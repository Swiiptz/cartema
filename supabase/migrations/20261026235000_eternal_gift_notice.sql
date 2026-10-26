-- CARTEMA — carte éternelle offerte par l'admin (décision de Swiiptz, 26/10/2026). Quand l'administrateur donne
-- une carte d'une édition éternelle (ETER), une fenêtre « Recevoir la carte » attend le joueur à sa prochaine
-- visite (player_notices, kind eternal_gift) : il la touche et la révélation de la carte se joue. La notification
-- « team_gift » habituelle part toujours. Déclencheur sur le journal, comme les dons de l'équipe : admin_grant_card
-- ne change pas, et un appel rejoué (même request_id) n'écrit rien, donc n'ouvre pas de seconde fenêtre.

create function private.notice_eternal_gift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_char uuid := (new.after_state->>'character_id')::uuid;
  v_finish public.finish := coalesce(new.after_state->>'finish', 'Standard')::public.finish;
  v_instance uuid;
begin
  if new.target_id is null or v_char is null then return null; end if;
  if not exists (select 1 from public.characters c join public.editions e on e.id = c.edition_id
                  where c.id = v_char and e.eternal) then
    return null;
  end if;
  -- Un des exemplaires créés par ce don (même transaction), pour montrer la carte avec sa version.
  select i.id into v_instance from public.inventory_items i
   where i.owner_id = new.target_id and i.character_id = v_char and i.finish = v_finish and i.created_at = now()
   order by i.id limit 1;
  insert into public.player_notices (owner_id, kind, payload)
    values (new.target_id, 'eternal_gift', jsonb_build_object(
      'card', private.card_json(v_char, v_finish, v_instance),
      'quantity', coalesce((new.after_state->>'quantity')::int, 1)));
  return null;
end $$;
revoke execute on function private.notice_eternal_gift() from public, anon, authenticated;

create trigger audit_eternal_gift after insert on public.admin_audit_logs
  for each row when (new.action = 'card_grant') execute function private.notice_eternal_gift();
