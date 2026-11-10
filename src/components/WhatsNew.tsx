'use client';
import {useEffect,useState} from 'react';
import {Snowflake,X} from 'lucide-react';

/**
 * Note « Nouveautés » de la mise à jour d'hiver (set 2), figée dans le site.
 * Visible du lundi 16/11/2026 16 h au lundi 30/11/2026 16 h (Paris), refermable (mémorisé sur l'appareil).
 * Jamais de carte citée ici : ni nom, ni numéro, ni rareté. N'ajouter une ligne qu'une fois la nouveauté livrée.
 * Aperçu en développement : /?nouveautes
 */
const FROM=Date.parse('2026-11-16T15:00:00Z');
const UNTIL=Date.parse('2026-11-30T15:00:00Z');
const DISMISS_KEY='cartema:whats-new:hiver-2026';
const TITLE='L’Appel des Neiges Éternelles';
const ITEMS:[string,string][]=[
 ['Un nouveau set','Appel des Neiges Éternelles rejoint la Camarilla : un nouvel album à compléter et ses propres boosters, dans leur sachet des cimes.'],
 ['L’hiver s’installe','la neige tombe sur Cartema le temps des fêtes.'],
 ['Nouveaux succès secrets','certains lient les deux sets. À vous de les débusquer.'],
 ['Protéger un personnage','depuis sa fiche : aucun de ses exemplaires ne sera recyclé, même ceux à venir.'],
 ['Doublons par rareté','choisissez les raretés à recycler d’un coup.'],
 ['Recherche sans accents','« Lucie » trouve aussi « Lucié », partout sur le site et au marché.'],
 ['Corrections','les succès de collection disent bien « Posséder », et les missions ne demandent plus de découvrir plus de visages qu’il n’en reste.'],
];

const preview=()=>process.env.NODE_ENV!=='production'&&typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('nouveautes');

export function WhatsNew(){
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  let dismissed=false;
  try{dismissed=localStorage.getItem(DISMISS_KEY)==='1';}catch{/* stockage facultatif */}
  if(preview()){setVisible(true);return;}
  if(dismissed)return;
  const now=Date.now();
  if(now>=FROM&&now<UNTIL){setVisible(true);return;}
  // Page restée ouverte jusqu'à 16 h : l'encart apparaît une seule fois, à l'échéance (moins de 24 h).
  if(now<FROM&&FROM-now<86_400_000){const t=setTimeout(()=>setVisible(true),FROM-now);return()=>clearTimeout(t);}
 },[]);
 if(!visible)return null;
 const dismiss=()=>{setVisible(false);try{localStorage.setItem(DISMISS_KEY,'1');}catch{/* stockage facultatif */}};
 return <section className="panel whats-new rise" aria-labelledby="whats-new-title">
  <span className="whats-new-frost" aria-hidden="true"/>
  <button type="button" className="icon-button whats-new-close" aria-label="Fermer les nouveautés" onClick={dismiss}><X size={16}/></button>
  <div className="whats-new-head">
   <span className="teaser-icon" aria-hidden="true"><Snowflake size={22}/></span>
   <div><span className="eyebrow">Nouveautés · mise à jour d’hiver</span><h2 id="whats-new-title">{TITLE}</h2></div>
  </div>
  <ul>{ITEMS.map(([t,d])=><li key={t}><strong>{t}.</strong> {d}</li>)}</ul>
 </section>;
}
