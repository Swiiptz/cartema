import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,asUser,createUser,credit,seedEdition,expectError,RARITIES,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:2});},30000);

async function giveFree(user:string,n:number){
  await db.query('update public.booster_balances set free_count=$2 where owner_id=$1',[user,n]);
}
async function boosters(user:string){
  const {rows:[b]}=await db.query<{free_count:number;purchased_count:number}>(
    'select free_count,purchased_count from public.booster_balances where owner_id=$1',[user]);
  return b;
}
async function balance(user:string){
  const {rows:[w]}=await db.query<{balance:string}>('select balance from public.wallets where owner_id=$1',[user]);
  return Number(w.balance);
}

describe('boutique',()=>{
  it('vend 1/3/10 boosters à 500/1 400/4 500 Deniers',async()=>{
    const u=await createUser(db);await credit(db,u,6400);
    await rpc(db,u,'buy_boosters',[1,randomUUID()]);
    await rpc(db,u,'buy_boosters',[3,randomUUID()]);
    const r=await rpc(db,u,'buy_boosters',[10,randomUUID()]);
    expect(r).toMatchObject({balance:0,purchased:14,replayed:false});
    const {rows}=await db.query(`select sum(delta)::int s from public.wallet_ledger where owner_id=$1 and kind='shop_booster'`,[u]);
    expect(rows[0]).toEqual({s:-6400});
  });
  it('refuse une offre inexistante et un solde insuffisant sans effet',async()=>{
    const u=await createUser(db);await credit(db,u,499);
    await expectError(rpc(db,u,'buy_boosters',[2,randomUUID()]),/invalid_offer/);
    await expectError(rpc(db,u,'buy_boosters',[1,randomUUID()]),/insufficient_funds/);
    expect(await balance(u)).toBe(499);
    expect((await boosters(u)).purchased_count).toBe(0);
    expect((await db.query('select * from public.shop_orders where owner_id=$1',[u])).rows).toEqual([]);
  });
  it('ne débite qu’une fois une requête répétée',async()=>{
    const u=await createUser(db);await credit(db,u,1000);
    const req=randomUUID();
    await rpc(db,u,'buy_boosters',[1,req]);
    const again=await rpc(db,u,'buy_boosters',[1,req]);
    expect(again).toMatchObject({replayed:true,balance:500,purchased:1});
  });
  it('bloque l’achat sans édition ouvrable',async()=>{
    const solo=await createDb();
    const u=await createUser(solo);await credit(solo,u,500);
    await seedEdition(solo,{skip:['Mythique'],enable:false});
    await expectError(rpc(solo,u,'buy_boosters',[1,randomUUID()]),/no_openable_edition/);
  },30000);
});

describe('ouverture',()=>{
  it('débite un booster et crée exactement 5 exemplaires tracés',async()=>{
    const u=await createUser(db);await giveFree(u,1);
    const r=await rpc(db,u,'open_booster',[edition,randomUUID()]);
    expect(r.replayed).toBe(false);
    expect(r.pool).toBe('free');
    expect(r.ruleset_version).toBe(1);
    expect(r.cards).toHaveLength(5);
    expect(r.cards.map((c:any)=>c.position)).toEqual([1,2,3,4,5]);
    expect(['Rare','Très rare','Épique','Légendaire','Mythique']).toContain(r.cards[4].rarity);
    expect((await boosters(u)).free_count).toBe(0);
    const inv=await asUser(db,u,'select id,origin_opening_id from public.inventory_items');
    expect(inv).toHaveLength(5);
    expect(new Set(inv.map((i:any)=>i.origin_opening_id))).toEqual(new Set([r.opening_id]));
    const hist=await asUser(db,u,'select * from public.pack_opening_cards');
    expect(hist).toHaveLength(5);
  });
  it('rejoue le même résultat pour une même requête, sans nouveau débit',async()=>{
    const u=await createUser(db);await giveFree(u,2);
    const req=randomUUID();
    const a=await rpc(db,u,'open_booster',[edition,req]);
    const b=await rpc(db,u,'open_booster',[edition,req]);
    expect(b.replayed).toBe(true);
    expect(b.cards).toEqual(a.cards);
    expect((await boosters(u)).free_count).toBe(1);
    expect(await rpc(db,u,'get_opening',[a.opening_id])).toMatchObject({opening_id:a.opening_id});
  });
  it('refuse une seconde ouverture quand il ne reste aucun booster',async()=>{
    const u=await createUser(db);await giveFree(u,1);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    await expectError(rpc(db,u,'open_booster',[edition,randomUUID()]),/no_booster_available/);
    expect((await db.query('select count(*)::int n from public.pack_openings where owner_id=$1',[u])).rows[0]).toEqual({n:1});
  });
  it('utilise les gratuits d’abord, puis les achetés',async()=>{
    const u=await createUser(db);await giveFree(u,1);
    await db.query('update public.booster_balances set purchased_count=1 where owner_id=$1',[u]);
    expect((await rpc(db,u,'open_booster',[edition,randomUUID()])).pool).toBe('free');
    expect((await rpc(db,u,'open_booster',[edition,randomUUID()])).pool).toBe('purchased');
  });
  it('enregistre la découverte et sa récompense une seule fois par personnage',async()=>{
    const u=await createUser(db);await giveFree(u,6);
    for(let i=0;i<6;i++) await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const {rows:[d]}=await db.query<{n:number}>('select count(*)::int n from public.discoveries where owner_id=$1',[u]);
    const {rows:[l]}=await db.query<{n:number;s:number}>(
      `select count(*)::int n, coalesce(sum(delta),0)::int s from public.wallet_ledger where owner_id=$1 and kind='discovery_reward'`,[u]);
    expect(l.n).toBe(d.n);
    expect(l.s).toBe(d.n*10);
    expect(await balance(u)).toBe(d.n*10);
  });
  it('refuse l’ouverture d’une édition devenue incomplète, sans débit',async()=>{
    const ed=await seedEdition(db,{prefix:'INC'});
    const u=await createUser(db);await giveFree(u,1);
    await db.query(`update public.characters set status='archived' where edition_id=$1 and rarity='Mythique'`,[ed]);
    await expectError(rpc(db,u,'open_booster',[ed,randomUUID()]),/edition_incomplete/);
    expect((await boosters(u)).free_count).toBe(1);
  });
  it('refuse d’activer les boosters d’une édition incomplète',async()=>{
    for(const missing of RARITIES){
      const ed=await seedEdition(db,{prefix:`M${RARITIES.indexOf(missing)}`,skip:[missing],enable:false});
      await expectError(db.query('update public.editions set packs_enabled=true where id=$1',[ed]),/edition_incomplete/);
    }
  });
  it('refuse une édition non activée',async()=>{
    const ed=await seedEdition(db,{prefix:'OFF',enable:false});
    const u=await createUser(db);await giveFree(u,1);
    await expectError(rpc(db,u,'open_booster',[ed,randomUUID()]),/edition_unavailable/);
  });
});

