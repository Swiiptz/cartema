// Habillage des cartes éternelles (édition ETER), toujours en pleine illustration : cadre d'argent riveté aux
// reflets teintés par la rareté et orfèvrerie baroque — grandes volutes et feuilles dans les coins, sarment de
// filigrane qui descend chaque côté (vrilles et feuilles), ailes de volutes autour du cimier en ouroboros et de la
// gemme du bas, fleurons sur la bordure intérieure. Un éclat de lumière parcourt l'orfèvrerie ; un reflet balaie
// la carte. Animations coupées si l'appareil réduit les animations. Dessin original.

const mix=(hex,other,f)=>{const a=parseInt(hex.slice(1),16),b=parseInt(other.slice(1),16);const c=[16,8,0].map(s=>Math.round(((a>>s)&255)*(1-f)+((b>>s)&255)*f));return `#${c.map(v=>v.toString(16).padStart(2,'0')).join('')}`;};
const r1=v=>Math.round(v*10)/10;

// Vrille en spirale qui part de (x, y) ; dir = 1 vers la droite, -1 vers la gauche ; s = taille.
const curl=(x,y,s,dir=1,up=1)=>{const d=dir,u=up;return `M${x} ${y}c${r1(2*s*d)} ${r1(-3*s*u)} ${r1(6.2*s*d)} ${r1(-2.4*s*u)} ${r1(6*s*d)} ${r1(.8*s*u)}c${r1(-.2*s*d)} ${r1(2.6*s*u)} ${r1(-3.6*s*d)} ${r1(2.9*s*u)} ${r1(-3.8*s*d)} ${r1(.7*s*u)}c${r1(-.1*s*d)} ${r1(-1.5*s*u)} ${r1(1.8*s*d)} ${r1(-1.7*s*u)} ${r1(2*s*d)} ${r1(-.3*s*u)}`;};
// Feuille en amande posée en (x, y), orientée de a degrés, longue de l.
const leaf=(x,y,a,l)=>{const r=a*Math.PI/180,c=Math.cos(r),s=Math.sin(r),P=(px,py)=>`${r1(x+px*c-py*s)} ${r1(y+px*s+py*c)}`;
 return `M${P(0,0)}Q${P(l*.5,-l*.34)} ${P(l,0)}Q${P(l*.5,l*.34)} ${P(0,0)}Z`;};

// Sarment du côté gauche : tige qui ondule de y 44 à y 270, une vrille et une feuille à chaque ventre.
function vine(){
 let stem='M15 40',curls='',leaves='';
 for(let k=0;k<11;k++){const y=40+k*21,x=k%2?19.5:12.5,ny=y+21;
  stem+=`C${x} ${y+7} ${x} ${ny-7} 15 ${ny}`;
  if(k%2){curls+=curl(19.5,y+10.5,1.25,1,k%4===1?1:-1);leaves+=leaf(19.5,y+10.5,k%4===1?-40:40,6);}
  else{leaves+=leaf(12.5,y+10.5,k%4===0?200:160,4.5);}
 }
 return {lines:stem+curls,leaves};
}
const VINE=vine();

// Ailes de volutes autour du cimier (haut) et de la gemme (bas), moitié gauche ; la droite est un miroir.
const CREST_WING=`M89 10C83 3 72 5 70 11C68.5 16 74 19 77 15.5C79 13 76.5 10.5 74.5 12.5M70 11C64 9 58 11 52 10`+curl(60,10.5,.9,-1,-1);
const GEM_WING=`M95 292C88 285 76 287 76 293.5C76 298 81.5 299 83.5 295.5M76 293.5C70 295 62 293 54 294`+curl(62,293.5,.9,-1,1);

