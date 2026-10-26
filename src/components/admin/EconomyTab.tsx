'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Plus,Save,X} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {palette} from '@/components/Card';
import {Skeleton} from '@/components/ui';
import {ALL_RARITIES,type Rarity} from '@/lib/draw';
import {callRpc} from '@/lib/game';

type Weighted={value:string;weight:number};
type Settings={next_set_features?:number;signed_odds?:number;pity_epic_every?:number;pity_legend_every?:number;streak_booster_every?:number;streak_booster_count?:number;trade_cooldown_hours:number;trade_daily_limit:number;gift_daily_limit:number;trade_tax_pct:number;trade_weekly_deniers_cap:number;buyer_tax_pct:number;bid_refund_tax_pct:number;alternate_art_odds:number;booster_offers:Record<string,number>;daily_login_reward:number;discovery_reward:number;welcome_free_boosters:number;free_booster_capacity:number;
 market_commission_pct:number;mission_bonus_daily:number;mission_bonus_weekly:number;recycle_values:Record<Rarity,number>;finish_multipliers:Record<string,number>;alternate_rarity_mult?:Record<Rarity,number>};
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
 ['streak_booster_every','Série de connexions','un bonus tous les N jours d’affilée (0 = aucun)'],
 ['streak_booster_count','Bonus de série','boosters offerts à chaque palier'],
 ['pity_epic_every','Épique garantie','au N-ième booster d’un joueur sans Épique (0 = aucune), caché aux joueurs'],
 ['next_set_features','Nouveautés du prochain set','1 = allumées : signatures, cartes signées et textes d’ambiance ; 0 = coupées (en attente du set)'],
 ['signed_odds','Carte signée','1 exemplaire sur N d’un personnage dont la signature est publiée (0 = jamais)'],
 ['pity_legend_every','Légendaire garantie','au N-ième booster d’un joueur sans Légendaire (0 = aucune), caché aux joueurs'],
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

type God={odds:number;blood_pct:number;alt_odds:number;rare_slots:number;opened:number;
 /** Garantie cachée : N-ième ouverture d'un joueur depuis son dernier God booster ; closest = les plus proches. */
 guarantee_every?:number;legend_mult?:number;
 /** Emplacements placés au hasard : cartes sans skin, à skin garanti, et poids des personnages à skin pour les autres. */
 plain_slots?:number;skin_slots?:number;skin_weight?:number;closest?:{handle:string|null;since:number;remaining:number}[]|null};

