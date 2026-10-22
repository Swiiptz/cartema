'use client';
import Link from 'next/link';
import {Clock,Palette,ScrollText} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Countdown} from './ui';

const when=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});

/** Annonce principale de l'accueil : le prochain concours, 14 jours avant son début. */
export function ContestTeaser(){
 const {player,refreshPlayer}=useAuth();
 const c=player?.contest_next;
 if(!c)return null;
 return <section className="panel contest-teaser rise" aria-label="Annonce">
  <span className="teaser-glow" aria-hidden="true"/>
  <div className="teaser-icon" aria-hidden="true"><Palette size={22}/></div>
  <div className="teaser-body">
   <span className="eyebrow">Annonce · bientôt</span>
   <h2>{c.title}</h2>
   <p>Dessinez les cartes {c.edition?`de ${c.edition}`:'de l’édition'} à votre façon : le dessin le plus voté de chaque carte marque des points, et les plus beaux deviennent des illustrations officielles du jeu.</p>
   <p className="teaser-when"><Clock size={14}/> Début {when(c.starts_at)} · dans <strong><Countdown to={c.starts_at} onDone={()=>void refreshPlayer()}/></strong></p>
  </div>
  <Link className="primary ghost compact" href="/concours/"><ScrollText size={14}/> Voir les règles</Link>
 </section>;
}
