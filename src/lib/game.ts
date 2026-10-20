import type {SupabaseClient} from '@supabase/supabase-js';
import type {DemoCard} from '@/components/Card';
import {ALL_RARITIES,type Finish,type Rarity} from './draw';

// Formes renvoyées par les RPC (voir supabase/migrations, docs/BACKEND.md).
export type ArtMeta={layout?:'portrait'|'full'|'cover';offsetY?:number};
export type PlayerState={
 profile:{id:string;handle:string|null;role:'player'|'admin';created_at:string;title?:string|null};
 balance:number;
 boosters:{free:number;purchased:number;free_capacity:number;next_free_at:string|null};
 booster_offers:Record<string,number>;
 /** Deniers du bonus quotidien crédités par cet appel (0 si déjà reçu aujourd'hui). */
 daily_reward?:number;
 /** Invitations d'amis, cadeaux et échanges reçus en attente de réponse. */
 social_pending?:number;
 /** Missions accomplies dont la récompense n'est pas encore réclamée. */
 missions_ready?:number;
 editions:{id:string;name:string;prefix:string;cover_path:string|null;openable:boolean}[];
};
export type OpenedCard={position:number;instance_id:string;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique?:boolean;finish:Finish;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Opening={opening_id:string;edition_id:string;ruleset_version:number;pool:'free'|'purchased';created_at:string;cards:OpenedCard[];replayed:boolean};
export type KnownAlbumEntry={known:true;character_id:string;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;name:string;role_title:string;clan:string|null;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;discovered_at:string;finishes_seen:Finish[];owned:Partial<Record<Finish,number>>};
export type UnknownAlbumEntry={known:false;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;silhouette_key:string|null};
export type AlbumEntry=KnownAlbumEntry|UnknownAlbumEntry;
/** Carte d'album : rendu + informations de possession. */
export type AlbumCard=DemoCard&{characterId?:string;editionId?:string;finishesSeen?:Finish[];owned?:number};
export type InventoryItem={instance_id:string;finish:Finish;locked:boolean;reserved:boolean;reserved_kind?:string|null;listing_id?:string|null;listing_price?:number|null;listing_kind?:'fixed'|'auction'|null;acquired_at:string;unique:boolean;value:number};
export type ListingCard={character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique:boolean;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Listing={listing_id:string;price:number;net:number;status:'active'|'sold'|'cancelled'|'expired';kind:'fixed'|'auction';ends_at:string|null;current_bid:number|null;bid_count:number;min_next_bid:number;leading:boolean;won:boolean;created_at:string;closed_at:string|null;mine:boolean;seller:string|null;buyer:string|null;finish:Finish;discovered:boolean;card:ListingCard};
export type SocialCard={instance_id:string|null;finish:Finish;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique:boolean;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Friend={profile_id:string;handle:string;since:string;discovered:number};
export type FriendRequest={request_id:string;profile_id:string;handle:string;created_at:string};
export type Friends={friends:Friend[];incoming:FriendRequest[];outgoing:FriendRequest[]};
export type Gift={gift_id:string;status:'pending'|'accepted'|'declined'|'cancelled'|'expired';incoming:boolean;other:string|null;created_at:string;expires_at:string;closed_at:string|null;card:SocialCard};
export type Trade={trade_id:string;status:'pending'|'accepted'|'declined'|'cancelled'|'expired'|'countered';incoming:boolean;other_id:string;other:string|null;proposer_deniers:number;recipient_deniers:number;created_at:string;expires_at:string;closed_at:string|null;proposer_cards:SocialCard[];recipient_cards:SocialCard[]};
export type Social={gifts:Gift[];trades:Trade[];pending_count:number};
export function socialToCard(c:SocialCard):DemoCard{return {id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:c.unique,known:true,finish:c.finish,illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),...art(c.art_meta)};}
export type Mission={assignment_id:string;kind:'daily'|'weekly';label:string;target:number;reward:number;progress:number;claimed:boolean;ends_at:string};
export type Missions={daily:Mission[];weekly:Mission[];replacement_available:boolean;daily_reset:string;weekly_reset:string};
export type Achievement={code:string;secret:boolean;category:'collection'|'general'|'custom';label:string|null;description?:string|null;title?:string|null;edition?:string|null;edition_prefix?:string|null;rarity?:Rarity|null;reward_deniers?:number;reward_boosters?:number;progress?:number;target?:number;unlocked_at:string|null;reason?:string|null;conditional?:boolean};
export type Leaderboard={top:{position:number;handle:string;title:string|null;score:number;me:boolean}[];me:{position:number;score:number}|null;total_characters:number};
export type TradeStatus={allowed:boolean;blocked:boolean;available_at:string|null;commission_pct:number};
export function listingToCard(l:Listing):DemoCard{const c=l.card;return {id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:c.unique,known:true,finish:l.finish,illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),...art(c.art_meta)};}
export type RecycleResult={operation_id?:string;total:number;count:number;balance:number;replayed:boolean};
export type DuplicatePreview={count:number;total:number;by_rarity:Partial<Record<Rarity,number>>};

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
 // Affichée dans la finition la plus rare possédée, sinon la plus rare déjà obtenue.
 const rank=(f:Finish)=>(['Standard','Dorée','Sanglante'] as Finish[]).indexOf(f);
 const ownedFinishes=(Object.keys(e.owned) as Finish[]).filter(f=>(e.owned[f]??0)>0);
 const pool=ownedFinishes.length?ownedFinishes:e.finishes_seen;
 const best=[...pool].sort((x,y)=>rank(y)-rank(x))[0];
 const shown=best&&best!=='Standard'?best:undefined;
 return {id:e.code,name:e.name,clan:e.clan??'?',role:e.role_title,rarity:e.rarity,unique:!!e.unique,known:true,finish:shown,
  illustration:e.art_path??undefined,silhouette:silhouetteIndex(e.silhouette_key),...art(e.art_meta),
  characterId:e.character_id,editionId:e.edition_id,finishesSeen:e.finishes_seen,owned};
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
 confirm_special_finish:'Confirmez le recyclage des finitions Dorée ou Sanglante.',
 card_locked:'Cette carte est verrouillée : déverrouillez-la d’abord.',
 card_reserved:'Cette carte est engagée dans une vente ou un échange.',
 not_owned:'Cette carte ne vous appartient plus (rechargez la page).',
 nothing_to_recycle:'Aucune carte à recycler.',
 unique_indestructible:'Une carte unique ne peut pas être recyclée.',
 recycled_item:'Cette carte a déjà été recyclée.',
 account_too_new:'Les échanges entre joueurs s’ouvrent 24 h après la création du compte.',
 transactions_blocked:'Les échanges sont suspendus sur ce compte.',
 invalid_price:'Prix invalide : un nombre entier de Deniers, au moins 1.',
 listing_unavailable:'Cette annonce n’est plus disponible.',
 own_listing:'C’est votre propre annonce.',
 invalid_duration:'Durée d’enchère invalide (12, 24, 48 ou 72 h).',
 auction_closed:'Cette enchère est terminée.',
 already_leading:'Vous êtes déjà le meilleur enchérisseur.',
 bid_too_low:'Mise trop basse : respectez le palier minimum.',
 auction_has_bids:'Une enchère qui a reçu une mise ne peut plus être retirée.',
 not_fixed_price:'Cette annonce est une enchère.',
 player_not_found:'Aucun joueur avec ce pseudonyme.',
 self_request:'Vous ne pouvez pas vous ajouter vous-même.',
 already_friends:'Vous êtes déjà amis.',
 request_pending:'Demande déjà envoyée.',
 not_friends:'Réservé à vos amis.',
 gift_unavailable:'Ce cadeau n’est plus disponible.',
 trade_unavailable:'Cet échange n’est plus disponible.',
 card_unavailable:'Une des cartes n’est plus disponible (vendue, verrouillée ou engagée).',
 empty_trade:'Ajoutez au moins une carte à l’échange.',
 too_many_cards:'10 cartes maximum de chaque côté.',
 mission_incomplete:'Mission pas encore accomplie.',
 already_claimed:'Récompense déjà réclamée.',
 replacement_used:'Remplacement gratuit déjà utilisé aujourd’hui.',
 title_locked:'Ce titre n’est pas encore débloqué.',
 already_granted:'Ce joueur a déjà ce succès.',
 conditional_achievement:'Ce succès se débloque automatiquement (cartes requises).',
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
