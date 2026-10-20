-- CARTEMA — outils d'administration des joueurs (CDC : outils économiques et modération).
-- Toutes les actions exigent un motif et sont inscrites au journal d'administration
-- (état avant / après). Les ajustements sont idempotents (identifiant de requête).
--  * recherche et fiche joueur : soldes, collection, historique Deniers et boosters, journal ;
--  * ajustement de Deniers (crédit ou débit, jamais sous zéro) et de boosters achetés ;
--  * suspension du compte (plus aucune action ; ses ventes et enchères actives sont retirées,
--    les cartes engagées redeviennent libres) et blocage des seuls échanges / marché ;
--  * réinitialisation d'un pseudonyme inapproprié (le joueur doit en choisir un nouveau).
-- L'administrateur ne peut pas se sanctionner lui-même.

create function public.admin_search_players(p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role,
      'created_at', p.created_at, 'suspended', p.suspended_at is not null, 'blocked', p.transactions_blocked_at is not null)
      order by p.handle nulls last, p.created_at)
    from (select * from public.profiles p
           where coalesce(trim(p_query), '') = ''
              or p.handle ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '\_') || '%'
              or p.id::text = trim(p_query)
           order by p.handle nulls last, p.created_at limit 40) p), '[]'::jsonb);
end $$;

create function public.admin_player(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_p public.profiles;
begin
  perform private.require_admin();
  select * into v_p from public.profiles where id = p_id;
  if not found then raise exception 'player_not_found'; end if;
  return jsonb_build_object(
    'id', v_p.id, 'handle', v_p.handle, 'role', v_p.role, 'title', v_p.title, 'created_at', v_p.created_at,
    'suspended_at', v_p.suspended_at, 'blocked_at', v_p.transactions_blocked_at,
    'email', (select u.email from auth.users u where u.id = v_p.id),
    'balance', (select balance from public.wallets where owner_id = v_p.id),
    'boosters', (select jsonb_build_object('free', free_count, 'purchased', purchased_count) from public.booster_balances where owner_id = v_p.id),
    'cards', (select count(*) from public.inventory_items where owner_id = v_p.id and recycled_at is null),
    'faces', (select count(*) from public.discoveries where owner_id = v_p.id),
    'achievements', (select count(*) from public.achievement_unlocks where owner_id = v_p.id),
    'openings', (select count(*) from public.pack_openings where owner_id = v_p.id),
    'active_listings', (select count(*) from public.listings where seller_id = v_p.id and status = 'active'),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('delta', l.delta, 'balance_after', l.balance_after, 'kind', l.kind,
                 'created_at', l.created_at) order by l.id desc)
               from (select * from public.wallet_ledger where owner_id = v_p.id order by id desc limit 30) l), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('source', g.source, 'pool', g.pool, 'quantity', g.quantity,
                 'created_at', g.created_at) order by g.id desc)
               from (select * from public.booster_grants where owner_id = v_p.id order by id desc limit 20) g), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'created_at', a.created_at,
                 'actor', (select handle from public.profiles where id = a.actor_id), 'after', a.after_state) order by a.id desc)
               from (select * from public.admin_audit_logs where target_id = v_p.id order by id desc limit 30) a), '[]'::jsonb));
end $$;

