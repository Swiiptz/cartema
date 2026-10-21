# Sauvegardes de la base

Chaque nuit (vers 3 h – 4 h, heure de Paris), le workflow **Sauvegarde de la base**
(`.github/workflows/backup.yml`) exporte la base Supabase, la chiffre et la garde **30 jours**
dans l'onglet *Actions* du dépôt GitHub. On peut aussi la lancer à la main (*Run workflow*).

## Ce qui est sauvegardé

- Les données du jeu (`public`, `private`) : joueurs, Deniers et historique, cartes possédées,
  catalogue, marché, échanges, succès, missions, événements, journal d'administration.
- Les comptes (`auth`) : e-mails, identités Discord, mots de passe chiffrés par Supabase.
  Les sessions et journaux de connexion, éphémères, sont exclus.
- Les métadonnées des fichiers (`storage`), **pas les images elles-mêmes**. Les originaux
  importés restent dans `illustrations/importees/` sur l'ordinateur de l'administrateur.
- `structure.sql` : la structure lisible, à comparer avec `supabase/migrations/`.

Le fichier est chiffré en AES-256 avec la phrase `BACKUP_PASSPHRASE` : **sans elle, la
sauvegarde est illisible**, y compris pour vous. Gardez-la hors de GitHub (gestionnaire de mots
de passe).

## Mise en place (une fois)

Dans GitHub : *Settings › Secrets and variables › Actions › New repository secret*.

1. `SUPABASE_DB_URL` : dans Supabase, bouton **Connect** en haut du projet › *Session pooler*,
   copier l'URI (elle commence par `postgresql://postgres.grlpysqlabwylexinbrl:` et se termine
   par `:5432/postgres`), puis remplacer `[YOUR-PASSWORD]` par le mot de passe de la base.
2. `BACKUP_PASSPHRASE` : une longue phrase secrète (20 caractères minimum).

Puis *Actions › Sauvegarde de la base › Run workflow* pour vérifier (environ 1 minute, coche
verte, artefact `cartema-AAAA-MM-JJ` en bas de la page du lancement).

GitHub suspend les tâches planifiées d'un dépôt public sans activité depuis 60 jours : un
simple commit (ou *Enable workflow*) les relance.

## Restaurer

1. Télécharger l'artefact du jour voulu (*Actions* › lancement › *Artifacts*), le dézipper.
2. Déchiffrer :
   ```bash
   gpg --decrypt cartema-AAAA-MM-JJ.tar.gz.gpg > sauvegarde.tar.gz
   tar -xzf sauvegarde.tar.gz
   ```
3. Dans un projet Supabase vierge, appliquer d'abord la structure : `npx supabase db push`
   (migrations du dépôt), puis les données sans recréer les tables :
   ```bash
   pg_restore --data-only --no-owner --disable-triggers --schema=public --schema=private --schema=auth --dbname="<URI session pooler>" sauvegarde/cartema.dump
   ```
   `--disable-triggers` évite que les garde-fous (registre append-only, carte unique…) bloquent
   le rechargement de données déjà cohérentes.
4. Pour récupérer seulement une table ou un joueur, restaurer d'abord dans une base de test et
   recopier ce qui manque, plutôt que d'écraser la base en ligne.
