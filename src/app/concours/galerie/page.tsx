'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Brush,Crown,Images,Palette,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {TarotCard} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {callRpc,socialToCard,type ContestGallery,type ContestGalleryItem} from '@/lib/game';
import {contestImageUrl} from '@/lib/paths';

const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
const PLACES=['1er','2e','3e'];

/** Galerie des concours clos : podium, puis les dessins retenus rendus sur leur carte. */
export default function Galerie(){
 const {configured,ready,session,client}=useAuth();
 const [list,setList]=useState<ContestGallery[]|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [zoom,setZoom]=useState<ContestGalleryItem|null>(null);
 const load=useCallback(async()=>{
  if(!client)return;
  try{setList(await callRpc<ContestGallery[]>(client,'get_contest_gallery'));}catch(e){setError((e as Error).message);setList([]);}
 },[client]);
 useEffect(()=>{if(session)void load();},[session,load]);

 if(!configured||!ready||(session&&list===null))return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:320,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Galerie</span><h1>Les dessins des concours.</h1><p className="muted">Connectez-vous pour voir les illustrations retenues.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 return <div className="page gallery-page">
  <header className="market-head rise"><div><span className="eyebrow">Concours d’illustrations</span><h1>La galerie</h1>
   <p className="muted">Les dessins retenus de chaque concours, avec leurs auteurs.</p></div>
   <Link className="text-link" href="/concours/"><ArrowLeft size={14}/> Concours</Link></header>
  {error&&<p className="auth-error" role="alert">{error}</p>}
  {list!.length===0&&<section className="panel album-empty"><Images size={28}/><h2>Pas encore de concours terminé.</h2><p className="muted">Les dessins retenus apparaîtront ici après la clôture du premier concours.</p><Link className="primary" href="/concours/"><Brush size={15}/> Participer au concours</Link></section>}
  {list!.map((c,ci)=><section key={c.id} className="panel gallery-contest rise" style={{'--i':ci} as React.CSSProperties}>
   <div className="gallery-head"><div><span className="eyebrow">{c.edition} · clos le {day(c.ends_at)}</span><h2>{c.title}</h2></div>
    <small className="muted">{c.entries} dessin{c.entries>1?'s':''} · {c.artists} illustrateur{c.artists>1?'s':''}</small></div>
   {c.final&&c.podium.length>0?<ol className="gallery-podium">{c.podium.map(p=><li key={`${p.place}-${p.handle}`} className={`place-${p.place}`}>
     <span className="gallery-place">{p.place===1?<Crown size={16}/>:null}{PLACES[p.place-1]}</span>
     <Link className="person-name" href={`/joueur/?h=${encodeURIComponent(p.handle)}`}>{p.handle}</Link>
     <small>{p.points} pt{p.points>1?'s':''} · Illustrateur de génie</small></li>)}</ol>
    :<p className="muted gallery-pending"><Palette size={14}/> Délibération en cours : le podium sera affiché après la distribution des récompenses.</p>}
   {c.selected.length===0?<p className="muted">Aucun dessin retenu pour l’instant.</p>
    :<ul className="gallery-grid">{c.selected.map(s=><li key={s.entry_id} className="gallery-item">
     <button className="gallery-card" onClick={()=>setZoom(s)} aria-label={`Voir le dessin de ${s.author??'un ancien joueur'} pour ${s.character}`}><TarotCard card={socialToCard(s.card)}/></button>
     <div className="gallery-caption"><strong>{s.character}</strong>
      <small>par {s.author?<Link href={`/joueur/?h=${encodeURIComponent(s.author)}`}>{s.author}</Link>:'un ancien joueur'}</small>
      <span className={`gallery-kind ${s.kind}`}>{s.kind==='main'?'Illustration officielle':s.line_label??'Version alternative'}</span></div>
    </li>)}</ul>}
  </section>)}
  {zoom&&<div className="picker-zoom" role="dialog" aria-modal="true" aria-label={`Dessin de ${zoom.author??'un ancien joueur'}`} onClick={ev=>{if(ev.target===ev.currentTarget)setZoom(null);}} onKeyDown={ev=>{if(ev.key==='Escape'){ev.preventDefault();setZoom(null);}}}>
   <img className="contest-zoom-img" src={contestImageUrl(zoom.image_path)} alt={`Dessin de ${zoom.author??'un ancien joueur'} pour ${zoom.character}`}/>
   <p className="picker-wish">{zoom.character} · par {zoom.author??'un ancien joueur'}</p>
   <div className="picker-zoom-actions"><button className="primary ghost" autoFocus onClick={()=>setZoom(null)}><X size={15}/> Fermer</button></div>
  </div>}
 </div>;
}
