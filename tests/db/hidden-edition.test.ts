import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Une édition en préparation (album non publié, boosters fermés) ne doit rien laisser voir aux
// joueurs, même si ses cartes sont déjà marquées « publiées » dans l'admin.
let db:Db;let visible:string;let hidden:string;let player:string;
const SECRET=/ANE|Secret/;
beforeAll(async()=>{
  db=await createDb();visible=await seedEdition(db,{prefix:'CAM',perRarity:1});
  const {rows:[ed]}=await db.query<{id:string}>(`insert into public.editions (name,prefix,album_published,packs_enabled) values ('Anarchs','ANE',false,false) returning id`);
  hidden=ed.id;
  const rarities=['Commun','Peu commun','Rare','Très rare','Épique','Légendaire','Mythique'];
  for(let i=0;i<rarities.length;i++)
    await db.query(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,$2,$3,$4,'published')`,[hidden,i+1,`Secret ANE ${i+1}`,rarities[i]]);
  player=await createUser(db,{createdAt:'2026-01-01T00:00:00Z',handle:true});
},30000);

describe('édition en préparation',()=>{
  it('n’apparaît dans aucune lecture des joueurs',async()=>{
    const {rows:[p]}=await db.query<{handle:string}>('select handle from public.profiles where id=$1',[player]);
    const reads:[string,unknown[]][]=[
      ['get_album',[]],['get_album',[hidden]],['get_achievements',[]],['get_leaderboard',[50]],['get_missions',[]],
      ['get_player_state',[]],['get_market_board',['fixed']],['get_market_board',['auction']],['get_events',[]],
      ['get_wishlist',[]],['get_profile',[p.handle]],['get_history',[]],['get_showcase_candidates',[]],['get_trade_status',[]],['get_contest_gallery',[]],['get_player_notice',[]]];
    for(const [fn,args] of reads){
      const out=JSON.stringify(await rpc(db,player,fn,args).catch(e=>({error:(e as Error).message})));
      expect(out,`${fn} laisse voir l’édition cachée`).not.toMatch(SECRET);
    }
    // Le total du classement ne compte que les éditions publiées.
    expect((await rpc(db,player,'get_leaderboard',[50])).total_characters).toBe(7);
  });
  it('refuse les actions sur ses cartes',async()=>{
    await expectError(rpc(db,player,'open_booster',[hidden,randomUUID()]),/edition_unavailable/);
    // Même réponse qu'un code inexistant : rien à deviner.
    await expectError(rpc(db,player,'set_wish',['ANE-001',null,true]),/not_found/);
    await expectError(rpc(db,player,'set_wish',['ANE-099',null,true]),/not_found/);
    await expectError(rpc(db,player,'submit_card_feedback',['ANE-001','info','Indice ?']),/not_found/);
    await rpc(db,player,'set_wish',['CAM-001',null,true]); // une édition publiée reste normale
    // Publication de l'album : les cartes deviennent accessibles.
    await db.query('update public.editions set album_published=true where id=$1',[hidden]);
    expect(await rpc(db,player,'set_wish',['ANE-001',null,true])).toBe(true);
    await db.query('update public.editions set album_published=false where id=$1',[hidden]);
    await db.query(`delete from public.wishlists where owner_id=$1`,[player]);
  });
  it('reste invisible en lecture directe de la table des éditions',async()=>{
    await db.query('begin');
    try{
      await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:player,role:'authenticated'})]);
      await db.query('set local role authenticated');
      const {rows}=await db.query<{prefix:string}>('select prefix from public.editions');
      expect(rows.map(r=>r.prefix)).not.toContain('ANE');
    }finally{await db.query('rollback');}
  });
});
