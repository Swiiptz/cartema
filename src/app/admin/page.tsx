'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Archive,BookPlus,Check,FolderOpen,Images,ImagePlus,PackageOpen,Plus,Save,ShieldAlert,Upload,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {useAuth} from '@/components/AuthProvider';
import {useAsk,type AskOptions} from '@/components/AskDialog';
import {Skeleton} from '@/components/ui';
import {eventEffects} from '@/components/EventBanner';
import {StatsTab} from '@/components/admin/StatsTab';
import {EconomyTab} from '@/components/admin/EconomyTab';
import {PlayerCards,ReportsTab} from '@/components/admin/ModerationTabs';
import {CardArtsPanel,ContributionsTab} from '@/components/admin/ContributionsTab';
import {IdeasTab} from '@/components/admin/IdeasTab';
import {EventContent} from '@/components/admin/EventContent';
import {MonitorTab} from '@/components/admin/MonitorTab';
import {EditionShop} from '@/components/admin/EditionShop';
import {ContestTab} from '@/components/admin/ContestTab';
import {TarotCard,palette,type DemoCard} from '@/components/Card';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc,silhouetteIndex} from '@/lib/game';
import {ACCEPTED_TYPES,ENGRAVED_CLANS,matchIllustrations,nextNumber,uploadIllustration,type AdminCatalog,type AdminCharacter,type AdminEdition,type CharacterStatus,type IllustrationMeta} from '@/lib/admin';

type Tab='characters'|'editions'|'clans'|'achievements'|'players'|'events'|'stats'|'economy'|'reports'|'contributions'|'contest'|'monitor'|'ideas';
const STATUS_LABEL:Record<CharacterStatus,string>={draft:'Brouillon',published:'Publiée',archived:'Archivée'};
// jsonb ne conserve pas l'ordre des clés : comparaison indépendante de l'ordre.
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
// Boîte de dialogue intégrée : window.prompt est bloqué dans certains navigateurs intégrés.
const AskContext=createContext<(o:AskOptions)=>Promise<string|null>>(async()=>null);
function useReason(){
 const ask=useContext(AskContext);
 return (message:string,confirmLabel='Valider')=>ask({title:'Motif requis',message,inputLabel:'Motif (inscrit au journal)',confirmLabel});
}

export default function Admin(){
 const {configured,ready,session,client,player}=useAuth();
 const [catalog,setCatalog]=useState<AdminCatalog|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [tab,setTab]=useState<Tab>('characters');
 // Joueur à ouvrir directement dans l'onglet Joueurs (depuis la surveillance).
 const [focusPlayer,setFocusPlayer]=useState<string|null>(null);
 const isAdmin=player?.profile.role==='admin';
 const [ask,askNode]=useAsk();

 const load=useCallback(async()=>{
  if(!client)return;
  try{setCatalog(await callRpc<AdminCatalog>(client,'admin_catalog'));setError(null);}
  catch(e){setError((e as Error).message);}
 },[client]);
 useEffect(()=>{if(isAdmin)void load();},[isAdmin,load]);

 /** Exécute une action admin, recharge le catalogue et affiche le résultat. */
 // Les messages s'effacent seuls après quelques secondes (les erreurs restent jusqu'à fermeture).
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),5000);return()=>clearTimeout(t);},[notice]);
 const act=useCallback(async(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>{
  if(!client)return false;
  setError(null);setNotice(null);
  try{await action(client);await load();setNotice(label);return true;}
  catch(e){setError((e as Error).message);return false;}
 },[client,load]);

 if(!configured)return <Gate title="Back-office indisponible" text="Le site n’est pas relié à son serveur."/>;
 if(!ready||(session&&!player))return <div className="page"><p className="muted" aria-live="polite">Chargement…</p></div>;
 if(!session)return <Gate title="Accès protégé" text="Connectez-vous avec le compte administrateur." link/>;
 if(!isAdmin)return <Gate title="Accès réservé" text="Ce compte n’a pas les droits d’administration."/>;

 return <AskContext.Provider value={ask}><div className="page admin-page">{askNode}
  <header className="admin-heading"><div><span className="eyebrow">Back-office</span><h1>Le cabinet de l’archiviste</h1></div><p className="muted">Chaque modification est enregistrée dans le journal d’administration.</p></header>
  <nav className="admin-tabs" aria-label="Sections du back-office">{([['characters','Personnages'],['editions','Éditions'],['clans','Clans'],['achievements','Succès'],['events','Événements'],['economy','Économie'],['players','Joueurs'],['contributions','Contributions'],['ideas','Doléances'],['contest','Concours'],['reports','Signalements'],['monitor','Surveillance'],['stats','Statistiques']] as const).map(([k,l])=><button key={k} className={tab===k?'on':''} aria-pressed={tab===k} onClick={()=>setTab(k)}>{l}</button>)}</nav>
  <div className="admin-toast" aria-live="polite">{error&&<p className="auth-error" role="alert">{error}<button className="icon-button" aria-label="Fermer" onClick={()=>setError(null)}><X size={16}/></button></p>}{notice&&<p className="auth-notice">{notice}<button className="icon-button" aria-label="Fermer" onClick={()=>setNotice(null)}><X size={16}/></button></p>}</div>
  <div key={tab} className="tab-panel">{!catalog?<div className="admin-card-list">{Array.from({length:6},(_,i)=><Skeleton key={i} style={{height:84}}/>)}</div>:tab==='characters'?<CharactersTab catalog={catalog} act={act} client={client!} onError={setError}/>:tab==='editions'?<EditionsTab catalog={catalog} act={act}/>:tab==='clans'?<ClansTab catalog={catalog} act={act}/>:tab==='achievements'?<AchievementsTab catalog={catalog} act={act} client={client!}/>:tab==='events'?<EventsTab act={act} client={client!} characters={catalog.characters}/>:tab==='stats'?<StatsTab client={client!}/>:tab==='economy'?<EconomyHost act={act} client={client!}/>:tab==='reports'?<ReportsHost act={act} client={client!}/>:tab==='monitor'?<MonitorTab client={client!} onOpenPlayer={id=>{setFocusPlayer(id);setTab('players');}}/>:tab==='contributions'?<ContributionsHost act={act} client={client!} catalog={catalog}/>:tab==='contest'?<ContestHost act={act} client={client!} catalog={catalog}/>:tab==='ideas'?<IdeasHost act={act} client={client!}/>:<PlayersTab act={act} client={client!} characters={catalog.characters} focus={focusPlayer}/>}</div>
 </div></AskContext.Provider>;
}

function Gate({title,text,link=false}:{title:string;text:string;link?:boolean}){
 return <div className="page auth-page"><section className="panel auth-panel"><span className="eyebrow"><ShieldAlert size={13}/> Administration</span><h1>{title}</h1><p className="muted">{text}</p>{link?<Link className="primary" href="/connexion/">Se connecter</Link>:<Link className="primary ghost" href="/">Retour au cabinet</Link>}</section></div>;
}

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;

// ------------------------------------------------------------------ personnages
type Draft={unique?:boolean;id:string|null;edition_id:string;number:number;name:string;role_title:string;clan_id:string|null;rarity:Rarity;art_path:string|null;art_meta:IllustrationMeta;status:CharacterStatus;silhouette_key:string|null};
const emptyDraft=(catalog:AdminCatalog,editionId:string):Draft=>({id:null,edition_id:editionId,number:nextNumber(catalog.characters,editionId),name:'',role_title:'',clan_id:null,rarity:'Commun',art_path:null,art_meta:{},status:'draft',silhouette_key:null});
const toDraft=(c:AdminCharacter):Draft=>({unique:!!c.is_unique,id:c.id,edition_id:c.edition_id,number:c.number,name:c.name,role_title:c.role_title,clan_id:c.clan_id,rarity:c.rarity,art_path:c.art_path,art_meta:c.art_meta??{},status:c.status,silhouette_key:c.silhouette_key});

