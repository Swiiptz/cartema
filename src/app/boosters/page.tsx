'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowUpRight,Check,Coins,Eye,Layers3,RotateCcw,Settings2,ShieldCheck,Sparkles,Volume2,VolumeX,X} from 'lucide-react';
import {CardBack,TarotCard,palette,type DemoCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {callRpc,openedToCard,revealOrder,GameError,type Opening} from '@/lib/game';
import {previewPack} from '@/data/demo';
import {BoosterSkin} from '@/components/BoosterSkin';

type Phase='sealed'|'opening'|'reveal';
type Pending={requestId:string;editionId:string};
// La clé de requête survit au rechargement : rejouer une ouverture interrompue renvoie
// le même tirage côté serveur, sans consommer un second booster.
const PENDING_KEY='cartema.pendingOpening';
function readPending():Pending|null{try{const raw=sessionStorage.getItem(PENDING_KEY);return raw?JSON.parse(raw) as Pending:null;}catch{return null;}}
function writePending(p:Pending|null){try{if(p)sessionStorage.setItem(PENDING_KEY,JSON.stringify(p));else sessionStorage.removeItem(PENDING_KEY);}catch{/* stockage facultatif */}}
export default function Boosters(){
 const {configured,session,client,player,refreshPlayer}=useAuth();
 const live=Boolean(configured&&session&&client);
 const [phase,setPhase]=useState<Phase>('sealed');
 const [opening,setOpening]=useState<Opening|null>(null);
 const [editionId,setEditionId]=useState<string|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [buying,setBuying]=useState<string|null>(null);
 const flow=useRef({animationDone:false,result:null as Opening|null});
 const [ask,askNode]=useAsk();
 const [revealed,setRevealed]=useState<number[]>([]);
 const [options,setOptions]=useState(false);
 const [sound,setSound]=useState(false);
 const [effects,setEffects]=useState(true);
 const [cascading,setCascading]=useState(false);
 const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
 const audio=useRef<AudioContext|null>(null);
 const startY=useRef<{x:number;y:number}|null>(null);
 const openingLock=useRef(false);
 const revealedRef=useRef(new Set<number>());
 const [burst,setBurst]=useState<number|null>(null);
 // Révélation en pile : une seule carte à la fois, toucher pour la retourner puis pour passer à la suivante.
 const [current,setCurrent]=useState(0);
 const [leaving,setLeaving]=useState(false);
 const activeCard=useRef<HTMLButtonElement>(null);
 const editions=player?.editions.filter(e=>e.openable)??[];
 const edition=editions.find(e=>e.id===editionId)??editions[0];
 const available=player?player.boosters.free+player.boosters.purchased:0;
 const pack:DemoCard[]=revealOrder(live?(opening?.cards.map(openedToCard)??[]):previewPack);
 const stacked=phase==='reveal'&&current<pack.length;
 const complete=phase==='reveal'&&!stacked&&revealed.length===pack.length;
 useEffect(()=>{if(stacked)activeCard.current?.focus({preventScroll:true});},[stacked,current]);
 useEffect(()=>()=>{timers.current.forEach(clearTimeout);void audio.current?.close();},[]);
 useEffect(()=>{if(live)setPending(readPending());},[live]);
 const maybeReveal=useCallback(()=>{const f=flow.current;if(f.animationDone&&(!live||f.result)){setOpening(f.result);setPhase('reveal');}},[live]);
 function tone(index=0){
  if(!sound)return;
  try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.type='sine';osc.frequency.value=[261.63,329.63,392,523.25,659.25][index];gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.6);}catch{/* Sound is optional. */}
 }
 function open(resume?:Pending){
  if(openingLock.current)return;
  let request:Pending|null=null;
  if(live){
   request=resume??pending??(edition?{requestId:crypto.randomUUID(),editionId:edition.id}:null);
   if(!request){setError('Aucune édition n’est ouverte aux boosters pour le moment.');return;}
   if(!resume&&!pending&&available<1){setError('Aucun booster disponible dans votre réserve.');return;}
   writePending(request);setPending(request);
  }
  openingLock.current=true;setError(null);flow.current={animationDone:false,result:null};
  tone();setPhase('opening');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  timers.current.push(setTimeout(()=>{flow.current.animationDone=true;maybeReveal();},reduced?150:1950));
  if(live&&request)void callRpc<Opening>(client!,'open_booster',{p_edition_id:request.editionId,p_request_id:request.requestId}).then(result=>{
   writePending(null);setPending(null);flow.current.result=result;maybeReveal();void refreshPlayer();
  },(e:GameError)=>{
   // Refus définitif : la clé est abandonnée. Incident réseau : on la garde pour rejouer.
   if(e.definitive){writePending(null);setPending(null);}
   timers.current.forEach(clearTimeout);timers.current=[];openingLock.current=false;setPhase('sealed');setError(e.message);void refreshPlayer();
  });
 }
 async function buy(quantity:string){
  if(!client||buying)return;
  setBuying(quantity);setError(null);
  try{await callRpc(client,'buy_boosters',{p_quantity:Number(quantity),p_request_id:crypto.randomUUID()});await refreshPlayer();}
  catch(e){setError((e as Error).message);}
  finally{setBuying(null);}
 }
 function tilt(e:React.PointerEvent<HTMLButtonElement>){if(e.pointerType!=='mouse'||phase!=='sealed')return;const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--tilt-x',`${(0.5-(e.clientY-r.top)/r.height)*14}deg`);e.currentTarget.style.setProperty('--tilt-y',`${((e.clientX-r.left)/r.width-0.5)*20}deg`);}
 function clearTilt(e:React.PointerEvent<HTMLButtonElement>){e.currentTarget.style.setProperty('--tilt-x','0deg');e.currentTarget.style.setProperty('--tilt-y','0deg');startY.current=null;}
 function reveal(i:number){if(revealedRef.current.has(i))return;revealedRef.current.add(i);setRevealed(old=>[...old,i]);tone(i);setBurst(i);}
 function advance(){
  if(leaving)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCurrent(c=>c+1);return;}
  setLeaving(true);
  timers.current.push(setTimeout(()=>{setLeaving(false);setBurst(null);setCurrent(c=>c+1);},380));
 }
 function touchActive(){if(revealedRef.current.has(current))advance();else reveal(current);}
 function revealAll(){
  if(cascading)return;
  setCascading(true);setLeaving(false);setCurrent(pack.length);
  pack.map((_,i)=>i).filter(i=>!revealedRef.current.has(i)).forEach((i,k)=>timers.current.push(setTimeout(()=>reveal(i),250+k*180)));
 }
 function reset(){timers.current.forEach(clearTimeout);timers.current=[];setRevealed([]);revealedRef.current.clear();openingLock.current=false;setBurst(null);setCascading(false);setCurrent(0);setLeaving(false);setOpening(null);setPhase('sealed');}
 return <div className={`opening-page ${effects?'with-effects':''}`}>{askNode}
  <div className="opening-toolbar"><Link href="/" className="back-link"><ArrowLeft size={15}/> Le cabinet</Link><span className="toolbar-title">L’atelier des arcanes</span><div className="toolbar-actions"><button className={`icon-button ${options?'selected':''}`} aria-label="Options d’ouverture" aria-expanded={options} onClick={()=>setOptions(!options)}><Settings2 size={17}/></button><button className="icon-button" aria-label={sound?'Couper le son':'Activer le son'} aria-pressed={sound} onClick={()=>setSound(!sound)}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div></div>
  {options&&<div className="opening-options panel"><div className="section-header"><span className="eyebrow">Votre rituel</span><button className="icon-button" aria-label="Fermer les options" onClick={()=>setOptions(false)}><X size={16}/></button></div><label><input type="checkbox" checked={effects} onChange={e=>setEffects(e.target.checked)}/> Lumière et particules d’ambiance</label><label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/> Notes sonores à la révélation</label><small>La réduction des animations de votre appareil est respectée.</small></div>}
  <header className="opening-heading"><div className="eyebrow"><span className="tiny-rule"/> Un rendez-vous avec l’inconnu <span className="tiny-rule"/></div><h1>{phase==='reveal'?'Le voile se lève.':'Ce que la nuit vous réserve.'}</h1><p>{phase==='reveal'?'Cinq arcanes, un à un.':'Cinq cartes, cinq destins. Un nouveau chapitre de votre collection.'}</p></header>
  {live?<div className="edition-label"><span className="status-light"/> {editions.length>1&&phase==='sealed'?<select aria-label="Édition du booster" value={edition?.id} onChange={e=>setEditionId(e.target.value)}>{editions.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>:(edition?.name??'Aucune édition ouverte')} <span className="edition-divider"/> Édition permanente</div>:<div className="edition-label"><span className="status-light"/> Camarilla <span className="edition-divider"/> Aperçu</div>}
  <section className={`ritual-stage ${phase}`} aria-label="Prévisualisation d’ouverture de booster">
   <div className="ritual-halo" aria-hidden="true"/>{phase==='opening'&&effects&&<div className="seal-light" aria-hidden="true"/>}<div className="ritual-orbit orbit-one" aria-hidden="true"/><div className="ritual-orbit orbit-two" aria-hidden="true"/>
   {effects&&<div className="motes" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} style={{'--i':i,left:`${8+(i*37)%85}%`,top:`${10+(i*23)%80}%`} as React.CSSProperties}/>)}</div>}
   {phase!=='reveal'?<div className="sealed-scene"><div className="ghost-card ghost-left"><CardBack/></div><div className="ghost-card ghost-right"><CardBack/></div><button className="pack-object" disabled={phase==='opening'} aria-label="Déchirer la languette du booster" onClick={()=>open()} onPointerMove={tilt} onPointerLeave={clearTilt} onPointerCancel={clearTilt} onPointerDown={e=>{startY.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{if(startY.current!==null&&(Math.abs(e.clientX-startY.current.x)>40||startY.current.y-e.clientY>30))open();startY.current=null;}}><span className="pack-side pack-side-left" aria-hidden="true"/><span className="pack-side pack-side-right" aria-hidden="true"/><span className="pack-top-edge" aria-hidden="true"/><span className="pack-face pack-reverse" aria-hidden="true"><CardBack/></span><span className="pack-face pack-obverse"><span className="packet-mouth" aria-hidden="true"/><span className="packet-body"><BoosterSkin/></span><span className="packet-tear"><BoosterSkin/></span><span className="packet-pull-tab" aria-hidden="true"/><span className="packet-torn-edge" aria-hidden="true"/><span className="pack-reflection" aria-hidden="true"/></span></button><div className="pack-ground"/></div>:stacked?(()=>{const card=pack[current];const shown=revealed.includes(current);const behind=Math.min(4,pack.length-current-1);return <div className="reveal-stack-scene">
    <div className="reveal-stack">
     <div key={current} className={`reveal-slot stack-active ${shown?'slot-revealed':''} ${leaving?'is-leaving':''} ${card.finish==='Dorée'?'slot-gold':card.finish==='Sanglante'?'slot-blood':''}`} style={{'--slot-color':card.finish==='Dorée'?'#f1d99b':card.finish==='Sanglante'?'#a92646':palette[card.rarity]} as React.CSSProperties}>{effects&&burst===current&&<span className="reveal-burst" key={`burst-${current}`} aria-hidden="true">{Array.from({length:10},(_,j)=><i key={j} style={{'--ray':j} as React.CSSProperties}/>)}</span>}<button ref={activeCard} className={`flip-card ${shown?'is-revealed':''}`} style={{'--glow':palette[card.rarity]} as React.CSSProperties} aria-label={shown?`${card.name}, ${card.rarity}${card.finish&&card.finish!=='Standard'?`, finition ${card.finish}`:''}. ${current+1<pack.length?'Carte suivante':'Voir les cinq cartes'}`:`Retourner la carte ${current+1} sur ${pack.length}`} onClick={touchActive}><span className="flip-inner"><span className="flip-back" aria-hidden={shown}><CardBack/></span><span className="flip-front" aria-hidden={!shown}><TarotCard card={card}/></span></span></button></div>
     {Array.from({length:behind},(_,k)=>behind-k).map(depth=><span className="stack-card" key={depth} style={{'--depth':depth} as React.CSSProperties} aria-hidden="true"><CardBack/></span>)}
    </div>
    <p className="stack-caption" aria-live="polite">{shown?<><Check size={13}/> <strong>{card.name}</strong> · {card.unique?'Carte unique':card.finish&&card.finish!=='Standard'?card.finish:card.rarity}</>:`Carte ${current+1} sur ${pack.length}`}</p>
    <div className="reveal-tray" aria-hidden="true">{pack.map((c,i)=><span key={i} className={`tray-slot ${i<current?'filled':''}`}>{i<current&&<TarotCard card={c}/>}</span>)}</div>
   </div>;})():<div className="reveal-grid">{pack.map((card,i)=><div className={`reveal-slot ${revealed.includes(i)?'slot-revealed':''} ${card.finish==='Dorée'?'slot-gold':card.finish==='Sanglante'?'slot-blood':''}`} key={i} style={{'--index':i,'--slot-color':card.finish==='Dorée'?'#f1d99b':card.finish==='Sanglante'?'#a92646':palette[card.rarity]} as React.CSSProperties}>{effects&&burst===i&&<span className="reveal-burst" key={`burst-${i}`} aria-hidden="true">{Array.from({length:10},(_,j)=><i key={j} style={{'--ray':j} as React.CSSProperties}/>)}</span>}<button className={`flip-card ${revealed.includes(i)?'is-revealed':''}`} style={{'--glow':palette[card.rarity],'--index':i} as React.CSSProperties} aria-label={revealed.includes(i)?`${card.name}, ${card.rarity}`:`Révéler la carte ${i+1}`} aria-pressed={revealed.includes(i)} disabled={revealed.includes(i)} onClick={()=>reveal(i)}><span className="flip-inner"><span className="flip-back" aria-hidden={revealed.includes(i)}><CardBack/></span><span className="flip-front" aria-hidden={!revealed.includes(i)}><TarotCard card={card}/></span></span></button><span className="card-index">{revealed.includes(i)?<><Check size={12}/><span>{card.finish&&card.finish!=='Standard'?card.finish:card.rarity}</span></>:String(i+1).padStart(2,'0')}</span></div>)}</div>}
  </section>
  <div className="ritual-controls" aria-live="polite">
   {phase==='sealed'?<><p className="gesture-hint"><span className="hint-line"/> Tirez la languette. Révélez l’invisible. <span className="hint-line"/></p><button className="primary open-button" disabled={live&&!pending&&(available<1||!edition)} onClick={()=>open()}><Sparkles size={17}/> Déchirer le booster <ArrowUpRight size={17}/></button>{live?<span className="control-caption">{pending?'Une ouverture a été interrompue : elle reprendra le même tirage.':`${available} booster${available>1?'s':''} dans votre réserve`}</span>:<span className="control-caption">5 cartes · aperçu sans consommation de booster{configured&&<> · <Link className="text-link" href="/connexion/">Se connecter pour ouvrir</Link></>}</span>}{error&&<p className="auth-error" role="alert">{error}</p>}</>:phase==='opening'?<p className="eyebrow">Les arcanes s’éveillent…</p>:<><p className="reveal-count">{complete?'Votre rituel est complet.':stacked?(revealed.includes(current)?(current+1<pack.length?'Touchez la carte pour passer à la suivante':'Touchez la carte pour voir vos cinq arcanes'):'Touchez la carte pour la retourner'):'Les derniers arcanes se dévoilent…'}</p>{complete?<button className="primary" onClick={reset} disabled={live&&available<1}><RotateCcw size={16}/> {live?'Ouvrir un autre booster':'Rejouer le rituel'}</button>:<button className="primary ghost" disabled={cascading} onClick={revealAll}><Eye size={17}/> Tout révéler</button>}<span className="control-caption">{complete?(live?<>Ces cartes sont dans votre <Link className="text-link" href="/collection/">collection</Link>.</>:'Aperçu visuel : les cartes ne sont pas ajoutées à votre collection.'):'Une carte à la fois · « Tout révéler » pour aller plus vite.'}</span></>}
  </div>
  <div className="ritual-footer"><span><Layers3 size={15}/> 5 cartes par booster</span><span><ShieldCheck size={15}/> Rare ou supérieure en 5e carte</span><span><Sparkles size={15}/> 3 finitions à découvrir</span></div>
  <div className="opening-bottom"><div><span className="eyebrow">Le don des arcanes</span><p>Un booster à 06 h et à 18 h. La nuit sait être généreuse.</p></div>{live&&player?<div className="reserve-preview"><div className="pips" aria-label={`Réserve gratuite : ${player.boosters.free} sur ${player.boosters.free_capacity}`}>{Array.from({length:player.boosters.free_capacity},(_,i)=><i className={i<player.boosters.free?'on':''} key={i}/>)}</div><span>{player.boosters.free} / {player.boosters.free_capacity} <small>{player.boosters.purchased?`+ ${player.boosters.purchased} acheté${player.boosters.purchased>1?'s':''}`:'réserve gratuite'}</small></span></div>:<div className="reserve-preview"><div className="pips" aria-label="Exemple de réserve : 4 sur 6">{Array.from({length:6},(_,i)=><i className={i<4?'on':''} key={i}/>)}</div><span>4 / 6 <small>exemple de réserve</small></span></div>}</div>
  {live&&player?<section className="booster-shop panel" aria-label="Boutique de boosters"><div className="section-header"><div><span className="eyebrow">L’échoppe</span><h2>Boosters supplémentaires</h2></div><span className="shop-balance"><Coins size={15}/> {player.balance.toLocaleString('fr-FR')} Deniers</span></div><div className="shop-offers">{Object.entries(player.booster_offers).sort((a,b)=>Number(a[0])-Number(b[0])).map(([qty,price])=><button key={qty} className="primary ghost" disabled={!!buying||player.balance<price||!editions.length} onClick={()=>void ask({title:`Acheter ${qty} booster${Number(qty)>1?'s':''} ?`,message:`${price.toLocaleString('fr-FR')} Deniers seront débités. Il vous restera ${(player.balance-price).toLocaleString('fr-FR')} Deniers.`,confirmLabel:'Acheter'}).then(ok=>{if(ok!==null)void buy(qty);})}>{buying===qty?'Achat…':`${qty} booster${Number(qty)>1?'s':''} · ${price.toLocaleString('fr-FR')} Deniers`}</button>)}</div><small className="muted">Mêmes probabilités qu’un booster gratuit. L’édition se choisit à l’ouverture.</small></section>:<p className="demo-note">Atelier de démonstration · Cartes de présentation, aucun tirage réel ni ajout à la collection.</p>}
 </div>;
}
