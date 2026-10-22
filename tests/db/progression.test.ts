import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});},30000);

const iso=(d:Date)=>d.toISOString();
async function period(kind:string,at:string){const {rows:[r]}=await db.query<{period_start:Date;period_end:Date}>('select * from private.mission_period($1,$2)',[kind,at]);return [iso(r.period_start),iso(r.period_end)];}
async function player(handle:string,createdAt?:string){const id=await createUser(db,createdAt?{createdAt}:{});await rpc(db,id,'set_handle',[handle]);return id;}
/** Découverte seule : la carte a été vue une fois, sans être possédée. */
async function see(user:string,where:string,params:unknown[]=[]){
  await db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters c where c.edition_id=$2 and ${where} on conflict do nothing`,[user,edition,...params]);
}
/** Découvre et possède un exemplaire, comme après un booster. */
async function discover(user:string,where:string,params:unknown[]=[],finish='Standard'){
  await see(user,where,params);
  await db.query(`insert into public.inventory_items (owner_id,character_id,finish) select $1,id,$${3+params.length} from public.characters c where c.edition_id=$2 and ${where}`,[user,edition,...params,finish]);
}

describe('périodes des missions (Europe/Paris)',()=>{
  it('renouvelle les quotidiennes à 06 h, y compris au passage à l’heure d’hiver',async()=>{
    expect(await period('daily','2026-10-25 05:59+01')).toEqual(['2026-10-24T04:00:00.000Z','2026-10-25T05:00:00.000Z']);
    expect(await period('daily','2026-10-25 06:00+01')).toEqual(['2026-10-25T05:00:00.000Z','2026-10-26T05:00:00.000Z']);
  });
  it('renouvelle les hebdomadaires le lundi à 06 h',async()=>{
    expect(await period('weekly','2026-10-21 12:00+02')).toEqual(['2026-10-19T04:00:00.000Z','2026-10-26T05:00:00.000Z']);
    expect(await period('weekly','2026-10-26 05:00+01')).toEqual(['2026-10-19T04:00:00.000Z','2026-10-26T05:00:00.000Z']);
  });
});

describe('missions',()=>{
  it('donne 3 missions par période, jamais impossibles',async()=>{
    const u=await player('novice');
    const m=await rpc(db,u,'get_missions');
    expect(m.daily).toHaveLength(3);expect(m.weekly).toHaveLength(3);
    const codes=(await db.query<{template_code:string}>('select template_code from public.mission_assignments where owner_id=$1',[u])).rows.map(r=>r.template_code);
    const {rows}=await db.query<{code:string}>(`select code from public.mission_templates where requires is not null`);
    expect(codes.filter(c=>rows.some(r=>r.code===c))).toEqual([]); // compte neuf sans amis : rien d'impossible
    expect((await rpc(db,u,'get_missions')).daily.map((x:any)=>x.assignment_id)).toEqual(m.daily.map((x:any)=>x.assignment_id));
  });
  it('réclame une récompense une seule fois, après réalisation',async()=>{
    await db.query(`update public.mission_templates set active = code in ('d_open_1','d_discover_1','d_rare_1','d_recycle_3') or kind='weekly'`);
    const u=await player('ouvreur');
    const m=await rpc(db,u,'get_missions');
    const open=m.daily.find((x:any)=>x.label==='Ouvrir 1 booster')??m.daily[0];
    await expectError(rpc(db,u,'claim_mission',[open.assignment_id]),/mission_incomplete/);
    await db.query('update public.booster_balances set free_count=1 where owner_id=$1',[u]);
    await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const after=(await rpc(db,u,'get_missions')).daily;
    const done=after.filter((x:any)=>x.progress>=x.target);
    expect(done.length).toBeGreaterThan(0);
    const r=await rpc(db,u,'claim_mission',[done[0].assignment_id]);
    expect(r.reward).toBe(done[0].reward);
    await expectError(rpc(db,u,'claim_mission',[done[0].assignment_id]),/already_claimed/);
  });
  it('autorise un seul remplacement gratuit par jour',async()=>{
    const u=await player('difficile');
    const m=await rpc(db,u,'get_missions');
    const replaced=await rpc(db,u,'replace_mission',[m.daily[0].assignment_id]);
    expect(replaced.daily).toHaveLength(3);
    expect(replaced.daily.map((x:any)=>x.assignment_id)).not.toContain(m.daily[0].assignment_id);
    expect(replaced.replacement_available).toBe(false);
    await expectError(rpc(db,u,'replace_mission',[replaced.daily[0].assignment_id]),/replacement_used/);
  });
});

describe('succès',()=>{
  it('génère les succès de l’édition : par rareté, par clan et complet',async()=>{
    const u=await player('collection');
    const list=await rpc<any[]>(db,u,'get_achievements');
    const sets=list.filter(a=>a.category==='collection'&&a.edition_prefix==='CAM');
    expect(sets.filter(a=>a.code.includes(':rarity:'))).toHaveLength(7);
    expect(sets.find(a=>a.code==='set:CAM:all')).toMatchObject({label:'Maître de Édition CAM',target:14,progress:0});
  });
  it('proportionne les récompenses de collection à la taille du groupe',async()=>{
    const u=await player('comptable');
    const list=await rpc<any[]>(db,u,'get_achievements');
    expect(list.find(a=>a.code==='set:CAM:rarity:Commun').reward_deniers).toBe(2*8);
    expect(list.find(a=>a.code==='set:CAM:rarity:Mythique')).toMatchObject({reward_deniers:2*500,reward_boosters:4});
    expect(list.find(a=>a.code==='set:CAM:all')).toMatchObject({reward_deniers:8000,reward_boosters:12});
  });
  it('débloque « toutes les Communes » une seule fois avec sa récompense',async()=>{
    const u=await player('communard');
    await discover(u,`c.rarity='Commun'`);
    const list=await rpc<any[]>(db,u,'get_achievements');
    expect(list.find(a=>a.code==='set:CAM:rarity:Commun')).toMatchObject({label:'Toutes les Communes',progress:2,target:2});
    expect(list.find(a=>a.code==='set:CAM:rarity:Commun').unlocked_at).not.toBeNull();
    await rpc(db,u,'get_achievements');
    const {rows}=await db.query<{n:number;s:number}>(`select count(*)::int n, sum(delta)::int s from public.wallet_ledger where owner_id=$1 and kind='achievement_reward'`,[u]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await db.query(`select count(*)::int n from public.wallet_ledger where owner_id=$1 and idempotency_key='achievement:set:CAM:rarity:Commun'`,[u])).rows[0]).toEqual({n:1});
  });
  it('masque les succès secrets non débloqués et permet de porter un titre',async()=>{
    const u=await player('discret');
    const list=await rpc<any[]>(db,u,'get_achievements');
    const secret=list.find(a=>a.code==='unique');
    expect(secret).toEqual({code:'unique',secret:true,category:'general',label:null,unlocked_at:null,edition:null,edition_prefix:null});
    await expectError(rpc(db,u,'set_title',['faces_50']),/title_locked/);
    await discover(u,`true`);
    await rpc(db,u,'get_achievements');
    expect(await rpc(db,u,'set_title',['set:CAM:all'])).toBe('Maître de Édition CAM');
  });
  it('décerne un succès personnalisé, une seule fois, avec motif',async()=>{
    const admin=await player('maitre_jeu');
    await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
    const u=await player('heros_gn');
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'Héros de la Nuit Rouge','Présent lors de la séance du 31 octobre.',false,100,1,'Héros de la Nuit Rouge']);
    expect((await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===code)).toBeUndefined();
    await expectError(rpc(db,admin,'admin_grant_achievement',[code,'heros_gn','']),/reason_required/);
    await rpc(db,admin,'admin_grant_achievement',[code,'heros_gn','Séance du 31 octobre']);
    const mine=(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===code);
    expect(mine).toMatchObject({category:'custom',label:'Héros de la Nuit Rouge',reason:'Séance du 31 octobre'});
    await expectError(rpc(db,admin,'admin_grant_achievement',[code,'heros_gn','encore']),/already_granted/);
    await expectError(rpc(db,u,'admin_grant_achievement',[code,'heros_gn','triche']),/forbidden/);
  });
  it('range un succès personnalisé dans un set ou dans les succès généraux',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id; // un seul admin
    const {rows:[ch]}=await db.query<{id:string}>('select id from public.characters where edition_id=$1 limit 1',[edition]);
    const args=(code:string|null,ed:string|null)=>[code,'Gardien du set','Visible dans le set.',false,0,0,null,[ch.id],ed];
    const code=await rpc<string>(db,admin,'admin_save_achievement',args(null,edition));
    const find=async()=>(await rpc<any[]>(db,admin,'admin_custom_achievements')).find(a=>a.code===code);
    expect(await find()).toMatchObject({edition_id:edition,edition:expect.any(String)});
    expect((await rpc<any[]>(db,admin,'get_achievements')).find(a=>a.code===code)).toMatchObject({edition_prefix:'CAM'});
    await rpc(db,admin,'admin_save_achievement',args(code,null));
    expect(await find()).toMatchObject({edition_id:null,edition:null});
    await expectError(rpc(db,admin,'admin_save_achievement',args(code,randomUUID())),/not_found/);
  });
});

describe('classement',()=>{
  it('classe par succès, puis par personnages découverts (finitions ignorées)',async()=>{
    const a=await player('premier');const b=await player('second');const c=await player('troisieme');
    await discover(a,`c.number<=10`);await discover(b,`c.number<=3`);await discover(c,`c.number<=12`);
    await db.query(`insert into public.finish_discoveries (owner_id,character_id,finish) select $1,id,'Dorée' from public.characters where edition_id=$2 and number<=3`,[b,edition]);
    await rpc(db,a,'get_achievements'); // débloque « Premiers visages » (10 découvertes)
    const board=await rpc(db,b,'get_leaderboard',[50]);
    const row=(h:string)=>board.top.find((x:any)=>x.handle===h);
    expect(row('premier')).toMatchObject({faces:10});expect(row('premier').achievements).toBeGreaterThan(0);
    expect(row('troisieme')).toMatchObject({faces:12,achievements:0});
    expect(row('second')).toMatchObject({faces:3,achievements:0});
    expect(row('premier').position).toBeLessThan(row('troisieme').position); // les succès priment
    expect(row('troisieme').position).toBeLessThan(row('second').position);  // puis les découvertes
    expect(board.me).toMatchObject({faces:3});
  });
});

describe('succès conditionnels personnalisés',()=>{
  it('se débloque en découvrant le groupe choisi, explication révélée seulement après',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const {rows:chars}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number in (5,6) order by number`,[edition]);
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'LES BRATS!!','Avoir collectionné Sirius et Wezen.',false,200,0,null,chars.map(c=>c.id)]);
    await expectError(rpc(db,admin,'admin_grant_achievement',[code,'maitre_jeu','x']),/conditional_achievement/);
    const u=await player('brat');
    let a=(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code);
    expect(a).toMatchObject({label:'LES BRATS!!',conditional:true,description:null,progress:0,target:2,unlocked_at:null});
    await discover(u,`c.number=5`);
    a=(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code);
    expect(a).toMatchObject({progress:1,unlocked_at:null});
    await discover(u,`c.number=6`);
    a=(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code);
    expect(a).toMatchObject({progress:2,description:'Avoir collectionné Sirius et Wezen.'});
    expect(a.unlocked_at).not.toBeNull();
  });
});

