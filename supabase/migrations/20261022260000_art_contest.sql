-- CARTEMA — concours d'illustrations (décision du 22/10/2026, premier concours le week-end suivant).
--  * Un concours (contests) s'ouvre entre deux dates sur une édition. Toutes ses cartes publiées sauf
--    les Mythiques et la carte unique sont proposables ; une carte non découverte s'affiche neutre
--    (nom et clan seulement) côté page.
--  * Un dessin par joueur et par carte (remplaçable : ses votes repartent à zéro), un vote par joueur
--    et par carte (modifiable, jamais pour soi). Dessins visibles tout de suite, signalables ; l'admin
--    peut en masquer un (il perd ses votes).
--  * Points : 1 point par carte à l'auteur du dessin en tête (à égalité, celui qui a atteint ce
--    nombre de votes en premier) ; après la clôture, +1 pour un dessin retenu (illustration principale
--    ou version alternative) et +1 pour un « vrai dessin ».
--  * Distribution (une seule fois) : barème par place en Deniers et boosters, titre « Illustrateur de
--    génie » pour les 3 premiers (succès personnalisé porteur du titre).
--  * Un dessin retenu donne à son auteur la carte avec cette illustration : Sanglante jusqu'à Très
--    rare, Dorée pour une Épique, Standard pour une Légendaire.

