import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
const ART='/illustrations/CAM/a.webp',ART2='/illustrations/CAM/b.webp',PAINT='/illustrations/CAM/paint.webp';
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['conservateur']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}
const char=async(n:number)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=$2`,[edition,n])).rows[0].id;
async function give(owner:string,n:number){const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[owner,await char(n)]);return r.id;}

describe('versions d’illustration',()=>{
  it('garde l’ancienne illustration sur les exemplaires déjà possédés',async()=>{
    const u=await player('ancien');const c=await char(2);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    const before=await give(u,2);
    await db.query(`update public.characters set art_meta='{"offsetY":5}' where id=$1`,[c]); // recadrage : pas de version
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c]))).toEqual([]);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART2]);
    const after=await give(u,2);
    const inv=await rpc<any[]>(db,u,'get_inventory',[c]);
    expect(inv.find(i=>i.instance_id===before)).toMatchObject({variant:'Illustration d’origine',variant_kind:'legacy',variant_art:ART});
    expect(inv.find(i=>i.instance_id===after).variant).toBeNull();
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2) on conflict do nothing`,[u,c]);
    const album=(await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===2);
    expect(album.art_path).toBe(ART2);
    expect(album.variants).toEqual([{label:'Illustration d’origine',kind:'legacy',art_path:ART,art_meta:{offsetY:5},credit:null,count:1}]);
    // La version suit l'exemplaire dans la vitrine.
    await rpc(db,u,'set_showcase',[[before]]);
    expect((await rpc(db,u,'get_profile',['ancien'])).showcase[0]).toMatchObject({art_path:ART,variant:'Illustration d’origine'});
  });
  it('tire une version alternative selon la chance globale',async()=>{
    const c=await char(3);
    const art=await rpc<string>(db,admin,'admin_add_card_art',[c,PAINT,{},'Version Paint','Dessin maison']);
    await rpc(db,admin,'admin_save_settings',[{alternate_art_odds:1},'Test : toujours']);
    // Ne garder que le personnage 3 dans les raretés qu'il occupe : le tirer est alors certain pour sa rareté.
    const u=await player('chanceux_paint');
    await db.query('update public.booster_balances set free_count=6 where owner_id=$1',[u]);
    let hit:any=null;
    for(let i=0;i<6&&!hit;i++){const o=await rpc(db,u,'open_booster',[edition,randomUUID()]);hit=o.cards.find((x:any)=>x.number===3)??null;}
    expect(hit).not.toBeNull(); // ~0,2 % de malchance : aucun Rare tiré en 6 boosters
    expect(hit).toMatchObject({variant:'Version Paint',variant_kind:'alternate',art_path:PAINT});
    await rpc(db,admin,'admin_set_card_art_active',[art,false,'Pause']);
    await rpc(db,admin,'admin_save_settings',[{alternate_art_odds:500},'Retour à la normale']);
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c]))[0]).toMatchObject({active:false,kind:'alternate'});
    await expectError(rpc(db,admin,'admin_add_card_art',[c,'https://evil.example/x.png',{},'x','x']),/invalid_art_path/);
  });
});

describe('contributions des joueurs',()=>{
  it('propose une illustration, l’admin accepte avec récompense, l’auteur est prévenu',async()=>{
    const u=await player('artiste');const c=await char(4);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','info','Le clan est faux.']),/not_discovered/);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','illustration','',`${randomUUID()}/x.png`]),/image_required/);
    const id=await rpc<string>(db,u,'submit_card_feedback',['CAM-004','illustration','Mon dessin',`${u}/portrait.png`]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','illustration','Encore',`${u}/b.png`]),/already_submitted/);
    await rpc(db,u,'submit_card_feedback',['CAM-004','info','Le titre est Primogène, pas Nouveau-né.']);
    const list=await rpc<any[]>(db,admin,'admin_submissions',['pending']);
    expect(list.map(s=>s.kind).sort()).toEqual(['illustration','info']);
    expect((await rpc(db,admin,'get_notifications')).items.some((n:any)=>n.kind==='submission_received')).toBe(true);
    const boosters=async()=>(await db.query<{n:number}>('select purchased_count n from public.booster_balances where owner_id=$1',[u])).rows[0].n;
    const b0=await boosters();
    await rpc(db,admin,'admin_decide_submission',[id,true,0,1,'Superbe, appliquée']);
    expect(await boosters()).toBe(b0+1);
    await expectError(rpc(db,admin,'admin_decide_submission',[id,true,0,1,'x']),/already_closed/);
    const n=(await rpc(db,u,'get_notifications')).items.find((x:any)=>x.kind==='submission_decided');
    expect(n.payload).toMatchObject({accepted:true,reward_boosters:1});
    const info=(await rpc<any[]>(db,admin,'admin_submissions',['pending']))[0];
    await expectError(rpc(db,admin,'admin_decide_submission',[info.id,false,0,0,' ']),/reason_required/);
    await rpc(db,admin,'admin_decide_submission',[info.id,false,500,0,'Information correcte']);
    expect((await rpc<any[]>(db,u,'get_my_submissions')).map(s=>s.status).sort()).toEqual(['accepted','rejected']);
    await expectError(rpc(db,u,'admin_submissions',['pending']),/forbidden/);
  });
});

describe('crédits d’illustration',()=>{
  it('crédite l’artiste après validation et archive le crédit avec l’ancienne illustration',async()=>{
    const u=await player('dessinatrice');const c=await char(5);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-005','credit','C’est mon dessin',null,' ']),/credit_required/);
    await rpc(db,u,'submit_card_feedback',['CAM-005','credit','C’est mon dessin, lien vers mon compte',null,'Lune Noire']);
    const s=(await rpc<any[]>(db,admin,'admin_submissions',['pending'])).find(x=>x.kind==='credit');
    expect(s).toMatchObject({credit_name:'Lune Noire',art_credit:null});
    await rpc(db,admin,'admin_set_art_credit',[c,null,s.credit_name,'Crédit validé']);
    await rpc(db,admin,'admin_decide_submission',[s.id,true,50,0,'Merci !']);
    await give(u,5);
    expect((await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===5).art_credit).toBe('Lune Noire');
    // Nouvelle illustration officielle : l'ancienne garde son crédit, la nouvelle repart sans.
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART2]);
    const album=(await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===5);
    expect(album.art_credit).toBeNull();
    expect(album.variants[0]).toMatchObject({kind:'legacy',credit:'Lune Noire'});
  });
});
