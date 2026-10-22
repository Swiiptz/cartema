import type {SupabaseClient} from '@supabase/supabase-js';
import type {Rarity} from './draw';
import type {ArtMeta,BoosterThemeName} from './game';

/** Sachets de booster disponibles (voir BoosterSkin). */
export type BoosterTheme=BoosterThemeName;
export const BOOSTER_THEMES:[BoosterTheme,string][]=[['camarilla','Camarilla (bordeaux)'],['alpes','Alpes de Savoie (bleu nuit)'],['sabbat','Sabbat (nuit)'],['independant','Indépendants (émeraude)'],['gold','Or']];
export type AdminEdition={id:string;name:string;prefix:string;cover_path:string|null;album_published:boolean;packs_enabled:boolean;archived_at:string|null;teaser?:boolean;booster_theme?:BoosterTheme;booster_offers?:Record<string,number>|null;complete:boolean;used:boolean;published_by_rarity:Partial<Record<Rarity,number>>};
export type AdminClan={id:string;name:string;symbol_key:string|null};
export type CharacterStatus='draft'|'published'|'archived';
export type IllustrationMeta=ArtMeta&{width?:number;height?:number;transparent?:boolean;original?:string};
export type AdminCharacter={art_credit?:string|null;id:string;edition_id:string;clan_id:string|null;number:number;name:string;role_title:string;rarity:Rarity;art_path:string|null;art_meta:IllustrationMeta;silhouette_key:string|null;is_unique?:boolean;status:CharacterStatus;published_at:string|null;updated_at:string};
export type AdminCatalog={editions:AdminEdition[];clans:AdminClan[];characters:AdminCharacter[]};

/** Clans dont le moteur de cartes possède déjà un symbole gravé (tarot-renderer.js). */
export const ENGRAVED_CLANS=['Toréador','Gangrel','Malkavien','Ventrue','Tremere','Brujah','Nosferatu','Lasombra','Assamite','Ravnos','Giovanni','Sethite','Baali','Tzimisce'];

export const ACCEPTED_TYPES=['image/png','image/webp','image/jpeg'];
export const MAX_UPLOAD_BYTES=15*1024*1024;
const DISPLAY_WIDTH=900;

/**
 * Cadrage par défaut, sans réglage par personnage :
 * - portrait détouré (transparent) → fenêtre portrait, image entière en haut ;
 * - image opaque de proportion portrait classique (ex. Norton, 1,33) → fenêtre portrait ;
 * - image opaque très verticale (ex. Rus, 2,0) ou plus large que haute → remplissage de la fenêtre.
 * L'administrateur peut corriger le cadrage et le décalage avant publication.
 */
export function defaultLayout({width,height,transparent}:{width:number;height:number;transparent:boolean}):'portrait'|'cover'{
 if(transparent)return 'portrait';
 const ratio=height/width;
 return ratio<1||ratio>=1.8?'cover':'portrait';
}

export function nextNumber(characters:readonly AdminCharacter[],editionId:string):number{
 return characters.filter(c=>c.edition_id===editionId).reduce((m,c)=>Math.max(m,c.number),0)+1;
}

/** Vérifie que le fichier est réellement une image décodable, détecte transparence et dimensions. */
async function inspect(file:File){
 if(!ACCEPTED_TYPES.includes(file.type))throw new Error('Format refusé : PNG, WebP ou JPEG uniquement.');
 if(file.size>MAX_UPLOAD_BYTES)throw new Error('Fichier trop lourd : 15 Mo maximum.');
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}
 catch{throw new Error('Ce fichier n’est pas une image lisible.');}
 if(bitmap.width<200||bitmap.height<200)throw new Error('Image trop petite : 200 × 200 px minimum.');
 let transparent=false;
 if(file.type!=='image/jpeg'){
  const probe=new OffscreenCanvas(64,64);const ctx=probe.getContext('2d')!;
  ctx.drawImage(bitmap,0,0,64,64);
  const data=ctx.getImageData(0,0,64,64).data;
  for(let i=3;i<data.length;i+=4)if(data[i]<250){transparent=true;break;}
 }
 return {bitmap,transparent};
}

async function toDisplayWebp(bitmap:ImageBitmap):Promise<Blob>{
 const scale=Math.min(1,DISPLAY_WIDTH/bitmap.width);
 const canvas=new OffscreenCanvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));
 const ctx=canvas.getContext('2d')!;
 ctx.imageSmoothingQuality='high';
 ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 return canvas.convertToBlob({type:'image/webp',quality:.9});
}

/**
 * Conserve l'original intact, publie une version d'affichage WebP (900 px de large, sans recadrage)
 * et renvoie le chemin public et les métadonnées à enregistrer sur le personnage.
 */
/**
 * Un dossier par édition, nommé d'après la carte : CAM/display/CAM-001-1a2b3c4d.webp.
 * Le suffixe aléatoire évite qu'un remplacement soit masqué par le cache des navigateurs.
 */
export function illustrationPaths(prefix:string,number:number,ext:string,token:string){
 const code=`${prefix}-${String(number).padStart(3,'0')}`;
 return {original:`${prefix}/originals/${code}-${token}.${ext}`,display:`${prefix}/display/${code}-${token}.webp`};
}

export async function uploadIllustration(client:SupabaseClient,file:File,card:{prefix:string;number:number}):Promise<{path:string;meta:IllustrationMeta}>{
 const {bitmap,transparent}=await inspect(file);
 const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 const bucket=client.storage.from('illustrations');
 const {original,display}=illustrationPaths(card.prefix,card.number,ext,crypto.randomUUID().slice(0,8));
 const up1=await bucket.upload(original,file,{contentType:file.type,upsert:false});
 if(up1.error)throw new Error(`Envoi de l’original impossible : ${up1.error.message}`);
 const up2=await bucket.upload(display,await toDisplayWebp(bitmap),{contentType:'image/webp',upsert:false,cacheControl:'31536000'});
 if(up2.error)throw new Error(`Envoi de la version d’affichage impossible : ${up2.error.message}`);
 const meta:IllustrationMeta={layout:defaultLayout({width:bitmap.width,height:bitmap.height,transparent}),offsetY:0,width:bitmap.width,height:bitmap.height,transparent,original};
 bitmap.close();
 return {path:bucket.getPublicUrl(display).data.publicUrl,meta};
}

/** Clé de comparaison : sans accents, casse, extension ni séparateurs (« Saint_Simon.png » = « saint simon »). */
export function nameKey(s:string):string{
 return s.replace(/\.[a-z0-9]{2,5}$/i,'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9*]+/g,' ').trim();
}

export type IllustrationMatch<F>={file:F;candidates:AdminCharacter[]};
/**
 * Rapproche chaque fichier du personnage de même nom : nom complet d'abord, sinon prénom seul
 * (premier mot du nom) en dernier recours. Plusieurs candidats = choix manuel ; aucun = fichier ignoré.
 */
export function matchIllustrations<F extends {name:string}>(files:readonly F[],characters:readonly AdminCharacter[]):IllustrationMatch<F>[]{
 const active=characters.filter(c=>c.status!=='archived');
 return files.filter(f=>/\.(png|webp|jpe?g)$/i.test(f.name)).map(file=>{
  const key=nameKey(file.name);
  let candidates=active.filter(c=>nameKey(c.name)===key);
  if(!candidates.length)candidates=active.filter(c=>nameKey(c.name.split(' ')[0])===key);
  return {file,candidates};
 });
}
