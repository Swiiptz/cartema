'use client';
import {useEffect} from 'react';
import {withBase} from '@/lib/paths';
import {captureInstallPrompt} from '@/lib/install';

/** Enregistre le service worker de coquille statique, en production uniquement. */
export function ServiceWorker(){
 // Invite d'installation captée sur toutes les pages (elle n'est envoyée qu'une fois).
 useEffect(()=>{captureInstallPrompt();},[]);
 useEffect(()=>{
  if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
  void navigator.serviceWorker.register(withBase('/sw.js'),{scope:withBase('/')}).catch(()=>{/* PWA facultative */});
 },[]);
 return null;
}
