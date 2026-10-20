import type {DemoCard} from '@/components/Card';
// Presentation data only. Alhoon's clan and rarity are intentionally unspecified.
export const alhoon:DemoCard={id:'APERÇU',name:'Alhoon',clan:'?',role:'Illustration originale',rarity:'Rare',known:true,illustration:'/illustrations/alhoon.png',provisional:true};
export const rus:DemoCard={id:'APERÇU-RUS',name:'Rus',clan:'?',role:'Illustration originale',rarity:'Rare',known:true,illustration:'/illustrations/rus.webp',originalIllustration:'/illustrations/originals/rus.png',artLayout:'cover',artOffsetY:-18,provisional:true};
export const norton:DemoCard={id:'APERÇU-NORTON',name:'Norton',clan:'?',role:'Illustration originale',rarity:'Rare',known:true,illustration:'/illustrations/norton.webp',originalIllustration:'/illustrations/originals/norton.png',provisional:true};
export const demoCards:DemoCard[]=[
 alhoon,
 {id:'CAM-001',name:'Werner Le Nôtre',clan:'Toréador',role:'Veneur',rarity:'Rare',known:true},
 {id:'CAM-002',name:'Samaël',clan:'Gangrel',role:'Prince',rarity:'Légendaire',known:true,finish:'Dorée'},
 {id:'CAM-003',name:'Inconnu',clan:'Inconnu',role:'',rarity:'Mythique',known:false},
 {id:'CAM-004',name:'Ava',clan:'Malkavien',role:'Prévôt',rarity:'Très rare',known:true},
 {id:'CAM-005',name:'Inconnu',clan:'Inconnu',role:'',rarity:'Épique',known:false},
 {id:'CAM-006',name:'Lohengrin',clan:'Ventrue',role:'Sénéchal',rarity:'Épique',known:true},
 rus,norton,
];
export const previewPack:DemoCard[]=[demoCards[1],demoCards[4],{...demoCards[6],finish:'Sanglante'},demoCards[2],alhoon];
