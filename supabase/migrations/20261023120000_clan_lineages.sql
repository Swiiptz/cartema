-- CARTEMA — lignées de clan (décisions du 23/10/2026).
--  * Un succès général par clan (métrique « clan_lineage ») : posséder tous les membres du clan, toutes
--    éditions publiées confondues (hors cartes uniques, éditions archivées et édition éternelle).
--  * On peut le perdre : l'état vit dans public.lineage_holds, pas dans achievement_unlocks (les lignées
--    ne comptent donc ni au classement, ni dans les succès du profil). Dès qu'un membre quitte la
--    collection (vente, don, échange, recyclage, retrait), la lignée est perdue et son titre retiré ;
--    elle revient quand le clan est de nouveau complet.
--  * Récompense (deniers, boosters) seulement la première fois. Titres choisis par Swiiptz.

create table public.lineage_holds (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.achievements(code) on update cascade on delete cascade,
  first_at timestamptz not null default now(),
  since timestamptz not null default now(),
  lost_at timestamptz,
  primary key (owner_id, code)
);
alter table public.lineage_holds enable row level security;
comment on table public.lineage_holds is
  'Lignées de clan : détenue tant que lost_at est vide. La ligne existe dès la première complétion (récompense déjà donnée).';

-- Lignées des clans existants. Récompense pour les grands clans (10 membres ou plus) seulement.
with t(name, title) as (values
  ('Toréador', 'Syndrome de Stendhal'), ('Brujah', 'Phalange de Caïn'), ('Gangrel', 'Apex Predator'),
  ('Ventrue', 'Suprématie'), ('Nosferatu', 'Indicible'), ('Malkavien', 'La toile'), ('Tremere', 'Tétraèdre'),
  ('Assamite', 'Contrat rempli'), ('Lasombra', 'Hégémonie'), ('Ravnos', 'Mirage'), ('Baali', 'Ami des démons'),
  ('Sethite', 'Vendeur de tentations'), ('Giovanni', 'Familia'), ('Tzimisce', 'Dracul')),
n as (select cl.id, cl.name, t.title,
             (select count(*) from public.characters c join public.editions e on e.id = c.edition_id
               where c.clan_id = cl.id and c.status = 'published' and not c.is_unique
                 and e.album_published and e.archived_at is null and not e.eternal) members
        from t join public.clans cl on cl.name = t.name)
insert into public.achievements (code, label, description, category, metric, target, clan_id, title, reward_deniers, reward_boosters, sort)
select 'lineage:' || n.id, 'Lignée ' || n.name,
       'Posséder tous les membres du clan ' || n.name || ', toutes éditions confondues. Le titre se perd si l’un d’eux quitte votre collection.',
       'general', 'clan_lineage', 1, n.id, n.title,
       case when n.members >= 10 then (round(n.members * 60 / 100.0) * 100)::bigint else 0 end,
       case when n.members >= 10 then (n.members / 5)::int else 0 end,
       900 + row_number() over (order by n.members desc, n.name)
  from n
on conflict (code) do nothing;

