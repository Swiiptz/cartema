import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});},30000);

async function player(handle:string){const id=await createUser(db);await rpc(db,id,'set_handle',[handle]);return {id,handle};}
async function give(owner:string,number:number,finish='Standard'){
  const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,$3 from public.characters where edition_id=$2 and number=$4 returning id`,[owner,edition,finish,number]);
  return r.id;
}
async function befriend(a:{id:string},b:{id:string;handle:string}){
  await rpc(db,a.id,'send_friend_request',[b.handle]);
  const f=await rpc(db,b.id,'get_friends');
  await rpc(db,b.id,'respond_friend_request',[f.incoming[0].request_id,true]);
}

describe('vitrine',()=>{
  it('expose jusqu’à 5 exemplaires possédés, dans l’ordre choisi',async()=>{
    const a=await player('vitrine_a');const b=await player('vitrine_b');
    const ids=[await give(a.id,3),await give(a.id,1,'Dorée'),await give(a.id,2)];
    const p=await rpc(db,a.id,'set_showcase',[ids]);
    expect(p.showcase.map((c:any)=>c.instance_id)).toEqual(ids);
    expect(p.showcase[1]).toMatchObject({finish:'Dorée',number:1});
    const seen=await rpc(db,b.id,'get_profile',['VITRINE_A']);
    expect(seen).toMatchObject({handle:'vitrine_a',relation:'none',visible:true,settings:null});
    expect(seen.showcase).toHaveLength(3);
    await expectError(rpc(db,b.id,'set_showcase',[[ids[0]]]),/not_owned/);
    await expectError(rpc(db,a.id,'set_showcase',[[ids[0],ids[0]]]),/duplicate_card/);
    const six=[...ids,await give(a.id,4),await give(a.id,5),await give(a.id,6)];
    await expectError(rpc(db,a.id,'set_showcase',[six]),/too_many_cards/);
  });
  it('retire de la vitrine un exemplaire recyclé',async()=>{
    const a=await player('recycleur_vitrine');
    const id=await give(a.id,7);
    await rpc(db,a.id,'set_showcase',[[id]]);
    await rpc(db,a.id,'recycle_cards',[[id],randomUUID(),true]);
    expect((await rpc(db,a.id,'get_profile',['recycleur_vitrine'])).showcase).toEqual([]);
  });
  it('propose chaque version d’illustration et accepte plusieurs exemplaires d’une même carte (23/10)',async()=>{
    const a=await player('vitrine_versions');
    const admin=await createUser(db);await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
    const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=8`,[edition]);
    const art=await rpc<string>(db,admin,'admin_add_card_art',[c.id,'/illustrations/CAM/v2.webp',{},'Version nocturne','Test']);
    const std=[await give(a.id,8),await give(a.id,8),await give(a.id,8)];
    const alt=await give(a.id,8);await db.query('update public.inventory_items set art_id=$2 where id=$1',[alt,art]);
    const list=(await rpc<any[]>(db,a.id,'get_showcase_candidates')).filter(x=>x.number===8);
    expect(list).toHaveLength(2);
    expect(list.find(x=>!x.variant)).toMatchObject({copies:3});
    expect(list.find(x=>!x.variant).instances).toHaveLength(3);
    expect(list.find(x=>x.variant)).toMatchObject({variant:'Version nocturne',copies:1,instances:[alt]});
    const p=await rpc(db,a.id,'set_showcase',[[std[0],alt,std[1]]]);
    expect(p.showcase.map((x:any)=>x.variant??null)).toEqual([null,'Version nocturne',null]);
  });
  it('propose un exemplaire par personnage et finition',async()=>{
    const a=await player('candidat');
    await give(a.id,2);await give(a.id,2);await give(a.id,2,'Sanglante');
    const list=await rpc<any[]>(db,a.id,'get_showcase_candidates');
    expect(list.map(c=>[c.number,c.finish])).toEqual([[2,'Standard'],[2,'Sanglante']]);
  });
});

