import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;let admin:string;
const ART='/illustrations/CAM/a.webp',ART2='/illustrations/CAM/b.webp',PAINT='/illustrations/CAM/paint.webp';
beforeAll(async()=>{
  db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:1});
  admin=await createUser(db);await rpc(db,admin,'set_handle',['conservateur']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(handle:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[handle]);return id;}
const char=async(n:number)=>(await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=$2`,[edition,n])).rows[0].id;
async function give(owner:string,n:number){const {rows:[r]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[owner,await char(n)]);return r.id;}

describe('versions d’illustration',()=>{
  it('garde l’ancienne illustration sur les exemplaires déjà possédés',async()=>{
    const u=await player('ancien');const c=await char(2);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    const before=await give(u,2);
    await db.query(`update public.characters set art_meta='{"offsetY":5}' where id=$1`,[c]); // recadrage : pas de version
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c]))).toEqual([]);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART2]);
    const after=await give(u,2);
    const inv=await rpc<any[]>(db,u,'get_inventory',[c]);
    expect(inv.find(i=>i.instance_id===before)).toMatchObject({variant:'Illustration d’origine',variant_kind:'legacy',variant_art:ART});
    expect(inv.find(i=>i.instance_id===after).variant).toBeNull();
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2) on conflict do nothing`,[u,c]);
    const album=(await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===2);
    expect(album.art_path).toBe(ART2);
    expect(album.variants).toEqual([{label:'Illustration d’origine',kind:'legacy',art_path:ART,art_meta:{offsetY:5},credit:null,count:1}]);
    // La version suit l'exemplaire dans la vitrine.
    await rpc(db,u,'set_showcase',[[before]]);
    expect((await rpc(db,u,'get_profile',['ancien'])).showcase[0]).toMatchObject({art_path:ART,variant:'Illustration d’origine'});
  });
  it('tire une version alternative selon la chance globale',async()=>{
    const c=await char(3);
    const art=await rpc<string>(db,admin,'admin_add_card_art',[c,PAINT,{},'Version Paint','Dessin maison']);
    await rpc(db,admin,'admin_save_settings',[{alternate_art_odds:1},'Test : toujours']);
    // Ne garder que le personnage 3 dans les raretés qu'il occupe : le tirer est alors certain pour sa rareté.
    const u=await player('chanceux_paint');
    await db.query('update public.booster_balances set free_count=6 where owner_id=$1',[u]);
    let hit:any=null;
    for(let i=0;i<6&&!hit;i++){const o=await rpc(db,u,'open_booster',[edition,randomUUID()]);hit=o.cards.find((x:any)=>x.number===3)??null;}
    expect(hit).not.toBeNull(); // ~0,2 % de malchance : aucun Rare tiré en 6 boosters
    expect(hit).toMatchObject({variant:'Version Paint',variant_kind:'alternate',art_path:PAINT});
    await rpc(db,admin,'admin_set_card_art_active',[art,false,'Pause']);
    await rpc(db,admin,'admin_save_settings',[{alternate_art_odds:500},'Retour à la normale']);
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c]))[0]).toMatchObject({active:false,kind:'alternate'});
    await expectError(rpc(db,admin,'admin_add_card_art',[c,'https://evil.example/x.png',{},'x','x']),/invalid_art_path/);
  });
});

