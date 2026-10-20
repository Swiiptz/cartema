import type {SupabaseClient} from '@supabase/supabase-js';
import type {DemoCard} from '@/components/Card';
import type {Finish,Rarity} from './draw';

// Formes renvoyées par les RPC (voir supabase/migrations, docs/BACKEND.md).
export type ArtMeta={layout?:'portrait'|'full'|'cover';offsetY?:number};
export type PlayerState={
 profile:{id:string;handle:string|null;role:'player'|'admin';created_at:string};
 balance:number;
 boosters:{free:number;purchased:number;free_capacity:number;next_free_at:string|null};
 booster_offers:Record<string,number>;
 editions:{id:string;name:string;prefix:string;cover_path:string|null;openable:boolean}[];
};
export type OpenedCard={position:number;instance_id:string;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;finish:Finish;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Opening={opening_id:string;edition_id:string;ruleset_version:number;pool:'free'|'purchased';created_at:string;cards:OpenedCard[];replayed:boolean};
export type KnownAlbumEntry={known:true;character_id:string;edition_id:string;code:string;number:number;rarity:Rarity;name:string;role_title:string;clan:string|null;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;discovered_at:string;finishes_seen:Finish[];owned:Partial<Record<Finish,number>>};
export type UnknownAlbumEntry={known:false;edition_id:string;code:string;number:number;rarity:Rarity;silhouette_key:string|null};
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
 return {id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,known:true,finish:c.finish,
  illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),...art(c.art_meta)};
}

export function albumToCard(e:AlbumEntry):AlbumCard{
 if(!e.known)return {id:e.code,name:'Inconnu',clan:'Inconnu',role:'',rarity:e.rarity,known:false,silhouette:silhouetteIndex(e.silhouette_key),editionId:e.edition_id};
 const owned=Object.values(e.owned).reduce((s,n)=>s+(n??0),0);
 return {id:e.code,name:e.name,clan:e.clan??'?',role:e.role_title,rarity:e.rarity,known:true,
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
