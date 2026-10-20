# CARTEMA — Cahier des charges fonctionnel et technique

**Version :** 1.0 — 20 octobre 2026  
**Nature :** Jeu web de collection de cartes tarot gothiques, inspiré d'une chronique de semi-GN Camarilla.  
**Plateforme :** application web mobile-first, responsive, installable en PWA.  
**Statut :** spécification de référence ; le dépôt joint est une base de développement, **pas** l'application fonctionnelle finale.

## 1. Vision et contraintes
- Univers visuel : tarot gothique, noir/bordeaux/or, fioritures superposées aux portraits, typographies élégantes mais accessibles ; interfaces tactiles ergonomiques.
- Site responsive : priorité écran 360–430 px, 2 cartes par rangée dans l'album mobile ; 5 onglets inférieurs (Accueil, Collection, Boosters, Marché, Profil). Desktop avec navigation latérale ou supérieure.
- PWA : `manifest.webmanifest`, icônes, service worker, installation selon navigateur ; en ligne obligatoire pour toutes les écritures monétaires, ouvertures, ventes et transferts. Accessibilité : préférences de réduction d'animations, son coupé initialement, boutons accessibles, contrastes suffisants.
- Français comme langue principale ; fuseau métier `Europe/Paris` ; horaires d'été/hiver respectés ; stockage des instants en UTC.
- Budget hébergement cible 0 € si possible, solutions managées, déploiement **manuel**. L'exploitation gratuite durable n'est pas garantie ; surveiller quotas, capacités de tâches programmées et sauvegardes.
- Monnaie interne exclusivement virtuelle : **Denier** (pluriel Deniers). Aucun paiement réel.

## 2. Identité, comptes et accès
- Inscription libre, accès au jeu immédiat. Auth e-mail/mot de passe **ou** OAuth Discord. Association des identités possible et sécurisée ; e-mail non vérifié autorisé.
- Un administrateur principal uniquement ; son statut est attribué côté serveur par provisionnement sécurisé, jamais par un champ modifiable par le client.
- Profils : pseudonyme unique, avatar, titre issu des succès, badges, cadre, bannière, fond, effets et décorations ; vitrine de **5 cartes** ; visibilité des collections et statistiques configurable par le joueur.
- Transactions entre joueurs (achats sur marché, ventes, enchères, échanges, cadeaux) interdites avant **24 h** d'ancienneté du compte. Les boosters et l'album restent disponibles immédiatement. La vérification de l'e-mail n'est pas obligatoire.
- Protection des accès : vérification serveur du propriétaire de chaque donnée, limitation de débit, validation des uploads, journaux, gestion des sessions, protections anti-CSRF selon la méthode d'auth, interdiction de confiance aux sommes calculées par le navigateur.

