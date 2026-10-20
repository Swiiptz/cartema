// Habillage de la carte unique (Caïn) : la seule carte claire du jeu.
// Papier d'os brûlé sur lequel l'encre de l'illustration se pose (fond blanc absorbé par
// multiplication), cadre d'obsidienne et d'argent oxydé, fil pourpre du premier sang,
// coulures d'encre dans la diagonale du dessin. Textes et chemins échappés par Card.tsx.

// Marque de Caïn : signe original (trait, croissant renversé et entaille), pas un symbole de clan.
const MARK='<path d="M0-11V10M-6.5-4.5Q0 2.5 6.5-4.5M-4 6.5H4"/><path d="M-2.2-11.5 0-14 2.2-11.5" stroke-width=".9"/>';

// Coups de pinceau qui prolongent les diagonales du dessin depuis le coin inférieur gauche.
const STREAKS='M6 236C30 222 52 214 84 206M4 252C34 236 66 226 108 214M6 270C36 252 74 240 122 226M10 286C44 266 86 252 136 238';

export function renderUniqueCard({id,name,title,illustration,artLayout,artOffsetY},u){
 const fit=artLayout==='portrait'?'xMidYMin slice':'xMidYMid slice';
 const art=illustration?`<g mask="url(#u-art-mask${u})"><image href="${illustration}" x="11" y="${11+artOffsetY}" width="178" height="218" preserveAspectRatio="${fit}" style="mix-blend-mode:multiply"/></g>`:'';
 const nameSize=name.length>14?14:name.length>9?18:22;
 return `<div class="card crafted-card unique-card"><svg viewBox="0 0 200 300" role="img" aria-label="${name}, carte unique">
 <defs>
  <linearGradient id="u-paper${u}" x1="0" y1="0" x2=".35" y2="1"><stop stop-color="#f4ecdd"/><stop offset=".55" stop-color="#ebe0cb"/><stop offset="1" stop-color="#d8c8ab"/></linearGradient>
  <radialGradient id="u-burn${u}" cx=".5" cy=".45" r=".72"><stop offset=".62" stop-color="#2a1a10" stop-opacity="0"/><stop offset=".9" stop-color="#3a2416" stop-opacity=".32"/><stop offset="1" stop-color="#1c0f08" stop-opacity=".7"/></radialGradient>
  <linearGradient id="u-obsidian${u}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b1a1f"/><stop offset=".4" stop-color="#050507"/><stop offset=".62" stop-color="#26242b"/><stop offset="1" stop-color="#030304"/></linearGradient>
  <linearGradient id="u-silver${u}" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#e9e4da"/><stop offset=".3" stop-color="#7c7770"/><stop offset=".5" stop-color="#d6d0c4"/><stop offset=".72" stop-color="#5b5751"/><stop offset="1" stop-color="#cfc8bb"/></linearGradient>
  <linearGradient id="u-art-fade${u}" gradientUnits="userSpaceOnUse" x1="0" y1="11" x2="0" y2="229"><stop stop-color="white"/><stop offset=".78" stop-color="white"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient>
  <mask id="u-art-mask${u}" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="300"><rect width="200" height="300" fill="url(#u-art-fade${u})"/></mask>
  <filter id="u-grain${u}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .22  0 0 0 0 .15  0 0 0 0 .1  0 0 0 .55 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
  <filter id="u-ink${u}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2"/></filter>
  <clipPath id="u-face${u}"><rect x="11" y="11" width="178" height="278" rx="6"/></clipPath>
 </defs>
 <rect width="200" height="300" rx="12" fill="url(#u-obsidian${u})"/>
 <g clip-path="url(#u-face${u})">
  <rect x="11" y="11" width="178" height="278" fill="url(#u-paper${u})"/>
  <rect x="11" y="11" width="178" height="278" fill="#fff" filter="url(#u-grain${u})" opacity=".55"/>
  ${art}
  <g class="unique-streaks" filter="url(#u-ink${u})" fill="none" stroke="#0d0b0c" stroke-linecap="round">
   <path d="${STREAKS}" stroke-width="2.2" opacity=".55"/>
   <path d="M4 244C40 228 70 220 98 211M8 262C46 244 84 234 116 222" stroke-width="5" opacity=".18"/>
  </g>
  <g class="unique-spatter" fill="#0d0b0c" opacity=".7"><circle cx="171" cy="34" r="1.6"/><circle cx="178" cy="44" r=".8"/><circle cx="163" cy="27" r=".6"/><circle cx="24" cy="208" r="1.1"/><circle cx="33" cy="199" r=".5"/></g>
  <rect x="11" y="11" width="178" height="278" fill="url(#u-burn${u})"/>
  <g class="unique-motes" fill="#141012">${[[40,60,.9],[150,90,.7],[62,150,.6],[132,40,.5],[90,118,.45],[168,170,.8]].map(([x,y,r],i)=>`<circle cx="${x}" cy="${y}" r="${r}" style="--m:${i}"/>`).join('')}</g>
 </g>
 <rect x="6.5" y="6.5" width="187" height="287" rx="9.5" fill="none" stroke="url(#u-silver${u})" stroke-width="1.6"/>
 <rect x="10.5" y="10.5" width="179" height="279" rx="7" fill="none" stroke="#0a090b" stroke-width="1.4"/>
 <rect class="unique-thread" x="12.6" y="12.6" width="174.8" height="274.8" rx="5.4" fill="none" stroke="#9b1426" stroke-width=".7" pathLength="100"/>
 <g fill="none" stroke="url(#u-silver${u})" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
  ${['','translate(200 0) scale(-1 1)','translate(0 300) scale(1 -1)','translate(200 300) scale(-1 -1)'].map(t=>`<g transform="${t}"><path d="M7 44 16 16 44 7M16 16 27 27M11 30 19 22M30 11 22 19"/><path d="M16 16 21 9M16 16 9 21" stroke="#9b1426" stroke-width=".8"/></g>`).join('')}
 </g>
 <path d="M14 222H70Q86 222 100 212 114 222 130 222H186" fill="none" stroke="#0d0b0c" stroke-width="1" opacity=".75"/>
 <circle cx="100" cy="212" r="15.5" fill="#070608" stroke="url(#u-silver${u})" stroke-width="1.5"/>
 <circle class="unique-mark-glow" cx="100" cy="212" r="11.5" fill="none" stroke="#9b1426" stroke-width=".6"/>
 <g transform="translate(100 212) scale(.82)" fill="none" stroke="#c4182f" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="unique-mark">${MARK}</g>
 <text x="100" y="${nameSize>18?250:247}" text-anchor="middle" font-family="var(--display)" font-weight="700" font-size="${nameSize}" letter-spacing="${nameSize>18?4:2}" fill="#0d0b0c">${name}</text>
 <path d="M66 ${nameSize>18?256:252}Q100 ${nameSize>18?260:256} 134 ${nameSize>18?255:251}" fill="none" stroke="#9b1426" stroke-width="1.3" stroke-linecap="round" filter="url(#u-ink${u})"/>
 ${title?`<text x="100" y="268" text-anchor="middle" font-family="var(--body)" font-style="italic" font-size="10" fill="#2b2220">${title}</text>`:''}
 <text x="100" y="${title?279:270}" text-anchor="middle" font-family="var(--display)" font-size="5.6" letter-spacing="1.6" fill="#7d1020">UNIQUE · I / I</text>
 <text x="100" y="291.5" text-anchor="middle" font-family="var(--display)" font-size="5.6" letter-spacing=".5" fill="#d9d2c4">${id}</text>
</svg></div>`;
}
