'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {Brush,Check,Clock,Crown,Flag,Flame,Heart,ImagePlus,Images,Palette,ScrollText,Search,Trophy,X} from 'lucide-react';
import {useAuth} from '@/components/AuthProvider';
import {useAsk} from '@/components/AskDialog';
import {CardBack,TarotCard,palette} from '@/components/Card';
import {Countdown,Sheet,Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc,socialToCard,type Contest,type ContestCard,type ContestEntry,type ContestRank} from '@/lib/game';
import {prepareContestImage} from '@/lib/admin';
import {defaultContestRules,parseContestRules,type RuleItem} from '@/lib/contest';
import {contestImageUrl} from '@/lib/paths';

type Tab='cards'|'ranking'|'rules';
type Filter='all'|'priority'|'entries'|'mine'|'empty';
const dateFr=(iso:string)=>new Date(iso).toLocaleString('fr-FR',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const fr=(n:number)=>n.toLocaleString('fr-FR');

export default function Concours(){
 const {configured,ready,session,client,player}=useAuth();
 const [ask,askNode]=useAsk();
 const [tab,setTab]=useState<Tab>('cards');
 const [contest,setContest]=useState<Contest|null|undefined>(undefined);
 const [ranking,setRanking]=useState<ContestRank[]|null>(null);
 const [query,setQuery]=useState('');
 const [rarity,setRarity]=useState<Rarity|''>('');
 const [filter,setFilter]=useState<Filter>('all');
 const [open,setOpen]=useState<ContestCard|null>(null);
 const [message,setMessage]=useState<{error?:string;notice?:string}>({});

 const load=useCallback(async()=>{
  if(!client)return;
  try{const [c,r]=await Promise.all([callRpc<Contest|null>(client,'get_contest'),callRpc<ContestRank[]>(client,'get_contest_leaderboard')]);setContest(c);setRanking(r);if(c?.upcoming)setTab('rules');
   setOpen(o=>o&&(c?.cards.find(x=>x.character_id===o.character_id)??null));}
  catch(e){setMessage({error:(e as Error).message});setContest(null);}
 },[client]);
 useEffect(()=>{if(session)void load();},[session,load]);
 useEffect(()=>{if(!message.notice)return;const t=setTimeout(()=>setMessage({}),5000);return()=>clearTimeout(t);},[message.notice]);

 // Cartes à privilégier : sans illustration ou illustration IA, points multipliés.
 const mult=contest?.priority_multiplier??2;
 const prioCount=(contest?.cards??[]).filter(c=>c.priority).length;
 const cards=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return (contest?.cards??[]).filter(c=>(!q||c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q)||(c.clan??'').toLowerCase().includes(q))
   &&(!rarity||c.rarity===rarity)&&(filter==='all'||(filter==='priority'&&!!c.priority)||(filter==='entries'&&c.entries>0)||(filter==='mine'&&c.mine)||(filter==='empty'&&c.entries===0)));
 },[contest,query,rarity,filter]);

 if(!configured||!ready)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:260,marginTop:16}}/></div>;
 if(!session)return <div className="page auth-screen"><section className="panel auth-panel"><span className="eyebrow">Concours</span><h1>Le concours d’illustrations.</h1><p className="muted">Connectez-vous pour proposer vos dessins et voter.</p><Link className="primary" href="/connexion/">Se connecter</Link></section></div>;
 if(contest===undefined)return <div className="page"><Skeleton style={{height:40,width:'40%'}}/><Skeleton style={{height:260,marginTop:16}}/></div>;
 if(contest===null)return <div className="page"><section className="panel album-empty"><Palette size={28}/><h2>Aucun concours en cours.</h2><p className="muted">Le prochain concours d’illustrations sera annoncé ici.</p><Link className="primary" href="/concours/galerie/"><Images size={15}/> Voir la galerie</Link><Link className="primary ghost" href="/">Retour à l’accueil</Link></section></div>;

 const me=ranking?.find(r=>r.me);
 return <div className="page contest-page">
  {askNode}
  <header className="market-head rise"><div><span className="eyebrow">Concours d’illustrations · {contest.edition}</span><h1>{contest.title}</h1>
   <p className="muted contest-when">{contest.upcoming?<><Clock size={13}/> Commence dans <Countdown to={contest.starts_at} onDone={()=>void load()}/> · {dateFr(contest.starts_at)}</>:contest.open?<><Clock size={13}/> Se termine dans <Countdown to={contest.ends_at} onDone={()=>void load()}/> · {dateFr(contest.ends_at)}</>:contest.rewarded?'Concours terminé : les récompenses ont été distribuées.':'Concours terminé : validation des dessins en cours.'}</p></div>
   <span className="chip gold"><Trophy size={15}/> {me?<>{me.points} pt{me.points>1?'s':''}<small> · {me.position}{me.position===1?'er':'e'}</small></>:<>0 pt<small> · {contest.my_entries} dessin{contest.my_entries>1?'s':''}</small></>}</span></header>
  <div className="segmented social-tabs" role="tablist">{([['cards','Cartes',Brush],['ranking','Classement',Trophy],['rules','Règles',ScrollText]] as const).map(([k,l,I])=><button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)}><I size={15}/> {l}</button>)}</div>
  <div className="admin-toast" aria-live="polite">{message.error&&<p className="auth-error" role="alert">{message.error}<button className="icon-button" aria-label="Fermer" onClick={()=>setMessage({})}><X size={16}/></button></p>}{message.notice&&<p className="auth-notice">{message.notice}</p>}</div>

  <div key={tab} className="tab-panel">
  {tab==='cards'&&contest.upcoming&&<section className="panel album-empty"><Palette size={28}/><h2>Les cartes arrivent au lancement.</h2><p className="muted">Vous pourrez proposer vos dessins et voter dès le {dateFr(contest.starts_at)}. Préparez vos crayons : lisez les règles en attendant.</p><button className="primary ghost" onClick={()=>setTab('rules')}><ScrollText size={15}/> Lire les règles</button></section>}
  {tab==='cards'&&!contest.upcoming&&<>
   {!player?.profile.handle&&<p className="trade-lock"><Palette size={15}/> Choisissez un <Link className="text-link" href="/profile/">pseudonyme</Link> pour proposer vos dessins.</p>}
   <div className="market-filters">
    <label className="search-field"><Search size={18}/><input aria-label="Rechercher une carte" placeholder="Nom, numéro ou clan…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <select aria-label="Rareté" value={rarity} onChange={e=>setRarity(e.target.value as Rarity|'')}><option value="">Toutes raretés</option>{ALL_RARITIES.filter(r=>contest.allow_mythic||r!=='Mythique').map(r=><option key={r}>{r}</option>)}</select>
    <select aria-label="Filtrer" value={filter} onChange={e=>setFilter(e.target.value as Filter)}><option value="all">Toutes les cartes</option><option value="priority">À privilégier</option><option value="entries">Avec des dessins</option><option value="empty">Sans dessin</option><option value="mine">Mes propositions</option></select>
   </div>
   <p className="market-count muted">{cards.length} carte{cards.length>1?'s':''} {contest.allow_mythic?' · Mythiques comprises':' · les Mythiques ne sont pas au concours'} · <Link className="text-link" href="/concours/galerie/"><Images size={12}/> Galerie des concours</Link></p>
   {prioCount>0&&<button className={`prio-banner ${filter==='priority'?'on':''}`} onClick={()=>setFilter(filter==='priority'?'all':'priority')}><Flame size={16}/><span><strong>{prioCount} carte{prioCount>1?'s':''} à privilégier · points ×{mult}</strong><small>Sans illustration ou illustration IA : le dessin en tête et le dessin retenu y valent {mult} points.</small></span><b>{filter==='priority'?'Toutes les cartes':'Les voir'}</b></button>}
   <div className="card-grid contest-grid">{cards.map((c,i)=><button key={c.character_id} className="contest-card rise" style={{'--i':Math.min(i,12)} as React.CSSProperties} onClick={()=>setOpen(c)} aria-label={`${c.code} ${c.name} : ${c.entries} dessin${c.entries>1?'s':''}`}>
    <ContestCardFace c={c}/>
    <span className="contest-meta"><strong>{c.entries}</strong> dessin{c.entries>1?'s':''}{c.leader&&<small><Crown size={11}/> {c.leader}</small>}</span>
    {c.priority&&<span className="prio-badge" title={`Carte à privilégier : points ×${mult}`}><Flame size={11}/>×{mult}</span>}
    {(c.mine||c.voted)&&<span className="contest-flags">{c.mine&&<i title="Votre dessin"><Brush size={11}/></i>}{c.voted&&<i title="Vous avez voté"><Heart size={11}/></i>}</span>}
   </button>)}</div>
  </>}
  {tab==='ranking'&&(!ranking?<Skeleton style={{height:260}}/>:<section className="social-section">
   <p className="muted">1 point par carte où votre dessin est en tête des votes, puis, après la clôture, 1 point par dessin retenu et 1 point de plus pour un vrai dessin.</p>
   {ranking.length===0?<p className="muted">Personne n’a encore de point : proposez le premier dessin !</p>
   :<ol className="ranking">{ranking.map((r,i)=><li key={r.handle} className={`rise ${r.me?'me':''} top-${r.position}`} style={{'--i':Math.min(i,15)} as React.CSSProperties}>
    <span className="rank-pos">{r.position<=3?<Crown size={16}/>:r.position}</span>
    <Link className="person-name" href={`/joueur/?h=${encodeURIComponent(r.handle)}`}>{r.handle}<small className="rank-title">{[r.leads&&`${r.leads} en tête`,r.selected&&`${r.selected} retenu${r.selected>1?'s':''}`,r.real&&`${r.real} vrai${r.real>1?'s':''} dessin${r.real>1?'s':''}`].filter(Boolean).join(' · ')}</small></Link>
    <span className="rank-scores"><strong className="rank-score">{r.points}<small> pt{r.points>1?'s':''}</small></strong></span>
   </li>)}</ol>}
  </section>)}
  {tab==='rules'&&<Rules contest={contest}/>}
  </div>

  {client&&<Sheet open={!!open} onClose={()=>setOpen(null)} title={open?`${open.code} · ${open.discovered?open.name:`${open.name} (non découverte)`}`:''}>
   {open&&<CardEntries card={open} contest={contest} client={client} canSubmit={!!player?.profile.handle} ask={ask} onChanged={n=>{if(n)setMessage({notice:n});void load();}} onError={e=>setMessage({error:e})}/>}
  </Sheet>}
 </div>;
}

