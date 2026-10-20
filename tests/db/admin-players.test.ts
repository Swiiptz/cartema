import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM'});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['archiviste']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01 12:00+01'});await rpc(db,id,'set_handle',[handle]);return id;}
async function audit(target:string){return (await db.query<{action:string;reason:string}>(`select action,reason from public.admin_audit_logs where target_id=$1 order by id`,[target])).rows;}

describe('fiche joueur',()=>{
  it('trouve un joueur et affiche ses soldes et son historique',async()=>{
    const u=await player('cherche_moi');
    const found=await rpc<any[]>(db,admin,'admin_search_players',['cherche']);
    expect(found.map(p=>p.handle)).toEqual(['cherche_moi']);
    const p=await rpc(db,admin,'admin_player',[u]);
    expect(p).toMatchObject({handle:'cherche_moi',balance:expect.any(Number),boosters:{free:3,purchased:0},cards:0,suspended_at:null});
    await expectError(rpc(db,u,'admin_player',[u]),/forbidden/);
    await expectError(rpc(db,u,'admin_search_players',['']),/forbidden/);
  });
});

describe('ajustements économiques',()=>{
  it('crédite et débite des Deniers avec motif, une seule fois par requête',async()=>{
    const u=await player('credite');
    const start=(await rpc(db,admin,'admin_player',[u])).balance;
    const req=randomUUID();
    expect(await rpc(db,admin,'admin_adjust_deniers',[u,500,'Lot du tournoi',req])).toBe(start+500);
    expect(await rpc(db,admin,'admin_adjust_deniers',[u,500,'Lot du tournoi',req])).toBe(start+500);
    expect(await rpc(db,admin,'admin_adjust_deniers',[u,-200,'Correction',randomUUID()])).toBe(start+300);
    await expectError(rpc(db,admin,'admin_adjust_deniers',[u,-1e9,'Trop',randomUUID()]),/insufficient_funds/);
    await expectError(rpc(db,admin,'admin_adjust_deniers',[u,10,' ',randomUUID()]),/reason_required/);
    await expectError(rpc(db,admin,'admin_adjust_deniers',[u,0,'Rien',randomUUID()]),/invalid_amount/);
    expect((await audit(u)).filter(a=>a.action==='deniers_adjust').map(a=>a.reason)).toEqual(['Lot du tournoi','Correction']);
    const ledger=(await rpc(db,admin,'admin_player',[u])).ledger;
    expect(ledger.filter((l:any)=>l.kind==='admin_adjust').map((l:any)=>l.delta)).toEqual([-200,500]);
  });
  it('ajoute et retire des boosters achetés sans passer sous zéro',async()=>{
    const u=await player('booste');
    const req=randomUUID();
    expect(await rpc(db,admin,'admin_adjust_boosters',[u,4,'Compensation panne',req])).toBe(4);
    expect(await rpc(db,admin,'admin_adjust_boosters',[u,4,'Compensation panne',req])).toBe(4);
    expect(await rpc(db,admin,'admin_adjust_boosters',[u,-1,'Erreur',randomUUID()])).toBe(3);
    await expectError(rpc(db,admin,'admin_adjust_boosters',[u,-10,'Trop',randomUUID()]),/insufficient_boosters/);
    expect((await rpc(db,admin,'admin_player',[u])).boosters).toEqual({free:3,purchased:3});
  });
});

describe('modération',()=>{
  it('suspend un joueur : plus d’action possible, ventes sans offre retirées',async()=>{
    const u=await player('fautif');
    const {rows:[item]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 and number=1 returning id`,[u,edition]);
    const l=await rpc(db,u,'create_listing',[item.id,100,randomUUID()]);
    await rpc(db,admin,'admin_set_suspended',[u,true,'Insultes répétées']);
    await expectError(rpc(db,u,'get_player_state'),/account_suspended/);
    const {rows:[listing]}=await db.query<any>(`select status from public.listings where id=$1`,[l.listing_id??l.id??l]);
    expect(listing.status).toBe('cancelled');
    const {rows:[inv]}=await db.query<any>(`select reserved_kind from public.inventory_items where id=$1`,[item.id]);
    expect(inv.reserved_kind).toBeNull();
    await rpc(db,admin,'admin_set_suspended',[u,false,'Excuses acceptées']);
    expect((await rpc(db,u,'get_player_state')).profile.handle).toBe('fautif');
    expect((await audit(u)).map(a=>a.action)).toEqual(['player_suspend','player_unsuspend']);
  });
  it('bloque les échanges et le marché seulement',async()=>{
    const u=await player('bloque');
    await credit(db,u,1000);
    await rpc(db,admin,'admin_set_trade_block',[u,true,'Soupçon de multi-compte']);
    expect((await rpc(db,u,'get_trade_status')).blocked).toBe(true);
    expect((await rpc(db,u,'get_player_state')).profile.handle).toBe('bloque');
    await rpc(db,admin,'admin_set_trade_block',[u,false,'Vérifié']);
    expect((await rpc(db,u,'get_trade_status')).blocked).toBe(false);
  });
  it('réinitialise un pseudonyme et protège l’administrateur',async()=>{
    const u=await player('pseudo_grossier');
    await rpc(db,admin,'admin_reset_handle',[u,'Pseudonyme inapproprié']);
    expect((await rpc(db,u,'get_player_state')).profile.handle).toBeNull();
    await expectError(rpc(db,admin,'admin_set_suspended',[admin,true,'test']),/cannot_sanction_admin/);
    await expectError(rpc(db,admin,'admin_set_trade_block',[admin,true,'test']),/cannot_sanction_admin/);
  });
});
