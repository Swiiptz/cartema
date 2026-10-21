'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Heart,Store,Users,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TarotCard} from './Card';
import {Skeleton} from './ui';
import {callRpc,silhouetteIndex,type WishItem,type Wishlist} from '@/lib/game';
import type {Rarity} from '@/lib/draw';

/** Clé d'un souhait : numéro de carte + finition (« * » = toutes). */
export const wishKey=(code:string,finish?:string|null)=>`${code}|${finish||'*'}`;
const WISH_FINISHES:[string|null,string][]=[[null,'Toutes'],['Dorée','Dorée'],['Sanglante','Sanglante']];

export function wishToCard(w:WishItem){
 return {id:w.code,name:w.name??'Inconnu',clan:w.known?w.clan??'?':'Inconnu',role:w.role_title??'',rarity:w.rarity as Rarity,known:w.known,
  finish:w.finish??undefined,illustration:w.art_path??undefined,silhouette:silhouetteIndex(w.silhouette_key),
  artLayout:w.art_meta?.layout==='full'||w.art_meta?.layout==='cover'?w.art_meta.layout:undefined,artOffsetY:Number(w.art_meta?.offsetY)||undefined};
}

/** Liste de souhaits du joueur connecté, chargée une fois et partagée par la page. */
export function useWishes(client:SupabaseClient|null,enabled:boolean){
 const [keys,setKeys]=useState<Set<string>>(new Set());
 const load=useCallback(async()=>{
  if(!client||!enabled)return;
  try{const w=await callRpc<Wishlist>(client,'get_wishlist',{p_handle:null});setKeys(new Set(w.items.map(i=>wishKey(i.code,i.finish))));}catch{/* facultatif */}
 },[client,enabled]);
 useEffect(()=>{void load();},[load]);
 const toggle=useCallback(async(code:string,finish:string|null,on:boolean)=>{
  if(!client)return;
  const k=wishKey(code,finish);
  setKeys(s=>{const n=new Set(s);if(on)n.add(k);else n.delete(k);return n;});
  try{await callRpc(client,'set_wish',{p_code:code,p_finish:finish,p_on:on});}
  catch(e){setKeys(s=>{const n=new Set(s);if(on)n.delete(k);else n.add(k);return n;});throw e;}
 },[client]);
 return {keys,toggle,reload:load};
}

/** Choix « je cherche cette carte » dans la fiche : toute finition, ou Dorée / Sanglante précise. */
export function WishPicker({code,keys,onToggle}:{code:string;keys:Set<string>;onToggle:(code:string,finish:string|null,on:boolean)=>Promise<void>}){
 const [error,setError]=useState<string|null>(null);
 const any=[...keys].some(k=>k.startsWith(`${code}|`));
 return <div className="wish-picker">
  <span className="eyebrow"><Heart size={12} className={any?'wished':''}/> Je cherche cette carte</span>
  <div className="finish-switch" aria-label="Ajouter à la liste de souhaits">{WISH_FINISHES.map(([f,l])=>{const on=keys.has(wishKey(code,f));return <button key={l} className={on?'active':''} aria-pressed={on}
   onClick={()=>{setError(null);onToggle(code,f,!on).catch(e=>setError((e as Error).message));}}>{l}</button>;})}</div>
  <small>{error??(any?'Vous serez prévenu dès qu’elle est mise en vente.':'Ajoutez-la à votre liste de souhaits, visible sur votre profil.')}</small>
 </div>;
}

/** Liste de souhaits : la sienne (disponibilités, amis, retrait) ou celle d'un autre joueur. */
export function WishlistView({client,handle,own}:{client:SupabaseClient;handle:string|null;own:boolean}){
 const [data,setData]=useState<Wishlist|null>(null);
 const load=useCallback(async()=>{try{setData(await callRpc<Wishlist>(client,'get_wishlist',{p_handle:handle}));}catch{setData({visible:false,items:[]});}},[client,handle]);
 useEffect(()=>{void load();},[load]);
 async function remove(w:WishItem){await callRpc(client,'set_wish',{p_code:w.code,p_finish:w.finish,p_on:false});void load();}
 if(!data)return <Skeleton style={{height:120}}/>;
 if(!data.visible)return null;
 if(!data.items.length)return <p className="muted wish-empty">{own?'Aucune carte souhaitée. Ouvrez une carte de votre collection et touchez « Je cherche cette carte ».':'Aucune carte souhaitée pour l’instant.'}</p>;
 return <ul className="wish-list">{data.items.map(w=><li key={wishKey(w.code,w.finish)} className="wish-item rise">
  <span className="wish-thumb"><TarotCard card={wishToCard(w)}/></span>
  <div className="wish-info">
   <strong>{w.known?w.name:'Carte voilée'}</strong>
   <span className="wish-meta">{w.code} · {w.rarity}{w.finish?` · ${w.finish} seulement`:''}</span>
   {own&&<>
    {(w.on_market??0)>0?<Link className="wish-status market" href="/market/"><Store size={13}/> {w.on_market} en vente{w.best_price?` · dès ${w.best_price.toLocaleString('fr-FR')} Deniers`:''}</Link>:<span className="wish-status">Pas en vente pour l’instant</span>}
    {(w.friends?.length??0)>0&&<Link className="wish-status friends" href="/amis/"><Users size={13}/> Chez {w.friends!.join(', ')}</Link>}
    {(w.owned??0)>0&&<span className="wish-status owned">Déjà possédée ×{w.owned}</span>}
   </>}
  </div>
  {own&&<button className="icon-button wish-remove" aria-label={`Retirer ${w.code} des souhaits`} onClick={()=>void remove(w)}><X size={15}/></button>}
 </li>)}</ul>;
}