// tint : couleur de la rareté, posée dans les reflets de l'argent et les gemmes.
export function eternalDefinitions(u,tint){
 const deep=mix(tint,'#1b1d24',.3),pale=mix(tint,'#ffffff',.5);
 return `<linearGradient id="eter-silver${u}" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#ffffff"/><stop offset=".16" stop-color="#a3a9b1"/><stop offset=".3" stop-color="${tint}"/><stop offset=".42" stop-color="#f4f6f8"/><stop offset=".58" stop-color="#80878f"/><stop offset=".72" stop-color="${tint}"/><stop offset=".84" stop-color="#eceff2"/><stop offset="1" stop-color="#b9bfc6"/></linearGradient>
 <radialGradient id="eter-gem${u}" cx=".35" cy=".3" r=".8"><stop stop-color="#ffffff"/><stop offset=".3" stop-color="${pale}"/><stop offset=".7" stop-color="${tint}"/><stop offset="1" stop-color="${deep}"/></radialGradient>
 <radialGradient id="eter-mote${u}"><stop stop-color="#ffffff"/><stop offset=".45" stop-color="#eef2f6" stop-opacity=".7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
 <radialGradient id="eter-mote-tint${u}"><stop stop-color="#ffffff"/><stop offset=".4" stop-color="${pale}" stop-opacity=".8"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>
 <radialGradient id="eter-fade${u}"><stop stop-color="#07080b" stop-opacity=".78"/><stop offset=".6" stop-color="#07080b" stop-opacity=".45"/><stop offset="1" stop-color="#07080b" stop-opacity="0"/></radialGradient>
 <linearGradient id="eter-sweep${u}" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ffffff" stop-opacity="0"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".16"/><stop offset=".55" stop-color="${tint}" stop-opacity=".14"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`;
}

// Particules : [x, y de départ, rayon, teintée]. Elles montent lentement en dérivant et s'éteignent.
const MOTES=[[22,282,1.4,0],[38,250,.9,1],[54,290,1.1,0],[70,232,.7,0],[86,276,1.3,1],[104,240,.8,0],[118,286,1,0],[134,226,1.2,1],[150,272,.8,0],[166,244,1.1,0],[180,288,1.3,1],
 [30,170,.7,0],[62,140,1,1],[96,190,.6,0],[128,150,.9,0],[160,120,.7,1],[46,96,.8,0],[142,70,.6,0],[172,196,.9,0],[16,128,.8,1]];

