// Hand-authored SVG ornament for the Sanglante finish. No raster artwork.
export function bloodDefinitions(u){return `<clipPath id="ornament-safe${u}"><path d="M0 0H200V300H0Z M38 223H162V281H38Z M80 283H120V296H80Z" clip-rule="evenodd"/></clipPath><linearGradient id="ichor${u}" x1="0" y1="0" x2="1" y2=".2"><stop stop-color="#26030b"/><stop offset=".22" stop-color="#79091c"/><stop offset=".44" stop-color="#d51b31"/><stop offset=".58" stop-color="#6e0718"/><stop offset=".8" stop-color="#a80e25"/><stop offset="1" stop-color="#30030e"/></linearGradient><radialGradient id="ruby${u}" cx=".3" cy=".2" r=".8"><stop stop-color="#fb7f6a"/><stop offset=".18" stop-color="#c72136"/><stop offset=".52" stop-color="#7b071b"/><stop offset="1" stop-color="#26040f"/></radialGradient>`;}
function rose(x,y,u,flip=false){return `<g transform="translate(${x} ${y}) scale(${flip?'-1':'1'} 1)"><path d="M-1 6Q-8 2-10 8-4 11-1 6M2 7Q8 1 11 7 6 12 2 7" fill="#3d3821" stroke="#b09250" stroke-width=".5"/><path d="M0-7C-4-10-8-6-7-3-12 0-8 6-4 6-2 11 4 9 6 5 11 3 9-3 6-5 5-10 1-10 0-7Z" fill="url(#ruby${u})" stroke="#380512" stroke-width=".8"/><path d="M-5-3Q0-8 5-2 8 3 1 6-5 7-6 1-7-3-2-4 3-6 4-1 5 4 0 4-4 3-3 0-2-2 2-2 1 1L-1 2" fill="none" stroke="#d04045" stroke-width=".65"/><path d="M-5-5-7-2M4-6 6-4" stroke="#ed8d65" stroke-width=".35"/></g>`;}
export function bloodFrame(u){
 const metal=`url(#metal${u})`,blood=`url(#ichor${u})`;
 const vine='M10 75C27 57 7 43 18 26 25 15 40 19 45 11M12 84C29 103 7 116 15 134 25 155 8 167 14 187M11 214C29 203 10 191 19 179M12 265C26 245 12 234 23 226M12 271C30 293 48 277 65 291';
 const red='M54 9C44 16 29 11 22 18 11 29 20 39 12 58M8 101C18 113 9 127 15 140M11 167C20 180 8 195 16 206M13 235C24 243 13 251 17 263M17 280C25 289 36 282 47 290';
 const side=`<path d="${vine}" fill="none" stroke="#21170e" stroke-width="4.6"/><path d="${vine}" fill="none" stroke="${metal}" stroke-width="2.5"/><path d="M12 73C21 61 9 47 19 29M13 136C23 154 10 168 15 180M17 272Q35 289 55 286" fill="none" stroke="#f1d39a" stroke-width=".5" opacity=".85"/>
 <g fill="#302317" stroke="${metal}" stroke-width=".8"><path d="M14 47Q28 43 23 32 13 34 14 47ZM16 126Q27 125 23 114 13 116 16 126ZM14 178Q25 175 23 165 14 168 14 178ZM15 245Q27 241 24 230 13 233 15 245Z"/><path d="M14 57 23 54 17 62M14 149 22 153 15 158M17 195 23 198 15 202M26 281 31 273 33 283"/></g>
 <g stroke="${metal}" fill="#100c10" stroke-width=".8"><path d="M16 68Q4 79 16 93 28 79 16 68Z"/><path d="M16 72V88M9 80H23"/><path d="M16 103 17.5 108 23 110 17.5 112 16 117 14.5 112 9 110 14.5 108Z" fill="${metal}"/><path d="M16 153a6 6 0 1 0 5 10 5 5 0 0 1-5-10Z" fill="${metal}"/></g>
 <path d="M16 72 20 80 16 87 12 80Z" fill="url(#ruby${u})"/>
 <g fill="none" stroke="${metal}" stroke-width=".8"><path d="M18 25Q35 27 39 12M18 25Q25 39 34 36 43 33 37 27 32 22 28 27 25 31 29 33M13 271Q28 264 36 275 41 286 50 282 58 279 54 274 50 271 47 275"/></g>
 <path class="ichor-body" d="${red}" fill="none" stroke="#24020b" stroke-width="3.6" stroke-linecap="round"/>
 <path d="${red}" fill="none" stroke="${blood}" stroke-width="2.4" stroke-linecap="round"/>
 <path class="ichor-static-glint" d="${red}" fill="none" stroke="#ffb1a0" stroke-width=".6" pathLength="100" stroke-dasharray="5 15 2 28 5 45"/>
 <g fill="${blood}" stroke="#3d0410" stroke-width=".4"><path d="M21 22C18 29 23 32 20 39L19 46Q20 50 21.3 46C22 40 24 35 23 31L24 23Z"/><path d="M13 139C14 146 12 153 13 159Q14 163 15 158L15 145Z"/><path d="M17 260 17 270Q18 274 19 270L19 260Z"/></g>
 ${flowingBlood(u)}
 <g stroke="#f58b78" stroke-width=".4" fill="none" opacity=".8"><path d="M20.5 38 20 44M13.8 150v7M18 265v4"/></g>`;
 return `<g class="sanguine-ornament" pointer-events="none" clip-path="url(#ornament-safe${u})"><path d="M13 9Q100 17 187 9M11 13Q100 22 189 13" fill="none" stroke="${metal}" stroke-width=".7" opacity=".8"/>
 ${side}<g transform="translate(200 0) scale(-1 1)">${side}</g>
 <g fill="none" stroke="${metal}" stroke-width="1"><path d="M45 12Q59 27 79 18M155 12Q141 27 121 18M55 11Q64 21 73 13M145 11Q136 21 127 13"/><path d="M84 9Q100 30 116 9M83 12 78 6 79 17M117 12 122 6 121 17"/></g>
 <path d="M100 5 104 13 100 24 96 13Z" fill="url(#ruby${u})" stroke="${metal}" stroke-width="1"/><path d="M98 12 100 8 101 13" stroke="#f5b5a1" stroke-width=".6" fill="none"/>
 <path d="M29 209Q40 194 63 203M171 209Q160 194 137 203" fill="none" stroke="${metal}" stroke-width="1.2"/>
 ${rose(24,270,u)}${rose(176,270,u,true)}
 <g fill="none" stroke="${metal}" stroke-width=".85"><path d="M50 286Q67 276 81 287M150 286Q133 276 119 287M60 289Q71 281 78 288M140 289Q129 281 122 288"/></g>
 <path d="M25 211Q42 204 64 210M175 211Q158 204 136 210" stroke="${blood}" stroke-width="1.8" fill="none"/>
 <path class="ichor-static-glint" d="M25 211Q42 204 64 210M175 211Q158 204 136 210" stroke="#ffb1a0" stroke-width=".5" fill="none" pathLength="100" stroke-dasharray="4 96"/>
 ${bloodAccents(u)}
 </g>`;
}

