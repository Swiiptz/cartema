'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {TarotCard} from '@/components/Card';
import {useAuth} from '@/components/AuthProvider';
import {demoCards} from '@/data/demo';
import {callRpc,type AlbumEntry} from '@/lib/game';

export default function Profile(){
 const {configured,ready,session,client,player}=useAuth();
 const [album,setAlbum]=useState<AlbumEntry[]|null>(null);
 useEffect(()=>{
  if(!client||!session)return;
  let alive=true;
  callRpc<AlbumEntry[]>(client,'get_album').then(a=>{if(alive)setAlbum(a);}).catch(()=>{});
  return()=>{alive=false;};
 },[client,session]);

 // Mode atelier (site non relié à Supabase) : maquette de présentation.
 if(!configured)return <div className="page"><div className="eyebrow">Le collectionneur</div><h1>Mon profil</h1><div className="panel"><div className="profile-top"><div className="profile-avatar">✧</div><div><h2>Archiviste anonyme</h2><p>Gardien des Arcanes</p></div></div><p className="muted">Vitrine de collection — cinq emplacements</p><div className="card-grid">{demoCards.filter(c=>c.known).slice(0,4).map(c=><TarotCard card={c} key={c.id}/>)}</div></div><p className="demo-note">Écran de présentation sans données personnelles.</p></div>;

 if(!ready||(session&&!player))return <div className="page"><p className="muted" aria-live="polite">Chargement…</p></div>;
 if(!session||!player)return <div className="page auth-page"><section className="panel auth-panel"><span className="eyebrow">Le collectionneur</span><h1>Votre profil vous attend.</h1><p className="muted">Connectez-vous pour retrouver votre pseudonyme, vos Deniers et votre collection.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 const discovered=album?.filter(c=>c.known).length;
 const owned=album?.reduce((s,c)=>s+(c.known?Object.values(c.owned).reduce((a,n)=>a+(n??0),0):0),0);
 return <div className="page">
  <div className="eyebrow">Le collectionneur</div><h1>{player.profile.handle??'Mon profil'}</h1>
  <div className="panel profile-real">
   <div className="profile-top"><div className="profile-avatar">✧</div><div><h2>{player.profile.handle??'Pseudonyme à choisir'}</h2><p>Membre depuis le {new Date(player.profile.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</p></div></div>
   <dl className="auth-facts">
    <div><dt>Deniers</dt><dd>{player.balance.toLocaleString('fr-FR')}</dd></div>
    <div><dt>Boosters</dt><dd>{player.boosters.free} gratuits · {player.boosters.purchased} achetés</dd></div>
    <div><dt>Visages découverts</dt><dd>{discovered===undefined?'…':`${discovered} / ${album!.length}`}</dd></div>
    <div><dt>Cartes possédées</dt><dd>{owned??'…'}</dd></div>
   </dl>
   <div className="auth-actions"><Link className="primary" href="/collection/">Ma collection</Link><Link className="primary ghost" href="/connexion/">Mon compte</Link></div>
  </div>
  <p className="demo-note">Vitrine de cinq cartes, titres, badges et confidentialité : à venir.</p>
 </div>;
}
