import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['moderateur']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}
const charId=async(n:number)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=$2`,[edition,n])).rows[0].id;

describe('signalements',()=>{
  it('signale un joueur, prévient l’admin, une seule fois tant que c’est ouvert',async()=>{
    const a=await player('plaignant');await player('fauteur');
    await rpc(db,a,'report_player',['fauteur','pseudo','Pseudonyme insultant.']);
    await expectError(rpc(db,a,'report_player',['fauteur','triche','Encore lui.']),/already_reported/);
    await expectError(rpc(db,a,'report_player',['plaignant','autre','Moi-même ?']),/self_report/);
    await expectError(rpc(db,a,'report_player',['personne','autre','Introuvable.']),/player_not_found/);
    await expectError(rpc(db,a,'report_player',['fauteur','autre','court']),/already_reported/);
    const notif=(await rpc(db,admin,'get_notifications')).items.find((n:any)=>n.kind==='report_received');
    expect(notif.payload).toMatchObject({from:'plaignant',target:'fauteur',category:'pseudo'});
    const [r]=await rpc<any[]>(db,admin,'admin_reports',['open']);
    expect(r).toMatchObject({reporter:'plaignant',target:'fauteur',category:'pseudo',target_reports:1});
    await expectError(rpc(db,a,'admin_reports',['open']),/forbidden/);
    await rpc(db,admin,'admin_close_report',[r.id,'resolved','Pseudonyme réinitialisé']);
    expect(await rpc(db,admin,'admin_reports',['open'])).toEqual([]);
    await expectError(rpc(db,admin,'admin_close_report',[r.id,'dismissed','x']),/already_closed/);
    // Une fois traité, un nouveau signalement est possible.
    await rpc(db,a,'report_player',['fauteur','comportement','Nouveau problème.']);
  });
  it('limite à 5 signalements par jour',async()=>{
    const a=await player('procedurier');
    for(let i=0;i<5;i++){await player(`cible_${i}`);await rpc(db,a,'report_player',[`cible_${i}`,'autre','Motif détaillé.']);}
    await player('cible_6');
    await expectError(rpc(db,a,'report_player',['cible_6','autre','Motif détaillé.']),/too_many_reports/);
  });
});

describe('cartes données et retirées par l’admin',()=>{
  it('donne des exemplaires (idempotent) et la découverte, sans récompense de découverte',async()=>{
    const u=await player('beneficiaire');
    const c=await charId(3);const req=randomUUID();
    const before=Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[u])).rows[0].b);
    expect(await rpc(db,admin,'admin_grant_card',[u,c,'Dorée',2,'Lot de séance',req])).toBe(2);
    expect(await rpc(db,admin,'admin_grant_card',[u,c,'Dorée',2,'Lot de séance',req])).toBe(2);
    const cards=await rpc<any[]>(db,admin,'admin_player_cards',[u]);
    expect(cards.map(x=>[x.number,x.finish])).toEqual([[3,'Dorée'],[3,'Dorée']]);
    expect((await db.query(`select 1 from public.discoveries where owner_id=$1 and character_id=$2`,[u,c])).rows).toHaveLength(1);
    expect(Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[u])).rows[0].b)).toBe(before);
    await expectError(rpc(db,admin,'admin_grant_card',[u,c,'Standard',21,'x',randomUUID()]),/invalid_amount/);
  });
  it('retire un exemplaire libre, refuse un exemplaire engagé, garde la découverte',async()=>{
    const u=await player('retire');
    await rpc(db,admin,'admin_grant_card',[u,await charId(4),'Standard',2,'Test',randomUUID()]);
    const [a,b]=await rpc<any[]>(db,admin,'admin_player_cards',[u]);
    await rpc(db,u,'set_cards_locked',[[a.instance_id],true]);
    await rpc(db,u,'set_showcase',[[a.instance_id]]);
    await rpc(db,admin,'admin_remove_card',[a.instance_id,'Carte obtenue par erreur']);
    await rpc(db,u,'create_listing',[b.instance_id,100,randomUUID()]);
    await expectError(rpc(db,admin,'admin_remove_card',[b.instance_id,'x']),/card_reserved/);
    expect(await rpc<any[]>(db,admin,'admin_player_cards',[u])).toHaveLength(1);
    expect((await rpc(db,u,'get_profile',['retire'])).showcase).toEqual([]);
    const {rows}=await db.query(`select action from public.admin_audit_logs where target_id=$1 order by id`,[u]);
    expect(rows.map((r:any)=>r.action)).toEqual(['card_grant','card_remove']);
  });
  it('ne touche jamais à la carte unique',async()=>{
    const u=await player('pas_cain_admin');
    await db.query(`update public.characters set is_unique=true where edition_id=$1 and number=1`,[edition]);
    await expectError(rpc(db,admin,'admin_grant_card',[u,await charId(1),'Standard',1,'x',randomUUID()]),/unique_card/);
    await db.query(`update public.characters set is_unique=false where edition_id=$1 and number=1`,[edition]);
  });
});
