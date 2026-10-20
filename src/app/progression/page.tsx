'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Award,Clock,Crown,Info,Lock,Medal,ScrollText,Trophy,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {Countdown,Skeleton} from '@/components/ui';
import {MissionList} from '@/components/MissionList';
import {palette} from '@/components/Card';
import {callRpc,type Achievement,type Leaderboard,type Mission,type Missions} from '@/lib/game';

type Tab='missions'|'achievements'|'ranking';

export default function Progression(){
 const {configured,ready,session,client,player,refreshPlayer}=useAuth();
 const [ask,askNode]=useAsk();
 const [tab,setTab]=useState<Tab>('missions');
 const [missions,setMissions]=useState<Missions|null>(null);
 const [achievements,setAchievements]=useState<Achievement[]|null>(null);
 const [board,setBoard]=useState<Leaderboard|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});

 const load=useCallback(async()=>{
  if(!client)return;
  try{const [m,a,b]=await Promise.all([callRpc<Missions>(client,'get_missions'),callRpc<Achievement[]>(client,'get_achievements'),callRpc<Leaderboard>(client,'get_leaderboard',{p_limit:50})]);setMissions(m);setAchievements(a);setBoard(b);}
  catch(e){setMessage({error:(e as Error).message});}
 },[client]);
 useEffect(()=>{if(session)void load();},[session,load]);
 useEffect(()=>{const t=new URLSearchParams(window.location.search).get('onglet');if(t==='succes')setTab('achievements');if(t==='classement')setTab('ranking');},[]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);

 async function run(action:()=>Promise<string|null>){
  setBusy(true);setMessage({});
  try{const n=await action();await load();void refreshPlayer();if(n)setMessage({notice:n});}
  catch(e){setMessage({error:(e as Error).message});}
  finally{setBusy(false);}
 }
 const claim=(m:Mission)=>void run(async()=>{const r=await callRpc<{reward:number}>(client!,'claim_mission',{p_assignment_id:m.assignment_id});return `+${r.reward} Deniers · ${m.label}`;});
 const replace=(m:Mission)=>void (async()=>{if((await ask({title:'Remplacer cette mission ?',message:`« ${m.label} » sera remplacée par une autre. Un seul remplacement gratuit par jour.`,confirmLabel:'Remplacer'}))===null)return;void run(async()=>{await callRpc(client!,'replace_mission',{p_assignment_id:m.assignment_id});return 'Mission remplacée.';});})();

 if(!configured||!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:260,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Progression</span><h1>Missions et succès.</h1><p className="muted">Connectez-vous pour suivre vos missions, vos succès et votre rang.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 const unlockedCount=achievements?.filter(a=>a.unlocked_at).length??0;
 return <div className="page progression-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Progression</span><h1>Le grand livre</h1></div>{board?.me&&<span className="chip gold"><Trophy size={15}/> {board.me.position}<small>e · {board.me.score} visages</small></span>}</header>
  <div className="segmented social-tabs" role="tablist">{([['missions','Missions',ScrollText],['achievements','Succès',Award],['ranking','Classement',Trophy]] as const).map(([k,l,I])=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)}><I size={15}/> {l}</button>)}</div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  {tab==='missions'&&(!missions?<Skeleton style={{height:300}}/>:<div className="social-col">
   <section className="social-section"><div className="section-header"><h2>Quotidiennes</h2><span className="muted reset-in"><Clock size={12}/> renouvelées dans <Countdown to={missions.daily_reset} onDone={()=>void load()}/></span></div>
    <MissionList missions={missions.daily} busy={busy} canReplace={missions.replacement_available} onClaim={claim} onReplace={replace}/></section>
   <section className="social-section"><div className="section-header"><h2>Hebdomadaires</h2><span className="muted reset-in"><Clock size={12}/> renouvelées dans <Countdown to={missions.weekly_reset} onDone={()=>void load()}/></span></div>
    <MissionList missions={missions.weekly} busy={busy} canReplace={missions.replacement_available} onClaim={claim} onReplace={replace}/></section>
   <p className="muted small-note">{missions.replacement_available?'Une mission vous déplaît ? Vous pouvez en remplacer une gratuitement aujourd’hui.':'Remplacement gratuit utilisé aujourd’hui.'}</p>
  </div>)}

  {tab==='achievements'&&(!achievements?<Skeleton style={{height:300}}/>:<Achievements list={achievements} unlocked={unlockedCount} currentTitle={player?.profile.title??null} busy={busy} onTitle={code=>void run(async()=>{const t=await callRpc<string|null>(client!,'set_title',{p_code:code});return t?`Vous portez désormais le titre « ${t} ».`:'Titre retiré.';})}/>)}

  {tab==='ranking'&&(!board?<Skeleton style={{height:300}}/>:<section className="social-section">
   <p className="muted">Classement par nombre de personnages découverts ({board.total_characters} au total). Les finitions ne comptent pas, et une carte cédée reste découverte.</p>
   <ol className="ranking">{board.top.map((r,i)=><li key={`${r.handle}-${i}`} className={`rise ${r.me?'me':''} top-${r.position}`} style={{'--i':Math.min(i,15)} as React.CSSProperties}>
    <span className="rank-pos">{r.position<=3?<Crown size={16}/>:r.position}</span>
    <span className="person-name">{r.handle}{r.title&&<small className="rank-title">{r.title}</small>}</span>
    <strong className="rank-score">{r.score}</strong>
   </li>)}</ol>
   {board.me&&!board.top.some(r=>r.me)&&<p className="muted">Vous êtes {board.me.position}e avec {board.me.score} visages.</p>}
  </section>)}
 </div>;
}

