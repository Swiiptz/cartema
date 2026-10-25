import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Concours (25/10) : fin des envois distincte de la fin des votes (prolongation « votes seulement »),
// et titre « Illustrateur de talent » pour quiconque a soumis au moins un dessin.
let db:Db;let cam:string;let admin:string;let contest:string;
const card=async(rarity:string)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 limit 1`,[cam,rarity])).rows[0].id;
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
const submit=(u:string,c:string)=>rpc<string>(db,u,'submit_contest_entry',[c,`${u}/${randomUUID()}.webp`]);
const iso=(h:number)=>new Date(Date.now()+h*3600e3).toISOString();
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['jury_prolongation']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  contest=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours prolongé',cam,iso(-48),iso(24),null,'Création']);
},30000);

describe('concours : votes prolongés et titre de talent',()=>{
  it('ferme les envois mais laisse voter jusqu’à la fin',async()=>{
    const a=await player('dessinatrice_talent');const v=await player('votant_tardif');
    const e=await submit(a,await card('Rare'));
    expect(await rpc(db,a,'set_title',['contest_talent'])).toBe('Illustrateur de talent');
    await expectError(rpc(db,v,'set_title',['contest_talent']),/./);
    const c0=await rpc(db,a,'get_contest');
    await expectError(rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Avant le début',null,null,null,null,iso(-72)]),/invalid_dates/);
    await rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Votes seulement',null,null,null,null,iso(-1)]);
    const c=await rpc(db,v,'get_contest');
    expect(c).toMatchObject({open:true,submissions_open:false});
    await expectError(submit(v,await card('Rare')),/submissions_closed/);
    expect(await rpc(db,v,'vote_contest_entry',[e,true])).toBe(true);
    // Sans date passée, la fin des envois est gardée ; une date à la fin (ou après) l'efface.
    await rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Règles',null]);
    expect((await rpc(db,v,'get_contest')).submissions_open).toBe(false);
    await rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Envois rouverts',null,null,null,null,c0.ends_at]);
    expect((await rpc(db,v,'get_contest')).submissions_open).toBe(true);
  });
});
