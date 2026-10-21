-- CARTEMA — signalements (modération) et don / retrait de cartes par l'administrateur (CDC §8).
--  * Signalement : un joueur signale un autre joueur (pseudonyme, triche, comportement, autre) avec
--    un message ; un seul signalement ouvert par couple, 5 par jour et par joueur. L'administrateur
--    est notifié, traite ou classe sans suite avec une note ; tout est journalisé.
--  * Don de carte : 1 à 20 exemplaires d'un personnage publié, finition au choix, découverte
--    acquise (sans récompense de découverte : c'est une correction), idempotent, motivé.
--  * Retrait : l'exemplaire sort de l'inventaire comme un recyclage (removed_at en plus), sans
--    Deniers ; impossible s'il est engagé (vente, enchère, échange, cadeau). La découverte reste.
--  * La carte unique n'est ni donnée ni retirée.

alter table public.inventory_items add column removed_at timestamptz;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('pseudo', 'triche', 'comportement', 'autre')),
  message text not null check (length(trim(message)) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  note text,
  check (reporter_id <> target_id)
);
create unique index reports_open_pair on public.reports (reporter_id, target_id) where status = 'open';
create index reports_status_ix on public.reports (status, created_at desc);
alter table public.reports enable row level security;
grant select on public.reports to authenticated;
create policy own_reports on public.reports for select to authenticated using (reporter_id = (select auth.uid()));

create or replace function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('friend_request', 'friend_accepted') then 'friends'
    when p_kind in ('gift_received', 'gift_answered', 'trade_received', 'trade_answered') then 'social'
    when p_kind in ('listing_sold', 'outbid', 'auction_won', 'auction_unsold', 'wish_listed') then 'market'
    when p_kind in ('report_received') then 'moderation'
    else 'achievements' end
$$;

create function public.report_player(p_handle text, p_category text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_target uuid;
begin
  select id into v_target from public.profiles where lower(handle) = lower(trim(p_handle)) and suspended_at is null;
  if v_target is null then raise exception 'player_not_found'; end if;
  if v_target = v_uid then raise exception 'self_report'; end if;
  if length(trim(coalesce(p_message, ''))) < 5 then raise exception 'message_required'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_reports';
  end if;
  insert into public.reports (reporter_id, target_id, category, message) values (v_uid, v_target, p_category, trim(p_message))
    on conflict do nothing;
  if not found then raise exception 'already_reported'; end if;
  perform private.notify((select id from public.profiles where role = 'admin' limit 1), 'report_received',
    jsonb_build_object('from', private.handle_of(v_uid), 'target', private.handle_of(v_target), 'category', p_category));
end $$;

create function public.admin_reports(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'message', r.message, 'status', r.status,
      'created_at', r.created_at, 'closed_at', r.closed_at, 'note', r.note,
      'reporter', (select handle from public.profiles where id = r.reporter_id),
      'target', (select handle from public.profiles where id = r.target_id), 'target_id', r.target_id,
      'target_reports', (select count(*) from public.reports x where x.target_id = r.target_id),
      'target_suspended', (select suspended_at is not null from public.profiles where id = r.target_id))
      order by r.created_at desc)
    from (select * from public.reports where p_status = 'all' or status = p_status order by created_at desc limit 100) r), '[]'::jsonb);
end $$;

create function public.admin_close_report(p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_note text := private.require_reason(p_note);
  v_report public.reports;
begin
  if p_status not in ('resolved', 'dismissed') then raise exception 'invalid_status'; end if;
  select * into v_report from public.reports where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_report.status <> 'open' then raise exception 'already_closed'; end if;
  update public.reports set status = p_status, closed_at = now(), closed_by = v_admin, note = v_note where id = p_id;
  perform private.audit(v_admin, 'report_' || p_status, v_report.target_id, v_note,
                        jsonb_build_object('report', p_id, 'category', v_report.category), null);
end $$;

-- ---------------------------------------------------------------- cartes d'un joueur
create function public.admin_player_cards(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(private.card_json(i.character_id, i.finish, i.id)
      || jsonb_build_object('locked', i.locked, 'reserved_kind', i.reserved_kind, 'acquired_at', i.acquired_at)
      order by c.number, i.finish, i.acquired_at)
    from public.inventory_items i join public.characters c on c.id = i.character_id
   where i.owner_id = p_id and i.recycled_at is null), '[]'::jsonb);
end $$;

create function public.admin_grant_card(p_id uuid, p_character_id uuid, p_finish public.finish, p_quantity integer,
                                        p_reason text, p_request_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_char public.characters;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  if coalesce(p_quantity, 0) not between 1 and 20 then raise exception 'invalid_amount'; end if;
  perform 1 from public.profiles where id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.admin_audit_logs where action = 'card_grant' and target_id = p_id
              and after_state->>'request_id' = p_request_id::text) then
    return p_quantity;
  end if;
  select * into v_char from public.characters where id = p_character_id;
  if not found or v_char.status <> 'published' then raise exception 'not_found'; end if;
  if v_char.is_unique then raise exception 'unique_card'; end if;
  insert into public.inventory_items (owner_id, character_id, finish)
    select p_id, p_character_id, coalesce(p_finish, 'Standard') from generate_series(1, p_quantity);
  insert into public.discoveries (owner_id, character_id) values (p_id, p_character_id) on conflict do nothing;
  insert into public.finish_discoveries (owner_id, character_id, finish) values (p_id, p_character_id, coalesce(p_finish, 'Standard'))
    on conflict do nothing;
  perform private.audit(v_admin, 'card_grant', p_id, v_reason, null, jsonb_build_object('request_id', p_request_id,
    'character', v_char.name, 'character_id', p_character_id, 'finish', coalesce(p_finish, 'Standard'), 'quantity', p_quantity));
  return p_quantity;
end $$;

create function public.admin_remove_card(p_instance_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = p_instance_id for update;
  if not found or v_item.recycled_at is not null then raise exception 'not_found'; end if;
  if v_item.reserved_kind is not null then raise exception 'card_reserved'; end if;
  if (select is_unique from public.characters where id = v_item.character_id) then raise exception 'unique_card'; end if;
  update public.inventory_items set locked = false, recycled_at = now(), removed_at = now() where id = p_instance_id;
  update public.profiles set showcase = array_remove(showcase, p_instance_id) where id = v_item.owner_id;
  perform private.audit(v_admin, 'card_remove', v_item.owner_id, v_reason, jsonb_build_object('instance', p_instance_id,
    'character', (select name from public.characters where id = v_item.character_id), 'finish', v_item.finish), null);
end $$;

-- Retraits par l'administrateur exclus du succès « recycler toutes les cartes ».
create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(d.character_id), count(*)
        from public.characters c
        left join public.discoveries d on d.character_id = c.id and d.owner_id = p_owner
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(d.character_id), cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        left join public.discoveries d on d.character_id = rc.id and d.owner_id = p_owner;
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null
                                               and i.removed_at is null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

revoke execute on function public.report_player(text, text, text), public.admin_reports(text), public.admin_close_report(uuid, text, text),
  public.admin_player_cards(uuid), public.admin_grant_card(uuid, uuid, public.finish, integer, text, uuid),
  public.admin_remove_card(uuid, text) from public, anon;
grant execute on function public.report_player(text, text, text), public.admin_reports(text), public.admin_close_report(uuid, text, text),
  public.admin_player_cards(uuid), public.admin_grant_card(uuid, uuid, public.finish, integer, text, uuid),
  public.admin_remove_card(uuid, text) to authenticated;
