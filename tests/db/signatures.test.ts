import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

// Cartes signées (25/10) : la personne qui joue un personnage envoie sa signature (contribution « signature »),
// l'admin la publie pour ce personnage ; ensuite, chaque exemplaire tiré a une chance sur signed_odds d'être signé.
let db:Db;let cam:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien_signatures']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  await rpc(db,admin,'admin_save_god_settings',[0,0,20,2,'Sans God',0]);
},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);await credit(db,id,5000);
  await db.query('update public.booster_balances set free_count=0,purchased_count=5 where owner_id=$1',[id]);return id;}
const open=(u:string)=>rpc(db,u,'open_booster',[cam,randomUUID()]);
const SIG='/illustrations/CAM/signatures/signature.webp';

describe('cartes signées',()=>{
  it('la signature se propose comme contribution, puis l’admin la publie pour le personnage',async()=>{
    const u=await player('joueuse_signature');
    const {rows:[c]}=await db.query<{id:string}>('select id from public.characters where edition_id=$1 and number=1',[cam]);
    await db.query('insert into public.discoveries (owner_id,character_id) values ($1,$2)',[u,c.id]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-001','signature','',null]),/image_required/);
    const id=await rpc<string>(db,u,'submit_card_feedback',['CAM-001','signature','C’est mon personnage.',`${u}/signature.png`]);
    expect((await rpc<any[]>(db,admin,'admin_submissions',['pending'])).find(s=>s.id===id)).toMatchObject({kind:'signature'});
    await expectError(rpc(db,u,'admin_set_signature',[c.id,SIG,'Pirate']),/forbidden/);
    await expectError(rpc(db,admin,'admin_set_signature',[c.id,'https://ailleurs.example/sig.png','Mauvais lien']),/invalid_art_path/);
    await rpc(db,admin,'admin_set_signature',[c.id,SIG,'Signature validée']);
    expect((await rpc(db,admin,'admin_catalog')).characters.find((x:any)=>x.id===c.id)).toMatchObject({signature_path:SIG});
  });

  it('un exemplaire tiré d’un personnage signé peut tomber signé, et la signature le suit partout',async()=>{
    await db.query('update public.characters set signature_path=$2 where edition_id=$1',[cam,SIG]);
    await rpc(db,admin,'admin_save_settings',[{signed_odds:1},'Toujours signé (test)']);
    const u=await player('chasseur_autographes');
    const o=await open(u);
    expect(o.cards.every((c:any)=>c.signed&&c.signature===SIG)).toBe(true);
    const inst=o.cards[0].instance_id;
    expect((await rpc<any[]>(db,u,'get_inventory',[o.cards[0].character_id])).find(x=>x.instance_id===inst)).toMatchObject({signed:true});
    const p=await rpc(db,u,'set_showcase',[[inst]]);
    expect(p.showcase[0]).toMatchObject({signed:true,signature:SIG});
    // Sans signature publiée, jamais signé ; chance à 0 : jamais signé.
    await db.query('update public.characters set signature_path=null where edition_id=$1',[cam]);
    expect((await open(u)).cards.some((c:any)=>c.signed)).toBe(false);
    await db.query('update public.characters set signature_path=$2 where edition_id=$1',[cam,SIG]);
    await rpc(db,admin,'admin_save_settings',[{signed_odds:0},'Jamais signé (test)']);
    expect((await open(u)).cards.some((c:any)=>c.signed)).toBe(false);
    await expectError(rpc(db,admin,'admin_save_settings',[{signed_odds:-1},'Négatif']),/invalid_setting/);
    await rpc(db,admin,'admin_save_settings',[{signed_odds:25},'Retour à 1 sur 25']);
  });
});
