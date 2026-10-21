#!/usr/bin/env node
// Génère les icônes de l'application (PWA, iOS, onglet) à partir d'un seul dessin vectoriel :
// le logo de l'en-tête (deux losanges dorés imbriqués) et le point de sang de « Vampiric Boosters ».
//   npm run icons
// Variante « maskable » : fond plein et motif réduit à la zone que les lanceurs Android ne
// rognent jamais (cercle central de 80 %).
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';

const OUT=join(process.cwd(),'public');

function art({rounded,scale}){
 const t=`translate(256 256) scale(${scale}) translate(-256 -256)`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
 <defs>
  <radialGradient id="night" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#3a1426"/><stop offset=".55" stop-color="#1a0d17"/><stop offset="1" stop-color="#0b070d"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dfa3"/><stop offset=".5" stop-color="#c9a45c"/><stop offset="1" stop-color="#8a6a32"/></linearGradient>
  <radialGradient id="blood" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ff8a9a"/><stop offset=".45" stop-color="#c0142f"/><stop offset="1" stop-color="#4f0410"/></radialGradient>
  <radialGradient id="halo"><stop offset="0" stop-color="#e0203f" stop-opacity=".55"/><stop offset="1" stop-color="#e0203f" stop-opacity="0"/></radialGradient>
 </defs>
 <rect width="512" height="512" ${rounded?'rx="112"':''} fill="url(#night)"/>
 <g transform="${t}">
  <circle cx="256" cy="256" r="150" fill="url(#halo)"/>
  <path d="M256 66 410 256 256 446 102 256Z" fill="none" stroke="url(#gold)" stroke-width="16" stroke-linejoin="round"/>
  <path d="M256 150 342 256 256 362 170 256Z" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linejoin="round" opacity=".85"/>
  <circle cx="256" cy="256" r="38" fill="url(#blood)"/>
  <circle cx="244" cy="243" r="9" fill="#fff" opacity=".35"/>
  <path d="M256 30v22M256 460v22M76 256h-22M436 256h22" stroke="#c9a45c" stroke-width="5" stroke-linecap="round" opacity=".55"/>
 </g>
</svg>`;
}

const svgAny=art({rounded:true,scale:1});
const svgMask=art({rounded:false,scale:.78});
writeFileSync(join(OUT,'icon.svg'),svgAny);
const png=(svg,size,file)=>sharp(Buffer.from(svg),{density:Math.max(72,size/512*72*2)}).resize(size,size).png({compressionLevel:9}).toFile(join(OUT,file));
await Promise.all([
 png(svgAny,192,'icon-192.png'),
 png(svgAny,512,'icon-512.png'),
 png(svgMask,512,'icon-maskable-512.png'),
 png(svgMask,192,'icon-maskable-192.png'),
 // iOS n'applique pas de transparence : fond plein, iOS arrondit lui-même.
 png(svgMask.replace('scale(.78)','scale(.86)'),180,'apple-touch-icon.png'),
 png(svgAny,48,'favicon-48.png'),
]);
console.log('Icônes générées dans public/.');
