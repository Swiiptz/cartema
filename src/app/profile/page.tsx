'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Award,BookOpen,Check,Coins,Eye,Layers3,Link2,LogOut,Pencil,ScrollText,Settings,Sparkles,Users} from 'lucide-react';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {DiscordIcon} from '@/components/DiscordIcon';
import {CountUp,Skeleton} from '@/components/ui';
import {Showcase,ShowcaseEditor} from '@/components/Showcase';
import {FeaturedAchievements,FeaturedEditor} from '@/components/FeaturedAchievements';
import {WishlistView} from '@/components/Wishes';
import {MyData} from '@/components/MyData';
import {demoCards} from '@/data/demo';
import {callRpc,type AlbumEntry,type NotificationPrefs,type Notifications,type PublicProfile} from '@/lib/game';
import {withBase} from '@/lib/paths';

export default function Profile(){
 const {configured,ready,session,client,player,refreshPlayer,signOut}=useAuth();
 const [album,setAlbum]=useState<AlbumEntry[]|null>(null);
 const [handle,setHandle]=useState('');
 // Erreur du pseudonyme affichée sous son champ (le message général est en bas de page).
 const [handleError,setHandleError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [pub,setPub]=useState<PublicProfile|null>(null);
 const [editing,setEditing]=useState(false);
 const [prefs,setPrefs]=useState<NotificationPrefs|null>(null);
 const [editingFeatured,setEditingFeatured]=useState(false);
 useEffect(()=>{
  if(!client||!session)return;
  let alive=true;
  callRpc<AlbumEntry[]>(client,'get_album').then(a=>{if(alive)setAlbum(a);}).catch(()=>{});
  return()=>{alive=false;};
 },[client,session]);
 const ownHandle=player?.profile.handle;
 useEffect(()=>{
  if(!client||!ownHandle)return;
  let alive=true;
  callRpc<PublicProfile>(client,'get_profile',{p_handle:ownHandle}).then(p=>{if(alive)setPub(p);}).catch(()=>{});
  callRpc<Notifications>(client,'get_notifications',{p_limit:1}).then(n=>{if(alive)setPrefs(n.prefs);}).catch(()=>{});
  return()=>{alive=false;};
 },[client,ownHandle]);

 // Mode atelier (site non relié à Supabase) : maquette de présentation.
 if(!configured)return <div className="page"><div className="eyebrow">Le collectionneur</div><h1>Mon profil</h1><div className="panel"><div className="profile-top"><div className="profile-avatar">✧</div><div><h2>Archiviste anonyme</h2><p>Gardien des Arcanes</p></div></div><div className="card-grid">{demoCards.filter(c=>c.known).slice(0,4).map(c=><TarotCard card={c} key={c.id}/>)}</div></div><p className="demo-note">Écran de présentation sans données personnelles.</p></div>;
 if(!ready||(session&&!player))return <div className="page profile-page"><Skeleton style={{height:110}}/><Skeleton style={{height:200,marginTop:16}}/></div>;
 if(!session||!player)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Le collectionneur</span><h1>Votre profil vous attend.</h1><p className="muted">Connectez-vous pour retrouver votre pseudonyme, vos Deniers et votre collection.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 async function run(label:string,action:()=>Promise<void>){
  setBusy(true);setError(null);setNotice(null);
  try{await action();setNotice(label);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const handleIssue=checkHandle(handle);
 const saveHandle=(e:React.FormEvent)=>{e.preventDefault();if(handleIssue){setHandleError(handleIssue);return;}
  setHandleError(null);void run('Pseudonyme enregistré.',async()=>{try{await callRpc(client!,'set_handle',{p_handle:handle.trim()});}catch(err){setHandleError((err as Error).message);throw err;}await refreshPlayer();setHandle('');});};
 const handleField=(label:string,placeholder:string)=><><input aria-label={label} aria-invalid={!!(handleIssue||handleError)} aria-describedby="handle-help" value={handle} onChange={e=>{setHandle(e.target.value);setHandleError(null);}} minLength={3} maxLength={24} required placeholder={placeholder}/></>;
 const handleHelp=<p id="handle-help" className={handleIssue||handleError?'auth-error handle-help':'muted handle-help'} role={handleError?'alert':undefined}>{handleError??handleIssue??'3 à 24 caractères : lettres, chiffres, _ . - (sans espace).'}</p>;
 const savePrivacy=(visibility:string,showStats:boolean)=>void run('Confidentialité enregistrée.',async()=>{
  await callRpc(client!,'set_privacy',{p_visibility:visibility,p_show_stats:showStats});
  setPub(p=>p&&{...p,settings:{visibility:visibility as 'public'|'friends'|'private',show_stats:showStats}});
 });
 const savePref=(key:keyof NotificationPrefs,value:boolean)=>void run('Préférences enregistrées.',async()=>{await callRpc(client!,'set_notification_prefs',{p_prefs:{[key]:value}});setPrefs(p=>p&&{...p,[key]:value});});
 const linkDiscord=()=>void run('Redirection vers Discord…',async()=>{const {error}=await client!.auth.linkIdentity({provider:'discord',options:{redirectTo:`${window.location.origin}${withBase('/profile/')}`}});if(error)throw new Error(error.message);});

 const identities=session.user.identities??[];
 const hasDiscord=identities.some(i=>i.provider==='discord');
 const name=player.profile.handle;
 const discovered=album?.filter(c=>c.known).length;
 const owned=album?.reduce((s,c)=>s+(c.known?Object.values(c.owned).reduce((a,n)=>a+(n??0),0):0),0);
 const stats=[
  {icon:Coins,label:'Deniers',value:player.balance},
  {icon:Layers3,label:'Boosters',value:player.boosters.free+player.boosters.purchased},
  {icon:Sparkles,label:'Visages découverts',value:discovered,suffix:album?` / ${album.length}`:''},
  {icon:BookOpen,label:'Cartes possédées',value:owned},
 ];

 return <div className="page profile-page">
  <header className="profile-hero rise">
   <div className="profile-sigil" aria-hidden="true">{(name??'?').slice(0,1).toUpperCase()}</div>
   <div><span className="eyebrow">{player.profile.title??'Collectionneur'}</span><h1>{name??'Sans nom'}</h1><p className="muted">Membre depuis le {new Date(player.profile.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</p></div>
  </header>

  {!name&&<form className="panel handle-callout rise" onSubmit={saveHandle}><h2>Choisissez votre pseudonyme</h2><p className="muted">Il vous représentera auprès des autres collectionneurs.</p><div className="inline-form">{handleField('Pseudonyme','Lilith')}<button className="primary" disabled={busy||!!handleIssue}><Check size={16}/> {busy?'Enregistrement…':'Valider'}</button></div>{handleHelp}</form>}

  <ul className="stat-grid">{stats.map((s,i)=><li key={s.label} className="panel rise" style={{'--i':i+1} as React.CSSProperties}><s.icon size={18}/><strong>{s.value===undefined?<Skeleton style={{height:28,width:60}}/>:<><CountUp value={s.value}/>{s.suffix&&<small>{s.suffix}</small>}</>}</strong><span>{s.label}</span></li>)}</ul>

  {name&&<section className="social-section showcase-section rise" style={{'--i':5} as React.CSSProperties}>
   <div className="section-header"><h2>Ma vitrine</h2><div className="showcase-actions"><Link className="text-link" href={`/joueur/?h=${encodeURIComponent(name)}`}><Eye size={14}/> Voir mon profil</Link><button className="primary ghost compact" disabled={!pub} onClick={()=>setEditing(true)}><Pencil size={14}/> Modifier</button></div></div>
   {!pub?<Skeleton style={{height:150}}/>:<Showcase cards={pub.showcase??[]} empty="Exposez jusqu’à cinq cartes de votre collection aux autres joueurs."/>}
  </section>}
  {name&&<section className="social-section showcase-section rise" style={{'--i':5} as React.CSSProperties}>
   <div className="section-header"><h2>Succès mis en avant</h2><button className="primary ghost compact" disabled={!pub} onClick={()=>setEditingFeatured(true)}><Pencil size={14}/> Choisir</button></div>
   {!pub?<Skeleton style={{height:80}}/>:<FeaturedAchievements list={pub.featured??[]} empty="Choisissez jusqu’à trois succès dont vous êtes fier."/>}
  </section>}
  {name&&client&&<section className="social-section showcase-section rise" style={{'--i':5} as React.CSSProperties}>
   <div className="section-header"><h2>Ma liste de souhaits</h2></div>
   <WishlistView client={client} handle={null} own/>
  </section>}
  {pub&&client&&<FeaturedEditor client={client} open={editingFeatured} current={pub.featured??[]} onClose={()=>setEditingFeatured(false)} onSaved={p=>{setPub(p);setEditingFeatured(false);setNotice('Succès mis en avant enregistrés.');}}/>}
  {pub&&client&&<ShowcaseEditor client={client} open={editing} current={pub.showcase??[]} onClose={()=>setEditing(false)} onSaved={p=>{setPub(p);setEditing(false);setNotice('Vitrine enregistrée.');}}/>}

  <div className="profile-links rise" style={{'--i':5} as React.CSSProperties}><Link className="primary" href="/collection/"><BookOpen size={16}/> Ma collection</Link><Link className="primary ghost" href="/progression/"><Award size={16}/> Missions &amp; succès</Link><Link className="primary ghost" href="/historique/"><ScrollText size={16}/> Mon historique</Link><Link className="primary ghost" href="/amis/"><Users size={16}/> Amis &amp; échanges{(player.social_pending??0)>0&&<b className="tab-count">{player.social_pending}</b>}</Link></div>

  <section className="panel settings-panel rise" style={{'--i':6} as React.CSSProperties} aria-labelledby="reglages">
   <h2 id="reglages"><Settings size={18}/> Paramètres du compte</h2>
   {name&&<form className="settings-row" onSubmit={saveHandle}><div><strong>Pseudonyme</strong><span className="muted">{name}</span></div><div className="inline-form">{handleField('Nouveau pseudonyme','Nouveau pseudonyme')}<button className="primary ghost" disabled={busy||!!handleIssue}>Modifier</button>{handle&&handleHelp}</div></form>}
   {pub?.settings&&<div className="settings-row"><div><strong>Visibilité du profil</strong><span className="muted">{pub.settings.visibility==='public'?'Tout le monde voit votre vitrine':pub.settings.visibility==='friends'?'Seuls vos amis voient votre vitrine':'Seuls votre pseudonyme et votre titre sont visibles'}</span></div>
    <select className="privacy-select" aria-label="Visibilité du profil" disabled={busy} value={pub.settings.visibility} onChange={e=>savePrivacy(e.target.value,pub.settings!.show_stats)}><option value="public">Public</option><option value="friends">Amis seulement</option><option value="private">Privé</option></select></div>}
   {pub?.settings&&<label className="settings-row privacy-toggle"><div><strong>Statistiques visibles</strong><span className="muted">Classement, succès, visages et finitions sur votre profil</span></div>
    <input type="checkbox" disabled={busy} checked={pub.settings.show_stats} onChange={e=>savePrivacy(pub.settings!.visibility,e.target.checked)}/></label>}
   {prefs&&<div className="settings-row notif-prefs"><div><strong>Notifications</strong><span className="muted">Ce qui apparaît sous la cloche</span></div>
    <div className="notif-toggles">{([['friends','Amis'],['social','Cadeaux et échanges'],['market','Marché et enchères'],['achievements','Succès']] as const).map(([k,l])=><label key={k} className="admin-check"><input type="checkbox" disabled={busy} checked={prefs[k]} onChange={e=>savePref(k,e.target.checked)}/> {l}</label>)}</div></div>}
   <div className="settings-row"><div><strong>E-mail</strong><span className="muted">{session.user.email??'—'}</span></div></div>
   <div className="settings-row"><div><strong>Discord</strong><span className="muted">{hasDiscord?'Compte lié · vérifié : marché et échanges ouverts sans délai':'Liez-le pour vérifier votre compte et ouvrir le marché et les échanges sans attendre 24 h'}</span></div>{!hasDiscord&&<button className="primary ghost discord-ghost" disabled={busy} onClick={linkDiscord}><DiscordIcon/> <Link2 size={14}/> Lier</button>}</div>
   <MyData handle={name??null}/>
   <div className="settings-row"><div><strong>Session</strong><span className="muted">Connecté sur cet appareil</span></div><button className="primary ghost" onClick={()=>void signOut()}><LogOut size={16}/> Se déconnecter</button></div>
   {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  </section>
 </div>;
}

/** Même règle que le serveur : 3 à 24 lettres, chiffres, _ . - ; propose une correction. */
function checkHandle(raw:string):string|null{
 const v=raw.trim();
 if(!v||/^[\p{L}\p{N}_.-]{3,24}$/u.test(v))return null;
 const fixed=v.replace(/\s+/g,'_').replace(/[^\p{L}\p{N}_.-]/gu,'').slice(0,24);
 if(v.length<3)return 'Au moins 3 caractères.';
 if(v.length>24)return `24 caractères maximum (${v.length} actuellement).`;
 const why=/\s/.test(v)?'Pas d’espace':'Seuls les lettres, chiffres, _ . - sont acceptés';
 return fixed.length>=3?`${why} : essayez « ${fixed} ».`:`${why}.`;
}
