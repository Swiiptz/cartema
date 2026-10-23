# Cartema — consignes pour les agents (Codex, Claude…)

Jeu de cartes tarot gothiques **en production**, avec ~150 joueurs réels. Site statique Next.js sur GitHub Pages, toute la logique dans Supabase (Postgres : RLS, fonctions `security definer`, pg_cron). Chaque migration touche des données vivantes.

**Lire d'abord `docs/PASSATION.md`** : la section « État au … » dit ce qui est en ligne, ce qui reste à faire et les mécanismes à connaître ; le §0 est le journal de tout ce qui a été livré, avec la migration de chaque livraison. `CODEX.md` est la mission d'origine (construire le jeu) : elle est terminée, ne pas la reprendre telle quelle.

## Travailler avec l'utilisateur

- Tout en **français** : réponses, interface, messages d'erreur (`src/lib/game.ts`, `messages`), commentaires de code, messages de commit.
- L'utilisateur, **Swiiptz**, est l'unique administrateur. Il décide des règles du jeu ; proposer, puis attendre son choix quand une règle de jeu change (taux, récompenses, ce qui se perd ou non).
- **Ne jamais appliquer une migration, commiter ou pousser sans son accord explicite.** Il répond d'habitude « Oui : applique la migration, commite et pousse. ». Préparer tout le reste (tests, build, dry-run), puis demander.
- Le déploiement du site est **manuel** et fait par lui : GitHub › Actions › « Déployer sur GitHub Pages ». Toujours lui rappeler ce qui attend un déploiement, et dans quel ordre (migration d'abord, site ensuite).
- Expliquer simplement, avec des chiffres quand il s'agit de taux ou d'économie (il demande souvent « 10 ou 20 ? », « t'es sûr ? »). Recommander une valeur, ne pas lister toutes les options.
- Après chaque livraison, ajouter une ligne au §0 de `docs/PASSATION.md` (date, migration, tests concernés, ce qui change). Mettre à jour la section « État au … » quand l'état change nettement.

## Commandes (Windows)

- Node est dans `C:\Program Files\nodejs` ; dans un shell bash : `export PATH="/c/Program Files/nodejs:$PATH"`.
- `npm test` : tests unitaires + tests SQL (PGlite rejoue **toutes** les migrations depuis zéro). Puis `npx tsc --noEmit` et `npm run build`. Si le build échoue sur `/_not-found` : arrêter le serveur de dev et supprimer `.next`.
- Aperçu local : `npm run dev` (lit `.env.local`, donc la vraie base : ne rien déclencher qui écrive, comme ouvrir un booster). Sans `.env.local`, mode démo. `/boosters/?god` rejoue l'animation du God booster sans appel serveur (en dev seulement).
- Migrations : `npx supabase db push --dry-run` (vérifier la liste), puis, après accord, `npx supabase db push --yes`.
- Lecture de la base de production : `npx supabase db query --linked "select …"`. **Chaque appel coûte ~10 s de calcul à la base : jamais en rafale.** Regrouper toutes les questions dans une seule requête (`jsonb_build_object` de sous-requêtes). Lecture seulement. Une dizaine d'appels de suite a provoqué des timeouts le 22/10.

## Base de données

- **Ne jamais modifier une migration déjà appliquée.** Nouveau fichier `supabase/migrations/AAAAMMJJHHMMSS_nom.sql`, avec la fonction recopiée **entière** (`create or replace`) depuis sa **dernière** version : `grep -ln "function public.nom(" supabase/migrations/*.sql | sort | tail -1`. Une migration pas encore appliquée peut être corrigée.
- Changer la signature d'une fonction : `drop function` puis `create function`, et refaire `revoke` / `grant`. Nouveaux paramètres **en dernier, avec une valeur par défaut** (`null` = inchangé) : le site déjà en ligne doit continuer de fonctionner tant qu'il n'est pas redéployé.
- Dans un `returns table (...)`, éviter les mots réservés comme noms de colonne (`leading`, `real`, `position`…).
- La base est petite. Une fonction de lecture appelée souvent (`get_player_state`, `get_market_board`…) ne doit jamais écrire, verrouiller ou clôturer quoi que ce soit, ni recalculer un agrégat par ligne : calculer une fois, dans une CTE. Exception assumée : `get_player_state` donne le bonus quotidien et compte la série de connexions, une fois par jour, sans verrou si déjà fait.
- Toute règle se vérifie **côté serveur, avec un test dans `tests/db/`, écrit avant de toucher au site**. Helpers dans `tests/db/harness.ts` (`createDb`, `createUser`, `rpc`, `seedEdition`, `expectError`, `credit`).
- Une édition dont l'album n'est pas publié ne doit **rien** laisser voir : compléter `tests/db/hidden-edition.test.ts` pour toute nouvelle lecture.
- Réglages d'économie (`economy_settings`, versionnés) : une clé nouvelle s'ajoute à `private.validate_settings` et à `public.admin_save_settings`, avec une nouvelle version active insérée par la migration (voir `20261023210000_rarity_pity.sql`).

## Site (React / Next.js)

- Ne jamais mettre une fonction passée en ligne par le parent (`onDone`, `onError`, `refreshPlayer`…) dans les dépendances d'un `useEffect` ou `useCallback` qui charge des données : la garder dans un `useRef`. C'est ce qui a saturé la base le 22/10.
- Un rafraîchissement lié au temps se déclenche une fois par échéance, jamais en boucle (`Countdown` dans `src/components/ui.tsx`).
- Styles : fichier unique `src/app/globals.css`. Ajouter les nouveaux blocs **à la fin**, avec un commentaire daté.
- Mobile d'abord : tester à 360–375 px, **aucun débordement horizontal** (`document.documentElement.scrollWidth` doit égaler la largeur). Sur téléphone, éviter les animations infinies coûteuses (ombres ou filtres animés, flou d'arrière-plan sur un élément fixe, très grands calques qui tournent).
- Types des réponses RPC et appels : `src/lib/game.ts` (`callRpc`).

## Pièges

- Les fichiers du dépôt sont en fins de ligne **CRLF**. Un script qui fait des remplacements doit normaliser en `\n`, remplacer, puis réécrire au format d'origine. Vérifier que chaque motif remplacé apparaît exactement une fois.
- Le dépôt GitHub est **public** : aucune image ni aucun contenu d'une édition non annoncée dans `public/`. Les illustrations vont dans le stockage Supabase.
- **Pas d'illustration générée par IA.**
- `private.pick_weighted` exige des tables de poids qui totalisent 100 000.
- Les succès « perdables » (lignées, camps) vivent dans `lineage_holds`, pas dans `achievement_unlocks` : penser aux deux quand on lit « ce que le joueur a obtenu » (titre, profil, mise en avant).
