import {useId} from 'react';
import type {BoosterThemeName as BoosterTheme} from '@/lib/game';

/** Couleurs du sachet par thème : feuille (7 arrêts), encre dorée et texte du bas. */
const THEMES:Record<BoosterTheme,{foil:string[];ink:string[];label:string}>={
 camarilla:{foil:['#100d13','#321220','#1a0c16','#421428','#1b0c15','#2e1221','#100b12'],ink:['#ead7aa','#ae8a50','#f0d9a1','#8b683d','#d3b47b'],label:'#d0b581'},
 alpes:{foil:['#0b0d18','#1a2242','#0f1428','#26325c','#10162b','#1d2748','#0a0c16'],ink:['#f1e4c0','#a99568','#f6ecd2','#7d6c4c','#d9cba4'],label:'#d8cba8'},
 sabbat:{foil:['#0b0c14','#1b1d36','#10111f','#262a4a','#0f101d','#1d2038','#0a0b12'],ink:['#d9dcf0','#8e93b8','#e6e8f7','#646a92','#b9bdd8'],label:'#b9bfe6'},
 independant:{foil:['#0a110e','#123222','#0c1a13','#174532','#0b1812','#123a28','#09100c'],ink:['#d8ecd0','#7fae84','#e3f2dc','#5a8a62','#b5d6ad'],label:'#a8d3a6'},
 gold:{foil:['#3b2a0e','#a17a2b','#5e4313','#e2bd62','#6a4b16','#c39a43','#3a290c'],ink:['#fff4cf','#d9b25c','#fffbe6','#a37b2d','#f1d68e'],label:'#2a1c06'},
};

