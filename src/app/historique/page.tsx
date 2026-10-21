'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowLeftRight,Coins,Gavel,Gift,Package,Recycle,ShoppingBag,Tag} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {palette} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {callRpc} from '@/lib/game';
import type {Rarity} from '@/lib/draw';

type Brief={name:string;code:string;rarity:Rarity;finish:string;variant?:string|null};
type Item={at:string;type:'opening'|'shop'|'sale'|'purchase'|'trade'|'gift'|'recycling'|'ledger';[k:string]:unknown};
type Page={items:Item[];next:string|null};
type Category='all'|'boosters'|'market'|'social'|'recycling'|'deniers';

const TABS:[Category,string][]=[['all','Tout'],['boosters','Boosters'],['market','Marché'],['social','Échanges'],['recycling','Recyclage'],['deniers','Deniers']];
const LEDGER:Record<string,string>={achievement_reward:'Succès',admin_adjust:'Ajustement de l’administrateur',auction_sale:'Vente aux enchères',bid_hold:'Enchère placée',bid_refund:'Enchère remboursée',
 daily_login:'Bonus de connexion',discovery_reward:'Nouveau visage découvert',market_purchase:'Achat au marché',market_sale:'Vente au marché',mission_reward:'Mission',recycle:'Recyclage',
 shop_booster:'Achat de boosters',trade_hold:'Échange proposé (réserve)',trade_payment:'Échange conclu (payé)',trade_receipt:'Échange conclu (reçu)',trade_refund:'Échange annulé (remboursé)',contribution_reward:'Contribution acceptée'};
const STATUS:Record<string,string>={sold:'vendue',cancelled:'retirée',expired:'sans offre',accepted:'accepté',declined:'refusé',countered:'contre-proposé',cancelled_trade:'annulé',expired_trade:'expiré'};
const fmt=(n:number)=>n.toLocaleString('fr-FR').replace(/ /g,' ');
const when=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

function Cards({cards}:{cards:Brief[]}){
 return <ul className="history-cards">{cards.map((c,i)=><li key={i} style={{'--rc':palette[c.rarity]} as React.CSSProperties}><i aria-hidden="true"/>{c.name}<small>{c.code} · {c.rarity}{c.finish!=='Standard'?` · ${c.finish}`:''}{c.variant?` · ${c.variant}`:''}</small></li>)}</ul>;
}

