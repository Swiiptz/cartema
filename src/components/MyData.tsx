'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Download,ShieldCheck,Trash2} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Sheet} from './ui';
import {callRpc} from '@/lib/game';

/** Vos données (RGPD) : export complet et suppression du compte. */
export function MyData({handle}:{handle:string|null}){
 const {client,signOut}=useAuth();
 const router=useRouter();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [open,setOpen]=useState(false);
 const [confirm,setConfirm]=useState('');
 const expected=handle??'supprimer';
 async function download(){
  if(!client)return;setBusy(true);setError(null);
  try{
   const data=await callRpc<unknown>(client,'export_my_data');
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download=`cartema-mes-donnees-${new Date().toISOString().slice(0,10)}.json`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function remove(){
  if(!client)return;setBusy(true);setError(null);
  try{await callRpc(client,'delete_my_account',{p_confirm:confirm});await signOut().catch(()=>{});router.replace('/');}
  catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <>
  <div className="settings-row my-data"><div><strong><ShieldCheck size={14}/> Mes données</strong><span className="muted">Téléchargez tout ce que Cartema sait de vous, ou supprimez votre compte. <Link className="text-link" href="/confidentialite/">Confidentialité</Link></span></div>
   <div className="my-data-actions"><button className="primary ghost compact" disabled={busy} onClick={()=>void download()}><Download size={14}/> Télécharger</button>
    <button className="primary ghost compact danger" disabled={busy} onClick={()=>{setOpen(true);setConfirm('');setError(null);}}><Trash2 size={14}/> Supprimer mon compte</button></div></div>
  {error&&!open&&<p className="auth-error" role="alert">{error}</p>}
  <Sheet open={open} onClose={()=>setOpen(false)} title="Supprimer mon compte">
   <div className="report-form">
    <p className="sheet-text">C’est <strong>définitif</strong>. Votre e-mail, votre connexion Discord, votre pseudonyme, votre vitrine, vos amis, vos souhaits et vos notifications seront effacés, et vos ventes en cours retirées. Vos cartes, Deniers et boosters seront perdus.</p>
    <p className="muted sheet-text">Seul un historique de jeu anonyme est conservé, pour que les cartes déjà échangées avec d’autres joueurs restent valides.</p>
    <label className="auth-field"><span>Pour confirmer, tapez {handle?<>votre pseudonyme <strong>{handle}</strong></>:<strong>supprimer</strong>}</span><input value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off"/></label>
    {error&&<p className="auth-error" role="alert">{error}</p>}
    <button className="primary danger-solid" disabled={busy||confirm.trim().toLowerCase()!==expected.toLowerCase()} onClick={()=>void remove()}><Trash2 size={14}/> {busy?'Suppression…':'Supprimer définitivement'}</button>
   </div>
  </Sheet>
 </>;
}
