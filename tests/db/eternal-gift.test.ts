import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,type Db} from './harness';

// Carte éternelle offerte par l'admin : une fenêtre « Recevoir la carte » attend le joueur (26/10).
let db:Db;let admin:string;let eternal:string;let normal:string;
beforeAll(async()=>{
  db=await createDb();
  normal=await seedEdition(db,{prefix:'CAM',perRarity:1});
  eternal=await seedEdition(db,{prefix:'ETER',perRarity:1,enable:false});
  await db.query('update public.editions set eternal=true where id=$1',[eternal]);
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
const char=async(edition:string,n:number)=>(await db.query<{id:string}>('select id from public.characters where edition_id=$1 and number=$2',[edition,n])).rows[0].id;

describe('carte éternelle offerte',()=>{
  it('ouvre une fenêtre « Recevoir » avec la carte, une seule fois',async()=>{
    const u=await createUser(db,{handle:true});
    await rpc(db,admin,'admin_grant_card',[u,await char(eternal,7),'Dorée',1,'Cadeau',randomUUID()]);
    const n=await rpc(db,u,'get_player_notice');
    expect(n).toMatchObject({kind:'eternal_gift',payload:{quantity:1,card:{code:'ETER-007',rarity:'Mythique',finish:'Dorée'}}});
    expect(n.payload.card.instance_id).toBeTruthy();
    await rpc(db,u,'dismiss_player_notice',[n.id]);
    expect(await rpc(db,u,'get_player_notice')).toBeNull();
  });
  it('rien pour une carte ordinaire, ni pour un appel rejoué',async()=>{
    const u=await createUser(db,{handle:true});
    await rpc(db,admin,'admin_grant_card',[u,await char(normal,3),'Standard',1,'Cadeau',randomUUID()]);
    expect(await rpc(db,u,'get_player_notice')).toBeNull();
    const req=randomUUID();
    await rpc(db,admin,'admin_grant_card',[u,await char(eternal,2),'Standard',2,'Cadeau',req]);
    await rpc(db,admin,'admin_grant_card',[u,await char(eternal,2),'Standard',2,'Cadeau',req]);
    const {rows}=await db.query<{n:number}>(`select count(*)::int n from public.player_notices where owner_id=$1`,[u]);
    expect(rows[0].n).toBe(1);
    expect((await rpc(db,u,'get_player_notice')).payload.quantity).toBe(2);
  });
});
