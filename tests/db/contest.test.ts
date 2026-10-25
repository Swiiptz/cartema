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
  // Toutes illustrées par défaut : seules les cartes choisies par un test sont « à privilégier ».
  await db.query(`update public.characters set art_path='/illustrations/test.webp' where edition_id=$1`,[cam]);
  // Mythiques admises par défaut depuis le 25/10 : décochées ici pour les tests qui en dépendent.
  contest=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours d’automne',cam,new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+86400e3).toISOString(),null,'Week-end',null,false]);
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
  it('règles écrites par l’admin : gardées si absentes, effacées par un texte vide',async()=>{
    const u=await player('lecteur_regles');
    const c0=await rpc(db,u,'get_contest');
    expect(c0.rules).toBeNull(); // règles par défaut
    const save=(rules:string|null)=>rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Règles',rules]);
    await save('  Thème : la nuit.\n- Noir et blanc seulement.  ');
    expect((await rpc(db,u,'get_contest')).rules).toBe('Thème : la nuit.\n- Noir et blanc seulement.');
    expect((await rpc<any[]>(db,admin,'admin_contests')).find(x=>x.id===contest).rules).toBe('Thème : la nuit.\n- Noir et blanc seulement.');
    await save(null); // ancien site : sans règles, rien ne change
    expect((await rpc(db,u,'get_contest')).rules).toBe('Thème : la nuit.\n- Noir et blanc seulement.');
    await expectError(save('x'.repeat(8001)),/rules_too_long/);
    await expectError(rpc(db,u,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Triche','Rien']),/forbidden|admin/);
    await save('   ');
    expect((await rpc(db,u,'get_contest')).rules).toBeNull();
  });
  it('Mythiques admises sur option du concours, jamais la carte unique (23/10)',async()=>{
    const u=await player('dessine_mythe');
    const c0=await rpc(db,u,'get_contest');
    expect(c0.allow_mythic).toBe(false);
    const save=(on:boolean|null)=>rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Mythiques',null,on]);
    await save(true);
    const c1=await rpc(db,u,'get_contest');
    expect(c1.allow_mythic).toBe(true);
    expect(c1.cards.map((x:any)=>x.rarity)).toContain('Mythique');
    expect(c1.cards).toHaveLength(7);
    const myth=await card('Mythique');
    const e=await submit(u,myth);
    expect(e).toBeTruthy();
    await save(null); // non précisé : inchangé
    expect((await rpc(db,u,'get_contest')).allow_mythic).toBe(true);
    await save(false);
    expect((await rpc(db,u,'get_contest')).cards).toHaveLength(6);
    await expectError(submit(u,myth),/not_found|invalid/);
    await db.query('delete from public.contest_entries where id=$1',[e]);
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
  it('cartes à privilégier (sans illustration ou illustration IA) : points en tête doublés, signalées sur la page',async()=>{
    const a=await player('peintre_prio'),v=await player('votant_prio');
    const c=await card('Peu commun');
    const isPrio=async()=>(await rpc(db,v,'get_contest')).cards.find((x:any)=>x.character_id===c).priority;
    expect(await isPrio()).toBe(false);
    await expectError(rpc(db,v,'admin_set_art_ai',[c,true,'Triche']),/forbidden/);
    await rpc(db,admin,'admin_set_art_ai',[c,true,'Illustration IA à remplacer']);
    expect(await isPrio()).toBe(true);
    expect((await rpc(db,v,'get_contest')).priority_multiplier).toBe(2);
    const e=await submit(a,c);await vote(v,e);
    expect((await board()).peintre_prio).toBe(2); // en tête d'une carte à privilégier : 2 points
    // Une nouvelle illustration officielle n'est plus « IA ».
    await db.query(`update public.characters set art_path='/illustrations/nouvelle.webp' where id=$1`,[c]);
    expect(await isPrio()).toBe(false);
    expect((await board()).peintre_prio).toBe(1);
    // Sans illustration : à privilégier aussi.
    await db.query(`update public.characters set art_path=null where id=$1`,[c]);
    expect(await isPrio()).toBe(true);
    expect((await rpc(db,admin,'admin_catalog')).characters.find((x:any)=>x.id===c)).toMatchObject({art_ai:false,art_path:null});
  });
  it('Mythiques : admises par défaut, points ×4 sans cumul avec le ×2, signalées sur la page (25/10)',async()=>{
    // Un nouveau concours admet les Mythiques sans qu'on le précise.
    const later=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours lointain',cam,new Date(Date.now()+60*86400e3).toISOString(),new Date(Date.now()+62*86400e3).toISOString(),null,'Plus tard']);
    expect((await rpc<any[]>(db,admin,'admin_contests')).find(x=>x.id===later)).toMatchObject({allow_mythic:true,mythic_multiplier:4});
    await db.query('delete from public.contests where id=$1',[later]);
    const c0=await rpc(db,admin,'get_contest');
    await rpc(db,admin,'admin_save_contest',[contest,c0.title,cam,c0.starts_at,c0.ends_at,null,'Mythiques',null,true]);
    const a=await player('peintre_mythe'),v=await player('votant_mythe');
    const myth=await card('Mythique');
    const info=async()=>(await rpc(db,v,'get_contest')).cards.find((x:any)=>x.character_id===myth);
    expect(await info()).toMatchObject({priority:true,multiplier:4});
    expect((await rpc(db,v,'get_contest')).mythic_multiplier).toBe(4);
    const e=await submit(a,myth);await vote(v,e);
    expect((await board()).peintre_mythe).toBe(4); // en tête d'une Mythique : 4 points
    // Sans illustration, une Mythique reste ×4 (pas ×8).
    await db.query(`update public.characters set art_path=null where id=$1`,[myth]);
    expect(await info()).toMatchObject({multiplier:4});
    expect((await board()).peintre_mythe).toBe(4);
    await db.query(`update public.characters set art_path='/illustrations/test.webp' where id=$1`,[myth]);
    // Les cartes ordinaires gardent leur multiplicateur.
    expect((await rpc(db,v,'get_contest')).cards.find((x:any)=>x.rarity==='Rare')).toMatchObject({multiplier:1});
    // Dessin masqué : il ne fausse pas le podium du test de clôture.
    await rpc(db,admin,'admin_hide_contest_entry',[e,true,'Fin du test']);
    expect((await board()).peintre_mythe).toBeUndefined();
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
    // Alternative pour la Rare : carte en contour classique avec la version de la ligne choisie.
    await rpc(db,admin,'admin_decide_contest_entry',[er,'alternate','Ligne Concours',false,'/illustrations/CAM/concours-rare.webp',{},'Belle version']);
    const {rows:[inst]}=await db.query<{finish:string;label:string}>(`select i.finish,a.label from public.inventory_items i join public.card_arts a on a.id=i.art_id where i.owner_id=$1`,[q]);
    expect(inst).toEqual({finish:'Standard',label:'Ligne Concours'});
    // Exemplaire de l'artiste : ni vente, ni échange, ni don pendant 30 jours ; la mention reste ensuite.
    const {rows:[gift]}=await db.query<{id:string}>(`select id from public.inventory_items where owner_id=$1 and art_id is not null`,[q]);
    await expectError(rpc(db,q,'create_listing',[gift.id,500,randomUUID()]),/artist_copy/);
    const copy=(await rpc<any[]>(db,q,'get_inventory',[rare])).find(x=>x.instance_id===gift.id);
    expect(copy.artist_copy).toBe(true);
    expect(new Date(copy.artist_until).getTime()).toBeGreaterThan(Date.now()+29*86400e3);
    await db.query(`update public.inventory_items set artist_until=now()-interval '1 minute' where id=$1`,[gift.id]);
    const freed=(await rpc<any[]>(db,q,'get_inventory',[rare])).find(x=>x.instance_id===gift.id);
    expect(freed).toMatchObject({artist_copy:true,artist_until:null});
    expect((await rpc(db,q,'create_listing',[gift.id,500,randomUUID()])).listing_id).toBeTruthy();
    // Galerie : dessins retenus visibles dès les choix faits, podium seulement après la distribution.
    const g0=(await rpc<any[]>(db,w,'get_contest_gallery')).find(x=>x.id===contest);
    expect(g0).toMatchObject({title:'Concours d’automne',final:false,podium:[]});
    expect(g0.selected.map((s:any)=>[s.author,s.kind])).toEqual(expect.arrayContaining([['artiste_or','main'],['artiste_argent','alternate']]));
    expect(g0.selected.find((s:any)=>s.kind==='main').card).toMatchObject({art_path:'/illustrations/CAM/concours.webp'});
    expect(g0.selected.find((s:any)=>s.kind==='alternate')).toMatchObject({line_label:'Ligne Concours'});
    expect(g0.selected.find((s:any)=>s.kind==='alternate').card).toMatchObject({variant:'Ligne Concours'});
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
    const g1=(await rpc<any[]>(db,w,'get_contest_gallery')).find(x=>x.id===contest);
    expect(g1.final).toBe(true);
    expect(g1.podium[0]).toMatchObject({place:1,handle:'artiste_or',points:3});
  });
});

describe('versions alternatives retenues',()=>{
  it('valent un point plein ou un demi-point, multiplicateur compris, arrondi au supérieur sur le total (25/10)',async()=>{
    const id=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours des versions',cam,new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+86400e3).toISOString(),null,'Versions']);
    const rapide=await player('dessin_rapide'),soigne=await player('dessin_soigne');
    const en=[await submit(rapide,await card('Commun')),await submit(rapide,await card('Peu commun')),await submit(rapide,await card('Rare'))];
    const fini=await submit(soigne,await card('Très rare'));
    const myth=await submit(soigne,await card('Mythique'));
    await db.query(`update public.contests set ends_at=now()-interval '1 minute' where id=$1`,[id]);
    const alt=(e:string,half:boolean|null)=>rpc(db,admin,'admin_decide_contest_entry',[e,'alternate','Ligne des versions',false,'/illustrations/CAM/version.webp',{},'Version retenue',half]);
    for(const e of en)await alt(e,true);   // 3 demi-points = 1,5
    await alt(fini,false);                 // point plein = 1
    await alt(myth,true);                  // Mythique ×4, demi-point = 2
    const {rows}=await db.query<{handle:string;points:string;selected:string}>('select handle,points,selected from private.contest_ranking($1)',[id]);
    const pts=Object.fromEntries(rows.map(r=>[r.handle,Number(r.points)]));
    expect(pts).toMatchObject({dessin_rapide:2,dessin_soigne:3}); // 1,5 arrondi à 2 ; 1 + 2
    expect((await rpc<any[]>(db,admin,'admin_contest_entries',[id])).find(x=>x.entry_id===fini)).toMatchObject({selected:'alternate',half_point:false});
    expect((await rpc<any[]>(db,admin,'admin_contest_entries',[id])).find(x=>x.entry_id===en[0])).toMatchObject({half_point:true});
    // Sans précision (ancien site) : point plein, comme avant.
    await db.query('delete from public.contests where id=$1',[id]);
  });
});

describe('galerie',()=>{
  it('ne montre pas un concours encore ouvert',async()=>{
    const u=await player('visiteur_galerie');
    const open=await rpc<string>(db,admin,'admin_save_contest',[null,'Concours ouvert',cam,new Date(Date.now()-3600e3).toISOString(),new Date(Date.now()+86400e3).toISOString(),null,'Ouvert']);
    expect((await rpc<any[]>(db,u,'get_contest_gallery')).some(x=>x.id===open)).toBe(false);
    await db.query('delete from public.contests where id=$1',[open]);
  });
});

describe('concours à venir',()=>{
  it('s’annonce 14 jours avant : accueil et page Concours, sans cartes ni dessins avant le début',async()=>{
    const fresh=await createDb();const ed=await seedEdition(fresh,{prefix:'CAM',perRarity:1});
    const boss=await createUser(fresh);await fresh.query(`update public.profiles set role='admin' where id=$1`,[boss]);
    const u=await createUser(fresh,{createdAt:'2026-01-01T00:00:00Z'});await rpc(fresh,u,'set_handle',['impatient']);
    const day=86400e3;
    await rpc(fresh,boss,'admin_save_contest',[null,'Concours lointain',ed,new Date(Date.now()+30*day).toISOString(),new Date(Date.now()+32*day).toISOString(),null,'Plus tard']);
    expect((await rpc(fresh,u,'get_player_state')).contest_next).toBeNull(); // trop loin
    await rpc(fresh,boss,'admin_save_contest',[null,'Concours rush',ed,new Date(Date.now()+2*day).toISOString(),new Date(Date.now()+4*day).toISOString(),null,'Bientôt']);
    const st=await rpc(fresh,u,'get_player_state');
    expect(st.contest).toBeNull();
    expect(st.contest_next).toMatchObject({title:'Concours rush',edition:'Édition CAM'});
    const c=await rpc(fresh,u,'get_contest');
    expect(c).toMatchObject({title:'Concours rush',upcoming:true,open:false,cards:[]});
    const {rows:[card]}=await fresh.query<{id:string}>(`select id from public.characters where edition_id=$1 and rarity='Rare'`,[ed]);
    await expectError(rpc(fresh,u,'submit_contest_entry',[card.id,`${u}/x.webp`]),/contest_closed|not_found/);
  },30000);
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
