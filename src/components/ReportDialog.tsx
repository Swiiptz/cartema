'use client';
import {useState} from 'react';
import {Flag} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Sheet} from './ui';
import {callRpc} from '@/lib/game';

const CATEGORIES:[string,string][]=[['pseudo','Pseudonyme inapproprié'],['comportement','Comportement (insultes, harcèlement)'],['triche','Triche ou abus'],['autre','Autre']];

/** Signalement d'un joueur à l'administrateur (message obligatoire, 5 par jour). */
export function ReportButton({client,handle}:{client:SupabaseClient;handle:string}){
 const [open,setOpen]=useState(false);
 const [category,setCategory]=useState('comportement');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [sent,setSent]=useState(false);
 async function send(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError(null);
  try{await callRpc(client,'report_player',{p_handle:handle,p_category:category,p_message:message});setSent(true);setMessage('');}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <>
  <button className="text-link report-link" onClick={()=>{setOpen(true);setSent(false);setError(null);}}><Flag size={13}/> Signaler</button>
  <Sheet open={open} onClose={()=>setOpen(false)} title={`Signaler ${handle}`}>
   {sent?<p className="auth-notice">Merci, votre signalement a été transmis à l’administrateur. Il reste confidentiel.</p>
    :<form className="report-form" onSubmit={e=>void send(e)}>
     <p className="muted sheet-text">Le signalement est confidentiel : seul l’administrateur le lit.</p>
     <label className="auth-field"><span>Motif</span><select value={category} onChange={e=>setCategory(e.target.value)}>{CATEGORIES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label className="auth-field"><span>Que s’est-il passé ?</span><textarea value={message} onChange={e=>setMessage(e.target.value)} rows={4} maxLength={1000} required minLength={5} placeholder="Décrivez les faits (où, quand, quoi)."/></label>
     {error&&<p className="auth-error" role="alert">{error}</p>}
     <button className="primary" disabled={busy||message.trim().length<5}><Flag size={14}/> {busy?'Envoi…':'Envoyer le signalement'}</button>
    </form>}
  </Sheet>
 </>;
}
