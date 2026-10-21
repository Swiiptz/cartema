import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,asUser,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
const OLD='2026-01-01T00:00:00Z';
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);

async function give(user:string,rarity='Rare',finish='Standard'){
  const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 limit 1`,[edition,rarity]);
  const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,$3) returning id`,[user,c.id,finish]);
  return {instance:i.id,character:c.id};
}
async function balance(user:string){return Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[user])).rows[0].b);}
async function veteran(){return createUser(db,{createdAt:OLD});}

describe('marché à prix fixe',()=>{
  it('vend une carte : commission de 5 % arrondie à l’inférieur, transfert et découverte',async()=>{
    const seller=await veteran();const buyer=await veteran();
    await credit(db,buyer,1000);
    const {instance,character}=await give(seller);
    const l=await rpc(db,seller,'create_listing',[instance,333,randomUUID()]);
    expect(l).toMatchObject({price:333,net:317}); // floor(333 × 5 %) = 16
    const r=await rpc(db,buyer,'buy_listing',[l.listing_id]);
    expect(r).toMatchObject({price:333,buyer_tax:16,discovered:true,replayed:false});
    expect(await balance(buyer)).toBe(1000-333-16+10); // prix + taxe acheteur de 5 %, +10 découverte
    expect(await balance(seller)).toBe(317);
    const {rows:[item]}=await db.query<{owner_id:string;reserved_kind:string|null}>('select owner_id,reserved_kind from public.inventory_items where id=$1',[instance]);
    expect(item).toEqual({owner_id:buyer,reserved_kind:null});
    const {rows:[d]}=await db.query('select count(*)::int n from public.discoveries where owner_id=$1 and character_id=$2',[buyer,character]);
    expect(d).toEqual({n:1});
    expect(await rpc(db,buyer,'buy_listing',[l.listing_id])).toMatchObject({replayed:true});
    expect(await balance(buyer)).toBe(661);
  });
  it('n’accepte qu’un seul acheteur',async()=>{
    const seller=await veteran();const a=await veteran();const b=await veteran();
    await credit(db,a,500);await credit(db,b,500);
    const {instance}=await give(seller);
    const l=await rpc(db,seller,'create_listing',[instance,100,randomUUID()]);
    await rpc(db,a,'buy_listing',[l.listing_id]);
    await expectError(rpc(db,b,'buy_listing',[l.listing_id]),/listing_unavailable/);
    expect(await balance(b)).toBe(500);
  });
  it('refuse un achat sans fonds, sur sa propre annonce, ou sur une carte verrouillée',async()=>{
    const seller=await veteran();const poor=await veteran();
    const {instance}=await give(seller);
    const l=await rpc(db,seller,'create_listing',[instance,100,randomUUID()]);
    await expectError(rpc(db,poor,'buy_listing',[l.listing_id]),/insufficient_funds/);
    await expectError(rpc(db,seller,'buy_listing',[l.listing_id]),/own_listing/);
    const other=await give(seller);
    await rpc(db,seller,'set_cards_locked',[[other.instance],true]);
    await expectError(rpc(db,seller,'create_listing',[other.instance,50,randomUUID()]),/card_locked/);
  });
  it('réserve l’exemplaire en vente et le libère à l’annulation',async()=>{
    const seller=await veteran();
    const {instance}=await give(seller);
    const l=await rpc(db,seller,'create_listing',[instance,80,randomUUID()]);
    await expectError(rpc(db,seller,'recycle_cards',[[instance],randomUUID()]),/card_reserved/);
    await expectError(rpc(db,seller,'create_listing',[instance,90,randomUUID()]),/card_reserved/);
    await rpc(db,seller,'cancel_listing',[l.listing_id]);
    expect(await rpc(db,seller,'recycle_cards',[[instance],randomUUID()])).toMatchObject({count:1});
  });
  it('bloque les transactions pendant les 24 premières heures',async()=>{
    const fresh=await createUser(db);const seller=await veteran();
    await credit(db,fresh,500);
    const {instance}=await give(fresh);
    await expectError(rpc(db,fresh,'create_listing',[instance,10,randomUUID()]),/account_too_new/);
    const other=await give(seller);
    const l=await rpc(db,seller,'create_listing',[other.instance,10,randomUUID()]);
    await expectError(rpc(db,fresh,'buy_listing',[l.listing_id]),/account_too_new/);
    expect(await rpc(db,fresh,'get_trade_status')).toMatchObject({allowed:false});
  });
  it('montre les annonces actives et masque les ventes closes des autres',async()=>{
    const seller=await veteran();const viewer=await veteran();
    const {instance}=await give(seller,'Épique','Dorée');
    const l=await rpc(db,seller,'create_listing',[instance,250,randomUUID()]);
    const market=await rpc<any[]>(db,viewer,'get_market',[null,'Dorée']);
    expect(market.find(m=>m.listing_id===l.listing_id)).toMatchObject({price:250,finish:'Dorée',mine:false,discovered:false});
    await rpc(db,seller,'cancel_listing',[l.listing_id]);
    expect((await asUser(db,viewer,'select id from public.listings where id=$1',[l.listing_id]))).toEqual([]);
    expect((await rpc<any[]>(db,seller,'get_my_listings',[])).find(m=>m.listing_id===l.listing_id)).toMatchObject({status:'cancelled'});
  });
});

describe('compte vérifié par Discord',()=>{
  it('lève le délai de 24 h pour un compte lié à Discord',async()=>{
    const fresh=await createUser(db);
    let st=await rpc(db,fresh,'get_trade_status');
    expect(st).toMatchObject({allowed:false,verified:false});
    await db.query(`insert into auth.identities (user_id,provider) values ($1,'discord')`,[fresh]);
    st=await rpc(db,fresh,'get_trade_status');
    expect(st).toMatchObject({allowed:true,verified:true,available_at:null});
  });
});