/** Printed and embossed foil pouch; both torn halves share exactly this artwork. */
export function BoosterSkin({name='Camarilla',theme='camarilla'}:{name?:string;theme?:BoosterTheme}={}){
 const t=THEMES[theme]??THEMES.camarilla;
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <svg className="booster-skin" viewBox="0 0 200 300" aria-hidden="true"><defs>
 <linearGradient id={`foil${id}`} x2="1" y2=".2">{[0,.12,.28,.5,.7,.88,1].map((o,k)=><stop key={k} offset={o} stopColor={t.foil[k]}/>)}</linearGradient>
 <linearGradient id={`crimp${id}`} x2="0" y2="1"><stop stopColor="#9f8557"/><stop offset=".32" stopColor="#30211e"/><stop offset=".58" stopColor="#b29660"/><stop offset="1" stopColor="#493124"/></linearGradient>
 <linearGradient id={`ink${id}`} x1="0" y1="0" x2=".8" y2="1">{[0,.24,.47,.68,1].map((o,k)=><stop key={k} offset={o} stopColor={t.ink[k]}/>)}</linearGradient>
 <pattern id={`ribs${id}`} width="4" height="10" patternUnits="userSpaceOnUse"><path d="M1 0V10" stroke="#d2ba89" strokeWidth=".6" opacity=".4"/><path d="M3 0V10" stroke="#110b10" strokeWidth=".9" opacity=".75"/></pattern>
 <pattern id={`damask${id}`} width="30" height="42" patternUnits="userSpaceOnUse"><path d="M15 4C4 14 23 16 15 26 7 16 26 14 15 4ZM15 26v12M15 31Q4 25 5 19 14 18 15 26M15 31Q26 25 25 19 16 18 15 26" fill="none" stroke="#bd9b64" strokeWidth=".65" opacity=".09"/></pattern>
 <g id={`sigil${id}`} fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M100 111 123 153 100 195 77 153ZM100 127 114 153 100 179 86 153Z"/><path d="M100 137 103 150 114 153 103 156 100 169 97 156 86 153 97 150Z"/>
 {Array.from({length:8},(_,i)=><g key={i} transform={`rotate(${i*45} 100 153)`}><path d="M100 102v7M100 197v7"/><path d="M100 112Q85 129 100 139 115 129 100 112Z" opacity=".6"/></g>)}<circle cx="100" cy="153" r="44" strokeDasharray="1 4"/></g>
 </defs>
 <path d="M4 2H196L198 9V290L195 298H5L2 290V9Z" fill={`url(#foil${id})`} stroke="#6f5636" strokeWidth=".8"/>
 {theme==='alpes'?<EngravedRange id={id}/>:<rect x="5" y="18" width="190" height="264" fill={`url(#damask${id})`}/>}
 <path d="M4 2H196V18L189 16 181 18 173 16 165 18 157 16 149 18 141 16 133 18 125 16 117 18 109 16 101 18 93 16 85 18 77 16 69 18 61 16 53 18 45 16 37 18 29 16 21 18 13 16 4 18Z" fill={`url(#crimp${id})`}/><rect x="4" y="2" width="192" height="15" fill={`url(#ribs${id})`}/>
 <path d="M4 282 13 284 21 282 29 284 37 282 45 284 53 282 61 284 69 282 77 284 85 282 93 284 101 282 109 284 117 282 125 284 133 282 141 284 149 282 157 284 165 282 173 284 181 282 189 284 196 282V298H4Z" fill={`url(#crimp${id})`}/><rect x="4" y="284" width="192" height="14" fill={`url(#ribs${id})`}/>
 <g fill="none" stroke={`url(#ink${id})`} strokeWidth=".65" opacity=".52"><path d="M12 26V274M188 26V274M24 239V116Q24 91 65 77M176 239V116Q176 91 135 77M29 234V117Q29 97 60 85M171 234V117Q171 97 140 85"/>
 {[false,true].map(m=><g key={String(m)} transform={m?'translate(200 0) scale(-1 1)':''}><path d="M15 73Q30 82 19 99T19 128T19 157T19 186T19 215T19 244M16 96l8-3M17 125l-5-5M18 154l7-4M17 183l-5-4M18 212l7-4M18 241l-5-4"/><path d="M14 28Q28 21 34 30 39 39 29 41 23 41 24 34 27 30 30 34M14 270Q28 279 36 267 39 257 29 256 24 257 27 263"/><path d="M29 46 34 41 39 46 34 51ZM31 253l4-4 4 4-4 4Z"/></g>)}
 <path d="M66 72Q79 62 90 67M134 72Q121 62 110 67M66 234Q80 241 91 236M134 234Q120 241 109 236"/></g>
 <text x="100" y="41" fill="#baa078" textAnchor="middle" fontFamily="var(--display)" fontSize="7" letterSpacing="3.6">LES ARCANES</text>
 <path d="M64 44H82M118 44H136" stroke="#b99c65" strokeWidth=".5" opacity=".6"/>
 <text x="100.5" y="96" textAnchor="middle" fill="#08070a" fontFamily="var(--display)" fontWeight="600" fontSize="18" letterSpacing="2">CARTEMA</text>
 <text x="100" y="95" textAnchor="middle" fill={`url(#ink${id})`} fontFamily="var(--display)" fontWeight="600" fontSize="18" letterSpacing="2">CARTEMA</text>
 {theme==='alpes'?<MountainEmblem id={id}/>:<>
 <use href={`#sigil${id}`} transform="translate(.5 .7)" stroke="#09070c" strokeWidth="1.6"/>
 <use href={`#sigil${id}`} stroke={`url(#ink${id})`} strokeWidth=".9" opacity=".88"/></>}
 <g fill={`url(#ink${id})`} opacity=".7"><path d="M53 145a7 7 0 1 0 4 12 6 6 0 0 1-4-12ZM147 145a7 7 0 1 1-4 12 6 6 0 0 0 4-12Z"/><path d="M100 68 102 73 107 75 102 77 100 82 98 77 93 75 98 73ZM100 218 102 223 107 225 102 227 100 232 98 227 93 225 98 223Z"/></g>
 <text x="100" y="251" textAnchor="middle" fill={t.label} fontFamily="var(--display)" fontSize="7" letterSpacing="2.5">{name.toUpperCase()}</text><text x="100" y="267" textAnchor="middle" fill="#ab9193" fontFamily="var(--body)" fontStyle="italic" fontSize="10">Cinq arcanes au-delà du voile</text>
 <path d="M5 61H195" stroke="#ad8c55" strokeWidth=".55" strokeDasharray="1 4" opacity=".35"/>
 <path d="M3 18Q8 140 3 283M197 18Q192 140 197 283" stroke="#08070c" strokeWidth="2" fill="none" opacity=".8"/>
 <path d="M7 22Q12 140 7 278M193 22Q188 140 193 278" stroke="#d6b780" strokeWidth=".5" fill="none" opacity=".2"/>
 </svg>;
}

