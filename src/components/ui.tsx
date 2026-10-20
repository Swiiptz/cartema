'use client';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';

const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Bloc de chargement qui reprend la forme du contenu attendu. */
export function Skeleton({className='',style}:{className?:string;style?:React.CSSProperties}){
 return <span className={`skeleton ${className}`} style={style} aria-hidden="true"/>;
}

/** Nombre qui défile jusqu'à sa nouvelle valeur (instantané si animations réduites). */
export function CountUp({value,duration=650}:{value:number;duration?:number}){
 const [shown,setShown]=useState(value);
 const from=useRef(value);
 useEffect(()=>{
  const start=from.current;from.current=value;
  if(start===value||reducedMotion()){setShown(value);return;}
  let raf=0;const t0=performance.now();
  const step=(t:number)=>{const k=Math.min(1,(t-t0)/duration);const e=1-Math.pow(1-k,3);setShown(Math.round(start+(value-start)*e));if(k<1)raf=requestAnimationFrame(step);};
  raf=requestAnimationFrame(step);
  return()=>cancelAnimationFrame(raf);
 },[value,duration]);
 // Espace insécable classique : l'espace fine du format français n'existe pas dans toutes les polices.
 return <>{shown.toLocaleString('fr-FR').replace(/ /g,' ')}</>;
}

/** « 2 h 14 min » jusqu'à l'instant donné ; rafraîchi chaque seconde dans la dernière minute. */
export function formatDelay(ms:number){
 if(ms<=0)return 'maintenant';
 const s=Math.ceil(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
 if(h>=48)return `${Math.floor(h/24)} j ${h%24} h`;
 if(h>0)return `${h} h ${String(m).padStart(2,'0')} min`;
 if(m>0)return `${m} min ${String(sec).padStart(2,'0')} s`;
 return `${sec} s`;
}
export function Countdown({to,onDone}:{to:string|null;onDone?:()=>void}){
 const [now,setNow]=useState(()=>Date.now());
 const target=to?Date.parse(to):NaN;
 useEffect(()=>{
  if(!Number.isFinite(target))return;
  const id=setInterval(()=>{const n=Date.now();setNow(n);if(n>=target){clearInterval(id);onDone?.();}},1000);
  return()=>clearInterval(id);
 },[target,onDone]);
 if(!Number.isFinite(target))return null;
 return <time dateTime={to!}>{formatDelay(target-now)}</time>;
}

/** Panneau qui glisse depuis le bas (mobile) ou s'ouvre au centre (grand écran). */
export function Sheet({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close();},[open]);
 return <dialog ref={ref} className="sheet" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="sheet-body">
   <div className="sheet-handle" aria-hidden="true"/>
   <div className="sheet-header"><h2>{title}</h2><button className="icon-button" aria-label="Fermer" onClick={onClose}><X size={18}/></button></div>
   {children}
  </div>
 </dialog>;
}
