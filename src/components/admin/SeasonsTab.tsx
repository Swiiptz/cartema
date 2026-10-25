'use client';
import {useCallback,useEffect,useState} from 'react';
import {Flag,Gift,Play} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import {callRpc,type ContestRewards} from '@/lib/game';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
type Season={id:string;name:string;starts_at:string;ends_at:string|null;rewards:ContestRewards;rewarded_at:string|null;players:number};
const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
const fr=(n:number)=>n.toLocaleString('fr-FR');

/** Saisons du classement : une par set. Sans saison démarrée, le classement de saison reste invisible des joueurs. */
export function SeasonsTab({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [seasons,setSeasons]=useState<Season[]|null>(null);
 const [name,setName]=useState('');
 const load=useCallback(async()=>{setSeasons(await callRpc<Season[]>(client,'admin_seasons').catch(()=>[]));},[client]);
 useEffect(()=>{void load();},[load]);
 const open=seasons?.find(s=>!s.ends_at);
 async function start(){
  const r=await reason(`Démarrer la saison « ${name.trim()} » ? Le classement de saison devient visible des joueurs et compte les points à partir de maintenant.`,'Démarrer');
  if(r===null)return;
  if(await act('Saison démarrée.',c=>callRpc(c,'admin_start_season',{p_name:name.trim(),p_rewards:null,p_reason:r}))){setName('');await load();}
 }
 async function end(s:Season){
  const r=await reason(`Clore la saison « ${s.name} » ? Les points sont figés ; tu pourras ensuite distribuer les récompenses.`,'Clore');
  if(r!==null&&await act('Saison close.',c=>callRpc(c,'admin_end_season',{p_id:s.id,p_reason:r})))await load();
 }
 async function reward(s:Season){
  const r=await reason(`Distribuer les récompenses de « ${s.name} » à ${s.players} joueur(s) ? C’est définitif (une seule fois).`,'Distribuer');
  if(r!==null&&await act('Récompenses de la saison distribuées.',c=>callRpc(c,'admin_reward_season',{p_id:s.id,p_reason:r})))await load();
 }
 if(!seasons)return <Skeleton style={{height:200}}/>;
 return <div className="admin-reports">
  <section className="panel admin-edition">
   <span className="eyebrow">Classement de saison</span>
   <p className="admin-hint">Une saison dure le temps d’un set. Points : +1 par visage découvert, +10 par succès (+5 par palier au-delà du premier), +2 par mission quotidienne et +5 par hebdomadaire réclamées pendant la saison. Podium : titre « Champion de la saison », Deniers et boosters selon la place.</p>
   {open?<p className="admin-hint">Saison en cours : « {open.name} », depuis le {day(open.starts_at)}.</p>
    :<form className="admin-row" onSubmit={e=>{e.preventDefault();if(name.trim().length>=2)void start();}}>
     <label className="auth-field"><span>Nom de la saison</span><input value={name} maxLength={80} placeholder="Set 2 · Anarchs" onChange={e=>setName(e.target.value)}/></label>
     <button className="primary" disabled={name.trim().length<2}><Play size={15}/> Démarrer la saison</button>
    </form>}
  </section>
  {seasons.length===0?<p className="muted">Aucune saison pour l’instant : le classement de saison est invisible des joueurs.</p>
   :<ul className="report-list">{seasons.map(s=><li key={s.id} className="panel report-item">
    <div className="report-head"><span className="status-chip">{!s.ends_at?'En cours':s.rewarded_at?'Distribuée':'Close · à distribuer'}</span><strong>{s.name}</strong><small>du {day(s.starts_at)}{s.ends_at?` au ${day(s.ends_at)}`:''} · {s.players} joueur{s.players>1?'s':''} classé{s.players>1?'s':''}</small></div>
    <p className="admin-hint">Barème : {s.rewards.places.map(p=>`${p.from===p.to?`${p.from}${p.from===1?'er':'e'}`:`${p.from}e à ${p.to}e`} : ${fr(p.deniers)} Deniers et ${p.boosters} booster${p.boosters>1?'s':''}`).join(' · ')} · au-delà : {fr(s.rewards.others.deniers)} Deniers.</p>
    <div className="admin-actions">
     {!s.ends_at&&<button className="primary ghost compact" onClick={()=>void end(s)}><Flag size={14}/> Clore la saison</button>}
     {s.ends_at&&!s.rewarded_at&&<button className="primary compact" onClick={()=>void reward(s)}><Gift size={14}/> Distribuer les récompenses</button>}
    </div>
   </li>)}</ul>}
 </div>;
}
