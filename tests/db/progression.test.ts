import {describe,it,expect,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createDb,rpc,createUser,seedEdition,expectError,type Db} from './harness';

let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});},30000);

const iso=(d:Date)=>d.toISOString();
async function period(kind:string,at:string){const {rows:[r]}=await db.query<{period_start:Date;period_end:Date}>('select * from private.mission_period($1,$2)',[kind,at]);return [iso(r.period_start),iso(r.period_end)];}
async function player(handle:string,createdAt?:string){const id=await createUser(db,createdAt?{createdAt}:{});await rpc(db,id,'set_handle',[handle]);return id;}
async function discover(user:string,where:string,params:unknown[]=[]){
  await db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters c where c.edition_id=$2 and ${where} on conflict do nothing`,[user,edition,...params]);
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
    expect(list.find(a=>a.code==='set:CAM:rarity:Commun').reward_deniers).toBe(2*3);
    expect(list.find(a=>a.code==='set:CAM:rarity:Mythique')).toMatchObject({reward_deniers:2*200,reward_boosters:1});
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
    expect(secret).toEqual({code:'unique',secret:true,category:'general',label:null,unlocked_at:null});
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

describe('succès conditionnels secrets',()=>{
  it('apparaissent comme « succès secret » jusqu’au déblocage',async()=>{
    const admin=(await db.query<{id:string}>(`select id from public.profiles where role='admin'`)).rows[0].id;
    const {rows:chars}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number in (7,8)`,[edition]);
    const code=await rpc<string>(db,admin,'admin_save_achievement',[null,'Le pacte caché','Avoir réuni les deux frères.',true,100,0,null,chars.map(c=>c.id)]);
    const u=await player('curieux');
    expect((await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code)).toEqual({code,secret:true,category:'custom',label:null,unlocked_at:null});
    await discover(u,`c.number in (7,8)`);
    expect((await rpc<any[]>(db,u,'get_achievements')).find(x=>x.code===code)).toMatchObject({label:'Le pacte caché',description:'Avoir réuni les deux frères.'});
    expect((await rpc(db,u,'get_player_state')).missions_ready).toBeGreaterThanOrEqual(0);
  });
});
