'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ArrowLeftRight,Award,Bell,CheckCheck,Coins,Gavel,Gift,Heart,UserPlus,Users} from 'lucide-react';
import {useAuth} from './AuthProvider';
import {Sheet,Skeleton} from './ui';
import {callRpc,type AppNotification,type Notifications} from '@/lib/game';

const POLL_MS=60000;

/** Libellé, icône et lien d'une notification. */
export function describe(n:AppNotification):{text:string;icon:typeof Bell;href:string}{
 const p=n.payload;const card=p.card?`${p.card}${p.finish&&p.finish!=='Standard'?` (${p.finish})`:''}`:'';
 const d=(v?:number)=>`${(v??0).toLocaleString('fr-FR')} Deniers`;
 switch(n.kind){
  case 'friend_request':return {text:`${p.from} vous demande en ami.`,icon:UserPlus,href:'/amis/'};
  case 'friend_accepted':return {text:`${p.from} a accepté votre demande d’ami.`,icon:Users,href:`/joueur/?h=${encodeURIComponent(p.from??'')}`};
  case 'gift_received':return {text:`${p.from} vous offre ${card}.`,icon:Gift,href:'/amis/'};
  case 'gift_answered':return {text:`${p.from} a ${p.status==='accepted'?'accepté':'refusé'} votre cadeau : ${card}.`,icon:Gift,href:'/amis/'};
  case 'trade_received':return {text:p.counter?`${p.from} vous fait une contre-proposition.`:`${p.from} vous propose un échange.`,icon:ArrowLeftRight,href:'/amis/'};
  case 'trade_answered':return {text:`${p.from} a ${p.status==='accepted'?'accepté':'refusé'} votre échange.`,icon:ArrowLeftRight,href:'/amis/'};
  case 'listing_sold':return {text:`${card} vendue ${p.auction?'aux enchères ':''}pour ${d(p.price)}${p.buyer?` à ${p.buyer}`:''}.`,icon:Coins,href:'/market/'};
  case 'outbid':return {text:`Enchère dépassée sur ${card} : ${d(p.amount)}.`,icon:Gavel,href:'/market/'};
  case 'auction_won':return {text:`Vous remportez ${card} pour ${d(p.price)}.`,icon:Gavel,href:'/collection/'};
  case 'wish_listed':return {text:`Carte souhaitée en vente : ${card}, ${p.auction?'enchères à partir de ':''}${d(p.price)}.`,icon:Heart,href:'/market/'};
  case 'auction_unsold':return {text:`Enchère close sans offre : ${card} vous revient.`,icon:Gavel,href:'/market/'};
  case 'achievement':{
   const r=[(p.reward_deniers??0)>0&&`+${d(p.reward_deniers)}`,(p.reward_boosters??0)>0&&`+${p.reward_boosters} booster${(p.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
   return {text:`Succès débloqué : ${p.label}${r?` (${r})`:''}.`,icon:Award,href:'/progression/?onglet=succes'};}
  default:return {text:'Nouvelle activité.',icon:Bell,href:'/'};
 }
}

function ago(iso:string){
 const s=Math.max(0,(Date.now()-Date.parse(iso))/1000);
 if(s<60)return 'à l’instant';if(s<3600)return `il y a ${Math.floor(s/60)} min`;if(s<86400)return `il y a ${Math.floor(s/3600)} h`;
 if(s<7*86400)return `il y a ${Math.floor(s/86400)} j`;
 return new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
}

/** Cloche de l'en-tête : pastille des non-lues (rafraîchie à chaque page et chaque minute) et panneau. */
export function NotificationBell(){
 const {session,client,player}=useAuth();
 const pathname=usePathname();
 const [unread,setUnread]=useState(0);
 const [open,setOpen]=useState(false);
 const [data,setData]=useState<Notifications|null>(null);
 const poll=useCallback(()=>{if(client&&player&&document.visibilityState==='visible')void callRpc<number>(client,'get_unread_count').then(setUnread).catch(()=>{});},[client,player]);
 useEffect(()=>{poll();},[poll,pathname]);
 useEffect(()=>{
  const id=setInterval(poll,POLL_MS);document.addEventListener('visibilitychange',poll);
  return()=>{clearInterval(id);document.removeEventListener('visibilitychange',poll);};
 },[poll]);
 async function show(){
  if(!client)return;
  setOpen(true);setData(null);
  try{
   const n=await callRpc<Notifications>(client,'get_notifications',{p_limit:40});
   setData(n);
   if(n.unread>0)setUnread(await callRpc<number>(client,'mark_notifications_read',{p_ids:null}));
  }catch{setData({items:[],unread:0,prefs:{friends:true,social:true,market:true,achievements:true}});}
 }
 if(!session||!player)return null;
 return <>
  <button className="bell" aria-label={unread?`Notifications, ${unread} non lue${unread>1?'s':''}`:'Notifications'} onClick={()=>void show()}>
   <Bell size={17}/>{unread>0&&<b className="bell-count">{unread>9?'9+':unread}</b>}
  </button>
  <Sheet open={open} onClose={()=>setOpen(false)} title="Notifications">
   {!data?<div className="notif-list">{Array.from({length:4},(_,i)=><Skeleton key={i} style={{height:54}}/>)}</div>
    :data.items.length===0?<p className="muted sheet-text">Rien de nouveau pour l’instant.</p>
    :<ul className="notif-list">{data.items.map((n,i)=>{const {text,icon:Icon,href}=describe(n);return <li key={n.id} className={`rise ${n.read?'':'unread'}`} style={{'--i':Math.min(i,10)} as React.CSSProperties}>
     <Link href={href} onClick={()=>setOpen(false)}><span className="notif-icon"><Icon size={15}/></span><span className="notif-text">{text}<small>{ago(n.created_at)}</small></span></Link></li>;})}</ul>}
   {data&&data.items.length>0&&<p className="muted notif-foot"><CheckCheck size={13}/> Tout est marqué comme lu · réglages dans votre <Link href="/profile/" onClick={()=>setOpen(false)}>profil</Link>.</p>}
  </Sheet>
 </>;
}
