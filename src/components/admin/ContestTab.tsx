'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Check,Crown,Eye,EyeOff,Flag,Gift,Layers,Plus,Replace,Save,ScrollText,Trash2,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Skeleton} from '@/components/ui';
import type {AskOptions} from '@/components/AskDialog';
import {callRpc,type ContestPlace,type ContestRank,type ContestRewards} from '@/lib/game';
import {uploadIllustration,type AdminCatalog} from '@/lib/admin';
import {contestImageUrl} from '@/lib/paths';
import {defaultContestRulesText} from '@/lib/contest';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
type Ask=(o:AskOptions)=>Promise<string|null>;
type AdminContest={id:string;title:string;edition_id:string;starts_at:string;ends_at:string;rewards:ContestRewards;rewarded_at:string|null;rules:string|null;open:boolean;entries:number;reports:number;allow_mythic?:boolean};
type Entry={entry_id:string;character_id:string;code:string;name:string;rarity:string;prefix:string;number:number;author:string;image_path:string;created_at:string;votes:number;leading:boolean;hidden:boolean;hidden_reason:string|null;reports:string[];selected:'main'|'alternate'|null;line_label:string|null;real_drawing:boolean;granted:boolean};

const DEFAULT_REWARDS:ContestRewards={places:[{from:1,to:1,deniers:3000,boosters:10},{from:2,to:2,deniers:2000,boosters:6},{from:3,to:3,deniers:1500,boosters:4},{from:4,to:10,deniers:500,boosters:2}],others:{deniers:200,boosters:1}};
/** Date ISO → valeur d'un champ datetime-local (heure de l'appareil). */
const toLocal=(iso:string)=>{const d=new Date(iso);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);};
const when=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/** Concours d'illustrations : dates et barème, revue des dessins, validation, distribution. */
export function ContestTab({client,act,reason,ask,catalog}:{client:SupabaseClient;act:Act;reason:Reason;ask:Ask;catalog:AdminCatalog}){
 const [contests,setContests]=useState<AdminContest[]|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [editing,setEditing]=useState<AdminContest|'new'|null>(null);
 const load=useCallback(async()=>{const c=await callRpc<AdminContest[]>(client,'admin_contests').catch(()=>[]);setContests(c);setSelected(s=>s??c[0]?.id??null);},[client]);
 useEffect(()=>{void load();},[load]);
 const current=contests?.find(c=>c.id===selected);
 if(!contests)return <Skeleton style={{height:200}}/>;
 return <div className="contest-admin">
  <div className="contest-toolbar">
   <select aria-label="Concours" value={selected??''} onChange={e=>setSelected(e.target.value||null)}>{contests.length===0&&<option value="">Aucun concours</option>}{contests.map(c=><option key={c.id} value={c.id}>{c.title} · {when(c.starts_at)}</option>)}</select>
   <button className="primary ghost compact" onClick={()=>setEditing('new')}><Plus size={14}/> Nouveau concours</button>
   {current&&!current.rewarded_at&&!editing&&<button className="primary ghost compact" onClick={()=>setEditing(current)}>Modifier le concours</button>}
  </div>
  {editing&&<ContestForm key={editing==='new'?'new':editing.id} contest={editing==='new'?null:editing} catalog={catalog} act={act} reason={reason} onDone={id=>{setEditing(null);if(id)setSelected(id);void load();}}/>}
  {current&&<ContestReview key={current.id} contest={current} client={client} act={act} reason={reason} ask={ask} onChanged={load}/>}
 </div>;
}

