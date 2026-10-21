#!/usr/bin/env node
// Import d'illustrations depuis un dossier local, sans passer par le back-office.
//
//   1. Déposer les images dans illustrations/ (ou illustrations/<PRÉFIXE>/ pour une autre édition
//      que CAM), nommées comme le personnage : « Violette.webp », « Isabeau de Marnay.png ».
//   2. npm run illustrations:essai      → montre seulement les correspondances, n’envoie rien
//      npm run illustrations            → envoie, relie aux cartes, range les fichiers dans importees/
//
// Même traitement que le back-office : original conservé intact, version d'affichage WebP de
// 900 px de large, cadrage par défaut, chemins par édition (CAM/originals, CAM/display) et
// inscription au journal d'administration. Passe par la CLI Supabase du projet lié : aucune clé
// à fournir. Une carte qui avait déjà une illustration est remplacée.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,extname,basename,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';

sharp.cache(false);

// Racine du projet d'après l'emplacement du script : la commande marche depuis n'importe quel dossier.
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const DIR=join(ROOT,'illustrations');
const DONE=join(DIR,'importees');
const DISPLAY_WIDTH=900;
const MAX_BYTES=15*1024*1024;
// PowerShell avale « -- » : « npm run illustrations -- --essai » arrive comme option npm
// (npm_config_essai). On la reconnaît aussi, pour ne jamais envoyer par erreur.
const DRY=['--essai','--dry-run','essai'].some(a=>process.argv.includes(a))||!!process.env.npm_config_essai||!!process.env.npm_config_dry_run;
const TYPES={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'};

// La CLI confond un chemin Windows absolu (« D:\… ») avec une adresse : chemins relatifs uniquement.
const local=p=>relative(ROOT,p).replace(/\\/g,'/');
const nameKey=s=>s.replace(/\.[a-z0-9]{2,5}$/i,'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9*]+/g,' ').trim();
const defaultLayout=({width,height,transparent})=>transparent?'portrait':(height/width<1||height/width>=1.8?'cover':'portrait');
const sql=s=>`'${String(s).replace(/'/g,"''")}'`;

function supabase(args,opts={}){
 return execFileSync('npx',['supabase',...args,'--agent','no'],{cwd:ROOT,encoding:'utf8',shell:process.platform==='win32',stdio:['ignore','pipe','pipe'],...opts});
}
/** Requête sur la base liée ; une nouvelle tentative si la CLI ne répond pas, puis erreur lisible. */
function query(text){
 const file=join(tmpdir(),`cartema-${randomUUID()}.sql`);
 writeFileSync(file,text);
 let last='';
 for(let attempt=1;attempt<=2;attempt++){
  try{
   // Format JSON imposé : dans un terminal, la CLI affiche sinon un tableau.
   const out=supabase(['db','query','--linked','-f',file,'-o','json']);
   const start=out.search(/[[{]/);
   if(start>=0){
    const data=JSON.parse(out.slice(start,Math.max(out.lastIndexOf(']'),out.lastIndexOf('}'))+1));
    rmSync(file,{force:true});
    return Array.isArray(data)?data:data.rows??[];
   }
   last=out;
  }catch(e){last=`${e.stdout??''}${e.stderr??''}`||e.message;}
 }
 rmSync(file,{force:true});
 console.error(`
La base Supabase n’a pas répondu. Message de la CLI :
${last.trim()||'(aucun)'}
`);
 console.error('Vérifiez la connexion internet, puis « npx supabase login » et « npx supabase link » si le message parle d’accès.');
 process.exit(1);
}
function supabaseUrl(){
 const env=readFileSync(join(ROOT,'.env.local'),'utf8');
 const m=env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
 if(!m)throw new Error('NEXT_PUBLIC_SUPABASE_URL absent de .env.local');
 return m[1].trim().replace(/\/$/,'');
}

/** Fichiers à importer : racine du dossier → CAM ; sous-dossier → préfixe d'édition. */
function collect(){
 mkdirSync(DIR,{recursive:true});
 const out=[];
 for(const entry of readdirSync(DIR)){
  const full=join(DIR,entry);
  if(statSync(full).isDirectory()){
   if(entry==='importees'||entry==='.tmp')continue;
   for(const f of readdirSync(full))if(TYPES[extname(f).toLowerCase()])out.push({path:join(full,f),name:f,prefix:entry.toUpperCase()});
  }else if(TYPES[extname(entry).toLowerCase()])out.push({path:full,name:entry,prefix:'CAM'});
 }
 return out;
}

const files=collect();
if(!files.length){console.log(`Aucune image dans ${DIR}. Déposez-y des fichiers nommés comme les personnages.`);process.exit(0);}

const characters=query(`select c.id, c.number, c.name, e.prefix from public.characters c join public.editions e on e.id = c.edition_id
  where c.status <> 'archived' and e.archived_at is null;`);
const plan=[];
for(const f of files){
 const pool=characters.filter(c=>c.prefix===f.prefix);
 const key=nameKey(f.name);
 let found=pool.filter(c=>nameKey(c.name)===key);
 if(!found.length)found=pool.filter(c=>nameKey(c.name.split(' ')[0])===key);
 if(found.length===1)plan.push({...f,character:found[0]});
 else console.log(`✗ ${f.name} : ${found.length?`ambigu (${found.map(c=>c.name).join(', ')}) — renommez avec le nom complet`:`aucun personnage « ${basename(f.name,extname(f.name))} » dans ${f.prefix}`}`);
}
for(const p of plan)console.log(`✓ ${p.name} → ${p.character.name} (${p.prefix}-${String(p.character.number).padStart(3,'0')})`);
if(DRY||!plan.length){console.log(DRY?'\nEssai : rien n’a été envoyé.':'\nRien à importer.');process.exit(0);}

const base=supabaseUrl();
const [admin]=query(`select id from public.profiles where role = 'admin' limit 1;`);
const updates=[];
mkdirSync(DONE,{recursive:true});
for(const p of plan){
 const ext=extname(p.name).toLowerCase();
 if(statSync(p.path).size>MAX_BYTES){console.log(`✗ ${p.name} : plus de 15 Mo, ignoré.`);continue;}
 // Lecture en mémoire : sous Windows, sharp garderait le fichier verrouillé (rangement impossible).
 const buffer=readFileSync(p.path);
 const image=sharp(buffer);
 const meta=await image.metadata();
 const transparent=meta.hasAlpha?!(await image.stats()).isOpaque:false;
 const code=`${p.prefix}-${String(p.character.number).padStart(3,'0')}`;
 const token=randomUUID().slice(0,8);
 const original=`${p.prefix}/originals/${code}-${token}${ext==='.jpeg'?'.jpg':ext}`;
 const display=`${p.prefix}/display/${code}-${token}.webp`;
 mkdirSync(join(DIR,'.tmp'),{recursive:true});
 const tmp=join(DIR,'.tmp',`${code}-${token}.webp`);
 await sharp(buffer).resize({width:DISPLAY_WIDTH,withoutEnlargement:true}).webp({quality:90}).toFile(tmp);
 supabase(['storage','cp',local(p.path),`ss:///illustrations/${original}`,'--linked','--experimental','--content-type',TYPES[ext]]);
 supabase(['storage','cp',local(tmp),`ss:///illustrations/${display}`,'--linked','--experimental','--content-type','image/webp','--cache-control','max-age=31536000']);
 const artMeta={layout:defaultLayout({width:meta.width,height:meta.height,transparent}),offsetY:0,width:meta.width,height:meta.height,transparent,original};
 updates.push(`with before as (select to_jsonb(c) as s from public.characters c where c.id = ${sql(p.character.id)}),
 upd as (update public.characters set art_path = ${sql(`${base}/storage/v1/object/public/illustrations/${display}`)}, art_meta = ${sql(JSON.stringify(artMeta))}::jsonb
   where id = ${sql(p.character.id)} returning to_jsonb(characters) as s)
 insert into public.admin_audit_logs (actor_id, target_id, action, reason, before_state, after_state)
   select ${admin?sql(admin.id):'null'}, ${sql(p.character.id)}, 'character_update', 'Import d’illustration depuis le dossier local (${sql(p.name).slice(1,-1)})', before.s, upd.s from before, upd;`);
 rmSync(tmp,{force:true});
 renameSync(p.path,join(DONE,`${code} ${p.name}`));
 console.log(`↑ ${p.character.name} envoyé.`);
}
if(updates.length){query(`begin;\n${updates.join('\n')}\ncommit;`);console.log(`\n${updates.length} illustration(s) reliée(s). Fichiers rangés dans illustrations/importees/.`);}
