'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Palette} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Countdown} from './ui';

/** Concours d'illustrations ouvert : invitation sur tout le site, sauf sur sa propre page. */
export function ContestBanner(){
 const {player}=useAuth();
 const path=usePathname();
 const c=player?.contest;
 if(!c||path?.startsWith('/concours'))return null;
 return <div className="handle-banner contest-banner rise" role="status"><Palette size={16}/><span>Concours d’illustrations <strong>« {c.title} »</strong> : proposez vos dessins et votez. Fin dans <Countdown to={c.ends_at}/>.</span><Link className="primary compact" href="/concours/">Participer</Link></div>;
}
