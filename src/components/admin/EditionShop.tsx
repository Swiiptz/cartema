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
 const [prices,setPrices]=useState<Record<string,string>>(()=>Object.fromEntries(LOTS.map(k=>[k,e.booster_offers?.[k]?String(e.booster_offers[k]):''])));
 const filled=LOTS.filter(k=>prices[k].trim()!=='');
 const bad=filled.some(k=>!/^\d+$/.test(prices[k].trim())||Number(prices[k])<=0)||(filled.length>0&&!filled.includes('1'));
 async function save(){
  const offers=filled.length?Object.fromEntries(filled.map(k=>[k,Number(prices[k])])):null;
  const r=await reason(`« ${e.name} » : sachet ${BOOSTER_THEMES.find(t=>t[0]===theme)?.[1]}, ${offers?`prix ${filled.map(k=>`${k} → ${prices[k]}`).join(', ')}`:'prix généraux'}${teaser?', annoncée « Soon » aux joueurs (nom et sachet seulement)':''}.`);
  if(r===null)return;
  await act('Boutique de l’édition enregistrée.',c=>callRpc(c,'admin_set_edition_shop',{p_id:e.id,p_teaser:teaser,p_theme:theme,p_offers:offers,p_reason:r}));
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
   </div>
  </div>
 </fieldset>;
}
