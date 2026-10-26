'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Check} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Sheet} from './ui';
import {callRpc} from '@/lib/game';

type RestoredCard={code:string;card:string;rarity:string;finish:string;version:string};
type Notice={id:string;kind:string;payload:{cards?:RestoredCard[];deniers?:number;value?:number};created_at:string};

/** Fenêtre d'information montrée une seule fois à un joueur (lue une fois par session, fermée pour de bon). */
export function PlayerNotice(){
 const {client,player}=useAuth();
 const [notice,setNotice]=useState<Notice|null>(null);
 const [busy,setBusy]=useState(false);
 // Une seule lecture par joueur et par chargement du site.
 const loadedFor=useRef<string|null>(null);
 const playerId=player?.profile.id??null;
 useEffect(()=>{
  if(!client||!playerId||loadedFor.current===playerId)return;
  loadedFor.current=playerId;
  void callRpc<Notice|null>(client,'get_player_notice').then(n=>{if(n&&n.kind==='versions_restored')setNotice(n);}).catch(()=>{});
 },[client,playerId]);
 async function close(){
  if(!client||!notice)return;
  setBusy(true);
  try{await callRpc(client,'dismiss_player_notice',{p_id:notice.id});}catch{/* elle reviendra au prochain chargement */}
  finally{setBusy(false);setNotice(null);}
 }
 if(!notice)return null;
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
