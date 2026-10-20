import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);

async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return {id,handle};}
async function give(user:string){
  const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 and rarity='Épique' returning id`,[user,edition]);
  return i.id;
}
const kinds=async(u:string)=>(await rpc(db,u,'get_notifications')).items.map((n:any)=>n.kind);
async function befriend(a:{id:string},b:{id:string;handle:string}){
  await rpc(db,a.id,'send_friend_request',[b.handle]);
  const f=await rpc(db,b.id,'get_friends');
  await rpc(db,b.id,'respond_friend_request',[f.incoming[0].request_id,true]);
}

describe('notifications',()=>{
  it('prévient des demandes d’ami et de leur acceptation',async()=>{
    const a=await player('notif_a');const b=await player('notif_b');
    await befriend(a,b);
    const nb=await rpc(db,b.id,'get_notifications');
    expect(nb.items[0]).toMatchObject({kind:'friend_request',payload:{from:'notif_a'},read:false});
    expect(nb.unread).toBe(1);
    expect((await rpc(db,a.id,'get_notifications')).items[0]).toMatchObject({kind:'friend_accepted',payload:{from:'notif_b'}});
  });
  it('prévient d’un cadeau reçu puis de la réponse',async()=>{
    const a=await player('donneur');const b=await player('receveur');
    await befriend(a,b);
    const g=await rpc(db,a.id,'send_gift',[b.id,await give(a.id),randomUUID()]);
    const received=(await rpc(db,b.id,'get_notifications')).items.find((n:any)=>n.kind==='gift_received');
    expect(received.payload).toMatchObject({from:'donneur',finish:'Standard'});
    await rpc(db,b.id,'respond_gift',[g.gift_id??g,true]);
    expect((await rpc(db,a.id,'get_notifications')).items[0]).toMatchObject({kind:'gift_answered',payload:{status:'accepted',from:'receveur'}});
  });
  it('prévient l’enchérisseur dépassé, le gagnant et le vendeur',async()=>{
    const s=await player('vendeur_n');const x=await player('miseur_x');const y=await player('miseur_y');
    await credit(db,x.id,5000);await credit(db,y.id,5000);
    const {listing_id:l}=await rpc(db,s.id,'create_auction',[await give(s.id),100,12,randomUUID()]);
    await rpc(db,x.id,'place_bid',[l,100,randomUUID()]);
    expect(await kinds(x.id)).not.toContain('outbid');
    await rpc(db,y.id,'place_bid',[l,120,randomUUID()]);
    expect((await rpc(db,x.id,'get_notifications')).items[0]).toMatchObject({kind:'outbid',payload:{amount:120}});
    await db.query(`update public.listings set ends_at=now()-interval '1 second' where id=$1`,[l]);
    await db.query('select private.close_expired_auctions()');
    expect((await rpc(db,y.id,'get_notifications')).items[0]).toMatchObject({kind:'auction_won',payload:{price:120}});
    expect((await rpc(db,s.id,'get_notifications')).items[0]).toMatchObject({kind:'listing_sold',payload:{price:120,auction:true,buyer:'miseur_y'}});
  });
  it('prévient d’un succès débloqué',async()=>{
    const u=await player('chanceux');
    await db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters where edition_id=$2 on conflict do nothing`,[u.id,edition]);
    await rpc(db,u.id,'get_achievements');
    expect(await kinds(u.id)).toContain('achievement');
  });
  it('respecte les préférences et marque comme lu',async()=>{
    const a=await player('silencieux');const b=await player('bavard');
    await rpc(db,a.id,'set_notification_prefs',[{friends:false,bogus:true,market:'oui'}]);
    expect((await rpc(db,a.id,'get_notifications')).prefs).toEqual({friends:false,social:true,market:true,achievements:true});
    await rpc(db,b.id,'send_friend_request',['silencieux']);
    expect(await kinds(a.id)).not.toContain('friend_request');
    await rpc(db,a.id,'send_friend_request',['bavard']); // accepte la demande en retour
    expect(await rpc(db,b.id,'get_unread_count')).toBe(1);
    expect(await rpc(db,b.id,'mark_notifications_read')).toBe(0);
    expect((await rpc(db,b.id,'get_notifications')).items.every((n:any)=>n.read)).toBe(true);
    // Personne ne lit les notifications d'un autre.
    const {rows}=await db.query<any>(`select count(*)::int n from public.notifications where owner_id=$1`,[b.id]);
    expect(rows[0].n).toBeGreaterThan(0);
    expect((await rpc(db,a.id,'get_notifications')).items.some((n:any)=>n.payload.from==='silencieux')).toBe(false);
  });
});