-- Perte d'une lignée : date de perte et titre retiré s'il était porté.
create function private.lose_lineage(p_owner uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.lineage_holds set lost_at = now() where owner_id = p_owner and code = p_code and lost_at is null;
  if found then
    update public.profiles p set title = null
     where p.id = p_owner and p.title = (select a.title from public.achievements a where a.code = p_code);
  end if;
end $$;
revoke execute on function private.lose_lineage(uuid, text) from public, anon, authenticated;

-- Membres d'un clan qui comptent pour sa lignée.
create function private.lineage_complete(p_owner uuid, p_clan uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.characters c join public.editions e on e.id = c.edition_id
                      where c.clan_id = p_clan and c.status = 'published' and not c.is_unique
                        and e.album_published and e.archived_at is null and not e.eternal
                        and not private.owns_card(p_owner, c.id))
$$;
revoke execute on function private.lineage_complete(uuid, uuid) from public, anon, authenticated;

-- Un exemplaire quitte une collection : on vérifie seulement les lignées détenues de son clan.
create function private.on_inventory_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_clan uuid;
begin
  for v_code, v_clan in
    select h.code, a.clan_id from public.lineage_holds h
      join public.achievements a on a.code = h.code
      join public.characters c on c.clan_id = a.clan_id
     where h.owner_id = old.owner_id and h.lost_at is null and a.metric = 'clan_lineage' and c.id = old.character_id loop
    if not private.lineage_complete(old.owner_id, v_clan) then
      perform private.lose_lineage(old.owner_id, v_code);
    end if;
  end loop;
  return null;
end $$;
revoke execute on function private.on_inventory_leave() from public, anon, authenticated;
create trigger inventory_lineage_leave after update of owner_id, recycled_at, removed_at on public.inventory_items
  for each row when (old.owner_id is distinct from new.owner_id
                     or (old.recycled_at is null and new.recycled_at is not null)
                     or (old.removed_at is null and new.removed_at is not null))
  execute function private.on_inventory_leave();

-- Récompense d'un succès (commune aux succès définitifs et aux lignées).
create function private.give_achievement_reward(p_owner uuid, p_def public.achievements) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_def.reward_deniers > 0 then
    perform private.apply_wallet_delta(p_owner, p_def.reward_deniers, 'achievement_reward', 'achievement', null,
                                       'achievement:' || p_def.code);
  end if;
  if p_def.reward_boosters > 0 then
    update public.booster_balances set purchased_count = purchased_count + p_def.reward_boosters, updated_at = now()
     where owner_id = p_owner;
    insert into public.booster_grants (owner_id, source, pool, quantity) values (p_owner, 'reward', 'purchased', p_def.reward_boosters);
  end if;
end $$;
revoke execute on function private.give_achievement_reward(uuid, public.achievements) from public, anon, authenticated;

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(*) filter (where private.owns_card_art(p_owner, rc.id, f.finish, p_def.required_arts->>rc.id::text)),
             cardinality(p_def.required_characters)::bigint
        from unnest(p_def.required_characters) rc(id)
        cross join lateral (select (p_def.required_finishes->>rc.id::text)::public.finish as finish) f;
  elsif p_def.metric = 'recycle_all' then
    return query
      select count(*) filter (where exists (select 1 from public.inventory_items i
                                             where i.owner_id = p_owner and i.character_id = c.id and i.recycled_at is not null
                                               and i.removed_at is null)),
             count(*)
        from public.characters c
        join public.editions e on e.id = c.edition_id
       where c.status = 'published' and not c.is_unique and e.album_published and e.archived_at is null;
  elsif p_def.metric = 'early_supporter' then
    return query
      select case when p.created_at < timestamptz '2026-11-21 00:00 Europe/Paris' then 1::bigint else 0::bigint end, 1::bigint
        from public.profiles p where p.id = p_owner;
  elsif p_def.metric = 'same_card_copies' then
    -- Narcisse : le plus grand nombre d'exemplaires possédés d'un même personnage.
    return query
      select coalesce(max(n.copies), 0), p_def.target::bigint
        from (select count(*) copies from public.inventory_items i
               where i.owner_id = p_owner and i.recycled_at is null and i.removed_at is null
               group by i.character_id) n;
  elsif p_def.metric = 'clan_lineage' then
    -- Lignée : tous les membres du clan, toutes éditions publiées (hors uniques, archivées, éternelle).
    return query
      select count(*) filter (where private.owns_card(p_owner, c.id)), count(*)
        from public.characters c join public.editions e on e.id = c.edition_id
       where c.clan_id = p_def.clan_id and c.status = 'published' and not c.is_unique
         and e.album_published and e.archived_at is null and not e.eternal;
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

create or replace function private.sync_achievement_states(p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_def public.achievements;
  v_state record;
  v_states jsonb := '{}'::jsonb;
  v_hold public.lineage_holds;
begin
  perform private.sync_set_achievements();
  for v_def in select a.* from public.achievements a
                where a.metric not in ('manual', 'clan_lineage')
                  and not exists (select 1 from public.achievement_unlocks u where u.owner_id = p_owner and u.code = a.code) loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    if v_state.target > 0 and v_state.progress >= v_state.target then
      insert into public.achievement_unlocks (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
      if found then
        perform private.give_achievement_reward(p_owner, v_def);
      end if;
    end if;
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  -- Lignées : recalculées à chaque passe, car elles se gagnent et se perdent.
  for v_def in select a.* from public.achievements a where a.metric = 'clan_lineage' loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    select * into v_hold from public.lineage_holds h where h.owner_id = p_owner and h.code = v_def.code;
    if v_state.target > 0 and v_state.progress >= v_state.target then
      if v_hold.owner_id is null then
        insert into public.lineage_holds (owner_id, code) values (p_owner, v_def.code) on conflict do nothing;
        if found then perform private.give_achievement_reward(p_owner, v_def); end if;
      elsif v_hold.lost_at is not null then
        update public.lineage_holds set since = now(), lost_at = null where owner_id = p_owner and code = v_def.code;
      end if;
    elsif v_hold.owner_id is not null and v_hold.lost_at is null then
      perform private.lose_lineage(p_owner, v_def.code);
    end if;
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  return v_states;
end $$;

create or replace function public.get_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_states jsonb;
begin
  -- Une seule passe : débloque et donne la progression des succès restants ; les succès obtenus
  -- ne sont pas recalculés (la progression n'est affichée que pour les succès à obtenir).
  v_states := private.sync_achievement_states(v_uid);
  return coalesce((select jsonb_agg(case when u.code is not null or not a.secret then jsonb_build_object(
      'code', a.code, 'label', a.label, 'secret', a.secret, 'title', a.title,
      'description', case when a.category = 'custom' and u.code is null then null else a.description end,
      'conditional', a.metric = 'characters', 'category', a.category, 'edition', e.name, 'edition_prefix', e.prefix, 'rarity', a.rarity,
      'series', a.series, 'series_label', a.series_label, 'tier', a.tier,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters,
      'owned_rule', a.metric in ('set_clan', 'set_rarity', 'set_all', 'characters', 'clan_lineage'),
      'progress', case when u.code is not null then coalesce(st.target, a.target) when a.metric = 'manual' then 0
                       else least(st.progress, st.target) end,
      'target', case when a.metric = 'manual' then 1 else coalesce(st.target, a.target) end,
      'unlocked_at', case when a.metric = 'clan_lineage' then case when h.lost_at is null then h.since end else u.unlocked_at end,
      'reason', u.reason)
      -- Lignée : détenue tant que le clan reste complet ; récompense déjà reçue si la ligne existe.
      || case when a.metric = 'clan_lineage' then jsonb_build_object('lineage', true, 'lost_at', h.lost_at,
                                                                      'reward_claimed', h.owner_id is not null)
              else '{}'::jsonb end
      -- Set presque complet : les cartes qui manquent (nom si découverte, sinon seulement le numéro),
      -- seulement quand la moitié du set est déjà possédée.
      || case when u.code is null and a.metric in ('set_clan', 'set_rarity', 'set_all')
                   and st.target - st.progress between 1 and 5 and st.progress * 2 >= st.target then jsonb_build_object('missing', (
           select jsonb_agg(jsonb_build_object(
                    'name', case when exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = c.id)
                                 then c.name end,
                    'code', e.prefix || '-' || lpad(c.number::text, 3, '0')) order by c.number)
             from public.characters c
            where c.edition_id = a.edition_id and c.status = 'published' and not c.is_unique
              and (a.metric <> 'set_clan' or c.clan_id = a.clan_id)
              and (a.metric <> 'set_rarity' or c.rarity = a.rarity)
              and not private.owns_card(v_uid, c.id)))
         else '{}'::jsonb end
      -- Lignée non détenue et presque complète : les membres qui manquent, toutes éditions confondues.
      || case when a.metric = 'clan_lineage' and (h.owner_id is null or h.lost_at is not null)
                   and st.target - st.progress between 1 and 5 and st.progress * 2 >= st.target then jsonb_build_object('missing', (
           select jsonb_agg(jsonb_build_object(
                    'name', case when exists (select 1 from public.discoveries d where d.owner_id = v_uid and d.character_id = c.id)
                                 then c.name end,
                    'code', ce.prefix || '-' || lpad(c.number::text, 3, '0')) order by ce.prefix, c.number)
             from public.characters c join public.editions ce on ce.id = c.edition_id
            where c.clan_id = a.clan_id and c.status = 'published' and not c.is_unique
              and ce.album_published and ce.archived_at is null and not ce.eternal
              and not private.owns_card(v_uid, c.id)))
         else '{}'::jsonb end
    else jsonb_build_object('code', a.code, 'secret', true, 'category', a.category, 'label', null, 'unlocked_at', null,
                           'edition', e.name, 'edition_prefix', e.prefix) end
    order by a.category, e.prefix nulls first, (u.code is null), a.sort, a.label)
    from public.achievements a
    left join public.editions e on e.id = a.edition_id
    left join public.achievement_unlocks u on u.code = a.code and u.owner_id = v_uid
    left join public.lineage_holds h on h.code = a.code and h.owner_id = v_uid
    left join lateral (select (v_states->a.code->>0)::bigint as progress, (v_states->a.code->>1)::bigint as target) st on true
    -- Personnalisés : automatiques et secrets visibles (secrets masqués) ; manuels non secrets
    -- visibles une fois décernés.
    where a.category <> 'custom' or u.code is not null or a.metric <> 'manual' or a.secret), '[]'::jsonb);
end $$;

create or replace function public.sync_my_achievements() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  perform private.sync_achievement_states(v_uid);
  -- unlocked_at vaut now() (heure de la transaction) pour les succès débloqués par cet appel.
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'title', a.title, 'secret', a.secret,
      'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'series_label', a.series_label, 'tier', a.tier)
      -- Lignée retrouvée : pas de nouvelle récompense.
      || case when x.lineage then jsonb_build_object('lineage', true) else '{}'::jsonb end
      || case when x.lineage and x.again then jsonb_build_object('reward_deniers', 0, 'reward_boosters', 0) else '{}'::jsonb end
      order by a.sort)
    from (select u.code, false lineage, false again from public.achievement_unlocks u where u.owner_id = v_uid and u.unlocked_at = now()
          union all
          -- Lignée gagnée ou retrouvée par cet appel.
          select h.code, true, h.first_at < now()
            from public.lineage_holds h where h.owner_id = v_uid and h.since = now() and h.lost_at is null) x
    join public.achievements a on a.code = x.code), '[]'::jsonb);
end $$;

create or replace function public.set_title(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_title text;
begin
  if p_code is null then
    update public.profiles set title = null where id = v_uid;
    return null;
  end if;
  select a.title into v_title from public.achievements a
   where a.code = p_code and a.title is not null
     and (exists (select 1 from public.achievement_unlocks u where u.code = a.code and u.owner_id = v_uid)
          -- Lignée : seulement tant qu'elle est détenue.
          or exists (select 1 from public.lineage_holds h where h.code = a.code and h.owner_id = v_uid and h.lost_at is null));
  if v_title is null then raise exception 'title_locked'; end if;
  update public.profiles set title = v_title where id = v_uid;
  return v_title;
end $$;
