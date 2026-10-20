// Export statique pour GitHub Pages : aucun code serveur Next.js.
// NEXT_PUBLIC_BASE_PATH vaut "/<nom-du-dépôt>" sur Pages, vide en local.
const basePath=process.env.NEXT_PUBLIC_BASE_PATH||'';
export default {output:'export',basePath,trailingSlash:true,images:{unoptimized:true},env:{NEXT_PUBLIC_BASE_PATH:basePath}};
