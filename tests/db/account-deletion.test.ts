import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}

describe('RGPD',()=>{
  it('exporte toutes les données du joueur',async()=>{
    const u=await player('curieux_rgpd');
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    await rpc(db,u,'set_wish',['TST-001',null,true]).catch(()=>{});
    const data=await rpc(db,u,'export_my_data');
    expect(data.profile).toMatchObject({handle:'curieux_rgpd'});
    expect(data.profile.role).toBeUndefined();
    expect(data.cards).toHaveLength(5);
    expect(data.discoveries.length).toBeGreaterThan(0);
    expect(data.history.items[0].type).toBe('opening');
    expect(data.account).toHaveProperty('email');
  });
  it('supprime le compte sans casser les cartes cédées aux autres',async()=>{
    const u=await player('partant');const v=await player('ami_partant');
    await credit(db,u,2000);await credit(db,v,2000);
    await db.query('update public.booster_balances set free_count=2 where owner_id=$1',[u]);
    const o=await rpc(db,u,'open_booster',[edition,randomUUID()]);
    await rpc(db,u,'recycle_cards',[[o.cards[0].instance_id],randomUUID(),true]);
    const sold=await rpc(db,u,'create_listing',[o.cards[1].instance_id,100,randomUUID()]);
    await rpc(db,v,'buy_listing',[sold.listing_id??sold.id??sold]);
    const open=await rpc(db,u,'create_listing',[o.cards[2].instance_id,100,randomUUID()]);
    await rpc(db,u,'send_friend_request',['ami_partant']);
    await expectError(rpc(db,u,'delete_my_account',['autre']),/confirmation_mismatch/);
    await rpc(db,u,'delete_my_account',['PARTANT']);
    expect((await db.query(`select count(*)::int n from auth.users where id=$1`,[u])).rows[0]).toEqual({n:0});
    const {rows:[p]}=await db.query<any>(`select handle, deleted_at, suspended_at, visibility from public.profiles where id=$1`,[u]);
    expect(p).toMatchObject({handle:null,visibility:'private'});
    expect(p.deleted_at).not.toBeNull();
    expect((await db.query<any>(`select status from public.listings where id=$1`,[open.listing_id??open.id??open])).rows[0].status).toBe('cancelled');
    expect((await db.query(`select count(*)::int n from public.friendships where requester_id=$1 or addressee_id=$1`,[u])).rows[0]).toEqual({n:0});
    // La carte achetée par l'autre joueur est intacte.
    expect((await db.query(`select count(*)::int n from public.inventory_items where id=$1 and owner_id=$2`,[o.cards[1].instance_id,v])).rows[0]).toEqual({n:1});
    await expectError(rpc(db,v,'get_profile',['partant']),/player_not_found/);
    await expectError(rpc(db,u,'get_player_state'),/account_suspended|profile_missing/);
  });
  it('protège le compte administrateur',async()=>{
    const a=await player('admin_rgpd');
    await db.query(`update public.profiles set role='admin' where id=$1`,[a]);
    await expectError(rpc(db,a,'delete_my_account',['admin_rgpd']),/cannot_delete_admin/);
  });
});
