-- CARTEMA — concours : votes prolongés sans envoi, titre « Illustrateur de talent » (décisions de Swiiptz, 25/10/2026).
--  * contests.submissions_end_at : fin des envois, avant la fin du concours (ends_at, fin des votes). Après elle,
--    submit_contest_entry refuse (submissions_closed) ; les votes restent ouverts jusqu'à ends_at. Null = envois
--    ouverts jusqu'à la fin. Réglable dans l'admin (admin_save_contest, dernier paramètre : null = inchangé,
--    une date à la fin ou après = pas de fin séparée).
--  * CAM 1 : envois arrêtés le 25/10 à 23 h 50 (sa fin d'origine), votes prolongés de 30 minutes à partir de l'application de la migration.
--  * Succès « contest_talent », titre « Illustrateur de talent » : débloqué au premier dessin soumis à un concours
--    (rattrapage pour les dessins déjà envoyés et non masqués). Le podium garde « Illustrateur de génie ».

alter table public.contests add column submissions_end_at timestamptz;
alter table public.contests add constraint contests_submissions_end check (submissions_end_at is null or
  (submissions_end_at > starts_at and submissions_end_at < ends_at));

update public.contests set submissions_end_at = ends_at, ends_at = now() + interval '30 minutes'
 where id = 'ff4fc310-2687-405e-b7ba-55a9036b0547' and rewarded_at is null;

insert into public.achievements (code, label, description, secret, category, metric, target, reward_deniers, reward_boosters, title, sort)
  values ('contest_talent', 'Illustrateur de talent', 'Soumettre au moins un dessin à un concours d’illustrations.', false, 'custom', 'manual', 1, 0, 0,
          'Illustrateur de talent', 599)
  on conflict (code) do nothing;
insert into public.achievement_unlocks (owner_id, code)
  select distinct e.author_id, 'contest_talent' from public.contest_entries e where e.hidden_at is null
  on conflict do nothing;

create function private.contest_talent_unlock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.achievement_unlocks (owner_id, code) values (new.author_id, 'contest_talent') on conflict do nothing;
  return new;
end $$;
revoke execute on function private.contest_talent_unlock() from public, anon, authenticated;
create trigger contest_entries_talent after insert on public.contest_entries
  for each row execute function private.contest_talent_unlock();

create or replace function public.submit_contest_entry(p_character_id uuid, p_image_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
  v_id uuid;
begin
  if (select handle from public.profiles where id = v_uid) is null then raise exception 'handle_required'; end if;
  if not private.contest_open(v_contest) then raise exception 'contest_closed'; end if;
  -- Prolongation « votes seulement » : plus de nouveau dessin après la fin des envois.
  if v_contest.submissions_end_at is not null and v_contest.submissions_end_at <= now() then raise exception 'submissions_closed'; end if;
  if not private.contest_card_ok(v_contest, p_character_id) then raise exception 'not_found'; end if;
  if p_image_path is null or split_part(p_image_path, '/', 1) <> v_uid::text or p_image_path like '%..%' then
    raise exception 'invalid_image';
  end if;
  insert into public.contest_entries (contest_id, character_id, author_id, image_path)
    values (v_contest.id, p_character_id, v_uid, p_image_path)
  on conflict (contest_id, character_id, author_id) do update
    set image_path = excluded.image_path, created_at = now(), hidden_at = null, hidden_reason = null
  returning id into v_id;
  -- Nouveau dessin : les votes reçus par l'ancien repartent à zéro.
  delete from public.contest_votes where entry_id = v_id;
  return v_id;
end $$;

create or replace function private.contest_json(p_contest public.contests, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_contest.id, 'title', p_contest.title, 'starts_at', p_contest.starts_at,
    'ends_at', p_contest.ends_at, 'open', private.contest_open(p_contest),
    'submissions_end_at', p_contest.submissions_end_at,
    'submissions_open', private.contest_open(p_contest) and (p_contest.submissions_end_at is null or p_contest.submissions_end_at > now()), 'rewarded', p_contest.rewarded_at is not null,
    'edition', (select e.name from public.editions e where e.id = p_contest.edition_id),
    'rewards', p_contest.rewards, 'rules', p_contest.rules, 'priority_multiplier', p_contest.priority_multiplier,
    'allow_mythic', p_contest.allow_mythic, 'mythic_multiplier', p_contest.mythic_multiplier,
    'my_entries', (select count(*) from public.contest_entries e where e.contest_id = p_contest.id and e.author_id = p_uid),
    'my_points', coalesce((select r.points from private.contest_ranking(p_contest.id) r where r.author_id = p_uid), 0))
$$;

create or replace function public.admin_contests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'edition_id', c.edition_id,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'rewards', c.rewards, 'rules', c.rules, 'rewarded_at', c.rewarded_at,
      'allow_mythic', c.allow_mythic, 'priority_multiplier', c.priority_multiplier, 'mythic_multiplier', c.mythic_multiplier,
      'open', private.contest_open(c), 'submissions_end_at', c.submissions_end_at,
      'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
      'reports', (select count(*) from public.contest_reports r join public.contest_entries e on e.id = r.entry_id
                   where e.contest_id = c.id and e.hidden_at is null)) order by c.starts_at desc)
    from public.contests c), '[]'::jsonb);