function ContestForm({contest,catalog,act,reason,onDone}:{contest:AdminContest|null;catalog:AdminCatalog;act:Act;reason:Reason;onDone:(id?:string)=>void}){
 const editions=catalog.editions.filter(e=>!e.archived_at&&!e.eternal);
 const [title,setTitle]=useState(contest?.title??'Concours d’illustrations');
 const [edition,setEdition]=useState(contest?.edition_id??editions.find(e=>e.packs_enabled)?.id??editions[0]?.id??'');
 const [start,setStart]=useState(contest?toLocal(contest.starts_at):toLocal(new Date().toISOString()));
 const [end,setEnd]=useState(contest?toLocal(contest.ends_at):toLocal(new Date(Date.now()+3*86400e3).toISOString()));
 const [places,setPlaces]=useState<ContestPlace[]>(contest?.rewards.places??DEFAULT_REWARDS.places);
 const [others,setOthers]=useState(contest?.rewards.others??DEFAULT_REWARDS.others);
 const [rules,setRules]=useState(contest?.rules??'');
 // Mythiques admises par défaut pour un nouveau concours (décision du 25/10).
 const [allowMythic,setAllowMythic]=useState(contest?!!contest.allow_mythic:true);
 const num=(v:string)=>Math.max(0,Number(v.replace(/\D/g,''))||0);
 const setPlace=(i:number,k:keyof ContestPlace,v:string)=>setPlaces(p=>p.map((x,j)=>j===i?{...x,[k]:num(v)}:x));
 const editionName=editions.find(e=>e.id===edition)?.name??'';
 const badDates=!!start&&!!end&&new Date(end)<=new Date(start);
 const bad=!title.trim()||!edition||!start||!end||badDates||places.some(p=>p.from<1||p.to<p.from)||rules.length>8000;
 async function save(){
  const r=await reason(`${contest?'Modifier':'Créer'} « ${title} » : du ${when(new Date(start).toISOString())} au ${when(new Date(end).toISOString())}.`);
  if(r===null)return;
  let id:string|undefined;
  if(await act(contest?'Concours mis à jour.':'Concours créé.',async c=>{id=await callRpc<string>(c,'admin_save_contest',{p_id:contest?.id??null,p_title:title,p_edition_id:edition,p_starts_at:new Date(start).toISOString(),p_ends_at:new Date(end).toISOString(),p_rewards:{places,others},p_reason:r,p_rules:rules,p_allow_mythic:allowMythic});}))onDone(id);
 }
 return <section className="panel contest-form">
  <header className="contest-form-head"><span className="eyebrow">{contest?'Modifier le concours':'Nouveau concours'}</span><button className="icon-button" aria-label="Fermer" onClick={()=>onDone()}><X size={16}/></button></header>
  <fieldset className="contest-fieldset">
   <legend>Informations</legend>
   <div className="contest-info-grid">
    <label className="auth-field contest-wide"><span>Titre</span><input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="auth-field contest-wide"><span>Édition</span><select value={edition} onChange={e=>setEdition(e.target.value)}>{editions.map(e=><option key={e.id} value={e.id}>{e.name} ({e.prefix})</option>)}</select></label>
    <label className="auth-field"><span>Début</span><input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label className="auth-field"><span>Fin</span><input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
   </div>
   <label className="contest-check"><input type="checkbox" checked={allowMythic} onChange={e=>setAllowMythic(e.target.checked)}/> <span>Mythiques admises <small>(points ×3, le dessin doit faire mythique ; jamais la carte unique ; un dessin retenu offre la carte en Standard)</small></span></label>
   {badDates&&<p className="contest-error">La fin doit venir après le début.</p>}
  </fieldset>
  <fieldset className="contest-fieldset">
   <legend>Barème par place</legend>
   <div className="contest-rewards">
    <div className="contest-rewards-row head"><span>Places</span><span>Deniers</span><span>Boosters</span><span/></div>
    {places.map((p,i)=><div key={i} className="contest-rewards-row">
     <span className="contest-range"><input aria-label="De la place" inputMode="numeric" value={p.from} onChange={e=>setPlace(i,'from',e.target.value)}/><i>à</i><input aria-label="À la place" inputMode="numeric" value={p.to} onChange={e=>setPlace(i,'to',e.target.value)}/></span>
     <input aria-label="Deniers" inputMode="numeric" value={p.deniers} onChange={e=>setPlace(i,'deniers',e.target.value)}/>
     <input aria-label="Boosters" inputMode="numeric" value={p.boosters} onChange={e=>setPlace(i,'boosters',e.target.value)}/>
     <button className="icon-button" aria-label="Retirer cette ligne" onClick={()=>setPlaces(x=>x.filter((_,j)=>j!==i))}><Trash2 size={14}/></button>
    </div>)}
    <div className="contest-rewards-row others">
     <span className="contest-range-label">Au-delà, avec au moins 1 point</span>
     <input aria-label="Deniers au-delà" inputMode="numeric" value={others.deniers} onChange={e=>setOthers(o=>({...o,deniers:num(e.target.value)}))}/>
     <input aria-label="Boosters au-delà" inputMode="numeric" value={others.boosters} onChange={e=>setOthers(o=>({...o,boosters:num(e.target.value)}))}/>
     <span/>
    </div>
   </div>
   <button className="text-link" onClick={()=>{const last=places[places.length-1];setPlaces(x=>[...x,{from:(last?.to??0)+1,to:(last?.to??0)+1,deniers:100,boosters:0}]);}}><Plus size={13}/> Ajouter une ligne</button>
   <p className="admin-hint">Le titre « Illustrateur de génie » est donné aux 3 premières places à la distribution.</p>
  </fieldset>
  <fieldset className="contest-fieldset">
   <legend>Règles</legend>
   <p className="admin-hint">Affichées dans l’onglet Règles du concours, entre les dates et les récompenses (calculées à part). Une ligne qui commence par « - » devient une règle, et « Titre. » en tête est mis en valeur. Vide : règles par défaut du site.</p>
   <textarea className="contest-rules-input" rows={10} value={rules} maxLength={8000} placeholder={'- Thème. Les vampires au clair de lune.\n- Format. Dessin vertical, sans texte.'} onChange={e=>setRules(e.target.value)}/>
   <div className="contest-rules-tools"><button className="text-link" onClick={()=>setRules(defaultContestRulesText(editionName,allowMythic))}><ScrollText size={13}/> Partir des règles par défaut</button>{rules&&<button className="text-link" onClick={()=>setRules('')}>Vider</button>}<small>{rules.length.toLocaleString('fr-FR')} / 8 000</small></div>
  </fieldset>
  <div className="admin-actions"><button className="primary" disabled={bad} onClick={()=>void save()}><Save size={15}/> Enregistrer</button><button className="text-link" onClick={()=>onDone()}>Annuler</button></div>
 </section>;
}

