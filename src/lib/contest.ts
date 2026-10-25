/** Règles du concours d'illustrations : texte par défaut et lecture des règles écrites par l'admin. */

export type RuleItem={title:string;text:string};

/** Règles par défaut, hors dates et récompenses (calculées à part). `before` précède les récompenses, `after` les suit. */
export function defaultContestRules(edition:string,allowMythic=false,mythicMult=4):{before:RuleItem[];after:RuleItem[]}{
 return {
  before:[
   {title:'Les cartes.',text:`Toutes les cartes de l’édition ${edition}, ${allowMythic?'Mythiques comprises (sauf la carte unique)':'sauf les Mythiques'}. Une carte que vous n’avez pas découverte apparaît neutre (nom et clan seulement) : vous pouvez quand même la dessiner.`},
   ...(allowMythic?[{title:`Mythiques ×${mythicMult}.`,text:`Ce sont les cartes les plus prestigieuses du jeu : être en tête des votes ou voir son dessin retenu y rapporte ${mythicMult} points. Le dessin doit être à la hauteur de leur rang : il doit faire mythique.`}]:[]),
   {title:'Format.',text:'Dessin vertical, idéalement 900 × 1350 px. Le visage et l’essentiel dans les deux tiers du haut : le bas de la carte porte le nom du personnage.'},
   {title:'Vos dessins.',text:'Un dessin par carte et par joueur, fait par vous. Vous pouvez le remplacer tant que le concours est ouvert, mais ses votes repartent alors à zéro. Pseudonyme obligatoire.'},
   {title:'Les votes.',text:'Un vote par carte : choisissez votre dessin préféré, changez d’avis quand vous voulez. On ne vote pas pour son propre dessin.'},
   {title:'Les points.',text:'Pour chaque carte, l’auteur du dessin le plus voté gagne 1 point ; à égalité, celui qui a atteint ce nombre de votes en premier le garde. Si un autre dessin passe devant, le point change de main.'},
   {title:'Après la clôture.',text:'L’équipe choisit les dessins retenus (illustration officielle ou version alternative) : +1 point par dessin retenu, et +1 point de plus pour un vrai dessin soigné. Les votes guident ce choix sans le décider.'},
   {title:'Dessin retenu.',text:`Son auteur reçoit la carte avec son illustration. En illustration officielle : en Sanglante jusqu’aux Très rares, en Dorée pour une Épique, en Standard pour une Légendaire${allowMythic?' ou une Mythique':''}. En version alternative (pleine illustration) : en contour classique. C’est un exemplaire de l’artiste : ni vendu, ni échangé, ni offert pendant 30 jours.`},
  ],
  after:[
   {title:'Podium.',text:'Les 3 premiers gagnent le titre « Illustrateur de génie ». Le 1er crée une carte de son choix dans l’édition Éternelle (ETER) et en reçoit un exemplaire ; les cartes éternelles ne tombent que dans les God boosters et certains boosters.'},
   {title:'Respect.',text:'Pas de dessin copié, généré par IA, choquant ou moqueur. Un dessin signalé peut être masqué : il perd alors ses votes. Les illustrations retenues peuvent être utilisées dans le jeu, avec votre nom en crédit.'},
  ],
 };
}

/** Règles par défaut en texte, pour partir d'une base dans l'admin (une règle par ligne). */
export function defaultContestRulesText(edition:string,allowMythic=false){
 const {before,after}=defaultContestRules(edition,allowMythic);
 return [...before,...after].map(r=>`- ${r.title} ${r.text}`).join('\n');
}

/** Découpe les règles de l'admin : une ligne « - … » est une règle (« Titre. » en tête mis en valeur), les autres sont des paragraphes. */
export function parseContestRules(rules:string):({kind:'rule';item:RuleItem}|{kind:'text';text:string})[]{
 return rules.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{
  const m=/^[-•*]\s*(.*)$/.exec(l);
  if(!m)return {kind:'text' as const,text:l};
  const t=/^([^.!?:]{1,40}[.:])\s+(.*)$/.exec(m[1]);
  return {kind:'rule' as const,item:t?{title:t[1],text:t[2]}:{title:'',text:m[1]}};
 });
}