create table public.contests (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  edition_id uuid not null references public.editions(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  -- Barème par place : [{"from":1,"to":1,"deniers":3000,"boosters":10}, …] ; au-delà, « others ».
  rewards jsonb not null default '{"places":[{"from":1,"to":1,"deniers":3000,"boosters":10},{"from":2,"to":2,"deniers":2000,"boosters":6},{"from":3,"to":3,"deniers":1500,"boosters":4},{"from":4,"to":10,"deniers":500,"boosters":2}],"others":{"deniers":200,"boosters":1}}'::jsonb,
  rewarded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.contest_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  author_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_reason text,
  -- Décision de l'admin après la clôture.
  selected text check (selected in ('main', 'alternate')),
  line_label text,
  real_drawing boolean not null default false,
  granted_instance uuid references public.inventory_items(id),
  decided_at timestamptz,
  unique (contest_id, character_id, author_id)
);
create index contest_entries_card_ix on public.contest_entries (contest_id, character_id);

create table public.contest_votes (
  contest_id uuid not null references public.contests(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  voter_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid not null references public.contest_entries(id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (contest_id, character_id, voter_id)
);
create index contest_votes_entry_ix on public.contest_votes (entry_id);

create table public.contest_reports (
  entry_id uuid not null references public.contest_entries(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(trim(reason)) between 2 and 300),
  created_at timestamptz not null default now(),
  primary key (entry_id, reporter_id)
);

alter table public.contests enable row level security;
alter table public.contest_entries enable row level security;
alter table public.contest_votes enable row level security;
alter table public.contest_reports enable row level security;

-- Images des dessins : stockage public en lecture, chaque joueur n'écrit que dans son dossier.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('contest', 'contest', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute $p$create policy contest_own_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'contest' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  execute $p$create policy contest_admin_delete on storage.objects for delete to authenticated
    using (bucket_id = 'contest' and private.is_admin())$p$;
end $$;

-- Concours à montrer : ouvert, ou terminé depuis moins de 14 jours (classement et résultats).
create function private.current_contest() returns public.contests
language sql stable security definer set search_path = '' as $$
  select c.* from public.contests c
   where c.starts_at <= now() and c.ends_at > now() - interval '14 days'
   order by (c.ends_at > now()) desc, c.starts_at desc limit 1
$$;

create function private.contest_open(p_contest public.contests) returns boolean
language sql stable set search_path = '' as $$
  select p_contest.id is not null and p_contest.starts_at <= now() and p_contest.ends_at > now()
$$;

create function private.contest_card_ok(p_contest public.contests, p_character uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.characters c where c.id = p_character and c.edition_id = p_contest.edition_id
                  and c.status = 'published' and not c.is_unique and c.rarity <> 'Mythique')
$$;

-- Votes par dessin (dessins visibles), et date à laquelle il a atteint son total actuel.
create function private.contest_tally(p_contest uuid)
returns table (entry_id uuid, character_id uuid, author_id uuid, votes bigint, reached timestamptz, in_lead boolean)
language sql stable security definer set search_path = '' as $$
  with t as (
    select e.id, e.character_id, e.author_id, count(v.voter_id) as votes, coalesce(max(v.voted_at), e.created_at) as reached
      from public.contest_entries e
      left join public.contest_votes v on v.entry_id = e.id
     where e.contest_id = p_contest and e.hidden_at is null
     group by e.id)
  select t.id, t.character_id, t.author_id, t.votes, t.reached,
         t.votes > 0 and row_number() over (partition by t.character_id order by t.votes desc, t.reached, t.id) = 1
    from t
$$;

-- Classement : cartes en tête + dessins retenus + vrais dessins.
create function private.contest_ranking(p_contest uuid)
returns table (author_id uuid, handle text, leads bigint, selected bigint, drawings bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  with l as (select t.author_id, count(*) as leads from private.contest_tally(p_contest) t where t.in_lead group by t.author_id),
  a as (
    select e.author_id,
           count(*) filter (where e.selected is not null and e.hidden_at is null) as selected,
           count(*) filter (where e.real_drawing and e.hidden_at is null) as drawings
      from public.contest_entries e where e.contest_id = p_contest group by e.author_id),
  p as (select a.author_id, coalesce(l.leads, 0) as leads, a.selected, a.drawings,
               coalesce(l.leads, 0) + a.selected + a.drawings as points
          from a left join l on l.author_id = a.author_id)
  select p.author_id, pr.handle, p.leads, p.selected, p.drawings, p.points,
         rank() over (order by p.points desc) as place
    from p join public.profiles pr on pr.id = p.author_id
   where p.points > 0
   order by p.points desc, pr.handle
$$;

create function private.contest_json(p_contest public.contests, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_contest.id, 'title', p_contest.title, 'starts_at', p_contest.starts_at,
    'ends_at', p_contest.ends_at, 'open', private.contest_open(p_contest), 'rewarded', p_contest.rewarded_at is not null,
    'edition', (select e.name from public.editions e where e.id = p_contest.edition_id),
    'rewards', p_contest.rewards,
    'my_entries', (select count(*) from public.contest_entries e where e.contest_id = p_contest.id and e.author_id = p_uid),
    'my_points', coalesce((select r.points from private.contest_ranking(p_contest.id) r where r.author_id = p_uid), 0))
$$;

-- Page Concours : le concours, ses cartes (neutres si non découvertes) et le résumé de chaque carte.
create function public.get_contest() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
begin
  if v_contest.id is null then return null; end if;
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
        'mine', mine.character_id is not null, 'voted', voted.character_id is not null)
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

-- Dessins d'une carte, du plus voté au moins voté.
create function public.get_contest_card(p_character_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
begin
  if v_contest.id is null or not private.contest_card_ok(v_contest, p_character_id) then raise exception 'not_found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('entry_id', t.entry_id, 'image_path', e.image_path,
      'author', pr.handle, 'votes', t.votes, 'leading', t.in_lead, 'mine', e.author_id = v_uid,
      'my_vote', exists (select 1 from public.contest_votes v where v.entry_id = t.entry_id and v.voter_id = v_uid),
      'selected', e.selected, 'created_at', e.created_at) order by t.votes desc, t.reached, t.entry_id)
    from private.contest_tally(v_contest.id) t
    join public.contest_entries e on e.id = t.entry_id
    join public.profiles pr on pr.id = e.author_id
   where t.character_id = p_character_id), '[]'::jsonb);
end $$;

