'use client';
import {useEffect,useState} from 'react';
import {Snowflake} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {callRpc} from '@/lib/game';

/**
 * Thème d'hiver (mise à jour d'hiver 2026), placé dans l'en-tête : allumé par le réglage Économie winter_theme,
 * lu une fois par visite. Chaque joueur peut le couper avec le bouton flocon (mémorisé sur l'appareil).
 * Ajoute la classe « winter » sur <html> (nuit froide : globals.css) et une neige en profondeur :
 * flocons doux sur trois plans, quelques cristaux fins. Chute et balancement séparés (transform seulement).
 * Aperçu en développement : ?hiver
 */
const OFF_KEY='cartema:winter-off';
// Flocons figés (pas de hasard au rendu) : position, taille, opacité, durée, décalage, amplitude du balancement.
const FLAKES=Array.from({length:26},(_,i)=>{
 const plane=i%3; // 0 = lointain (petit, lent), 1 = milieu, 2 = proche (grand, flou, rare)
 const crystal=i%7===3;
 return {crystal,plane,style:{
  '--l':`${(i*37+11)%100}%`,
  '--s':crystal?`${16+(i%3)*5}px`:plane===0?'4px':plane===1?'6px':`${10+(i%2)*5}px`,
  '--o':crystal?.5:plane===0?.55:plane===1?.7:.25,
  '--d':`${plane===0?26:plane===1?18:13}s`,
  '--dl':`${-((i*53)%26)}s`,
  '--w':`${plane===0?10:plane===1?18:30}px`,
  '--sw':`${4+(i%4)}s`,
 } as React.CSSProperties};
});
export function WinterTheme(){
 const {client}=useAuth();
 const [enabled,setEnabled]=useState(false);
 const [off,setOff]=useState(false);
 useEffect(()=>{
  try{setOff(localStorage.getItem(OFF_KEY)==='1');}catch{/* stockage facultatif */}
  if(process.env.NODE_ENV!=='production'&&new URLSearchParams(window.location.search).has('hiver')){setEnabled(true);return;}
  if(!client)return;
  let alive=true;
  void callRpc<{winter?:boolean}>(client,'get_features').then(f=>{if(alive)setEnabled(!!f?.winter);}).catch(()=>{});
  return()=>{alive=false;};
 },[client]);
 const on=enabled&&!off;
 useEffect(()=>{
  document.documentElement.classList.toggle('winter',on);
  return()=>document.documentElement.classList.remove('winter');
 },[on]);
 if(!enabled)return null;
 const toggle=()=>{const next=!off;setOff(next);try{localStorage.setItem(OFF_KEY,next?'1':'0');}catch{/* stockage facultatif */}};
 return <>
  <button type="button" className="winter-toggle" aria-pressed={on} title={on?'Couper la neige':'Remettre la neige'} aria-label={on?'Couper le thème d’hiver':'Remettre le thème d’hiver'} onClick={toggle}><Snowflake size={16}/></button>
  {on&&<div className="snowfall" aria-hidden="true">{FLAKES.map((f,i)=><span key={i} className={`plane-${f.plane}`} style={f.style}><i className={f.crystal?'crystal':undefined}/></span>)}</div>}
 </>;
}
