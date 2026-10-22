-- CARTEMA — mise à jour du 22/10/2026 (lot 2) : doléances, annonce du concours à venir, paliers de
-- succès pour la prochaine extension.
--  * Doléances : un joueur propose une idée (fonctionnalité, carte, correction, autre), privée par
--    défaut. L'admin répond, change le statut et peut la rendre publique ; les joueurs votent alors
--    pour les idées publiques (un vote chacun, jamais pour la sienne). L'auteur est notifié de la
--    réponse, l'admin de chaque nouvelle doléance. 5 doléances par jour de jeu.
--  * Concours à venir : get_player_state renvoie contest_next (concours qui commence dans les 14 jours)
--    pour l'annonce de l'accueil ; get_contest renvoie ce concours (upcoming, sans cartes) quand aucun
--    n'est en cours, pour que la page montre le compte à rebours et les règles.
--  * Paliers (décision du 22/10) : Visages 500 et Rituels 2 000 (5e palier), Éclats d'or 25 et Sang versé
--    10 (4e palier). Le social (Coterie, Pactes) et le Négoce ne changent pas.

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('feature', 'card', 'bug', 'other')),
  title text not null check (length(title) between 3 and 80),
  body text not null default '' check (length(body) <= 2000),
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  public boolean not null default false,
  reply text check (reply is null or length(reply) <= 1000),
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index suggestions_author_ix on public.suggestions (author_id, created_at desc);
create index suggestions_public_ix on public.suggestions (created_at desc) where public;
alter table public.suggestions enable row level security;

create table public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (suggestion_id, voter_id)
);
create index suggestion_votes_voter_ix on public.suggestion_votes (voter_id);
alter table public.suggestion_votes enable row level security;
revoke all on public.suggestions, public.suggestion_votes from anon, authenticated;

create or replace function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('friend_request', 'friend_accepted') then 'friends'
    when p_kind in ('gift_received', 'gift_answered', 'trade_received', 'trade_answered', 'submission_decided', 'suggestion_answered') then 'social'
    when p_kind in ('listing_sold', 'outbid', 'auction_won', 'auction_unsold', 'wish_listed') then 'market'
    when p_kind in ('report_received', 'submission_received', 'suggestion_received') then 'moderation'
    else 'achievements' end
$$;

create function private.suggestion_json(p_s public.suggestions, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_s.id, 'category', p_s.category, 'title', p_s.title, 'body', p_s.body,
    'status', p_s.status, 'public', p_s.public, 'reply', p_s.reply, 'created_at', p_s.created_at, 'replied_at', p_s.replied_at,
    'mine', p_s.author_id = p_uid,
    'author', (select handle from public.profiles where id = p_s.author_id),
    'votes', (select count(*) from public.suggestion_votes v where v.suggestion_id = p_s.id),
    'my_vote', exists (select 1 from public.suggestion_votes v where v.suggestion_id = p_s.id and v.voter_id = p_uid))
$$;

create function public.submit_suggestion(p_category text, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
  v_admin uuid;
begin
  if p_category not in ('feature', 'card', 'bug', 'other') or length(v_title) < 3 or length(v_title) > 80
     or length(v_body) > 2000 then
    raise exception 'invalid_suggestion';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.suggestions where author_id = v_uid and created_at > now() - interval '2 days'
        and private.game_day(created_at) = private.game_day(now())) >= 5 then
    raise exception 'suggestion_limit';
  end if;
  insert into public.suggestions (author_id, category, title, body) values (v_uid, p_category, v_title, v_body)
    returning id into v_id;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  perform private.notify(v_admin, 'suggestion_received', jsonb_build_object('title', v_title, 'category', p_category,
    'from', (select handle from public.profiles where id = v_uid)));
  return v_id;
end $$;

-- Mes doléances, puis les idées publiques (les plus votées d'abord).
create function public.get_suggestions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(private.suggestion_json(s, v_uid) order by s.created_at desc)
                        from (select * from public.suggestions where author_id = v_uid order by created_at desc limit 50) s), '[]'::jsonb),
    'public', coalesce((select jsonb_agg(x.j order by x.votes desc, x.created_at desc) from (
        select private.suggestion_json(s, v_uid) j, s.created_at,
               (select count(*) from public.suggestion_votes v where v.suggestion_id = s.id) votes
          from public.suggestions s where s.public order by s.created_at desc limit 100) x), '[]'::jsonb));
