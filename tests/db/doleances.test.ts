import {describe,it,expect,beforeAll} from 'vitest';
import {createDb,rpc,createUser,seedEdition,type Db} from './harness';

// Doléances traitées pour la mise à jour d'hiver (10/11).
let db:Db;let edition:string;
beforeAll(async()=>{db=await createDb();edition=await seedEdition(db,{prefix:'CAM',perRarity:2});},30000);
const player=()=>createUser(db,{createdAt:'2026-01-01T00:00:00Z',handle:true});

describe('missions de visages',()=>{
  it('ne demandent jamais plus de visages qu’il n’en reste à découvrir',async()=>{
    const u=await player();
    // 13 cartes découvertes sur 14 : il n'en reste qu'une.
    await db.query(`insert into public.discoveries (owner_id,character_id) select $1,id from public.characters where edition_id=$2 order by number limit 13`,[u,edition]);
    // Rendre toutes les missions de visages tirables : seules les autres sont mises de côté.
    await db.query(`update public.mission_templates set active = (metric in ('discover','discover_days'))`);
    try{
      const m=await rpc(db,u,'get_missions');
      const all=[...m.daily,...m.weekly];
      const {rows}=await db.query<{label:string;target:number}>(`select label,target from public.mission_templates where metric in ('discover','discover_days')`);
      const big=new Set(rows.filter(r=>r.target>1).map(r=>r.label));
      expect(all.filter((x:any)=>big.has(x.label))).toEqual([]);
      expect(all.every((x:any)=>x.target<=1)).toBe(true);
    }finally{await db.query(`update public.mission_templates set active = true`);}
  });
});

describe('succès de collection',()=>{
  it('disent « Posséder », comme leur règle',async()=>{
    const u=await player();
    await rpc(db,u,'get_achievements');
    const {rows}=await db.query<{description:string}>(`select description from public.achievements where category='collection' and metric in ('set_clan','set_rarity','set_all')`);
    expect(rows.length).toBeGreaterThan(0);
    for(const r of rows)expect(r.description).toMatch(/^Posséder /);
  });
});

describe('recherche du marché',()=>{
  it('compare les noms sans accents',async()=>{
    const {rows:[r]}=await db.query<{a:string;b:boolean}>(`select private.fold('Lucié Œdipe d’Arc') a, private.fold('Lucien') like '%'||private.fold('LUCIE')||'%' b`);
    expect(r).toEqual({a:"lucie oedipe d'arc",b:true});
    // Le marché passe bien par la fonction repliée.
    const u=await player();
    await db.query(`update public.characters set name='Lucié' where edition_id=$1 and number=1`,[edition]);
    const {rows:[c]}=await db.query<{id:string}>(`select id from public.characters where edition_id=$1 and number=1`,[edition]);
    const {rows:[i]}=await db.query<{id:string}>(`insert into public.inventory_items (owner_id,character_id,finish) values ($1,$2,'Standard') returning id`,[u,c.id]);
    await db.query(`insert into public.listings (seller_id,instance_id,character_id,finish,kind,price,status,request_id) values ($1,$2,$3,'Standard','fixed',100,'active',gen_random_uuid())`,[u,i.id,c.id]);
    const {rows}=await db.query(`select * from private.market_rows($1,'fixed',null,null,null,'lucie',false)`,[u]);
    expect(rows.length).toBe(1);
  });
});
