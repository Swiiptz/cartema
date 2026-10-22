'use client';
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';

/** Lien temporaire (1 h) vers une image du bucket privé « submissions » : seuls l'auteur et l'admin y ont accès. */
export function useSignedSubmission(client:SupabaseClient|null,path:string|null|undefined){
 const [url,setUrl]=useState<string|null>(null);
 useEffect(()=>{
  setUrl(null);if(!client||!path)return;let alive=true;
  void client.storage.from('submissions').createSignedUrl(path,3600).then(({data})=>{if(alive)setUrl(data?.signedUrl??null);});
  return()=>{alive=false;};
 },[client,path]);
 return url;
}
