import type {DemoCard} from '@/components/Card';
// Vitrine publique : vraies cartes illustrées, données du catalogue Camarilla (import du Google Sheets).
export const alhoon:DemoCard={id:'CAM-189',name:'Alhoon',clan:'Malkavien',role:'Nouveau-né',rarity:'Peu commun',known:true,illustration:'/illustrations/alhoon.png'};
export const rus:DemoCard={id:'CAM-142',name:'Rus',clan:'Gangrel',role:'Nouveau-né',rarity:'Rare',known:true,illustration:'/illustrations/rus.webp',originalIllustration:'/illustrations/originals/rus.png',artLayout:'cover',artOffsetY:-18};
export const norton:DemoCard={id:'CAM-141',name:'Norton',clan:'Ventrue',role:'Nouveau-né',rarity:'Commun',known:true,illustration:'/illustrations/norton.webp',originalIllustration:'/illustrations/originals/norton.png'};
export const showcase:DemoCard[]=[alhoon,norton,rus];
// Le reste n'est utilisé qu'en mode atelier (site non relié à Supabase).
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
