'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {UserPen} from 'lucide-react';
import {useAuth} from './AuthProvider';

/** Invite à choisir un pseudonyme : sans lui, pas de marché, d'échanges ni de cadeaux. */
export function HandleBanner(){
 const {player}=useAuth();
 const path=usePathname();
 if(!player||player.profile.handle||path?.startsWith('/profile'))return null;
 return <div className="handle-banner rise" role="status"><UserPen size={16}/><span>Choisissez votre <strong>pseudonyme</strong> : il s’affiche auprès des autres joueurs et il est nécessaire pour le marché, les échanges et les cadeaux.</span><Link className="primary compact" href="/profile/">Choisir</Link></div>;
}
