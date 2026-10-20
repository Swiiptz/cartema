# Mission Codex : implémenter CARTEMA intégralement

**Avant la reprise, lire `docs/PASSATION.md`** : état constaté du code et décisions utilisateur récentes. Les consignes graphiques historiques de DESIGN/preview sont à interpréter avec cette passation ; ne pas annuler les évolutions validées.

Lis d'abord `docs/CAHIER_DES_CHARGES.md`, puis `README.md`. Construis **tous les modules demandés** et rends l'application utilisable de bout en bout ; ce dépôt fourni n'est qu'une fondation UI, de données et de règles.

**Avant toute UI : lis `docs/DESIGN.md` et ouvre `docs/design/preview.html` — c'est la référence visuelle obligatoire (cartes, tokens, polices, animations).**

Règles de travail :
1. Conserve toutes les décisions explicitement validées. N'invente pas le contenu du Google Sheets, de portraits, de secrets ou de ressources graphiques.
2. Bâtis une architecture transactionnelle solide : fonctions serveur, PostgreSQL, politiques d'accès, idempotency keys, verrouillage de lignes/transactions, ledger auditable ; sécurise explicitement ouvertures, crédits, réservations, enchères, marchés et cadeaux.
3. Évite le faux-fonctionnel : tout bouton de transaction doit être connecté à une vraie opération testée, ou clairement marqué indisponible jusqu'à l'implémentation. Retire les données fictives des pages de production.
4. Mets en place Supabase Auth (email/mot de passe + Discord) et RLS ; clé de service uniquement côté serveur. Aucun accès client à la table administrative ou aux réglages métier sensibles.
5. Crée migrations, seeds non personnels, services, API, UI accessibles, tests unitaires, intégration et end-to-end. Compte à rebours Europe/Paris avec DST ; stockage UTC.
6. Tirages : contrôler poids 100 % par slot, absence de rareté => bloquer édition, 5e emplacement 55/37/6/1,9/0,1, finition 98/1,8/0,2 ; moteur cryptographiquement sûr et transactionnel. Slots 1–4 **provisoires** jusqu'à validation : laisser configurables et documenter le point ouvert.
7. UI : mobile first, PWA installable, esthétique tarot gothique noir/bordeaux/or ; cartes générées automatiquement par overlay graphique, silhouette aléatoire fixée par personnage, médaillon de clan en haut, numéro discret en bas, ornementation progressive selon rareté.
8. Implémente catalogue, import Sheets initial avec mapping, clans personnalisés, éditions, boutique, inventaire, packs gratuits, marché, enchères, échanges, dons entre amis, missions, succès secrets, événements, notifications internes, liste de souhaits, stats, visibilité et back-office unique.
9. Prévois sauvegardes quotidiennes DB+objets+configuration hors site, rétention 30 jours, alertes et restauration testée ; fournis une solution réalisable pour l'hébergeur choisi et signale tout coût incompatible avec 0 €.
10. Déploiement prod manuel. Prévois dev/staging/prod, commandes de lancement et de migration, scripts de test, procédure de rollback, documentation des variables d'environnement.

## Ordre d'implémentation interne (livraison finale complète)
- Modèle SQL et auth/RLS ; moteur d'écritures atomiques ; moteur de boosters ; pages de jeu ; marché et réservations ; social et progression ; admin et événements ; QA/PWA/déploiement.
- Termine chaque sous-système par tests et vérification de sécurité, mais conserve **l'objectif de tous les modules livrés**.

## Definition of Done
Toutes les exigences et scénarios de `docs/CAHIER_DES_CHARGES.md` sont testés, fonctionnalités réellement connectées, admin protégé, aucun solde incohérent, édition incomplète bloquée, sauvegarde restaurée avec succès, interface responsive et PWA installable. Signale distinctement toute restriction externe restante.
