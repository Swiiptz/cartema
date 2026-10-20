-- CARTEMA — comptes, droits d'accès et RLS.
-- Principe : le navigateur ne lit que ses propres données et n'écrit JAMAIS directement
-- dans les tables ; toute écriture passe par une fonction RPC SECURITY DEFINER qui
-- vérifie auth.uid(). Supabase accorde par défaut ALL aux rôles anon/authenticated :
-- on retire explicitement ces droits.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
-- PUBLIC reçoit EXECUTE sur toute fonction par défaut, globalement : une révocation
-- limitée à un schéma ne suffit pas.
alter default privileges revoke execute on functions from public;

alter table public.profiles enable row level security;
alter table public.clans enable row level security;
alter table public.silhouettes enable row level security;
alter table public.editions enable row level security;
alter table public.characters enable row level security;
alter table public.pack_rulesets enable row level security;
alter table public.economy_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.booster_balances enable row level security;
alter table public.booster_grants enable row level security;
alter table public.shop_orders enable row level security;
alter table public.pack_openings enable row level security;
alter table public.pack_opening_cards enable row level security;
alter table public.inventory_items enable row level security;
alter table public.discoveries enable row level security;
alter table public.finish_discoveries enable row level security;
alter table public.admin_audit_logs enable row level security;

-- ---------------------------------------------------------------- helpers
create function private.is_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin' and p.suspended_at is null)
$$;

create function private.require_player() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_suspended timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select p.suspended_at into v_suspended from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'profile_missing' using errcode = '28000';
  end if;
  if v_suspended is not null then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- Créneaux de boosters gratuits : 06 h et 18 h Europe/Paris, dans ]p_from, p_to].
create function private.free_slots_between(p_from timestamptz, p_to timestamptz)
returns setof timestamptz language sql stable set search_path = '' as $$
  select s from (
    select ((d::date + v.t) at time zone 'Europe/Paris') as s
    from generate_series((p_from at time zone 'Europe/Paris')::date,
                         (p_to at time zone 'Europe/Paris')::date,
                         interval '1 day') d
    cross join (values (time '06:00'), (time '18:00')) v(t)
  ) x
  where s > p_from and s <= p_to
  order by s
$$;

create function private.last_free_slot(p_at timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select max(s) from private.free_slots_between(p_at - interval '1 day', p_at) s
$$;

-- ---------------------------------------------------------------- création de compte
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb := (private.active_settings()).settings;
  v_welcome integer := coalesce((v_settings->>'welcome_free_boosters')::int, 0);
begin
  insert into public.profiles (id) values (new.id);
  insert into public.wallets (owner_id) values (new.id);
  insert into public.booster_balances (owner_id, free_count, free_synced_until)
    values (new.id, v_welcome, private.last_free_slot(now()));
  if v_welcome > 0 then
    insert into public.booster_grants (owner_id, source, pool, quantity)
      values (new.id, 'welcome', 'free', v_welcome);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- lecture directe autorisée
grant select on public.profiles, public.wallets, public.wallet_ledger, public.booster_balances,
  public.booster_grants, public.shop_orders, public.pack_openings, public.pack_opening_cards,
  public.inventory_items, public.discoveries, public.finish_discoveries
  to authenticated;

create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
create policy own_wallet on public.wallets for select to authenticated using (owner_id = auth.uid());
create policy own_ledger on public.wallet_ledger for select to authenticated using (owner_id = auth.uid());
create policy own_boosters on public.booster_balances for select to authenticated using (owner_id = auth.uid());
create policy own_grants on public.booster_grants for select to authenticated using (owner_id = auth.uid());
create policy own_orders on public.shop_orders for select to authenticated using (owner_id = auth.uid());
create policy own_openings on public.pack_openings for select to authenticated using (owner_id = auth.uid());
create policy own_opening_cards on public.pack_opening_cards for select to authenticated
  using (exists (select 1 from public.pack_openings o where o.id = opening_id and o.owner_id = auth.uid()));
create policy own_inventory on public.inventory_items for select to authenticated using (owner_id = auth.uid());
create policy own_discoveries on public.discoveries for select to authenticated using (owner_id = auth.uid());
create policy own_finish_discoveries on public.finish_discoveries for select to authenticated using (owner_id = auth.uid());

-- Référentiels non secrets.
grant select on public.clans, public.silhouettes, public.editions, public.pack_rulesets to anon, authenticated;
create policy read_clans on public.clans for select to anon, authenticated using (true);
create policy read_silhouettes on public.silhouettes for select to anon, authenticated using (true);
create policy read_editions on public.editions for select to anon, authenticated
  using (album_published and archived_at is null);
-- Transparence des probabilités appliquées.
create policy read_rulesets on public.pack_rulesets for select to anon, authenticated using (true);

-- `characters` : aucune lecture directe par les joueurs. L'identité d'une carte non
-- découverte ne doit jamais quitter le serveur ; l'album passe par public.get_album().
-- `economy_settings` et `admin_audit_logs` : administration uniquement (via RPC admin).

-- ---------------------------------------------------------------- RPC compte
create function public.set_handle(p_handle text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_handle text := trim(p_handle);
begin
  if v_handle !~ '^[[:alnum:]_.-]{3,24}$' then
    raise exception 'invalid_handle' using hint = '3 à 24 caractères : lettres, chiffres, _ . -';
  end if;
  begin
    update public.profiles set handle = v_handle where id = v_uid;
  exception when unique_violation then
    raise exception 'handle_taken';
  end;
  return v_handle;
end $$;
grant execute on function public.set_handle(text) to authenticated;
