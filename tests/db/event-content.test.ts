import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['meneur']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}
const iso=(ms:number)=>new Date(Date.now()+ms).toISOString();
async function event(start:number,end:number,name='Nuit de chasse'){
  return rpc<string>(db,admin,'admin_save_event',[null,name,'',iso(start),iso(end),2,1,0,null,'Test']);
}
const save=(id:string,o:{missions?:unknown[];cards?:string[];community?:unknown;leaderboard?:unknown})=>
  rpc(db,admin,'admin_save_event_content',[id,o.missions??[],o.cards??[],o.community??{},o.leaderboard??{},'Contenu']);
const open=async(u:string,n:number)=>{await db.query('update public.booster_balances set free_count=$2 where owner_id=$1',[u,n]);for(let i=0;i<n;i++)await rpc(db,u,'open_booster',[edition,randomUUID()]);};
const endNow=(id:string)=>db.query(`update public.events set ends_at=now(), starts_at=least(starts_at, now()) where id=$1`,[id]);

describe('missions d’événement',()=>{
  it('se mesurent sur la période et se réclament une fois, avec boosters',async()=>{
    const id=await event(-3600e3,3600e3);
    await save(id,{missions:[{label:'Ouvrir 2 boosters',metric:'open_boosters',target:2,reward_deniers:100,reward_boosters:1}]});
    const u=await player('chasseur');
    let e=await rpc(db,u,'get_event',[id]);
    expect(e.missions[0]).toMatchObject({label:'Ouvrir 2 boosters',progress:0,claimed:false});
    await expectError(rpc(db,u,'claim_event_mission',[e.missions[0].id]),/mission_incomplete/);
    await open(u,2);
    e=await rpc(db,u,'get_event',[id]);
    expect(e.missions[0].progress).toBe(2);
    expect(await rpc(db,u,'claim_event_mission',[e.missions[0].id])).toEqual({reward_deniers:100,reward_boosters:1});
    await expectError(rpc(db,u,'claim_event_mission',[e.missions[0].id]),/already_claimed/);
    await expectError(save(id,{missions:[{label:'x',metric:'pirater',target:1}]}),/invalid_setting/);
  });
});

describe('cartes d’événement',()=>{
  it('sont voilées avant le début puis publiées automatiquement',async()=>{
    const {rows:[c]}=await db.query<{id:string}>(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,500,'Invitée de la nuit','Rare','draft') returning id`,[edition]);
    const id=await event(3600e3,7200e3,'Bal masqué');
    await save(id,{cards:[c.id]});
    const u=await player('curieuse');
    const veiled=(await rpc(db,u,'get_event',[id])).cards;
    expect(veiled).toHaveLength(1);expect(veiled[0]).toMatchObject({rarity:'Rare',known:false,code:'???'});expect(veiled[0].name).toBeUndefined();
    await db.query(`update public.events set starts_at=now()-interval '1 minute' where id=$1`,[id]);
    expect(await db.query(`select private.run_events() n`).then(r=>(r.rows[0] as any).n)).toBeGreaterThanOrEqual(1);
    expect((await db.query<{status:string}>(`select status from public.characters where id=$1`,[c.id])).rows[0].status).toBe('published');
    expect((await rpc(db,u,'get_event',[id])).cards[0]).toMatchObject({code:'CAM-500',known:false});
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c.id]);
    expect((await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===500)).toMatchObject({event:'Bal masqué'});
    // Une fois l'événement commencé, on ne peut plus ajouter de carte.
    const {rows:[d]}=await db.query<{id:string}>(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,501,'Retardataire','Rare','draft') returning id`,[edition]);
    await expectError(save(id,{cards:[c.id,d.id]}),/event_started/);
  });
});

describe('défi communautaire et classement',()=>{
  it('récompense participants et podium à la clôture, une seule fois',async()=>{
    const id=await event(-3600e3,3600e3,'Grande chasse');
    await save(id,{community:{metric:'open_boosters',target:4,reward_deniers:50,reward_boosters:1},
      leaderboard:{metric:'open_boosters',rewards:[{deniers:300,boosters:2},{deniers:150},{deniers:50}]}});
    // Période qui commence maintenant : les ouvertures des autres tests ne comptent pas.
    await db.query(`update public.events set starts_at=now() where id=$1`,[id]);
    const a=await player('premier_e');const b=await player('second_e');const c=await player('absent_e');
    await open(a,3);await open(b,1);
    const e=await rpc(db,a,'get_event',[id]);
    expect(e.community).toMatchObject({total:4,target:4,mine:3});
    expect(e.leaderboard.top.map((r:any)=>[r.handle,r.position])).toEqual([['premier_e',1],['second_e',2]]);
    await endNow(id);
    await db.query('select private.run_events()');
    await db.query('select private.run_events()'); // une seule fois
    const rewards=async(u:string)=>(await db.query(`select kind, rank, deniers, boosters from public.event_rewards where owner_id=$1 and event_id=$2 order by kind`,[u,id])).rows;
    expect(await rewards(a)).toEqual([{kind:'community',rank:null,deniers:'50',boosters:1},{kind:'podium',rank:1,deniers:'300',boosters:2}].map(r=>({...r,deniers:Number(r.deniers)})).map(r=>expect.objectContaining({kind:r.kind,rank:r.rank,boosters:r.boosters})));
    expect((await rewards(b)).map((r:any)=>r.kind)).toEqual(['community','podium']);
    expect(await rewards(c)).toEqual([]);
    expect((await rpc(db,a,'get_notifications')).items.filter((n:any)=>n.kind==='event_reward')).toHaveLength(2);
    expect((await rpc(db,a,'get_event',[id]))).toMatchObject({ended:true,settled:true});
  });
  it('ne récompense pas si l’objectif collectif n’est pas atteint',async()=>{
    const id=await event(-3600e3,3600e3,'Défi raté');
    await save(id,{community:{metric:'open_boosters',target:999,reward_deniers:50}});
    const u=await player('seul_e');await open(u,1);
    await endNow(id);await db.query('select private.run_events()');
    expect((await db.query(`select count(*)::int n from public.event_rewards where event_id=$1`,[id])).rows[0]).toEqual({n:0});
  });
});
