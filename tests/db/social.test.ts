import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,credit,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
const OLD='2026-01-01T00:00:00Z';
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{perRarity:1});},30000);

let n=0;
async function player(){const id=await createUser(db,{createdAt:OLD});await rpc(db,id,'set_handle',[`joueur_${++n}`]);return {id,handle:`joueur_${n}`};}
async function give(user:string,rarity='Rare'){
  const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 limit 1`,[edition,rarity]);
  return (await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[user,c.id])).rows[0].id;
}
const owner=async(i:string)=>(await db.query<{owner_id:string;reserved_kind:string|null}>('select owner_id,reserved_kind from public.inventory_items where id=$1',[i])).rows[0];
const balance=async(u:string)=>Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[u])).rows[0].b);
async function befriend(a:{id:string},b:{id:string;handle:string}){
  expect(await rpc(db,a.id,'send_friend_request',[b.handle])).toBe('sent');
  const f=await rpc(db,b.id,'get_friends');
  await rpc(db,b.id,'respond_friend_request',[f.incoming[0].request_id,true]);
}

describe('amis',()=>{
  it('envoie, accepte, refuse et retire',async()=>{
    const a=await player();const b=await player();const c=await player();
    await expectError(rpc(db,a.id,'send_friend_request',['personne_inconnue']),/player_not_found/);
    await expectError(rpc(db,a.id,'send_friend_request',[a.handle]),/self_request/);
    await befriend(a,b);
    expect((await rpc(db,a.id,'get_friends')).friends.map((f:any)=>f.handle)).toEqual([b.handle]);
    await expectError(rpc(db,b.id,'send_friend_request',[a.handle]),/already_friends/);
    await rpc(db,c.id,'send_friend_request',[a.handle]);
    expect(await rpc(db,a.id,'send_friend_request',[c.handle.toUpperCase()])).toBe('accepted'); // demande croisée
    await rpc(db,a.id,'remove_friend',[b.id]);
    expect((await rpc(db,b.id,'get_friends')).friends).toEqual([]);
  });
});

describe('cadeaux',()=>{
  it('réservés aux amis, acceptés ou refusés, sans commission',async()=>{
    const a=await player();const b=await player();const stranger=await player();
    const card=await give(a.id);
    await expectError(rpc(db,a.id,'send_gift',[stranger.id,card,randomUUID()]),/not_friends/);
    await befriend(a,b);
    const {gift_id}=await rpc(db,a.id,'send_gift',[b.id,card,randomUUID()]);
    expect(await owner(card)).toEqual({owner_id:a.id,reserved_kind:'gift'});
    await expectError(rpc(db,a.id,'recycle_cards',[[card],randomUUID()]),/card_reserved/);
    await rpc(db,b.id,'respond_gift',[gift_id,true]);
    expect(await owner(card)).toEqual({owner_id:b.id,reserved_kind:null});
    await expectError(rpc(db,b.id,'respond_gift',[gift_id,true]),/gift_unavailable/);
    await expectError(rpc(db,b.id,'send_gift',[a.id,card,randomUUID()]),/card_cooldown/); // reçue à l'instant
    await db.query(`update public.inventory_items set social_received_at=now()-interval '73 hours' where id=$1`,[card]);
    await expectError(rpc(db,b.id,'send_gift',[a.id,card,randomUUID()]),/card_returning/); // a l'a cédée il y a moins de 30 jours
    await db.query(`update public.gifts set closed_at=now()-interval '31 days' where id=$1`,[gift_id]);
    const back=await rpc(db,b.id,'send_gift',[a.id,card,randomUUID()]);
    await rpc(db,a.id,'respond_gift',[back.gift_id,false]);
    expect(await owner(card)).toEqual({owner_id:b.id,reserved_kind:null});
  });
  it('rend la carte à l’expiration',async()=>{
    const a=await player();const b=await player();await befriend(a,b);
    const card=await give(a.id);
    const {gift_id}=await rpc(db,a.id,'send_gift',[b.id,card,randomUUID()]);
    await db.query(`update public.gifts set expires_at=now()-interval '1 second' where id=$1`,[gift_id]);
    expect(Number((await db.query<{n:number}>('select private.expire_social() n')).rows[0].n)).toBe(1);
    expect(await owner(card)).toEqual({owner_id:a.id,reserved_kind:null});
    await expectError(rpc(db,b.id,'respond_gift',[gift_id,true]),/gift_unavailable/);
  });
});

describe('échanges',()=>{
  it('échange cartes et Deniers atomiquement, sans commission (taxe de 5 % sur les Deniers reçus)',async()=>{
    const a=await player();const b=await player();await befriend(a,b);
    await credit(db,a.id,1000);await credit(db,b.id,1000);
    const a1=await give(a.id,'Rare');const a2=await give(a.id,'Commun');const b1=await give(b.id,'Épique');
    const {trade_id}=await rpc(db,a.id,'propose_trade',[b.id,[a1,a2],[b1],200,50,randomUUID(),null]);
    expect(await balance(a.id)).toBe(800); // 200 bloqués
    expect(await owner(a1)).toEqual({owner_id:a.id,reserved_kind:'trade'});
    await rpc(db,b.id,'respond_trade',[trade_id,true]);
    expect((await owner(a1)).owner_id).toBe(b.id);expect((await owner(a2)).owner_id).toBe(b.id);
    expect((await owner(b1)).owner_id).toBe(a.id);
    expect(await balance(a.id)).toBe(800+48+10); // +50 reçus moins 2 de taxe, +10 découverte de l'Épique
    expect(await balance(b.id)).toBe(1000-50+190+20); // 200 moins 10 de taxe, +20 : deux découvertes
  });
  it('refus, annulation et expiration rendent cartes et Deniers',async()=>{
    const a=await player();const b=await player();await befriend(a,b);await credit(db,a.id,300);
    const card=await give(a.id);
    const t1=await rpc(db,a.id,'propose_trade',[b.id,[card],[],100,0,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t1.trade_id,false]);
    expect(await balance(a.id)).toBe(300);expect(await owner(card)).toEqual({owner_id:a.id,reserved_kind:null});
    const t2=await rpc(db,a.id,'propose_trade',[b.id,[card],[],100,0,randomUUID(),null]);
    await rpc(db,a.id,'cancel_trade',[t2.trade_id]);
    expect(await balance(a.id)).toBe(300);
    const t3=await rpc(db,a.id,'propose_trade',[b.id,[card],[],100,0,randomUUID(),null]);
    await db.query(`update public.trades set expires_at=now()-interval '1 second' where id=$1`,[t3.trade_id]);
    await rpc(db,a.id,'get_social');
    expect(await balance(a.id)).toBe(300);expect(await owner(card)).toEqual({owner_id:a.id,reserved_kind:null});
  });
  it('contre-proposition : l’offre initiale est close et les rôles s’inversent',async()=>{
    const a=await player();const b=await player();await befriend(a,b);await credit(db,a.id,500);
    const a1=await give(a.id);const b1=await give(b.id);const b2=await give(b.id,'Commun');
    const t1=await rpc(db,a.id,'propose_trade',[b.id,[a1],[b1],100,0,randomUUID(),null]);
    const t2=await rpc(db,b.id,'propose_trade',[a.id,[b2],[a1],0,150,randomUUID(),t1.trade_id]);
    expect(await balance(a.id)).toBe(500); // les 100 bloqués sont rendus
    const social=await rpc(db,a.id,'get_social');
    expect(social.trades.find((t:any)=>t.trade_id===t1.trade_id).status).toBe('countered');
    await rpc(db,a.id,'respond_trade',[t2.trade_id,true]);
    expect((await owner(a1)).owner_id).toBe(b.id);expect((await owner(b2)).owner_id).toBe(a.id);
    expect(await balance(a.id)).toBe(350+10);
  });
  it('respecte les limites et refuse les cartes indisponibles',async()=>{
    const a=await player();const b=await player();await befriend(a,b);
    const many=await Promise.all(Array.from({length:11},()=>give(a.id)));
    await expectError(rpc(db,a.id,'propose_trade',[b.id,many,[],0,0,randomUUID(),null]),/too_many_cards/);
    await expectError(rpc(db,a.id,'propose_trade',[b.id,[],[],0,0,randomUUID(),null]),/empty_trade/);
    const b1=await give(b.id);
    const t=await rpc(db,a.id,'propose_trade',[b.id,[many[0]],[b1],0,0,randomUUID(),null]);
    await rpc(db,b.id,'set_cards_locked',[[b1],true]);
    await expectError(rpc(db,b.id,'respond_trade',[t.trade_id,true]),/card_unavailable/);
    await expectError(rpc(db,a.id,'propose_trade',[b.id,[many[0]],[],0,0,randomUUID(),null]),/card_unavailable/); // déjà engagée
  });
  it('bloque les échanges des comptes de moins de 24 h',async()=>{
    const a=await player();const fresh=await createUser(db);await rpc(db,fresh,'set_handle',['tout_neuf']);
    await rpc(db,fresh,'send_friend_request',[a.handle]);
    const f=await rpc(db,a.id,'get_friends');await rpc(db,a.id,'respond_friend_request',[f.incoming[0].request_id,true]);
    await expectError(rpc(db,fresh,'propose_trade',[a.id,[await give(fresh)],[],0,0,randomUUID(),null]),/account_too_new/);
  });
});

describe('Deniers dans les échanges',()=>{
  it('taxe de 5 % sur les Deniers reçus, chaque côté',async()=>{
    const a=await player();const b=await player();await befriend(a,b);
    await credit(db,a.id,1000);await credit(db,b.id,1000);
    const t=await rpc(db,a.id,'propose_trade',[b.id,[await give(a.id)],[await give(b.id)],300,100,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t.trade_id,true]);
    expect(await balance(a.id)).toBe(1000-300+95+10); // +10 : découverte
    expect(await balance(b.id)).toBe(1000-100+285+10);
    const {rows:[r]}=await db.query<{p:string;r:string}>('select proposer_tax p, recipient_tax r from public.trades where id=$1',[t.trade_id]);
    expect([Number(r.p),Number(r.r)]).toEqual([5,15]);
  });
  it('plafonne les Deniers reçus par semaine, à la proposition et à l’acceptation',async()=>{
    const a=await player();const b=await player();const c=await player();await befriend(a,b);await befriend(c,b);
    await credit(db,a.id,5000);await credit(db,c.id,5000);
    await expectError(rpc(db,a.id,'propose_trade',[b.id,[await give(a.id)],[],2500,0,randomUUID(),null]),/trade_deniers_cap/);
    expect(await balance(a.id)).toBe(5000);
    // Deux propositions qui passent seules, mais pas ensemble : la seconde est refusée à l'acceptation.
    const t1=await rpc(db,a.id,'propose_trade',[b.id,[await give(a.id)],[],1500,0,randomUUID(),null]);
    const t2=await rpc(db,c.id,'propose_trade',[b.id,[await give(c.id)],[],1000,0,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t1.trade_id,true]);
    await expectError(rpc(db,b.id,'respond_trade',[t2.trade_id,true]),/trade_deniers_cap/);
    const status=await rpc(db,b.id,'get_trade_status');
    expect([status.trade_cap,status.trade_received_week,status.trade_tax_pct]).toEqual([2000,1500,5]);
    // Les échanges de cartes seules restent libres.
    const t3=await rpc(db,c.id,'propose_trade',[b.id,[await give(c.id)],[],0,0,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t3.trade_id,true]);
  });
});

describe('limites quotidiennes',()=>{
  // Les réglages sont versionnés : on active une nouvelle version.
  const setLimits=(t:number,g:number)=>db.exec(`update public.economy_settings set active=false where active;
    insert into public.economy_settings (version,active,settings) select max(version)+1,true,(select settings from public.economy_settings order by version desc limit 1)||'{"trade_daily_limit":${t},"gift_daily_limit":${g}}'::jsonb from public.economy_settings;`);
  it('plafonne les échanges conclus par jour, pour les deux parties',async()=>{
    await setLimits(2,0);
    const a=await player();const b=await player();const c=await player();await befriend(a,b);await befriend(a,c);
    const swap=async(x:{id:string},y:{id:string})=>{const t=await rpc(db,x.id,'propose_trade',[y.id,[await give(x.id)],[],0,0,randomUUID(),null]);return t.trade_id;};
    const t1=await swap(a,b);const t2=await swap(a,c);const t3=await swap(c,a);
    await rpc(db,b.id,'respond_trade',[t1,true]);await rpc(db,c.id,'respond_trade',[t2,true]);
    await expectError(rpc(db,a.id,'respond_trade',[t3,true]),/trade_daily_limit/); // a en est à 2
    await expectError(swap(b,a),/trade_daily_limit/); // prévenu dès la proposition
    const st=await rpc(db,a.id,'get_trade_status');
    expect([st.trade_daily_limit,st.trades_today]).toEqual([2,2]);
    await setLimits(5,5);
  });
  it('plafonne les cadeaux envoyés et reçus par jour',async()=>{
    await setLimits(0,2);
    const a=await player();const b=await player();const c=await player();const d=await player();
    await befriend(a,d);await befriend(b,d);await befriend(c,d);await befriend(a,b);
    const send=async(x:{id:string},y:{id:string})=>(await rpc(db,x.id,'send_gift',[y.id,await give(x.id),randomUUID()])).gift_id;
    const accept=(y:{id:string},g:string)=>rpc(db,y.id,'respond_gift',[g,true]);
    await accept(d,await send(a,d));await accept(d,await send(b,d));
    const g3=await send(c,d);
    await expectError(accept(d,g3),/gift_received_limit/); // d a déjà reçu 2 cadeaux
    await send(a,b);
    await expectError(send(a,b),/gift_daily_limit/); // a en a envoyé 2
    await setLimits(5,5);
  });
});

describe('délai après réception',()=>{
  it('empêche de redonner une carte reçue avant 72 h, sauf au marché',async()=>{
    const a=await player();const b=await player();const c=await player();await befriend(a,b);await befriend(b,c);
    const card=await give(a.id);const other=await give(b.id);
    const t=await rpc(db,a.id,'propose_trade',[b.id,[card],[other],0,0,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t.trade_id,true]);
    // Retour immédiat : refusé, par échange comme par cadeau, et la carte n'est pas proposée à l'ami.
    await expectError(rpc(db,b.id,'propose_trade',[a.id,[card],[],0,0,randomUUID(),null]),/card_cooldown/);
    await expectError(rpc(db,a.id,'propose_trade',[b.id,[],[card],0,0,randomUUID(),null]),/card_cooldown/);
    await expectError(rpc(db,b.id,'send_gift',[c.id,card,randomUUID()]),/card_cooldown/);
    expect((await rpc(db,a.id,'get_friend_cards',[b.id])).some((x:any)=>x.instance_id===card)).toBe(false);
    const {rows:[ch]}=await db.query<{character_id:string}>('select character_id from public.inventory_items where id=$1',[card]);
    expect((await rpc(db,b.id,'get_inventory',[ch.character_id])).find((x:any)=>x.instance_id===card).cooldown_until).toBeTruthy();
    await rpc(db,b.id,'create_listing',[card,50,randomUUID()]); // la vente reste possible
    // Passé le délai, la carte redevient libre.
    await db.query(`update public.inventory_items set social_received_at=now()-interval '25 hours' where id=$1`,[other]);
    await befriend(a,c);
    await expectError(rpc(db,a.id,'send_gift',[c.id,other,randomUUID()]),/card_cooldown/); // 72 h désormais
    await db.query(`update public.inventory_items set social_received_at=now()-interval '73 hours' where id=$1`,[other]);
    await rpc(db,a.id,'send_gift',[c.id,other,randomUUID()]);
  });
});

describe('fin des prêts',()=>{
  const age=(i:string)=>db.query(`update public.inventory_items set social_received_at=now()-interval '73 hours' where id=$1`,[i]);
  it('une carte ne revient pas avant 30 jours à qui l’a cédée, même par un troisième ami',async()=>{
    const a=await player();const b=await player();const c=await player();
    await befriend(a,b);await befriend(b,c);await befriend(c,a);
    const card=await give(a.id);
    const t=await rpc(db,a.id,'propose_trade',[b.id,[card],[],0,0,randomUUID(),null]);
    await rpc(db,b.id,'respond_trade',[t.trade_id,true]);await age(card);
    // B ne peut ni la rendre ni se la faire redemander par A.
    await expectError(rpc(db,b.id,'propose_trade',[a.id,[card],[],0,0,randomUUID(),null]),/card_returning/);
    await expectError(rpc(db,a.id,'propose_trade',[b.id,[],[card],0,0,randomUUID(),null]),/card_returning/);
    await expectError(rpc(db,b.id,'send_gift',[a.id,card,randomUUID()]),/card_returning/);
    expect((await rpc(db,a.id,'get_friend_cards',[b.id])).some((x:any)=>x.instance_id===card)).toBe(false);
    // Boucle A → B → C → A : bloquée aussi.
    const g=await rpc(db,b.id,'send_gift',[c.id,card,randomUUID()]);await rpc(db,c.id,'respond_gift',[g.gift_id,true]);await age(card);
    await expectError(rpc(db,c.id,'send_gift',[a.id,card,randomUUID()]),/card_returning/);
    await expectError(rpc(db,c.id,'send_gift',[b.id,card,randomUUID()]),/card_returning/);
    // Passé 30 jours, plus de blocage.
    await db.query(`update public.trades set closed_at=now()-interval '31 days' where id=$1`,[t.trade_id]);
    await rpc(db,c.id,'send_gift',[a.id,card,randomUUID()]);
  });
  it('bloque aussi le rachat au marché et les mises',async()=>{
    const a=await player();const b=await player();await credit(db,a.id,1000);await credit(db,b.id,1000);
    const card=await give(a.id);
    const l=await rpc(db,a.id,'create_listing',[card,5,randomUUID()]);
    await rpc(db,b.id,'buy_listing',[l.listing_id]);
    const back=await rpc(db,b.id,'create_listing',[card,5,randomUUID()]);
    await expectError(rpc(db,a.id,'buy_listing',[back.listing_id]),/card_returning/);
    expect((await owner(card)).owner_id).toBe(b.id);
    await rpc(db,b.id,'cancel_listing',[back.listing_id]);
    const auction=await rpc(db,b.id,'create_auction',[card,5,24,randomUUID()]);
    await expectError(rpc(db,a.id,'place_bid',[auction.listing_id,5,randomUUID()]),/card_returning/);
  });
});

describe('pseudonyme obligatoire',()=>{
  it('refuse vente, achat et échange sans pseudonyme',async()=>{
    const nameless=await createUser(db,{createdAt:OLD});await credit(db,nameless,500);
    const seller=await player();
    await expectError(rpc(db,nameless,'create_listing',[await give(nameless),20,randomUUID()]),/handle_required/);
    const l=await rpc(db,seller.id,'create_listing',[await give(seller.id),20,randomUUID()]);
    await expectError(rpc(db,nameless,'buy_listing',[l.listing_id]),/handle_required/);
    const st=await rpc(db,nameless,'get_trade_status');
    expect([st.allowed,st.handle_missing]).toEqual([false,true]);
    await rpc(db,nameless,'set_handle',['enfin_nomme']);
    await rpc(db,nameless,'buy_listing',[l.listing_id]);
  });
});
