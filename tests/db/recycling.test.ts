import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,asUser,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);

async function charId(rarity:string){
  const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 limit 1`,[edition,rarity]);
  return c.id;
}
async function give(user:string,rarity:string,finish='Standard',n=1){
  const c=await charId(rarity);const ids:string[]=[];
  for(let i=0;i<n;i++){
    const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish,acquired_at) values ($1,$2,$3,now()+($4||' seconds')::interval) returning id`,[user,c,finish,i]);
    ids.push(r.id);
  }
  await db.query('insert into public.discoveries (owner_id,character_id) values ($1,$2) on conflict do nothing',[user,c]);
  return ids;
}
async function balance(user:string){return Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[user])).rows[0].b);}

describe('recyclage',()=>{
  it('crédite la valeur validée selon rareté et finition',async()=>{
    const u=await createUser(db);
    const ids=[...await give(u,'Commun'),...await give(u,'Rare','Dorée'),...await give(u,'Mythique','Sanglante')];
    await expectError(rpc(db,u,'recycle_cards',[ids,randomUUID()]),/confirm_special_finish/);
    const r=await rpc(db,u,'recycle_cards',[ids,randomUUID(),true]);
    expect(r).toMatchObject({total:5+40*3+3000*10,count:3,replayed:false});
    expect(await balance(u)).toBe(30125);
  });
  it('est idempotent et irréversible',async()=>{
    const u=await createUser(db);const ids=await give(u,'Épique','Standard',2);
    const req=randomUUID();
    await rpc(db,u,'recycle_cards',[ids,req]);
    expect(await rpc(db,u,'recycle_cards',[ids,req])).toMatchObject({replayed:true,total:400});
    expect(await balance(u)).toBe(400);
    await expectError(rpc(db,u,'recycle_cards',[ids,randomUUID()]),/not_owned/);
    await expectError(db.query('update public.inventory_items set recycled_at=null where id=$1',[ids[0]]),/recycled_item/);
  });
  it('refuse les exemplaires verrouillés, d’autrui ou uniques',async()=>{
    const u=await createUser(db);const other=await createUser(db);
    const [a]=await give(u,'Commun');const [b]=await give(other,'Commun');
    expect(await rpc(db,u,'set_cards_locked',[[a],true])).toBe(1);
    await expectError(rpc(db,u,'recycle_cards',[[a],randomUUID()]),/card_locked/);
    expect(await rpc(db,u,'set_cards_locked',[[b],true])).toBe(0);
    await expectError(rpc(db,u,'recycle_cards',[[b],randomUUID()]),/not_owned/);
    const {rows:[c]}=await db.query<{id:string}>(`insert into public.characters (edition_id,number,name,rarity,status,is_unique) values ($1,900,'Unique','Mythique','published',true) returning id`,[edition]);
    const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[u,c.id]);
    await expectError(rpc(db,u,'recycle_cards',[[i.id],randomUUID(),true]),/unique_indestructible/);
  });
  it('conserve l’historique d’ouverture et la découverte',async()=>{
    const u=await createUser(db);
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    const o=await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const ids=o.cards.map((c:any)=>c.instance_id);
    await rpc(db,u,'recycle_cards',[ids,randomUUID(),true]);
    expect((await rpc(db,u,'get_opening',[o.opening_id])).cards).toHaveLength(5);
    const album=await rpc<any[]>(db,u,'get_album',[edition]);
    const known=album.filter(c=>c.known);
    expect(known.length).toBeGreaterThan(0);
    expect(known.every(c=>Object.keys(c.owned).length===0)).toBe(true);
    expect(await rpc(db,u,'get_inventory',[o.cards[0].character_id])).toEqual([]);
  });
});

describe('recyclage rapide des doublons',()=>{
  it('ne recycle que les Standards non verrouillées et garde un exemplaire',async()=>{
    const u=await createUser(db);
    const communs=await give(u,'Commun','Standard',4);
    await give(u,'Rare','Dorée',2);
    await give(u,'Peu commun','Standard',1);
    await rpc(db,u,'set_cards_locked',[[communs[3]],true]);
    expect(await rpc(db,u,'preview_duplicates',[])).toMatchObject({count:2,total:10});
    const r=await rpc(db,u,'recycle_duplicates',[randomUUID()]);
    expect(r).toMatchObject({count:2,total:10});
    const left=await asUser<{finish:string;locked:boolean}>(db,u,`select finish,locked from public.inventory_items where recycled_at is null order by finish,locked`);
    expect(left).toHaveLength(5);
    expect(await rpc(db,u,'preview_duplicates',[])).toMatchObject({count:0,total:0});
  });
});

describe('bonus de connexion',()=>{
  it('crédite une fois par jour calendaire de Paris',async()=>{
    const u=await createUser(db);
    const claim=(at:string)=>db.query<{r:string}>('select private.claim_daily_reward($1,$2) r',[u,at]).then(x=>Number(x.rows[0].r));
    expect(await claim('2026-10-25 23:30+01')).toBe(25);
    expect(await claim('2026-10-25 23:59+01')).toBe(0);
    expect(await claim('2026-10-26 00:01+01')).toBe(25);
    expect(await claim('2026-10-25 22:59+00')).toBe(0); // 23:59 à Paris, déjà crédité
  });
});
