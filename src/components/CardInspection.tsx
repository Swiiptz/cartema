'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {Expand,Gift,Lock,LockOpen,Recycle,Tag,X} from 'lucide-react';
import {TarotCard,type DemoCard} from './Card';
import {useAuth} from './AuthProvider';
import {useAsk} from './AskDialog';
import {Skeleton} from './ui';
import {SellDialog,type SellChoice} from './SellDialog';
import {GiftDialog} from './GiftDialog';
import {callRpc,type CardPrices,type InventoryItem,type RecycleResult} from '@/lib/game';
import {WishPicker} from './Wishes';
import {CardFeedback} from './CardFeedback';
import type {ArtVariant} from '@/lib/game';

const FINISHES=['Standard','Dorée','Sanglante'];
/**
 * finishesSeen : finitions débloquées par le joueur ; seules celles-ci sont proposées en aperçu.
 * characterId + onChanged : album réel, affiche les exemplaires possédés (verrouiller, recycler).
 */
export function CardInspection({card,finishesSeen,characterId,onChanged,wishes,onWish,variants}:{card:DemoCard;finishesSeen?:readonly string[];characterId?:string;onChanged?:()=>void;wishes?:Set<string>;onWish?:(code:string,finish:string|null,on:boolean)=>Promise<void>;variants?:ArtVariant[]}){
 const options=finishesSeen?FINISHES.filter(f=>finishesSeen.includes(f)):FINISHES;
 const dialog=useRef<HTMLDialogElement>(null);
 const title=useId();
 const [finish,setFinish]=useState(card.finish||'Standard');
 // Version d'illustration affichée dans la fiche : officielle (null) ou une version possédée.
 const [version,setVersion]=useState<ArtVariant|null>(null);
 const [open,setOpen]=useState(false);
 // Fermeture animée : la fenêtre se retire en fondu avant d'être réellement fermée.
 const close=()=>{
  const d=dialog.current;if(!d||!d.open||d.classList.contains('closing'))return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){d.close();return;}
  d.classList.add('closing');
  setTimeout(()=>{d.classList.remove('closing');d.close();},230);
 };
 // Inclinaison de la carte qui suit le pointeur (souris uniquement).
 // Inclinaison et reflet holographique : à la souris comme au doigt ; le reflet suit le pointeur.
 const tilt=(e:React.PointerEvent<HTMLDivElement>)=>{
  const el=e.currentTarget,r=el.getBoundingClientRect();
  const x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
  el.style.setProperty('--rx',`${(0.5-y)*16}deg`);el.style.setProperty('--ry',`${(x-0.5)*20}deg`);
  el.style.setProperty('--mx',`${x*100}%`);el.style.setProperty('--my',`${y*100}%`);el.style.setProperty('--holo','1');
 };
 const untilt=(e:React.PointerEvent<HTMLDivElement>)=>{const el=e.currentTarget;el.style.setProperty('--rx','0deg');el.style.setProperty('--ry','0deg');el.style.setProperty('--holo','0');};
 const shownFinish=card.known?finish:card.finish;
 const holo=card.unique?'unique':shownFinish==='Dorée'?'gold':shownFinish==='Sanglante'?'blood':card.rarity==='Légendaire'||card.rarity==='Mythique'?'rare':'std';
 return <><button className="inspect-card" aria-label={`Examiner ${card.known?card.name:'la carte inconnue'}`} onClick={()=>{setFinish(card.finish||'Standard');setOpen(true);dialog.current?.showModal();}}><TarotCard card={card}/><span className="inspect-hint"><Expand size={13}/> Examiner la carte</span></button>
 <dialog className="card-dialog" ref={dialog} aria-labelledby={title} onClose={e=>{if(e.target===e.currentTarget)setOpen(false);}} onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className="card-dialog-content">
  <button className="icon-button dialog-close" aria-label="Fermer le détail" onClick={close}><X size={20}/></button>
  <div className="dialog-art" onPointerMove={tilt} onPointerLeave={untilt} onPointerUp={e=>{if(e.pointerType!=='mouse')untilt(e);}} onPointerCancel={untilt}><div className={`holo-wrap holo-${card.known?holo:'std'}`}><TarotCard key={`${finish}|${version?.label??''}`} card={{...card,finish:card.known?finish:card.finish,...(version?{illustration:version.art_path,artLayout:version.art_meta?.layout==='full'||version.art_meta?.layout==='cover'||version.art_meta?.layout==='fullart'?version.art_meta.layout:undefined,artOffsetY:Number(version.art_meta?.offsetY)||undefined}:{})}}/><span className="holo-sheen" aria-hidden="true"/><span className="holo-glare" aria-hidden="true"/></div></div>
  <div className="dialog-copy">
   <span className="eyebrow">Détail de la carte</span>
   <h2 id={title}>{card.known?card.name:'Identité voilée'}</h2>
   <span className="detail-rarity">{card.provisional?'Rareté à définir':card.unique?'Carte unique':card.rarity}</span>
   {card.known&&!card.unique&&options.length>1&&<div className="finish-preview"><span className="eyebrow">Aperçu des finitions</span><div className="finish-switch" aria-label="Prévisualiser une finition">{options.map(f=><button key={f} className={finish===f?'active':''} aria-pressed={finish===f} onClick={()=>setFinish(f)}>{f}</button>)}</div><small>{finishesSeen?'Finitions que vous avez obtenues.':'Comparaison visuelle de la même carte.'}</small></div>}
   <dl><div><dt>Numéro</dt><dd>{card.id}</dd></div><div><dt>Clan</dt><dd>{card.known?(card.clan!=='?'?card.clan:'À définir'):'À découvrir'}</dd></div>{card.known&&(version?version.credit:card.illustration&&card.credit)&&<div><dt>Illustration</dt><dd>{version?version.credit:card.credit}</dd></div>}{card.known&&card.event&&<div><dt>Origine</dt><dd>Carte de l’événement « {card.event} »</dd></div>}<div><dt>Titre / fonction</dt><dd>{card.known?card.role||'À définir':'Identité voilée'}</dd></div>{finishesSeen?card.known&&<div><dt>Finitions obtenues</dt><dd>{options.join(', ')||'—'}</dd></div>:<div><dt>Finition d’origine</dt><dd>{card.finish||'Standard'}</dd></div>}</dl>
   {card.known&&variants&&variants.length>0&&<div className="finish-preview"><span className="eyebrow">Versions d’illustration possédées</span><div className="finish-switch" aria-label="Choisir la version affichée"><button className={version?'':'active'} aria-pressed={!version} onClick={()=>setVersion(null)}>Officielle</button>{variants.map(v=><button key={v.label} className={version?.label===v.label?'active':''} aria-pressed={version?.label===v.label} onClick={()=>setVersion(v)}>{v.label} ×{v.count}</button>)}</div><small>Les exemplaires gardent l’illustration qu’ils avaient quand vous les avez obtenus.</small></div>}
   {wishes&&onWish&&!card.unique&&<WishPicker code={card.id} keys={wishes} onToggle={onWish}/>}
   {open&&card.known&&characterId&&onChanged&&<OwnedCopies characterId={characterId} cardName={card.name} onChanged={onChanged}/>}
   {characterId&&card.known&&!card.unique&&<CardFeedback code={card.id} name={card.name} hasArt={!!card.illustration}/>}
   {card.provisional&&<p className="detail-note">Étude graphique de {card.name} · Clan et rareté à définir.</p>}
  </div>
 </div></dialog></>;
}

