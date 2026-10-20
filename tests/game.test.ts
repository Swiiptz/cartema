import {describe,it,expect} from 'vitest';
import {albumToCard,openedToCard,revealOrder,silhouetteIndex,toGameError,type AlbumEntry,type OpenedCard} from '../src/lib/game';
import {selectAlbum,initialAlbumFilters} from '../src/lib/album';
import {resolveIllustration} from '../src/lib/paths';

const known:AlbumEntry={known:true,character_id:'c1',edition_id:'e1',code:'CAM-001',number:1,rarity:'Rare',name:'Werner',role_title:'Veneur',clan:'Toréador',art_path:'/illustrations/alhoon.png',art_meta:{layout:'cover',offsetY:-18},silhouette_key:'gravure-4',discovered_at:'2026-10-20T10:00:00Z',finishes_seen:['Standard','Sanglante'],owned:{Standard:2}};
const unknown:AlbumEntry={known:false,edition_id:'e1',code:'CAM-002',number:2,rarity:'Mythique',silhouette_key:'gravure-1'};

describe('cartes issues du serveur',()=>{
  it('reprend la silhouette persistée',()=>{
    expect(silhouetteIndex('gravure-4')).toBe(4);
    expect(silhouetteIndex(null)).toBeUndefined();
  });
  it('convertit une carte connue avec cadrage et possession',()=>{
    expect(albumToCard(known)).toMatchObject({id:'CAM-001',name:'Werner',clan:'Toréador',known:true,artLayout:'cover',artOffsetY:-18,silhouette:4,owned:2,finishesSeen:['Standard','Sanglante']});
  });
  it('garde une carte inconnue anonyme',()=>{
    const card=albumToCard(unknown);
    expect(card).toMatchObject({id:'CAM-002',known:false,name:'Inconnu',clan:'Inconnu',role:'',silhouette:1});
    expect(card.illustration).toBeUndefined();
  });
  it('affiche la finition tirée à l’ouverture',()=>{
    const opened:OpenedCard={position:5,instance_id:'i',character_id:'c',code:'CAM-009',number:9,name:'Ava',role_title:'',clan:null,rarity:'Épique',finish:'Dorée',art_path:null,art_meta:{},silhouette_key:'gravure-2'};
    expect(openedToCard(opened)).toMatchObject({finish:'Dorée',clan:'?',known:true,silhouette:2});
  });
  it('filtre les finitions selon celles réellement obtenues',()=>{
    const cards=[albumToCard(known),albumToCard(unknown)];
    expect(selectAlbum(cards,{...initialAlbumFilters,finish:'Sanglante'}).map(c=>c.id)).toEqual(['CAM-001']);
    expect(selectAlbum(cards,{...initialAlbumFilters,finish:'Dorée'})).toEqual([]);
  });
});

describe('ordre de révélation',()=>{
  it('révèle de la moins rare à la plus rare, finitions spéciales en dernier',()=>{
    const pack=[{id:'a',rarity:'Rare',finish:'Standard'},{id:'b',rarity:'Commun',finish:'Dorée'},{id:'c',rarity:'Commun',finish:'Standard'},{id:'d',rarity:'Peu commun'},{id:'e',rarity:'Commun',finish:'Standard'}] as const;
    expect(revealOrder(pack).map(c=>c.id)).toEqual(['c','e','b','d','a']);
    expect(revealOrder([{id:'u',rarity:'Mythique',unique:true},{id:'m',rarity:'Mythique',finish:'Sanglante'}]).map(c=>c.id)).toEqual(['m','u']);
  });
});

describe('erreurs et chemins',()=>{
  it('distingue refus métier définitif et incident réseau',()=>{
    expect(toGameError({message:'no_booster_available',code:'P0001'})).toMatchObject({code:'no_booster_available',definitive:true});
    expect(toGameError({message:'TypeError: Failed to fetch',code:''})).toMatchObject({code:'unknown',definitive:false});
  });
  it('n’accepte que les illustrations locales ou du stockage du projet',()=>{
    expect(resolveIllustration('/illustrations/rus.webp')).toBe('/illustrations/rus.webp');
    expect(resolveIllustration('https://evil.example/x.png')).toBeUndefined();
    expect(resolveIllustration('/illustrations/../secret')).toBeUndefined();
  });
});

describe('finition affichée dans l’album',()=>{
  it('montre la meilleure finition obtenue quand la Standard manque',()=>{
    const base={known:true,character_id:'c',edition_id:'e',code:'CAM-002',number:2,rarity:'Rare',name:'X',role_title:'',clan:null,art_path:null,art_meta:{},silhouette_key:null,discovered_at:'',owned:{}} as const;
    expect(albumToCard({...base,finishes_seen:['Dorée']} as any).finish).toBe('Dorée');
    expect(albumToCard({...base,finishes_seen:['Standard','Sanglante']} as any).finish).toBeUndefined();
  });
});
