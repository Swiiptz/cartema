'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {House,BookOpen,PackageOpen,Store,UserRound} from 'lucide-react';
import {useAuth} from './AuthProvider';
const links=[{href:'/',label:'Accueil',icon:House},{href:'/collection',label:'Collection',icon:BookOpen},{href:'/boosters',label:'Boosters',icon:PackageOpen},{href:'/market',label:'Marché',icon:Store},{href:'/profile',label:'Profil',icon:UserRound}];
export function Navigation(){const pathname=usePathname();const {player}=useAuth();const pending=player?.social_pending??0;return <nav className="nav" aria-label="Navigation principale">{links.map(({href,label,icon:Icon})=>{const on=pathname===href||pathname===href+'/'||(href==='/profile'&&pathname.startsWith('/amis'));return <Link aria-current={on?'page':undefined} className={on?'active':''} key={href} href={href}><span className="nav-icon"><Icon size={19}/>{href==='/profile'&&pending>0&&<b className="nav-dot" aria-label={`${pending} en attente`}>{pending}</b>}</span><span>{label}</span></Link>;})}</nav>}
