'use client';
import {useState} from 'react';
import {ImagePlus,MessageSquareWarning} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Sheet} from './ui';
import {callRpc,type InventoryItem} from '@/lib/game';

const TYPES:Record<string,string>={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'};
const MAX=10*1024*1024;

/** Lien discret de la fiche : signaler une information fausse ou proposer une illustration. */
export function CardFeedback({code,name,hasArt,characterId}:{code:string;name:string;hasArt:boolean;characterId?:string|null}){
 const {client,session}=useAuth();
 const [open,setOpen]=useState(false);
 const [kind,setKind]=useState<'info'|'illustration'|'credit'|'ambiance'|'signature'>('info');
 const [credit,setCredit]=useState('');
 const [message,setMessage]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [sent,setSent]=useState(false);
 // Signature et texte d'ambiance : seulement une fois les nouveautés du prochain set allumées.
 const [nextSet,setNextSet]=useState(false);
 // Demande de crédit : versions d'illustration possédées de cette carte (« » = l'illustration officielle).
 const [versions,setVersions]=useState<{id:string;label:string}[]>([]);
 const [artId,setArtId]=useState('');
 if(!client||!session)return null;
 const reset=()=>{setKind('info');setMessage('');setCredit('');setFile(null);setError(null);setSent(false);setArtId('');};
 function loadVersions(){
  if(!characterId)return;
  void callRpc<InventoryItem[]>(client!,'get_inventory',{p_character_id:characterId}).then(items=>{const seen=new Map<string,string>();for(const i of items)if(i.art_id&&i.variant&&!seen.has(i.art_id))seen.set(i.art_id,i.variant);const list=[...seen].map(([id,label])=>({id,label}));setVersions(list);if(!hasArt&&list[0])setArtId(list[0].id);}).catch(()=>setVersions([]));
 }
 async function send(e:React.FormEvent){
  e.preventDefault();setError(null);
  if((kind==='illustration'||kind==='signature')&&(!file||!TYPES[file.type])){setError('Choisissez une image PNG, WebP ou JPEG.');return;}
  if(file&&file.size>MAX){setError('Image trop lourde : 10 Mo maximum.');return;}
  setBusy(true);
  try{
   let path:string|null=null;
   if((kind==='illustration'||kind==='signature')&&file){
    // Chaque joueur n'écrit que dans son propre dossier du bucket privé.
    path=`${session!.user.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
    const up=await client!.storage.from('submissions').upload(path,file,{contentType:file.type,upsert:false});
    if(up.error)throw new Error(`Envoi de l’image impossible : ${up.error.message}`);
   }
   await callRpc(client!,'submit_card_feedback',{p_code:code,p_kind:kind,p_message:message,p_image_path:path,p_credit_name:kind==='credit'?credit:null,p_art_id:kind==='credit'&&artId?artId:null});
   setSent(true);
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 return <>
  <div className="feedback-row"><button className="feedback-link" onClick={()=>{reset();setOpen(true);loadVersions();void callRpc<{next_set:boolean}>(client,'get_features').then(f=>setNextSet(f.next_set)).catch(()=>setNextSet(false));}} title="Signaler une erreur, proposer une illustration ou demander un crédit"><MessageSquareWarning size={13}/><span>Une erreur ? Une illustration à proposer ?</span></button></div>
  <Sheet open={open} onClose={()=>setOpen(false)} title={name}>
   {sent?<p className="auth-notice">Merci ! L’administrateur va examiner votre proposition. Vous serez prévenu de sa décision{kind==='illustration'&&!hasArt?' ; une illustration acceptée rapporte 1 booster':kind==='credit'?' ; une fois validé, votre nom apparaîtra dans les détails de la carte':''}.</p>
    :<form className="report-form" onSubmit={e=>void send(e)}>
     <div className="segmented" role="tablist">
      <button type="button" role="tab" aria-selected={kind==='info'} onClick={()=>setKind('info')}>Information erronée</button>
      <button type="button" role="tab" aria-selected={kind==='illustration'} onClick={()=>setKind('illustration')}>{hasArt?'Autre illustration':'Proposer une illustration'}</button>
      {(hasArt||versions.length>0)&&<button type="button" role="tab" aria-selected={kind==='credit'} onClick={()=>setKind('credit')}>Demander un crédit</button>}
      {nextSet&&<button type="button" role="tab" aria-selected={kind==='ambiance'} onClick={()=>setKind('ambiance')}>Texte d’ambiance</button>}
      {nextSet&&<button type="button" role="tab" aria-selected={kind==='signature'} onClick={()=>setKind('signature')}>Ma signature</button>}
     </div>
     {kind==='signature'&&<p className="admin-hint">Réservé à la personne qui joue ce personnage : l’administrateur le vérifie. Envoyez votre signature sur fond transparent (PNG). Une fois validée, des exemplaires signés de cette carte pourront tomber dans les boosters.</p>}
     {(kind==='illustration'||kind==='signature')&&<label className="feedback-file"><ImagePlus size={16}/><span>{file?file.name:'Choisir une image (PNG, WebP, JPEG · 10 Mo max)'}</span><input type="file" accept="image/png,image/webp,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>}
     {kind==='credit'&&versions.length>0&&<label className="auth-field"><span>Illustration concernée</span><select value={artId} onChange={e=>setArtId(e.target.value)}>{hasArt&&<option value="">Illustration officielle</option>}{versions.map(v=><option key={v.id} value={v.id}>Version « {v.label} »</option>)}</select></label>}
     {kind==='credit'&&<label className="auth-field"><span>Nom à afficher sous l’illustration</span><input value={credit} onChange={e=>setCredit(e.target.value)} maxLength={80} placeholder="Votre nom d’artiste"/></label>}
     <label className="auth-field"><span>{kind==='info'?'Qu’est-ce qui est faux ?':kind==='credit'?'Comment l’administrateur peut-il vérifier ? (facultatif)':kind==='ambiance'?`Votre texte d’ambiance (${message.trim().length}/200)`:kind==='signature'?'Votre lien avec ce personnage (facultatif)':'Un mot sur votre illustration (facultatif)'}</span>
      <textarea rows={4} maxLength={kind==='ambiance'?200:1500} value={message} onChange={e=>setMessage(e.target.value)} placeholder={kind==='info'?'Ex. : le clan est Toréador, pas Ventrue.':kind==='ambiance'?'Ex. : Elle sourit toujours avant de mordre, jamais après.':kind==='credit'?'Ex. : lien vers mon portfolio, fichier source…':'Ex. : portrait réalisé par moi, fond transparent.'}/></label>
     {kind==='illustration'&&<p className="admin-hint">En proposant une image, vous confirmez en avoir les droits et acceptez qu’elle soit utilisée dans Cartema.</p>}
     {error&&<p className="auth-error" role="alert">{error}</p>}
     <button className="primary" disabled={busy||(kind==='info'?message.trim().length<5:kind==='ambiance'?message.trim().length<10||message.trim().length>200:kind==='signature'?!file:kind==='credit'?credit.trim().length<2:!file)}>{busy?'Envoi…':'Envoyer'}</button>
    </form>}
  </Sheet>
 </>;
}
