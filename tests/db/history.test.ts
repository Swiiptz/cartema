import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}

describe('historique du joueur',()=>{
  it('retrace ouvertures, boutique, ventes et recyclages, par catégorie et page par page',async()=>{
    const s=await player('historien');const b=await player('acheteur_h');
    await credit(db,s,2000);await credit(db,b,2000);
    await rpc(db,s,'buy_boosters',[1,randomUUID()]);
    await db.query('update public.booster_balances set free_count=2 where owner_id=$1',[s]);
    const o1=await rpc(db,s,'open_booster',[edition,randomUUID()]);
    await rpc(db,s,'open_booster',[edition,randomUUID()]);
    const [toSell,toRecycle]=o1.cards.filter((c:any)=>!c.unique);
    const l=await rpc(db,s,'create_listing',[toSell.instance_id,200,randomUUID()]);
    await rpc(db,b,'buy_listing',[l.listing_id??l.id??l]);
    await rpc(db,s,'recycle_cards',[[toRecycle.instance_id],randomUUID(),true]);

    const all=await rpc(db,s,'get_history',['all',null,30]);
    expect(all.items.map((x:any)=>x.type)).toEqual(['recycling','sale','opening','opening','shop']);
    const opening=all.items.find((x:any)=>x.type==='opening');
    expect(opening.cards).toHaveLength(5);
    expect(opening).toMatchObject({pool:expect.any(String),ruleset:2});
    expect(all.items.find((x:any)=>x.type==='sale')).toMatchObject({status:'sold',price:200,commission:10,other:'acheteur_h'});
    expect((await rpc(db,b,'get_history',['market',null,30])).items[0]).toMatchObject({type:'purchase',price:200,other:'historien'});
    expect((await rpc(db,s,'get_history',['boosters',null,30])).items.map((x:any)=>x.type)).toEqual(['opening','opening','shop']);

    const page1=await rpc(db,s,'get_history',['all',null,2]);
    expect(page1.items).toHaveLength(2);
    const page2=await rpc(db,s,'get_history',['all',page1.next,2]);
    expect(page2.items.map((x:any)=>x.type)).toEqual(['opening','opening']);

    const ledger=await rpc(db,s,'get_history',['deniers',null,50]);
    expect(ledger.items.every((x:any)=>x.type==='ledger')).toBe(true);
    expect(ledger.items.map((x:any)=>x.kind)).toEqual(expect.arrayContaining(['shop_booster','market_sale','recycle']));
    await expectError(rpc(db,s,'get_history',['tout',null,10]),/invalid_kind/);
  });
  it('n’affiche jamais les opérations des autres joueurs',async()=>{
    const x=await player('discret_h');
    expect((await rpc(db,x,'get_history',['all',null,30])).items).toEqual([]);
  });
});
