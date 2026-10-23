-- CARTEMA — prévenir le joueur des dons de l'équipe (23/10/2026). Cas de Volfsön : 13 boosters crédités
-- sans qu'il le voie. Une notification « team_gift » part à chaque don de boosters, de Deniers ou de
-- cartes par l'administrateur (jamais pour un retrait), quelles que soient les préférences de
-- notification. Le motif saisi reste interne. Déclencheurs sur les écritures existantes : les fonctions
-- d'administration ne changent pas, et un appel rejoué (même request_id) n'écrit rien, donc ne notifie pas.

create function private.notify_team_gift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_payload jsonb;
begin
  if tg_table_name = 'booster_grants' then
    if new.source <> 'admin' or new.quantity <= 0 then return null; end if;
    v_owner := new.owner_id;
    v_payload := jsonb_build_object('boosters', new.quantity);
  elsif tg_table_name = 'wallet_ledger' then
    if new.kind <> 'admin_adjust' or new.delta <= 0 then return null; end if;
    v_owner := new.owner_id;
    v_payload := jsonb_build_object('deniers', new.delta);
  else
    if new.action <> 'card_grant' or new.target_id is null then return null; end if;
    v_owner := new.target_id;
    v_payload := jsonb_build_object('card', new.after_state->>'character', 'character_id', new.after_state->>'character_id',
                                    'finish', new.after_state->>'finish', 'quantity', (new.after_state->>'quantity')::int,
                                    'version', new.after_state->>'version');
  end if;
  insert into public.notifications (owner_id, kind, payload) values (v_owner, 'team_gift', v_payload);
  return null;
end $$;
revoke execute on function private.notify_team_gift() from public, anon, authenticated;

create trigger booster_grants_team_gift after insert on public.booster_grants
  for each row when (new.source = 'admin' and new.quantity > 0) execute function private.notify_team_gift();
create trigger wallet_ledger_team_gift after insert on public.wallet_ledger
  for each row when (new.kind = 'admin_adjust' and new.delta > 0) execute function private.notify_team_gift();
create trigger audit_team_gift after insert on public.admin_audit_logs
  for each row when (new.action = 'card_grant') execute function private.notify_team_gift();
