import {describe,it,expect} from 'vitest';
import {fold,matches} from '../src/lib/search';

describe('recherche sans accents (doléance du 30/10)',()=>{
  it('ignore accents, casse, ligatures et apostrophe typographique',()=>{
    expect(fold('  Lucié ')).toBe('lucie');
    expect(fold('Œdipe d’Arc')).toBe("oedipe d'arc");
    expect(matches('Lucien','lucie')).toBe(true);
    expect(matches('Lucié','Lucie')).toBe(true);
    expect(matches('Nosfératu','nosferatu')).toBe(true);
    expect(matches('Ventrue','lucie')).toBe(false);
  });
});
