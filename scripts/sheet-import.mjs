// Import initial du catalogue depuis l'export CSV du Google Sheets (CDC §3 : une seule fois).
// Usage : node scripts/sheet-import.mjs <fichier.csv> <sortie.sql> [Nom d'édition] [PRÉFIXE]
// Produit un rapport d'aperçu (stdout) et un SQL idempotent qui crée les personnages EN BROUILLON.
// La publication reste manuelle (back-office).
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const RARITIES={commun:'Commun','peu commun':'Peu commun',rare:'Rare','tres rare':'Très rare',epique:'Épique',legendaire:'Légendaire',mythique:'Mythique'};
// Orthographe française des clans dont le moteur possède le symbole gravé.
const CLAN_ALIASES={malkavian:'Malkavien'};
const NO_VALUE=new Set(['','*','inconnu']);

export const fold=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const clean=s=>(s??'').replace(/\s+/g,' ').trim();

/** Analyse CSV minimale conforme RFC 4180 (guillemets, virgules et retours à la ligne échappés). */
export function parseCsv(text){
 const rows=[];let row=[];let field='';let quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(field||row.length){row.push(field);rows.push(row);}
 return rows;
}

const COLUMNS={prenom:'prenom',nom:'nom',clan:'clan',statut:'statut/secte',rarete:'rarete',etat:'mort/vivant/disparu',praxis:'praxis (set)',poste:'poste & annee'};

/** Applique le mapping validé : nom = Prénom + Nom, fonction = Poste sinon Statut, numéro = ligne − 1. */
export function mapRows(rows){
 const header=rows[0].map(fold);
 const idx=Object.fromEntries(Object.entries(COLUMNS).map(([k,label])=>{
  const i=header.indexOf(label);
  if(i<0)throw new Error(`Colonne introuvable : ${label}`);
  return [k,i];
 }));
 const characters=[];const skipped=[];const warnings=[];
 rows.slice(1).forEach((r,k)=>{
  const line=k+2;
  const get=key=>clean(r[idx[key]]);
  if(!r.some(c=>clean(c)))return;
  const name=clean(`${get('prenom')} ${get('nom')}`);
  const rawRarity=get('rarete');
  const rarity=RARITIES[fold(rawRarity)];
  if(!rarity){skipped.push({line,name,reason:rawRarity?`rareté « ${rawRarity} » hors des 7`:'rareté manquante'});return;}
  const rawClan=get('clan');
  const clan=NO_VALUE.has(fold(rawClan))?null:(CLAN_ALIASES[fold(rawClan)]??rawClan);
  const statut=get('statut');const poste=get('poste');
  const role=poste||(NO_VALUE.has(fold(statut))?'':statut);
  if(name.length>24)warnings.push({line,name,reason:`nom long (${name.length} caractères) : vérifier l’affichage de la carte`});
  if(/\*/.test(name))warnings.push({line,name,reason:'nom contenant « * »'});
  characters.push({line,number:line-1,name,role_title:role,clan,rarity,
   lore:{prenom:get('prenom'),nom:get('nom'),clan_source:rawClan,statut,etat:get('etat'),praxis:get('praxis'),poste}});
 });
 return {characters,skipped,warnings};
}

const q=s=>s===null||s===undefined?'null':`'${String(s).replace(/'/g,"''")}'`;

export function toSql({characters},{editionName,prefix,sheetId}){
 const clans=[...new Set(characters.map(c=>c.clan).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
 const values=characters.map(c=>`(${c.number},${q(c.name)},${q(c.role_title)},${q(c.clan)},${q(c.rarity)},${q(`sheet:${sheetId}:L${c.line}`)},${q(JSON.stringify(c.lore))}::jsonb)`).join(',\n  ');
 return `-- Import initial généré par scripts/sheet-import.mjs : ${characters.length} personnages en brouillon.
begin;
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin');
  v_edition uuid;
  v_inserted integer;
begin
  if v_admin is null then raise exception 'admin_missing'; end if;
  insert into public.editions (name, prefix, album_published) values (${q(editionName)}, ${q(prefix)}, false)
    on conflict (prefix) do nothing;
  select id into v_edition from public.editions where prefix = ${q(prefix)};
  insert into public.clans (name) select unnest(array[${clans.map(q).join(',')}]::text[]) on conflict (name) do nothing;
  with src(number, name, role_title, clan, rarity, source_ref, lore) as (values
  ${values}
  ), ins as (
    insert into public.characters (edition_id, number, name, role_title, clan_id, rarity, status, source_ref, lore, created_by)
    select v_edition, s.number, s.name, s.role_title, cl.id, s.rarity::public.rarity, 'draft', s.source_ref, s.lore, v_admin
    from src s left join public.clans cl on cl.name = s.clan
    on conflict (source_ref) where source_ref is not null do nothing
    returning 1)
  select count(*) into v_inserted from ins;
  insert into public.admin_audit_logs (actor_id, target_id, action, reason, after_state)
    values (v_admin, v_edition, 'catalog_import', 'Import initial du Google Sheets (mapping validé le 20/10/2026)',
            jsonb_build_object('inserted', v_inserted, 'source_rows', ${characters.length}, 'sheet', ${q(sheetId)}));
  raise notice 'Personnages insérés : %', v_inserted;
end $$;
commit;
`;
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const [csvPath,outPath,editionName='Camarilla',prefix='CAM']=process.argv.slice(2);
 if(!csvPath||!outPath){console.error('Usage : node scripts/sheet-import.mjs <csv> <sortie.sql> [édition] [PRÉFIXE]');process.exit(1);}
 const result=mapRows(parseCsv(readFileSync(csvPath,'utf8').replace(/^﻿/,'')));
 const byRarity={};const byClan={};
 for(const c of result.characters){byRarity[c.rarity]=(byRarity[c.rarity]??0)+1;const k=c.clan??'(à définir)';byClan[k]=(byClan[k]??0)+1;}
 console.log(JSON.stringify({importes:result.characters.length,numeros:`${result.characters[0]?.number}…${result.characters.at(-1)?.number}`,par_rarete:byRarity,par_clan:byClan,ecartes:result.skipped,avertissements:result.warnings},null,1));
 writeFileSync(outPath,toSql(result,{editionName,prefix,sheetId:'135ip4qZ'}));
}
