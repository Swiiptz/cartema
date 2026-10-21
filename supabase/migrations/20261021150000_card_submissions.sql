-- CARTEMA — contributions des joueurs sur les cartes (demande du 21/10/2026).
--  * Depuis la fiche d'une carte découverte : signaler une information erronée, proposer une
--    illustration (nouvelle si la carte n'en a pas, remplacement sinon) avec une image, ou demander
--    à être crédité comme artiste de l'illustration (nom affiché dans la fiche après validation).
--  * Images : bucket privé « submissions », chaque joueur n'écrit que dans son dossier ;
--    lecture par l'auteur et l'administrateur. PNG / WebP / JPEG, 10 Mo.
--  * 10 propositions par jour et par joueur ; une seule en attente par carte et par type.
--  * L'administrateur accepte (récompense en Deniers et / ou boosters, 1 booster proposé pour une
--    nouvelle illustration) ou refuse avec une note ; l'auteur est notifié. L'application d'une
--    illustration (officielle ou version alternative) se fait depuis l'administration.

create table public.card_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  kind text not null check (kind in ('info', 'illustration', 'credit')),
  credit_name text check (credit_name is null or length(trim(credit_name)) between 2 and 80),
  message text not null default '' check (length(message) <= 1500),
  image_path text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  admin_note text,
  reward_deniers bigint not null default 0 check (reward_deniers >= 0),
  reward_boosters integer not null default 0 check (reward_boosters >= 0),
  check (kind <> 'illustration' or image_path is not null),
  check (kind <> 'info' or length(trim(message)) >= 5),
  check (kind <> 'credit' or credit_name is not null)
);
create unique index card_submissions_pending on public.card_submissions (owner_id, character_id, kind) where status = 'pending';
create index card_submissions_status_ix on public.card_submissions (status, created_at desc);
alter table public.card_submissions enable row level security;
grant select on public.card_submissions to authenticated;
create policy own_submissions on public.card_submissions for select to authenticated using (owner_id = (select auth.uid()));

-- Bucket des images proposées (ignoré hors Supabase, tests PGlite).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('submissions', 'submissions', false, 10485760, array['image/png', 'image/webp', 'image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute $p$create policy submissions_own_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  execute $p$create policy submissions_read on storage.objects for select to authenticated
    using (bucket_id = 'submissions' and ((storage.foldername(name))[1] = (select auth.uid())::text or private.is_admin()))$p$;
  execute $p$create policy submissions_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'submissions' and private.is_admin())$p$;
end $$;

create or replace function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('friend_request', 'friend_accepted') then 'friends'
    when p_kind in ('gift_received', 'gift_answered', 'trade_received', 'trade_answered', 'submission_decided') then 'social'
    when p_kind in ('listing_sold', 'outbid', 'auction_won', 'auction_unsold', 'wish_listed') then 'market'
    when p_kind in ('report_received', 'submission_received') then 'moderation'
    else 'achievements' end
$$;

create function public.submit_card_feedback(p_code text, p_kind text, p_message text, p_image_path text default null,
                                            p_credit_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_character uuid := private.character_by_code(p_code);
  v_id uuid;
begin
  if v_character is null then raise exception 'not_found'; end if;
  -- On ne propose rien sur une carte jamais vue (son identité resterait cachée à l'auteur).
  if not exists (select 1 from public.discoveries where owner_id = v_uid and character_id = v_character) then raise exception 'not_discovered'; end if;
  if p_kind not in ('info', 'illustration', 'credit') then raise exception 'invalid_kind'; end if;
  if p_kind = 'credit' and length(trim(coalesce(p_credit_name, ''))) not between 2 and 80 then raise exception 'credit_required'; end if;
  if p_kind = 'info' and length(trim(coalesce(p_message, ''))) < 5 then raise exception 'message_required'; end if;
  if p_kind = 'illustration' and (p_image_path is null or split_part(p_image_path, '/', 1) <> v_uid::text or p_image_path like '%..%') then
    raise exception 'image_required';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.card_submissions where owner_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_submissions';
  end if;
  insert into public.card_submissions (owner_id, character_id, kind, message, image_path, credit_name)
    values (v_uid, v_character, p_kind, left(trim(coalesce(p_message, '')), 1500), case when p_kind = 'illustration' then p_image_path end,
            nullif(trim(coalesce(p_credit_name, '')), ''))
    on conflict do nothing returning id into v_id;
  if v_id is null then raise exception 'already_submitted'; end if;
  perform private.notify((select id from public.profiles where role = 'admin' limit 1), 'submission_received',
    jsonb_build_object('from', private.handle_of(v_uid), 'kind', p_kind,
                       'card', (select name from public.characters where id = v_character)));
  return v_id;
end $$;

create function public.get_my_submissions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'created_at', s.created_at,
      'card', c.name, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'admin_note', s.admin_note,
      'reward_deniers', s.reward_deniers, 'reward_boosters', s.reward_boosters) order by s.created_at desc)
    from public.card_submissions s join public.characters c on c.id = s.character_id join public.editions e on e.id = c.edition_id
   where s.owner_id = v_uid), '[]'::jsonb);
