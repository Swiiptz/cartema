import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['vigie']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
const veteran=async(h:string)=>{const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;};
async function give(owner:string,rarity='Commun'){
  const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 and rarity=$3 limit 1 returning id`,[owner,edition,rarity]);
  return i.id;
}
const check=async(code:string)=>(await rpc(db,admin,'admin_anomalies',[7])).checks.find((c:any)=>c.code===code);

describe('surveillance anti-triche',()=>{
  it('ne signale rien d’incohérent après une activité normale',async()=>{
    const a=await veteran('normal_a');const b=await veteran('normal_b');
    await credit(db,a,3000);await credit(db,b,3000);
    await rpc(db,a,'buy_boosters',[1,randomUUID()]);
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[a]);
    const o=await rpc(db,a,'open_booster',[edition,randomUUID()]);
    await rpc(db,a,'open_booster',[edition,randomUUID()]);
    const l=await rpc(db,a,'create_listing',[o.cards[0].instance_id,20,randomUUID()]);
    await rpc(db,b,'buy_listing',[l.listing_id]);
    const {listing_id:au}=await rpc(db,a,'create_auction',[o.cards[1].instance_id,10,12,randomUUID()]);
    await rpc(db,b,'place_bid',[au,10,randomUUID()]);
    const r=await rpc(db,admin,'admin_anomalies',[7]);
    const critical=r.checks.filter((c:any)=>c.severity==='critical'&&c.count>0);
    expect(critical).toEqual([]);
    expect(r.checks.length).toBeGreaterThanOrEqual(11);
  });
  it('repère un duo, une vente à prix aberrant et un faux enchérisseur',async()=>{
    const main=await veteran('principal');const alt=await veteran('secondaire');const s=await veteran('vendeur_s');const shill=await veteran('complice');
    await credit(db,main,50000);await credit(db,shill,5000);
    for(let i=0;i<4;i++){const l=await rpc(db,alt,'create_listing',[await give(alt),i===0?5000:30,randomUUID()]);await rpc(db,main,'buy_listing',[l.listing_id]);}
    expect((await check('pair_concentration')).rows.map((r:any)=>[r.player,r.other])).toContainEqual(['secondaire','principal']);
    expect((await check('price_outlier')).rows.some((r:any)=>r.player==='secondaire'&&/5000/.test(r.detail))).toBe(true);
    for(let i=0;i<4;i++){const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),10,12,randomUUID()]);await rpc(db,shill,'place_bid',[l,10,randomUUID()]);}
    expect((await check('shill_bidding')).rows.map((r:any)=>[r.player,r.other])).toContainEqual(['complice','vendeur_s']);
  });
  it('détecte une incohérence de solde et une carte bloquée',async()=>{
    const u=await veteran('bricole');
    await db.query('update public.wallets set balance=balance+999 where owner_id=$1',[u]);
    const id=await give(u);
    await db.query(`update public.inventory_items set reserved_kind='listing', reserved_ref=gen_random_uuid() where id=$1`,[id]);
    expect((await check('ledger_mismatch')).rows.map((r:any)=>r.player)).toContain('bricole');
    expect((await check('orphan_reservation')).rows.map((r:any)=>r.player)).toContain('bricole');
  });
  it('est réservé à l’administrateur',async()=>{
    const u=await veteran('curieux_s');
    await expectError(rpc(db,u,'admin_anomalies',[7]),/forbidden/);
  });
});
