import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,expectError,type Db} from './harness';

let db:Db;let admin:string;
beforeAll(async()=>{
  db=await createDb();
  admin=await createUser(db);await rpc(db,admin,'set_handle',['gardien']);
  await db.query(`update public.profiles set role='admin' where id=$1`,[admin]);
},30000);
async function player(h:string){const id=await createUser(db,{createdAt:'2026-01-01T00:00:00Z'});await rpc(db,id,'set_handle',[h]);return id;}
const send=(u:string,title='Un mode tournoi',category='feature')=>rpc<string>(db,u,'submit_suggestion',[category,title,'Des tournois du samedi soir.']);

describe('doléances',()=>{
  it('l’admin peut masquer une doléance pour lui seul, sans prévenir l’auteur ni changer son statut (23/10)',async()=>{
    const a=await player('idee_masquee');
    const id=await send(a,'Une idée en double');
    const notifs=async()=>(await rpc(db,a,'get_notifications')).items.length;
    const before=await notifs();
    await rpc(db,admin,'admin_hide_suggestion',[id,true]);
    expect((await rpc<any[]>(db,admin,'admin_suggestions',['new'])).some(s=>s.id===id)).toBe(false);
    expect((await rpc<any[]>(db,admin,'admin_suggestions',[null])).some(s=>s.id===id)).toBe(false);
    expect((await rpc<any[]>(db,admin,'admin_suggestions',['hidden'])).find(s=>s.id===id)).toMatchObject({status:'new'});
    // Pour l'auteur, rien ne change.
    const mine=(await rpc(db,a,'get_suggestions')).mine.find((s:any)=>s.id===id);
    expect(mine).toMatchObject({status:'new'});
    expect(JSON.stringify(mine)).not.toMatch(/hidden/);
    expect(await notifs()).toBe(before);
    await expectError(rpc(db,a,'admin_hide_suggestion',[id,true]),/forbidden|admin/);
    await rpc(db,admin,'admin_hide_suggestion',[id,false]);
    expect((await rpc<any[]>(db,admin,'admin_suggestions',['new'])).some(s=>s.id===id)).toBe(true);
  });
  it('privées par défaut : seul l’auteur et l’admin les voient, l’admin est prévenu',async()=>{
    const a=await player('idee_a');const b=await player('idee_b');
    const id=await send(a);
    const mine=await rpc(db,a,'get_suggestions');
    expect(mine.mine).toHaveLength(1);
    expect(mine.mine[0]).toMatchObject({id,status:'new',public:false,category:'feature',title:'Un mode tournoi'});
    expect((await rpc(db,b,'get_suggestions')).public.some((s:any)=>s.id===id)).toBe(false);
    expect((await rpc(db,admin,'get_notifications')).items.some((n:any)=>n.kind==='suggestion_received')).toBe(true);
    await expectError(rpc(db,b,'admin_suggestions',[null]),/forbidden/);
  });
  it('l’admin répond, rend publique ; les joueurs votent une fois, jamais pour la leur',async()=>{
    const a=await player('idee_c');const b=await player('idee_d');const c=await player('idee_e');
    const id=await send(a,'Une vitrine animée');
    await expectError(rpc(db,b,'vote_suggestion',[id,true]),/not_found/); // encore privée
    await rpc(db,admin,'admin_answer_suggestion',[id,'planned',true,'Bonne idée, prévue pour le set 2.','Tri']);
    expect((await rpc(db,a,'get_notifications')).items[0]).toMatchObject({kind:'suggestion_answered',payload:{title:'Une vitrine animée',status:'planned'}});
    await rpc(db,b,'vote_suggestion',[id,true]);await rpc(db,c,'vote_suggestion',[id,true]);
    await rpc(db,b,'vote_suggestion',[id,true]); // idempotent
    await expectError(rpc(db,a,'vote_suggestion',[id,true]),/own_suggestion/);
    const pub=(await rpc(db,b,'get_suggestions')).public.find((s:any)=>s.id===id);
    expect(pub).toMatchObject({votes:2,my_vote:true,status:'planned',reply:'Bonne idée, prévue pour le set 2.',author:'idee_c'});
    await rpc(db,c,'vote_suggestion',[id,false]);
    expect((await rpc(db,c,'get_suggestions')).public.find((s:any)=>s.id===id)).toMatchObject({votes:1,my_vote:false});
    expect((await rpc<any[]>(db,admin,'admin_suggestions',[null])).find(s=>s.id===id)).toMatchObject({votes:1,author:'idee_c',public:true});
  });
  it('votes négatifs : refusés sauf si l’admin les autorise, un seul vote par joueur, modifiable (26/10)',async()=>{
    const a=await player('idee_neg_a');const b=await player('idee_neg_b');const c=await player('idee_neg_c');const d=await player('idee_neg_d');
    const id=await send(a,'Une idée qui divise');
    await rpc(db,admin,'admin_answer_suggestion',[id,'new',true,null,'Tri']);
    const view=async(u:string)=>(await rpc(db,u,'get_suggestions')).public.find((s:any)=>s.id===id);
    // Option coupée par défaut : seul le vote pour existe.
    expect(await view(b)).toMatchObject({allow_downvotes:false,votes:0,downvotes:0,my_vote:false,my_downvote:false});
    await expectError(rpc(db,b,'vote_suggestion',[id,true,-1]),/downvotes_disabled/);
    await expectError(rpc(db,b,'vote_suggestion',[id,true,0]),/invalid_vote/);
    await rpc(db,b,'vote_suggestion',[id,true]); // ancien appel à 2 paramètres
    expect(await view(b)).toMatchObject({votes:1,downvotes:0,my_vote:true,my_downvote:false});
    // L'admin autorise les votes négatifs (nouveau paramètre, en dernier).
    await rpc(db,admin,'admin_answer_suggestion',[id,'new',true,null,'Tri',true]);
    await rpc(db,c,'vote_suggestion',[id,true,-1]);await rpc(db,d,'vote_suggestion',[id,true,-1]);
    await rpc(db,d,'vote_suggestion',[id,true,-1]); // idempotent
    expect(await view(c)).toMatchObject({allow_downvotes:true,votes:1,downvotes:2,my_vote:false,my_downvote:true});
    await expectError(rpc(db,a,'vote_suggestion',[id,true,-1]),/own_suggestion/);
    // Un seul vote par joueur : passer de pour à contre, puis le retirer.
    await rpc(db,b,'vote_suggestion',[id,true,-1]);
    expect(await view(b)).toMatchObject({votes:0,downvotes:3,my_vote:false,my_downvote:true});
    await rpc(db,c,'vote_suggestion',[id,true,1]);
    expect(await view(c)).toMatchObject({votes:1,downvotes:2,my_vote:true,my_downvote:false});
    await rpc(db,d,'vote_suggestion',[id,false]);
    expect(await view(d)).toMatchObject({votes:1,downvotes:1,my_vote:false,my_downvote:false});
    expect((await db.query(`select count(*)::int n from public.suggestion_votes where suggestion_id=$1`,[id])).rows[0]).toEqual({n:2});
    expect((await rpc<any[]>(db,admin,'admin_suggestions',[null])).find(s=>s.id===id)).toMatchObject({allow_downvotes:true,votes:1,downvotes:1});
    // Enregistrer sans le nouveau paramètre ne change pas l'option.
    await rpc(db,admin,'admin_answer_suggestion',[id,'planned',true,null,'Tri']);
    expect(await view(b)).toMatchObject({allow_downvotes:true,downvotes:1});
    // Option recoupée : les votes contre ne comptent plus et ne s'acceptent plus.
    await rpc(db,admin,'admin_answer_suggestion',[id,'planned',true,null,'Tri',false]);
    expect(await view(b)).toMatchObject({allow_downvotes:false,votes:1,downvotes:0,my_downvote:false});
    await expectError(rpc(db,d,'vote_suggestion',[id,true,-1]),/downvotes_disabled/);
  });
  it('idées publiques classées par solde (pour moins contre) quand les votes négatifs sont autorisés',async()=>{
    const a=await player('idee_solde_a');const v=[await player('idee_solde_b'),await player('idee_solde_c'),await player('idee_solde_d')];
    const x=await send(a,'Idée contestée');const y=await send(a,'Idée tiède');
    await rpc(db,admin,'admin_answer_suggestion',[x,'new',true,null,'Tri',true]);
    await rpc(db,admin,'admin_answer_suggestion',[y,'new',true,null,'Tri']);
    await rpc(db,v[0],'vote_suggestion',[x,true,1]);await rpc(db,v[1],'vote_suggestion',[x,true,-1]);await rpc(db,v[2],'vote_suggestion',[x,true,-1]);
    await rpc(db,v[0],'vote_suggestion',[y,true]);
    const ids=(await rpc(db,v[0],'get_suggestions')).public.map((s:any)=>s.id);
    expect(ids.indexOf(y)).toBeLessThan(ids.indexOf(x));
  });
  it('une demande de personnage peut joindre une illustration, visible seulement par l’auteur et l’admin',async()=>{
    const a=await player('idee_art');const b=await player('idee_voisin');
    const path=`${a}/perso.webp`;
    const id=await rpc<string>(db,a,'submit_suggestion',['card','Une carte pour Malyen jeune','Voici mon dessin.',path]);
    expect((await rpc(db,a,'get_suggestions')).mine[0]).toMatchObject({id,image_path:path});
    await expectError(rpc(db,a,'submit_suggestion',['card','Image d’un autre','',`${b}/vol.webp`]),/invalid_suggestion/);
    await expectError(rpc(db,a,'submit_suggestion',['card','Chemin piégé','',`${a}/../x.webp`]),/invalid_suggestion/);
    await rpc(db,admin,'admin_answer_suggestion',[id,'planned',true,'Superbe !','Tri']);
    expect((await rpc<any[]>(db,admin,'admin_suggestions',[null])).find(s=>s.id===id).image_path).toBe(path);
    expect((await rpc(db,b,'get_suggestions')).public.find((s:any)=>s.id===id).image_path).toBeNull(); // publique, mais l'image reste privée
    // Sans image : l'ancien appel à 3 paramètres marche toujours (site déjà en ligne).
    expect(await rpc<string>(db,a,'submit_suggestion',['feature','Sans image','Rien à joindre.'])).toBeTruthy();
  });
  it('contrôle le contenu et limite à 5 doléances par jour',async()=>{
    const u=await player('idee_f');
    await expectError(send(u,'ab'),/invalid_suggestion/);
    await expectError(send(u,'Titre correct','farce'),/invalid_suggestion/);
    for(let i=0;i<5;i++)await send(u,`Idée numéro ${i}`,'card');
    await expectError(send(u,'Une de trop'),/suggestion_limit/);
  });
});
