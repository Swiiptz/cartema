'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Plus,Save,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {palette} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc} from '@/lib/game';

type Weighted={value:string;weight:number};
type Settings={trade_cooldown_hours:number;trade_daily_limit:number;gift_daily_limit:number;trade_tax_pct:number;trade_weekly_deniers_cap:number;buyer_tax_pct:number;bid_refund_tax_pct:number;alternate_art_odds:number;booster_offers:Record<string,number>;daily_login_reward:number;discovery_reward:number;welcome_free_boosters:number;free_booster_capacity:number;
 market_commission_pct:number;mission_bonus_daily:number;mission_bonus_weekly:number;recycle_values:Record<Rarity,number>;finish_multipliers:Record<string,number>};
type Economy={settings:{version:number;settings:Settings;created_at:string};settings_history:{version:number;created_at:string;by:string|null;active:boolean}[];
 ruleset:{version:number;slots:Weighted[][];finishes:Weighted[];unique_odds:number;notes:string;created_at:string};
 ruleset_history:{version:number;created_at:string;by:string|null;active:boolean;notes:string;openings:number}[]};
type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string,confirmLabel?:string)=>Promise<string|null>;

const TOTAL=100000;
const pct=(w:number)=>String(Math.round(w)/1000).replace('.',',');
const toWeight=(s:string)=>Math.round(Number(s.replace(',','.'))*1000);
const fmtDate=(d:string)=>new Date(d).toLocaleString('fr-FR',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const SLOT5:Rarity[]=['Rare','Très rare','Épique','Légendaire','Mythique'];

/** Champs simples des réglages : [clé, libellé, aide]. */
const FIELDS:[keyof Settings,string,string][]=[
 ['daily_login_reward','Bonus de connexion','Deniers, une fois par jour'],
 ['discovery_reward','Découverte d’un personnage','Deniers, une fois par personnage'],
 ['welcome_free_boosters','Boosters de bienvenue','à l’inscription'],
 ['free_booster_capacity','Réserve de boosters gratuits','maximum accumulable'],
 ['mission_bonus_daily','Bonus missions du jour','boosters, toutes réclamées'],
 ['mission_bonus_weekly','Bonus missions de la semaine','boosters, toutes réclamées'],
 ['market_commission_pct','Commission du marché','% prélevés sur la vente'],
 ['buyer_tax_pct','Taxe acheteur','% payés en plus du prix (achat, enchère gagnée)'],
 ['bid_refund_tax_pct','Taxe de remboursement','% retenus sur une mise dépassée'],
 ['trade_tax_pct','Taxe des échanges','% retenus sur les Deniers reçus dans un échange'],
 ['trade_cooldown_hours','Délai après réception','Heures avant de pouvoir échanger ou offrir une carte reçue par échange ou cadeau (0 = aucun)'],
 ['trade_daily_limit','Échanges par jour','Échanges conclus par joueur et par jour, renouvelés à 6 h (0 = sans limite)'],
 ['gift_daily_limit','Cadeaux par jour','Cadeaux envoyés et cadeaux reçus par joueur et par jour (0 = sans limite)'],
 ['trade_weekly_deniers_cap','Plafond des échanges','Deniers qu’un joueur peut recevoir par échange sur 7 jours (0 = sans plafond)'],
 ['alternate_art_odds','Versions alternatives','chance « 1 sur N » par carte tirée, pour les lignes sans chance propre (0 = jamais)'],
];

export function EconomyTab({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [eco,setEco]=useState<Economy|null>(null);
 const load=useCallback(async()=>{setEco(await callRpc<Economy>(client,'admin_economy'));},[client]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 if(!eco)return <Skeleton style={{height:400}}/>;
 return <div className="admin-economy">
  <SettingsForm key={`s${eco.settings.version}`} eco={eco} act={act} reason={reason} onSaved={load}/>
  <RulesetForm key={`r${eco.ruleset.version}`} eco={eco} act={act} reason={reason} onSaved={load}/>
  <GodSettings client={client} act={act} reason={reason}/>
  <ArtLines key={`a${eco.settings.version}`} client={client} act={act} reason={reason}/>
 </div>;
}

type God={odds:number;blood_pct:number;alt_odds:number;rare_slots:number;opened:number};

/** God booster : chance d'apparition et contenu. */
function GodSettings({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [god,setGod]=useState<God|null>(null);
 const [form,setForm]=useState<Record<keyof Omit<God,'opened'>,string>|null>(null);
 const load=useCallback(async()=>{const g=await callRpc<God>(client,'admin_god_settings');setGod(g);setForm({odds:String(g.odds),blood_pct:String(g.blood_pct),alt_odds:String(g.alt_odds),rare_slots:String(g.rare_slots)});},[client]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 if(!god||!form)return <Skeleton style={{height:160}}/>;
 const n=(k:keyof typeof form)=>Number(form[k].replace(',','.'));
 const bad=!/^\d+$/.test(form.odds)||!/^\d+$/.test(form.alt_odds)||!/^[0-4]$/.test(form.rare_slots)||!(n('blood_pct')>=0&&n('blood_pct')<=100);
 const dirty=n('odds')!==god.odds||n('blood_pct')!==Number(god.blood_pct)||n('alt_odds')!==god.alt_odds||n('rare_slots')!==god.rare_slots;
 async function save(){
  const r=await reason(`God booster : ${n('odds')>0?`1 booster sur ${n('odds').toLocaleString('fr-FR')}`:'désactivé'}, ${n('blood_pct')} % de Sanglante, version alternative 1 sur ${n('alt_odds')}, ${n('rare_slots')} carte(s) de plus en Rare ou mieux. S’applique aux prochaines ouvertures.`);
  if(r===null)return;
  if(await act('Réglages du God booster enregistrés.',c=>callRpc(c,'admin_save_god_settings',{p_odds:n('odds'),p_blood_pct:n('blood_pct'),p_alt_odds:n('alt_odds'),p_rare_slots:n('rare_slots'),p_reason:r})))await load();
 }
 const field=(k:keyof typeof form,label:string,help:string)=><label className="auth-field"><span>{label}</span><input inputMode="decimal" value={form[k]} onChange={e=>setForm(f=>f&&{...f,[k]:e.target.value})}/><small>{help}</small></label>;
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Booster divin · {god.opened} ouvert{god.opened>1?'s':''} à ce jour</span><h2>God booster</h2></div></div>
  <p className="admin-hint">À chaque ouverture, une chance qu’un booster devienne divin : toutes ses cartes au moins Dorées, plus de Sanglantes et de versions alternatives, et davantage de cartes Rares ou mieux.</p>
  <div className="eco-grid">
   {field('odds','Chance d’apparition','« 1 sur N » boosters ouverts (0 = jamais)')}
   {field('blood_pct','Part de Sanglante','% par carte, les autres sont Dorées')}
   {field('alt_odds','Versions alternatives','« 1 sur N » par carte (une ligne à 0 ne tombe jamais)')}
   {field('rare_slots','Cartes Rares en plus','0 à 4 cartes avant la 5e tirées comme la 5e')}
  </div>
  <div className="admin-actions"><button className="primary" disabled={bad||!dirty} onClick={()=>void save()}><Save size={15}/> Enregistrer</button></div>
 </section>;
}

type ArtLine={legacy?:boolean;label:string;active:boolean;odds:number|null;arts:number;active_arts:number;characters:number;owned:number;
 cards?:{art_id:string;code:string;name:string;rarity:string;art_path:string;active:boolean;owned:number}[]};

/** Lignes de versions alternatives (même nom de version) : activation et chance propre. */
function ArtLines({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [data,setData]=useState<{global_odds:number;lines:ArtLine[]}|null>(null);
 const [odds,setOdds]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{const d=await callRpc<{global_odds:number;lines:ArtLine[]}>(client,'admin_art_lines');setData(d);setOdds(Object.fromEntries(d.lines.map(l=>[l.label,l.odds===null?'':String(l.odds)])));},[client]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 const chance=(n:number)=>n>0?`1 sur ${n.toLocaleString('fr-FR')}`:'jamais';
 async function save(l:ArtLine,active:boolean){
  const raw=(odds[l.label]??'').replace(/\s/g,'');const value=raw===''?null:Number(raw);
  const r=await reason(`« ${l.label} » : ${active?`tombe avec une chance de ${chance(value??data!.global_odds)}${value===null?' (réglage global)':''}`:'ne tombe plus (les exemplaires possédés la gardent)'}.`,'Appliquer');
  if(r===null)return;
  if(await act('Ligne de versions enregistrée.',c=>callRpc(c,'admin_set_art_line',{p_label:l.label,p_active:active,p_odds:value,p_reason:r})))await load();
 }
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Versions alternatives</span><h2>Lignes de versions</h2></div></div>
  <p className="admin-hint">Une ligne regroupe les versions qui portent le même nom : versions alternatives, et anciennes illustrations officielles (« Illustration d’origine »…), qui tombent de la même façon. Chaque ligne d’un personnage tiré est tentée avec sa chance ; laissez vide pour la chance globale ({data?chance(data.global_odds):'…'}), 0 pour jamais. Une version seule se désactive depuis la fiche du personnage.</p>
  {!data?<Skeleton style={{height:120}}/>:data.lines.length===0?<p className="muted">Aucune version alternative pour l’instant.</p>
   :<ul className="arts-list">{data.lines.map(l=>{const raw=(odds[l.label]??'').replace(/\s/g,'');const bad=raw!==''&&!/^\d+$/.test(raw);const dirty=raw!==(l.odds===null?'':String(l.odds));
    return <li key={l.label} className={`line-row ${l.active?'':'off'}`}>
     <span><strong>{l.label}</strong>{l.legacy&&<em className="line-tag">anciennes officielles</em>}<small>{l.active?`tirable · ${chance(l.odds??data.global_odds)}${l.odds===null?' (global)':''}`:'désactivée'} · {l.active_arts}/{l.arts} version{l.arts>1?'s':''} active{l.active_arts>1?'s':''} · {l.characters} personnage{l.characters>1?'s':''} · {l.owned} exemplaire{l.owned>1?'s':''}</small></span>
     <span className="art-actions"><label className="auth-field"><span>1 sur N</span><input inputMode="numeric" aria-label={`Chance de ${l.label}`} placeholder={String(data.global_odds)} value={odds[l.label]??''} onChange={e=>setOdds(o=>({...o,[l.label]:e.target.value}))}/></label>
      <button type="button" className="primary ghost compact" disabled={bad||!dirty} onClick={()=>void save(l,l.active)}>Enregistrer</button>
      <button type="button" className="text-link" disabled={bad} onClick={()=>void save(l,!l.active)}>{l.active?'Désactiver':'Activer'}</button></span>
     {l.cards&&l.cards.length>0&&<details className="line-cards"><summary>Voir les {l.cards.length} carte{l.cards.length>1?'s':''} de la ligne</summary>
      <ul>{l.cards.map(c=><li key={c.art_id} className={c.active?'':'off'}><img src={c.art_path.startsWith('/')?`${process.env.NEXT_PUBLIC_BASE_PATH??''}${c.art_path}`:c.art_path} alt=""/>
       <span><strong>{c.code} · {c.name}</strong><small>{c.rarity} · {c.active?'tirable':'version désactivée'} · {c.owned} exemplaire{c.owned>1?'s':''}</small></span></li>)}</ul>
      <p className="admin-hint">Pour désactiver une seule de ces versions : fiche du personnage, « Versions d’illustration ».</p></details>}
    </li>;})}</ul>}
 </section>;
}

function SettingsForm({eco,act,reason,onSaved}:{eco:Economy;act:Act;reason:Reason;onSaved:()=>Promise<void>}){
 const cur=eco.settings.settings;
 const [form,setForm]=useState(()=>({
  fields:Object.fromEntries(FIELDS.map(([k])=>[k,String(cur[k])])) as Record<string,string>,
  offers:Object.fromEntries(Object.entries(cur.booster_offers).map(([k,v])=>[k,String(v)])) as Record<string,string>,
  recycle:Object.fromEntries(ALL_RARITIES.map(r=>[r,String(cur.recycle_values[r]??0)])) as Record<string,string>,
  gold:String(cur.finish_multipliers['Dorée']),blood:String(cur.finish_multipliers['Sanglante']),
 }));
 const int=(s:string)=>Number(s.replace(/\s/g,''));
 // Changements par rapport à la version active : seules ces clés sont envoyées.
 const changes=useMemo(()=>{
  const out:Partial<Record<keyof Settings,unknown>>={};const lines:string[]=[];
  for(const [k,label] of FIELDS){const v=int(form.fields[k]);if(v!==cur[k]){out[k]=v;lines.push(`${label} : ${cur[k]} → ${v}`);}}
  const offers=Object.fromEntries(Object.entries(form.offers).map(([k,v])=>[k,int(v)]));
  if(JSON.stringify(offers)!==JSON.stringify(cur.booster_offers)){out.booster_offers=offers;for(const k of Object.keys(offers))if(offers[k]!==cur.booster_offers[k])lines.push(`Prix ×${k} : ${cur.booster_offers[k]} → ${offers[k]}`);}
  const recycle=Object.fromEntries(ALL_RARITIES.map(r=>[r,int(form.recycle[r])])) as Record<Rarity,number>;
  if(ALL_RARITIES.some(r=>recycle[r]!==cur.recycle_values[r])){out.recycle_values=recycle;for(const r of ALL_RARITIES)if(recycle[r]!==cur.recycle_values[r])lines.push(`Recyclage ${r} : ${cur.recycle_values[r]} → ${recycle[r]}`);}
  const mult={Standard:1,'Dorée':Number(form.gold.replace(',','.')),Sanglante:Number(form.blood.replace(',','.'))};
  if(mult['Dorée']!==cur.finish_multipliers['Dorée']||mult.Sanglante!==cur.finish_multipliers['Sanglante']){out.finish_multipliers=mult;lines.push(`Multiplicateurs Dorée / Sanglante : ×${cur.finish_multipliers['Dorée']} / ×${cur.finish_multipliers['Sanglante']} → ×${mult['Dorée']} / ×${mult.Sanglante}`);}
  return {out,lines};
 },[form,cur]);
 const invalid=[...Object.values(form.fields),...Object.values(form.offers),...Object.values(form.recycle)].some(v=>!/^\d+$/.test(v.replace(/\s/g,'')));
 async function save(){
  const r=await reason(`Nouvelle version des réglages (v${eco.settings.version+1}). Changements : ${changes.lines.join(' · ')}. Ils s’appliquent immédiatement à tous les joueurs.`,'Appliquer');
  if(r===null)return;
  if(await act(`Réglages enregistrés (v${eco.settings.version+1}).`,c=>callRpc(c,'admin_save_settings',{p_changes:changes.out,p_reason:r})))await onSaved();
 }
 const setField=(group:'fields'|'offers'|'recycle',k:string,v:string)=>setForm(f=>({...f,[group]:{...f[group],[k]:v}}));
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Réglages · version {eco.settings.version} du {fmtDate(eco.settings.created_at)}</span><h2>Économie</h2></div></div>
  <h3 className="eco-sub">Boutique</h3>
  <div className="eco-grid">{Object.keys(form.offers).sort((a,b)=>Number(a)-Number(b)).map(k=><label key={k} className="auth-field"><span>Lot de {k} booster{Number(k)>1?'s':''}</span><input inputMode="numeric" value={form.offers[k]} onChange={e=>setField('offers',k,e.target.value)}/><small>Deniers{Number(k)>1&&Number(form.offers[k])?` · ${Math.round(int(form.offers[k])/Number(k))} l’unité`:''}</small></label>)}</div>
  <h3 className="eco-sub">Récompenses et règles</h3>
  <div className="eco-grid">{FIELDS.map(([k,label,help])=><label key={k} className="auth-field"><span>{label}</span><input inputMode="numeric" value={form.fields[k]} onChange={e=>setField('fields',k,e.target.value)}/><small>{help}</small></label>)}</div>
  <h3 className="eco-sub">Recyclage (Deniers par carte Standard)</h3>
  <div className="eco-grid">{ALL_RARITIES.map(r=><label key={r} className="auth-field"><span><i className="eco-dot" style={{background:palette[r]}}/>{r}</span><input inputMode="numeric" value={form.recycle[r]} onChange={e=>setField('recycle',r,e.target.value)}/></label>)}
   <label className="auth-field"><span>Multiplicateur Dorée</span><input inputMode="decimal" value={form.gold} onChange={e=>setForm(f=>({...f,gold:e.target.value}))}/></label>
   <label className="auth-field"><span>Multiplicateur Sanglante</span><input inputMode="decimal" value={form.blood} onChange={e=>setForm(f=>({...f,blood:e.target.value}))}/></label></div>
  {changes.lines.length>0&&<ul className="eco-diff">{changes.lines.map(l=><li key={l}>{l}</li>)}</ul>}
  <div className="admin-actions"><button className="primary" disabled={invalid||!changes.lines.length} onClick={()=>void save()}><Save size={15}/> Enregistrer une nouvelle version</button>{invalid&&<span className="admin-hint">Nombres entiers uniquement.</span>}</div>
  <History rows={eco.settings_history.map(h=>({v:h.version,date:h.created_at,by:h.by,active:h.active}))}/>
 </section>;
}

function RulesetForm({eco,act,reason,onSaved}:{eco:Economy;act:Act;reason:Reason;onSaved:()=>Promise<void>}){
 const r=eco.ruleset;
 const [slots,setSlots]=useState(()=>r.slots.map(s=>s.map(x=>({value:x.value,pct:pct(x.weight)}))));
 const [finishes,setFinishes]=useState(()=>r.finishes.map(x=>({value:x.value,pct:pct(x.weight)})));
 const [odds,setOdds]=useState(String(r.unique_odds));
 const [notes,setNotes]=useState('');
 const sum=(rows:{pct:string}[])=>rows.reduce((a,x)=>a+toWeight(x.pct),0);
 const asWeighted=(rows:{value:string;pct:string}[])=>rows.map(x=>({value:x.value,weight:toWeight(x.pct)}));
 const valid=slots.every(s=>sum(s)===TOTAL&&s.every(x=>toWeight(x.pct)>0))&&sum(finishes)===TOTAL&&/^\d+$/.test(odds);
 const changed=JSON.stringify(slots.map(asWeighted))!==JSON.stringify(r.slots)||JSON.stringify(asWeighted(finishes))!==JSON.stringify(r.finishes)||Number(odds)!==r.unique_odds;
 const setRow=(si:number,ri:number,v:string)=>setSlots(s=>s.map((rows,i)=>i!==si?rows:rows.map((x,j)=>j!==ri?x:{...x,pct:v})));
 async function save(){
  const reasonText=await reason(`Nouvelle table de tirage (v${r.version+1}), appliquée aux prochaines ouvertures. Les ouvertures passées gardent la v${r.version}.`,'Activer');
  if(reasonText===null)return;
  if(await act(`Table de tirage v${r.version+1} active.`,c=>callRpc(c,'admin_save_ruleset',{p_slots:slots.map(asWeighted),p_finishes:asWeighted(finishes),p_unique_odds:Number(odds),p_notes:notes,p_reason:reasonText})))await onSaved();
 }
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Tirage · version {r.version} du {fmtDate(r.created_at)}{r.notes?` · ${r.notes}`:''}</span><h2>Probabilités des boosters</h2></div></div>
  <p className="admin-hint">Chaque emplacement doit totaliser 100 %. Le 5e emplacement n’accepte que Rare ou mieux. Une nouvelle version n’affecte que les ouvertures suivantes.</p>
  <div className="eco-slots">{slots.map((rows,si)=>{const total=sum(rows);const allowed=si===4?SLOT5:ALL_RARITIES;const missing=allowed.filter(x=>!rows.some(row=>row.value===x));
   return <div key={si} className={`eco-slot ${total===TOTAL?'':'bad'}`}><h3 className="eco-sub">Emplacement {si+1}<span>{pct(total)} %</span></h3>
    {rows.map((x,ri)=><div key={x.value} className="eco-row"><span><i className="eco-dot" style={{background:palette[x.value as Rarity]}}/>{x.value}</span><input inputMode="decimal" aria-label={`${x.value}, emplacement ${si+1}`} value={x.pct} onChange={e=>setRow(si,ri,e.target.value)}/><span className="eco-unit">%</span>
     {rows.length>1&&<button className="icon-button" aria-label={`Retirer ${x.value}`} onClick={()=>setSlots(s=>s.map((rr,i)=>i!==si?rr:rr.filter((_,j)=>j!==ri)))}><X size={13}/></button>}</div>)}
    {missing.length>0&&<label className="eco-add"><Plus size={13}/><select value="" onChange={e=>{const v=e.target.value;if(v)setSlots(s=>s.map((rr,i)=>i!==si?rr:[...rr,{value:v,pct:'0'}]));}}><option value="">Ajouter une rareté</option>{missing.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
   </div>;})}
   <div className={`eco-slot ${sum(finishes)===TOTAL?'':'bad'}`}><h3 className="eco-sub">Finitions (chaque carte)<span>{pct(sum(finishes))} %</span></h3>
    {finishes.map((x,i)=><div key={x.value} className="eco-row"><span>{x.value}</span><input inputMode="decimal" aria-label={`Finition ${x.value}`} value={x.pct} onChange={e=>setFinishes(f=>f.map((y,j)=>j!==i?y:{...y,pct:e.target.value}))}/><span className="eco-unit">%</span></div>)}
    <div className="eco-row"><span>Caïn (5e carte)</span><input inputMode="numeric" aria-label="Chance de la carte unique, une sur" value={odds} onChange={e=>setOdds(e.target.value)}/><span className="eco-unit">1 sur N</span></div>
   </div>
  </div>
  <label className="auth-field"><span>Note de version (facultatif)</span><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Finitions plus généreuses"/></label>
  <div className="admin-actions"><button className="primary" disabled={!valid||!changed} onClick={()=>void save()}><Save size={15}/> Activer une nouvelle table</button>{!valid&&<span className="admin-hint">Chaque bloc doit faire exactement 100 %, sans ligne à 0 %.</span>}</div>
  <History rows={eco.ruleset_history.map(h=>({v:h.version,date:h.created_at,by:h.by,active:h.active,extra:`${h.openings} ouverture${h.openings>1?'s':''}${h.notes?` · ${h.notes}`:''}`}))}/>
 </section>;
}

function History({rows}:{rows:{v:number;date:string;by:string|null;active:boolean;extra?:string}[]}){
 return <details className="chart-table"><summary>Versions précédentes</summary><table><tbody>{rows.map(h=><tr key={h.v}><td>v{h.v}{h.active?' · active':''}</td><td>{fmtDate(h.date)}</td><td>{h.by??'—'}</td><td>{h.extra??''}</td></tr>)}</tbody></table></details>;
}
