import {describe,it,expect} from 'vitest';
import {parseCsv,mapRows,toSql} from '../scripts/sheet-import.mjs';

const csv=`Prénom,Nom,Clan,Statut/Secte,Rareté,Mort/vivant/disparu,Praxis (SET),Poste & année
Caïn,,*,*,One,Inconnu,*,
Yvan,,Gangrel,Anarch,Peu commun,Mort,Flandres & Artois,
Clément,de Saint-Simon,Toréador,Ancien,Légendaire,Inconnu,Natio,Prince
"Isabeau ",d'Arc,Malkavian,Inconnu,Epique,Vivant,Ys,
Morgan,,Gangrel,Inconnu,,Vivant,Montpelliérain,
Melchior,,Inconnu,Anarch,Très rare,Inconnu,Les Jardins,
`;

describe('import du Google Sheets',()=>{
  const result=mapRows(parseCsv(csv));
  it('numérote selon la ligne du fichier et écarte les raretés invalides',()=>{
    expect(result.characters.map((c:any)=>c.number)).toEqual([2,3,4,6]);
    expect(result.skipped.map((s:any)=>[s.line,s.reason])).toEqual([[2,'rareté « One » hors des 7'],[6,'rareté manquante']]);
  });
  it('applique le mapping validé',()=>{
    const [yvan,clement,isabeau,melchior]=result.characters;
    expect(yvan).toMatchObject({name:'Yvan',role_title:'Anarch',clan:'Gangrel',rarity:'Peu commun'});
    expect(clement).toMatchObject({name:'Clément de Saint-Simon',role_title:'Prince',rarity:'Légendaire'});
    expect(isabeau).toMatchObject({name:'Isabeau d\'Arc',role_title:'',clan:'Malkavien',rarity:'Épique'});
    expect(melchior).toMatchObject({clan:null,rarity:'Très rare'});
    expect(yvan.lore).toMatchObject({etat:'Mort',praxis:'Flandres & Artois'});
  });
  it('échappe les apostrophes et rend l’import rejouable',()=>{
    const sql=toSql(result,{editionName:'Camarilla',prefix:'CAM',sheetId:'x'});
    expect(sql).toContain(`'Isabeau d''Arc'`);
    expect(sql).toContain('on conflict (source_ref) where source_ref is not null do nothing');
    expect(sql).toContain(`'draft'`);
  });
});
