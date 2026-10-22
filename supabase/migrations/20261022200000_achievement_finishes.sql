-- CARTEMA — succès conditionnels avec finition (22/10/2026). Un personnage requis peut exiger une
-- finition : « Varco en Dorée et Joséphine de Vilmot en Dorée ». Sans finition, la simple découverte
-- suffit (comme avant). La finition compte dès qu'elle a été obtenue une fois (finish_discoveries),
-- même si l'exemplaire a été cédé depuis.

alter table public.achievements add column required_finishes jsonb not null default '{}'::jsonb;
comment on column public.achievements.required_finishes is
  'Succès conditionnels : finition exigée par personnage ({"<character_id>": "Dorée"}) ; absent = découverte simple.';

create or replace function private.achievement_state(p_owner uuid, p_def public.achievements)
returns table (progress bigint, target bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_def.metric in ('set_clan', 'set_rarity', 'set_all') then
    return query
      select count(d.character_id), count(*)
        from public.characters c
        left join public.discoveries d on d.character_id = c.id and d.owner_id = p_owner
       where c.edition_id = p_def.edition_id and c.status = 'published' and not c.is_unique
         and (p_def.metric <> 'set_clan' or c.clan_id = p_def.clan_id)
         and (p_def.metric <> 'set_rarity' or c.rarity = p_def.rarity);
  elsif p_def.metric = 'characters' then
    return query
      select count(*) filter (where case when f.finish is null
               then exists (select 1 from public.discoveries d where d.owner_id = p_owner and d.character_id = rc.id)
               else exists (select 1 from public.finish_discoveries fd
                             where fd.owner_id = p_owner and fd.character_id = rc.id and fd.finish = f.finish) end),
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
  elsif p_def.metric = 'manual' then
    return query select 0::bigint, 1::bigint;
  else
    return query select private.metric_value(p_owner, p_def.metric), p_def.target::bigint;
  end if;
end $$;

-- p_finishes : {"<character_id>": "Dorée" | "Sanglante"} ; les autres personnages requis n'exigent que la découverte.
drop function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid);
create function public.admin_save_achievement(p_code text, p_label text, p_description text, p_secret boolean,
                                              p_reward_deniers bigint, p_reward_boosters integer, p_title text,
                                              p_characters uuid[] default null, p_edition_id uuid default null,
                                              p_finishes jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := coalesce(nullif(trim(p_code), ''), 'custom:' || gen_random_uuid());
  v_chars uuid[] := (select array_agg(distinct c.id) from public.characters c where c.id = any (coalesce(p_characters, '{}')));
  v_finishes jsonb;
begin
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'name_required'; end if;
  if p_edition_id is not null and not exists (select 1 from public.editions where id = p_edition_id) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_finishes, '{}'::jsonb)) f where f.value not in ('Dorée', 'Sanglante')) then
    raise exception 'invalid_finish';
  end if;
  -- Seulement pour les personnages requis.
  v_finishes := coalesce((select jsonb_object_agg(f.key, f.value) from jsonb_each_text(coalesce(p_finishes, '{}'::jsonb)) f
                           where f.key = any (select unnest(v_chars)::text)), '{}'::jsonb);
  insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                   required_finishes, reward_deniers, reward_boosters, title, sort, edition_id)
    values (v_code, trim(p_label), coalesce(trim(p_description), ''), coalesce(p_secret, false), 'custom',
            case when v_chars is null then 'manual' else 'characters' end, 1, v_chars, v_finishes,
            greatest(coalesce(p_reward_deniers, 0), 0), greatest(coalesce(p_reward_boosters, 0), 0), nullif(trim(p_title), ''), 500,
            p_edition_id)
  on conflict (code) do update set label = excluded.label, description = excluded.description, secret = excluded.secret,
    reward_deniers = excluded.reward_deniers, reward_boosters = excluded.reward_boosters, title = excluded.title,
    edition_id = excluded.edition_id,
    metric = case when public.achievements.metric in ('manual', 'characters') then excluded.metric else public.achievements.metric end,
    required_characters = case when public.achievements.metric in ('manual', 'characters') then excluded.required_characters
                               else public.achievements.required_characters end,
    required_finishes = case when public.achievements.metric in ('manual', 'characters') then excluded.required_finishes
                             else public.achievements.required_finishes end
    where public.achievements.category = 'custom';
  perform private.audit(v_admin, 'achievement_save', null, 'Succès personnalisé ' || trim(p_label), null,
                        jsonb_build_object('code', v_code, 'edition', p_edition_id, 'finishes', v_finishes));
  return v_code;
