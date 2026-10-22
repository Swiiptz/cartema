import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let cam:string;let ane:string;let admin:string;
const RARE=['Rare','Très rare','Épique','Légendaire','Mythique'];
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});ane=await seedEdition(db,{prefix:'ANX',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['intendant']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z',handle:true});await credit(db,id,5000);
  await db.query('update public.booster_balances set free_count=0,purchased_count=0 where owner_id=$1',[id]);return id;}
const reserve=async(u:string)=>{const s=await rpc(db,u,'get_player_state');return {free:s.boosters.free,bonus:s.boosters.purchased,
  ed:Object.fromEntries(s.editions.filter((e:any)=>!e.teaser).map((e:any)=>[e.prefix,e.reserve]))};};
const open=(u:string,ed:string)=>rpc(db,u,'open_booster',[ed,randomUUID()]);

describe('boutique par édition',()=>{
  it('achète au prix de l’édition et range les boosters dans sa réserve',async()=>{
    await rpc(db,admin,'admin_set_edition_shop',[ane,false,'alpes',{'1':300,'3':800},'Prix ANX']);
    const u=await player();
    await rpc(db,u,'buy_boosters',[1,randomUUID(),ane]);
    await rpc(db,u,'buy_boosters',[1,randomUUID(),cam]); // prix généraux
    const {rows}=await db.query<{p:string;e:string}>(`select price p,edition_id e from public.shop_orders where owner_id=$1 order by created_at`,[u]);
    expect(rows.map(r=>Number(r.p))).toEqual([300,500]);
    expect(await reserve(u)).toMatchObject({free:0,bonus:0,ed:{CAM:1,ANX:1}});
    await expectError(rpc(db,u,'buy_boosters',[10,randomUUID(),ane]),/invalid_offer/); // pas de lot de 10 pour ANX
    const s=await rpc(db,u,'get_player_state');
    expect(s.editions.find((e:any)=>e.prefix==='ANX')).toMatchObject({theme:'alpes',offers:{'1':300,'3':800},reserve:1});
  });
  it('ouvre les gratuits, puis ceux de l’édition, puis les récompenses',async()=>{
    const u=await player();
    await db.query('update public.booster_balances set free_count=1,purchased_count=1 where owner_id=$1',[u]);
    await rpc(db,u,'buy_boosters',[1,randomUUID(),ane]);
    expect((await open(u,cam)).pool).toBe('free');
    await expectError(rpc(db,u,'open_booster',[cam,randomUUID(),'edition']),/no_booster_available/); // achat ANX ≠ CAM
    expect((await open(u,ane)).pool).toBe('edition');
    expect((await open(u,cam)).pool).toBe('purchased'); // récompense : toute édition
    await expectError(open(u,cam),/no_booster_available/);
    expect(await reserve(u)).toMatchObject({free:0,bonus:0,ed:{ANX:0}});
  });
  it('refuse des prix invalides',async()=>{
    await expectError(rpc(db,admin,'admin_set_edition_shop',[ane,false,'alpes',{'3':800},'x']),/invalid_offer/);
    await expectError(rpc(db,admin,'admin_set_edition_shop',[ane,false,'alpes',{'1':-5},'x']),/invalid_offer/);
    await rpc(db,admin,'admin_set_edition_shop',[ane,false,'alpes',null,'Retour aux prix généraux']);
    const u=await player();await rpc(db,u,'buy_boosters',[1,randomUUID(),ane]);
    expect(Number((await db.query<{p:string}>('select price p from public.shop_orders where owner_id=$1',[u])).rows[0].p)).toBe(500);
  });
});

describe('édition annoncée (Soon)',()=>{
  it('montre seulement son nom et son sachet',async()=>{
    const {rows:[ed]}=await db.query<{id:string}>(`insert into public.editions (name,prefix,album_published,packs_enabled) values ('Anarchs','ANE',false,false) returning id`);
    await db.query(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,1,'Secret ANE 1','Rare','published')`,[ed.id]);
    const u=await player();
    let s=await rpc(db,u,'get_player_state');
    expect(s.editions.some((e:any)=>e.id===ed.id)).toBe(false);
    await rpc(db,admin,'admin_set_edition_shop',[ed.id,true,'alpes',null,'Annonce']);
    s=await rpc(db,u,'get_player_state');
    expect(s.editions.find((e:any)=>e.id===ed.id)).toEqual({id:ed.id,name:'Anarchs',prefix:'ANE',teaser:true,openable:false,theme:'alpes'});
    expect(JSON.stringify(s)).not.toMatch(/Secret/);
    await expectError(open(u,ed.id),/edition_unavailable/);
    await expectError(rpc(db,u,'buy_boosters',[1,randomUUID(),ed.id]),/edition_unavailable/);
  });
});

describe('God booster',()=>{
  it('est garanti tous les 2 000 boosters ouverts dans le jeu (23/10)',async()=>{
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Test : seulement la garantie']);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({guarantee_every:2000});
    const u=await player();await db.query('update public.booster_balances set purchased_count=3 where owner_id=$1',[u]);
    await db.query(`select setval('private.pack_opening_seq',3998)`); // 3 999e ouverture, puis la 4 000e
    expect((await open(u,cam)).god).toBe(false);
    const g=await open(u,cam);
    expect(g.god).toBe(true);
    expect(g.cards.every((c:any)=>c.finish==='Dorée')).toBe(true);
    expect((await open(u,cam)).god).toBe(false);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({total_opened:4001,next_guaranteed:1999});
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Test : sans garantie',0]);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({guarantee_every:0,next_guaranteed:null});
  });

  it('donne des cartes dorées, plus de Rares et le signale',async()=>{
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : toujours']);
    const u=await player();await db.query('update public.booster_balances set purchased_count=3 where owner_id=$1',[u]);
    for(let i=0;i<3;i++){
      const o=await open(u,cam);
      expect(o.god).toBe(true);
      const cards=[...o.cards].sort((a:any,b:any)=>a.position-b.position);
      expect(cards.every((c:any)=>c.finish==='Dorée')).toBe(true);
      expect(cards.slice(2).every((c:any)=>RARE.includes(c.rarity))).toBe(true); // cartes 3, 4 et 5
    }
    await rpc(db,admin,'admin_save_god_settings',[1,100,20,2,'Test : Sanglante']);
    await db.query('update public.booster_balances set purchased_count=1 where owner_id=$1',[u]);
    expect((await open(u,cam)).cards.every((c:any)=>c.finish==='Sanglante')).toBe(true);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({odds:1,blood_pct:100,opened:5});
    await rpc(db,admin,'admin_save_god_settings',[0,10,20,2,'Test : jamais']);
    await db.query('update public.booster_balances set purchased_count=1 where owner_id=$1',[u]);
    expect((await open(u,cam)).god).toBe(false);
  });
  it('fait tomber les versions alternatives bien plus souvent',async()=>{
    const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=1`,[cam]);
    const art=await rpc<string>(db,admin,'admin_add_card_art',[c.id,'/illustrations/CAM/god.webp',{},'Version God','Test']);
    const pick=async(cap:number|null)=>(await db.query<{a:string|null}>('select private.pick_alternate_art($1,0,$2) a',[c.id,cap])).rows[0].a;
    expect(await pick(null)).toBeNull();      // chance globale à 0 : jamais hors God booster
    expect(await pick(1)).toBe(art);          // God booster réglé à « 1 sur 1 »
    await rpc(db,admin,'admin_set_art_line',['Version God',true,0,'Ligne coupée']);
    expect(await pick(1)).toBeNull();         // une ligne à 0 ne tombe jamais, même en God booster
  });
});
