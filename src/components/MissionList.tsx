'use client';
import {Check,Coins,Gift,RefreshCw} from 'lucide-react';
import type {Mission,MissionBonus} from '@/lib/game';

/** Liste de missions : avancement, réclamation et remplacement gratuit. */
export function MissionList({missions,busy,canReplace,onClaim,onReplace}:{missions:Mission[];busy:boolean;canReplace:boolean;onClaim:(m:Mission)=>void;onReplace?:(m:Mission)=>void}){
 return <ul className="mission-list">{missions.map((m,i)=>{const done=m.progress>=m.target;return <li key={m.assignment_id} className={`mission rise ${m.claimed?'claimed':done?'ready':''}`} style={{'--i':i} as React.CSSProperties}>
  <div className="mission-top"><span className="mission-label">{m.label}</span><span className="mission-reward"><Coins size={12}/> {m.reward}</span></div>
  <div className="mission-bottom">
   <div className="meter mission-meter" aria-label={`${m.progress} sur ${m.target}`}><i style={{'--v':`${Math.min(100,m.progress/m.target*100)}%`} as React.CSSProperties}/></div>
   <span className="mission-count">{m.progress}/{m.target}</span>
   {m.claimed?<span className="mission-done"><Check size={13}/> Reçu</span>
    :done?<button className="primary compact mission-claim" disabled={busy} onClick={()=>onClaim(m)}>Réclamer</button>
    :canReplace&&onReplace&&m.replaceable!==false?<button className="icon-button mission-swap" disabled={busy} aria-label={`Remplacer « ${m.label} »`} title="Remplacer (1 fois par jour)" onClick={()=>onReplace(m)}><RefreshCw size={14}/></button>:null}
  </div>
 </li>;})}</ul>;
}

/** Bonus versé quand toutes les missions de la période sont réclamées. */
export function MissionBonusBar({bonus,missions,period}:{bonus?:MissionBonus;missions:Mission[];period:string}){
 if(!bonus||bonus.boosters<=0||!missions.length)return null;
 const claimed=missions.filter(m=>m.claimed).length;
 return <div className={`mission-bonus ${bonus.claimed?'claimed':''}`}>
  <Gift size={15}/>
  <span>{bonus.claimed?`Bonus ${period} reçu`:`Toutes réclamées : +${bonus.boosters} booster${bonus.boosters>1?'s':''}`}</span>
  <span className="mission-bonus-pips" aria-label={`${claimed} sur ${missions.length}`}>{missions.map((m,i)=><i key={i} className={m.claimed?'on':''}/>)}</span>
 </div>;
}
