import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,seedEdition,type Db} from './harness';

// Succès d'édition créés à la publication (16/11) : titres propres à l'Appel des Neiges Éternelles pour
// chaque rareté, et « Maître de l’… » élidé devant une voyelle. Les autres éditions gardent le titre d'avant.
let db:Db;
beforeAll(async()=>{
  db=await createDb();
  const ane=await seedEdition(db,{prefix:'ANE',perRarity:1});
  await db.query(`update public.editions set name='Appel des Neiges Éternelles' where id=$1`,[ane]);
  await seedEdition(db,{prefix:'CAM',perRarity:1});
},30000);

const row=async(code:string)=>(await db.query<{label:string;title:string|null}>('select label,title from public.achievements where code=$1',[code])).rows[0];

describe('succès d’édition générés',()=>{
  it('titres variés par rareté pour ANE, élision du « Maître de l’… »',async()=>{
    const u=await createUser(db);await rpc(db,u,'set_handle',['alpiniste']);
    await rpc(db,u,'get_achievements');
    expect(await row('set:ANE:rarity:Commun')).toMatchObject({label:'Toutes les Communes',title:'Flocon parmi les flocons'});
    expect((await row('set:ANE:rarity:Mythique')).title).toBe('Gardien des neiges éternelles');
    expect(await row('set:ANE:all')).toMatchObject({label:'Maître de l’Appel des Neiges Éternelles',title:'Maître de l’Appel des Neiges Éternelles'});
    expect(await row('set:CAM:rarity:Commun')).toMatchObject({title:null});
    expect((await row('set:CAM:rarity:Mythique')).title).toBe('Gardien des mythes');
    expect((await row('set:CAM:all')).label).toBe('Maître de l’Édition CAM');
  });
});
