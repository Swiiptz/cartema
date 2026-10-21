'use client';
import {useCallback,useEffect,useState} from 'react';
import {Check,ImagePlus,Layers,Replace,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {TarotCard} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {callRpc,silhouetteIndex,type ArtMeta} from '@/lib/game';
import {uploadIllustration,type AdminCatalog} from '@/lib/admin';
import type {Rarity} from '@/lib/draw';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;
type Submission={credit_name:string|null;art_credit:string|null;id:string;kind:'info'|'illustration'|'credit';status:'pending'|'accepted'|'rejected';message:string;image_path:string|null;created_at:string;decided_at:string|null;admin_note:string|null;
 reward_deniers:number;reward_boosters:number;author:string|null;character_id:string;name:string;number:number;prefix:string;rarity:Rarity;role_title:string;clan:string|null;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
type Art={credit:string|null;id:string;kind:'legacy'|'alternate';label:string;art_path:string;art_meta:ArtMeta;active:boolean;owned:number};
const FRAMES:Record<string,string>={fullart:'Plein cadre (full art)',cover:'Remplir la fenêtre',portrait:'Portrait',full:'Image entière, centrée'};
const when=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const layout=(m:ArtMeta|null|undefined)=>m?.layout==='full'||m?.layout==='cover'||m?.layout==='fullart'?m.layout:undefined;

/** Image d'un bucket privé, servie par une adresse signée temporaire. */
function useSigned(client:SupabaseClient,path:string|null){
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{if(!path)return;let alive=true;void client.storage.from('submissions').createSignedUrl(path,3600).then(({data})=>{if(alive)setUrl(data?.signedUrl??null);});return()=>{alive=false;};},[client,path]);
 return url;
}

/** Propositions des joueurs : corrections d'informations et illustrations. */
export function ContributionsTab({client,act,reason,catalog}:{client:SupabaseClient;act:Act;reason:Reason;catalog:AdminCatalog}){
 const [status,setStatus]=useState<'pending'|'all'>('pending');
 const [list,setList]=useState<Submission[]|null>(null);
 const load=useCallback(async()=>{setList(await callRpc<Submission[]>(client,'admin_submissions',{p_status:status}).catch(()=>[]));},[client,status]);
 useEffect(()=>{setList(null);void load();},[load]);
 return <div className="admin-reports">
  <div className="stats-filter" role="radiogroup" aria-label="Propositions affichées">{([['pending','En attente'],['all','Toutes']] as const).map(([v,l])=><button key={v} role="radio" aria-checked={status===v} className={status===v?'on':''} onClick={()=>setStatus(v)}>{l}</button>)}</div>
  {!list?<Skeleton style={{height:200}}/>:list.length===0?<p className="muted">{status==='pending'?'Aucune proposition en attente.':'Aucune proposition.'}</p>
   :<ul className="report-list">{list.map(s=><SubmissionItem key={s.id} s={s} client={client} act={act} reason={reason} catalog={catalog} onDone={load}/>)}</ul>}
 </div>;
}

function SubmissionItem({s,client,act,reason,catalog,onDone}:{s:Submission;client:SupabaseClient;act:Act;reason:Reason;catalog:AdminCatalog;onDone:()=>void}){
 const image=useSigned(client,s.image_path);
 // Une illustration acceptée pour une carte qui n'en avait pas rapporte 1 booster ; le reste est au choix.
 const [deniers,setDeniers]=useState('0');
 const [boosters,setBoosters]=useState(s.kind==='illustration'&&!s.art_path?'1':'0');
 const [busy,setBusy]=useState(false);
 const code=`${s.prefix}-${String(s.number).padStart(3,'0')}`;
 const card={id:code,name:s.name,clan:s.clan??'?',role:s.role_title,rarity:s.rarity,known:true,illustration:s.art_path??undefined,silhouette:silhouetteIndex(s.silhouette_key),artLayout:layout(s.art_meta),artOffsetY:Number(s.art_meta?.offsetY)||undefined};
 async function imageFile(){
  const blob=await (await fetch(image!)).blob();
  return new File([blob],s.image_path!.split('/').pop()!,{type:blob.type||'image/png'});
 }
 async function decide(accept:boolean,apply?:'official'|'alternate'|'credit'){
  const note=await reason(accept?`Accepter la proposition de ${s.author} pour ${s.name}${apply==='official'?' et remplacer l’illustration officielle':apply==='alternate'?' et l’ajouter en version alternative':apply==='credit'?` et créditer « ${s.credit_name} »`:''} ? Récompense : ${Number(deniers)||0} Deniers, ${Number(boosters)||0} booster(s). Note pour le joueur :`:`Refuser la proposition de ${s.author} : raison (envoyée au joueur) ?`,accept?'Accepter':'Refuser');
  if(note===null)return;
  setBusy(true);
  const ok=await act(accept?'Proposition acceptée.':'Proposition refusée.',async c=>{
   if(accept&&apply==='credit')await callRpc(c,'admin_set_art_credit',{p_character_id:s.character_id,p_art_id:null,p_credit:s.credit_name,p_reason:note});
   else if(accept&&apply){
    const ch=catalog.characters.find(x=>x.id===s.character_id);
    if(!ch)throw new Error('Personnage introuvable dans le catalogue.');
    const {path,meta}=await uploadIllustration(c,await imageFile(),{prefix:s.prefix,number:s.number});
    if(apply==='official')await callRpc(c,'admin_save_character',{p_id:ch.id,p_edition_id:ch.edition_id,p_number:ch.number,p_name:ch.name,p_role_title:ch.role_title,p_clan_id:ch.clan_id,p_rarity:ch.rarity,p_art_path:path,p_art_meta:meta});
    else await callRpc(c,'admin_add_card_art',{p_character_id:ch.id,p_art_path:path,p_art_meta:meta,p_label:`Version de ${s.author??'joueur'}`,p_reason:note});
   }
   await callRpc(c,'admin_decide_submission',{p_id:s.id,p_accept:accept,p_reward_deniers:Number(deniers)||0,p_reward_boosters:Number(boosters)||0,p_note:note});
  });
  setBusy(false);
  if(ok)onDone();
 }
 return <li className={`panel report-item contribution ${s.status}`}>
  <div className="report-head"><span className="status-chip">{s.kind==='illustration'?(s.art_path?'Autre illustration':'Nouvelle illustration'):s.kind==='credit'?'Demande de crédit':'Information erronée'}</span><strong>{code} · {s.name}</strong><small>{when(s.created_at)} · par {s.author??'—'}</small></div>
  <div className="contribution-body">
   <div className="contribution-card"><span className="admin-hint">Actuelle</span><TarotCard card={card}/></div>
   {s.kind==='illustration'&&<div className="contribution-card"><span className="admin-hint">Proposée</span>{image?<a href={image} target="_blank" rel="noreferrer"><img src={image} alt={`Illustration proposée pour ${s.name}`}/></a>:<Skeleton className="skeleton-card"/>}
    {image&&<TarotCard card={{...card,illustration:image,artLayout:undefined,artOffsetY:undefined}}/>}</div>}
   <div className="contribution-text">{s.message?<p className="report-message">{s.message}</p>:<p className="muted">Sans message.</p>}
    {s.kind==='info'&&<p className="admin-hint">Corrigez la fiche dans l’onglet Personnages, puis acceptez.</p>}
    {s.kind==='credit'&&<p className="credit-ask">Nom demandé : <strong>{s.credit_name}</strong>{s.art_credit?` · crédit actuel : ${s.art_credit}`:' · aucun crédit actuellement'}</p>}</div>
  </div>
  {s.status==='pending'?<>
   <div className="admin-row give-row"><label className="auth-field"><span>Deniers</span><input inputMode="numeric" value={deniers} onChange={e=>setDeniers(e.target.value.replace(/\D/g,''))}/></label>
    <label className="auth-field"><span>Boosters</span><input inputMode="numeric" value={boosters} onChange={e=>setBoosters(e.target.value.replace(/\D/g,''))}/></label></div>
   <div className="admin-actions">
    {s.kind==='illustration'&&<><button className="primary compact" disabled={busy||!image} onClick={()=>void decide(true,'official')}><Replace size={14}/> {s.art_path?'Remplacer l’officielle':'Appliquer'}</button>
     <button className="primary ghost compact" disabled={busy||!image} onClick={()=>void decide(true,'alternate')}><Layers size={14}/> Version alternative</button></>}
    {s.kind==='credit'&&<button className="primary compact" disabled={busy} onClick={()=>void decide(true,'credit')}><Check size={14}/> Créditer et accepter</button>}
    <button className="primary ghost compact" disabled={busy} onClick={()=>void decide(true)}><Check size={14}/> Accepter{s.kind==='illustration'?' sans appliquer':s.kind==='credit'?' sans créditer':''}</button>
    <button className="primary ghost compact danger" disabled={busy} onClick={()=>void decide(false)}><X size={14}/> Refuser</button>
   </div>
   {s.kind==='illustration'&&s.art_path&&<p className="admin-hint">Remplacer l’officielle : les exemplaires déjà possédés gardent l’ancienne illustration (version d’origine).</p>}
  </>:<p className="admin-hint">{s.status==='accepted'?'Acceptée':'Refusée'} le {when(s.decided_at!)}{s.admin_note?` · ${s.admin_note}`:''}{s.status==='accepted'&&(s.reward_deniers||s.reward_boosters)?` · +${s.reward_deniers} Deniers, +${s.reward_boosters} booster(s)`:''}</p>}
 </li>;
}

/** Versions d'illustration d'un personnage : anciennes officielles et versions alternatives tirables. */
export function CardArtsPanel({client,act,reason,characterId,prefix,number,officialCredit}:{client:SupabaseClient;act:Act;reason:Reason;characterId:string;prefix:string;number:number;officialCredit?:string|null}){
 const [arts,setArts]=useState<Art[]|null>(null);
 const [file,setFile]=useState<File|null>(null);
 const [label,setLabel]=useState('');
 const [credit,setCredit]=useState('');
 const [official,setOfficial]=useState<string|null>(null);
 const [frame,setFrame]=useState<'auto'|'fullart'|'cover'|'portrait'>('fullart');
 const load=useCallback(async()=>{setArts(await callRpc<Art[]>(client,'admin_card_arts',{p_character_id:characterId}).catch(()=>[]));},[client,characterId]);
 useEffect(()=>{void load();},[load]);
 async function add(){
  if(!file)return;const r=await reason(`Ajouter « ${label||'Version alternative'} » : elle pourra tomber rarement à la place de l’illustration officielle.`,'Ajouter');if(r===null)return;
  if(await act('Version alternative ajoutée.',async c=>{const {path,meta}=await uploadIllustration(c,file,{prefix,number});await callRpc(c,'admin_add_card_art',{p_character_id:characterId,p_art_path:path,p_art_meta:frame==='auto'?meta:{...meta,layout:frame},p_label:label,p_reason:r,p_credit:credit||null});})){setFile(null);setLabel('');setCredit('');void load();}
 }
 async function saveCredit(artId:string|null,value:string){
  const r=await reason(value?`Créditer « ${value} » ?`:'Retirer le crédit ?','Enregistrer');if(r===null)return;
  if(await act('Crédit enregistré.',c=>callRpc(c,'admin_set_art_credit',{p_character_id:characterId,p_art_id:artId,p_credit:value,p_reason:r}))){setOfficial(null);void load();}
 }
 async function setLayout(a:Art,layout:string){
  const r=await reason(`Cadrage de « ${a.label} » : ${FRAMES[layout]}.`,'Appliquer');if(r===null)return;
  if(await act('Cadrage mis à jour.',c=>callRpc(c,'admin_set_card_art_meta',{p_id:a.id,p_meta:{layout},p_reason:r})))void load();
 }
 async function toggle(a:Art){
  const r=await reason(a.active?`Ne plus faire tomber « ${a.label} » (les exemplaires existants la gardent) ?`:`Faire de nouveau tomber « ${a.label} » ?`,a.active?'Désactiver':'Activer');if(r===null)return;
  if(await act(a.active?'Version désactivée.':'Version réactivée.',c=>callRpc(c,'admin_set_card_art_active',{p_id:a.id,p_active:!a.active,p_reason:r})))void load();
 }
 return <fieldset className="admin-art card-arts"><legend>Versions d’illustration</legend>
  <div className="admin-row give-row"><label className="auth-field"><span>Crédit de l’illustration officielle</span><input value={official??officialCredit??''} onChange={e=>setOfficial(e.target.value)} placeholder="Nom de l’artiste"/></label>
   <button type="button" className="primary ghost compact" disabled={official===null} onClick={()=>void saveCredit(null,(official??'').trim())}>Enregistrer</button></div>
  <p className="admin-hint">Les versions alternatives tombent avec la chance réglée dans Économie (« 1 sur N » par carte tirée). Les anciennes illustrations officielles restent sur les exemplaires déjà possédés.</p>
  {!arts?<Skeleton style={{height:60}}/>:arts.length===0?<p className="admin-hint">Aucune version pour l’instant.</p>
   :<ul className="arts-list">{arts.map(a=><li key={a.id} className={a.active||a.kind==='legacy'?'':'off'}><img src={a.art_path.startsWith('/')?`${process.env.NEXT_PUBLIC_BASE_PATH??''}${a.art_path}`:a.art_path} alt=""/>
    <span><strong>{a.label}</strong><small>{a.kind==='legacy'?'ancienne officielle':a.active?'tirable':'désactivée'} · {a.owned} exemplaire{a.owned>1?'s':''}{a.credit?` · par ${a.credit}`:''}</small></span>
    <span className="art-actions"><select aria-label={`Cadrage de ${a.label}`} value={a.art_meta?.layout??'portrait'} onChange={e=>void setLayout(a,e.target.value)}>{Object.entries(FRAMES).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
    {a.kind==='alternate'&&<button type="button" className="text-link" onClick={()=>void toggle(a)}>{a.active?'Désactiver':'Activer'}</button>}</span></li>)}</ul>}
  <div className="admin-row give-row"><label className="feedback-file"><ImagePlus size={15}/><span>{file?file.name:'Image de la version'}</span><input type="file" accept="image/png,image/webp,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
   <label className="auth-field"><span>Nom de la version</span><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Version Paint"/></label>
   <label className="auth-field"><span>Cadrage</span><select value={frame} onChange={e=>setFrame(e.target.value as typeof frame)}><option value="fullart">Plein cadre (full art)</option><option value="cover">Remplir la fenêtre</option><option value="portrait">Portrait</option><option value="auto">Automatique</option></select></label>
   <label className="auth-field"><span>Crédit (facultatif)</span><input value={credit} onChange={e=>setCredit(e.target.value)} maxLength={80}/></label>
   <button type="button" className="primary compact" disabled={!file} onClick={()=>void add()}>Ajouter</button></div>
 </fieldset>;
}
