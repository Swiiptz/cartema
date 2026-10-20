import {useId} from 'react';

/** Printed and embossed foil pouch; both torn halves share exactly this artwork. */
export function BoosterSkin(){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
 return <svg className="booster-skin" viewBox="0 0 200 300" aria-hidden="true"><defs>
 <linearGradient id={`foil${id}`} x2="1" y2=".2"><stop stopColor="#100d13"/><stop offset=".12" stopColor="#321220"/><stop offset=".28" stopColor="#1a0c16"/><stop offset=".5" stopColor="#421428"/><stop offset=".7" stopColor="#1b0c15"/><stop offset=".88" stopColor="#2e1221"/><stop offset="1" stopColor="#100b12"/></linearGradient>
 <linearGradient id={`crimp${id}`} x2="0" y2="1"><stop stopColor="#9f8557"/><stop offset=".32" stopColor="#30211e"/><stop offset=".58" stopColor="#b29660"/><stop offset="1" stopColor="#493124"/></linearGradient>
 <linearGradient id={`ink${id}`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#ead7aa"/><stop offset=".24" stopColor="#ae8a50"/><stop offset=".47" stopColor="#f0d9a1"/><stop offset=".68" stopColor="#8b683d"/><stop offset="1" stopColor="#d3b47b"/></linearGradient>
 <pattern id={`ribs${id}`} width="4" height="10" patternUnits="userSpaceOnUse"><path d="M1 0V10" stroke="#d2ba89" strokeWidth=".6" opacity=".4"/><path d="M3 0V10" stroke="#110b10" strokeWidth=".9" opacity=".75"/></pattern>
 <pattern id={`damask${id}`} width="30" height="42" patternUnits="userSpaceOnUse"><path d="M15 4C4 14 23 16 15 26 7 16 26 14 15 4ZM15 26v12M15 31Q4 25 5 19 14 18 15 26M15 31Q26 25 25 19 16 18 15 26" fill="none" stroke="#bd9b64" strokeWidth=".65" opacity=".09"/></pattern>
 <g id={`sigil${id}`} fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M100 111 123 153 100 195 77 153ZM100 127 114 153 100 179 86 153Z"/><path d="M100 137 103 150 114 153 103 156 100 169 97 156 86 153 97 150Z"/>
 {Array.from({length:8},(_,i)=><g key={i} transform={`rotate(${i*45} 100 153)`}><path d="M100 102v7M100 197v7"/><path d="M100 112Q85 129 100 139 115 129 100 112Z" opacity=".6"/></g>)}<circle cx="100" cy="153" r="44" strokeDasharray="1 4"/></g>
 </defs>
 <path d="M4 2H196L198 9V290L195 298H5L2 290V9Z" fill={`url(#foil${id})`} stroke="#6f5636" strokeWidth=".8"/>
 <rect x="5" y="18" width="190" height="264" fill={`url(#damask${id})`}/>
 <path d="M4 2H196V18L189 16 181 18 173 16 165 18 157 16 149 18 141 16 133 18 125 16 117 18 109 16 101 18 93 16 85 18 77 16 69 18 61 16 53 18 45 16 37 18 29 16 21 18 13 16 4 18Z" fill={`url(#crimp${id})`}/><rect x="4" y="2" width="192" height="15" fill={`url(#ribs${id})`}/>
 <path d="M4 282 13 284 21 282 29 284 37 282 45 284 53 282 61 284 69 282 77 284 85 282 93 284 101 282 109 284 117 282 125 284 133 282 141 284 149 282 157 284 165 282 173 284 181 282 189 284 196 282V298H4Z" fill={`url(#crimp${id})`}/><rect x="4" y="284" width="192" height="14" fill={`url(#ribs${id})`}/>
 <g fill="none" stroke={`url(#ink${id})`} strokeWidth=".65" opacity=".52"><path d="M12 26V274M188 26V274M24 239V116Q24 91 65 77M176 239V116Q176 91 135 77M29 234V117Q29 97 60 85M171 234V117Q171 97 140 85"/>
 {[false,true].map(m=><g key={String(m)} transform={m?'translate(200 0) scale(-1 1)':''}><path d="M15 73Q30 82 19 99T19 128T19 157T19 186T19 215T19 244M16 96l8-3M17 125l-5-5M18 154l7-4M17 183l-5-4M18 212l7-4M18 241l-5-4"/><path d="M14 28Q28 21 34 30 39 39 29 41 23 41 24 34 27 30 30 34M14 270Q28 279 36 267 39 257 29 256 24 257 27 263"/><path d="M29 46 34 41 39 46 34 51ZM31 253l4-4 4 4-4 4Z"/></g>)}
 <path d="M66 72Q79 62 90 67M134 72Q121 62 110 67M66 234Q80 241 91 236M134 234Q120 241 109 236"/></g>
 <text x="100" y="41" fill="#baa078" textAnchor="middle" fontFamily="var(--display)" fontSize="7" letterSpacing="3.6">LES ARCANES</text>
 <path d="M64 44H82M118 44H136" stroke="#b99c65" strokeWidth=".5" opacity=".6"/>
 <text x="100.5" y="96" textAnchor="middle" fill="#08070a" fontFamily="var(--display)" fontWeight="600" fontSize="18" letterSpacing="2">CARTEMA</text>
 <text x="100" y="95" textAnchor="middle" fill={`url(#ink${id})`} fontFamily="var(--display)" fontWeight="600" fontSize="18" letterSpacing="2">CARTEMA</text>
 <use href={`#sigil${id}`} transform="translate(.5 .7)" stroke="#09070c" strokeWidth="1.6"/>
 <use href={`#sigil${id}`} stroke={`url(#ink${id})`} strokeWidth=".9" opacity=".88"/>
 <g fill={`url(#ink${id})`} opacity=".7"><path d="M53 145a7 7 0 1 0 4 12 6 6 0 0 1-4-12ZM147 145a7 7 0 1 1-4 12 6 6 0 0 0 4-12Z"/><path d="M100 68 102 73 107 75 102 77 100 82 98 77 93 75 98 73ZM100 218 102 223 107 225 102 227 100 232 98 227 93 225 98 223Z"/></g>
 <text x="100" y="251" textAnchor="middle" fill="#d0b581" fontFamily="var(--display)" fontSize="7" letterSpacing="2.5">CAMARILLA</text><text x="100" y="267" textAnchor="middle" fill="#ab9193" fontFamily="var(--body)" fontStyle="italic" fontSize="10">Cinq arcanes au-delà du voile</text>
 <path d="M5 61H195" stroke="#ad8c55" strokeWidth=".55" strokeDasharray="1 4" opacity=".35"/>
 <path d="M3 18Q8 140 3 283M197 18Q192 140 197 283" stroke="#08070c" strokeWidth="2" fill="none" opacity=".8"/>
 <path d="M7 22Q12 140 7 278M193 22Q188 140 193 278" stroke="#d6b780" strokeWidth=".5" fill="none" opacity=".2"/>
 </svg>;
}
