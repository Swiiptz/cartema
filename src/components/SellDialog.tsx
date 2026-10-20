'use client';
import {useEffect,useRef,useState} from 'react';
import {Gavel,Tag,X} from 'lucide-react';

export type SellChoice={kind:'fixed'|'auction';price:number;hours:number};
const DURATIONS=[12,24,48,72];
const net=(p:number,pct=5)=>p-Math.floor(p*pct/100);

/** Mise en vente : prix fixe ou enchère, avec aperçu du gain net (commission 5 %). */
export function SellDialog({open,name,finish,suggested,onCancel,onConfirm}:{open:boolean;name:string;finish:string;suggested:number;onCancel:()=>void;onConfirm:(c:SellChoice)=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 const [kind,setKind]=useState<'fixed'|'auction'>('fixed');
 const [price,setPrice]=useState(String(suggested));
 const [hours,setHours]=useState(24);
 useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open){setKind('fixed');setPrice(String(suggested));setHours(24);d.showModal();}if(!open&&d.open)d.close();},[open,suggested]);
 const value=Number(price);
 const valid=Number.isInteger(value)&&value>=1&&value<=10000000;
 return <dialog ref={ref} className="ask-dialog sell-dialog" aria-label="Mettre en vente" onCancel={e=>{e.preventDefault();onCancel();}} onClose={e=>e.stopPropagation()} onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
  <form className="ask-dialog-body" onSubmit={e=>{e.preventDefault();if(valid)onConfirm({kind,price:value,hours});}}>
   <div className="sell-head"><h2>Mettre en vente</h2><button type="button" className="icon-button" aria-label="Fermer" onClick={onCancel}><X size={18}/></button></div>
   <p className="muted">{name}{finish!=='Standard'?` · finition ${finish}`:''}</p>
   <div className="segmented" role="tablist" aria-label="Type de vente">
    <button type="button" role="tab" aria-selected={kind==='fixed'} onClick={()=>setKind('fixed')}><Tag size={14}/> Prix fixe</button>
    <button type="button" role="tab" aria-selected={kind==='auction'} onClick={()=>setKind('auction')}><Gavel size={14}/> Enchère</button>
   </div>
   <label className="auth-field"><span>{kind==='fixed'?'Prix (Deniers)':'Mise de départ (Deniers)'}</span><input inputMode="numeric" value={price} onChange={e=>setPrice(e.target.value.replace(/[^\d]/g,''))} required/></label>
   {kind==='auction'&&<div className="duration-picker" role="radiogroup" aria-label="Durée">{DURATIONS.map(h=><button type="button" key={h} role="radio" aria-checked={hours===h} className={hours===h?'on':''} onClick={()=>setHours(h)}>{h} h</button>)}</div>}
   <p className="sell-net">{valid?<>{kind==='fixed'?'Vous recevrez':'Vous recevrez au moins'} <strong>{net(value).toLocaleString('fr-FR')} Deniers</strong> <small>(commission 5 %)</small></>:'Indiquez un nombre entier de Deniers.'}</p>
   {kind==='auction'&&<p className="muted sell-rules">Paliers : +10 sous 500, +25 jusqu’à 2 000, +50 au-delà. Une mise dans les 2 dernières minutes prolonge l’enchère. Sans mise, la carte vous revient. Une enchère ayant reçu une mise ne peut plus être retirée.</p>}
   <div className="ask-dialog-actions"><button type="button" className="primary ghost" onClick={onCancel}>Annuler</button><button className="primary" disabled={!valid}>{kind==='fixed'?'Mettre en vente':'Lancer l’enchère'}</button></div>
  </form>
 </dialog>;
}
