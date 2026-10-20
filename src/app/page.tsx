'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {ArrowRight,BookOpen,Coins,Eye,Moon,Sparkles,Users} from 'lucide-react';
import {TarotCard,palette} from '@/components/Card';
import {BoosterSkin} from '@/components/BoosterSkin';
import {useAuth} from '@/components/AuthProvider';
import {CountUp,Countdown,Skeleton} from '@/components/ui';
import {MissionList} from '@/components/MissionList';
import {showcase} from '@/data/demo';
import {ALL_RARITIES} from '@/lib/draw';
import {callRpc,openedToCard,revealOrder,type AlbumEntry,type Mission,type Missions,type Opening} from '@/lib/game';

export default function Home(){
 const {configured,ready,session,player}=useAuth();
 if(configured&&!ready)return <div className="page dash"><Skeleton style={{height:40,width:'45%'}}/><Skeleton style={{height:230,marginTop:18}}/><Skeleton style={{height:160,marginTop:18}}/></div>;
 if(configured&&session)return player?<Dashboard/>:<div className="page dash"><Skeleton style={{height:40,width:'45%'}}/><Skeleton style={{height:230,marginTop:18}}/></div>;
 return <Visitor configured={configured}/>;
}

function Visitor({configured}:{configured:boolean}){
 return <div className="page visitor">
  <section className="visitor-hero">
   <div className="card-fan" aria-hidden="true">{showcase.map((c,i)=><div key={c.id} className="fan-card" style={{'--i':i} as React.CSSProperties}><TarotCard card={c}/></div>)}</div>
   <div className="visitor-copy rise" style={{'--i':2} as React.CSSProperties}>
    <span className="eyebrow">Chronique Camarilla</span>
    <h1>Cartema</h1>
    <p>Le tarot des personnages de la chronique. Ouvrez des boosters, dévoilez les visages, complétez l’album.</p>
    <div className="visitor-actions">{configured?<><Link className="primary" href="/connexion/?mode=inscription">Créer un compte <ArrowRight size={16}/></Link><Link className="primary ghost" href="/connexion/">Se connecter</Link></>:<><Link className="primary" href="/boosters/">Voir l’ouverture <ArrowRight size={16}/></Link><Link className="primary ghost" href="/collection/">Voir l’album</Link></>}</div>
   </div>
  </section>
  <ul className="visitor-facts">
   <li className="rise" style={{'--i':3} as React.CSSProperties}><Moon size={20}/><strong>Deux boosters offerts</strong><span>Chaque jour à 6 h et 18 h, même si vous n’êtes pas là.</span></li>
   <li className="rise" style={{'--i':4} as React.CSSProperties}><Sparkles size={20}/><strong>Sept raretés, trois finitions</strong><span>Standard, Dorée et la très rare Sanglante.</span></li>
   <li className="rise" style={{'--i':5} as React.CSSProperties}><Eye size={20}/><strong>Des visages voilés</strong><span>Chaque carte reste secrète tant que vous ne l’avez pas tirée.</span></li>
  </ul>
 </div>;
}