describe('anciennes illustrations officielles',()=>{
  it('tombent comme des versions alternatives tant qu’elles sont actives (par défaut)',async()=>{
    const u=await player('ancien_tirable');const c=await char(3); // sa version Paint est désactivée plus haut
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    const copy=await give(u,3);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,'/illustrations/CAM/v2.webp']);
    const legacy=(await rpc<any[]>(db,admin,'admin_card_arts',[c])).find(a=>a.kind==='legacy');
    expect(legacy).toMatchObject({active:true,owned:1}); // active par défaut
    const pick=async()=>(await db.query<{a:string|null}>('select private.pick_alternate_art($1,1) a',[c])).rows[0].a;
    expect(await pick()).toBe(legacy.id);
    const {lines}=await rpc(db,admin,'admin_art_lines');
    expect(lines.find((l:any)=>l.label===legacy.label)).toMatchObject({legacy:true,active:true});
    await rpc(db,admin,'admin_set_card_art_active',[legacy.id,false,'Ne plus la faire tomber']);
    expect(await pick()).toBeNull();
    // L'exemplaire possédé la garde.
    expect((await db.query<{art_id:string}>('select art_id from public.inventory_items where id=$1',[copy])).rows[0].art_id).toBe(legacy.id);
    await rpc(db,admin,'admin_set_card_art_active',[legacy.id,true,'Retour']);
    expect(await pick()).toBe(legacy.id);
  });
});
describe('lignes de versions',()=>{
  const pick=async(c:string,global:number)=>(await db.query<{a:string|null}>('select private.pick_alternate_art($1,$2) a',[c,global])).rows[0].a;
  it('règle la chance et l’activation de toutes les versions du même nom',async()=>{
    const c1=await char(1),c7=await char(7);
    const a1=await rpc<string>(db,admin,'admin_add_card_art',[c1,PAINT,{},'Ligne Néon','Test']);
    await rpc(db,admin,'admin_add_card_art',[c7,PAINT,{},'Ligne Néon','Test']);
    expect(await pick(c1,1)).toBe(a1);   // sans réglage : chance globale
    expect(await pick(c1,0)).toBeNull();
    await rpc(db,admin,'admin_set_art_line',['Ligne Néon',true,1,'Toujours']);
    expect(await pick(c1,0)).toBe(a1);   // chance propre, même si la globale est à 0
    await rpc(db,admin,'admin_set_art_line',['Ligne Néon',true,0,'Jamais']);
    expect(await pick(c1,1)).toBeNull();
    await rpc(db,admin,'admin_set_art_line',['Ligne Néon',false,null,'Pause']);
    expect(await pick(c1,1)).toBeNull();
    expect(await pick(c7,1)).toBeNull();
    const {lines}=await rpc(db,admin,'admin_art_lines');
    const neon=lines.find((l:any)=>l.label==='Ligne Néon');
    expect(neon).toMatchObject({active:false,odds:null,arts:2,active_arts:2,characters:2,owned:0});
    expect(neon.cards.map((c:any)=>[c.code,c.active,c.owned])).toEqual([['CAM-001',true,0],['CAM-007',true,0]]);
    await rpc(db,admin,'admin_set_art_line',['Ligne Néon',true,null,'Reprise']);
    expect(await pick(c7,1)).not.toBeNull();
    await expectError(rpc(db,admin,'admin_set_art_line',['Ligne Néon',true,-1,'x']),/invalid_odds/);
    await expectError(rpc(db,admin,'admin_set_art_line',['Inconnue',true,null,'x']),/not_found/);
    await expectError(rpc(db,await player('curieux_ligne'),'admin_art_lines'),/./);
  });
});

