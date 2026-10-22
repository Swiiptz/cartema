import type {Metadata,Viewport} from 'next';
import Link from 'next/link';
import {Cinzel,Cormorant_Garamond,Manrope} from 'next/font/google';
import {Moon} from 'lucide-react';
import {Navigation} from '@/components/Navigation';
import {HandleBanner} from '@/components/HandleBanner';
import {AuthProvider} from '@/components/AuthProvider';
import {AccountBadge} from '@/components/AccountBadge';
import {NotificationBell} from '@/components/NotificationBell';
import {ServiceWorker} from '@/components/ServiceWorker';
import {withBase} from '@/lib/paths';
import './globals.css';
const cinzel=Cinzel({subsets:['latin'],weight:['400','600','700'],variable:'--font-cinzel',display:'swap'});
const cormorant=Cormorant_Garamond({subsets:['latin'],weight:['500','600'],style:['normal','italic'],variable:'--font-cormorant',display:'swap'});
const manrope=Manrope({subsets:['latin'],weight:['400','500','600','700'],variable:'--font-manrope',display:'swap'});
export const metadata:Metadata={title:'Cartema',description:'Un rituel, cinq cartes. Découvrez le tarot gothique de la chronique Camarilla.',manifest:withBase('/manifest.webmanifest'),applicationName:'Cartema',
 icons:{icon:[{url:withBase('/icon.svg'),type:'image/svg+xml'},{url:withBase('/favicon-48.png'),sizes:'48x48',type:'image/png'}],apple:[{url:withBase('/apple-touch-icon.png'),sizes:'180x180'}]},
 // Écran d'accueil iOS : plein écran, barre d'état fondue dans le fond sombre.
 appleWebApp:{capable:true,title:'Cartema',statusBarStyle:'black-translucent'},
 formatDetection:{telephone:false}};
export const viewport:Viewport={themeColor:'#0d090f',width:'device-width',initialScale:1,viewportFit:'cover',colorScheme:'dark'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" className={`${cinzel.variable} ${cormorant.variable} ${manrope.variable}`}><body><AuthProvider><ServiceWorker/><a className="skip-link" href="#contenu">Aller au contenu</a><div className="layout"><header className="header"><Link href="/" className="logo"><svg viewBox="0 0 32 38" aria-hidden="true"><path d="M16 2 29 19 16 36 3 19Z"/><path d="M16 9 23 19 16 29 9 19Z"/><circle cx="16" cy="19" r="3"/></svg><span>CARTEMA<small>VAMPIRIC<i className="blood-dot" aria-hidden="true"/>BOOSTERS</small></span></Link><div className="header-status"><NotificationBell/><AccountBadge/><span className="header-moon"><Moon size={17}/></span></div></header><Navigation/><HandleBanner/><main id="contenu">{children}</main><footer className="site-footer"><span>CARTEMA</span> <span className="footer-copy">Les secrets se collectionnent.</span><nav className="footer-links" aria-label="Informations légales"><Link href="/mentions-legales/">Mentions légales</Link><Link href="/confidentialite/">Confidentialité</Link></nav></footer></div></AuthProvider></body></html>}
