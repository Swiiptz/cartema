-- CARTEMA — versions alternatives retenues au concours : point plein ou demi-point (décision de Swiiptz, 25/10/2026).
--  * Pour un dessin retenu en version alternative, l'admin choisit point plein ou demi-point (demi-point par
--    défaut dans l'admin) : contest_entries.half_point. Le multiplicateur de la carte s'applique (Mythique ×4 :
--    2 points en demi-point). L'illustration officielle vaut toujours un point plein.
--  * Arrondi au supérieur sur le total de chaque joueur (3 demi-points = 1,5 → 2), pour limiter l'intérêt des
--    dessins en série face aux dessins soignés.
--  * admin_decide_contest_entry reçoit p_half en dernier (null = point plein) : le site déjà en ligne continue
--    de fonctionner. Le classement est recalculé à la distribution : vaut pour CAM 1.

alter table public.contest_entries add column half_point boolean not null default false;
comment on column public.contest_entries.half_point is 'Version alternative retenue pour un demi-point (choix de l''admin).';

create or replace function private.contest_ranking(p_contest uuid)
returns table (author_id uuid, handle text, leads bigint, selected bigint, drawings bigint, points bigint, place bigint)
language sql stable security definer set search_path = '' as $$
  -- Points multipliés par carte : Mythique ×3, sinon carte à privilégier ×2 (sans cumul).
  with l as (select t.author_id, count(*) as leads,
               sum(private.contest_card_multiplier(p_contest, t.character_id)) as lead_points
          from private.contest_tally(p_contest) t where t.in_lead group by t.author_id),
  a as (
    select e.author_id,
           count(*) filter (where e.selected is not null and e.hidden_at is null) as selected,
           coalesce(sum(private.contest_card_multiplier(p_contest, e.character_id)
                        * case when e.half_point then 0.5 else 1 end)
                    filter (where e.selected is not null and e.hidden_at is null), 0) as selected_points,
           count(*) filter (where e.real_drawing and e.hidden_at is null) as drawings
      from public.contest_entries e where e.contest_id = p_contest group by e.author_id),
  p as (select a.author_id, coalesce(l.leads, 0) as leads, a.selected, a.drawings,
               -- Demi-points des versions alternatives : arrondi au supérieur sur le total du joueur.
               ceil(coalesce(l.lead_points, 0) + a.selected_points + a.drawings)::bigint as points
          from a left join l on l.author_id = a.author_id)
  select p.author_id, pr.handle, p.leads, p.selected, p.drawings, p.points,
         rank() over (order by p.points desc) as place
    from p join public.profiles pr on pr.id = p.author_id
   where p.points > 0
   order by p.points desc, pr.handle
$$;