function previewCard(d:Draft,catalog:AdminCatalog,finish='Standard'):DemoCard{
 const prefix=catalog.editions.find(e=>e.id===d.edition_id)?.prefix??'???';
 const clan=catalog.clans.find(c=>c.id===d.clan_id)?.name??'?';
 return {id:`${prefix}-${String(d.number).padStart(3,'0')}`,name:d.name||'Sans nom',clan,role:d.role_title,rarity:d.rarity,known:true,finish,
  unique:d.unique,illustration:d.art_path??undefined,artLayout:d.art_meta.layout,artOffsetY:d.art_meta.offsetY,silhouette:silhouetteIndex(d.silhouette_key)};
}

function CharactersTab({catalog,act,client,onError}:{catalog:AdminCatalog;act:Act;client:SupabaseClient;onError:(m:string)=>void}){
 // 'active' : toutes les éditions non archivées (vue par défaut).
 const [editionId,setEditionId]=useState('active');
 const lastActive=[...catalog.editions].reverse().find(e=>!e.archived_at)?.id??catalog.editions[0]?.id??'';
 const archived=useMemo(()=>new Set(catalog.editions.filter(e=>e.archived_at).map(e=>e.id)),[catalog]);
 const prefixOf=useMemo(()=>new Map(catalog.editions.map(e=>[e.id,e.prefix])),[catalog]);
 const inScope=useCallback((c:AdminCharacter)=>editionId==='active'?!archived.has(c.edition_id):c.edition_id===editionId,[editionId,archived]);
 const [status,setStatus]=useState<CharacterStatus|'all'>('all');
 const [rarity,setRarity]=useState<Rarity|'all'>('all');
 const [clanId,setClanId]=useState<string>('all');
 const [art,setArt]=useState<'all'|'missing'|'present'>('all');
 const [query,setQuery]=useState('');
 const [draft,setDraft]=useState<Draft|null>(null);
 const [bulk,setBulk]=useState(false);
 const list=useMemo(()=>{const q=query.trim().toLowerCase();return catalog.characters.filter(c=>inScope(c)&&(status==='all'||c.status===status)
  &&(rarity==='all'||c.rarity===rarity)&&(clanId==='all'||(clanId==='none'?!c.clan_id:c.clan_id===clanId))
  &&(art==='all'||(art==='missing'?!c.art_path:!!c.art_path))&&(!q||c.name.toLowerCase().includes(q)||String(c.number)===q));},[catalog,inScope,status,rarity,clanId,art,query]);
 const inEdition=catalog.characters.filter(inScope);
 const missingArt=inEdition.filter(c=>!c.art_path&&c.status!=='archived').length;
 const filtered=status!=='all'||rarity!=='all'||clanId!=='all'||art!=='all'||!!query.trim();
 // Après rechargement du catalogue, l'éditeur reprend la version enregistrée.
 useEffect(()=>{setDraft(d=>{if(!d?.id)return d;const fresh=catalog.characters.find(c=>c.id===d.id);return fresh?toDraft(fresh):null;});},[catalog]);

 if(!catalog.editions.length)return <div className="panel admin-empty"><BookPlus size={26}/><h2>Aucune édition</h2><p className="muted">Créez d’abord une édition dans l’onglet « Éditions ».</p></div>;
 const edition=catalog.editions.find(e=>e.id===editionId);
 return <div className="admin-characters">
  <div className="admin-toolbar">
   <label><span>Édition</span><select value={editionId} onChange={e=>{setEditionId(e.target.value);setDraft(null);}}><option value="active">Toutes les éditions non archivées</option>{catalog.editions.map(e=><option key={e.id} value={e.id}>{e.name} ({e.prefix}){e.archived_at?' · archivée':''}</option>)}</select></label>
   <label><span>État</span><select value={status} onChange={e=>setStatus(e.target.value as CharacterStatus|'all')}><option value="all">Tous</option><option value="draft">Brouillons</option><option value="published">Publiées</option><option value="archived">Archivées</option></select></label>
   <label><span>Rareté</span><select value={rarity} onChange={e=>setRarity(e.target.value as Rarity|'all')}><option value="all">Toutes</option>{ALL_RARITIES.map(r=><option key={r} value={r}>{r}</option>)}</select></label>
   <label><span>Clan</span><select value={clanId} onChange={e=>setClanId(e.target.value)}><option value="all">Tous</option><option value="none">Sans clan</option>{[...catalog.clans].sort((a,b)=>a.name.localeCompare(b.name,'fr')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label><span>Illustration</span><select value={art} onChange={e=>setArt(e.target.value as 'all'|'missing'|'present')}><option value="all">Toutes</option><option value="missing">Sans illustration ({missingArt})</option><option value="present">Avec illustration</option></select></label>
   <label className="admin-search"><span>Recherche</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nom ou numéro"/></label>
   <button className="primary ghost" disabled={!edition||!!edition.archived_at} title={!edition?'Choisissez une édition':undefined} onClick={()=>{setBulk(!bulk);setDraft(null);}}><Images size={16}/> Associer des illustrations</button>
   <button className="primary" disabled={!!edition?.archived_at} onClick={()=>{setBulk(false);setDraft(emptyDraft(catalog,edition?.id??lastActive));}}><Plus size={16}/> Nouveau personnage</button>
  </div>
  {bulk&&edition&&<BulkIllustrations key={editionId} prefix={edition.prefix} characters={catalog.characters.filter(c=>c.edition_id===editionId)} act={act} client={client} onClose={()=>setBulk(false)}/>}
  <p className="admin-hint admin-count">{list.length} personnage{list.length>1?'s':''}{filtered?` sur ${inEdition.length}`:''}{filtered&&<button className="text-link" onClick={()=>{setStatus('all');setRarity('all');setClanId('all');setArt('all');setQuery('');}}>Effacer les filtres</button>}</p>
  <div className={`admin-split ${draft?'editing':''}`}>
   <ul className="admin-card-list" aria-label="Personnages de l’édition">
    {list.map(c=><li key={c.id}><button className={draft?.id===c.id?'on':''} onClick={()=>setDraft(toDraft(c))}><span className="admin-card-thumb"><TarotCard card={previewCard(toDraft(c),catalog)}/></span><span className="admin-card-meta"><strong>{editionId==='active'?`${prefixOf.get(c.edition_id)}-${String(c.number).padStart(3,'0')}`:c.number}. {c.name}</strong><span style={{color:c.is_unique?'#f3ecdf':palette[c.rarity]}}>{c.is_unique?'Carte unique':c.rarity}</span><span className={`status-chip ${c.status}`}>{STATUS_LABEL[c.status]}</span></span></button></li>)}
    {!list.length&&<li className="muted admin-list-empty">Aucun personnage pour ce filtre.</li>}
   </ul>
   {draft&&<CharacterEditor key={draft.id??'new'} draft={draft} setDraft={setDraft} catalog={catalog} act={act} client={client} onError={onError}/>}
  </div>
 </div>;
}

function CharacterEditor({draft,setDraft,catalog,act,client,onError}:{draft:Draft;setDraft:(d:Draft|null)=>void;catalog:AdminCatalog;act:Act;client:SupabaseClient;onError:(m:string)=>void}){
 const [busy,setBusy]=useState(false);
 const [finish,setFinish]=useState('Standard');
 const askReason=useReason();
 const creating=!draft.id;
 // Illustration générée par IA : la carte devient « à privilégier » aux concours (points multipliés).
 const artAi=!!catalog.characters.find(c=>c.id===draft.id)?.art_ai;
 async function setArtAi(value:boolean){
  const r=await askReason(value?`Marquer l’illustration de ${draft.name} comme générée par IA : la carte sera « à privilégier » aux concours (points ×2).`:`Retirer la mention IA de ${draft.name}.`);
  if(r===null)return;setBusy(true);
  await act(value?'Illustration marquée IA.':'Mention IA retirée.',c=>callRpc(c,'admin_set_art_ai',{p_character_id:draft.id,p_ai:value,p_reason:r}));
  setBusy(false);
 }
 const set=<K extends keyof Draft>(k:K,v:Draft[K])=>setDraft({...draft,[k]:v});
 const setMeta=(m:Partial<IllustrationMeta>)=>setDraft({...draft,art_meta:{...draft.art_meta,...m}});

 async function upload(file:File|undefined){
  if(!file)return;
  setBusy(true);
  try{const prefix=catalog.editions.find(e=>e.id===draft.edition_id)?.prefix??'SANS';const {path,meta}=await uploadIllustration(client,file,{prefix,number:draft.number});setDraft({...draft,art_path:path,art_meta:meta});}
  catch(e){onError((e as Error).message);}
  finally{setBusy(false);}
 }
 async function save(){
  setBusy(true);
  let id:string|null=draft.id;
  const ok=await act(creating?'Personnage créé en brouillon.':'Modifications enregistrées.',async c=>{
   id=await callRpc<string>(c,'admin_save_character',{p_id:draft.id,p_edition_id:draft.edition_id,p_number:draft.number,p_name:draft.name,p_role_title:draft.role_title,p_clan_id:draft.clan_id,p_rarity:draft.rarity,p_art_path:draft.art_path,p_art_meta:draft.art_meta});
  });
  if(ok&&creating&&id)setDraft({...draft,id});
  setBusy(false);
 }
 async function changeStatus(next:CharacterStatus,question:string,label:string){
  if(!draft.id)return;
  const reason=await askReason(question);if(!reason)return;
  setBusy(true);
  await act(label,c=>callRpc(c,'admin_set_character_status',{p_id:draft.id,p_status:next,p_reason:reason}));
  setBusy(false);
 }
 const dirty=(()=>{const saved=catalog.characters.find(c=>c.id===draft.id);return !saved||canonical(toDraft(saved))!==canonical(draft);})();

 return <section className="panel admin-editor" aria-label={creating?'Nouveau personnage':`Modifier ${draft.name}`}>
  <div className="section-header"><div><span className="eyebrow">{creating?'Nouveau personnage':STATUS_LABEL[draft.status]}</span><h2>{draft.name||'Sans nom'}</h2></div><button className="icon-button" aria-label="Fermer l’éditeur" onClick={()=>setDraft(null)}><X size={18}/></button></div>
  <div className="admin-editor-body">
   <div className="admin-preview">
    <TarotCard key={`${finish}-${draft.art_path}-${draft.art_meta.layout}-${draft.art_meta.offsetY}`} card={previewCard(draft,catalog,finish)}/>
    <div className="finish-switch" aria-label="Aperçu de finition">{['Standard','Dorée','Sanglante'].map(f=><button key={f} className={finish===f?'active':''} aria-pressed={finish===f} onClick={()=>setFinish(f)}>{f}</button>)}</div>
   </div>
   <div className="admin-form">
    <div className="admin-row">
     <label className="auth-field"><span>Numéro</span><input type="number" min={1} value={draft.number} disabled={!creating} onChange={e=>set('number',Number(e.target.value))}/></label>
     <label className="auth-field"><span>Rareté</span><select value={draft.rarity} disabled={!creating} onChange={e=>set('rarity',e.target.value as Rarity)}>{ALL_RARITIES.map(r=><option key={r}>{r}</option>)}</select></label>
    </div>
    {creating&&<p className="admin-hint">Numéro et rareté sont définitifs après création.</p>}
    <label className="auth-field"><span>Nom</span><input value={draft.name} maxLength={60} onChange={e=>set('name',e.target.value)} required/></label>
    <label className="auth-field"><span>Titre / fonction</span><input value={draft.role_title} maxLength={60} onChange={e=>set('role_title',e.target.value)}/></label>
    <label className="auth-field"><span>Clan</span><select value={draft.clan_id??''} onChange={e=>set('clan_id',e.target.value||null)}><option value="">Clan inconnu (médaillon mystérieux)</option>{catalog.clans.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset className="admin-art">
     <legend>Illustration</legend>
     <label className="primary ghost admin-upload"><Upload size={16}/> {draft.art_path?'Remplacer l’illustration':'Ajouter une illustration'}<input type="file" accept={ACCEPTED_TYPES.join(',')} disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>
     {draft.art_meta.width&&<p className="admin-hint">{draft.art_meta.width} × {draft.art_meta.height} px · {draft.art_meta.transparent?'détourée':'fond opaque'} · original conservé</p>}
     {draft.art_path&&<>
      <label className="auth-field"><span>Cadrage</span><select value={draft.art_meta.layout??'portrait'} onChange={e=>setMeta({layout:e.target.value as IllustrationMeta['layout']})}><option value="portrait">Portrait (image entière, en haut)</option><option value="cover">Remplir la fenêtre</option><option value="full">Image entière, centrée</option><option value="fullart">Plein cadre (full art)</option></select></label>
      {draft.art_meta.layout==='cover'&&<label className="auth-field"><span>Décalage vertical : {draft.art_meta.offsetY??0}</span><input type="range" min={-40} max={40} value={draft.art_meta.offsetY??0} onChange={e=>setMeta({offsetY:Number(e.target.value)})}/></label>}
      <button className="text-link" onClick={()=>setDraft({...draft,art_path:null,art_meta:{}})}><X size={14}/> Retirer (silhouette)</button>
      {!creating&&<label className="admin-check ai-check"><input type="checkbox" checked={artAi} disabled={busy||dirty} onChange={e=>void setArtAi(e.target.checked)}/> Illustration générée par IA <small>carte « à privilégier » aux concours ; décochée d’office quand l’illustration change</small></label>}
     </>}
     {!draft.art_path&&<p className="admin-hint"><ImagePlus size={13}/> Sans illustration, la silhouette attribuée au personnage est utilisée.</p>}
    </fieldset>
    {!creating&&draft.id&&!draft.unique&&<CardArtsPanel client={client} act={act} reason={askReason} characterId={draft.id} prefix={catalog.editions.find(e=>e.id===draft.edition_id)?.prefix??'CAM'} number={draft.number} officialCredit={catalog.characters.find(c=>c.id===draft.id)?.art_credit} base={previewCard(draft,catalog)}/>}
    <div className="admin-actions">
     <button className="primary" disabled={busy||!draft.name.trim()||!dirty} onClick={()=>void save()}><Save size={16}/> {creating?'Créer le brouillon':'Enregistrer'}</button>
     {!creating&&draft.status!=='published'&&<button className="primary ghost" disabled={busy||dirty} onClick={()=>void changeStatus('published','Publier cette carte : elle apparaîtra dans l’album (si l’album de l’édition est publié).','Carte publiée : elle apparaît dans l’album.')}><Check size={16}/> Publier</button>}
     {!creating&&draft.status==='published'&&<button className="primary ghost" disabled={busy} onClick={()=>void changeStatus('archived','Archiver cette carte : elle ne sera plus tirée, les exemplaires possédés restent.','Carte archivée.')}><Archive size={16}/> Archiver</button>}
    </div>
    {!creating&&dirty&&<p className="admin-hint">Enregistrez avant de publier.</p>}
   </div>
  </div>
 </section>;
}

// ------------------------------------------------------------------ association groupée
type BulkRow={file:File;candidates:AdminCharacter[];target:string;state:'pending'|'done'|'error'|'skipped';message?:string};

function BulkIllustrations({prefix,characters,act,client,onClose}:{prefix:string;characters:AdminCharacter[];act:Act;client:SupabaseClient;onClose:()=>void}){
 const [rows,setRows]=useState<BulkRow[]>([]);
 const [replace,setReplace]=useState(false);
 const [running,setRunning]=useState(false);
 const byId=useMemo(()=>new Map(characters.map(c=>[c.id,c])),[characters]);
 function pick(list:FileList|null){
  if(!list)return;
  const matched=matchIllustrations([...list],characters);
  setRows(matched.map(m=>({file:m.file,candidates:m.candidates,target:m.candidates.length===1?m.candidates[0].id:'',state:'pending'})));
 }
 const update=(i:number,patch:Partial<BulkRow>)=>setRows(r=>r.map((x,k)=>k===i?{...x,...patch}:x));
 const ready=rows.filter(r=>r.state==='pending'&&r.target&&(replace||!byId.get(r.target)?.art_path));
 async function run(){
  setRunning(true);
  await act(`Illustrations associées.`,async c=>{
   for(const [i,r] of rows.entries()){
    if(!ready.includes(r))continue;
    const ch=byId.get(r.target)!;
    try{
     const {path,meta}=await uploadIllustration(c,r.file,{prefix,number:ch.number});
     await callRpc(c,'admin_save_character',{p_id:ch.id,p_edition_id:ch.edition_id,p_number:ch.number,p_name:ch.name,p_role_title:ch.role_title,p_clan_id:ch.clan_id,p_rarity:ch.rarity,p_art_path:path,p_art_meta:meta});
     update(i,{state:'done'});
    }catch(e){update(i,{state:'error',message:(e as Error).message});}
   }
  });
  setRunning(false);
 }
 const unmatched=rows.filter(r=>!r.candidates.length).length;
 return <section className="panel admin-bulk" aria-label="Associer des illustrations">
  <div className="section-header"><div><span className="eyebrow">Illustrations en lot</span><h2>Associer par nom de fichier</h2></div><button className="icon-button" aria-label="Fermer" onClick={onClose}><X size={18}/></button></div>
  <p className="admin-hint">Le nom du fichier doit être celui de la carte (« Clément de Saint-Simon.png ») ou son prénom s’il est unique (« Norton.webp »). Accents, majuscules et tirets ne comptent pas. Les originaux sont conservés, rangés dans le dossier {prefix}/ de l’édition.</p>
  <div className="admin-actions">
   <label className="primary ghost admin-upload"><FolderOpen size={16}/> Choisir un dossier<input type="file" multiple {...{webkitdirectory:''}} onChange={e=>{pick(e.target.files);e.target.value='';}}/></label>
   <label className="primary ghost admin-upload"><ImagePlus size={16}/> Choisir des images<input type="file" multiple accept={ACCEPTED_TYPES.join(',')} onChange={e=>{pick(e.target.files);e.target.value='';}}/></label>
   <label className="admin-check"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/> Remplacer les illustrations déjà présentes</label>
  </div>
  {rows.length>0&&<>
   <p className="admin-hint">{rows.length} image{rows.length>1?'s':''} · {rows.filter(r=>r.target).length} associée{rows.filter(r=>r.target).length>1?'s':''}{unmatched?` · ${unmatched} sans correspondance`:''}</p>
   <ul className="admin-bulk-list">{rows.map((r,i)=>{const ch=byId.get(r.target);const has=!!ch?.art_path;return <li key={i} className={r.state}>
    <span className="admin-bulk-file">{r.file.name}</span>
    {r.candidates.length===0?<span className="muted">Aucune carte de ce nom</span>:r.candidates.length===1?<span>→ {r.candidates[0].number}. {r.candidates[0].name}</span>:<select aria-label={`Carte pour ${r.file.name}`} value={r.target} disabled={r.state!=='pending'} onChange={e=>update(i,{target:e.target.value})}><option value="">Plusieurs cartes : choisir…</option>{r.candidates.map(c=><option key={c.id} value={c.id}>{c.number}. {c.name} ({c.rarity})</option>)}</select>}
    <span className={`status-chip ${r.state==='done'?'published':r.state==='error'?'archived':''}`}>{r.state==='done'?'Associée':r.state==='error'?(r.message??'Erreur'):has&&!replace?'Déjà illustrée':r.target?'Prête':'—'}</span>
   </li>;})}</ul>
   <div className="admin-actions"><button className="primary" disabled={running||!ready.length} onClick={()=>void run()}><Upload size={16}/> {running?'Envoi en cours…':`Envoyer et associer (${ready.length})`}</button></div>
  </>}
 </section>;
}

// ------------------------------------------------------------------ éditions
function EditionsTab({catalog,act}:{catalog:AdminCatalog;act:Act}){
 const [name,setName]=useState('');
 const [prefix,setPrefix]=useState('');
 const create=(e:React.FormEvent)=>{e.preventDefault();void act('Édition créée (album non publié).',c=>callRpc(c,'admin_save_edition',{p_id:null,p_name:name,p_prefix:prefix,p_album_published:false,p_cover_path:null})).then(ok=>{if(ok){setName('');setPrefix('');}});};
 return <div className="admin-editions">
  {catalog.editions.map(e=><EditionCard key={e.id} edition={e} catalog={catalog} act={act}/>)}
  <form className="panel admin-create" onSubmit={create}>
   <span className="eyebrow">Nouvelle édition</span>
   <div className="admin-row">
    <label className="auth-field"><span>Nom</span><input value={name} onChange={e=>setName(e.target.value)} required placeholder="Camarilla"/></label>
    <label className="auth-field"><span>Préfixe (2 à 8, A-Z 0-9)</span><input value={prefix} onChange={e=>setPrefix(e.target.value.toUpperCase())} pattern="[A-Z0-9]{2,8}" required placeholder="CAM"/></label>
   </div>
   <button className="primary"><Plus size={16}/> Créer l’édition</button>
  </form>
 </div>;
}

function EditionCard({edition:e,catalog,act}:{edition:AdminEdition;catalog:AdminCatalog;act:Act}){
 const drafts=catalog.characters.filter(c=>c.edition_id===e.id&&c.status==='draft').length;
 const toggleAlbum=()=>void act(e.album_published?'Album masqué.':'Album publié.',c=>callRpc(c,'admin_save_edition',{p_id:e.id,p_name:e.name,p_prefix:e.prefix,p_album_published:!e.album_published,p_cover_path:e.cover_path}));
 const askReason=useReason();
 const togglePacks=async()=>{const reason=await askReason(e.packs_enabled?'Suspendre les boosters de cette édition.':'Activer les boosters de cette édition.');if(reason)void act(e.packs_enabled?'Boosters suspendus.':'Boosters activés.',c=>callRpc(c,'admin_set_packs',{p_edition_id:e.id,p_enabled:!e.packs_enabled,p_reason:reason}));};
 const publishDrafts=async()=>{const reason=await askReason(`Publier les ${drafts} brouillons de « ${e.name} » ? Ils apparaîtront dans l’album (si l’album est publié).`);if(reason)void act(`${drafts} carte${drafts>1?'s':''} publiée${drafts>1?'s':''}.`,c=>callRpc(c,'admin_publish_drafts',{p_edition_id:e.id,p_reason:reason}));};
 const archive=async()=>{const reason=await askReason(`Archiver « ${e.name} » ? Les boosters seront arrêtés, rien n’est supprimé.`);if(reason)void act('Édition archivée.',c=>callRpc(c,'admin_archive_edition',{p_edition_id:e.id,p_reason:reason}));};
 return <section className={`panel admin-edition ${e.archived_at?'archived':''}`}>
  <div className="section-header"><div><span className="eyebrow">{e.prefix}{e.archived_at?' · archivée':''}</span><h2>{e.name}</h2></div><span className={`status-chip ${e.packs_enabled?'published':'draft'}`}><PackageOpen size={13}/> {e.packs_enabled?'Boosters actifs':'Boosters fermés'}</span></div>
  <div className="rarity-check" aria-label="Cartes publiées par rareté">{ALL_RARITIES.map(r=>{const n=e.published_by_rarity[r]??0;return <span key={r} className={n?'ok':'missing'} style={{'--rc':palette[r]} as React.CSSProperties}>{r}<b>{n}</b></span>;})}</div>
  <p className="admin-hint">{e.complete?'Les 7 raretés ont au moins une carte publiée.':'Il manque au moins une rareté publiée : activation des boosters impossible.'}{drafts?` · ${drafts} brouillon${drafts>1?'s':''} en attente`:''}</p>
  {!e.archived_at&&<div className="admin-actions">
   {drafts>0&&<button className="primary" onClick={()=>void publishDrafts()}><Check size={16}/> Publier les {drafts} brouillons</button>}
   <button className="primary ghost" onClick={toggleAlbum}>{e.album_published?'Masquer l’album':'Publier l’album'}</button>
   <button className="primary ghost" disabled={!e.packs_enabled&&!e.complete} onClick={()=>void togglePacks()}>{e.packs_enabled?'Suspendre les boosters':'Activer les boosters'}</button>
   <button className="text-link" onClick={()=>void archive()}><Archive size={14}/> Archiver</button>
  </div>}
  {!e.archived_at&&<EditionShop edition={e} act={act} reason={askReason}/>}
 </section>;
}

// ------------------------------------------------------------------ clans
function ClansTab({catalog,act}:{catalog:AdminCatalog;act:Act}){
 const [name,setName]=useState('');
 const missing=ENGRAVED_CLANS.filter(n=>!catalog.clans.some(c=>c.name===n));
 const create=(n:string)=>act(`Clan « ${n} » ajouté.`,c=>callRpc(c,'admin_save_clan',{p_id:null,p_name:n,p_symbol_key:null}));
 const ask=useContext(AskContext);
 const rename=async(id:string,old:string)=>{const n=await ask({title:'Renommer le clan',inputLabel:'Nouveau nom',initialValue:old,confirmLabel:'Renommer'});if(n&&n.trim()&&n.trim()!==old)void act('Clan renommé.',c=>callRpc(c,'admin_save_clan',{p_id:id,p_name:n.trim(),p_symbol_key:null}));};
 return <div className="admin-clans">
  <ul className="panel admin-clan-list">{catalog.clans.map(c=><li key={c.id}><span>{c.name}</span><span className="admin-hint">{ENGRAVED_CLANS.includes(c.name)?'Symbole gravé':'Médaillon mystérieux (symbole à fournir)'}</span><button className="text-link" onClick={()=>void rename(c.id,c.name)}>Renommer</button></li>)}{!catalog.clans.length&&<li className="muted">Aucun clan pour l’instant.</li>}</ul>
  <form className="panel admin-create" onSubmit={e=>{e.preventDefault();void create(name.trim()).then(ok=>{if(ok)setName('');});}}>
   <span className="eyebrow">Nouveau clan ou lignée</span>
   <label className="auth-field"><span>Nom</span><input value={name} onChange={e=>setName(e.target.value)} required maxLength={40}/></label>
   <button className="primary"><Plus size={16}/> Ajouter</button>
   {missing.length>0&&<p className="admin-hint">Symboles déjà dessinés : {missing.map((n,i)=><span key={n}>{i?', ':''}<button type="button" className="text-link" onClick={()=>void create(n)}>{n}</button></span>)}</p>}
  </form>
 </div>;
}

// ------------------------------------------------------------------ succès personnalisés
type CustomAchievement={code:string;label:string;description:string;secret:boolean;reward_deniers:number;reward_boosters:number;title:string|null;conditional:boolean;automatic?:boolean;edition?:string|null;edition_id?:string|null;characters:{id:string;name:string;code:string;finish?:string|null;art?:string|null;art_label?:string|null}[];holders:string[]};
type AchievementForm={code:string;label:string;description:string;secret:boolean;deniers:string;boosters:string;title:string;mode:'conditional'|'manual';edition:string};
const emptyAchievement:AchievementForm={code:'',label:'',description:'',secret:false,deniers:'100',boosters:'0',title:'',mode:'conditional',edition:''};

/** Version d'illustration exigée pour un personnage d'un succès conditionnel. */
function ArtChoice({client,characterId,value,onChange}:{client:SupabaseClient;characterId:string;value:string;onChange:(v:string)=>void}){
 const [arts,setArts]=useState<{id:string;label:string;kind:string}[]|null>(null);
 useEffect(()=>{let alive=true;void callRpc<{id:string;label:string;kind:string}[]>(client,'admin_card_arts',{p_character_id:characterId}).then(a=>{if(alive)setArts(a);}).catch(()=>{if(alive)setArts([]);});return()=>{alive=false;};},[client,characterId]);
 return <select aria-label="Version d’illustration exigée" value={value} onChange={e=>onChange(e.target.value)}><option value="">toute version</option>{(arts?.length??0)>0&&<option value="alt">une version alternative</option>}{arts?.map(a=>(<option key={a.id} value={a.id}>{a.label}</option>))}</select>;
}

function AchievementsTab({catalog,act,client}:{catalog:AdminCatalog;act:Act;client:SupabaseClient}){
 const [list,setList]=useState<CustomAchievement[]|null>(null);
 const [form,setForm]=useState<AchievementForm>(emptyAchievement);
 const [chars,setChars]=useState<string[]>([]);
 // Finition exigée par personnage requis (absente = simple découverte).
 const [finishes,setFinishes]=useState<Record<string,string>>({});
 // Version d'illustration exigée par personnage requis : id de version, ou « alt » (n'importe quelle alternative).
 const [arts,setArts]=useState<Record<string,string>>({});
 const [query,setQuery]=useState('');
 const [grant,setGrant]=useState<{code:string;handle:string;reason:string}|null>(null);
 const load=useCallback(async()=>{setList(await callRpc<CustomAchievement[]>(client,'admin_custom_achievements').catch(()=>[]));},[client]);
 useEffect(()=>{void load();},[load]);
 const published=useMemo(()=>catalog.characters.filter(c=>c.status==='published'),[catalog]);
 const matches=useMemo(()=>{const q=query.trim().toLowerCase();return q.length<2?[]:published.filter(c=>c.name.toLowerCase().includes(q)&&!chars.includes(c.id)).slice(0,8);},[query,published,chars]);
 const label=(id:string)=>{const c=catalog.characters.find(x=>x.id===id);const e=catalog.editions.find(x=>x.id===c?.edition_id);return c?`${c.name} (${e?.prefix}-${String(c.number).padStart(3,'0')})`:id;};
 const edit=(a:CustomAchievement)=>{setForm({code:a.code,label:a.label,description:a.description,secret:a.secret,deniers:String(a.reward_deniers),boosters:String(a.reward_boosters),title:a.title??'',mode:a.conditional?'conditional':'manual',edition:a.edition_id??''});setChars(a.characters.map(c=>c.id));setFinishes(Object.fromEntries(a.characters.filter(c=>c.finish).map(c=>[c.id,c.finish!])));setArts(Object.fromEntries(a.characters.filter(c=>c.art).map(c=>[c.id,c.art!])));};
 const reset=()=>{setForm(emptyAchievement);setChars([]);setFinishes({});setArts({});};
 const digits=(v:string)=>v.replace(/[^\d]/g,'');
 const save=(e:React.FormEvent)=>{e.preventDefault();void act(form.code?'Succès mis à jour.':'Succès créé.',async c=>{await callRpc(c,'admin_save_achievement',{p_code:form.code||null,p_label:form.label,p_description:form.description,p_secret:form.secret,p_reward_deniers:Number(form.deniers)||0,p_reward_boosters:Number(form.boosters)||0,p_title:form.title||null,p_characters:form.mode==='conditional'?chars:null,p_edition_id:form.edition||null,p_finishes:form.mode==='conditional'?Object.fromEntries(Object.entries(finishes).filter(([id])=>chars.includes(id))):null,p_arts:form.mode==='conditional'?Object.fromEntries(Object.entries(arts).filter(([id])=>chars.includes(id))):null});}).then(ok=>{if(ok){reset();void load();}});};
 const doGrant=(e:React.FormEvent)=>{e.preventDefault();if(!grant)return;void act(`Succès décerné à ${grant.handle}.`,c=>callRpc(c,'admin_grant_achievement',{p_code:grant.code,p_handle:grant.handle,p_reason:grant.reason})).then(ok=>{if(ok){setGrant(null);void load();}});};
 return <div className="admin-editions">
  <form className="panel admin-create" onSubmit={save}>
   <span className="eyebrow">{form.code?'Modifier le succès':'Nouveau succès personnalisé'}</span>
   <label className="auth-field"><span>Nom</span><input value={form.label} onChange={e=>setForm({...form,label:e.target.value})} required placeholder="LES BRATS!!"/></label>
   <label className="auth-field"><span>Explication (révélée une fois débloqué)</span><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Avoir collectionné Sirius et Wezen."/></label>
   <div className="segmented" role="tablist"><button type="button" role="tab" aria-selected={form.mode==='conditional'} onClick={()=>setForm({...form,mode:'conditional'})}>Conditionnel</button><button type="button" role="tab" aria-selected={form.mode==='manual'} onClick={()=>setForm({...form,mode:'manual'})}>Décerné à la main</button></div>
   {form.mode==='conditional'?<div className="admin-art"><span className="admin-hint">Se débloque automatiquement quand le joueur possède tous ces personnages, dans la finition et la version d’illustration choisies le cas échéant.</span>
    <div className="chip-row">{chars.map(id=><span key={id} className="chip req-chip">{label(id)}<select aria-label={`Finition exigée pour ${label(id)}`} value={finishes[id]??''} onChange={e=>setFinishes(f=>{const n={...f};if(e.target.value)n[id]=e.target.value;else delete n[id];return n;})}><option value="">toute finition</option><option value="Dorée">Dorée</option><option value="Sanglante">Sanglante</option></select><ArtChoice client={client} characterId={id} value={arts[id]??''} onChange={v=>setArts(a=>{const n={...a};if(v)n[id]=v;else delete n[id];return n;})}/><button type="button" className="icon-button" aria-label={`Retirer ${label(id)}`} onClick={()=>setChars(chars.filter(x=>x!==id))}><X size={12}/></button></span>)}{!chars.length&&<span className="muted">Aucun personnage choisi.</span>}</div>
    <input className="picker-search" placeholder="Ajouter un personnage (nom)…" value={query} onChange={e=>setQuery(e.target.value)}/>
    {matches.length>0&&<ul className="friend-pick">{matches.map(c=><li key={c.id}><button type="button" onClick={()=>{setChars([...chars,c.id]);setQuery('');}}>{label(c.id)}</button></li>)}</ul>}
   </div>:<p className="admin-hint">Vous le décernerez à un joueur avec un motif (séance de GN, événement…).</p>}
   <div className="admin-row"><label className="auth-field"><span>Deniers</span><input inputMode="numeric" value={form.deniers} onChange={e=>setForm({...form,deniers:digits(e.target.value)})}/></label><label className="auth-field"><span>Boosters</span><input inputMode="numeric" value={form.boosters} onChange={e=>setForm({...form,boosters:digits(e.target.value)})}/></label></div>
   <label className="auth-field"><span>Rangement</span><select value={form.edition} onChange={e=>setForm({...form,edition:e.target.value})}><option value="">Succès généraux</option>{catalog.editions.filter(x=>!x.archived_at||x.id===form.edition).map(x=><option key={x.id} value={x.id}>Set {x.name} ({x.prefix})</option>)}</select></label>
   <label className="auth-field"><span>Titre offert (facultatif)</span><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
   <label className="admin-check"><input type="checkbox" checked={form.secret} onChange={e=>setForm({...form,secret:e.target.checked})}/> Secret (invisible tant qu’il n’est pas obtenu)</label>
   <div className="admin-actions"><button className="primary" disabled={form.mode==='conditional'&&!chars.length}>{form.code?'Enregistrer':'Créer le succès'}</button>{form.code&&<button type="button" className="text-link" onClick={reset}>Annuler la modification</button>}</div>
  </form>
  {!list?<Skeleton style={{height:120}}/>:list.map(a=><section key={a.code} className="panel admin-edition">
   <div className="section-header"><div><span className="eyebrow">{a.conditional?'Conditionnel':a.automatic?'Automatique':'Décerné à la main'}{a.edition?` · ${a.edition}`:''}{a.secret?' · secret':''}</span><h2>{a.label}</h2></div><button className="text-link" onClick={()=>edit(a)}>Modifier</button></div>
   <p className="admin-hint">{a.description||'Sans explication.'} · +{a.reward_deniers} Deniers{a.reward_boosters?` · +${a.reward_boosters} booster(s)`:''}{a.title?` · titre « ${a.title} »`:''}</p>
   {a.conditional&&<p className="admin-hint">Requis : {a.characters.map(c=>`${c.name} (${c.code})${c.finish?` en ${c.finish}`:''}`).join(', ')}</p>}
   <p className="admin-hint">Obtenu par : {a.holders.length?a.holders.join(', '):'personne pour l’instant'}</p>
   {!a.automatic&&(grant?.code===a.code?<form className="admin-row" onSubmit={doGrant}><input className="picker-search" placeholder="Pseudonyme" value={grant.handle} onChange={e=>setGrant({...grant,handle:e.target.value})} required/><input className="picker-search" placeholder="Motif" value={grant.reason} onChange={e=>setGrant({...grant,reason:e.target.value})} required/><button className="primary compact">Décerner</button></form>
    :<button className="primary ghost compact" onClick={()=>setGrant({code:a.code,handle:'',reason:''})}>Décerner à un joueur</button>)}
  </section>)}
 </div>;
}

// ------------------------------------------------------------------ joueurs
type PlayerRow={id:string;handle:string|null;role:string;created_at:string;suspended:boolean;blocked:boolean};
type PlayerDetail={id:string;handle:string|null;role:string;title:string|null;created_at:string;suspended_at:string|null;blocked_at:string|null;email:string|null;balance:number;boosters:{free:number;purchased:number};cards:number;faces:number;achievements:number;openings:number;active_listings:number;
 ledger:{delta:number;balance_after:number;kind:string;created_at:string}[];grants:{source:string;pool:string;quantity:number;created_at:string}[];audit:{action:string;reason:string;created_at:string;actor:string|null}[]};
const LEDGER_LABEL:Record<string,string>={achievement_reward:'Succès',admin_adjust:'Ajustement admin',auction_sale:'Vente aux enchères',bid_hold:'Enchère placée',bid_refund:'Enchère remboursée',daily_login:'Bonus quotidien',discovery_reward:'Découverte',market_purchase:'Achat au marché',market_sale:'Vente au marché',mission_reward:'Mission',recycle:'Recyclage',shop_booster:'Achat de boosters',trade_hold:'Échange (réserve)',trade_payment:'Échange payé',trade_receipt:'Échange reçu',trade_refund:'Échange remboursé'};
const GRANT_LABEL:Record<string,string>={free_slot:'Créneau gratuit',welcome:'Bienvenue',shop:'Boutique',admin:'Ajustement admin',reward:'Récompense'};
const AUDIT_LABEL:Record<string,string>={deniers_adjust:'Deniers ajustés',boosters_adjust:'Boosters ajustés',player_suspend:'Compte suspendu',player_unsuspend:'Compte réactivé',trade_block:'Échanges bloqués',trade_unblock:'Échanges débloqués',handle_reset:'Pseudonyme réinitialisé',achievement_grant:'Succès décerné',art_credit:'Crédit d’illustration',art_alternate_add:'Version alternative ajoutée',submission_accept:'Contribution acceptée',submission_reject:'Contribution refusée',card_grant:'Carte donnée',card_remove:'Carte retirée',report_resolved:'Signalement traité',report_dismissed:'Signalement classé',grant_test_boosters:'Boosters de test',grant_test_resources:'Ressources de test',admin_provision:'Nomination administrateur'};
const when=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

function PlayersTab({act,client,characters,focus}:{act:Act;client:SupabaseClient;characters:AdminCharacter[];focus?:string|null}){
 const reason=useReason();
 const [query,setQuery]=useState('');
 const [rows,setRows]=useState<PlayerRow[]|null>(null);
 const [selected,setSelected]=useState<string|null>(focus??null);
 useEffect(()=>{if(focus)setSelected(focus);},[focus]);
 const [detail,setDetail]=useState<PlayerDetail|null>(null);
 const [adjust,setAdjust]=useState({deniers:'',boosters:'',reason:''});
 useEffect(()=>{const t=setTimeout(()=>{void callRpc<PlayerRow[]>(client,'admin_search_players',{p_query:query}).then(setRows).catch(()=>setRows([]));},250);return()=>clearTimeout(t);},[client,query]);
 const loadDetail=useCallback(async(id:string)=>{setDetail(await callRpc<PlayerDetail>(client,'admin_player',{p_id:id}));},[client]);
 useEffect(()=>{setDetail(null);if(selected)void loadDetail(selected).catch(()=>{});},[selected,loadDetail]);
 const refresh=()=>{if(selected)void loadDetail(selected);void callRpc<PlayerRow[]>(client,'admin_search_players',{p_query:query}).then(setRows);};
 const signed=(v:string)=>v.replace(/[^\d-]/g,'').replace(/(?!^)-/g,'');
 const name=detail?.handle??'ce joueur';

 const applyAdjust=(kind:'deniers'|'boosters')=>{
  const delta=Number(adjust[kind]);if(!delta||!detail)return;
  if(!adjust.reason.trim())return;
  void act(`${delta>0?'+':''}${delta} ${kind==='deniers'?'Deniers':'booster(s)'} pour ${name}.`,c=>callRpc(c,kind==='deniers'?'admin_adjust_deniers':'admin_adjust_boosters',{p_id:detail.id,p_delta:delta,p_reason:adjust.reason,p_request_id:crypto.randomUUID()}))
   .then(ok=>{if(ok){setAdjust({deniers:'',boosters:'',reason:''});refresh();}});
 };
 const sanction=async(label:string,question:string,fn:string,args:Record<string,unknown>)=>{
  if(!detail)return;const r=await reason(question,label);if(r===null)return;
  if(await act(`${label} : ${name}.`,c=>callRpc(c,fn,{p_id:detail.id,...args,p_reason:r})))refresh();
 };

 return <div className="admin-players">
  <section className="panel admin-player-list">
   <input className="picker-search" placeholder="Rechercher un pseudonyme…" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Rechercher un joueur"/>
   {!rows?<Skeleton style={{height:160}}/>:rows.length===0?<p className="muted">Aucun joueur.</p>
    :<ul>{rows.map(p=><li key={p.id}><button className={selected===p.id?'on':''} aria-pressed={selected===p.id} onClick={()=>setSelected(p.id)}>
     <span className="person-sigil">{(p.handle??'?')[0]?.toUpperCase()}</span><span className="person-name">{p.handle??<em>sans pseudonyme</em>}<small>inscrit le {new Date(p.created_at).toLocaleDateString('fr-FR')}</small></span>
     {p.role==='admin'&&<span className="status-chip">admin</span>}{p.suspended&&<span className="status-chip danger">suspendu</span>}{p.blocked&&<span className="status-chip warn">échanges bloqués</span>}
    </button></li>)}</ul>}
  </section>

  {!selected?<section className="panel admin-player-empty"><p className="muted">Choisissez un joueur pour voir sa fiche.</p></section>
   :!detail?<Skeleton style={{height:420}}/>:<section className="panel admin-player">
   <div className="section-header"><div><span className="eyebrow">{detail.title??'Joueur'}{detail.role==='admin'?' · administrateur':''}</span><h2>{detail.handle??'Sans pseudonyme'}</h2><p className="admin-hint">{detail.email??'—'} · inscrit le {new Date(detail.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</p></div>
    {detail.handle&&<Link className="text-link" href={`/joueur/?h=${encodeURIComponent(detail.handle)}`}>Profil public</Link>}</div>
   {(detail.suspended_at||detail.blocked_at)&&<p className="admin-hint admin-flags">{detail.suspended_at&&<span className="status-chip danger">Suspendu depuis le {when(detail.suspended_at)}</span>}{detail.blocked_at&&<span className="status-chip warn">Échanges bloqués depuis le {when(detail.blocked_at)}</span>}</p>}
   <ul className="admin-player-stats">
    <li><strong>{detail.balance.toLocaleString('fr-FR')}</strong><span>Deniers</span></li>
    <li><strong>{detail.boosters.free}+{detail.boosters.purchased}</strong><span>Boosters (gratuits + achetés)</span></li>
    <li><strong>{detail.cards}</strong><span>Cartes</span></li><li><strong>{detail.faces}</strong><span>Visages</span></li>
    <li><strong>{detail.achievements}</strong><span>Succès</span></li><li><strong>{detail.openings}</strong><span>Ouvertures</span></li>
   </ul>

   <div className="admin-adjust">
    <span className="eyebrow">Ajustement économique</span>
    <label className="auth-field"><span>Motif (inscrit au journal)</span><input value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})} placeholder="Lot du tournoi, compensation…"/></label>
    <div className="admin-row">
     <div className="admin-adjust-line"><input inputMode="numeric" aria-label="Deniers à ajouter ou retirer" placeholder="+500 ou -200" value={adjust.deniers} onChange={e=>setAdjust({...adjust,deniers:signed(e.target.value)})}/><button className="primary compact" disabled={!Number(adjust.deniers)||!adjust.reason.trim()} onClick={()=>applyAdjust('deniers')}>Deniers</button></div>
     <div className="admin-adjust-line"><input inputMode="numeric" aria-label="Boosters à ajouter ou retirer" placeholder="+3 ou -1" value={adjust.boosters} onChange={e=>setAdjust({...adjust,boosters:signed(e.target.value)})}/><button className="primary compact" disabled={!Number(adjust.boosters)||!adjust.reason.trim()} onClick={()=>applyAdjust('boosters')}>Boosters</button></div>
    </div>
    <p className="admin-hint">Valeur négative pour retirer. Les boosters retirés ne concernent que la réserve achetée.</p>
   </div>

   {detail.role!=='admin'&&<div className="admin-moderation">
    <span className="eyebrow">Modération</span>
    <div className="admin-actions">
     {detail.suspended_at?<button className="primary ghost compact" onClick={()=>void sanction('Compte réactivé',`Réactiver le compte de ${name} ?`,'admin_set_suspended',{p_suspended:false})}>Réactiver le compte</button>
      :<button className="primary ghost compact danger" onClick={()=>void sanction('Compte suspendu',`Suspendre ${name} ? Il ne pourra plus rien faire et ses ventes sans offre seront retirées.`,'admin_set_suspended',{p_suspended:true})}>Suspendre</button>}
     {detail.blocked_at?<button className="primary ghost compact" onClick={()=>void sanction('Échanges débloqués',`Rendre le marché et les échanges à ${name} ?`,'admin_set_trade_block',{p_blocked:false})}>Débloquer les échanges</button>
      :<button className="primary ghost compact" onClick={()=>void sanction('Échanges bloqués',`Bloquer le marché, les cadeaux et les échanges de ${name} ?`,'admin_set_trade_block',{p_blocked:true})}>Bloquer les échanges</button>}
     {detail.handle&&<button className="primary ghost compact" onClick={()=>void sanction('Pseudonyme réinitialisé',`Effacer le pseudonyme « ${detail.handle} » ? Le joueur devra en choisir un autre.`,'admin_reset_handle',{})}>Réinitialiser le pseudonyme</button>}
    </div>
   </div>}

   <PlayerCards key={detail.id} client={client} act={act} reason={reason} playerId={detail.id} playerName={name} characters={characters} onChanged={refresh}/>

   <div className="admin-history">
    <details open><summary>Journal d’administration ({detail.audit.length})</summary>{detail.audit.length?<ul>{detail.audit.map((a,i)=><li key={i}><strong>{AUDIT_LABEL[a.action]??a.action}</strong><span>{a.reason}</span><small>{when(a.created_at)}{a.actor?` · ${a.actor}`:''}</small></li>)}</ul>:<p className="admin-hint">Aucune intervention.</p>}</details>
    <details><summary>Mouvements de Deniers (30 derniers)</summary><ul>{detail.ledger.map((l,i)=><li key={i}><strong className={l.delta<0?'neg':'pos'}>{l.delta>0?'+':''}{l.delta.toLocaleString('fr-FR')}</strong><span>{LEDGER_LABEL[l.kind]??l.kind}</span><small>{when(l.created_at)} · solde {l.balance_after.toLocaleString('fr-FR')}</small></li>)}</ul></details>
    <details><summary>Boosters reçus (20 derniers)</summary><ul>{detail.grants.map((g,i)=><li key={i}><strong className={g.quantity<0?'neg':'pos'}>{g.quantity>0?'+':''}{g.quantity}</strong><span>{GRANT_LABEL[g.source]??g.source}</span><small>{when(g.created_at)} · {g.pool==='free'?'gratuit':'acheté'}</small></li>)}</ul></details>
   </div>
  </section>}
 </div>;
}

// ------------------------------------------------------------------ événements
type AdminEvent={id:string;name:string;description:string;starts_at:string;ends_at:string;cancelled_at:string|null;finish_multiplier:number;deniers_multiplier:number;bonus_boosters:number;free_interval_hours:number|null;claims:number;openings:number};
type EventForm={id:string|null;name:string;description:string;start:string;end:string;finish:string;deniers:string;boosters:string;interval:string};
// datetime-local attend l'heure locale sans fuseau.
const localInput=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
const emptyEvent=():EventForm=>{const s=new Date();s.setMinutes(0,0,0);s.setHours(s.getHours()+1);const e=new Date(s.getTime()+24*3600e3);return {id:null,name:'',description:'',start:localInput(s),end:localInput(e),finish:'1',deniers:'1',boosters:'0',interval:''};};
const INTERVALS=[1,2,3,4,6,8,12];

function EventsTab({act,client,characters}:{act:Act;client:SupabaseClient;characters:AdminCharacter[]}){
 const [contentOf,setContentOf]=useState<string|null>(null);
 const reason=useReason();
 const [list,setList]=useState<AdminEvent[]|null>(null);
 const [form,setForm]=useState<EventForm>(emptyEvent);
 const load=useCallback(async()=>{setList(await callRpc<AdminEvent[]>(client,'admin_events').catch(()=>[]));},[client]);
 useEffect(()=>{void load();},[load]);
 const status=(e:AdminEvent)=>e.cancelled_at?'Annulé':Date.parse(e.ends_at)<=Date.now()?'Terminé':Date.parse(e.starts_at)<=Date.now()?'En cours':'À venir';
 const edit=(e:AdminEvent)=>setForm({id:e.id,name:e.name,description:e.description,start:localInput(new Date(e.starts_at)),end:localInput(new Date(e.ends_at)),finish:String(e.finish_multiplier),deniers:String(e.deniers_multiplier),boosters:String(e.bonus_boosters),interval:e.free_interval_hours?String(e.free_interval_hours):''});
 const noEffect=form.finish==='1'&&form.deniers==='1'&&form.boosters==='0'&&!form.interval;
 async function save(ev:React.FormEvent){
  ev.preventDefault();
  const r=await reason(form.id?'Pourquoi modifier cet événement ?':'Pourquoi créer cet événement ?',form.id?'Enregistrer':'Créer');if(r===null)return;
  const ok=await act(form.id?'Événement mis à jour.':'Événement programmé.',c=>callRpc(c,'admin_save_event',{p_id:form.id,p_name:form.name,p_description:form.description,
   p_starts_at:new Date(form.start).toISOString(),p_ends_at:new Date(form.end).toISOString(),p_finish_multiplier:Number(form.finish),p_deniers_multiplier:Number(form.deniers),
   p_bonus_boosters:Number(form.boosters),p_free_interval_hours:form.interval?Number(form.interval):null,p_reason:r}));
  if(ok){setForm(emptyEvent());void load();}
 }
 async function cancel(e:AdminEvent){
  const r=await reason(`Annuler « ${e.name} » ? S’il est en cours, il s’arrête immédiatement.`,'Annuler l’événement');if(r===null)return;
  if(await act('Événement annulé.',c=>callRpc(c,'admin_cancel_event',{p_id:e.id,p_reason:r})))void load();
 }
 const fmt=(d:string)=>new Date(d).toLocaleString('fr-FR',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 return <div className="admin-editions">
  <form className="panel admin-create" onSubmit={e=>void save(e)}>
   <span className="eyebrow">{form.id?'Modifier l’événement':'Nouvel événement'}</span>
   <label className="auth-field"><span>Nom</span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required placeholder="La Nuit Rouge"/></label>
   <label className="auth-field"><span>Description (affichée aux joueurs)</span><input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Le sang coule plus volontiers cette nuit…"/></label>
   <div className="admin-row"><label className="auth-field"><span>Début</span><input type="datetime-local" value={form.start} onChange={e=>setForm({...form,start:e.target.value})} required/></label><label className="auth-field"><span>Fin</span><input type="datetime-local" value={form.end} onChange={e=>setForm({...form,end:e.target.value})} required/></label></div>
   <div className="admin-row">
    <label className="auth-field"><span>Finitions rares</span><select value={form.finish} onChange={e=>setForm({...form,finish:e.target.value})}>{['1','1.5','2','3','4','5'].map(v=><option key={v} value={v}>{v==='1'?'Normales':`×${v.replace('.',',')}`}</option>)}</select></label>
    <label className="auth-field"><span>Deniers (connexion, missions)</span><select value={form.deniers} onChange={e=>setForm({...form,deniers:e.target.value})}>{['1','1.5','2','3'].map(v=><option key={v} value={v}>{v==='1'?'Normaux':`×${v.replace('.',',')}`}</option>)}</select></label>
   </div>
   <div className="admin-row">
    <label className="auth-field"><span>Boosters gratuits</span><select value={form.interval} onChange={e=>setForm({...form,interval:e.target.value})}><option value="">06 h et 18 h (normal)</option>{INTERVALS.map(h=><option key={h} value={h}>Toutes les {h} h</option>)}</select></label>
    <label className="auth-field"><span>Boosters offerts (une fois)</span><select value={form.boosters} onChange={e=>setForm({...form,boosters:e.target.value})}>{Array.from({length:11},(_,i)=><option key={i} value={i}>{i===0?'Aucun':i}</option>)}</select></label>
   </div>
   <p className="admin-hint">Les effets ne s’appliquent qu’entre le début et la fin. Les boosters gratuits supplémentaires restent limités par la réserve de 6.</p>
   <div className="admin-actions"><button className="primary" disabled={noEffect||!form.name.trim()}>{form.id?'Enregistrer':'Programmer l’événement'}</button>{form.id&&<button type="button" className="text-link" onClick={()=>setForm(emptyEvent())}>Annuler la modification</button>}</div>
   {noEffect&&<p className="admin-hint">Choisissez au moins un effet.</p>}
  </form>
  {!list?<Skeleton style={{height:120}}/>:list.length===0?<p className="muted">Aucun événement programmé.</p>:list.map(e=>{const st=status(e);return <section key={e.id} className={`panel admin-edition event-admin ${st==='En cours'?'live':''}`}>
   <div className="section-header"><div><span className="eyebrow">{st}</span><h2>{e.name}</h2></div>{(st==='À venir'||st==='En cours')&&<div className="admin-actions"><button className="text-link" onClick={()=>edit(e)}>Modifier</button><button className="text-link" onClick={()=>void cancel(e)}>Annuler</button></div>}</div>
   <p className="admin-hint">{fmt(e.starts_at)} → {fmt(e.ends_at)}</p>
   <ul className="event-effects">{eventEffects(e).map(({icon:I,text})=><li key={text}><I size={13}/> {text}</li>)}</ul>
   <p className="admin-hint">{e.openings} ouverture{e.openings>1?'s':''} sous l’effet des finitions{e.bonus_boosters?` · ${e.claims} cadeau${e.claims>1?'x':''} récupéré${e.claims>1?'s':''}`:''}</p>
   {!e.cancelled_at&&<button type="button" className="text-link" onClick={()=>setContentOf(contentOf===e.id?null:e.id)}>{contentOf===e.id?'Fermer le contenu':'Missions, cartes, défi et classement'}</button>}
   {contentOf===e.id&&<EventContent client={client} act={act} reason={reason} eventId={e.id} characters={characters}/>}
  </section>;})}
 </div>;
}

// Économie : le motif passe par la boîte de dialogue intégrée du back-office.
function EconomyHost({act,client}:{act:Act;client:SupabaseClient}){
 const reason=useReason();
 return <EconomyTab act={act} client={client} reason={reason}/>;
}

function ReportsHost({act,client}:{act:Act;client:SupabaseClient}){
 const reason=useReason();
 return <ReportsTab act={act} client={client} reason={reason}/>;
}

function ContestHost({act,client,catalog}:{act:Act;client:SupabaseClient;catalog:AdminCatalog}){
 const reason=useReason();const ask=useContext(AskContext);
 return <ContestTab act={act} client={client} reason={reason} ask={ask} catalog={catalog}/>;
}

function IdeasHost({act,client}:{act:Act;client:SupabaseClient}){
 const reason=useReason();
 return <IdeasTab act={act} client={client} reason={reason}/>;
}

function ContributionsHost({act,client,catalog}:{act:Act;client:SupabaseClient;catalog:AdminCatalog}){
 const reason=useReason();
 return <ContributionsTab act={act} client={client} reason={reason} catalog={catalog}/>;
}
