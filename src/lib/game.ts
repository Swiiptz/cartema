import type {SupabaseClient} from '@supabase/supabase-js';
import type {DemoCard} from '@/components/Card';
import {ALL_RARITIES,type Finish,type Rarity} from './draw';

// Formes renvoyées par les RPC (voir supabase/migrations, docs/BACKEND.md).
export type ArtMeta={layout?:'portrait'|'full'|'cover'|'fullart';offsetY?:number};
/** Sachets de booster (voir BoosterSkin). */
export type BoosterThemeName='camarilla'|'alpes'|'sabbat'|'independant'|'gold';
export type PlayerEdition={id:string;name:string;prefix?:string;cover_path?:string|null;openable:boolean;teaser?:boolean;theme?:BoosterThemeName;offers?:Record<string,number>;reserve?:number};
export type PlayerState={
 profile:{id:string;handle:string|null;role:'player'|'admin';created_at:string;title?:string|null};
 balance:number;
 boosters:{free:number;purchased:number;free_capacity:number;next_free_at:string|null};
 booster_offers:Record<string,number>;
 /** Deniers du bonus quotidien crédités par cet appel (0 si déjà reçu aujourd'hui). */
 daily_reward?:number;
 /** Série de connexions : jours d'affilée, meilleure série, booster tous les `every` jours (0 = aucun). */
 streak?:{current:number;best:number;every:number;count:number;next_bonus_in:number|null};
 /** Boosters de série crédités par cet appel (palier atteint aujourd'hui). */
 streak_reward?:number;
 /** Invitations d'amis, cadeaux et échanges reçus en attente de réponse. */
 social_pending?:number;
 /** Missions accomplies dont la récompense n'est pas encore réclamée. */
 missions_ready?:number;
 /** Concours d'illustrations ouvert (bannière du site). */
 contest?:{id:string;title:string;ends_at:string}|null;
 /** Prochain concours, annoncé 14 jours avant son début (annonce de l'accueil). */
 contest_next?:{id:string;title:string;starts_at:string;ends_at:string;edition:string|null}|null;
 /** Éditions ouvertes (prix, boosters achetés pour elles) puis annoncées « Soon » (nom et sachet seulement). */
 editions:PlayerEdition[];
};
export type OpenedCard={position:number;new?:boolean;signed?:boolean;signature?:string|null;instance_id:string;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique?:boolean;finish:Finish;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;variant?:string|null;variant_kind?:string|null};
export type Opening={god?:boolean;opening_id:string;edition_id:string;ruleset_version:number;pool:'free'|'purchased'|'edition';created_at:string;cards:OpenedCard[];replayed:boolean};
export type KnownAlbumEntry={known:true;character_id:string;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;name:string;role_title:string;clan:string|null;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;discovered_at:string;finishes_seen:Finish[];owned:Partial<Record<Finish,number>>;variants?:ArtVariant[];art_credit?:string|null;event?:string|null};
export type ArtVariant={label:string;kind:string;art_path:string;art_meta:ArtMeta;credit?:string|null;count:number};
export type UnknownAlbumEntry={known:false;edition_id:string;code:string;number:number;rarity:Rarity;unique?:boolean;silhouette_key:string|null};
export type AlbumEntry=KnownAlbumEntry|UnknownAlbumEntry;
/** Carte d'album : rendu + informations de possession. */
export type AlbumCard=DemoCard&{variants?:ArtVariant[];characterId?:string;editionId?:string;finishesSeen?:Finish[];owned?:number};
export type InventoryItem={cooldown_until?:string|null;
 /** Exemplaire de l'artiste (concours) : mention gardée ; artist_until n'est plus renseigné depuis le 26/10 (plus de délai). */
 artist_copy?:boolean;artist_until?:string|null;signed?:boolean;variant?:string|null;variant_kind?:string|null;instance_id:string;finish:Finish;locked:boolean;reserved:boolean;reserved_kind?:string|null;listing_id?:string|null;listing_price?:number|null;listing_kind?:'fixed'|'auction'|null;acquired_at:string;unique:boolean;value:number};
