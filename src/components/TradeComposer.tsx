'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeftRight,Coins,Heart,X,ZoomIn} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TarotCard} from './Card';
import {Sheet,Skeleton} from './ui';
import {callRpc,socialToCard,type SocialCard,type TradeStatus,type WishItem,type Wishlist} from '@/lib/game';

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
 // Listes de souhaits : la mienne (cartes à repérer chez l'ami) et la sienne, si elle est visible.
 const [myWishes,setMyWishes]=useState<WishItem[]>([]);
 const [theirWishes,setTheirWishes]=useState<WishItem[]>([]);
 useEffect(()=>{
  if(!draft)return;
  setGive(draft.give??[]);setTake(draft.take??[]);setGiveDeniers(String(draft.giveDeniers??0));setTakeDeniers(String(draft.takeDeniers??0));setError(null);
  setMine(null);setTheirs(null);setMyWishes([]);setTheirWishes([]);
  void callRpc<Wishlist>(client,'get_wishlist').then(w=>setMyWishes(w.items)).catch(()=>{});
  void callRpc<Wishlist>(client,'get_wishlist',{p_handle:draft.friendHandle}).then(w=>setTheirWishes(w.visible?w.items:[])).catch(()=>{});
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
   <Picker title="Vous donnez" cards={mine} selected={give} onToggle={id=>setGive(t=>toggle(t,id))} wishes={theirWishes} wishLabel={`Recherchée par ${draft.friendHandle}`} wishHint={n=>`${draft.friendHandle} recherche ${n} de vos cartes`}/>
   <label className="deniers-field"><Coins size={14}/> Deniers donnés<input inputMode="numeric" value={giveDeniers} onChange={e=>setGiveDeniers(e.target.value.replace(/[^\d]/g,''))}/></label>
   <div className="trade-swap" aria-hidden="true"><ArrowLeftRight size={18}/></div>
   <Picker title={`${draft.friendHandle} donne`} cards={theirs} selected={take} onToggle={id=>setTake(t=>toggle(t,id))} wishes={myWishes} wishLabel="Dans votre liste de souhaits" wishHint={n=>`${n} carte${n>1?'s':''} de votre liste de souhaits`}/>
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

/** Carte agrandie par-dessus la fenêtre d'échange ; Échap la ferme sans fermer l'échange. */
function CardZoom({card,on,wished,onToggle,onClose}:{card:SocialCard;on:boolean;wished:string|null;onToggle:()=>void;onClose:()=>void}){
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{close.current?.focus();},[]);
 return <div className="picker-zoom" role="dialog" aria-modal="true" aria-label={card.name} onClick={e=>{if(e.target===e.currentTarget)onClose();}}
  onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}}>
  <div className="picker-zoom-card"><TarotCard card={socialToCard(card)}/></div>
  {wished&&<p className="picker-wish"><Heart size={13}/> {wished}</p>}
  <div className="picker-zoom-actions"><button type="button" className="primary ghost" ref={close} onClick={onClose}><X size={15}/> Fermer</button>
   <button type="button" className="primary" onClick={()=>{onToggle();onClose();}}>{on?'Retirer de l’échange':'Choisir cette carte'}</button></div>
 </div>;
}

/** Carte souhaitée : même numéro, et même finition si le souhait en précise une. */
const wished=(c:SocialCard,wishes:WishItem[])=>wishes.some(w=>w.code===c.code&&(!w.finish||w.finish===c.finish));

function Picker({title,cards,selected,onToggle,wishes,wishLabel,wishHint}:{title:string;cards:SocialCard[]|null;selected:string[];onToggle:(id:string)=>void;wishes:WishItem[];wishLabel:string;wishHint:(n:number)=>string}){
 const [query,setQuery]=useState('');
 const [zoom,setZoom]=useState<SocialCard|null>(null);
 // Les cartes souhaitées passent en tête.
 const list=useMemo(()=>(cards??[]).filter(c=>!query||c.name.toLowerCase().includes(query.toLowerCase())).map(c=>({c,w:wished(c,wishes)})).sort((a,b)=>Number(b.w)-Number(a.w)),[cards,query,wishes]);
 const matches=useMemo(()=>(cards??[]).filter(c=>wished(c,wishes)).length,[cards,wishes]);
 return <section className="trade-picker">
  <div className="picker-head"><h3>{title}</h3><span className="muted">{selected.length}/{MAX}</span></div>
  {matches>0&&<p className="picker-wish"><Heart size={13}/> {wishHint(matches)}</p>}
  {cards&&cards.length>8&&<input className="picker-search" placeholder="Filtrer par nom…" value={query} onChange={e=>setQuery(e.target.value)}/>}
  {!cards?<div className="picker-grid">{Array.from({length:4},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
   :cards.length===0?<p className="muted">Aucune carte disponible (les cartes verrouillées, en vente, engagées ou reçues il y a moins de 72 h n’apparaissent pas).</p>
   :<div className="picker-grid">{list.map(({c,w})=>{const on=selected.includes(c.instance_id!);const name=`${c.name}${c.finish!=='Standard'?`, ${c.finish}`:''}`;return <div key={c.instance_id} className="picker-cell">
    <button className={`picker-card ${on?'on':''} ${w?'wished':''}`} aria-pressed={on} aria-label={`${name}${w?` · ${wishLabel}`:''}`} title={w?wishLabel:undefined} onClick={()=>onToggle(c.instance_id!)}><TarotCard card={socialToCard(c)}/>{w&&<span className="picker-heart" aria-hidden="true"><Heart size={10}/></span>}</button>
    <button type="button" className="picker-zoom-btn" aria-label={`Agrandir ${name}`} onClick={()=>setZoom(c)}><ZoomIn size={12}/></button></div>;})}</div>}
  {zoom&&<CardZoom card={zoom} on={selected.includes(zoom.instance_id!)} wished={wished(zoom,wishes)?wishLabel:null} onToggle={()=>onToggle(zoom.instance_id!)} onClose={()=>setZoom(null)}/>}
 </section>;
}
