import {describe,it,expect} from 'vitest';
import {ALL_RARITIES,SLOT_5,FINISHES,validateWeights,drawPack,drawWeighted,type Card} from '../src/lib/draw';
const catalog:Card[]=ALL_RARITIES.map((r,i)=>({id:String(i),name:`Perso ${i}`,rarity:r}));
describe('tirage',()=>{
  it('valide les distributions',()=>{expect(()=>validateWeights(SLOT_5)).not.toThrow();expect(()=>validateWeights(FINISHES)).not.toThrow();});
  it('garantit une rare ou supérieure en cinquième emplacement',()=>{for(let k=0;k<100;k++){let i=0;const pack=drawPack(catalog,()=>((k*31+(i++*19))%100)/100);expect(['Rare','Très rare','Épique','Légendaire','Mythique']).toContain(pack[4].card.rarity);}});
  it('bloque une édition incomplète',()=>expect(()=>drawPack(catalog.slice(1),()=>0.1)).toThrow(/bloquée/));
  it('refuse un total de poids invalide',()=>expect(()=>drawWeighted([{value:'a',weight:50}],()=>0.2)).toThrow());
});
