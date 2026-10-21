'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Clock,Coins,Crown,Gavel,Search,Store,Tag,X} from 'lucide-react';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {CountUp,Countdown,Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Finish,type Rarity} from '@/lib/draw';
import {callRpc,listingToCard,type Listing,type TradeStatus} from '@/lib/game';

const dateFr=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

export default function Market(){
 const {configured,ready,session,client,player,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [tab,setTab]=useState<'buy'|'mine'>('buy');
 const [listings,setListings]=useState<Listing[]|null>(null);
 const [mine,setMine]=useState<Listing[]|null>(null);
 const [bids,setBids]=useState<Listing[]|null>(null);
 const [status,setStatus]=useState<TradeStatus|null>(null);
 const [rarity,setRarity]=useState<Rarity|''>('');
 const [finish,setFinish]=useState<Finish|''>('');
 const [query,setQuery]=useState('');
 const [busy,setBusy]=useState<string|null>(null);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});

 const load=useCallback(async()=>{
  if(!client)return;
  try{
   const [m,own,st,b]=await Promise.all([
    callRpc<Listing[]>(client,'get_market',{p_rarity:rarity||null,p_finish:finish||null,p_query:query.trim()||null}),
    callRpc<Listing[]>(client,'get_my_listings'),
    callRpc<TradeStatus>(client,'get_trade_status'),
    callRpc<Listing[]>(client,'get_my_bids')]);
   setListings(m);setMine(own);setStatus(st);setBids(b);
  }catch(e){setMessage({error:(e as Error).message});}
 },[client,rarity,finish,query]);
 useEffect(()=>{if(!session)return;const t=setTimeout(()=>void load(),query?300:0);return()=>clearTimeout(t);},[session,load,query]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);

 async function buy(l:Listing){
  const ok=await ask({title:`Acheter ${l.card.name} ?`,message:`${l.price.toLocaleString('fr-FR')} Deniers${l.finish!=='Standard'?` · finition ${l.finish}`:''}. Il vous restera ${((player?.balance??0)-l.price).toLocaleString('fr-FR')} Deniers.`,confirmLabel:'Acheter'});
  if(ok===null)return;
  setBusy(l.listing_id);setMessage({});
  try{const r=await callRpc<{discovered:boolean}>(client!,'buy_listing',{p_listing_id:l.listing_id});setMessage({notice:`${l.card.name} rejoint votre collection${r.discovered?' · nouveau visage, +10 Deniers':''}.`});await load();void refreshPlayer();}
  catch(e){setMessage({error:(e as Error).message});await load();}
  finally{setBusy(null);}
 }
 async function placeBid(l:Listing){
  const raw=await ask({title:`Enchérir sur ${l.card.name}`,message:`${l.current_bid?`Mise actuelle : ${l.current_bid.toLocaleString('fr-FR')} Deniers.`:`Mise de départ : ${l.price.toLocaleString('fr-FR')} Deniers.`} Minimum : ${l.min_next_bid.toLocaleString('fr-FR')}. Votre mise est bloquée jusqu’à la fin, et rendue si quelqu’un vous dépasse.`,inputLabel:'Votre mise (Deniers)',initialValue:String(l.min_next_bid),confirmLabel:'Enchérir'});
  if(raw===null)return;
  const amount=Number(raw.replace(/\s/g,''));
  setBusy(l.listing_id);setMessage({});
  try{if(!Number.isInteger(amount))throw new Error('Mise invalide.');await callRpc(client!,'place_bid',{p_listing_id:l.listing_id,p_amount:amount,p_request_id:crypto.randomUUID()});setMessage({notice:`Vous menez l’enchère avec ${amount.toLocaleString('fr-FR')} Deniers.`});await load();void refreshPlayer();}
  catch(e){setMessage({error:(e as Error).message});await load();}
  finally{setBusy(null);}
 }
 async function cancel(l:Listing){
  const ok=await ask({title:'Retirer cette annonce ?',message:`${l.card.name} redeviendra disponible dans votre collection.`,confirmLabel:'Retirer'});
  if(ok===null)return;
  setBusy(l.listing_id);setMessage({});
  try{await callRpc(client!,'cancel_listing',{p_listing_id:l.listing_id});setMessage({notice:'Annonce retirée.'});await load();}
  catch(e){setMessage({error:(e as Error).message});}
  finally{setBusy(null);}
 }

 const activeMine=useMemo(()=>mine?.filter(l=>l.status==='active'&&l.mine)??[],[mine]);
 const history=useMemo(()=>mine?.filter(l=>l.status!=='active')??[],[mine]);

 if(!configured)return <div className="page"><div className="eyebrow">Marché</div><h1>Hôtel des ventes</h1><p className="muted">Disponible une fois le site relié à son serveur.</p></div>;
 if(!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:300,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Marché</span><h1>L’hôtel des ventes.</h1><p className="muted">Connectez-vous pour acheter et vendre des cartes entre collectionneurs.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 return <div className="page market-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Marché</span><h1>L’hôtel des ventes</h1></div>{player&&<span className="chip gold"><Coins size={15}/><CountUp value={player.balance}/><small>Deniers</small></span>}</header>
  {status&&!status.allowed&&<p className="trade-lock rise"><Clock size={15}/> {status.blocked?'Les échanges sont suspendus sur ce compte.':<>Les achats et ventes entre joueurs s’ouvrent le {status.available_at?dateFr(status.available_at):'…'} (24 h après la création du compte). <Link className="text-link" href="/profile/">Liez votre compte Discord</Link> pour les débloquer tout de suite.</>}</p>}
  <div className="segmented market-tabs" role="tablist"><button role="tab" aria-selected={tab==='buy'} onClick={()=>setTab('buy')}><Store size={15}/> Acheter</button><button role="tab" aria-selected={tab==='mine'} onClick={()=>setTab('mine')}><Tag size={15}/> Mes ventes{activeMine.length>0&&<b className="tab-count">{activeMine.length}</b>}</button></div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  {tab==='buy'?<>
   <div className="market-filters">
    <label className="search-field"><Search size={18}/><input aria-label="Rechercher un personnage" placeholder="Rechercher…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <select aria-label="Rareté" value={rarity} onChange={e=>setRarity(e.target.value as Rarity|'')}><option value="">Toutes raretés</option>{ALL_RARITIES.map(r=><option key={r}>{r}</option>)}</select>
    <select aria-label="Finition" value={finish} onChange={e=>setFinish(e.target.value as Finish|'')}><option value="">Toutes finitions</option>{['Standard','Dorée','Sanglante'].map(f=><option key={f}>{f}</option>)}</select>
   </div>
   {!listings?<div className="card-grid">{Array.from({length:8},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
   :listings.length===0?<div className="album-empty"><Store size={28}/><h2>Aucune annonce pour l’instant.</h2><p>Mettez une carte en vente depuis votre collection : ouvrez-la, puis « Vendre ».</p><Link className="primary ghost" href="/collection/">Ma collection</Link></div>
   :<div className="card-grid market-grid" key={`${rarity}|${finish}|${query}`}>{listings.map((l,i)=>{const afford=(player?.balance??0)>=l.price;return <article key={l.listing_id} className="listing rise" style={{'--i':Math.min(i,12)} as React.CSSProperties}>
     <div className="listing-art">{!l.discovered&&!l.mine&&<span className="listing-new">Nouveau</span>}{l.kind==='auction'&&<span className="listing-auction"><Gavel size={11}/> Enchère</span>}<TarotCard card={listingToCard(l)}/></div>
     {l.kind==='auction'?<div className="listing-info auction-info">
      <strong className="listing-price"><Coins size={14}/> {(l.current_bid??l.price).toLocaleString('fr-FR')}</strong>
      <span className="muted">{l.bid_count?`${l.bid_count} mise${l.bid_count>1?'s':''}`:'départ'} · {l.mine?'votre enchère':l.seller??'—'}</span>
      <span className="auction-timer"><Clock size={12}/> <Countdown to={l.ends_at} onDone={()=>void load()}/></span>
     </div>:<div className="listing-info"><strong className="listing-price"><Coins size={14}/> {l.price.toLocaleString('fr-FR')}</strong><span className="muted">{l.mine?'Votre annonce':`par ${l.seller??'—'}`}</span></div>}
     {l.mine?<button className="primary ghost compact" disabled={busy===l.listing_id||(l.kind==='auction'&&l.bid_count>0)} onClick={()=>void cancel(l)}>{l.kind==='auction'&&l.bid_count>0?'Mises en cours':'Retirer'}</button>
      :l.kind==='auction'?(l.leading?<span className="leading-chip"><Crown size={14}/> Vous menez</span>:<button className="primary compact" disabled={!!busy||!status?.allowed||(player?.balance??0)<l.min_next_bid} onClick={()=>void placeBid(l)}>{busy===l.listing_id?'Mise…':(player?.balance??0)<l.min_next_bid?'Fonds insuffisants':`Enchérir · ${l.min_next_bid.toLocaleString('fr-FR')}`}</button>)
      :<button className="primary compact" disabled={!!busy||!status?.allowed||!afford} onClick={()=>void buy(l)}>{busy===l.listing_id?'Achat…':!afford?'Fonds insuffisants':'Acheter'}</button>}
    </article>;})}</div>}
  </>:<>
   <section className="market-section"><h2>En vente</h2>{!mine?<Skeleton style={{height:120}}/>:activeMine.length===0?<p className="muted">Aucune carte en vente. Ouvrez une carte de votre <Link className="text-link" href="/collection/">collection</Link> puis choisissez « Vendre ».</p>
    :<div className="card-grid market-grid">{activeMine.map((l,i)=><article key={l.listing_id} className="listing rise" style={{'--i':i} as React.CSSProperties}><div className="listing-art"><TarotCard card={listingToCard(l)}/></div><div className="listing-info"><strong className="listing-price"><Coins size={14}/> {l.price.toLocaleString('fr-FR')}</strong><span className="muted">{l.kind==='auction'?<><Countdown to={l.ends_at} onDone={()=>void load()}/> · {l.bid_count} mise{l.bid_count>1?'s':''}</>:<>vous recevrez {l.net.toLocaleString('fr-FR')}</>}</span></div><button className="primary ghost compact" disabled={busy===l.listing_id} onClick={()=>void cancel(l)}>Retirer</button></article>)}</div>}</section>
   <section className="market-section"><h2>Mes mises</h2>{!bids?<Skeleton style={{height:80}}/>:bids.length===0?<p className="muted">Vous n’avez misé sur aucune enchère récemment.</p>
    :<ul className="market-history">{bids.map(l=><li key={l.listing_id}><span className="history-name">{l.card.name}<small>{l.status==='active'?<>fin dans <Countdown to={l.ends_at} onDone={()=>void load()}/></>:l.closed_at?dateFr(l.closed_at):''}</small></span><span className={`history-kind ${l.leading||l.won?'sold':'cancelled'}`}>{l.status==='active'?(l.leading?'Vous menez':'Dépassé'):l.won?'Remportée':'Perdue'}</span><strong>{(l.current_bid??l.price).toLocaleString('fr-FR')}</strong></li>)}</ul>}</section>
   <section className="market-section"><h2>Historique</h2>{!mine?<Skeleton style={{height:120}}/>:history.length===0?<p className="muted">Aucune vente ni achat pour l’instant.</p>
    :<ul className="market-history">{history.map(l=><li key={l.listing_id}><span className="history-name">{l.card.name}<small>{l.finish!=='Standard'?`${l.finish} · `:''}{l.closed_at?dateFr(l.closed_at):''}</small></span><span className={`history-kind ${l.status}`}>{l.status==='cancelled'?'Retirée':l.status==='expired'?'Sans enchère':l.mine?`Vendue à ${l.buyer??'—'}`:`Achetée à ${l.seller??'—'}`}</span><strong className={l.status==='sold'?(l.mine?'gain':'loss'):''}>{l.status==='sold'?(l.mine?`+${((l.current_bid??l.price)-Math.floor((l.current_bid??l.price)*5/100)).toLocaleString('fr-FR')}`:`−${(l.current_bid??l.price).toLocaleString('fr-FR')}`):'—'}</strong></li>)}</ul>}</section>
  </>}
 </div>;
}
