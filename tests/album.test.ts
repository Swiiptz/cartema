import {describe,it,expect} from 'vitest';
import {selectAlbum,initialAlbumFilters} from '../src/lib/album';
import type {DemoCard} from '../src/components/Card';
const cards:DemoCard[]=[{id:'CAM-010',name:'Éléonore',clan:'Toréador',role:'Artiste',rarity:'Rare',known:true,finish:'Dorée'},{id:'CAM-002',name:'Secret',clan:'Ventrue',role:'Prince',rarity:'Mythique',known:false},{id:'CAM-003',name:'Ava',clan:'Malkavien',role:'Prévôt',rarity:'Très rare',known:true}];
describe('album',()=>{
 it('croise les filtres et recherche sans exiger les accents',()=>{expect(selectAlbum(cards,{...initialAlbumFilters,query:'eleonore',clan:'Toréador',rarity:'Rare',finish:'Dorée'}).map(c=>c.id)).toEqual(['CAM-010']);});
 it('ne révèle pas une identité inconnue par recherche ou filtre',()=>{expect(selectAlbum(cards,{...initialAlbumFilters,query:'secret'})).toEqual([]);expect(selectAlbum(cards,{...initialAlbumFilters,clan:'Ventrue'})).toEqual([]);expect(selectAlbum(cards,{...initialAlbumFilters,query:'CAM-002'})).toHaveLength(1);});
 it('trie naturellement les numéros et garde les inconnus en fin du tri par nom',()=>{expect(selectAlbum(cards,initialAlbumFilters).map(c=>c.id)).toEqual(['CAM-002','CAM-003','CAM-010']);expect(selectAlbum(cards,{...initialAlbumFilters,sort:'name',descending:true}).at(-1)?.known).toBe(false);});
 it('distingue Standard, Dorée et cartes manquantes sans modifier le catalogue',()=>{expect(selectAlbum(cards,{...initialAlbumFilters,finish:'Standard'}).map(c=>c.id)).toEqual(['CAM-003']);expect(selectAlbum(cards,{...initialAlbumFilters,status:'missing'}).map(c=>c.id)).toEqual(['CAM-002']);expect(cards[0].id).toBe('CAM-010');});
 it('montre les doublons et trie par nombre d’exemplaires',()=>{
  const owned=[{...cards[0],owned:3},{...cards[1],owned:0},{...cards[2],owned:2},{...cards[0],id:'CAM-011',owned:1}];
  expect(selectAlbum(owned,{...initialAlbumFilters,status:'dupes'}).map(c=>c.id)).toEqual(['CAM-003','CAM-010']);
  expect(selectAlbum(owned,{...initialAlbumFilters,sort:'copies'}).map(c=>c.id)).toEqual(['CAM-010','CAM-003','CAM-011','CAM-002']);
 });
 it('ne présente pas une rareté provisoire comme une rareté officielle',()=>{
  const preview:DemoCard={...cards[0],id:'APERÇU-RUS',name:'Rus',provisional:true};
  expect(selectAlbum([preview],{...initialAlbumFilters,rarity:'Rare'})).toEqual([]);
  expect(selectAlbum([preview],initialAlbumFilters)).toHaveLength(1);
 });
});