create function public.submit_contest_entry(p_character_id uuid, p_image_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
  v_id uuid;
begin
  if (select handle from public.profiles where id = v_uid) is null then raise exception 'handle_required'; end if;
  if not private.contest_open(v_contest) then raise exception 'contest_closed'; end if;
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

create function public.vote_contest_entry(p_entry_id uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
  v_entry public.contest_entries;
begin
  if not private.contest_open(v_contest) then raise exception 'contest_closed'; end if;
  select * into v_entry from public.contest_entries where id = p_entry_id and contest_id = v_contest.id and hidden_at is null;
  if not found then raise exception 'not_found'; end if;
  if v_entry.author_id = v_uid then raise exception 'own_entry'; end if;
  if not coalesce(p_on, true) then
    delete from public.contest_votes where voter_id = v_uid and entry_id = p_entry_id;
    return false;
  end if;
  insert into public.contest_votes (contest_id, character_id, voter_id, entry_id)
    values (v_contest.id, v_entry.character_id, v_uid, p_entry_id)
  on conflict (contest_id, character_id, voter_id) do update set entry_id = excluded.entry_id, voted_at = now();
  return true;
end $$;

create function public.report_contest_entry(p_entry_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  if not exists (select 1 from public.contest_entries where id = p_entry_id and hidden_at is null) then raise exception 'not_found'; end if;
  if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'message_required'; end if;
  insert into public.contest_reports (entry_id, reporter_id, reason) values (p_entry_id, v_uid, trim(p_reason))
    on conflict do nothing;
end $$;

create function public.get_contest_leaderboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
begin
  if v_contest.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('position', r.place, 'handle', r.handle, 'leads', r.leads,
      'selected', r.selected, 'real', r.drawings, 'points', r.points, 'me', r.author_id = v_uid) order by r.place, r.handle)
    from private.contest_ranking(v_contest.id) r), '[]'::jsonb);
end $$;

-- État du joueur : reprise de get_player_state (20261022250000_teaser_prefix) avec le concours ouvert.
create or replace function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_daily bigint := private.claim_daily_reward(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'handle', p.handle, 'role', p.role, 'created_at', p.created_at, 'title', p.title)
                from public.profiles p where p.id = v_uid),
    'balance', (select w.balance from public.wallets w where w.owner_id = v_uid),
    'boosters', jsonb_build_object(
      'free', v_boosters.free_count,
      'purchased', v_boosters.purchased_count,
      'free_capacity', (v_settings->>'free_booster_capacity')::int,
      'next_free_at', (select min(s) from private.free_slots_between(now(), now() + interval '1 day') s)),
    'booster_offers', v_settings->'booster_offers',
    'daily_reward', v_daily,
    -- Concours d'illustrations ouvert : pour la bannière du site.
    'contest', (select jsonb_build_object('id', c.id, 'title', c.title, 'ends_at', c.ends_at)
                  from public.contests c where c.starts_at <= now() and c.ends_at > now() order by c.ends_at limit 1),
    'missions_ready', (select count(*) from public.mission_assignments a join public.mission_templates t on t.code = a.template_code
                        where a.owner_id = v_uid and a.replaced_at is null and a.claimed_at is null and a.period_end > now()
                          and private.metric_value(v_uid, t.metric, a.period_start, a.period_end) >= t.target),
    'social_pending', (select count(*) from public.gifts where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.trades where recipient_id = v_uid and status = 'pending' and expires_at > now())
                    + (select count(*) from public.friendships where addressee_id = v_uid and status = 'pending'),
    -- Éditions ouvertes, avec leurs prix et les boosters achetés pour elles ; puis les éditions annoncées
    -- (« Soon ») : leur nom, leur code et leur sachet seulement.
    'editions', coalesce((
      select jsonb_agg(x.e order by x.teaser, x.created_at) from (
        select e.created_at, false as teaser,
               jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
                 'openable', private.edition_is_complete(e.id), 'teaser', false, 'theme', e.booster_theme,
                 'offers', private.edition_offers(e.id),
                 'reserve', coalesce((select b.count from public.booster_edition_balances b where b.owner_id = v_uid and b.edition_id = e.id), 0)) as e
          from public.editions e where e.packs_enabled and e.archived_at is null
        union all
        select e.created_at, true,
               jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix, 'teaser', true, 'openable', false, 'theme', e.booster_theme)
          from public.editions e where e.teaser and not e.packs_enabled and e.archived_at is null) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- administration
