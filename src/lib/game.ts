import type {SupabaseClient} from '@supabase/supabase-js';
import type {DemoCard} from '@/components/Card';
import {ALL_RARITIES,type Finish,type Rarity} from './draw';

// Formes renvoyées par les RPC (voir supabase/migrations, docs/BACKEND.md).
export type ArtMeta={layout?:'portrait'|'full'|'cover';offsetY?:number};
export type PlayerState={
 profile:{id:string;handle:string|null;role:'player'|'admin';created_at:string};
 balance:number;
 boosters:{free:number;purchased:number;free_capacity:number;next_free_at:string|null};
 booster_offers:Record<string,number>;
 editions:{id:string;name:string;prefix:string;cover_path:string|null;openable:boolean}[];
};
export type OpenedCard={position:number;instance_id:string;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique?:boolean;finish:Finish;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Opening={opening_id:string;edition_id:string;ruleset_version:number;pool:'free'|'purchased';created_at:string;cards:OpenedCard[];replayed:boolean};
export type KnownAlbumEntry={known:true;character_id:string;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;name:string;role_title:string;clan:string|null;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;discovered_at:string;finishes_seen:Finish[];owned:Partial<Record<Finish,number>>};
export type UnknownAlbumEntry={known:false;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;silhouette_key:string|null};
export type AlbumEntry=KnownAlbumEntry|UnknownAlbumEntry;
/** Carte d'album : rendu + informations de possession. */
export type AlbumCard=DemoCard&{editionId?:string;finishesSeen?:Finish[];owned?:number};

/** "gravure-3" → 3 ; la silhouette est persistée en base, jamais recalculée. */
export function silhouetteIndex(key:string|null|undefined):number|undefined{
 const m=key?.match(/-(\d+)$/);
 return m?Number(m[1]):undefined;
}

function art(meta:ArtMeta|null|undefined){
 const layout=meta?.layout==='full'||meta?.layout==='cover'?meta.layout:undefined;
 const offset=Number(meta?.offsetY);
 return {artLayout:layout,artOffsetY:Number.isFinite(offset)?offset:undefined};
}

export function openedToCard(c:OpenedCard):DemoCard{
 return {id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:!!c.unique,known:true,finish:c.finish,
  illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),...art(c.art_meta)};
}

export function albumToCard(e:AlbumEntry):AlbumCard{
 if(!e.known)return {id:e.code,name:'Inconnu',clan:'Inconnu',role:'',rarity:e.rarity,unique:!!e.unique,known:false,silhouette:silhouetteIndex(e.silhouette_key),editionId:e.edition_id};
 const owned=Object.values(e.owned).reduce((s,n)=>s+(n??0),0);
 return {id:e.code,name:e.name,clan:e.clan??'?',role:e.role_title,rarity:e.rarity,unique:!!e.unique,known:true,
  illustration:e.art_path??undefined,silhouette:silhouetteIndex(e.silhouette_key),...art(e.art_meta),
  editionId:e.edition_id,finishesSeen:e.finishes_seen,owned};
}

const messages:Record<string,string>={
 not_authenticated:'Connectez-vous pour continuer.',
 account_suspended:'Ce compte est suspendu.',
 no_booster_available:'Aucun booster disponible dans votre réserve.',
 edition_unavailable:'Cette édition n’est pas ouverte aux boosters.',
 edition_incomplete:'Cette édition est momentanément incomplète : ouverture suspendue.',
 no_openable_edition:'Aucune édition n’est ouverte aux boosters pour le moment.',
 insufficient_funds:'Deniers insuffisants.',
 invalid_offer:'Offre inconnue.',
 handle_taken:'Ce pseudonyme est déjà pris.',
 invalid_handle:'Pseudonyme invalide : 3 à 24 caractères, lettres, chiffres, _ . -',
 forbidden:'Accès réservé à l’administrateur.',
 reason_required:'Un motif est obligatoire pour cette action.',
 prefix_taken:'Ce préfixe est déjà utilisé par une autre édition.',
 clan_taken:'Ce clan existe déjà.',
 number_taken:'Ce numéro est déjà pris dans cette édition.',
 name_required:'Le nom est obligatoire.',
 invalid_art_path:'Illustration refusée : elle doit venir du stockage du projet.',
 invalid_art_meta:'Réglage de cadrage invalide.',
 already_published:'Une carte déjà publiée ne revient pas en brouillon : archivez-la.',
 immutable_character:'Édition, numéro et rareté sont figés après création.',
 immutable_edition:'Le préfixe est figé dès la première carte.',
 edition_archived:'Cette édition est archivée.',
 not_found:'Élément introuvable (rechargez la page).',
};
export class GameError extends Error{
 constructor(public code:string,message:string,public definitive:boolean){super(message);}
}
/** Erreur métier (refus définitif) ou incident réseau (issue inconnue, à rejouer avec la même clé). */
export function toGameError(error:{message?:string;code?:string}|null|undefined):GameError{
 const raw=error?.message??'';
 const code=Object.keys(messages).find(k=>raw.startsWith(k));
 if(code)return new GameError(code,messages[code],true);
 const network=!error?.code||/fetch|network|timeout/i.test(raw);
 return new GameError('unknown',network?'Connexion interrompue. Réessayez : l’opération ne sera pas comptée deux fois.':'Une erreur est survenue.',!network);
}

export async function callRpc<T>(client:SupabaseClient,fn:string,args?:Record<string,unknown>):Promise<T>{
 let result;
 try{result=await client.rpc(fn,args);}catch(e){throw toGameError({message:(e as Error).message});}
 if(result.error)throw toGameError(result.error);
 return result.data as T;
}

// Ordre de révélation : de la moins rare à la plus rare, finitions spéciales en dernier à rareté égale,
// carte unique toujours en tout dernier.
// Affichage seulement : l'historique serveur conserve les positions du tirage.
const FINISH_ORDER=['Standard','Dorée','Sanglante'];
export function revealOrder<C extends {rarity:Rarity;finish?:string;unique?:boolean}>(cards:readonly C[]):C[]{
 return cards.map((card,i)=>({card,i})).sort((a,b)=>Number(!!a.card.unique)-Number(!!b.card.unique)||ALL_RARITIES.indexOf(a.card.rarity)-ALL_RARITIES.indexOf(b.card.rarity)||FINISH_ORDER.indexOf(a.card.finish??'Standard')-FINISH_ORDER.indexOf(b.card.finish??'Standard')||a.i-b.i).map(x=>x.card);
}