/** God booster : chance d'apparition et contenu. */
function GodSettings({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [god,setGod]=useState<God|null>(null);
 const [form,setForm]=useState<Record<'odds'|'blood_pct'|'alt_odds'|'rare_slots'|'guarantee_every'|'legend_mult'|'plain_slots'|'skin_slots'|'skin_weight',string>|null>(null);
 const load=useCallback(async()=>{const g=await callRpc<God>(client,'admin_god_settings');setGod(g);setForm({odds:String(g.odds),blood_pct:String(g.blood_pct),alt_odds:String(g.alt_odds),rare_slots:String(g.rare_slots),guarantee_every:String(g.guarantee_every??0),legend_mult:String(g.legend_mult??5),plain_slots:String(g.plain_slots??0),skin_slots:String(g.skin_slots??0),skin_weight:String(g.skin_weight??1)});},[client]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 if(!god||!form)return <Skeleton style={{height:160}}/>;
 const n=(k:keyof typeof form)=>Number(form[k].replace(',','.'));
 const bad=!/^\d+$/.test(form.odds)||!/^\d+$/.test(form.alt_odds)||!/^[0-4]$/.test(form.rare_slots)||!/^\d+$/.test(form.guarantee_every)||!(Number(form.legend_mult)>=1&&Number(form.legend_mult)<=20&&/^\d+$/.test(form.legend_mult))||!(n('blood_pct')>=0&&n('blood_pct')<=100)
  ||!/^[0-5]$/.test(form.plain_slots)||!/^[0-5]$/.test(form.skin_slots)||n('plain_slots')+n('skin_slots')>5||!(/^d+$/.test(form.skin_weight)&&n('skin_weight')>=1&&n('skin_weight')<=20);
 const dirty=n('odds')!==god.odds||n('blood_pct')!==Number(god.blood_pct)||n('alt_odds')!==god.alt_odds||n('rare_slots')!==god.rare_slots||n('guarantee_every')!==(god.guarantee_every??0)||n('legend_mult')!==(god.legend_mult??5)
  ||n('plain_slots')!==(god.plain_slots??0)||n('skin_slots')!==(god.skin_slots??0)||n('skin_weight')!==(god.skin_weight??1);
 async function save(){
  const r=await reason(`God booster : ${n('odds')>0?`1 booster sur ${n('odds').toLocaleString('fr-FR')}`:'désactivé'}, ${n('blood_pct')} % de Sanglante, ${n('plain_slots')} carte(s) sans skin et ${n('skin_slots')} à skin garanti (placées au hasard), personnages à skin ×${n('skin_weight')} et skin 1 sur ${n('alt_odds')} pour les autres, ${n('rare_slots')} carte(s) de plus en Rare ou mieux, Légendaires et Mythiques ×${n('legend_mult')}, ${n('guarantee_every')>0?`garanti au ${n('guarantee_every').toLocaleString('fr-FR')}e booster de chaque joueur depuis son dernier God booster`:'sans garantie'}. S’applique aux prochaines ouvertures.`);
  if(r===null)return;
  if(await act('Réglages du God booster enregistrés.',c=>callRpc(c,'admin_save_god_settings',{p_odds:n('odds'),p_blood_pct:n('blood_pct'),p_alt_odds:n('alt_odds'),p_rare_slots:n('rare_slots'),p_reason:r,p_guarantee_every:n('guarantee_every'),p_legend_mult:n('legend_mult'),p_skin_slots:n('skin_slots'),p_skin_weight:n('skin_weight'),p_plain_slots:n('plain_slots')})))await load();
 }
 const field=(k:keyof typeof form,label:string,help:string)=><label className="auth-field"><span>{label}</span><input inputMode="decimal" value={form[k]} onChange={e=>setForm(f=>f&&{...f,[k]:e.target.value})}/><small>{help}</small></label>;
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Booster divin · {god.opened} ouvert{god.opened>1?'s':''} à ce jour</span><h2>God booster</h2></div></div>
  {god.closest&&god.closest.length>0&&<p className="admin-hint">Compteur caché aux joueurs. Les plus proches de leur God booster garanti : {god.closest.map(c=>`${c.handle??'sans pseudo'} (encore ${c.remaining.toLocaleString('fr-FR')})`).join(', ')}.</p>}
  <p className="admin-hint">À chaque ouverture, une chance qu’un booster devienne divin : toutes ses cartes au moins Dorées, plus de Sanglantes et de skins (jamais d’ancienne illustration officielle), et davantage de cartes Rares ou mieux.</p>
  <div className="eco-grid">
   {field('odds','Chance d’apparition','« 1 sur N » boosters ouverts (0 = jamais)')}
   {field('blood_pct','Part de Sanglante','% par carte, les autres sont Dorées')}
   {field('plain_slots','Cartes sans skin','N cartes placées au hasard : finition seulement (0 à 5)')}
   {field('skin_slots','Cartes à skin garanti','N cartes placées au hasard, parmi les personnages qui ont un skin (0 à 5)')}
   {field('skin_weight','Personnages à skin favorisés','×N dans le tirage des autres cartes (1 = aucun avantage, jusqu’à 20)')}
   {field('alt_odds','Skins des autres cartes','« 1 sur N » au plus par ligne de skin (une ligne à 0 ne tombe jamais)')}
   {field('rare_slots','Cartes Rares en plus','0 à 4 cartes avant la 5e tirées comme la 5e')}
   {field('legend_mult','Légendaires et Mythiques','×N sur la table de la 5e carte, God booster seulement (1 à 20)')}
   {field('guarantee_every','Garanti au bout de','N boosters d’un joueur depuis son dernier God booster (0 = sans garantie)')}
  </div>
  <div className="admin-actions"><button className="primary" disabled={bad||!dirty} onClick={()=>void save()}><Save size={15}/> Enregistrer</button></div>
 </section>;
}

type ArtLine={legacy?:boolean;label:string;active:boolean;odds:number|null;rarity_odds?:Partial<Record<Rarity,number>>;arts:number;active_arts:number;characters:number;owned:number;
 cards?:{art_id:string;code:string;name:string;rarity:string;art_path:string;active:boolean;owned:number}[]};
type ArtLinesData={global_odds:number;rarity_mult?:Partial<Record<Rarity,number>>;lines:ArtLine[]};

/** Lignes de versions alternatives (même nom de version) : activation, chance propre, chance par rareté et nom. */
function ArtLines({client,act,reason}:{client:SupabaseClient;act:Act;reason:Reason}){
 const [data,setData]=useState<ArtLinesData|null>(null);
 const [odds,setOdds]=useState<Record<string,string>>({});
 // Réglage à la main par rareté (vide = lissé par les multiplicateurs d'Économie).
 const [manual,setManual]=useState<Record<string,Record<string,string>>>({});
 const [renaming,setRenaming]=useState<{label:string;value:string}|null>(null);
 const load=useCallback(async()=>{const d=await callRpc<ArtLinesData>(client,'admin_art_lines');setData(d);
  setOdds(Object.fromEntries(d.lines.map(l=>[l.label,l.odds===null?'':String(l.odds)])));
  setManual(Object.fromEntries(d.lines.map(l=>[l.label,Object.fromEntries(ALL_RARITIES.map(r=>[r,l.rarity_odds?.[r]===undefined?'':String(l.rarity_odds[r])]))])));},[client]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 const chance=(n:number)=>n>0?`1 sur ${n.toLocaleString('fr-FR')}`:'jamais';
 const clean=(s:string|undefined)=>(s??'').replace(/\s/g,'');
 /** Chance lissée d'une rareté : chance de la ligne (ou globale) divisée par le multiplicateur, comme le serveur. */
 const smooth=(lineOdds:number|null,r:Rarity)=>{if(lineOdds===0||!data)return 0;const base=lineOdds??data.global_odds;return base>0?Math.max(1,Math.round(base/(data.rarity_mult?.[r]||1))):0;};
 const lineValue=(l:ArtLine)=>{const raw=clean(odds[l.label]);return raw===''?null:Number(raw);};
 const manualOf=(l:ArtLine)=>Object.fromEntries(ALL_RARITIES.filter(r=>clean(manual[l.label]?.[r])!=='').map(r=>[r,Number(clean(manual[l.label][r]))]));
 const summary=(l:ArtLine,m:Record<string,number>)=>ALL_RARITIES.map(r=>`${r} ${chance(lineValue(l)===0?0:m[r]??smooth(lineValue(l),r))}${m[r]!==undefined?' (à la main)':''}`).join(', ');
 async function save(l:ArtLine,active:boolean,rarityOdds?:Record<string,number>){
  const value=lineValue(l);const m=rarityOdds??manualOf(l);
  const r=await reason(`« ${l.label} » : ${active?`chance de base ${chance(value??data!.global_odds)}${value===null?' (réglage global)':''}. Par rareté : ${summary(l,m)}.`:'ne tombe plus (les exemplaires possédés la gardent)'}`,'Appliquer');
  if(r===null)return;
  if(await act('Ligne de versions enregistrée.',c=>callRpc(c,'admin_set_art_line',{p_label:l.label,p_active:active,p_odds:value,p_reason:r,p_rarity_odds:m})))await load();
 }
 async function rename(l:ArtLine){
  const next=renaming?.value.trim()??'';
  const r=await reason(`Renommer « ${l.label} » en « ${next} » : ses ${l.arts} version${l.arts>1?'s':''} et son réglage suivent. Les joueurs verront le nouveau nom sur leurs exemplaires.`,'Renommer');
  if(r===null)return;
  if(await act('Ligne renommée.',c=>callRpc(c,'admin_rename_art_line',{p_label:l.label,p_new_label:next,p_reason:r}))){setRenaming(null);await load();}
 }
 return <section className="panel admin-edition eco-section">
  <div className="section-header"><div><span className="eyebrow">Versions alternatives</span><h2>Lignes de versions</h2></div></div>
  <p className="admin-hint">Une ligne regroupe les versions qui portent le même nom : versions alternatives, et anciennes illustrations officielles (« Illustration d’origine »…), qui tombent de la même façon. Chaque ligne d’un personnage tiré est tentée avec sa chance ; laissez vide pour la chance globale ({data?chance(data.global_odds):'…'}), 0 pour jamais. Par rareté, la chance est divisée par le multiplicateur réglé dans Économie ; une case remplie à la main l’emporte, « Lisser » vide toutes les cases. Une version seule se désactive depuis la fiche du personnage.</p>
  {!data?<Skeleton style={{height:120}}/>:data.lines.length===0?<p className="muted">Aucune version alternative pour l’instant.</p>
   :<ul className="arts-list">{data.lines.map(l=>{const raw=clean(odds[l.label]);const m=manual[l.label]??{};
    const bad=(raw!==''&&!/^\d+$/.test(raw))||ALL_RARITIES.some(r=>clean(m[r])!==''&&!/^\d+$/.test(clean(m[r])));
    const dirty=raw!==(l.odds===null?'':String(l.odds))||ALL_RARITIES.some(r=>clean(m[r])!==(l.rarity_odds?.[r]===undefined?'':String(l.rarity_odds[r])));
    const hasManual=Object.keys(l.rarity_odds??{}).length>0;const value=lineValue(l);
    return <li key={l.label} className={`line-row ${l.active?'':'off'}`}>
     <span><strong>{l.label}</strong>{l.legacy&&<em className="line-tag">anciennes officielles</em>}<small>{l.active?`tirable · ${chance(l.odds??data.global_odds)}${l.odds===null?' (global)':''}${hasManual?' · réglée à la main':''}`:'désactivée'} · {l.active_arts}/{l.arts} version{l.arts>1?'s':''} active{l.active_arts>1?'s':''} · {l.characters} personnage{l.characters>1?'s':''} · {l.owned} exemplaire{l.owned>1?'s':''}</small></span>
     <span className="art-actions"><label className="auth-field"><span>1 sur N</span><input inputMode="numeric" aria-label={`Chance de ${l.label}`} placeholder={String(data.global_odds)} value={odds[l.label]??''} onChange={e=>setOdds(o=>({...o,[l.label]:e.target.value}))}/></label>
      <button type="button" className="primary ghost compact" disabled={bad||!dirty} onClick={()=>void save(l,l.active)}>Enregistrer</button>
      <button type="button" className="text-link" disabled={bad} onClick={()=>void save(l,!l.active)}>{l.active?'Désactiver':'Activer'}</button>
      <button type="button" className="text-link" onClick={()=>setRenaming(renaming?.label===l.label?null:{label:l.label,value:l.label})}>Renommer</button></span>
     {renaming?.label===l.label&&<form className="line-rename" onSubmit={e=>{e.preventDefault();void rename(l);}}>
      <label className="auth-field"><span>Nouveau nom</span><input autoFocus maxLength={80} value={renaming.value} onChange={e=>setRenaming({label:l.label,value:e.target.value})}/></label>
      <button className="primary ghost compact" disabled={!renaming.value.trim()||renaming.value.trim()===l.label}>Valider</button>
      <button type="button" className="text-link" onClick={()=>setRenaming(null)}>Annuler</button></form>}
     <div className="line-rarities" aria-label={`Chance de ${l.label} par rareté`}>
      {ALL_RARITIES.map(r=><label key={r} className="auth-field"><span><i className="eco-dot" style={{background:palette[r]}}/>{r}</span>
       <input inputMode="numeric" aria-label={`${l.label}, ${r}, 1 sur N`} placeholder={value===0?'jamais':String(smooth(value,r))} value={m[r]??''} onChange={e=>setManual(x=>({...x,[l.label]:{...x[l.label],[r]:e.target.value}}))}/></label>)}
      <button type="button" className="text-link" disabled={bad||!hasManual&&ALL_RARITIES.every(r=>clean(m[r])==='')} onClick={()=>{setManual(x=>({...x,[l.label]:Object.fromEntries(ALL_RARITIES.map(r=>[r,'']))}));void save(l,l.active,{});}}>Lisser</button>
     </div>
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
  altMult:Object.fromEntries(ALL_RARITIES.map(r=>[r,String(cur.alternate_rarity_mult?.[r]??1).replace('.',',')])) as Record<string,string>,
 }));
 const num=(s:string)=>Number(s.replace(',','.'));
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
  const altMult=Object.fromEntries(ALL_RARITIES.map(r=>[r,num(form.altMult[r])])) as Record<Rarity,number>;
  const curMult=(r:Rarity)=>cur.alternate_rarity_mult?.[r]??1;
  if(ALL_RARITIES.some(r=>altMult[r]!==curMult(r))){out.alternate_rarity_mult=altMult;for(const r of ALL_RARITIES)if(altMult[r]!==curMult(r))lines.push(`Versions alternatives ${r} : ×${curMult(r)} → ×${altMult[r]}`);}
  return {out,lines};
 },[form,cur]);
 const invalid=[...Object.values(form.fields),...Object.values(form.offers),...Object.values(form.recycle)].some(v=>!/^\d+$/.test(v.replace(/\s/g,'')))
  ||Object.values(form.altMult).some(v=>!(/^\d+([.,]\d+)?$/.test(v)&&num(v)>=1&&num(v)<=1000));
 async function save(){
  const r=await reason(`Nouvelle version des réglages (v${eco.settings.version+1}). Changements : ${changes.lines.join(' · ')}. Ils s’appliquent immédiatement à tous les joueurs.`,'Appliquer');
  if(r===null)return;
  if(await act(`Réglages enregistrés (v${eco.settings.version+1}).`,c=>callRpc(c,'admin_save_settings',{p_changes:changes.out,p_reason:r})))await onSaved();
 }
 const setField=(group:'fields'|'offers'|'recycle'|'altMult',k:string,v:string)=>setForm(f=>({...f,[group]:{...f[group],[k]:v}}));
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
  <h3 className="eco-sub">Versions alternatives par rareté</h3>
  <p className="admin-hint">La chance « 1 sur N » d’une ligne est divisée par ce multiplicateur selon la rareté de la carte tirée (×5 : 1 sur 1 000 devient 1 sur 200). De 1 à 1 000. Une ligne réglée à la main pour une rareté garde son réglage.</p>
  <div className="eco-grid">{ALL_RARITIES.map(r=>{const v=num(form.altMult[r]);return <label key={r} className="auth-field"><span><i className="eco-dot" style={{background:palette[r]}}/>{r}</span><input inputMode="decimal" value={form.altMult[r]} onChange={e=>setField('altMult',r,e.target.value)}/><small>× · 1 sur 1 000 devient {v>=1?`1 sur ${Math.max(1,Math.round(1000/v)).toLocaleString('fr-FR')}`:'—'}</small></label>;})}</div>
  {changes.lines.length>0&&<ul className="eco-diff">{changes.lines.map(l=><li key={l}>{l}</li>)}</ul>}
  <div className="admin-actions"><button className="primary" disabled={invalid||!changes.lines.length} onClick={()=>void save()}><Save size={15}/> Enregistrer une nouvelle version</button>{invalid&&<span className="admin-hint">Nombres entiers uniquement (multiplicateurs des versions : de 1 à 1 000).</span>}</div>
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
