# CARTEMA — base de projet pour Codex

**Reprise du projet : lire [la passation du 20 octobre 2026](docs/PASSATION.md)** (état réel, décisions graphiques actuelles, automatisation restante et plan d’implémentation).

PWA mobile-first, jeu de collection de cartes tarot gothiques. **Cette archive est un starter visuel et architectural, pas un jeu opérationnel** : les écrans utilisent des données fictives et aucune transaction réelle n'est activée. Le cahier des charges intégral est dans `docs/CAHIER_DES_CHARGES.md`.

## Démarrage

```bash
npm install
npm run dev
```

Ouvrir http://localhost:3000. Le starter contient un design responsive, 5 sections principales, une maquette de carte SVG/CSS, un manifeste PWA, un moteur de tirage pur testable, un schéma SQL d'amorçage et un guide Codex.

## Structure
- `docs/CAHIER_DES_CHARGES.md` : décisions métier + sécurité + tests
- `CODEX.md` : prompt de mission pour Codex
- `src/app` : pages Next.js App Router
- `src/components` : composants réutilisables
- `src/lib/draw.ts` : référence de probabilités, contrôles des distributions
- `supabase/migrations/` : schéma, RLS et fonctions transactionnelles (voir `docs/BACKEND.md`)
- `tests/db/` : tests d'intégration SQL sur PGlite
- `tests/draw.test.ts` : quelques tests unitaires de référence

## Important avant la production
1. Configurer une authentification réelle Supabase (email + Discord), RLS et autorisations côté serveur.
2. Implémenter les opérations de portefeuille/inventaire/enchères dans des transactions PostgreSQL atomiques, avec idempotence et journal complet.
3. Tester quotas, tâches d'expiration, sauvegardes hors site sur 30 jours et restauration ; gratuité non garantie.
4. Compléter l'import de Google Sheets après lecture réelle du fichier utilisateur (aucune donnée réelle n'est fournie dans cette archive).
5. Les probabilités des positions 1 à 4 sont **provisoires** ; la 5e position et les finitions sont validées.
6. Les images et icônes décoratives du starter sont des éléments CSS/SVG génériques ; remplacer avec tes assets licenciés.
## Atelier visuel — octobre 2026

L’accueil, l’album et `/boosters` appliquent la direction artistique de `docs/DESIGN.md`. La mise en scène du paquet s’inspire de https://kyara.games/ouvrir/daily : objet central, halo, ouverture puis révélation libre des cartes. Les règles de Kyara ne sont pas reprises.

- Illustration Alhoon : `public/illustrations/alhoon.png`, original conservé. Son clan et sa rareté ne sont pas confirmés : le cadre bleu est un exemple d’habillage.
- Les prochains portraits se branchent avec le champ `illustration` d’une carte, chemin local `/illustrations/...`. Cadres et finitions restent séparés des fichiers d’origine.
- Gravures SVG reprises de la référence locale dans `src/components/tarot-renderer.js`. `Card.tsx` échappe les données et génère des identifiants SVG uniques.
- Ouverture de démonstration à cinq cartes fixes, sans débit de réserve, tirage aléatoire, persistance ni ajout d’inventaire. Aucune opération économique n’est simulée comme réelle.
- Son désactivé initialement, effets réglables, réduction des animations et parcours clavier pris en charge.
- Polices chargées par `next/font/google` puis auto-hébergées ; le premier build nécessite un accès à Google Fonts.

Vérifier avec `npm test` et `npm run build`, puis lancer `npm run dev`. Le backend du cahier des charges reste à implémenter.

### Nouvelle composition des cartes

Les cartes utilisent désormais une fenêtre de portrait presque pleine hauteur, un numéro discret dans la bordure basse et un médaillon à la jonction du portrait et du cartouche. Les ornements d’acanthe et d’épines suivent le bord ; les métaux, gravures et halos évoluent selon la rareté. Nom, clan et fonction ont chacun leur ligne. Le cadrage des illustrations privilégie le haut du personnage, sans modifier le fichier original. Dans l’album, cliquer une carte ouvre son détail via un dialogue natif, refermable avec Échap. Les personnages sans illustration conservent une silhouette de présentation.

### Album et interface mobile

L’interface utilise Manrope pour les commandes et textes courants ; Cinzel et Cormorant restent dans les titres et les cartes. Les boutons principaux font au moins 52 px de haut, les contrôles de filtre au moins 44 px, et les champs de recherche mobiles utilisent 16 px. L’album conserve deux colonnes sur petit écran, trois dès 640 px, quatre dès 1100 px. Les filtres clan/rareté/finition se combinent avec le statut de découverte, une recherche insensible aux accents et le tri réversible. Les identités inconnues restent exclues des recherches par nom/clan et des filtres de clan. La progression affichée provient uniquement des cartes de démonstration.

### Illustrations Rus et Norton

Rus correspond à la première illustration fournie, Norton à la seconde. Les PNG originaux sont conservés sous `public/illustrations/originals/`. Les WebP d’affichage sont redimensionnés à 900 px de large sans recadrage ni modification créative. Rus utilise `artLayout: 'cover'` avec un décalage vertical pour remplir la fenêtre du portrait en conservant son orientation inversée ; Norton garde le cadrage portrait. `provisional: true` indique que clan et rareté ne sont pas encore validés : le cadre est un aperçu et ces cartes ne correspondent à aucun filtre de rareté officielle. Le fondu des bords est appliqué automatiquement par le moteur SVG à toutes les illustrations, indépendamment de la finition. Il suit la fenêtre de cadrage et ses décalages ; aucun réglage de fondu par personnage n’est nécessaire. Les originaux sont archivés sans lien dédié dans l’interface.