describe('règles de tirage',()=>{
  it('refuse une table dont le total n’est pas 100 %',async()=>{
    await expectError(db.query(`insert into public.pack_rulesets (version,slots,finishes) select 2,
      jsonb_set(slots,'{0,0,weight}','69999'),finishes from public.pack_rulesets where version=1`),/total 99999/);
  });
  it('refuse un 5e emplacement pouvant donner moins que Rare',async()=>{
    await expectError(db.query(`insert into public.pack_rulesets (version,slots,finishes) select 2,
      jsonb_set(slots,'{4,0,value}','"Commun"'),finishes from public.pack_rulesets where version=1`),/emplacement 5 valeur interdite/);
  });
  it('fige une version utilisée',async()=>{
    await expectError(db.query(`update public.pack_rulesets set finishes='[{"value":"Standard","weight":100000}]'`),/immutable_ruleset/);
  });
  it('respecte les pondérations validées (5e emplacement et finitions)',async()=>{
    const N=20000;
    const {rows}=await db.query<{v:string;n:number}>(
      `select v, count(*)::int n from (select private.pick_weighted(slots->4) v from public.pack_rulesets, generate_series(1,$1) where version=1) x group by v`,[N]);
    const freq=Object.fromEntries(rows.map(r=>[r.v,r.n/N]));
    expect(Object.keys(freq).every(k=>['Rare','Très rare','Épique','Légendaire','Mythique'].includes(k))).toBe(true);
    expect(freq['Rare']).toBeGreaterThan(0.53);expect(freq['Rare']).toBeLessThan(0.57);
    expect(freq['Très rare']).toBeGreaterThan(0.35);expect(freq['Très rare']).toBeLessThan(0.39);
    const {rows:f}=await db.query<{n:number}>(
      `select count(*)::int n from (select private.pick_weighted(finishes) v from public.pack_rulesets, generate_series(1,$1) where version=1) x where v='Standard'`,[N]);
    expect(f[0].n/N).toBeGreaterThan(0.97);
  },30000);
  it('tire un entier uniforme sans sortir des bornes',async()=>{
    const {rows}=await db.query<{lo:number;hi:number;k:number}>(
      `select min(r)::int lo, max(r)::int hi, count(distinct r)::int k from (select private.random_below(7) r from generate_series(1,5000)) x`);
    expect(rows[0]).toEqual({lo:0,hi:6,k:7});
  });
});

describe('album',()=>{
  it('ne révèle aucune identité de carte non découverte',async()=>{
    const u=await createUser(db);await giveFree(u,1);
    const opened=await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const album=await rpc<any[]>(db,u,'get_album',[edition]);
    expect(album).toHaveLength(14);
    const known=album.filter(c=>c.known);
    const unknown=album.filter(c=>!c.known);
    expect(new Set(known.map(c=>c.character_id))).toEqual(new Set(opened.cards.map((c:any)=>c.character_id)));
    for(const c of unknown){
      expect(Object.keys(c).sort()).toEqual(['code','edition_id','known','number','rarity','silhouette_key','unique']);
    }
    expect(JSON.stringify(unknown)).not.toMatch(/Perso/);
    const owned=known.reduce((s,c)=>s+Object.values(c.owned as Record<string,number>).reduce((a,b)=>a+b,0),0);
    expect(owned).toBe(5);
    expect(album.map(c=>c.number)).toEqual([...Array(14)].map((_,i)=>i+1));
  });
  it('attribue et conserve une silhouette par personnage',async()=>{
    const {rows}=await db.query<{n:number}>(`select count(*)::int n from public.characters where silhouette_key is null`);
    expect(rows[0].n).toBe(0);
    await expectError(db.query(`update public.characters set silhouette_key='gravure-0' where silhouette_key<>'gravure-0'`),/silhouette déjà attribuée/);
    await expectError(db.query(`update public.characters set rarity='Mythique' where rarity='Commun'`),/immutable_character/);
  });
});
