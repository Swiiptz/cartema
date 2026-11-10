import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,seedEdition,type Db} from './harness';

// Succès qui offrent une carte (10/11) et succès secrets du set 2 avant sa sortie.
let db:Db;let cam:string;let hidden:string;
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});
  const {rows:[e]}=await db.query<{id:string}>(`insert into public.editions (name,prefix,album_published,packs_enabled,teaser) values ('Set caché','ANE',false,false,true) returning id`);
  hidden=e.id;
  await db.query(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,1,'Secret ANE 1','Très rare','draft')`,[hidden]);
},30000);
const ids=async(sql:string,params:unknown[]=[])=>(await db.query<{id:string}>(sql,params)).rows.map(r=>r.id);

describe('récompense en carte',()=>{
  it('offre une Sanglante d’un des personnages requis, une seule fois',async()=>{
    const [a,b]=await ids(`select id from public.characters where edition_id=$1 and number in (1,2) order by number`,[cam]);
    await db.query(`insert into public.achievements (code,label,description,category,metric,target,secret,required_characters,required_finishes,reward_card,sort)
      values ('custom:test-lettres','Relation','Deux cartes dorées.','custom','characters',2,true,$1,$2,'blood_random_required',500)`,
      [[a,b],JSON.stringify({[a]:'Dorée',[b]:'Dorée'})]);
    const u=await createUser(db,{createdAt:'2026-01-01T00:00:00Z',handle:true});
    for(const c of [a,b])await db.query(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Dorée')`,[u,c]);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2),($1,$3)`,[u,a,b]);
    await rpc(db,u,'sync_my_achievements');
    await rpc(db,u,'sync_my_achievements');
    const {rows}=await db.query<{character_id:string}>(`select character_id from public.inventory_items where owner_id=$1 and finish='Sanglante'`,[u]);
    expect(rows.length).toBe(1);
    expect([a,b]).toContain(rows[0].character_id);
    expect((await db.query(`select 1 from public.finish_discoveries where owner_id=$1 and finish='Sanglante'`,[u])).rows.length).toBe(1);
  });
});

describe('succès secret qui cite une carte du set caché',()=>{
  it('apparaît en succès secret sans rien dévoiler',async()=>{
    const [c]=await ids(`select id from public.characters where edition_id=$1 and number=1`,[cam]);
    const [h]=await ids(`select id from public.characters where edition_id=$1`,[hidden]);
    await db.query(`insert into public.achievements (code,label,description,category,metric,target,secret,required_characters,title,sort)
      values ('custom:test-teasing','Secret ANE ennemis','Rassembler Secret ANE 1.','custom','characters',2,true,$1,'Secret ANE titre',501)`,[[c,h]]);
    const u=await createUser(db,{createdAt:'2026-01-01T00:00:00Z',handle:true});
    await db.query(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard')`,[u,c]);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c]);
    for(const fn of ['get_achievements','sync_my_achievements','get_player_state'])
      expect(JSON.stringify(await rpc(db,u,fn)),fn).not.toMatch(/Secret ANE/);
  });
});
