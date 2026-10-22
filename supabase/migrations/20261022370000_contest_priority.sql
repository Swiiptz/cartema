-- CARTEMA — concours : cartes « à privilégier » (décision du 22/10/2026). Dessiner une carte sans
-- illustration, ou dont l'illustration a été générée par IA, rapporte plus : le point « en tête » et le
-- point « dessin retenu » sont multipliés par contests.priority_multiplier (2 par défaut). Le point
-- « vrai dessin » ne change pas.
--  * characters.art_ai : illustration générée par IA, cochée par l'admin (Personnages) ; remise à
--    faux automatiquement quand l'illustration officielle change (un nouveau dessin la remplace).
--  * get_contest : chaque carte porte « priority », le concours son multiplicateur (pastille et filtre).

alter table public.characters add column art_ai boolean not null default false;
comment on column public.characters.art_ai is 'Illustration officielle générée par IA (à remplacer : carte à privilégier aux concours).';
alter table public.contests add column priority_multiplier smallint not null default 2 check (priority_multiplier between 1 and 5);

-- Une nouvelle illustration officielle n'est plus « IA ».
create function private.reset_art_ai() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.art_path is distinct from old.art_path and new.art_ai = old.art_ai then new.art_ai := false; end if;
  return new;
end $$;
create trigger characters_reset_art_ai before update of art_path on public.characters
  for each row execute function private.reset_art_ai();

create function private.contest_priority(p_character uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.art_path is null or c.art_ai from public.characters c where c.id = p_character), false)
$$;

create function public.admin_set_art_ai(p_character_id uuid, p_ai boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
begin
  update public.characters set art_ai = coalesce(p_ai, false) where id = p_character_id;
  if not found then raise exception 'not_found'; end if;
  perform private.audit(v_admin, 'character_art_ai', p_character_id, v_reason, null, jsonb_build_object('art_ai', p_ai));
end $$;

revoke execute on function private.reset_art_ai(), private.contest_priority(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_art_ai(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_art_ai(uuid, boolean, text) to authenticated;

create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers,
        'eternal', e.eternal, 'eternal_drops', e.eternal_drops,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit, 'art_ai', c.art_ai,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;

create or replace function private.contest_ranking(p_contest uuid)
returns table (author_id uuid, handle text, leads bigint, selected bigint, drawings bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  -- Cartes à privilégier (sans illustration ou illustration IA) : points multipliés.
  with m as (select greatest(coalesce(c.priority_multiplier, 1), 1)::bigint as mult from public.contests c where c.id = p_contest),
  l as (select t.author_id, count(*) as leads,
               sum(case when private.contest_priority(t.character_id) then (select mult from m) else 1 end) as lead_points
          from private.contest_tally(p_contest) t where t.in_lead group by t.author_id),
  a as (
    select e.author_id,
           count(*) filter (where e.selected is not null and e.hidden_at is null) as selected,
           coalesce(sum(case when private.contest_priority(e.character_id) then (select mult from m) else 1 end)
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
     where c.edition_id = v_contest.edition_id and c.status = 'published' and not c.is_unique and c.rarity <> 'Mythique'), '[]'::jsonb));
end $$;
