import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,createUser,type Db} from './harness';

let db:Db;
beforeAll(async()=>{db=await createDb();},30000);

const iso=(rows:{s:Date}[])=>rows.map(r=>r.s.toISOString());
async function setSynced(user:string,at:string,free=0){
  await db.query('update public.booster_balances set free_synced_until=$2, free_count=$3 where owner_id=$1',[user,at,free]);
}
async function sync(user:string,at:string){
  const {rows:[r]}=await db.query<{free_count:number;free_synced_until:Date}>(
    'select * from private.sync_free_boosters($1,$2)',[user,at]);
  return r;
}

describe('créneaux Europe/Paris',()=>{
  it('place 06 h et 18 h correctement autour du passage à l’heure d’hiver',async()=>{
    const {rows}=await db.query<{s:Date}>(
      `select s from private.free_slots_between('2026-10-24 12:00+02','2026-10-26 07:00+01') s`);
    expect(iso(rows)).toEqual([
      '2026-10-24T16:00:00.000Z','2026-10-25T05:00:00.000Z','2026-10-25T17:00:00.000Z','2026-10-26T05:00:00.000Z']);
  });
  it('place 06 h et 18 h correctement autour du passage à l’heure d’été',async()=>{
    const {rows}=await db.query<{s:Date}>(
      `select s from private.free_slots_between('2026-03-28 19:00+01','2026-03-29 18:00+02') s`);
    expect(iso(rows)).toEqual(['2026-03-29T04:00:00.000Z','2026-03-29T16:00:00.000Z']);
  });
  it('exclut le début et inclut la fin de l’intervalle',async()=>{
    const {rows}=await db.query<{s:Date}>(
      `select s from private.free_slots_between('2026-10-20 06:00+02','2026-10-20 18:00+02') s`);
    expect(iso(rows)).toEqual(['2026-10-20T16:00:00.000Z']);
  });
});

describe('crédit des boosters gratuits',()=>{
  it('crédite une seule fois par créneau, même appelé plusieurs fois',async()=>{
    const u=await createUser(db);
    await setSynced(u,'2026-10-24 12:00+02');
    expect((await sync(u,'2026-10-24 18:00+02')).free_count).toBe(1);
    expect((await sync(u,'2026-10-24 18:00+02')).free_count).toBe(1);
    expect((await sync(u,'2026-10-24 23:00+02')).free_count).toBe(1);
    expect((await sync(u,'2026-10-25 06:00+01')).free_count).toBe(2);
    const {rows}=await db.query(`select count(*)::int n from public.booster_grants where owner_id=$1 and source='free_slot'`,[u]);
    expect(rows[0]).toEqual({n:2});
  });
  it('ne crédite pas deux fois lors du changement d’heure',async()=>{
    const u=await createUser(db);
    await setSynced(u,'2026-10-25 01:00+02');
    // 02:00–03:00 se répète cette nuit-là : aucun créneau supplémentaire.
    expect((await sync(u,'2026-10-25 05:59+01')).free_count).toBe(0);
    expect((await sync(u,'2026-10-25 06:00+01')).free_count).toBe(1);
  });
  it('rattrape un compte inactif sans dépasser la capacité de 6',async()=>{
    const u=await createUser(db);
    await setSynced(u,'2026-10-01 07:00+02');
    const r=await sync(u,'2026-10-20 07:00+02');
    expect(r.free_count).toBe(6);
    expect(r.free_synced_until.toISOString()).toBe('2026-10-20T04:00:00.000Z');
    const {rows}=await db.query(`select count(*)::int n from public.booster_grants where owner_id=$1 and source='free_slot'`,[u]);
    expect(rows[0]).toEqual({n:6});
  });
  it('perd les gains quand la réserve est pleine, sans report',async()=>{
    const u=await createUser(db);
    await setSynced(u,'2026-10-20 07:00+02',6);
    expect((await sync(u,'2026-10-21 19:00+02')).free_count).toBe(6);
    await db.query('update public.booster_balances set free_count=5 where owner_id=$1',[u]);
    // Les créneaux déjà passés ne sont pas recrédités.
    expect((await sync(u,'2026-10-21 19:00+02')).free_count).toBe(5);
    expect((await sync(u,'2026-10-22 06:00+02')).free_count).toBe(6);
  });
  it('ne crédite rien rétroactivement à un nouveau compte',async()=>{
    const u=await createUser(db);
    const {rows:[b]}=await db.query<{free_count:number}>('select free_count from public.booster_balances where owner_id=$1',[u]);
    expect(b.free_count).toBe(0);
    expect((await db.query('select * from private.sync_free_boosters($1)',[u])).rows[0]).toMatchObject({free_count:0});
  });
});
