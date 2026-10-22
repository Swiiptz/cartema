# Cartema — consignes pour Claude

Jeu de cartes tarot gothiques **en production**, avec de vrais joueurs. Site statique Next.js sur GitHub Pages, toute la logique dans Supabase (Postgres). Lire d'abord **`docs/PASSATION.md`** : la section « État au … » donne ce qui reste à faire, et le §0 est le journal de tout ce qui a été livré.

## Travail avec l'utilisateur
- Tout en **français** : réponses, interface, messages d'erreur (`src/lib/game.ts`, `messages`), commentaires de code et messages de commit.
- L'utilisateur (Swiiptz) est l'unique administrateur. Il demande lui-même les commits, les pushes et l'application des migrations : ne pas le faire sans son accord.
- Le déploiement du site est **manuel**. L'utilisateur le lance depuis GitHub › Actions › « Déployer sur GitHub Pages ».
- Après chaque livraison, ajouter une ligne au §0 de `docs/PASSATION.md`, avec la migration concernée.

## Commandes (Windows)
- Node est dans `C:\Program Files\nodejs`. Il manque au `PATH` du shell bash : `export PATH="/c/Program Files/nodejs:$PATH"`.
- `npm test` : tests unitaires et tests SQL. PGlite rejoue toutes les migrations depuis zéro.
- `npx tsc --noEmit` puis `npm run build`. Si le build échoue sur `/_not-found`, arrêter le serveur de développement et supprimer `.next`.
- Aperçu local : `.claude/launch.json` (`npm run dev -- -p 3101`). Sans `.env.local`, le site tourne en mode démo, sans compte.
- Migrations : `npx supabase db push --dry-run`, vérifier la liste, puis `npx supabase db push --yes`. La CLI est déjà reliée au projet. `npx supabase db query --linked "select …"` permet de lire la base de production (lecture seulement). **Chaque appel coûte ~10 s de calcul à la base** (introspection des extensions, rôle de connexion) : jamais en rafale, regrouper les questions dans une seule requête. Une dizaine d'appels de suite a provoqué des timeouts le 22/10 vers 17 h 56.

## Règles base de données
- Ne **jamais** modifier une migration déjà appliquée. Créer un nouveau fichier `supabase/migrations/AAAAMMJJHHMMSS_nom.sql` et y recopier la fonction entière (`create or replace`).
- Changer la signature d'une fonction : faire `drop function` puis `create function`, et refaire les `revoke` et `grant` (modèle en fin de migration).
- Dans un `returns table (...)`, éviter les mots réservés de Postgres comme nom de colonne : `leading`, `real`, `position`…
- La base est petite (taille « nano »). Une fonction de lecture appelée souvent ne doit jamais écrire, verrouiller ou clôturer quoi que ce soit, ni recalculer un agrégat une fois par ligne. Calculer une seule fois, dans une CTE.
- Toute règle se vérifie côté serveur, avec un test dans `tests/db/`, à écrire avant de toucher au site.
- Une édition dont l'album n'est pas publié ne doit **rien** laisser voir aux joueurs : `tests/db/hidden-edition.test.ts` le vérifie, le compléter pour toute nouvelle lecture.

## Règles React
- Ne jamais mettre une fonction passée en ligne par le parent (`onDone`, `onError`…) dans les dépendances d'un `useEffect` ou d'un `useCallback` qui charge des données. La garder dans un `useRef`. C'est ce qui a saturé la base le 22/10.
- Un rafraîchissement lié au temps se déclenche une seule fois par échéance, jamais en boucle (voir `Countdown` dans `src/components/ui.tsx`).

## Pièges divers
- Les fichiers du dépôt sont en fins de ligne CRLF dans la copie de travail. Un script qui fait des remplacements doit normaliser en `\n`, puis réécrire dans le format d'origine.
- Le dépôt GitHub est **public** : aucune image ni aucun contenu d'une édition non annoncée dans `public/`. Les illustrations vont dans le stockage Supabase.
- Pas d'illustration générée par IA.
