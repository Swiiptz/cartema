/** Moteur probabiliste de référence, pur. En production, appeler uniquement depuis le serveur. */
export type Rarity = 'Commun'|'Peu commun'|'Rare'|'Très rare'|'Épique'|'Légendaire'|'Mythique';
export type Finish = 'Standard'|'Dorée'|'Sanglante';
export type Weighted<T extends string> = ReadonlyArray<{value:T; weight:number}>;
export const SLOT_5: Weighted<Rarity> = [
  {value:'Rare',weight:55},{value:'Très rare',weight:37},{value:'Épique',weight:6},
  {value:'Légendaire',weight:1.9},{value:'Mythique',weight:0.1}
];
export const FINISHES: Weighted<Finish> = [
  {value:'Standard',weight:98},{value:'Dorée',weight:1.8},{value:'Sanglante',weight:0.2}
];
// Provisoire : à confirmer dans le cahier des charges.
export const SLOT_1_3: Weighted<Rarity> = [{value:'Commun',weight:70},{value:'Peu commun',weight:30}];
export const SLOT_4: Weighted<Rarity> = [{value:'Peu commun',weight:75},{value:'Rare',weight:20},{value:'Épique',weight:5}];
export const ALL_RARITIES: Rarity[]=['Commun','Peu commun','Rare','Très rare','Épique','Légendaire','Mythique'];
export type Card = {id:string;name:string;rarity:Rarity};
export function validateWeights<T extends string>(table:Weighted<T>):void {
  if(!table.length || table.some(x=>!Number.isFinite(x.weight)||x.weight<=0)) throw new Error('Poids non valides');
  const total=table.reduce((s,x)=>s+x.weight,0);
  if(Math.abs(total-100)>1e-8) throw new Error(`Total des poids invalide : ${total}`);
  if(new Set(table.map(x=>x.value)).size!==table.length) throw new Error('Valeurs répétées');
}
export function drawWeighted<T extends string>(table:Weighted<T>,rand:()=>number):T {
  validateWeights(table);
  const n=rand();
  if(!Number.isFinite(n)||n<0||n>=1) throw new Error('Aléa hors de [0,1[');
  let threshold=0;
  for(const item of table){ threshold+=item.weight/100; if(n<threshold+Number.EPSILON) return item.value; }
  return table[table.length-1].value;
}
/** L'appelant doit fournir un RNG cryptographiquement sûr CÔTÉ SERVEUR. */
export function drawPack(catalog:Card[],rand:()=>number):Array<{card:Card;finish:Finish}> {
  for(const rarity of ALL_RARITIES) if(!catalog.some(c=>c.rarity===rarity)) throw new Error(`Édition bloquée : rareté absente (${rarity})`);
  const slots=[SLOT_1_3,SLOT_1_3,SLOT_1_3,SLOT_4,SLOT_5];
  return slots.map(slot=>{
    const rarity=drawWeighted(slot,rand);
    const options=catalog.filter(c=>c.rarity===rarity);
    if(!options.length) throw new Error('Édition incomplète');
    const idx=Math.floor(rand()*options.length);
    const card=options[idx];
    const finish=drawWeighted(FINISHES,rand);
    return {card,finish};
  });
}
