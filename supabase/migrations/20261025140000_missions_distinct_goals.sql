-- CARTEMA — missions : jamais deux missions du même objectif sur une période (signalement de Swiiptz, 25/10/2026).
-- « Découvrir 1 nouveau visage » et « Découvrir 2 nouveaux visages » pouvaient tomber le même jour, y compris
-- en remplacement l'une de l'autre (26 cas). Le tirage prend au plus une mission par métrique, mission
-- remplacée comprise ; repli sans cette règle s'il manque des objectifs distincts.

create or replace function private.ensure_missions(p_owner uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_missing integer;
begin
  select period_start, period_end into v_start, v_end from private.mission_period(p_kind);
  perform 1 from public.profiles where id = p_owner for update;
  -- Missions fixes d'abord (jamais remplacées), puis tirage au hasard jusqu'à 3.
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and t.fixed and private.mission_eligible(p_owner, t.requires)
  on conflict do nothing;
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  -- Un seul tirage par objectif (métrique) sur la période, mission remplacée comprise : jamais « 1 visage »
  -- et « 2 visages » le même jour.
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, x.code, p_kind, v_start, v_end
      from (select distinct on (t.metric) t.code
              from public.mission_templates t
             where t.kind = p_kind and t.active and not t.fixed and private.mission_eligible(p_owner, t.requires)
               and not exists (select 1 from public.mission_assignments a
                                join public.mission_templates t2 on t2.code = a.template_code
                               where a.owner_id = p_owner and a.period_start = v_start
                                 and (a.template_code = t.code or t2.metric = t.metric))
             order by t.metric, random()) x
     order by random() limit v_missing;
  -- Repli si les objectifs distincts manquent : compléter avec d'autres missions, sans doublon de mission.
  v_missing := 3 - (select count(*) from public.mission_assignments
                     where owner_id = p_owner and period_start = v_start and replaced_at is null);
  if v_missing <= 0 then return; end if;
  insert into public.mission_assignments (owner_id, template_code, kind, period_start, period_end)
    select p_owner, t.code, p_kind, v_start, v_end
      from public.mission_templates t
     where t.kind = p_kind and t.active and not t.fixed and private.mission_eligible(p_owner, t.requires)
       and not exists (select 1 from public.mission_assignments a
                        where a.owner_id = p_owner and a.period_start = v_start and a.template_code = t.code)
     order by random() limit v_missing;
end $$;
