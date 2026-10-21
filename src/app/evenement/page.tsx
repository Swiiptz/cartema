'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Check,Clock,Coins,Crown,Gift,Layers3,Trophy,Users} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {TarotCard} from '@/components/Card';
import {eventEffects} from '@/components/EventBanner';
import {Countdown,Skeleton} from '@/components/ui';
import {callRpc,silhouetteIndex,EVENT_METRICS,type ArtMeta} from '@/lib/game';
import type {Rarity} from '@/lib/draw';

type EventCard={code:string;rarity:Rarity;silhouette_key:string|null;known:boolean;name?:string;role_title?:string;clan?:string|null;art_path?:string|null;art_meta?:ArtMeta|null};
type EventDetail={id:string;name:string;description:string;starts_at:string;ends_at:string;active:boolean;ended:boolean;settled:boolean;claim_until:string;
 finish_multiplier:number;deniers_multiplier:number;bonus_boosters:number;free_interval_hours:number|null;claimed_bonus:boolean;
 missions:{id:string;label:string;target:number;progress:number;claimed:boolean;reward_deniers:number;reward_boosters:number}[];
 community:{metric:string;target:number;total:number;mine:number;reward_deniers:number;reward_boosters:number}|null;
 leaderboard:{metric:string;rewards:{deniers?:number;boosters?:number}[];top:{position:number;handle:string;score:number;me:boolean}[];me:{position:number;score:number}|null}|null;
 cards:EventCard[];my_rewards:{kind:string;rank:number|null;deniers:number;boosters:number}[]};
const fmt=(n:number)=>n.toLocaleString('fr-FR').replace(/ /g,' ');
const reward=(d?:number,b?:number)=>[(d??0)>0&&`${fmt(d!)} Deniers`,(b??0)>0&&`${b} booster${(b??0)>1?'s':''}`].filter(Boolean).join(' + ');