export type ListingCard={artist_copy?:boolean;variant?:string|null;art_credit?:string|null;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique:boolean;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null};
export type Listing={buyer_tax?:number;min_next_tax?:number;listing_id:string;price:number;net:number;status:'active'|'sold'|'cancelled'|'expired';kind:'fixed'|'auction';ends_at:string|null;current_bid:number|null;bid_count:number;min_next_bid:number;leading:boolean;won:boolean;created_at:string;closed_at:string|null;mine:boolean;seller:string|null;buyer:string|null;finish:Finish;discovered:boolean;card:ListingCard};
export type SocialCard={artist_copy?:boolean;instance_id:string|null;finish:Finish;character_id:string;code:string;number:number;name:string;role_title:string;clan:string|null;rarity:Rarity;unique:boolean;art_path:string|null;art_meta:ArtMeta;silhouette_key:string|null;art_credit?:string|null;variant?:string|null;
 /** Exemplaire signé et image de la signature du personnage. */
 signed?:boolean;signature?:string|null;
 /** Choix de la vitrine : exemplaires possédés de cette version (au plus 5 identifiants). */
 copies?:number;instances?:string[]};
export type Friend={profile_id:string;handle:string;since:string;discovered:number};
export type FriendRequest={request_id:string;profile_id:string;handle:string;created_at:string};
export type Friends={friends:Friend[];incoming:FriendRequest[];outgoing:FriendRequest[]};
export type Gift={gift_id:string;status:'pending'|'accepted'|'declined'|'cancelled'|'expired';incoming:boolean;other:string|null;created_at:string;expires_at:string;closed_at:string|null;card:SocialCard};
export type Trade={trade_id:string;status:'pending'|'accepted'|'declined'|'cancelled'|'expired'|'countered';incoming:boolean;other_id:string;other:string|null;proposer_deniers:number;recipient_deniers:number;created_at:string;expires_at:string;closed_at:string|null;proposer_cards:SocialCard[];recipient_cards:SocialCard[]};
export type Social={gifts:Gift[];trades:Trade[];pending_count:number};
export function socialToCard(c:SocialCard):DemoCard{return {artistCopy:!!c.artist_copy,credit:c.art_credit??undefined,id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:c.unique,known:true,finish:c.finish,illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),signature:c.signed?c.signature??undefined:undefined,...art(c.art_meta)};}
export type Mission={assignment_id:string;kind:'daily'|'weekly';label:string;target:number;reward:number;progress:number;claimed:boolean;ends_at:string;replaceable?:boolean};
export type MissionBonus={boosters:number;claimed:boolean};
export type Missions={daily:Mission[];weekly:Mission[];replacement_available:boolean;daily_reset:string;weekly_reset:string;daily_bonus?:MissionBonus;weekly_bonus?:MissionBonus};
export type Achievement={code:string;secret:boolean;category:'collection'|'general'|'custom';label:string|null;description?:string|null;title?:string|null;edition?:string|null;edition_prefix?:string|null;rarity?:Rarity|null;reward_deniers?:number;reward_boosters?:number;progress?:number;target?:number;unlocked_at:string|null;reason?:string|null;conditional?:boolean;series?:string|null;series_label?:string|null;tier?:number|null;
 /** Succès de cartes : compte les cartes possédées (pas seulement découvertes). */
 owned_rule?:boolean;
 /** Set à 5 cartes ou moins du but : cartes manquantes (nom seulement si découverte). */
 missing?:{name:string|null;code:string}[];
 /** Lignée de clan : détenue tant que tous les membres sont possédés (unlocked_at), perdue sinon. */
 lineage?:boolean;lost_at?:string|null;reward_claimed?:boolean;
 /** Camp (Team Apo, Team Gwen…) : mêmes règles qu'une lignée, avec une carte interdite. */
 faction?:boolean};
/** Paliers d'une série de succès : métal par défaut ; une série dont les paliers portent une rareté
 * (De l'or à la lie) affiche le nom de la rareté. Jusqu'à 7 paliers (6 pour les séries en métal). */
