'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {palette} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc} from '@/lib/game';

type Day={day:string;openings:number;active:number;signups:number};
type Stats={days:number;
 players:{total:number;new:number;active_today:number;active_7d:number;active_period:number;suspended:number};
 boosters:{opened_total:number;opened_period:number;free_period:number;purchased_period:number;in_reserve:number;rarities:Partial<Record<Rarity,number>>;gold_period:number;blood_period:number;unique_found:boolean};
 economy:{circulation:number;created_period:number;shop_period:number;commission_period:number;sources:Record<string,number>};
 market:{sales_period:number;volume_period:number;active_fixed:number;active_auctions:number};
 social:{friendships:number;trades_period:number;gifts_period:number;recycled_period:number};
 series:Day[];recent_players:{handle:string;created_at:string}[]};

const SOURCE_LABEL:Record<string,string>={daily_login:'Bonus de connexion',discovery_reward:'Découvertes',mission_reward:'Missions',achievement_reward:'Succès',recycle:'Recyclage',admin_adjust:'Ajustements admin'};
// Espace insécable classique : l'espace fine du format français manque à la police.
const fmt=(n:number)=>n.toLocaleString('fr-FR').replace(/ /g,' ');
const compact=(n:number)=>n>=10000?`${Math.round(n/1000)} k`:n>=1000?`${(n/1000).toFixed(1).replace('.',',')} k`:String(n);
const dayLabel=(d:string,long=false)=>new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR',long?{weekday:'long',day:'numeric',month:'long'}:{day:'numeric',month:'short'});

