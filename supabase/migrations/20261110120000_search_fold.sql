-- CARTEMA — recherche sans accents (doléance du 30/10, 10/11/2026) : « Lucie » trouve « Lucié » et « Lucien ».
--  * private.fold : minuscules, accents et ligatures retirés, apostrophe typographique ramenée à « ' ».
--    Écrit en SQL simple (translate) plutôt qu'avec l'extension unaccent, absente de la base de test.
--  * Marché (get_market_board, via private.market_rows) : la recherche compare les noms repliés.

create function private.fold(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select replace(replace(replace(replace(lower(translate(p, 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ’', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy''')),
                 'œ', 'oe'), 'æ', 'ae'), 'Œ', 'oe'), 'Æ', 'ae')
$$;
revoke execute on function private.fold(text) from public, anon, authenticated;

-- Reprise de 20261022130000_market_board : noms et recherche repliés.
create or replace function private.market_rows(p_viewer uuid, p_kind text, p_rarity public.rarity, p_finish public.finish,
                                    p_clan_id uuid, p_query text, p_undiscovered boolean)
returns table (id uuid, character_id uuid, finish public.finish, art_id uuid, price bigint, created_at timestamptz,
               ends_at timestamptz, rarity public.rarity, number integer)
language sql stable security definer set search_path = '' as $$
  select l.id, l.character_id, l.finish, i.art_id, coalesce(l.current_bid, l.price), l.created_at, l.ends_at, c.rarity, c.number
    from public.listings l
    join public.characters c on c.id = l.character_id
    join public.inventory_items i on i.id = l.instance_id
   where l.status = 'active' and l.kind = p_kind
     and (l.kind <> 'auction' or l.ends_at > now())
     and (p_rarity is null or c.rarity = p_rarity)
     and (p_finish is null or l.finish = p_finish)
     and (p_clan_id is null or c.clan_id = p_clan_id)
     and (p_query is null or private.fold(c.name) like '%' || private.fold(p_query) || '%')
     and (not coalesce(p_undiscovered, false)
          or not exists (select 1 from public.discoveries d where d.owner_id = p_viewer and d.character_id = c.id))
$$;
revoke execute on function private.market_rows(uuid, text, public.rarity, public.finish, uuid, text, boolean) from public, anon, authenticated;
