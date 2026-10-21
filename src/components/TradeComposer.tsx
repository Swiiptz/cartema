'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeftRight,Coins} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TarotCard} from './Card';
import {Sheet,Skeleton} from './ui';
import {callRpc,socialToCard,type SocialCard,type TradeStatus} from '@/lib/game';

const MAX=10;
export type TradeDraft={friendId:string;friendHandle:string;give?:string[];take?:string[];giveDeniers?:number;takeDeniers?:number;parentId?:string;theirCards?:SocialCard[]};

/** Composition d'un échange (ou d'une contre-proposition) avec un ami. */
export function TradeComposer({client,myId,draft,onClose,onDone}:{client:SupabaseClient;myId:string;draft:TradeDraft|null;onClose:()=>void;onDone:(msg:string)=>void}){
 const [mine,setMine]=useState<SocialCard[]|null>(null);
 const [theirs,setTheirs]=useState<SocialCard[]|null>(null);
 const [give,setGive]=useState<string[]>([]);
 const [take,setTake]=useState<string[]>([]);
 const [giveDeniers,setGiveDeniers]=useState('0');
 const [takeDeniers,setTakeDeniers]=useState('0');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [status,setStatus]=useState<TradeStatus|null>(null);
 useEffect(()=>{
  if(!draft)return;
  setGive(draft.give??[]);setTake(draft.take??[]);setGiveDeniers(String(draft.giveDeniers??0));setTakeDeniers(String(draft.takeDeniers??0));setError(null);
  setMine(null);setTheirs(null);
  void callRpc<TradeStatus>(client,'get_trade_status').then(setStatus).catch(()=>setStatus(null));
  void callRpc<SocialCard[]>(client,'get_friend_cards',{p_friend_id:myId}).then(setMine).catch(e=>setError((e as Error).message));
  // Contre-proposition : les cartes engagées par l'ami dans son offre redeviennent disponibles à sa clôture.
  void callRpc<SocialCard[]>(client,'get_friend_cards',{p_friend_id:draft.friendId}).then(c=>setTheirs(dedupe([...(draft.theirCards??[]),...c]))).catch(e=>setError((e as Error).message));
 },[draft,client,myId]);
 const gd=Number(giveDeniers)||0,td=Number(takeDeniers)||0;
 const tax=status?.trade_tax_pct??0,cap=status?.trade_cap??0;
 const net=(n:number)=>n-Math.floor(n*tax/100);
 // Deniers que je peux encore recevoir par échange cette semaine (le plafond de l'ami est vérifié par le serveur).
 const room=cap>0?Math.max(0,cap-(status?.trade_received_week??0)):null;
 const overCap=room!==null&&td>room;
 const valid=give.length+take.length>0&&give.length<=MAX&&take.length<=MAX&&!overCap;
 async function submit(){
  if(!draft)return;
  setBusy(true);setError(null);
  try{
   await callRpc(client,'propose_trade',{p_recipient_id:draft.friendId,p_give:give,p_take:take,p_give_deniers:gd,p_take_deniers:td,p_request_id:crypto.randomUUID(),p_parent_id:draft.parentId??null});
   onDone(draft.parentId?'Contre-proposition envoyée.':`Proposition envoyée à ${draft.friendHandle}.`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <Sheet open={!!draft} onClose={onClose} title={draft?.parentId?'Contre-proposition':'Proposer un échange'}>
  {draft&&<div className="trade-composer">
   <p className="muted sheet-text">Avec <strong>{draft.friendHandle}</strong> · 10 cartes maximum de chaque côté. Vos cartes et vos Deniers sont réservés jusqu’à la réponse (48 h).</p>
   <Picker title="Vous donnez" cards={mine} selected={give} onToggle={id=>setGive(t=>toggle(t,id))}/>
   <label className="deniers-field"><Coins size={14}/> Deniers donnés<input inputMode="numeric" value={giveDeniers} onChange={e=>setGiveDeniers(e.target.value.replace(/[^\d]/g,''))}/></label>
   <div className="trade-swap" aria-hidden="true"><ArrowLeftRight size={18}/></div>
   <Picker title={`${draft.friendHandle} donne`} cards={theirs} selected={take} onToggle={id=>setTake(t=>toggle(t,id))}/>
   <label className="deniers-field"><Coins size={14}/> Deniers demandés<input inputMode="numeric" value={takeDeniers} onChange={e=>setTakeDeniers(e.target.value.replace(/[^\d]/g,''))}/></label>
   <p className="trade-summary">{give.length} carte{give.length>1?'s':''}{gd?` + ${gd.toLocaleString('fr-FR')} Deniers`:''} contre {take.length} carte{take.length>1?'s':''}{td?` + ${td.toLocaleString('fr-FR')} Deniers`:''}</p>
   {(gd>0||td>0)&&tax>0&&<p className="muted trade-tax">Taxe de {tax} % sur les Deniers reçus :{td>0&&<> vous recevrez <strong>{net(td).toLocaleString('fr-FR')}</strong>{gd>0?',':'.'}</>}{gd>0&&<> {draft.friendHandle} recevra <strong>{net(gd).toLocaleString('fr-FR')}</strong>.</>}</p>}
   {!!status?.trade_daily_limit&&<p className={(status.trades_today??0)>=status.trade_daily_limit?'auth-error':'muted trade-tax'}>Échanges conclus aujourd’hui : {status.trades_today??0}/{status.trade_daily_limit} (renouvelés à 6 h).</p>}
   {room!==null&&<p className={overCap?'auth-error':'muted trade-tax'}>{overCap?`Vous ne pouvez plus recevoir que ${room.toLocaleString('fr-FR')} Deniers par échange cette semaine.`:`Plafond : vous pouvez encore recevoir ${room.toLocaleString('fr-FR')} Deniers par échange cette semaine (sur ${cap.toLocaleString('fr-FR')}).`}</p>}
   {error&&<p className="auth-error" role="alert">{error}</p>}
   <button className="primary" disabled={!valid||busy} onClick={()=>void submit()}><ArrowLeftRight size={15}/> {busy?'Envoi…':draft.parentId?'Envoyer la contre-proposition':'Proposer l’échange'}</button>
  </div>}
 </Sheet>;
}

function toggle(list:string[],id:string){return list.includes(id)?list.filter(x=>x!==id):list.length>=MAX?list:[...list,id];}
function dedupe(cards:SocialCard[]){const seen=new Set<string>();return cards.filter(c=>{const k=c.instance_id??'';if(seen.has(k))return false;seen.add(k);return true;});}

function Picker({title,cards,selected,onToggle}:{title:string;cards:SocialCard[]|null;selected:string[];onToggle:(id:string)=>void}){
 const [query,setQuery]=useState('');
 const list=useMemo(()=>(cards??[]).filter(c=>!query||c.name.toLowerCase().includes(query.toLowerCase())),[cards,query]);
 return <section className="trade-picker">
  <div className="picker-head"><h3>{title}</h3><span className="muted">{selected.length}/{MAX}</span></div>
  {cards&&cards.length>8&&<input className="picker-search" placeholder="Filtrer par nom…" value={query} onChange={e=>setQuery(e.target.value)}/>}
  {!cards?<div className="picker-grid">{Array.from({length:4},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
   :cards.length===0?<p className="muted">Aucune carte disponible (les cartes verrouillées, en vente, engagées ou reçues il y a moins de 24 h n’apparaissent pas).</p>
   :<div className="picker-grid">{list.map(c=>{const on=selected.includes(c.instance_id!);return <button key={c.instance_id} className={`picker-card ${on?'on':''}`} aria-pressed={on} aria-label={`${c.name}${c.finish!=='Standard'?`, ${c.finish}`:''}`} onClick={()=>onToggle(c.instance_id!)}><TarotCard card={socialToCard(c)}/></button>;})}</div>}
 </section>;
}
