import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,expectError,type Db} from './harness';

// Série de connexions (23/10) : jours de connexion d'affilée (heure de Paris), booster tous les N jours,
// succès à paliers sur la meilleure série.
let db:Db;let admin:string;
beforeAll(async()=>{
  db=await createDb();
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien_series']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);
  await db.query('update public.booster_balances set free_count=0,purchased_count=0 where owner_id=$1',[id]);return id;}
const touch=async(u:string,at:string)=>(await db.query<{r:any}>('select private.touch_login_streak($1,$2::timestamptz) r',[u,at])).rows[0].r;
const day=(d:number)=>`2026-11-${String(d).padStart(2,'0')}T20:00:00+01:00`;
const bonus=async(u:string)=>(await db.query<{n:number}>('select purchased_count n from public.booster_balances where owner_id=$1',[u])).rows[0].n;

describe('série de connexions',()=>{
  it('compte les jours d’affilée, offre un booster tous les 7 jours et repart à 1 après un trou',async()=>{
    const u=await player('assidu_serie');
    for(let d=1;d<=6;d++)expect(await touch(u,day(d))).toMatchObject({streak:d,boosters:0});
    expect(await touch(u,day(6))).toBeNull(); // déjà compté aujourd'hui
    expect(await touch(u,day(7))).toMatchObject({streak:7,best:7,boosters:1});
    expect(await bonus(u)).toBe(1);
    // Un jour sauté : la série repart à 1, la meilleure reste.
    expect(await touch(u,day(9))).toMatchObject({streak:1,best:7,boosters:0});
    const {rows:[p]}=await db.query('select login_streak,login_streak_best from public.profiles where id=$1',[u]);
    expect(p).toEqual({login_streak:1,login_streak_best:7});
    // Succès « Habitué » : meilleure série de 7 jours.
    const a=(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code==='streak_7');
    expect(a).toMatchObject({series:'streak',tier:1});
    expect(a.unlocked_at).not.toBeNull();
  });

  it('est visible dans l’état du joueur, avec le prochain booster',async()=>{
    const u=await player('regard_serie');
    const s=await rpc(db,u,'get_player_state');
    expect(s.streak).toMatchObject({current:1,best:1,every:7,next_bonus_in:6});
    expect(s.streak_reward).toBe(0);
  });

  it('se règle dans l’économie : booster coupé à 0, valeurs contrôlées',async()=>{
    await rpc(db,admin,'admin_save_settings',[{streak_booster_every:0},'Sans booster de série']);
    const u=await player('sans_bonus_serie');
    for(let d=1;d<=7;d++)await touch(u,day(d));
    expect(await bonus(u)).toBe(0);
    expect((await db.query('select login_streak from public.profiles where id=$1',[u])).rows[0]).toEqual({login_streak:7});
    await expectError(rpc(db,admin,'admin_save_settings',[{streak_booster_every:100},'Trop']),/invalid_setting/);
    await rpc(db,admin,'admin_save_settings',[{streak_booster_every:7,streak_booster_count:2},'Deux boosters']);
    const v=await player('double_serie');
    for(let d=1;d<=7;d++)await touch(v,day(d));
    expect(await bonus(v)).toBe(2);
  });
});
