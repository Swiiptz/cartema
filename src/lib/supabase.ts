import {createClient,type SupabaseClient} from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client:SupabaseClient|null=null;

/** Client navigateur (clé anon, publique). null tant que le projet n'est pas configuré. */
export function getSupabase():SupabaseClient|null{
 if(!url||!anonKey||typeof window==='undefined')return null;
 return client??=createClient(url,anonKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
}
export const supabaseConfigured=Boolean(url&&anonKey);
