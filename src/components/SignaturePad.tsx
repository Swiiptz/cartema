'use client';
import {useEffect,useRef,useState} from 'react';
import {Eraser,ImagePlus,PenLine,Undo2} from 'lucide-react';

/** Fichier importé : PNG seulement, 2 Mo, entre 300 × 100 et 4 000 × 4 000 pixels. */
export const SIGNATURE_LIMITS={maxBytes:2*1024*1024,minWidth:300,minHeight:100,maxSide:4000};
// Image envoyée : rognée au tracé, au plus 1 000 × 400 pixels.
const OUT_W=1000,OUT_H=400;
const PAD_W=900,PAD_H=360,STROKE=9;

type Point=[number,number];

/** Rogne les marges transparentes et réduit l'image ; rien si elle est vide. */
function normalize(source:CanvasImageSource,width:number,height:number):Promise<Blob|null>{
 const c=document.createElement('canvas');c.width=width;c.height=height;
 const g=c.getContext('2d',{willReadFrequently:true})!;g.drawImage(source,0,0);
 const {data}=g.getImageData(0,0,width,height);
 let x0=width,y0=height,x1=-1,y1=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
 if(x1<0)return Promise.resolve(null);
 const m=Math.round(Math.max(x1-x0,y1-y0)*.04);
 x0=Math.max(0,x0-m);y0=Math.max(0,y0-m);x1=Math.min(width-1,x1+m);y1=Math.min(height-1,y1+m);
 const w=x1-x0+1,h=y1-y0+1,k=Math.min(1,OUT_W/w,OUT_H/h);
 const out=document.createElement('canvas');out.width=Math.max(1,Math.round(w*k));out.height=Math.max(1,Math.round(h*k));
 const o=out.getContext('2d')!;o.imageSmoothingQuality='high';o.drawImage(c,x0,y0,w,h,0,0,out.width,out.height);
 return new Promise(r=>out.toBlob(b=>r(b),'image/png'));
}

/** Vérifie un PNG importé : taille, poids et fond vraiment transparent. Renvoie le message d'erreur, ou rien. */
async function checkPng(file:File):Promise<{error:string}|{image:ImageBitmap}>{
 const L=SIGNATURE_LIMITS;
 if(file.type!=='image/png')return {error:'Seul un fichier PNG est accepté.'};
 if(file.size>L.maxBytes)return {error:'Fichier trop lourd : 2 Mo maximum.'};
 let image:ImageBitmap;
 try{image=await createImageBitmap(file);}catch{return {error:'Image illisible.'};}
 if(image.width<L.minWidth||image.height<L.minHeight)return {error:`Image trop petite : ${L.minWidth} × ${L.minHeight} pixels minimum.`};
 if(image.width>L.maxSide||image.height>L.maxSide)return {error:`Image trop grande : ${L.maxSide} pixels maximum de côté.`};
 // Analyse sur une réduction : au moins 30 % de pixels transparents, et un tracé bien visible.
 const k=Math.min(1,400/Math.max(image.width,image.height));
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*k));c.height=Math.max(1,Math.round(image.height*k));
 const g=c.getContext('2d',{willReadFrequently:true})!;g.drawImage(image,0,0,c.width,c.height);
 const {data}=g.getImageData(0,0,c.width,c.height);
 let clear=0,ink=0;const total=data.length/4;
 for(let i=3;i<data.length;i+=4){if(data[i]<16)clear++;else if(data[i]>200)ink++;}
 if(clear/total<.3)return {error:'Le fond doit être transparent : exportez votre signature en PNG sans fond.'};
 if(ink/total<.003)return {error:'La signature est trop pâle ou trop fine pour être lisible.'};
 return {image};
}

