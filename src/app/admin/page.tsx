'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {Archive,BookPlus,Check,FolderOpen,Images,ImagePlus,PackageOpen,Plus,Save,ShieldAlert,Upload,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {useAuth} from '@/components/AuthProvider';
import {TarotCard,palette,type DemoCard} from '@/components/Card';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc,silhouetteIndex} from '@/lib/game';
import {ACCEPTED_TYPES,ENGRAVED_CLANS,matchIllustrations,nextNumber,uploadIllustration,type AdminCatalog,type AdminCharacter,type AdminEdition,type CharacterStatus,type IllustrationMeta} from '@/lib/admin';

type Tab='characters'|'editions'|'clans';
const STATUS_LABEL:Record<CharacterStatus,string>={draft:'Brouillon',published:'Publiée',archived:'Archivée'};
// jsonb ne conserve pas l'ordre des clés : comparaison indépendante de l'ordre.
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const askReason=(question:string)=>{const r=window.prompt(question);return r&&r.trim()?r.trim():null;};

export default function Admin(){
 const {configured,ready,session,client,player}=useAuth();
 const [catalog,setCatalog]=useState<AdminCatalog|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [tab,setTab]=useState<Tab>('characters');
 const isAdmin=player?.profile.role==='admin';

 const load=useCallback(async()=>{
  if(!client)return;
  try{setCatalog(await callRpc<AdminCatalog>(client,'admin_catalog'));setError(null);}
  catch(e){setError((e as Error).message);}
 },[client]);
 useEffect(()=>{if(isAdmin)void load();},[isAdmin,load]);

 /** Exécute une action admin, recharge le catalogue et affiche le résultat. */
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

 return <div className="page admin-page">
  <header className="admin-heading"><div><span className="eyebrow">Back-office</span><h1>Le cabinet de l’archiviste</h1></div><p className="muted">Chaque modification est enregistrée dans le journal d’administration.</p></header>
  <nav className="admin-tabs" aria-label="Sections du back-office">{([['characters','Personnages'],['editions','Éditions'],['clans','Clans']] as const).map(([k,l])=><button key={k} className={tab===k?'on':''} aria-pressed={tab===k} onClick={()=>setTab(k)}>{l}</button>)}</nav>
  <div aria-live="polite">{error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice">{notice}</p>}</div>
  {!catalog?<p className="muted">Ouverture des registres…</p>:tab==='characters'?<CharactersTab catalog={catalog} act={act} client={client!} onError={setError}/>:tab==='editions'?<EditionsTab catalog={catalog} act={act}/>:<ClansTab catalog={catalog} act={act}/>}
 </div>;
}

function Gate({title,text,link=false}:{title:string;text:string;link?:boolean}){
 return <div className="page auth-page"><section className="panel auth-panel"><span className="eyebrow"><ShieldAlert size={13}/> Administration</span><h1>{title}</h1><p className="muted">{text}</p>{link?<Link className="primary" href="/connexion/">Se connecter</Link>:<Link className="primary ghost" href="/">Retour au cabinet</Link>}</section></div>;
}

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;

// ------------------------------------------------------------------ personnages
type Draft={id:string|null;edition_id:string;number:number;name:string;role_title:string;clan_id:string|null;rarity:Rarity;art_path:string|null;art_meta:IllustrationMeta;status:CharacterStatus;silhouette_key:string|null};
const emptyDraft=(catalog:AdminCatalog,editionId:string):Draft=>({id:null,edition_id:editionId,number:nextNumber(catalog.characters,editionId),name:'',role_title:'',clan_id:null,rarity:'Commun',art_path:null,art_meta:{},status:'draft',silhouette_key:null});
const toDraft=(c:AdminCharacter):Draft=>({id:c.id,edition_id:c.edition_id,number:c.number,name:c.name,role_title:c.role_title,clan_id:c.clan_id,rarity:c.rarity,art_path:c.art_path,art_meta:c.art_meta??{},status:c.status,silhouette_key:c.silhouette_key});

function previewCard(d:Draft,catalog:AdminCatalog,finish='Standard'):DemoCard{
 const prefix=catalog.editions.find(e=>e.id===d.edition_id)?.prefix??'???';
 const clan=catalog.clans.find(c=>c.id===d.clan_id)?.name??'?';
 return {id:`${prefix}-${String(d.number).padStart(3,'0')}`,name:d.name||'Sans nom',clan,role:d.role_title,rarity:d.rarity,known:true,finish,
  illustration:d.art_path??undefined,artLayout:d.art_meta.layout,artOffsetY:d.art_meta.offsetY,silhouette:silhouetteIndex(d.silhouette_key)};
}

function CharactersTab({catalog,act,client,onError}:{catalog:AdminCatalog;act:Act;client:SupabaseClient;onError:(m:string)=>void}){
 const [editionId,setEditionId]=useState([...catalog.editions].reverse().find(e=>!e.archived_at)?.id??catalog.editions[0]?.id??'');
 const [status,setStatus]=useState<CharacterStatus|'all'>('all');
 const [draft,setDraft]=useState<Draft|null>(null);
 const [bulk,setBulk]=useState(false);
 const list=useMemo(()=>catalog.characters.filter(c=>c.edition_id===editionId&&(status==='all'||c.status===status)),[catalog,editionId,status]);
 // Après rechargement du catalogue, l'éditeur reprend la version enregistrée.
 useEffect(()=>{setDraft(d=>{if(!d?.id)return d;const fresh=catalog.characters.find(c=>c.id===d.id);return fresh?toDraft(fresh):null;});},[catalog]);

 if(!catalog.editions.length)return <div className="panel admin-empty"><BookPlus size={26}/><h2>Aucune édition</h2><p className="muted">Créez d’abord une édition dans l’onglet « Éditions ».</p></div>;
 const edition=catalog.editions.find(e=>e.id===editionId);
 return <div className="admin-characters">
  <div className="admin-toolbar">
   <label><span>Édition</span><select value={editionId} onChange={e=>{setEditionId(e.target.value);setDraft(null);}}>{catalog.editions.map(e=><option key={e.id} value={e.id}>{e.name} ({e.prefix}){e.archived_at?' · archivée':''}</option>)}</select></label>
   <label><span>État</span><select value={status} onChange={e=>setStatus(e.target.value as CharacterStatus|'all')}><option value="all">Tous</option><option value="draft">Brouillons</option><option value="published">Publiées</option><option value="archived">Archivées</option></select></label>
   <button className="primary ghost" disabled={!!edition?.archived_at} onClick={()=>{setBulk(!bulk);setDraft(null);}}><Images size={16}/> Associer des illustrations</button>
   <button className="primary" disabled={!!edition?.archived_at} onClick={()=>{setBulk(false);setDraft(emptyDraft(catalog,editionId));}}><Plus size={16}/> Nouveau personnage</button>
  </div>
  {bulk&&edition&&<BulkIllustrations key={editionId} characters={catalog.characters.filter(c=>c.edition_id===editionId)} act={act} client={client} onClose={()=>setBulk(false)}/>}
  <div className={`admin-split ${draft?'editing':''}`}>
   <ul className="admin-card-list" aria-label="Personnages de l’édition">
    {list.map(c=><li key={c.id}><button className={draft?.id===c.id?'on':''} onClick={()=>setDraft(toDraft(c))}><span className="admin-card-thumb"><TarotCard card={previewCard(toDraft(c),catalog)}/></span><span className="admin-card-meta"><strong>{c.number}. {c.name}</strong><span style={{color:palette[c.rarity]}}>{c.rarity}</span><span className={`status-chip ${c.status}`}>{STATUS_LABEL[c.status]}</span></span></button></li>)}
    {!list.length&&<li className="muted admin-list-empty">Aucun personnage pour ce filtre.</li>}
   </ul>
   {draft&&<CharacterEditor key={draft.id??'new'} draft={draft} setDraft={setDraft} catalog={catalog} act={act} client={client} onError={onError}/>}
  </div>
 </div>;
}

function CharacterEditor({draft,setDraft,catalog,act,client,onError}:{draft:Draft;setDraft:(d:Draft|null)=>void;catalog:AdminCatalog;act:Act;client:SupabaseClient;onError:(m:string)=>void}){
 const [busy,setBusy]=useState(false);
 const [finish,setFinish]=useState('Standard');
 const creating=!draft.id;
 const set=<K extends keyof Draft>(k:K,v:Draft[K])=>setDraft({...draft,[k]:v});
 const setMeta=(m:Partial<IllustrationMeta>)=>setDraft({...draft,art_meta:{...draft.art_meta,...m}});

 async function upload(file:File|undefined){
  if(!file)return;
  setBusy(true);
  try{const {path,meta}=await uploadIllustration(client,file);setDraft({...draft,art_path:path,art_meta:meta});}
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
  const reason=askReason(question);if(!reason)return;
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
    <label className="auth-field"><span>Clan</span><select value={draft.clan_id??''} onChange={e=>set('clan_id',e.target.value||null)}><option value="">Clan à définir (médaillon mystérieux)</option>{catalog.clans.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <fieldset className="admin-art">
     <legend>Illustration</legend>
     <label className="primary ghost admin-upload"><Upload size={16}/> {draft.art_path?'Remplacer l’illustration':'Ajouter une illustration'}<input type="file" accept={ACCEPTED_TYPES.join(',')} disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>
     {draft.art_meta.width&&<p className="admin-hint">{draft.art_meta.width} × {draft.art_meta.height} px · {draft.art_meta.transparent?'détourée':'fond opaque'} · original conservé</p>}
     {draft.art_path&&<>
      <label className="auth-field"><span>Cadrage</span><select value={draft.art_meta.layout??'portrait'} onChange={e=>setMeta({layout:e.target.value as IllustrationMeta['layout']})}><option value="portrait">Portrait (image entière, en haut)</option><option value="cover">Remplir la fenêtre</option><option value="full">Image entière, centrée</option></select></label>
      {draft.art_meta.layout==='cover'&&<label className="auth-field"><span>Décalage vertical : {draft.art_meta.offsetY??0}</span><input type="range" min={-40} max={40} value={draft.art_meta.offsetY??0} onChange={e=>setMeta({offsetY:Number(e.target.value)})}/></label>}
      <button className="text-link" onClick={()=>setDraft({...draft,art_path:null,art_meta:{}})}><X size={14}/> Retirer (silhouette)</button>
     </>}
     {!draft.art_path&&<p className="admin-hint"><ImagePlus size={13}/> Sans illustration, la silhouette attribuée au personnage est utilisée.</p>}
    </fieldset>
    <div className="admin-actions">
     <button className="primary" disabled={busy||!draft.name.trim()||!dirty} onClick={()=>void save()}><Save size={16}/> {creating?'Créer le brouillon':'Enregistrer'}</button>
     {!creating&&draft.status!=='published'&&<button className="primary ghost" disabled={busy||dirty} onClick={()=>void changeStatus('published','Motif de la publication (ex. « Validée par l’équipe ») :','Carte publiée : elle apparaît dans l’album.')}><Check size={16}/> Publier</button>}
     {!creating&&draft.status==='published'&&<button className="primary ghost" disabled={busy} onClick={()=>void changeStatus('archived','Motif de l’archivage (la carte ne sera plus tirée, les exemplaires restent) :','Carte archivée.')}><Archive size={16}/> Archiver</button>}
    </div>
    {!creating&&dirty&&<p className="admin-hint">Enregistrez avant de publier.</p>}
   </div>
  </div>
 </section>;
}

// ------------------------------------------------------------------ association groupée
type BulkRow={file:File;candidates:AdminCharacter[];target:string;state:'pending'|'done'|'error'|'skipped';message?:string};

function BulkIllustrations({characters,act,client,onClose}:{characters:AdminCharacter[];act:Act;client:SupabaseClient;onClose:()=>void}){
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
     const {path,meta}=await uploadIllustration(c,r.file);
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
  <p className="admin-hint">Le nom du fichier doit être celui de la carte (« Clément de Saint-Simon.png ») ou son prénom s’il est unique (« Norton.webp »). Accents, majuscules et tirets ne comptent pas. Les originaux sont conservés.</p>
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
 const togglePacks=()=>{const reason=askReason(e.packs_enabled?'Motif de la suspension des boosters :':'Motif de l’activation des boosters :');if(reason)void act(e.packs_enabled?'Boosters suspendus.':'Boosters activés.',c=>callRpc(c,'admin_set_packs',{p_edition_id:e.id,p_enabled:!e.packs_enabled,p_reason:reason}));};
 const publishDrafts=()=>{const reason=askReason(`Publier les ${drafts} brouillons de « ${e.name} » ? Ils apparaîtront dans l’album (si l’album est publié). Motif :`);if(reason)void act(`${drafts} carte${drafts>1?'s':''} publiée${drafts>1?'s':''}.`,c=>callRpc(c,'admin_publish_drafts',{p_edition_id:e.id,p_reason:reason}));};
 const archive=()=>{const reason=askReason(`Archiver « ${e.name} » ? Les boosters seront arrêtés, rien n’est supprimé. Motif :`);if(reason)void act('Édition archivée.',c=>callRpc(c,'admin_archive_edition',{p_edition_id:e.id,p_reason:reason}));};
 return <section className={`panel admin-edition ${e.archived_at?'archived':''}`}>
  <div className="section-header"><div><span className="eyebrow">{e.prefix}{e.archived_at?' · archivée':''}</span><h2>{e.name}</h2></div><span className={`status-chip ${e.packs_enabled?'published':'draft'}`}><PackageOpen size={13}/> {e.packs_enabled?'Boosters actifs':'Boosters fermés'}</span></div>
  <div className="rarity-check" aria-label="Cartes publiées par rareté">{ALL_RARITIES.map(r=>{const n=e.published_by_rarity[r]??0;return <span key={r} className={n?'ok':'missing'} style={{'--rc':palette[r]} as React.CSSProperties}>{r}<b>{n}</b></span>;})}</div>
  <p className="admin-hint">{e.complete?'Les 7 raretés ont au moins une carte publiée.':'Il manque au moins une rareté publiée : activation des boosters impossible.'}{drafts?` · ${drafts} brouillon${drafts>1?'s':''} en attente`:''}</p>
  {!e.archived_at&&<div className="admin-actions">
   {drafts>0&&<button className="primary" onClick={publishDrafts}><Check size={16}/> Publier les {drafts} brouillons</button>}
   <button className="primary ghost" onClick={toggleAlbum}>{e.album_published?'Masquer l’album':'Publier l’album'}</button>
   <button className="primary ghost" disabled={!e.packs_enabled&&!e.complete} onClick={togglePacks}>{e.packs_enabled?'Suspendre les boosters':'Activer les boosters'}</button>
   <button className="text-link" onClick={archive}><Archive size={14}/> Archiver</button>
  </div>}
 </section>;
}

// ------------------------------------------------------------------ clans
function ClansTab({catalog,act}:{catalog:AdminCatalog;act:Act}){
 const [name,setName]=useState('');
 const missing=ENGRAVED_CLANS.filter(n=>!catalog.clans.some(c=>c.name===n));
 const create=(n:string)=>act(`Clan « ${n} » ajouté.`,c=>callRpc(c,'admin_save_clan',{p_id:null,p_name:n,p_symbol_key:null}));
 const rename=(id:string,old:string)=>{const n=window.prompt('Nouveau nom du clan :',old);if(n&&n.trim()&&n.trim()!==old)void act('Clan renommé.',c=>callRpc(c,'admin_save_clan',{p_id:id,p_name:n.trim(),p_symbol_key:null}));};
 return <div className="admin-clans">
  <ul className="panel admin-clan-list">{catalog.clans.map(c=><li key={c.id}><span>{c.name}</span><span className="admin-hint">{ENGRAVED_CLANS.includes(c.name)?'Symbole gravé':'Médaillon mystérieux (symbole à fournir)'}</span><button className="text-link" onClick={()=>rename(c.id,c.name)}>Renommer</button></li>)}{!catalog.clans.length&&<li className="muted">Aucun clan pour l’instant.</li>}</ul>
  <form className="panel admin-create" onSubmit={e=>{e.preventDefault();void create(name.trim()).then(ok=>{if(ok)setName('');});}}>
   <span className="eyebrow">Nouveau clan ou lignée</span>
   <label className="auth-field"><span>Nom</span><input value={name} onChange={e=>setName(e.target.value)} required maxLength={40}/></label>
   <button className="primary"><Plus size={16}/> Ajouter</button>
   {missing.length>0&&<p className="admin-hint">Symboles déjà dessinés : {missing.map((n,i)=><span key={n}>{i?', ':''}<button type="button" className="text-link" onClick={()=>void create(n)}>{n}</button></span>)}</p>}
  </form>
 </div>;
}
