'use client';
import {useCallback,useEffect,useState} from 'react';
import {Clock,Coins,Gift,Hourglass,Sparkles} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Countdown} from './ui';
import {callRpc,type GameEvent} from '@/lib/game';

/** Effets d'un événement en phrases courtes. */
export function eventEffects(e:Pick<GameEvent,'finish_multiplier'|'deniers_multiplier'|'bonus_boosters'|'free_interval_hours'>){
 const out:{icon:typeof Sparkles;text:string}[]=[];
 if(e.finish_multiplier>1)out.push({icon:Sparkles,text:`Finitions Dorée et Sanglante ×${String(e.finish_multiplier).replace('.',',')}`});
 if(e.deniers_multiplier>1)out.push({icon:Coins,text:`Deniers ×${String(e.deniers_multiplier).replace('.',',')} (connexion et missions)`});
 if(e.free_interval_hours)out.push({icon:Hourglass,text:`Un booster gratuit toutes les ${e.free_interval_hours} h`});
 if(e.bonus_boosters>0)out.push({icon:Gift,text:`${e.bonus_boosters} booster${e.bonus_boosters>1?'s':''} offert${e.bonus_boosters>1?'s':''}`});
 return out;
}

/** Bannière des événements en cours et à venir (14 jours), avec le cadeau à récupérer. */
export function EventBanner({compact=false}:{compact?:boolean}){
 const {client,player,refreshPlayer}=useAuth();
 const [events,setEvents]=useState<GameEvent[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<string|null>(null);
 const load=useCallback(()=>{if(client&&player)void callRpc<GameEvent[]>(client,'get_events').then(setEvents).catch(()=>{});},[client,player]);
 useEffect(()=>{load();},[load]);
 async function claim(e:GameEvent){
  if(!client)return;
  setBusy(true);
  try{const n=await callRpc<number>(client,'claim_event_bonus',{p_event_id:e.id});setNotice(`+${n} booster${n>1?'s':''} ajouté${n>1?'s':''} à votre réserve.`);load();void refreshPlayer();}
  catch(err){setNotice((err as Error).message);}finally{setBusy(false);}
 }
 const shown=compact?events.filter(e=>e.active):events;
 if(!shown.length)return null;
 return <div className={`event-banners ${compact?'compact':''}`}>{shown.map((e,i)=><section key={e.id} className={`event-banner rise ${e.active?'live':'soon'}`} style={{'--i':i} as React.CSSProperties}>
  <div className="event-head"><span className="eyebrow"><span className="event-dot" aria-hidden="true"/>{e.active?'Événement en cours':'Bientôt'}</span>
   <span className="event-time"><Clock size={12}/> {e.active?<>se termine dans <Countdown to={e.ends_at} onDone={load}/></>:<>commence dans <Countdown to={e.starts_at} onDone={load}/></>}</span></div>
  <h2>{e.name}</h2>
  {e.description&&!compact&&<p className="event-desc">{e.description}</p>}
  <ul className="event-effects">{eventEffects(e).map(({icon:I,text})=><li key={text}><I size={13}/> {text}</li>)}</ul>
  {e.active&&e.bonus_boosters>0&&(e.claimed?<p className="event-claimed">Cadeau récupéré.</p>
   :<button className="primary compact" disabled={busy} onClick={()=>void claim(e)}><Gift size={14}/> Récupérer {e.bonus_boosters} booster{e.bonus_boosters>1?'s':''}</button>)}
  {notice&&i===0&&<p className="event-claimed" role="status">{notice}</p>}
 </section>)}</div>;
}
