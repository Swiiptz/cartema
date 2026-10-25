import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,asUser,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;let cain:string;
async function useOdds(version:number,odds:number){
  await db.query('update public.pack_rulesets set active=false where active');
  await db.query(`insert into public.pack_rulesets (version,slots,finishes,unique_odds,active)
    select $1,slots,finishes,$2,true from public.pack_rulesets where version=1`,[version,odds]);
}
async function giveFree(user:string,n:number){await db.query('update public.booster_balances set free_count=$2 where owner_id=$1',[user,n]);}

beforeAll(async()=>{
  db=await createDb();
  edition=await seedEdition(db,{prefix:'CAM'});
  admin=await createUser(db);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  const {rows:[c]}=await db.query<{id:string}>(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,100,'Caïn','Mythique','draft') returning id`,[edition]);
  cain=c.id;
  await rpc(db,admin,'admin_set_unique',[cain,true,'Carte unique validée']);
  await rpc(db,admin,'admin_set_character_status',[cain,'published','Mise en jeu']);
},30000);

describe('carte unique',()=>{
  it('ne compte pas dans les 7 raretés et n’est jamais tirée normalement',async()=>{
    await useOdds(3,0);
    const u=await createUser(db);await giveFree(u,6);
    for(let i=0;i<6;i++){
      const r=await rpc(db,u,'open_booster',[edition,randomUUID()]);
      expect(r.cards.some((c:any)=>c.character_id===cain)).toBe(false);
    }
    const {rows:[e]}=await db.query<{c:boolean}>('select private.edition_is_complete($1) c',[edition]);
    expect(e.c).toBe(true);
  });
  it('remplace la 5e carte quand elle sort, une seule fois dans tout le jeu',async()=>{
    await useOdds(4,1); // 1 chance sur 1 : sortie garantie si encore disponible
    const winner=await createUser(db);await giveFree(winner,1);
    const r=await rpc(db,winner,'open_booster',[edition,randomUUID()]);
    expect(r.cards[4]).toMatchObject({character_id:cain,unique:true,finish:'Standard',name:'Caïn'});
    const other=await createUser(db);await giveFree(other,3);
    for(let i=0;i<3;i++){
      const again=await rpc(db,other,'open_booster',[edition,randomUUID()]);
      expect(again.cards.some((c:any)=>c.character_id===cain)).toBe(false);
      expect(['Rare','Très rare','Épique','Légendaire','Mythique']).toContain(again.cards[4].rarity);
    }
    const {rows}=await db.query<{n:number}>('select count(*)::int n from public.inventory_items where character_id=$1',[cain]);
    expect(rows[0].n).toBe(1);
  });
  it('interdit un second exemplaire et toute destruction',async()=>{
    const u=await createUser(db);
    await expectError(db.query(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard')`,[u,cain]),/unique_already_owned/);
    await expectError(db.query('delete from public.inventory_items where character_id=$1',[cain]),/unique_indestructible/);
    await expectError(rpc(db,admin,'admin_set_unique',[cain,false,'Retour en carte normale']),/immutable_character/);
  });
  it('reste secrète : registre illisible, identité masquée pour les autres',async()=>{
    const u=await createUser(db);
    await expectError(asUser(db,u,'select * from public.unique_drops'),/permission denied/);
    const album=await rpc<any[]>(db,u,'get_album',[edition]);
    const entry=album.find(c=>c.number===100);
    expect(entry).toEqual({known:false,edition_id:edition,code:'CAM-100',number:100,rarity:'Mythique',unique:true,silhouette_key:entry.silhouette_key});
  });
  it('fige la probabilité dans la version de règles',async()=>{
    await expectError(db.query('update public.pack_rulesets set unique_odds=5 where version=4'),/immutable_ruleset/);
  });
});
