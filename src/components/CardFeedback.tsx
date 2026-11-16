'use client';
import {useState} from 'react';
import {ArrowLeft,BadgeCheck,ChevronRight,ImagePlus,MessageSquareWarning,PenLine,Quote,TriangleAlert} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {TarotCard,type DemoCard} from './Card';
import {SignaturePad} from './SignaturePad';
import {Sheet} from './ui';
import {callRpc,type InventoryItem} from '@/lib/game';

const TYPES:Record<string,string>={'image/png':'png','image/webp':'webp','image/jpeg':'jpg'};
const MAX=10*1024*1024;
type Kind='info'|'illustration'|'credit'|'ambiance'|'signature';

/** Types de contribution proposés en tuiles (texte d'ambiance et signature : nouveautés du prochain set). */
const CHOICES:{kind:Kind;Icon:typeof Quote;title:(hasArt:boolean)=>string;hint:string}[]=[
 {kind:'info',Icon:TriangleAlert,title:()=>'Signaler une erreur',hint:'Nom, clan, fonction ou rareté inexacts.'},
 {kind:'illustration',Icon:ImagePlus,title:hasArt=>hasArt?'Proposer une autre illustration':'Proposer une illustration',hint:'Votre dessin pour ce personnage.'},
 {kind:'credit',Icon:BadgeCheck,title:()=>'Demander un crédit',hint:'Vous êtes l’auteur d’une illustration de cette carte.'},
 {kind:'ambiance',Icon:Quote,title:()=>'Écrire un texte d’ambiance',hint:'Une citation affichée sur la fiche, signée de votre pseudo.'},
 {kind:'signature',Icon:PenLine,title:()=>'Signer la carte',hint:'Vous jouez ce personnage : votre autographe sur des exemplaires rares.'},
];

