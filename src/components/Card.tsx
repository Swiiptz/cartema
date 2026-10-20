import {useId} from 'react';
import type {Rarity} from '@/lib/draw';
import {resolveIllustration} from '@/lib/paths';
import {renderCard,renderBack} from './tarot-renderer';

export const palette:Record<Rarity,string>={'Commun':'#8d8a8f','Peu commun':'#5f9c7a','Rare':'#4a86c9','Très rare':'#3fb0b8','Épique':'#9b72e0','Légendaire':'#e0b04a','Mythique':'#e0405f'};
export type DemoCard={id:string;name:string;clan:string;role:string;rarity:Rarity;known:boolean;finish?:string;illustration?:string;originalIllustration?:string;artLayout?:'portrait'|'full'|'cover';artOffsetY?:number;provisional?:boolean;silhouette?:number};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function TarotCard({card}:{card:DemoCard}){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 const tuple=[escape(card.id),escape(card.name),escape(card.known?card.clan:'?'),escape(card.role),card.rarity,card.known?1:0,card.finish==='Dorée'?'gold':card.finish==='Sanglante'?'blood':''];
 // Only local illustration paths or the project's public storage are accepted; text and attributes are XML-escaped.
 const source=resolveIllustration(card.illustration);
 const illustration=source?escape(source):undefined;
 return <article className="tarot-card" style={{'--rarity-color':palette[card.rarity]} as React.CSSProperties} aria-label={`${card.known?card.name:'Personnage non découvert'}, ${card.provisional?'cadre de présentation':card.rarity}`} dangerouslySetInnerHTML={{__html:renderCard(tuple,id,illustration,card.artLayout==='full'?'full':card.artLayout==='cover'?'cover':'portrait',!!card.provisional,Number.isFinite(card.artOffsetY)?Math.max(-40,Math.min(40,card.artOffsetY!)):0,card.silhouette)}}/>;
}
export function CardBack({pack=false}:{pack?:boolean}){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <div className="tarot-card card-back" aria-hidden="true" dangerouslySetInnerHTML={{__html:renderBack(pack?'CARTEMA':'',id)}}/>;
}
