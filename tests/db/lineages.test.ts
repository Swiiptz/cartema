import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

// Lignées (23/10) : posséder tous les membres d'un clan, toutes éditions confondues. Le titre se perd
// dès qu'un membre quitte la collection ; la récompense n'est donnée qu'à la première fois.
let db:Db;let cam:string;let anx:string;let clan:string;
const CODE='lineage:test';
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});anx=await seedEdition(db,{prefix:'ANX',perRarity:1});
  clan=(await db.query<{id:string}>(`insert into public.clans (name) values ('Lignée de test') returning id`)).rows[0].id;
  // Membres : CAM-001, CAM-002 et ANX-001. Ni la carte unique ni l'édition éternelle ne comptent.
  await db.query(`update public.characters set clan_id=$1 where (edition_id=$2 and number in (1,2)) or (edition_id=$3 and number=1)`,[clan,cam,anx]);
  const eter=await seedEdition(db,{prefix:'ETR',perRarity:1});
  await db.query(`update public.editions set eternal=true, packs_enabled=false where id=$1`,[eter]);
  await db.query(`update public.characters set clan_id=$1 where edition_id=$2 and number=1`,[clan,eter]);
  await db.query(`insert into public.achievements (code,label,description,category,metric,target,clan_id,title,reward_deniers,reward_boosters,sort)
                  values ($1,'Lignée de test','Posséder tous les membres du clan.','general','clan_lineage',1,$2,'Héritier',500,2,900)`,[CODE,clan]);
},30000);

