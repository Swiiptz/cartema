'use client';
import {useState} from 'react';
import {ImagePlus,MessageSquareWarning} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Sheet} from './ui';
import {callRpc} from '@/lib/game';

const TYPES:Record<string,string>={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'};
const MAX=10*1024*1024;

/** Lien discret de la fiche : signaler une information fausse ou proposer une illustration. */
export function CardFeedback({code,name,hasArt}:{code:string;name:string;hasArt:boolean}){
 const {client,session}=useAuth();
 const [open,setOpen]=useState(false);
 const [kind,setKind]=useState<'info'|'illustration'|'credit'>('info');
 const [credit,setCredit]=useState('');
 const [message,setMessage]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [sent,setSent]=useState(false);
 if(!client||!session)return null;
 const reset=()=>{setKind('info');setMessage('');setCredit('');setFile(null);setError(null);setSent(false);};
 async function send(e:React.FormEvent){
  e.preventDefault();setError(null);
  if(kind==='illustration'&&(!file||!TYPES[file.type])){setError('Choisissez une image PNG, WebP ou JPEG.');return;}
  if(file&&file.size>MAX){setError('Image trop lourde : 10 Mo maximum.');return;}
  setBusy(true);
  try{
   let path:string|null=null;
   if(kind==='illustration'&&file){
    // Chaque joueur n'écrit que dans son propre dossier du bucket privé.
    path=`${session!.user.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
    const up=await client!.storage.from('submissions').upload(path,file,{contentType:file.type,upsert:false});
    if(up.error)throw new Error(`Envoi de l’image impossible : ${up.error.message}`);
   }
   await callRpc(client!,'submit_card_feedback',{p_code:code,p_kind:kind,p_message:message,p_image_path:path,p_credit_name:kind==='credit'?credit:null});
   setSent(true);
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <>
  <button className="text-link feedback-link" onClick={()=>{reset();setOpen(true);}}><MessageSquareWarning size={13}/> Signaler une erreur ou proposer une illustration</button>
  <Sheet open={open} onClose={()=>setOpen(false)} title={name}>
   {sent?<p className="auth-notice">Merci ! L’administrateur va examiner votre proposition. Vous serez prévenu de sa décision{kind==='illustration'&&!hasArt?' ; une illustration acceptée rapporte 1 booster':kind==='credit'?' ; une fois validé, votre nom apparaîtra dans les détails de la carte':''}.</p>
    :<form className="report-form" onSubmit={e=>void send(e)}>
     <div className="segmented" role="tablist">
      <button type="button" role="tab" aria-selected={kind==='info'} onClick={()=>setKind('info')}>Information erronée</button>
      <button type="button" role="tab" aria-selected={kind==='illustration'} onClick={()=>setKind('illustration')}>{hasArt?'Autre illustration':'Proposer une illustration'}</button>
      {hasArt&&<button type="button" role="tab" aria-selected={kind==='credit'} onClick={()=>setKind('credit')}>Demander un crédit</button>}
     </div>
     {kind==='illustration'&&<label className="feedback-file"><ImagePlus size={16}/><span>{file?file.name:'Choisir une image (PNG, WebP, JPEG · 10 Mo max)'}</span><input type="file" accept="image/png,image/webp,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>}
     {kind==='credit'&&<label className="auth-field"><span>Nom à afficher sous l’illustration</span><input value={credit} onChange={e=>setCredit(e.target.value)} maxLength={80} placeholder="Votre nom d’artiste"/></label>}
     <label className="auth-field"><span>{kind==='info'?'Qu’est-ce qui est faux ?':kind==='credit'?'Comment l’administrateur peut-il vérifier ? (facultatif)':'Un mot sur votre illustration (facultatif)'}</span>
      <textarea rows={4} maxLength={1500} value={message} onChange={e=>setMessage(e.target.value)} placeholder={kind==='info'?'Ex. : le clan est Toréador, pas Ventrue.':kind==='credit'?'Ex. : lien vers mon portfolio, fichier source…':'Ex. : portrait réalisé par moi, fond transparent.'}/></label>
     {kind==='illustration'&&<p className="admin-hint">En proposant une image, vous confirmez en avoir les droits et acceptez qu’elle soit utilisée dans Cartema.</p>}
     {error&&<p className="auth-error" role="alert">{error}</p>}
     <button className="primary" disabled={busy||(kind==='info'?message.trim().length<5:kind==='credit'?credit.trim().length<2:!file)}>{busy?'Envoi…':'Envoyer'}</button>
    </form>}
  </Sheet>
 </>;
}
