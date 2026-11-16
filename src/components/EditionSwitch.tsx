'use client';
import type {EditionProgress} from '@/lib/album';

/** Pastilles de choix d'édition, avec l'avancement de chacune ; « Toutes » en option. */
export function EditionSwitch({progress,value,onChange,withAll=false,label='Édition'}:{progress:EditionProgress[];value:string;onChange:(id:string)=>void;withAll?:boolean;label?:string}){
 return <div className="edition-switch" role="tablist" aria-label={label}>
  {withAll&&<button type="button" role="tab" aria-selected={value==='all'} onClick={()=>onChange('all')}><span className="edition-switch-name">Toutes</span></button>}
  {progress.map(p=><button key={p.edition.id} type="button" role="tab" aria-selected={value===p.edition.id} onClick={()=>onChange(p.edition.id)} title={p.edition.name}>
   <span className="edition-switch-name">{p.edition.name}</span><small>{p.found}/{p.total}</small></button>)}
 </div>;
}
