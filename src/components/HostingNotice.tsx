'use client';
import {useEffect,useState} from 'react';
import {ChevronDown,Heart,X} from 'lucide-react';

/**
 * Bandeau d'information (18/11/2026) : retour sur l'offre gratuite de Supabase le samedi 21/11.
 * Visible jusqu'au lundi 30/11/2026 16 h (Paris), refermable (mémorisé sur l'appareil).
 */
const UNTIL=Date.parse('2026-11-30T15:00:00Z');
const DISMISS_KEY='cartema:hosting-notice:2026-11';
// Chiffres arrêtés au 18/11/2026 (figés dans le site).
const RECAP:[string,string][]=[['220','joueuses et joueurs'],['57 324','boosters ouverts'],['286 620','cartes tirées'],['25 663','ventes au marché'],['1 096','échanges'],['8 816','succès débloqués'],['154','dessins au concours'],['194','contributions acceptées']];

export function HostingNotice(){
 const [visible,setVisible]=useState(false);
 const [details,setDetails]=useState(false);
 useEffect(()=>{
  let dismissed=false;
  try{dismissed=localStorage.getItem(DISMISS_KEY)==='1';}catch{/* stockage facultatif */}
  if(!dismissed&&Date.now()<UNTIL)setVisible(true);
 },[]);
 if(!visible)return null;
 const dismiss=()=>{setVisible(false);try{localStorage.setItem(DISMISS_KEY,'1');}catch{/* stockage facultatif */}};
 return <section className="panel hosting-notice rise" aria-labelledby="hosting-notice-title">
  <button type="button" className="icon-button hosting-notice-close" aria-label="Fermer le message" onClick={dismiss}><X size={16}/></button>
  <div className="hosting-notice-head">
   <span className="teaser-icon" aria-hidden="true"><Heart size={20}/></span>
   <div><span className="eyebrow">Un mot sur la suite de Cartema</span><h2 id="hosting-notice-title">Merci à vous</h2></div>
  </div>
  <p>Cartema n’a même pas un mois, et vous en avez fait bien plus qu’un petit jeu de cartes. Merci pour votre enthousiasme, vos dessins, vos idées, vos doléances et votre patience. En chiffres, depuis le 20 octobre :</p>
  <ul className="hosting-recap">{RECAP.map(([n,label])=><li key={label}><b>{n}</b><span>{label}</span></li>)}</ul>
  <p>Pour que le jeu tourne sans ralentir, j’ai payé moi-même un serveur plus puissant ce mois-ci. Je ne pourrai pas le reconduire : à partir du <strong>samedi 21 novembre</strong>, Cartema repasse sur l’offre gratuite. <strong>Le jeu continue</strong>, vos cartes, collections et succès restent intacts ; il sera seulement plus lent et il pourra y avoir quelques bugs. Merci de votre patience, et merci d’être là. 🖤</p>
  <button type="button" className="text-link hosting-more" aria-expanded={details} aria-controls="hosting-details" onClick={()=>setDetails(d=>!d)}>Pourquoi, en détail <ChevronDown size={14} className={details?'open':''}/></button>
  {details&&<div id="hosting-details" className="hosting-details">
   <h3>Comment marche Cartema</h3>
   <p>Le site lui-même est gratuit à héberger : ce ne sont que des pages. Tout le reste (vos comptes, vos cartes, les tirages, le marché, les échanges, les illustrations) vit chez <strong>Supabase</strong>, un service qui fournit la base de données, le stockage des images et les connexions. Chaque booster ouvert, chaque vente ou chaque page de collection, c’est une demande envoyée à cette base.</p>
   <h3>Pourquoi ça ramait au début</h3>
   <p>L’offre gratuite donne une toute petite machine partagée, avec très peu de mémoire. Avec des centaines de joueurs et des milliers de boosters par jour, elle saturait : quand la mémoire est pleine, la base doit écrire sur le disque pour s’en sortir, et tout devient lent, jusqu’à des pages qui n’arrivent plus à charger.</p>
   <h3>Ce que l’offre payante a apporté</h3>
   <ul><li>une machine plus puissante, avec plus de mémoire : les pages et les ouvertures répondent vite ;</li><li>plus de place pour la base de données et les illustrations, et plus de trafic d’images autorisé ;</li><li>des sauvegardes quotidiennes de la base.</li></ul>
   <p>Elle coûte normalement environ 25 € par mois ; le premier mois était à 5 € grâce à une réduction.</p>
   <h3>Ce qui change à partir du 21 novembre</h3>
   <ul><li><strong>Plus lent</strong>, surtout le soir quand beaucoup de monde joue : ouvertures, marché et collection mettront plus de temps à répondre.</li><li><strong>Premier chargement long</strong> après une période calme : la base « se réveille ».</li><li><strong>Des plafonds</strong> : l’offre gratuite limite la taille de la base, le stockage des images et le trafic. Cartema en est déjà proche ; je ferai le ménage (anciennes images envoyées, historique) pour rester dessous.</li><li><strong>Rien n’est perdu</strong> : vos cartes, vos Deniers, vos collections et vos succès restent tels quels.</li></ul>
  </div>}
 </section>;
}