create function public.admin_contests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'edition_id', c.edition_id,
      'starts_at', c.starts_at, 'ends_at', c.ends_at, 'rewards', c.rewards, 'rewarded_at', c.rewarded_at,
      'open', private.contest_open(c),
      'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
      'reports', (select count(*) from public.contest_reports r join public.contest_entries e on e.id = r.entry_id
                   where e.contest_id = c.id and e.hidden_at is null)) order by c.starts_at desc)
    from public.contests c), '[]'::jsonb);
end $$;

create function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
                                          p_ends_at timestamptz, p_rewards jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_id uuid;
begin
  if p_ends_at is null or p_starts_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_dates'; end if;
  if not exists (select 1 from public.editions where id = p_edition_id) then raise exception 'not_found'; end if;
  if p_rewards is not null and (jsonb_typeof(p_rewards->'places') <> 'array' or jsonb_typeof(p_rewards->'others') <> 'object') then
    raise exception 'invalid_offer';
  end if;
  if p_id is null then
    insert into public.contests (title, edition_id, starts_at, ends_at, created_by)
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin)
      returning id into v_id;
    if p_rewards is not null then
      update public.contests set rewards = p_rewards where id = v_id;
    end if;
  else
    update public.contests set title = trim(p_title), edition_id = p_edition_id, starts_at = p_starts_at,
                               ends_at = p_ends_at, rewards = coalesce(p_rewards, rewards)
     where id = p_id and rewarded_at is null
     returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  perform private.audit(v_admin, 'contest_save', v_id, v_reason, null,
    jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'rewards', p_rewards));
  return v_id;
end $$;

-- Tous les dessins d'un concours, carte par carte, avec votes et signalements.
create function public.admin_contest_entries(p_contest_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('entry_id', e.id, 'character_id', e.character_id,
      'code', ed.prefix || '-' || lpad(c.number::text, 3, '0'), 'name', c.name, 'rarity', c.rarity, 'prefix', ed.prefix, 'number', c.number,
      'author', pr.handle, 'author_id', e.author_id, 'image_path', e.image_path, 'created_at', e.created_at,
      'votes', (select count(*) from public.contest_votes v where v.entry_id = e.id),
      'leading', coalesce((select t.in_lead from private.contest_tally(p_contest_id) t where t.entry_id = e.id), false),
      'hidden', e.hidden_at is not null, 'hidden_reason', e.hidden_reason,
      'reports', coalesce((select jsonb_agg(r.reason order by r.created_at) from public.contest_reports r where r.entry_id = e.id), '[]'::jsonb),
      'selected', e.selected, 'line_label', e.line_label, 'real_drawing', e.real_drawing, 'granted', e.granted_instance is not null)
      order by c.number, (select count(*) from public.contest_votes v where v.entry_id = e.id) desc)
    from public.contest_entries e
    join public.characters c on c.id = e.character_id
    join public.editions ed on ed.id = c.edition_id
    join public.profiles pr on pr.id = e.author_id
   where e.contest_id = p_contest_id), '[]'::jsonb);
end $$;

