'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {Clock,Coins,Crown,Gavel,Layers,Search,Store,Tag,X} from 'lucide-react';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {CountUp,Countdown,Sheet,Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Finish,type Rarity} from '@/lib/draw';
import {PriceHints} from '@/components/PriceHints';
import {callRpc,listingToCard,marketCard,type CardPrices,type Listing,type MarketBoard,type MarketGroup,type MarketOffer,type TradeStatus} from '@/lib/game';

const PAGE=48;
/** Maximum renvoyé par get_market_board en un appel. */
const BATCH=120;
const SORTS={fixed:[['recent','Plus récentes'],['price_asc','Prix croissant'],['price_desc','Prix décroissant'],['rarity','Rareté'],['offers','Plus d’offres']],
 auction:[['ending','Fin la plus proche'],['price_asc','Mise croissante'],['price_desc','Mise décroissante'],['rarity','Rareté'],['recent','Plus récentes']]} as const;
type Kind=keyof typeof SORTS;
/** Ce qu'il faut pour acheter une offre à prix fixe. */
type Purchase={listing_id:string;price:number;buyer_tax?:number;name:string;finish:Finish};
const dateFr=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

export default function Market(){
 const {configured,ready,session,client,player,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [tab,setTab]=useState<'buy'|'mine'>('buy');
 const [kind,setKind]=useState<Kind>('fixed');
 const [groups,setGroups]=useState<MarketGroup[]|null>(null);
 const [auctions,setAuctions]=useState<Listing[]|null>(null);
 const [total,setTotal]=useState(0);
 const [clans,setClans]=useState<{id:string;name:string}[]>([]);
 const [clan,setClan]=useState('');
 const [sort,setSort]=useState('');
 const [undiscovered,setUndiscovered]=useState(false);
 const [more,setMore]=useState(false);
 const [offersOf,setOffersOf]=useState<MarketGroup|null>(null);
 // Prix de référence de la carte dont on regarde les offres (clé : personnage:finition:version).
 const [offerPrices,setOfferPrices]=useState<CardPrices|null>(null);
 const offersKey=offersOf?.key??null;
 useEffect(()=>{setOfferPrices(null);if(!offersKey||!client)return;let alive=true;const [character,finish,art]=offersKey.split(':');
  void callRpc<CardPrices>(client,'get_card_prices',{p_character_id:character,p_finish:finish,p_art_id:art||null}).then(p=>{if(alive)setOfferPrices(p);}).catch(()=>{});
  return()=>{alive=false;};},[offersKey,client]);
 const [mine,setMine]=useState<Listing[]|null>(null);
 const [bids,setBids]=useState<Listing[]|null>(null);
 const [status,setStatus]=useState<TradeStatus|null>(null);
 const [rarity,setRarity]=useState<Rarity|''>('');
 const [finish,setFinish]=useState<Finish|''>('');
 const [query,setQuery]=useState('');
 const [busy,setBusy]=useState<string|null>(null);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});

 // Nombre d'entrées affichées : un rechargement (achat, fin d'enchère) garde tout ce qui a été déroulé.
 const shown=useRef(PAGE);
 const boardArgs=useCallback((offset:number,limit:number)=>({p_kind:kind,p_rarity:rarity||null,p_finish:finish||null,p_query:query.trim()||null,p_clan_id:clan||null,p_undiscovered:undiscovered,p_sort:sort||null,p_limit:limit,p_offset:offset}),[kind,rarity,finish,query,clan,undiscovered,sort]);
 useEffect(()=>{shown.current=PAGE;},[boardArgs]);
 /** Les `count` premières entrées, relues depuis le début : ni doublon ni trou si le marché a bougé entre deux pages. */
 const fetchBoard=useCallback(async(count:number)=>{
  const items:(MarketGroup|Listing)[]=[];let board:MarketBoard<MarketGroup|Listing>={items,total:0,clans:[]};
  for(let offset=0;offset<count;){
   const limit=Math.min(BATCH,count-offset);
   const m=await callRpc<MarketBoard<MarketGroup|Listing>>(client!,'get_market_board',boardArgs(offset,limit));
   board={...m,items};offset+=limit;
   const seen=new Set(items.map(itemKey));items.push(...m.items.filter(x=>!seen.has(itemKey(x))));
   if(m.items.length<limit)break;
  }
  return board;
 },[client,boardArgs]);
 // Trois chargements séparés pour ménager la base : un filtre ne relit que le marché, le statut est lu
 // une fois, Mes ventes et Mes mises seulement quand leur onglet est ouvert.
 const loadBoard=useCallback(async()=>{
  if(!client)return;
  try{
   const m=await fetchBoard(shown.current);
   if(kind==='fixed')setGroups(m.items as MarketGroup[]);else setAuctions(m.items as Listing[]);
   setTotal(m.total);setClans(m.clans);
   // L'offre ouverte suit les achats des autres joueurs.
   setOffersOf(o=>o&&((m.items as MarketGroup[]).find(g=>g.key===o.key)??null));
  }catch(e){setMessage({error:(e as Error).message});}
 },[client,kind,fetchBoard]);
 const mineStale=useRef(true);
 const loadMine=useCallback(async()=>{
  if(!client)return;
  mineStale.current=false;
  try{const [own,b]=await Promise.all([callRpc<Listing[]>(client,'get_my_listings'),callRpc<Listing[]>(client,'get_my_bids')]);setMine(own);setBids(b);}
  catch(e){setMessage({error:(e as Error).message});}
 },[client]);
 /** Après une action : le marché, et Mes ventes seulement si l'onglet est ouvert (sinon relu à son ouverture). */
 const load=useCallback(async()=>{
  mineStale.current=true;
  await Promise.all([loadBoard(),tab==='mine'?loadMine():null]);
 },[loadBoard,loadMine,tab]);
 useEffect(()=>{if(session&&tab==='mine'&&mineStale.current)void loadMine();},[session,tab,loadMine]);
 useEffect(()=>{if(!session||!client)return;let alive=true;
  void callRpc<TradeStatus>(client,'get_trade_status').then(s=>{if(alive)setStatus(s);}).catch(()=>{});
  return()=>{alive=false;};},[session,client]);
 async function loadMore(){
  if(!client)return;setMore(true);
  const count=(kind==='fixed'?groups?.length??0:auctions?.length??0)+PAGE;
  try{const m=await fetchBoard(count);shown.current=count;
   if(kind==='fixed')setGroups(m.items as MarketGroup[]);else setAuctions(m.items as Listing[]);setTotal(m.total);}
  catch(e){setMessage({error:(e as Error).message});}finally{setMore(false);}
 }
 const switchKind=(k:Kind)=>{if(k===kind)return;setKind(k);setSort('');setClan('');};
 // Fin d'une enchère : rechargement tout de suite, puis une fois après la clôture par la tâche
 // planifiée (chaque minute). Jamais plus : la page ne doit pas interroger la base en boucle.
 const ended=useRef<ReturnType<typeof setTimeout>[]>([]);
 useEffect(()=>()=>ended.current.forEach(clearTimeout),[]);
 const afterEnd=useCallback(()=>{void load();ended.current.push(setTimeout(()=>void load(),65000));},[load]);
 useEffect(()=>{if(!session)return;const t=setTimeout(()=>void loadBoard(),query?300:0);return()=>clearTimeout(t);},[session,loadBoard,query]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);

 async function buy(l:Purchase){
  const ok=await ask({title:`Acheter ${l.name} ?`,message:`${l.price.toLocaleString('fr-FR')} Deniers + ${(l.buyer_tax??0).toLocaleString('fr-FR')} de taxe = ${(l.price+(l.buyer_tax??0)).toLocaleString('fr-FR')} Deniers${l.finish!=='Standard'?` · finition ${l.finish}`:''}. Il vous restera ${((player?.balance??0)-l.price-(l.buyer_tax??0)).toLocaleString('fr-FR')} Deniers.`,confirmLabel:'Acheter'});
  if(ok===null)return;
  setBusy(l.listing_id);setMessage({});
  try{const r=await callRpc<{discovered:boolean}>(client!,'buy_listing',{p_listing_id:l.listing_id});setMessage({notice:`${l.name} rejoint votre collection${r.discovered?' · nouveau visage, +10 Deniers':''}.`});await load();void refreshPlayer();}
  catch(e){setMessage({error:(e as Error).message});await load();}
  finally{setBusy(null);}
 }
 async function placeBid(l:Listing){
  const raw=await ask({title:`Enchérir sur ${l.card.name}`,message:`${l.current_bid?`Mise actuelle : ${l.current_bid.toLocaleString('fr-FR')} Deniers.`:`Mise de départ : ${l.price.toLocaleString('fr-FR')} Deniers.`} Minimum : ${l.min_next_bid.toLocaleString('fr-FR')}. Vous avez ${(player?.balance??0).toLocaleString('fr-FR')} Deniers. Votre mise et la taxe acheteur (${(l.min_next_tax??0).toLocaleString('fr-FR')} pour la mise minimale) sont mises de côté jusqu’à la fin. Si quelqu’un vous dépasse, elles vous sont rendues moins une taxe de 5 % de votre mise.`,inputLabel:'Votre mise (Deniers)',initialValue:String(l.min_next_bid),confirmLabel:'Enchérir'});
  if(raw===null)return;
  const amount=Number(raw.replace(/\s/g,''));
  setBusy(l.listing_id);setMessage({});
  try{if(!Number.isInteger(amount))throw new Error('Mise invalide.');
   // Contrôle immédiat (le serveur refuse de toute façon une mise sans les fonds).
   if(amount>(player?.balance??0))throw new Error(`Fonds insuffisants : vous avez ${(player?.balance??0).toLocaleString('fr-FR')} Deniers.`);
   if(amount<l.min_next_bid)throw new Error(`Mise minimale : ${l.min_next_bid.toLocaleString('fr-FR')} Deniers.`);
  await callRpc(client!,'place_bid',{p_listing_id:l.listing_id,p_amount:amount,p_request_id:crypto.randomUUID()});setMessage({notice:`Vous menez l’enchère avec ${amount.toLocaleString('fr-FR')} Deniers.`});await load();void refreshPlayer();}
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

 const boardKey=`${kind}|${rarity}|${finish}|${query}|${clan}|${sort}|${undiscovered}`;
 const activeMine=useMemo(()=>mine?.filter(l=>l.status==='active'&&l.mine)??[],[mine]);
 const history=useMemo(()=>mine?.filter(l=>l.status!=='active')??[],[mine]);

 if(!configured)return <div className="page"><div className="eyebrow">Marché</div><h1>Hôtel des ventes</h1><p className="muted">Disponible une fois le site relié à son serveur.</p></div>;
 if(!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:300,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Marché</span><h1>L’hôtel des ventes.</h1><p className="muted">Connectez-vous pour acheter et vendre des cartes entre collectionneurs.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 return <div className="page market-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Marché</span><h1>L’hôtel des ventes</h1></div>{player&&<span className="chip gold"><Coins size={15}/><CountUp value={player.balance}/><small>Deniers</small></span>}</header>
  {status&&!status.allowed&&<p className="trade-lock rise"><Clock size={15}/> {status.handle_missing?<>Choisissez un <Link className="text-link" href="/profile/">pseudonyme</Link> pour acheter et vendre.</>:status.blocked?'Les échanges sont suspendus sur ce compte.':<>Les achats et ventes entre joueurs s’ouvrent le {status.available_at?dateFr(status.available_at):'…'} (24 h après la création du compte). <Link className="text-link" href="/profile/">Liez votre compte Discord</Link> pour les débloquer tout de suite.</>}</p>}
  <div className="segmented market-tabs" role="tablist"><button role="tab" aria-selected={tab==='buy'} onClick={()=>setTab('buy')}><Store size={15}/> Acheter</button><button role="tab" aria-selected={tab==='mine'} onClick={()=>setTab('mine')}><Tag size={15}/> Mes ventes{activeMine.length>0&&<b className="tab-count">{activeMine.length}</b>}</button></div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  {tab==='buy'?<>
   <div className="segmented market-kind" role="tablist" aria-label="Type de vente"><button role="tab" aria-selected={kind==='fixed'} onClick={()=>switchKind('fixed')}><Tag size={14}/> Prix fixe</button><button role="tab" aria-selected={kind==='auction'} onClick={()=>switchKind('auction')}><Gavel size={14}/> Enchères</button></div>
   <div className="market-filters">
    <label className="search-field"><Search size={18}/><input aria-label="Rechercher un personnage" placeholder="Rechercher…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <select aria-label="Rareté" value={rarity} onChange={e=>setRarity(e.target.value as Rarity|'')}><option value="">Toutes raretés</option>{ALL_RARITIES.map(r=><option key={r}>{r}</option>)}</select>
    <select aria-label="Finition" value={finish} onChange={e=>setFinish(e.target.value as Finish|'')}><option value="">Toutes finitions</option>{['Standard','Dorée','Sanglante'].map(f=><option key={f}>{f}</option>)}</select>
    <select aria-label="Clan" value={clan} onChange={e=>setClan(e.target.value)}><option value="">Tous les clans</option>{clans.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select aria-label="Trier" value={sort||SORTS[kind][0][0]} onChange={e=>setSort(e.target.value)}>{SORTS[kind].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    <label className="check-field"><input type="checkbox" checked={undiscovered} onChange={e=>setUndiscovered(e.target.checked)}/> Non découvertes</label>
   </div>
   {(kind==='fixed'?groups:auctions)&&<p className="market-count muted">{total===0?'Aucun résultat':`${total.toLocaleString('fr-FR')} ${kind==='fixed'?`carte${total>1?'s':''} en vente`:`enchère${total>1?'s':''} en cours`}`}</p>}
   {kind==='fixed'?(!groups?<div className="card-grid">{Array.from({length:8},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
   :groups.length===0?<Empty/>
   :<div className="card-grid market-grid" key={boardKey}>{groups.map((g,i)=>{const best=g.best===undefined?g.listings.find(o=>!o.mine):g.best;const afford=!!best&&(player?.balance??0)>=best.price+best.buyer_tax;return <article key={g.key} className="listing rise" style={{'--i':Math.min(i,12)} as React.CSSProperties}>
     <div className="listing-art">{!g.discovered&&<span className="listing-new">Nouveau</span>}{g.offers>1&&<span className="listing-offers"><Layers size={11}/> {g.offers} offres</span>}<TarotCard card={marketCard(g.card,g.finish)}/></div>
     <div className="listing-info"><strong className="listing-price"><Coins size={14}/> {g.offers>1&&<small>dès</small>}{g.min_price.toLocaleString('fr-FR')}</strong><span className="muted">{g.offers>1?(top(g)>g.min_price?`jusqu’à ${top(g).toLocaleString('fr-FR')}`:'même prix'):g.listings[0]?.mine?'Votre annonce':`par ${g.listings[0]?.seller??'joueur sans pseudo'}`}</span></div>
     <div className="listing-actions">
      {best?<button className="primary compact" disabled={!!busy||!status?.allowed||!afford} onClick={()=>void buy({...best,name:g.card.name,finish:g.finish})}>{busy===best.listing_id?'Achat…':!afford?'Fonds insuffisants':`Acheter · ${best.price.toLocaleString('fr-FR')}`}</button>
       :<button className="primary ghost compact" onClick={()=>setTab('mine')}>Votre annonce</button>}
      {g.offers>1&&<button type="button" className="offers-btn" aria-label={`Voir les ${g.offers} offres`} title={`Voir les ${g.offers} offres`} onClick={()=>setOffersOf(g)}><Layers size={15}/><b>{g.offers}</b></button>}
     </div>
    </article>;})}</div>)
   :(!auctions?<div className="card-grid">{Array.from({length:8},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
   :auctions.length===0?<Empty/>
   :<div className="card-grid market-grid" key={boardKey}>{auctions.map((l,i)=><article key={l.listing_id} className="listing rise" style={{'--i':Math.min(i,12)} as React.CSSProperties}>
     <div className="listing-art">{!l.discovered&&!l.mine&&<span className="listing-new">Nouveau</span>}<span className="listing-auction"><Gavel size={11}/> Enchère</span><TarotCard card={listingToCard(l)}/></div>
     <div className="listing-info auction-info">
      <strong className="listing-price"><Coins size={14}/> {(l.current_bid??l.price).toLocaleString('fr-FR')}</strong>
      <span className="muted">{l.bid_count?`${l.bid_count} mise${l.bid_count>1?'s':''}`:'départ'} · {l.mine?'votre enchère':l.seller??'joueur sans pseudo'}</span>
      <span className="auction-timer"><Clock size={12}/> <Countdown to={l.ends_at} onDone={afterEnd}/></span>
     </div>
     {l.mine?<button className="primary ghost compact" disabled={busy===l.listing_id||l.bid_count>0} onClick={()=>void cancel(l)}>{l.bid_count>0?'Mises en cours':'Retirer'}</button>
      :l.leading?<span className="leading-chip"><Crown size={14}/> Vous menez</span>:<button className="primary compact" disabled={!!busy||!status?.allowed||(player?.balance??0)<l.min_next_bid+(l.min_next_tax??0)} onClick={()=>void placeBid(l)}>{busy===l.listing_id?'Mise…':(player?.balance??0)<l.min_next_bid+(l.min_next_tax??0)?'Fonds insuffisants':`Enchérir · ${l.min_next_bid.toLocaleString('fr-FR')}`}</button>}
    </article>)}</div>)}
   {(kind==='fixed'?groups?.length??0:auctions?.length??0)<total&&<button className="primary ghost market-more" disabled={more} onClick={()=>void loadMore()}>{more?'Chargement…':'Voir plus'}</button>}
   <Sheet open={!!offersOf} onClose={()=>setOffersOf(null)} title={offersOf?`${offersOf.card.name}${offersOf.finish!=='Standard'?` · ${offersOf.finish}`:''}${offersOf.card.variant?` · ${offersOf.card.variant}`:''}`:''}>
    {offersOf&&<div className="offers-sheet"><div className="offers-card"><TarotCard card={marketCard(offersOf.card,offersOf.finish)}/></div>
     <ul className="offers-list">{offersOf.listings.map(o=><Offer key={o.listing_id} o={o} disabled={!!busy||!status?.allowed} busy={busy===o.listing_id} balance={player?.balance??0} onBuy={()=>void buy({...o,name:offersOf.card.name,finish:offersOf.finish})}/>)}</ul>
     {offersOf.offers>offersOf.listings.length&&<p className="muted">Les {offersOf.listings.length} meilleurs prix sur {offersOf.offers} offres.</p>}
     <PriceHints prices={offerPrices}/></div>}
   </Sheet>
  </>:<>
   <section className="market-section"><h2>En vente</h2>{!mine?<Skeleton style={{height:120}}/>:activeMine.length===0?<p className="muted">Aucune carte en vente. Ouvrez une carte de votre <Link className="text-link" href="/collection/">collection</Link> puis choisissez « Vendre ».</p>
    :<div className="card-grid market-grid">{activeMine.map((l,i)=><article key={l.listing_id} className="listing rise" style={{'--i':i} as React.CSSProperties}><div className="listing-art"><TarotCard card={listingToCard(l)}/></div><div className="listing-info"><strong className="listing-price"><Coins size={14}/> {l.price.toLocaleString('fr-FR')}</strong><span className="muted">{l.kind==='auction'?<><Countdown to={l.ends_at} onDone={afterEnd}/> · {l.bid_count} mise{l.bid_count>1?'s':''}</>:<>vous recevrez {l.net.toLocaleString('fr-FR')}</>}</span></div><button className="primary ghost compact" disabled={busy===l.listing_id} onClick={()=>void cancel(l)}>Retirer</button></article>)}</div>}</section>
   <section className="market-section"><h2>Mes mises</h2>{!bids?<Skeleton style={{height:80}}/>:bids.length===0?<p className="muted">Vous n’avez misé sur aucune enchère récemment.</p>
    :<ul className="market-history">{bids.map(l=><li key={l.listing_id}><span className="history-name">{l.card.name}<small>{l.status==='active'?<>fin dans <Countdown to={l.ends_at} onDone={afterEnd}/></>:l.closed_at?dateFr(l.closed_at):''}</small></span><span className={`history-kind ${l.leading||l.won?'sold':'cancelled'}`}>{l.status==='active'?(l.leading?'Vous menez':'Dépassé'):l.won?'Remportée':'Perdue'}</span><strong>{(l.current_bid??l.price).toLocaleString('fr-FR')}</strong></li>)}</ul>}</section>
   <section className="market-section"><h2>Historique</h2>{!mine?<Skeleton style={{height:120}}/>:history.length===0?<p className="muted">Aucune vente ni achat pour l’instant.</p>
    :<ul className="market-history">{history.map(l=><li key={l.listing_id}><span className="history-name">{l.card.name}<small>{l.finish!=='Standard'?`${l.finish} · `:''}{l.closed_at?dateFr(l.closed_at):''}</small></span><span className={`history-kind ${l.status}`}>{l.status==='cancelled'?'Retirée':l.status==='expired'?'Sans enchère':l.mine?`Vendue à ${l.buyer??'joueur sans pseudo'}`:`Achetée à ${l.seller??'joueur sans pseudo'}`}</span><strong className={l.status==='sold'?(l.mine?'gain':'loss'):''}>{l.status==='sold'?(l.mine?`+${((l.current_bid??l.price)-Math.floor((l.current_bid??l.price)*5/100)).toLocaleString('fr-FR')}`:`−${(l.current_bid??l.price).toLocaleString('fr-FR')}`):'—'}</strong></li>)}</ul>}</section>
  </>}
 </div>;
}

function Empty(){return <div className="album-empty"><Store size={28}/><h2>Aucune annonce ne correspond.</h2><p>Changez les filtres, ou mettez une carte en vente depuis votre collection : ouvrez-la, puis « Vendre ».</p><Link className="primary ghost" href="/collection/">Ma collection</Link></div>;}

function Offer({o,disabled,busy,balance,onBuy}:{o:MarketOffer;disabled:boolean;busy:boolean;balance:number;onBuy:()=>void}){
 const afford=balance>=o.price+o.buyer_tax;
 return <li><span className="offer-seller">{o.mine?'Votre annonce':o.seller??'Joueur sans pseudo'}<small>{dateFr(o.created_at)}</small></span><strong className="listing-price"><Coins size={13}/> {o.price.toLocaleString('fr-FR')}</strong>
  {o.mine?<span className="muted">—</span>:<button className="primary compact" disabled={disabled||!afford} onClick={onBuy}>{busy?'Achat…':afford?'Acheter':'Fonds insuffisants'}</button>}</li>;
}

/** Prix le plus haut parmi les offres affichées. */
function top(g:MarketGroup){return g.max_price??g.listings.reduce((m,o)=>Math.max(m,o.price),g.min_price);}
const itemKey=(x:MarketGroup|Listing)=>'key' in x?x.key:x.listing_id;
