'use client';
import {useState} from 'react';
import Link from 'next/link';
import {KeyRound,LogOut,Mail,Link2,Check} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {withBase} from '@/lib/paths';
import {callRpc} from '@/lib/game';

const redirectTo=()=>`${window.location.origin}${withBase('/connexion/')}`;

function DiscordIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.5 1.1a15.7 15.7 0 0 0-5.8 0L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-2.9-11.7ZM8.7 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/></svg>;}

export default function Connexion(){
 const {configured,ready,client,session,player,refreshPlayer,signOut}=useAuth();
 const [mode,setMode]=useState<'signin'|'signup'>('signin');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [handle,setHandle]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);

 async function run(action:()=>Promise<void>){
  setBusy(true);setError(null);setNotice(null);
  try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const submitCredentials=(e:React.FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!client)return;
  if(mode==='signin'){
   const {error}=await client.auth.signInWithPassword({email,password});
   if(error)throw new Error(error.message==='Invalid login credentials'?'E-mail ou mot de passe incorrect.':error.message);
  }else{
   const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo()}});
   if(error)throw new Error(error.message);
   if(!data.session)setNotice('Compte créé. Confirmez votre adresse depuis l’e-mail reçu pour vous connecter.');
  }
 });};
 const discord=()=>void run(async()=>{
  const {error}=await client!.auth.signInWithOAuth({provider:'discord',options:{redirectTo:redirectTo()}});
  if(error)throw new Error(error.message);
 });
 const linkDiscord=()=>void run(async()=>{
  const {error}=await client!.auth.linkIdentity({provider:'discord',options:{redirectTo:redirectTo()}});
  if(error)throw new Error(error.message);
 });
 const saveHandle=(e:React.FormEvent)=>{e.preventDefault();void run(async()=>{
  await callRpc(client!,'set_handle',{p_handle:handle});
  await refreshPlayer();setHandle('');setNotice('Pseudonyme enregistré.');
 });};

 if(!configured)return <div className="page auth-page"><section className="panel auth-panel"><span className="eyebrow">Comptes</span><h1>Le registre est fermé.</h1><p className="muted">Ce site n’est pas encore relié à son serveur de comptes. L’aperçu visuel reste disponible.</p><Link href="/" className="primary ghost">Retour au cabinet</Link></section></div>;
 if(!ready)return <div className="page auth-page"><p className="muted" aria-live="polite">Chargement…</p></div>;

 const feedback=<>{error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}</>;

 if(session){
  const identities=session.user.identities??[];
  const hasDiscord=identities.some(i=>i.provider==='discord');
  const needsHandle=player&&!player.profile.handle;
  return <div className="page auth-page"><section className="panel auth-panel">
   <span className="eyebrow">Votre registre</span>
   <h1>{player?.profile.handle?<>Bienvenue, <em>{player.profile.handle}</em>.</>:'Choisissez votre nom.'}</h1>
   {needsHandle&&<p className="muted">Un pseudonyme unique vous représentera auprès des autres collectionneurs.</p>}
   <form className="auth-form" onSubmit={saveHandle}>
    <label className="auth-field"><span>{needsHandle?'Pseudonyme':'Changer de pseudonyme'}</span><input value={handle} onChange={e=>setHandle(e.target.value)} minLength={3} maxLength={24} autoComplete="nickname" required placeholder={player?.profile.handle??'Lilith'}/></label>
    <button className="primary" disabled={busy}><Check size={16}/> Enregistrer</button>
   </form>
   {feedback}
   <dl className="auth-facts">
    <div><dt>E-mail</dt><dd>{session.user.email??'—'}</dd></div>
    {player&&<div><dt>Deniers</dt><dd>{player.balance.toLocaleString('fr-FR')}</dd></div>}
    {player&&<div><dt>Boosters</dt><dd>{player.boosters.free} gratuits · {player.boosters.purchased} achetés</dd></div>}
    <div><dt>Discord</dt><dd>{hasDiscord?'Lié':<button className="text-link" disabled={busy} onClick={linkDiscord}><Link2 size={14}/> Lier mon compte Discord</button>}</dd></div>
   </dl>
   <div className="auth-actions"><Link href="/boosters/" className="primary">Ouvrir un booster</Link><button className="primary ghost" onClick={()=>void signOut()}><LogOut size={16}/> Se déconnecter</button></div>
  </section></div>;
 }

 return <div className="page auth-page"><section className="panel auth-panel">
  <span className="eyebrow">Le registre des arcanes</span>
  <h1>{mode==='signin'?'Entrer dans le cabinet.':'Rejoindre le cabinet.'}</h1>
  <button className="primary discord-button" disabled={busy} onClick={discord}><DiscordIcon/> Continuer avec Discord</button>
  <div className="auth-divider"><span/>ou<span/></div>
  <form className="auth-form" onSubmit={submitCredentials}>
   <label className="auth-field"><span><Mail size={14}/> E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/></label>
   <label className="auth-field"><span><KeyRound size={14}/> Mot de passe</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='signin'?'current-password':'new-password'} minLength={8} required/></label>
   <button className="primary" disabled={busy}>{mode==='signin'?'Se connecter':'Créer mon compte'}</button>
  </form>
  {feedback}
  <p className="auth-switch">{mode==='signin'?'Pas encore de compte ?':'Déjà inscrit ?'} <button className="text-link" onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError(null);setNotice(null);}}>{mode==='signin'?'Créer un compte':'Se connecter'}</button></p>
 </section></div>;
}
