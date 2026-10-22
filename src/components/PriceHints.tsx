'use client';
import {TrendingUp} from 'lucide-react';
import type {CardPrices} from '@/lib/game';

const fr=(n:number)=>n.toLocaleString('fr-FR');

/** Repères de prix d'une carte ; `onUse` propose de reprendre la moyenne. */
export function PriceHints({prices,onUse}:{prices:CardPrices|null;onUse?:(price:number)=>void}){
 if(!prices)return null;
 const n=prices.sales.length;
 if(!n&&prices.lowest===null)return <p className="price-hints muted"><TrendingUp size={13}/> Aucune vente récente de cette carte.</p>;
 return <p className="price-hints"><TrendingUp size={13}/> <span>
  {n>0&&<>Moyenne des {n>1?`${n} dernières ventes`:'dernière vente'} : <strong>{fr(prices.average!)}</strong>{n>1&&<> · dernière : {fr(prices.last!)}</>}</>}
  {prices.lowest!==null&&<>{n>0?' · ':''}moins chère en vente : {fr(prices.lowest)}</>}
  {onUse&&prices.average!==null&&<> <button type="button" className="text-link" onClick={()=>onUse(prices.average!)}>Utiliser la moyenne</button></>}
 </span></p>;
}
