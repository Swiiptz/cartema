'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowLeftRight,Check,Clock,Coins,Gift as GiftIcon,UserMinus,UserPlus,Users,X} from 'lucide-react';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {Countdown,Skeleton} from '@/components/ui';
import {EventBanner} from '@/components/EventBanner';
import {TRADE_WARN,TradeComposer,type TradeDraft} from '@/components/TradeComposer';
import {callRpc,socialToCard,type Friends,type Social,type SocialCard,type Trade} from '@/lib/game';

type Tab='friends'|'gifts'|'trades';
const STATUS:Record<string,string>={accepted:'Acceptée',declined:'Refusée',cancelled:'Annulée',expired:'Expirée',countered:'Contre-proposée',pending:'En attente'};

export default function Amis(){
 const {configured,ready,session,client,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [tab,setTab]=useState<Tab>('friends');
 const [friends,setFriends]=useState<Friends|null>(null);
 const [social,setSocial]=useState<Social|null>(null);
 const [handle,setHandle]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});
 const [draft,setDraft]=useState<TradeDraft|null>(null);

 const load=useCallback(async()=>{
  if(!client)return;
  try{const [f,s]=await Promise.all([callRpc<Friends>(client,'get_friends'),callRpc<Social>(client,'get_social')]);setFriends(f);setSocial(s);}
  catch(e){setMessage({error:(e as Error).message});}
 },[client]);
 useEffect(()=>{if(session)void load();},[session,load]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);
 useEffect(()=>{const t=new URLSearchParams(window.location.search).get('onglet');if(t==='cadeaux')setTab('gifts');if(t==='echanges')setTab('trades');},[]);

 async function run(action:()=>Promise<string|null>){
  setBusy(true);setMessage({});
  try{const n=await action();await load();if(n){setMessage({notice:n});void refreshPlayer();}}
  catch(e){setMessage({error:(e as Error).message});}
  finally{setBusy(false);}
 }
 const addFriend=(e:React.FormEvent)=>{e.preventDefault();void run(async()=>{const r=await callRpc<string>(client!,'send_friend_request',{p_handle:handle});setHandle('');return r==='accepted'?'Vous êtes maintenant amis.':'Demande envoyée.';});};
 const confirm=async(title:string,message:string,label:string)=>(await ask({title,message,confirmLabel:label}))!==null;

 if(!configured||!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:240,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Amis</span><h1>Le cercle des collectionneurs.</h1><p className="muted">Connectez-vous pour ajouter des amis, offrir des cartes et proposer des échanges.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 const incomingGifts=social?.gifts.filter(g=>g.incoming&&g.status==='pending')??[];
 const outgoingGifts=social?.gifts.filter(g=>!g.incoming&&g.status==='pending')??[];
 const pastGifts=social?.gifts.filter(g=>g.status!=='pending')??[];
 const incomingTrades=social?.trades.filter(t=>t.incoming&&t.status==='pending')??[];
 const outgoingTrades=social?.trades.filter(t=>!t.incoming&&t.status==='pending')??[];
 const pastTrades=social?.trades.filter(t=>t.status!=='pending')??[];
 const counts={friends:friends?.incoming.length??0,gifts:incomingGifts.length,trades:incomingTrades.length};
 const counter=(t:Trade)=>setDraft({friendId:t.other_id,friendHandle:t.other??'',parentId:t.trade_id,give:t.recipient_cards.map(c=>c.instance_id!),take:t.proposer_cards.map(c=>c.instance_id!),giveDeniers:t.recipient_deniers,takeDeniers:t.proposer_deniers,theirCards:t.proposer_cards});

 return <div className="page social-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Cercle</span><h1>Amis &amp; échanges</h1></div></header>
  {session&&<EventBanner compact/>}
  <div className="segmented social-tabs" role="tablist">{([['friends','Amis',Users],['gifts','Cadeaux',GiftIcon],['trades','Échanges',ArrowLeftRight]] as const).map(([k,l,I])=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)}><I size={15}/> {l}{counts[k]>0&&<b className="tab-count">{counts[k]}</b>}</button>)}</div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  {tab==='friends'&&<div className="social-col">
   <form className="panel add-friend" onSubmit={addFriend}><label className="auth-field"><span><UserPlus size={14}/> Ajouter un ami par son pseudonyme</span><span className="inline-form"><input value={handle} onChange={e=>setHandle(e.target.value)} placeholder="Pseudonyme" required minLength={3} maxLength={24}/><button className="primary compact" disabled={busy}>Inviter</button></span></label></form>
   {friends&&friends.incoming.length>0&&<section className="social-section"><h2>Demandes reçues</h2><ul className="social-list">{friends.incoming.map(r=><li key={r.request_id} className="rise"><span className="person-sigil">{r.handle[0]?.toUpperCase()}</span><span className="person-name">{r.handle}</span><button className="action-btn sell" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'respond_friend_request',{p_request_id:r.request_id,p_accept:true});return `${r.handle} fait partie de vos amis.`;})}><Check size={14}/> Accepter</button><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'respond_friend_request',{p_request_id:r.request_id,p_accept:false});return 'Demande refusée.';})}><X size={14}/></button></li>)}</ul></section>}
   <section className="social-section"><h2>Vos amis</h2>{!friends?<Skeleton style={{height:100}}/>:friends.friends.length===0?<p className="muted">Aucun ami pour l’instant. Invitez un collectionneur avec son pseudonyme.</p>
    :<ul className="social-list">{friends.friends.map((f,i)=><li key={f.profile_id} className="rise" style={{'--i':i} as React.CSSProperties}><span className="person-sigil">{f.handle[0]?.toUpperCase()}</span><Link className="person-name" href={`/joueur/?h=${encodeURIComponent(f.handle)}`}>{f.handle}<small>{f.discovered} visage{f.discovered>1?'s':''} découvert{f.discovered>1?'s':''}</small></Link>
     <button className="action-btn sell" onClick={()=>setDraft({friendId:f.profile_id,friendHandle:f.handle})}><ArrowLeftRight size={14}/> Échanger</button>
     <button className="action-btn" aria-label={`Retirer ${f.handle}`} disabled={busy} onClick={()=>void (async()=>{if(await confirm(`Retirer ${f.handle} ?`,'Vous ne pourrez plus vous offrir de cartes ni échanger.','Retirer'))void run(async()=>{await callRpc(client!,'remove_friend',{p_profile_id:f.profile_id});return 'Ami retiré.';});})()}><UserMinus size={14}/></button></li>)}</ul>}</section>
   {friends&&friends.outgoing.length>0&&<section className="social-section"><h2>Invitations envoyées</h2><ul className="social-list">{friends.outgoing.map(r=><li key={r.request_id}><span className="person-sigil">{r.handle[0]?.toUpperCase()}</span><span className="person-name">{r.handle}<small>en attente</small></span><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'remove_friend',{p_profile_id:r.profile_id});return 'Invitation annulée.';})}>Annuler</button></li>)}</ul></section>}
  </div>}

  {tab==='gifts'&&<div className="social-col">
   <p className="muted">Pour offrir une carte, ouvrez-la dans votre <Link className="text-link" href="/collection/">collection</Link> puis choisissez « Offrir ». Le cadeau revient si votre ami le refuse ou ne répond pas sous 48 h.</p>
   <GiftSection title="Cadeaux reçus" gifts={incomingGifts} loading={!social} empty="Aucun cadeau en attente." render={g=><><button className="action-btn sell" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'respond_gift',{p_gift_id:g.gift_id,p_accept:true});return `${g.card.name} rejoint votre collection.`;})}><Check size={14}/> Accepter</button><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'respond_gift',{p_gift_id:g.gift_id,p_accept:false});return 'Cadeau refusé : la carte retourne à son expéditeur.';})}>Refuser</button></>}/>
   <GiftSection title="Cadeaux envoyés" gifts={outgoingGifts} loading={!social} empty="Aucun cadeau en attente de réponse." render={g=><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'cancel_gift',{p_gift_id:g.gift_id});return 'Cadeau annulé.';})}>Annuler</button>}/>
   {pastGifts.length>0&&<section className="social-section"><h2>Historique</h2><ul className="market-history">{pastGifts.map(g=><li key={g.gift_id}><span className="history-name">{g.card.name}<small>{g.incoming?`de ${g.other}`:`à ${g.other}`}</small></span><span className={`history-kind ${g.status==='accepted'?'sold':'cancelled'}`}>{STATUS[g.status]}</span><strong>{g.card.finish!=='Standard'?g.card.finish:''}</strong></li>)}</ul></section>}
  </div>}

  {tab==='trades'&&<div className="social-col">
   <TradeSection title="Propositions reçues" trades={incomingTrades} loading={!social} empty="Aucune proposition en attente." render={t=><><button className="action-btn sell" disabled={busy} onClick={()=>void (async()=>{if(await confirm('Accepter l’échange ?',`Les cartes et les Deniers sont échangés immédiatement avec ${t.other}.${t.proposer_deniers||t.recipient_deniers?' Une taxe est retenue sur les Deniers reçus (5 % par défaut).':''}${t.proposer_cards.length?` ${TRADE_WARN.received}`:''}${t.recipient_cards.length?` ${TRADE_WARN.given}`:''}`,'Accepter'))void run(async()=>{await callRpc(client!,'respond_trade',{p_trade_id:t.trade_id,p_accept:true});return 'Échange conclu.';});})()}><Check size={14}/> Accepter</button><button className="action-btn" disabled={busy} onClick={()=>counter(t)}><ArrowLeftRight size={14}/> Contre-proposer</button><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'respond_trade',{p_trade_id:t.trade_id,p_accept:false});return 'Échange refusé.';})}>Refuser</button></>}/>
   <TradeSection title="Propositions envoyées" trades={outgoingTrades} loading={!social} empty="Aucune proposition en attente. Proposez un échange depuis l’onglet Amis." render={t=><button className="action-btn" disabled={busy} onClick={()=>void run(async()=>{await callRpc(client!,'cancel_trade',{p_trade_id:t.trade_id});return 'Proposition annulée : vos cartes et Deniers sont libérés.';})}>Annuler</button>}/>
   {pastTrades.length>0&&<section className="social-section"><h2>Historique</h2><ul className="market-history">{pastTrades.map(t=><li key={t.trade_id}><span className="history-name">{t.incoming?`De ${t.other}`:`À ${t.other}`}<small>{t.proposer_cards.length} ↔ {t.recipient_cards.length} carte(s)</small></span><span className={`history-kind ${t.status==='accepted'?'sold':'cancelled'}`}>{STATUS[t.status]}</span><strong/></li>)}</ul></section>}
  </div>}

  {client&&session&&<TradeComposer client={client} myId={session.user.id} draft={draft} onClose={()=>setDraft(null)} onDone={msg=>{setDraft(null);setTab('trades');setMessage({notice:msg});void load();void refreshPlayer();}}/>}
 </div>;
}

