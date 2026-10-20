import {describe,it,expect} from 'vitest';
import {defaultLayout,nextNumber,type AdminCharacter} from '../src/lib/admin';

describe('préparation des illustrations',()=>{
  it('choisit un cadrage par défaut cohérent avec les illustrations validées',()=>{
    expect(defaultLayout({width:373,height:602,transparent:true})).toBe('portrait'); // Alhoon détouré
    expect(defaultLayout({width:1086,height:1448,transparent:false})).toBe('portrait'); // Norton
    expect(defaultLayout({width:1920,height:3838,transparent:false})).toBe('cover'); // Rus, très vertical
    expect(defaultLayout({width:1600,height:900,transparent:false})).toBe('cover'); // paysage
  });
  it('propose le numéro suivant dans l’édition',()=>{
    const c=(edition_id:string,number:number)=>({edition_id,number}) as AdminCharacter;
    expect(nextNumber([c('a',1),c('a',7),c('b',30)],'a')).toBe(8);
    expect(nextNumber([],'a')).toBe(1);
  });
});
