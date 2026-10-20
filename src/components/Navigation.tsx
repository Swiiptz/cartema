'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {House,BookOpen,PackageOpen,Store,Trophy,UserRound} from 'lucide-react';
import {useAuth} from './AuthProvider';
const links=[{href:'/',label:'Accueil',icon:House},{href:'/collection',label:'Collection',icon:BookOpen},{href:'/boosters',label:'Boosters',icon:PackageOpen},{href:'/market',label:'Marché',icon:Store},{href:'/progression',label:'Progrès',icon:Trophy},{href:'/profile',label:'Profil',icon:UserRound}];
export function Navigation(){const pathname=usePathname();const {player}=useAuth();const badges:Record<string,number>={'/profile':player?.social_pending??0,'/progression':player?.missions_ready??0};return <nav className="nav" aria-label="Navigation principale">{links.map(({href,label,icon:Icon})=>{const on=pathname===href||pathname===href+'/'||(href==='/profile'&&pathname.startsWith('/amis'));return <Link aria-current={on?'page':undefined} className={on?'active':''} key={href} href={href}><span className="nav-icon"><Icon size={19}/>{(badges[href]??0)>0&&<b className="nav-dot" aria-label={`${badges[href]} en attente`}>{badges[href]}</b>}</span><span>{label}</span></Link>;})}</nav>}