end $$;

create or replace function public.admin_custom_achievements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description,
      'secret', a.secret, 'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title,
      'conditional', a.metric = 'characters', 'automatic', a.metric <> 'manual', 'edition', e.name, 'edition_id', a.edition_id,
      'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', ce.prefix || '-' || lpad(c.number::text, 3, '0'),
                                                                  'finish', a.required_finishes->>c.id::text) order by c.number)
                               from public.characters c join public.editions ce on ce.id = c.edition_id
                              where c.id = any (coalesce(a.required_characters, '{}'))), '[]'::jsonb),
      'holders', (select coalesce(jsonb_agg(p.handle order by u.unlocked_at), '[]'::jsonb)
                    from public.achievement_unlocks u join public.profiles p on p.id = u.owner_id where u.code = a.code))
      order by a.label) from public.achievements a left join public.editions e on e.id = a.edition_id
     where a.category = 'custom'), '[]'::jsonb);
end $$;

revoke execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid, jsonb) to authenticated;

-- Don de cartes par l'administrateur : version d'illustration au choix (alternative ou ancienne
-- officielle) ; p_art_id null = illustration officielle du moment, comme avant.
drop function public.admin_grant_card(uuid, uuid, public.finish, integer, text, uuid);
create function public.admin_grant_card(p_id uuid, p_character_id uuid, p_finish public.finish, p_quantity integer,
                                        p_reason text, p_request_id uuid, p_art_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_char public.characters;
  v_art public.card_arts;
begin
  if p_request_id is null then raise exception 'request_id_required'; end if;
  if coalesce(p_quantity, 0) not between 1 and 20 then raise exception 'invalid_amount'; end if;
  perform 1 from public.profiles where id = p_id for update;
  if not found then raise exception 'player_not_found'; end if;
  if exists (select 1 from public.admin_audit_logs where action = 'card_grant' and target_id = p_id
              and after_state->>'request_id' = p_request_id::text) then
    return p_quantity;
  end if;
  select * into v_char from public.characters where id = p_character_id;
  if not found or v_char.status <> 'published' then raise exception 'not_found'; end if;
  if v_char.is_unique then raise exception 'unique_card'; end if;
  if p_art_id is not null then
    select * into v_art from public.card_arts where id = p_art_id and character_id = p_character_id;
    if not found then raise exception 'not_found'; end if;
  end if;
  insert into public.inventory_items (owner_id, character_id, finish, art_id)
    select p_id, p_character_id, coalesce(p_finish, 'Standard'), p_art_id from generate_series(1, p_quantity);
  insert into public.discoveries (owner_id, character_id) values (p_id, p_character_id) on conflict do nothing;
  insert into public.finish_discoveries (owner_id, character_id, finish) values (p_id, p_character_id, coalesce(p_finish, 'Standard'))
    on conflict do nothing;
  perform private.audit(v_admin, 'card_grant', p_id, v_reason, null, jsonb_build_object('request_id', p_request_id,
    'character', v_char.name, 'character_id', p_character_id, 'finish', coalesce(p_finish, 'Standard'), 'quantity', p_quantity,
    'art', p_art_id, 'version', v_art.label));
  return p_quantity;
end $$;

revoke execute on function public.admin_grant_card(uuid, uuid, public.finish, integer, text, uuid, uuid) from public, anon;
grant execute on function public.admin_grant_card(uuid, uuid, public.finish, integer, text, uuid, uuid) to authenticated;
