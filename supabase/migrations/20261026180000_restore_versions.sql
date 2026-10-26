-- CARTEMA — restitution des versions d'illustration recyclées par lot (décision de Swiiptz, 26/10/2026).
-- « Recycler les doublons » prenait aussi les versions alternatives et les anciennes illustrations (corrigé par
-- 20261026170000_recycle_versions). Les versions parties dans un lot de doublons n'ont jamais été choisies :
-- elles sont rendues. Un lot de doublons se reconnaît à ses cartes de plusieurs personnages (la fiche d'une carte
-- ne recycle qu'un personnage à la fois) ; un recyclage d'un seul personnage reste tel quel.
--  * Un exemplaire recyclé est figé (inventory_recycled_guard) : on rend un exemplaire identique (personnage,
--    finition, version, signature, date d'obtention), l'historique du recyclage reste vrai.
--  * Les Deniers reçus pour ces cartes sont repris, sans jamais faire passer un solde sous zéro.
--  * Le joueur est prévenu une seule fois par une fenêtre (player_notices), qu'il ferme.
--  * Une version redevenue l'illustration officielle (Rus, 26/10) n'est pas rendue : ce serait une carte normale.

-- Fenêtres d'information à montrer une seule fois à un joueur.
create table public.player_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index player_notices_unseen_ix on public.player_notices (owner_id, created_at) where seen_at is null;
alter table public.player_notices enable row level security;

-- Versions déjà rendues : l'opération ne rend jamais deux fois le même exemplaire.
create table public.version_restorations (
  recycled_id uuid primary key references public.inventory_items(id),
  restored_id uuid not null references public.inventory_items(id),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  value bigint not null,
  created_at timestamptz not null default now()
);
alter table public.version_restorations enable row level security;

-- Prochaine fenêtre à montrer (lecture seule), ou null.
create function public.get_player_notice() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return (select jsonb_build_object('id', n.id, 'kind', n.kind, 'payload', n.payload, 'created_at', n.created_at)
            from public.player_notices n
           where n.owner_id = v_uid and n.seen_at is null
           order by n.created_at limit 1);
end $$;

create function public.dismiss_player_notice(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  update public.player_notices set seen_at = coalesce(seen_at, now()) where id = p_id and owner_id = v_uid;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Rend les versions recyclées dans un lot de plusieurs personnages ; renvoie le nombre de joueurs et de cartes.
create function private.restore_bulk_recycled_versions() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_owner record;
  v_item record;
  v_new uuid;
  v_cards jsonb;
  v_value bigint;
  v_taken bigint;
  v_players integer := 0;
  v_count integer := 0;
begin
  for v_owner in
    select distinct i.owner_id
      from public.inventory_items i
      join public.recycling_operations r on r.owner_id = i.owner_id and r.created_at = i.recycled_at
                                         and r.items @> jsonb_build_array(jsonb_build_object('instance_id', i.id))
      join public.card_arts a on a.id = i.art_id
      join public.characters c on c.id = i.character_id
     where i.art_id is not null and i.recycled_at is not null and a.art_path is distinct from c.art_path
       and not exists (select 1 from public.version_restorations v where v.recycled_id = i.id)
       and (select count(distinct x->>'character_id') from jsonb_array_elements(r.items) x) > 1
  loop
    perform 1 from public.wallets where owner_id = v_owner.owner_id for update;
    v_cards := '[]'::jsonb;
    v_value := 0;
    for v_item in
      select i.*, c.name, c.rarity, e.prefix || '-' || lpad(c.number::text, 3, '0') as code, a.label,
             coalesce((select (x->>'value')::bigint from jsonb_array_elements(r.items) x where x->>'instance_id' = i.id::text), 0) as value
        from public.inventory_items i
        join public.recycling_operations r on r.owner_id = i.owner_id and r.created_at = i.recycled_at
                                           and r.items @> jsonb_build_array(jsonb_build_object('instance_id', i.id))
        join public.characters c on c.id = i.character_id
        join public.editions e on e.id = c.edition_id
        join public.card_arts a on a.id = i.art_id
       where i.owner_id = v_owner.owner_id and i.recycled_at is not null and a.art_path is distinct from c.art_path
         and not exists (select 1 from public.version_restorations v where v.recycled_id = i.id)
         and (select count(distinct x->>'character_id') from jsonb_array_elements(r.items) x) > 1
       order by i.recycled_at, c.number
    loop
      insert into public.inventory_items (owner_id, character_id, finish, art_id, signed, acquired_at)
        values (v_item.owner_id, v_item.character_id, v_item.finish, v_item.art_id, v_item.signed, v_item.acquired_at)
        returning id into v_new;
      insert into public.version_restorations (recycled_id, restored_id, owner_id, value)
        values (v_item.id, v_new, v_item.owner_id, v_item.value);
      v_cards := v_cards || jsonb_build_object('code', v_item.code, 'card', v_item.name, 'rarity', v_item.rarity,
                                               'finish', v_item.finish, 'version', v_item.label);
      v_value := v_value + v_item.value;
      v_count := v_count + 1;
    end loop;
    -- Deniers repris, dans la limite du solde.
    v_taken := least(v_value, (select balance from public.wallets where owner_id = v_owner.owner_id));
    if v_taken > 0 then
      perform private.apply_wallet_delta(v_owner.owner_id, -v_taken, 'version_restore', 'version_restoration', null,
                                         'version_restore:' || v_owner.owner_id || ':' || now()::text);
    end if;
    insert into public.player_notices (owner_id, kind, payload)
      values (v_owner.owner_id, 'versions_restored', jsonb_build_object('cards', v_cards, 'deniers', v_taken, 'value', v_value));
    v_players := v_players + 1;
  end loop;
  return jsonb_build_object('players', v_players, 'cards', v_count);
end $$;

revoke execute on function private.restore_bulk_recycled_versions() from public, anon, authenticated;
revoke execute on function public.get_player_notice(), public.dismiss_player_notice(uuid) from public, anon;
grant execute on function public.get_player_notice(), public.dismiss_player_notice(uuid) to authenticated;

-- Restitution, une fois, à l'application de la migration.
select private.restore_bulk_recycled_versions();
