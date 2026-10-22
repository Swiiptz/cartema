'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Award,ChevronDown,Clock,Crown,Info,Lock,Medal,ScrollText,Search,Trophy,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {Countdown,Skeleton} from '@/components/ui';
import {MissionBonusBar,MissionList} from '@/components/MissionList';
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
  try{const n=await action();await Promise.all([load(),refreshPlayer()]);if(n)setMessage({notice:n});}
  catch(e){setMessage({error:(e as Error).message});}
  finally{setBusy(false);}
 }
 const claim=(m:Mission)=>void run(async()=>{const r=await callRpc<{reward:number;bonus_boosters?:number}>(client!,'claim_mission',{p_assignment_id:m.assignment_id});const b=r.bonus_boosters??0;return `+${r.reward} Deniers · ${m.label}${b?` — toutes réclamées : +${b} booster${b>1?'s':''} !`:''}`;});
 const replace=(m:Mission)=>void (async()=>{if((await ask({title:'Remplacer cette mission ?',message:`« ${m.label} » sera remplacée par une autre. Un seul remplacement gratuit par jour.`,confirmLabel:'Remplacer'}))===null)return;void run(async()=>{await callRpc(client!,'replace_mission',{p_assignment_id:m.assignment_id});return 'Mission remplacée.';});})();

 if(!configured||!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:260,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Progression</span><h1>Missions et succès.</h1><p className="muted">Connectez-vous pour suivre vos missions, vos succès et votre rang.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 const unlockedCount=achievements?.filter(a=>a.unlocked_at).length??0;
 return <div className="page progression-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Progression</span><h1>Le grand livre</h1></div>{board?.me&&<span className="chip gold"><Trophy size={15}/> {board.me.position}<small>{board.me.position===1?'er':'e'} · {board.me.achievements} succès</small></span>}</header>
  <div className="segmented social-tabs" role="tablist">{([['missions','Missions',ScrollText],['achievements','Succès',Award],['ranking','Classement',Trophy]] as const).map(([k,l,I])=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)}><I size={15}/> {l}</button>)}</div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  <div key={tab} className="tab-panel">
  {tab==='missions'&&(!missions?<Skeleton style={{height:300}}/>:<div className="social-col">
   <section className="social-section"><div className="section-header"><h2>Quotidiennes</h2><span className="muted reset-in"><Clock size={12}/> renouvelées dans <Countdown to={missions.daily_reset} onDone={()=>void load()}/></span></div>
    <MissionBonusBar bonus={missions.daily_bonus} missions={missions.daily} period="du jour"/>
    <MissionList missions={missions.daily} busy={busy} canReplace={missions.replacement_available} onClaim={claim} onReplace={replace}/></section>
   <section className="social-section"><div className="section-header"><h2>Hebdomadaires</h2><span className="muted reset-in"><Clock size={12}/> renouvelées dans <Countdown to={missions.weekly_reset} onDone={()=>void load()}/></span></div>
    <MissionBonusBar bonus={missions.weekly_bonus} missions={missions.weekly} period="de la semaine"/>
    <MissionList missions={missions.weekly} busy={busy} canReplace={missions.replacement_available} onClaim={claim} onReplace={replace}/></section>
   <p className="muted small-note">{missions.replacement_available?'Une mission vous déplaît ? Vous pouvez en remplacer une gratuitement aujourd’hui.':'Remplacement gratuit utilisé aujourd’hui.'}</p>
  </div>)}

  {tab==='achievements'&&(!achievements?<Skeleton style={{height:300}}/>:<Achievements list={achievements} unlocked={unlockedCount} currentTitle={player?.profile.title??null} busy={busy} onTitle={code=>void run(async()=>{const t=await callRpc<string|null>(client!,'set_title',{p_code:code});return t?`Vous portez désormais le titre « ${t} ».`:'Titre retiré.';})}/>)}

  {tab==='ranking'&&(!board?<Skeleton style={{height:300}}/>:<section className="social-section">
   <p className="muted">Classement par nombre de succès obtenus, puis par personnages découverts en cas d’égalité. Les succès sont définitifs et une carte cédée reste découverte. Pour un succès de cartes (clan, rareté, édition, groupe de personnages), il faut posséder les cartes au moment de l’obtenir.</p>
   <ol className="ranking">{board.top.map((r,i)=><li key={`${r.handle}-${i}`} className={`rise ${r.me?'me':''} top-${r.position}`} style={{'--i':Math.min(i,15)} as React.CSSProperties}>
    <span className="rank-pos">{r.position<=3?<Crown size={16}/>:r.position}</span>
    <Link className="person-name" href={`/joueur/?h=${encodeURIComponent(r.handle)}`}>{r.handle}{r.title&&<small className="rank-title">{r.title}</small>}</Link>
    <span className="rank-scores"><strong className="rank-score">{r.achievements}<small> succès</small></strong><small>{r.faces} visage{r.faces>1?'s':''}</small></span>
   </li>)}</ol>
   {board.me&&!board.top.some(r=>r.me)&&<p className="muted">Vous êtes {board.me.position}e avec {board.me.achievements} succès et {board.me.faces} visages.</p>}
  </section>)}
  </div>
 </div>;
}

