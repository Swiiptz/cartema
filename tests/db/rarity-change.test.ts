import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,asUser,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let player:string;
const char=async(rarity:string)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 order by number limit 1`,[edition,rarity])).rows[0].id;
const change=(id:string,rarity:string)=>db.query(`select private.change_character_rarity($1,$2,'Rééquilibrage')`,[id,rarity]);
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});
  player=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});
},30000);

describe('changement de rareté',()=>{
  it('passe une carte en Rare : exemplaires et valeur suivent, verrou rétabli, journal tenu',async()=>{
    const id=await char('Peu commun');
    await db.query(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard')`,[player,id]);
    const before=(await rpc<any[]>(db,player,'get_inventory',[id]))[0].value;
    await change(id,'Rare');
    expect((await db.query(`select rarity from public.characters where id=$1`,[id])).rows[0]).toEqual({rarity:'Rare'});
    expect((await rpc<any[]>(db,player,'get_inventory',[id]))[0].value).toBeGreaterThan(before);
    const {rows:[log]}=await db.query<any>(`select action,reason,before_state->>'rarity' avant,after_state->>'rarity' apres from public.admin_audit_logs where target_id=$1 order by id desc limit 1`,[id]);
    expect(log).toEqual({action:'character_rarity',reason:'Rééquilibrage',avant:'Peu commun',apres:'Rare'});
    // Le verrou habituel tient toujours en dehors de la fonction.
    await expectError(db.query(`update public.characters set rarity='Commun' where id=$1`,[id]),/immutable_character/);
  });
  it('refuse de vider une rareté de l’édition, la carte unique et un personnage inconnu',async()=>{
    const last=await char('Peu commun'); // il n'en reste qu'une
    await expectError(change(last,'Rare'),/rarity_would_empty/);
    await db.query(`update public.characters set is_unique=true where id=$1`,[await char('Commun')]);
    await expectError(change(await char('Commun'),'Rare'),/unique_card/);
    await expectError(change('00000000-0000-0000-0000-000000000000','Rare'),/not_found/);
  });
  it('n’est pas appelable par les joueurs',async()=>{
    await expectError(asUser(db,player,`select private.change_character_rarity($1,'Épique','Triche')`,[await char('Rare')]),/permission denied/);
  });
});
