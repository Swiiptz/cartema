'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ArrowLeftRight,Award,Bell,CheckCheck,Coins,Gavel,Flag,Gift,Heart,Lightbulb,Palette,UserPlus,Users} from 'lucide-react';
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
  case 'report_received':return {text:`Nouveau signalement : ${p.target} (par ${p.from}).`,icon:Flag,href:'/admin/'};
  case 'submission_received':return {text:`${p.from} propose ${p.kind==='illustration'?'une illustration':'une correction'} pour ${p.card}.`,icon:Flag,href:'/admin/'};
  case 'submission_decided':{
   const r=[(p.reward_deniers??0)>0&&`+${d(p.reward_deniers)}`,(p.reward_boosters??0)>0&&`+${p.reward_boosters} booster${(p.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
   return {text:p.accepted?`Votre ${p.kind==='illustration'?'illustration':'correction'} pour ${p.card} est acceptée${r?` (${r})`:''}. Merci !`:`Votre proposition pour ${p.card} n’a pas été retenue${p.note?` : ${p.note}`:''}.`,icon:Award,href:'/collection/'};}
  case 'event_reward':{
   const r=[(p.reward_deniers??0)>0&&`+${d(p.reward_deniers)}`,(p.reward_boosters??0)>0&&`+${p.reward_boosters} booster${(p.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
   return {text:p.kind==='podium'?`${p.rank}${p.rank===1?'re':'e'} place de l’événement « ${p.event} » : ${r}.`:`Défi communautaire « ${p.event} » réussi : ${r}.`,icon:Gift,href:'/'};}
  case 'wish_listed':return {text:`Carte souhaitée en vente : ${card}, ${p.auction?'enchères à partir de ':''}${d(p.price)}.`,icon:Heart,href:'/market/'};
  case 'auction_unsold':return {text:`Enchère close sans offre : ${card} vous revient.`,icon:Gavel,href:'/market/'};
  case 'achievement':{
   const r=[(p.reward_deniers??0)>0&&`+${d(p.reward_deniers)}`,(p.reward_boosters??0)>0&&`+${p.reward_boosters} booster${(p.reward_boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
   return {text:`Succès débloqué : ${p.label}${r?` (${r})`:''}.`,icon:Award,href:'/progression/?onglet=succes'};}
  case 'contest_selected':return {text:`Votre dessin pour ${p.character} est retenu (${p.label}) : la carte vous est offerte${p.finish&&p.finish!=='Standard'?` en finition ${p.finish}`:''}.`,icon:Palette,href:'/collection/'};
  case 'contest_reward':{
   const r=[(p.deniers??0)>0&&`+${d(p.deniers)}`,(p.boosters??0)>0&&`+${p.boosters} booster${(p.boosters??0)>1?'s':''}`].filter(Boolean).join(' · ');
   return {text:`Concours « ${p.title} » : ${p.position}${p.position===1?'re':'e'} place${p.podium?', titre « Illustrateur de génie »':''}${r?` (${r})`:''}.`,icon:Palette,href:'/concours/'};}
  case 'suggestion_received':return {text:`${p.from} envoie une doléance : « ${p.title} ».`,icon:Lightbulb,href:'/admin/'};
  case 'suggestion_answered':return {text:`L’équipe a répondu à votre idée « ${p.title} »${p.status==='planned'?' : elle est prévue !':p.status==='done'?' : c’est fait !':p.status==='declined'?'.':'.'}${p.public?' Elle est ouverte au vote.':''}`,icon:Lightbulb,href:'/doleances/'};
  case 'team_gift':
   if((p.boosters??0)>0)return {text:`L’équipe vous offre ${p.boosters} booster${(p.boosters??0)>1?'s':''} : ${(p.boosters??0)>1?'ils vous attendent':'il vous attend'} dans votre réserve.`,icon:Gift,href:'/boosters/'};
   if((p.deniers??0)>0)return {text:`L’équipe vous offre ${d(p.deniers)}.`,icon:Coins,href:'/'};
   return {text:`L’équipe vous offre ${(p.quantity??1)>1?`${p.quantity} × `:''}${card}${p.version?`, version « ${p.version} »`:''}.`,icon:Gift,href:'/collection/'};
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
 const {session,client,player,refreshPlayer}=useAuth();
 // Nouvelle notification (don de l'équipe, vente, cadeau…) : réserve et Deniers rechargés aussitôt.
 // Fonction du contexte gardée dans une ref (pas dans les dépendances du chargement).
 const refreshRef=useRef(refreshPlayer);refreshRef.current=refreshPlayer;
 const lastUnread=useRef<number|null>(null);
 const hasPlayer=!!player;
 const pathname=usePathname();
 const [unread,setUnread]=useState(0);
 const [open,setOpen]=useState(false);
 const [data,setData]=useState<Notifications|null>(null);
 const poll=useCallback(()=>{if(client&&hasPlayer&&document.visibilityState==='visible')void callRpc<number>(client,'get_unread_count').then(n=>{
  if(lastUnread.current!==null&&n>lastUnread.current)void refreshRef.current();
  lastUnread.current=n;setUnread(n);
 }).catch(()=>{});},[client,hasPlayer]);
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
