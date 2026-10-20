import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['organisateur']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

const iso=(rows:{s:Date}[])=>rows.map(r=>r.s.toISOString());
type Fx={finish?:number;deniers?:number;boosters?:number;interval?:number|null};
async function event(start:string,end:string,fx:Fx,name='Nuit rouge'){
  return rpc<string>(db,admin,'admin_save_event',[null,name,'',start,end,fx.finish??1,fx.deniers??1,fx.boosters??0,fx.interval??null,'Test']);
}
const clear=()=>db.query(`update public.events set cancelled_at=now() where cancelled_at is null`);

describe('administration des événements',()=>{
  it('exige un effet, une période valide et un motif ; réservé à l’admin',async()=>{
    await expectError(event('2026-10-25 12:00+01','2026-10-26 12:00+01',{}),/event_without_effect/);
    await expectError(event('2026-10-26 12:00+01','2026-10-25 12:00+01',{finish:2}),/invalid_period/);
    await expectError(rpc(db,admin,'admin_save_event',[null,'X','','2026-10-25','2026-10-26',2,1,0,null,' ']),/reason_required/);
    await expectError(event('2026-10-25 12:00+01','2026-10-26 12:00+01',{interval:5}),/check/);
    const u=await createUser(db);
    await expectError(rpc(db,u,'admin_save_event',[null,'X','','2026-10-25','2026-10-26',2,1,0,null,'x']),/forbidden/);
    const id=await event('2030-01-01','2030-01-02',{finish:3});
    expect((await rpc<any[]>(db,admin,'admin_events')).find(e=>e.id===id)).toMatchObject({finish_multiplier:3});
    await rpc(db,admin,'admin_cancel_event',[id,'Annulé']);
    expect((await rpc<any[]>(db,admin,'admin_events')).find(e=>e.id===id).cancelled_at).not.toBeNull();
  });
});

describe('effets',()=>{
  it('multiplie les finitions rares en gardant un total de 100 000',async()=>{
    const {rows:[r]}=await db.query<{f:any}>(`select private.event_finishes(finishes,3) f from public.pack_rulesets where version=1`);
    const w=Object.fromEntries(r.f.map((x:any)=>[x.value,Number(x.weight)]));
    expect(w).toEqual({Standard:100000-5400-600,'Dorée':5400,Sanglante:600});
  });
  it('trace l’événement sur les ouvertures concernées',async()=>{
    await clear();
    const id=await event(new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+3600e3).toISOString(),{finish:2});
    const u=await createUser(db);
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const {rows:[o]}=await db.query(`select event_id from public.pack_openings where owner_id=$1`,[u]);
    expect((o as any).event_id).toBe(id);
    await clear();
  });
  it('ajoute des créneaux gratuits toutes les N heures pendant l’événement seulement',async()=>{
    await clear();
    await event('2026-11-02 09:00+01','2026-11-02 21:00+01',{interval:3});
    const {rows}=await db.query<{s:Date}>(`select s from private.free_slots_between('2026-11-02 05:00+01','2026-11-03 07:00+01') s`);
    // 06 h et 18 h habituels, plus 09, 12, 15 h (18 h déjà compté) ; 21 h = fin exclue.
    expect(iso(rows)).toEqual(['2026-11-02T05:00:00.000Z','2026-11-02T08:00:00.000Z','2026-11-02T11:00:00.000Z',
      '2026-11-02T14:00:00.000Z','2026-11-02T17:00:00.000Z','2026-11-03T05:00:00.000Z']);
    await clear();
  });
  it('multiplie le bonus de connexion du jour',async()=>{
    await clear();
    const u=await createUser(db);
    const {rows:[s]}=await db.query<{v:string}>(`select (settings->>'daily_login_reward') v from public.economy_settings where active`);
    await event(new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+3600e3).toISOString(),{deniers:2});
    const {rows:[r]}=await db.query<{n:string}>(`select private.claim_daily_reward($1) n`,[u]);
    expect(Number(r.n)).toBe(2*Number(s.v));
    await clear();
  });
  it('offre des boosters une seule fois par joueur pendant l’événement',async()=>{
    await clear();
    const id=await event(new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+3600e3).toISOString(),{boosters:2},'Pluie de boosters');
    const u=await createUser(db);
    const list=await rpc<any[]>(db,u,'get_events');
    expect(list[0]).toMatchObject({id,active:true,bonus_boosters:2,claimed:false});
    expect(await rpc(db,u,'claim_event_bonus',[id])).toBe(2);
    await expectError(rpc(db,u,'claim_event_bonus',[id]),/already_claimed/);
    expect((await rpc<any[]>(db,u,'get_events'))[0].claimed).toBe(true);
    await rpc(db,admin,'admin_cancel_event',[id,'Fin anticipée']);
    const v=await createUser(db);
    await expectError(rpc(db,v,'claim_event_bonus',[id]),/event_unavailable/);
  });
});