function GiftSection({title,gifts,loading,empty,render}:{title:string;gifts:Social['gifts'];loading:boolean;empty:string;render:(g:Social['gifts'][number])=>React.ReactNode}){
 return <section className="social-section"><h2>{title}</h2>{loading?<Skeleton style={{height:120}}/>:gifts.length===0?<p className="muted">{empty}</p>
  :<ul className="offer-list">{gifts.map((g,i)=><li key={g.gift_id} className="panel offer-card rise" style={{'--i':i} as React.CSSProperties}><div className="offer-cards"><div className="offer-thumb"><TarotCard card={socialToCard(g.card)}/></div></div><div className="offer-body"><strong>{g.card.name}{g.card.finish!=='Standard'&&<span className={`finish-pill ${g.card.finish==='Dorée'?'gold':'blood'}`}>{g.card.finish}</span>}</strong><span className="muted">{g.incoming?`Offert par ${g.other}`:`Pour ${g.other}`} · <Clock size={12}/> <Countdown to={g.expires_at}/></span><div className="offer-actions">{render(g)}</div></div></li>)}</ul>}</section>;
}

function TradeSection({title,trades,loading,empty,render}:{title:string;trades:Trade[];loading:boolean;empty:string;render:(t:Trade)=>React.ReactNode}){
 const side=(cards:SocialCard[],deniers:number)=><div className="trade-side">{cards.map(c=><div key={c.instance_id} className="offer-thumb"><TarotCard card={socialToCard(c)}/></div>)}{deniers>0&&<span className="deniers-chip"><Coins size={13}/> {deniers.toLocaleString('fr-FR')}</span>}{!cards.length&&!deniers&&<span className="muted">rien</span>}</div>;
 return <section className="social-section"><h2>{title}</h2>{loading?<Skeleton style={{height:140}}/>:trades.length===0?<p className="muted">{empty}</p>
  :<ul className="offer-list">{trades.map((t,i)=><li key={t.trade_id} className="panel trade-card rise" style={{'--i':i} as React.CSSProperties}>
   <div className="trade-head"><strong>{t.incoming?`${t.other} vous propose`:`Proposé à ${t.other}`}</strong><span className="muted"><Clock size={12}/> <Countdown to={t.expires_at}/></span></div>
   <div className="trade-sides"><div><small className="muted">{t.incoming?'Vous recevez':'Vous donnez'}</small>{side(t.proposer_cards,t.proposer_deniers)}</div><ArrowLeftRight size={18} className="trade-arrow"/><div><small className="muted">{t.incoming?'Vous donnez':'Vous recevez'}</small>{side(t.recipient_cards,t.recipient_deniers)}</div></div>
   <div className="offer-actions">{render(t)}</div>
  </li>)}</ul>}</section>;
}
