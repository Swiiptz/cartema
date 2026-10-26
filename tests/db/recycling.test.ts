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
  it('traite les versions d’illustration comme les finitions rares (26/10)',async()=>{
    const u=await createUser(db);const c=await charId('Très rare');
    const {rows:[art]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'alternate','Version test','/illustrations/CAM/version-test.webp') returning id`,[c]);
    // Une version plus ancienne que l'exemplaire normal : elle ne doit ni partir ni compter comme l'exemplaire gardé.
    const [alt,alt2]=await give(u,'Très rare','Standard',2);
    await db.query(`update public.inventory_items set art_id=$1 where id = any($2)`,[art.id,[alt,alt2]]);
    const normal=await give(u,'Très rare','Standard',2);
    expect(await rpc(db,u,'preview_duplicates',[])).toMatchObject({count:1});
    expect((await rpc(db,u,'recycle_duplicates',[randomUUID()])).count).toBe(1);
    const left=await asUser<{id:string}>(db,u,`select id from public.inventory_items where recycled_at is null`);
    expect(left.map(x=>x.id).sort()).toEqual([alt,alt2,normal[0]].sort());
    // Recyclage manuel : confirmation demandée, comme pour une Dorée ou une Sanglante.
    await expectError(rpc(db,u,'recycle_cards',[[alt],randomUUID()]),/confirm_special_finish/);
    expect((await rpc(db,u,'recycle_cards',[[alt],randomUUID(),true])).count).toBe(1);
  });
});

describe('restitution des versions recyclées par lot (26/10)',()=>{
  it('rend la version, reprend les Deniers, prévient une seule fois',async()=>{
    const u=await createUser(db);const c=await charId('Rare');
    const {rows:[art]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'alternate','Version perdue','/illustrations/CAM/version-perdue.webp') returning id`,[c]);
    const [alt]=await give(u,'Rare');await db.query(`update public.inventory_items set art_id=$1 where id=$2`,[art.id,alt]);
    const [other]=await give(u,'Commun');
    const [alone]=await give(u,'Rare');await db.query(`update public.inventory_items set art_id=$1 where id=$2`,[art.id,alone]);
    // Version redevenue l'illustration officielle : rien à rendre.
    const p=await charId('Peu commun');await db.query(`update public.characters set art_path='/illustrations/CAM/officielle.webp' where id=$1`,[p]);
    const {rows:[same]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path,active) values ($1,'legacy','Illustration d’origine','/illustrations/CAM/officielle.webp',false) returning id`,[p]);
    const [old]=await give(u,'Peu commun');await db.query(`update public.inventory_items set art_id=$1 where id=$2`,[same.id,old]);
    // Lot de doublons (plusieurs personnages d'un coup) : involontaire. Recyclage d'une seule carte : voulu.
    const lot=await rpc(db,u,'recycle_cards',[[alt,other,old],randomUUID(),true]);
    await rpc(db,u,'recycle_cards',[[alone],randomUUID(),true]);
    const before=await balance(u);
    const r=await db.query<{r:any}>('select private.restore_bulk_recycled_versions() r');
    expect(r.rows[0].r).toMatchObject({players:1,cards:1});
    const {rows:back}=await db.query<{art_id:string;finish:string}>(`select art_id,finish from public.inventory_items where owner_id=$1 and recycled_at is null`,[u]);
    expect(back).toEqual([{art_id:art.id,finish:'Standard'}]);
    expect(await balance(u)).toBe(before-40); // valeur de recyclage d'une Rare Standard
    expect(lot.total).toBeGreaterThan(40);
    // Fenêtre unique : visible jusqu'à ce que le joueur la ferme.
    const notice=await rpc(db,u,'get_player_notice');
    expect(notice).toMatchObject({kind:'versions_restored',payload:{deniers:40,cards:[{version:'Version perdue',rarity:'Rare'}]}});
    expect(await rpc(db,u,'get_player_notice')).toMatchObject({id:notice.id});
    await rpc(db,u,'dismiss_player_notice',[notice.id]);
    expect(await rpc(db,u,'get_player_notice')).toBeNull();
    await expectError(rpc(db,await createUser(db),'dismiss_player_notice',[notice.id]),/not_found/);
    // Relancer ne rend rien de plus.
    expect((await db.query<{r:any}>('select private.restore_bulk_recycled_versions() r')).rows[0].r).toMatchObject({players:0,cards:0});
  });
  it('ne fait jamais passer un solde sous zéro',async()=>{
    const u=await createUser(db);const c=await charId('Très rare');
    const {rows:[art]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'alternate','Version fauchée','/illustrations/CAM/version-fauchee.webp') returning id`,[c]);
    const [alt]=await give(u,'Très rare');await db.query(`update public.inventory_items set art_id=$1 where id=$2`,[art.id,alt]);
    const [other]=await give(u,'Commun');
    await rpc(db,u,'recycle_cards',[[alt,other],randomUUID(),true]);
    const b=await balance(u);
    await db.query(`select private.apply_wallet_delta($1,$2,'test','test',null,'vider')`,[u,-b]);
    await db.query('select private.restore_bulk_recycled_versions()');
    expect(await balance(u)).toBe(0);
    expect((await rpc(db,u,'get_player_notice')).payload.deniers).toBe(0);
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
