import type {DemoCard} from '../components/Card';
import {ALL_RARITIES,type Rarity,type Finish} from './draw';
export type AlbumFilters={query:string;status:'all'|'known'|'missing';clan:string;rarity:Rarity|'all';finish:Finish|'all';sort:'number'|'name'|'rarity'|'clan';descending:boolean};
export const initialAlbumFilters:AlbumFilters={query:'',status:'all',clan:'all',rarity:'all',finish:'all',sort:'number',descending:false};
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim();
const compare=new Intl.Collator('fr',{numeric:true,sensitivity:'base'}).compare;
// finishesSeen (album réel) : finitions déjà obtenues ; sinon finition affichée (démo).
export function selectAlbum<C extends DemoCard&{finishesSeen?:readonly Finish[]}>(cards:readonly C[],filters:AlbumFilters):C[]{
 const query=normalize(filters.query);
 return cards.filter(c=>{
  if(filters.status==='known'&&!c.known||filters.status==='missing'&&c.known)return false;
  if(filters.clan!=='all'&&(!c.known||c.clan!==filters.clan))return false;
  if(filters.rarity!=='all'&&(c.provisional||c.rarity!==filters.rarity))return false;
  if(filters.finish!=='all'&&(!c.known||(c.finishesSeen?!c.finishesSeen.includes(filters.finish):(c.finish||'Standard')!==filters.finish)))return false;
  // Unknown identities must never be discoverable through search or clan filters.
  return !query||normalize(c.known?[c.id,c.name,c.clan,c.role].join(' '):c.id).includes(query);
 }).sort((a,b)=>{
  if(filters.sort==='rarity'&&!!a.provisional!==!!b.provisional)return a.provisional?1:-1;
  if((filters.sort==='name'||filters.sort==='clan')&&a.known!==b.known)return a.known?-1:1;
  let order=filters.sort==='rarity'?ALL_RARITIES.indexOf(a.rarity)-ALL_RARITIES.indexOf(b.rarity):filters.sort==='name'?compare(a.known?a.name:'',b.known?b.name:''):filters.sort==='clan'?compare(a.known?a.clan:'',b.known?b.clan:''):compare(a.id,b.id);
  if(!order)order=compare(a.id,b.id);
  return filters.descending?-order:order;
 });
}
