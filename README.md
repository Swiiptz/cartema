# CARTEMA

Jeu de collection de cartes tarot gothiques (Vampire), en PWA mobile-first. Site statique sur GitHub Pages, logique de jeu dans Supabase (Postgres, RLS, fonctions transactionnelles, tâches pg_cron).

**Reprise du projet : lire [la passation](docs/PASSATION.md)** (journal de tout ce qui est livré, état par module, mise en production, décisions graphiques, points ouverts).

## Démarrage

```bash
npm ci
cp .env.example .env.local   # URL et clé publique Supabase
npm run dev                  # http://localhost:3000
```

Sans `.env.local`, le site s'ouvre en mode aperçu avec des cartes de démonstration.

## Vérifier

```bash
npm test          # tests unitaires et tests SQL (PGlite rejoue toutes les migrations)
npx tsc --noEmit
npm run build     # export statique dans out/
```

Les mêmes vérifications tournent sur GitHub à chaque push (`.github/workflows/tests.yml`).

## Mettre en production

1. `npx supabase db push --dry-run`, puis `npx supabase db push` (migrations).
2. GitHub › Actions › « Déployer sur GitHub Pages » › Run workflow.

## Structure

- `supabase/migrations/` : schéma, RLS et toute la logique métier (voir `docs/BACKEND.md`)
- `src/app/` : pages (accueil, collection, boosters, marché, progression, profil, amis, admin…)
- `src/components/` : composants, rendu SVG des cartes (`tarot-renderer.js` et cadres de finition)
- `src/lib/game.ts` : types des réponses, appels RPC et messages d'erreur
- `tests/db/` : tests SQL par module
- `docs/` : passation, cahier des charges, backend, sauvegardes, design
