'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {getSupabase,supabaseConfigured} from '@/lib/supabase';
import {callRpc,type PlayerState} from '@/lib/game';

type Auth={
 configured:boolean;
 ready:boolean;
 client:SupabaseClient|null;
 session:Session|null;
 player:PlayerState|null;
 playerError:string|null;
 refreshPlayer:()=>Promise<PlayerState|null>;
 signOut:()=>Promise<void>;
};
const AuthContext=createContext<Auth>({configured:false,ready:true,client:null,session:null,player:null,playerError:null,refreshPlayer:async()=>null,signOut:async()=>{}});
export const useAuth=()=>useContext(AuthContext);

export function AuthProvider({children}:{children:React.ReactNode}){
 const [client]=useState(()=>getSupabase());
 const [session,setSession]=useState<Session|null>(null);
 const [ready,setReady]=useState(!supabaseConfigured);
 const [player,setPlayer]=useState<PlayerState|null>(null);
 const [playerError,setPlayerError]=useState<string|null>(null);
 // Bonus de connexion (et boosters de série) crédités par le serveur à la première visite du jour.
 const [daily,setDaily]=useState<{deniers:number;days:number;boosters:number}|null>(null);
 useEffect(()=>{if(!daily)return;const t=setTimeout(()=>setDaily(null),daily.boosters?7000:5500);return()=>clearTimeout(t);},[daily]);

 const refreshPlayer=useCallback(async()=>{
  if(!client)return null;
  try{const state=await callRpc<PlayerState>(client,'get_player_state');setPlayer(state);
   if(state.daily_reward||state.streak_reward)setDaily({deniers:state.daily_reward??0,days:state.streak?.current??0,boosters:state.streak_reward??0});setPlayerError(null);return state;}
  catch(e){setPlayerError((e as Error).message);return null;}
 },[client]);

 useEffect(()=>{
  if(!client){setReady(true);return;}
  let alive=true;
  void client.auth.getSession().then(({data})=>{if(alive){setSession(data.session);setReady(true);}});
  const {data:{subscription}}=client.auth.onAuthStateChange((event,next)=>{setSession(next);if(!next)setPlayer(null);if(event==='TOKEN_REFRESHED')setRetry(r=>r+1);});
  return()=>{alive=false;subscription.unsubscribe();};
 },[client]);

 const userId=session?.user.id;
 useEffect(()=>{if(userId)void refreshPlayer();},[userId,refreshPlayer]);
 // Un échec (session en cours de renouvellement, réseau) ne doit pas bloquer le site : nouvel essai.
 const [retry,setRetry]=useState(0);
 const attempts=useRef(0);
 useEffect(()=>{
  if(!userId||!playerError||attempts.current>=4)return;
  const t=setTimeout(()=>{attempts.current++;void refreshPlayer();},1200*(attempts.current+1));
  return()=>clearTimeout(t);
 },[userId,playerError,refreshPlayer,retry]);
 useEffect(()=>{if(player)attempts.current=0;},[player]);
 useEffect(()=>{if(retry&&userId&&!player)void refreshPlayer();},[retry,userId,player,refreshPlayer]);

 const signOut=useCallback(async()=>{await client?.auth.signOut();setPlayer(null);},[client]);
 return <AuthContext.Provider value={{configured:supabaseConfigured,ready,client,session,player,playerError,refreshPlayer,signOut}}>{children}{daily&&<div className="toast" role="status"><span className="toast-coin" aria-hidden="true">✦</span><span>{daily.deniers>0&&<><strong>+{daily.deniers} Deniers</strong> · bonus de connexion du jour</>}{daily.boosters>0&&<>{daily.deniers>0?<br/>:null}<strong>Série de {daily.days} jours</strong> · +{daily.boosters} booster{daily.boosters>1?'s':''} offert{daily.boosters>1?'s':''}</>}</span><button className="icon-button" aria-label="Fermer" onClick={()=>setDaily(null)}>×</button></div>}</AuthContext.Provider>;
}
