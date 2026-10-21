'use client';
import {useEffect,useState} from 'react';
import {Download,EllipsisVertical,Share,SquarePlus,X} from 'lucide-react';
import {canPrompt,isIos,isPhone,isStandalone,promptInstall,subscribeInstall} from '@/lib/install';

const DISMISS_KEY='cartema.install.dismissed';

/** Encart « Installer l'application », sur téléphone seulement et tant qu'elle n'est pas installée. */
export function InstallCard(){
 const [visible,setVisible]=useState(false);
 const [promptable,setPromptable]=useState(false);
 const [ios,setIos]=useState(false);
 const [help,setHelp]=useState(false);
 useEffect(()=>{
  let dismissed=false;
  try{dismissed=localStorage.getItem(DISMISS_KEY)==='1';}catch{/* stockage facultatif */}
  const sync=()=>{setVisible(!dismissed&&isPhone()&&!isStandalone());setPromptable(canPrompt());};
  setIos(isIos());sync();
  return subscribeInstall(sync);
 },[]);
 if(!visible)return null;
 const dismiss=()=>{setVisible(false);try{localStorage.setItem(DISMISS_KEY,'1');}catch{/* stockage facultatif */}};
 async function install(){if(promptable){await promptInstall();}else setHelp(h=>!h);}
 return <section className="install-card rise" aria-label="Installer l’application">
  <img className="install-icon" src={`${process.env.NEXT_PUBLIC_BASE_PATH??''}/icon-192.png`} alt="" width={44} height={44}/>
  <div className="install-copy"><strong>Cartema sur votre écran d’accueil</strong><span>Ouverture en plein écran, sans barre d’adresse.</span></div>
  <button className="primary compact" onClick={()=>void install()}><Download size={14}/> {promptable?'Installer':'Comment faire'}</button>
  <button className="icon-button install-close" aria-label="Ne plus proposer" onClick={dismiss}><X size={15}/></button>
  {help&&<ol className="install-steps">{ios?<>
   <li>Touchez <Share size={14} aria-label="Partager"/> <b>Partager</b> dans la barre de Safari.</li>
   <li>Choisissez <SquarePlus size={14} aria-hidden="true"/> <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.</li>
  </>:<>
   <li>Ouvrez le menu <EllipsisVertical size={14} aria-label="du navigateur"/> du navigateur.</li>
   <li>Choisissez <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.</li>
  </>}</ol>}
 </section>;
}
