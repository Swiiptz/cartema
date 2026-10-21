import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:1});},30000);

async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return {id,handle};}
async function give(owner:string,number:number,finish='Standard'){
  const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,$3 from public.characters where edition_id=$2 and number=$4 returning id`,[owner,edition,finish,number]);
  return r.id;
}
async function befriend(a:{id:string},b:{id:string;handle:string}){
  await rpc(db,a.id,'send_friend_request',[b.handle]);
  const f=await rpc(db,b.id,'get_friends');
  await rpc(db,b.id,'respond_friend_request',[f.incoming[0].request_id,true]);
}
const discover=(u:string,n:number)=>db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters where edition_id=$2 and number=$3 on conflict do nothing`,[u,edition,n]);

describe('liste de souhaits',()=>{
  it('souhaite une carte par son numéro, voilée tant qu’elle n’est pas découverte',async()=>{
    const a=await player('souhaiteur');
    expect(await rpc(db,a.id,'set_wish',['cam-3',null,true])).toBe(true);
    expect(await rpc(db,a.id,'set_wish',['CAM-003',null,true])).toBe(true); // déjà souhaitée : pas de doublon
    await rpc(db,a.id,'set_wish',['CAM-003','Dorée',true]);
    let w=await rpc(db,a.id,'get_wishlist',[null]);
    expect(w.items).toHaveLength(2);
    expect(w.items[0]).toMatchObject({code:'CAM-003',known:false});
    expect(w.items[0].name).toBeUndefined();
    await discover(a.id,3);
    w=await rpc(db,a.id,'get_wishlist',[null]);
    expect(w.items[0]).toMatchObject({known:true,name:expect.any(String)});
    expect(await rpc(db,a.id,'set_wish',['CAM-003','Dorée',false])).toBe(false);
    expect((await rpc(db,a.id,'get_wishlist',[null])).items).toHaveLength(1);
    await expectError(rpc(db,a.id,'set_wish',['CAM-999',null,true]),/not_found/);
  });
  it('refuse la carte unique',async()=>{
    const a=await player('pas_cain');
    await db.query(`update public.characters set is_unique=true where edition_id=$1 and number=1`,[edition]);
    await expectError(rpc(db,a.id,'set_wish',['CAM-001',null,true]),/not_found/);
    await db.query(`update public.characters set is_unique=false where edition_id=$1 and number=1`,[edition]);
  });
  it('montre annonces et amis qui possèdent la carte, en respectant leur confidentialité',async()=>{
    const a=await player('chercheur');const f=await player('ami_proprio');const p=await player('ami_prive');const s=await player('vendeur_w');
    await befriend(a,f);await befriend(a,p);
    await rpc(db,p.id,'set_privacy',['private',true]);
    await give(f.id,4);await give(p.id,4);
    await rpc(db,a.id,'set_wish',['CAM-004',null,true]);
    await rpc(db,s.id,'create_listing',[await give(s.id,4),120,randomUUID()]);
    const [item]=(await rpc(db,a.id,'get_wishlist',[null])).items;
    expect(item).toMatchObject({on_market:1,best_price:120,owned:0,friends:['ami_proprio']});
  });
  it('prévient quand une carte souhaitée est mise en vente (finition comprise)',async()=>{
    const a=await player('alerte');const s=await player('vendeur_x');
    await rpc(db,a.id,'set_wish',['CAM-005','Sanglante',true]);
    await rpc(db,s.id,'create_listing',[await give(s.id,5),50,randomUUID()]); // Standard : pas d'alerte
    expect((await rpc(db,a.id,'get_notifications')).items.filter((n:any)=>n.kind==='wish_listed')).toHaveLength(0);
    await rpc(db,s.id,'create_listing',[await give(s.id,5,'Sanglante'),900,randomUUID()]);
    const n=(await rpc(db,a.id,'get_notifications')).items.find((x:any)=>x.kind==='wish_listed');
    expect(n.payload).toMatchObject({card:'CAM-005',finish:'Sanglante',price:900,auction:false});
  });
  it('affiche la liste aux autres selon la visibilité du profil',async()=>{
    const a=await player('vitrine_souhaits');const b=await player('visiteur_w');
    await rpc(db,a.id,'set_wish',['CAM-006',null,true]);
    const seen=await rpc(db,b.id,'get_wishlist',['vitrine_souhaits']);
    expect(seen).toMatchObject({visible:true});
    expect(seen.items[0].on_market).toBeUndefined(); // détails réservés au propriétaire
    await rpc(db,a.id,'set_privacy',['private',true]);
    expect(await rpc(db,b.id,'get_wishlist',['vitrine_souhaits'])).toEqual({visible:false,items:[]});
  });
});
