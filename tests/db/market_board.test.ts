import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let viewer:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:2});viewer=await player('regard');await credit(db,viewer,5000);},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
async function character(rarity:string,nth=0){return (await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 order by number offset $3 limit 1`,[edition,rarity,nth])).rows[0].id;}
async function give(owner:string,char:string,finish='Standard',art:string|null=null){
  return (await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish,art_id) values ($1,$2,$3,$4) returning id`,[owner,char,finish,art])).rows[0].id;
}
const sell=async(owner:string,char:string,price:number,finish='Standard',art:string|null=null)=>(await rpc(db,owner,'create_listing',[await give(owner,char,finish,art),price,randomUUID()])).listing_id;
const board=(args:Record<string,unknown>={})=>{
  const a={kind:'fixed',rarity:null,finish:null,query:null,clan:null,undiscovered:false,sort:null,limit:48,offset:0,...args};
  return rpc(db,viewer,'get_market_board',[a.kind,a.rarity,a.finish,a.query,a.clan,a.undiscovered,a.sort,a.limit,a.offset]);
};

describe('marché regroupé',()=>{
  it('regroupe les offres d’une même carte, du moins cher au plus cher',async()=>{
    const a=await player('vend_a');const b=await player('vend_b');const rare=await character('Rare');
    await sell(a,rare,120);await sell(b,rare,80);await sell(a,rare,100);
    await sell(a,rare,500,'Dorée'); // autre finition : autre entrée
    const r=await board({rarity:'Rare'});
    const std=r.items.find((g:any)=>g.card.character_id===rare&&g.finish==='Standard');
    expect([std.offers,std.min_price]).toEqual([3,80]);
    expect(std.listings.map((l:any)=>[l.price,l.seller])).toEqual([[80,'vend_b'],[100,'vend_a'],[120,'vend_a']]);
    expect(std.listings[0].buyer_tax).toBe(4);
    expect(r.items.filter((g:any)=>g.card.character_id===rare)).toHaveLength(2);
    // Acheter l'offre la moins chère.
    await rpc(db,viewer,'buy_listing',[std.listings[0].listing_id]);
    const after=(await board({rarity:'Rare'})).items.find((g:any)=>g.card.character_id===rare&&g.finish==='Standard');
    expect([after.offers,after.min_price]).toEqual([2,100]);
  });
  it('sépare et affiche les versions alternatives',async()=>{
    const s=await player('vend_alt');const ch=await character('Peu commun');
    const {rows:[art]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'alternate','Paint','/illustrations/x.png') returning id`,[ch]);
    await sell(s,ch,30);await sell(s,ch,300,'Standard',art.id);
    const groups=(await board({rarity:'Peu commun'})).items.filter((g:any)=>g.card.character_id===ch);
    expect(groups.map((g:any)=>g.card.variant??null).sort()).toEqual(['Paint',null]);
    expect(groups.find((g:any)=>g.card.variant==='Paint').card.art_path).toBe('/illustrations/x.png');
  });
  it('propose tous les clans des albums publiés, même sans annonce, avec leur nombre d’annonces (23/10)',async()=>{
    const {rows:[seth]}=await db.query<{id:string}>(`insert into public.clans (name) values ('Sethite') returning id`);
    await db.query('update public.characters set clan_id=$1 where id=$2',[seth.id,await character('Rare',1)]);
    // Un clan qui n'a de membres que dans un album non publié reste caché.
    const {rows:[hid]}=await db.query<{id:string}>(`insert into public.clans (name) values ('Clan caché') returning id`);
    const other=await seedEdition(db,{prefix:'HID',perRarity:1});
    await db.query('update public.editions set album_published=false where id=$1',[other]);
    await db.query('update public.characters set clan_id=$1 where edition_id=$2',[hid.id,other]);
    const clans=(await board()).clans;
    expect(clans).toContainEqual({id:seth.id,name:'Sethite',listings:0});
    expect(clans.some((c:any)=>c.id===hid.id)).toBe(false);
  });
  it('filtre par clan, recherche et cartes non découvertes, et trie',async()=>{
    const s=await player('vend_f');const epic=await character('Épique');const epic2=await character('Épique',1);
    await sell(s,epic,900);await sell(s,epic2,400);
    const {rows:[clan]}=await db.query<{id:string}>(`insert into public.clans (name) values ('Toréador') returning id`);
    await db.query('update public.characters set clan_id=$1 where id=$2',[clan.id,epic]);
    const {rows:[c]}=await db.query<{name:string}>('select name from public.characters where id=$1',[epic]);
    expect((await board({clan:clan.id})).items.map((g:any)=>g.card.character_id)).toEqual([epic]);
    expect((await board()).clans).toContainEqual({id:clan.id,name:'Toréador',listings:1});
    expect((await board({query:c.name.slice(0,4).toUpperCase()})).items.some((g:any)=>g.card.character_id===epic)).toBe(true);
    const asc=(await board({rarity:'Épique',sort:'price_asc'})).items.map((g:any)=>g.min_price);
    expect(asc).toEqual([...asc].sort((x:number,y:number)=>x-y));
    const desc=(await board({rarity:'Épique',sort:'price_desc'})).items.map((g:any)=>g.min_price);
    expect(desc).toEqual([...desc].sort((x:number,y:number)=>y-x));
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2) on conflict do nothing`,[viewer,epic]);
    const undisc=(await board({rarity:'Épique',undiscovered:true})).items.map((g:any)=>g.card.character_id);
    expect(undisc).toContain(epic2);expect(undisc).not.toContain(epic);
  });
  it('liste les enchères à part, de la plus proche de la fin à la plus lointaine',async()=>{
    const s=await player('vend_e');const ch=await character('Très rare');
    const l1=(await rpc(db,s,'create_auction',[await give(s,ch),50,24,randomUUID()])).listing_id;
    const l2=(await rpc(db,s,'create_auction',[await give(s,ch),50,12,randomUUID()])).listing_id;
    const r=await board({kind:'auction'});
    const ids=r.items.map((l:any)=>l.listing_id);
    expect(ids.indexOf(l2)).toBeLessThan(ids.indexOf(l1));
    expect((await board()).items.every((g:any)=>g.listings.every((l:any)=>l.listing_id!==l1))).toBe(true);
    await expectError(board({sort:'n_importe'}),/invalid_sort/);
  });
  it('donne le prix maximum et l’offre à acheter au-delà des 12 meilleurs prix',async()=>{
    const other=await player('vend_loin');const ch=await character('Commun',1);
    for(let p=10;p<22;p++) await sell(viewer,ch,p); // les 12 moins chères sont au joueur
    const target=await sell(other,ch,50);await sell(other,ch,70);
    const g=(await board({rarity:'Commun'})).items.find((x:any)=>x.card.character_id===ch);
    expect([g.offers,g.min_price,g.max_price,g.listings.length]).toEqual([14,10,70,12]);
    expect(g.listings.every((l:any)=>l.mine)).toBe(true);
    expect([g.best.listing_id,g.best.price,g.best.buyer_tax,g.best.seller,g.best.mine]).toEqual([target,50,2,'vend_loin',false]);
    const solo=await character('Commun');await sell(viewer,solo,15);
    expect((await board({rarity:'Commun'})).items.find((x:any)=>x.card.character_id===solo).best).toBeNull();
  });
  it('donne les prix de référence : dernières ventes, moyenne et offre la moins chère',async()=>{
    const s=await player('vend_ref');const ch=await character('Légendaire');
    const prices=(args:unknown[])=>rpc(db,viewer,'get_card_prices',args);
    expect(await prices([ch,'Standard'])).toMatchObject({sales:[],average:null,last:null,lowest:null});
    for(const p of [100,200]){const id=await sell(s,ch,p);await rpc(db,viewer,'buy_listing',[id]);}
    await sell(s,ch,900,'Dorée'); // autre finition : ne compte pas
    await sell(s,ch,350);
    const r=await prices([ch,'Standard']);
    expect(r.sales.map((x:any)=>x.price).sort()).toEqual([100,200]);
    expect([r.average,r.lowest]).toEqual([150,350]);
    // Depuis un exemplaire : même carte, même version.
    const {rows:[i]}=await db.query<{id:string}>(`select id from public.inventory_items where owner_id=$1 and character_id=$2 limit 1`,[viewer,ch]);
    expect((await prices([ch,'Standard',null,i.id])).average).toBe(150);
    expect((await prices([ch,'Dorée'])).lowest).toBe(900);
  });
  it('pagine les entrées',async()=>{
    const all=await board({limit:120});
    const page=await board({limit:2,offset:1});
    expect(page.total).toBe(all.total);
    expect(page.items.map((g:any)=>g.key)).toEqual(all.items.slice(1,3).map((g:any)=>g.key));
  });
});
