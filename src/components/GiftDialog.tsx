'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Gift,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {callRpc,type Friends} from '@/lib/game';
import {Skeleton} from './ui';

/** Choix de l'ami à qui offrir un exemplaire. */
export function GiftDialog({open,client,name,onCancel,onConfirm}:{open:boolean;client:SupabaseClient;name:string;onCancel:()=>void;onConfirm:(friendId:string,handle:string)=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 const [friends,setFriends]=useState<Friends['friends']|null>(null);
 const [choice,setChoice]=useState<string|null>(null);
 useEffect(()=>{const d=ref.current;if(!d)return;
  if(open&&!d.open){setChoice(null);setFriends(null);d.showModal();void callRpc<Friends>(client,'get_friends').then(f=>setFriends(f.friends)).catch(()=>setFriends([]));}
  if(!open&&d.open)d.close();},[open,client]);
 const picked=friends?.find(f=>f.profile_id===choice);
 return <dialog ref={ref} className="ask-dialog" aria-label="Offrir une carte" onCancel={e=>{e.preventDefault();onCancel();}} onClose={e=>e.stopPropagation()} onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
  <div className="ask-dialog-body">
   <div className="sell-head"><h2>Offrir {name}</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={onCancel}><X size={18}/></button></div>
   <p className="muted">Votre ami doit accepter. Sans réponse sous 48 h, ou en cas de refus, la carte vous revient.</p>
   {!friends?<Skeleton style={{height:90}}/>:friends.length===0?<p className="muted">Vous n’avez pas encore d’amis. <Link className="text-link" href="/amis/">Inviter un collectionneur</Link></p>
    :<ul className="friend-pick" role="radiogroup" aria-label="Ami destinataire">{friends.map(f=><li key={f.profile_id}><button role="radio" aria-checked={choice===f.profile_id} className={choice===f.profile_id?'on':''} onClick={()=>setChoice(f.profile_id)}><span className="person-sigil">{f.handle[0]?.toUpperCase()}</span>{f.handle}</button></li>)}</ul>}
   <div className="ask-dialog-actions"><button className="primary ghost" onClick={onCancel}>Annuler</button><button className="primary" disabled={!picked} onClick={()=>picked&&onConfirm(picked.profile_id,picked.handle)}><Gift size={15}/> Offrir</button></div>
  </div>
 </dialog>;
}
