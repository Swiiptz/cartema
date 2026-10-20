'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {Expand,Lock,LockOpen,Recycle,Tag,X} from 'lucide-react';
import {TarotCard,type DemoCard} from './Card';
import {useAuth} from './AuthProvider';
import {useAsk} from './AskDialog';
import {Skeleton} from './ui';
import {callRpc,type InventoryItem,type RecycleResult} from '@/lib/game';

const FINISHES=['Standard','Dorée','Sanglante'];
/**
 * finishesSeen : finitions débloquées par le joueur ; seules celles-ci sont proposées en aperçu.
 * characterId + onChanged : album réel, affiche les exemplaires possédés (verrouiller, recycler).
 */
export function CardInspection({card,finishesSeen,characterId,onChanged}:{card:DemoCard;finishesSeen?:readonly string[];characterId?:string;onChanged?:()=>void}){
 const options=finishesSeen?FINISHES.filter(f=>finishesSeen.includes(f)):FINISHES;
 const dialog=useRef<HTMLDialogElement>(null);
 const title=useId();
 const [finish,setFinish]=useState(card.finish||'Standard');
 const [open,setOpen]=useState(false);
 // Fermeture animée : la fenêtre se retire en fondu avant d'être réellement fermée.
 const close=()=>{
  const d=dialog.current;if(!d||!d.open||d.classList.contains('closing'))return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){d.close();return;}
  d.classList.add('closing');
  setTimeout(()=>{d.classList.remove('closing');d.close();},230);
 };
 // Inclinaison de la carte qui suit le pointeur (souris uniquement).
 const tilt=(e:React.PointerEvent<HTMLDivElement>)=>{
  if(e.pointerType!=='mouse')return;
  const r=e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--rx',`${(0.5-(e.clientY-r.top)/r.height)*10}deg`);
  e.currentTarget.style.setProperty('--ry',`${((e.clientX-r.left)/r.width-0.5)*14}deg`);
 };
 const untilt=(e:React.PointerEvent<HTMLDivElement>)=>{e.currentTarget.style.setProperty('--rx','0deg');e.currentTarget.style.setProperty('--ry','0deg');};
 return <><button className="inspect-card" aria-label={`Examiner ${card.known?card.name:'la carte inconnue'}`} onClick={()=>{setFinish(card.finish||'Standard');setOpen(true);dialog.current?.showModal();}}><TarotCard card={card}/><span className="inspect-hint"><Expand size={13}/> Examiner la carte</span></button>
 <dialog className="card-dialog" ref={dialog} aria-labelledby={title} onClose={e=>{if(e.target===e.currentTarget)setOpen(false);}} onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className="card-dialog-content">
  <button className="icon-button dialog-close" aria-label="Fermer le détail" onClick={close}><X size={20}/></button>
  <div className="dialog-art" onPointerMove={tilt} onPointerLeave={untilt}><TarotCard key={finish} card={{...card,finish:card.known?finish:card.finish}}/></div>
  <div className="dialog-copy">
   <span className="eyebrow">Détail de la carte</span>
   <h2 id={title}>{card.known?card.name:'Identité voilée'}</h2>
   <span className="detail-rarity">{card.provisional?'Rareté à définir':card.unique?'Carte unique':card.rarity}</span>
   {card.known&&!card.unique&&options.length>1&&<div className="finish-preview"><span className="eyebrow">Aperçu des finitions</span><div className="finish-switch" aria-label="Prévisualiser une finition">{options.map(f=><button key={f} className={finish===f?'active':''} aria-pressed={finish===f} onClick={()=>setFinish(f)}>{f}</button>)}</div><small>{finishesSeen?'Finitions que vous avez obtenues.':'Comparaison visuelle de la même carte.'}</small></div>}
   <dl><div><dt>Numéro</dt><dd>{card.id}</dd></div><div><dt>Clan</dt><dd>{card.known?(card.clan!=='?'?card.clan:'À définir'):'À découvrir'}</dd></div><div><dt>Titre / fonction</dt><dd>{card.known?card.role||'À définir':'Identité voilée'}</dd></div>{finishesSeen?card.known&&<div><dt>Finitions obtenues</dt><dd>{options.join(', ')||'—'}</dd></div>:<div><dt>Finition d’origine</dt><dd>{card.finish||'Standard'}</dd></div>}</dl>
   {open&&card.known&&characterId&&onChanged&&<OwnedCopies characterId={characterId} onChanged={onChanged}/>}
   {card.provisional&&<p className="detail-note">Étude graphique de {card.name} · Clan et rareté à définir.</p>}
  </div>
 </div></dialog></>;
}