export const TIER_NAMES=['Bronze','Argent','Or','Platine','Sang','Éternel'];
export const TIER_COLORS=['#c58a5a','#c9ccd6','#e7c46a','#a9e4e8','#d0344f','#e9e4f5'];
export const TIER_ROMAN=['I','II','III','IV','V','VI','VII'];
export const tierName=(a:{tier?:number|null;rarity?:string|null})=>a.rarity??TIER_NAMES[(a.tier??1)-1]??'';
export type FeaturedAchievement={code:string;label:string;description:string|null;title:string|null;tier:number|null;series_label:string|null;rarity:Rarity|null;category:string;unlocked_at:string};
export type WishItem={code:string;number:number;rarity:string;finish:string|null;silhouette_key:string|null;known:boolean;character_id?:string;name?:string;role_title?:string;clan?:string|null;art_path?:string|null;art_meta?:ArtMeta|null;owned?:number;on_market?:number;best_price?:number|null;friends?:string[]};
export type Wishlist={visible:boolean;items:WishItem[]};
/** Mesures utilisables par les missions, défis et classements d'événement. */
export const EVENT_METRICS:Record<string,string>={open_boosters:'Boosters ouverts',open_days:'Jours avec un booster ouvert',discover:'Visages découverts',discover_days:'Jours avec une découverte',
 rare_pull:'Cartes Rare ou mieux',very_rare_pull:'Cartes Très rare ou mieux',epic_pull:'Cartes Épique ou mieux',recycle:'Cartes recyclées',market_sell:'Ventes au marché',market_buy:'Achats au marché',
 market_list:'Mises en vente',auction_bid:'Enchères placées',trade_done:'Échanges conclus',gift_send:'Cartes offertes',daily_login:'Jours de connexion'};
export type GameEvent={id:string;name:string;description:string;starts_at:string;ends_at:string;active:boolean;finish_multiplier:number;deniers_multiplier:number;bonus_boosters:number;free_interval_hours:number|null;claimed:boolean;
 /** Trêve des échanges : ni délai de 72 h, ni délai avant retour pendant l'événement. */
 trade_truce?:boolean};
export type NotificationPrefs={friends:boolean;social:boolean;market:boolean;achievements:boolean};
export type AppNotification={id:string;kind:string;created_at:string;read:boolean;payload:{character?:string;title?:string;public?:boolean;position?:number;deniers?:number;boosters?:number;podium?:boolean;event?:string;rank?:number;accepted?:boolean;kind?:string;note?:string|null;target?:string;category?:string;from?:string;card?:string;finish?:string;status?:string;counter?:boolean;price?:number;amount?:number;auction?:boolean;buyer?:string;label?:string;reward_deniers?:number;reward_boosters?:number;quantity?:number;version?:string|null}};
export type Notifications={items:AppNotification[];unread:number;prefs:NotificationPrefs};
export type PublicProfile={verified?:boolean;featured:FeaturedAchievement[];profile_id:string;handle:string;title:string|null;created_at:string;relation:'self'|'friends'|'pending_out'|'pending_in'|'none';visible:boolean;settings:{visibility:'public'|'friends'|'private';show_stats:boolean}|null;showcase:SocialCard[]|null;stats:{faces:number;total_characters:number;achievements:number;gold:number;blood:number;position:number}|null;recent:{label:string;unlocked_at:string;tier:number|null}[]|null};
/** Classement de saison (null tant qu'aucune saison n'a été démarrée). */
export type SeasonBoard={season:{id:string;name:string;starts_at:string;ends_at:string|null;open:boolean;rewarded:boolean;rewards:ContestRewards};
 top:{position:number;handle:string;points:number;faces:number;achievements:number;missions:number;me:boolean}[];me:{position:number;points:number}|null};
export type Leaderboard={top:{position:number;handle:string;title:string|null;score:number;achievements:number;faces:number;me:boolean}[];me:{position:number;score:number;achievements:number;faces:number}|null;total_characters:number;total_achievements:number};
export type TradeStatus={handle_missing?:boolean;verified?:boolean;allowed:boolean;blocked:boolean;available_at:string|null;commission_pct:number;trade_tax_pct?:number;trade_cap?:number;trade_received_week?:number;trade_daily_limit?:number;trades_today?:number;gift_daily_limit?:number;gifts_sent_today?:number;gifts_received_today?:number};
export function listingToCard(l:Listing):DemoCard{return marketCard(l.card,l.finish);}
/** Carte du marché (annonce ou entrée regroupée), avec sa version d'illustration. */
export function marketCard(c:ListingCard,finish:Finish):DemoCard{return {artistCopy:!!c.artist_copy,variant:c.variant??undefined,credit:c.art_credit??undefined,id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:c.unique,known:true,finish,illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),...art(c.art_meta)};}
/** Offre d'une carte regroupée au marché (prix fixe). */
export type MarketOffer={listing_id:string;price:number;buyer_tax:number;seller:string|null;mine:boolean;created_at:string};
export type MarketGroup={max_price?:number;best?:MarketOffer|null;key:string;offers:number;min_price:number;discovered:boolean;finish:Finish;card:ListingCard;listings:MarketOffer[]};
/** Prix de référence d'une carte : 10 dernières ventes sur 90 jours, moyenne, dernière, offre la moins chère d'un autre joueur. */
export type CardPrices={sales:{price:number;kind:'fixed'|'auction';closed_at:string}[];average:number|null;last:number|null;lowest:number|null};
export type MarketBoard<T>={items:T[];total:number;clans:{id:string;name:string;listings?:number}[]};
export type RecycleResult={operation_id?:string;total:number;count:number;balance:number;replayed:boolean};
export type DuplicatePreview={count:number;total:number;by_rarity:Partial<Record<Rarity,number>>};

