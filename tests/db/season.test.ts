import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Classement de saison (25/10) : une saison dure le temps d'un set, démarrée et close par l'admin. Points :
// +1 par visage découvert, +10 par succès (+5 par palier au-delà du premier), +2 par mission quotidienne et
// +5 par mission hebdomadaire réclamées pendant la saison. Podium : titre « Champion de la saison », barème par place.
let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['maitre_saisons']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
const discover=(u:string,n:number,at='now()')=>db.query(`insert into public.discoveries (owner_id,character_id,first_seen_at) select $1,id,${at} from public.characters where edition_id=$2 order by number limit $3 on conflict do nothing`,[u,edition,n]);
const mission=(u:string,kind:'daily'|'weekly')=>db.query(`insert into public.mission_assignments (owner_id,template_code,kind,period_start,period_end,claimed_at)
  select $1,code,kind,now()-interval '1 hour',now()+interval '1 day',now() from public.mission_templates where kind=$2 and not fixed order by code limit 1`,[u,kind]);

describe('classement de saison',()=>{
  it('reste éteint sans saison démarrée',async()=>{
    const u=await player('avant_saison');
    expect(await rpc(db,u,'get_season_leaderboard',[50])).toBeNull();
    await expectError(rpc(db,u,'admin_start_season',['Saison pirate',null,'x']),/forbidden/);
  });

  it('compte les points de la saison seulement, puis récompense le podium une fois',async()=>{
    const a=await player('champion_set'),b=await player('second_set');
    await discover(a,2,"now()-interval '10 days'"); // avant la saison : ne compte pas
    const id=await rpc<string>(db,admin,'admin_start_season',['Set 2 · Anarchs',null,'Lancement du set 2']);
    await expectError(rpc(db,admin,'admin_start_season',['Doublon',null,'x']),/season_open/);
    await discover(a,5);                        // 5 visages dont 2 déjà vus avant : 3 comptent
    await db.query(`insert into public.achievement_unlocks (owner_id,code) values ($1,'faces_10'),($1,'faces_50')`,[a]); // 10 + 15
    await mission(a,'daily');await mission(a,'weekly');  // 2 + 5
    await discover(b,3);await mission(b,'daily');         // 3 + 2
    const board=await rpc(db,a,'get_season_leaderboard',[50]);
    expect(board.season).toMatchObject({id,name:'Set 2 · Anarchs',open:true});
    const pts=Object.fromEntries(board.top.map((r:any)=>[r.handle,r.points]));
    expect(pts).toMatchObject({champion_set:35,second_set:5});
    expect(board.me).toMatchObject({position:1,points:35});
    await expectError(rpc(db,admin,'admin_reward_season',[id,'Trop tôt']),/season_open/);
    await rpc(db,admin,'admin_end_season',[id,'Fin du set']);
    const before=Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[a])).rows[0].b);
    await rpc(db,admin,'admin_reward_season',[id,'Podium']);
    const after=Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[a])).rows[0].b);
    expect(after-before).toBe(5000);
    expect(await rpc(db,a,'set_title',[`season:${id}`])).toBe('Champion de la saison');
    await expectError(rpc(db,admin,'admin_reward_season',[id,'Encore']),/already_granted/);
    // Saison close : toujours consultable, marquée close.
    expect((await rpc(db,b,'get_season_leaderboard',[50])).season).toMatchObject({open:false,rewarded:true});
  });
});
