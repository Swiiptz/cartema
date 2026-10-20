# CARTEMA — Direction artistique (référence pour Codex)

> Mise à jour du 20 octobre 2026 : ce document et la preview ci-dessous décrivent plusieurs étapes historiques. Pour la reprise, lire `PASSATION.md`, notamment les décisions graphiques actuelles (§4) et le statut de l’automatisation (§6). Le code actuel intègre les dernières demandes : Manrope pour l’interface, médaillon à la jonction portrait/cartouche, numéro discret en bas, nouveaux cadres animés, déchirure 3D et fondu des images. Ne pas rétablir un ancien rendu en portant la preview à l’identique.

**Référence visuelle : `docs/design/preview.html`** (ouvrir dans un navigateur, largeur mobile). Elle fait foi pour proportions, couleurs, ornements et animations. Porter son rendu dans les composants React ; ne pas le réinventer.

## Ce qui change par rapport au starter
1. **Plus de glyphes Unicode décoratifs** (❧ ✧ ❦ ◈ ☼) : remplacer par SVG. Les icônes de nav restent `lucide-react`, trait 1.5.
2. **Typographies** (Google Fonts, licence OFL, via `next/font/google`, auto-hébergées) : `Cinzel` 400/600/700 pour titres, noms, labels ; `Cormorant Garamond` 500/600 + italique pour le texte courant. Fallback Georgia. Fin de Georgia/system-ui.
3. **Tokens** (remplacer `:root` de `globals.css`) : `--bg #0d090f`, `--panel #1a1119`, `--panel2 #241520`, `--line #4a2a3a`, `--wine #6b1630`, `--gold #c9a45c`, `--gold2 #f0d79a`, `--text #f1e6d6`, `--muted #a8979f`. Ne pas descendre `--muted` en contraste (≥ 4,5:1 sur `--panel`).
4. **Panneaux** : dégradé 160° panel2→panel, bordure `--line`, **second filet or à 13 % d'opacité inset 4 px** (effet encadrement tarot). Rayon 14.
5. **Bouton primaire** : dégradé or #f0d79a→#b88a45, texte brun très sombre, ombre « épaisseur » `0 2px 0 #7a5a2a`, Cinzel 12 px capitales espacées 0,2em, hauteur ≥ 44 px. Variante `ghost` : filet or.
6. **Boosters gratuits** : afficher la réserve en **6 pastilles** (pleine = dégradé bordeaux + lueur, vide = filet or), plus un gros chiffre.
7. **Nav basse** : 5 onglets, libellés Cinzel 9 px capitales, zone tactile ≥ 44 px, `env(safe-area-inset-bottom)`. Desktop (≥ 930 px) : barre latérale (déjà prévue).
8. **Mobile** : conserver 2 colonnes d'album ≤ 639 px, 3 dès 640, 4 dès 1100.

## Anatomie de la carte (viewBox 200×300, composant `TarotCard` en SVG pur)
Ordre de rendu : fond dégradé → cadre extérieur (couleur rareté, 3 px) → filet or intérieur 0,8 px → **ornements de coin** → fenêtre portrait en **arche** (clip) avec fond radial, silhouette/portrait, rayons → médaillon de clan (cercle r17 centré en haut, anneau couleur rareté) → nom (Cinzel 600) → « clan · titre » (Cormorant italique) → gemmes ◆ + rareté en capitales → **numéro `PREFIXE-001` 7 px dans la bordure basse**.
- **Ornementation croissante** (`level` = index de rareté 0..6) : ≥2 second filet de coin ; ≥4 rosette + volutes ; ≥5 pointes de gravure ; **6 (Mythique) : rayons rayonnant derrière le portrait**. Gemmes : `ceil((level+1)/2)`.
- **Couleurs de rareté** : Commun #8d8a8f · Peu commun #5f9c7a · Rare #4a86c9 · Très rare #3fb0b8 · Épique #9b72e0 · Légendaire #e0b04a · Mythique #e0405f.
- **Finitions** (jamais seulement un badge) : *Dorée* = fond portrait doré + reflet de feuille (overlay `mix-blend-mode:color-dodge`, dégradé 115° animé 4 s) ; *Sanglante* = fond bordeaux profond + coulures SVG sous l’arche + reflet rouge. Libellé « DORÉE / SANGLANTE » à côté du numéro. Reflet désactivé si `prefers-reduced-motion`.
- **Inconnue** : silhouette sombre + « ? » or à 50 %, numéro et rareté visibles, **aucun nom ni portrait** (conforme CDC §3).
- **Médaillons de clan** : SVG originaux, gravure au trait 1,3 px or, dans un carré de 20 u centré en 0,0 (cf. `SIG` dans la preview : rose Toréador, griffe Gangrel, œil Malkavien, couronne Ventrue, « ? » inconnu). **Chaque clan ajouté par l’admin fournit un symbole SVG**, même contrainte de viewBox.
- **Silhouette** : buste + tête, plusieurs variantes dans `silhouettes` ; tirage unique par personnage puis persisté (`silhouette_key`). Prévoir ≥ 8 variantes (coiffes, capuche, couronne, voile…). Dans la preview il n’y en a qu’une.
- Ids de gradients/clip : **`useId()`** (le starter utilisait `card.id`, collisions si la même carte apparaît 2 fois).