/** "gravure-3" → 3 ; la silhouette est persistée en base, jamais recalculée. */
export function silhouetteIndex(key:string|null|undefined):number|undefined{
 const m=key?.match(/-(\d+)$/);
 return m?Number(m[1]):undefined;
}

function art(meta:ArtMeta|null|undefined){
 const layout=meta?.layout==='full'||meta?.layout==='cover'||meta?.layout==='fullart'?meta.layout:undefined;
 const offset=Number(meta?.offsetY);
 return {artLayout:layout,artOffsetY:Number.isFinite(offset)?offset:undefined};
}

export function openedToCard(c:OpenedCard):DemoCard{
 return {id:c.code,name:c.name,clan:c.clan??'?',role:c.role_title,rarity:c.rarity,unique:!!c.unique,known:true,finish:c.finish,
  illustration:c.art_path??undefined,silhouette:silhouetteIndex(c.silhouette_key),variant:c.variant_kind==='alternate'?c.variant??undefined:undefined,fresh:!!c.new,signature:c.signed?c.signature??undefined:undefined,...art(c.art_meta)};
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
  characterId:e.character_id,editionId:e.edition_id,finishesSeen:e.finishes_seen,owned,variants:e.variants,credit:e.art_credit??undefined,event:e.event??undefined};
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
 season_open:'Une saison est déjà en cours.',
 invalid_title:'Titre invalide : 1 à 60 caractères.',
 number_taken:'Ce numéro est déjà pris dans cette édition.',
 name_required:'Le nom est obligatoire.',
 invalid_art_path:'Illustration refusée : elle doit venir du stockage du projet.',
 invalid_finish:'Finition invalide : Dorée ou Sanglante.',
 invalid_odds:'Chance invalide : un nombre entier entre 0 et 1 000 000, ou vide pour la chance globale.',
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
 contest_closed:'Le concours est fermé.',
 own_entry:'Vous ne pouvez pas voter pour votre propre dessin.',
 invalid_image:'Image refusée : envoyez-la depuis cette page.',
 contest_open:'Le concours est encore ouvert : la validation se fait après sa clôture.',
 already_decided:'Ce dessin a déjà été retenu autrement.',
 invalid_dates:'Dates invalides : la fin doit suivre le début.',
 eternal_edition:'Une édition éternelle ne s’ouvre pas en booster : ses cartes tombent en sixième carte.',
 handle_required:'Choisissez d’abord un pseudonyme dans votre profil : il s’affiche auprès des autres joueurs.',
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
 duplicate_card:'Cette carte est déjà dans la vitrine.',
 invalid_amount:'Indiquez un montant non nul.',
 confirmation_mismatch:'La confirmation ne correspond pas.',
 cannot_delete_admin:'Le compte administrateur ne peut pas être supprimé ici.',
 not_discovered:'Découvrez d’abord cette carte.',
 image_required:'Ajoutez une image.',
 credit_required:'Indiquez le nom à créditer (2 à 80 caractères).',
 too_many_submissions:'Trop de propositions aujourd’hui, réessayez demain.',
 feature_locked:'Cette nouveauté arrive avec le prochain set.',
 submissions_closed:'Les envois sont clos : vous pouvez encore voter jusqu’à la fin du concours.',
 already_submitted:'Vous avez déjà une proposition en attente pour cette carte.',
 self_report:'Vous ne pouvez pas vous signaler vous-même.',
 message_required:'Décrivez les faits (5 caractères minimum).',
 too_many_reports:'Trop de signalements aujourd’hui, réessayez demain.',
 already_reported:'Vous avez déjà signalé ce joueur ; l’administrateur va l’examiner.',
 already_closed:'Ce signalement est déjà traité.',
 unique_card:'La carte unique ne peut pas être donnée ni retirée.',
 invalid_setting:'Valeur hors des limites autorisées.',
 unknown_setting:'Réglage inconnu.',
 no_change:'Aucun changement à enregistrer.',
 wishlist_full:'Liste de souhaits pleine (60 cartes au maximum).',
 event_unavailable:'Cet événement n’est pas en cours.',
 event_without_effect:'Choisissez au moins un effet.',
 invalid_period:'La fin doit suivre le début.',
 event_closed:'Cet événement est terminé ou annulé.',
 insufficient_boosters:'Le joueur n’a pas assez de boosters achetés.',
 cannot_sanction_admin:'Impossible de sanctionner un administrateur.',
 too_many_achievements:'3 succès au maximum.',
 duplicate_achievement:'Ce succès est déjà mis en avant.',
 invalid_visibility:'Réglage de visibilité inconnu.',
 self_request:'Vous ne pouvez pas vous ajouter vous-même.',
 already_friends:'Vous êtes déjà amis.',
 request_pending:'Demande déjà envoyée.',
 not_friends:'Réservé à vos amis.',
 gift_unavailable:'Ce cadeau n’est plus disponible.',
 rules_too_long:'Les règles sont trop longues (8 000 caractères au plus).',
 invalid_suggestion:'Titre de 3 à 80 caractères, description de 2 000 caractères au plus.',
 suggestion_limit:'Vous avez envoyé 5 doléances aujourd’hui. Revenez demain, après 6 h.',
 own_suggestion:'On ne vote pas pour sa propre idée.',
 downvotes_disabled:'Cette idée ne se vote que pour, pas contre.',
 invalid_vote:'Vote invalide.',
 card_cooldown:'Carte reçue récemment : elle ne peut pas être échangée, offerte ni vendue avant 72 h.',
 artist_copy:'Exemplaire de l’artiste : il ne peut être ni vendu, ni échangé, ni offert pendant 30 jours après le concours.',
 card_returning:'Cette carte a appartenu à ce joueur il y a moins de 7 jours : elle ne peut pas encore lui revenir.',
 trade_daily_limit:'Limite d’échanges du jour atteinte (pour vous ou votre ami). Elle se renouvelle à 6 h.',
 gift_daily_limit:'Vous avez envoyé tous vos cadeaux du jour. La limite se renouvelle à 6 h.',
 gift_received_limit:'Vous avez reçu tous les cadeaux possibles aujourd’hui. Réessayez après 6 h (le cadeau reste en attente 48 h).',
 trade_unavailable:'Cet échange n’est plus disponible.',
 card_unavailable:'Une des cartes n’est plus disponible (vendue, verrouillée ou engagée).',
 empty_trade:'Ajoutez au moins une carte à l’échange.',
 trade_deniers_cap:'Plafond hebdomadaire de Deniers reçus par échange dépassé (pour vous ou votre ami). Réduisez le montant ou attendez quelques jours.',
 too_many_cards:'10 cartes maximum de chaque côté.',
 mission_incomplete:'Mission pas encore accomplie.',
 already_claimed:'Récompense déjà réclamée.',
 replacement_used:'Remplacement gratuit déjà utilisé aujourd’hui.',
 not_replaceable:'Cette mission ne peut pas être remplacée.',
 title_locked:'Ce titre n’est pas encore débloqué.',
 already_granted:'Ce joueur a déjà ce succès.',
 conditional_achievement:'Ce succès se débloque automatiquement.',
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

