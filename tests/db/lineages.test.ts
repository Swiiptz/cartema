import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Lignées (23/10) : posséder tous les membres d'un clan, toutes éditions confondues. Le titre se perd
// dès qu'un membre quitte la collection ; la récompense n'est donnée qu'à la première fois.
let db:Db;let cam:string;let anx:string;let clan:string;
const CODE='lineage:test';
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});anx=await seedEdition(db,{prefix:'ANX',perRarity:1});
  clan=(await db.query<{id:string}>(`insert into public.clans (name) values ('Lignée de test') returning id`)).rows[0].id;
  // Membres : CAM-001, CAM-002 et ANX-001. Ni la carte unique ni l'édition éternelle ne comptent.
  await db.query(`update public.characters set clan_id=$1 where (edition_id=$2 and number in (1,2)) or (edition_id=$3 and number=1)`,[clan,cam,anx]);
  const eter=await seedEdition(db,{prefix:'ETR',perRarity:1});
  await db.query(`update public.editions set eternal=true, packs_enabled=false where id=$1`,[eter]);
  await db.query(`update public.characters set clan_id=$1 where edition_id=$2 and number=1`,[clan,eter]);
  await db.query(`insert into public.achievements (code,label,description,category,metric,target,clan_id,title,reward_deniers,reward_boosters,sort)
                  values ($1,'Lignée de test','Posséder tous les membres du clan.','general','clan_lineage',1,$2,'Héritier',500,2,900)`,[CODE,clan]);
},30000);

async function player(handle:string){const id=await createUser(db);await rpc(db,id,'set_handle',[handle]);return id;}
async function give(owner:string,edition:string,number:number){
  const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 and number=$3 returning id`,[owner,edition,number]);
  return r.id;
}
const lineage=async(u:string)=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===CODE);
const title=async(u:string)=>(await db.query<{t:string|null}>('select title t from public.profiles where id=$1',[u])).rows[0].t;
const rewards=async(u:string)=>Number((await db.query<{n:string}>(`select count(*) n from public.wallet_ledger where owner_id=$1 and idempotency_key=$2`,[u,'achievement:'+CODE])).rows[0].n);

describe('lignées de clan',()=>{
  it('se gagnent avec tous les membres, se perdent dès qu’un membre part, sans seconde récompense',async()=>{
    const u=await player('heritier');
    const first=await give(u,cam,1);await give(u,cam,2);
    expect(await lineage(u)).toMatchObject({lineage:true,progress:2,target:3,unlocked_at:null,owned_rule:true});
    await give(u,anx,1);
    const gained=await rpc<any[]>(db,u,'sync_my_achievements');
    expect(gained.find(a=>a.code===CODE)).toMatchObject({label:'Lignée de test',title:'Héritier',lineage:true});
    expect(await lineage(u)).toMatchObject({progress:3,target:3,reward_claimed:true,lost_at:null});
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    expect(await rewards(u)).toBe(1);
    expect(await rpc(db,u,'set_title',[CODE])).toBe('Héritier');
    // Les lignées ne comptent pas dans le classement (succès définitifs seulement).
    const unlocks=Number((await db.query<{n:string}>('select count(*) n from public.achievement_unlocks where owner_id=$1',[u])).rows[0].n);
    expect((await rpc(db,u,'get_leaderboard',[50])).me.achievements).toBe(unlocks);
    expect((await db.query('select 1 from public.achievement_unlocks where code=$1',[CODE])).rows).toHaveLength(0);

    // Recyclage d'un membre : titre retiré tout de suite, sans attendre la page Progrès.
    await rpc(db,u,'recycle_cards',[[first],randomUUID(),true]);
    expect(await title(u)).toBeNull();
    const lost=await lineage(u);
    expect(lost).toMatchObject({unlocked_at:null,progress:2,reward_claimed:true});
    expect(lost.lost_at).not.toBeNull();
    await expectError(rpc(db,u,'set_title',[CODE]),/title_locked/);

    // Reprise du membre : la lignée revient, sans nouvelle récompense.
    await give(u,cam,1);
    expect((await rpc<any[]>(db,u,'sync_my_achievements')).find(a=>a.code===CODE)).toBeTruthy();
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    expect(await rewards(u)).toBe(1);
  });

  it('se perd quand un membre change de propriétaire ; un doublon cédé ne fait rien perdre',async()=>{
    const u=await player('vendeur_lignee');const other=await player('acheteur_lignee');
    const ids=[await give(u,cam,1),await give(u,cam,2),await give(u,anx,1)];
    await give(u,cam,2); // un doublon : le donner ne fait rien perdre
    await rpc(db,u,'get_achievements');
    await rpc(db,u,'set_title',[CODE]);
    await db.query('update public.inventory_items set owner_id=$2 where id=$1',[ids[1],other]);
    expect(await title(u)).toBe('Héritier');
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    await db.query('update public.inventory_items set owner_id=$2 where id=$1',[ids[2],other]);
    expect(await title(u)).toBeNull();
    expect((await lineage(u)).unlocked_at).toBeNull();
  });
});
