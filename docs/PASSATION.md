# CARTEMA — État des lieux et passation

Date : 20 octobre 2026 · état constaté dans le code local.

## 0. Avancement depuis la passation

- 20/10/2026 : Git initialisé. Architecture retenue : site statique GitHub Pages + Supabase, logique métier en fonctions Postgres. Première tranche backend livrée et testée sur PGlite (schéma, RLS, crédits Paris, boutique, ouverture atomique, album masqué) : voir `BACKEND.md`.
- 20/10/2026 (suite) : export statique (`output: 'export'`, basePath Pages), client Supabase, `/connexion/` (e-mail, Discord, pseudo, liaison), `/boosters/` et `/collection/` branchés sur les RPC, mode aperçu conservé sans configuration, SW enregistré avec chemins relatifs, workflow manuel GitHub Pages. Non vérifié contre un vrai projet Supabase (aucun n’était relié). `next start` n’existe plus : `npm run start` sert `out/`.
- 20/10/2026 (soir) : projet Supabase de dev `grlpysqlabwylexinbrl` relié (CLI dans les devDependencies, `supabase/config.toml`). Migrations et réglages d'auth appliqués (`npx supabase db push`, `npx supabase config push`). Édition d'ESSAI (7 cartes fictives, `supabase/dev/edition-essai.sql`) active. Vérifié sur la vraie base : droits anon refusés, deux ouvertures simultanées avec 1 booster → une seule réussite, ouverture de bout en bout par un joueur (5 exemplaires, découvertes, récompenses, ledger égal au solde). Discord pas encore configuré, aucun administrateur désigné, site pas encore publié sur Pages.
- 20/10/2026 (soir, suite) : révélation en pile par rareté croissante (voir §4). Back-office `/admin/` livré (éditions, clans, personnages, publication motivée, activation des boosters, upload d'illustrations avec original conservé et cadrage automatique), migration `…150000_admin.sql` appliquée, Swiiptz désigné administrateur. Reste : import Sheets, couvertures, outils économiques/modération.
- 20/10/2026 (nuit) : import du Google Sheets → 230 brouillons dans Camarilla (CAM). Caïn (« One ») écarté : **nouvelle mécanique demandée — carte unique, un seul exemplaire dans tout le jeu, palier de rareté propre** ; règles à définir (taux, emplacement, échange possible ?). Morgan sans rareté écarté. Outils ajoutés : association d’illustrations par nom de fichier, publication groupée des brouillons.
- **Carte unique Caïn (règles validées par l’utilisateur le 20/10/2026)** : migration `…170000_unique_card.sql`. CAM-001, `is_unique`. Une chance sur 10 000 par booster CAM (`pack_rulesets.unique_odds`, figé par version), à la place de la 5e carte ; un seul exemplaire dans tout le jeu (`unique_drops` + trigger) ; échangeable/vendable mais indestructible (recyclage interdit par trigger) ; tirage secret (registre sans accès joueur, aucune annonce) ; hors des 7 raretés obligatoires (rareté interne Mythique, affichée « Unique ») ; révélée en dernier. Créée en brouillon. **Habillage propre** (`src/components/unique-frame.js`) : seule carte claire du jeu — papier d’os vieilli à grain et bords brûlés, encre de l’illustration multipliée sur le papier (le fond blanc disparaît), lumière pâle centrale, lueur de sang dans l’ombre ailée, cadre obsidienne/argent oxydé à angles acérés, fil pourpre animé, Marque de Caïn (signe original) au médaillon, traînées d’encre prolongeant la diagonale du dessin, « UNIQUE · I / I ». Illustration : `public/illustrations/CAM/CAM-001.webp` (original intact : `public/illustrations/CAM/originals/CAM-001.webp`, 575 × 863, fourni sous le nom `cainl.webp`). Inconnue, la carte garde le voile commun avec la mention UNIQUE.

- 20/10/2026 (fin de soirée) : refonte de l’interface (accueil tableau de bord, boosters avec réserve et ouverture multiple, profil fusionné avec le compte, transitions et animations), révélations rares (effet plein écran Légendaire/Mythique/unique, effet discret Dorée/Sanglante), symboles des 7 clans manquants, logo « Vampiric Boosters ».
- Économie et échanges livrés et testés (migrations `…180000` à `…210000`) : recyclage et verrouillage, bonus quotidien 25 Deniers, marché à prix fixe (commission 5 % floor), enchères (séquestre, paliers, anti-sniping 2 min, clôture pg_cron chaque minute), amis, cadeaux (48 h, proposition non validée) et échanges entre amis (10 cartes, Deniers, contre-propositions, 48 h). Règle des 24 h appliquée à toutes les transactions entre joueurs. **Décisions à confirmer** : annonces du marché montrées en clair ; échanges limités aux amis (pas encore de réglages de confidentialité) ; durées d’expiration cadeaux/échanges 48 h.
- Progression (migration `…220000_progression.sql`) : 3 missions quotidiennes (06 h Paris) et 3 hebdomadaires (lundi 06 h), avancement calculé depuis les données réelles, 1 remplacement gratuit par jour, missions impossibles exclues ; succès par **édition** générés automatiquement (chaque clan complet, chaque rareté complète, toutes les cartes → titre « Maître de … »), succès **personnalisés** (conditionnels sur un groupe de personnages, ex. « LES BRATS!! » = Sirius + Wezen, ou décernés à la main avec motif, explication révélée après déblocage), succès généraux et secrets ; titres portés ; classement historique des découvertes. Montants et seuils = propositions à valider.
- Navigation : **6 onglets** (Accueil, Collection, Boosters, Marché, Progrès, Profil) au lieu des 5 du CDC §1, à la demande de l’utilisateur (accès clair aux missions, succès et classement) ; pastilles : missions à réclamer (Progrès), invitations/cadeaux/échanges (Profil). Succès en catégories repliables ; les conditionnels secrets apparaissent comme « succès secret ».
- Équilibrage validé par l’utilisateur (migration `…240000_balance.sql`) : 3 boosters de bienvenue (réglages économiques v2) ; récompenses de collection proportionnelles (clan : 10 Deniers par carte, min. 50 ; rareté : 3/5/10/20/30/60/200 par carte, +1 booster pour Légendaires et Mythiques) ; **classement par nombre de succès puis par personnages découverts** (écart au CDC §7 décidé par l’utilisateur). Analyse : ~480 Deniers/jour pour un joueur actif (~3 boosters/jour), recyclage d’un booster ≈ 145 Deniers (29 % du prix), Mythique précise ≈ 4 000 boosters (taux CDC conservé).
- Reste au CDC : notifications internes et préférences, vitrine de 5 cartes et confidentialité, événements, outils admin économiques et modération, statistiques, sauvegardes hors site.
- 20/10/2026 (nuit, suite) : migration `…250000_achievement_tiers.sql`. **Succès à paliers** (`series`, `series_label`, `tier`) : Rituels, Visages découverts, Éclats d’or, Sang versé, Négoce, Coterie, Pactes, affichés en une carte (médaille Bronze/Argent/Or/Platine, jalons, bulle listant chaque palier) ; chaque palier reste un succès distinct pour le total et le classement ; gold_10 et blood_3 ne sont plus secrets. **Récompenses relevées** (demande : généreux sans abus) : clan = 25 Deniers/carte et 1 booster par tranche de 5 cartes, rareté = barème par carte + boosters, édition complète 8 000 + 12 boosters ; succès sociaux plus modestes (comptes secondaires). **Missions** : bonus 1 booster quand les 3 quotidiennes sont réclamées, 4 pour les hebdomadaires (`mission_bonuses`, réglages `mission_bonus_daily/weekly`) ; « Venir 5 jours » fixe et non remplaçable ; hebdomadaires plus longues (gros volumes ou jours différents, journée de jeu 06 h–06 h via `private.game_day`) ; catalogue élargi (Très rare, Épique, mises en vente, enchères, achats, échanges).
- 20/10/2026 (nuit, fin) : migration `…260000_secret_chronicle.sql`, 7 succès secrets de chronique : Pigeons voyageurs (Gwen de Quéribus, Isabeau de Marnay, Ganord, Rosana, Ary, Alaric Draven), LES BRATS!!! (Sirius, Wezen), Le Notred (Lys, Perrette, Werner Le Nôtre), De Marnayed (Isabeau, Lara de Marnay), « Le gars a pas compris le principe du jeu » (mesure `recycle_all` : chaque carte publiée hors Caïn recyclée au moins une fois), « Soutien de la première heure » (`early_supporter` : compte créé avant le 21/11/2026 00 h Paris), « Actually 🤓 » (manuel, à décerner depuis l'admin). Les groupes sont figés à la création : un nouveau Le Nôtre ou De Marnay doit être ajouté au succès depuis l'admin. Les succès manuels secrets s'affichent désormais comme « succès secret ». Rangement (`…270000_secret_placement.sql`) : un succès personnalisé rattaché à une édition (`edition_id`) s'affiche dans son set (sous-groupes Personnages / Secrets) ; un secret personnalisé sans édition va dans les secrets généraux ; la chronique ne garde que les succès personnalisés visibles.
- 20/10/2026 (nuit, fin) : **profil public et vitrine** (migrations `…280000` à `…300000`). Page `/joueur/?h=pseudo` (liens depuis le classement et la liste d'amis) : titre, ancienneté, lien d'amitié (ajout direct), 3 succès favoris, vitrine de 5 cartes cliquables (fiche en lecture seule), statistiques (rang, succès, visages des éditions actives, finitions), derniers succès non secrets. Profil : choix de la vitrine (`set_showcase`, un exemplaire par personnage et finition, éditions archivées exclues), des succès favoris (`set_featured_achievements`, 3 max, débloqués, visibles même en privé comme le titre), confidentialité (`set_privacy` : public / amis / privé, statistiques masquables). Un exemplaire cédé ou recyclé sort de la vitrine.
- 20/10/2026 (nuit, fin) : **outils admin « Joueurs »** (`…310000_admin_players.sql`, onglet Joueurs du back-office). Recherche, fiche (e-mail, soldes, collection, 30 derniers mouvements de Deniers, boosters reçus, journal d'administration), ajustement de Deniers et de boosters achetés (motif obligatoire, idempotent, jamais sous zéro), suspension (bloque toute action ; ventes sans offre retirées, enchères disputées menées à terme), blocage du marché / des échanges, réinitialisation d'un pseudonyme. L'administrateur ne peut pas se sanctionner. Les succès personnalisés automatiques (recyclage, ancienneté) n'ont plus de bouton « Décerner ». Accueil visiteur : Norton remplacé par une carte voilée (seul autre dessin disponible : Caïn, à ne pas dévoiler).
- 20/10/2026 (nuit, fin) : **notifications** (`…320000_notifications.sql`). Table `notifications` remplie par déclencheurs (amis, cadeaux, échanges et contre-propositions, vente conclue, enchère dépassée / remportée / close sans offre, succès débloqué) via `private.notify`, qui respecte les préférences par catégorie (`profiles.notification_prefs` : friends, social, market, achievements). RPC `get_notifications`, `get_unread_count`, `mark_notifications_read`, `set_notification_prefs`. Cloche dans l'en-tête (pastille rafraîchie à chaque page, chaque minute et au retour sur l'onglet ; ouvrir le panneau marque tout comme lu), préférences dans Profil › Paramètres. Lues purgées après 60 jours. Pas de notification push hors du site (non demandé).
- 20/10/2026 (nuit, fin) : **événements** (`…330000_events.sql`, onglet admin Événements, bannière sur l'accueil et Boosters). Effets entre début et fin : finitions rares ×1–×5 (table figée intacte, `pack_openings.event_id`), Deniers ×1–×3 (connexion, missions), boosters offerts une fois (`claim_event_bonus`), boosters gratuits toutes les N h (1–12 h, alignés sur 06 h, réserve de 6). Chevauchement : multiplicateur max, intervalle le plus court. Création / modification / annulation avec motif au journal. **Non vérifié dans le navigateur** (tests SQL OK).
- 21/10/2026 : **import d'illustrations par dossier** : déposer les images nommées comme les personnages dans `illustrations/` (racine = CAM, sous-dossier = préfixe d'une autre édition ; dossier ignoré par Git), puis `npm run illustrations` (`npm run illustrations:essai` pour voir les correspondances sans rien envoyer ; sous PowerShell `-- --essai` est aussi reconnu). Même traitement que le back-office (original intact + WebP 900 px, cadrage par défaut, journal d'administration), via la CLI Supabase liée (`sharp` en devDependency). Les fichiers traités sont rangés dans `illustrations/importees/`. Violette (CAM-011) et Yana (CAM-157) importées ainsi.
- 21/10/2026 : **icônes PWA** générées par `npm run icons` (`scripts/icons.mjs`, depuis un seul SVG : losanges dorés du logo et point de sang) : `icon.svg`, `icon-192/512.png`, `icon-maskable-192/512.png` (zone sûre 80 %), `apple-touch-icon.png`, `favicon-48.png`. Manifeste complété (id, orientation portrait, catégories, raccourcis Boosters / Collection / Progrès), métadonnées iOS (plein écran, barre d'état translucide, marge de sécurité en mode installé), service worker v3.
- 21/10/2026 : **lenteurs** mesurées : côté base tout prend quelques ms (album 9 ms, recyclage 4 ms) ; le premier appel après une période calme met ~3 s (réveil du projet Supabase gratuit), les suivants ~0,14 s. Correctifs : album de la collection gardé en mémoire (retour instantané, mise à jour en arrière-plan), `TarotCard` mémorisé (SVG recalculé seulement si la carte change), cartes hors écran non peintes (`content-visibility`), rechargements parallèles après recyclage / verrouillage, délai maximal de 20 s par requête (message au lieu d'un chargement sans fin).
- 21/10/2026 : **encart d'installation** sur l'accueil (joueur et visiteur), téléphone seulement et masqué une fois l'app installée (`display-mode: standalone`) ou fermé (mémorisé sur l'appareil). Android / Chrome : bouton « Installer » (invite native captée dès le chargement, `src/lib/install.ts`) ; iPhone et autres : étapes expliquées (Partager › Sur l'écran d'accueil).
- 21/10/2026 : **statistiques admin** (`…100000_admin_stats.sql`, onglet Statistiques, `src/components/admin/StatsTab.tsx`) : période 7 / 30 / 90 j ; tuiles (inscrits, actifs du jour / 7 j via le bonus de connexion, boosters ouverts et en réserve, Deniers en circulation / créés / dépensés, ventes, finitions rares, Caïn tiré ou non) ; colonnes journalières (ouvertures, actifs, inscriptions) avec infobulle et tableau dépliable ; répartition des raretés tirées et des sources de Deniers ; communauté et derniers inscrits. **Filtres des personnages** (Admin › Personnages) : rareté, clan (ou sans clan), illustration (sans / avec, avec compteur), recherche par nom ou numéro.
- 21/10/2026 : **sauvegardes quotidiennes** (`.github/workflows/backup.yml`, procédure dans `docs/SAUVEGARDES.md`) : pg_dump 17 via le *session pooler* (IPv4), schémas public / private / auth / storage (sans sessions ni journaux d'auth), contrôle des tables principales, chiffrement AES-256 (gpg, `BACKUP_PASSPHRASE`) car le dépôt est public, artefact gardé 30 jours. Secrets à créer par l'administrateur : `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`. Les images du stockage ne sont pas sauvegardées (originaux dans `illustrations/importees/`).
- 21/10/2026 : **liste de souhaits** (`…110000_wishlists.sql`, `src/components/Wishes.tsx`). Souhait par numéro de carte (« CAM-097 »), toute finition ou Dorée / Sanglante précise, jamais la carte unique, 60 au plus ; carte non découverte voilée. Fiche de carte : « Je cherche cette carte » ; album : cœur sur les cartes souhaitées ; profil : liste avec annonces en cours et meilleur prix, amis qui en possèdent un exemplaire disponible (sauf profils privés), retrait ; profil public : liste selon la visibilité. Alerte « carte souhaitée en vente » à chaque nouvelle annonce (catégorie Marché, finition respectée).
- 21/10/2026 : **réglages économiques en admin** (`…120000_admin_economy.sql`, onglet Économie, `src/components/admin/EconomyTab.tsx`). Réglages (prix des lots, bonus de connexion, découverte, bienvenue, réserve gratuite, bonus de missions, commission, recyclage, multiplicateurs de finitions) : clés connues seulement, plages contrôlées, nouvelle version active à chaque enregistrement. Tirage (pondérations des 5 emplacements, finitions, chance de Caïn) : nouvelle table versionnée, sommes et raretés contrôlées par le garde-fou existant, ouvertures passées liées à leur version. Récapitulatif des changements, motif obligatoire, journal avant / après, historique des versions.
- 21/10/2026 : **signalements et cartes en admin** (`…130000_moderation_cards.sql`). Joueurs : bouton « Signaler » sur le profil public (motif + message, confidentiel, un signalement ouvert par couple, 5 par jour), l'administrateur est notifié (catégorie modération, toujours active). Admin : onglet Signalements (ouverts / tous, traité ou classé sans suite avec note journalisée) ; dans la fiche joueur, don de cartes (personnage, finition, 1 à 20, découverte sans récompense, idempotent) et retrait d'exemplaires libres (marqués `removed_at`, sans Deniers, exclus du succès de recyclage, retirés de la vitrine). Carte unique jamais donnée ni retirée.
- 21/10/2026 : **versions d'illustration, contributions et crédits** (`…140000_card_arts.sql`, `…150000_card_submissions.sql`). Changement d'illustration officielle : l'ancienne devient « Illustration d'origine » (table `card_arts`, kind legacy) et reste sur les exemplaires possédés (`inventory_items.art_id`) ; un recadrage ne crée pas de version. Versions alternatives (dessins faits main) ajoutées en admin (Personnages › Versions d'illustration), tirées avec une chance globale « 1 sur N » (`alternate_art_odds`, 500, onglet Économie) ; la version suit l'exemplaire (marché, échanges, vitrine, révélation « Version alternative »). Fiche de carte : versions possédées, crédit « Illustration : nom ». Bouton discret « Signaler une erreur ou proposer une illustration » : information erronée, illustration (image dans le bucket privé `submissions`, dossier du joueur), demande de crédit ; 10 par jour, une en attente par carte et type. Admin › Contributions : remplacer l'officielle, ajouter en version alternative, créditer, accepter avec récompense (1 booster proposé pour une première illustration) ou refuser avec note ; l'auteur est notifié.
- 21/10/2026 : **historique du joueur** (`…160000_player_history.sql`, page `/historique/`, lien depuis le profil). `get_history(catégorie, curseur, limite)` : ouvertures (5 cartes, édition, source, version des règles, événement, versions d'illustration), achats en boutique, ventes (prix, commission) et achats au marché, échanges (donné / reçu, Deniers), cadeaux, recyclages, et tous les mouvements de Deniers ; uniquement ses propres opérations, page par page (« Voir plus »).
- 21/10/2026 : **Discord** : le fournisseur n'était pas activé côté Supabase (`external.discord = false`) ; la page Profil a déjà « Lier » (liaison manuelle activée). Adresse de retour `/profile/` ajoutée aux redirections autorisées (`config push`). Reste à faire par l'administrateur : application Discord (redirection `https://grlpysqlabwylexinbrl.supabase.co/auth/v1/callback`) puis Client ID / Secret dans Supabase › Authentication › Sign In / Providers › Discord. Le secret ne va jamais dans le dépôt.
- 21/10/2026 : **contenu des événements** (`…170000_event_content.sql`, `src/components/admin/EventContent.tsx`, page `/evenement/?id=`). Missions d'événement (mesures des missions, comptées sur la période, réclamables 48 h après la fin, Deniers et / ou boosters) ; cartes d'événement (brouillons rattachés, publiés automatiquement au début par la tâche `cartema-events`, puis permanents ; mention « Carte de l'événement » dans la fiche) ; défi communautaire (total de tous les joueurs, récompense à chaque participant si atteint) ; classement (podium récompensé). Clôture automatique et unique (`settled_at`, `event_rewards`), notifications `event_reward`. Bannière : lien « Missions, défi et classement ».
- 21/10/2026 : **RGPD** (`…180000_gdpr.sql`, pages `/mentions-legales/` et `/confidentialite/`, `src/lib/legal.ts` à compléter : éditeur et contact). Profil › Mes données : export JSON complet (`export_my_data`) et suppression du compte (`delete_my_account`, confirmation par le pseudonyme). Suppression = compte de connexion effacé, profil anonymisé (pseudonyme, titre, vitrine, amis, souhaits, notifications supprimés, ventes ouvertes retirées), historique de jeu conservé sans lien avec la personne (cartes cédées valides, registre immuable) ; même effet depuis le tableau de bord Supabase. Consentement rappelé à l'inscription, liens dans le pied de page. **Probabilités validées** (`…190000_validate_ruleset.sql`) : table v1 confirmée telle quelle.
- 21/10/2026 : **compte vérifié par Discord** (`…200000_discord_verified.sql`) : un compte lié à Discord (`auth.identities`, provider discord) n'a pas le délai de 24 h (marché, cadeaux, échanges, missions qui en dépendent) ; une identité Discord ne se lie qu'à un compte. Badge « Vérifié » sur le profil public, incitation sur le marché et dans le profil.
- 21/10/2026 : **cadrage « plein cadre » (full art)** (`…220000_full_art.sql`, `tarot-renderer.js`) : l'illustration couvre toute la carte, bandeau du nom translucide sur un dégradé sombre. Choix à l'ajout d'une version d'illustration (par défaut pour les versions) et modifiable ensuite (`admin_set_card_art_meta`) ; aussi proposé pour l'illustration officielle.
- 21/10/2026 : **taxes du marché** (`…230000_market_taxes.sql`), réglables dans Admin › Économie : taxe acheteur 5 % (`buyer_tax_pct`, payée en plus du prix ; pour une enchère, mise de côté avec la mise) et taxe de remboursement 5 % de la mise dépassée (`bid_refund_tax_pct`). Arrondi inférieur, Deniers détruits. Les 155 mises placées avant la mise en service gardent les anciennes règles (`bids.taxed = false`). Commission vendeur de 5 % inchangée.

## 1. Reprendre ici

Le projet est une **démo visuelle avancée, pas encore un jeu connecté**. Le travail récent porte sur les cartes, les finitions, le booster et la lisibilité mobile. Les règles métier complètes restent dans `CAHIER_DES_CHARGES.md` ; ce document indique ce qui existe réellement et ce qui manque.

Racine à ouvrir : `D:/Dev/Cartema/Cartema_Codex_Starter_v2/cartema_project`.
Aucun dépôt Git détecté à cet emplacement ni dans ses parents lors de cette passation : il n’y a pas de commit ou de diff de référence à transmettre. Initialiser le suivi de versions avant de poursuivre les développements importants.

Ordre de lecture :
1. Ce document, puis `CAHIER_DES_CHARGES.md` intégralement.
2. Le code actuel des cartes et de `/boosters`, puis `README.md`.
3. `DESIGN.md` et `design/preview.html` pour l’historique graphique. **La preview et certaines consignes de DESIGN sont anciennes** : conserver les évolutions validées décrites ci-dessous.
4. `CODEX.md` pour les exigences d’implémentation complète et de sécurité.

Les instructions de mission dans CODEX ne signifient pas que les modules sont déjà livrés. Le statut ci-dessous repose sur les fichiers inspectés, pas sur leur intention.

## 2. Lancement et vérifications

Stack installée : Next.js 15.5.28, React 19, TypeScript, lucide-react, Vitest. CSS classique ; Tailwind n’est pas installé. Node 22 / npm 11 utilisés pendant le travail.

```powershell
cd D:\Dev\Cartema\Cartema_Codex_Starter_v2\cartema_project
npm ci
npm run dev -- -p 3101
```

Pour vérifier une livraison :

```powershell
npm test
npm run build
npm run start -- -p 3101
```

Ne pas lancer deux serveurs sur le même port. Au moment de la passation, un serveur de production local écoute sur `http://localhost:3101` ; arrêter celui-ci avant de lancer un autre serveur sur ce port. `npm run dev` sans argument utilise 3000.

- Dernier build applicatif : réussi après l’ajout du fondu et le retrait du lien vers les originaux.
- Tests relancés pendant cette passation : **15/15**, dans 3 fichiers (tirage 4, album 5, cartes 6).
- Les modifications de cette passation sont documentaires, sans nouveau changement applicatif.
- Polices via `next/font/google` : un build peut nécessiter un accès réseau à Google Fonts.
- `.env.example` ne contient que les noms des variables Supabase. Aucun backend provisionné ou connecté n’a été validé pendant ce travail.
- Pas de tests d’intégration DB, de tests de concurrence, ni de suite E2E automatisée actuellement. Les 15 tests ne prouvent pas la conformité globale au CDC.

## 3. État réel par module

| Module | Disponible actuellement | Reste à implémenter |
|---|---|---|
| Accueil et navigation | DA gothique, navigation 5 sections, responsive | Données du compte, réserve réelle, raccourcis métier |
| Cartes | Générateur SVG, 7 habillages de rareté, 3 finitions, silhouettes, fondu | Pipeline automatique d’import, catalogue réel, métadonnées et silhouettes persistées |
| Collection | Grille, recherche, filtres combinés, tris réversibles, progression et détail | Source serveur, multi-éditions, quantités, découvertes historiques, finitions possédées, actions inventaire |
| Boosters | Paquet gothique, déchirure 3D, extraction, retournement libre/cascade, son optionnel | Réserve, attribution Paris, achat, tirage serveur atomique, persistance et historique |
| Moteur de tirage | Fonctions pures et distributions de référence testées | RNG serveur, configuration versionnée, validation du catalogue publié, transaction et idempotence |
| Auth et accès | Aucune intégration | Supabase email/Discord, sessions, liaison d’identités, RLS, propriétaire/admin |
| Inventaire et économie | Schéma SQL partiel | Exemplaires, réservations, verrous, portefeuille/ledger, recyclage, boutique |
| Marché | Page de présentation | Annonces, achats, enchères, commission, clôtures et transferts |
| Profil | Maquette anonyme | Vraies données, confidentialité, personnalisation, vitrine de 5 cartes (la maquette n’en affiche que 4) |
| Social et progression | Aucun service | Amis, cadeaux, échanges, souhaits, missions, succès, classement, événements, notifications et statistiques |
| Admin | Catalogue complet (éditions, clans, personnages, illustrations, publication, boosters), journalisé | Import Sheets, couvertures, économie, interventions joueurs, modération, statistiques |
| PWA et exploitation | Manifeste SVG et fichier service worker d’amorçage | Enregistrement du SW, icônes/installabilité, stratégie cache sûre, déploiement, monitoring et sauvegardes |

Aucune route API, Server Action métier, dépendance Supabase, persistance de partie ou connexion DB n’est présente dans les sources inspectées. `/admin` est un écran d’attente, **pas une authentification ou une protection implémentée**.

## 4. Décisions graphiques et produit à conserver

Évolutions expressément demandées durant l’atelier :

- Mobile first : cible 360–430 px, **2 cartes par ligne** ; 3 à partir de 640 px, 4 à partir de 1100 px. Navigation basse tactile sur mobile.
- Noir/bordeaux/or, tarot gothique. Fioritures lisibles et concentrées sur les bords, portrait dégagé. Pas de retour aux ornements qui occupent toute l’image.
- Interface en **Manrope** pour la lisibilité ; Cinzel pour les titres et noms, Cormorant pour le texte des cartes. Boutons et contrôles ≥44 px (les boutons à 52 px ont été jugés trop massifs par l’utilisateur le 20/10/2026 : boutons en pilule, plus légers), recherche mobile à 16 px.
- Numéro discret en bas, sans étiquette noire ni augmentation de taille. Nom, clan, rareté/finition et fonction ont des zones distinctes : prévenir tout chevauchement.
- **Pas de génération d’illustrations par IA.** Utiliser les dessins fournis ; cadre, SVG et animations sont indépendants des fichiers originaux.
- Dorée distincte de Légendaire : gravure champagne, ornements propres, étoiles fixes qui scintillent et balayage brillant du cadre. Aucun cercle rotatif devant le personnage. Les effets doivent rester visibles sur une image opaque avec fond.
- Sanglante : or ancien, rubis, épines/roses et sang sombre ; éviter les grosses coulures roses/cartoon. Le fluide doit **couler vers le bas**, avec détachement des gouttes, sans oscillation verticale ni remontée visible lors du reset.
- Booster : vrai effet de **déchirure du paquet en 3D**, pas seulement un retournement de carte. Logo imprimé/intégré au sachet, pas un autocollant.
- Inconnues : silhouette, numéro, rareté ; pas d’identité ni de portrait dévoilés. Conserver la découverte après une cession ultérieure.
- Dernière demande : fondre élégamment les images recadrées dans le fond, **automatiquement**, et **ne pas ajouter de lien “voir l’illustration entière”**. Le lien a été retiré.
- Son initialement coupé, options d’effets, réduction des animations et navigation clavier à préserver.
- **Révélation en pile (décision utilisateur du 20/10/2026)** : une seule carte au centre, les suivantes empilées derrière ; toucher pour retourner, toucher encore pour passer à la suivante, petite rangée des cartes déjà vues, récapitulatif des 5 à la fin, bouton « Tout révéler » conservé. Les cartes apparaissent **de la moins rare à la plus rare** (finition spéciale en dernier à rareté égale). Cela **remplace la règle du CDC §4 « le joueur choisit l’ordre des 5 cartes »** : écart validé par l’utilisateur. Tri d’affichage uniquement (`revealOrder` dans `src/lib/game.ts`) ; l’historique serveur garde les positions du tirage.

La position actuelle du médaillon est à la jonction portrait/cartouche (centre SVG 100,205). L’ancienne consigne “médaillon en haut” du CDC/DESIGN ne décrit donc pas le visuel actuellement travaillé avec l’utilisateur. Ne pas déplacer automatiquement ce médaillon en restaurant une ancienne preview ; documenter tout arbitrage nécessaire avant la conformité finale.

## 5. Carte du code

| Fichier | Rôle et précautions |
|---|---|
| `src/components/Card.tsx` | Type `DemoCard`, adaptateur React, échappement XML, chemins locaux d’illustration, ids SVG uniques via `useId` |
| `src/components/tarot-renderer.js` | Composition SVG 200×300, portrait, silhouettes, cadre de rareté, textes et masques de fondu |
| `src/components/gold-frame.js` | Ornements Dorée, masques du reflet, étoiles ; conserver le balayage au-dessus de l’illustration et limité au cadre |
| `src/components/blood-frame.js` | Cadre Sanglante, définitions SVG et trajets de fluide descendants |
| `src/components/CardInspection.tsx` | Dialogue natif, fermeture Échap, comparaison Standard/Dorée/Sanglante ; comparaison purement visuelle |
| `src/components/BoosterSkin.tsx` | Dessin original SVG du sachet, réutilisé pour les parties déchirées |
| `src/app/boosters/page.tsx` | États sealed/opening/reveal, temporisations, gestes, retournements, sons Web Audio ; `previewPack` fixe |
| `src/app/globals.css` | Tokens, responsive, animations des cartes et du paquet ; nombreux blocs/overrides ajoutés successivement |
| `src/lib/album.ts` | Sélection/tri purs, recherche sans accents, protection des identités inconnues dans les filtres |
| `src/app/collection/page.tsx` | Interface de l’album, état local des filtres, compteurs de démo |
| `src/data/demo.ts` | Seule source actuelle des cartes et du paquet de présentation ; à remplacer pour le jeu réel |
| `src/lib/draw.ts` | Pondérations et tirage pur avec RNG injecté ; aucun accès DB |
| `supabase/migrations/` | Schéma, RLS et RPC transactionnelles (remplace l’ancien `db/migrations/0001_init.sql`) ; voir `BACKEND.md` |
| `tests/` | Tests unitaires actuels ; à compléter avec intégration et concurrence |
| `docs/design/` | Preview historique et captures de travail ; captures complémentaires, pas spécification métier |

Les effets Dorée/Sanglante et les textes ne sont pas intégrés dans les fichiers image : une correction du moteur peut donc s’appliquer globalement. Garder des ids SVG uniques même lorsqu’une carte apparaît simultanément dans la grille et le dialogue.

## 6. Illustrations et automatisation : fait / à faire

### Assets actuels

- Alhoon : `public/illustrations/alhoon.png`.
- Rus : `public/illustrations/rus.webp`, original dans `public/illustrations/originals/rus.png`.
- Norton : `public/illustrations/norton.webp`, original dans `public/illustrations/originals/norton.png`.
- Les WebP Rus/Norton ont été produits à 900 px de large, sans modification créative. Aucun service de conversion automatique n’est intégré.
- Rus est naturellement inversé dans le dessin fourni ; ce n’est pas une rotation CSS. Le dessin complet contient une longue composition avec reflet. Le cadrage actuel privilégie le personnage.
- Ces trois personnages ont `provisional: true` : clans et raretés officiels à confirmer. Le bleu est un cadre de présentation ; ne pas importer “Rare” comme donnée métier validée. Le filtre de rareté officielle exclut les aperçus.

### Automatique aujourd’hui

Le renderer superpose cadre, textes et finition à partir des données. Les masques de fondu haut/bas/côtés sont communs à toutes les illustrations et suivent le cadrage et ses décalages. Ils ne touchent ni le cadre ni les textes. Les silhouettes ne sont pas masquées comme des portraits.

### Encore manuel ou incomplet

L’ajout des fichiers, la conversion WebP et les entrées de `demo.ts` ont été faits manuellement. Le choix de cadrage n’est **pas encore automatique** : `artLayout` propose portrait/full/cover, et Rus possède actuellement un `artOffsetY: -18` spécifique. Ne pas annoncer que l’exigence d’import automatique du CDC est déjà terminée.

La silhouette actuelle est choisie par hash de l’id parmi **6 variantes codées** ; stable tant que l’id ne change pas, mais sans tirage initial stocké en DB. Le CDC demande un choix fixé puis persisté ; la bibliothèque définitive reste à fournir/valider.

### Pipeline à construire

1. Upload admin sécurisé : validation réelle du contenu, dimensions/poids, formats acceptés, stockage original séparé.
2. Génération automatique de variantes optimisées et métadonnées (dimensions, transparence, orientation), en conservant l’original.
3. Politique de cadrage par défaut couvrant portraits détourés, images opaques avec fond, formats larges et très verticaux. Prévoir un aperçu et une correction optionnelle persistée pour les compositions atypiques ; le chemin normal doit fonctionner sans réglage par personnage.
4. Même rendu centralisé partout : album, détail, profil, révélation et couvertures d’édition adaptées. Aucun cadre “cuit” dans l’original.
5. Publication manuelle après validation des données ; pas de publication automatique à l’upload.
6. Tests de rendu : visage lisible, bords fondus, absence de chevauchement, finitions visibles sur fond opaque, inconnues anonymes, fonctionnement à 360 px et en réduction d’animations.

## 7. Plan d’implémentation conseillé

Chaque étape doit livrer une tranche réellement utilisable, avec tests, sans dégrader le travail graphique.

### A — Fondations serveur et données

- Initialiser le suivi Git et les environnements dev/staging/prod ; documenter les variables et migrations.
- Provisionner Supabase Auth email/Discord, profils/pseudo unique, sessions, administrateur unique attribué côté serveur et RLS.
- Compléter le modèle du CDC : catalogue/clans/éditions, instances et réservations, découvertes, soldes et ledger, boosters/crédits/ouvertures/règles versionnées, puis tables des autres modules.
- Définir une couche transactionnelle : idempotency keys, contraintes uniques, verrouillage des ressources, journal et tests de concurrence. La clé de service ne doit jamais atteindre le navigateur.
- Ne pas exécuter la migration d’amorçage seule comme si elle sécurisait la production.

### B — Catalogue réel et générateur automatique

- Réaliser le pipeline d’images ci-dessus, le CRUD admin, les symboles/silhouettes persistés, les éditions et leur publication.
- Import initial Sheets avec mapping, aperçu, erreurs et dédoublonnage. Le contenu réel du fichier n’a pas été lu ; ne pas inventer de personnages ou colonnes.
- Remplacer `DemoCard` par des modèles séparant catalogue, découverte historique et exemplaires possédés ; adapter le renderer sans le réécrire graphiquement.
- Source serveur pour l’album, filtre d’édition, quantités par finition et actions verrouiller/recycler/vendre liées au vrai stock.
- Ne pas envoyer les secrets des cartes inconnues au client : masquer dans le SVG ne protège pas une réponse API contenant leur identité.

### C — Boucle de jeu complète

- Crédits gratuits 06 h/18 h Europe/Paris, capacité 6, rattrapage hors connexion et unicité par créneau ; tests changements d’heure.
- Boutique : 500 / 1 400 / 4 500 Deniers pour 1/3/10 boosters ; réserve achetée distincte.
- Ouverture serveur : vérifier édition complète, débiter une fois, tirer, créer les 5 instances et découvertes, écrire l’historique avec règles appliquées, puis retourner le résultat à animer.
- Définir reprise/réconciliation après erreur réseau ou rechargement. Ne jamais rejouer un tirage parce que l’animation est interrompue.
- Brancher la scène existante sur ce résultat ; le verrou React actuel évite seulement des doubles clics locaux, il n’apporte aucune garantie serveur.
- Recyclage et récompenses avec ledger et confirmation des finitions rares ; dernier exemplaire cessible, découverte conservée.

### D — Échanges économiques et social

- Marché achat immédiat, commission, réservations et achats concurrents.
- Enchères avec Deniers bloqués, paliers, anti-sniping et tâche de clôture idempotente même sans visiteurs.
- Échanges (10 cartes maximum par partie, 48 h, Deniers optionnels) ; cadeaux de cartes entre amis, acceptation obligatoire et restitution.
- Blocage des transactions entre joueurs pendant les premières 24 h du compte.
- Profil réel/vitrine 5 cartes, amis, souhaits publics, notifications internes, confidentialité, historiques et statistiques.

### E — Progression et administration complète

- 3 missions quotidiennes, 3 hebdomadaires, renouvellement Paris et 1 remplacement gratuit quotidien.
- Succès visibles/secrets, classement historique, cosmétiques et événements ; pas de niveau/XP, pas de finition donnée hors booster.
- Configuration économique versionnée, publication/activation des éditions, interventions motivées, audit et modération.
- Notifications dans le site uniquement : pas de messagerie privée, mails, push ou bot Discord demandés.

### F — Livraison exploitable

- Finaliser PWA : icônes PNG 192/512 + maskable, enregistrement du SW et tests d’installation. Le SW actuel inclut `/` en cache ; revoir cela avant l’auth pour ne pas restituer des pages personnalisées d’un autre compte. Aucune écriture hors ligne.
- Tests d’intégration/RLS/concurrence et parcours E2E du CDC §12 ; QA mobile, clavier, lecteur d’écran, contraste et performances des animations.
- Hébergeur compatible Next full-stack, tâches planifiées fiables, monitoring et alertes, migrations/rollback et publication manuelle.
- Sauvegardes chiffrées quotidiennes DB + objets + configuration hors site, rétention 30 jours, restauration testée sur un autre environnement. Rien de cela n’a été provisionné ici.
- Droits d’usage des illustrations et pages légales/confidentialité avant ouverture publique.

## 8. Règles à ne pas perdre pendant l’intégration

- Booster de 5 cartes, doublons possibles ; uniquement l’édition choisie, personnages uniformes dans la rareté.
- Slot 5 : Rare 55 %, Très rare 37 %, Épique 6 %, Légendaire 1,9 %, Mythique 0,1 %.
- Finition indépendante par carte : Standard 98 %, Dorée 1,8 %, Sanglante 0,2 %.
- Sept raretés disponibles obligatoires pour activer/acheter/ouvrir ; aucun fallback ou mélange d’édition.
- Slots 1–4 dans `draw.ts` : **propositions provisoires**, pas règles définitivement approuvées. Les rendre configurables/versionnées.
- Inventaire par exemplaire ; verrouillage manuel ; aucune protection implicite du dernier exemplaire.
- Recyclage Standard : 5/15/40/90/200/750/3 000 Deniers selon rareté ; Dorée ×3, Sanglante ×10.
- Commission marché 5 % ; règle d’arrondi à formaliser (CDC recommande floor). Aucune commission sur cadeaux/échanges.
- Enchères 12/24/48/72 h ; paliers +10 sous 500, +25 sous 2 000, +50 ensuite ; 2 minutes restantes après une surenchère tardive.
- Stockage UTC, calendriers métier Europe/Paris avec DST ; aucune heure du navigateur comme autorité.
- Solde, propriété, réservation, ancienneté et autorisation contrôlés côté serveur à chaque opération.

## 9. Points ouverts et dette identifiée

- Validation finale des slots 1–4 ; montants missions/succès/connexion/découvertes et cosmétiques.
- Catalogue Sheets réel, numérotation/édition/clans/raretés des illustrations ; bibliothèque définitive de symboles et silhouettes.
- Expiration des cadeaux, annulations/quotas de marché, traitement des cartes rendues indisponibles ; voir CDC §13.
- Fournisseur, budget effectif, sauvegardes et ordonnanceur à choisir ; ne pas promettre une exploitation conforme gratuite avant vérification.
- CSS et SVG sont denses, avec overrides successifs : refactoriser progressivement en conservant des captures avant/après ; éviter de réécrire l’ensemble avant de connecter le jeu.
- `drawPack` exige un RNG injecté mais ne vérifie pas explicitement sa valeur au moment de choisir l’index du personnage, contrairement à `drawWeighted` : renforcer ce contrat avant production. Les distributions sont encore des constantes.
- Les tests cartes contrôlent surtout le markup SVG. Le fondu a été vérifié visuellement sur Rus et Norton ; pas de régression visuelle automatisée.
- Les compteurs de réserve, les “connues” et le paquet sont fictifs. Les filtres/options ne persistent pas au rechargement. La comparaison de finition ne signifie pas possession.
- Le README/DESIGN contenaient des prescriptions devenues obsolètes : ne pas réintroduire le numéro en tête, un badge noir, un cercle doré tournant, un effet de sang qui remonte ou un lien vers l’image entière.

## 10. Première tâche concrète pour le repreneur

Conserver la DA actuelle, poser l’auth/RLS et le catalogue persistant avec import d’illustrations automatique, puis réaliser **une ouverture serveur de bout en bout** : compte connecté → crédit disponible → débit atomique → cinq instances → découverte → historique → animation existante → album actualisé après rechargement. Cette tranche établira les fondations avant marché et progression.

Critère de fin global : toutes les exigences du CDC et ses 13 scénarios d’acceptation satisfaits ; pas seulement les écrans visibles. Répertorier explicitement tout service externe ou choix métier encore nécessaire.
- **Surveillance anti-triche** (admin › Surveillance, migration `20261021240000_admin_anomalies`) : `admin_anomalies(p_days)` lance 12 contrôles. Les 6 contrôles d'intégrité (solde négatif, solde ≠ journal, mise sans fonds bloqués, carte bloquée sans offre, unique en double, boosters ouverts en trop) ne devraient jamais remonter. Les 6 pistes de comportement (duo actif, prix aberrant, comptes neufs qui donnent, faux enchérisseur, gains rapides, rafale) sont à vérifier sur la fiche du joueur avant toute sanction. Un clic sur un joueur ouvre sa fiche.
- **Aperçu des versions d'illustration** (admin › Personnages › Versions d'illustration) : un clic sur la vignette d'une version l'affiche sur la carte avec son cadrage. Choisir un fichier montre aussitôt l'aperçu avec le cadrage sélectionné, avant tout envoi.