/** Au-delà, la requête est abandonnée : un message s'affiche au lieu d'un chargement sans fin. */
const RPC_TIMEOUT_MS=20000;
export async function callRpc<T>(client:SupabaseClient,fn:string,args?:Record<string,unknown>):Promise<T>{
 let result;
 try{result=await client.rpc(fn,args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));}
 catch(e){throw toGameError({message:(e as Error).message});}
 if(result.error)throw toGameError(result.error);
 return result.data as T;
}

// Ordre de révélation : de la moins rare à la plus rare, finitions spéciales en dernier à rareté égale,
// carte unique toujours en tout dernier.
// Affichage seulement : l'historique serveur conserve les positions du tirage.
const FINISH_ORDER=['Standard','Dorée','Sanglante'];
/** Ordre de révélation : rareté croissante, puis les éternelles (ETER), la carte unique en tout dernier. */
export function revealOrder<C extends {rarity:Rarity;finish?:string;unique?:boolean;id?:string}>(cards:readonly C[]):C[]{
 const last=(c:C)=>c.unique?2:c.id?.startsWith('ETER-')?1:0;
 return cards.map((card,i)=>({card,i})).sort((a,b)=>last(a.card)-last(b.card)||ALL_RARITIES.indexOf(a.card.rarity)-ALL_RARITIES.indexOf(b.card.rarity)||FINISH_ORDER.indexOf(a.card.finish??'Standard')-FINISH_ORDER.indexOf(b.card.finish??'Standard')||a.i-b.i).map(x=>x.card);
}