function OwnedCopies({characterId,cardName,onChanged}:{characterId:string;cardName:string;onChanged:()=>void}){
 const {client,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [items,setItems]=useState<InventoryItem[]|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});
 const load=useCallback(async()=>{if(client)setItems(await callRpc<InventoryItem[]>(client,'get_inventory',{p_character_id:characterId}).catch(()=>[]));},[client,characterId]);
 useEffect(()=>{void load();},[load]);

 async function run(action:()=>Promise<string|null>){
  setBusy(true);setMessage({});
  try{const notice=await action();if(notice){setMessage({notice});onChanged();void refreshPlayer();}await load();}
  catch(e){setMessage({error:(e as Error).message});}
  finally{setBusy(false);}
 }
 const toggleLock=(it:InventoryItem)=>run(async()=>{await callRpc(client!,'set_cards_locked',{p_instance_ids:[it.instance_id],p_locked:!it.locked});return null;});
 const recycle=(list:InventoryItem[])=>run(async()=>{
  const total=list.reduce((s,i)=>s+i.value,0);
  const special=list.some(i=>i.finish!=='Standard');
  const ok=await ask({title:list.length>1?`Recycler ${list.length} exemplaires ?`:`Recycler cet exemplaire${special?` ${list[0].finish.toLowerCase()}`:''} ?`,
   message:`Vous recevrez ${total.toLocaleString('fr-FR')} Deniers. C’est définitif, mais le personnage reste découvert dans votre album.${special?' Attention : finition rare, introuvable autrement qu’en booster.':''}`,
   confirmLabel:`Recycler · +${total.toLocaleString('fr-FR')}`});
  if(ok===null)return null;
  const r=await callRpc<RecycleResult>(client!,'recycle_cards',{p_instance_ids:list.map(i=>i.instance_id),p_request_id:crypto.randomUUID(),p_confirm_special:special});
  return `+${r.total.toLocaleString('fr-FR')} Deniers`;
 });

 const [selling,setSelling]=useState<InventoryItem|null>(null);
 // Prix de référence de l'exemplaire mis en vente (même finition et même version).
 const [prices,setPrices]=useState<CardPrices|null>(null);
 const [pricesStatus,setPricesStatus]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{if(!selling||!client)return;let alive=true;
  void callRpc<CardPrices>(client,'get_card_prices',{p_character_id:characterId,p_finish:selling.finish,p_instance_id:selling.instance_id}).then(p=>{if(alive){setPrices(p);setPricesStatus('ready');}}).catch(()=>{if(alive)setPricesStatus('error');});
  return()=>{alive=false;};},[selling,client,characterId]);
 const sell=(it:InventoryItem)=>{setPrices(null);setPricesStatus('loading');setSelling(it);};
 const confirmSell=(c:SellChoice)=>{const it=selling!;setSelling(null);void run(async()=>{
  if(c.kind==='fixed'){
   const r=await callRpc<{net:number}>(client!,'create_listing',{p_instance_id:it.instance_id,p_price:c.price,p_request_id:crypto.randomUUID()});
   return `En vente à ${c.price.toLocaleString('fr-FR')} Deniers · vous recevrez ${r.net.toLocaleString('fr-FR')}`;
  }
  await callRpc(client!,'create_auction',{p_instance_id:it.instance_id,p_start_price:c.price,p_hours:c.hours,p_request_id:crypto.randomUUID()});
  return `Enchère lancée pour ${c.hours} h · départ ${c.price.toLocaleString('fr-FR')} Deniers`;
 });};
 const [gifting,setGifting]=useState<InventoryItem|null>(null);
 const confirmGift=(friendId:string,handle:string)=>{const it=gifting!;setGifting(null);void run(async()=>{
  await callRpc(client!,'send_gift',{p_recipient_id:friendId,p_instance_id:it.instance_id,p_request_id:crypto.randomUUID()});
  return `Cadeau envoyé à ${handle} : il a 48 h pour l’accepter.`;
 });};
 const unlist=(it:InventoryItem)=>run(async()=>{await callRpc(client!,'cancel_listing',{p_listing_id:it.listing_id});return 'Annonce retirée.';});
 if(!items)return <div className="owned-copies"><Skeleton style={{height:44}}/><Skeleton style={{height:44}}/></div>;
 const extras=items.filter(i=>i.finish==='Standard'&&!i.locked&&!i.reserved&&!i.unique).slice(1);
 return <section className="owned-copies" aria-label="Vos exemplaires">
  {askNode}
  {client&&<GiftDialog open={!!gifting} client={client} name={cardName} onCancel={()=>setGifting(null)} onConfirm={confirmGift}/>}
  <SellDialog open={!!selling} name={cardName} finish={selling?.finish??'Standard'} prices={prices} pricesStatus={pricesStatus} onCancel={()=>setSelling(null)} onConfirm={confirmSell}/>
  <div className="owned-head"><span className="eyebrow">Vos exemplaires</span><strong>{items.length}</strong></div>
  {items.length===0?<p className="muted">Vous ne possédez plus d’exemplaire de cette carte. Elle reste découverte dans votre album.</p>:<ul className="owned-list">{items.map(it=><li key={it.instance_id} className={`finish-${it.finish==='Dorée'?'gold':it.finish==='Sanglante'?'blood':'standard'} ${it.listing_id?'listed':''}`}>
   <div className="owned-top">
    <span className="owned-finish">{it.finish}{it.variant&&<em className="owned-variant"> · {it.variant}</em>}<small>Obtenue le {new Date(it.acquired_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}</small></span>
    {it.reserved&&!it.listing_id?<span className="listed-badge"><Gift size={12}/> {it.reserved_kind==='gift'?'Cadeau en attente':'Proposée en échange'}</span>:it.listing_id?<span className="listed-badge"><Tag size={12}/> {it.reserved_kind==='gift'?'Offerte':it.reserved_kind==='trade'?'Échange':it.listing_kind==='auction'?'Enchère':'En vente'} · {(it.listing_price??0).toLocaleString('fr-FR')}</span>
     :<button className={`lock-toggle ${it.locked?'on':''}`} disabled={busy} aria-pressed={it.locked} aria-label={it.locked?'Déverrouiller cet exemplaire':'Verrouiller cet exemplaire'} onClick={()=>void toggleLock(it)}>{it.locked?<Lock size={14}/>:<LockOpen size={14}/>}<span>{it.locked?'Verrouillée':'Verrouiller'}</span></button>}
   </div>
   <div className="owned-actions">
    {it.reserved&&!it.listing_id?<span className="owned-note">Gérez-la depuis la page <Link className="text-link" href="/amis/">Amis</Link></span>:it.listing_id?<button className="action-btn" disabled={busy} onClick={()=>void unlist(it)}><X size={14}/> Retirer la vente</button>
     :<><button className="action-btn sell" disabled={busy||it.locked||it.reserved||!!it.cooldown_until||!!it.artist_until} title={it.artist_until?`Exemplaire de l’artiste : vous pourrez le vendre ${until(it.artist_until)}`:it.cooldown_until?`Reçue récemment : vous pourrez la vendre ${until(it.cooldown_until)}`:undefined} onClick={()=>void sell(it)}><Tag size={14}/> Vendre</button>
      <span className="action-sep" aria-hidden="true"/>
      <button className="action-btn" disabled={busy||it.locked||it.reserved||!!it.cooldown_until||!!it.artist_until} title={it.artist_until?`Exemplaire de l’artiste : vous pourrez l’offrir ou l’échanger ${until(it.artist_until)}`:it.cooldown_until?`Reçue récemment : vous pourrez l’offrir ou l’échanger ${until(it.cooldown_until)}`:undefined} onClick={()=>setGifting(it)}><Gift size={14}/> Offrir</button>
      {it.artist_until?<span className="owned-note artist-note">Exemplaire de l’artiste · échangeable et vendable {until(it.artist_until)}</span>
       :it.cooldown_until&&<span className="owned-note">Reçue récemment · échangeable et vendable {until(it.cooldown_until)}</span>}
      {it.artist_copy&&!it.artist_until&&<span className="owned-note artist-note">Exemplaire de l’artiste</span>}
      <span className="action-sep" aria-hidden="true"/>
      {it.unique?<span className="owned-note">Indestructible</span>:<button className="action-btn recycle" disabled={busy||it.locked||it.reserved} onClick={()=>void recycle([it])}><Recycle size={14}/> Recycler <b>+{it.value.toLocaleString('fr-FR')}</b></button>}</>}
   </div>
   {it.locked&&!it.listing_id&&<small className="owned-hint">Verrouillée : protégée de la vente et du recyclage.</small>}
  </li>)}</ul>}
  {extras.length>0&&<button className="primary ghost compact" disabled={busy} onClick={()=>void recycle(extras)}><Recycle size={14}/> Recycler les {extras.length} doublon{extras.length>1?'s':''} Standard · +{extras.reduce((s,i)=>s+i.value,0).toLocaleString('fr-FR')}</button>}
  {message.error&&<p className="auth-error" role="alert">{message.error}</p>}{message.notice&&<p className="auth-notice" role="status">{message.notice}</p>}
 </section>;
}

/** « à 14 h 05 » aujourd'hui, « demain à 14 h 05 », sinon « lundi 27 octobre à 14 h 05 » (le délai dure 72 h). */
function until(iso:string){
 const d=new Date(iso);const t=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
 const day=(k:number)=>{const x=new Date();x.setDate(x.getDate()+k);return x.toDateString();};
 if(d.toDateString()===day(0))return `à ${t}`;
 if(d.toDateString()===day(1))return `demain à ${t}`;
 return `le ${d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})} à ${t}`;
}
