import { createClient } from "@supabase/supabase-js";
import { readSupabaseBrowserEnv } from "@/lib/supabaseEnv";

const { url, anonKey } = readSupabaseBrowserEnv();

export const supabase = createClient(url, anonKey);