## Révélation de booster
Dos de carte (losange + cadre) ; retournement 3D `rotateY(180°)` 0,8 s, `backface-visibility:hidden` ; l’ordre est choisi par le joueur ; **lueur `drop-shadow` de la couleur de rareté pour Épique+** ; bouton « Tout révéler » en cascade 180 ms. Son et particules désactivables, coupés par défaut ; `prefers-reduced-motion` → pas de rotation, fondu simple. Le tirage serveur est fini **avant** l’animation.

## Points d’attention détectés dans le starter (non esthétiques)
- Le CDC demande **Tailwind**, le starter n’en a pas : trancher (recommandé : garder les variables CSS ci-dessus, ajouter Tailwind seulement si Codex l’impose, sans dupliquer les tokens).
- `layout.tsx` : solde « 1 250 » codé en dur dans l’en-tête et `<a href="/">` au lieu de `Link`.
- `public/icon.svg` : pas d’icônes PNG 192/512 ni maskable ; Chrome/Android exigent des PNG pour l’installation → à générer.
- `sw.js` met `/` en cache : à retirer dès qu’il y a de l’auth (risque de page d’un autre compte hors ligne).
- `draw.ts` : `drawWeighted` revalide à chaque appel (ok) mais `rand` doit être remplacé par un RNG serveur (`crypto.randomInt`) ; `Number.EPSILON` dans la comparaison est inutile.
- Contraste : `.edition-number` et `.finish-stamp` à 8 px sont sous le seuil lisible ; la preview les passe à 7 px **mais en SVG mis à l’échelle** (≈ 9–10 px réels sur mobile) — vérifier à 360 px.
- Écrans **Marché** et **Profil** non redessinés dans la preview : appliquer les mêmes panneaux, boutons, chips et cartes ; la vitrine du profil = 5 cartes (1 grande + 4 petites).

---
## v3 — Carte gothique détaillée (remplace « Anatomie de la carte » ci-dessus là où elle diffère)
Source de vérité : fonctions `card`, `corner`, `rose`, `FIG`, `back` de `docs/design/preview.html`. À porter telles quelles en composants React/SVG.
- **Architecture** : fenêtre portrait en **arche ogivale** (pas un rectangle), **rosace** de vitrail derrière le personnage (3 cercles, 12 rayons, 12 perles), **deux piliers gothiques** à pinacle de chaque côté, fond **damassé** (motif losange), **ruban de titre** aux extrémités en V pour le nom, filets doubles, brume colorée au pied de la fenêtre, lune, étoiles.
- **Silhouettes** : 3 modèles dans la preview (encapuchonné, couronné à haut col, voilé) choisis par hash de l’id **puis persistés** (`silhouette_key`). Cible production : **≥ 12 modèles** ; les portraits importés remplacent la silhouette dans la même arche.
- **Progression par rareté** (`lv` 0→6) : 0 coins + filet ; 1 damassé renforcé + volutes ; 2 pointes dorées + **vignes à épines sur les piliers** ; 3 **ailes** de médaillon, chauve-souris, filet d’arche intérieur, gemme sur pinacle ; 4 rosettes de coin ; 5 gravures de coin + ailes détaillées ; 6 **halo + 18 rayons**. La rosace gagne en opacité avec la rareté.
- **Finitions** : Dorée (vitrail ambre + reflet de feuille), Sanglante (vitrail sang, **coulures sur l’arche**, reflet rouge).
- **Dos de carte / booster** : rosace dorée + losange bordeaux, damassé, coins niveau 4. Le booster est ce dos avec bandeau « CARTEMA ».
- Accueil : le bloc « boosters gratuits » est en **arche** (border-radius elliptique) ; fond de page damassé à 8 %.
- Prochaine étape recommandée côté assets : faire dessiner/valider une **bibliothèque de silhouettes et symboles de clan** (SVG, même viewBox) plutôt que d’étendre le code.
