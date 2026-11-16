-- CARTEMA — lignées : récompense regagnable avec un nouveau set (16/11/2026, décision de Swiiptz).
--  * Une lignée compte toutes les éditions publiées : à la sortie d'un set, chaque clan gagne des membres et
--    tous les détenteurs la perdent. Compléter de nouveau le clan sur ce nouveau total redonne la récompense,
--    une seule fois par total (lineage_holds.rewarded_target). La perdre puis la reprendre au même total ne
--    redonne rien, comme avant.
--  * Les détenteurs actuels sont réputés récompensés pour le total d'aujourd'hui (avant l'ouverture d'ANE).
--  * La seconde récompense a sa propre clé de Deniers (« achievement:<code>:<total> ») : la première,
--    « achievement:<code> », aurait fait ignorer le versement.

alter table public.lineage_holds add column rewarded_target integer;
comment on column public.lineage_holds.rewarded_target is
  'Nombre de cartes requises lors de la dernière récompense : une lignée complétée sur un total plus grand est de nouveau récompensée.';

update public.lineage_holds h set rewarded_target = (
  select s.target from public.achievements a, lateral private.achievement_state(h.owner_id, a) s where a.code = h.code);

create function private.give_lineage_reward(p_owner uuid, p_def public.achievements, p_target integer, p_first boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_first then
    perform private.give_achievement_reward(p_owner, p_def);
    return;
  end if;
  if p_def.reward_deniers > 0 then
    perform private.apply_wallet_delta(p_owner, p_def.reward_deniers, 'achievement_reward', 'achievement', null,
                                       'achievement:' || p_def.code || ':' || p_target);
  end if;
  if p_def.reward_boosters > 0 then
    update public.booster_balances set purchased_count = purchased_count + p_def.reward_boosters, updated_at = now()
     where owner_id = p_owner;
    insert into public.booster_grants (owner_id, source, pool, quantity) values (p_owner, 'reward', 'purchased', p_def.reward_boosters);
  end if;
end $$;
revoke execute on function private.give_lineage_reward(uuid, public.achievements, integer, boolean) from public, anon, authenticated;

-- Reprise de 20261023190000_team_factions, avec la récompense par total.
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
                where a.metric not in ('manual', 'clan_lineage', 'faction')
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
  -- Lignées et camps : recalculés à chaque passe, car ils se gagnent et se perdent.
  for v_def in select a.* from public.achievements a where a.metric in ('clan_lineage', 'faction') loop
    select * into v_state from private.achievement_state(p_owner, v_def);
    select * into v_hold from public.lineage_holds h where h.owner_id = p_owner and h.code = v_def.code;
    if v_state.target > 0 and v_state.progress >= v_state.target then
      if v_hold.owner_id is null then
        insert into public.lineage_holds (owner_id, code, rewarded_target) values (p_owner, v_def.code, v_state.target)
          on conflict do nothing;
        if found then perform private.give_lineage_reward(p_owner, v_def, v_state.target::int, true); end if;
      else
        if v_hold.lost_at is not null then
          update public.lineage_holds set since = now(), lost_at = null where owner_id = p_owner and code = v_def.code;
        end if;
        -- Nouveau total (un set a ajouté des membres) : récompense de nouveau, une fois pour ce total.
        if v_state.target > coalesce(v_hold.rewarded_target, 0) then
          update public.lineage_holds set rewarded_target = v_state.target where owner_id = p_owner and code = v_def.code;
          perform private.give_lineage_reward(p_owner, v_def, v_state.target::int, false);
        end if;
      end if;
    elsif v_hold.owner_id is not null and v_hold.lost_at is null then
      perform private.lose_lineage(p_owner, v_def.code);
    end if;
    v_states := v_states || jsonb_build_object(v_def.code, jsonb_build_array(v_state.progress, v_state.target));
  end loop;
  return v_states;
end $$;
