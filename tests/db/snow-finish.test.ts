import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,type Db} from './harness';

// Finition Neige (16/11) : seulement dans les boosters d'une édition « Neige » (ANE) et dans les God boosters,
// avec la chance de la Sanglante ; rien tant qu'aucune édition Neige n'a son album publié. Recyclage au prix
// d'une Sanglante, jamais dans les doublons. Succès : cartes d'une finition (édition, rareté) et une de chaque rareté.
let db:Db;let cam:string;let ane:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();
  cam=await seedEdition(db,{prefix:'CAM',perRarity:2});ane=await seedEdition(db,{prefix:'ANE',perRarity:2});
  await db.query(`update public.editions set snow_finish=true where id=$1`,[ane]);
  admin=await createUser(db);await rpc(db,admin,'set_handle',['flocon_admin']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God']);
  // Moitié Standard, moitié Sanglante : une Standard d'ANE devient Neige une fois sur deux.
  const {ruleset:r}=await rpc(db,admin,'admin_economy');
  await rpc(db,admin,'admin_save_ruleset',[r.slots,[{value:'Standard',weight:49999},{value:'Dorée',weight:1},{value:'Sanglante',weight:50000}],r.unique_odds,'Test Neige','Test']);
},30000);

async function player(handle:string){const id=await createUser(db);await rpc(db,id,'set_handle',[handle]);
  await db.query('update public.booster_balances set free_count=0,purchased_count=60 where owner_id=$1',[id]);return id;}
async function finishes(u:string,edition:string,n:number){const out:string[]=[];
  for(let i=0;i<n;i++)out.push(...(await rpc(db,u,'open_booster',[edition,randomUUID()])).cards.map((c:any)=>c.finish));return out;}

describe('finition Neige',()=>{
  it('tombe dans les boosters ANE seulement, et pas avant la publication de l’album',async()=>{
    const u=await player('skieur');
    await db.query(`update public.editions set album_published=false where id=$1`,[ane]);
    expect(await finishes(u,cam,8)).not.toContain('Neige');
    await db.query(`update public.editions set album_published=true where id=$1`,[ane]);
    expect(await finishes(u,cam,8)).not.toContain('Neige');
    const got=await finishes(u,ane,8);
    expect(got).toContain('Neige');
    expect(got).toContain('Sanglante');
  });

  it('peut tomber dans un God booster de n’importe quelle édition',async()=>{
    const u=await player('dieu_des_neiges');
    await rpc(db,admin,'admin_save_god_settings',[1,50,20,2,'Toujours God']);
    const got=await finishes(u,cam,6);
    expect(got).toContain('Neige');
    expect(got.every(f=>['Dorée','Sanglante','Neige'].includes(f))).toBe(true);
    // Sans édition Neige publiée : jamais de Neige, même dans un God booster.
    await db.query(`update public.editions set album_published=false where id=$1`,[ane]);
    expect(await finishes(u,cam,6)).not.toContain('Neige');
    await db.query(`update public.editions set album_published=true where id=$1`,[ane]);
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God']);
  });

  it('se recycle au prix d’une Sanglante et reste hors des doublons',async()=>{
    const u=await player('recycleur_neige');
    const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity='Rare' limit 1`,[ane]);
    const ins=async(f:string)=>(await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,$3) returning id`,[u,c.id,f])).rows[0].id;
    await ins('Standard');const snow=await ins('Neige');await ins('Neige');
    const {rows:[v]}=await db.query<{snow:string;blood:string}>(`select private.recycle_value('Rare','Neige',s.settings) snow, private.recycle_value('Rare','Sanglante',s.settings) blood from public.economy_settings s where s.active`);
    expect(v.snow).toBe(v.blood);
    expect((await rpc(db,u,'preview_duplicates',[1,null])).count).toBe(0);
    const r=await rpc(db,u,'recycle_cards',[[snow],randomUUID(),true]);
    expect(String(r.total)).toBe(String(v.blood));
  });

  it('succès : N cartes d’une finition (filtrées par édition et rareté), et une de chaque rareté',async()=>{
    const u=await player('collection_neige');
    await db.query(`insert into public.achievements (code,label,description,category,metric,target,finish,edition_id,rarity,sort) values
      ('test:snow2','Tempête','Deux cartes en Neige.','general','finish_cards',2,'Neige',null,null,900),
      ('test:heart','Cœur de glace','Une Légendaire d’ANE en Sanglante.','general','finish_cards',1,'Sanglante',$1,'Légendaire',901),
      ('test:aval','Avalanche','Une carte de chaque rareté en Neige.','general','finish_rarities',7,'Neige',null,null,902)`,[ane]);
    const give=async(edition:string,rarity:string,f:string,k=0)=>db.query(`insert into public.inventory_items (owner_id,character_id,finish)
      select $1,id,$4 from public.characters where edition_id=$2 and rarity=$3 order by number offset $5 limit 1`,[u,edition,rarity,f,k]);
    const state=async(code:string)=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===code);
    await give(cam,'Légendaire','Sanglante');
    await give(ane,'Commun','Neige');await give(ane,'Commun','Neige'); // même personnage : compte une fois
    expect(await state('test:snow2')).toMatchObject({progress:1,target:2,unlocked_at:null});
    expect((await state('test:heart')).unlocked_at).toBeNull();
    await give(ane,'Commun','Neige',1);
    await give(ane,'Légendaire','Sanglante');
    expect((await state('test:snow2')).unlocked_at).not.toBeNull();
    expect((await state('test:heart')).unlocked_at).not.toBeNull();
    for(const r of ['Peu commun','Rare','Très rare','Épique','Légendaire'])await give(ane,r,'Neige');
    expect(await state('test:aval')).toMatchObject({progress:6,target:7,unlocked_at:null});
    await give(cam,'Mythique','Neige');
    expect((await state('test:aval')).unlocked_at).not.toBeNull();
  });
});
