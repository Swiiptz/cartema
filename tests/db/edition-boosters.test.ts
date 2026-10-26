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
  it('est garanti au N-ième booster d’un joueur depuis son dernier God booster, sans compteur visible (23/10)',async()=>{
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Test : garantie tous les 3',3]);
    const u=await player();const v=await player();
    await db.query('update public.booster_balances set purchased_count=10 where owner_id = any($1)',[[u,v]]);
    // Compteur propre à chaque joueur : 3e ouverture de u = God, les ouvertures de v ne comptent pas pour u.
    expect((await open(u,cam)).god).toBe(false);
    expect((await open(v,cam)).god).toBe(false);
    expect((await open(u,cam)).god).toBe(false);
    const g=await open(u,cam);
    expect(g.god).toBe(true);
    expect(g.cards.every((c:any)=>c.finish==='Dorée')).toBe(true);
    expect((await open(u,cam)).god).toBe(false); // repart à zéro
    // Un God booster tombé par chance remet aussi le compteur à zéro.
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : toujours']);
    expect((await open(v,cam)).god).toBe(true);
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Test : garantie seule']);
    expect((await open(v,cam)).god).toBe(false);
    expect((await open(v,cam)).god).toBe(false);
    expect((await open(v,cam)).god).toBe(true);
    // Caché aux joueurs ; l'admin voit qui en est le plus proche.
    expect(JSON.stringify(await rpc(db,u,'get_player_state'))).not.toMatch(/guarantee|pity|garant/i);
    const s=await rpc<any>(db,admin,'admin_god_settings');
    expect(s.guarantee_every).toBe(3);
    expect(s.closest.length).toBeGreaterThan(0);
    expect(s.closest.every((x:any)=>x.remaining===Math.max(3-x.since,1))).toBe(true);
    expect(s.closest.map((x:any)=>x.remaining)).toEqual([...s.closest.map((x:any)=>x.remaining)].sort((a:number,b:number)=>a-b));
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Test : sans garantie',0]);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({guarantee_every:0});
  });

  it('multiplie les Légendaires et Mythiques de sa table, les autres raretés réduites en proportion (23/10)',async()=>{
    const table=[{value:'Rare',weight:55000},{value:'Très rare',weight:37000},{value:'Épique',weight:6000},{value:'Légendaire',weight:1900},{value:'Mythique',weight:100}];
    const boost=async(m:number)=>(await db.query<{t:{value:string;weight:number}[]}>('select private.boost_top_rarities($1::jsonb,$2) t',[JSON.stringify(table),m])).rows[0].t;
    const x5=await boost(5);
    expect(x5.reduce((s,r)=>s+Number(r.weight),0)).toBe(100000);
    expect(x5.find(r=>r.value==='Légendaire')!.weight).toBe(9500);
    expect(x5.find(r=>r.value==='Mythique')!.weight).toBe(500);
    expect(x5.find(r=>r.value==='Rare')!.weight).toBeLessThan(55000);
    expect(await boost(1)).toEqual(table);
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : ×20',null,20]);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({legend_mult:20});
    const u=await player();await db.query('update public.booster_balances set purchased_count=1 where owner_id=$1',[u]);
    expect((await open(u,cam)).god).toBe(true);
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : ×5',null,5]);
    await expectError(rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : trop',null,50]),/check|violates/);
  });

  it('tire des personnages à skin et de vrais skins, jamais une ancienne officielle (27/10)',async()=>{
    const gds=await seedEdition(db,{prefix:'GDS',perRarity:2});
    // Dans chaque rareté, un seul des deux personnages a un skin ; tous ont une ancienne officielle active.
    const {rows:chars}=await db.query<{id:string;rarity:string;skinned:boolean}>(
      `select id,rarity,row_number() over (partition by rarity order by number)=1 skinned from public.characters where edition_id=$1`,[gds]);
    const skins=new Set<string>();
    for(const c of chars){
      await db.query(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'legacy','Illustration d’origine','/illustrations/GDS/old.webp')`,[c.id]);
      if(c.skinned){const {rows:[a]}=await db.query<{id:string}>(`insert into public.card_arts (character_id,kind,label,art_path) values ($1,'alternate','Skin GDS','/illustrations/GDS/skin.webp') returning id`,[c.id]);skins.add(a.id);}
    }
    const skinned=new Set(chars.filter(c=>c.skinned).map(c=>c.id));
    expect((await db.query<{r:string[]|null}>('select private.with_skin($1::uuid[]) r',[chars.filter(c=>!c.skinned).map(c=>c.id)])).rows[0].r).toBeNull();
    // Poids : un personnage à skin compte 3 fois.
    const [a,b]=chars;
    expect((await db.query<{r:string[]}>('select private.skin_weighted($1::uuid[],$2::uuid[],3) r',[[a.id,b.id],[a.id]])).rows[0].r.filter(x=>x===a.id)).toHaveLength(3);
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : emplacements',null,null,2,3,2]);
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({skin_slots:2,skin_weight:3,plain_slots:2});
    const u=await player();await db.query('update public.booster_balances set purchased_count=30 where owner_id=$1',[u]);
    let lowSkin=false;
    for(let i=0;i<30;i++){
      const o=await open(u,gds);
      expect(o.god).toBe(true);
      const {rows}=await db.query<{position:number;character_id:string;art_id:string|null}>(
        'select position,character_id,art_id from public.pack_opening_cards where opening_id=$1 and position<=5',[o.opening_id]);
      // 2 cartes à skin garanti et 2 cartes sans skin, placées au hasard ; jamais d'ancienne officielle.
      const withSkin=rows.filter(r=>r.art_id!==null);
      expect(withSkin.every(r=>skins.has(r.art_id!)&&skinned.has(r.character_id))).toBe(true);
      expect(withSkin.length).toBeGreaterThanOrEqual(2);
      expect(rows.length-withSkin.length).toBeGreaterThanOrEqual(2);
      if(withSkin.some(r=>r.position<=2))lowSkin=true;
    }
    // Les skins ne sont pas réservés aux Rares ou mieux (cartes 3 à 5) : ils tombent aussi sur les cartes 1 et 2.
    expect(lowSkin).toBe(true);
    await expectError(rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : trop',null,null,6,3]),/check|violates/);
    await expectError(rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : trop',null,null,3,3,3]),/check|violates/);
    // Hors God booster, l'ancienne officielle peut toujours tomber.
    const {rows:[{n}]}=await db.query<{n:number}>(`select count(*)::int n from public.card_arts a where a.kind='legacy' and a.label='Illustration d’origine'
      and private.pick_alternate_art(a.character_id,1) = a.id and a.character_id = any($1::uuid[])`,[chars.filter(c=>!c.skinned).map(c=>c.id)]);
    expect(n).toBe(chars.length/2);
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
    expect(await rpc(db,admin,'admin_god_settings')).toMatchObject({odds:1,blood_pct:100,opened:38});
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

describe('cartes garanties (pitié cachée)',()=>{
  it('force une Épique au N-ième booster sans Épique, une Légendaire au N-ième sans Légendaire (23/10)',async()=>{
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God',0]);
    // Tirage normal quasi sans Épique ni mieux : seules les garanties en donnent.
    const {rows:[r]}=await db.query<{id:string;slots:any}>('select id,slots from public.pack_rulesets where id=(private.active_ruleset()).id');
    const flat=JSON.parse(JSON.stringify(r.slots));
    flat[3]=[{value:'Peu commun',weight:100000}];
    // Épique et mieux presque impossibles (3 sur 100 000) : la garantie garde ces proportions entre elles.
    flat[4]=[{value:'Rare',weight:99997},{value:'Épique',weight:1},{value:'Légendaire',weight:1},{value:'Mythique',weight:1}];
    // Table de tirage figée par un déclencheur : modifiée directement pour ce test seulement.
    const setSlots=async(s:unknown)=>{await db.query(`set session_replication_role = replica`);
      try{await db.query('update public.pack_rulesets set slots=$2 where id=$1',[r.id,JSON.stringify(s)]);}finally{await db.query(`set session_replication_role = origin`);}};
    await setSlots(flat);
    try{
      const TOP=['Épique','Légendaire','Mythique'];
      const fifth=(o:any)=>o.cards.find((c:any)=>c.position===5).rarity;
      await rpc(db,admin,'admin_save_settings',[{pity_epic_every:3,pity_legend_every:0},'Épique au 3e']);
      const u=await player();await db.query('update public.booster_balances set purchased_count=10 where owner_id=$1',[u]);
      expect(fifth(await open(u,cam))).toBe('Rare');
      expect(fifth(await open(u,cam))).toBe('Rare');
      expect(TOP).toContain(fifth(await open(u,cam)));   // 3e sans Épique : garantie
      expect(fifth(await open(u,cam))).toBe('Rare');     // compteur remis à zéro
      await rpc(db,admin,'admin_save_settings',[{pity_epic_every:0,pity_legend_every:2},'Légendaire au 2e']);
      const v=await player();await db.query('update public.booster_balances set purchased_count=10 where owner_id=$1',[v]);
      expect(fifth(await open(v,cam))).toBe('Rare');
      expect(['Légendaire','Mythique']).toContain(fifth(await open(v,cam)));
      // Caché aux joueurs.
      expect(JSON.stringify(await rpc(db,v,'get_player_state'))).not.toMatch(/pity/);
      await expectError(rpc(db,admin,'admin_save_settings',[{pity_epic_every:-1},'Négatif']),/invalid_setting/);
    }finally{
      await setSlots(r.slots);
      await rpc(db,admin,'admin_save_settings',[{pity_epic_every:25,pity_legend_every:100},'Retour aux valeurs']);
    }
  });
});

describe('pastille « Nouveau »',()=>{
  it('marque les cartes découvertes par cette ouverture, une seule fois par personnage (25/10)',async()=>{
    await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God',0]);
    const u=await player();await db.query('update public.booster_balances set purchased_count=3 where owner_id=$1',[u]);
    const o=await open(u,cam);
    const seen=new Set<string>();
    for(const c of [...o.cards].sort((a:any,b:any)=>a.position-b.position)){
      expect(c.new).toBe(!seen.has(c.character_id));seen.add(c.character_id);
    }
    // Un personnage déjà découvert n'est plus nouveau.
    const o2=await open(u,cam);
    for(const c of o2.cards)if(seen.has(c.character_id))expect(c.new).toBe(false);
  });
});
