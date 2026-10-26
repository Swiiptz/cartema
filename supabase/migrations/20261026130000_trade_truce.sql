-- CARTEMA — trêve des échanges (décision de Swiiptz, 26/10/2026). La fenêtre d'échange n'affichait pas les rappels
-- du délai de 72 h et des 30 jours sans retour : des joueurs ont cédé des cartes sans le savoir. Un événement
-- marqué trade_truce suspend, tant qu'il est en cours, le délai après réception (private.cooldown_until) et le
-- délai avant retour (private.card_return_until) : les cartes peuvent revenir à leur ancien propriétaire.
-- Les deux protections reprennent à la fin de l'événement. L'événement lui-même (12 h) est créé à part, en
-- production, au moment voulu ; son bandeau sert d'annonce.

alter table public.events add column trade_truce boolean not null default false;
comment on column public.events.trade_truce is 'Trêve des échanges : ni délai après réception, ni délai avant retour pendant l''événement.';

-- Vrai si une trêve des échanges est en cours (table minuscule, index sur la période).
create function private.trade_truce_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events where trade_truce and cancelled_at is null and starts_at <= now() and ends_at > now())
$$;

create or replace function private.cooldown_until(p_received timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p_received is not null and v.h > 0 and not private.trade_truce_active() and p_received + make_interval(hours => v.h) > now()
              then p_received + make_interval(hours => v.h) end
    from (select coalesce(((private.active_settings()).settings->>'trade_cooldown_hours')::int, 0) h) v
$$;

create or replace function private.card_return_until(p_instance uuid, p_owner uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(s.at) + interval '7 days' from (
    select t.closed_at as at from public.trade_items ti join public.trades t on t.id = ti.trade_id
     where ti.instance_id = p_instance and t.status = 'accepted'
       and case ti.side when 'proposer' then t.proposer_id else t.recipient_id end = p_owner
    union all
    select g.closed_at from public.gifts g
     where g.instance_id = p_instance and g.status = 'accepted' and g.sender_id = p_owner
    union all
    select l.closed_at from public.listings l
     where l.instance_id = p_instance and l.status = 'sold' and l.seller_id = p_owner) s
  where s.at > now() - interval '7 days' and not private.trade_truce_active()
$$;

create or replace function public.get_events() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'description', e.description,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'active', e.starts_at <= now(),
      'finish_multiplier', e.finish_multiplier, 'deniers_multiplier', e.deniers_multiplier,
      'bonus_boosters', e.bonus_boosters, 'free_interval_hours', e.free_interval_hours, 'trade_truce', e.trade_truce,
      'claimed', exists (select 1 from public.event_claims c where c.event_id = e.id and c.owner_id = v_uid))
      order by e.starts_at)
    from public.events e
   where e.cancelled_at is null and e.ends_at > now() and e.starts_at < now() + interval '14 days'), '[]'::jsonb);
end $$;

revoke execute on function private.trade_truce_active() from public, anon, authenticated;