async function player(handle:string){const id=await createUser(db);await rpc(db,id,'set_handle',[handle]);return id;}
async function give(owner:string,edition:string,number:number){
  const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 and number=$3 returning id`,[owner,edition,number]);
  return r.id;
}
const lineage=async(u:string)=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===CODE);
const title=async(u:string)=>(await db.query<{t:string|null}>('select title t from public.profiles where id=$1',[u])).rows[0].t;
const rewards=async(u:string)=>Number((await db.query<{n:string}>(`select count(*) n from public.wallet_ledger where owner_id=$1 and idempotency_key=$2`,[u,'achievement:'+CODE])).rows[0].n);

describe('lignées de clan',()=>{
  it('se gagnent avec tous les membres, se perdent dès qu’un membre part, sans seconde récompense',async()=>{
    const u=await player('heritier');
    const first=await give(u,cam,1);await give(u,cam,2);
    expect(await lineage(u)).toMatchObject({lineage:true,progress:2,target:3,unlocked_at:null,owned_rule:true});
    await give(u,anx,1);
    const gained=await rpc<any[]>(db,u,'sync_my_achievements');
    expect(gained.find(a=>a.code===CODE)).toMatchObject({label:'Lignée de test',title:'Héritier',lineage:true});
    expect(await lineage(u)).toMatchObject({progress:3,target:3,reward_claimed:true,lost_at:null});
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    expect(await rewards(u)).toBe(1);
    expect(await rpc(db,u,'set_title',[CODE])).toBe('Héritier');
    // Les lignées ne comptent pas dans le classement (succès définitifs seulement).
    const unlocks=Number((await db.query<{n:string}>('select count(*) n from public.achievement_unlocks where owner_id=$1',[u])).rows[0].n);
    expect((await rpc(db,u,'get_leaderboard',[50])).me.achievements).toBe(unlocks);
    expect((await db.query('select 1 from public.achievement_unlocks where code=$1',[CODE])).rows).toHaveLength(0);

    // Recyclage d'un membre : titre retiré tout de suite, sans attendre la page Progrès.
    await rpc(db,u,'recycle_cards',[[first],randomUUID(),true]);
    expect(await title(u)).toBeNull();
    const lost=await lineage(u);
    expect(lost).toMatchObject({unlocked_at:null,progress:2,reward_claimed:true});
    expect(lost.lost_at).not.toBeNull();
    await expectError(rpc(db,u,'set_title',[CODE]),/title_locked/);

    // Reprise du membre : la lignée revient, sans nouvelle récompense.
    await give(u,cam,1);
    expect((await rpc<any[]>(db,u,'sync_my_achievements')).find(a=>a.code===CODE)).toBeTruthy();
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    expect(await rewards(u)).toBe(1);
  });

  it('se perd quand un membre change de propriétaire ; un doublon cédé ne fait rien perdre',async()=>{
    const u=await player('vendeur_lignee');const other=await player('acheteur_lignee');
    const ids=[await give(u,cam,1),await give(u,cam,2),await give(u,anx,1)];
    await give(u,cam,2); // un doublon : le donner ne fait rien perdre
    await rpc(db,u,'get_achievements');
    await rpc(db,u,'set_title',[CODE]);
    await db.query('update public.inventory_items set owner_id=$2 where id=$1',[ids[1],other]);
    expect(await title(u)).toBe('Héritier');
    expect((await lineage(u)).unlocked_at).not.toBeNull();
    await db.query('update public.inventory_items set owner_id=$2 where id=$1',[ids[2],other]);
    expect(await title(u)).toBeNull();
    expect((await lineage(u)).unlocked_at).toBeNull();
  });
});

describe('lignée mise en avant sur le profil',()=>{
  it('se met en avant avec un succès définitif tant qu’elle est détenue, disparaît du profil une fois perdue (23/10)',async()=>{
    const u=await player('vitrine_lignee');
    const first=await give(u,cam,1);await give(u,cam,2);await give(u,anx,1);
    await rpc(db,u,'get_achievements'); // lignée gagnée
    const lasting='faces_10';
    await db.query(`insert into public.achievement_unlocks (owner_id,code) values ($1,$2)`,[u,lasting]);
    const p=await rpc(db,u,'set_featured_achievements',[[lasting,CODE]]);
    expect(p.featured.map((f:any)=>f.code)).toEqual([lasting,CODE]);
    await rpc(db,u,'recycle_cards',[[first],randomUUID(),true]);
    expect((await rpc(db,u,'get_profile',['vitrine_lignee'])).featured.map((f:any)=>f.code)).toEqual([lasting]);
    await expectError(rpc(db,u,'set_featured_achievements',[[CODE]]),/title_locked/);
  });
});

describe('camps (Team Apo, Team Gwen)',()=>{
  it('se gagnent avec les cartes requises sans la carte interdite, et se perdent dès qu’on obtient l’interdite (23/10)',async()=>{
    const id=async(ed:string,n:number)=>(await db.query<{id:string}>('select id from public.characters where edition_id=$1 and number=$2',[ed,n])).rows[0].id;
    const apo=await id(cam,3),isa=await id(cam,4),gwen=await id(cam,5);
    await db.query(`insert into public.achievements (code,label,description,category,metric,target,required_characters,excluded_characters,title,reward_deniers,sort,edition_id)
                    values ('chronicle:team-test','Le parti de test','Apo et Isabeau, sans Gwen.','custom','faction',1,$1,$2,'Team Test',100,600,$3)`,[[apo,isa],[gwen],cam]);
    const u=await player('camp_apo');const other=await player('camp_autre');
    const team=async()=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code==='chronicle:team-test');
    expect(await team()).toMatchObject({description:'Apo et Isabeau, sans Gwen.',unlocked_at:null}); // condition visible avant
    await give(u,cam,3);await give(u,cam,4);
    expect(await team()).toMatchObject({lineage:true,faction:true,progress:2,target:2});
    expect((await team()).unlocked_at).not.toBeNull();
    expect(await rpc(db,u,'set_title',['chronicle:team-test'])).toBe('Team Test');
    // Obtenir Gwen fait perdre le camp tout de suite.
    const g=await give(u,cam,5);
    expect(await title(u)).toBeNull();
    const lost=await team();
    expect(lost.unlocked_at).toBeNull();expect(lost.progress).toBe(1);
    // S'en séparer le rend à la passe suivante.
    await db.query('update public.inventory_items set owner_id=$2 where id=$1',[g,other]);
    expect((await team()).unlocked_at).not.toBeNull();
    // Une carte requise qui part : perdu aussi.
    await db.query(`update public.inventory_items set owner_id=$2 where owner_id=$1 and character_id=$3`,[u,other,isa]);
    expect((await team()).unlocked_at).toBeNull();
  });
});

describe('lignée d’un nouveau clan',()=>{
  it('l’admin crée la lignée avec son titre ; le renommage du clan suit (25/10)',async()=>{
    const admin=await player('gardien_lignees');await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
    const clan=await rpc<string>(db,admin,'admin_save_clan',[null,'Salubri']);
    const code=await rpc<string>(db,admin,'admin_set_clan_lineage',[clan,'Troisième œil','Nouveau clan']);
    expect(code).toBe(`lineage:${clan}`);
    const row=async()=>(await db.query<{label:string;title:string}>('select label,title,metric,category,clan_id from public.achievements where code=$1',[code])).rows[0];
    expect(await row()).toMatchObject({label:'Lignée Salubri',title:'Troisième œil',metric:'clan_lineage',category:'general',clan_id:clan});
    await rpc(db,admin,'admin_set_clan_lineage',[clan,'Œil de Saulot','Nouveau titre']);
    expect((await row()).title).toBe('Œil de Saulot');
    await rpc(db,admin,'admin_save_clan',[clan,'Salubris']);
    expect((await row()).label).toBe('Lignée Salubris');
    expect((await rpc(db,admin,'admin_catalog')).clans.find((c:any)=>c.id===clan)).toMatchObject({lineage_title:'Œil de Saulot'});
    const u=await player('curieux_lignee');
    await expectError(rpc(db,u,'admin_set_clan_lineage',[clan,'Pirate','x']),/forbidden/);
    await expectError(rpc(db,admin,'admin_set_clan_lineage',[clan,'  ','Vide']),/invalid/);
  });
});
