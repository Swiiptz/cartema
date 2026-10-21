'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Plus,Save,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import {callRpc,EVENT_METRICS} from '@/lib/game';
import type {AdminCharacter} from '@/lib/admin';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
type MissionRow={id?:string;label:string;metric:string;target:string;reward_deniers:string;reward_boosters:string;claims?:number};
type Content={missions:{id:string;label:string;metric:string;target:number;reward_deniers:number;reward_boosters:number;claims:number}[];card_ids:string[];
 community:{metric:string|null;target:number|null;reward_deniers:number;reward_boosters:number};leaderboard:{metric:string|null;rewards:{deniers?:number;boosters?:number}[]};started:boolean;settled:boolean};
const METRIC_OPTIONS=Object.entries(EVENT_METRICS);
const digits=(v:string)=>v.replace(/\D/g,'');

/** Contenu d'un événement : missions, cartes publiées au début, défi communautaire, classement. */
export function EventContent({client,act,reason,eventId,characters}:{client:SupabaseClient;act:Act;reason:Reason;eventId:string;characters:AdminCharacter[]}){
 const [data,setData]=useState<Content|null>(null);
 const [missions,setMissions]=useState<MissionRow[]>([]);
 const [cards,setCards]=useState<string[]>([]);
 const [query,setQuery]=useState('');
 const [community,setCommunity]=useState({metric:'',target:'',deniers:'0',boosters:'0'});
 const [board,setBoard]=useState({metric:'',r:[{d:'0',b:'0'},{d:'0',b:'0'},{d:'0',b:'0'}]});
 const load=useCallback(async()=>{
  const c=await callRpc<Content>(client,'admin_event_content',{p_event_id:eventId});
  setData(c);
  setMissions(c.missions.map(m=>({id:m.id,label:m.label,metric:m.metric,target:String(m.target),reward_deniers:String(m.reward_deniers),reward_boosters:String(m.reward_boosters),claims:m.claims})));
  setCards(c.card_ids);
  setCommunity({metric:c.community.metric??'',target:c.community.target?String(c.community.target):'',deniers:String(c.community.reward_deniers),boosters:String(c.community.reward_boosters)});
  setBoard({metric:c.leaderboard.metric??'',r:[0,1,2].map(i=>({d:String(c.leaderboard.rewards[i]?.deniers??0),b:String(c.leaderboard.rewards[i]?.boosters??0)}))});
 },[client,eventId]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 const drafts=useMemo(()=>{const q=query.trim().toLowerCase();if(q.length<2)return [];return characters.filter(c=>c.status==='draft'&&!c.is_unique&&!cards.includes(c.id)&&(c.name.toLowerCase().includes(q)||String(c.number)===q)).slice(0,8);},[query,characters,cards]);
 const name=(id:string)=>{const c=characters.find(x=>x.id===id);return c?`${c.number}. ${c.name} · ${c.rarity}`:id;};
 if(!data)return <Skeleton style={{height:120}}/>;
 const setM=(i:number,k:keyof MissionRow,v:string)=>setMissions(ms=>ms.map((m,j)=>j!==i?m:{...m,[k]:v}));
 const valid=missions.every(m=>m.label.trim()&&Number(m.target)>0)&&(!community.metric||Number(community.target)>0);
 async function save(){
  const r=await reason('Enregistrer le contenu de l’événement ?','Enregistrer');if(r===null)return;
  const rewards=board.r.map(x=>({deniers:Number(x.d)||0,boosters:Number(x.b)||0}));
  while(rewards.length&&!rewards[rewards.length-1].deniers&&!rewards[rewards.length-1].boosters)rewards.pop();
  if(await act('Contenu de l’événement enregistré.',c=>callRpc(c,'admin_save_event_content',{p_event_id:eventId,
   p_missions:missions.map(m=>({id:m.id??null,label:m.label,metric:m.metric,target:Number(m.target),reward_deniers:Number(m.reward_deniers)||0,reward_boosters:Number(m.reward_boosters)||0})),
   p_card_ids:data!.started?[]:cards,
   p_community:community.metric?{metric:community.metric,target:Number(community.target),reward_deniers:Number(community.deniers)||0,reward_boosters:Number(community.boosters)||0}:{},
   p_leaderboard:board.metric?{metric:board.metric,rewards}:{},p_reason:r})))void load();
 }
 if(data.settled)return <p className="admin-hint">Événement clôturé : récompenses versées, contenu figé.</p>;
 return <div className="event-content">
  <h3 className="eco-sub">Missions de l’événement</h3>
  {missions.map((m,i)=><div key={m.id??`n${i}`} className="event-mission-row">
   <input aria-label="Libellé" value={m.label} onChange={e=>setM(i,'label',e.target.value)} placeholder="Ouvrir 10 boosters"/>
   <select aria-label="Mesure" value={m.metric} onChange={e=>setM(i,'metric',e.target.value)}>{METRIC_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
   <input aria-label="Objectif" inputMode="numeric" value={m.target} onChange={e=>setM(i,'target',digits(e.target.value))} placeholder="Objectif"/>
   <input aria-label="Deniers" inputMode="numeric" value={m.reward_deniers} onChange={e=>setM(i,'reward_deniers',digits(e.target.value))} placeholder="Deniers"/>
   <input aria-label="Boosters" inputMode="numeric" value={m.reward_boosters} onChange={e=>setM(i,'reward_boosters',digits(e.target.value))} placeholder="Boosters"/>
   {m.claims?<span className="admin-hint">{m.claims} réclamée{m.claims>1?'s':''}</span>:<button type="button" className="icon-button" aria-label="Retirer la mission" onClick={()=>setMissions(ms=>ms.filter((_,j)=>j!==i))}><X size={14}/></button>}
  </div>)}
  <button type="button" className="text-link" onClick={()=>setMissions(ms=>[...ms,{label:'',metric:'open_boosters',target:'5',reward_deniers:'100',reward_boosters:'0'}])}><Plus size={13}/> Ajouter une mission</button>
  <p className="admin-hint">Les colonnes : libellé · mesure · objectif · Deniers · boosters. Comptées pendant l’événement, réclamables jusqu’à 48 h après.</p>

  <h3 className="eco-sub">Cartes de l’événement</h3>
  {data.started?<p className="admin-hint">{cards.length?cards.map(name).join(' · '):'Aucune carte.'} — liste figée depuis le début de l’événement.</p>:<>
   <div className="chip-row">{cards.map(id=><button type="button" key={id} className="chip" onClick={()=>setCards(cards.filter(x=>x!==id))}>{name(id)} <X size={12}/></button>)}{!cards.length&&<span className="muted">Aucune carte.</span>}</div>
   <input className="picker-search" placeholder="Ajouter un personnage en brouillon (nom ou numéro)…" value={query} onChange={e=>setQuery(e.target.value)}/>
   {drafts.length>0&&<ul className="friend-pick">{drafts.map(c=><li key={c.id}><button type="button" onClick={()=>{setCards([...cards,c.id]);setQuery('');}}>{name(c.id)}</button></li>)}</ul>}
   <p className="admin-hint">Ces brouillons seront publiés automatiquement à l’heure de début, puis resteront dans l’édition.</p></>}

  <h3 className="eco-sub">Défi communautaire</h3>
  <div className="eco-grid">
   <label className="auth-field"><span>Mesure</span><select value={community.metric} onChange={e=>setCommunity({...community,metric:e.target.value})}><option value="">Aucun défi</option>{METRIC_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   {community.metric&&<><label className="auth-field"><span>Objectif commun</span><input inputMode="numeric" value={community.target} onChange={e=>setCommunity({...community,target:digits(e.target.value)})}/></label>
    <label className="auth-field"><span>Deniers par participant</span><input inputMode="numeric" value={community.deniers} onChange={e=>setCommunity({...community,deniers:digits(e.target.value)})}/></label>
    <label className="auth-field"><span>Boosters par participant</span><input inputMode="numeric" value={community.boosters} onChange={e=>setCommunity({...community,boosters:digits(e.target.value)})}/></label></>}
  </div>

  <h3 className="eco-sub">Classement</h3>
  <div className="eco-grid">
   <label className="auth-field"><span>Mesure</span><select value={board.metric} onChange={e=>setBoard({...board,metric:e.target.value})}><option value="">Pas de classement</option>{METRIC_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   {board.metric&&board.r.map((x,i)=><label key={i} className="auth-field"><span>{['1re','2e','3e'][i]} place · Deniers / boosters</span><div className="podium-inputs"><input inputMode="numeric" value={x.d} onChange={e=>setBoard({...board,r:board.r.map((y,j)=>j!==i?y:{...y,d:digits(e.target.value)})})}/><input inputMode="numeric" value={x.b} onChange={e=>setBoard({...board,r:board.r.map((y,j)=>j!==i?y:{...y,b:digits(e.target.value)})})}/></div></label>)}
  </div>
  <div className="admin-actions"><button type="button" className="primary compact" disabled={!valid} onClick={()=>void save()}><Save size={14}/> Enregistrer le contenu</button></div>
 </div>;
}