/** Signature tracée à l'écran ou importée (PNG transparent), toujours rendue en PNG rogné. */
export function SignaturePad({onChange}:{onChange:(signature:Blob|null)=>void}){
 const [mode,setMode]=useState<'draw'|'file'>('draw');
 const [strokes,setStrokes]=useState<Point[][]>([]);
 const [fileName,setFileName]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 const canvas=useRef<HTMLCanvasElement>(null);
 const current=useRef<Point[]|null>(null);
 // Traits validés, lus aussi entre deux rendus (gestes très rapprochés).
 const done=useRef<Point[][]>([]);
 // Rappel du parent gardé à part : il change à chaque rendu.
 const changed=useRef(onChange);changed.current=onChange;

 const paint=(list:Point[][])=>{
  const c=canvas.current;if(!c)return;const g=c.getContext('2d')!;
  g.clearRect(0,0,PAD_W,PAD_H);g.lineCap='round';g.lineJoin='round';g.lineWidth=STROKE;g.strokeStyle='#1d1418';g.fillStyle='#1d1418';
  for(const s of list){
   if(s.length===1){g.beginPath();g.arc(s[0][0],s[0][1],STROKE/2,0,Math.PI*2);g.fill();continue;}
   // Courbe lissée : on passe par le milieu de chaque segment.
   g.beginPath();g.moveTo(s[0][0],s[0][1]);
   for(let i=1;i<s.length-1;i++)g.quadraticCurveTo(s[i][0],s[i][1],(s[i][0]+s[i+1][0])/2,(s[i][1]+s[i+1][1])/2);
   g.lineTo(s[s.length-1][0],s[s.length-1][1]);g.stroke();
  }
 };
 const commit=(list:Point[][])=>{done.current=list;setStrokes(list);paint(list);if(!list.length){changed.current(null);return;}void normalize(canvas.current!,PAD_W,PAD_H).then(b=>changed.current(b));};
 useEffect(()=>{if(mode==='draw')paint(strokes);},[mode]);// eslint-disable-line react-hooks/exhaustive-deps

 const at=(e:React.PointerEvent<HTMLCanvasElement>):Point=>{const r=e.currentTarget.getBoundingClientRect();return [(e.clientX-r.left)*PAD_W/r.width,(e.clientY-r.top)*PAD_H/r.height];};
 const switchTo=(m:'draw'|'file')=>{if(m===mode)return;setMode(m);setError(null);setFileName(null);done.current=[];setStrokes([]);changed.current(null);};

 async function pick(file:File|undefined){
  setError(null);setFileName(null);changed.current(null);
  if(!file)return;
  const r=await checkPng(file);
  if('error' in r){setError(r.error);return;}
  const blob=await normalize(r.image,r.image.width,r.image.height);r.image.close();
  if(!blob){setError('La signature est vide.');return;}
  setFileName(file.name);changed.current(blob);
 }

 return <div className="signature-pad">
  <div className="segmented signature-modes" role="tablist">
   <button type="button" role="tab" aria-selected={mode==='draw'} onClick={()=>switchTo('draw')}><PenLine size={15}/> Signer ici</button>
   <button type="button" role="tab" aria-selected={mode==='file'} onClick={()=>switchTo('file')}><ImagePlus size={15}/> Importer un PNG</button>
  </div>
  {mode==='draw'?<>
   <div className="signature-sheet">
    <canvas ref={canvas} width={PAD_W} height={PAD_H} aria-label="Zone de signature"
     onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);current.current=[at(e)];paint([...done.current,current.current]);}}
     onPointerMove={e=>{if(!current.current)return;current.current.push(at(e));paint([...done.current,current.current]);}}
     onPointerUp={()=>{if(!current.current)return;const s=current.current;current.current=null;commit([...done.current,s]);}}
     onPointerCancel={()=>{current.current=null;paint(done.current);}}/>
    {!strokes.length&&<span className="signature-placeholder" aria-hidden="true">Signez ici</span>}
    <span className="signature-line" aria-hidden="true"/>
   </div>
   <div className="signature-tools">
    <button type="button" className="signature-tool" disabled={!strokes.length} onClick={()=>commit(done.current.slice(0,-1))}><Undo2 size={15}/> Annuler le trait</button>
    <button type="button" className="signature-tool" disabled={!strokes.length} onClick={()=>commit([])}><Eraser size={15}/> Tout effacer</button>
   </div>
  </>:<>
   <label className="feedback-file"><ImagePlus size={16}/><span>{fileName??'Choisir un PNG à fond transparent'}</span><input type="file" accept="image/png" onChange={e=>void pick(e.target.files?.[0])}/></label>
   <ul className="signature-rules">
    <li><strong>Format</strong> PNG uniquement, <strong>fond transparent</strong> (pas de fond blanc ni de papier scanné).</li>
    <li><strong>Taille conseillée</strong> 1 000 × 400 pixels, signature allongée à l’horizontale.</li>
    <li><strong>Minimum</strong> {SIGNATURE_LIMITS.minWidth} × {SIGNATURE_LIMITS.minHeight} pixels, <strong>maximum</strong> {SIGNATURE_LIMITS.maxSide.toLocaleString('fr-FR')} pixels de côté, 2 Mo.</li>
    <li>Trait épais et foncé : il sera redessiné à l’encre dorée sur la carte. Les marges vides sont retirées automatiquement.</li>
   </ul>
  </>}
  {error&&<p className="auth-error" role="alert">{error}</p>}
 </div>;
}
