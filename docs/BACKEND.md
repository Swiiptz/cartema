# CARTEMA — Backend Supabase

## Architecture retenue (20 octobre 2026)

- **Front** : Next.js exporté en site statique, hébergé sur **GitHub Pages**. Aucun code serveur Next.js (ni route API, ni Server Action, ni middleware).
- **Back** : **Supabase**, avec Auth (e-mail et Discord), PostgreSQL et Storage pour les images.
- **Logique métier dans Postgres.** Toute écriture passe par une fonction RPC `SECURITY DEFINER` du schéma `public`, appelée avec la clé `anon` et le JWT du joueur. La fonction vérifie `auth.uid()`, verrouille les lignes concernées et écrit tout dans une seule transaction.
- **Droits du navigateur** : il lit uniquement ses propres lignes (RLS) et n'a **aucun droit d'écriture direct** sur les tables.
- **Clé `service_role`** : elle n'est utilisée ni par le site ni par GitHub Pages. Elle ne sert qu'aux opérations d'exploitation (CLI, sauvegardes).
- **Fonctions internes** : elles vivent dans le schéma `private`, qui n'est jamais accordé à `anon` ni à `authenticated`.

## Migrations

Les fichiers de `supabase/migrations/` s'appliquent dans l'ordre :

| Fichier | Contenu |
|---|---|
| `…120000_core_schema.sql` | Types, tables du catalogue, de la configuration versionnée, de l'économie, des ouvertures, de l'inventaire et de l'audit |
| `…120100_integrity.sql` | Invariants (poids à 100 %, 5ᵉ emplacement Rare ou mieux, versions figées, ledger en ajout seul, numéro et rareté immuables, silhouette persistée, édition incomplète non activable) et configuration initiale |
| `…120200_security.sql` | Retrait des droits par défaut de Supabase, RLS, création de compte, créneaux Europe/Paris, pseudo |
| `…120300_boosters.sql` | Aléa `pgcrypto`, portefeuille idempotent, crédits gratuits, boutique, ouverture atomique, album masqué et liste blanche des RPC |

### RPC disponibles pour un joueur connecté

| RPC | Effet |
|---|---|
| `get_player_state()` | Profil, solde, boosters (après rattrapage des créneaux 06 h / 18 h), offres et éditions ouvrables |
| `set_handle(p_handle)` | Pseudo unique, insensible à la casse |
| `buy_boosters(p_quantity, p_request_id)` | Achat de 1, 3 ou 10 boosters ; un même `p_request_id` ne débite qu'une fois |
| `open_booster(p_edition_id, p_request_id, p_pool?)` | Débit d'un booster (gratuits d'abord), tirage, 5 exemplaires, découvertes et récompense de découverte, historique. Un même `p_request_id` renvoie le même résultat, ce qui permet de reprendre l'animation après un rechargement |
| `get_opening(p_opening_id)` | Relecture d'une ouverture du joueur |
| `get_album(p_edition_id?)` | Album. Une carte non découverte ne renvoie que le code, le numéro, la rareté et la silhouette |

Le client doit générer `p_request_id` (`crypto.randomUUID()`) **avant** l'appel et le conserver tant que la réponse n'est pas reçue.

### Décisions techniques prises ici

- **Boosters non liés à une édition** : achetés comme gratuits, l'édition est choisie à l'ouverture. L'achat exige au moins une édition ouvrable, et l'ouverture revérifie l'édition choisie.
- **Ordre de consommation** : les boosters gratuits partent en premier, car ils sont plafonnés à 6 ; un appel peut forcer `p_pool`.
- **Poids des tirages** : entiers sur 100 000 (0,1 % = 100), pour éviter les flottants.
- **Booster de bienvenue** : `welcome_free_boosters` vaut **0** tant qu'une valeur n'est pas validée.
- **Crédits gratuits** : rattrapage à chaque appel de `get_player_state`/`open_booster`, ce qui couvre la règle « même hors connexion ». Un cron n'est pas nécessaire pour ce point.

## Tests

```bash
npm test
```

`tests/db/` charge les migrations dans **PGlite**, un PostgreSQL 18 embarqué. Ces tests ne nécessitent ni Docker ni réseau. `tests/db/supabase-stub.sql` reproduit le strict nécessaire de Supabase : rôles, `auth.users`, `auth.uid()` et droits par défaut. **Ce fichier n'est jamais appliqué sur Supabase.**

**Limite** : PGlite n'a qu'une connexion, donc les accès **réellement concurrents** n'y sont pas testés. Le comportement concurrent repose sur `SELECT … FOR UPDATE` du compteur de boosters et du portefeuille, plus les contraintes d'unicité. Il faudra le vérifier sur une vraie base, avec des appels parallèles sur le projet Supabase de dev (CDC §12, scénarios 4 à 6).

## Brancher le projet Supabase

1. Créer le projet (région UE), puis récupérer l'**URL** et la **clé anon** (*Project Settings → API*).
2. Créer `.env.local` à partir de `.env.example`. La clé `anon` est publique par nature ; ne jamais y mettre la clé `service_role`.
3. Appliquer les migrations, au choix :
   - avec la CLI, sans Docker : `npx supabase login`, `npx supabase link --project-ref <ref>`, puis `npx supabase db push` ;
   - à défaut : coller chaque fichier, dans l'ordre, dans le *SQL Editor*.
4. Désigner l'administrateur, une seule fois, depuis le SQL Editor :
   ```sql
   update public.profiles set role = 'admin' where id = '<uuid du compte>';
   ```
5. Activer les fournisseurs d'auth : e-mail (sans confirmation obligatoire, CDC §2), puis Discord (application Discord, puis client id et secret dans Supabase).

## Points ouverts

- Emplacements 1 à 4 : poids **provisoires** (`pack_rulesets` v1), à confirmer.
- Montants de bienvenue, de découverte (10) et de connexion quotidienne (25) : propositions du CDC, à paramétrer.
- Plan gratuit de Supabase : mise en pause après 7 jours d'inactivité et aucune sauvegarde exploitable. La sauvegarde quotidienne hors site sur 30 jours reste à construire (GitHub Actions + `pg_dump` chiffré vers un stockage externe).
