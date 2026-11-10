import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,expectError,type Db} from './harness';

// Thème d'hiver (10/11) : réglage Économie winter_theme, lu par get_features (visiteurs compris).
let db:Db;let admin:string;
beforeAll(async()=>{db=await createDb();admin=await createUser(db,{handle:true});await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);},30000);

describe('thème d’hiver',()=>{
  it('éteint par défaut, allumé d’un réglage, sans toucher aux autres réglages',async()=>{
    const u=await createUser(db,{handle:true});
    expect(await rpc(db,u,'get_features')).toEqual({next_set:false,winter:false});
    expect(await rpc(db,null,'get_features')).toEqual({next_set:false,winter:false});
    await expectError(rpc(db,admin,'admin_save_settings',[{winter_theme:2},'Hors plage']),/invalid_setting/);
    const before=(await db.query<{s:any}>(`select settings s from public.economy_settings where active`)).rows[0].s;
    await rpc(db,admin,'admin_save_settings',[{winter_theme:1},'Neige']);
    expect(await rpc(db,null,'get_features')).toEqual({next_set:false,winter:true});
    const after=(await db.query<{s:any}>(`select settings s from public.economy_settings where active`)).rows[0].s;
    expect({...after,winter_theme:0}).toEqual(before);
    expect(after.alternate_rarity_mult).toBeTruthy();
  });
});