end $$;

create function public.vote_suggestion(p_id uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_s public.suggestions;
begin
  select * into v_s from public.suggestions where id = p_id and public;
  if not found then raise exception 'not_found'; end if;
  if v_s.author_id = v_uid then raise exception 'own_suggestion'; end if;
  if p_on then
    insert into public.suggestion_votes (suggestion_id, voter_id) values (p_id, v_uid) on conflict do nothing;
  else
    delete from public.suggestion_votes where suggestion_id = p_id and voter_id = v_uid;
  end if;
  return p_on;
end $$;

create function public.admin_suggestions(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
begin
  return coalesce((select jsonb_agg(private.suggestion_json(s, v_admin) order by (s.status = 'new') desc, s.created_at desc)
    from (select * from public.suggestions where p_status is null or status = p_status order by created_at desc limit 200) s), '[]'::jsonb);
end $$;

create function public.admin_answer_suggestion(p_id uuid, p_status text, p_public boolean, p_reply text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.suggestions;
  v_after public.suggestions;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if p_status not in ('new', 'planned', 'done', 'declined') or length(v_reply) > 1000 then raise exception 'invalid_suggestion'; end if;
  select * into v_before from public.suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.suggestions set status = p_status, public = coalesce(p_public, public), reply = v_reply,
         replied_at = case when v_reply is distinct from v_before.reply or p_status <> v_before.status then now() else replied_at end
   where id = p_id returning * into v_after;
  -- L'auteur est prévenu quand la réponse ou le statut change.
  if v_reply is distinct from v_before.reply or p_status <> v_before.status then
    perform private.notify(v_after.author_id, 'suggestion_answered',
      jsonb_build_object('id', p_id, 'title', v_after.title, 'status', p_status, 'public', v_after.public));
  end if;
  perform private.audit(v_admin, 'suggestion_answer', p_id, v_reason, to_jsonb(v_before), to_jsonb(v_after));
end $$;

revoke execute on function private.suggestion_json(public.suggestions, uuid) from public, anon, authenticated;
revoke execute on function public.submit_suggestion(text, text, text), public.get_suggestions(), public.vote_suggestion(uuid, boolean),
  public.admin_suggestions(text), public.admin_answer_suggestion(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.submit_suggestion(text, text, text), public.get_suggestions(), public.vote_suggestion(uuid, boolean),
  public.admin_suggestions(text), public.admin_answer_suggestion(uuid, text, boolean, text, text) to authenticated;

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
    -- Concours annoncé : le prochain qui commence dans les 14 jours (annonce de l'accueil).
    'contest_next', (select jsonb_build_object('id', c.id, 'title', c.title, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
                       'edition', (select e.name from public.editions e where e.id = c.edition_id))
                  from public.contests c where c.starts_at > now() and c.starts_at <= now() + interval '14 days'
                 order by c.starts_at limit 1),
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

-- Paliers pour la prochaine extension.
insert into public.achievements (code, label, description, secret, metric, target, reward_deniers, reward_boosters, title, sort,
                                 series, series_label, tier) values
  ('packs_2000', 'Grand prêtre', 'Ouvrir 2 000 boosters.', false, 'open_boosters', 2000, 6000, 16, 'Grand prêtre du rituel', 36, 'packs', 'Rituels', 5),
  ('faces_500', 'Mémoire des visages', 'Découvrir 500 personnages.', false, 'discover', 500, 6000, 16, 'Archiviste des visages', 71, 'faces', 'Visages découverts', 5),
  ('gold_25', 'Âme dorée', 'Obtenir vingt-cinq personnages différents en finition Dorée.', false, 'finish_gold', 25, 3500, 8, 'Âme dorée', 103, 'gold', 'Éclats d’or', 4),
  ('blood_10', 'Fleuve de sang', 'Obtenir dix personnages différents en finition Sanglante.', false, 'finish_blood', 10, 6000, 12, 'Seigneur de sang', 113, 'blood', 'Sang versé', 4)
on conflict (code) do nothing;
