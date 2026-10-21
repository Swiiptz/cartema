#!/usr/bin/env node
// Import d'illustrations depuis un dossier local, sans passer par le back-office.
//
//   1. Déposer les images dans illustrations/ (ou illustrations/<PRÉFIXE>/ pour une autre édition
//      que CAM), nommées comme le personnage : « Violette.webp », « Isabeau de Marnay.png ».
//      Deux personnages du même nom : ajouter le numéro de la carte (« Lily 150.png », « CAM-151.png »).
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
// Un sous-dossier qui ne porte pas le préfixe d'une édition (brouillons, à trier…) est ignoré.
const prefixes=new Set(characters.map(c=>c.prefix));
for(const p of new Set(files.map(f=>f.prefix)))if(!prefixes.has(p))console.log(`· dossier « ${p} » ignoré : ce n’est pas le préfixe d’une édition (${[...prefixes].join(', ')}).`);
for(const f of files.filter(f=>prefixes.has(f.prefix))){
 const pool=characters.filter(c=>c.prefix===f.prefix);
 // Un numéro seul dans le nom (« Lily 150.png », « CAM-150.png ») désigne la carte : utile quand
 // deux personnages portent le même nom. Le nom éventuel doit alors correspondre à cette carte.
 const tokens=nameKey(f.name).split(' ').filter(Boolean);
 const number=tokens.find(t=>/^\d{1,4}$/.test(t));
 const key=tokens.filter(t=>t!==number&&t!==f.prefix.toLowerCase()).join(' ');
 const matches=c=>!key||nameKey(c.name)===key||nameKey(c.name.split(' ')[0])===key;
 let found;
 if(number){
  found=pool.filter(c=>c.number===Number(number));
  if(found.length&&!matches(found[0])){console.log(`✗ ${f.name} : la carte ${f.prefix}-${number.padStart(3,'0')} est ${found[0].name}, pas « ${key} »`);continue;}
 }else{
  found=pool.filter(c=>nameKey(c.name)===key);
  if(!found.length)found=pool.filter(c=>nameKey(c.name.split(' ')[0])===key);
 }
 if(found.length===1)plan.push({...f,character:found[0]});
 else console.log(`✗ ${f.name} : ${found.length?`ambigu — ajoutez le numéro de la carte au nom du fichier : ${found.map(c=>`« ${c.name} ${c.number}${extname(f.name)} »`).join(' ou ')}`:number?`aucune carte n° ${number} dans ${f.prefix}`:`aucun personnage « ${basename(f.name,extname(f.name))} » dans ${f.prefix}`}`);
}
for(const p of plan)console.log(`✓ ${p.name} → ${p.character.name} (${p.prefix}-${String(p.character.number).padStart(3,'0')})`);
if(DRY||!plan.length){console.log(DRY?'\nEssai : rien n’a été envoyé.':'\nRien à importer.');process.exit(0);}

const base=supabaseUrl();
const [admin]=query(`select id from public.profiles where role = 'admin' limit 1;`);
// Préparation locale (originaux et versions d'affichage aux chemins définitifs), puis un seul
// envoi parallèle par édition et une seule transaction pour relier les cartes : rapide, et rien
// n'est relié ni rangé si l'envoi échoue. Noms préparés sans espace (la CLI les coupe).
const STAGE=join(DIR,'.tmp','envoi');
rmSync(STAGE,{recursive:true,force:true});
const ready=[];
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
 mkdirSync(join(STAGE,p.prefix,'originals'),{recursive:true});
 mkdirSync(join(STAGE,p.prefix,'display'),{recursive:true});
 writeFileSync(join(STAGE,original),buffer);
 await sharp(buffer).resize({width:DISPLAY_WIDTH,withoutEnlargement:true}).webp({quality:90}).toFile(join(STAGE,display));
 const artMeta={layout:defaultLayout({width:meta.width,height:meta.height,transparent}),offsetY:0,width:meta.width,height:meta.height,transparent,original};
 ready.push({...p,code,sql:`with before as (select to_jsonb(c) as s from public.characters c where c.id = ${sql(p.character.id)}),
 upd as (update public.characters set art_path = ${sql(`${base}/storage/v1/object/public/illustrations/${display}`)}, art_meta = ${sql(JSON.stringify(artMeta))}::jsonb
   where id = ${sql(p.character.id)} returning to_jsonb(characters) as s)
 insert into public.admin_audit_logs (actor_id, target_id, action, reason, before_state, after_state)
   select ${admin?sql(admin.id):'null'}, ${sql(p.character.id)}, 'character_update', 'Import d’illustration depuis le dossier local (${sql(p.name).slice(1,-1)})', before.s, upd.s from before, upd;`});
 console.log(`· ${p.character.name} préparé.`);
}
if(!ready.length){rmSync(STAGE,{recursive:true,force:true});console.log('\nRien à envoyer.');process.exit(0);}
console.log(`\nEnvoi de ${ready.length*2} fichier(s)…`);
try{
 // Copie vers la racine du bucket : le dossier d'édition y arrive à son chemin exact
 // (vers « …/CAM », la CLI créerait « CAM/CAM » quand le dossier existe déjà).
 for(const prefix of new Set(ready.map(r=>r.prefix)))
  supabase(['storage','cp','-r',local(join(STAGE,prefix)),'ss:///illustrations','-j','8','--linked','--experimental','--cache-control','max-age=31536000']);
}catch(e){
 rmSync(STAGE,{recursive:true,force:true});
 console.error(`\nL’envoi a échoué : aucune carte n’a été modifiée, les images restent dans illustrations/.\n${`${e.stdout??''}${e.stderr??''}`.split('\n').filter(l=>/error|erreur|unexpected/i.test(l)).join('\n')||e.message}`);
 process.exit(1);
}
query(`begin;\n${ready.map(r=>r.sql).join('\n')}\ncommit;`);
mkdirSync(DONE,{recursive:true});
for(const r of ready)renameSync(r.path,join(DONE,`${r.code} ${r.name}`));
rmSync(STAGE,{recursive:true,force:true});
console.log(`${ready.length} illustration(s) envoyée(s) et reliée(s). Fichiers rangés dans illustrations/importees/.`);