// Voile sombre et doux derrière les textes, reflet qui balaie la carte et particules (dans la découpe de la carte).
export const eternalSurface=u=>`<ellipse cx="100" cy="262" rx="78" ry="44" fill="url(#eter-fade${u})"/><g class="eter-sweep"><rect x="-90" y="-20" width="70" height="340" fill="url(#eter-sweep${u})" transform="skewX(-18)"/></g><g class="eter-motes">${MOTES.map(([x,y,r,t],i)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="url(#eter-mote${t?'-tint':''}${u})" style="--m:${i}"/>`).join('')}</g>`;

const gem=(u,x,y,r)=>`<g class="eter-gem"><path d="M${x} ${y-r*1.3}L${x+r} ${y}L${x} ${y+r*1.3}L${x-r} ${y}Z" fill="url(#eter-gem${u})" stroke="#1b1d24" stroke-width=".5"/><path d="M${x-r*.35} ${y-r*.5}L${x} ${y-r*1.05}" stroke="#ffffff" stroke-width=".6" stroke-linecap="round"/></g>`;

// Orfèvrerie gravée : trait sombre dessous (profondeur), argent dessus, et l'éclat qui court (classe eter-glint).
const engraved=(u,d,w=.9)=>`<path d="${d}" fill="none" stroke="#15171c" stroke-width="${w+1}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="url(#eter-silver${u})" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><path class="eter-glint" d="${d}" fill="none" stroke="#ffffff" stroke-width="${w*.8}" stroke-linecap="round" pathLength="100" stroke-dasharray="5 95"/>`;
const MIRROR='translate(200 0) scale(-1 1)';

// Cadre riveté, sarments, ailes du cimier et de la gemme, fleurons ; à poser avant les textes.
export function eternalFrame(u,frame){
 const rivets=[];for(let y=40;y<=260;y+=22)rivets.push(`<circle cx="6.6" cy="${y}" r="1.1"/><circle cx="193.4" cy="${y}" r="1.1"/>`);
 const fleurons=[];for(const x of [34,52,148,166])for(const y of [10,290])fleurons.push(`<path d="M${x} ${y-2.2}L${x+1.6} ${y}L${x} ${y+2.2}L${x-1.6} ${y}Z"/>`);
 const pearls=[[58,10.5],[64,10.5],[142,10.5],[136,10.5],[58,293.8],[142,293.8]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".9"/>`).join('');
 const side=`${engraved(u,VINE.lines)}<path d="${VINE.leaves}" fill="url(#eter-silver${u})" stroke="#15171c" stroke-width=".35"/>`;
 const wings=`${engraved(u,CREST_WING,1)}${engraved(u,GEM_WING,1)}<path d="${leaf(70,11,200,6)}${leaf(76,293.5,160,6)}" fill="url(#eter-silver${u})" stroke="#15171c" stroke-width=".35"/>`;
 return `<path class="eter-halo" d="${frame}" fill="none" stroke="#f4f6f8" stroke-width="9" opacity=".14"/>
 <path d="${frame}" fill="none" stroke="#15171c" stroke-width="5"/>
 <path d="${frame}" fill="none" stroke="url(#eter-silver${u})" stroke-width="3.4"/>
 <path d="${frame}" fill="none" stroke="#ffffff" stroke-width=".5" opacity=".7" transform="translate(.6 .6)"/>
 <rect x="10" y="10" width="180" height="280" rx="7" fill="none" stroke="url(#eter-silver${u})" stroke-width="1"/>
 <g fill="url(#eter-silver${u})" stroke="#15171c" stroke-width=".3">${rivets.join('')}${fleurons.join('')}${pearls}</g>
 <g class="eter-filigree">${side}<g transform="${MIRROR}">${side}</g>${wings}<g transform="${MIRROR}">${wings}</g></g>
 <g class="eter-crest" transform="translate(100 9)"><circle r="9.5" fill="#0c0d11" stroke="url(#eter-silver${u})" stroke-width="1.6"/><path d="M-6.2 2.6A6.6 6.6 0 1 1 3.8 5.4" fill="none" stroke="#e9edf1" stroke-width="1.5" stroke-linecap="round"/><path d="M3.8 5.4 6.6 3.4 5.3 6.9Z" fill="#e9edf1"/><circle cx="-4.6" cy="4.6" r=".8" fill="#e9edf1"/>${gem(u,0,0,2.6)}</g>
 ${gem(u,100,293,3.4)}`;
}

// Coins d'argent : arc gravé, grandes volutes qui partent le long des deux bords, feuilles, perles et gemme ;
// en miroir sur les quatre coins.
export const eternalCorner=metal=>{
 const d=`M8 54Q8 8 54 8M15 42Q15 15 42 15M24 13C33 6 46 9 45 17.5C44 23.5 36 23 37 18C37.6 15.5 40.5 15.5 41 17.5M13 24C6 33 9 46 17.5 45C23.5 44 23 36 18 37C15.5 37.6 15.5 40.5 17.5 41`;
 return `<path d="${d}" fill="none" stroke="#15171c" stroke-width="2.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${metal}" stroke-width="1.3" stroke-linecap="round"/>
 <path class="eter-glint" d="${d}" fill="none" stroke="#ffffff" stroke-width=".9" stroke-linecap="round" pathLength="100" stroke-dasharray="5 95"/>
 <path d="${leaf(46,12.5,-14,8)}${leaf(12.5,46,104,8)}${leaf(30,25,-45,5)}" fill="${metal}" stroke="#15171c" stroke-width=".35"/>
 <path d="M20 36a9 9 0 0 1 16-16" fill="none" stroke="#ffffff" stroke-width=".6" opacity=".7"/>
 <g fill="${metal}" stroke="#15171c" stroke-width=".3"><circle cx="31" cy="9.5" r=".9"/><circle cx="9.5" cy="31" r=".9"/><circle cx="22" cy="10.8" r=".8"/><circle cx="10.8" cy="22" r=".8"/></g>
 <path d="M19 19l4-6 4 6-4 6Z" fill="${metal}" stroke="#15171c" stroke-width=".5"/>`;
};