drop function public.admin_decide_contest_entry(uuid, text, text, boolean, text, jsonb, text);
create function public.admin_decide_contest_entry(p_entry_id uuid, p_selected text, p_line_label text, p_real_drawing boolean,
                                                  p_art_path text, p_art_meta jsonb, p_reason text,
                                                  p_half boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_entry public.contest_entries;
  v_contest public.contests;
  v_char public.characters;
  v_art uuid;
  v_finish public.finish;
  v_instance uuid;
begin
  select * into v_entry from public.contest_entries where id = p_entry_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into v_contest from public.contests where id = v_entry.contest_id;
  if v_contest.ends_at > now() then raise exception 'contest_open'; end if;
  if p_selected is not null and p_selected not in ('main', 'alternate') then raise exception 'invalid_kind'; end if;
  if v_entry.selected is not null and p_selected is distinct from v_entry.selected then raise exception 'already_decided'; end if;
  select * into v_char from public.characters where id = v_entry.character_id for update;

  if p_selected is not null and v_entry.selected is null then
    perform private.assert_art(p_art_path, coalesce(p_art_meta, '{}'::jsonb));
    if p_art_path is null then raise exception 'invalid_art_path'; end if;
    if p_selected = 'main' then
      -- Le déclencheur garde l'ancienne illustration sur les exemplaires déjà possédés.
      update public.characters set art_path = p_art_path, art_meta = coalesce(p_art_meta, '{}'::jsonb),
                                   art_credit = (select handle from public.profiles where id = v_entry.author_id)
       where id = v_char.id;
      v_art := null;
    else
      insert into public.card_arts (character_id, kind, label, art_path, art_meta, credit, created_by)
        values (v_char.id, 'alternate', coalesce(nullif(trim(p_line_label), ''), 'Version du concours'), p_art_path,
                coalesce(p_art_meta, '{}'::jsonb), (select handle from public.profiles where id = v_entry.author_id), v_admin)
        returning id into v_art;
    end if;
    -- Carte offerte à l'auteur, avec cette illustration.
    v_finish := case when v_char.rarity in ('Commun', 'Peu commun', 'Rare', 'Très rare') then 'Sanglante'
                     when v_char.rarity = 'Épique' then 'Dorée' else 'Standard' end;
    insert into public.inventory_items (owner_id, character_id, finish, art_id)
      values (v_entry.author_id, v_char.id, v_finish, v_art) returning id into v_instance;
    insert into public.discoveries (owner_id, character_id) values (v_entry.author_id, v_char.id) on conflict do nothing;
    insert into public.finish_discoveries (owner_id, character_id, finish) values (v_entry.author_id, v_char.id, v_finish)
      on conflict do nothing;
    -- Version alternative : point plein ou demi-point (choix de l'admin ; plein si non précisé).
    update public.contest_entries set selected = p_selected, line_label = nullif(trim(p_line_label), ''),
                                      half_point = p_selected = 'alternate' and coalesce(p_half, false),
                                      granted_instance = v_instance, decided_at = now()
     where id = p_entry_id;
    perform private.notify(v_entry.author_id, 'contest_selected', jsonb_build_object(
      'character', v_char.name, 'finish', v_finish, 'label', case when p_selected = 'main' then 'Illustration officielle' else coalesce(nullif(trim(p_line_label), ''), 'Version du concours') end));
  end if;

  update public.contest_entries set real_drawing = coalesce(p_real_drawing, real_drawing), decided_at = coalesce(decided_at, now())
   where id = p_entry_id;
  perform private.audit(v_admin, 'contest_decide', p_entry_id, v_reason, null,
    jsonb_build_object('selected', p_selected, 'line', p_line_label, 'real_drawing', p_real_drawing, 'instance', v_instance,
                       'half', p_half));
  return jsonb_build_object('selected', coalesce(p_selected, v_entry.selected), 'instance', v_instance, 'finish', v_finish);
end $$;
revoke execute on function public.admin_decide_contest_entry(uuid, text, text, boolean, text, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_decide_contest_entry(uuid, text, text, boolean, text, jsonb, text, boolean) to authenticated;

create or replace function public.admin_contest_entries(p_contest_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('entry_id', e.id, 'character_id', e.character_id,
      'code', ed.prefix || '-' || lpad(c.number::text, 3, '0'), 'name', c.name, 'rarity', c.rarity, 'prefix', ed.prefix, 'number', c.number,
      'author', pr.handle, 'author_id', e.author_id, 'image_path', e.image_path, 'created_at', e.created_at,
      'votes', (select count(*) from public.contest_votes v where v.entry_id = e.id),
      'leading', coalesce((select t.in_lead from private.contest_tally(p_contest_id) t where t.entry_id = e.id), false),
      'hidden', e.hidden_at is not null, 'hidden_reason', e.hidden_reason,
      'reports', coalesce((select jsonb_agg(r.reason order by r.created_at) from public.contest_reports r where r.entry_id = e.id), '[]'::jsonb),
      'selected', e.selected, 'line_label', e.line_label, 'real_drawing', e.real_drawing, 'granted', e.granted_instance is not null,
      'half_point', e.half_point)
      order by c.number, (select count(*) from public.contest_votes v where v.entry_id = e.id) desc)
    from public.contest_entries e
    join public.characters c on c.id = e.character_id
    join public.editions ed on ed.id = c.edition_id
    join public.profiles pr on pr.id = e.author_id
   where e.contest_id = p_contest_id), '[]'::jsonb);
end $$;
