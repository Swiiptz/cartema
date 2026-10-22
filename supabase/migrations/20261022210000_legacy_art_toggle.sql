-- CARTEMA — anciennes illustrations officielles tirables (décision du 22/10/2026). Une ancienne
-- officielle (« Illustration d'origine », « Ancienne illustration 2 »…) devient une version comme les
-- alternatives : active par défaut, elle peut tomber au tirage avec la chance de sa ligne (même nom)
-- ou la chance globale ; désactivée, elle ne tombe plus et les exemplaires possédés la gardent.
-- Elles étaient jusqu'ici créées avec active = false, sans effet : toutes deviennent actives.
-- Les lignes de versions (admin › Économie) les regroupent aussi par nom, et listent leurs cartes.

update public.card_arts set active = true where kind = 'legacy' and not active;

create or replace function private.on_character_art_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_art uuid;
  v_count integer;
begin
  if old.art_path is not null and new.art_path is distinct from old.art_path then
    v_count := (select count(*) from public.card_arts where character_id = old.id and kind = 'legacy');
    insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, active)
      values (old.id, 'legacy', case when v_count = 0 then 'Illustration d’origine' else 'Ancienne illustration ' || (v_count + 1) end,
              old.art_path, coalesce(old.art_meta, '{}'::jsonb), old.art_credit, true)
      returning id into v_art;
    -- Les exemplaires possédés gardent l'illustration qu'ils avaient.
    update public.inventory_items set art_id = v_art
     where character_id = old.id and art_id is null and recycled_at is null;
    -- Le crédit appartenait à l'ancienne image, sauf s'il est changé dans la même opération.
    if new.art_credit is not distinct from old.art_credit then new.art_credit := null; end if;
  end if;
  return new;
end $$;

-- Version tirée pour ce personnage (alternative ou ancienne officielle), ou null (officielle actuelle).
create or replace function private.pick_alternate_art(p_character uuid, p_global_odds integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_line record;
begin
  for v_line in
    select a.label, coalesce(l.odds, p_global_odds, 0) as odds, count(*)::int as n
      from public.card_arts a
      left join public.card_art_lines l on l.label = a.label
     where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and coalesce(l.active, true)
     group by a.label, l.odds
     order by random()
  loop
    if v_line.odds > 0 and private.random_below(v_line.odds) = 0 then
      return (select a.id from public.card_arts a
               where a.character_id = p_character and a.kind in ('alternate', 'legacy') and a.active and a.label = v_line.label
               order by a.id offset private.random_below(v_line.n) limit 1);
    end if;
  end loop;
  return null;
end $$;

-- Activer / désactiver une version tirable (alternative ou ancienne officielle).
create or replace function public.admin_set_card_art_active(p_id uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_art public.card_arts;
begin
  select * into v_art from public.card_arts where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.card_arts set active = coalesce(p_active, false) where id = p_id;
  perform private.audit(v_admin,
    case when v_art.kind = 'legacy' then case when p_active then 'art_legacy_enable' else 'art_legacy_disable' end
         else case when p_active then 'art_alternate_enable' else 'art_alternate_disable' end end,
    v_art.character_id, v_reason, null, jsonb_build_object('art', p_id));
end $$;

-- Lignes de versions : alternatives et anciennes officielles, avec le détail de leurs cartes.
create or replace function public.admin_art_lines() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'global_odds', coalesce(((private.active_settings()).settings->>'alternate_art_odds')::int, 0),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'legacy', x.legacy, 'active', coalesce(l.active, true), 'odds', l.odds,
        'arts', x.arts, 'active_arts', x.active_arts, 'characters', x.characters, 'owned', x.owned,
        'cards', (select jsonb_agg(jsonb_build_object('art_id', a.id, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'),
                                                      'name', c.name, 'rarity', c.rarity, 'art_path', a.art_path, 'active', a.active,
                                                      'owned', (select count(*) from public.inventory_items i
                                                                 where i.art_id = a.id and i.recycled_at is null))
                                   order by e.prefix, c.number)
                    from public.card_arts a join public.characters c on c.id = a.character_id join public.editions e on e.id = c.edition_id
                   where a.kind in ('alternate', 'legacy') and a.label = x.label)) order by x.legacy, x.label)
      from (select a.label, bool_and(a.kind = 'legacy') as legacy, count(*) as arts, count(*) filter (where a.active) as active_arts,
                   count(distinct a.character_id) as characters,
                   (select count(*) from public.inventory_items i join public.card_arts a2 on a2.id = i.art_id
                     where a2.label = a.label and a2.kind in ('alternate', 'legacy') and i.recycled_at is null) as owned
              from public.card_arts a where a.kind in ('alternate', 'legacy') group by a.label) x
      left join public.card_art_lines l on l.label = x.label), '[]'::jsonb));
end $$;

-- p_odds null = chance globale.
create or replace function public.admin_set_art_line(p_label text, p_active boolean, p_odds integer, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.card_art_lines;
begin
  if not exists (select 1 from public.card_arts where label = p_label and kind in ('alternate', 'legacy')) then
    raise exception 'not_found';
  end if;
  if p_odds is not null and (p_odds < 0 or p_odds > 1000000) then raise exception 'invalid_odds'; end if;
  select * into v_before from public.card_art_lines where label = p_label for update;
  insert into public.card_art_lines (label, active, odds, updated_by)
    values (p_label, coalesce(p_active, true), p_odds, v_admin)
    on conflict (label) do update set active = excluded.active, odds = excluded.odds,
                                      updated_by = excluded.updated_by, updated_at = now();
  perform private.audit(v_admin, 'art_line', null, v_reason,
    case when v_before.label is not null then jsonb_build_object('label', p_label, 'active', v_before.active, 'odds', v_before.odds) end,
    jsonb_build_object('label', p_label, 'active', coalesce(p_active, true), 'odds', p_odds));
end $$;