/** Concours d'illustrations (voir supabase/migrations/20261022260000_art_contest.sql). */
export type ContestCard={character_id:string;code:string;number:number;name:string;clan:string|null;rarity:Rarity;discovered:boolean;card:SocialCard|null;entries:number;leader:string|null;mine:boolean;voted:boolean;
 /** Carte à privilégier (sans illustration ou illustration IA) : points multipliés. */
 priority?:boolean;
 /** Multiplicateur des points de la carte : Mythique ×3, carte à privilégier ×2, sinon 1. */
 multiplier?:number};
export type ContestPlace={from:number;to:number;deniers:number;boosters:number};
export type ContestRewards={places:ContestPlace[];others:{deniers:number;boosters:number}};
/** Galerie : concours clos, dessins retenus (carte rendue avec l'illustration) et podium une fois distribué. */
export type ContestGalleryItem={entry_id:string;character:string;code:string;rarity:Rarity;author:string|null;kind:'main'|'alternate';line_label:string|null;real_drawing:boolean;image_path:string;card:SocialCard};
export type ContestGalleryMythic={character_id:string;character:string;code:string;versions:SocialCard[]};
export type ContestGallery={id:string;title:string;edition:string;starts_at:string;ends_at:string;final:boolean;entries:number;artists:number;
 podium:{place:number;handle:string;points:number;selected:number;leads:number}[];selected:ContestGalleryItem[];
 /** Classement complet après la distribution (place, pseudo, points), et Mythiques avec toutes leurs versions (26/10). */
 ranking?:{place:number;handle:string;points:number}[];mythics?:ContestGalleryMythic[]};
export type Contest={id:string;title:string;starts_at:string;ends_at:string;open:boolean;rewarded:boolean;edition:string;rewards:ContestRewards;submissions_end_at?:string|null;submissions_open?:boolean;rules?:string|null;upcoming?:boolean;priority_multiplier?:number;allow_mythic?:boolean;mythic_multiplier?:number;my_entries:number;my_points:number;cards:ContestCard[]};
export type ContestEntry={entry_id:string;image_path:string;author:string;votes:number;leading:boolean;mine:boolean;my_vote:boolean;selected:'main'|'alternate'|null;created_at:string};
export type ContestRank={position:number;handle:string;leads:number;selected:number;real:number;points:number;me:boolean};

/** Doléances (voir supabase/migrations/20261022330000_suggestions_tiers.sql). */
export type SuggestionCategory='feature'|'card'|'bug'|'other';
export type SuggestionStatus='new'|'planned'|'done'|'declined';
export type Suggestion={id:string;category:SuggestionCategory;title:string;body:string;status:SuggestionStatus;public:boolean;reply:string|null;created_at:string;replied_at:string|null;mine:boolean;author:string|null;votes:number;my_vote:boolean;image_path?:string|null;allow_downvotes?:boolean;downvotes?:number;my_downvote?:boolean};
export const SUGGESTION_CATEGORIES:Record<SuggestionCategory,string>={feature:'Fonctionnalité',card:'Carte',bug:'Correction',other:'Autre'};
export const SUGGESTION_STATUS:Record<SuggestionStatus,string>={new:'Reçue',planned:'Prévue',done:'Faite',declined:'Écartée'};
