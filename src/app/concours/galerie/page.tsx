'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowLeft,Brush,Crown,Gem,Images,Palette,Trophy,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {TarotCard} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {callRpc,socialToCard,type ContestGallery} from '@/lib/game';
import {contestImageUrl} from '@/lib/paths';

const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
type Tab='official'|'mythics'|'ranking';
type Zoom={src:string;caption:string};

/** Résultats des concours clos : illustrations officielles, Mythiques avec toutes leurs versions, classement. */
export default function Galerie(){
 const {configured,ready,session,client,player}=useAuth();
 const [list,setList]=useState<ContestGallery[]|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [contestId,setContestId]=useState<string|null>(null);
 const [tab,setTab]=useState<Tab>('official');
 const [zoom,setZoom]=useState<Zoom|null>(null);
 const load=useCallback(async()=>{
  if(!client)return;
  try{setList(await callRpc<ContestGallery[]>(client,'get_contest_gallery'));}catch(e){setError((e as Error).message);setList([]);}
 },[client]);
 useEffect(()=>{if(session)void load();},[session,load]);

 if(!configured||!ready||(session&&list===null))return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:320,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Galerie</span><h1>Les résultats des concours.</h1><p className="muted">Connectez-vous pour voir les illustrations retenues.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;

 const c=list!.find(x=>x.id===contestId)??list![0];
 const officials=c?c.selected.filter(s=>s.kind==='main'&&s.rarity!=='Mythique'):[];
 const mythics=c?.mythics??[];
 const ranking=c?.ranking??[];
 const me=player?.profile.handle;
 const tabs=([['official','Officielles',Brush],['mythics','Mythiques',Gem],['ranking','Classement',Trophy]] as const).filter(([k])=>k!=='mythics'||mythics.length>0);
 const current=tabs.some(([k])=>k===tab)?tab:'official';

 return <div className="page gallery-page">
  <header className="market-head rise"><div><span className="eyebrow">Concours d’illustrations</span><h1>La galerie</h1>
   <p className="muted">Les résultats de chaque concours : illustrations officielles, versions des Mythiques et classement.</p></div>
   <Link className="text-link" href="/concours/"><ArrowLeft size={14}/> Concours</Link></header>
  {error&&<p className="auth-error" role="alert">{error}</p>}
  {!c&&<section className="panel album-empty"><Images size={28}/><h2>Pas encore de concours terminé.</h2><p className="muted">Les résultats apparaîtront ici après la clôture du premier concours.</p><Link className="primary" href="/concours/"><Brush size={15}/> Voir le concours</Link></section>}
  {c&&<section className="panel gallery-contest rise">
   <div className="gallery-head"><div><span className="eyebrow">{c.edition} · clos le {day(c.ends_at)}</span>
    {list!.length>1?<select className="gallery-select" aria-label="Choisir un concours" value={c.id} onChange={e=>setContestId(e.target.value)}>{list!.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select>:<h2>{c.title}</h2>}</div>
    <small className="muted">{c.entries} dessin{c.entries>1?'s':''} · {c.artists} illustrateur{c.artists>1?'s':''}</small></div>
   <div className="segmented social-tabs" role="tablist">{tabs.map(([k,l,I])=><button key={k} role="tab" aria-selected={current===k} onClick={()=>setTab(k)}><I size={15}/> {l}</button>)}</div>

   <div key={`${c.id}-${current}`} className="tab-panel">
   {current==='official'&&(officials.length===0?<p className="muted">Aucune illustration officielle retenue pour l’instant.</p>
    :<ul className="gallery-grid">{officials.map(s=><li key={s.entry_id} className="gallery-item">
     <button className="gallery-card" onClick={()=>setZoom({src:contestImageUrl(s.image_path)??'',caption:`${s.character} · par ${s.author??'un ancien joueur'}`})} aria-label={`Voir le dessin de ${s.author??'un ancien joueur'} pour ${s.character}`}><TarotCard card={socialToCard(s.card)}/></button>
     <div className="gallery-caption"><strong>{s.character}</strong>
      <small>par {s.author?<Link href={`/joueur/?h=${encodeURIComponent(s.author)}`}>{s.author}</Link>:'un ancien joueur'}</small></div>
    </li>)}</ul>)}

   {current==='mythics'&&<div className="gallery-mythics">{mythics.map(m=><section key={m.character_id} className="gallery-mythic">
    <h3>{m.character} <small className="muted">{m.code} · {m.versions.length} version{m.versions.length>1?'s':''}</small></h3>
    <ul className="gallery-grid">{m.versions.map((v,i)=><li key={`${i}-${v.art_path}`} className="gallery-item">
     <button className="gallery-card" disabled={!v.art_path} onClick={()=>v.art_path&&setZoom({src:v.art_path,caption:`${m.character} · ${v.variant??'Illustration officielle'}${v.art_credit?` · par ${v.art_credit}`:''}`})} aria-label={`Voir la version ${v.variant??'officielle'} de ${m.character}`}><TarotCard card={socialToCard(v)}/></button>
     <div className="gallery-caption">
      <span className={`gallery-kind ${v.variant?'alternate':'main'}`}>{v.variant??'Illustration officielle'}</span>
      {v.art_credit&&<small>par {v.art_credit}</small>}</div>
    </li>)}</ul>
   </section>)}</div>}

   {current==='ranking'&&(!c.final?<p className="muted gallery-pending"><Palette size={14}/> Le classement sera publié après la distribution des récompenses.</p>
    :ranking.length===0?<p className="muted">Aucun point marqué.</p>
    :<ol className="ranking">{ranking.map((r,i)=><li key={r.handle} className={`rise ${r.handle===me?'me':''} top-${r.place}`} style={{'--i':Math.min(i,15)} as React.CSSProperties}>
     <span className="rank-pos">{r.place<=3?<Crown size={16}/>:r.place}</span>
     <Link className="person-name" href={`/joueur/?h=${encodeURIComponent(r.handle)}`}>{r.handle}</Link>
     <span className="rank-scores"><strong className="rank-score">{r.points}<small> pt{r.points>1?'s':''}</small></strong></span>
    </li>)}</ol>)}
   </div>
  </section>}
  {zoom&&<div className="picker-zoom" role="dialog" aria-modal="true" aria-label={zoom.caption} onClick={ev=>{if(ev.target===ev.currentTarget)setZoom(null);}} onKeyDown={ev=>{if(ev.key==='Escape'){ev.preventDefault();setZoom(null);}}}>
   <img className="contest-zoom-img" src={zoom.src} alt={zoom.caption}/>
   <p className="picker-wish">{zoom.caption}</p>
   <div className="picker-zoom-actions"><button className="primary ghost" autoFocus onClick={()=>setZoom(null)}><X size={15}/> Fermer</button></div>
  </div>}
 </div>;
}