end $$;

drop function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean, integer, integer);
create function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
                                          p_ends_at timestamptz, p_rewards jsonb, p_reason text,
                                          p_rules text default null, p_allow_mythic boolean default null,
                                          p_priority_multiplier integer default null, p_mythic_multiplier integer default null,
                                          p_submissions_end_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_rules text := nullif(trim(p_rules), '');
  v_id uuid;
begin
  if p_ends_at is null or p_starts_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  -- Fin des envois : entre le début et la fin du concours ; à la fin (ou après), pas de fin séparée.
  if p_submissions_end_at is not null and p_submissions_end_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if not exists (select 1 from public.editions where id = p_edition_id) then raise exception 'not_found'; end if;
  if p_rewards is not null and (jsonb_typeof(p_rewards->'places') <> 'array' or jsonb_typeof(p_rewards->'others') <> 'object') then
    raise exception 'invalid_offer';
  end if;
  if length(v_rules) > 8000 then raise exception 'rules_too_long'; end if;
  if p_id is null then
    insert into public.contests (title, edition_id, starts_at, ends_at, created_by, rules, allow_mythic,
                                 priority_multiplier, mythic_multiplier)
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin, v_rules, coalesce(p_allow_mythic, true),
              coalesce(p_priority_multiplier, 2), coalesce(p_mythic_multiplier, 4))
      returning id into v_id;
    if p_submissions_end_at is not null and p_submissions_end_at < p_ends_at then
      update public.contests set submissions_end_at = p_submissions_end_at where id = v_id;
    end if;
    if p_rewards is not null then
      update public.contests set rewards = p_rewards where id = v_id;
    end if;
  else
    update public.contests set title = trim(p_title), edition_id = p_edition_id, starts_at = p_starts_at,
                               ends_at = p_ends_at, rewards = coalesce(p_rewards, rewards),
                               rules = case when p_rules is null then rules else v_rules end,
                               allow_mythic = coalesce(p_allow_mythic, allow_mythic),
                               priority_multiplier = coalesce(p_priority_multiplier, priority_multiplier),
                               mythic_multiplier = coalesce(p_mythic_multiplier, mythic_multiplier),
                               submissions_end_at = case when p_submissions_end_at is null then
                                                      case when submissions_end_at < p_ends_at then submissions_end_at end
                                                    when p_submissions_end_at < p_ends_at then p_submissions_end_at end
     where id = p_id and rewarded_at is null
     returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  perform private.audit(v_admin, 'contest_save', v_id, v_reason, null,
    jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'rewards', p_rewards, 'rules', p_rules,
                       'allow_mythic', p_allow_mythic, 'priority_multiplier', p_priority_multiplier,
                       'mythic_multiplier', p_mythic_multiplier, 'submissions_end_at', p_submissions_end_at));
  return v_id;
end $$;
revoke execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean, integer, integer, timestamptz) from public, anon;
grant execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean, integer, integer, timestamptz) to authenticated;