/** Carte découverte : son rendu ; sinon carte neutre avec seulement le nom et le clan. */
function ContestCardFace({c}:{c:ContestCard}){
 if(c.discovered&&c.card)return <TarotCard card={socialToCard(c.card)}/>;
 return <span className="contest-neutral" style={{'--rc':palette[c.rarity]} as React.CSSProperties}><CardBack/><span className="contest-neutral-text"><small>{c.code}</small><strong>{c.name}</strong><em>{c.clan??'Clan inconnu'}</em><small>{c.rarity}</small></span></span>;
}

function CardEntries({card,contest,client,canSubmit,ask,onChanged,onError}:{card:ContestCard;contest:Contest;client:NonNullable<ReturnType<typeof useAuth>['client']>;canSubmit:boolean;ask:ReturnType<typeof useAsk>[0];onChanged:(notice?:string)=>void;onError:(e:string)=>void}){
 const [entries,setEntries]=useState<ContestEntry[]|null>(null);
 const [busy,setBusy]=useState(false);
 const [zoom,setZoom]=useState<ContestEntry|null>(null);
 // Rappels du parent recréés à chaque rendu : gardés en référence pour ne pas relancer le chargement en boucle.
 const errorRef=useRef(onError);errorRef.current=onError;
 const load=useCallback(async()=>{setEntries(await callRpc<ContestEntry[]>(client,'get_contest_card',{p_character_id:card.character_id}).catch(e=>{errorRef.current((e as Error).message);return [];}));},[client,card.character_id]);
 useEffect(()=>{setEntries(null);void load();},[load]);
 const mine=entries?.find(e=>e.mine);
 async function run(action:()=>Promise<string|undefined>){
  setBusy(true);
  try{const n=await action();await load();onChanged(n);}catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 async function upload(file:File){
  if(mine&&(await ask({title:'Remplacer votre dessin ?',message:`Votre dessin actuel pour ${card.name} sera remplacé et ses ${mine.votes} vote${mine.votes>1?'s':''} repartiront à zéro.`,confirmLabel:'Remplacer'}))===null)return;
  await run(async()=>{
   const blob=await prepareContestImage(file);
   const {data:{user}}=await client.auth.getUser();if(!user)throw new Error('Session expirée : reconnectez-vous.');
   const path=`${user.id}/${crypto.randomUUID()}.webp`;
   const up=await client.storage.from('contest').upload(path,blob,{contentType:'image/webp',upsert:false});
   if(up.error)throw new Error(`Envoi impossible : ${up.error.message}`);
   await callRpc(client,'submit_contest_entry',{p_character_id:card.character_id,p_image_path:path});
   return mine?'Dessin remplacé.':'Dessin proposé. Bonne chance !';
  });
 }
 const vote=(e:ContestEntry)=>void run(async()=>{await callRpc(client,'vote_contest_entry',{p_entry_id:e.entry_id,p_on:!e.my_vote});return e.my_vote?'Vote retiré.':`Vote pour le dessin de ${e.author}.`;});
 async function report(e:ContestEntry){
  const reason=await ask({title:'Signaler ce dessin ?',message:`Dessin de ${e.author}. L’équipe sera prévenue ; dites-nous pourquoi.`,inputLabel:'Raison',confirmLabel:'Signaler'});
  if(reason===null)return;
  await run(async()=>{await callRpc(client,'report_contest_entry',{p_entry_id:e.entry_id,p_reason:reason});return 'Signalement envoyé. Merci.';});
 }
 return <div className="contest-sheet">
  <div className="contest-sheet-head"><div className="contest-sheet-card"><ContestCardFace c={card}/></div>
   <div className="contest-sheet-info">
    <p className="muted">{card.rarity}{card.clan?` · ${card.clan}`:''}{card.discovered?'':' · carte non découverte : son illustration reste cachée'}</p>
    {contest.open?<>
     <p className="muted small-note">Un dessin par joueur et par carte, un vote par carte (pas pour soi). Le dessin en tête rapporte 1 point à son auteur.</p>
     {canSubmit?<label className={`feedback-file primary ${busy?'is-busy':''}`}><ImagePlus size={15}/><span>{busy?'Envoi…':mine?'Remplacer mon dessin':'Proposer mon dessin'}</span><input type="file" accept="image/png,image/webp,image/jpeg" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/></label>
      :<p className="muted">Choisissez un pseudonyme dans votre profil pour proposer un dessin.</p>}
    </>:<p className="muted">Concours terminé : les votes sont clos.</p>}
   </div>
  </div>
  {!entries?<Skeleton style={{height:160}}/>:entries.length===0?<p className="muted">Aucun dessin pour cette carte : soyez le premier !</p>
  :<ul className="contest-entries">{entries.map(e=><li key={e.entry_id} className={`${e.leading?'leading':''} ${e.mine?'mine':''}`}>
    <button className="contest-entry-img" onClick={()=>setZoom(e)} aria-label={`Agrandir le dessin de ${e.author}`}>{contestImageUrl(e.image_path)?<img src={contestImageUrl(e.image_path)} alt={`Dessin de ${e.author}`} loading="lazy"/>:<span className="muted">Image indisponible</span>}</button>
    <div className="contest-entry-info">
     <span className="contest-entry-author">{e.leading&&<Crown size={13}/>} {e.author}{e.mine&&<small> · vous</small>}{e.selected&&<small className="selected-pill"><Check size={11}/> retenu</small>}</span>
     <span className="contest-entry-votes"><Heart size={13}/> {fr(e.votes)} vote{e.votes>1?'s':''}</span>
     <span className="contest-entry-actions">
      {!e.mine&&contest.open&&<button className={`primary compact ${e.my_vote?'':'ghost'}`} disabled={busy} onClick={()=>vote(e)}><Heart size={13}/> {e.my_vote?'Mon vote':'Voter'}</button>}
      {!e.mine&&<button className="text-link" disabled={busy} onClick={()=>void report(e)}><Flag size={12}/> Signaler</button>}
     </span>
    </div>
   </li>)}</ul>}
  {zoom&&<div className="picker-zoom" role="dialog" aria-modal="true" aria-label={`Dessin de ${zoom.author}`} onClick={ev=>{if(ev.target===ev.currentTarget)setZoom(null);}} onKeyDown={ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();setZoom(null);}}}>
   <img className="contest-zoom-img" src={contestImageUrl(zoom.image_path)} alt={`Dessin de ${zoom.author}`}/>
   <p className="picker-wish">{zoom.author} · {zoom.votes} vote{zoom.votes>1?'s':''}</p>
   <div className="picker-zoom-actions"><button className="primary ghost" autoFocus onClick={()=>setZoom(null)}><X size={15}/> Fermer</button></div>
  </div>}
 </div>;
}

