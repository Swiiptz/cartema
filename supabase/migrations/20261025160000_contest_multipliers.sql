-- CARTEMA — multiplicateurs du concours réglables dans l'admin (25/10/2026) : ×2 des cartes à privilégier
-- (priority_multiplier) et ×4 des Mythiques (mythic_multiplier), de 1 à 5 (contraintes des colonnes).
-- admin_save_contest reçoit les deux en dernier (null = inchangé ; 2 et 4 à la création).

drop function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean);
create function public.admin_save_contest(p_id uuid, p_title text, p_edition_id uuid, p_starts_at timestamptz,
                                          p_ends_at timestamptz, p_rewards jsonb, p_reason text,
                                          p_rules text default null, p_allow_mythic boolean default null,
                                          p_priority_multiplier integer default null, p_mythic_multiplier integer default null) returns uuid
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
    insert into public.contests (title, edition_id, starts_at, ends_at, created_by, rules, allow_mythic,
                                 priority_multiplier, mythic_multiplier)
      values (trim(p_title), p_edition_id, p_starts_at, p_ends_at, v_admin, v_rules, coalesce(p_allow_mythic, true),
              coalesce(p_priority_multiplier, 2), coalesce(p_mythic_multiplier, 4))
      returning id into v_id;
    if p_rewards is not null then
      update public.contests set rewards = p_rewards where id = v_id;
    end if;
  else
    update public.contests set title = trim(p_title), edition_id = p_edition_id, starts_at = p_starts_at,
                               ends_at = p_ends_at, rewards = coalesce(p_rewards, rewards),
                               rules = case when p_rules is null then rules else v_rules end,
                               allow_mythic = coalesce(p_allow_mythic, allow_mythic),
                               priority_multiplier = coalesce(p_priority_multiplier, priority_multiplier),
                               mythic_multiplier = coalesce(p_mythic_multiplier, mythic_multiplier)
     where id = p_id and rewarded_at is null
     returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  perform private.audit(v_admin, 'contest_save', v_id, v_reason, null,
    jsonb_build_object('title', p_title, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'rewards', p_rewards, 'rules', p_rules,
                       'allow_mythic', p_allow_mythic, 'priority_multiplier', p_priority_multiplier,
                       'mythic_multiplier', p_mythic_multiplier));
  return v_id;
end $$;
revoke execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_save_contest(uuid, text, uuid, timestamptz, timestamptz, jsonb, text, text, boolean, integer, integer) to authenticated;
