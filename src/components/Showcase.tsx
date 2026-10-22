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

/** Choix des cartes exposées, dans l'ordre des clics : une entrée par version (finition et illustration),
 * exposable autant de fois qu'on en possède d'exemplaires. */
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
 const list=useMemo(()=>(candidates??[]).filter(c=>!query||c.name.toLowerCase().includes(query.toLowerCase())),[candidates,query]);
 const copiesOf=(c:SocialCard)=>c.instances??(c.instance_id?[c.instance_id]:[]);
 const used=new Set(picked.map(p=>p.instance_id));
 const shown=(c:SocialCard)=>copiesOf(c).filter(id=>used.has(id)).length;
 /** Ajoute un exemplaire de plus ; une fois tous exposés (ou la vitrine pleine), retire cette version. */
 const choose=(c:SocialCard)=>setPicked(p=>{
  const ids=copiesOf(c);const taken=new Set(p.map(x=>x.instance_id));const next=ids.find(id=>!taken.has(id));
  if(next&&p.length<SHOWCASE_SIZE)return [...p,{...c,instance_id:next}];
  return p.filter(x=>!ids.includes(x.instance_id??''));
 });
 const remove=(i:number)=>setPicked(p=>p.filter((_,j)=>j!==i));
 const label=(c:SocialCard)=>`${c.name}${c.finish!=='Standard'?`, ${c.finish}`:''}${c.variant?`, ${c.variant}`:''}`;
 async function save(){
  setBusy(true);setError(null);
  try{onSaved(await callRpc<PublicProfile>(client,'set_showcase',{p_items:picked.map(c=>c.instance_id)}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Sheet open={open} onClose={onClose} title="Ma vitrine">
  <div className="showcase-editor">
   <p className="muted sheet-text">Choisissez jusqu’à cinq cartes, dans l’ordre d’affichage. Chaque version d’illustration se choisit à part, et une carte possédée en plusieurs exemplaires peut être exposée plusieurs fois. Touchez une carte exposée pour la retirer.</p>
   <div className="showcase compact">{Array.from({length:SHOWCASE_SIZE},(_,i)=>{const c=picked[i];return c
    ?<button key={c.instance_id??i} className="showcase-slot" aria-label={`Retirer ${label(c)}`} onClick={()=>remove(i)}><TarotCard card={socialToCard(c)}/><span className="slot-remove"><X size={12}/></span></button>
    :<div key={`vide-${i}`} className="showcase-slot empty"><span aria-hidden="true">{i+1}</span></div>;})}</div>
   {candidates&&candidates.length>8&&<input className="picker-search" placeholder="Filtrer par nom…" value={query} onChange={e=>setQuery(e.target.value)}/>}
   {!candidates?<div className="picker-grid">{Array.from({length:6},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
    :candidates.length===0?<p className="muted">Ouvrez des boosters pour garnir votre vitrine.</p>
    :<div className="picker-grid">{list.map(c=>{const n=shown(c);const total=c.copies??1;return <button key={c.instance_id??label(c)} className={`picker-card ${n?'on':''}`} aria-pressed={n>0} aria-label={`${label(c)}${total>1?` (${n} sur ${total} exposés)`:''}`} onClick={()=>choose(c)}>
     <TarotCard card={socialToCard(c)}/>
     {c.variant&&<span className="picker-variant">{c.variant}</span>}
     {total>1&&<span className={`picker-copies ${n?'on':''}`}>{n?`${n}/`:'×'}{total}</span>}
    </button>;})}</div>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <button className="primary" disabled={busy||!candidates} onClick={()=>void save()}><Check size={15}/> {busy?'Enregistrement…':'Enregistrer la vitrine'}</button>
  </div>
 </Sheet>;
}
