'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Bug,Flame,Lightbulb,MessageSquareQuote,Send,Sparkles,SquarePen,Users,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {Skeleton} from '@/components/ui';
import {callRpc,SUGGESTION_CATEGORIES,SUGGESTION_STATUS,type Suggestion,type SuggestionCategory} from '@/lib/game';

type Tab='propose'|'public';
const ICONS:Record<SuggestionCategory,typeof Lightbulb>={feature:Lightbulb,card:Sparkles,bug:Bug,other:MessageSquareQuote};
const when=(d:string)=>new Date(d).toLocaleDateString('fr-FR',{day:'numeric',month:'long'});

/** Une doléance : catégorie, statut, texte et réponse de l'équipe. */
function Idea({s,onVote,busy}:{s:Suggestion;onVote?:(s:Suggestion)=>void;busy?:boolean}){
 const Icon=ICONS[s.category];
 return <li className={`panel idea-item rise status-${s.status}`}>
  <div className="idea-head"><span className="idea-cat"><Icon size={13}/> {SUGGESTION_CATEGORIES[s.category]}</span><span className={`idea-status ${s.status}`}>{SUGGESTION_STATUS[s.status]}</span>{s.public&&s.mine&&<span className="idea-public"><Users size={12}/> Publique</span>}</div>
  <h3>{s.title}</h3>
  {s.body&&<p className="idea-text">{s.body}</p>}
  {s.reply&&<blockquote className="idea-reply"><span>Réponse de l’équipe</span>{s.reply}</blockquote>}
  <div className="idea-foot"><small className="muted">{s.mine?'Votre idée':`Par ${s.author??'un joueur'}`} · {when(s.created_at)}</small>
   {s.public&&(onVote&&!s.mine?<button className={`idea-vote ${s.my_vote?'on':''}`} disabled={busy} aria-pressed={s.my_vote} onClick={()=>onVote(s)}><Flame size={14}/> {s.my_vote?'Soutenue':'Soutenir'}<b>{s.votes}</b></button>
    :<span className="idea-vote static"><Flame size={14}/><b>{s.votes}</b></span>)}</div>
 </li>;
}

export default function Doleances(){
 const {configured,ready,session,client}=useAuth();
 const [tab,setTab]=useState<Tab>('propose');
 const [data,setData]=useState<{mine:Suggestion[];public:Suggestion[]}|null>(null);
 const [category,setCategory]=useState<SuggestionCategory>('feature');
 const [title,setTitle]=useState('');
 const [body,setBody]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});
 const load=useCallback(async()=>{if(!client)return;try{setData(await callRpc(client,'get_suggestions'));}catch(e){setMessage({error:(e as Error).message});}},[client]);
 useEffect(()=>{if(session)void load();},[session,load]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);

 async function send(){
  if(!client)return;setBusy(true);setMessage({});
  try{await callRpc(client,'submit_suggestion',{p_category:category,p_title:title,p_body:body});setTitle('');setBody('');setMessage({notice:'Merci ! Votre doléance est arrivée sur le bureau de l’équipe.'});await load();}
  catch(e){setMessage({error:(e as Error).message});}finally{setBusy(false);}
 }
 async function vote(s:Suggestion){
  if(!client)return;setBusy(true);
  try{await callRpc(client,'vote_suggestion',{p_id:s.id,p_on:!s.my_vote});await load();}catch(e){setMessage({error:(e as Error).message});}finally{setBusy(false);}
 }

 if(!configured||!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:260,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Doléances</span><h1>La boîte à doléances.</h1><p className="muted">Connectez-vous pour proposer une idée ou soutenir celles des autres.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;
 const valid=title.trim().length>=3&&title.trim().length<=80&&body.length<=2000;
 return <div className="page ideas-page">
  <header className="market-head rise"><div><span className="eyebrow">Doléances</span><h1>La boîte à idées</h1><p className="muted">Une fonctionnalité, une carte, une correction : dites-nous ce qui rendrait Cartema meilleur. L’équipe lit tout et répond.</p></div></header>
  <div className="segmented social-tabs" role="tablist">{([['propose','Proposer',SquarePen],['public','Idées publiques',Users]] as const).map(([k,l,I])=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)}><I size={15}/> {l}{k==='public'&&data&&data.public.length>0&&<b className="tab-count">{data.public.length}</b>}</button>)}</div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>
  <div key={tab} className="tab-panel">
  {tab==='propose'?<>
   <section className="panel idea-form rise">
    <div className="idea-cats" role="radiogroup" aria-label="Type de doléance">{(Object.keys(SUGGESTION_CATEGORIES) as SuggestionCategory[]).map(k=>{const I=ICONS[k];return <button key={k} role="radio" aria-checked={category===k} className={category===k?'on':''} onClick={()=>setCategory(k)}><I size={15}/> {SUGGESTION_CATEGORIES[k]}</button>;})}</div>
    <label className="auth-field"><span>Titre</span><input value={title} maxLength={80} placeholder={category==='card'?'Ex. : une carte pour Lara de Marnay jeune':category==='bug'?'Ex. : le bouton Vendre ne répond pas':'Ex. : un mode tournoi le samedi soir'} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="auth-field"><span>Détails <small>facultatif</small></span><textarea value={body} maxLength={2000} rows={5} placeholder="Expliquez votre idée, comment elle marcherait, pourquoi elle vous plairait…" onChange={e=>setBody(e.target.value)}/></label>
    <div className="idea-send"><small className="muted">Privée : seule l’équipe la lit. Elle peut la rendre publique pour que tout le monde vote. 5 par jour.</small><button className="primary" disabled={busy||!valid} onClick={()=>void send()}><Send size={15}/> Envoyer</button></div>
   </section>
   <h2 className="ideas-title">Mes doléances</h2>
   {!data?<Skeleton style={{height:120}}/>:data.mine.length===0?<p className="muted">Vous n’avez encore rien proposé.</p>:<ul className="idea-list">{data.mine.map(s=><Idea key={s.id} s={s}/>)}</ul>}
  </>:<>
   <p className="muted">Les idées retenues par l’équipe pour un vote. Soutenez celles que vous voulez voir arriver en premier.</p>
   {!data?<Skeleton style={{height:200}}/>:data.public.length===0?<section className="panel album-empty"><Lightbulb size={28}/><h2>Aucune idée publique pour l’instant.</h2><p className="muted">Proposez la vôtre : elle sera peut-être la première soumise au vote.</p></section>
   :<ul className="idea-list">{data.public.map(s=><Idea key={s.id} s={s} onVote={s=>void vote(s)} busy={busy}/>)}</ul>}
  </>}
  </div>
 </div>;
}