## 3. Personnages, clans, cartes et éditions
- Catalogue initial issu d'un **import Google Sheets une seule fois** ; ensuite la gestion s'effectue depuis l'administration web. La feuille d'origine n'a pas encore été lue : prévoir correspondance des colonnes, prévisualisation, erreurs et dédoublonnage avant l'import. Ne jamais supposer son contenu.
- Personnage : identifiant immuable, nom, titre/fonction, clan/lignée unique, édition, numéro officiel, rareté fixe, illustration facultative, état (brouillon/publiée/archivée), dates, auteur et métadonnées techniques.
- Clans : référentiel prédéfini et extensible (lignées et clans personnalisés), un seul par personnage ; clan inconnu représenté par un médaillon mystérieux. Symboles originaux style gravure tarot : rose Toréador, griffe Gangrel, œil Malkavien, etc. Symbole placé dans **un médaillon en haut**.
- Génération **automatique** à partir des données : portrait importé ou silhouette gothique tirée au hasard **une fois par personnage puis persistée**, même modèle, fioritures en surimpression, contour couleur rareté, détail des ornements croissant avec la rareté, nom/titre/clan/rareté/numéro lisibles. Numéro `PREFIXE-001` petit dans la bordure inférieure. Le générateur doit pouvoir être corrigé globalement sans modifier les images d'origine.
- **7 raretés** : Commun, Peu commun, Rare, Très rare, Épique, Légendaire, Mythique. La rareté est indépendante de la puissance RP.
- Chaque personnage a une carte principale et des finitions cosmétiques : Standard, Dorée, Sanglante. Finitions uniquement tirées dans les boosters, jamais données par succès ou événement ; probabilité **indépendante** par carte : Standard 98 %, Dorée 1,8 %, Sanglante 0,2 %. Les finitions comptent séparément pour leur propre progression mais découvrir une finition révèle le personnage dans l'album principal.
- Album : **grille uniquement**, 2 cartes par ligne sur mobile, nombre de colonnes croissant avec l'écran ; tri numéro/nom/clan/rareté et filtres édition, clan, rareté, découvert/manquant, finition. Cartes inconnues : silhouette mystérieuse + numéro + rareté, ni nom ni portrait. Carte connue : image, nom, titre/fonction, clan, rareté, numéro. Pas de fiche encyclopédique longue ; la découverte historique persiste après vente/recyclage.
- Éditions : permanentes tant qu'actives, album publiable indépendamment du booster ; booster activé **manuellement**. Couverture image fournie habillée automatiquement façon tarot. Préfixe propre, numéros immuables ; ajouts de cartes à tout moment, publication des cartes **manuelle** seulement. Nouvelle carte publiée : disponibilité immédiate si booster actif et catalogue complet, annonce révélant identité et portrait. Éditions **archivables, jamais supprimées** si elles ont servi à des transactions ; anciens inventaires préservés.
- Éditions et boosters spécifiques : un booster d'une édition ne contient que ses cartes. Les boosters gratuits ne sont attachés à une édition qu'au moment de l'ouverture ; les lots achetés peuvent être liés à l'édition choisie à l'achat (décision technique documentée et cohérente en interface).

## 4. Boosters et aléatoire
- Booster = **5 cartes** ; chaque exemplaire tiré indépendamment, **doublons possibles y compris dans le même paquet**, personnages d'une rareté donnée dans une édition choisis uniformément.
- **Cinquième emplacement validé** : Rare 55 %, Très rare 37 %, Épique 6 %, Légendaire 1,9 %, Mythique 0,1 %. Garantie de Rare ou mieux sur cet emplacement.
- **Emplacements 1–4 encore à confirmer formellement** : valeurs de travail issues des propositions antérieures : emplacements 1–3 Commun 70 % / Peu commun 30 % ; emplacement 4 Peu commun 75 % / Rare 20 % / Épique 5 %. Ne pas figer ces valeurs sans confirmation ; stocker les distributions dans la configuration et tester leur somme 100 %.
- **Une édition n'a pas le droit d'activer ses boosters si une des 7 raretés manque** : contrôler toutes les raretés réellement admissibles par les emplacements. Aucun fallback, aucune redistribution, aucun résultat provenant d'une autre édition. Si l'édition devient incomplète, suspendre achats et ouvertures ; un booster possédé reste stocké.
- Finitions : tirées **après** choix du personnage et de sa rareté, à 98/1,8/0,2 %. Pas de protection anti-doublons ni de compteur de chance augmentée.
- Révélations : le joueur choisit l'ordre des 5 cartes à retourner ; animation 3D, particules et sons désactivables, bouton passer/révéler tout. Réserver/débiter booster et créer les cinq exemplaires **atomiquement au serveur** avant l'affichage des animations. Historique intégral des ouvertures conservé.
- Boosters gratuits : **+1 à 06 h et +1 à 18 h Europe/Paris**, même hors connexion ; capacité **6 gratuits**, les gains au-delà de 6 sont perdus, pas de report ; packs achetés séparés, sans limite. Garantir l'idempotence d'attribution par compte et créneau : calcul paresseux sur visite/API et/ou cron fiable ; ne pas créditer deux fois au changement d'heure.
- Boutique : booster unitaire **500 Deniers**, lot ×3 **1 400 Deniers**, lot ×10 **4 500 Deniers**, probabilités identiques ; cosmétiques à prix administrables ; **aucune vente officielle de carte à l'unité**.

