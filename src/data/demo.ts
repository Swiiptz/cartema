import type {DemoCard} from '@/components/Card';
// Vitrine publique : vraies cartes illustrées, données du catalogue Camarilla (import du Google Sheets).
export const alhoon:DemoCard={id:'CAM-189',name:'Alhoon',clan:'Malkavien',role:'Nouveau-né',rarity:'Peu commun',known:true,illustration:'/illustrations/alhoon.png'};
export const rus:DemoCard={id:'CAM-142',name:'Rus',clan:'Gangrel',role:'Nouveau-né',rarity:'Rare',known:true,illustration:'/illustrations/rus.webp',originalIllustration:'/illustrations/originals/rus.png',artLayout:'cover',artOffsetY:-18};
export const norton:DemoCard={id:'CAM-141',name:'Norton',clan:'Ventrue',role:'Nouveau-né',rarity:'Commun',known:true,illustration:'/illustrations/norton.webp',originalIllustration:'/illustrations/originals/norton.png'};
// Au centre, une carte voilée : les visages se découvrent en jouant.
export const veiled:DemoCard={id:'CAM-???',name:'Inconnu',clan:'Inconnu',role:'',rarity:'Épique',known:false,silhouette:2};
export const showcase:DemoCard[]=[alhoon,veiled,rus];
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
// Cartes éternelles fictives (aperçu local « ?eter » seulement) : illustrations déjà publiques.
export const eterPreview:DemoCard[]=[
 {id:'ETER-001',name:'Le Veilleur',clan:'Toréador',role:'Gardien des âges',rarity:'Rare',known:true,illustration:'/illustrations/Werner.png'},
 {id:'ETER-002',name:'L’Exilée',clan:'Malkavien',role:'Voix d’avant',rarity:'Légendaire',known:true,illustration:'/illustrations/alhoon.png'},
 {id:'ETER-003',name:'Le Premier Loup',clan:'Gangrel',role:'Sans âge',rarity:'Mythique',known:true,illustration:'/illustrations/rus.webp'},
];
// Carte unique fictive (aperçu local « ?cain » seulement).
export const cainPreview:DemoCard={id:'CAM-001',name:'Caïn',clan:'?',role:'Le Premier',rarity:'Mythique',known:true,unique:true,illustration:'/illustrations/Werner.png'};