/** Tableau de bord d'administration : tuiles, séries journalières, répartitions. */
export function StatsTab({client}:{client:SupabaseClient}){
 const [days,setDays]=useState(30);
 const [stats,setStats]=useState<Stats|null>(null);
 const [error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{setError(null);try{setStats(await callRpc<Stats>(client,'admin_stats',{p_days:days}));}catch(e){setError((e as Error).message);}},[client,days]);
 useEffect(()=>{void load();},[load]);
 if(error)return <p className="auth-error" role="alert">{error}</p>;
 if(!stats)return <div className="stats-grid">{Array.from({length:8},(_,i)=><Skeleton key={i} style={{height:96}}/>)}</div>;
 const s=stats,period=`${s.days} j`;
 const tiles:{label:string;value:string;note?:string}[]=[
  {label:'Joueurs inscrits',value:fmt(s.players.total),note:`+${fmt(s.players.new)} sur ${period}`},
  {label:'Actifs aujourd’hui',value:fmt(s.players.active_today),note:`${fmt(s.players.active_7d)} sur 7 j · ${fmt(s.players.active_period)} sur ${period}`},
  {label:`Boosters ouverts (${period})`,value:fmt(s.boosters.opened_period),note:`${fmt(s.boosters.free_period)} gratuits · ${fmt(s.boosters.purchased_period)} achetés`},
  {label:'Boosters en réserve',value:fmt(s.boosters.in_reserve),note:`${fmt(s.boosters.opened_total)} ouverts depuis le début`},
  {label:'Deniers en circulation',value:fmt(s.economy.circulation),note:`+${fmt(s.economy.created_period)} créés sur ${period}`},
  {label:`Dépensés en boutique (${period})`,value:fmt(s.economy.shop_period),note:`${fmt(s.economy.commission_period)} de commissions du marché`},
  {label:`Ventes au marché (${period})`,value:fmt(s.market.sales_period),note:`${fmt(s.market.volume_period)} Deniers · ${s.market.active_fixed} en vente, ${s.market.active_auctions} enchères`},
  {label:`Finitions rares (${period})`,value:`${fmt(s.boosters.gold_period)} · ${fmt(s.boosters.blood_period)}`,note:`dorées · sanglantes${s.boosters.unique_found?' · Caïn a été tiré':' · Caïn pas encore tiré'}`},
 ];
 return <div className="admin-stats">
  <div className="stats-filter" role="radiogroup" aria-label="Période">{[7,30,90].map(d=><button key={d} role="radio" aria-checked={days===d} className={days===d?'on':''} onClick={()=>setDays(d)}>{d} jours</button>)}</div>
  <ul className="stats-grid">{tiles.map(t=><li key={t.label} className="panel stat-tile"><span className="stat-label">{t.label}</span><strong>{t.value}</strong>{t.note&&<small>{t.note}</small>}</li>)}</ul>
  <div className="stats-charts">
   <ColumnChart title="Boosters ouverts par jour" unit="booster" series={s.series} pick={d=>d.openings}/>
   <ColumnChart title="Joueurs actifs par jour" unit="joueur" series={s.series} pick={d=>d.active}/>
   <ColumnChart title="Inscriptions par jour" unit="inscription" series={s.series} pick={d=>d.signups}/>
  </div>
  <div className="stats-split">
   <BarList title={`Raretés tirées (${period})`} rows={ALL_RARITIES.map(r=>({label:r,value:s.boosters.rarities[r]??0,color:palette[r]}))} showShare/>
   <BarList title={`Origine des Deniers créés (${period})`} rows={Object.entries(s.economy.sources).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({label:SOURCE_LABEL[k]??k,value:v,color:'var(--gold)'}))}/>
   <section className="panel stats-card"><h3>Communauté</h3><dl className="stats-dl">
    <div><dt>Amitiés</dt><dd>{fmt(s.social.friendships)}</dd></div><div><dt>Échanges ({period})</dt><dd>{fmt(s.social.trades_period)}</dd></div>
    <div><dt>Cadeaux ({period})</dt><dd>{fmt(s.social.gifts_period)}</dd></div><div><dt>Cartes recyclées ({period})</dt><dd>{fmt(s.social.recycled_period)}</dd></div>
    <div><dt>Comptes suspendus</dt><dd>{fmt(s.players.suspended)}</dd></div></dl>
    <h3>Derniers inscrits</h3><ul className="stats-recent">{s.recent_players.map(p=><li key={p.handle}><span>{p.handle}</span><small>{new Date(p.created_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</small></li>)}</ul>
   </section>
  </div>
 </div>;
}

/** Colonnes d'une seule série (pas de légende : le titre la nomme), infobulle au survol, tableau dépliable. */
function ColumnChart({title,unit,series,pick}:{title:string;unit:string;series:Day[];pick:(d:Day)=>number}){
 const [hover,setHover]=useState<number|null>(null);
 const values=series.map(pick);
 const max=Math.max(1,...values);
 const top=Math.max(2,niceMax(max)); // des comptes : graduations entières
 const total=values.reduce((a,b)=>a+b,0);
 const W=600,H=200,PAD_L=48,PAD_B=30,PAD_T=12;
 const band=(W-PAD_L)/values.length,bar=Math.min(24,Math.max(2,band-2));
 const y=(v:number)=>PAD_T+(H-PAD_T-PAD_B)*(1-v/top);
 const h=hover===null?null:{d:series[hover],v:values[hover],x:PAD_L+hover*band+band/2};
 return <section className="panel stats-card chart-card">
  <div className="chart-head"><h3>{title}</h3><span className="chart-total">{fmt(total)} au total</span></div>
  <div className="chart-wrap" onMouseLeave={()=>setHover(null)}>
   <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} : ${fmt(total)} sur la période, maximum ${fmt(max)} en un jour`}>
    {[0,top/2,top].map(t=><g key={t}><line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} className="chart-grid"/><text x={PAD_L-6} y={y(t)+6} textAnchor="end" className="chart-tick">{compact(t)}</text></g>)}
    {values.map((v,i)=>{const x=PAD_L+i*band+(band-bar)/2,yy=y(v),hh=H-PAD_B-yy,r=Math.min(4,hh,bar/2);
     return <g key={i}>
      {v>0&&<path d={`M${x},${H-PAD_B} V${yy+r} Q${x},${yy} ${x+r},${yy} H${x+bar-r} Q${x+bar},${yy} ${x+bar},${yy+r} V${H-PAD_B} Z`} className={`chart-bar ${hover===i?'on':''} ${hover!==null&&hover!==i?'dim':''}`} style={{'--i':i} as React.CSSProperties}/>}
      <rect x={PAD_L+i*band} y={PAD_T} width={band} height={H-PAD_T-PAD_B} fill="transparent" onMouseEnter={()=>setHover(i)} onFocus={()=>setHover(i)} onClick={()=>setHover(i)}/>
     </g>;})}
    <text x={PAD_L} y={H-4} className="chart-tick">{dayLabel(series[0].day)}</text>
    <text x={W} y={H-4} textAnchor="end" className="chart-tick">{dayLabel(series.at(-1)!.day)}</text>
   </svg>
   {h&&<div className={`chart-tip ${h.x/W>.75?'end':h.x/W<.25?'start':''}`} style={{left:`${h.x/W*100}%`}}><strong>{fmt(h.v)} {unit}{h.v>1?'s':''}</strong><span>{dayLabel(h.d.day,true)}</span></div>}
  </div>
  <details className="chart-table"><summary>Voir les données</summary><table><thead><tr><th>Jour</th><th>{title.split(' par ')[0]}</th></tr></thead><tbody>{series.map((d,i)=><tr key={d.day}><td>{dayLabel(d.day)}</td><td>{fmt(values[i])}</td></tr>)}</tbody></table></details>
 </section>;
}

function niceMax(v:number){const p=10**Math.floor(Math.log10(v));for(const m of [1,2,2.5,5,10])if(m*p>=v)return m*p;return 10*p;}

/** Barres horizontales étiquetées : nom et valeur en texte, la couleur n'est qu'un repère. */
function BarList({title,rows,showShare=false}:{title:string;rows:{label:string;value:number;color:string}[];showShare?:boolean}){
 const total=rows.reduce((a,r)=>a+r.value,0),max=Math.max(1,...rows.map(r=>r.value));
 const list=useMemo(()=>rows,[rows]);
 return <section className="panel stats-card"><h3>{title}</h3>
  {total===0?<p className="muted">Rien sur la période.</p>:<ul className="bar-list">{list.map(r=><li key={r.label} title={`${r.label} : ${fmt(r.value)}`}>
   <span className="bar-label"><i style={{background:r.color}} aria-hidden="true"/>{r.label}</span>
   <span className="bar-track"><b style={{width:`${r.value/max*100}%`,background:r.color}}/></span>
   <span className="bar-value">{fmt(r.value)}{showShare&&<small> · {(r.value/total*100).toLocaleString('fr-FR',{maximumFractionDigits:1})} %</small>}</span>
  </li>)}</ul>}
 </section>;
}
