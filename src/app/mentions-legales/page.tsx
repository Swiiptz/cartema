import Link from 'next/link';
import {LEGAL} from '@/lib/legal';

export const metadata={title:'Cartema'};

/** Mentions légales (LCEN). */
export default function LegalNotice(){
 return <div className="page legal-page">
  <header className="rise"><span className="eyebrow">Informations légales</span><h1>Mentions légales</h1><p className="muted">Mise à jour : {LEGAL.updated}</p></header>
  <section className="rise"><h2>Éditeur</h2>
   <p>Cartema est un projet amateur, gratuit et non commercial, édité par {LEGAL.editor}.</p>
   <p>Contact : {LEGAL.contact}</p></section>
  <section className="rise"><h2>Hébergement</h2>
   <p><strong>Site</strong> : GitHub Pages, service de GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis — github.com.</p>
   <p><strong>Comptes et données de jeu</strong> : Supabase, Inc. (supabase.com), serveurs situés dans l’Union européenne (Irlande).</p></section>
  <section className="rise"><h2>Propriété intellectuelle</h2>
   <p>Les illustrations des cartes appartiennent à leurs auteurs, qui en autorisent l’usage dans Cartema ; elles ne peuvent pas être réutilisées sans leur accord. Les noms des personnages sont ceux de la chronique de jeu de rôle dont le jeu s’inspire.</p>
   <p>L’univers de référence, ses clans et ses marques appartiennent à leurs détenteurs respectifs. Cartema n’est ni affilié à ces détenteurs ni approuvé par eux.</p></section>
  <section className="rise"><h2>Données personnelles</h2>
   <p>Voir la <Link className="text-link" href="/confidentialite/">politique de confidentialité</Link>.</p></section>
 </div>;
}
