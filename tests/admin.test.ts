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

import {matchIllustrations,nameKey} from '../src/lib/admin';
describe('association des illustrations par nom de fichier',()=>{
  const c=(id:string,name:string,status='draft')=>({id,name,status,edition_id:'e',number:1}) as AdminCharacter;
  const chars=[c('1','Norton'),c('2','Clément de Saint-Simon'),c('3','Arthur'),c('4','Arthur'),c('5','Rus','archived'),c('6','Isabeau de Sancerre')];
  it('normalise accents, casse, extension et séparateurs',()=>{
    expect(nameKey('Clement_de-Saint_Simon.PNG')).toBe('clement de saint simon');
  });
  it('associe par nom complet, sinon par prénom, et signale les ambiguïtés',()=>{
    const r=matchIllustrations([{name:'norton.webp'},{name:'Clément de Saint-Simon.png'},{name:'arthur.jpg'},{name:'Isabeau.png'},{name:'rus.png'},{name:'notes.txt'},{name:'Inconnu.png'}],chars);
    expect(r.map(m=>[m.file.name,m.candidates.map(x=>x.id)])).toEqual([
      ['norton.webp',['1']],['Clément de Saint-Simon.png',['2']],['arthur.jpg',['3','4']],['Isabeau.png',['6']],['rus.png',[]],['Inconnu.png',[]]]);
  });
});
