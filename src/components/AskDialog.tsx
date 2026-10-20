'use client';
import {useCallback,useId,useRef,useState} from 'react';

export type AskOptions={
 title:string;
 message?:string;
 /** Si présent, un champ texte obligatoire (motif, nouveau nom…) ; la réponse est sa valeur. */
 inputLabel?:string;
 initialValue?:string;
 confirmLabel?:string;
};

/**
 * Remplace window.prompt / window.confirm, bloqués dans certains navigateurs intégrés :
 * `await ask({...})` renvoie le texte saisi (ou '' sans champ), ou null si l'on annule.
 */
export function useAsk(){
 const dialog=useRef<HTMLDialogElement>(null);
 const resolver=useRef<((v:string|null)=>void)|null>(null);
 const [opts,setOpts]=useState<AskOptions|null>(null);
 const [value,setValue]=useState('');
 const titleId=useId();

 const ask=useCallback((o:AskOptions)=>new Promise<string|null>(resolve=>{
  resolver.current?.(null);
  resolver.current=resolve;
  setOpts(o);setValue(o.initialValue??'');
  requestAnimationFrame(()=>dialog.current?.showModal());
 }),[]);

 const finish=(result:string|null)=>{
  const r=resolver.current;resolver.current=null;
  dialog.current?.close();
  r?.(result);
 };

 const node=<dialog ref={dialog} className="ask-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();finish(null);}} onClick={e=>{if(e.target===e.currentTarget)finish(null);}}>
  {opts&&<form method="dialog" className="ask-dialog-body" onSubmit={e=>{e.preventDefault();if(opts.inputLabel&&!value.trim())return;finish(opts.inputLabel?value.trim():'');}}>
   <h2 id={titleId}>{opts.title}</h2>
   {opts.message&&<p className="muted">{opts.message}</p>}
   {opts.inputLabel&&<label className="auth-field"><span>{opts.inputLabel}</span><input autoFocus value={value} onChange={e=>setValue(e.target.value)} required maxLength={300}/></label>}
   <div className="ask-dialog-actions">
    <button type="button" className="primary ghost" onClick={()=>finish(null)}>Annuler</button>
    <button type="submit" className="primary" disabled={!!opts.inputLabel&&!value.trim()}>{opts.confirmLabel??'Confirmer'}</button>
   </div>
  </form>}
 </dialog>;
 return [ask,node] as const;
}
