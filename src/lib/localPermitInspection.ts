import { FEATURE_FLAG, type FeatureFlagKey } from '@/lib/featureFlags';

/**
 * Local read-only inspection of the production permit repository (D-052).
 * Opens `module.central_permits` in this browser only, without touching the production flag (A-6).
 * All three conditions are required, so a deployed build cannot turn it on:
 *  - a Vite dev server or dev-mode build (`import.meta.env.DEV`),
 *  - `VITE_LOCAL_PERMIT_INSPECTION=read-only` in the environment that started Vite,
 *  - the page is served from a loopback host.
 * While it is on, every permit-repository write RPC is refused in the client (see centralPermits.ts).
 * Data access is unchanged: RLS still decides what the signed-in user can read.
 */

export const LOCAL_PERMIT_INSPECTION_VALUE = 'read-only';

type InspectionEnv = { DEV?: boolean; VITE_LOCAL_PERMIT_INSPECTION?: string } | undefined;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// `import.meta.env.DEV` is replaced with `false` in production builds, so this compiles to `undefined`.
function viteEnv(): InspectionEnv {
  try {
    return import.meta.env.DEV
      ? { DEV: true, VITE_LOCAL_PERMIT_INSPECTION: import.meta.env.VITE_LOCAL_PERMIT_INSPECTION as string | undefined }
      : undefined;
  } catch {
    return undefined;
  }
}

function currentHostname(): string {
  return typeof window !== 'undefined' && window.location ? window.location.hostname : '';
}

export function isLocalPermitInspection(env: InspectionEnv = viteEnv(), hostname: string = currentHostname()): boolean {
  return (
    env?.DEV === true &&
    env?.VITE_LOCAL_PERMIT_INSPECTION === LOCAL_PERMIT_INSPECTION_VALUE &&
    LOOPBACK_HOSTS.has(hostname)
  );
}

export function applyLocalInspectionFlags<T extends Record<FeatureFlagKey, boolean>>(flags: T, active = isLocalPermitInspection()): T {
  if (!active) return flags;
  return { ...flags, [FEATURE_FLAG.MODULE_CENTRAL_PERMITS]: true };
}

export function assertPermitWritesAllowed(action: string, active = isLocalPermitInspection()): void {
  if (active) {
    throw new Error(`${action}: disabled in local read-only inspection`);
  }
}
