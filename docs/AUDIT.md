# CARTEMA — Audit du site et de la base (22 octobre 2026, soir)

Méthode : schéma audité sur une copie locale (les 59 migrations rejouées dans PGlite, puis interrogation du catalogue Postgres) ; production interrogée en trois appels seulement (statistiques, intégrité, tâches planifiées) pour ne pas la charger ; site audité dans le code (`src/`, `public/`, dépendances).

## En bref

| Domaine | Verdict |
|---|---|
| Intégrité des données | **Saine** : aucun écart sur 8 contrôles |
| Sécurité de la base | **Saine** : un point mineur |
| Sécurité du site | **Saine** : deux points de contenu public à trancher |
| Performance | **Le goulot est la mémoire de la machine**, pas le code ni les tâches planifiées ; quelques index manquants |
| Dépendances | 3 alertes, sans impact sur le site publié |

**Cause des lags** (question du 22/10 : « actions des joueurs, tâches autour ? ») : ni l'un ni l'autre en soi. La machine nano a 432 Mo de RAM et swappe à 110 %. À chaud, les fonctions prennent 0,2 à 11 ms ; les moyennes de 100 à 300 ms et les pics de 7 s sont des attentes de swap. Les tâches planifiées pèsent ~3 % du calcul ; les appels du site ~97 %, dont la moitié venait de la page Marché (corrigé le 22/10). Avec **132 joueurs actifs sur 136 en 24 h**, la machine gratuite est sous-dimensionnée.

## 1. Intégrité (production)

Tous les contrôles à zéro : soldes négatifs, solde différent du journal des Deniers, boosters négatifs, cartes réservées sans annonce, annonces dont la carte a changé de main, carte unique en double, enchères échues non closes, cadeaux et échanges expirés non clos.

## 2. Sécurité de la base

Conforme :
- RLS activé sur les 48 tables de `public` ; les politiques ne donnent que la lecture de ses propres lignes (sauf catalogue public et annonces actives).
- Aucune écriture directe possible depuis le site : tout passe par les fonctions.
- Aucune fonction ouverte aux visiteurs non connectés ; aucune fonction `private.*` exécutable par les joueurs, sauf `is_admin` (voir plus bas).
- Les 120 fonctions `security definer` fixent toutes leur `search_path`.
- Toutes les fonctions publiques vérifient l'appelant (`require_player`, `require_admin`, `require_trader` ou `auth.uid()`), et toutes les `admin_*` exigent l'administrateur.

Points mineurs :
- **S1 — `private.is_admin` et l'usage du schéma `private` sont ouverts aux joueurs** : un joueur peut demander si un identifiant est celui de l'admin. **À garder** : les règles du stockage (illustrations, contributions, concours) s'évaluent avec le rôle du joueur et appellent `is_admin` pour autoriser l'admin ; le retirer casserait les envois d'images. Fuite négligeable.
- **S2 — Politiques RLS en `auth.uid()` direct** (au lieu de `(select auth.uid())`) sur 22 tables : réévalué ligne par ligne. Sans effet aujourd'hui (le site lit presque tout par fonctions), à corriger si des lectures directes se multiplient.

## 3. Sécurité du site

Conforme :
- Aucun secret dans le dépôt : `.env.local` ignoré, `.env.example` vide, aucune clé de service dans le code.
- Rendu des cartes : le SVG est inséré tel quel, mais noms, clans, fonctions et chemins d'images sont échappés avant (`Card.tsx`) ; les pseudonymes sont limités à `[lettres chiffres _ . -]`. Pas de faille XSS trouvée.
- Lectures directes de tables limitées à deux cas sans risque (liste des éditions, dernière ouverture du joueur), couverts par RLS.

À trancher :
- **S3 — L'illustration de Caïn (carte unique, tirage secret) est publique** : `public/illustrations/CAM/CAM-001.webp` et son original, donc dans le dépôt GitHub public et sur le site. Si elle doit rester une surprise, la passer dans le stockage Supabase comme les autres.
- **S4 — Fichier d'origine douteuse** : `public/illustrations/originals/here-is-everything-i-have-for-our-girl-ennoia-wolf-isnt-v0-o7m8mcvb5doh1.webp` porte un nom de fichier Reddit. Vérifier qu'on a le droit de l'utiliser, et le renommer.

## 4. Performance

### Mémoire (cause principale)
Tableau de bord, 22/10 : 432 Mo de RAM, 478 Mo de swap, engagement mémoire 1,36 Go sur 1,42 Go (« SEVERE »), processeur à 17 %. Base de 47 Mo, 11 connexions du site. Remèdes : plan Pro avec machine Micro (1 Go) ; à défaut, redémarrer le projet avant une période chargée.

