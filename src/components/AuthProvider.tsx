'use client';
import {createContext,useCallback,useContext,useEffect,useState} from 'react';
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

 const refreshPlayer=useCallback(async()=>{
  if(!client)return null;
  try{const state=await callRpc<PlayerState>(client,'get_player_state');setPlayer(state);setPlayerError(null);return state;}
  catch(e){setPlayerError((e as Error).message);return null;}
 },[client]);

 useEffect(()=>{
  if(!client){setReady(true);return;}
  let alive=true;
  void client.auth.getSession().then(({data})=>{if(alive){setSession(data.session);setReady(true);}});
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,next)=>{setSession(next);if(!next)setPlayer(null);});
  return()=>{alive=false;subscription.unsubscribe();};
 },[client]);

 const userId=session?.user.id;
 useEffect(()=>{if(userId)void refreshPlayer();},[userId,refreshPlayer]);

 const signOut=useCallback(async()=>{await client?.auth.signOut();setPlayer(null);},[client]);
 return <AuthContext.Provider value={{configured:supabaseConfigured,ready,client,session,player,playerError,refreshPlayer,signOut}}>{children}</AuthContext.Provider>;
}