create function public.admin_hide_contest_entry(p_entry_id uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
begin
  update public.contest_entries set hidden_at = case when p_hidden then now() end,
                                    hidden_reason = case when p_hidden then v_reason end
   where id = p_entry_id;
  if not found then raise exception 'not_found'; end if;
  -- Un dessin masqué perd ses votes : ses votants peuvent voter pour un autre.
  if p_hidden then delete from public.contest_votes where entry_id = p_entry_id; end if;
  perform private.audit(v_admin, case when p_hidden then 'contest_hide' else 'contest_unhide' end, p_entry_id, v_reason, null, null);
end $$;

-- Décision sur un dessin, après la clôture : vrai dessin, et/ou retenu (principal ou alternatif).
-- Pour un dessin retenu, l'illustration est déjà publiée (p_art_path, envoyée par la page admin) :
-- principale = nouvelle illustration officielle ; alternative = version de la ligne p_line_label.
-- L'auteur reçoit la carte avec cette illustration (une seule fois).
create function public.admin_decide_contest_entry(p_entry_id uuid, p_selected text, p_line_label text, p_real_drawing boolean,
                                                  p_art_path text, p_art_meta jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_entry public.contest_entries;
  v_contest public.contests;
  v_char public.characters;
  v_art uuid;
  v_finish public.finish;
  v_instance uuid;
begin
  select * into v_entry from public.contest_entries where id = p_entry_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into v_contest from public.contests where id = v_entry.contest_id;
  if v_contest.ends_at > now() then raise exception 'contest_open'; end if;
  if p_selected is not null and p_selected not in ('main', 'alternate') then raise exception 'invalid_kind'; end if;
  if v_entry.selected is not null and p_selected is distinct from v_entry.selected then raise exception 'already_decided'; end if;
  select * into v_char from public.characters where id = v_entry.character_id for update;

  if p_selected is not null and v_entry.selected is null then
    perform private.assert_art(p_art_path, coalesce(p_art_meta, '{}'::jsonb));
    if p_art_path is null then raise exception 'invalid_art_path'; end if;
    if p_selected = 'main' then
      -- Le déclencheur garde l'ancienne illustration sur les exemplaires déjà possédés.
      update public.characters set art_path = p_art_path, art_meta = coalesce(p_art_meta, '{}'::jsonb),
                                   art_credit = (select handle from public.profiles where id = v_entry.author_id)
       where id = v_char.id;
      v_art := null;
    else
      insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, created_by)
        values (v_char.id, 'alternate', coalesce(nullif(trim(p_line_label), ''), 'Version du concours'), p_art_path,
                coalesce(p_art_meta, '{}'::jsonb), (select handle from public.profiles where id = v_entry.author_id), v_admin)
        returning id into v_art;
    end if;
    -- Carte offerte à l'auteur, avec cette illustration.
    v_finish := case when v_char.rarity in ('Commun', 'Peu commun', 'Rare', 'Très rare') then 'Sanglante'
                     when v_char.rarity = 'Épique' then 'Dorée' else 'Standard' end;
    insert into public.inventory_items (owner_id, character_id, finish, art_id)
      values (v_entry.author_id, v_char.id, v_finish, v_art) returning id into v_instance;
    insert into public.discoveries (owner_id, character_id) values (v_entry.author_id, v_char.id) on conflict do nothing;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (v_entry.author_id, v_char.id, v_finish)
      on conflict do nothing;
    update public.contest_entries set selected = p_selected, line_label = nullif(trim(p_line_label), ''),
                                      granted_instance = v_instance, decided_at = now()
     where id = p_entry_id;
    perform private.notify(v_entry.author_id, 'contest_selected', jsonb_build_object(
      'character', v_char.name, 'finish', v_finish, 'label', case when p_selected = 'main' then 'Illustration officielle' else coalesce(nullif(trim(p_line_label), ''), 'Version du concours') end));
  end if;

  update public.contest_entries set real_drawing = coalesce(p_real_drawing, real_drawing), decided_at = coalesce(decided_at, now())
   where id = p_entry_id;
  perform private.audit(v_admin, 'contest_decide', p_entry_id, v_reason, null,
    jsonb_build_object('selected', p_selected, 'line', p_line_label, 'real_drawing', p_real_drawing, 'instance', v_instance));
  return jsonb_build_object('selected', coalesce(p_selected, v_entry.selected), 'instance', v_instance, 'finish', v_finish);
end $$;

-- Distribution des récompenses (une seule fois, après la clôture).
create function public.admin_reward_contest(p_contest_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_contest public.contests;
  v_row record;
  v_place jsonb;
  v_deniers bigint;
  v_boosters integer;
  v_code text;
  v_count integer := 0;
begin
  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_contest.ends_at > now() then raise exception 'contest_open'; end if;
  if v_contest.rewarded_at is not null then raise exception 'already_granted'; end if;

  -- Titre du podium : un succès personnalisé porteur du titre, décerné aux 3 premières places.
  v_code := 'contest:' || v_contest.id;
  insert into public.achievements (code, label, description, secret, category, metric, target, reward_deniers, reward_boosters, title, sort)
    values (v_code, 'Illustrateur de génie', 'Sur le podium du concours « ' || v_contest.title || ' ».', false, 'custom', 'manual', 1, 0, 0,
            'Illustrateur de génie', 600)
    on conflict (code) do nothing;

  for v_row in select * from private.contest_ranking(p_contest_id) loop
    v_place := (select p from jsonb_array_elements(v_contest.rewards->'places') p
                 where v_row.place between (p->>'from')::int and (p->>'to')::int limit 1);
    v_place := coalesce(v_place, v_contest.rewards->'others');
    v_deniers := coalesce((v_place->>'deniers')::bigint, 0);
    v_boosters := coalesce((v_place->>'boosters')::int, 0);
    if v_deniers > 0 then
      perform private.apply_wallet_delta(v_row.author_id, v_deniers, 'contest_reward', 'contest', v_contest.id,
                                         'contest:' || v_contest.id);
    end if;
    if v_boosters > 0 then
      update public.booster_balances set purchased_count = purchased_count + v_boosters, updated_at = now() where owner_id = v_row.author_id;
      insert into public.booster_grants (owner_id, source, pool, quantity, ref_id) values (v_row.author_id, 'reward', 'purchased', v_boosters, v_contest.id);
    end if;
    if v_row.place <= 3 then
      insert into public.achievement_unlocks (owner_id, code) values (v_row.author_id, v_code) on conflict do nothing;
    end if;
    perform private.notify(v_row.author_id, 'contest_reward', jsonb_build_object('title', v_contest.title, 'position', v_row.place,
      'deniers', v_deniers, 'boosters', v_boosters, 'podium', v_row.place <= 3));
    v_count := v_count + 1;
  end loop;

  update public.contests set rewarded_at = now() where id = p_contest_id;
  perform private.audit(v_admin, 'contest_reward', p_contest_id, v_reason, null, jsonb_build_object('players', v_count));
  return jsonb_build_object('players', v_count);
end $$;

revoke execute on function private.current_contest(), private.contest_open(public.contests), private.contest_card_ok(public.contests, uuid),
  private.contest_tally(uuid), private.contest_ranking(uuid), private.contest_json(public.contests, uuid) from public, anon, authenticated;
revoke execute on function public.get_contest(), public.get_contest_card(uuid), public.submit_contest_entry(uuid, text),
  public.vote_contest_entry(uuid, boolean), public.report_contest_entry(uuid, text), public.get_contest_leaderboard(),
  public.admin_contests(), public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text),
  public.admin_contest_entries(uuid), public.admin_hide_contest_entry(uuid, boolean, text),
  public.admin_decide_contest_entry(uuid, text, text, boolean, text, jsonb, text), public.admin_reward_contest(uuid, text) from public, anon;
grant execute on function public.get_contest(), public.get_contest_card(uuid), public.submit_contest_entry(uuid, text),
  public.vote_contest_entry(uuid, boolean), public.report_contest_entry(uuid, text), public.get_contest_leaderboard(),
  public.admin_contests(), public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text),
  public.admin_contest_entries(uuid), public.admin_hide_contest_entry(uuid, boolean, text),
  public.admin_decide_contest_entry(uuid, text, text, boolean, text, jsonb, text), public.admin_reward_contest(uuid, text) to authenticated;
