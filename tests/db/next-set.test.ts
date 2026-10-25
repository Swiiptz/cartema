import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

// Nouveautés du prochain set (25/10) : signatures et textes d'ambiance restent coupés tant que l'admin n'allume pas
// next_set_features (Économie). Coupé : propositions refusées, textes validés cachés, aucune carte signée.
let db:Db;let cam:string;let admin:string;
const SIG='/illustrations/CAM/signatures/signature.webp';
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien_du_set']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God',0]);
},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);await credit(db,id,5000);
  await db.query('update public.booster_balances set free_count=0,purchased_count=5 where owner_id=$1',[id]);return id;}

describe('nouveautés du prochain set',()=>{
  it('restent coupées par défaut, puis s’allument d’un réglage',async()=>{
    const u=await player('impatiente_du_set');
    const {rows:[c]}=await db.query<{id:string}>('select id from public.characters where edition_id=$1 and number=1',[cam]);
    await db.query('insert into public.discoveries (owner_id,character_id) values ($1,$2)',[u,c.id]);
    await db.query(`update public.characters set flavor_text='Un texte déjà validé.', signature_path=$2 where edition_id=$1`,[cam,SIG]);
    await rpc(db,admin,'admin_save_settings',[{signed_odds:1},'Toujours signé (test)']);

    expect(await rpc(db,u,'get_features')).toEqual({next_set:false});
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','ambiance','Elle sourit avant de mordre.',null]),/feature_locked/);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','signature','',`${u}/sig.png`]),/feature_locked/);
    expect(await rpc(db,u,'submit_card_feedback',['CAM-001','info','Le clan est faux.',null])).toBeTruthy();
    expect(await rpc(db,u,'get_card_flavor',[c.id])).toBeNull();
    expect((await rpc(db,u,'open_booster',[cam,randomUUID()])).cards.some((x:any)=>x.signed)).toBe(false);

    await expectError(rpc(db,admin,'admin_save_settings',[{next_set_features:2},'Hors plage']),/invalid_setting/);
    await rpc(db,admin,'admin_save_settings',[{next_set_features:1},'Lancement du set']);
    expect(await rpc(db,u,'get_features')).toEqual({next_set:true});
    expect(await rpc(db,u,'submit_card_feedback',['CAM-001','ambiance','Elle sourit avant de mordre.',null])).toBeTruthy();
    expect(await rpc(db,u,'get_card_flavor',[c.id])).toMatchObject({text:'Un texte déjà validé.'});
    expect((await rpc(db,u,'open_booster',[cam,randomUUID()])).cards.every((x:any)=>x.signed)).toBe(true);
  });
});
