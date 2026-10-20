'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowDownWideNarrow,ArrowUpWideNarrow,BookOpen,Search,SlidersHorizontal,X,RotateCcw} from 'lucide-react';
import {CardInspection} from '@/components/CardInspection';
import {demoCards} from '@/data/demo';
import {ALL_RARITIES,type Rarity,type Finish} from '@/lib/draw';
import {initialAlbumFilters,selectAlbum,type AlbumFilters} from '@/lib/album';
import {useAuth} from '@/components/AuthProvider';
import {albumToCard,callRpc,type AlbumCard,type AlbumEntry} from '@/lib/game';

type Edition={id:string;name:string;prefix:string};

export default function Collection(){
 const [filters,setFilters]=useState<AlbumFilters>(initialAlbumFilters);
 const [expanded,setExpanded]=useState(false);
 const {configured,session,client}=useAuth();
 const live=Boolean(configured&&session&&client);
 const [album,setAlbum]=useState<AlbumCard[]|null>(null);
 const [editions,setEditions]=useState<Edition[]>([]);
 const [editionId,setEditionId]=useState<string>('all');
 const [loadError,setLoadError]=useState<string|null>(null);
 useEffect(()=>{
  if(!live||!client)return;
  let alive=true;
  // Les cartes non découvertes arrivent déjà anonymisées par le serveur.
  Promise.all([callRpc<AlbumEntry[]>(client,'get_album'),client.from('editions').select('id,name,prefix').order('created_at')])
   .then(([entries,eds])=>{if(!alive)return;setAlbum(entries.map(albumToCard));setEditions((eds.data??[]) as Edition[]);setLoadError(null);})
   .catch(e=>{if(alive)setLoadError((e as Error).message);});
  return()=>{alive=false;};
 },[live,client]);
 const source:AlbumCard[]=useMemo(()=>live?(album??[]).filter(c=>editionId==='all'||c.editionId===editionId):demoCards,[live,album,editionId]);
 const cards=useMemo(()=>selectAlbum(source,filters),[source,filters]);
 const clans=useMemo(()=>[...new Set(source.filter(c=>c.known&&c.clan!=='?').map(c=>c.clan))].sort((a,b)=>a.localeCompare(b,'fr')),[source]);
 const discovered=source.filter(c=>c.known).length;
 const editionName=live?(editions.find(e=>e.id===editionId)?.name??(editions.length===1?editions[0].name:'Toutes les éditions')):'Camarilla';
 const active=[filters.clan!=='all',filters.rarity!=='all',filters.finish!=='all'].filter(Boolean).length;
 function update<K extends keyof AlbumFilters>(key:K,value:AlbumFilters[K]){setFilters(old=>({...old,[key]:value}));}
 function reset(){setFilters(initialAlbumFilters);}
 return <div className="page album-page"><header className="album-heading"><div><div className="eyebrow">Les archives de Cartema</div><h1>Votre cabinet<br/><em>de curiosités.</em></h1><p className="muted">Chaque visage dévoilé laisse une trace.</p></div><div className="album-progress"><div className="album-progress-title"><BookOpen size={17}/><span>{live?editionName:'Édition Camarilla'}</span>{!live&&<span className="album-edition-tag">Aperçu</span>}</div><div className="album-progress-numbers"><strong>{discovered}<small> / {source.length}</small></strong><span>visages découverts</span></div><progress aria-label={live?'Personnages découverts':'Personnages découverts dans cet aperçu'} value={discovered} max={Math.max(1,source.length)}/><p>Les cartes voilées gardent leur secret.</p></div></header>
 <section className="album-toolbar" aria-label="Recherche et filtres de l’album"><div className="album-search-row"><label className="search-field"><Search size={18}/><input aria-label="Rechercher une carte" placeholder="Rechercher…" value={filters.query} onChange={e=>update('query',e.target.value)}/>{filters.query&&<button className="search-clear" aria-label="Effacer la recherche" onClick={()=>update('query','')}><X size={16}/></button>}</label><button className={`filter-toggle ${expanded?'on':''}`} aria-expanded={expanded} aria-controls="album-filters" onClick={()=>setExpanded(!expanded)}><SlidersHorizontal size={17}/><span>Filtres</span>{active>0&&<b>{active}</b>}</button></div>
 <div className="album-status-tabs" aria-label="État de découverte">{([{value:'all',label:'Toutes',count:source.length},{value:'known',label:'Découvertes',count:discovered},{value:'missing',label:'À découvrir',count:source.length-discovered}] as const).map(t=><button className={filters.status===t.value?'on':''} key={t.value} aria-pressed={filters.status===t.value} onClick={()=>update('status',t.value)}>{t.label}<span>{t.count}</span></button>)}</div>
 {expanded&&<div id="album-filters" className="album-filter-fields">{live&&editions.length>1&&<label><span>Édition</span><select value={editionId} onChange={e=>setEditionId(e.target.value)}><option value="all">Toutes les éditions</option>{editions.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}<label><span>Clan</span><select value={filters.clan} onChange={e=>update('clan',e.target.value)}><option value="all">Tous les clans</option>{clans.map(clan=><option key={clan}>{clan}</option>)}</select></label><label><span>Rareté</span><select value={filters.rarity} onChange={e=>update('rarity',e.target.value as Rarity|'all')}><option value="all">Toutes les raretés</option>{ALL_RARITIES.map(r=><option key={r}>{r}</option>)}</select></label><label><span>Finition</span><select value={filters.finish} onChange={e=>update('finish',e.target.value as Finish|'all')}><option value="all">Toutes les finitions</option>{['Standard','Dorée','Sanglante'].map(f=><option key={f}>{f}</option>)}</select></label><button className="reset-filters" onClick={reset}><RotateCcw size={15}/> Réinitialiser</button></div>}
 </section>
 {active>0&&<div className="active-filters" aria-label="Filtres actifs">{filters.clan!=='all'&&<button onClick={()=>update('clan','all')} aria-label={`Retirer le filtre clan ${filters.clan}`}>{filters.clan}<X size={13}/></button>}{filters.rarity!=='all'&&<button onClick={()=>update('rarity','all')} aria-label={`Retirer le filtre rareté ${filters.rarity}`}>{filters.rarity}<X size={13}/></button>}{filters.finish!=='all'&&<button onClick={()=>update('finish','all')} aria-label={`Retirer le filtre finition ${filters.finish}`}>{filters.finish}<X size={13}/></button>}</div>}
 <div className="album-results-row"><p className="collection-count" aria-live="polite">{cards.length} {cards.length>1?'cartes':'carte'}<span> · {editionName}</span></p><div className="album-sort"><select aria-label="Trier les cartes" value={filters.sort} onChange={e=>update('sort',e.target.value as AlbumFilters['sort'])}><option value="number">Numéro</option><option value="name">Nom</option><option value="rarity">Rareté</option><option value="clan">Clan</option></select><button className="icon-button" aria-label={filters.descending?'Passer au tri croissant':'Passer au tri décroissant'} onClick={()=>update('descending',!filters.descending)}>{filters.descending?<ArrowUpWideNarrow size={17}/>:<ArrowDownWideNarrow size={17}/>}</button></div></div>
 <div className="card-grid album-grid">{cards.map(c=><div className="album-card-cell" key={c.id}><CardInspection card={c}/><span className={`discovery-status ${c.known?'known':''}`}>{c.known?(live?(c.owned?`Dévoilée · ×${c.owned}`:'Dévoilée · cédée'):'Dévoilée'):'À découvrir'}</span></div>)}</div>
 {live&&!album&&!loadError&&<p className="muted" aria-live="polite">Ouverture des archives…</p>}{loadError&&<p className="auth-error" role="alert">{loadError}</p>}{live&&album&&!source.length&&<div className="album-empty"><BookOpen size={28}/><h2>Les archives sont encore vides.</h2><p>Aucune carte n’a été publiée pour le moment.</p></div>}{!cards.length&&source.length>0&&<div className="album-empty"><Search size={28}/><h2>Aucun visage dans le miroir.</h2><p>Essayez un autre nom ou allégez vos filtres.</p><button className="primary ghost" onClick={reset}><RotateCcw size={16}/> Réinitialiser les filtres</button></div>}
 {!live&&<p className="demo-note">Album de démonstration · Clans et raretés des illustrations ajoutées à définir.{configured&&<> <Link className="text-link" href="/connexion/">Se connecter pour voir sa collection</Link></>}</p>}</div>;
}