## 5. Inventaire et recyclage
- Exemplaires illimités, pile par (carte, finition) avec quantité. Système de verrouillage **manuel** ; exemplaires verrouillés exclus des ventes, offres, cadeaux, recyclage. Pas de protection automatique du dernier exemplaire.
- Recyclage multiple autorisé ; recyclage rapide limité aux **Standards non verrouillées**. Dorées/Sanglantes recyclables individuellement avec confirmation explicite. Recyclage irréversible, exécuté côté serveur en transaction.
- Valeurs Standards validées comme base : Commun 5, Peu commun 15, Rare 40, Très rare 90, Épique 200, Légendaire 750, Mythique 3 000 Deniers. Dorée ×3 ; Sanglante ×10. Paramétrables admin, historisées, affichées avant confirmation.

## 6. Économie, marché, enchères, échanges et cadeaux
- Sources Deniers : connexion quotidienne (proposition initiale **25 Deniers**, à paramétrer), missions, découvertes (proposition initiale **10 Deniers** une seule fois par personnage, à paramétrer), succès, recyclage et ventes. Comptabilité par **ledger** immuable et solde matérialisé contrôlé ; montants entiers, jamais négatifs hors capacité de correction strictement définie.
- Boutique, recyclage et récompenses sont des créations/destructions monétaires enregistrées ; vente joueur->joueur transfère les Deniers et détruit la commission.
- Marché : prix libre, achat immédiat et enchères, **commission 5 %** prélevée sur le revenu vendeur à la finalisation ; affichage du net exact, arrondi en entiers défini uniformément (recommandation : commission `floor(prix*5/100)`). Pas de commission sur échanges ou cadeaux.
- Enchères : durée **12/24/48/72 h** ; surenchère minimale : +10 sous 500, +25 de 500 à moins de 2 000, +50 à partir de 2 000 Deniers ; verrouiller les Deniers du meilleur enchérisseur et libérer ceux du précédent atomiquement. Toute enchère placée dans les **2 dernières minutes** prolonge la clôture jusqu'à 2 minutes après cette nouvelle enchère. Clôture fiable/idempotente côté serveur, même sans visiteurs. Sans enchère : rendre l'exemplaire au vendeur. Encadrer annulations, expiration, concurrence et suspension.
- Échanges : max **10 cartes par joueur** + Deniers optionnels, possibles hors ligne, contre-offres, expiration **48 h**, sans commission ; pas de protection du dernier exemplaire. Réserver exemplaires et Deniers engagés. Accepter/refuser/annuler atomiquement et empêcher les double-emplois.
- Cadeaux : **cartes uniquement**, entre **amis**, acceptation obligatoire du destinataire, pas de commission ; retour de carte au refus ou expiration (durée d'expiration des cadeaux à configurer ultérieurement, par défaut proposée 48 h mais pas encore validée).
- Période anti-abus : blocage des transactions entre joueurs pendant les 24 premières heures du compte ; limitation de débit sur inscription, création d'offres et enchères, détection/signalement de mouvements anormaux.

## 7. Communauté, missions et succès
- Profil : pseudo/avatar, titre/badges, vitrine 5 cartes ; confidentialité des collections et statistiques à la carte. Liste de souhaits **publique**, recherche par finition, alertes de mise en vente et recherche chez les amis dans le respect des réglages de confidentialité des collections.
- Amis : demandes, acceptation, suppression. Notifications **dans le site uniquement**, préférences par catégorie, historique obligatoire pour opérations de marché même si les alertes sont désactivées. Pas de mails, push, bot Discord ni messagerie privée.
- Classement principal : nombre **historique** de personnages uniques découverts, finitions ignorées pour le score, aucune diminution après cession. Aucun XP ni niveau.
- Missions : **3 quotidiennes**, renouvelées à 06 h heure de Paris, **3 hebdomadaires** renouvelées lundi à 06 h, **1 remplacement gratuit par jour** ; récompenses en Deniers, montants administrables ; ne pas donner de mission impossible à réaliser (éviter obligation d'échange si pas de partenaires, par exemple).
- Succès visibles et secrets (secrets masqués jusqu'au déblocage), récompenses variées : Deniers, boosters, titres, badges et cosmétiques. Acquis définitivement, pas de niveau.
- Événements : séances semi-GN, saisonniers et défis communautaires. Durée libre admin, missions/récompenses dédiées, nouvelles cartes événementielles qui rejoignent ensuite les **éditions permanentes**. Les **finitions** restent obtenables uniquement en boosters.

## 8. Administration, publication et modération
- Back-office sécurisé du seul administrateur : CRUD personnages, clans, symboles, silhouettes, éditions, couvertures, images ; import initial Sheets avec prévisualisation et mapping ; génération/aperçu automatique et publication manuelle des cartes ; activation des boosters après validation des 7 raretés.
- Administration économique : prix booster/lots, récompenses, recyclage, pondérations de **chaque slot**, finitions, commission, événement, catalogue des cosmétiques ; avant toute modification, écran de confirmation, sommes contrôlées, versionnement de configuration ; les paramètres appliqués à un tirage sont conservés dans son historique.
- Interventions administratives : ajout **et retrait** de cartes, boosters, Deniers avec **justification obligatoire** et contrôle d'intégrité ; journaux complets datés, avant/après, acteur/cible et identifiant d'opération. Restitution/correction sans modifier silencieusement le passé.
- Modération : signalements, suspensions, blocage individuel des transactions, journaux et enquête. Chaque action de modération motivée/journalisée.

## 9. Statistiques, historiques, confidentialité
- Statistiques **complètes** : collection/découvertes par clan et édition/variantes, ouvertures, tirages par rareté, commerce, soldes et flux économiques, missions et succès. **Pas d'obligation de graphiques avancés**.
- Visibilité personnalisable par joueur ; données administratives/sensibles jamais exposées publiquement.
- Historique **intégral des ouvertures** : 5 instances effectivement obtenues, édition, règles de tirage, instant, finition, source du booster. Historique de ventes, échanges, dons et recyclages.

## 10. Infrastructure, sauvegardes et déploiement
- Architecture cible : frontend Next.js/React/TypeScript + Tailwind ; hébergement statique/edge managé compatible avec la version choisie ; backend transactionnel Supabase Auth + PostgreSQL et stockage d'images. **Vérifier la compatibilité du déploiement Next.js avec l'hébergeur** avant d'adopter un mode SSR spécifique ; Cloudflare Pages statique seul ne suffit pas pour une application Next.js full-stack sans adaptation.
- Transactions complexes : PostgreSQL via fonctions serveur/RPC avec droits restrictifs, `SECURITY DEFINER` audité et `search_path` contrôlé ou backend protégé par clé serveur ; jamais exposer la clé service role dans le navigateur.
- Plan de tâches asynchrones/clôtures : mécanisme planifié managé ou réconciliation à chaque accès ; les enchères doivent être clôturées dans un délai raisonnable **même en absence de connexion**. Prévoir surveillance des échecs et exécution idempotente.
- **Sauvegardes quotidiennes**, **30 jours de rétention**, DB + images + configuration, stockées hors de l'hébergement primaire, chiffrées et avec restaurations testées. **Ce besoin peut dépasser les offres gratuites** ; ne jamais annoncer la stratégie conforme avant d'avoir provisionné et testé stockage et automatisation.
- Déploiement **manuel** de production depuis une version validée ; environnements dev/test/prod, secrets hors repo, migrations transactionnelles, vérifications avant publication, rollback et monitoring.
- Mentions légales/confidentialité et politique de contenus/illustrations à prévoir avant ouverture publique ; droits d'utilisation des images des participants à vérifier.

## 11. Modèle de données (conceptuel)
- `profiles`, `auth_identities`, `friendships`, `notification_preferences`, `notifications`, `reports`, `admin_audit_logs`.
- `clans`, `silhouettes`, `editions`, `characters`, `card_finishes`, `cosmetics`, `owned_cosmetics`, `showcase_slots`, `wishlists`, `discoveries`.
- `inventory_items` **par exemplaire**, `booster_balances`, `booster_grants`, `pack_openings`, `pack_opening_cards`, `pack_rulesets` (versions).
- `wallets`, `wallet_ledger`, `shop_orders`, `listings`, `bids`, `trades`, `trade_items`, `gifts`, `recycling_operations`.
- `missions`, `mission_assignments`, `achievements`, `achievement_unlocks`, `events`, `event_progress`, `event_rewards`.
- Relations et contraintes doivent empêcher toute duplication de découvertes/récompenses, soldes négatifs, cartes simultanément engagées, transfert vers soi-même abusif et transactions partielles.

## 12. Tests d'acceptation impératifs
1. On peut s'inscrire, se connecter, lier Discord, créer un pseudo unique ; non-admin interdit sur `/admin` et API associées.
2. À 06 h/18 h Paris, un seul booster gratuit crédité par créneau, même en requêtes concurrentes, capacité 6, comptes inactifs rattrapés correctement, heure d'été testée.
3. Booster 5 cartes dont 5e Rare ou supérieure ; distributions valides à 100 %, finitions indépendantes ; 7 raretés disponibles obligatoires ; édition incomplète bloquée à l'achat et à l'ouverture.
4. Deux ouvertures simultanées avec 1 booster disponible : une seule réussite ; chaque tirage enregistré intégralement avec les 5 exemplaires.
5. Achat et recyclage : aucun solde négatif, aucune multiplication de monnaie lors de requêtes répétées, transaction idempotente.
6. Achat immédiat concurrent d'une même carte : un seul acheteur ; commission exactement 5 % selon règle d'arrondi et ledger équilibré.
7. Enchère : montant bloqué, ancien enchérisseur remboursé, paliers, anti-sniping, clôture automatique unique ; restitution sans enchère.
8. Échanges max 10 cartes par partie, 48 h, verrouillages respectés, acceptation atomique, impossibilité de réutiliser une carte réservée.
9. Cadeau réservé aux amis, carte non verrouillée, acceptation expresse et restitution si refus.
10. Dernier exemplaire vendable/recyclable ; découverte historique et classement restent inchangés.
11. Silhouette attribuée une seule fois, finitions cohérentes, médaillon de clan et numéro discret, rendu mobile 360 px.
12. Sauvegarde hors site et restauration complète testée sur environnement distinct ; journaux d'administration intègres.
13. PWA installable sur navigateurs compatibles ; animations et sons désactivables, navigation clavier/screen reader.

## 13. Points ouverts / décisions restantes
- Distributions exactes des **emplacements 1 à 4** (valeurs actuellement de travail, non validées dans une réponse définitive).
- Montants exacts des missions, succès, bonus quotidien/découvertes et tarifs des cosmétiques.
- Durée d'expiration des cadeaux ; politique des annulations de ventes ; quotas de marché ; façon de traiter une carte rendue indisponible durant une offre.
- Catalogue initial réel du Google Sheets : colonnes, valeurs, doublons, illustrations, éditions.
- Liste finale des symboles de clan et bibliothèque de silhouettes ; typographies et éléments graphiques avec licences.
- Fournisseur précis, automatisation des clôtures d'enchères, sauvegardes chiffrées hors-site et coûts réels.

**Principe pour Codex :** implémenter tous les modules de cette spécification ; ne pas remplacer une règle validée par une autre sans le signaler, et traiter chaque point ouvert comme une configuration ou un blocage explicite, jamais comme une supposition silencieuse.
