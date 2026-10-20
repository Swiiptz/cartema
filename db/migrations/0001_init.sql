-- SCHÉMA PARTIEL D'AMORÇAGE. Ne pas exécuter en production sans ajouter RLS,
-- politiques d'authentification, services transactionnels, contraintes et tables métier.
create extension if not exists pgcrypto;
create table if not exists profiles (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid unique,
 handle text unique not null,
 role text not null default 'player' check(role in ('player','admin')),
 created_at timestamptz not null default now(),
 banned_at timestamptz
);
create table if not exists clans (
 id uuid primary key default gen_random_uuid(),
 name text unique not null,
 sigil_asset_path text,
 created_at timestamptz not null default now()
);
create table if not exists editions (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 prefix text unique not null,
 cover_asset_path text,
 album_published boolean not null default false,
 packs_enabled boolean not null default false,
 archived_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists characters (
 id uuid primary key default gen_random_uuid(),
 edition_id uuid not null references editions(id),
 clan_id uuid references clans(id),
 number integer not null check(number>0),
 name text not null,
 role_title text not null default '',
 rarity text not null check(rarity in ('Commun','Peu commun','Rare','Très rare','Épique','Légendaire','Mythique')),
 art_path text,
 silhouette_key text not null,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 created_at timestamptz not null default now(),
 unique(edition_id,number)
);
create table if not exists card_instances (
 id uuid primary key default gen_random_uuid(),
 character_id uuid not null references characters(id),
 owner_id uuid not null references profiles(id),
 finish text not null check(finish in ('Standard','Dorée','Sanglante')),
 locked boolean not null default false,
 reserved_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists ix_card_owner on card_instances(owner_id,character_id,finish);
create table if not exists discoveries (
 owner_id uuid not null references profiles(id),
 character_id uuid not null references characters(id),
 first_seen_at timestamptz not null default now(),
 primary key(owner_id,character_id)
);
create table if not exists wallets (
 owner_id uuid primary key references profiles(id),
 deniers bigint not null default 0 check(deniers>=0)
);
create table if not exists wallet_ledger (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references profiles(id),
 delta bigint not null,
 kind text not null,
 correlation_id uuid not null,
 created_at timestamptz not null default now(),
 unique(owner_id,kind,correlation_id)
);
create table if not exists admin_audit_logs (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references profiles(id),
 target_id uuid,
 action text not null,
 reason text not null check(length(trim(reason))>0),
 before_state jsonb,
 after_state jsonb,
 created_at timestamptz not null default now()
);
-- Sécurité indispensable AVANT activation des API : RLS, politiques par rôle,
-- transactions atomiques, tables d'inventaire/boutique/enchères/manifeste, audit.
