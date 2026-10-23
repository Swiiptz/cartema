-- CARTEMA — concours : Mythiques sur option et galerie des concours terminés (décisions du 23/10/2026).
--  * contests.allow_mythic : les Mythiques de l'édition peuvent être dessinées (case de l'admin, décochée
--    par défaut). La carte unique (Caïn) reste toujours exclue. Un dessin retenu sur une Mythique est offert
--    en Standard, comme pour une Légendaire (déjà le cas dans admin_decide_contest_entry).
--  * get_contest_gallery : concours clos (albums publiés), avec leurs dessins retenus (carte rendue avec
--    l'illustration retenue, auteur, ligne) et le podium une fois les récompenses distribuées.
--  * admin_save_contest reçoit p_allow_mythic en dernier (null = inchangé) : le site déjà en ligne continue
--    d'enregistrer.

alter table public.contests add column allow_mythic boolean not null default false;
comment on column public.contests.allow_mythic is 'Les Mythiques de l''édition peuvent être dessinées (jamais la carte unique).';

create or replace function private.contest_card_ok(p_contest public.contests, p_character uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.characters c where c.id = p_character and c.edition_id = p_contest.edition_id
                  and c.status = 'published' and not c.is_unique
                  and (c.rarity <> 'Mythique' or p_contest.allow_mythic))
$$;

create or replace function private.contest_json(p_contest public.contests, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_contest.id, 'title', p_contest.title, 'starts_at', p_contest.starts_at,
    'ends_at', p_contest.ends_at, 'open', private.contest_open(p_contest), 'rewarded', p_contest.rewarded_at is not null,
    'edition', (select e.name from public.editions e where e.id = p_contest.edition_id),
    'rewards', p_contest.rewards, 'rules', p_contest.rules, 'priority_multiplier', p_contest.priority_multiplier,
    'allow_mythic', p_contest.allow_mythic,
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
        'priority', c.art_path is null or c.art_ai)
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
      'allow_mythic', c.allow_mythic, 'priority_multiplier', c.priority_multiplier,
      'open', private.contest_open(c),
      'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
      'reports', (select count(*) from public.contest_reports r join public.contest_entries e on e.id = r.entry_id
                   where e.contest_id = c.id and e.hidden_at is null)) order by c.starts_at desc)
    from public.contests c), '[]'::jsonb);
end $$;

drop function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text);
create function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
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
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin, v_rules, coalesce(p_allow_mythic, false))
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
revoke execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean) from public, anon;
grant execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean) to authenticated;

-- Galerie : les 12 derniers concours clos. Le classement n'est calculé que pour les concours distribués
-- (podium définitif), une fois par concours.
create function public.get_contest_gallery() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', c.title, 'edition', e.name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'final', c.rewarded_at is not null,
      'entries', (select count(*) from public.contest_entries x where x.contest_id = c.id and x.hidden_at is null),
      'artists', (select count(distinct x.author_id) from public.contest_entries x where x.contest_id = c.id and x.hidden_at is null),
      'podium', case when c.rewarded_at is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('place', r.place, 'handle', r.handle, 'points', r.points,
                                            'selected', r.selected, 'leads', r.leads) order by r.place, r.handle)
          from private.contest_ranking(c.id) r where r.place <= 3), '[]'::jsonb) end,
      'selected', coalesce((
        select jsonb_agg(jsonb_build_object(
            'entry_id', x.id, 'character', ch.name, 'code', e.prefix || '-' || lpad(ch.number::text, 3, '0'),
            'rarity', ch.rarity, 'author', p.handle, 'kind', x.selected, 'line_label', x.line_label,
            'real_drawing', x.real_drawing, 'image_path', x.image_path,
            'card', private.card_json(ch.id, 'Standard', x.granted_instance))
          order by (x.selected = 'main') desc, ch.number)
          from public.contest_entries x
          join public.characters ch on ch.id = x.character_id
          left join public.profiles p on p.id = x.author_id
         where x.contest_id = c.id and x.selected is not null and x.hidden_at is null), '[]'::jsonb))
    order by c.ends_at desc)
    from (select * from public.contests where ends_at <= now() order by ends_at desc limit 12) c
    join public.editions e on e.id = c.edition_id
   where e.album_published), '[]'::jsonb);
end $$;
revoke execute on function public.get_contest_gallery() from public, anon;
grant execute on function public.get_contest_gallery() to authenticated;