describe('chances par rareté (26/10)',()=>{
  const odds=async(line:number|null,manual:object,global:number,rarity:string)=>(await db.query<{o:number}>(
    'select private.alt_line_odds($1,$2,$3,$4) o',[line,JSON.stringify(manual),global,rarity])).rows[0].o;
  it('divise la chance par le multiplicateur de la rareté, sauf réglage à la main',async()=>{
    const mult=(await rpc(db,admin,'admin_art_lines')).rarity_mult;
    expect(mult).toEqual({Commun:1,'Peu commun':1,Rare:2,'Très rare':3,'Épique':5,'Légendaire':10,Mythique:20});
    expect(await odds(null,{},1000,'Commun')).toBe(1000);
    expect(await odds(null,{},1000,'Épique')).toBe(200);
    expect(await odds(700,{},1000,'Mythique')).toBe(35);
    expect(await odds(100,{},1000,'Très rare')).toBe(33);
    expect(await odds(null,{},1,'Mythique')).toBe(1);          // jamais en dessous de 1 sur 1
    expect(await odds(0,{'Épique':5},1000,'Épique')).toBe(0);  // ligne à 0 : jamais, même réglée à la main
    expect(await odds(null,{'Épique':50},1000,'Épique')).toBe(50);
    expect(await odds(null,{'Épique':0},1000,'Épique')).toBe(0);
    expect(await odds(null,{'Épique':50},1000,'Rare')).toBe(500);
    expect(await odds(null,{},0,'Épique')).toBe(0);
  });
  it('réglage à la main par ligne, lissage et multiplicateurs modifiables',async()=>{
    const c=await char(6); // Légendaire
    const art=await rpc<string>(db,admin,'admin_add_card_art',[c,PAINT,{},'Ligne Légende','Test']);
    const pick=async()=>(await db.query<{a:string|null}>('select private.pick_alternate_art($1,1000000) a',[c])).rows[0].a;
    expect(await pick()).toBeNull(); // 1 sur 100 000 : quasi jamais
    await rpc(db,admin,'admin_set_art_line',['Ligne Légende',true,null,'À la main',{'Légendaire':1}]);
    expect(await pick()).toBe(art);
    const line=(await rpc(db,admin,'admin_art_lines')).lines.find((l:any)=>l.label==='Ligne Légende');
    expect(line.rarity_odds).toEqual({'Légendaire':1});
    // Sans p_rarity_odds, le réglage à la main est gardé ; {} le retire (lissage).
    await rpc(db,admin,'admin_set_art_line',['Ligne Légende',true,null,'Chance globale']);
    expect(await pick()).toBe(art);
    await rpc(db,admin,'admin_set_art_line',['Ligne Légende',true,null,'Lisser',{}]);
    expect(await pick()).toBeNull();
    await expectError(rpc(db,admin,'admin_set_art_line',['Ligne Légende',true,null,'x',{Inconnue:3}]),/invalid_odds/);
    await expectError(rpc(db,admin,'admin_set_art_line',['Ligne Légende',true,null,'x',{Rare:-1}]),/invalid_odds/);
    // Multiplicateurs : toutes les raretés, de 1 à 1 000.
    const all={Commun:1,'Peu commun':1,Rare:2,'Très rare':3,'Épique':5,'Légendaire':10,Mythique:20};
    await expectError(rpc(db,admin,'admin_save_settings',[{alternate_rarity_mult:{...all,Mythique:0}},'x']),/invalid_setting/);
    await expectError(rpc(db,admin,'admin_save_settings',[{alternate_rarity_mult:{Rare:2}},'x']),/invalid_setting/);
    await rpc(db,admin,'admin_save_settings',[{alternate_rarity_mult:{...all,'Légendaire':100}},'Plus de légendes']);
    expect(await odds(null,{},1000,'Légendaire')).toBe(10);
    await rpc(db,admin,'admin_save_settings',[{alternate_rarity_mult:all},'Retour']);
  });
  it('renomme une ligne partout, réglages compris',async()=>{
    const c1=await char(1),c2=await char(2);
    await rpc(db,admin,'admin_add_card_art',[c1,PAINT,{},'Ligne Brouillon','Test']);
    await rpc(db,admin,'admin_add_card_art',[c2,PAINT,{},'Ligne Brouillon','Test']);
    await rpc(db,admin,'admin_add_card_art',[c2,PAINT,{},'Ligne Prise','Test']);
    await rpc(db,admin,'admin_set_art_line',['Ligne Brouillon',true,250,'Réglage',{Rare:40}]);
    await expectError(rpc(db,admin,'admin_rename_art_line',['Ligne Brouillon','Ligne Prise','x']),/line_exists/);
    await expectError(rpc(db,admin,'admin_rename_art_line',['Ligne Brouillon','  ','x']),/invalid_label/);
    await expectError(rpc(db,admin,'admin_rename_art_line',['Inconnue','Autre','x']),/not_found/);
    await expectError(rpc(db,await player('curieux_renom'),'admin_rename_art_line',['Ligne Brouillon','Pirate','x']),/./);
    await rpc(db,admin,'admin_rename_art_line',['Ligne Brouillon',' Ligne Aube ','Nom définitif']);
    const lines=(await rpc(db,admin,'admin_art_lines')).lines;
    expect(lines.find((l:any)=>l.label==='Ligne Brouillon')).toBeUndefined();
    expect(lines.find((l:any)=>l.label==='Ligne Aube')).toMatchObject({odds:250,rarity_odds:{Rare:40},arts:2,characters:2});
  });
});