/** Lien discret de la fiche : signaler une information fausse ou proposer une illustration. */
export function CardFeedback({code,name,hasArt,characterId,card}:{code:string;name:string;hasArt:boolean;characterId?:string|null;card?:DemoCard}){
 const {client,session}=useAuth();
 const [open,setOpen]=useState(false);
 const [kind,setKind]=useState<Kind>('info');
 // Première étape : choisir le type de contribution, présenté en tuiles ; le formulaire vient ensuite.
 const [chosen,setChosen]=useState(false);
 const [credit,setCredit]=useState('');
 const [message,setMessage]=useState('');
 const [file,setFile]=useState<File|null>(null);
 // Signature tracée ou importée, déjà contrôlée et rognée (PNG) ; adresse locale pour l'aperçu sur la carte.
 const [signature,setSignature]=useState<{blob:Blob;url:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [sent,setSent]=useState(false);
 // Signature et texte d'ambiance : seulement une fois les nouveautés du prochain set allumées.
 const [nextSet,setNextSet]=useState(false);
 // Demande de crédit : versions d'illustration possédées de cette carte (« » = l'illustration officielle).
 const [versions,setVersions]=useState<{id:string;label:string}[]>([]);
 const [artId,setArtId]=useState('');
 if(!client||!session)return null;
 const reset=()=>{setKind('info');setChosen(false);setMessage('');setCredit('');setFile(null);setSignature(null);setError(null);setSent(false);setArtId('');};
 function loadVersions(){
  if(!characterId)return;
  void callRpc<InventoryItem[]>(client!,'get_inventory',{p_character_id:characterId}).then(items=>{const seen=new Map<string,string>();for(const i of items)if(i.art_id&&i.variant&&!seen.has(i.art_id))seen.set(i.art_id,i.variant);const list=[...seen].map(([id,label])=>({id,label}));setVersions(list);if(!hasArt&&list[0])setArtId(list[0].id);}).catch(()=>setVersions([]));
 }
 async function send(e:React.FormEvent){
  e.preventDefault();setError(null);
  if(kind==='illustration'&&(!file||!TYPES[file.type])){setError('Choisissez une image PNG, WebP ou JPEG.');return;}
  if(kind==='signature'&&!signature){setError('Signez ou importez votre signature.');return;}
  if(kind==='illustration'&&file&&file.size>MAX){setError('Image trop lourde : 10 Mo maximum.');return;}
  setBusy(true);
  try{
   let path:string|null=null;
   if(kind==='signature'&&signature){
    path=`${session!.user.id}/${crypto.randomUUID()}.png`;
    const up=await client!.storage.from('submissions').upload(path,signature.blob,{contentType:'image/png',upsert:false});
    if(up.error)throw new Error(`Envoi de la signature impossible : ${up.error.message}`);
   }else if(kind==='illustration'&&file){
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
  <div className="feedback-row"><button className="feedback-link" onClick={()=>{reset();setOpen(true);loadVersions();void callRpc<{next_set:boolean}>(client,'get_features').then(f=>setNextSet(f.next_set)).catch(()=>setNextSet(false));}} title="Signaler une erreur, proposer une illustration, un texte d’ambiance ou votre signature, demander un crédit"><MessageSquareWarning size={14}/><span>Contribuer à cette carte</span></button></div>
  <Sheet open={open} onClose={()=>setOpen(false)} title={name}>
   {sent?<p className="auth-notice">Merci ! L’administrateur va examiner votre proposition. Vous serez prévenu de sa décision{kind==='illustration'&&!hasArt?' ; une illustration acceptée rapporte 1 booster':kind==='credit'?' ; une fois validé, votre nom apparaîtra dans les détails de la carte':''}.</p>
    :!chosen?<div className="contribution-choices">
     <p className="admin-hint">Que voulez-vous faire pour cette carte ?</p>
     {CHOICES.filter(c=>c.kind==='credit'?hasArt||versions.length>0:c.kind==='ambiance'||c.kind==='signature'?nextSet:true).map(c=><button key={c.kind} type="button" className={`contribution-choice ${c.kind}`} onClick={()=>{setKind(c.kind);setChosen(true);setError(null);setMessage('');}}>
      <span className="contribution-icon" aria-hidden="true"><c.Icon size={18}/></span><span className="contribution-text"><strong>{c.title(hasArt)}</strong><small>{c.hint}</small></span><ChevronRight size={16} className="contribution-chevron" aria-hidden="true"/></button>)}
    </div>
    :<form className="report-form" onSubmit={e=>void send(e)}>
     <div className="contribution-head"><button type="button" className="contribution-back" onClick={()=>{setChosen(false);setError(null);}}><ArrowLeft size={15}/> Changer</button><strong>{CHOICES.find(c=>c.kind===kind)?.title(hasArt)}</strong></div>
     {kind==='signature'&&<p className="admin-hint">Réservé à la personne qui joue ce personnage (PJ ou PNJ) : l’administrateur le vérifie avant de publier. Une fois validée, des exemplaires signés de cette carte pourront tomber dans les boosters.</p>}
     {kind==='signature'&&<SignaturePad onChange={b=>setSignature(old=>{if(old)URL.revokeObjectURL(old.url);return b?{blob:b,url:URL.createObjectURL(b)}:null;})}/>}
     {kind==='signature'&&signature&&card&&<div className="signature-preview"><TarotCard card={{...card,signature:signature.url}}/><p className="admin-hint">Aperçu : sur les exemplaires signés, votre signature apparaîtra ainsi, à l’encre dorée.</p></div>}
     {kind==='illustration'&&<label className="feedback-file"><ImagePlus size={16}/><span>{file?file.name:'Choisir une image (PNG, WebP, JPEG · 10 Mo max)'}</span><input type="file" accept="image/png,image/webp,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>}
     {kind==='credit'&&versions.length>0&&<label className="auth-field"><span>Illustration concernée</span><select value={artId} onChange={e=>setArtId(e.target.value)}>{hasArt&&<option value="">Illustration officielle</option>}{versions.map(v=><option key={v.id} value={v.id}>Version « {v.label} »</option>)}</select></label>}
     {kind==='credit'&&<label className="auth-field"><span>Nom à afficher sous l’illustration</span><input value={credit} onChange={e=>setCredit(e.target.value)} maxLength={80} placeholder="Votre nom d’artiste"/></label>}
     {kind==='ambiance'?<label className="flavor-editor"><span className="flavor-editor-label">Votre texte d’ambiance <small>Une phrase du personnage ou sur lui, comme une citation.</small></span>
      <span className="flavor-editor-quote"><span aria-hidden="true">«</span><textarea rows={3} maxLength={200} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Elle sourit toujours avant de mordre, jamais après."/><span aria-hidden="true">»</span></span>
      <span className="flavor-editor-foot"><span>Signé de votre pseudo une fois validé</span><span className={message.trim().length>200||message.trim().length<10?'flavor-count short':'flavor-count'}>{message.trim().length}/200</span></span>
     </label>:
     <label className="auth-field"><span>{kind==='info'?'Qu’est-ce qui est faux ?':kind==='credit'?'Comment l’administrateur peut-il vérifier ? (facultatif)':kind==='signature'?'Votre lien avec ce personnage (facultatif)':'Un mot sur votre illustration (facultatif)'}</span>
      <textarea rows={4} maxLength={1500} value={message} onChange={e=>setMessage(e.target.value)} placeholder={kind==='info'?'Ex. : le clan est Toréador, pas Ventrue.':kind==='credit'?'Ex. : lien vers mon portfolio, fichier source…':kind==='signature'?'Ex. : je joue ce personnage sur le serveur depuis la première chronique.':'Ex. : portrait réalisé par moi, fond transparent.'}/></label>}
     {kind==='illustration'&&<p className="admin-hint">En proposant une image, vous confirmez en avoir les droits et acceptez qu’elle soit utilisée dans Cartema.</p>}
     {error&&<p className="auth-error" role="alert">{error}</p>}
     <button className="primary" disabled={busy||(kind==='info'?message.trim().length<5:kind==='ambiance'?message.trim().length<10||message.trim().length>200:kind==='signature'?!signature:kind==='credit'?credit.trim().length<2:!file)}>{busy?'Envoi…':'Envoyer'}</button>
    </form>}
  </Sheet>
 </>;
}