describe('succès de cartes : posséder au moment du déblocage (décision du 22/10)',()=>{
  const ach=async(u:string,code:string)=>(await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code===code);
  it('une carte vue une fois ne compte plus : il faut l’avoir, et le succès reste acquis ensuite',async()=>{
    const u=await player('possedant');
    await see(u,`c.rarity='Peu commun'`); // les deux Peu communes vues, aucune possédée
    expect(await ach(u,'set:CAM:rarity:Peu commun')).toMatchObject({progress:0,target:2,owned_rule:true,unlocked_at:null});
    // Il manque les deux : leurs noms sont connus puisqu'elles ont été découvertes.
    expect((await ach(u,'set:CAM:rarity:Peu commun')).missing.map((m:any)=>m.name).sort()).toEqual(['Perso CAM 3','Perso CAM 4']);
    await discover(u,`c.number=3`);
    // Un exemplaire en vente compte toujours : il est encore au joueur.
    await db.query(`update public.inventory_items set reserved_kind='listing',reserved_ref=gen_random_uuid() where owner_id=$1`,[u]);
    expect(await ach(u,'set:CAM:rarity:Peu commun')).toMatchObject({progress:1,missing:[{name:'Perso CAM 4',code:'CAM-004'}]});
    // Un exemplaire recyclé ou retiré ne compte pas.
    await discover(u,`c.number=4`);
    await db.query(`update public.inventory_items set recycled_at=now() where owner_id=$1 and character_id=(select id from public.characters where edition_id=$2 and number=4)`,[u,edition]);
    expect(await ach(u,'set:CAM:rarity:Peu commun')).toMatchObject({progress:1,unlocked_at:null});
    await discover(u,`c.number=4`);
    expect((await ach(u,'set:CAM:rarity:Peu commun')).unlocked_at).not.toBeNull();
    // Débloqué : revendre ou recycler ensuite ne le retire pas.
    await db.query(`update public.inventory_items set reserved_kind=null,reserved_ref=null,recycled_at=now() where owner_id=$1 and recycled_at is null`,[u]);
    expect((await ach(u,'set:CAM:rarity:Peu commun')).unlocked_at).not.toBeNull();
  });
  it('ne nomme pas une carte manquante jamais découverte, ni au-delà de 5 manquantes',async()=>{
    const u=await player('explorateur');
    await discover(u,`c.rarity='Rare' and c.number=5`);
    expect((await ach(u,'set:CAM:rarity:Rare')).missing).toEqual([{name:null,code:'CAM-006'}]);
    expect((await ach(u,'set:CAM:all')).missing).toBeUndefined(); // 13 manquantes : pas de liste
  });
  it('les groupes de personnages exigent aussi de posséder les cartes',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const {rows:chars}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number in (9,10)`,[edition]);
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'Les jumeaux','Réunir les jumeaux.',false,0,0,null,chars.map(c=>c.id)]);
    const u=await player('jumeaux');
    await see(u,`c.number in (9,10)`);
    expect(await ach(u,code)).toMatchObject({progress:0,unlocked_at:null,owned_rule:true});
    await discover(u,`c.number in (9,10)`);
    expect((await ach(u,code)).unlocked_at).not.toBeNull();
  });
});

describe('succès conditionnels avec finition',()=>{
  it('exige la finition choisie pour certains personnages, la simple découverte pour les autres',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const {rows:[a,b]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number in (7,8) order by number`,[edition]);
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'Duo doré','Varco et Joséphine en Dorée.',false,0,0,null,[a.id,b.id],null,{[a.id]:'Dorée'}]);
    expect((await rpc<any[]>(db,admin,'admin_custom_achievements')).find(x=>x.code===code).characters.map((c:any)=>c.finish)).toEqual(['Dorée',null]);
    const u=await player('dore_duo');
    const state=async()=>(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code);
    await discover(u,`c.number in (7,8)`);
    expect(await state()).toMatchObject({progress:1,target:2,unlocked_at:null}); // possédé, mais pas en Dorée
    await db.query(`insert into public.finish_discoveries (owner_id,character_id,finish) values ($1,$2,'Dorée')`,[u,a.id]);
    expect(await state()).toMatchObject({progress:1,unlocked_at:null}); // une Dorée vue une fois ne suffit plus
    await discover(u,`c.number=7`,[],'Dorée');
    expect((await state()).unlocked_at).not.toBeNull();
    await expectError(rpc(db,admin,'admin_save_achievement',[code,'Duo doré','',false,0,0,null,[a.id,b.id],null,{[a.id]:'Argentée'}]),/invalid_finish/);
  });
});

