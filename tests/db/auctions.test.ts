import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
const OLD='2026-01-01T00:00:00Z';
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);

async function give(user:string){
  const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity='Épique' limit 1`,[edition]);
  const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[user,c.id]);
  return i.id;
}
const balance=async(u:string)=>Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[u])).rows[0].b);
const veteran=()=>createUser(db,{createdAt:OLD,handle:true});
const bid=(u:string,l:string,amount:number)=>rpc(db,u,'place_bid',[l,amount,randomUUID()]);
const expire=(l:string)=>db.query(`update public.listings set ends_at=now()-interval '1 second' where id=$1`,[l]);
const close=()=>db.query<{n:number}>('select private.close_expired_auctions() n').then(r=>Number(r.rows[0].n));

describe('enchères',()=>{
  it('n’accepte que les durées 12/24/48/72 h',async()=>{
    const s=await veteran();const item=await give(s);
    await expectError(rpc(db,s,'create_auction',[item,100,6,randomUUID()]),/invalid_duration/);
    const a=await rpc(db,s,'create_auction',[item,100,24,randomUUID()]);
    const hours=(Date.parse(a.ends_at)-Date.now())/3600e3;
    expect(hours).toBeGreaterThan(23.9);expect(hours).toBeLessThan(24.1);
  });
  it('applique les paliers, bloque la mise et rembourse l’enchérisseur dépassé',async()=>{
    const s=await veteran();const a=await veteran();const b=await veteran();
    await credit(db,a,5000);await credit(db,b,5000);
    const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),480,12,randomUUID()]);
    await expectError(bid(a,l,479),/bid_too_low/);
    await bid(a,l,480);
    expect(await balance(a)).toBe(5000-480-24); // mise + taxe acheteur de 5 % mises de côté
    await expectError(bid(b,l,489),/bid_too_low/); // +10 sous 500
    await bid(b,l,490);
    expect(await balance(a)).toBe(5000-24); // rendu moins la taxe de remboursement de 5 %
    expect(await balance(b)).toBe(5000-490-24);
    await expectError(bid(b,l,600),/already_leading/);
    await expectError(bid(a,l,499),/bid_too_low/); // 490 + 10 = 500 minimum
    await bid(a,l,510);
    await expectError(bid(b,l,534),/bid_too_low/); // +25 entre 500 et 2 000
    await bid(b,l,535);
    await bid(a,l,2000);
    await expectError(bid(b,l,2049),/bid_too_low/); // +50 au-delà de 2 000
    await expectError(bid(s,l,5000),/own_listing/);
  });
  it('prolonge l’enchère après une mise de dernière minute',async()=>{
    const s=await veteran();const a=await veteran();await credit(db,a,500);
    const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),10,12,randomUUID()]);
    await db.query(`update public.listings set ends_at=now()+interval '30 seconds' where id=$1`,[l]);
    const r=await bid(a,l,10);
    expect(Date.parse(r.ends_at)-Date.now()).toBeGreaterThan(110e3);
  });
  it('clôture une seule fois : carte au gagnant, prix moins 5 % au vendeur',async()=>{
    const s=await veteran();const a=await veteran();const b=await veteran();
    await credit(db,a,1000);await credit(db,b,1000);
    const item=await give(s);
    const {listing_id:l}=await rpc(db,s,'create_auction',[item,100,12,randomUUID()]);
    await bid(a,l,100);await bid(b,l,333);
    await expire(l);
    expect(await close()).toBe(1);
    expect(await close()).toBe(0);
    const {rows:[it]}=await db.query<{owner_id:string;reserved_kind:string|null}>('select owner_id,reserved_kind from public.inventory_items where id=$1',[item]);
    expect(it).toEqual({owner_id:b,reserved_kind:null});
    expect(await balance(s)).toBe(317);
    expect(await balance(a)).toBe(1000-5); // dépassé : rendu moins 5 % de sa mise
    expect(await balance(b)).toBe(1000-333-16+10); // mise + taxe acheteur, +10 découverte
    await expectError(bid(a,l,400),/auction_closed/);
  });
  it('rend la carte au vendeur sans enchère et refuse l’annulation après une mise',async()=>{
    const s=await veteran();const a=await veteran();await credit(db,a,100);
    const item=await give(s);
    const {listing_id:l}=await rpc(db,s,'create_auction',[item,50,12,randomUUID()]);
    await expire(l);await close();
    const {rows:[it]}=await db.query<{owner_id:string;reserved_kind:string|null}>('select owner_id,reserved_kind from public.inventory_items where id=$1',[item]);
    expect(it).toEqual({owner_id:s,reserved_kind:null});
    const {listing_id:l2}=await rpc(db,s,'create_auction',[item,50,12,randomUUID()]);
    await bid(a,l2,50);
    await expectError(rpc(db,s,'cancel_listing',[l2]),/auction_has_bids/);
    await expectError(rpc(db,a,'buy_listing',[l2]),/not_fixed_price/);
  });
  it('une enchère échue disparaît du marché à la consultation',async()=>{
    const s=await veteran();const v=await veteran();
    const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),50,12,randomUUID()]);
    const before=await rpc<any[]>(db,v,'get_market',[]);
    expect(before.find(x=>x.listing_id===l)).toMatchObject({kind:'auction',min_next_bid:50,bid_count:0});
    await expire(l);
    expect((await rpc<any[]>(db,v,'get_market',[])).find(x=>x.listing_id===l)).toBeUndefined();
  });
});

describe('enchère sans les fonds',()=>{
  it('refuse la mise, ne crée aucune offre et ne touche à rien',async()=>{
    const s=await veteran();const pauvre=await veteran();
    await db.query('update public.wallets set balance=0 where owner_id=$1',[pauvre]);
    await credit(db,pauvre,100);
    const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),480,12,randomUUID()]);
    await expectError(bid(pauvre,l,480),/insufficient_funds/);
    expect(await balance(pauvre)).toBe(100);
    const {rows:[x]}=await db.query<any>('select current_bid, bid_count from public.listings where id=$1',[l]);
    expect(x).toMatchObject({current_bid:null,bid_count:0});
    expect((await db.query(`select count(*)::int n from public.bids where listing_id=$1`,[l])).rows[0]).toEqual({n:0});
  });
});

describe('mises placées avant les taxes',()=>{
  it('sont remboursées en entier',async()=>{
    const s=await veteran();const a=await veteran();const b=await veteran();
    await credit(db,a,1000);await credit(db,b,1000);
    const {listing_id:l}=await rpc(db,s,'create_auction',[await give(s),100,12,randomUUID()]);
    // Mise « ancienne » : séquestre = mise seule, pas de taxe.
    await bid(a,l,100);
    await db.query(`update public.bids set taxed=false, hold=amount, buyer_tax=0 where listing_id=$1`,[l]);
    await db.query(`update public.wallets set balance=balance+5 where owner_id=$1`,[a]); // annule la taxe prise par la nouvelle règle
    await bid(b,l,110);
    expect(await balance(a)).toBe(1000);
  });
});
