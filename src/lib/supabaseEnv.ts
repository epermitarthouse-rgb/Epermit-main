/**
 * Browser Supabase configuration from Vite environment variables.
 * No hardcoded fallbacks — missing values fail at startup.
 */

export type SupabaseBrowserEnv = {
  url: string;
  anonKey: string;
};

export type EnvRecord = Record<string, string | undefined>;

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Resolve the public anon/publishable key.
 * VITE_SUPABASE_ANON_KEY is canonical; VITE_SUPABASE_PUBLISHABLE_KEY is a legacy alias.
 */
export function resolveSupabaseAnonKey(env: EnvRecord): string {
  const anon = trim(env.VITE_SUPABASE_ANON_KEY);
  if (anon) return anon;
  return trim(env.VITE_SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Read and validate browser Supabase env. Throws if required values are missing.
 */
export function readSupabaseBrowserEnv(
  env: EnvRecord = import.meta.env as EnvRecord,
): SupabaseBrowserEnv {
  const url = trim(env.VITE_SUPABASE_URL);
  const anonKey = resolveSupabaseAnonKey(env);

  if (!url) {
    throw new Error(
      "Missing VITE_SUPABASE_URL. Set it in .env (local) or Vercel project settings (deployed).",
    );
  }

  if (!anonKey) {
    throw new Error(
      "Missing VITE_SUPABASE_ANON_KEY (or legacy VITE_SUPABASE_PUBLISHABLE_KEY). Set it in .env or Vercel project settings.",
    );
  }

  if (/service_role/i.test(anonKey)) {
    throw new Error(
      "Invalid Supabase browser key: service-role credentials must not be used in frontend code.",
    );
  }

  return { url, anonKey };
}

/** Headers for calling Supabase Edge Functions from the browser. */
export function getSupabaseFunctionHeaders(
  env: EnvRecord = import.meta.env as EnvRecord,
): Record<string, string> {
  const { anonKey } = readSupabaseBrowserEnv(env);
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}
