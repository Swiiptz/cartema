-- CARTEMA — succès qui offrent une carte (10/11/2026, succès du set 2).
--  * achievements.reward_card : 'blood_random_required' = au déblocage, un exemplaire Sanglant d'un des personnages
--    requis, tiré au hasard (ex. « Relation épistolaire » : une Sanglante de l'un des deux). Versé une seule fois,
--    comme les Deniers et les boosters (give_achievement_reward n'est appelée qu'au premier déblocage).
--  * La carte est découverte, et sa finition aussi ; aucune récompense de découverte en plus.

alter table public.achievements add column reward_card text check (reward_card in ('blood_random_required'));

create or replace function private.give_achievement_reward(p_owner uuid, p_def public.achievements) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_character uuid;
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
  if p_def.reward_card = 'blood_random_required' and cardinality(p_def.required_characters) > 0 then
    v_character := p_def.required_characters[1 + private.random_below(cardinality(p_def.required_characters))::int];
    insert into public.inventory_items (owner_id, character_id, finish) values (p_owner, v_character, 'Sanglante');
    insert into public.discoveries (owner_id, character_id) values (p_owner, v_character) on conflict do nothing;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (p_owner, v_character, 'Sanglante') on conflict do nothing;
  end if;
end $$;
revoke execute on function private.give_achievement_reward(uuid, public.achievements) from public, anon, authenticated;