/* Édition ANE : dorure gravée. Les montagnes sont tracées à l'or fin, les versants d'ombre en
 * hachures comme sur une gravure, et une ombre portée sombre leur donne du relief (même procédé que
 * le sigil du sachet classique). */

/** Hachures dorées d'un versant d'ombre (motif partagé par le fond et le médaillon). */
function Hatch({id,gap=2.2,angle=-50,opacity=.55}:{id:string;gap?:number;angle?:number;opacity?:number}){
 return <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}><path d={`M0 0V${gap}`} stroke="#e8d4a2" strokeWidth=".45" opacity={opacity}/></pattern>;
}

type Peak={x:number;top:number;base:number;w:number};
/** Un sommet gravé : contour doré, versant d'ombre hachuré, neige cernée d'or. */
function EngravedPeak({p,id,shade,line,emboss}:{p:Peak;id:string;shade:string;line:number;emboss:boolean}){
 const h=p.base-p.top,snow=`M${p.x} ${p.top}L${p.x-p.w*.3} ${p.top+h*.28}L${p.x-p.w*.1} ${p.top+h*.22}L${p.x+1} ${p.top+h*.33}L${p.x+p.w*.13} ${p.top+h*.21}L${p.x+p.w*.28} ${p.top+h*.27}Z`;
 const ridge=`M${p.x-p.w} ${p.base}L${p.x} ${p.top}L${p.x+p.w} ${p.base}`;
 return <g>
  {emboss&&<path d={ridge} transform="translate(.6 .9)" fill="none" stroke="#05060b" strokeWidth={line+.9} strokeLinejoin="round" opacity=".8"/>}
  <path d={`M${p.x} ${p.top}L${p.x+p.w} ${p.base}H${p.x+3}Z`} fill={`url(#${shade})`}/>
  <path d={`M${p.x} ${p.top}L${p.x+2} ${p.top+h*.5}L${p.x+3} ${p.base}`} fill="none" stroke={`url(#ink${id})`} strokeWidth={line*.55} opacity=".7"/>
  <path d={snow} fill="#f6ecd2" opacity=".14" stroke={`url(#ink${id})`} strokeWidth={line*.7}/>
  <path d={ridge} fill="none" stroke={`url(#ink${id})`} strokeWidth={line} strokeLinejoin="round"/>
 </g>;
}

/** Chaîne gravée en fond, de bord à bord, discrète comme le damas. */
function EngravedRange({id}:{id:string}){
 const far:Peak[]=[{x:20,top:206,base:250,w:26},{x:58,top:192,base:250,w:30},{x:96,top:200,base:250,w:26},{x:136,top:188,base:250,w:32},{x:178,top:204,base:250,w:28}];
 const near:Peak[]=[{x:38,top:222,base:268,w:30},{x:112,top:228,base:268,w:28},{x:162,top:218,base:268,w:32}];
 return <g opacity=".4">
  <defs><Hatch id={`rh${id}`} gap={2.6} opacity={.5}/></defs>
  {far.map((p,k)=><EngravedPeak key={k} p={p} id={id} shade={`rh${id}`} line={.45} emboss={false}/>)}
  {near.map((p,k)=><EngravedPeak key={`n${k}`} p={p} id={id} shade={`rh${id}`} line={.55} emboss={false}/>)}
  {/* Brumes de vallée */}
  <path d="M8 246Q50 240 92 246T182 244M14 262Q60 256 104 262T192 260" fill="none" stroke={`url(#ink${id})`} strokeWidth=".45" strokeDasharray="6 3"/>
 </g>;
}

