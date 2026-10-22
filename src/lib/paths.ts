/** Préfixe GitHub Pages ("/<dépôt>"), vide en local. */
export const basePath=process.env.NEXT_PUBLIC_BASE_PATH||'';
export const withBase=(path:string)=>`${basePath}${path}`;

const storagePrefix=process.env.NEXT_PUBLIC_SUPABASE_URL
 ?`${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'')}/storage/v1/object/public/`:null;

/** Illustrations acceptées : fichiers locaux de /illustrations/ ou stockage public du projet Supabase. */
export function resolveIllustration(path?:string|null):string|undefined{
 if(!path)return undefined;
 if(path.startsWith('/illustrations/')&&!path.includes('..'))return withBase(path);
 if(storagePrefix&&path.startsWith(storagePrefix)&&!path.includes('..'))return path;
 // Aperçu admin d'un fichier choisi localement (URL créée par la page elle-même).
 if(path.startsWith(`blob:${typeof location==='undefined'?'':location.origin}/`))return path;
 return undefined;
}

/** Adresse publique d'un dessin du concours (stockage « contest »), ou rien sans Supabase. */
export function contestImageUrl(path:string):string|undefined{
 if(!storagePrefix||path.includes('..'))return undefined;
 return `${storagePrefix}contest/${path}`;
}