type Group={key:string;title:string;subgroups:{key:string;title:string;items:Achievement[]}[]};
const TIERS=['Bronze','Argent','Or','Platine','Sang'];
const TIER_COLORS=['#c58a5a','#c9ccd6','#e7c46a','#a9e4e8','#d0344f'];
const reward=(a:Achievement)=>[(a.reward_deniers??0)>0&&`+${a.reward_deniers} Deniers`,(a.reward_boosters??0)>0&&`+${a.reward_boosters} booster${(a.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
/** Une série regroupe ses paliers ; les autres succès restent seuls. */
function bySeries(items:Achievement[]){
 const out:(Achievement|Achievement[])[]=[];const seen=new Map<string,Achievement[]>();
 for(const a of items){if(!a.series){out.push(a);continue;}let s=seen.get(a.series);if(!s){s=[];seen.set(a.series,s);out.push(s);}s.push(a);}
 for(const s of seen.values())s.sort((x,y)=>(x.tier??0)-(y.tier??0));
 return out;
}

function Achievements({list,unlocked,currentTitle,busy,onTitle}:{list:Achievement[];unlocked:number;currentTitle:string|null;busy:boolean;onTitle:(code:string|null)=>void}){
 const [info,setInfo]=useState<string|null>(null);
 // Choix affiché immédiatement, puis confirmé par le profil rechargé.
 const [chosen,setChosen]=useState<string|null|undefined>(undefined);
 useEffect(()=>{setChosen(undefined);},[currentTitle]);
 const groups=useMemo(()=>{
  const out:Group[]=[];
  // Succès personnalisés rattachés à une édition : rangés dans son set ; secrets sans édition :
  // avec les secrets généraux ; les autres forment la chronique.
  const custom=list.filter(a=>a.category==='custom');
  const editions=[...new Set(list.filter(a=>a.category==='collection').map(a=>a.edition??''))];
  for(const ed of editions){
   const items=list.filter(a=>a.category==='collection'&&(a.edition??'')===ed);
   const linked=custom.filter(a=>a.edition&&a.edition===ed);
   out.push({key:`ed-${ed}`,title:`Collection · ${ed}`,subgroups:[
    {key:'all',title:'Édition complète',items:items.filter(a=>a.code.endsWith(':all'))},
    {key:'rarity',title:'Raretés',items:items.filter(a=>a.code.includes(':rarity:'))},
    {key:'clan',title:'Clans',items:items.filter(a=>a.code.includes(':clan:'))},
    {key:'groups',title:'Personnages',items:linked.filter(a=>!a.secret)},
    {key:'secret',title:'Secrets',items:linked.filter(a=>a.secret)}].filter(s=>s.items.length)});
  }
  const placed=new Set(editions);
  const chronicle=custom.filter(a=>!(a.edition&&placed.has(a.edition))&&!a.secret);
  if(chronicle.length)out.push({key:'custom',title:'Succès de la chronique',subgroups:[{key:'visible',title:'',items:chronicle}]});
  const general=list.filter(a=>a.category==='general');
  const secrets=[...general.filter(a=>a.secret),...custom.filter(a=>!(a.edition&&placed.has(a.edition))&&a.secret)];
  out.push({key:'general',title:'Succès généraux',subgroups:[
   {key:'visible',title:'',items:general.filter(a=>!a.secret)},
   {key:'secret',title:'Secrets',items:secrets}].filter(s=>s.items.length)});
  return out;
 },[list]);
 // Catégories repliables : la première est ouverte, le choix est mémorisé sur l'appareil.
 const [opened,setOpened]=useState<Record<string,boolean>>({});
 useEffect(()=>{try{const raw=localStorage.getItem('cartema.achievements.open');if(raw)setOpened(JSON.parse(raw));}catch{/* facultatif */}},[]);
 const isOpen=(key:string,fallback:boolean)=>opened[key]??fallback;
 const toggle=(key:string,fallback:boolean)=>setOpened(o=>{const n={...o,[key]:!(o[key]??fallback)};try{localStorage.setItem('cartema.achievements.open',JSON.stringify(n));}catch{/* facultatif */}return n;});
 const count=(items:Achievement[])=>`${items.filter(a=>a.unlocked_at).length}/${items.length}`;
 const titles=list.filter(a=>a.unlocked_at&&a.title);

 const series=(tiers:Achievement[],i:number)=>{
  const done=tiers.filter(a=>a.unlocked_at);const top=done[done.length-1];const next=tiers.find(a=>!a.unlocked_at);
  const key=`series:${tiers[0].series}`;const level=top?.tier??0;
  const color=level?TIER_COLORS[Math.min(level,TIER_COLORS.length)-1]:'var(--gold)';
  return <li key={key} className={`achievement series rise ${top?'done':''} ${next?'':'complete'}`} style={{'--i':Math.min(i,12),'--rc':color} as React.CSSProperties}>
   <span className="ach-medal tier-medal" aria-hidden="true"><Award size={18}/>{level>0&&<b>{['I','II','III','IV','V'][level-1]}</b>}</span>
   <div className="ach-body">
    <div className="ach-head"><strong>{tiers[0].series_label}</strong>{top&&<span className="tier-name">{TIERS[level-1]}</span>}<button className="info-btn" aria-label="Paliers" aria-expanded={info===key} onClick={()=>setInfo(info===key?null:key)}><Info size={13}/></button></div>
    {info===key&&<ol className="ach-bubble tier-list" role="note">{tiers.map(a=><li key={a.code} className={a.unlocked_at?'on':''} style={{'--tc':TIER_COLORS[(a.tier??1)-1]} as React.CSSProperties}>
     <b>{TIERS[(a.tier??1)-1]}</b> <span>{a.label} — {a.description}</span>{reward(a)&&<small>{reward(a)}{a.title?` · titre « ${a.title} »`:''}</small>}</li>)}</ol>}
    <small className="ach-date">{top?top.label:'Aucun palier atteint'}{top?.title?` · titre « ${top.title} »`:''}</small>
    {next?<div className="ach-progress"><div className="meter"><i style={{'--v':`${next.target?Math.min(100,(next.progress??0)/next.target*100):0}%`} as React.CSSProperties}/></div><small>{next.progress??0}/{next.target}</small></div>
     :<small className="ach-reward">Tous les paliers obtenus</small>}
    <div className="tier-pips">{tiers.map(a=><i key={a.code} title={`${TIERS[(a.tier??1)-1]} : ${a.label}`} className={a.unlocked_at?'on':''} style={{'--tc':TIER_COLORS[(a.tier??1)-1]} as React.CSSProperties}/>)}</div>
    {next&&reward(next)&&<small className="ach-reward">Prochain palier ({TIERS[(next.tier??1)-1]}) : {reward(next)}</small>}
   </div>
  </li>;};
 const render=(items:Achievement[])=>bySeries(items).map((x,i)=>Array.isArray(x)?series(x,i):item(x,i));
 const item=(a:Achievement,i:number)=>{const done=!!a.unlocked_at;const hidden=a.secret&&!done;const hasInfo=!!a.description||!!a.reason;return <li key={a.code} className={`achievement rise ${done?'done':''} ${hidden?'secret':''}`} style={{'--i':Math.min(i,12),'--rc':a.rarity?palette[a.rarity]:'var(--gold)'} as React.CSSProperties}>
  <span className="ach-medal" aria-hidden="true">{hidden?<Lock size={16}/>:<Award size={18}/>}</span>
  <div className="ach-body">
   <div className="ach-head"><strong>{hidden?'Succès secret':a.label}</strong>{hasInfo&&!hidden&&<button className="info-btn" aria-label="Explication" aria-expanded={info===a.code} onClick={()=>setInfo(info===a.code?null:a.code)}><Info size={13}/></button>}</div>
   {info===a.code&&<p className="ach-bubble" role="note">{a.description}{a.reason&&<span className="ach-reason">Décerné : {a.reason}</span>}</p>}
   {hidden?<small className="muted">Continuez à jouer pour le révéler.</small>
    :done?<small className="ach-date">Obtenu le {new Date(a.unlocked_at!).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}{a.title?` · titre « ${a.title} »`:''}</small>
    :<div className="ach-progress"><div className="meter"><i style={{'--v':`${a.target?Math.min(100,(a.progress??0)/a.target*100):0}%`} as React.CSSProperties}/></div><small>{a.progress??0}/{a.target}{a.owned_rule&&<em className="ach-owned"> possédées</em>}</small></div>}
   {!done&&!hidden&&a.missing&&a.missing.length>0&&<div className="ach-missing"><span>Il vous manque</span>
    {a.missing.map(m=>m.name
     ?<Link key={m.code} className="ach-missing-chip" href={`/market/?q=${encodeURIComponent(m.name)}`} title={`Chercher ${m.name} au marché`}><Search size={11}/>{m.name}</Link>
     :<span key={m.code} className="ach-missing-chip unknown" title="Carte jamais découverte">{m.code} · inconnue</span>)}</div>}
   {!hidden&&((a.reward_deniers??0)>0||(a.reward_boosters??0)>0)&&<small className="ach-reward">{(a.reward_deniers??0)>0&&`+${a.reward_deniers} Deniers`}{(a.reward_boosters??0)>0&&` · +${a.reward_boosters} booster${(a.reward_boosters??0)>1?'s':''}`}</small>}
  </div>
 </li>;};

 return <div className="social-col">
  <div className="panel title-panel"><div><span className="eyebrow">Succès</span><strong className="title-count">{unlocked} / {list.length}</strong></div>
   <label className="auth-field title-select"><span><Medal size={14}/> Titre porté</span><select value={chosen!==undefined?(chosen??''):(titles.find(t=>t.title===currentTitle)?.code??'')} disabled={busy||!titles.length} onChange={e=>{setChosen(e.target.value||null);onTitle(e.target.value||null);}}><option value="">{titles.length?'Aucun titre':'Aucun titre débloqué'}</option>{titles.map(t=><option key={t.code} value={t.code}>{t.title}</option>)}</select></label>
  </div>
  {groups.map((g,gi)=>{const all=g.subgroups.flatMap(s=>s.items);const open=isOpen(g.key,gi===0);return <section key={g.key} className={`ach-group ${open?'open':''}`}>
   <button className="ach-group-head" aria-expanded={open} onClick={()=>toggle(g.key,gi===0)}><ChevronDown size={18} className="chevron"/><h2>{g.title}</h2><span className="ach-count">{count(all)}</span></button>
   <div className={`collapsible ${open?'open':''}`} inert={!open}><div className="collapsible-inner"><div className="ach-group-body">
    {g.subgroups.map(sg=>{const key=`${g.key}/${sg.key}`;if(!sg.title)return <ul key={key} className="achievement-grid">{render(sg.items)}</ul>;
     const sOpen=isOpen(key,sg.key==='all'||sg.key==='visible');
     return <div key={key} className={`ach-sub ${sOpen?'open':''}`}>
      <button className="ach-sub-head" aria-expanded={sOpen} onClick={()=>toggle(key,sg.key==='all'||sg.key==='visible')}><ChevronDown size={15} className="chevron"/><span>{sg.title}</span><span className="ach-count">{count(sg.items)}</span></button>
      <div className={`collapsible ${sOpen?'open':''}`} inert={!sOpen}><div className="collapsible-inner"><ul className="achievement-grid">{render(sg.items)}</ul></div></div>
     </div>;})}
   </div></div></div>
  </section>;})}
 </div>;
}
