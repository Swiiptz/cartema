import type {Metadata,Viewport} from 'next';
import Link from 'next/link';
import localFont from 'next/font/local';
import {Moon} from 'lucide-react';
import {Navigation} from '@/components/Navigation';
import {HandleBanner} from '@/components/HandleBanner';
import {ContestBanner} from '@/components/ContestBanner';
import {AuthProvider} from '@/components/AuthProvider';
import {AccountBadge} from '@/components/AccountBadge';
import {NotificationBell} from '@/components/NotificationBell';
import {ServiceWorker} from '@/components/ServiceWorker';
import {withBase} from '@/lib/paths';
import './globals.css';
// Polices embarquées (paquets @fontsource, mêmes fichiers que Google Fonts) : le build ne dépend
// plus d'un téléchargement chez Google, qui faisait parfois échouer le déploiement.
const cinzel=localFont({variable:'--font-cinzel',display:'swap',src:[
 {path:'../../node_modules/@fontsource/cinzel/files/cinzel-latin-400-normal.woff2',weight:'400',style:'normal'},
 {path:'../../node_modules/@fontsource/cinzel/files/cinzel-latin-600-normal.woff2',weight:'600',style:'normal'},
 {path:'../../node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff2',weight:'700',style:'normal'}]});
const cormorant=localFont({variable:'--font-cormorant',display:'swap',src:[
 {path:'../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2',weight:'500',style:'normal'},
 {path:'../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2',weight:'500',style:'italic'},
 {path:'../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2',weight:'600',style:'normal'},
 {path:'../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-italic.woff2',weight:'600',style:'italic'}]});
const manrope=localFont({variable:'--font-manrope',display:'swap',src:[
 {path:'../../node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2',weight:'400',style:'normal'},
 {path:'../../node_modules/@fontsource/manrope/files/manrope-latin-500-normal.woff2',weight:'500',style:'normal'},
 {path:'../../node_modules/@fontsource/manrope/files/manrope-latin-600-normal.woff2',weight:'600',style:'normal'},
 {path:'../../node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2',weight:'700',style:'normal'}]});
export const metadata:Metadata={title:'Cartema',description:'Un rituel, cinq cartes. Découvrez le tarot gothique de la chronique Camarilla.',manifest:withBase('/manifest.webmanifest'),applicationName:'Cartema',
 icons:{icon:[{url:withBase('/icon.svg'),type:'image/svg+xml'},{url:withBase('/favicon-48.png'),sizes:'48x48',type:'image/png'}],apple:[{url:withBase('/apple-touch-icon.png'),sizes:'180x180'}]},
 // Écran d'accueil iOS : plein écran, barre d'état fondue dans le fond sombre.
 appleWebApp:{capable:true,title:'Cartema',statusBarStyle:'black-translucent'},
 formatDetection:{telephone:false}};
export const viewport:Viewport={themeColor:'#0d090f',width:'device-width',initialScale:1,viewportFit:'cover',colorScheme:'dark'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" className={`${cinzel.variable} ${cormorant.variable} ${manrope.variable}`}><body><AuthProvider><ServiceWorker/><a className="skip-link" href="#contenu">Aller au contenu</a><div className="layout"><header className="header"><Link href="/" className="logo"><svg viewBox="0 0 32 38" aria-hidden="true"><path d="M16 2 29 19 16 36 3 19Z"/><path d="M16 9 23 19 16 29 9 19Z"/><circle cx="16" cy="19" r="3"/></svg><span>CARTEMA<small>VAMPIRIC<i className="blood-dot" aria-hidden="true"/>BOOSTERS</small></span></Link><div className="header-status"><NotificationBell/><AccountBadge/><span className="header-moon"><Moon size={17}/></span></div></header><Navigation/><HandleBanner/><ContestBanner/><main id="contenu">{children}</main><footer className="site-footer"><span>CARTEMA</span> <span className="footer-copy">Les secrets se collectionnent.</span><nav className="footer-links" aria-label="Informations légales"><Link href="/doleances/">Doléances</Link><Link href="/mentions-legales/">Mentions légales</Link><Link href="/confidentialite/">Confidentialité</Link></nav></footer></div></AuthProvider></body></html>}
