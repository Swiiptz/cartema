import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let cam:string;let admin:string;let contest:string;
const card=async(rarity:string)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity=$2 limit 1`,[cam,rarity])).rows[0].id;
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
const submit=(u:string,c:string)=>rpc<string>(db,u,'submit_contest_entry',[c,`${u}/${randomUUID()}.webp`]);
const vote=(u:string,e:string)=>rpc(db,u,'vote_contest_entry',[e,true]);
const board=async()=>Object.fromEntries((await rpc<any[]>(db,admin,'get_contest_leaderboard')).map(r=>[r.handle,r.points]));
beforeAll(async()=>{
  db=await createDb();cam=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['jury']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
  contest=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours d’automne',cam,new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+86400e3).toISOString(),null,'Week-end']);
},30000);

describe('concours d’illustrations',()=>{
  it('montre les cartes sans les Mythiques, neutres si non découvertes',async()=>{
    const u=await player('curieux_concours');
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,await card('Rare')]);
    const c=await rpc(db,u,'get_contest');
    expect(c).toMatchObject({title:'Concours d’automne',open:true});
    expect((await rpc(db,u,'get_player_state')).contest).toMatchObject({id:contest,title:'Concours d’automne'});
    expect(c.cards.map((x:any)=>x.rarity)).not.toContain('Mythique');
    expect(c.cards).toHaveLength(6);
    const rare=c.cards.find((x:any)=>x.rarity==='Rare'),commun=c.cards.find((x:any)=>x.rarity==='Commun');
    expect(rare).toMatchObject({discovered:true});expect(rare.card).toBeTruthy();
    expect(commun).toMatchObject({discovered:false,card:null});expect(commun.name).toBeTruthy();
    await expectError(rpc(db,u,'get_contest_card',[await card('Mythique')]),/not_found/);
  });
  it('un dessin et un vote par carte, point à l’auteur en tête, premier arrivé à égalité',async()=>{
    const a=await player('peintre_a'),b=await player('peintre_b'),v1=await player('votant_1'),v2=await player('votant_2'),v3=await player('votant_3');
    const c=await card('Commun');
    const ea=await submit(a,c),eb=await submit(b,c);
    await expectError(vote(a,ea),/own_entry/);
    await expectError(rpc(db,a,'submit_contest_entry',[c,`${b}/vol.webp`]),/invalid_image/);
    await vote(v1,ea);                    // A en tête
    expect(await board()).toMatchObject({peintre_a:1});
    await vote(v2,eb);                    // égalité : A l'a atteinte en premier
    expect(await board()).toMatchObject({peintre_a:1});
    expect((await board()).peintre_b).toBeUndefined();
    await vote(v3,eb);                    // B passe devant : le point change de main
    let r=await board();expect(r.peintre_b).toBe(1);expect(r.peintre_a).toBeUndefined();
    await vote(v3,ea);                    // v3 change d'avis : un seul vote par carte
    r=await board();expect(r.peintre_a).toBe(1);
    const cardView=await rpc<any[]>(db,v3,'get_contest_card',[c]);
    expect(cardView.map(e=>[e.author,e.votes,e.my_vote])).toEqual([['peintre_a',2,true],['peintre_b',1,false]]);
    // Nouveau dessin : ses votes repartent à zéro.
    await submit(a,c);
    r=await board();expect(r.peintre_b).toBe(1);
    // Signalement puis masquage : le dessin perd ses votes.
    await rpc(db,v1,'report_contest_entry',[eb,'Ce n’est pas un dessin']);
    const entries=await rpc<any[]>(db,admin,'admin_contest_entries',[contest]);
    expect(entries.find(e=>e.entry_id===eb).reports).toEqual(['Ce n’est pas un dessin']);
    await rpc(db,admin,'admin_hide_contest_entry',[eb,true,'Troll']);
    expect((await board()).peintre_b).toBeUndefined();
    expect((await rpc<any[]>(db,v1,'get_contest_card',[c])).some(e=>e.entry_id===eb)).toBe(false);
  });
  it('après la clôture : validation, carte offerte, points et récompenses une seule fois',async()=>{
    const p=await player('artiste_or'),q=await player('artiste_argent'),w=await player('jury_public');
    const epic=await card('Épique'),rare=await card('Rare');
    const ep=await submit(p,epic),er=await submit(q,rare);await vote(w,ep);
    await expectError(rpc(db,admin,'admin_decide_contest_entry',[ep,'main',null,true,'/illustrations/CAM/concours.webp',{},'trop tôt']),/contest_open/);
    await db.query(`update public.contests set ends_at=now()-interval '1 minute', starts_at=now()-interval '2 days' where id=$1`,[contest]);
    await expectError(submit(p,rare),/contest_closed/);
    await expectError(vote(w,er),/contest_closed/);
    // Principale pour l'Épique : carte Dorée offerte avec la nouvelle illustration officielle.
    const d1=await rpc(db,admin,'admin_decide_contest_entry',[ep,'main',null,true,'/illustrations/CAM/concours.webp',{},'Superbe']);
    expect(d1.finish).toBe('Dorée');
    const {rows:[ch]}=await db.query<{art_path:string;art_credit:string}>('select art_path,art_credit from public.characters where id=$1',[epic]);
    expect(ch).toEqual({art_path:'/illustrations/CAM/concours.webp',art_credit:'artiste_or'});
    // Alternative pour la Rare : carte Sanglante avec la version de la ligne choisie.
    await rpc(db,admin,'admin_decide_contest_entry',[er,'alternate','Ligne Concours',false,'/illustrations/CAM/concours-rare.webp',{},'Belle version']);
    const {rows:[inst]}=await db.query<{finish:string;label:string}>(`select i.finish,a.label from public.inventory_items i join public.card_arts a on a.id=i.art_id where i.owner_id=$1`,[q]);
    expect(inst).toEqual({finish:'Sanglante',label:'Ligne Concours'});
    const r=await board();
    expect(r.artiste_or).toBe(3);         // en tête + retenu + vrai dessin
    expect(r.artiste_argent).toBe(1);     // retenu seulement
    // Distribution : barème par place, titre pour le podium, une seule fois.
    const before=Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[p])).rows[0].b);
    await rpc(db,admin,'admin_reward_contest',[contest,'Fin du concours']);
    const after=Number((await db.query<{b:string}>('select balance b from public.wallets where owner_id=$1',[p])).rows[0].b);
    expect(after-before).toBe(3000);
    expect((await rpc<any[]>(db,p,'get_achievements')).find(a=>a.code===`contest:${contest}`)).toMatchObject({title:'Illustrateur de génie'});
    expect(await rpc(db,p,'set_title',[`contest:${contest}`])).toBe('Illustrateur de génie');
    await expectError(rpc(db,admin,'admin_reward_contest',[contest,'Encore']),/already_granted/);
  });
});

describe('édition éternelle',()=>{
  it('ajoute une sixième carte éternelle au God booster et aux éditions qui l’autorisent',async()=>{
    const {rows:[ed]}=await db.query<{id:string}>(`insert into public.editions (name,prefix,album_published) values ('Éternelle','ETER',true) returning id`);
    await rpc(db,admin,'admin_set_edition_eternal',[ed.id,true,false,'Édition éternelle']);
    // Une carte par rareté de la 5e carte : la sixième tombe à coup sûr.
    let n=0;for(const r of ['Rare','Très rare','Épique','Légendaire','Mythique'])
      await db.query(`insert into public.characters (edition_id,number,name,rarity,status) values ($1,$2,$3,$4,'published')`,[ed.id,++n,`Éternel ${n}`,r]);
    await expectError(rpc(db,admin,'admin_set_packs',[ed.id,true,'Ouvrir']),/eternal_edition|edition_incomplete/);
    const u=await player('chanceux_eternel');
    await db.query('update public.booster_balances set purchased_count=5 where owner_id=$1',[u]);
    const open=()=>rpc(db,u,'open_booster',[cam,randomUUID()]);
    expect((await open()).cards).toHaveLength(5);          // ni God ni option : pas de sixième carte
    await rpc(db,admin,'admin_save_god_settings',[1,0,20,2,'Test : toujours']);
    let o=await open();
    expect(o.cards).toHaveLength(6);
    expect(o.cards.find((c:any)=>c.position===6).code).toMatch(/^ETER-/);
    await rpc(db,admin,'admin_save_god_settings',[0,10,20,2,'Test : jamais']);
    await rpc(db,admin,'admin_set_edition_eternal',[cam,false,true,'Option éternelle sur CAM']);
    o=await open();
    expect(o.god).toBe(false);
    expect(o.cards).toHaveLength(6);
    await rpc(db,admin,'admin_set_edition_eternal',[cam,false,false,'Option retirée']);
    expect((await open()).cards).toHaveLength(5);
  });
});
