'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Award,X} from 'lucide-react';

export type UnlockedAchievement={code:string;label:string;title?:string|null;reward_deniers?:number;reward_boosters?:number;series_label?:string|null;tier?:number|null;lineage?:boolean};
const EVENT='cartema:achievements';
const TIERS=['Bronze','Argent','Or','Platine','Sang'];

/** Annonce des succès débloqués à l'instant (fin de révélation d'un booster, par exemple). */
export function announceAchievements(list:UnlockedAchievement[]){
 if(list.length&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent<UnlockedAchievement[]>(EVENT,{detail:list}));
}

/** Bannières dorées, une par succès, empilées en haut de l'écran ; chacune s'efface après quelques secondes. */
export function AchievementToasts(){
 const [items,setItems]=useState<(UnlockedAchievement&{key:number})[]>([]);
 useEffect(()=>{
  let n=0;
  const on=(e:Event)=>{
   const list=(e as CustomEvent<UnlockedAchievement[]>).detail;
   // Au plus 3 à la fois, l'une après l'autre.
   list.slice(0,6).forEach((a,i)=>setTimeout(()=>setItems(x=>[...x.slice(-2),{...a,key:++n}]),i*700));
  };
  window.addEventListener(EVENT,on);
  return()=>window.removeEventListener(EVENT,on);
 },[]);
 useEffect(()=>{
  if(!items.length)return;
  const t=setTimeout(()=>setItems(x=>x.slice(1)),5200);
  return()=>clearTimeout(t);
 },[items]);
 if(!items.length)return null;
 return <div className="ach-toasts" aria-live="polite">{items.map(a=>{
  const reward=[(a.reward_deniers??0)>0&&`+${(a.reward_deniers??0).toLocaleString('fr-FR')} Deniers`,(a.reward_boosters??0)>0&&`+${a.reward_boosters} booster${(a.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
  return <div key={a.key} className="ach-toast" role="status">
   <span className="ach-toast-shine" aria-hidden="true"/>
   <span className="ach-toast-medal" aria-hidden="true"><Award size={20}/></span>
   <Link className="ach-toast-body" href="/progression/?onglet=succes" onClick={()=>setItems(x=>x.filter(y=>y.key!==a.key))}>
    <small>{a.lineage?'Lignée complète':'Succès débloqué'}{a.tier&&a.series_label?` · ${a.series_label} ${TIERS[a.tier-1]??''}`:''}</small>
    <strong>{a.label}</strong>
    {(reward||a.title)&&<em>{reward}{reward&&a.title?' · ':''}{a.title?`titre « ${a.title} »`:''}</em>}
   </Link>
   <button className="ach-toast-close" aria-label="Fermer" onClick={()=>setItems(x=>x.filter(y=>y.key!==a.key))}><X size={14}/></button>
  </div>;})}</div>;
}
