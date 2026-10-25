-- CARTEMA — Mythiques au concours de dessin (décision de Swiiptz, 25/10/2026).
--  * Une Mythique rapporte ×3 (contests.mythic_multiplier) sur le point « en tête des votes » et le point
--    « dessin retenu » ; le point « vrai dessin » reste à 1. Pas de cumul avec le ×2 des cartes sans
--    illustration ou à illustration IA : une Mythique compte ×3 dans tous les cas.
--  * Le dessin doit « faire mythique » : précisé dans les règles (site) et sur la page du concours.
--  * Mythiques admises par défaut pour les nouveaux concours ; cochées sur le concours en cours (CAM 1),
--    dont la phrase « sauf les Mythiques » des règles écrites est corrigée. La carte unique reste exclue.
--  * Le classement est recalculé à la distribution : le ×3 vaut aussi pour CAM 1.

alter table public.contests add column mythic_multiplier smallint not null default 3 check (mythic_multiplier between 1 and 5);
alter table public.contests alter column allow_mythic set default true;

-- Multiplicateur des points d'une carte dans un concours.
create function private.contest_card_multiplier(p_contest uuid, p_character uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when c.rarity = 'Mythique' then greatest(k.mythic_multiplier, 1)
                               when c.art_path is null or c.art_ai then greatest(k.priority_multiplier, 1) else 1 end::bigint
                     from public.characters c, public.contests k where c.id = p_character and k.id = p_contest), 1)
$$;
revoke execute on function private.contest_card_multiplier(uuid, uuid) from public, anon, authenticated;

