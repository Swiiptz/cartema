import {describe,it,expect} from 'vitest';
import {renderCard,renderBack} from '../src/components/tarot-renderer';

describe('habillage tarot',()=>{
 it('intègre le portrait fourni dans sa fenêtre de portrait sans modifier son fichier',()=>{
  const html=renderCard(['TEST-001','Alhoon','?','Illustration originale','Rare',1,''],'unique-a','/illustrations/alhoon.png');
  expect(html).toContain('<image href="/illustrations/alhoon.png"');
  expect(html).toContain('clip-path="url(#cgunique-aTEST-001)"');
  expect(html).toContain('Alhoon');
 });
 it('garde une carte inconnue anonyme même si ses données sont renseignées',()=>{
  const html=renderCard(['TEST-002','Nom secret','?','Titre secret','Mythique',0,''],'unique-b','/illustrations/alhoon.png');
  expect(html).not.toContain('Nom secret');expect(html).not.toContain('Titre secret');expect(html).not.toContain('<image');
  expect(html).toContain('TEST-002');expect(html).toContain('MYTHIQUE');
 });
 it('isole les références SVG de deux dos de carte simultanés',()=>{
  const a=renderBack('CARTEMA','first');const b=renderBack('CARTEMA','second');
  expect(a).toContain('url(#bdfirst)');expect(b).toContain('url(#bdsecond)');expect(b).not.toContain('id="bdfirst"');
 });
 it('garde les effets dorés au-dessus du portrait, avec le visage et le texte dégagés',()=>{
  const html=renderCard(['TEST-003','Portrait','?','Titre','Rare',1,'gold'],'opaque-check','/illustrations/opaque.png');
  expect(html.indexOf('<image')).toBeLessThan(html.indexOf('class="gold-surface"'));
  expect(html).toContain('mask="url(#gold-margingopaque-checkTEST-003)"');
  expect(html).toContain('class="gilded-ornament"');
  expect(html).not.toContain('gold-aureole');
 });
 it('conserve une illustration verticale entière et signale le cadre provisoire',()=>{
  const html=renderCard(['APERÇU-RUS','Rus','?','Illustration originale','Rare',1,''],'full-check','/illustrations/rus.webp','full',true);
  expect(html).toContain('width="178" height="174" preserveAspectRatio="xMidYMid meet"');
  expect(html).toContain('Rus, cadre de présentation');
  expect(html).not.toContain('Rus, Rare');
 });
 it('remplit la fenêtre de Rus et décale le cadrage sans tourner son illustration',()=>{
  const html=renderCard(['APERÇU-RUS','Rus','?','Illustration originale','Rare',1,''],'cover-check','/illustrations/rus.webp','cover',true,-18);
  expect(html).toContain('x="11" y="-7" width="178" height="194" preserveAspectRatio="xMidYMax slice"');
  expect(html).not.toContain('rotate(180');
 });
});

describe('carte unique',()=>{
 it('a son propre habillage clair une fois identifiée, et absorbe le fond blanc de l’illustration',()=>{
  const html=renderCard(['CAM-001','Caïn','?','','Mythique',1,''],'u1','/illustrations/originals/cain.png','cover',false,0,undefined,true);
  expect(html).toContain('unique-card');expect(html).toContain('UNIQUE · I / I');
  expect(html).toContain('style="mix-blend-mode:multiply"><image');
  expect(html).not.toContain('MYTHIQUE');
 });
 it('reste voilée tant qu’elle n’est pas découverte',()=>{
  const html=renderCard(['CAM-001','Caïn','?','','Mythique',0,''],'u2',undefined,'portrait',false,0,1,true);
  expect(html).not.toContain('Caïn');expect(html).not.toContain('unique-card');expect(html).toContain('UNIQUE');
 });
 it('comprime un nom très long au lieu de déborder',()=>{
  expect(renderCard(['CAM-037','Gabrielle Monique de Saint-Etienne','Toréador','Ancilla','Rare',1,''],'l1')).toContain('textLength="150"');
 });
});


describe('pleine illustration',()=>{
 const card=['CAM-042','Isabeau de Marnay','Tremere','Ancienne','Légendaire',1,''];
 it.each(['','gold','blood'])('dégage le dessin et conserve les textes en finition %s',finish=>{
  const html=renderCard([...card.slice(0,6),finish],'fullart-check','/illustrations/existante.webp','fullart');
  expect(html).toContain('width="178" height="278" preserveAspectRatio="xMidYMid slice"');
  expect(html).not.toContain('M13 224Q12 210');
  expect(html).not.toContain('M26 207Q46 198');
  expect(html).not.toContain('translate(100 205)');
  expect(html).not.toContain('cx="100" cy="205"');
  expect(html).toContain('filter="url(#text-shadow');
  expect(html).not.toContain('paint-order="stroke"');
  expect(html).toContain('Isabeau de Marnay');
  expect(html).toContain('TREMERE');
 });
 it.each(['portrait','full','cover'])('conserve le cartouche et le symbole en cadrage %s',layout=>{
  const html=renderCard(card,'classic-check','/illustrations/existante.webp',layout);
  expect(html).toContain('M13 224Q12 210');
  expect(html).toContain('translate(100 205)');
  expect(html).not.toContain('paint-order="stroke"');
 });
 it('conserve le voile pour une carte inconnue ou sans illustration',()=>{
  for(const [known,image] of [[0,'/illustrations/secrete.webp'],[1,undefined]] as const){
   const html=renderCard([...card.slice(0,5),known,''],'veiled-check',image,'fullart');
   expect(html).not.toContain('<image');
   expect(html).toContain('translate(100 205)');
   if(!known)expect(html).not.toContain('Isabeau de Marnay');
  }
 });
});

describe('carte signée',()=>{
 const card=['CAM-042','Isabeau de Marnay','Tremere','Ancienne','Légendaire',1,''];
 it.each(['portrait','fullart'])('pose la signature sur l’illustration (cadrage %s), avec son liseré',layout=>{
  const html=renderCard(card,'signed-check','/illustrations/existante.webp',layout,false,0,undefined,false,'/illustrations/CAM/signatures/sig.webp');
  expect(html).toContain('class="card-signature"');
  expect(html).toContain('href="/illustrations/CAM/signatures/sig.webp"');
  expect(html).toContain('filter="url(#signature-ink');
 });
 it('ne signe jamais une carte inconnue ni une carte sans signature',()=>{
  expect(renderCard([...card.slice(0,5),0,''],'veiled-sign',undefined,'portrait',false,0,undefined,false,'/illustrations/CAM/signatures/sig.webp')).not.toContain('card-signature');
  expect(renderCard(card,'plain','/illustrations/existante.webp')).not.toContain('card-signature');
 });
});
