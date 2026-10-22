-- CARTEMA — prix de référence au marché (22/10/2026). Pour une carte (personnage, finition, version
-- d'illustration) : les 10 dernières ventes des 90 derniers jours (prix fixe ou enchère), leur
-- moyenne, la dernière, et l'offre à prix fixe la moins chère en cours. Affiché à la mise en vente
-- (avec un prix proposé) et dans la liste des offres du marché.

create function public.get_card_prices(p_character_id uuid, p_finish public.finish, p_art_id uuid default null,
                                       p_instance_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  -- Depuis un exemplaire : sa version d'illustration.
  v_art uuid := case when p_instance_id is null then p_art_id
                     else (select art_id from public.inventory_items where id = p_instance_id) end;
  v_sales jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('price', s.price, 'kind', s.kind, 'closed_at', s.closed_at) order by s.closed_at desc), '[]'::jsonb)
    into v_sales
    from (select coalesce(l.current_bid, l.price) as price, l.kind, l.closed_at
            from public.listings l join public.inventory_items i on i.id = l.instance_id
           where l.character_id = p_character_id and l.finish = p_finish and i.art_id is not distinct from v_art
             and l.status = 'sold' and l.closed_at > now() - interval '90 days'
           order by l.closed_at desc limit 10) s;
  return jsonb_build_object('sales', v_sales,
    'average', (select round(avg((x->>'price')::bigint))::bigint from jsonb_array_elements(v_sales) x),
    'last', (v_sales->0->>'price')::bigint,
    'lowest', (select min(l.price) from public.listings l join public.inventory_items i on i.id = l.instance_id
                where l.character_id = p_character_id and l.finish = p_finish and i.art_id is not distinct from v_art
                  and l.status = 'active' and l.kind = 'fixed' and l.seller_id <> v_uid));
end $$;

revoke execute on function public.get_card_prices(uuid, public.finish, uuid, uuid) from public, anon;
grant execute on function public.get_card_prices(uuid, public.finish, uuid, uuid) to authenticated;
