'use client';
import {useCallback,useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,ChevronDown,RefreshCw,ShieldAlert} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import {callRpc} from '@/lib/game';

type Row={player:string|null;player_id?:string;other?:string|null;other_id?:string;detail:string};
type Check={code:string;severity:'critical'|'warning';title:string;hint:string;rows:Row[];count:number};
type Report={generated_at:string;days:number;checks:Check[]};

/** Surveillance : contrôles d'intégrité et comportements suspects, avec accès direct à la fiche joueur. */
export function MonitorTab({client,onOpenPlayer}:{client:SupabaseClient;onOpenPlayer:(id:string)=>void}){
 const [days,setDays]=useState(7);
 const [report,setReport]=useState<Report|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [open,setOpen]=useState<Record<string,boolean>>({});
 const load=useCallback(async()=>{setBusy(true);setError(null);try{setReport(await callRpc<Report>(client,'admin_anomalies',{p_days:days}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[client,days]);
 useEffect(()=>{void load();},[load]);
 if(error)return <p className="auth-error" role="alert">{error}</p>;
 if(!report)return <Skeleton style={{height:300}}/>;
 const critical=report.checks.filter(c=>c.severity==='critical'&&c.count>0);
 const warnings=report.checks.filter(c=>c.severity==='warning'&&c.count>0);
 const clean=report.checks.filter(c=>c.count===0);
 const player=(id:string|undefined,name:string|null|undefined)=>id?<button type="button" className="text-link" onClick={()=>onOpenPlayer(id)}>{name??'compte supprimé'}</button>:<span>{name??'—'}</span>;
 const block=(c:Check)=>{const isOpen=open[c.code]??c.severity==='critical';return <section key={c.code} className={`panel monitor-check ${c.severity}`}>
  <button type="button" className="monitor-head" aria-expanded={isOpen} onClick={()=>setOpen(o=>({...o,[c.code]:!isOpen}))}>
   {c.severity==='critical'?<ShieldAlert size={18}/>:<AlertTriangle size={18}/>}<strong>{c.title}</strong><span className="ach-count">{c.count}</span><ChevronDown size={16} className="chevron"/></button>
  <div className={`collapsible ${isOpen?'open':''}`} inert={!isOpen}><div className="collapsible-inner">
   <p className="admin-hint">{c.hint}</p>
   <ul className="monitor-rows">{c.rows.slice(0,50).map((r,i)=><li key={i}><span className="monitor-who">{player(r.player_id,r.player)}{r.other_id&&<> ↔ {player(r.other_id,r.other)}</>}</span><span>{r.detail}</span></li>)}</ul>
   {c.count>50&&<p className="admin-hint">… et {c.count-50} autres.</p>}
  </div></div>
 </section>;};
 return <div className="admin-monitor">
  <div className="monitor-toolbar">
   <div className="stats-filter" role="radiogroup" aria-label="Période des comportements">{[1,7,30].map(d=><button key={d} role="radio" aria-checked={days===d} className={days===d?'on':''} onClick={()=>setDays(d)}>{d===1?'24 h':`${d} jours`}</button>)}</div>
   <button className="primary ghost compact" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/> {busy?'Analyse…':'Relancer'}</button>
   <span className="admin-hint">Analyse du {new Date(report.generated_at).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
  </div>
  <div className={`panel monitor-summary ${critical.length?'critical':warnings.length?'warning':'ok'}`}>
   {critical.length?<ShieldAlert size={22}/>:warnings.length?<AlertTriangle size={22}/>:<CheckCircle2 size={22}/>}
   <div><strong>{critical.length?`${critical.length} incohérence${critical.length>1?'s':''} à corriger`:warnings.length?`${warnings.length} piste${warnings.length>1?'s':''} à examiner`:'Rien de suspect'}</strong>
    <span className="admin-hint">Les incohérences ne devraient jamais arriver. Les pistes sont des comportements inhabituels : vérifiez la fiche du joueur avant toute sanction.</span></div>
  </div>
  {critical.map(block)}{warnings.map(block)}
  {clean.length>0&&<details className="chart-table"><summary>Contrôles sans résultat ({clean.length})</summary><ul className="monitor-clean">{clean.map(c=><li key={c.code}><CheckCircle2 size={13}/> {c.title}</li>)}</ul></details>}
 </div>;
}