### Tâches planifiées
73 échecs en 24 h, tous « job startup timeout » : pg_cron n'a pas pu lancer la tâche à temps quand la machine swappait (symptôme, pas cause). Aucun retard visible : aucune enchère ni aucun échange expiré en attente au moment de l'audit. À surveiller : si ça persiste après un passage en Micro, `max_worker_processes` (6) est à regarder.

### Index manquants (lectures complètes de table mesurées en production)

| Table | Lectures complètes | Lignes lues ainsi | Requêtes concernées | Index proposé |
|---|---|---|---|---|
| `listings` | 54 106 | 66 millions | prix de référence par carte, filtre par clan du marché | `(character_id, finish)` sur les ventes, `(kind)` sur les annonces actives |
| `friendships` | 51 281 | 12,5 millions | demandes reçues (état joueur, page Amis) | `(addressee_id)`, `(requester_id)` |
| `trades` | 67 232 | 7,7 millions | échanges du joueur, limites du jour, plafond hebdomadaire | `(proposer_id)`, `(recipient_id)` |
| `gifts` | 31 345 | 2,3 millions | cadeaux du joueur, limites du jour | `(sender_id)`, `(recipient_id)` |
| `booster_grants` | 4 120 | 4,5 millions | boosters reçus (historique, admin) | `(owner_id, created_at)` |

Pour le concours du week-end : `contest_votes (contest_id, voter_id)` et `contest_entries (contest_id, author_id)` servent à chaque affichage de la page Concours et n'ont pas d'index adapté.

Tables petites aujourd'hui, donc gain modeste ; mais elles grossissent avec les échanges, et chaque lecture complète pèse sur une mémoire déjà saturée.

### Lectures qui écrivent
- **P1 — `get_notifications`** supprime les notifications lues de plus de 60 jours à chaque ouverture de la cloche : une écriture dans une lecture fréquente (règle de `CLAUDE.md`). Aucune ligne concernée aujourd'hui ; à déplacer dans la tâche `cartema-expire-social`.
- **P2 — `get_social`** lance `private.expire_social()` (expiration de tous les cadeaux et échanges du jeu) à chaque ouverture de la page Amis, alors que la tâche planifiée le fait toutes les 5 minutes. Léger quand rien n'expire, mais même schéma que l'incident du 22/10 matin : à retirer.
- `get_player_state` et `get_achievements` écrivent par conception (bonus du jour, boosters gratuits, récompenses) mais ont déjà un chemin rapide sans écriture : conforme.
- **P3 — `get_market`** (ancienne version du marché) n'est plus appelée par le site, mais encore par trois fichiers de tests : à supprimer en même temps qu'eux, sans urgence (aucun effet sur les lags).

### Site
- Rafraîchissements automatiques : seulement la cloche (1 appel par minute, onglet visible) et les comptes à rebours (une seule fois par échéance). Aucune boucle trouvée ; aucun `useEffect` ne dépend d'une fonction passée par le parent.
- Page Marché : 4 appels par chargement et par filtre ramenés à 1 (22/10, commit `34b0311`).

## 5. Dépendances (`npm audit`, hors outils de développement)
- **`sharp`** (alertes hautes, libvips/libheif/librsvg) : sert seulement aux scripts locaux d'import d'illustrations, jamais au site. Passer en 0.35.5 (version majeure : relancer `npm run illustrations:essai` après).
- **`postcss` via `next`** (alertes sur le traitement de CSS hostile) : utilisé seulement au build, sur notre propre CSS ; aucun risque pour le site exporté. Le correctif impose Next 16 : à planifier, pas urgent.

## 6. Exploitation
- Aucun suivi des erreurs côté joueurs (déjà noté en PASSATION §8).
- Sauvegardes quotidiennes chiffrées en place ; les images du stockage ne sont pas sauvegardées.

## Plan proposé

| Priorité | Action | Effort |
|---|---|---|
| 1 | Machine Micro (plan Pro), ou redémarrage avant le concours | décision de l'admin |
| 2 | Migration « index et lectures » : index ci-dessus, P1, P2 | **faite** : `20261022310000_audit_indexes` |
| 3 | S3 Caïn et S4 fichier Reddit | décision de l'admin |
| 4 | `sharp` 0.35.5 ; Next 16 plus tard | court / à planifier |
| 5 | Suivi des erreurs côté joueurs | à étudier |