/** Page d'un événement : effets, missions, défi commun, classement, cartes inédites. */
export default function EventPage(){
 const {configured,ready,session,client,refreshPlayer}=useAuth();
 const [id,setId]=useState<string|null|undefined>(undefined);
 const [ev,setEv]=useState<EventDetail|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{setId(new URLSearchParams(window.location.search).get('id'));},[]);
 const load=useCallback(async()=>{if(!client||!id)return;try{setEv(await callRpc<EventDetail>(client,'get_event',{p_event_id:id}));}catch(e){setError((e as Error).message);}},[client,id]);
 useEffect(()=>{if(session)void load();},[session,load]);
 async function claim(missionId:string){
  if(!client)return;setBusy(true);setNotice(null);
  try{const r=await callRpc<{reward_deniers:number;reward_boosters:number}>(client,'claim_event_mission',{p_mission_id:missionId});setNotice(`+${reward(r.reward_deniers,r.reward_boosters)}`);await Promise.all([load(),refreshPlayer()]);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(!configured||!ready||id===undefined||(session&&id&&!ev&&!error))return <div className="page"><Skeleton style={{height:140}}/><Skeleton style={{height:260,marginTop:14}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Événement</span><h1>Un événement vous attend.</h1><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;
 if(error&&!ev||!ev)return <div className="page"><section className="panel auth-panel"><h2>Événement introuvable</h2><p className="muted">{error??'Lien incomplet.'}</p><Link className="primary ghost" href="/">Retour à l’accueil</Link></section></div>;
 const claimOpen=!ev.ended||Date.parse(ev.claim_until)>Date.now();
 return <div className="page event-page">
  <header className={`event-banner rise ${ev.active?'live':'soon'}`}>
   <div className="event-head"><span className="eyebrow"><span className="event-dot" aria-hidden="true"/>{ev.active?'Événement en cours':ev.ended?'Événement terminé':'Bientôt'}</span>
    <span className="event-time"><Clock size={12}/> {ev.active?<>se termine dans <Countdown to={ev.ends_at} onDone={()=>void load()}/></>:ev.ended?<>terminé le {new Date(ev.ends_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}</>:<>commence dans <Countdown to={ev.starts_at} onDone={()=>void load()}/></>}</span></div>
   <h1>{ev.name}</h1>{ev.description&&<p className="event-desc">{ev.description}</p>}
   <ul className="event-effects">{eventEffects(ev).map(({icon:I,text})=><li key={text}><I size={13}/> {text}</li>)}</ul>
  </header>
  {notice&&<p className="auth-notice" role="status">{notice}</p>}{error&&<p className="auth-error" role="alert">{error}</p>}
  {ev.my_rewards.length>0&&<section className="panel event-rewards rise"><Gift size={18}/><div><strong>Récompenses reçues</strong>{ev.my_rewards.map((r,i)=><p key={i}>{r.kind==='podium'?`${r.rank}${r.rank===1?'re':'e'} place du classement`:'Défi communautaire réussi'} : {reward(r.deniers,r.boosters)}</p>)}</div></section>}

  {ev.missions.length>0&&<section className="social-section rise"><div className="section-header"><h2>Missions de l’événement</h2>{ev.ended&&claimOpen&&<span className="muted reset-in">À réclamer avant le {new Date(ev.claim_until).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}</span>}</div>
   <ul className="mission-list">{ev.missions.map((m,i)=>{const done=m.progress>=m.target;return <li key={m.id} className={`mission rise ${m.claimed?'claimed':done?'ready':''}`} style={{'--i':i} as React.CSSProperties}>
    <div className="mission-top"><span className="mission-label">{m.label}</span><span className="mission-reward">{m.reward_deniers>0&&<><Coins size={12}/> {fmt(m.reward_deniers)}</>}{m.reward_boosters>0&&<> <Layers3 size={12}/> {m.reward_boosters}</>}</span></div>
    <div className="mission-bottom"><div className="meter mission-meter"><i style={{'--v':`${Math.min(100,m.progress/m.target*100)}%`} as React.CSSProperties}/></div><span className="mission-count">{m.progress}/{m.target}</span>
     {m.claimed?<span className="mission-done"><Check size={13}/> Reçu</span>:done&&claimOpen&&ev.starts_at<=new Date().toISOString()?<button className="primary compact mission-claim" disabled={busy} onClick={()=>void claim(m.id)}>Réclamer</button>:null}</div>
   </li>;})}</ul></section>}

  {ev.community&&<section className="panel event-community rise"><div className="section-header"><div><span className="eyebrow"><Users size={12}/> Défi communautaire</span><h2>{EVENT_METRICS[ev.community.metric]??ev.community.metric} : {fmt(ev.community.total)} / {fmt(ev.community.target)}</h2></div></div>
   <div className="meter community-meter"><i style={{'--v':`${Math.min(100,ev.community.total/ev.community.target*100)}%`} as React.CSSProperties}/></div>
   <p className="muted">Ensemble, atteignez l’objectif avant la fin : chaque participant recevra {reward(ev.community.reward_deniers,ev.community.reward_boosters)||'une récompense'}. Votre contribution : <strong>{fmt(ev.community.mine)}</strong>.</p></section>}

  {ev.leaderboard&&<section className="social-section rise"><div className="section-header"><h2><Trophy size={18}/> Classement · {EVENT_METRICS[ev.leaderboard.metric]??ev.leaderboard.metric}</h2></div>
   {ev.leaderboard.rewards.length>0&&<p className="muted">{ev.leaderboard.rewards.map((r,i)=>`${['1re','2e','3e'][i]} : ${reward(r.deniers,r.boosters)||'—'}`).join(' · ')}</p>}
   {ev.leaderboard.top.length===0?<p className="muted">Personne n’est encore classé.</p>:<ol className="ranking">{ev.leaderboard.top.map(r=><li key={r.handle} className={`${r.me?'me':''} top-${r.position}`}><span className="rank-pos">{r.position<=3?<Crown size={16}/>:r.position}</span><span className="person-name">{r.handle}</span><span className="rank-scores"><strong className="rank-score">{fmt(r.score)}</strong></span></li>)}</ol>}
   {ev.leaderboard.me&&!ev.leaderboard.top.some(r=>r.me)&&<p className="muted">Vous êtes {ev.leaderboard.me.position}e avec {fmt(ev.leaderboard.me.score)}.</p>}</section>}

  {ev.cards.length>0&&<section className="social-section rise"><h2>Cartes de l’événement</h2>
   <p className="muted">{ev.starts_at>new Date().toISOString()?`${ev.cards.length} carte${ev.cards.length>1?'s':''} inédite${ev.cards.length>1?'s':''} dévoilée${ev.cards.length>1?'s':''} au début de l’événement.`:'Elles rejoignent l’édition : on peut les tirer dans les boosters.'}</p>
   <div className="card-grid event-cards">{ev.cards.map((c,i)=><TarotCard key={`${c.code}-${i}`} card={{id:c.code,name:c.name??'Inconnu',clan:c.known?c.clan??'?':'Inconnu',role:c.role_title??'',rarity:c.rarity,known:c.known,illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),artLayout:c.art_meta?.layout==='full'||c.art_meta?.layout==='cover'?c.art_meta.layout:undefined,artOffsetY:Number(c.art_meta?.offsetY)||undefined}}/>)}</div></section>}
 </div>;
}