/** Règles du concours : dates et barème réels, puis les règles écrites par l'admin ou, à défaut, celles du site. */
function Rules({contest}:{contest:Contest}){
 const places=contest.rewards.places;
 const rule=(r:RuleItem,k:number)=><li key={k}>{r.title&&<strong>{r.title}</strong>} {r.text}</li>;
 const defaults=defaultContestRules(contest.edition,!!contest.allow_mythic);
 return <section className="social-section contest-rules">
  <h2>Règles du concours</h2>
  <ol>
   <li><strong>Dates.</strong> Du {dateFr(contest.starts_at)} au {dateFr(contest.ends_at)}. Après la fin, plus de dessins ni de votes.</li>
   <li><strong>Cartes à privilégier ×{contest.priority_multiplier??2}.</strong> Les cartes sans illustration, ou dont l’illustration a été générée par IA, portent la pastille « ×{contest.priority_multiplier??2} » : être en tête des votes ou voir son dessin retenu y rapporte {contest.priority_multiplier??2} points au lieu de 1. Ce sont les cartes qui ont le plus besoin de vos crayons !</li>
   {contest.rules&&contest.allow_mythic&&<li><strong>Mythiques.</strong> Elles sont au concours (jamais la carte unique) : un dessin retenu doit être à la hauteur de leur rang, il doit faire mythique. La carte est alors offerte en Standard.</li>}
   {contest.rules
    ?parseContestRules(contest.rules).map((x,k)=>x.kind==='rule'?rule(x.item,k):<li key={k} className="plain">{x.text}</li>)
    :defaults.before.map(rule)}
   <li><strong>Récompenses.</strong> {places.map(p=>`${p.from===p.to?`${p.from}${p.from===1?'er':'e'}`:`${p.from}e à ${p.to}e`} : ${fr(p.deniers)} Deniers et ${p.boosters} booster${p.boosters>1?'s':''}`).join(' · ')} · au-delà, avec au moins 1 point : {fr(contest.rewards.others.deniers)} Deniers et {contest.rewards.others.boosters} booster{contest.rewards.others.boosters>1?'s':''}.</li>
   {!contest.rules&&defaults.after.map((r,k)=>rule(r,100+k))}
  </ol>
 </section>;
}
