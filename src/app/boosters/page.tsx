'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,ArrowUpRight,Check,Eye,Layers3,RotateCcw,Settings2,ShieldCheck,Sparkles,Volume2,VolumeX,X} from 'lucide-react';
import {CardBack,TarotCard,palette} from '@/components/Card';
import {previewPack} from '@/data/demo';
import {BoosterSkin} from '@/components/BoosterSkin';

type Phase='sealed'|'opening'|'reveal';
export default function Boosters(){
 const [phase,setPhase]=useState<Phase>('sealed');
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
 const complete=revealed.length===5;
 useEffect(()=>()=>{timers.current.forEach(clearTimeout);void audio.current?.close();},[]);
 function tone(index=0){
  if(!sound)return;
  try{const ctx=audio.current??(audio.current=new AudioContext());void ctx.resume();const osc=ctx.createOscillator();const gain=ctx.createGain();osc.type='sine';osc.frequency.value=[261.63,329.63,392,523.25,659.25][index];gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.6);}catch{/* Sound is optional. */}
 }
 function open(){if(openingLock.current)return;openingLock.current=true;tone();setPhase('opening');const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;timers.current.push(setTimeout(()=>setPhase('reveal'),reduced?150:1950));}
 function tilt(e:React.PointerEvent<HTMLButtonElement>){if(e.pointerType!=='mouse'||phase!=='sealed')return;const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--tilt-x',`${(0.5-(e.clientY-r.top)/r.height)*14}deg`);e.currentTarget.style.setProperty('--tilt-y',`${((e.clientX-r.left)/r.width-0.5)*20}deg`);}
 function clearTilt(e:React.PointerEvent<HTMLButtonElement>){e.currentTarget.style.setProperty('--tilt-x','0deg');e.currentTarget.style.setProperty('--tilt-y','0deg');startY.current=null;}
 function reveal(i:number){if(revealedRef.current.has(i))return;revealedRef.current.add(i);setRevealed(old=>[...old,i]);tone(i);setBurst(i);}
 function revealAll(){if(cascading)return;setCascading(true);previewPack.forEach((_,i)=>timers.current.push(setTimeout(()=>reveal(i),i*180)));}
 function reset(){timers.current.forEach(clearTimeout);timers.current=[];setRevealed([]);revealedRef.current.clear();openingLock.current=false;setBurst(null);setCascading(false);setPhase('sealed');}
 return <div className={`opening-page ${effects?'with-effects':''}`}>
  <div className="opening-toolbar"><Link href="/" className="back-link"><ArrowLeft size={15}/> Le cabinet</Link><span className="toolbar-title">L’atelier des arcanes</span><div className="toolbar-actions"><button className={`icon-button ${options?'selected':''}`} aria-label="Options d’ouverture" aria-expanded={options} onClick={()=>setOptions(!options)}><Settings2 size={17}/></button><button className="icon-button" aria-label={sound?'Couper le son':'Activer le son'} aria-pressed={sound} onClick={()=>setSound(!sound)}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}</button></div></div>
  {options&&<div className="opening-options panel"><div className="section-header"><span className="eyebrow">Votre rituel</span><button className="icon-button" aria-label="Fermer les options" onClick={()=>setOptions(false)}><X size={16}/></button></div><label><input type="checkbox" checked={effects} onChange={e=>setEffects(e.target.checked)}/> Lumière et particules d’ambiance</label><label><input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/> Notes sonores à la révélation</label><small>La réduction des animations de votre appareil est respectée.</small></div>}
  <header className="opening-heading"><div className="eyebrow"><span className="tiny-rule"/> Un rendez-vous avec l’inconnu <span className="tiny-rule"/></div><h1>{phase==='reveal'?'Le voile se lève.':'Ce que la nuit vous réserve.'}</h1><p>{phase==='reveal'?'Cinq arcanes. À vous d’en choisir l’ordre.':'Cinq cartes, cinq destins. Un nouveau chapitre de votre collection.'}</p></header>
  <div className="edition-label"><span className="status-light"/> Camarilla <span className="edition-divider"/> Édition permanente</div>
  <section className={`ritual-stage ${phase}`} aria-label="Prévisualisation d’ouverture de booster">
   <div className="ritual-halo" aria-hidden="true"/>{phase==='opening'&&effects&&<div className="seal-light" aria-hidden="true"/>}<div className="ritual-orbit orbit-one" aria-hidden="true"/><div className="ritual-orbit orbit-two" aria-hidden="true"/>
   {effects&&<div className="motes" aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} style={{'--i':i,left:`${8+(i*37)%85}%`,top:`${10+(i*23)%80}%`} as React.CSSProperties}/>)}</div>}
   {phase!=='reveal'?<div className="sealed-scene"><div className="ghost-card ghost-left"><CardBack/></div><div className="ghost-card ghost-right"><CardBack/></div><button className="pack-object" disabled={phase==='opening'} aria-label="Déchirer la languette du booster" onClick={open} onPointerMove={tilt} onPointerLeave={clearTilt} onPointerCancel={clearTilt} onPointerDown={e=>{startY.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{if(startY.current!==null&&(Math.abs(e.clientX-startY.current.x)>40||startY.current.y-e.clientY>30))open();startY.current=null;}}><span className="pack-side pack-side-left" aria-hidden="true"/><span className="pack-side pack-side-right" aria-hidden="true"/><span className="pack-top-edge" aria-hidden="true"/><span className="pack-face pack-reverse" aria-hidden="true"><CardBack/></span><span className="pack-face pack-obverse"><span className="packet-mouth" aria-hidden="true"/><span className="packet-body"><BoosterSkin/></span><span className="packet-tear"><BoosterSkin/></span><span className="packet-pull-tab" aria-hidden="true"/><span className="packet-torn-edge" aria-hidden="true"/><span className="pack-reflection" aria-hidden="true"/></span></button><div className="pack-ground"/></div>:<div className="reveal-grid">{previewPack.map((card,i)=><div className={`reveal-slot ${revealed.includes(i)?'slot-revealed':''} ${card.finish==='Dorée'?'slot-gold':card.finish==='Sanglante'?'slot-blood':''}`} key={i} style={{'--index':i,'--slot-color':card.finish==='Dorée'?'#f1d99b':card.finish==='Sanglante'?'#a92646':palette[card.rarity]} as React.CSSProperties}>{effects&&burst===i&&<span className="reveal-burst" key={`burst-${i}`} aria-hidden="true">{Array.from({length:10},(_,j)=><i key={j} style={{'--ray':j} as React.CSSProperties}/>)}</span>}<button className={`flip-card ${revealed.includes(i)?'is-revealed':''}`} style={{'--glow':palette[card.rarity],'--index':i} as React.CSSProperties} aria-label={revealed.includes(i)?`${card.name}, ${card.rarity}`:`Révéler la carte ${i+1}`} aria-pressed={revealed.includes(i)} disabled={revealed.includes(i)} onClick={()=>reveal(i)}><span className="flip-inner"><span className="flip-back" aria-hidden={revealed.includes(i)}><CardBack/></span><span className="flip-front" aria-hidden={!revealed.includes(i)}><TarotCard card={card}/></span></span></button><span className="card-index">{revealed.includes(i)?<><Check size={12}/><span>{card.finish&&card.finish!=='Standard'?card.finish:card.rarity}</span></>:String(i+1).padStart(2,'0')}</span></div>)}</div>}
  </section>
  <div className="ritual-controls" aria-live="polite">
   {phase==='sealed'?<><p className="gesture-hint"><span className="hint-line"/> Tirez la languette. Révélez l’invisible. <span className="hint-line"/></p><button className="primary open-button" onClick={open}><Sparkles size={17}/> Déchirer le booster <ArrowUpRight size={17}/></button><span className="control-caption">5 cartes · aperçu sans consommation de booster</span></>:phase==='opening'?<p className="eyebrow">Les arcanes s’éveillent…</p>:<><p className="reveal-count">{complete?'Votre rituel est complet.':`${revealed.length} / 5 arcanes révélés · Touchez une carte`}</p>{complete?<button className="primary" onClick={reset}><RotateCcw size={16}/> Rejouer le rituel</button>:<button className="primary ghost" disabled={cascading} onClick={revealAll}><Eye size={17}/> Tout révéler</button>}<span className="control-caption">{complete?'Aperçu visuel : les cartes ne sont pas ajoutées à votre collection.':'Choisissez librement l’ordre de votre découverte.'}</span></>}
  </div>
  <div className="ritual-footer"><span><Layers3 size={15}/> 5 cartes par booster</span><span><ShieldCheck size={15}/> Rare ou supérieure en 5e carte</span><span><Sparkles size={15}/> 3 finitions à découvrir</span></div>
  <div className="opening-bottom"><div><span className="eyebrow">Le don des arcanes</span><p>Un booster à 06 h et à 18 h. La nuit sait être généreuse.</p></div><div className="reserve-preview"><div className="pips" aria-label="Exemple de réserve : 4 sur 6">{Array.from({length:6},(_,i)=><i className={i<4?'on':''} key={i}/>)}</div><span>4 / 6 <small>exemple de réserve</small></span></div></div>
  <p className="demo-note">Atelier de démonstration · Cartes de présentation, aucun tirage réel ni ajout à la collection.</p>
 </div>;
}
