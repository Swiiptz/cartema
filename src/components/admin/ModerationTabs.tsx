'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Check,Gift,Trash2,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import {callRpc,type SocialCard} from '@/lib/game';
import type {AdminCharacter} from '@/lib/admin';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
type Report={id:string;category:string;message:string;status:'open'|'resolved'|'dismissed';created_at:string;closed_at:string|null;note:string|null;reporter:string|null;target:string|null;target_id:string;target_reports:number;target_suspended:boolean};
const CATEGORY:Record<string,string>={pseudo:'Pseudonyme',comportement:'Comportement',triche:'Triche ou abus',autre:'Autre'};
const STATUS:Record<string,string>={open:'Ouvert',resolved:'Traité',dismissed:'Classé sans suite'};
const when=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/** Signalements des joueurs : lecture, traitement ou classement avec note (journalisés). */
export function ReportsTab({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [status,setStatus]=useState<'open'|'all'>('open');
 const [list,setList]=useState<Report[]|null>(null);
 const load=useCallback(async()=>{setList(await callRpc<Report[]>(client,'admin_reports',{p_status:status}).catch(()=>[]));},[client,status]);
 useEffect(()=>{setList(null);void load();},[load]);
 async function close(r:Report,next:'resolved'|'dismissed'){
  const note=await reason(next==='resolved'?`Signalement de ${r.target} traité : qu’avez-vous fait ?`:`Classer sans suite le signalement de ${r.target} : pourquoi ?`,next==='resolved'?'Marquer traité':'Classer');
  if(note===null)return;
  if(await act(next==='resolved'?'Signalement traité.':'Signalement classé.',c=>callRpc(c,'admin_close_report',{p_id:r.id,p_status:next,p_note:note})))void load();
 }
 return <div className="admin-reports">
  <div className="stats-filter" role="radiogroup" aria-label="Signalements affichés">{([['open','Ouverts'],['all','Tous']] as const).map(([v,l])=><button key={v} role="radio" aria-checked={status===v} className={status===v?'on':''} onClick={()=>setStatus(v)}>{l}</button>)}</div>
  {!list?<Skeleton style={{height:160}}/>:list.length===0?<p className="muted">{status==='open'?'Aucun signalement en attente.':'Aucun signalement.'}</p>
   :<ul className="report-list">{list.map(r=><li key={r.id} className={`panel report-item ${r.status}`}>
    <div className="report-head"><span className="status-chip">{CATEGORY[r.category]??r.category}</span><strong>{r.target?<Link className="text-link" href={`/joueur/?h=${encodeURIComponent(r.target)}`}>{r.target}</Link>:'compte supprimé'}</strong>
     {r.target_reports>1&&<span className="status-chip warn">{r.target_reports} signalements</span>}{r.target_suspended&&<span className="status-chip danger">suspendu</span>}<small>{when(r.created_at)} · par {r.reporter??'—'}</small></div>
    <p className="report-message">{r.message}</p>
    {r.status==='open'?<div className="admin-actions"><button className="primary ghost compact" onClick={()=>void close(r,'resolved')}><Check size={14}/> Traité</button><button className="primary ghost compact" onClick={()=>void close(r,'dismissed')}><X size={14}/> Classer sans suite</button>
     <span className="admin-hint">Sanctions : onglet Joueurs.</span></div>
     :<p className="admin-hint">{STATUS[r.status]} le {when(r.closed_at!)}{r.note?` · ${r.note}`:''}</p>}
   </li>)}</ul>}
 </div>;
}

type OwnedCard=SocialCard&{locked:boolean;reserved_kind:string|null;acquired_at:string};
const RESERVED:Record<string,string>={listing:'en vente',auction:'aux enchères',trade:'dans un échange',gift:'offerte'};

/** Cartes d'un joueur dans sa fiche : don (personnage, finition, quantité) et retrait d'exemplaires. */
export function PlayerCards({client,act,reason,playerId,playerName,characters,onChanged}:{client:SupabaseClient;act:Act;reason:Reason;playerId:string;playerName:string;characters:AdminCharacter[];onChanged:()=>void}){
 const [cards,setCards]=useState<OwnedCard[]|null>(null);
 const [query,setQuery]=useState('');
 const [pick,setPick]=useState<AdminCharacter|null>(null);
 const [finish,setFinish]=useState('Standard');
 const [quantity,setQuantity]=useState('1');
 const [filter,setFilter]=useState('');
 const load=useCallback(async()=>{setCards(await callRpc<OwnedCard[]>(client,'admin_player_cards',{p_id:playerId}).catch(()=>[]));},[client,playerId]);
 useEffect(()=>{setCards(null);void load();},[load]);
 const matches=useMemo(()=>{const q=query.trim().toLowerCase();if(q.length<2)return [];return characters.filter(c=>c.status==='published'&&!c.is_unique&&(c.name.toLowerCase().includes(q)||String(c.number)===q)).slice(0,8);},[query,characters]);
 const shown=useMemo(()=>(cards??[]).filter(c=>!filter||c.name.toLowerCase().includes(filter.toLowerCase())||c.code.toLowerCase().includes(filter.toLowerCase())),[cards,filter]);
 async function give(){
  if(!pick)return;const n=Number(quantity);
  const r=await reason(`Donner ${n} × ${pick.name} (${finish}) à ${playerName} ?`,'Donner');if(r===null)return;
  if(await act(`${n} × ${pick.name} donné${n>1?'s':''} à ${playerName}.`,c=>callRpc(c,'admin_grant_card',{p_id:playerId,p_character_id:pick.id,p_finish:finish,p_quantity:n,p_reason:r,p_request_id:crypto.randomUUID()}))){setPick(null);setQuery('');setQuantity('1');void load();onChanged();}
 }
 async function remove(card:OwnedCard){
  const r=await reason(`Retirer un exemplaire de ${card.name} (${card.finish}) à ${playerName} ? Il ne recevra pas de Deniers ; la découverte reste.`,'Retirer');if(r===null)return;
  if(await act(`${card.name} retiré à ${playerName}.`,c=>callRpc(c,'admin_remove_card',{p_instance_id:card.instance_id,p_reason:r}))){void load();onChanged();}
 }
 return <div className="admin-moderation player-cards">
  <span className="eyebrow">Cartes</span>
  <div className="give-card">
   {pick?<div className="give-pick"><strong>{pick.name}</strong><span className="admin-hint">n° {pick.number} · {pick.rarity}</span><button className="icon-button" aria-label="Changer de personnage" onClick={()=>setPick(null)}><X size={14}/></button></div>
    :<><input className="picker-search" placeholder="Donner une carte : nom ou numéro…" value={query} onChange={e=>setQuery(e.target.value)}/>
     {matches.length>0&&<ul className="friend-pick">{matches.map(c=><li key={c.id}><button onClick={()=>{setPick(c);setQuery('');}}>{c.number}. {c.name} · {c.rarity}</button></li>)}</ul>}</>}
   {pick&&<div className="admin-row give-row">
    <label className="auth-field"><span>Finition</span><select value={finish} onChange={e=>setFinish(e.target.value)}>{['Standard','Dorée','Sanglante'].map(f=><option key={f}>{f}</option>)}</select></label>
    <label className="auth-field"><span>Quantité</span><input inputMode="numeric" value={quantity} onChange={e=>setQuantity(e.target.value.replace(/\D/g,'').slice(0,2))}/></label>
    <button className="primary compact" disabled={!(Number(quantity)>=1&&Number(quantity)<=20)} onClick={()=>void give()}><Gift size={14}/> Donner</button></div>}
  </div>
  {!cards?<Skeleton style={{height:80}}/>:<>
   <div className="owned-head"><span className="admin-hint">{cards.length} exemplaire{cards.length>1?'s':''}</span>{cards.length>8&&<input className="picker-search" placeholder="Filtrer…" value={filter} onChange={e=>setFilter(e.target.value)}/>}</div>
   <ul className="owned-admin">{shown.map(c=><li key={c.instance_id}><span>{c.code} · <strong>{c.name}</strong>{c.finish!=='Standard'?` · ${c.finish}`:''}{c.locked?' · verrouillée':''}{c.reserved_kind?` · ${RESERVED[c.reserved_kind]??c.reserved_kind}`:''}</span>
    <button className="icon-button" disabled={!!c.reserved_kind||c.unique} title={c.reserved_kind?'Engagée : annulez d’abord la vente ou l’échange':c.unique?'Carte unique':'Retirer cet exemplaire'} aria-label={`Retirer ${c.name}`} onClick={()=>void remove(c)}><Trash2 size={14}/></button></li>)}</ul>
  </>}
 </div>;
}
