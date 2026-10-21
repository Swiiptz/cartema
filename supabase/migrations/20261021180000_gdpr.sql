-- CARTEMA — RGPD : export des données et suppression du compte (droit d'accès, de portabilité et
-- à l'effacement).
--  * Export : toutes les données personnelles et de jeu du joueur, en un fichier JSON.
--  * Suppression : le compte de connexion (e-mail, identités Discord) est supprimé. Le profil n'est
--    pas effacé ligne à ligne : les cartes cédées à d'autres joueurs gardent la trace de leur
--    ouverture, et le registre des Deniers est immuable. Il devient un profil anonyme (identifiant
--    aléatoire, sans pseudonyme ni titre), inaccessible et masqué partout ; ses données sociales
--    (amis, souhaits, notifications, vitrine, préférences) sont supprimées et ses ventes ouvertes
--    retirées. Plus rien ne relie ces traces à une personne.
--  * Même effet si l'administrateur supprime l'utilisateur depuis le tableau de bord Supabase.

alter table public.profiles add column deleted_at timestamptz;

-- Le profil survit à la suppression du compte de connexion (anonymisé par le déclencheur ci-dessous).
do $$
declare
  v_name text;
begin
  select con.conname into v_name from pg_constraint con
   where con.conrelid = 'public.profiles'::regclass and con.contype = 'f' and con.confrelid = 'auth.users'::regclass;
  if v_name is not null then execute format('alter table public.profiles drop constraint %I', v_name); end if;
end $$;

create function private.anonymize_profile(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_listing public.listings;
begin
  update public.profiles set handle = null, title = null, showcase = '{}', featured_achievements = '{}', notification_prefs = '{}',
         visibility = 'private', show_stats = false, suspended_at = coalesce(suspended_at, now()), deleted_at = now(),
         role = case when role = 'admin' then 'player' else role end
   where id = p_id;
  delete from public.wishlists where owner_id = p_id;
  delete from public.notifications where owner_id = p_id;
  delete from public.friendships where requester_id = p_id or addressee_id = p_id;
  -- Ventes ouvertes sans offre retirées (les enchères disputées vont à leur terme, comme une suspension).
  for v_listing in select * from public.listings l where l.seller_id = p_id and l.status = 'active'
                     and not exists (select 1 from public.bids b where b.listing_id = l.id) for update loop
    update public.listings set status = 'cancelled', closed_at = now() where id = v_listing.id;
    update public.inventory_items set reserved_kind = null, reserved_ref = null where id = v_listing.instance_id and reserved_ref = v_listing.id;
  end loop;
end $$;

create function private.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.anonymize_profile(old.id);
  return old;
end $$;
create trigger on_auth_user_deleted after delete on auth.users for each row execute function private.on_auth_user_deleted();

-- Le joueur supprime lui-même son compte en confirmant son pseudonyme.
create function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.role = 'admin' then raise exception 'cannot_delete_admin'; end if;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(coalesce(v_profile.handle, 'supprimer')) then raise exception 'confirmation_mismatch'; end if;
  delete from auth.users where id = v_uid;
end $$;

-- Toutes les données du joueur, lisibles et réutilisables (portabilité).
create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
                  'identities', coalesce((select jsonb_agg(i.provider) from auth.identities i where i.user_id = u.id), '[]'::jsonb))
                  from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) - 'role' from public.profiles p where p.id = v_uid),
    'balance', (select balance from public.wallets where owner_id = v_uid),
    'boosters', (select to_jsonb(b) from public.booster_balances b where b.owner_id = v_uid),
    'cards', coalesce((select jsonb_agg(private.card_brief(i.character_id, i.finish) || jsonb_build_object('acquired_at', i.acquired_at,
                  'locked', i.locked, 'recycled_at', i.recycled_at) order by i.acquired_at)
                  from public.inventory_items i where i.owner_id = v_uid), '[]'::jsonb),
    'discoveries', coalesce((select jsonb_agg(private.card_brief(d.character_id, 'Standard') || jsonb_build_object('first_seen_at', d.first_seen_at) order by d.first_seen_at)
                  from public.discoveries d where d.owner_id = v_uid), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('code', u.code, 'label', a.label, 'unlocked_at', u.unlocked_at) order by u.unlocked_at)
                  from public.achievement_unlocks u join public.achievements a on a.code = u.code where u.owner_id = v_uid), '[]'::jsonb),
    'deniers_ledger', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'kind', l.kind, 'delta', l.delta, 'balance', l.balance_after) order by l.id)
                  from public.wallet_ledger l where l.owner_id = v_uid), '[]'::jsonb),
    'history', (select public.get_history('all', null, 100)),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('handle', private.handle_of(case when f.requester_id = v_uid then f.addressee_id else f.requester_id end),
                  'status', f.status, 'since', coalesce(f.accepted_at, f.created_at)))
                  from public.friendships f where f.requester_id = v_uid or f.addressee_id = v_uid), '[]'::jsonb),
    'wishlist', (select public.get_wishlist(null)->'items'),
    'reports_sent', coalesce((select jsonb_agg(jsonb_build_object('target', private.handle_of(r.target_id), 'category', r.category, 'message', r.message,
                  'status', r.status, 'created_at', r.created_at)) from public.reports r where r.reporter_id = v_uid), '[]'::jsonb),
    'contributions', (select public.get_my_submissions()));
end $$;

revoke execute on function private.anonymize_profile(uuid), private.on_auth_user_deleted() from public, anon, authenticated;
revoke execute on function public.delete_my_account(text), public.export_my_data() from public, anon;
grant execute on function public.delete_my_account(text), public.export_my_data() to authenticated;
