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