create function private.require_reason(p_reason text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required'; end if;
  return trim(p_reason);
end $$;

create function public.admin_adjust_deniers(p_id uuid, p_delta bigint, p_reason text, p_request_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before bigint;
  v_after bigint;
begin
  if coalesce(p_delta, 0) = 0 then raise exception 'invalid_amount'; end if;
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select balance into v_before from public.wallets where owner_id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.wallet_ledger where owner_id = p_id and idempotency_key = 'admin:' || p_request_id) then
    return v_before;
  end if;
  v_after := private.apply_wallet_delta(p_id, p_delta, 'admin_adjust', 'admin', p_request_id, 'admin:' || p_request_id);
  perform private.audit(v_admin, 'deniers_adjust', p_id, v_reason, jsonb_build_object('balance', v_before),
                        jsonb_build_object('balance', v_after, 'delta', p_delta));
  return v_after;
end $$;

create function public.admin_adjust_boosters(p_id uuid, p_delta integer, p_reason text, p_request_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_b public.booster_balances;
begin
  if coalesce(p_delta, 0) = 0 then raise exception 'invalid_amount'; end if;
  if p_request_id is null then raise exception 'request_id_required'; end if;
  select * into v_b from public.booster_balances where owner_id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.booster_grants where owner_id = p_id and source = 'admin' and ref_id = p_request_id) then
    return v_b.purchased_count;
  end if;
  if v_b.purchased_count + p_delta < 0 then raise exception 'insufficient_boosters'; end if;
  update public.booster_balances set purchased_count = purchased_count + p_delta, updated_at = now() where owner_id = p_id;
  insert into public.booster_grants (owner_id, source, pool, quantity, ref_id) values (p_id, 'admin', 'purchased', p_delta, p_request_id);
  perform private.audit(v_admin, 'boosters_adjust', p_id, v_reason, jsonb_build_object('purchased', v_b.purchased_count),
                        jsonb_build_object('purchased', v_b.purchased_count + p_delta, 'delta', p_delta));
  return v_b.purchased_count + p_delta;
end $$;

create function public.admin_set_suspended(p_id uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
  v_listing public.listings;
begin
  select * into v_p from public.profiles where id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if p_id = v_admin or v_p.role = 'admin' then raise exception 'cannot_sanction_admin'; end if;
  if p_suspended and v_p.suspended_at is null then
    update public.profiles set suspended_at = now() where id = p_id;
    -- Ses ventes à prix fixe et ses enchères sans offre sont retirées ; les enchères déjà
    -- disputées vont à leur terme (l'enchérisseur a engagé ses Deniers).
    for v_listing in select * from public.listings where seller_id = p_id and status = 'active'
                       and not exists (select 1 from public.bids b where b.listing_id = listings.id) for update loop
      update public.listings set status = 'cancelled', closed_at = now() where id = v_listing.id;
      update public.inventory_items set reserved_kind = null, reserved_ref = null
       where id = v_listing.instance_id and reserved_ref = v_listing.id;
    end loop;
  elsif not p_suspended and v_p.suspended_at is not null then
    update public.profiles set suspended_at = null where id = p_id;
  else
    return;
  end if;
  perform private.audit(v_admin, case when p_suspended then 'player_suspend' else 'player_unsuspend' end, p_id, v_reason,
                        jsonb_build_object('suspended', v_p.suspended_at is not null), jsonb_build_object('suspended', p_suspended));
end $$;

create function public.admin_set_trade_block(p_id uuid, p_blocked boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if p_id = v_admin or v_p.role = 'admin' then raise exception 'cannot_sanction_admin'; end if;
  if (v_p.transactions_blocked_at is not null) = p_blocked then return; end if;
  update public.profiles set transactions_blocked_at = case when p_blocked then now() end where id = p_id;
  perform private.audit(v_admin, case when p_blocked then 'trade_block' else 'trade_unblock' end, p_id, v_reason,
                        jsonb_build_object('blocked', not p_blocked), jsonb_build_object('blocked', p_blocked));
end $$;

create function public.admin_reset_handle(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if v_p.handle is null then return; end if;
  update public.profiles set handle = null where id = p_id;
  perform private.audit(v_admin, 'handle_reset', p_id, v_reason, jsonb_build_object('handle', v_p.handle), jsonb_build_object('handle', null));
end $$;

-- Succès personnalisés : distinguer les automatiques (groupe de cartes, recyclage, ancienneté)
-- des succès à décerner à la main.
create or replace function public.admin_custom_achievements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description,
      'secret', a.secret, 'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title,
      'conditional', a.metric = 'characters', 'automatic', a.metric <> 'manual', 'edition', e.name,
      'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', ce.prefix || '-' || lpad(c.number::text, 3, '0')) order by c.number)
                               from public.characters c join public.editions ce on ce.id = c.edition_id
                              where c.id = any (coalesce(a.required_characters, '{}'))), '[]'::jsonb),
      'holders', (select coalesce(jsonb_agg(p.handle order by u.unlocked_at), '[]'::jsonb)
                    from public.achievement_unlocks u join public.profiles p on p.id = u.owner_id where u.code = a.code))
      order by a.label) from public.achievements a left join public.editions e on e.id = a.edition_id
     where a.category = 'custom'), '[]'::jsonb);
end $$;

revoke execute on function public.admin_search_players(text), public.admin_player(uuid),
  public.admin_adjust_deniers(uuid, bigint, text, uuid), public.admin_adjust_boosters(uuid, integer, text, uuid),
  public.admin_set_suspended(uuid, boolean, text), public.admin_set_trade_block(uuid, boolean, text),
  public.admin_reset_handle(uuid, text), private.require_reason(text) from public, anon;
grant execute on function public.admin_search_players(text), public.admin_player(uuid),
  public.admin_adjust_deniers(uuid, bigint, text, uuid), public.admin_adjust_boosters(uuid, integer, text, uuid),
  public.admin_set_suspended(uuid, boolean, text), public.admin_set_trade_block(uuid, boolean, text),
  public.admin_reset_handle(uuid, text) to authenticated;
revoke execute on function private.require_reason(text) from authenticated;
