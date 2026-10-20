'use client';
import {useEffect,useMemo,useState} from 'react';
import {Check,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TarotCard} from './Card';
import {CardInspection} from './CardInspection';
import {Sheet,Skeleton} from './ui';
import {callRpc,socialToCard,type PublicProfile,type SocialCard} from '@/lib/game';

export const SHOWCASE_SIZE=5;

/** Vitrine de cinq emplacements ; les emplacements vides restent visibles en filigrane. */
export function Showcase({cards,empty}:{cards:SocialCard[];empty?:string}){
 return <div className="showcase">
  {Array.from({length:SHOWCASE_SIZE},(_,i)=>{const c=cards[i];return <div key={c?.instance_id??`vide-${i}`} className={`showcase-slot rise ${c?'':'empty'}`} style={{'--i':i} as React.CSSProperties}>
   {c?<CardInspection card={socialToCard(c)}/>:<span aria-hidden="true">✧</span>}
  </div>;})}
  {!cards.length&&empty&&<p className="muted showcase-empty">{empty}</p>}
 </div>;
}

/** Choix des cartes exposées : un exemplaire par personnage et finition, dans l'ordre des clics. */
export function ShowcaseEditor({client,open,current,onClose,onSaved}:{client:SupabaseClient;open:boolean;current:SocialCard[];onClose:()=>void;onSaved:(p:PublicProfile)=>void}){
 const [candidates,setCandidates]=useState<SocialCard[]|null>(null);
 const [picked,setPicked]=useState<SocialCard[]>([]);
 const [query,setQuery]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  if(!open)return;
  setPicked(current);setQuery('');setError(null);setCandidates(null);
  void callRpc<SocialCard[]>(client,'get_showcase_candidates').then(setCandidates).catch(e=>setError((e as Error).message));
 },[open,client,current]);
 const key=(c:SocialCard)=>`${c.character_id}:${c.finish}`;
 const pickedKeys=new Set(picked.map(key));
 const list=useMemo(()=>(candidates??[]).filter(c=>!query||c.name.toLowerCase().includes(query.toLowerCase())),[candidates,query]);
 const toggle=(c:SocialCard)=>setPicked(p=>pickedKeys.has(key(c))?p.filter(x=>key(x)!==key(c)):p.length>=SHOWCASE_SIZE?p:[...p,c]);
 async function save(){
  setBusy(true);setError(null);
  try{onSaved(await callRpc<PublicProfile>(client,'set_showcase',{p_items:picked.map(c=>c.instance_id)}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Sheet open={open} onClose={onClose} title="Ma vitrine">
  <div className="showcase-editor">
   <p className="muted sheet-text">Choisissez jusqu’à cinq cartes, dans l’ordre d’affichage. Touchez une carte exposée pour la retirer.</p>
   <div className="showcase compact">{Array.from({length:SHOWCASE_SIZE},(_,i)=>{const c=picked[i];return c
    ?<button key={key(c)} className="showcase-slot" aria-label={`Retirer ${c.name}`} onClick={()=>toggle(c)}><TarotCard card={socialToCard(c)}/><span className="slot-remove"><X size={12}/></span></button>
    :<div key={`vide-${i}`} className="showcase-slot empty"><span aria-hidden="true">{i+1}</span></div>;})}</div>
   {candidates&&candidates.length>8&&<input className="picker-search" placeholder="Filtrer par nom…" value={query} onChange={e=>setQuery(e.target.value)}/>}
   {!candidates?<div className="picker-grid">{Array.from({length:6},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
    :candidates.length===0?<p className="muted">Ouvrez des boosters pour garnir votre vitrine.</p>
    :<div className="picker-grid">{list.map(c=>{const on=pickedKeys.has(key(c));return <button key={key(c)} className={`picker-card ${on?'on':''}`} aria-pressed={on} aria-label={`${c.name}${c.finish!=='Standard'?`, ${c.finish}`:''}`} onClick={()=>toggle(c)}><TarotCard card={socialToCard(c)}/></button>;})}</div>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <button className="primary" disabled={busy||!candidates} onClick={()=>void save()}><Check size={15}/> {busy?'Enregistrement…':'Enregistrer la vitrine'}</button>
  </div>
 </Sheet>;
}
