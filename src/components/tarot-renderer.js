import {goldFrame,goldDefinitions,goldSurface,goldShine} from './gold-frame';
import {bloodFrame,bloodDefinitions} from './blood-frame';
import {renderUniqueCard} from './unique-frame';
// Original vector frame system. Text and local asset paths are XML-escaped in Card.tsx.
const R={Commun:['#a79c88',0],'Peu commun':['#8aa969',1],Rare:['#74afd2',2],'Très rare':['#56c4c9',3],'Épique':['#b282ce',4],'Légendaire':['#dfb752',5],Mythique:['#d75464',6]};
const SIG={
 'Toréador':'<path d="M0-2C-7-10-12-1-5 3-8 9 3 11 5 4 13 1 7-9 1-5-4-8-7-2-2 1 3 5 7-2 2-3"/><path d="M0 5v6m0-2-5-2m5 1 5-2"/>',
 'Gangrel':'<path d="M-7 8Q-10-2-3-10M0 9Q-3-2 3-11M7 8Q5-2 10-8"/>',
 'Malkavien':'<path d="M-11 0Q0-10 11 0 0 10-11 0Z"/><circle r="3.4"/><path d="M0-10v-3M-8-7l-2-3M8-7l2-3"/>',
 'Ventrue':'<path d="M-9 7V-5l5 6 4-10 4 10 5-6V7Zm0-3H9"/><circle cy="-11" r="1"/>',
 'Tremere':'<path d="M0-10 10 8H-10Z"/><circle cy="2" r="7"/>',
 'Brujah':'<path d="M-2 10C-14 4-3-2-5-9 1-7 3-2 1 2 8-1 5-7 7-8 17 3 6 12-2 10Z"/>',
 'Nosferatu':'<path d="M-12-3-4 0 0-6 4 0 12-3 8 5 3 3 0 9-3 3-8 5Z"/>',
 'Lasombra':'<circle cy="-3" r="6.5"/><path d="M-2.5-9.2A6.5 6.5 0 0 1 3.8 2.2 5.2 5.2 0 0 0-2.5-9.2Z" fill="#e5cea0" fill-opacity=".55"/><path d="M-4.5 2.6Q-6 7-9.5 9M0 3.5Q1 7-1 11M4.5 2.6Q6 7 9.5 9"/>',
 'Assamite':'<path d="M-3-10.5A10 10 0 1 0 8.5 4.5 8 8 0 1 1-3-10.5Z"/><path d="M4-11V5M1.5 2.5H6.5M4 5V8.5"/>',
 'Ravnos':'<circle r="9"/><circle r="2.2"/><path d="M0-9V-2.2M0 2.2V9M-7.8-4.5-1.9-1.1M1.9 1.1 7.8 4.5M7.8-4.5 1.9-1.1M-1.9 1.1-7.8 4.5"/>',
 'Giovanni':'<path d="M-7 1C-7-6-3.5-9.5 0-9.5S7-6 7 1C7 4 5.2 5.2 4 5.2V8.5H-4V5.2C-5.2 5.2-7 4-7 1Z"/><circle cx="-3" cy="0" r="1.9"/><circle cx="3" cy="0" r="1.9"/><path d="M0 2.6 1 4.2H-1ZM-2 8.5V6.5M0 8.5V6.5M2 8.5V6.5"/>',
 'Sethite':'<path d="M-5 10.5C-11 7-7 1.5 0 1.5S10-2.5 6-7.5C3.5-10.5-2-10.5-3.6-7.6"/><path d="M-3.6-7.6-6.8-9M-3.6-7.6-6.2-5.4"/><circle cx="-1.2" cy="-8.6" r=".7" fill="#e5cea0"/>',
 'Baali':'<circle r="10"/><path d="M0 9.4-5.6-7.6 8.9 3H-8.9L5.6-7.6Z"/>',
 'Tzimisce':'<path d="M-10 7C-6-2-1-8 9-10.5 6.5-6.5 7.5-3.5 10-1.5 6-.5 4.8 1.8 5.8 5 2 3.4-.4 4.5-1.3 8.5-3.8 6.6-6.5 6.4-10 7Z"/><path d="M9-10.5-1.3 8.5M7.5-3.5 2.5 1M5.8 5 1 1.8"/>',
 '?':'<path d="M0-10 3-3 10 0 3 3 0 10-3 3-10 0-3-3Z"/><circle r="3"/>'
};
const H=s=>Math.abs([...s].reduce((a,c)=>(a*31+c.charCodeAt(0))|0,7));
const spokes=(cx,cy,r1,r2,n)=>Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n;return`M${cx+r1*Math.cos(a)} ${cy+r1*Math.sin(a)}L${cx+r2*Math.cos(a)} ${cy+r2*Math.sin(a)}`}).join('');
// Acanthus leaves and thorn stems follow the edge, leaving the portrait clear.
const corner=(lv,G)=>`<g fill="none" stroke="${G}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M8 47C11 33 7 15 17 10 25 6 35 12 48 7M11 29C21 27 31 17 28 11M13 19C20 22 24 18 21 14 17 10 14 16 17 18"/><path d="M11 40C14 35 21 37 21 29 15 29 11 33 11 40ZM28 12C34 19 41 16 43 10 36 9 34 13 28 12Z" fill="${G}" fill-opacity=".3"/>${lv>=2?`<path d="M8 55C17 48 22 42 18 37M36 9C40 24 30 28 26 24 22 20 26 17 29 20"/><path d="M18 37l6-2-4 6M39 13l5 7-7-2"/>`:''}${lv>=4?`<path d="M8 67Q17 60 15 51M49 8Q57 14 65 9"/><path d="M14 51l5-5M53 11l3 5"/><circle cx="11" cy="11" r="3" fill="${G}"/><circle cx="11" cy="11" r="1" fill="#141114" stroke="none"/>`:''}${lv>=5?'<path d="M22 8Q27 1 31 8M8 22Q1 27 8 31M46 9l5-4M9 46l-4 5"/>':''}</g>`;
// Six original busts: curved anatomy, fabric folds and a face kept in shadow.
function silhouette(index,u){
 const face=`<path d="M82 91C80 72 89 62 101 63 117 64 123 79 119 96L115 114Q110 125 101 129 89 124 85 113Z" fill="url(#face${u})"/><path d="M86 106Q90 120 100 125M115 78Q119 88 116 97" stroke="#81909d" stroke-opacity=".12" fill="none"/>`;
 const body=`<path d="M17 224C20 183 39 169 73 156L86 143 86 125H115L116 144 129 156C161 168 181 185 185 224Z" fill="url(#robe${u})"/><path d="M43 183Q50 195 51 219M156 182Q149 201 152 220M73 163Q77 190 85 222M127 163Q121 194 116 222" fill="none" stroke="#9aa0ae" stroke-opacity=".12" stroke-width="1.1"/>`;
 const hood=`<path d="M59 165C62 145 59 119 64 94 68 61 79 45 101 43 124 46 138 72 140 103L140 141 150 172 122 159 101 183 78 159Z" fill="url(#robe${u})"/><path d="M78 147C71 119 72 91 81 75Q101 48 122 77C131 100 128 124 122 148L111 160 101 151 89 162Z" fill="#080a10"/><path d="M63 147Q63 86 84 60M137 147Q139 86 116 60M77 152Q68 115 80 81M124 151Q134 115 121 82M78 160 101 183 122 160" fill="none" stroke="#9aa9b7" stroke-opacity=".21" stroke-width="1.2"/>`;
 const hair=`<path d="M68 158C74 132 58 105 72 76 76 50 110 47 124 66 143 88 130 123 140 156L120 164 82 166Z" fill="#0a0c12"/><path d="M74 154Q65 109 76 83 83 61 103 59M127 156Q136 116 128 86M81 69Q95 54 115 66M78 93Q73 112 78 133" fill="none" stroke="#8a94a4" stroke-opacity=".22" stroke-width="1.1"/>`;
 const veil=`<path d="M53 202C66 160 57 115 67 81 73 55 91 46 105 48 133 49 144 83 143 110L153 179 170 219H129L120 148H83L75 218H47Z" fill="url(#robe${u})"/><path d="M75 151Q68 101 80 79 100 57 120 80Q135 107 124 153" fill="#080a10"/><path d="M63 177Q67 142 66 116 63 78 87 57M140 169Q132 135 137 106 140 78 118 58M77 155 69 217M127 157 139 217M86 167 81 217" fill="none" stroke="#929dab" stroke-opacity=".2" stroke-width="1.2"/>`;
 const crown=`<path d="M78 65 73 46 87 54 92 38 102 53 113 37 118 54 131 46 126 67Q102 59 78 65Z" fill="#191b22" stroke="#9f9a89" stroke-opacity=".35" stroke-width="1.1"/><path d="M80 68Q104 61 124 69" fill="none" stroke="#a7a08b" stroke-opacity=".3"/>`;
 const collar=`<path d="M76 152 59 117Q74 120 85 140L101 165 117 140Q131 121 143 117L128 154 108 183 101 188 93 181Z" fill="#12151e" stroke="#7f8c9c" stroke-opacity=".27" stroke-width="1.1"/><path d="M62 123 98 180M139 123 105 180" fill="none" stroke="#99a3af" stroke-opacity=".17"/>`;
 const bust=[body+hood,body+hair+face+collar,body+veil,body+hair+face+crown,body+hair+face+`<path d="M71 162Q63 134 69 104M133 161Q145 131 134 95M81 151Q85 169 101 181 116 168 121 149" fill="none" stroke="#b1a4af" stroke-opacity=".2" stroke-width="1.5"/>`,body+hood+`<path d="M82 161 69 196 94 221M120 162 134 196 108 221" fill="none" stroke="#9098aa" stroke-opacity=".24" stroke-width="1.5"/>`][index%6];
 return `<g class="portrait-silhouette"><ellipse cx="101" cy="124" rx="57" ry="76" fill="#080a10" opacity=".2"/>${bust}<path d="M37 214Q100 197 164 214" fill="none" stroke="#7d8595" stroke-opacity=".08" stroke-width="8"/></g>`;
}
// unique : carte à exemplaire unique (Caïn), habillage propre une fois identifiée ; inconnue, elle garde le voile commun.
export function renderCard(c,k,illustration,artLayout='portrait',provisional=false,artOffsetY=0,silhouetteIndex,unique=false,signature){
 const[id,n,cl,role,ra,kn,fin]=c,[base,lv]=R[ra],u='g'+k+id;
 const color=fin==='gold'?'#d5b870':fin==='blood'?'#98733e':base;
 const light=fin==='gold'?'#fff2c5':fin==='blood'?'#e2c08a':lv===0?'#d7c6a5':lv===1?'#c8d8a3':lv===2?'#c7e7ef':lv===3?'#b5ece4':lv===4?'#e6bcf1':lv===5?'#ffe8aa':'#ffa38b';
 if(unique&&kn)return renderUniqueCard({id,name:n,title:role,illustration,artLayout,artOffsetY},u);
 const metal=`url(#metal${u})`,clip=`c${u}`;
 // Fade follows the image viewport, including crop offsets, for every illustration.
 const artBottom=artLayout==='cover'?Math.min(205,205+artOffsetY):artLayout==='full'?185:214;
 const artTop=artLayout==='cover'?Math.max(11,11+artOffsetY):11;
 const image=(y,height,fit,extra='')=>`<image href="${illustration}" x="11" y="${y}" width="178" height="${height}" preserveAspectRatio="${fit}" ${extra}/>`;
 const fullArt=artLayout==='fullart';
 // Pleine illustration affichée : ni cartouche, ni médaillon, ni barre ; un voile léger en bas et une ombre douce sous les textes.
 const fa=fullArt&&kn&&!!illustration;
 const ink=fa?` filter="url(#text-shadow${u})"`:'';
 const foreground=artLayout==='cover'?image(11+artOffsetY,194,'xMidYMax slice'):artLayout==='full'?image(11,174,'xMidYMid meet'):`<image href="${illustration}" x="4" y="7" width="192" height="310" preserveAspectRatio="xMidYMin meet"/>`;
 const art=kn&&illustration&&fullArt?image(11,278,'xMidYMid slice'):kn&&illustration?`<g mask="url(#art-sides${u})">${artLayout==='cover'?`<g mask="url(#art-ambience${u})">${image(11,194,'xMidYMax slice','opacity=".3" style="filter:blur(5px)"')}</g>`:''}<g mask="url(#art-fade${u})">${foreground}</g></g>`:silhouette(Number.isInteger(silhouetteIndex)?silhouetteIndex:H(id)%6,u);
 const name=kn?n:'Inconnu',clan=kn&&cl!=='?'?cl:'Clan inconnu';
 const title=kn?(role||'Chronique Camarilla'):'Identité voilée';
 const frame='M13 6H187Q194 6 194 13V287Q194 294 187 294H13Q6 294 6 287V13Q6 6 13 6Z';
 // Carte signée : signature (image transparente) en bas à droite de l'illustration, légèrement inclinée, liseré doré.
 const signed=kn&&signature?`<g class="card-signature" transform="rotate(-7 146 ${fa?196:178})"><image href="${signature}" x="102" y="${fa?172:154}" width="88" height="46" preserveAspectRatio="xMidYMid meet" filter="url(#signature-ink${u})"/></g>`:'';
 return `<div class="card crafted-card ${fin} rarity-${lv}${unique?' unique-veiled':''}"><svg viewBox="0 0 200 300" role="img" aria-label="${kn?n+', '+(provisional?'cadre de présentation':ra):'Personnage inconnu, '+ra}">
 <defs>${kn&&signature?`<filter id="signature-ink${u}" x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius=".9" result="edge"/><feFlood flood-color="#f1d99b" flood-opacity=".85"/><feComposite in2="edge" operator="in" result="gold"/><feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="glow"/><feFlood flood-color="#08080b" flood-opacity=".55"/><feComposite in2="glow" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="gold"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`:''}${fa?`<filter id="text-shadow${u}" x="-20%" y="-50%" width="140%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation=".85"/><feOffset dy=".7"/><feComponentTransfer><feFuncA type="linear" slope=".85"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`:''}
 ${fin==='blood'?bloodDefinitions(u):fin==='gold'?goldDefinitions(u,fa):''}
  <linearGradient id="metal${u}" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${light}"/><stop offset=".28" stop-color="${color}"/><stop offset=".48" stop-color="${light}"/><stop offset=".65" stop-color="${color}"/><stop offset="1" stop-color="${light}"/></linearGradient>
  <radialGradient id="glass${u}" cx=".5" cy=".38" r=".75"><stop stop-color="${fin==='blood'?'#75152b':color}" stop-opacity="${fin==='blood'?'.2':'.23'}"/><stop offset=".6" stop-color="#141218"/><stop offset="1" stop-color="#06080a"/></radialGradient>
  <linearGradient id="shade${u}" x1="0" y1="0" x2="0" y2="1">${fa?'<stop offset=".7" stop-color="#08080b" stop-opacity="0"/><stop offset="1" stop-color="#08080b" stop-opacity=".62"/>':'<stop offset=".57" stop-color="#08080b" stop-opacity="0"/><stop offset="1" stop-color="#08080b" stop-opacity=".94"/>'}</linearGradient>
  <linearGradient id="art-vertical${u}" gradientUnits="userSpaceOnUse" x1="0" y1="${artTop}" x2="0" y2="${artBottom}"><stop stop-color="white" stop-opacity="0"/><stop offset=".035" stop-color="white"/><stop offset=".82" stop-color="white"/><stop offset=".9" stop-color="white" stop-opacity=".88"/><stop offset=".96" stop-color="white" stop-opacity=".35"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <linearGradient id="art-horizontal${u}" gradientUnits="userSpaceOnUse" x1="11" y1="0" x2="189" y2="0"><stop stop-color="white" stop-opacity="0"/><stop offset=".045" stop-color="white"/><stop offset=".955" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <linearGradient id="art-background${u}" gradientUnits="userSpaceOnUse" x1="0" y1="11" x2="0" y2="205"><stop stop-color="white" stop-opacity="0"/><stop offset=".05" stop-color="white"/><stop offset=".76" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <mask id="art-fade${u}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="300"><rect width="200" height="300" fill="url(#art-vertical${u})"/></mask>
  <mask id="art-sides${u}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="300"><rect width="200" height="300" fill="url(#art-horizontal${u})"/></mask>
  <mask id="art-ambience${u}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="300"><rect width="200" height="300" fill="url(#art-background${u})"/></mask>
  <linearGradient id="panel${u}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#181519"/><stop offset=".55" stop-color="#08090c"/><stop offset="1" stop-color="${color}" stop-opacity=".1"/></linearGradient>
  <pattern id="grain${u}" width="9" height="11" patternUnits="userSpaceOnUse"><path d="M1 2h1M6 7h1M2 10h.5" stroke="#e0d0b4" stroke-opacity=".1" stroke-width=".45"/></pattern>
  <linearGradient id="robe${u}" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#232833"/><stop offset=".3" stop-color="#131721"/><stop offset=".6" stop-color="#080b12"/><stop offset="1" stop-color="#252835"/></linearGradient>
  <radialGradient id="face${u}" cx=".25" cy=".3" r=".9"><stop stop-color="#252a34"/><stop offset=".5" stop-color="#11151e"/><stop offset="1" stop-color="#070a10"/></radialGradient>
  <clipPath id="${clip}"><rect x="11" y="11" width="178" height="278" rx="7"/></clipPath>
 </defs>
 <rect width="200" height="300" rx="12" fill="#08090c"/>
 <g clip-path="url(#${clip})"><rect x="10" y="10" width="180" height="280" fill="url(#glass${u})"/>
 <g stroke="${color}" fill="none" opacity="${kn?'.13':'.19'}" stroke-width=".7"><circle cx="100" cy="111" r="72"/><circle cx="100" cy="111" r="59"/><path d="${spokes(100,111,22,72,12)}"/><path d="M100 39 151 162 34 91H166L49 162Z"/></g>
 ${lv>=5?`<g stroke="${metal}" fill="none" opacity=".48"><circle cx="100" cy="102" r="55" stroke-width="1.1"/><path d="${spokes(100,102,58,69,lv===6?24:16)}" stroke-width="1.35"/></g>`:''}
 ${art}<rect x="10" y="10" width="180" height="${fa?280:212}" fill="url(#shade${u})" opacity="${fa?'1':artLayout==='full'||artLayout==='cover'?'.15':'1'}"/>
 ${fin==='gold'?goldSurface(u):''}
 ${fin==='blood'?`<g class="blood-patina" fill="#430c18" opacity=".7"><path d="M11 12 28 13 22 20 26 31 18 44 21 59 16 68 18 84 11 103Z"/><path d="M189 17 180 25 184 40 177 47 180 67 174 84 180 96 177 118 185 132 189 153Z"/><path d="M11 154 17 162 14 177 23 185 18 198 25 209H11ZM189 168 181 181 185 193 173 205 189 213Z"/></g><g class="blood-etching" fill="none" stroke="#86303b" stroke-width=".7" stroke-linecap="round" opacity=".65"><path d="M20 17 18 32 21 43 17 57 19 75M181 22 178 41 182 56 175 73 177 91 173 109M15 174 19 182 17 191M185 182 179 195 181 207"/><path d="M23 25 28 29M177 67 169 72M19 184 26 188" stroke-width=".4"/></g><g class="blood-residue" fill="#7b1c2e" opacity=".5"><circle cx="26" cy="38" r=".8"/><circle cx="23" cy="48" r=".45"/><circle cx="171" cy="82" r=".9"/><circle cx="175" cy="96" r=".4"/><circle cx="23" cy="176" r=".6"/><circle cx="178" cy="188" r=".8"/></g><g class="blood-incense" fill="none" stroke="#78303f" stroke-width="7" opacity=".1"><path d="M12 214C38 182 12 160 29 132S12 77 20 50M188 218C163 185 191 162 175 129S190 81 179 54"/></g>`:''}
 ${signed}
 <rect x="10" y="10" width="180" height="280" fill="url(#grain${u})"/>
 </g>
 <path d="${frame}" fill="none" stroke="${color}" stroke-opacity="${fin==='blood'?'.08':'.2'}" stroke-width="7"/>
 <path d="${frame}" fill="none" stroke="${metal}" stroke-width="2.6"/>
 ${fin?`<path class="finish-edge ${fin}-edge" d="${frame}" fill="none" stroke="${fin==='gold'?'#fff0b0':'#b36b66'}" stroke-width="2.3" pathLength="100" stroke-dasharray="12 88"/>`:''}
 <rect x="10" y="10" width="180" height="280" rx="7" fill="none" stroke="${color}" stroke-width=".75" opacity=".6"/>
 <path d="M14 56V34Q14 14 34 14H56M144 14H166Q186 14 186 34V56" fill="none" stroke="${metal}" stroke-width="1.15"/>
 ${fa?'':`<path d="M13 224Q12 210 25 207H72Q86 207 100 197 114 207 128 207H175Q188 210 187 224V277Q186 287 176 287H24Q14 287 13 277Z" fill="url(#panel${u})" fill-opacity="1" stroke="${metal}" stroke-width="1.4"/>
 <path d="M15 223Q24 212 42 215H77M123 215H158Q176 212 185 223M18 274Q30 280 46 281H75M125 281H154Q170 280 182 274" fill="none" stroke="${color}" stroke-width="1" opacity=".7"/>`}
 ${fin==='blood'?bloodFrame(u):fin==='gold'?goldFrame(u):['','translate(200 0) scale(-1 1)','translate(0 300) scale(1 -1)','translate(200 300) scale(-1 -1)'].map(t=>`<g transform="${t}">${corner(lv,metal)}</g>`).join('')}

 ${fin==='gold'?goldShine(u):''}
 ${fa?'':`<path d="M26 207Q46 198 66 207M134 207Q154 198 174 207" fill="none" stroke="${metal}" stroke-width="1.6"/>
 <circle cx="100" cy="205" r="17" fill="#080a0d" stroke="${metal}" stroke-width="1.7"/>
 <circle cx="100" cy="205" r="13.5" fill="none" stroke="${color}" stroke-width=".65" opacity=".65"/>
 <g transform="translate(100 205) scale(.88)" fill="none" stroke="#e5cea0" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${SIG[kn?cl:'?']||SIG['?']}</g>`}
 <text x="100" y="235" text-anchor="middle" font-family="var(--display)" font-weight="600" font-size="${name.length>16?10.3:name.length>12?11.7:14}"${name.length>22?' textLength="150" lengthAdjust="spacingAndGlyphs"':''}${ink} fill="#f3e5c9">${name}</text>
 <text x="100" y="248" text-anchor="middle" font-family="var(--display)" font-size="8.4" letter-spacing="1.2"${ink} fill="${light}">${clan.toUpperCase()}</text>
 <path d="M36 259H52M148 259H164" stroke="${metal}" stroke-width=".65" opacity=".5"/>
 <text x="100" y="273" text-anchor="middle" font-family="var(--body)" font-size="${title.length>24?9.5:11}"${ink} fill="#e3d0b2">${title}</text>
 <text x="100" y="291" text-anchor="middle" font-family="var(--display)" font-size="5.6" letter-spacing=".5"${ink} fill="#ded1b9">${id}</text>
 <text x="100" y="258" text-anchor="middle" font-family="var(--display)" font-size="5.2" letter-spacing=".6"${ink} fill="${light}" opacity=".8">${provisional?'APERÇU':unique?'UNIQUE':ra.toUpperCase()}${fin?' · '+(fin==='gold'?'DORÉE':'SANGLANTE'):''}</text>
 </svg></div>`;
}
export const renderBack=(t,k)=>`<div class="card"><svg viewBox="0 0 200 300"><defs><pattern id="bd${k}" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M9 1l6 8-6 8-6-8z" fill="none" stroke="#c9a45c" stroke-opacity=".09" stroke-width="1"/></pattern><radialGradient id="bg2${k}" cx=".5" cy=".5" r=".75"><stop stop-color="#561430"/><stop offset="1" stop-color="#12060d"/></radialGradient></defs><rect width="200" height="300" fill="url(#bg2${k})"/><rect width="200" height="300" fill="url(#bd${k})"/><rect x="3" y="3" width="194" height="294" rx="10" fill="none" stroke="#c9a45c" stroke-width="3"/><rect x="9" y="9" width="182" height="282" rx="6" fill="none" stroke="#c9a45c" stroke-width="1.4"/><g>${corner(4,'#c9a45c')}</g><g transform="translate(200 0) scale(-1 1)">${corner(4,'#c9a45c')}</g><g transform="translate(0 300) scale(1 -1)">${corner(4,'#c9a45c')}</g><g transform="translate(200 300) scale(-1 -1)">${corner(4,'#c9a45c')}</g><g fill="none" stroke="#c9a45c" stroke-width="2" opacity=".65"><circle cx="100" cy="150" r="48"/><path d="${spokes(100,150,52,58,8)}"/></g><path d="M100 92l32 58-32 58-32-58z" fill="#7b1d36" stroke="#f0d79a" stroke-width="2"/><path d="M100 110l20 40-20 40-20-40z" fill="none" stroke="#f0d79a" stroke-width="1.5"/><circle cx="100" cy="150" r="9" fill="#12060d" stroke="#f0d79a"/>${t?`<rect x="30" y="246" width="140" height="24" fill="#12060d" stroke="#c9a45c"/><text x="100" y="263" text-anchor="middle" font-family="var(--display)" font-weight="700" font-size="16" letter-spacing="5" fill="#f0d79a">${t}</text>`:''}</svg></div>`;