end $$;

create function public.admin_submissions(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'message', s.message,
      'image_path', s.image_path, 'credit_name', s.credit_name, 'art_credit', c.art_credit, 'created_at', s.created_at, 'decided_at', s.decided_at, 'admin_note', s.admin_note,
      'reward_deniers', s.reward_deniers, 'reward_boosters', s.reward_boosters,
      'author', (select handle from public.profiles where id = s.owner_id),
      'character_id', c.id, 'name', c.name, 'number', c.number, 'prefix', e.prefix, 'rarity', c.rarity,
      'role_title', c.role_title, 'clan', (select name from public.clans where id = c.clan_id),
      'art_path', c.art_path, 'art_meta', c.art_meta, 'silhouette_key', c.silhouette_key) order by s.created_at desc)
    from (select * from public.card_submissions where p_status = 'all' or status = p_status order by created_at desc limit 100) s
    join public.characters c on c.id = s.character_id join public.editions e on e.id = c.edition_id), '[]'::jsonb);
end $$;

create function public.admin_decide_submission(p_id uuid, p_accept boolean, p_reward_deniers bigint, p_reward_boosters integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_sub public.card_submissions;
  v_deniers bigint := case when p_accept then greatest(coalesce(p_reward_deniers, 0), 0) else 0 end;
  v_boosters integer := case when p_accept then greatest(coalesce(p_reward_boosters, 0), 0) else 0 end;
begin
  if not p_accept and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'reason_required'; end if;
  if v_deniers > 100000 or v_boosters > 20 then raise exception 'invalid_amount'; end if;
  select * into v_sub from public.card_submissions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_sub.status <> 'pending' then raise exception 'already_closed'; end if;
  update public.card_submissions set status = case when p_accept then 'accepted' else 'rejected' end, decided_at = now(),
         decided_by = v_admin, admin_note = nullif(trim(coalesce(p_note, '')), ''), reward_deniers = v_deniers, reward_boosters = v_boosters
   where id = p_id;
  if v_deniers > 0 then
    perform private.apply_wallet_delta(v_sub.owner_id, v_deniers, 'contribution_reward', 'submission', p_id, 'submission:' || p_id);
  end if;
  if v_boosters > 0 then
    update public.booster_balances set purchased_count = purchased_count + v_boosters, updated_at = now() where owner_id = v_sub.owner_id;
    insert into public.booster_grants (owner_id, source, pool, quantity, ref_id) values (v_sub.owner_id, 'reward', 'purchased', v_boosters, p_id);
  end if;
  perform private.notify(v_sub.owner_id, 'submission_decided', jsonb_build_object('accepted', p_accept, 'kind', v_sub.kind,
    'card', (select name from public.characters where id = v_sub.character_id), 'note', nullif(trim(coalesce(p_note, '')), ''),
    'reward_deniers', v_deniers, 'reward_boosters', v_boosters));
  perform private.audit(v_admin, case when p_accept then 'submission_accept' else 'submission_reject' end, v_sub.owner_id,
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Contribution acceptée'), null,
    jsonb_build_object('submission', p_id, 'kind', v_sub.kind, 'deniers', v_deniers, 'boosters', v_boosters));
end $$;

revoke execute on function public.submit_card_feedback(text, text, text, text, text), public.get_my_submissions(),
  public.admin_submissions(text), public.admin_decide_submission(uuid, boolean, bigint, integer, text) from public, anon;
grant execute on function public.submit_card_feedback(text, text, text, text, text), public.get_my_submissions(),
  public.admin_submissions(text), public.admin_decide_submission(uuid, boolean, bigint, integer, text) to authenticated;
