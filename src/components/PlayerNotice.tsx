'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Check,Sparkles} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {CardBack,TarotCard,type DemoCard} from './Card';
import {eterPreview} from '@/data/demo';
import {Sheet} from './ui';
import {callRpc,socialToCard,type SocialCard} from '@/lib/game';

type RestoredCard={code:string;card:string;rarity:string;finish:string;version:string};
type Notice={id:string;kind:string;created_at:string;
 payload:{cards?:RestoredCard[];deniers?:number;value?:number;card?:SocialCard;quantity?:number}};
const KINDS=['versions_restored','eternal_gift'];

/** Fenêtre d'information montrée une seule fois à un joueur (lue une fois par chargement, fermée pour de bon). */
export function PlayerNotice(){
 const {client,player,refreshPlayer}=useAuth();
 const refreshRef=useRef(refreshPlayer);refreshRef.current=refreshPlayer;
 const [notice,setNotice]=useState<Notice|null>(null);
 const [busy,setBusy]=useState(false);
 // Une seule lecture par joueur et par chargement du site.
 const loadedFor=useRef<string|null>(null);
 const playerId=player?.profile.id??null;
 useEffect(()=>{
  if(!client||!playerId||loadedFor.current===playerId)return;
  loadedFor.current=playerId;
  void callRpc<Notice|null>(client,'get_player_notice').then(n=>{if(n&&KINDS.includes(n.kind))setNotice(n);}).catch(()=>{});
 },[client,playerId]);
 async function close(){
  if(!client||!notice)return;
  setBusy(true);
  try{await callRpc(client,'dismiss_player_notice',{p_id:notice.id});}catch{/* elle reviendra au prochain chargement */}
  finally{setBusy(false);setNotice(null);void refreshRef.current();}
 }
 // « ?cadeau-eter » (développement seulement) : rejoue la carte éternelle offerte, sans compte ni base.
 const [demo,setDemo]=useState(false);
 useEffect(()=>{if(process.env.NODE_ENV!=='production'&&new URLSearchParams(window.location.search).has('cadeau-eter'))setDemo(true);},[]);
 if(demo)return <EternalGift card={eterPreview[2]} quantity={1} busy={false} onDone={()=>setDemo(false)}/>;
 if(!notice)return null;
 if(notice.kind==='eternal_gift'&&notice.payload.card)return <EternalGift card={socialToCard(notice.payload.card)} quantity={notice.payload.quantity??1} busy={busy} onDone={()=>void close()}/>;
 const cards=notice.payload.cards??[];const taken=notice.payload.deniers??0;const value=notice.payload.value??taken;
 const d=(n:number)=>`${n.toLocaleString('fr-FR')} Denier${n>1?'s':''}`;
 return <Sheet open onClose={()=>void close()} title={cards.length>1?'Vos versions rares vous sont rendues':'Votre version rare vous est rendue'}>
  <div className="player-notice">
   <p className="muted sheet-text">Un bug du bouton « Recycler les doublons » a recyclé {cards.length>1?'des versions d’illustration rares':'une version d’illustration rare'} sans que vous l’ayez choisi. {cards.length>1?`Ces ${cards.length} cartes sont de retour`:'Cette carte est de retour'} dans votre collection :</p>
   <ul className="notice-cards">{cards.map((c,i)=><li key={`${c.code}-${i}`}><strong>{c.code} · {c.card}</strong><small>{c.version} · {c.rarity}{c.finish&&c.finish!=='Standard'?` · ${c.finish}`:''}</small></li>)}</ul>
   <p className="muted sheet-text">{taken>0?`Les ${d(taken)} reçus pour ${cards.length>1?'ces cartes':'cette carte'} ont été repris${taken<value?` (sur ${d(value)}, pour ne pas vider votre solde)`:''}.`:value>0?'Les Deniers reçus pour ces cartes vous restent.':''} Si vous voulez quand même {cards.length>1?'les':'la'} recycler, vous pouvez le faire depuis {cards.length>1?'leur':'sa'} fiche : les versions rares ne partent plus avec les doublons. Désolé pour la gêne.</p>
   <div className="notice-actions"><Link className="text-link" href="/collection/" onClick={()=>void close()}>Voir ma collection</Link>
    <button className="primary" disabled={busy} onClick={()=>void close()}><Check size={15}/> Compris</button></div>
  </div>
 </Sheet>;
}

/**
 * Carte éternelle offerte par l'équipe : d'abord une invitation (la carte face cachée), puis, au toucher de
 * « Recevoir la carte », la grande révélation des éternelles en plein écran — éclair, brume, halo,
 * particules, et la carte qui tourne sur elle-même avant de se poser face visible.
 */
function EternalGift({card,quantity,busy,onDone}:{card:DemoCard;quantity:number;busy:boolean;onDone:()=>void}){
 const [phase,setPhase]=useState<'invite'|'reveal'>('invite');
 const [shown,setShown]=useState(false);
 const [ready,setReady]=useState(false);
 const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
 useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 function receive(){
  setPhase('reveal');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // La carte se retourne juste après l'éclair ; le bouton vient quand elle s'est posée.
  timers.current.push(setTimeout(()=>setShown(true),reduced?0:450),setTimeout(()=>setReady(true),reduced?200:3600));
 }
 if(phase==='invite')return <Sheet open onClose={receive} title="Une carte éternelle vous attend">
  <div className="eternal-invite">
   <div className="eternal-invite-card"><CardBack/></div>
   <p className="muted sheet-text">L’équipe vous offre {quantity>1?`${quantity} exemplaires d’une carte éternelle`:'une carte éternelle'}. Recevez-la pour la découvrir.</p>
   <button className="primary" onClick={receive}><Sparkles size={15}/> Recevoir la carte</button>
  </div>
 </Sheet>;
 return <div className="eternal-gift" role="dialog" aria-modal="true" aria-label="Carte éternelle reçue">
  <div className="epic-reveal epic-eternelle with-rays" aria-hidden="true"><span className="epic-rays"/><span className="epic-ring"/><span className="eternal-flash"/><span className="eternal-mist"/><span className="eternal-halo"/><span className="eternal-motes">{Array.from({length:18},(_,k)=><i key={k} style={{'--m':k} as React.CSSProperties}/>)}</span></div>
  <div className="eternal-gift-stage">
   <div className={`reveal-slot eternal-spin ${shown?'slot-revealed':''}`}>
    <div className={`flip-card ${shown?'is-revealed':''}`}><span className="flip-inner"><span className="flip-back"><CardBack/></span><span className="flip-front"><TarotCard card={card}/></span></span></div>
   </div>
  </div>
  <p className={`eternal-gift-caption ${ready?'on':''}`} aria-live="polite">{ready&&<><strong>{card.name}</strong> · Carte éternelle{quantity>1?` · ×${quantity}`:''}</>}</p>
  <button className={`primary eternal-gift-done ${ready?'on':''}`} disabled={!ready||busy} onClick={onDone}><Check size={15}/> Ajouter à ma collection</button>
 </div>;
}