create or replace function private.contest_ranking(p_contest uuid)
returns table (author_id uuid, handle text, leads bigint, selected bigint, drawings bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  -- Points multipliés par carte : Mythique ×3, sinon carte à privilégier ×2 (sans cumul).
  with l as (select t.author_id, count(*) as leads,
               sum(private.contest_card_multiplier(p_contest, t.character_id)) as lead_points
          from private.contest_tally(p_contest) t where t.in_lead group by t.author_id),
  a as (
    select e.author_id,
           count(*) filter (where e.selected is not null and e.hidden_at is null) as selected,
           coalesce(sum(private.contest_card_multiplier(p_contest, e.character_id))
                    filter (where e.selected is not null and e.hidden_at is null), 0) as selected_points,
           count(*) filter (where e.real_drawing and e.hidden_at is null) as drawings
      from public.contest_entries e where e.contest_id = p_contest group by e.author_id),
  p as (select a.author_id, coalesce(l.leads, 0) as leads, a.selected, a.drawings,
               coalesce(l.lead_points, 0) + a.selected_points + a.drawings as points
          from a left join l on l.author_id = a.author_id)
  select p.author_id, pr.handle, p.leads, p.selected, p.drawings, p.points,
         rank() over (order by p.points desc) as place
    from p join public.profiles pr on pr.id = p.author_id
   where p.points > 0
   order by p.points desc, pr.handle
$$;

create or replace function private.contest_json(p_contest public.contests, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_contest.id, 'title', p_contest.title, 'starts_at', p_contest.starts_at,
    'ends_at', p_contest.ends_at, 'open', private.contest_open(p_contest), 'rewarded', p_contest.rewarded_at is not null,
    'edition', (select e.name from public.editions e where e.id = p_contest.edition_id),
    'rewards', p_contest.rewards, 'rules', p_contest.rules, 'priority_multiplier', p_contest.priority_multiplier,
    'allow_mythic', p_contest.allow_mythic, 'mythic_multiplier', p_contest.mythic_multiplier,
    'my_entries', (select count(*) from public.contest_entries e where e.contest_id = p_contest.id and e.author_id = p_uid),
    'my_points', coalesce((select r.points from private.contest_ranking(p_contest.id) r where r.author_id = p_uid), 0))
$$;

create or replace function public.get_contest() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
begin
  if v_contest.id is null then
    -- Pas de concours en cours : le prochain, annoncé 14 jours avant, sans cartes ni dessins.
    select c.* into v_contest from public.contests c
     where c.starts_at > now() and c.starts_at <= now() + interval '14 days' order by c.starts_at limit 1;
    if v_contest.id is null then return null; end if;
    return private.contest_json(v_contest, v_uid) || jsonb_build_object('upcoming', true, 'cards', '[]'::jsonb);
  end if;
  -- Le décompte des votes est fait une seule fois pour toutes les cartes.
  return private.contest_json(v_contest, v_uid) || jsonb_build_object('cards', coalesce((
    with t as materialized (select * from private.contest_tally(v_contest.id)),
    lead as (select t.character_id, pr.handle from t join public.profiles pr on pr.id = t.author_id where t.in_lead),
    cnt as (select t.character_id, count(*) as n from t group by t.character_id),
    mine as (select x.character_id from public.contest_entries x where x.contest_id = v_contest.id and x.author_id = v_uid),
    voted as (select v.character_id from public.contest_votes v where v.contest_id = v_contest.id and v.voter_id = v_uid)
    select jsonb_agg(jsonb_build_object(
        'character_id', c.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'number', c.number,
        'name', c.name, 'clan', cl.name, 'rarity', c.rarity, 'discovered', d.character_id is not null,
        'card', case when d.character_id is not null then private.card_json(c.id, 'Standard') end,
        'entries', coalesce(cnt.n, 0), 'leader', lead.handle,
        'mine', mine.character_id is not null, 'voted', voted.character_id is not null,
        'priority', c.art_path is null or c.art_ai or c.rarity = 'Mythique',
        'multiplier', case when c.rarity = 'Mythique' then greatest(v_contest.mythic_multiplier, 1)
                           when c.art_path is null or c.art_ai then greatest(v_contest.priority_multiplier, 1) else 1 end)
      order by c.number)
      from public.characters c
      join public.editions e on e.id = c.edition_id
      left join public.clans cl on cl.id = c.clan_id
      left join public.discoveries d on d.character_id = c.id and d.owner_id = v_uid
      left join lead on lead.character_id = c.id
      left join cnt on cnt.character_id = c.id
      left join mine on mine.character_id = c.id
      left join voted on voted.character_id = c.id
     where c.edition_id = v_contest.edition_id and c.status = 'published' and not c.is_unique
       and (c.rarity <> 'Mythique' or v_contest.allow_mythic)), '[]'::jsonb));
end $$;

create or replace function public.admin_contests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'edition_id', c.edition_id,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'rewards', c.rewards, 'rules', c.rules, 'rewarded_at', c.rewarded_at,
      'allow_mythic', c.allow_mythic, 'priority_multiplier', c.priority_multiplier, 'mythic_multiplier', c.mythic_multiplier,
      'open', private.contest_open(c),
      'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
      'reports', (select count(*) from public.contest_reports r join public.contest_entries e on e.id = r.entry_id
                   where e.contest_id = c.id and e.hidden_at is null)) order by c.starts_at desc)
    from public.contests c), '[]'::jsonb);
end $$;

create or replace function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
                                          p_ends_at timestamptz, p_rewards jsonb, p_reason text,
                                          p_rules text default null, p_allow_mythic boolean default null) returns uuid
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
    insert into public.contests (title, edition_id, starts_at, ends_at, created_by, rules, allow_mythic)
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin, v_rules, coalesce(p_allow_mythic, true))
      returning id into v_id;
    if p_rewards is not null then
      update public.contests set rewards = p_rewards where id = v_id;
    end if;
  else
    update public.contests set title = trim(p_title), edition_id = p_edition_id, starts_at = p_starts_at,
                               ends_at = p_ends_at, rewards = coalesce(p_rewards, rewards),
                               rules = case when p_rules is null then rules else v_rules end,
                               allow_mythic = coalesce(p_allow_mythic, allow_mythic)
     where id = p_id and rewarded_at is null
     returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  perform private.audit(v_admin, 'contest_save', v_id, v_reason, null,
    jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'rewards', p_rewards, 'rules', p_rules,
                       'allow_mythic', p_allow_mythic));
  return v_id;
end $$;

-- Concours non distribués (CAM 1) : Mythiques admises, règles écrites mises à jour.
update public.contests
   set allow_mythic = true,
       rules = replace(rules, 'sauf les Mythiques', 'Mythiques comprises (points ×3 : le dessin doit faire mythique)')
 where rewarded_at is null;
