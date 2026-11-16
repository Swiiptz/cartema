// Finition « Neige » (prototype du 16/11/2026) : métal glacé, givre sur les bords, cristaux aux coins,
// petites stalactites sous le bord haut et flocons qui tombent doucement sur l'illustration.

// Flocon à six branches, centré sur 0,0, rayon 1.
const FLAKE='M0-1V1M-.866-.5.866.5M-.866.5.866-.5M0-.62-.18-.8M0-.62.18-.8M0 .62-.18.8M0 .62.18.8M-.54-.31-.7-.22M-.54-.31-.52-.5M.54.31.7.22M.54.31.52.5M.54-.31.7-.22M.54-.31.52-.5M-.54.31-.7.22M-.54.31-.52.5';

export function snowDefinitions(u){
 return `<linearGradient id="snow-metal${u}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#ffffff"/><stop offset=".22" stop-color="#a9cbe6"/><stop offset=".45" stop-color="#f4fbff"/><stop offset=".68" stop-color="#7fa8cc"/><stop offset="1" stop-color="#e8f4ff"/></linearGradient>
 <radialGradient id="snow-frost${u}" cx=".5" cy=".42" r=".75"><stop offset=".55" stop-color="#dff0ff" stop-opacity="0"/><stop offset=".86" stop-color="#dff0ff" stop-opacity=".28"/><stop offset="1" stop-color="#ffffff" stop-opacity=".62"/></radialGradient>
 <filter id="snow-glow${u}" x="-50%" y="-50%" width="200%" height="200%"><feMorphology in="SourceAlpha" operator="dilate" radius=".5" result="o"/><feFlood flood-color="#4f86b8" flood-opacity=".75"/><feComposite in2="o" operator="in" result="edge"/><feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="g"/><feFlood flood-color="#cfe8ff" flood-opacity=".9"/><feComposite in2="g" operator="in" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <radialGradient id="snow-gem${u}" cx=".38" cy=".32" r=".75"><stop stop-color="#ffffff"/><stop offset=".35" stop-color="#bfe2ff"/><stop offset=".75" stop-color="#4c8fcf"/><stop offset="1" stop-color="#1d4d80"/></radialGradient>
 <path id="snow-flake${u}" d="${FLAKE}" fill="none" stroke="#ffffff" stroke-width=".17" stroke-linecap="round"/>`;
}