describe('succès conditionnels secrets',()=>{
  it('apparaissent comme « succès secret » jusqu’au déblocage',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const {rows:chars}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number in (7,8)`,[edition]);
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'Le pacte caché','Avoir réuni les deux frères.',true,100,0,null,chars.map(c=>c.id)]);
    const u=await player('curieux');
    expect((await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code)).toEqual({code,secret:true,category:'custom',label:null,unlocked_at:null,edition:null,edition_prefix:null});
    await discover(u,`c.number in (7,8)`);
    expect((await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code)).toMatchObject({label:'Le pacte caché',description:'Avoir réuni les deux frères.'});
    expect((await rpc(db,u,'get_player_state')).missions_ready).toBeGreaterThanOrEqual(0);
  });
});

describe('séries de succès à paliers',()=>{
  it('regroupe les paliers d’une même famille, chacun restant un succès distinct',async()=>{
    const u=await player('palier');
    await discover(u,`c.number<=10`);
    const list=await rpc<any[]>(db,u,'get_achievements');
    const faces=list.filter(a=>a.series==='faces').sort((a,b)=>a.tier-b.tier);
    expect(faces.map(a=>[a.code,a.tier])).toEqual([['faces_10',1],['faces_50',2],['faces_100',3],['faces_200',4]]);
    expect(faces[0].unlocked_at).not.toBeNull();expect(faces[1].unlocked_at).toBeNull();
    expect(list.find(a=>a.code==='gold_10')).toMatchObject({secret:false,series:'gold',tier:3});
    expect(list.filter(a=>a.series==='packs')).toHaveLength(4);
  });
});

describe('missions longues et bonus',()=>{
  it('garde « Venir 5 jours » dans les hebdomadaires, sans remplacement possible',async()=>{
    await db.query(`update public.mission_templates set active = fixed or code like 'w\_%days%' or code in ('w_open_25','w_rare_15') or kind='daily'`);
    const u=await player('assidu');
    const m=await rpc(db,u,'get_missions');
    const login=m.weekly.find((x:any)=>x.label==='Venir 5 jours dans la semaine');
    expect(login).toMatchObject({replaceable:false});
    expect(m.weekly).toHaveLength(3);
    await expectError(rpc(db,u,'replace_mission',[login.assignment_id]),/not_replaceable/);
  });
  it('découpe les journées de jeu de 06 h à 06 h (heure de Paris)',async()=>{
    const {rows}=await db.query<{d:string}>(`select private.game_day(t)::text d from unnest(array['2026-10-19 07:00+02','2026-10-19 23:00+02','2026-10-20 05:59+02','2026-10-20 06:00+02']::timestamptz[]) t`);
    expect(rows.map(r=>r.d)).toEqual(['2026-10-19','2026-10-19','2026-10-19','2026-10-20']);
  });
  it('offre 1 booster quand toutes les missions du jour sont réclamées, une seule fois',async()=>{
    await db.query(`update public.mission_templates set active = code in ('d_open_1','d_open_2','d_open_3') or kind='weekly'`);
    const u=await player('bonus');
    const m=await rpc(db,u,'get_missions');
    expect(m.daily_bonus).toEqual({boosters:1,claimed:false});
    expect(m.weekly_bonus).toEqual({boosters:4,claimed:false});
    await db.query('update public.booster_balances set free_count=3, purchased_count=0 where owner_id=$1',[u]);
    for(let i=0;i<3;i++)await rpc(db,u,'open_booster',[edition,randomUUID()]);
    const results=[];
    for(const x of m.daily)results.push(await rpc(db,u,'claim_mission',[x.assignment_id]));
    expect(results.map(r=>r.bonus_boosters)).toEqual([0,0,1]);
    const {rows:[b]}=await db.query<{purchased_count:number}>('select purchased_count from public.booster_balances where owner_id=$1',[u]);
    expect(b.purchased_count).toBe(1);
    expect((await rpc(db,u,'get_missions')).daily_bonus).toEqual({boosters:1,claimed:true});
  });
});

describe('succès secrets de la chronique',()=>{
  it('récompense les comptes du premier mois seulement',async()=>{
    const early=await player('pionnier');
    const late=await player('retardataire','2026-12-01 12:00+01');
    const mine=(await rpc<any[]>(db,early,'get_achievements')).find(a=>a.code==='chronicle:early');
    expect(mine).toMatchObject({label:'Soutien de la première heure',description:'Avoir rejoint Cartema durant son premier mois.'});
    expect(mine.unlocked_at).not.toBeNull();
    expect((await rpc<any[]>(db,late,'get_achievements')).find(a=>a.code==='chronicle:early')).toEqual({code:'chronicle:early',secret:true,category:'custom',label:null,unlocked_at:null,edition:null,edition_prefix:null});
  });
  it('se débloque en recyclant une fois chaque carte du jeu',async()=>{
    const u=await player('broyeur_total');
    const {rows:chars}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and status='published' and not is_unique`,[edition]);
    const ids:string[]=[];
    for(const c of chars)ids.push((await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[u,c.id])).rows[0].id);
    await rpc(db,u,'recycle_cards',[ids.slice(1),randomUUID(),true]);
    expect((await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code==='chronicle:recycle-all').label).toBeNull();
    await rpc(db,u,'recycle_cards',[ids.slice(0,1),randomUUID(),true]);
    const a=(await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code==='chronicle:recycle-all');
    expect(a).toMatchObject({label:'Le gars a pas compris le principe du jeu',progress:chars.length,target:chars.length});
  });
  it('montre « Actually » comme secret et le décerne à la main',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const u=await player('pinailleur');
    expect((await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code==='chronicle:actually')).toMatchObject({secret:true,label:null});
    await rpc(db,admin,'admin_grant_achievement',['chronicle:actually','pinailleur','Erreur de clan sur une carte']);
    expect((await rpc<any[]>(db,u,'get_achievements')).find(a=>a.code==='chronicle:actually')).toMatchObject({label:'Actually 🤓',title:'Actually 🤓'});
    await expectError(rpc(db,admin,'admin_grant_achievement',['chronicle:early','pinailleur','x']),/conditional_achievement/);
  });
});
