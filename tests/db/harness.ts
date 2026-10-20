import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

const root=join(__dirname,'..','..');
const migrationsDir=join(root,'supabase','migrations');
export const RARITIES=['Commun','Peu commun','Rare','Très rare','Épique','Légendaire','Mythique'] as const;

/** Base neuve : stub Supabase puis toutes les migrations, dans l'ordre. */
export async function createDb(){
  const db=await PGlite.create({extensions:{pgcrypto}});
  await db.exec(readFileSync(join(__dirname,'supabase-stub.sql'),'utf8'));
  for(const file of readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort()){
    try{await db.exec(readFileSync(join(migrationsDir,file),'utf8'));}
    catch(e){throw new Error(`${file} : ${(e as Error).message}`);}
  }
  return db;
}
export type Db=Awaited<ReturnType<typeof createDb>>;

/** Exécute une requête avec le rôle et le JWT d'un joueur (comme PostgREST). */
export async function asUser<T=any>(db:Db,userId:string|null,sql:string,params:unknown[]=[]){
  const claims=userId?JSON.stringify({sub:userId,role:'authenticated'}):'';
  await db.query(`select set_config('request.jwt.claims',$1,false)`,[claims]);
  await db.exec(`set role ${userId?'authenticated':'anon'}`);
  try{return (await db.query<T>(sql,params)).rows;}
  finally{await db.exec('reset role');await db.query(`select set_config('request.jwt.claims','',false)`);}
}

export async function rpc<T=any>(db:Db,userId:string|null,fn:string,args:unknown[]=[]):Promise<T>{
  const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
  const rows=await asUser<{r:T}>(db,userId,`select public.${fn}(${placeholders}) as r`,args);
  return rows[0].r;
}

export async function createUser(db:Db,{createdAt}:{createdAt?:string}={}){
  const id=randomUUID();
  await db.query('insert into auth.users (id,email) values ($1,$2)',[id,`${id}@test.local`]);
  if(createdAt) await db.query('update public.profiles set created_at=$2 where id=$1',[id,createdAt]);
  return id;
}

export async function credit(db:Db,userId:string,amount:number){
  await db.query(`select private.apply_wallet_delta($1,$2,'test_credit',null,null,$3)`,[userId,amount,randomUUID()]);
}

/** Édition publiée avec `perRarity` personnages publiés par rareté (catalogue fictif de test). */
export async function seedEdition(db:Db,{prefix='TST',perRarity=1,skip=[] as string[],enable=true}={}){
  const {rows:[ed]}=await db.query<{id:string}>(
    `insert into public.editions (name,prefix,album_published) values ($1,$2,true) returning id`,[`Édition ${prefix}`,prefix]);
  let n=0;
  for(const rarity of RARITIES){
    if(skip.includes(rarity)) continue;
    for(let k=0;k<perRarity;k++){
      n++;
      await db.query(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,$2,$3,$4,'published')`,
        [ed.id,n,`Perso ${prefix} ${n}`,rarity]);
    }
  }
  if(enable) await db.query('update public.editions set packs_enabled=true where id=$1',[ed.id]);
  return ed.id;
}

export async function expectError(p:Promise<unknown>,pattern:RegExp){
  try{await p;}catch(e){
    const msg=(e as Error).message;
    if(!pattern.test(msg)) throw new Error(`Erreur inattendue : ${msg}`);
    return;
  }
  throw new Error(`Erreur attendue (${pattern}) mais succès`);
}
