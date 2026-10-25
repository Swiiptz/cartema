import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Textes d'ambiance (25/10) : proposés par un joueur depuis la fiche d'une carte découverte, validés par l'admin,
// puis affichés dans la fiche avec le pseudo de l'auteur.
let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien_textes']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  await rpc(db,admin,'admin_save_settings',[{next_set_features:1},'Nouveautés du set allumées (test)']);
},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
const charId=async(n:number)=>(await db.query<{id:string}>('select id from public.characters where edition_id=$1 and number=$2',[edition,n])).rows[0].id;
const see=(u:string,c:string)=>db.query('insert into public.discoveries (owner_id,character_id) values ($1,$2) on conflict do nothing',[u,c]);

describe('textes d’ambiance',()=>{
  it('se proposent sur une carte découverte, de 10 à 200 caractères, et s’affichent une fois validés',async()=>{
    const u=await player('plume_nocturne');const v=await player('lecteur_nocturne');
    const c=await charId(1);
    const text='Elle sourit toujours avant de mordre, jamais après.';
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','ambiance',text]),/not_discovered/);
    await see(u,c);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','ambiance','Bref.']),/message_required|invalid/);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','ambiance','x'.repeat(201)]),/too_long|invalid/);
    const id=await rpc<string>(db,u,'submit_card_feedback',['CAM-001','ambiance',text]);
    expect((await rpc<any[]>(db,admin,'admin_submissions',['pending'])).find(s=>s.id===id)).toMatchObject({kind:'ambiance',message:text});
    // Pas encore visible.
    await see(v,c);
    expect(await rpc(db,v,'get_card_flavor',[c])).toBeNull();
    await rpc(db,admin,'admin_decide_submission',[id,true,50,0,'Très beau']);
    expect(await rpc(db,v,'get_card_flavor',[c])).toEqual({text,author:'plume_nocturne'});
    // Jamais pour une carte non découverte.
    const w=await player('inconnu_nocturne');
    await expectError(rpc(db,w,'get_card_flavor',[c]),/not_discovered/);
  });
});
