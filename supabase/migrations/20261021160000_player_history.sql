-- CARTEMA — historique du joueur (CDC §9 : historique intégral des ouvertures, des ventes, échanges,
-- dons et recyclages). Lecture seule, uniquement ses propres opérations, page par page (curseur
-- de date). Catégories : boosters, market, social (échanges et cadeaux), recycling, deniers.

create function private.card_brief(p_character uuid, p_finish public.finish) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'code', e.prefix || '-' || lpad(c.number::text, 3, '0'), 'rarity', c.rarity, 'finish', p_finish)
    from public.characters c join public.editions e on e.id = c.edition_id where c.id = p_character
$$;

create function public.get_history(p_category text default 'all', p_before timestamptz default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_cat text := coalesce(p_category, 'all');
  v_items jsonb;
begin
  if v_cat not in ('all', 'boosters', 'market', 'social', 'recycling', 'deniers') then raise exception 'invalid_kind'; end if;
  with events as (
    -- Ouvertures : les 5 exemplaires obtenus, l'édition, la source, la version des règles.
    select o.created_at as at, jsonb_build_object('type', 'opening', 'pool', o.pool, 'edition', e.name,
             'ruleset', r.version, 'event', ev.name,
             'cards', (select jsonb_agg(private.card_brief(pc.character_id, pc.finish)
                         || jsonb_build_object('variant', a.label) order by pc.position)
                         from public.pack_opening_cards pc left join public.card_arts a on a.id = pc.art_id
                        where pc.opening_id = o.id)) as item
      from public.pack_openings o join public.editions e on e.id = o.edition_id
      join public.pack_rulesets r on r.id = o.ruleset_id left join public.events ev on ev.id = o.event_id
     where o.owner_id = v_uid and v_cat in ('all', 'boosters') and o.created_at < v_before
    union all
    -- Achats en boutique.
    select l.created_at, jsonb_build_object('type', 'shop', 'amount', -l.delta)
      from public.wallet_ledger l
     where l.owner_id = v_uid and l.kind = 'shop_booster' and v_cat in ('all', 'boosters') and l.created_at < v_before
    union all
    -- Marché : ventes (prix, commission, net), achats, annonces retirées ou sans offre.
    select coalesce(m.closed_at, m.created_at), jsonb_build_object(
             'type', case when m.seller_id = v_uid then 'sale' else 'purchase' end, 'status', m.status, 'auction', m.kind = 'auction',
             'card', private.card_brief(m.character_id, m.finish), 'price', coalesce(m.current_bid, m.price),
             'commission', m.commission, 'other', private.handle_of(case when m.seller_id = v_uid then m.buyer_id else m.seller_id end))
      from public.listings m
     where (m.seller_id = v_uid or (m.buyer_id = v_uid and m.status = 'sold')) and m.status <> 'active'
       and v_cat in ('all', 'market') and coalesce(m.closed_at, m.created_at) < v_before
    union all
    -- Échanges conclus, refusés, annulés ou expirés.
    select coalesce(t.closed_at, t.created_at), jsonb_build_object('type', 'trade', 'status', t.status,
             'other', private.handle_of(case when t.proposer_id = v_uid then t.recipient_id else t.proposer_id end),
             'proposed', t.proposer_id = v_uid,
             'given', (select coalesce(jsonb_agg(private.card_brief(ti.character_id, ti.finish)), '[]'::jsonb) from public.trade_items ti
                        where ti.trade_id = t.id and ti.side = case when t.proposer_id = v_uid then 'proposer' else 'recipient' end),
             'received', (select coalesce(jsonb_agg(private.card_brief(ti.character_id, ti.finish)), '[]'::jsonb) from public.trade_items ti
                           where ti.trade_id = t.id and ti.side = case when t.proposer_id = v_uid then 'recipient' else 'proposer' end),
             'deniers_given', case when t.proposer_id = v_uid then t.proposer_deniers else t.recipient_deniers end,
             'deniers_received', case when t.proposer_id = v_uid then t.recipient_deniers else t.proposer_deniers end)
      from public.trades t
     where (t.proposer_id = v_uid or t.recipient_id = v_uid) and t.status <> 'pending'
       and v_cat in ('all', 'social') and coalesce(t.closed_at, t.created_at) < v_before
    union all
    -- Cadeaux envoyés et reçus.
    select coalesce(g.closed_at, g.created_at), jsonb_build_object('type', 'gift', 'status', g.status, 'sent', g.sender_id = v_uid,
             'other', private.handle_of(case when g.sender_id = v_uid then g.recipient_id else g.sender_id end),
             'card', private.card_brief(g.character_id, g.finish))
      from public.gifts g
     where (g.sender_id = v_uid or g.recipient_id = v_uid) and g.status <> 'pending'
       and v_cat in ('all', 'social') and coalesce(g.closed_at, g.created_at) < v_before
    union all
    -- Recyclages : cartes et Deniers obtenus.
    select r.created_at, jsonb_build_object('type', 'recycling', 'total', r.total, 'count', jsonb_array_length(r.items),
             'cards', (select jsonb_agg(private.card_brief((x->>'character_id')::uuid, (x->>'finish')::public.finish))
                         from jsonb_array_elements(r.items) x))
      from public.recycling_operations r
     where r.owner_id = v_uid and v_cat in ('all', 'recycling') and r.created_at < v_before
    union all
    -- Tous les mouvements de Deniers (catégorie dédiée uniquement).
    select l.created_at, jsonb_build_object('type', 'ledger', 'kind', l.kind, 'delta', l.delta, 'balance', l.balance_after)
      from public.wallet_ledger l
     where l.owner_id = v_uid and v_cat = 'deniers' and l.created_at < v_before
  )
  select coalesce(jsonb_agg(item || jsonb_build_object('at', at) order by at desc), '[]'::jsonb) into v_items
    from (select * from events order by at desc limit v_limit) x;
  return jsonb_build_object('items', v_items,
    'next', case when jsonb_array_length(v_items) = v_limit then v_items->(v_limit - 1)->>'at' end);
end $$;

revoke execute on function private.card_brief(uuid, public.finish) from public, anon, authenticated;
revoke execute on function public.get_history(text, timestamptz, integer) from public, anon;
grant execute on function public.get_history(text, timestamptz, integer) to authenticated;