describe('confidentialité',()=>{
  it('respecte public, amis seulement et privé',async()=>{
    const a=await player('discret_a');const friend=await player('ami_a');const other=await player('inconnu_a');
    await befriend(friend,a);
    await rpc(db,a.id,'set_showcase',[[await give(a.id,1)]]);
    await rpc(db,a.id,'set_privacy',['friends',true]);
    expect(await rpc(db,friend.id,'get_profile',['discret_a'])).toMatchObject({relation:'friends',visible:true});
    const hidden=await rpc(db,other.id,'get_profile',['discret_a']);
    expect(hidden).toMatchObject({visible:false,showcase:null,stats:null,handle:'discret_a'});
    await rpc(db,a.id,'set_privacy',['private',true]);
    expect((await rpc(db,friend.id,'get_profile',['discret_a'])).visible).toBe(false);
    const self=await rpc(db,a.id,'get_profile',['discret_a']);
    expect(self).toMatchObject({relation:'self',visible:true,settings:{visibility:'private',show_stats:true}});
    await expectError(rpc(db,a.id,'set_privacy',['secret',true]),/invalid_visibility/);
  });
  it('peut masquer les statistiques en gardant la vitrine',async()=>{
    const a=await player('modeste');const b=await player('curieux_b');
    await rpc(db,a.id,'set_privacy',['public',false]);
    const p=await rpc(db,b.id,'get_profile',['modeste']);
    expect(p).toMatchObject({visible:true,stats:null,recent:null});
    expect(p.showcase).toEqual([]);
    expect((await rpc(db,a.id,'get_profile',['modeste'])).stats).toMatchObject({faces:0,achievements:expect.any(Number)});
  });
  it('signale les joueurs introuvables et les demandes d’ami en cours',async()=>{
    const a=await player('demandeur');const b=await player('demande');
    await expectError(rpc(db,a.id,'get_profile',['personne']),/player_not_found/);
    await rpc(db,a.id,'send_friend_request',['demande']);
    expect((await rpc(db,a.id,'get_profile',['demande'])).relation).toBe('pending_out');
    expect((await rpc(db,b.id,'get_profile',['demandeur'])).relation).toBe('pending_in');
  });
});

describe('succès mis en avant',()=>{
  it('affiche jusqu’à 3 succès débloqués choisis, même sur un profil privé',async()=>{
    const a=await player('fier');const b=await player('admirateur');
    await db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters where edition_id=$2 on conflict do nothing`,[a.id,edition]);
    const unlocked=(await rpc<any[]>(db,a.id,'get_achievements')).filter(x=>x.unlocked_at).map(x=>x.code);
    expect(unlocked.length).toBeGreaterThanOrEqual(3);
    await expectError(rpc(db,a.id,'set_featured_achievements',[['unique']]),/title_locked/);
    await expectError(rpc(db,a.id,'set_featured_achievements',[unlocked.slice(0,4).concat(unlocked).slice(0,4)]),/too_many_achievements/);
    const p=await rpc(db,a.id,'set_featured_achievements',[[unlocked[2],unlocked[0]]]);
    expect(p.featured.map((x:any)=>x.code)).toEqual([unlocked[2],unlocked[0]]);
    await rpc(db,a.id,'set_privacy',['private',true]);
    expect((await rpc(db,b.id,'get_profile',['fier'])).featured).toHaveLength(2);
  });
  it('ne propose pas en vitrine les cartes d’une édition archivée',async()=>{
    const a=await player('archiviste_v');
    await give(a.id,1);
    await db.query(`update public.editions set archived_at=now() where id=$1`,[edition]);
    expect(await rpc(db,a.id,'get_showcase_candidates')).toEqual([]);
    await db.query(`update public.editions set archived_at=null where id=$1`,[edition]);
  });
});
