-- CARTEMA — schéma de base.
-- Tables exposées dans `public` (protégées par RLS, voir migration security),
-- fonctions internes dans `private` (schéma jamais accordé à anon/authenticated).
-- Instants stockés en timestamptz (UTC) ; calendrier métier Europe/Paris.

create schema if not exists private;
revoke all on schema private from public;

create type public.rarity as enum ('Commun','Peu commun','Rare','Très rare','Épique','Légendaire','Mythique');
create type public.finish as enum ('Standard','Dorée','Sanglante');
create type public.publication_status as enum ('draft','published','archived');

-- ---------------------------------------------------------------- comptes
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text,
  role text not null default 'player' check (role in ('player','admin')),
  created_at timestamptz not null default now(),
  suspended_at timestamptz,
  transactions_blocked_at timestamptz,
  constraint handle_format check (handle is null or handle ~ '^[[:alnum:]_.-]{3,24}$')
);
create unique index profiles_handle_key on public.profiles (lower(handle)) where handle is not null;
-- Un seul administrateur principal (CDC §2).
create unique index profiles_single_admin on public.profiles (role) where role = 'admin';

-- ---------------------------------------------------------------- catalogue
create table public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  symbol_key text,
  created_at timestamptz not null default now()
);

create table public.silhouettes (
  key text primary key check (key ~ '^[a-z0-9_-]+$'),
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  prefix text not null unique check (prefix ~ '^[A-Z0-9]{2,8}$'),
  cover_path text,
  album_published boolean not null default false,
  packs_enabled boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id),
  clan_id uuid references public.clans(id),
  number integer not null check (number > 0),
  name text not null check (length(trim(name)) > 0),
  role_title text not null default '',
  rarity public.rarity not null,
  art_path text,
  art_meta jsonb not null default '{}'::jsonb,
  silhouette_key text references public.silhouettes(key),
  status public.publication_status not null default 'draft',
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, number)
);
create index characters_draw_ix on public.characters (edition_id, rarity) where status = 'published';

-- ---------------------------------------------------------------- configuration versionnée
-- Les poids sont des entiers sur 100 000 (0,1 % = 100) pour éviter les flottants.
create table public.pack_rulesets (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  slots jsonb not null,
  finishes jsonb not null,
  notes text not null default '',
  active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index pack_rulesets_single_active on public.pack_rulesets (active) where active;

create table public.economy_settings (
  version integer primary key check (version > 0),
  settings jsonb not null,
  active boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index economy_settings_single_active on public.economy_settings (active) where active;

-- ---------------------------------------------------------------- économie
create table public.wallets (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.wallet_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  kind text not null,
  ref_type text,
  ref_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);
create index wallet_ledger_owner_ix on public.wallet_ledger (owner_id, created_at desc);

create table public.booster_balances (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  free_count integer not null default 0 check (free_count >= 0),
  purchased_count integer not null default 0 check (purchased_count >= 0),
  -- Dernier créneau 06 h / 18 h (Paris) déjà traité ; jamais retraité.
  free_synced_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.booster_grants (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('free_slot','welcome','shop','admin','reward')),
  pool text not null check (pool in ('free','purchased')),
  quantity integer not null check (quantity <> 0),
  slot_at timestamptz,
  ref_id uuid,
  created_at timestamptz not null default now(),
  check ((source = 'free_slot') = (slot_at is not null))
);
create unique index booster_grants_slot_key on public.booster_grants (owner_id, slot_at) where source = 'free_slot';

create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  price bigint not null check (price > 0),
  settings_version integer not null references public.economy_settings(version),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, request_id)
);

-- ---------------------------------------------------------------- ouvertures et inventaire
create table public.pack_openings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  edition_id uuid not null references public.editions(id),
  ruleset_id uuid not null references public.pack_rulesets(id),
  pool text not null check (pool in ('free','purchased')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, request_id)
);
create index pack_openings_owner_ix on public.pack_openings (owner_id, created_at desc);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  finish public.finish not null,
  locked boolean not null default false,
  reserved_kind text check (reserved_kind in ('listing','auction','trade','gift')),
  reserved_ref uuid,
  origin_opening_id uuid references public.pack_openings(id),
  acquired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((reserved_kind is null) = (reserved_ref is null))
);
create index inventory_owner_ix on public.inventory_items (owner_id, character_id, finish);

create table public.pack_opening_cards (
  opening_id uuid not null references public.pack_openings(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  instance_id uuid not null references public.inventory_items(id),
  character_id uuid not null references public.characters(id),
  rarity public.rarity not null,
  finish public.finish not null,
  primary key (opening_id, position)
);

-- Découverte historique : jamais supprimée lors d'une cession ou d'un recyclage.
create table public.discoveries (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  first_seen_at timestamptz not null default now(),
  primary key (owner_id, character_id)
);

create table public.finish_discoveries (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id),
  finish public.finish not null,
  first_seen_at timestamptz not null default now(),
  primary key (owner_id, character_id, finish)
);

-- ---------------------------------------------------------------- audit
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  target_id uuid,
  action text not null,
  reason text not null check (length(trim(reason)) > 0),
  before_state jsonb,
  after_state jsonb,
  operation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
