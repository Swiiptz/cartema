-- CARTEMA — règles du concours écrites par l'admin (demande du 22/10/2026). Texte libre affiché dans
-- l'onglet Règles de /concours/ ; vide = règles par défaut du site. Les dates et le barème restent
-- calculés à part.
-- admin_save_contest reçoit p_rules en dernier, avec une valeur par défaut, pour que le site déjà en
-- ligne continue d'enregistrer : null = règles inchangées, texte vide = retour aux règles par défaut.

alter table public.contests add column rules text check (rules is null or length(rules) <= 8000);
comment on column public.contests.rules is 'Règles écrites par l''admin (null = règles par défaut du site).';

create or replace function private.contest_json(p_contest public.contests, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_contest.id, 'title', p_contest.title, 'starts_at', p_contest.starts_at,
    'ends_at', p_contest.ends_at, 'open', private.contest_open(p_contest), 'rewarded', p_contest.rewarded_at is not null,
    'edition', (select e.name from public.editions e where e.id = p_contest.edition_id),
    'rewards', p_contest.rewards, 'rules', p_contest.rules,
    'my_entries', (select count(*) from public.contest_entries e where e.contest_id = p_contest.id and e.author_id = p_uid),
    'my_points', coalesce((select r.points from private.contest_ranking(p_contest.id) r where r.author_id = p_uid), 0))
$$;

create or replace function public.admin_contests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'edition_id', c.edition_id,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'rewards', c.rewards, 'rules', c.rules, 'rewarded_at', c.rewarded_at,
      'open', private.contest_open(c),
      'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
      'reports', (select count(*) from public.contest_reports r join public.contest_entries e on e.id = r.entry_id
                   where e.contest_id = c.id and e.hidden_at is null)) order by c.starts_at desc)
    from public.contests c), '[]'::jsonb);
end $$;

drop function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text);
create function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
                                          p_ends_at timestamptz, p_rewards jsonb, p_reason text,
                                          p_rules text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_rules text := nullif(trim(p_rules), '');
  v_id uuid;
begin
  if p_ends_at is null or p_starts_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if not exists (select 1 from public.editions where id = p_edition_id) then raise exception 'not_found'; end if;
  if p_rewards is not null and (jsonb_typeof(p_rewards->'places') <> 'array' or jsonb_typeof(p_rewards->'others') <> 'object') then
    raise exception 'invalid_offer';
  end if;
  if length(v_rules) > 8000 then raise exception 'rules_too_long'; end if;
  if p_id is null then
    insert into public.contests (title, edition_id, starts_at, ends_at, created_by, rules)
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin, v_rules)
      returning id into v_id;
    if p_rewards is not null then
      update public.contests set rewards = p_rewards where id = v_id;
    end if;
  else
    update public.contests set title = trim(p_title), edition_id = p_edition_id, starts_at = p_starts_at,
                               ends_at = p_ends_at, rewards = coalesce(p_rewards, rewards),
                               rules = case when p_rules is null then rules else v_rules end
     where id = p_id and rewarded_at is null
     returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  perform private.audit(v_admin, 'contest_save', v_id, v_reason, null,
    jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'rewards', p_rewards, 'rules', p_rules));
  return v_id;
end $$;

revoke execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text) from public, anon;
grant execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text) to authenticated;
