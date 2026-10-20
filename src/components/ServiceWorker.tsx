'use client';
import {useEffect} from 'react';
import {withBase} from '@/lib/paths';

/** Enregistre le service worker de coquille statique, en production uniquement. */
export function ServiceWorker(){
 useEffect(()=>{
  if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
  void navigator.serviceWorker.register(withBase('/sw.js'),{scope:withBase('/')}).catch(()=>{/* PWA facultative */});
 },[]);
 return null;
}
