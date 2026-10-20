'use client';
import Link from 'next/link';
import {UserRound} from 'lucide-react';
import {useAuth} from './AuthProvider';

export function AccountBadge(){
 const {configured,ready,session,player}=useAuth();
 if(!configured)return <span className="demo-badge">ATELIER · APERÇU</span>;
 if(!ready)return <span className="demo-badge" aria-hidden="true">…</span>;
 if(!session)return <Link href="/connexion/" className="demo-badge account-badge">Se connecter</Link>;
 return <Link href="/connexion/" className="demo-badge account-badge"><UserRound size={13}/> {player?.profile.handle??'Mon compte'}{player&&<span className="account-deniers"> · {player.balance.toLocaleString('fr-FR')} Deniers</span>}</Link>;
}
