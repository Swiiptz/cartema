import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);
const player=async(h:string)=>{const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;};
// xmin change à chaque réécriture d'une ligne : identique = aucune écriture ni verrou.
const versions=async(sql:string,args:unknown[]=[])=>(await db.query<{x:string}>(sql,args)).rows.map(r=>r.x).join(',');

describe('performances',()=>{
  it('les lectures répétées ne réécrivent ni succès, ni boosters, ni porte-monnaie',async()=>{
    const u=await player('lecteur');
    await rpc(db,u,'get_player_state');await rpc(db,u,'get_achievements');
    const before=[await versions(`select xmin::text x from public.achievements order by code`),
      await versions(`select xmin::text x from public.booster_balances where owner_id=$1`,[u]),
      await versions(`select xmin::text x from public.wallets where owner_id=$1`,[u])];
    const state=await rpc(db,u,'get_player_state');const ach=await rpc(db,u,'get_achievements');
    expect([await versions(`select xmin::text x from public.achievements order by code`),
      await versions(`select xmin::text x from public.booster_balances where owner_id=$1`,[u]),
      await versions(`select xmin::text x from public.wallets where owner_id=$1`,[u])]).toEqual(before);
    expect(state.daily_reward).toBe(0);
    // La progression des succès à obtenir reste affichée.
    const first=ach.find((a:any)=>a.code==='first_pack');
    expect([first.progress,first.target,first.unlocked_at]).toEqual([0,1,null]);
  });
  it('débloque toujours les succès à l’ouverture de la page',async()=>{
    const u=await player('ouvreur');
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const first=(await rpc(db,u,'get_achievements')).find((a:any)=>a.code==='first_pack');
    expect(first.unlocked_at).toBeTruthy();
  });
  it('a les index des lectures fréquentes (audit du 22/10)',async()=>{
    const {rows}=await db.query<{indexname:string}>(`select indexname from pg_indexes where schemaname='public'`);
    const names=rows.map(r=>r.indexname);
    for(const ix of ['gifts_sender_ix','gifts_recipient_ix','trades_proposer_ix','trades_recipient_ix','friendships_addressee_ix','friendships_requester_ix',
      'listings_sold_card_ix','listings_active_card_ix','booster_grants_owner_ix','contest_votes_voter_ix','contest_entries_author_ix'])
      expect(names,ix).toContain(ix);
  });
  it('masque une enchère échue sans la clôturer, la tâche planifiée s’en charge',async()=>{
    const s=await player('vendeur_p');const b=await player('acheteur_p');await credit(db,b,500);
    const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,'Standard' from public.characters where edition_id=$2 limit 1 returning id`,[s,edition]);
    const {listing_id}=await rpc(db,s,'create_auction',[i.id,10,12,randomUUID()]);
    await rpc(db,b,'place_bid',[listing_id,10,randomUUID()]);
    await db.query(`update public.listings set ends_at=now()-interval '1 second' where id=$1`,[listing_id]);
    expect((await rpc(db,b,'get_market')).some((l:any)=>l.listing_id===listing_id)).toBe(false);
    expect((await db.query<{status:string}>('select status from public.listings where id=$1',[listing_id])).rows[0].status).toBe('active');
    await db.query('select private.close_expired_auctions()');
    expect((await db.query<{status:string}>('select status from public.listings where id=$1',[listing_id])).rows[0].status).toBe('sold');
  });
});
