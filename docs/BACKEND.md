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
5. Configurer l'auth (*Authentication*) :
   - **URL Configuration** : *Site URL* = `https://<compte>.github.io/<dépôt>/`. Dans *Redirect URLs*, ajouter `http://localhost:3000/connexion/` et `https://<compte>.github.io/<dépôt>/connexion/`.
   - **E-mail** : désactiver *Confirm email*, car le CDC §2 autorise un e-mail non vérifié. Si l'option reste active, l'inscription affiche « confirmez votre adresse ».
   - **Discord** : créer une application sur discord.com/developers. Lui donner comme redirect `https://<ref>.supabase.co/auth/v1/callback`, puis reporter le client id et le secret dans Supabase.
   - **Liaison d'identités** : activer *Allow manual linking*, nécessaire pour le bouton « Lier mon compte Discord ».

## Front branché

- `src/lib/supabase.ts` : client navigateur, en flux PKCE. Sans variables d'environnement, le site reste en **mode aperçu** avec les données de démonstration, signalé comme tel.
- `src/components/AuthProvider.tsx` : session, puis `get_player_state` au chargement et après chaque opération.
- `/connexion/` :
  - e-mail et mot de passe ;
  - Discord ;
  - choix du pseudo ;
  - liaison d'un compte Discord ;
  - déconnexion.
- `/boosters/` :
  - réserve réelle et choix de l'édition ;
  - boutique avec confirmation avant achat ;
  - ouverture serveur : l'animation attend la réponse et révèle les cartes réellement tirées.
- **Reprise d'une ouverture interrompue** : la clé de requête est conservée en `sessionStorage`. Après une coupure réseau ou un rechargement, « Déchirer le booster » rejoue la même clé : le serveur renvoie le même tirage, sans débiter de nouveau. Un refus métier (plus de booster, édition incomplète) abandonne la clé.
- `/collection/` :
  - album servi par `get_album`, avec le nombre d'exemplaires possédés ;
  - filtre de finition selon les finitions réellement obtenues ;
  - filtre d'édition dès qu'il en existe plusieurs.

## Back-office (`/admin/`)

Migration `…150000_admin.sql`. Les RPC `admin_*` exigent `private.require_admin()` : compte connecté, rôle `admin`, non suspendu. Chaque écriture ajoute une ligne à `admin_audit_logs` (état avant et après).

| RPC | Effet |
|---|---|
| `admin_catalog()` | Éditions, avec complétude par rareté, clans, et tous les personnages, brouillons compris |
| `admin_save_edition` | Crée ou modifie une édition (nom, préfixe figé dès la 1ʳᵉ carte, publication de l'album) |
| `admin_set_packs(edition, actif, motif)` | Active ou suspend les boosters. **Motif obligatoire.** Refusé si l'une des 7 raretés manque |
| `admin_archive_edition(edition, motif)` | Archive l'édition et arrête ses boosters. Jamais de suppression |
| `admin_save_clan` | Crée ou renomme un clan. Les clans Toréador, Gangrel, Malkavien, Ventrue, Tremere, Brujah et Nosferatu ont déjà un symbole gravé |
| `admin_save_character` | Crée un personnage, toujours en brouillon, ou le corrige. Numéro, rareté et édition restent figés |
| `admin_set_character_status(id, statut, motif)` | Publie ou archive. **Motif obligatoire.** Une carte publiée ne revient jamais en brouillon |

**Désigner l'administrateur** : une seule fois, en SQL, avec une ligne `admin_provision` dans le journal. Fait le 20/10/2026 pour Swiiptz sur le projet de dev.

**Illustrations** : bucket Storage `illustrations`.
- Lecture publique. Écriture, modification et suppression réservées à l'admin, par politique sur `storage.objects`.
- 15 Mo maximum, formats PNG, WebP et JPEG.
- Le navigateur vérifie que le fichier est bien une image décodable d'au moins 200 px. Il détecte la transparence et les dimensions, envoie l'**original intact** dans `originals/` et une **version d'affichage WebP de 900 px** dans `display/`, sans recadrage.
- Le **cadrage par défaut est automatique** : détouré → portrait ; opaque de proportion classique → portrait ; opaque très vertical (≥ 1,8) ou paysage → remplissage. L'admin peut le corriger avec aperçu en direct, et dans les trois finitions, avant de publier.
- Le chemin enregistré est vérifié côté serveur : stockage du projet ou `/illustrations/` uniquement.

Pas encore fait : import Google Sheets, couverture d'édition, symboles de clan personnalisés (téléversés), outils économiques (ajout ou retrait de boosters et de Deniers, réglages versionnés), modération.

## Développement et déploiement

```bash
cp .env.example .env.local
npm run dev
```

Après avoir rempli `.env.local` avec l'URL et la clé publique, ouvrir http://localhost:3000.

**Ne pas lancer `npm run build` pendant que `npm run dev` tourne** : les deux partagent `.next/` et le serveur de dev se met à renvoyer des 404. En cas de souci, arrêter le serveur, supprimer `.next/`, relancer.

- `npm run build` produit le site statique dans `out/`. `npm run start` le sert sur le port 3101.
- **Déploiement manuel** : `.github/workflows/deploy-pages.yml`, à lancer depuis l'onglet *Actions*. Le workflow exécute les tests, le build avec `NEXT_PUBLIC_BASE_PATH` fourni par GitHub Pages, puis la publication. Les prérequis sont indiqués en tête du fichier.
- **Retour arrière** : relancer le workflow sur un commit antérieur. Les migrations de base, elles, ne se défont pas automatiquement : écrire une migration corrective.

## Points ouverts

- Emplacements 1 à 4 : poids **provisoires** (`pack_rulesets` v1), à confirmer.
- Montants de bienvenue, de découverte (10) et de connexion quotidienne (25) : propositions du CDC, à paramétrer.
- Plan gratuit de Supabase : mise en pause après 7 jours d'inactivité et aucune sauvegarde exploitable. La sauvegarde quotidienne hors site sur 30 jours reste à construire (GitHub Actions + `pg_dump` chiffré vers un stockage externe).
