-- CARTEMA — date de sortie annoncée d'une édition « Soon » (10/11/2026, préparation du set 2 ANE).
--  * editions.launch_at : date affichée en compte à rebours sous le sachet grisé. Purement indicative :
--    elle n'ouvre rien. Album, boosters et annonce restent réglés à la main dans Admin › Éditions.
--  * get_player_state renvoie launch_at pour les éditions annoncées (jamais pour une édition non annoncée).
--  * admin_set_edition_launch(id, date ou null, motif) : réglage journalisé ; admin_catalog renvoie launch_at.
--  * ANE : sortie annoncée le lundi 16 novembre 2026 à 16 h (Paris). Sans effet si ANE n'existe pas.

alter table public.editions add column launch_at timestamptz;

update public.editions set launch_at = timestamptz '2026-11-16 16:00:00 Europe/Paris' where prefix = 'ANE';

create function public.admin_set_edition_launch(p_id uuid, p_launch_at timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.editions;
begin
  select * into v_before from public.editions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.editions set launch_at = p_launch_at where id = p_id;
  perform private.audit(v_admin, 'edition_launch', p_id, v_reason,
    jsonb_build_object('launch_at', v_before.launch_at), jsonb_build_object('launch_at', p_launch_at));
end $$;
revoke execute on function public.admin_set_edition_launch(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_set_edition_launch(uuid, timestamptz, text) to authenticated;

-- Reprise de 20261023170000_login_streak : les éditions annoncées envoient aussi leur date de sortie.
create or replace function public.get_player_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_boosters public.booster_balances := private.sync_free_boosters(v_uid);
  v_daily bigint := private.claim_daily_reward(v_uid);
  v_streak jsonb := private.touch_login_streak(v_uid);
  v_settings jsonb := (private.active_settings()).settings;
  v_every integer := coalesce((v_settings->>'streak_booster_every')::int, 0);
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
    -- Série de connexions : jours d'affilée, meilleure série, et boosters gagnés par cet appel.
    'streak', (select jsonb_build_object('current', p.login_streak, 'best', p.login_streak_best, 'every', v_every,
                                         'count', coalesce((v_settings->>'streak_booster_count')::int, 0),
                                         'next_bonus_in', case when v_every > 0 then v_every - p.login_streak % v_every end)
                 from public.profiles p where p.id = v_uid),
    'streak_reward', coalesce((v_streak->>'boosters')::int, 0),
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
    -- (« Soon ») : leur nom, leur code, leur sachet et leur date de sortie seulement.
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
               jsonb_build_object('id', e.id, 'name', e.name, 'prefix', e.prefix, 'teaser', true, 'openable', false, 'theme', e.booster_theme,
                                  'launch_at', e.launch_at)
          from public.editions e where e.teaser and not e.packs_enabled and e.archived_at is null) x), '[]'::jsonb)
  );
end $$;

-- Reprise de 20261025190000_signed_cards : launch_at en plus dans les éditions.
create or replace function public.admin_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'prefix', e.prefix, 'cover_path', e.cover_path,
        'album_published', e.album_published, 'packs_enabled', e.packs_enabled, 'archived_at', e.archived_at,
        'teaser', e.teaser, 'booster_theme', e.booster_theme, 'booster_offers', e.booster_offers, 'launch_at', e.launch_at,
        'eternal', e.eternal, 'eternal_drops', e.eternal_drops,
        'complete', private.edition_is_complete(e.id),
        'used', exists (select 1 from public.pack_openings o where o.edition_id = e.id),
        'published_by_rarity', (select coalesce(jsonb_object_agg(r.rarity, r.n), '{}'::jsonb) from (
            select c.rarity, count(*) as n from public.characters c
            where c.edition_id = e.id and c.status = 'published' group by c.rarity) r)
      ) order by e.created_at) from public.editions e), '[]'::jsonb),
    'clans', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'symbol_key', c.symbol_key,
        'lineage_title', (select a.title from public.achievements a where a.code = 'lineage:' || c.id)) order by c.name)
      from public.clans c), '[]'::jsonb),
    'characters', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'edition_id', c.edition_id, 'clan_id', c.clan_id, 'number', c.number, 'name', c.name,
        'role_title', c.role_title, 'rarity', c.rarity, 'art_path', c.art_path, 'art_meta', c.art_meta, 'art_credit', c.art_credit, 'art_ai', c.art_ai, 'signature_path', c.signature_path,
        'silhouette_key', c.silhouette_key, 'status', c.status, 'is_unique', c.is_unique, 'published_at', c.published_at,
        'updated_at', c.updated_at) order by c.edition_id, c.number) from public.characters c), '[]'::jsonb)
  );
end $$;
