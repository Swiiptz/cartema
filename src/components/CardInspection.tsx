'use client';
import {useId,useRef,useState} from 'react';
import {Expand,X} from 'lucide-react';
import {TarotCard,type DemoCard} from './Card';

const FINISHES=['Standard','Dorée','Sanglante'];
/** finishesSeen : finitions débloquées par le joueur ; seules celles-ci sont proposées en aperçu. */
export function CardInspection({card,finishesSeen}:{card:DemoCard;finishesSeen?:readonly string[]}){
 const options=finishesSeen?FINISHES.filter(f=>finishesSeen.includes(f)):FINISHES;
 const dialog=useRef<HTMLDialogElement>(null);
 const title=useId();
 const [finish,setFinish]=useState(card.finish||'Standard');
 return <><button className="inspect-card" aria-label={`Examiner ${card.known?card.name:'la carte inconnue'}`} onClick={()=>{setFinish(card.finish||'Standard');dialog.current?.showModal();}}><TarotCard card={card}/><span className="inspect-hint"><Expand size={13}/> Examiner la carte</span></button><dialog className="card-dialog" ref={dialog} aria-labelledby={title} onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}><div className="card-dialog-content"><button className="icon-button dialog-close" aria-label="Fermer le détail" onClick={()=>dialog.current?.close()}><X size={20}/></button><div className="dialog-art"><TarotCard key={finish} card={{...card,finish:card.known?finish:card.finish}}/></div><div className="dialog-copy"><span className="eyebrow">Les archives · Détail d’un arcane</span><h2 id={title}>{card.known?card.name:'Identité voilée'}</h2><span className="detail-rarity">{card.provisional?'Rareté à définir':card.rarity}</span>{card.known&&!card.unique&&options.length>1&&<div className="finish-preview"><span className="eyebrow">Aperçu des finitions</span><div className="finish-switch" aria-label="Prévisualiser une finition">{options.map(f=><button key={f} className={finish===f?'active':''} aria-pressed={finish===f} onClick={()=>setFinish(f)}>{f}</button>)}</div><small>{finishesSeen?'Finitions que vous avez obtenues.':'Comparaison visuelle de la même carte.'}</small></div>}<dl><div><dt>Numéro</dt><dd>{card.id}</dd></div><div><dt>Clan</dt><dd>{card.known?(card.clan!=='?'?card.clan:'À définir'):'À découvrir'}</dd></div><div><dt>Titre / fonction</dt><dd>{card.known?card.role||'À définir':'Identité voilée'}</dd></div>{finishesSeen?card.known&&<div><dt>Finitions obtenues</dt><dd>{options.join(', ')||'—'}</dd></div>:<div><dt>Finition d’origine</dt><dd>{card.finish||'Standard'}</dd></div>}</dl><p>{card.illustration?'Illustration originale.':'Silhouette de présentation en attendant l’illustration du personnage.'}</p>{card.provisional&&<p className="detail-note">Étude graphique de {card.name} · Clan et rareté à définir.</p>}</div></div></dialog></>;
}
