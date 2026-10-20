'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Award,BookOpen,Check,Coins,Layers3,Link2,LogOut,Settings,Sparkles,Users} from 'lucide-react';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {DiscordIcon} from '@/components/DiscordIcon';
import {CountUp,Skeleton} from '@/components/ui';
import {demoCards} from '@/data/demo';
import {callRpc,type AlbumEntry} from '@/lib/game';
import {withBase} from '@/lib/paths';

export default function Profile(){
 const {configured,ready,session,client,player,refreshPlayer,signOut}=useAuth();
 const [album,setAlbum]=useState<AlbumEntry[]|null>(null);
 const [handle,setHandle]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 useEffect(()=>{
  if(!client||!session)return;
  let alive=true;
  callRpc<AlbumEntry[]>(client,'get_album').then(a=>{if(alive)setAlbum(a);}).catch(()=>{});
  return()=>{alive=false;};
 },[client,session]);

 // Mode atelier (site non relié à Supabase) : maquette de présentation.
 if(!configured)return <div className="page"><div className="eyebrow">Le collectionneur</div><h1>Mon profil</h1><div className="panel"><div className="profile-top"><div className="profile-avatar">✧</div><div><h2>Archiviste anonyme</h2><p>Gardien des Arcanes</p></div></div><div className="card-grid">{demoCards.filter(c=>c.known).slice(0,4).map(c=><TarotCard card={c} key={c.id}/>)}</div></div><p className="demo-note">Écran de présentation sans données personnelles.</p></div>;
 if(!ready||(session&&!player))return <div className="page profile-page"><Skeleton style={{height:110}}/><Skeleton style={{height:200,marginTop:16}}/></div>;
 if(!session||!player)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Le collectionneur</span><h1>Votre profil vous attend.</h1><p className="muted">Connectez-vous pour retrouver votre pseudonyme, vos Deniers et votre collection.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 async function run(label:string,action:()=>Promise<void>){
  setBusy(true);setError(null);setNotice(null);
  try{await action();setNotice(label);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const saveHandle=(e:React.FormEvent)=>{e.preventDefault();void run('Pseudonyme enregistré.',async()=>{await callRpc(client!,'set_handle',{p_handle:handle});await refreshPlayer();setHandle('');});};
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

  {!name&&<form className="panel handle-callout rise" onSubmit={saveHandle}><h2>Choisissez votre pseudonyme</h2><p className="muted">Il vous représentera auprès des autres collectionneurs.</p><div className="inline-form"><input aria-label="Pseudonyme" value={handle} onChange={e=>setHandle(e.target.value)} minLength={3} maxLength={24} required placeholder="Lilith"/><button className="primary" disabled={busy}><Check size={16}/> Valider</button></div></form>}

  <ul className="stat-grid">{stats.map((s,i)=><li key={s.label} className="panel rise" style={{'--i':i+1} as React.CSSProperties}><s.icon size={18}/><strong>{s.value===undefined?<Skeleton style={{height:28,width:60}}/>:<><CountUp value={s.value}/>{s.suffix&&<small>{s.suffix}</small>}</>}</strong><span>{s.label}</span></li>)}</ul>

  <div className="profile-links rise" style={{'--i':5} as React.CSSProperties}><Link className="primary" href="/collection/"><BookOpen size={16}/> Ma collection</Link><Link className="primary ghost" href="/progression/"><Award size={16}/> Missions &amp; succès</Link><Link className="primary ghost" href="/amis/"><Users size={16}/> Amis &amp; échanges{(player.social_pending??0)>0&&<b className="tab-count">{player.social_pending}</b>}</Link></div>

  <section className="panel settings-panel rise" style={{'--i':6} as React.CSSProperties} aria-labelledby="reglages">
   <h2 id="reglages"><Settings size={18}/> Paramètres du compte</h2>
   {name&&<form className="settings-row" onSubmit={saveHandle}><div><strong>Pseudonyme</strong><span className="muted">{name}</span></div><div className="inline-form"><input aria-label="Nouveau pseudonyme" value={handle} onChange={e=>setHandle(e.target.value)} minLength={3} maxLength={24} required placeholder="Nouveau pseudonyme"/><button className="primary ghost" disabled={busy}>Modifier</button></div></form>}
   <div className="settings-row"><div><strong>E-mail</strong><span className="muted">{session.user.email??'—'}</span></div></div>
   <div className="settings-row"><div><strong>Discord</strong><span className="muted">{hasDiscord?'Compte lié':'Non lié'}</span></div>{!hasDiscord&&<button className="primary ghost discord-ghost" disabled={busy} onClick={linkDiscord}><DiscordIcon/> <Link2 size={14}/> Lier</button>}</div>
   <div className="settings-row"><div><strong>Session</strong><span className="muted">Connecté sur cet appareil</span></div><button className="primary ghost" onClick={()=>void signOut()}><LogOut size={16}/> Se déconnecter</button></div>
   {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  </section>
  <p className="demo-note">Vitrine de cinq cartes, titres et badges : à venir.</p>
 </div>;
}
