import { createClient } from '@supabase/supabase-js';

// SINGLE SOURCE OF TRUTH
// Hardcoded for immediate Vercel deployment stability
export const SUPABASE_URL = "https://eeqxyjrcldivtpikcpvk.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlcXh5anJjbGRpdnRwaWtjcHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NzM3ODAsImV4cCI6MjA4NDE0OTc4MH0.yPtoSOuQGB5UU-fLbcy1Lp8dNF2IHOeQas9kushTrV0";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase Keys Missing!");

/** Stable id for auth/insert audits — login and CRUD must share this module. */
export const SUPABASE_CLIENT_ID = 'src/lib/supabase.ts#singleton' as const;

/** Default GoTrue storage key for this project ref (localStorage). */
export const SUPABASE_AUTH_STORAGE_KEY = 'sb-eeqxyjrcldivtpikcpvk-auth-token';

export function decodeJwtClaims(accessToken: string): { sub: string | null; role: string | null } {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return { sub: null, role: null };
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { sub?: string; role?: string };
    return { sub: claims.sub ?? null, role: claims.role ?? null };
  } catch {
    return { sub: null, role: null };
  }
}

export function readSupabaseAuthStorageSnapshot(): {
  key: string;
  present: boolean;
  accessTokenPresent: boolean;
  userId: string | null;
  jwtSub: string | null;
  jwtRole: string | null;
  expiresAt: number | null;
} {
  const empty = {
    key: SUPABASE_AUTH_STORAGE_KEY,
    present: false,
    accessTokenPresent: false,
    userId: null as string | null,
    jwtSub: null as string | null,
    jwtRole: null as string | null,
    expiresAt: null as number | null,
  };

  if (typeof window === 'undefined') return empty;

  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return empty;

    const parsed = JSON.parse(raw) as {
      access_token?: string;
      user?: { id?: string };
      expires_at?: number;
      currentSession?: {
        access_token?: string;
        user?: { id?: string };
        expires_at?: number;
      };
    };

    const accessToken = parsed.access_token ?? parsed.currentSession?.access_token ?? null;
    const userId = parsed.user?.id ?? parsed.currentSession?.user?.id ?? null;
    const expiresAt = parsed.expires_at ?? parsed.currentSession?.expires_at ?? null;
    const claims = accessToken ? decodeJwtClaims(accessToken) : { sub: null, role: null };

    return {
      key: SUPABASE_AUTH_STORAGE_KEY,
      present: true,
      accessTokenPresent: Boolean(accessToken),
      userId,
      jwtSub: claims.sub,
      jwtRole: claims.role,
      expiresAt,
    };
  } catch {
    return { ...empty, present: true };
  }
}

/**
 * Runs after supabase-js fetchWithAuth attaches Authorization.
 * Proves whether projects INSERT uses the user JWT or falls back to the anon key.
 * Does not modify headers or body.
 */
const instrumentedFetch: typeof fetch = async (input, init) => {
  try {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = String(init?.method || 'GET').toUpperCase();

    if (url.includes('/rest/v1/projects') && method === 'POST') {
      const headers = new Headers(init?.headers);
      const authorization = headers.get('Authorization');
      const token = authorization?.replace(/^Bearer\s+/i, '') ?? null;
      const authorizationIsAnonKey = token === SUPABASE_ANON_KEY;
      const claims =
        token && !authorizationIsAnonKey
          ? decodeJwtClaims(token)
          : { sub: null, role: authorizationIsAnonKey ? 'anon' : null };
      const storage = readSupabaseAuthStorageSnapshot();

      console.info('[supabase:rest:projects-insert]', {
        url,
        method,
        authorizationAttached: Boolean(authorization),
        authorizationScheme: authorization?.startsWith('Bearer ')
          ? 'Bearer'
          : authorization
            ? 'other'
            : null,
        authorizationIsAnonKey,
        jwtSub: claims.sub,
        jwtRole: claims.role,
        storage,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        clientModule: SUPABASE_CLIENT_ID,
      });
    }
  } catch (err) {
    console.warn('[supabase:rest:projects-insert] probe failed', err);
  }

  return fetch(input, init);
};

/**
 * App-wide Supabase singleton — same URL/anon key as main.
 * Only difference vs main: read-only fetch probe for projects INSERT auth headers.
 * Auth options use library defaults (identical to bare createClient on main).
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: {
    fetch: instrumentedFetch,
  },
});
