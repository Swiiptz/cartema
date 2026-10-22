-- CARTEMA — rangement des succès personnalisés (22/10/2026). L'administrateur choisit où un succès
-- personnalisé s'affiche : succès généraux (sans édition) ou le set d'une édition. Jusqu'ici ce
-- rattachement ne se faisait que par migration.

drop function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[]);
create function public.admin_save_achievement(p_code text, p_label text, p_description text, p_secret boolean,
                                              p_reward_deniers bigint, p_reward_boosters integer, p_title text,
                                              p_characters uuid[] default null, p_edition_id uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_code text := coalesce(nullif(trim(p_code), ''), 'custom:' || gen_random_uuid());
  v_chars uuid[] := (select array_agg(distinct c.id) from public.characters c where c.id = any (coalesce(p_characters, '{}')));
begin
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'name_required'; end if;
  if p_edition_id is not null and not exists (select 1 from public.editions where id = p_edition_id) then
    raise exception 'not_found';
  end if;
  insert into public.achievements (code, label, description, secret, category, metric, target, required_characters,
                                   reward_deniers, reward_boosters, title, sort, edition_id)
    values (v_code, trim(p_label), coalesce(trim(p_description), ''), coalesce(p_secret, false), 'custom',
            case when v_chars is null then 'manual' else 'characters' end, 1, v_chars,
            greatest(coalesce(p_reward_deniers, 0), 0), greatest(coalesce(p_reward_boosters, 0), 0), nullif(trim(p_title), ''), 500,
            p_edition_id)
  on conflict (code) do update set label = excluded.label, description = excluded.description, secret = excluded.secret,
    reward_deniers = excluded.reward_deniers, reward_boosters = excluded.reward_boosters, title = excluded.title,
    edition_id = excluded.edition_id,
    metric = case when public.achievements.metric in ('manual', 'characters') then excluded.metric else public.achievements.metric end,
    required_characters = case when public.achievements.metric in ('manual', 'characters') then excluded.required_characters
                               else public.achievements.required_characters end
    where public.achievements.category = 'custom';
  perform private.audit(v_admin, 'achievement_save', null, 'Succès personnalisé ' || trim(p_label), null,
                        jsonb_build_object('code', v_code, 'edition', p_edition_id));
  return v_code;
end $$;

create or replace function public.admin_custom_achievements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label, 'description', a.description,
      'secret', a.secret, 'reward_deniers', a.reward_deniers, 'reward_boosters', a.reward_boosters, 'title', a.title,
      'conditional', a.metric = 'characters', 'automatic', a.metric <> 'manual', 'edition', e.name, 'edition_id', a.edition_id,
      'characters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'code', ce.prefix || '-' || lpad(c.number::text, 3, '0')) order by c.number)
                               from public.characters c join public.editions ce on ce.id = c.edition_id
                              where c.id = any (coalesce(a.required_characters, '{}'))), '[]'::jsonb),
      'holders', (select coalesce(jsonb_agg(p.handle order by u.unlocked_at), '[]'::jsonb)
                    from public.achievement_unlocks u join public.profiles p on p.id = u.owner_id where u.code = a.code))
      order by a.label) from public.achievements a left join public.editions e on e.id = a.edition_id
     where a.category = 'custom'), '[]'::jsonb);
end $$;

revoke execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid) from public, anon;
grant execute on function public.admin_save_achievement(text, text, text, boolean, bigint, integer, text, uuid[], uuid) to authenticated;