// Every stream is authored from top to bottom. Resets happen only while invisible.
function flowingBlood(u){
 const streams=[{d:'M22 18C19 29 23 36 20 47L19 59',x:19,y:59,t:7.5,delay:-1.2},{d:'M13 104C17 117 11 127 14 139L13 153',x:13,y:153,t:8.7,delay:-5.4},{d:'M16 175C12 186 18 196 15 211',x:15,y:211,t:6.8,delay:-3.1},{d:'M19 237C16 246 20 254 18 264',x:18,y:264,t:8.1,delay:-6.5}];
 return `<g class="gravity-blood">${streams.map(({d,x,y,t,delay})=>`<g style="--flow-time:${t}s;--flow-delay:${delay}s"><path class="blood-stream" d="${d}" fill="none" stroke="url(#ichor${u})" stroke-width="1.8" stroke-linecap="round" pathLength="100"/><path class="blood-stream-glint" d="${d}" fill="none" stroke="#f38c81" stroke-width=".45" stroke-linecap="round" pathLength="100"/><g class="falling-ichor"><path d="M${x} ${y-3}C${x-.2} ${y-1} ${x-1.8} ${y+.4} ${x-1.1} ${y+2}Q${x} ${y+3.6} ${x+1.1} ${y+2}C${x+1.8} ${y+.4} ${x+.2} ${y-1} ${x} ${y-3}Z" fill="url(#ruby${u})"/><path d="M${x-.3} ${y}v1.4" stroke="#ffb09c" stroke-width=".4"/></g></g>`).join('')}</g>`;
}

function bloodAccents(u){
 return `<g class="sanguine-accents">${[{x:25,y:31,t:5.8,d:-1.4},{x:176,y:45,t:6.3,d:-4.7},{x:18,y:117,t:7.1,d:-2.3},{x:183,y:174,t:5.6,d:-3.7},{x:24,y:232,t:6.8,d:-5.2}].map(({x,y,t,d})=>`<g class="blood-pearl" style="--pearl-time:${t}s;--pearl-delay:${d}s"><ellipse cx="${x}" cy="${y}" rx=".85" ry="1.5" fill="url(#ruby${u})"/><path d="M${x-.2} ${y-.6}v.8" stroke="#f5aa8d" stroke-width=".35"/></g>`).join('')}
 ${[{x:100,y:13,d:-1},{x:16,y:79,d:-4.2},{x:184,y:79,d:-2.5}].map(({x,y,d})=>`<g transform="translate(${x} ${y})"><path class="ruby-facet-glint" style="--facet-delay:${d}s" d="M-2-2 0-3 1 0" fill="none" stroke="#ffe3b6" stroke-width=".75" stroke-linecap="round"/></g>`).join('')}
 <path class="gilded-descending-glint" d="M6 25V275M194 25V275" fill="none" stroke="#f6d69b" stroke-width=".8" pathLength="100" stroke-dasharray="5 45"/>
 </g>`;
}
