import Link from 'next/link';
import {LEGAL} from '@/lib/legal';

export const metadata={title:'Cartema'};

/** Politique de confidentialité (RGPD). */
export default function Privacy(){
 return <div className="page legal-page">
  <header className="rise"><span className="eyebrow">Vos données</span><h1>Politique de confidentialité</h1><p className="muted">Mise à jour : {LEGAL.updated}</p></header>

  <section className="rise"><h2>Responsable du traitement</h2>
   <p>{LEGAL.editor}, éditeur de Cartema. Pour toute question ou demande : {LEGAL.contact}.</p></section>

  <section className="rise"><h2>Données collectées</h2>
   <ul>
    <li><strong>Compte</strong> : adresse e-mail et mot de passe (chiffré, jamais lisible), ou identité Discord si vous l’utilisez pour vous connecter (identifiant, nom d’utilisateur, e-mail).</li>
    <li><strong>Profil</strong> : pseudonyme, titre, vitrine, liste de souhaits, réglages de confidentialité et de notifications.</li>
    <li><strong>Jeu</strong> : cartes, boosters, Deniers et leur historique, missions, succès, ventes, enchères, échanges, cadeaux, amis.</li>
    <li><strong>Contributions et signalements</strong> : messages et images que vous envoyez volontairement.</li>
   </ul>
   <p>Aucune donnée de paiement : Cartema est gratuit et ne vend rien contre de l’argent réel.</p></section>

  <section className="rise"><h2>Pourquoi</h2>
   <ul>
    <li>Faire fonctionner votre compte et le jeu (exécution du service que vous demandez).</li>
    <li>Assurer la sécurité et l’équité : modération, lutte contre la triche, traitement des signalements (intérêt légitime).</li>
   </ul>
   <p>Pas de publicité, pas de revente, pas de profilage commercial.</p></section>

  <section className="rise"><h2>Qui y a accès</h2>
   <p>L’administrateur du jeu, pour la gestion et la modération. Les autres joueurs ne voient que ce que vous rendez public sur votre profil (pseudonyme, titre, vitrine, liste de souhaits, statistiques), selon vos réglages.</p>
   <p>Prestataires techniques : Supabase (comptes et base de données, Union européenne), GitHub (hébergement des pages du site), Discord (uniquement si vous l’utilisez pour vous connecter).</p></section>

  <section className="rise"><h2>Durée de conservation</h2>
   <p>Tant que votre compte existe. Une sauvegarde chiffrée de la base est conservée 30 jours.</p>
   <p>À la suppression du compte, l’e-mail, les identités de connexion, le pseudonyme, le titre, la vitrine, les amis, les souhaits et les notifications sont effacés. Seul reste un historique de jeu anonyme (identifiant aléatoire), nécessaire pour que les cartes échangées ou vendues à d’autres joueurs restent valides ; il ne permet plus de vous identifier.</p></section>

  <section className="rise"><h2>Vos droits</h2>
   <p>Vous pouvez à tout moment, depuis votre <Link className="text-link" href="/profile/">profil</Link> :</p>
   <ul>
    <li><strong>télécharger toutes vos données</strong> (fichier JSON, droit d’accès et de portabilité) ;</li>
    <li><strong>supprimer votre compte</strong> (droit à l’effacement) ;</li>
    <li>modifier votre pseudonyme et la visibilité de votre profil (droit de rectification).</li>
   </ul>
   <p>Pour toute autre demande (opposition, limitation, question) : {LEGAL.contact}. En cas de désaccord, vous pouvez saisir la CNIL (cnil.fr).</p></section>

  <section className="rise"><h2>Stockage sur votre appareil</h2>
   <p>Cartema n’utilise ni cookie publicitaire ni outil de mesure d’audience. Le navigateur conserve seulement votre session de connexion et quelques préférences d’affichage (catégories repliées, fermeture d’un encart) : ils sont nécessaires au fonctionnement et ne demandent pas de consentement.</p></section>

  <section className="rise"><h2>Âge</h2>
   <p>Cartema s’adresse aux personnes de {LEGAL.minimumAge} ans et plus. En dessous, l’accord d’un parent est nécessaire.</p></section>
 </div>;
}
