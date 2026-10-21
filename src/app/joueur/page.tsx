'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {Award,Check,Clock,Droplet,Lock,Sparkles,Trophy,UserPlus,Users} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {Showcase} from '@/components/Showcase';
import {FeaturedAchievements} from '@/components/FeaturedAchievements';
import {WishlistView} from '@/components/Wishes';
import {ReportButton} from '@/components/ReportDialog';
import {Skeleton} from '@/components/ui';
import {callRpc,type PublicProfile} from '@/lib/game';

const since=(d:string)=>new Date(d).toLocaleDateString('fr-FR',{month:'long',year:'numeric'});

/** Profil public d'un joueur : /joueur/?h=pseudonyme (export statique). */
export default function PlayerPage(){
 const {configured,ready,session,client,player}=useAuth();
 const [handle,setHandle]=useState<string|null|undefined>(undefined);
 const [profile,setProfile]=useState<PublicProfile|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<string|null>(null);
 useEffect(()=>{setHandle(new URLSearchParams(window.location.search).get('h'));},[]);
 const load=useCallback(async()=>{
  if(!client||!handle)return;
  try{setProfile(await callRpc<PublicProfile>(client,'get_profile',{p_handle:handle}));setError(null);}
  catch(e){setError((e as Error).message);}
 },[client,handle]);
 useEffect(()=>{if(session)void load();},[session,load]);

 async function addFriend(){
  if(!client||!profile)return;
  setBusy(true);setNotice(null);
  try{const r=await callRpc<string>(client,'send_friend_request',{p_handle:profile.handle});setNotice(r==='accepted'?`${profile.handle} fait partie de vos amis.`:'Invitation envoyée.');await load();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }

 if(!configured||!ready||handle===undefined||(session&&handle&&!profile&&!error))return <div className="page profile-page"><Skeleton style={{height:110}}/><Skeleton style={{height:240,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Profil</span><h1>Profil d’un collectionneur.</h1><p className="muted">Connectez-vous pour consulter les profils des autres joueurs.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;
 if(error||!profile)return <div className="page"><section className="panel auth-panel"><span className="eyebrow">Profil</span><h2>Joueur introuvable</h2><p className="muted">{error??'Aucun pseudonyme indiqué.'}</p><Link className="primary ghost" href="/progression/?onglet=classement">Voir le classement</Link></section></div>;

 const p=profile;const s=p.stats;
 return <div className="page profile-page player-page">
  <header className="profile-hero rise">
   <div className="profile-sigil" aria-hidden="true">{p.handle.slice(0,1).toUpperCase()}</div>
   <div><span className="eyebrow">{p.title??'Collectionneur'}</span><h1>{p.handle}</h1><p className="muted"><Clock size={12}/> Membre depuis {since(p.created_at)}</p></div>
   <div className="player-actions">
    {p.relation==='self'?<Link className="primary ghost compact" href="/profile/">Modifier mon profil</Link>
     :p.relation==='friends'?<span className="chip"><Users size={14}/> Ami</span>
     :p.relation==='pending_out'?<span className="chip">Invitation envoyée</span>
     :p.relation==='pending_in'?<Link className="primary compact" href="/amis/"><Check size={14}/> Répondre</Link>
     :player?.profile.handle&&<button className="primary compact" disabled={busy} onClick={()=>void addFriend()}><UserPlus size={14}/> Ajouter en ami</button>}
    {p.relation!=='self'&&client&&<ReportButton client={client} handle={p.handle}/>}
   </div>
  </header>
  {notice&&<p className="auth-notice" role="status">{notice}</p>}

  {p.featured.length>0&&<section className="social-section rise"><h2>Succès favoris</h2><FeaturedAchievements list={p.featured}/></section>}
  {!p.visible?<section className="panel private-profile rise"><Lock size={20}/><p>{p.relation==='none'||p.relation==='pending_out'||p.relation==='pending_in'?'Ce profil est réservé à ses amis.':'Ce profil est privé.'}</p></section>:<>
   <section className="social-section rise" style={{'--i':1} as React.CSSProperties}><h2>Vitrine</h2><Showcase cards={p.showcase??[]} empty="Aucune carte exposée pour l’instant."/></section>
   {s&&<ul className="stat-grid player-stats rise" style={{'--i':2} as React.CSSProperties}>
    <li className="panel"><Trophy size={18}/><strong>{s.position}<small>{s.position===1?'er':'e'}</small></strong><span>Classement</span></li>
    <li className="panel"><Award size={18}/><strong>{s.achievements}</strong><span>Succès</span></li>
    <li className="panel"><Sparkles size={18}/><strong>{s.faces}<small> / {s.total_characters}</small></strong><span>Visages découverts</span></li>
    <li className="panel"><Droplet size={18}/><strong>{s.gold}<small> dorées · </small>{s.blood}<small> sang</small></strong><span>Finitions rares</span></li>
   </ul>}
   {client&&<section className="social-section rise" style={{'--i':3} as React.CSSProperties}><h2>Liste de souhaits</h2><WishlistView client={client} handle={p.relation==='self'?null:p.handle} own={p.relation==='self'}/></section>}
   {p.recent&&p.recent.length>0&&<section className="social-section rise" style={{'--i':3} as React.CSSProperties}><h2>Derniers succès</h2><ul className="recent-achievements">{p.recent.map((r,i)=><li key={i}><Award size={14}/><span>{r.label}</span><small>{new Date(r.unlocked_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</small></li>)}</ul></section>}
  </>}
 </div>;
}
