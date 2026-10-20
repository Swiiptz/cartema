import type {Metadata,Viewport} from 'next';
import Link from 'next/link';
import {Cinzel,Cormorant_Garamond,Manrope} from 'next/font/google';
import {Moon} from 'lucide-react';
import {Navigation} from '@/components/Navigation';
import {AuthProvider} from '@/components/AuthProvider';
import {AccountBadge} from '@/components/AccountBadge';
import {ServiceWorker} from '@/components/ServiceWorker';
import {withBase} from '@/lib/paths';
import './globals.css';
const cinzel=Cinzel({subsets:['latin'],weight:['400','600','700'],variable:'--font-cinzel',display:'swap'});
const cormorant=Cormorant_Garamond({subsets:['latin'],weight:['500','600'],style:['normal','italic'],variable:'--font-cormorant',display:'swap'});
const manrope=Manrope({subsets:['latin'],weight:['400','500','600','700'],variable:'--font-manrope',display:'swap'});
export const metadata:Metadata={title:'Cartema — Vampiric Boosters',description:'Un rituel, cinq cartes. Découvrez le tarot gothique de la chronique Camarilla.',manifest:withBase('/manifest.webmanifest'),icons:{icon:withBase('/icon.svg')},applicationName:'Cartema'};
export const viewport:Viewport={themeColor:'#0d090f',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" className={`${cinzel.variable} ${cormorant.variable} ${manrope.variable}`}><body><AuthProvider><ServiceWorker/><a className="skip-link" href="#contenu">Aller au contenu</a><div className="layout"><header className="header"><Link href="/" className="logo"><svg viewBox="0 0 32 38" aria-hidden="true"><path d="M16 2 29 19 16 36 3 19Z"/><path d="M16 9 23 19 16 29 9 19Z"/><path className="logo-blood" d="M16 14.6C17.9 17.2 19 18.8 19 20.3A3 3 0 0 1 13 20.3C13 18.8 14.1 17.2 16 14.6Z"/></svg><span>CARTEMA<small>VAMPIRIC BOOSTERS</small></span></Link><div className="header-status"><AccountBadge/><span className="header-moon"><Moon size={17}/></span></div></header><Navigation/><main id="contenu">{children}</main><footer className="site-footer"><span>CARTEMA</span> Les secrets se collectionnent.</footer></div></AuthProvider></body></html>}
