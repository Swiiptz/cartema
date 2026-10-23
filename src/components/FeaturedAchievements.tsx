'use client';
import {useEffect,useState} from 'react';
import {Award,Check} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {palette} from './Card';
import {Sheet,Skeleton} from './ui';
import {callRpc,TIER_COLORS,tierName,type Achievement,type FeaturedAchievement,type PublicProfile} from '@/lib/game';

export const FEATURED_MAX=3;
const color=(a:{tier?:number|null;rarity?:string|null})=>a.rarity?palette[a.rarity as keyof typeof palette]:a.tier?TIER_COLORS[a.tier-1]:'var(--gold)';

/** Succès choisis par le joueur, présentés comme des médailles. */
export function FeaturedAchievements({list,empty}:{list:FeaturedAchievement[];empty?:string}){
 if(!list.length)return empty?<p className="muted featured-empty">{empty}</p>:null;
 return <ul className="featured-list">{list.map((a,i)=><li key={a.code} className="featured rise" style={{'--i':i,'--rc':color(a)} as React.CSSProperties}>
  <span className="featured-medal" aria-hidden="true"><Award size={22}/></span>
  <div><strong>{a.label}</strong>{(a.series_label||a.tier)&&<small className="featured-tier">{a.series_label}{a.tier?` · ${tierName(a)}`:''}</small>}<p>{a.description}</p></div>
 </li>)}</ul>;
}

/** Choix des succès mis en avant parmi les succès débloqués (3 au plus, dans l'ordre des clics). */
export function FeaturedEditor({client,open,current,onClose,onSaved}:{client:SupabaseClient;open:boolean;current:FeaturedAchievement[];onClose:()=>void;onSaved:(p:PublicProfile)=>void}){
 const [list,setList]=useState<Achievement[]|null>(null);
 const [picked,setPicked]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  if(!open)return;
  setPicked(current.map(a=>a.code));setError(null);setList(null);
  void callRpc<Achievement[]>(client,'get_achievements').then(a=>setList(a.filter(x=>x.unlocked_at&&x.label))).catch(e=>setError((e as Error).message));
 },[open,client,current]);
 const toggle=(code:string)=>setPicked(p=>p.includes(code)?p.filter(c=>c!==code):p.length>=FEATURED_MAX?p:[...p,code]);
 async function save(){
  setBusy(true);setError(null);
  try{onSaved(await callRpc<PublicProfile>(client,'set_featured_achievements',{p_codes:picked}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Sheet open={open} onClose={onClose} title="Succès mis en avant">
  <div className="showcase-editor">
   <p className="muted sheet-text">Choisissez jusqu’à {FEATURED_MAX} succès à montrer sur votre profil ({picked.length}/{FEATURED_MAX}). Un succès secret mis en avant est révélé aux autres joueurs.</p>
   {!list?<Skeleton style={{height:200}}/>:list.length===0?<p className="muted">Aucun succès débloqué pour l’instant.</p>
    :<ul className="featured-picker">{list.map(a=>{const i=picked.indexOf(a.code);return <li key={a.code}><button className={i>=0?'on':''} aria-pressed={i>=0} onClick={()=>toggle(a.code)} style={{'--rc':color(a)} as React.CSSProperties}>
     <span className="featured-pick-mark">{i>=0?i+1:<Award size={14}/>}</span><span><strong>{a.label}</strong>{a.series_label&&<small>{a.series_label}{a.tier?` · ${tierName(a)}`:''}</small>}</span></button></li>;})}</ul>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <button className="primary" disabled={busy||!list} onClick={()=>void save()}><Check size={15}/> {busy?'Enregistrement…':'Enregistrer'}</button>
  </div>
 </Sheet>;
}