function Achievements({list,unlocked,currentTitle,busy,onTitle}:{list:Achievement[];unlocked:number;currentTitle:string|null;busy:boolean;onTitle:(code:string|null)=>void}){
 const [open,setOpen]=useState<string|null>(null);
 const groups=useMemo(()=>{
  const out:{key:string;title:string;items:Achievement[]}[]=[];
  const editions=[...new Set(list.filter(a=>a.category==='collection').map(a=>a.edition??''))];
  for(const ed of editions){
   const items=list.filter(a=>a.category==='collection'&&(a.edition??'')===ed);
   out.push({key:`ed-${ed}`,title:`Collection · ${ed}`,items:[...items.filter(a=>a.code.endsWith(':all')),...items.filter(a=>a.code.includes(':rarity:')),...items.filter(a=>a.code.includes(':clan:'))]});
  }
  const custom=list.filter(a=>a.category==='custom');if(custom.length)out.push({key:'custom',title:'Succès de la chronique',items:custom});
  out.push({key:'general',title:'Succès généraux',items:list.filter(a=>a.category==='general')});
  return out;
 },[list]);
 const titles=list.filter(a=>a.unlocked_at&&a.title);
 return <div className="social-col">
  <div className="panel title-panel"><div><span className="eyebrow">Succès</span><strong className="title-count">{unlocked} / {list.length}</strong></div>
   <label className="auth-field title-select"><span><Medal size={14}/> Titre porté</span><select value={titles.find(t=>t.title===currentTitle)?.code??''} disabled={busy||!titles.length} onChange={e=>onTitle(e.target.value||null)}><option value="">{titles.length?'Aucun titre':'Aucun titre débloqué'}</option>{titles.map(t=><option key={t.code} value={t.code}>{t.title}</option>)}</select></label>
  </div>
  {groups.map(g=><section key={g.key} className="social-section"><h2>{g.title}</h2><ul className="achievement-grid">{g.items.map((a,i)=>{const done=!!a.unlocked_at;const hasInfo=!!a.description||!!a.reason;return <li key={a.code} className={`achievement rise ${done?'done':''} ${a.secret&&!done?'secret':''}`} style={{'--i':Math.min(i,12),'--rc':a.rarity?palette[a.rarity]:'var(--gold)'} as React.CSSProperties}>
   <span className="ach-medal" aria-hidden="true">{a.secret&&!done?<Lock size={16}/>:<Award size={18}/>}</span>
   <div className="ach-body">
    <div className="ach-head"><strong>{a.secret&&!done?'Succès secret':a.label}</strong>{hasInfo&&!(a.secret&&!done)&&<button className="info-btn" aria-label="Explication" aria-expanded={open===a.code} onClick={()=>setOpen(open===a.code?null:a.code)}><Info size={13}/></button>}</div>
    {open===a.code&&<p className="ach-bubble" role="note">{a.description}{a.reason&&<span className="ach-reason">Décerné : {a.reason}</span>}</p>}
    {a.secret&&!done?<small className="muted">Continuez à jouer pour le révéler.</small>
     :done?<small className="ach-date">Obtenu le {new Date(a.unlocked_at!).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}{a.title?` · titre « ${a.title} »`:''}</small>
     :<div className="ach-progress"><div className="meter"><i style={{'--v':`${a.target?Math.min(100,(a.progress??0)/a.target*100):0}%`} as React.CSSProperties}/></div><small>{a.progress??0}/{a.target}</small></div>}
    {!(a.secret&&!done)&&((a.reward_deniers??0)>0||(a.reward_boosters??0)>0)&&<small className="ach-reward">{(a.reward_deniers??0)>0&&`+${a.reward_deniers} Deniers`}{(a.reward_boosters??0)>0&&` · +${a.reward_boosters} booster${(a.reward_boosters??0)>1?'s':''}`}</small>}
   </div>
  </li>;})}</ul></section>)}
 </div>;
}