function Row({it,i}:{it:Item;i:number}){
 // Champs propres à chaque type d’opération, lus tels que renvoyés par get_history.
 const v=it as unknown as Record<string,never>;
 let icon=Package,title='',detail:React.ReactNode=null,amount:number|null=null;
 switch(it.type){
  case 'opening':icon=Package;title=`Booster ${v.pool==='free'?'gratuit':'acheté'} ouvert · ${v.edition}`;detail=<><Cards cards={v.cards}/>{v.event&&<small className="muted">Événement : {v.event}</small>}</>;break;
  case 'shop':icon=ShoppingBag;title='Achat de boosters';amount=-(v.amount as number);break;
  case 'sale':{const c=v.card as Brief;icon=v.auction?Gavel:Tag;
   title=v.status==='sold'?`${c.name} vendue${v.auction?' aux enchères':''}${v.other?` à ${v.other}`:''}`:`${c.name} ${v.status==='cancelled'?'retirée de la vente':'sans offre, rendue'}`;
   if(v.status==='sold'){amount=(v.price as number)-((v.commission as number)??0);detail=<small className="muted">Prix {fmt(v.price)} · commission {fmt(v.commission??0)}</small>;}break;}
  case 'purchase':{const c=v.card as Brief;icon=v.auction?Gavel:ShoppingBag;title=`${c.name} achetée${v.auction?' aux enchères':''}${v.other?` à ${v.other}`:''}`;amount=-(v.price as number);break;}
  case 'trade':icon=ArrowLeftRight;title=`Échange ${STATUS[v.status==='cancelled'?'cancelled_trade':v.status==='expired'?'expired_trade':v.status]??v.status} avec ${v.other??'un joueur'}`;
   detail=<div className="history-trade"><div><span className="eyebrow">Donné</span>{(v.given as Brief[]).length?<Cards cards={v.given}/>:<small className="muted">aucune carte</small>}{(v.deniers_given as number)>0&&<small>+ {fmt(v.deniers_given)} Deniers</small>}</div>
    <div><span className="eyebrow">Reçu</span>{(v.received as Brief[]).length?<Cards cards={v.received}/>:<small className="muted">aucune carte</small>}{(v.deniers_received as number)>0&&<small>+ {fmt(v.deniers_received)} Deniers</small>}</div></div>;break;
  case 'gift':{const c=v.card as Brief;icon=Gift;title=v.sent?`${c.name} offerte à ${v.other??'un ami'} · ${STATUS[v.status]??v.status}`:`${c.name} reçue de ${v.other??'un ami'} · ${STATUS[v.status]??v.status}`;break;}
  case 'recycling':icon=Recycle;title=`${v.count} carte${(v.count as number)>1?'s':''} recyclée${(v.count as number)>1?'s':''}`;amount=v.total as number;detail=<Cards cards={v.cards}/>;break;
  case 'ledger':icon=Coins;title=LEDGER[v.kind]??v.kind;amount=v.delta as number;detail=<small className="muted">Solde : {fmt(v.balance)}</small>;break;
 }
 const Icon=icon;
 return <li className={`history-row rise ${it.type}`} style={{'--i':Math.min(i%30,10)} as React.CSSProperties}>
  <span className="history-icon"><Icon size={15}/></span>
  <div className="history-main"><div className="history-head"><strong>{title}</strong>{amount!==null&&amount!==0&&<span className={`history-amount ${amount>0?'pos':'neg'}`}>{amount>0?'+':''}{fmt(amount)}</span>}</div>
   <time dateTime={it.at}>{when(it.at)}</time>{detail}</div>
 </li>;
}

/** Historique complet du joueur : ouvertures, marché, échanges, cadeaux, recyclages, Deniers. */
export default function History(){
 const {configured,ready,session,client}=useAuth();
 const [cat,setCat]=useState<Category>('all');
 const [items,setItems]=useState<Item[]|null>(null);
 const [next,setNext]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const load=useCallback(async(before:string|null)=>{
  if(!client)return;
  setBusy(true);setError(null);
  try{const p=await callRpc<Page>(client,'get_history',{p_category:cat,p_before:before,p_limit:30});setItems(old=>before?[...(old??[]),...p.items]:p.items);setNext(p.next);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 },[client,cat]);
 useEffect(()=>{setItems(null);setNext(null);if(session)void load(null);},[session,load]);
 if(!configured||!ready)return <div className="page"><Skeleton style={{height:300}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Historique</span><h1>Votre historique.</h1><p className="muted">Connectez-vous pour retrouver vos ouvertures et vos échanges.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;
 return <div className="page history-page">
  <header className="market-head rise"><div><span className="eyebrow">Le registre</span><h1>Mon historique</h1></div><Link className="text-link" href="/profile/">Retour au profil</Link></header>
  <div className="segmented social-tabs history-tabs" role="tablist">{TABS.map(([k,l])=><button key={k} role="tab" aria-selected={cat===k} onClick={()=>setCat(k)}>{l}</button>)}</div>
  {error&&<p className="auth-error" role="alert">{error}</p>}
  {!items?<div className="history-list">{Array.from({length:6},(_,i)=><Skeleton key={i} style={{height:64}}/>)}</div>
   :items.length===0?<p className="muted">Rien pour l’instant dans cette catégorie.</p>
   :<ul className="history-list" key={cat}>{items.map((it,i)=><Row key={`${it.at}-${i}`} it={it} i={i}/>)}</ul>}
  {next&&<button className="primary ghost compact history-more" disabled={busy} onClick={()=>void load(next)}>{busy?'Chargement…':'Voir plus'}</button>}
 </div>;
}
