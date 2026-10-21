import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['statisticien']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

describe('statistiques admin',()=>{
  it('compte joueurs actifs, ouvertures et Deniers créés, sur une période bornée',async()=>{
    const u=await createUser(db);await rpc(db,u,'set_handle',['joueur_actif']);
    await rpc(db,u,'get_player_state'); // bonus de connexion du jour = joueur actif
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const s=await rpc(db,admin,'admin_stats',[30]);
    expect(s.days).toBe(30);
    expect(s.players).toMatchObject({total:2});
    expect(s.players.active_today).toBeGreaterThanOrEqual(1);
    expect(s.boosters).toMatchObject({opened_total:1,opened_period:1,free_period:1});
    expect(Object.values(s.boosters.rarities).reduce((a:number,b)=>a+(b as number),0)).toBe(5);
    expect(s.economy.created_period).toBeGreaterThan(0);
    expect(s.economy.sources.daily_login).toBeGreaterThan(0);
    expect(s.series).toHaveLength(30);
    expect(s.series.at(-1)).toMatchObject({openings:1});
    expect(s.recent_players.map((p:any)=>p.handle)).toContain('joueur_actif');
    expect((await rpc(db,admin,'admin_stats',[1000])).series).toHaveLength(90);
    expect((await rpc(db,admin,'admin_stats',[1])).series).toHaveLength(7);
  });
  it('est réservé à l’administrateur',async()=>{
    const u=await createUser(db);
    await expectError(rpc(db,u,'admin_stats',[30]),/forbidden/);
  });
});
