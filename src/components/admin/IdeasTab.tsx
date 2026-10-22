'use client';
import {useCallback,useEffect,useState} from 'react';
import {Flame,Save,Users} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import {useSignedSubmission} from '@/lib/signed';
import {callRpc,SUGGESTION_CATEGORIES,SUGGESTION_STATUS,type Suggestion,type SuggestionStatus} from '@/lib/game';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
const when=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/** Doléances des joueurs : réponse, statut, publication pour le vote. */
export function IdeasTab({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [status,setStatus]=useState<SuggestionStatus|'all'>('new');
 const [list,setList]=useState<Suggestion[]|null>(null);
 const load=useCallback(async()=>{setList(await callRpc<Suggestion[]>(client,'admin_suggestions',{p_status:status==='all'?null:status}).catch(()=>[]));},[client,status]);
 useEffect(()=>{setList(null);void load();},[load]);
 return <div className="admin-reports">
  <div className="stats-filter" role="radiogroup" aria-label="Doléances affichées">{([['new','Reçues'],['planned','Prévues'],['done','Faites'],['declined','Écartées'],['all','Toutes']] as const).map(([v,l])=><button key={v} role="radio" aria-checked={status===v} className={status===v?'on':''} onClick={()=>setStatus(v)}>{l}</button>)}</div>
  {!list?<Skeleton style={{height:200}}/>:list.length===0?<p className="muted">Aucune doléance ici.</p>
   :<ul className="report-list">{list.map(s=><IdeaAdmin key={s.id} s={s} client={client} act={act} reason={reason} onDone={load}/>)}</ul>}
 </div>;
}

function IdeaAdmin({s,client,act,reason,onDone}:{s:Suggestion;client:SupabaseClient;act:Act;reason:Reason;onDone:()=>void}){
 const image=useSignedSubmission(client,s.image_path);
 const [st,setSt]=useState<SuggestionStatus>(s.status==='new'?'planned':s.status);
 const [pub,setPub]=useState(s.public);
 const [reply,setReply]=useState(s.reply??'');
 const [busy,setBusy]=useState(false);
 const changed=st!==s.status||pub!==s.public||reply.trim()!==(s.reply??'');
 async function save(){
  const r=await reason(`« ${s.title} » : ${SUGGESTION_STATUS[st].toLowerCase()}${pub?', publique (ouverte au vote)':', privée'}.${reply.trim()!==(s.reply??'')||st!==s.status?' L’auteur est prévenu.':''}`,'Enregistrer');
  if(r===null)return;setBusy(true);
  const ok=await act('Doléance mise à jour.',c=>callRpc(c,'admin_answer_suggestion',{p_id:s.id,p_status:st,p_public:pub,p_reply:reply,p_reason:r}));
  setBusy(false);if(ok)onDone();
 }
 return <li className={`panel report-item idea-admin status-${s.status}`}>
  <div className="report-head"><span className="status-chip">{SUGGESTION_CATEGORIES[s.category]}</span><strong>{s.title}</strong><small>{when(s.created_at)} · par {s.author??'—'}{s.public&&<> · <Flame size={11}/> {s.votes}</>}</small></div>
  {s.body?<p className="report-message">{s.body}</p>:<p className="muted">Sans détails.</p>}
  {s.image_path&&(image?<a className="idea-image" href={image} target="_blank" rel="noreferrer"><img src={image} alt={`Image jointe à « ${s.title} »`}/></a>:<span className="idea-image loading" aria-hidden="true"/>)}
  <div className="idea-admin-fields">
   <label className="auth-field"><span>Statut</span><select value={st} onChange={e=>setSt(e.target.value as SuggestionStatus)}>{(Object.keys(SUGGESTION_STATUS) as SuggestionStatus[]).map(k=><option key={k} value={k}>{SUGGESTION_STATUS[k]}</option>)}</select></label>
   <label className="admin-check"><input type="checkbox" checked={pub} onChange={e=>setPub(e.target.checked)}/> <Users size={13}/> Publique, ouverte au vote</label>
  </div>
  <label className="auth-field"><span>Réponse au joueur <small>visible par l’auteur, et par tous si publique</small></span><textarea rows={3} maxLength={1000} value={reply} placeholder="Merci ! Voici ce qu’on en pense…" onChange={e=>setReply(e.target.value)}/></label>
  <div className="admin-actions"><button className="primary compact" disabled={busy||!changed} onClick={()=>void save()}><Save size={14}/> Enregistrer</button></div>
 </li>;
}
