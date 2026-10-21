import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,asUser,rpc,createUser,seedEdition,expectError,credit,type Db} from './harness';

let db:Db;let alice:string;let bob:string;
beforeAll(async()=>{
  db=await createDb();
  alice=await createUser(db);bob=await createUser(db);
  await credit(db,alice,1000);
  await seedEdition(db);
},30000);

describe('comptes',()=>{
  it('crée profil, portefeuille et compteur de boosters à l’inscription',async()=>{
    const state=await rpc(db,alice,'get_player_state');
    expect(state.profile.role).toBe('player');
    expect(state.daily_reward).toBe(25); // bonus de connexion du jour
    expect(state.balance).toBe(1025);
    expect((await rpc(db,alice,'get_player_state')).daily_reward).toBe(0);
    expect(state.boosters).toMatchObject({free:3,purchased:0,free_capacity:6}); // 3 boosters de bienvenue
  });
  it('impose un pseudo unique sans tenir compte de la casse',async()=>{
    expect(await rpc(db,alice,'set_handle',['Lilith_9'])).toBe('Lilith_9');
    await expectError(rpc(db,bob,'set_handle',['lilith_9']),/handle_taken/);
    await expectError(rpc(db,bob,'set_handle',['a b']),/invalid_handle/);
  });
  it('n’autorise qu’un seul administrateur',async()=>{
    await db.query(`update public.profiles set role='admin' where id=$1`,[alice]);
    await expectError(db.query(`update public.profiles set role='admin' where id=$1`,[bob]),/profiles_single_admin/);
    await db.query(`update public.profiles set role='player' where id=$1`,[alice]);
  });
});

describe('accès refusés',()=>{
  it('refuse les RPC aux visiteurs anonymes',async()=>{
    await expectError(rpc(db,null,'get_player_state'),/permission denied/);
    await expectError(rpc(db,null,'open_booster',[crypto.randomUUID(),crypto.randomUUID()]),/permission denied/);
  });
  it('n’expose pas le schéma privé',async()=>{
    await expectError(asUser(db,alice,`select private.apply_wallet_delta($1,1000000,'x',null,null,'k')`,[alice]),/permission denied/);
  });
  it('interdit toute écriture directe dans les tables',async()=>{
    await expectError(asUser(db,alice,`update public.wallets set balance=999999`),/permission denied/);
    await expectError(asUser(db,alice,`update public.profiles set role='admin'`),/permission denied/);
    await expectError(asUser(db,alice,`update public.booster_balances set purchased_count=99`),/permission denied/);
    await expectError(asUser(db,alice,`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Sanglante' from public.characters limit 1`,[alice]),/permission denied/);
  });
  it('cache le catalogue brut et les réglages',async()=>{
    await expectError(asUser(db,alice,`select name from public.characters`),/permission denied/);
    await expectError(asUser(db,alice,`select * from public.economy_settings`),/permission denied/);
    await expectError(asUser(db,alice,`select * from public.admin_audit_logs`),/permission denied/);
  });
  it('ne montre à chacun que ses propres données',async()=>{
    const wallets=await asUser(db,bob,`select owner_id from public.wallets`);
    expect(wallets).toEqual([{owner_id:bob}]);
    expect(await asUser(db,bob,`select * from public.wallet_ledger`)).toEqual([]);
    expect(await asUser(db,bob,`select id from public.profiles`)).toEqual([{id:bob}]);
  });
});

describe('historique immuable',()=>{
  it('refuse la modification et la suppression du ledger',async()=>{
    await expectError(db.query(`update public.wallet_ledger set delta=1`),/immutable_history/);
    await expectError(db.query(`delete from public.wallet_ledger`),/immutable_history/);
  });
  it('autorise la suppression d’un compte : profil anonymisé, registre conservé (RGPD)',async()=>{
    const temp=await createUser(db);
    await credit(db,temp,50);
    await db.query('delete from auth.users where id=$1',[temp]);
    // Le registre des Deniers reste immuable ; plus rien ne le relie à une personne.
    const {rows}=await db.query('select count(*)::int n from public.wallet_ledger where owner_id=$1',[temp]);
    expect(rows[0]).toEqual({n:1});
    const {rows:[p]}=await db.query<any>('select handle, deleted_at from public.profiles where id=$1',[temp]);
    expect(p.handle).toBeNull();expect(p.deleted_at).not.toBeNull();
  });
});
