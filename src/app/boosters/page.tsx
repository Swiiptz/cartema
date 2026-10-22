'use client';
import {EventBanner} from '@/components/EventBanner';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft,ArrowUpRight,Check,ChevronLeft,ChevronRight,Coins,Crown,Eye,Layers3,RotateCcw,Settings2,ShieldCheck,Sparkles,Volume2,VolumeX,X} from 'lucide-react';
import {CardBack,TarotCard,palette,type DemoCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {CountUp,Countdown,Sheet} from '@/components/ui';
import {callRpc,openedToCard,revealOrder,GameError,type Opening,type PlayerEdition} from '@/lib/game';
import {previewPack} from '@/data/demo';
import {BoosterSkin} from '@/components/BoosterSkin';

type Phase='sealed'|'opening'|'reveal';
// Cartes qui méritent une révélation spectaculaire, et finitions à signaler.
type Tier='unique'|'mythique'|'legendaire';
function rarityTier(c:DemoCard):Tier|null{return c.unique?'unique':c.rarity==='Mythique'?'mythique':c.rarity==='Légendaire'?'legendaire':null;}
function finishTier(c:DemoCard):'gold'|'blood'|null{return c.finish==='Dorée'?'gold':c.finish==='Sanglante'?'blood':null;}
const TIER_LABEL:Record<Tier,string>={unique:'Carte unique',mythique:'Mythique',legendaire:'Légendaire'};
const FINISH_LABEL={gold:'Finition Dorée',blood:'Finition Sanglante'} as const;
type Pending={requestIds:string[];editionId:string};
// Aperçu local sans Supabase : une édition ouvrable et une annoncée, pour voir le carrousel.
const DEMO_CAROUSEL:PlayerEdition[]=[{id:'demo-cam',name:'Camarilla',prefix:'CAM',openable:true,theme:'camarilla'},{id:'demo-ane',name:'Les Sommets',prefix:'ANE',openable:false,teaser:true,theme:'alpes'}];
const OPEN_COUNTS=[1,3,5,10];
// La clé de requête survit au rechargement : rejouer une ouverture interrompue renvoie
// le même tirage côté serveur, sans consommer un second booster.
const PENDING_KEY='cartema.pendingOpening';
function readPending():Pending|null{try{const raw=sessionStorage.getItem(PENDING_KEY);if(!raw)return null;const p=JSON.parse(raw);return p.requestIds?p as Pending:p.requestId?{requestIds:[p.requestId],editionId:p.editionId}:null;}catch{return null;}}
function writePending(p:Pending|null){try{if(p)sessionStorage.setItem(PENDING_KEY,JSON.stringify(p));else sessionStorage.removeItem(PENDING_KEY);}catch{/* stockage facultatif */}}
export default function Boosters(){
 const {configured,session,client,player,refreshPlayer}=useAuth();
 const live=Boolean(configured&&session&&client);
 // En ligne sans compte : le paquet reste visible, mais l'ouverture mène à la connexion (pas de tirage fictif).
 const visitor=configured&&!live;
 const router=useRouter();
 const [phase,setPhase]=useState<Phase>('sealed');
 const [opening,setOpening]=useState<Opening|null>(null);
 const [editionId,setEditionId]=useState<string|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [buying,setBuying]=useState<string|null>(null);
 const flow=useRef({animationDone:false,result:null as Opening|null,godShown:false});
 // God booster : le sachet se change en or avant la révélation.
 const [god,setGod]=useState(false);
 // Un glissement horizontal change d'édition : le clic qui suit ne doit pas ouvrir le paquet.
 const swiped=useRef(false);
 const [swap,setSwap]=useState<'next'|'prev'|null>(null);
 const [shopOpen,setShopOpen]=useState(false);
 const [offer,setOffer]=useState<string|null>(null);
 // ?boutique=1 (depuis l'accueil) ouvre directement la boutique.
 useEffect(()=>{if(live&&new URLSearchParams(window.location.search).get('boutique'))setShopOpen(true);},[live]);
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
 const [count,setCount]=useState(1);
 const [leaving,setLeaving]=useState(false);
 const activeCard=useRef<HTMLButtonElement>(null);
 // Carrousel : éditions ouvertes puis annoncées (« Soon », grisées, sans ouverture ni achat).
 const carousel=player?player.editions.filter(e=>e.openable||e.teaser):configured?[]:DEMO_CAROUSEL;
 const editions=carousel.filter(e=>e.openable);
 const sel=carousel.find(e=>e.id===editionId)??editions[0]??carousel[0];
 const edition=sel&&!sel.teaser?sel:undefined;
 const soon=!!sel?.teaser;
 const selIndex=Math.max(0,carousel.findIndex(e=>e.id===sel?.id));
 const prevEdition=carousel[selIndex-1],nextEdition=carousel[selIndex+1];
 const step=(d:number)=>{const n=carousel[selIndex+d];if(!n||phase!=='sealed'||pending)return;setSwap(d>0?'next':'prev');setEditionId(n.id);setCount(1);setError(null);};
 // Gratuits et récompenses : toute édition ; achats : seulement l'édition choisie.
 const available=player?player.boosters.free+player.boosters.purchased+(edition?.reserve??0):0;
 const offers=edition?.offers??player?.booster_offers??{};
 const skin={name:sel?.name??'Camarilla',theme:god?'gold' as const:sel?.theme??'camarilla'};
 const pack:DemoCard[]=revealOrder(live?(opening?.cards.map(openedToCard)??[]):previewPack);
 const stacked=phase==='reveal'&&current<pack.length;
 const complete=phase==='reveal'&&!stacked&&revealed.length===pack.length;
 useEffect(()=>{if(stacked)activeCard.current?.focus({preventScroll:true});},[stacked,current]);
 useEffect(()=>()=>{timers.current.forEach(clearTimeout);void audio.current?.close();},[]);
 useEffect(()=>{if(live)setPending(readPending());},[live]);
 const maybeReveal=useCallback(()=>{
  const f=flow.current;if(!f.animationDone||(live&&!f.result))return;
  // God booster : un temps de plus pour la transformation dorée avant les cartes.
  if(f.result?.god&&!f.godShown){f.godShown=true;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;timers.current.push(setTimeout(()=>{setOpening(f.result);setPhase('reveal');},reduced?300:1800));return;}
  setOpening(f.result);setPhase('reveal');
 },[live]);
 function tone(index=0){
  if(!sound)return;
  try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.type='sine';osc.frequency.value=[261.63,329.63,392,523.25,659.25][index%5];gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.6);}catch{/* Sound is optional. */}
 }
 function open(resume?:Pending){
  if(openingLock.current)return;
  if(swiped.current){swiped.current=false;return;}
  if(visitor){router.push('/connexion/');return;}
  if(soon&&!resume&&!pending)return;
  let request:Pending|null=null;
  if(live){
   const n=Math.max(1,Math.min(count,available));
   request=resume??pending??(edition?{requestIds:Array.from({length:n},()=>crypto.randomUUID()),editionId:edition.id}:null);
   if(!request){setError('Aucune édition n’est ouverte aux boosters pour le moment.');return;}
   if(!resume&&!pending&&available<1){setError('Aucun booster disponible dans votre réserve.');return;}
   writePending(request);setPending(request);
  }
  openingLock.current=true;setError(null);flow.current={animationDone:false,result:null,godShown:false};setGod(false);
  tone();setPhase('opening');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  timers.current.push(setTimeout(()=>{flow.current.animationDone=true;maybeReveal();},reduced?150:1950));
  if(live&&request)void openAll(request);
 }
 // Chaque paquet est une transaction serveur distincte et idempotente : un rechargement rejoue
 // les mêmes clés (tirages déjà faits renvoyés à l'identique, les autres effectués une fois).
 async function openAll(request:Pending){
  const results:Opening[]=[];
  let failure:GameError|null=null;
  for(const requestId of request.requestIds){
   try{results.push(await callRpc<Opening>(client!,'open_booster',{p_edition_id:request.editionId,p_request_id:requestId}));}
   catch(e){failure=e as GameError;break;}
  }
  void refreshPlayer();
  if(failure&&!failure.definitive){
   // Incident réseau : on garde toutes les clés pour reprendre plus tard.
   timers.current.forEach(clearTimeout);timers.current=[];openingLock.current=false;setPhase('sealed');setError(failure.message);return;
  }
  writePending(null);setPending(null);
  if(!results.length){
   timers.current.forEach(clearTimeout);timers.current=[];openingLock.current=false;setPhase('sealed');setError(failure?.message??'Ouverture impossible.');return;
  }
  if(failure)setError(`${results.length} booster${results.length>1?'s':''} ouvert${results.length>1?'s':''} sur ${request.requestIds.length} : ${failure.message}`);
  flow.current.result={...results[0],cards:results.flatMap(r=>r.cards),replayed:results.every(r=>r.replayed),god:results.some(r=>r.god)};
  if(flow.current.result.god)setGod(true);
  maybeReveal();
 }
 async function buy(quantity:string){
  if(!client||buying)return;
  setBuying(quantity);setError(null);
  if(!edition)return;
  try{await callRpc(client,'buy_boosters',{p_quantity:Number(quantity),p_request_id:crypto.randomUUID(),p_edition_id:edition.id});await refreshPlayer();setOffer(null);setShopOpen(false);}
  catch(e){setError((e as Error).message);}
  finally{setBuying(null);}
 }
 function tilt(e:React.PointerEvent<HTMLButtonElement>){if(e.pointerType!=='mouse'||phase!=='sealed')return;const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--tilt-x',`${(0.5-(e.clientY-r.top)/r.height)*14}deg`);e.currentTarget.style.setProperty('--tilt-y',`${((e.clientX-r.left)/r.width-0.5)*20}deg`);}
 function clearTilt(e:React.PointerEvent<HTMLButtonElement>){e.currentTarget.style.setProperty('--tilt-x','0deg');e.currentTarget.style.setProperty('--tilt-y','0deg');startY.current=null;}
 function epicTone(){
  if(!sound)return;
  try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume();[392,493.88,587.33,783.99].forEach((f,k)=>{const osc=ctx.createOscillator();const gain=ctx.createGain();osc.type='triangle';osc.frequency.value=f;const t=ctx.currentTime+k*.09;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.04,t+.03);gain.gain.exponentialRampToValueAtTime(.001,t+1.4);osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+1.4);});}catch{/* Son facultatif. */}
 }
 function reveal(i:number){if(revealedRef.current.has(i))return;revealedRef.current.add(i);setRevealed(old=>[...old,i]);const c=pack[i];if(c&&rarityTier(c))epicTone();else tone(i);setBurst(i);}
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
  const rest=pack.map((_,i)=>i).filter(i=>!revealedRef.current.has(i));const step=Math.min(180,2400/Math.max(1,rest.length));
  rest.forEach((i,k)=>timers.current.push(setTimeout(()=>reveal(i),250+k*step)));
 }
 function reset(){timers.current.forEach(clearTimeout);timers.current=[];setGod(false);setRevealed([]);revealedRef.current.clear();openingLock.current=false;setBurst(null);setCascading(false);setCurrent(0);setLeaving(false);setOpening(null);setPhase('sealed');}
 return <div className={`opening-page ${effects?'with-effects':''}`}>
  <div className="opening-toolbar"><Link href="/" className="back-link"><ArrowLeft size={15}/> Le cabinet</Link><span className="toolbar-title">L’atelier des arcanes</span><div className="toolbar-actions"><button className={`icon-button ${options?'selected':''}`} aria-label="Options d’ouverture" aria-expanded={options} onClick={()=>setOptions(!options)}><Settings2 size={17}/></button><button className="icon-button" aria-label={sound?'Couper le son':'Activer le son'} aria-pressed={sound} onClick={()=>setSound(!sound)}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div></div>
  {options&&<div className="opening-options panel"><div className="section-header"><span className="eyebrow">Votre rituel</span><button className="icon-button" aria-label="Fermer les options" onClick={()=>setOptions(false)}><X size={16}/></button></div><label><input type="checkbox" checked={effects} onChange={e=>setEffects(e.target.checked)}/> Lumière et particules d’ambiance</label><label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/> Notes sonores à la révélation</label><small>La réduction des animations de votre appareil est respectée.</small></div>}
  {live&&player&&<EventBanner compact/>}
  {live&&player&&<div className="reserve-bar rise">
   <span className="chip" title="Boosters gratuits"><span className="mini-pips" aria-hidden="true">{Array.from({length:player.boosters.free_capacity},(_,k)=><i key={k} className={k<player.boosters.free?'on':''}/>)}</span>{player.boosters.free}/{player.boosters.free_capacity}<small>gratuits</small></span>
   {player.boosters.purchased>0&&<span className="chip" title="Récompenses et anciens achats : ouvrables sur toutes les éditions"><Layers3 size={14}/>{player.boosters.purchased}<small>bonus</small></span>}
   {(edition?.reserve??0)>0&&<span className="chip" title={`Achetés pour ${edition!.name} : ouvrables seulement sur cette édition`}><Coins size={14}/>{edition!.reserve}<small>{edition!.name}</small></span>}
   <span className="chip">{player.boosters.free>=player.boosters.free_capacity?<small>Réserve pleine</small>:<><small>Prochain dans</small><Countdown to={player.boosters.next_free_at} onDone={()=>void refreshPlayer()}/></>}</span>
   <button className="chip gold chip-button" onClick={()=>setShopOpen(true)}><Coins size={14}/><CountUp value={player.balance}/><small>· Boutique</small></button>
  </div>}
  <header className="opening-heading"><div className="eyebrow"><span className="tiny-rule"/> Un rendez-vous avec l’inconnu <span className="tiny-rule"/></div><h1>{phase==='reveal'?'Le voile se lève.':'Ce que la nuit vous réserve.'}</h1><p>{phase==='reveal'?pack.length>5?`${pack.length} arcanes, un à un.`:'Cinq arcanes, un à un.':'Cinq cartes, cinq destins. Un nouveau chapitre de votre collection.'}</p></header>
  {live?<div className={`edition-label ${soon?'is-soon':''}`}><span className="status-light"/> {sel?.name??'Aucune édition ouverte'} <span className="edition-divider"/> {soon?'Bientôt':'Édition permanente'}</div>:<div className={`edition-label ${soon?'is-soon':''}`}><span className="status-light"/> {sel?.name??'Camarilla'} <span className="edition-divider"/> {soon?'Bientôt':'Aperçu'}</div>}
  {god&&<div className="god-banner rise" role="status"><Crown size={18}/> <strong>God booster</strong> <span>Toutes les cartes sont dorées</span></div>}
  <section className={`ritual-stage ${phase} ${god?'god':''} ${soon&&phase==='sealed'?'is-soon':''}`} aria-label="Prévisualisation d’ouverture de booster">
   <div className="ritual-halo" aria-hidden="true"/>{phase==='opening'&&effects&&<div className="seal-light" aria-hidden="true"/>}<div className="ritual-orbit orbit-one" aria-hidden="true"/><div className="ritual-orbit orbit-two" aria-hidden="true"/>
   {effects&&<div className="motes" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} style={{'--i':i,left:`${8+(i*37)%85}%`,top:`${10+(i*23)%80}%`} as React.CSSProperties}/>)}</div>}
   {phase!=='reveal'?<div className={`sealed-scene ${soon?'is-soon':''} ${carousel.length>1?'has-carousel':''}`}>{carousel.length>1&&phase==='sealed'?<>
    {prevEdition?<button className={`side-pack side-left ${prevEdition.teaser?'soon':''}`} aria-label={`Booster ${prevEdition.name}${prevEdition.teaser?' (bientôt)':''}`} onClick={()=>step(-1)}><BoosterSkin name={prevEdition.name} theme={prevEdition.theme}/>{prevEdition.teaser&&<span className="pack-soon small">Soon</span>}</button>:<span className="side-pack side-left empty" aria-hidden="true"/>}
    {nextEdition?<button className={`side-pack side-right ${nextEdition.teaser?'soon':''}`} aria-label={`Booster ${nextEdition.name}${nextEdition.teaser?' (bientôt)':''}`} onClick={()=>step(1)}><BoosterSkin name={nextEdition.name} theme={nextEdition.theme}/>{nextEdition.teaser&&<span className="pack-soon small">Soon</span>}</button>:<span className="side-pack side-right empty" aria-hidden="true"/>}
   </>:<><div className="ghost-card ghost-left"><CardBack/></div><div className="ghost-card ghost-right"><CardBack/></div></>}<button key={sel?.id??'pack'} className={`pack-object ${god?'god-transform':''} ${swap&&phase==='sealed'?`swap-${swap}`:''}`} onAnimationEnd={e=>{if(e.animationName.startsWith('pack-swap'))setSwap(null);}} disabled={phase==='opening'||(soon&&!pending)} aria-label={soon?`${sel?.name} : bientôt disponible`:`Déchirer la languette du booster${live&&sel?` ${sel.name}`:''}`} onClick={()=>open()} onPointerMove={tilt} onPointerLeave={clearTilt} onPointerCancel={clearTilt} onPointerDown={e=>{swiped.current=false;startY.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const s=startY.current;startY.current=null;if(!s)return;const dx=e.clientX-s.x,dy=s.y-e.clientY;
     // Glisser à gauche / à droite : édition suivante / précédente ; tirer vers le haut : déchirer.
     if(carousel.length>1&&Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){swiped.current=true;step(dx<0?1:-1);return;}
     if(dy>30)open();}}><span className="pack-side pack-side-left" aria-hidden="true"/><span className="pack-side pack-side-right" aria-hidden="true"/><span className="pack-top-edge" aria-hidden="true"/><span className="pack-face pack-reverse" aria-hidden="true"><CardBack/></span><span className="pack-face pack-obverse"><span className="packet-mouth" aria-hidden="true"/><span className="packet-body"><BoosterSkin {...skin}/></span><span className="packet-tear"><BoosterSkin {...skin}/></span><span className="packet-pull-tab" aria-hidden="true"/><span className="packet-torn-edge" aria-hidden="true"/><span className="pack-reflection" aria-hidden="true"/>{soon&&<span className="pack-soon">Soon</span>}</span></button>{live&&available>1&&<span className="pack-count" aria-hidden="true">×{available}</span>}<div className="pack-ground"/></div>:stacked?(()=>{const card=pack[current];const shown=revealed.includes(current);const behind=Math.min(4,pack.length-current-1);const tier=rarityTier(card),fin=finishTier(card),special=tier??fin;return <div className="reveal-stack-scene">
    {shown&&tier&&<div key={`epic-${current}`} className={`epic-reveal epic-${special} ${effects?'with-rays':''}`} aria-hidden="true"><span className="epic-rays"/><span className="epic-ring"/><span className="epic-banner"><strong>{TIER_LABEL[tier]}</strong>{tier&&fin&&<small>et {FINISH_LABEL[fin].toLowerCase()} !</small>}</span></div>}
    <div className="reveal-stack" style={{'--behind':behind} as React.CSSProperties}>
     <div key={current} className={`reveal-slot stack-active ${!shown&&tier?`hint hint-${tier}`:!shown&&fin?`hint-soft hint-${fin}`:''} ${shown&&fin&&!tier?`finish-flash hint-${fin}`:''} ${shown?'slot-revealed':''} ${leaving?'is-leaving':''} ${card.finish==='Dorée'?'slot-gold':card.finish==='Sanglante'?'slot-blood':''}`} style={{'--slot-color':card.finish==='Dorée'?'#f1d99b':card.finish==='Sanglante'?'#a92646':palette[card.rarity]} as React.CSSProperties}>{effects&&burst===current&&<span className="reveal-burst" key={`burst-${current}`} aria-hidden="true">{Array.from({length:10},(_,j)=><i key={j} style={{'--ray':j} as React.CSSProperties}/>)}</span>}<button ref={activeCard} className={`flip-card ${shown?'is-revealed':''}`} style={{'--glow':palette[card.rarity]} as React.CSSProperties} aria-label={shown?`${card.name}, ${card.rarity}${card.finish&&card.finish!=='Standard'?`, finition ${card.finish}`:''}. ${current+1<pack.length?'Carte suivante':'Voir les cinq cartes'}`:`Retourner la carte ${current+1} sur ${pack.length}`} onClick={touchActive}><span className="flip-inner"><span className="flip-back" aria-hidden={shown}><CardBack/></span><span className="flip-front" aria-hidden={!shown}><TarotCard card={card}/></span></span></button></div>
     {Array.from({length:behind},(_,k)=>behind-k).map(depth=><span className="stack-card" key={depth} style={{'--depth':depth} as React.CSSProperties} aria-hidden="true"><CardBack/></span>)}
    </div>
    <p className="stack-caption" aria-live="polite">{shown?<><Check size={13}/> <strong>{card.name}</strong> · {card.unique?'Carte unique':card.rarity}{fin&&<span className={`finish-pill ${fin}`}>{card.finish}</span>}</>:`Carte ${current+1} sur ${pack.length}`}</p>
    {pack.length>5?<div className="meter reveal-meter" aria-hidden="true"><i style={{'--v':`${current/pack.length*100}%`} as React.CSSProperties}/></div>:<div className="reveal-tray" aria-hidden="true">{pack.map((c,i)=><span key={i} className={`tray-slot ${i<current?'filled':''}`}>{i<current&&<TarotCard card={c}/>}</span>)}</div>}
   </div>;})():<div className={`reveal-grid ${pack.length>5?'many':''}`}>{pack.map((card,i)=><div className={`reveal-slot ${revealed.includes(i)?'slot-revealed':''} ${card.finish==='Dorée'?'slot-gold':card.finish==='Sanglante'?'slot-blood':''}`} key={i} style={{'--index':i,'--slot-color':card.finish==='Dorée'?'#f1d99b':card.finish==='Sanglante'?'#a92646':palette[card.rarity]} as React.CSSProperties}>{effects&&burst===i&&<span className="reveal-burst" key={`burst-${i}`} aria-hidden="true">{Array.from({length:10},(_,j)=><i key={j} style={{'--ray':j} as React.CSSProperties}/>)}</span>}{revealed.includes(i)&&finishTier(card)&&<span className={`finish-ribbon ${finishTier(card)}`}>{card.finish}</span>}<button className={`flip-card ${revealed.includes(i)?'is-revealed':''}`} style={{'--glow':palette[card.rarity],'--index':i} as React.CSSProperties} aria-label={revealed.includes(i)?`${card.name}, ${card.rarity}`:`Révéler la carte ${i+1}`} aria-pressed={revealed.includes(i)} disabled={revealed.includes(i)} onClick={()=>reveal(i)}><span className="flip-inner"><span className="flip-back" aria-hidden={revealed.includes(i)}><CardBack/></span><span className="flip-front" aria-hidden={!revealed.includes(i)}><TarotCard card={card}/></span></span></button><span className="card-index">{revealed.includes(i)?<><Check size={12}/><span>{card.variant?`Version alternative · ${card.variant}`:card.finish&&card.finish!=='Standard'?card.finish:card.rarity}</span></>:String(i+1).padStart(2,'0')}</span></div>)}</div>}
  </section>
  {(live||!configured)&&carousel.length>1&&phase==='sealed'&&<div className="edition-picker" role="tablist" aria-label="Édition du booster">
   <button className="icon-button" aria-label="Édition précédente" disabled={!prevEdition||!!pending} onClick={()=>step(-1)}><ChevronLeft size={18}/></button>
   {carousel.map((e,i)=><button key={e.id} role="tab" aria-selected={i===selIndex} className={`edition-dot ${i===selIndex?'on':''} ${e.teaser?'soon':''}`} disabled={!!pending} onClick={()=>step(i-selIndex)}><i/><span title={e.name}>{e.prefix??e.name}{e.teaser?' · Soon':''}</span></button>)}
   <button className="icon-button" aria-label="Édition suivante" disabled={!nextEdition||!!pending} onClick={()=>step(1)}><ChevronRight size={18}/></button>
  </div>}
  <div className="ritual-controls" aria-live="polite">
   {phase==='sealed'?<>{live&&player?<div className="ready-block">
     <p className="ready-count"><span className="ready-rule" aria-hidden="true"/><span><strong><CountUp value={available}/></strong> booster{available>1?'s':''} en réserve</span><span className="ready-rule" aria-hidden="true"/></p>
     {available>1&&!pending&&<div className="reserve-deck" role="radiogroup" aria-label="Nombre de boosters à ouvrir">
      {Array.from({length:Math.min(available,10)},(_,i)=>{const on=i<Math.min(count,available);return <button key={i} role="radio" aria-checked={Math.min(count,available)===i+1} aria-label={`Ouvrir ${i+1} booster${i?'s':''}`} className={`deck-pack ${on?'on':''}`} style={{'--i':i} as React.CSSProperties} onClick={()=>setCount(i+1)}><span className="deck-pouch" aria-hidden="true"><i/></span></button>;})}
      {available>10&&<span className="deck-more">+{available-10}</span>}
     </div>}
     {available>1&&!pending&&<p className="deck-hint">Touchez les paquets pour en ouvrir plusieurs d’un coup</p>}
    </div>:soon?<p className="gesture-hint"><span className="hint-line"/> Glissez pour changer d’édition. <span className="hint-line"/></p>:<p className="gesture-hint"><span className="hint-line"/> Tirez la languette. Révélez l’invisible. <span className="hint-line"/></p>}<button className="primary open-button" disabled={(soon&&!pending)||(live&&!pending&&(available<1||!edition))} onClick={()=>open()}><Sparkles size={17}/> {visitor?'Se connecter pour ouvrir':soon&&!pending?'Bientôt disponible':pending?'Reprendre l’ouverture':Math.min(count,available)>1?`Ouvrir ${Math.min(count,available)} boosters`:'Déchirer le booster'} <ArrowUpRight size={17}/></button>{live&&player&&!soon&&<button className="text-link buy-link" onClick={()=>setShopOpen(true)}><Coins size={12}/> Acheter des boosters</button>}{live?<span className="control-caption">{pending?'Une ouverture a été interrompue : elle reprendra le même tirage.':soon?`${sel?.name} arrive bientôt. Restez à l’affût.`:edition?`Édition ${edition.name} · 5 cartes par booster`:'Aucune édition ouverte'}</span>:<span className="control-caption">{visitor?'Deux boosters gratuits par jour, à 6 h et 18 h, pour chaque collectionneur.':'5 cartes · aperçu sans consommation de booster'}</span>}{error&&<p className="auth-error" role="alert">{error}</p>}</>:phase==='opening'?<p className="eyebrow">Les arcanes s’éveillent…</p>:<><p className="reveal-count">{complete?'Votre rituel est complet.':stacked?(revealed.includes(current)?(current+1<pack.length?'Touchez la carte pour passer à la suivante':`Touchez la carte pour voir vos ${pack.length} arcanes`):'Touchez la carte pour la retourner'):'Les derniers arcanes se dévoilent…'}</p>{complete?<button className="primary" onClick={reset} disabled={live&&available<1}><RotateCcw size={16}/> {live?available>1?'Ouvrir d’autres boosters':'Ouvrir un autre booster':'Rejouer le rituel'}</button>:<button className="primary ghost" disabled={cascading} onClick={revealAll}><Eye size={17}/> Tout révéler</button>}<span className="control-caption">{complete?(live?<>Ces cartes sont dans votre <Link className="text-link" href="/collection/">collection</Link>.</>:'Aperçu visuel : les cartes ne sont pas ajoutées à votre collection.'):'Une carte à la fois · « Tout révéler » pour aller plus vite.'}</span></>}
  </div>
  <div className="ritual-footer"><span><Layers3 size={15}/> 5 cartes par booster</span><span><ShieldCheck size={15}/> Rare ou supérieure en 5e carte</span><span><Sparkles size={15}/> 3 finitions à découvrir</span></div>
  {!configured&&<div className="opening-bottom"><div><span className="eyebrow">Le don des arcanes</span><p>Un booster à 06 h et à 18 h. La nuit sait être généreuse.</p></div>{<div className="reserve-preview"><div className="pips" aria-label="Exemple de réserve : 4 sur 6">{Array.from({length:6},(_,i)=><i className={i<4?'on':''} key={i}/>)}</div><span>4 / 6 <small>exemple de réserve</small></span></div>}</div>}
  {live&&player&&<Sheet open={shopOpen} onClose={()=>{setShopOpen(false);setOffer(null);}} title={edition?`Boutique · ${edition.name}`:'Boutique'}>
   <p className="shop-balance-line"><Coins size={15}/> Solde : <strong><CountUp value={player.balance}/> Deniers</strong></p>
   <div className="offer-grid">{Object.entries(offers).sort((x,y)=>Number(x[0])-Number(y[0])).map(([qty,price])=>{const n=Number(qty),unit=offers['1']??price,saving=Math.round((1-price/(unit*n))*100),afford=player.balance>=price;return <button key={qty} className={`offer ${offer===qty?'selected':''}`} disabled={!afford||!edition||!!buying} aria-pressed={offer===qty} onClick={()=>setOffer(qty)}>
    <span className="offer-stack" aria-hidden="true">{Array.from({length:Math.min(n,4)},(_,k)=><i key={k} style={{'--k':k} as React.CSSProperties}/>)}</span>
    <strong>{n} booster{n>1?'s':''}</strong>
    <span className="offer-price">{price.toLocaleString('fr-FR')} <small>Deniers</small></span>
    {saving>0&&<span className="offer-saving">−{saving} %</span>}
    {!afford&&<small className="offer-missing">Il manque {(price-player.balance).toLocaleString('fr-FR')}</small>}
   </button>;})}</div>
   {offer&&<div className="offer-confirm rise">
    <p>Acheter <strong>{offer} booster{Number(offer)>1?'s':''} {edition?.name}</strong> pour {offers[offer].toLocaleString('fr-FR')} Deniers ? Il vous restera {(player.balance-offers[offer]).toLocaleString('fr-FR')} Deniers.</p>
    <button className="primary" disabled={!!buying} onClick={()=>void buy(offer)}>{buying?'Achat…':'Confirmer l’achat'}</button>
   </div>}
   {error&&shopOpen&&<p className="auth-error" role="alert">{error}</p>}
   <small className="muted">Mêmes probabilités qu’un booster gratuit. Ces boosters s’ouvrent seulement sur {edition?.name??'cette édition'} ; les boosters gratuits et bonus s’ouvrent sur toutes les éditions.</small>
  </Sheet>}
  {!configured&&<p className="demo-note">Atelier de démonstration · Cartes de présentation, aucun tirage réel ni ajout à la collection.</p>}
 </div>;
}
