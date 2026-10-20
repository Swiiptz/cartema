'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {House,BookOpen,PackageOpen,Store,UserRound} from 'lucide-react';
const links=[{href:'/',label:'Accueil',icon:House},{href:'/collection',label:'Collection',icon:BookOpen},{href:'/boosters',label:'Boosters',icon:PackageOpen},{href:'/market',label:'Marché',icon:Store},{href:'/profile',label:'Profil',icon:UserRound}];
export function Navigation(){const pathname=usePathname();return <nav className="nav" aria-label="Navigation principale">{links.map(({href,label,icon:Icon})=><Link aria-current={pathname===href?'page':undefined} className={pathname===href?'active':''} key={href} href={href}><Icon size={19}/><span>{label}</span></Link>)}</nav>}
