import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['tresorier']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

describe('réglages économiques',()=>{
  it('crée une nouvelle version active et journalise l’avant / après',async()=>{
    const before=await rpc(db,admin,'admin_economy');
    const v=await rpc<number>(db,admin,'admin_save_settings',[{daily_login_reward:40,booster_offers:{'1':450,'3':1300,'10':4200}},'Rééquilibrage']);
    expect(v).toBe(before.settings.version+1);
    const after=await rpc(db,admin,'admin_economy');
    expect(after.settings.settings).toMatchObject({daily_login_reward:40,booster_offers:{'1':450},discovery_reward:before.settings.settings.discovery_reward});
    expect(after.settings_history[1]).toMatchObject({version:before.settings.version,active:false});
    const {rows}=await db.query(`select action, reason from public.admin_audit_logs where action='settings_update'`);
    expect(rows).toEqual([{action:'settings_update',reason:'Rééquilibrage'}]);
    // Le joueur paie le nouveau prix.
    const u=await createUser(db);
    await db.query(`update public.wallets set balance=1000 where owner_id=$1`,[u]);
    await rpc(db,u,'buy_boosters',[1,randomUUID()]);
    expect(Number((await db.query<{b:string}>(`select balance b from public.wallets where owner_id=$1`,[u])).rows[0].b)).toBe(550);
  });
  it('refuse clés inconnues, valeurs hors plage, absence de changement et non-admin',async()=>{
    await expectError(rpc(db,admin,'admin_save_settings',[{jackpot:1},'x']),/unknown_setting/);
    await expectError(rpc(db,admin,'admin_save_settings',[{market_commission_pct:80},'x']),/invalid_setting/);
    await expectError(rpc(db,admin,'admin_save_settings',[{daily_login_reward:2.5},'x']),/invalid_setting/);
    await expectError(rpc(db,admin,'admin_save_settings',[{welcome_free_boosters:9},'x']),/invalid_setting/); // > capacité 6
    await expectError(rpc(db,admin,'admin_save_settings',[{recycle_values:{Commun:5}},'x']),/invalid_setting/);
    await expectError(rpc(db,admin,'admin_save_settings',[{daily_login_reward:40},'x']),/no_change/);
    await expectError(rpc(db,admin,'admin_save_settings',[{daily_login_reward:41},' ']),/reason_required/);
    const u=await createUser(db);
    await expectError(rpc(db,u,'admin_save_settings',[{daily_login_reward:99},'x']),/forbidden/);
  });
});

describe('tables de tirage',()=>{
  it('active une nouvelle version, les ouvertures gardent la leur',async()=>{
    const u=await createUser(db);
    await db.query('update public.booster_balances set free_count=2 where owner_id=$1',[u]);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const {ruleset:r}=await rpc(db,admin,'admin_economy');
    const finishes=[{value:'Standard',weight:96000},{value:'Dorée',weight:3500},{value:'Sanglante',weight:500}];
    const v=await rpc<number>(db,admin,'admin_save_ruleset',[r.slots,finishes,5000,'Finitions plus généreuses','Test']);
    expect(v).toBe(r.version+1);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const {rows}=await db.query<{version:number}>(`select r.version from public.pack_openings o join public.pack_rulesets r on r.id=o.ruleset_id where o.owner_id=$1 order by o.created_at`,[u]);
    expect(rows.map(x=>x.version)).toEqual([r.version,v]);
    const eco=await rpc(db,admin,'admin_economy');
    expect(eco.ruleset).toMatchObject({version:v,unique_odds:5000});
    expect(eco.ruleset_history.find((h:any)=>h.version===r.version)).toMatchObject({active:false,openings:1});
  });
  it('refuse une somme différente de 100 000 et une rareté interdite en 5e position',async()=>{
    const {ruleset:r}=await rpc(db,admin,'admin_economy');
    const bad=[{value:'Standard',weight:90000},{value:'Dorée',weight:1000},{value:'Sanglante',weight:100}];
    await expectError(rpc(db,admin,'admin_save_ruleset',[r.slots,bad,r.unique_odds,'','x']),/100000|total/);
    const slots=structuredClone(r.slots);slots[4][0]={value:'Commun',weight:slots[4][0].weight};
    await expectError(rpc(db,admin,'admin_save_ruleset',[slots,r.finishes,r.unique_odds,'','x']),/interdite|emplacement 5/);
    await expectError(rpc(db,admin,'admin_save_ruleset',[r.slots,r.finishes,r.unique_odds,'','x']),/no_change/);
    expect((await rpc(db,admin,'admin_economy')).ruleset.version).toBe(r.version);
  });
});