function OwnedCopies({characterId,onChanged}:{characterId:string;onChanged:()=>void}){
 const {client,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [items,setItems]=useState<InventoryItem[]|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});
 const load=useCallback(async()=>{if(client)setItems(await callRpc<InventoryItem[]>(client,'get_inventory',{p_character_id:characterId}).catch(()=>[]));},[client,characterId]);
 useEffect(()=>{void load();},[load]);

 async function run(action:()=>Promise<string|null>){
  setBusy(true);setMessage({});
  try{const notice=await action();await load();if(notice){setMessage({notice});onChanged();void refreshPlayer();}}
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

 const sell=(it:InventoryItem)=>run(async()=>{
  const raw=await ask({title:'Mettre en vente',message:`Fixez votre prix en Deniers. Une commission de 5 % est déduite à la vente ; l’exemplaire est réservé tant que l’annonce est active.${it.finish!=='Standard'?` Finition ${it.finish}.`:''}`,inputLabel:'Prix (Deniers)',initialValue:String(Math.max(it.value*2,10)),confirmLabel:'Mettre en vente'});
  if(raw===null)return null;
  const price=Number(raw.replace(/\s/g,''));
  if(!Number.isInteger(price)||price<1)throw new Error('Prix invalide : un nombre entier de Deniers, au moins 1.');
  const r=await callRpc<{net:number}>(client!,'create_listing',{p_instance_id:it.instance_id,p_price:price,p_request_id:crypto.randomUUID()});
  return `En vente à ${price.toLocaleString('fr-FR')} Deniers · vous recevrez ${r.net.toLocaleString('fr-FR')}`;
 });
 const unlist=(it:InventoryItem)=>run(async()=>{await callRpc(client!,'cancel_listing',{p_listing_id:it.listing_id});return 'Annonce retirée.';});
 if(!items)return <div className="owned-copies"><Skeleton style={{height:44}}/><Skeleton style={{height:44}}/></div>;
 const extras=items.filter(i=>i.finish==='Standard'&&!i.locked&&!i.reserved&&!i.unique).slice(1);
 return <section className="owned-copies" aria-label="Vos exemplaires">
  {askNode}
  <div className="owned-head"><span className="eyebrow">Vos exemplaires</span><strong>{items.length}</strong></div>
  {items.length===0?<p className="muted">Vous ne possédez plus d’exemplaire de cette carte. Elle reste découverte dans votre album.</p>:<ul className="owned-list">{items.map(it=><li key={it.instance_id} className={`finish-${it.finish==='Dorée'?'gold':it.finish==='Sanglante'?'blood':'standard'} ${it.listing_id?'listed':''}`}>
   <div className="owned-top">
    <span className="owned-finish">{it.finish}<small>Obtenue le {new Date(it.acquired_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}</small></span>
    {it.listing_id?<span className="listed-badge"><Tag size={12}/> En vente · {(it.listing_price??0).toLocaleString('fr-FR')}</span>
     :<button className={`lock-toggle ${it.locked?'on':''}`} disabled={busy} aria-pressed={it.locked} aria-label={it.locked?'Déverrouiller cet exemplaire':'Verrouiller cet exemplaire'} onClick={()=>void toggleLock(it)}>{it.locked?<Lock size={14}/>:<LockOpen size={14}/>}<span>{it.locked?'Verrouillée':'Verrouiller'}</span></button>}
   </div>
   <div className="owned-actions">
    {it.listing_id?<button className="action-btn" disabled={busy} onClick={()=>void unlist(it)}><X size={14}/> Retirer la vente</button>
     :<><button className="action-btn sell" disabled={busy||it.locked||it.reserved} onClick={()=>void sell(it)}><Tag size={14}/> Vendre</button>
      <span className="action-sep" aria-hidden="true"/>
      {it.unique?<span className="owned-note">Indestructible</span>:<button className="action-btn recycle" disabled={busy||it.locked||it.reserved} onClick={()=>void recycle([it])}><Recycle size={14}/> Recycler <b>+{it.value.toLocaleString('fr-FR')}</b></button>}</>}
   </div>
   {it.locked&&!it.listing_id&&<small className="owned-hint">Verrouillée : protégée de la vente et du recyclage.</small>}
  </li>)}</ul>}
  {extras.length>0&&<button className="primary ghost compact" disabled={busy} onClick={()=>void recycle(extras)}><Recycle size={14}/> Recycler les {extras.length} doublon{extras.length>1?'s':''} Standard · +{extras.reduce((s,i)=>s+i.value,0).toLocaleString('fr-FR')}</button>}
  {message.error&&<p className="auth-error" role="alert">{message.error}</p>}{message.notice&&<p className="auth-notice" role="status">{message.notice}</p>}
 </section>;
}
