-- CARTEMA — résultats des concours (décisions de Swiiptz, 26/10/2026).
--  * La page des soumissions disparaît à la clôture : private.current_contest ne renvoie plus qu'un concours
--    en cours. get_contest (null ou le prochain annoncé), get_contest_card (not_found), get_contest_leaderboard
--    (vide) et les signalements ne montrent plus rien d'un concours clos ; les résultats passent par la galerie.
--  * get_contest_gallery, en plus de ce qu'il renvoyait (le site déjà en ligne continue de marcher) :
--    - ranking : classement complet, place, pseudo et points seulement, une fois les récompenses distribuées ;
--    - mythics : pour un concours qui admet les Mythiques, chaque Mythique de l'édition avec son illustration
--      officielle et toutes ses versions alternatives actives, avec leur crédit.
--  * Ex aequo : ils partagent la place et le suivant prend la place juste après (1, 1, 2, 3…), pour le classement,
--    la galerie et la distribution (barème par place, titre du podium aux places 1 à 3). private.contest_places
--    numérote les places à partir des points de private.contest_ranking, qui reste inchangé.

create or replace function private.current_contest() returns public.contests
language sql stable security definer set search_path = '' as $$
  select c.* from public.contests c
   where c.starts_at <= now() and c.ends_at > now()
   order by c.starts_at desc limit 1
$$;
revoke execute on function private.current_contest() from public, anon, authenticated;

create function private.contest_places(p_contest uuid)
returns table (author_id uuid, handle text, leads bigint, selected bigint, drawings bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  select r.author_id, r.handle, r.leads, r.selected, r.drawings, r.points,
         dense_rank() over (order by r.points desc) as place
    from private.contest_ranking(p_contest) r
   order by r.points desc, r.handle
$$;
revoke execute on function private.contest_places(uuid) from public, anon, authenticated;

-- Galerie : les 12 derniers concours clos. Le classement n'est calculé que pour les concours distribués,
-- une fois par concours.
create or replace function public.get_contest_gallery() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'title', c.title, 'edition', e.name, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'final', c.rewarded_at is not null,
      'entries', (select count(*) from public.contest_entries x where x.contest_id = c.id and x.hidden_at is null),
      'artists', (select count(distinct x.author_id) from public.contest_entries x where x.contest_id = c.id and x.hidden_at is null),
      'podium', cr.podium, 'ranking', cr.ranking,
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
         where x.contest_id = c.id and x.selected is not null and x.hidden_at is null), '[]'::jsonb),
      'mythics', case when not c.allow_mythic then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
            'character_id', ch.id, 'character', ch.name, 'code', e.prefix || '-' || lpad(ch.number::text, 3, '0'),
            'versions', (select jsonb_agg(v.card order by v.official desc, v.created_at)
                           from (select true as official, null::timestamptz as created_at,
                                        private.card_json(ch.id, 'Standard') as card
                                 union all
                                 select false, a.created_at,
                                        private.card_json(ch.id, 'Standard')
                                          || jsonb_build_object('art_path', a.art_path, 'art_meta', a.art_meta,
                                                                'variant', a.label, 'variant_kind', a.kind,
                                                                'art_credit', a.credit)
                                   from public.card_arts a
                                  where a.character_id = ch.id and a.kind = 'alternate' and a.active) v))
          order by ch.number)
          from public.characters ch
         where ch.edition_id = c.edition_id and ch.rarity = 'Mythique' and ch.status = 'published'
           and not ch.is_unique and ch.art_path is not null), '[]'::jsonb) end)
    order by c.ends_at desc)
    from (select * from public.contests where ends_at <= now() order by ends_at desc limit 12) c
    join public.editions e on e.id = c.edition_id
    -- Classement calculé une seule fois par concours, seulement s'il est distribué.
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('place', r.place, 'handle', r.handle, 'points', r.points,
                                                   'selected', r.selected, 'leads', r.leads) order by r.place, r.handle)
                        filter (where r.place <= 3), '[]'::jsonb) as podium,
             coalesce(jsonb_agg(jsonb_build_object('place', r.place, 'handle', r.handle, 'points', r.points)
                                order by r.place, r.handle), '[]'::jsonb) as ranking
        from private.contest_places(c.id) r where c.rewarded_at is not null) cr
   where e.album_published), '[]'::jsonb);
end $$;

-- Classement du concours en cours : places serrées (reprise de 20261022260000_art_contest).
create or replace function public.get_contest_leaderboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_contest public.contests := private.current_contest();
begin
  if v_contest.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('position', r.place, 'handle', r.handle, 'leads', r.leads,
      'selected', r.selected, 'real', r.drawings, 'points', r.points, 'me', r.author_id = v_uid) order by r.place, r.handle)
    from private.contest_places(v_contest.id) r), '[]'::jsonb);
end $$;

-- Distribution : barème et titre du podium selon les places serrées (reprise de 20261022260000_art_contest).
create or replace function public.admin_reward_contest(p_contest_id uuid, p_reason text) returns jsonb
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

  for v_row in select * from private.contest_places(p_contest_id) loop
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
