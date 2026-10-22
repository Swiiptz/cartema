-- CARTEMA — changement de rareté d'un personnage publié (décision du 22/10/2026 : H0220W, CAM-212,
-- passe de Peu commun à Rare). La rareté reste figée par characters_guard ; seule
-- private.change_character_rarity, jamais exposée, peut la changer, le temps de sa transaction.
-- Effets : les exemplaires possédés suivent (la rareté vient du personnage), l'historique des tirages
-- garde la rareté du moment (pack_opening_cards.rarity), les succès déjà débloqués restent acquis.
-- Pas de notification aux joueurs (décision du 22/10).

create or replace function private.characters_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Silhouette tirée une seule fois puis persistée (CDC §3).
    if new.silhouette_key is null then
      select s.key into new.silhouette_key from public.silhouettes s
      where s.active order by gen_random_uuid() limit 1;
    end if;
  else
    -- La rareté ne change que par private.change_character_rarity (réglage local à sa transaction).
    if new.id <> old.id or new.edition_id <> old.edition_id or new.number <> old.number
       or (new.rarity <> old.rarity and coalesce(current_setting('cartema.rarity_change', true), '') <> 'on') then
      raise exception 'immutable_character: identifiant, édition, numéro et rareté sont fixes';
    end if;
    if new.silhouette_key is distinct from old.silhouette_key and old.silhouette_key is not null then
      raise exception 'immutable_character: silhouette déjà attribuée';
    end if;
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create function private.change_character_rarity(p_character_id uuid, p_rarity public.rarity, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.characters;
  v_after public.characters;
begin
  select * into v_before from public.characters where id = p_character_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_before.is_unique then raise exception 'unique_card'; end if;
  if v_before.rarity = p_rarity then return; end if;
  -- Une édition doit garder ses sept raretés, sinon ses boosters ne s'ouvrent plus.
  if v_before.status = 'published' and not exists (
       select 1 from public.characters c
        where c.edition_id = v_before.edition_id and c.id <> v_before.id and c.rarity = v_before.rarity
          and c.status = 'published' and not c.is_unique) then
    raise exception 'rarity_would_empty';
  end if;
  perform set_config('cartema.rarity_change', 'on', true);
  update public.characters set rarity = p_rarity where id = p_character_id returning * into v_after;
  perform set_config('cartema.rarity_change', 'off', true);
  perform private.audit((select id from public.profiles where role = 'admin' limit 1), 'character_rarity',
    p_character_id, p_reason, jsonb_build_object('rarity', v_before.rarity), jsonb_build_object('rarity', v_after.rarity));
end $$;

revoke execute on function private.change_character_rarity(uuid, public.rarity, text) from public, anon, authenticated;

-- H0220W (CAM-212) : Peu commun → Rare. Rien à faire sur une base qui n'a pas cette carte (tests).
select private.change_character_rarity(c.id, 'Rare', 'H0220W passe en Rare (décision du 22/10/2026)')
  from public.characters c join public.editions e on e.id = c.edition_id
 where e.prefix = 'CAM' and c.number = 212 and c.rarity = 'Peu commun';