describe('contributions des joueurs',()=>{
  it('propose une illustration, l’admin accepte avec récompense, l’auteur est prévenu',async()=>{
    const u=await player('artiste');const c=await char(4);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','info','Le clan est faux.']),/not_discovered/);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','illustration','',`${randomUUID()}/x.png`]),/image_required/);
    const id=await rpc<string>(db,u,'submit_card_feedback',['CAM-004','illustration','Mon dessin',`${u}/portrait.png`]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-004','illustration','Encore',`${u}/b.png`]),/already_submitted/);
    await rpc(db,u,'submit_card_feedback',['CAM-004','info','Le titre est Primogène, pas Nouveau-né.']);
    const list=await rpc<any[]>(db,admin,'admin_submissions',['pending']);
    expect(list.map(s=>s.kind).sort()).toEqual(['illustration','info']);
    expect((await rpc(db,admin,'get_notifications')).items.some((n:any)=>n.kind==='submission_received')).toBe(true);
    const boosters=async()=>(await db.query<{n:number}>('select purchased_count n from public.booster_balances where owner_id=$1',[u])).rows[0].n;
    const b0=await boosters();
    await rpc(db,admin,'admin_decide_submission',[id,true,0,1,'Superbe, appliquée']);
    expect(await boosters()).toBe(b0+1);
    await expectError(rpc(db,admin,'admin_decide_submission',[id,true,0,1,'x']),/already_closed/);
    const n=(await rpc(db,u,'get_notifications')).items.find((x:any)=>x.kind==='submission_decided');
    expect(n.payload).toMatchObject({accepted:true,reward_boosters:1});
    const info=(await rpc<any[]>(db,admin,'admin_submissions',['pending']))[0];
    await expectError(rpc(db,admin,'admin_decide_submission',[info.id,false,0,0,' ']),/reason_required/);
    await rpc(db,admin,'admin_decide_submission',[info.id,false,500,0,'Information correcte']);
    expect((await rpc<any[]>(db,u,'get_my_submissions')).map(s=>s.status).sort()).toEqual(['accepted','rejected']);
    await expectError(rpc(db,u,'admin_submissions',['pending']),/forbidden/);
  });
});

describe('crédits d’illustration',()=>{
  it('crédite l’artiste après validation et archive le crédit avec l’ancienne illustration',async()=>{
    const u=await player('dessinatrice');const c=await char(5);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    await db.query(`insert into public.discoveries (owner_id,character_id) values ($1,$2)`,[u,c]);
    await expectError(rpc(db,u,'submit_card_feedback',['CAM-005','credit','C’est mon dessin',null,' ']),/credit_required/);
    await rpc(db,u,'submit_card_feedback',['CAM-005','credit','C’est mon dessin, lien vers mon compte',null,'Lune Noire']);
    const s=(await rpc<any[]>(db,admin,'admin_submissions',['pending'])).find(x=>x.kind==='credit');
    expect(s).toMatchObject({credit_name:'Lune Noire',art_credit:null});
    await rpc(db,admin,'admin_set_art_credit',[c,null,s.credit_name,'Crédit validé']);
    await rpc(db,admin,'admin_decide_submission',[s.id,true,50,0,'Merci !']);
    await give(u,5);
    expect((await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===5).art_credit).toBe('Lune Noire');
    // Nouvelle illustration officielle : l'ancienne garde son crédit, la nouvelle repart sans.
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART2]);
    const album=(await rpc<any[]>(db,u,'get_album',[edition])).find(a=>a.number===5);
    expect(album.art_credit).toBeNull();
    expect(album.variants[0]).toMatchObject({kind:'legacy',credit:'Lune Noire'});
  });
});

