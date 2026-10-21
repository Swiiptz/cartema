'use client';
// Installation de l'application (PWA). Chrome / Android envoie « beforeinstallprompt » une seule
// fois, souvent avant l'affichage de l'accueil : l'événement est donc capté dès le chargement
// (voir ServiceWorker) et gardé ici. Safari iOS n'a pas d'invite : on y explique le geste.
type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};

let deferred:InstallEvent|null=null;
let installed=false;
let captured=false;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(l=>l());

export function captureInstallPrompt(){
 if(typeof window==='undefined'||captured)return;
 captured=true;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e as InstallEvent;emit();});
 window.addEventListener('appinstalled',()=>{installed=true;deferred=null;emit();});
}

export function subscribeInstall(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}

/** Déjà lancée comme application (écran d'accueil) ? */
export function isStandalone(){
 return installed||window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}
export function isPhone(){return /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent)||window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;}
export function isIos(){return /iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}
export const canPrompt=()=>deferred!==null;

/** Ouvre l'invite native ; renvoie true si l'utilisateur a accepté. */
export async function promptInstall(){
 if(!deferred)return false;
 const e=deferred;deferred=null;
 await e.prompt();
 const {outcome}=await e.userChoice;
 if(outcome==='accepted')installed=true;
 emit();
 return outcome==='accepted';
}
