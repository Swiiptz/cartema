'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Eye,EyeOff,KeyRound,Mail} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {TarotCard} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {showcase} from '@/data/demo';
import {withBase} from '@/lib/paths';
import {DiscordIcon} from '@/components/DiscordIcon';

const redirectTo=()=>`${window.location.origin}${withBase('/connexion/')}`;
const authMessages:Record<string,string>={
 'Invalid login credentials':'E-mail ou mot de passe incorrect.',
 'User already registered':'Un compte existe déjà avec cet e-mail.',
 'Password should be at least 8 characters.':'Le mot de passe doit contenir au moins 8 caractères.',
};


/** Connexion et inscription uniquement ; le compte se gère depuis le profil. */
export default function Connexion(){
 const {configured,ready,client,session}=useAuth();
 const router=useRouter();
 const [mode,setMode]=useState<'signin'|'signup'>('signin');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [reveal,setReveal]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);

 useEffect(()=>{if(new URLSearchParams(window.location.search).get('mode')==='inscription')setMode('signup');},[]);
 useEffect(()=>{if(session)router.replace('/profile/');},[session,router]);

 async function run(action:()=>Promise<void>){
  setBusy(true);setError(null);setNotice(null);
  try{await action();}catch(e){const m=(e as Error).message;setError(authMessages[m]??m);}finally{setBusy(false);}
 }
 const submit=(e:React.FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!client)return;
  if(mode==='signin'){const {error}=await client.auth.signInWithPassword({email,password});if(error)throw new Error(error.message);}
  else{const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo()}});if(error)throw new Error(error.message);if(!data.session)setNotice('Compte créé. Confirmez votre adresse depuis l’e-mail reçu.');}
 });};
 const discord=()=>void run(async()=>{const {error}=await client!.auth.signInWithOAuth({provider:'discord',options:{redirectTo:redirectTo()}});if(error)throw new Error(error.message);});

 if(!configured)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Comptes</span><h1>Le registre est fermé.</h1><p className="muted">Ce site n’est pas encore relié à son serveur de comptes.</p><Link href="/" className="primary ghost">Retour</Link></section></div>;
 if(!ready||session)return <div className="page auth-screen"><section className="panel auth-panel"><Skeleton style={{height:30,width:'60%'}}/><Skeleton style={{height:48}}/><Skeleton style={{height:48}}/></section></div>;

 return <div className="page auth-screen">
  <div className="auth-art" aria-hidden="true">{showcase.map((c,i)=><div key={c.id} className="fan-card" style={{'--i':i} as React.CSSProperties}><TarotCard card={c}/></div>)}</div>
  <section className="panel auth-panel rise">
   <span className="eyebrow">Cartema</span>
   <h1>{mode==='signin'?'Bon retour parmi nous.':'Rejoindre le cabinet.'}</h1>
   <div className="segmented" role="tablist" aria-label="Connexion ou inscription">
    <button role="tab" aria-selected={mode==='signin'} onClick={()=>{setMode('signin');setError(null);setNotice(null);}}>Connexion</button>
    <button role="tab" aria-selected={mode==='signup'} onClick={()=>{setMode('signup');setError(null);setNotice(null);}}>Inscription</button>
   </div>
   <button className="primary discord-button" disabled={busy} onClick={discord}><DiscordIcon/> Continuer avec Discord</button>
   <div className="auth-divider"><span/>ou par e-mail<span/></div>
   <form className="auth-form" onSubmit={submit}>
    <label className="auth-field"><span><Mail size={14}/> E-mail</span><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/></label>
    <label className="auth-field"><span><KeyRound size={14}/> Mot de passe</span><span className="field-with-action"><input type={reveal?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='signin'?'current-password':'new-password'} minLength={8} required/><button type="button" aria-label={reveal?'Masquer le mot de passe':'Afficher le mot de passe'} aria-pressed={reveal} onClick={()=>setReveal(!reveal)}>{reveal?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
    {mode==='signup'&&<p className="admin-hint">8 caractères minimum. Vous choisirez votre pseudonyme juste après.</p>}
    {mode==='signup'&&<p className="admin-hint legal-consent">En créant un compte, vous acceptez les <Link className="text-link" href="/mentions-legales/">mentions légales</Link> et la <Link className="text-link" href="/confidentialite/">politique de confidentialité</Link>.</p>}
    <button className="primary" disabled={busy}>{busy?'Un instant…':mode==='signin'?'Se connecter':'Créer mon compte'}</button>
   </form>
   {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  </section>
 </div>;
}
