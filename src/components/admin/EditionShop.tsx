'use client';
import {useState} from 'react';
import {Save} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {BoosterSkin} from '@/components/BoosterSkin';
import {callRpc} from '@/lib/game';
import {BOOSTER_THEMES,type AdminEdition,type BoosterTheme} from '@/lib/admin';

type Act=(label:string,action:(c:SupabaseClient)=>Promise<unknown>)=>Promise<boolean>;
type Reason=(message:string)=>Promise<string|null>;
const LOTS=['1','3','10'];

/** Boutique d'une édition : sachet, prix propres (vides = prix généraux) et annonce « Soon ». */
export function EditionShop({edition:e,act,reason}:{edition:AdminEdition;act:Act;reason:Reason}){
 const [theme,setTheme]=useState<BoosterTheme>(e.booster_theme??'camarilla');
 const [teaser,setTeaser]=useState(!!e.teaser);
 const [eternal,setEternal]=useState(!!e.eternal);
 const [eternalDrops,setEternalDrops]=useState(!!e.eternal_drops);
 const [prices,setPrices]=useState<Record<string,string>>(()=>Object.fromEntries(LOTS.map(k=>[k,e.booster_offers?.[k]?String(e.booster_offers[k]):''])));
 const filled=LOTS.filter(k=>prices[k].trim()!=='');
 const bad=filled.some(k=>!/^\d+$/.test(prices[k].trim())||Number(prices[k])<=0)||(filled.length>0&&!filled.includes('1'));
 async function save(){
  const offers=filled.length?Object.fromEntries(filled.map(k=>[k,Number(prices[k])])):null;
  const r=await reason(`« ${e.name} » : sachet ${BOOSTER_THEMES.find(t=>t[0]===theme)?.[1]}, ${offers?`prix ${filled.map(k=>`${k} → ${prices[k]}`).join(', ')}`:'prix généraux'}${teaser?', annoncée « Soon » aux joueurs (nom et sachet seulement)':''}.`);
  if(r===null)return;
  await act('Boutique de l’édition enregistrée.',c=>callRpc(c,'admin_set_edition_shop',{p_id:e.id,p_teaser:teaser,p_theme:theme,p_offers:offers,p_reason:r}));
 }
 async function saveEternal(){
  const r=await reason(eternal?`« ${e.name} » devient l’édition éternelle : ses boosters restent fermés, ses cartes tombent en sixième carte (God booster et éditions qui l’autorisent).`:`« ${e.name} » : sixième carte éternelle ${eternalDrops?'possible':'impossible'} dans ses boosters.`);
  if(r===null)return;
  await act('Options éternelles enregistrées.',c=>callRpc(c,'admin_set_edition_eternal',{p_id:e.id,p_eternal:eternal,p_eternal_drops:eternal?false:eternalDrops,p_reason:r}));
 }
 return <fieldset className="admin-art edition-shop"><legend>Boutique et annonce</legend>
  <div className="edition-shop-row">
   <div className={`edition-shop-pack ${teaser&&!e.packs_enabled?'soon':''}`}><BoosterSkin name={e.name} theme={theme}/></div>
   <div className="edition-shop-fields">
    <label className="auth-field"><span>Sachet</span><select value={theme} onChange={x=>setTheme(x.target.value as BoosterTheme)}>{BOOSTER_THEMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <div className="admin-row">{LOTS.map(k=><label key={k} className="auth-field"><span>Lot de {k}</span><input inputMode="numeric" placeholder="général" value={prices[k]} onChange={x=>setPrices(p=>({...p,[k]:x.target.value.replace(/[^\d]/g,'')}))}/></label>)}</div>
    {bad&&<p className="auth-error">Le lot de 1 est obligatoire dès qu’un prix est renseigné ; des nombres entiers positifs.</p>}
    <label className="admin-check"><input type="checkbox" checked={teaser} onChange={x=>setTeaser(x.target.checked)}/> Annoncer « Soon » sur la page boosters (tant que les boosters sont fermés)</label>
    <button type="button" className="primary ghost compact" disabled={bad} onClick={()=>void save()}><Save size={14}/> Enregistrer</button>
    <label className="admin-check"><input type="checkbox" checked={eternal} onChange={x=>setEternal(x.target.checked)}/> Édition éternelle (ETER) : ses cartes tombent seulement en sixième carte, jamais en booster à part</label>
    {!eternal&&<label className="admin-check"><input type="checkbox" checked={eternalDrops} onChange={x=>setEternalDrops(x.target.checked)}/> Sixième carte éternelle possible dans les boosters de cette édition</label>}
    {(eternal!==!!e.eternal||eternalDrops!==!!e.eternal_drops)&&<button type="button" className="primary ghost compact" onClick={()=>void saveEternal()}><Save size={14}/> Enregistrer les options éternelles</button>}
   </div>
  </div>
 </fieldset>;
}