function Dashboard(){
 const {client,player,refreshPlayer}=useAuth();
 const [album,setAlbum]=useState<AlbumEntry[]|null>(null);
 const [last,setLast]=useState<Opening|null|undefined>(undefined);
 const [missions,setMissions]=useState<Missions|null>(null);
 const [claiming,setClaiming]=useState(false);
 const loadMissions=useCallback(()=>{if(client)void callRpc<Missions>(client,'get_missions').then(setMissions).catch(()=>{});},[client]);
 useEffect(()=>{loadMissions();},[loadMissions]);
 async function claim(m:Mission){if(!client)return;setClaiming(true);try{await callRpc(client,'claim_mission',{p_assignment_id:m.assignment_id});loadMissions();void refreshPlayer();}finally{setClaiming(false);}}
 useEffect(()=>{
  if(!client)return;
  let alive=true;
  callRpc<AlbumEntry[]>(client,'get_album').then(a=>{if(alive)setAlbum(a);}).catch(()=>{if(alive)setAlbum([]);});
  client.from('pack_openings').select('id').order('created_at',{ascending:false}).limit(1).then(async({data})=>{
   const id=data?.[0]?.id;
   const o=id?await callRpc<Opening>(client,'get_opening',{p_opening_id:id}).catch(()=>null):null;
   if(alive)setLast(o);
  });
  return()=>{alive=false;};
 },[client]);
 const onSlot=useCallback(()=>{void refreshPlayer();},[refreshPlayer]);

 const stats=useMemo(()=>{
  if(!album)return null;
  const total=album.length,found=album.filter(c=>c.known).length;
  const byRarity=ALL_RARITIES.map(r=>({rarity:r,total:album.filter(c=>c.rarity===r&&!c.unique).length,found:album.filter(c=>c.rarity===r&&!c.unique&&c.known).length}));
  return {total,found,byRarity};
 },[album]);
 if(!player)return null;
 const b=player.boosters,available=b.free+b.purchased,full=b.free>=b.free_capacity;
 const hour=new Date().getHours();
 const lastCards=last?revealOrder(last.cards.map(openedToCard)).reverse():[];

 return <div className="page dash">
  <header className="dash-head rise">
   <div><span className="eyebrow">{hour>=5&&hour<18?'Bonjour':'Bonsoir'}</span><h1>{player.profile.handle??'Collectionneur'}</h1></div>
   <span className="chip gold"><Coins size={15}/><CountUp value={player.balance}/> <small>Deniers</small></span>
  </header>

  {(player.social_pending??0)>0&&<Link href="/amis/" className="social-alert rise"><Users size={16}/> <span><strong>{player.social_pending}</strong> invitation{player.social_pending!>1?'s':''}, cadeau{player.social_pending!>1?'x':''} ou échange{player.social_pending!>1?'s':''} en attente</span><ArrowRight size={14}/></Link>}
  <section className="panel reserve-card rise" style={{'--i':1} as React.CSSProperties}>
   <Link href="/boosters/" className="reserve-pack" aria-label="Aller ouvrir un booster"><BoosterSkin/></Link>
   <div className="reserve-info">
    <span className="eyebrow">Votre réserve</span>
    <p className="reserve-count"><strong><CountUp value={available}/></strong> booster{available>1?'s':''} prêt{available>1?'s':''}</p>
    <div className="reserve-pips" aria-label={`${b.free} boosters gratuits sur ${b.free_capacity}`}>{Array.from({length:b.free_capacity},(_,i)=><i key={i} className={i<b.free?'on':''}/>)}<small>{b.free}/{b.free_capacity} gratuits{b.purchased?` · ${b.purchased} acheté${b.purchased>1?'s':''}`:''}</small></div>
    <p className="reserve-next">{full?'Réserve pleine : ouvrez-en un pour ne pas perdre le prochain.':<>Prochain booster gratuit dans <Countdown to={b.next_free_at} onDone={onSlot}/></>}</p>
    <div className="reserve-actions">{available>0&&<Link className="primary ghost compact" href="/boosters/"><Sparkles size={14}/> {available>1?'Ouvrir mes boosters':'Ouvrir un booster'}</Link>}{available>0?<Link className="text-link buy-link" href="/boosters/?boutique=1"><Coins size={12}/> Acheter des boosters</Link>:<Link className="primary" href="/boosters/?boutique=1"><Coins size={16}/> Acheter des boosters</Link>}</div>
   </div>
  </section>

  <section className="panel progress-card rise" style={{'--i':2} as React.CSSProperties}>
   <div className="section-header"><div><span className="eyebrow">Votre album</span><h2>{stats?<><CountUp value={stats.found}/> <small>/ {stats.total} visages</small></>:<Skeleton style={{height:26,width:140}}/>}</h2></div><Link className="text-link" href="/collection/"><BookOpen size={14}/> Ouvrir</Link></div>
   <div className="meter" aria-hidden="true"><i style={{'--v':`${stats&&stats.total?stats.found/stats.total*100:0}%`} as React.CSSProperties}/></div>
   <ul className="rarity-progress">{(stats?.byRarity??ALL_RARITIES.map(r=>({rarity:r,total:0,found:0}))).map(r=><li key={r.rarity} style={{'--rc':palette[r.rarity]} as React.CSSProperties}><span>{r.rarity}</span><b>{stats?`${r.found}/${r.total}`:'…'}</b></li>)}</ul>
  </section>

  <section className="panel dash-missions rise" style={{'--i':3} as React.CSSProperties}>
   <div className="section-header"><div><span className="eyebrow">Missions du jour</span>{missions&&<h2><Countdown to={missions.daily_reset} onDone={loadMissions}/> <small>restantes</small></h2>}</div><Link className="text-link" href="/progression/">Tout voir <ArrowRight size={14}/></Link></div>
   {!missions?<Skeleton style={{height:150}}/>:<MissionList missions={missions.daily} busy={claiming} canReplace={false} onClaim={m=>void claim(m)}/>}
  </section>

  <section className="dash-last rise" style={{'--i':4} as React.CSSProperties}>
   <div className="section-header"><div><span className="eyebrow">Dernier tirage</span><h2>{last?new Date(last.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'}):'Aucun pour l’instant'}</h2></div>{last&&<Link className="text-link" href="/collection/">Collection <ArrowRight size={14}/></Link>}</div>
   {last===undefined?<div className="last-row">{Array.from({length:5},(_,i)=><Skeleton key={i} className="skeleton-card"/>)}</div>
    :last?<div className="last-row">{lastCards.map((c,i)=><div key={i} className="rise" style={{'--i':i} as React.CSSProperties}><TarotCard card={c}/></div>)}</div>
    :<p className="muted">Vos cartes apparaîtront ici après votre première ouverture.</p>}
  </section>
 </div>;
}