function ContestReview({contest,client,act,reason,ask,onChanged}:{contest:AdminContest;client:SupabaseClient;act:Act;reason:Reason;ask:Ask;onChanged:()=>void}){
 const [entries,setEntries]=useState<Entry[]|null>(null);
 const [ranking,setRanking]=useState<ContestRank[]|null>(null);
 const [filter,setFilter]=useState<'all'|'reported'|'leading'|'hidden'|'selected'>('all');
 const [busy,setBusy]=useState<string|null>(null);
 const closed=new Date(contest.ends_at)<=new Date();
 const load=useCallback(async()=>{
  const [e,r]=await Promise.all([callRpc<Entry[]>(client,'admin_contest_entries',{p_contest_id:contest.id}).catch(()=>[]),callRpc<ContestRank[]>(client,'get_contest_leaderboard').catch(()=>[])]);
  setEntries(e);setRanking(r);
 },[client,contest.id]);
 useEffect(()=>{void load();},[load]);
 const shown=useMemo(()=>(entries??[]).filter(e=>filter==='all'||(filter==='reported'&&e.reports.length>0&&!e.hidden)||(filter==='leading'&&e.leading)||(filter==='hidden'&&e.hidden)||(filter==='selected'&&!!e.selected)),[entries,filter]);
 const byCard=useMemo(()=>{const m=new Map<string,Entry[]>();for(const e of shown){const k=e.character_id;m.set(k,[...(m.get(k)??[]),e]);}return [...m.values()];},[shown]);
 const done=async(ok:boolean)=>{setBusy(null);if(ok){await load();onChanged();}};
 async function hide(e:Entry){
  const r=await reason(e.hidden?`Réafficher le dessin de ${e.author} pour ${e.name} ?`:`Masquer le dessin de ${e.author} pour ${e.name} ? Il perd ses ${e.votes} vote(s).`);
  if(r===null)return;setBusy(e.entry_id);
  await done(await act(e.hidden?'Dessin réaffiché.':'Dessin masqué.',c=>callRpc(c,'admin_hide_contest_entry',{p_entry_id:e.entry_id,p_hidden:!e.hidden,p_reason:r})));
 }
 async function real(e:Entry){
  const r=await reason(`${e.real_drawing?'Retirer':'Donner'} le point « vrai dessin » à ${e.author} pour ${e.name} ?`);
  if(r===null)return;setBusy(e.entry_id);
  await done(await act('Décision enregistrée.',c=>callRpc(c,'admin_decide_contest_entry',{p_entry_id:e.entry_id,p_selected:null,p_line_label:null,p_real_drawing:!e.real_drawing,p_art_path:null,p_art_meta:null,p_reason:r})));
 }
 async function select(e:Entry,mode:'main'|'alternate'){
  let label:string|null=null;
  if(mode==='alternate'){label=await ask({title:'Nom de la ligne de versions',message:`Les versions de même nom forment une ligne (chance de tirage réglable dans Économie).`,inputLabel:'Nom de la version',confirmLabel:'Continuer'});if(label===null)return;}
  const finish=['Commun','Peu commun','Rare','Très rare'].includes(e.rarity)?'Sanglante':e.rarity==='Épique'?'Dorée':'Standard';
  const r=await reason(`${mode==='main'?`Faire du dessin de ${e.author} l’illustration officielle de ${e.name} (les exemplaires déjà possédés gardent l’ancienne)`:`Ajouter le dessin de ${e.author} en version « ${label} » de ${e.name}`}. ${e.author} reçoit la carte en ${finish} et 1 point.`);
  if(r===null)return;setBusy(e.entry_id);
  await done(await act('Dessin retenu : carte offerte à son auteur.',async c=>{
   const url=contestImageUrl(e.image_path);if(!url)throw new Error('Image introuvable.');
   const blob=await (await fetch(url)).blob();
   const file=new File([blob],`${e.code}-concours.webp`,{type:blob.type||'image/webp'});
   const {path,meta}=await uploadIllustration(c,file,{prefix:e.prefix,number:e.number});
   await callRpc(c,'admin_decide_contest_entry',{p_entry_id:e.entry_id,p_selected:mode,p_line_label:label,p_real_drawing:e.real_drawing,p_art_path:path,p_art_meta:{...meta,layout:mode==='alternate'?'fullart':meta.layout},p_reason:r});
  }));
 }
 async function distribute(){
  const r=await reason(`Distribuer les récompenses de « ${contest.title} » à ${ranking?.length??0} joueur(s) ? C’est définitif (une seule fois).`,'Distribuer');
  if(r===null)return;setBusy('reward');
  await done(await act('Récompenses distribuées.',c=>callRpc(c,'admin_reward_contest',{p_contest_id:contest.id,p_reason:r})));
 }
 return <>
  <section className="panel admin-edition contest-summary">
   <div className="section-header"><div><span className="eyebrow">{contest.open?'Ouvert':closed?(contest.rewarded_at?'Terminé · récompenses distribuées':'Terminé · à valider'):'À venir'} · {when(contest.starts_at)} → {when(contest.ends_at)}</span><h2>{contest.title}</h2></div></div>
   <p className="admin-hint">{contest.entries} dessin{contest.entries>1?'s':''} · {contest.reports} signalement{contest.reports>1?'s':''} en attente.{closed?' Retenez les dessins (principale ou alternative), cochez les vrais dessins, puis distribuez.':' La validation s’ouvre après la clôture ; vous pouvez déjà masquer un dessin.'}</p>
   <div className="stats-filter" role="radiogroup" aria-label="Dessins affichés">{([['all','Tous'],['reported','Signalés'],['leading','En tête'],['selected','Retenus'],['hidden','Masqués']] as const).map(([v,l])=><button key={v} role="radio" aria-checked={filter===v} className={filter===v?'on':''} onClick={()=>setFilter(v)}>{l}</button>)}</div>
  </section>
  {!entries?<Skeleton style={{height:200}}/>:byCard.length===0?<p className="muted">Aucun dessin.</p>:byCard.map(list=><section key={list[0].character_id} className="panel admin-edition">
   <div className="section-header"><div><span className="eyebrow">{list[0].code} · {list[0].rarity}</span><h2>{list[0].name}</h2></div></div>
   <ul className="contest-entries">{list.map(e=><li key={e.entry_id} className={`${e.leading?'leading':''} ${e.hidden?'off':''}`}>
    <a className="contest-entry-img" href={contestImageUrl(e.image_path)} target="_blank" rel="noreferrer"><img src={contestImageUrl(e.image_path)} alt={`Dessin de ${e.author}`} loading="lazy"/></a>
    <div className="contest-entry-info">
     <span className="contest-entry-author">{e.leading&&<Crown size={13}/>} {e.author}{e.selected&&<small className="selected-pill"><Check size={11}/> {e.selected==='main'?'officielle':e.line_label??'alternative'}</small>}</span>
     <span className="contest-entry-votes">{e.votes} vote{e.votes>1?'s':''}{e.hidden?` · masqué${e.hidden_reason?` (${e.hidden_reason})`:''}`:''}</span>
     {e.reports.length>0&&<span className="contest-reports"><Flag size={11}/> {e.reports.join(' · ')}</span>}
     <span className="contest-entry-actions">
      <button className="text-link" disabled={!!busy} onClick={()=>void hide(e)}>{e.hidden?<><Eye size={12}/> Réafficher</>:<><EyeOff size={12}/> Masquer</>}</button>
      {closed&&!e.hidden&&<label className="admin-check"><input type="checkbox" checked={e.real_drawing} disabled={!!busy} onChange={()=>void real(e)}/> Vrai dessin</label>}
     </span>
     {closed&&!e.hidden&&!e.selected&&<span className="contest-entry-actions">
      <button className="primary compact" disabled={!!busy} onClick={()=>void select(e,'main')}><Replace size={13}/> Officielle</button>
      <button className="primary ghost compact" disabled={!!busy} onClick={()=>void select(e,'alternate')}><Layers size={13}/> Alternative</button>
     </span>}
    </div>
   </li>)}</ul>
  </section>)}
  {closed&&<section className="panel admin-edition">
   <div className="section-header"><div><span className="eyebrow">Classement final</span><h2>Récompenses</h2></div></div>
   {!ranking?<Skeleton style={{height:120}}/>:ranking.length===0?<p className="muted">Personne n’a de point.</p>
   :<ol className="ranking">{ranking.map(r=><li key={r.handle} className={`top-${r.position}`}><span className="rank-pos">{r.position<=3?<Crown size={16}/>:r.position}</span><span className="person-name">{r.handle}<small className="rank-title">{r.leads} en tête · {r.selected} retenu(s) · {r.real} vrai(s) dessin(s)</small></span><span className="rank-scores"><strong className="rank-score">{r.points}<small> pts</small></strong></span></li>)}</ol>}
   <p className="admin-hint">Le classement affiché est celui du concours en cours ou terminé depuis moins de 14 jours. Le 1er crée sa carte éternelle : ajoutez-la dans l’édition ETER (onglet Personnages) puis donnez-la-lui depuis sa fiche joueur.</p>
   <div className="admin-actions"><button className="primary" disabled={!!busy||!!contest.rewarded_at||!ranking?.length} onClick={()=>void distribute()}><Gift size={15}/> {contest.rewarded_at?'Récompenses distribuées':'Distribuer les récompenses'}</button></div>
  </section>}
 </>;
}