// Givre et flocons, posés sur l'illustration (sous le cadre).
export function snowSurface(u){
 const flakes=[[28,40,4.2,.75,0],[160,32,3.2,.6,1.8],[52,96,2.6,.55,3.1],[148,88,4.8,.7,.6],[96,22,2.2,.5,2.4],[34,150,3.4,.6,4.2],[170,140,2.4,.5,1.2],[118,124,2,.45,3.6],[70,180,2.8,.5,2.9],[138,186,3.6,.6,.3]];
 return `<rect x="10" y="10" width="180" height="280" fill="url(#snow-frost${u})"/>
 <g class="snow-flakes" filter="url(#snow-glow${u})">${flakes.map(([x,y,r,o,d])=>`<g class="snow-flake" style="animation-delay:-${d}s" opacity="${o}"><use href="#snow-flake${u}" transform="translate(${x} ${y}) scale(${r})"/></g>`).join('')}</g>
 <g fill="#ffffff" opacity=".75">${[[44,62],[132,58],[84,140],[156,110],[22,118],[110,170]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".7"/>`).join('')}</g>`;
}

// Volute de glace (spirale) pour l'ornement du haut.
const CURL='M0 0C-4-1-7 1-7 4-7 7-4 8-2 6-.5 4.5-1.5 2.5-3.2 3';
// Rinceau de givre le long d'un côté (même tracé que la Dorée, en glace).
const SCROLL='M12 68C29 52 8 40 21 24 30 13 44 22 55 11M13 88C32 107 6 117 16 135 29 154 6 163 15 183M12 219C32 205 9 190 23 179M13 264C32 247 10 235 24 223M13 277C28 293 49 276 66 291';

// Cadre : rinceaux de givre, éclats de cristal, cabochons de glace, cimier cristallin, stalactites.
export function snowFrame(u){
 const ice=`url(#snow-metal${u})`,gem=`url(#snow-gem${u})`;
 // Éclats de cristal en paire, comme les feuilles de la Dorée.
 const shards=[37,82,127,172,239].map(y=>`<g transform="translate(0 ${y})"><path d="M14 0 25-9 29-15 21-8ZM14 0 9-12 9-19 12-10Z" fill="${ice}" stroke="#2c5680" stroke-width=".45"/><path d="M15-1 24-10M13-2 10-14" stroke="#ffffff" stroke-width=".35" opacity=".8"/></g>`).join('');
 const half=`<path d="${SCROLL}" fill="none" stroke="#132a44" stroke-width="4.8"/><path d="${SCROLL}" fill="none" stroke="${ice}" stroke-width="2.8"/>
 <path d="M14 64C26 52 10 39 23 25M16 135C27 153 9 163 16 178M15 276Q34 290 54 285" fill="none" stroke="#ffffff" stroke-width=".6" opacity=".55"/>
 ${shards}<g fill="none" stroke="${ice}" stroke-width=".85"><path d="M18 26C30 31 43 26 38 18 34 12 28 19 31 22M14 79C24 74 29 84 23 90 19 94 15 88 19 86M16 141C28 140 29 153 22 155 17 157 17 151 21 151M16 269C31 261 40 274 34 280 29 285 24 280 28 277"/></g>
 <path d="M16 66 23 76 16 86 9 76Z" fill="#0f2238" stroke="${ice}" stroke-width="1"/><path d="M16 70 20 76 16 82 12 76Z" fill="${gem}"/>
 <use href="#snow-flake${u}" transform="translate(16 155) scale(5)" stroke="${ice}"/>
 <path d="M17 226Q30 221 29 237 29 245 22 245 16 243 20 238M22 279Q35 284 40 275" fill="none" stroke="${ice}" stroke-width="1.3"/>
 <path class="snow-glint" d="${SCROLL}" fill="none" stroke="#ffffff" stroke-width=".85" stroke-linecap="round" opacity=".35"/>`;
 const crown=`<g transform="translate(100 13)" filter="url(#snow-glow${u})"><use href="#snow-flake${u}" transform="scale(6.5)"/><path d="M0-8 2.2-3 0 2-2.2-3Z" fill="${gem}" stroke="#ffffff" stroke-width=".4"/>
  <g fill="none" stroke="#f4fbff" stroke-width=".7" stroke-linecap="round"><path transform="translate(-9 2)" d="${CURL}"/><path transform="translate(9 2) scale(-1 1)" d="${CURL}"/></g></g>`;
 const swags=`<g stroke="${ice}" fill="none" stroke-width="1"><path d="M24 11Q48 23 77 11M176 11Q152 23 123 11M48 11Q56 27 69 21 74 17 68 14 63 12 63 17M152 11Q144 27 131 21 126 17 132 14 137 12 137 17"/>
  <path d="M29 208Q43 194 64 201M171 208Q157 194 136 201M40 206Q50 196 65 204M160 206Q150 196 135 204M45 285Q59 273 77 287M155 285Q141 273 123 287"/></g>
  <g fill="${gem}" stroke="${ice}" stroke-width=".6"><path d="M25 263 30 270 25 277 20 270Z"/><path d="M175 263 180 270 175 277 170 270Z"/></g>`;
 const icicles=[30,40,52,86,114,148,160,170].map((x,i)=>{const h=[5,8,4,6,6,4,8,5][i];return `M${x-1.8} 9 L${x} ${9+h} L${x+1.8} 9Z`;}).join('');
 const twinkles=`<g class="snow-twinkles" fill="#ffffff">${[[26,70],[174,96],[22,200],[178,226],[64,30],[136,30]].map(([x,y],i)=>`<path class="snow-twinkle" style="animation-delay:-${i*.7}s" d="M${x} ${y-3}Q${x} ${y} ${x+3} ${y}Q${x} ${y} ${x} ${y+3}Q${x} ${y} ${x-3} ${y}Q${x} ${y} ${x} ${y-3}Z"/>`).join('')}</g>`;
 return `<g class="snow-frame" pointer-events="none">${half}<g transform="translate(200 0) scale(-1 1)">${half}</g>
 ${swags}<path d="${icicles}" fill="${ice}" stroke="#2c5680" stroke-width=".35" opacity=".95"/>${crown}${twinkles}</g>`;
}