/** Médaillon central : trois sommets gravés en relief sous une lune, dans le cercle du sigil. */
function MountainEmblem({id}:{id:string}){
 const peaks:Peak[]=[{x:74,top:140,base:184,w:26},{x:127,top:136,base:184,w:27},{x:100,top:116,base:184,w:36}];
 return <g strokeLinecap="round">
  <defs><Hatch id={`mh${id}`} gap={1.9} opacity={.8}/>
   <radialGradient id={`halo${id}`}><stop stopColor="#f6ecd2" stopOpacity=".22"/><stop offset="1" stopColor="#f6ecd2" stopOpacity="0"/></radialGradient></defs>
  <circle cx="100" cy="153" r="46" fill={`url(#halo${id})`}/>
  {/* Cercles du médaillon, gravés avec leur ombre */}
  <circle cx="100.5" cy="153.7" r="44" fill="none" stroke="#05060b" strokeWidth="1.6" strokeDasharray="1 4"/>
  <circle cx="100" cy="153" r="44" fill="none" stroke={`url(#ink${id})`} strokeWidth=".9" strokeDasharray="1 4" opacity=".9"/>
  <circle cx="100.5" cy="153.7" r="38" fill="none" stroke="#05060b" strokeWidth="1.2"/>
  <circle cx="100" cy="153" r="38" fill="none" stroke={`url(#ink${id})`} strokeWidth=".55"/>
  {/* Rayons de lune gravés, puis la lune en relief */}
  <g stroke={`url(#ink${id})`} strokeWidth=".4" opacity=".55">{Array.from({length:9},(_,k)=>{const a=(-160+k*14)*Math.PI/180;return <path key={k} d={`M${124+Math.cos(a)*11} ${129+Math.sin(a)*11}L${124+Math.cos(a)*17} ${129+Math.sin(a)*17}`}/>;})}</g>
  <path d="M121.5 121.5a8.5 8.5 0 1 0 9 12 7 7 0 0 1-9-12Z" transform="translate(.5 .8)" fill="#05060b" opacity=".8"/>
  <path d="M121.5 121.5a8.5 8.5 0 1 0 9 12 7 7 0 0 1-9-12Z" fill={`url(#ink${id})`}/>
  <g fill={`url(#ink${id})`}>{[[80,128,1.1],[90,121,.7],[108,124,.8],[72,141,.6],[134,147,.6]].map(([x,y,r],k)=><path key={k} d={`M${x} ${y-r*2}L${x+r*.5} ${y-r*.5}L${x+r*2} ${y}L${x+r*.5} ${y+r*.5}L${x} ${y+r*2}L${x-r*.5} ${y+r*.5}L${x-r*2} ${y}L${x-r*.5} ${y-r*.5}Z`}/>)}</g>
  {peaks.map((p,k)=><EngravedPeak key={k} p={p} id={id} shade={`mh${id}`} line={.85} emboss/>)}
  {/* Sapins gravés au pied des sommets */}
  <g stroke={`url(#ink${id})`} strokeWidth=".5" fill="none">{[[66,184,9],[72,184,12],[132,184,11],[139,184,8]].map(([x,y,hh],k)=><path key={k} d={`M${x} ${y-hh}L${x-3} ${y-hh*.5}H${x+3}ZM${x} ${y-hh*.6}L${x-4} ${y}H${x+4}Z`}/>)}</g>
  <path d="M61 184.6H140" stroke="#05060b" strokeWidth="1.4"/><path d="M61 184H139" stroke={`url(#ink${id})`} strokeWidth=".9"/>
 </g>;
}
