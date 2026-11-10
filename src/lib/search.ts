/** Texte replié pour la recherche : minuscules, sans accents ni ligatures, apostrophe droite (« Lucie » trouve « Lucié »). */
export const fold=(s:string|null|undefined)=>(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/œ/gi,'oe').replace(/æ/gi,'ae').replace(/’/g,"'").toLocaleLowerCase('fr').trim();
/** Le texte contient-il la recherche, accents ignorés ? Une recherche vide correspond à tout. */
export const matches=(text:string|null|undefined,query:string)=>fold(text).includes(fold(query));
