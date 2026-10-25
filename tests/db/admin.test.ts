import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,expectError,RARITIES,type Db} from './harness';

let db:Db;let admin:string;let player:string;
beforeAll(async()=>{
  db=await createDb();
  admin=await createUser(db);player=await createUser(db);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);

const saveCharacter=(user:string,o:{id?:string|null;edition:string;number:number;name?:string;rarity?:string;clan?:string|null;art?:string|null;meta?:object})=>
  rpc<string>(db,user,'admin_save_character',[o.id??null,o.edition,o.number,o.name??`Perso ${o.number}`,'Fonction',o.clan??null,o.rarity??'Rare',o.art??null,JSON.stringify(o.meta??{})]);

describe('accès au back-office',()=>{
  it('refuse toutes les RPC admin à un joueur',async()=>{
    await expectError(rpc(db,player,'admin_catalog'),/forbidden/);
    await expectError(rpc(db,player,'admin_save_edition',[null,'Pirate','PIR',true,null]),/forbidden/);
    await expectError(rpc(db,player,'admin_save_clan',[null,'Pirates',null]),/forbidden/);
    await expectError(rpc(db,null,'admin_catalog'),/permission denied/);
  });
  it('refuse un administrateur suspendu',async()=>{
    await db.query(`update public.profiles set suspended_at=now() where id=$1`,[admin]);
    await expectError(rpc(db,admin,'admin_catalog'),/account_suspended/);
    await db.query(`update public.profiles set suspended_at=null where id=$1`,[admin]);
  });
});

describe('catalogue',()=>{
  let edition:string;let clan:string;
  it('crée édition et clan, avec journal',async()=>{
    edition=await rpc(db,admin,'admin_save_edition',[null,'Camarilla','cam',false,null]);
    clan=await rpc(db,admin,'admin_save_clan',[null,'Toréador',null]);
    const cat=await rpc(db,admin,'admin_catalog');
    expect(cat.editions[0]).toMatchObject({name:'Camarilla',prefix:'CAM',complete:false,packs_enabled:false});
    expect(cat.clans).toEqual([{id:clan,name:'Toréador',symbol_key:null,lineage_title:null}]);
    const {rows}=await db.query<{action:string}>(`select action from public.admin_audit_logs where actor_id=$1 order by id`,[admin]);
    expect(rows.map(r=>r.action)).toEqual(['edition_create','clan_create']);
    await expectError(rpc(db,admin,'admin_save_edition',[null,'Doublon','CAM',false,null]),/prefix_taken/);
  });
  it('crée les personnages en brouillon, invisibles des joueurs',async()=>{
    const id=await saveCharacter(admin,{edition,number:1,name:'Werner',clan,rarity:'Rare'});
    await rpc(db,admin,'admin_save_edition',[edition,'Camarilla','CAM',true,null]);
    const cat=await rpc(db,admin,'admin_catalog');
    expect(cat.characters.find((c:any)=>c.id===id)).toMatchObject({status:'draft',name:'Werner',clan_id:clan});
    expect(await rpc(db,player,'get_album',[edition])).toEqual([]);
    await expectError(saveCharacter(admin,{edition,number:1}),/number_taken/);
  });
  it('refuse un chemin d’illustration externe et un cadrage invalide',async()=>{
    await expectError(saveCharacter(admin,{edition,number:50,art:'https://evil.example/x.png'}),/invalid_art_path/);
    await expectError(saveCharacter(admin,{edition,number:50,art:'/illustrations/../x'}),/invalid_art_path/);
    await expectError(saveCharacter(admin,{edition,number:50,meta:{layout:'zoom'}}),/invalid_art_meta/);
    await expectError(saveCharacter(admin,{edition,number:50,meta:{offsetY:99}}),/invalid_art_meta/);
    expect(await saveCharacter(admin,{edition,number:50,art:'https://abcd.supabase.co/storage/v1/object/public/illustrations/display/a.webp',meta:{layout:'cover',offsetY:-18}})).toBeTruthy();
  });
  it('fige numéro et rareté mais autorise la correction du nom',async()=>{
    const id=await saveCharacter(admin,{edition,number:60,name:'Ava',rarity:'Épique'});
    await expectError(saveCharacter(admin,{id,edition,number:61,name:'Ava',rarity:'Épique'}),/immutable_character/);
    await expectError(saveCharacter(admin,{id,edition,number:60,name:'Ava',rarity:'Mythique'}),/immutable_character/);
    await saveCharacter(admin,{id,edition,number:60,name:'Ava la Prévôt',rarity:'Épique'});
    const {rows:[c]}=await db.query<{name:string}>('select name from public.characters where id=$1',[id]);
    expect(c.name).toBe('Ava la Prévôt');
  });
  it('publie avec motif, et ne remet jamais une carte publiée en brouillon',async()=>{
    const id=await saveCharacter(admin,{edition,number:70,rarity:'Commun'});
    await expectError(rpc(db,admin,'admin_set_character_status',[id,'published','']),/reason_required/);
    await rpc(db,admin,'admin_set_character_status',[id,'published','Validée par l’équipe']);
    await expectError(rpc(db,admin,'admin_set_character_status',[id,'draft','retour']),/already_published/);
    const album=await rpc<any[]>(db,player,'get_album',[edition]);
    expect(album.map(c=>c.number)).toEqual([70]);
    await rpc(db,admin,'admin_set_character_status',[id,'archived','Erreur de saisie']);
    expect(await rpc(db,player,'get_album',[edition])).toEqual([]);
  });
  it('n’active les boosters qu’une fois les 7 raretés publiées',async()=>{
    await expectError(rpc(db,admin,'admin_set_packs',[edition,true,'Ouverture']),/edition_incomplete/);
    let n=100;
    for(const rarity of RARITIES){
      const id=await saveCharacter(admin,{edition,number:n++,rarity});
      await rpc(db,admin,'admin_set_character_status',[id,'published','Lot initial']);
    }
    await expectError(rpc(db,admin,'admin_set_packs',[edition,true,' ']),/reason_required/);
    await rpc(db,admin,'admin_set_packs',[edition,true,'Ouverture de l’édition']);
    const cat=await rpc(db,admin,'admin_catalog');
    expect(cat.editions[0]).toMatchObject({complete:true,packs_enabled:true});
    const u=await createUser(db);
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    expect((await rpc(db,u,'open_booster',[edition,randomUUID()])).cards).toHaveLength(5);
  });
  it('archive une édition sans la supprimer',async()=>{
    await rpc(db,admin,'admin_archive_edition',[edition,'Fin de saison']);
    const cat=await rpc(db,admin,'admin_catalog');
    expect(cat.editions[0]).toMatchObject({packs_enabled:false,used:true});
    expect(cat.editions[0].archived_at).not.toBeNull();
    await expectError(rpc(db,admin,'admin_set_packs',[edition,true,'Réouverture']),/edition_archived/);
  });
});

describe('publication groupée',()=>{
  it('publie tous les brouillons d’une édition avec un seul motif journalisé',async()=>{
    const ed=await rpc<string>(db,admin,'admin_save_edition',[null,'Lot','LOT',true,null]);
    for(let n=1;n<=3;n++) await saveCharacter(admin,{edition:ed,number:n});
    await expectError(rpc(db,player,'admin_publish_drafts',[ed,'x']),/forbidden/);
    await expectError(rpc(db,admin,'admin_publish_drafts',[ed,'']),/reason_required/);
    expect(await rpc(db,admin,'admin_publish_drafts',[ed,'Import initial validé'])).toBe(3);
    expect(await rpc(db,admin,'admin_publish_drafts',[ed,'Rien à publier'])).toBe(0);
    expect(await rpc<any[]>(db,player,'get_album',[ed])).toHaveLength(3);
  });
  it('refuse deux personnages issus de la même ligne source',async()=>{
    const ed=await rpc<string>(db,admin,'admin_save_edition',[null,'Source','SRC',false,null]);
    await db.query(`insert into public.characters (edition_id,number,name,rarity,source_ref) values ($1,1,'A','Commun','sheet:L2')`,[ed]);
    await expectError(db.query(`insert into public.characters (edition_id,number,name,rarity,source_ref) values ($1,2,'A','Commun','sheet:L2')`,[ed]),/characters_source_ref_key/);
  });
});
