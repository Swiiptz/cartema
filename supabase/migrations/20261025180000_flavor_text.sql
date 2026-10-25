-- CARTEMA — textes d'ambiance (suggestion d'un joueur, 25/10/2026). Un joueur propose un court texte (10 à 200
-- caractères) depuis la fiche d'une carte découverte (contribution « ambiance ») ; une fois accepté par l'admin, il
-- devient le texte de la carte (characters.flavor_text, auteur dans flavor_author), affiché dans la fiche par
-- get_card_flavor, seulement pour un joueur qui a découvert la carte.

alter table public.card_submissions drop constraint card_submissions_kind_check;
alter table public.card_submissions add constraint card_submissions_kind_check check (kind in ('info', 'illustration', 'credit', 'ambiance'));
alter table public.characters add column flavor_text text check (flavor_text is null or length(flavor_text) <= 200);
alter table public.characters add column flavor_author uuid references public.profiles(id) on delete set null;

create or replace function public.submit_card_feedback(p_code text, p_kind text, p_message text, p_image_path text default null,
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
  if p_kind not in ('info', 'illustration', 'credit', 'ambiance') then raise exception 'invalid_kind'; end if;
  -- Texte d'ambiance : 10 à 200 caractères.
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) < 10 then raise exception 'message_required'; end if;
  if p_kind = 'ambiance' and length(trim(coalesce(p_message, ''))) > 200 then raise exception 'too_long'; end if;
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

create or replace function public.admin_decide_submission(p_id uuid, p_accept boolean, p_reward_deniers bigint, p_reward_boosters integer, p_note text)
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
  -- Texte d'ambiance accepté : il devient celui de la carte (le précédent est remplacé).
  if p_accept and v_sub.kind = 'ambiance' then
    update public.characters set flavor_text = trim(v_sub.message), flavor_author = v_sub.owner_id where id = v_sub.character_id;
  end if;
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

create function public.get_card_flavor(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if not exists (select 1 from public.discoveries where owner_id = v_uid and character_id = p_character_id) then
    raise exception 'not_discovered';
  end if;
  return (select case when c.flavor_text is null then null
                      else jsonb_build_object('text', c.flavor_text, 'author', (select handle from public.profiles where id = c.flavor_author)) end
            from public.characters c where c.id = p_character_id);
end $$;
revoke execute on function public.get_card_flavor(uuid) from public, anon;
grant execute on function public.get_card_flavor(uuid) to authenticated;