describe('plein cadre',()=>{
  it('accepte le cadrage full art et le rend modifiable sur une version',async()=>{
    const c=await char(6);
    const id=await rpc<string>(db,admin,'admin_add_card_art',[c,PAINT,{layout:'fullart'},'Version pleine','Test']);
    await rpc(db,admin,'admin_set_card_art_meta',[id,{layout:'cover'},'Recadrage']);
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c])).find(a=>a.id===id).art_meta).toMatchObject({layout:'cover'});
    await expectError(rpc(db,admin,'admin_set_card_art_meta',[id,{layout:'geant'},'x']),/invalid_art_meta/);
  });
});

describe('succès sur une version d’illustration et retrait d’une version (23/10)',()=>{
  it('un succès conditionnel peut exiger de posséder une version précise, ou n’importe quelle alternative',async()=>{
    const c=await char(5);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    const paint=await rpc<string>(db,admin,'admin_add_card_art',[c,PAINT,{},'Paint','Dessin maison']);
    const precise=await rpc<string>(db,admin,'admin_save_achievement',[null,'Collectionneur de Paint','Avoir la version Paint.',false,0,0,null,[c],null,null,{[c]:paint}]);
    const any=await rpc<string>(db,admin,'admin_save_achievement',[null,'Amateur d’alternatives','Avoir une version alternative.',false,0,0,null,[c],null,null,{[c]:'alt'}]);
    await expectError(rpc(db,admin,'admin_save_achievement',[null,'Mauvais','x',false,0,0,null,[c],null,null,{[c]:randomUUID()}]),/invalid_art/);
    const listed=(await rpc<any[]>(db,admin,'admin_custom_achievements')).find(a=>a.code===precise);
    expect(listed.characters[0]).toMatchObject({art:paint,art_label:'Paint'});
    const u=await player('amateur_paint');
    const state=async(code:string)=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===code);
    await give(u,5); // version officielle
    expect((await state(precise)).unlocked_at).toBeNull();
    expect((await state(any)).unlocked_at).toBeNull();
    await db.query(`insert into public.inventory_items (owner_id,character_id,finish,art_id) values ($1,$2,'Standard',$3)`,[u,c,paint]);
    expect((await state(precise)).unlocked_at).not.toBeNull();
    expect((await state(any)).unlocked_at).not.toBeNull();
  });
  it('retirer une version partout : plus de tirage, les exemplaires reprennent l’officielle',async()=>{
    const c=await char(6);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART]);
    await db.query(`update public.characters set art_path=$2 where id=$1`,[c,ART2]); // l'ancienne devient « Illustration d'origine »
    const legacy=(await rpc<any[]>(db,admin,'admin_card_arts',[c]))[0];
    const u=await player('garde_origine');
    const item=await give(u,6);
    await db.query(`update public.inventory_items set art_id=$2 where id=$1`,[item,legacy.id]);
    await expectError(rpc(db,u,'admin_retire_card_art',[legacy.id,'Triche']),/forbidden/);
    expect(await rpc<number>(db,admin,'admin_retire_card_art',[legacy.id,'Illustration retirée'])).toBe(1);
    expect((await db.query('select art_id from public.inventory_items where id=$1',[item])).rows[0]).toEqual({art_id:null});
    expect((await rpc<any[]>(db,admin,'admin_card_arts',[c])).find(a=>a.id===legacy.id).active).toBe(false);
  });
});

