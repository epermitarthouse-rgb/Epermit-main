import { supabase } from '@/lib/supabase';

/** Known server-backed product visibility flags (allowlist). */
export const FEATURE_FLAG = {
  HOMEPAGE_SHOW_DEMO_VIDEO: 'homepage.show_demo_video',
  MODULE_DESIGN_CHECK: 'module.design_check',
  MODULE_CODE_ANALYZER: 'module.code_analyzer',
  MODULE_UTILITY_COORDINATION: 'module.utility_coordination',
  MODULE_JURISDICTION_MAP: 'module.jurisdiction_map',
  MODULE_PROVIDER_COMPARE: 'module.provider_compare',
  MODULE_PERMIT_INTELLIGENCE: 'module.permit_intelligence',
  MODULE_PERMIT_FILING: 'module.permit_filing',
  MODULE_RESPONSE_MATRIX: 'module.response_matrix',
  MODULE_PORTAL_HARVEST: 'module.portal_harvest',
  MODULE_OPERATIONS_BOARD: 'module.operations_board',
  MODULE_DEMO: 'module.demo',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG)[keyof typeof FEATURE_FLAG];

export const KNOWN_FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = Object.values(FEATURE_FLAG);

export interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  label: string;
  description: string | null;
  category: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface SetFeatureFlagResult {
  key: string;
  enabled: boolean;
  changed: boolean;
  updated_at?: string;
  updated_by?: string;
}

export const DEFAULT_FEATURE_FLAG_VALUES: Record<FeatureFlagKey, boolean> = {
  [FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO]: false,
  [FEATURE_FLAG.MODULE_DESIGN_CHECK]: true,
  [FEATURE_FLAG.MODULE_CODE_ANALYZER]: true,
  [FEATURE_FLAG.MODULE_UTILITY_COORDINATION]: true,
  [FEATURE_FLAG.MODULE_JURISDICTION_MAP]: true,
  [FEATURE_FLAG.MODULE_PROVIDER_COMPARE]: true,
  [FEATURE_FLAG.MODULE_PERMIT_INTELLIGENCE]: true,
  [FEATURE_FLAG.MODULE_PERMIT_FILING]: true,
  [FEATURE_FLAG.MODULE_RESPONSE_MATRIX]: true,
  [FEATURE_FLAG.MODULE_PORTAL_HARVEST]: true,
  [FEATURE_FLAG.MODULE_OPERATIONS_BOARD]: true,
  [FEATURE_FLAG.MODULE_DEMO]: true,
};

/** Friendly admin UI metadata — no internal keys shown in the panel. */
export const flagUiConfig: Record<
  FeatureFlagKey,
  { label: string; description: string; category: string }
> = {
  [FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO]: {
    label: 'Platform Demo Video',
    description: 'Show the interactive platform demo video on the homepage',
    category: 'Homepage',
  },
  [FEATURE_FLAG.MODULE_DESIGN_CHECK]: {
    label: 'DesignCheck',
    description: 'Pre-submittal readiness overview',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_CODE_ANALYZER]: {
    label: 'Code Analyzer',
    description: 'AI-powered code compliance analysis',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_UTILITY_COORDINATION]: {
    label: 'Utility Coordination',
    description: 'UCI workspace and all utility coordination routes',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_JURISDICTION_MAP]: {
    label: 'Jurisdiction Map',
    description: 'Interactive coverage map and state landing pages',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_PROVIDER_COMPARE]: {
    label: 'Provider Compare',
    description: 'Side-by-side jurisdiction comparison',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_PERMIT_INTELLIGENCE]: {
    label: 'Permit Intelligence',
    description: 'Search and explore permit data',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_PERMIT_FILING]: {
    label: 'Permit Filing',
    description: 'Multi-municipality permit filing wizard',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_RESPONSE_MATRIX]: {
    label: 'Response Matrix',
    description: 'Comment responses, review, and classified comments',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_PORTAL_HARVEST]: {
    label: 'Portal Harvest',
    description: 'Gather and view portal data',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_OPERATIONS_BOARD]: {
    label: 'Operations Board',
    description: 'Reimbursables, scope, and PM workflow',
    category: 'Modules',
  },
  [FEATURE_FLAG.MODULE_DEMO]: {
    label: 'Executive Demo',
    description: 'McDonald\'s executive demo experience',
    category: 'Modules',
  },
};

/** Deprecated localStorage key — no longer authoritative after Phase 2. */
export const LEGACY_FEATURE_FLAGS_STORAGE_KEY = 'permitpulse_feature_flags';

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

let rpcClientOverride: RpcClient | null = null;

export const __featureFlagsTestHooks = {
  setRpcClientOverride(client: RpcClient | null) {
    rpcClientOverride = client;
  },
};

function getRpcClient(): RpcClient {
  return rpcClientOverride ?? supabase;
}

export function flagMapFromRows(rows: FeatureFlagRow[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const row of rows) {
    map[row.key] = row.enabled;
  }
  return map;
}

export function mergeWithDefaults(
  rows: FeatureFlagRow[] | null | undefined,
): Record<FeatureFlagKey, boolean> {
  const merged = { ...DEFAULT_FEATURE_FLAG_VALUES };
  if (!rows?.length) return merged;
  for (const row of rows) {
    if (isKnownFeatureFlagKey(row.key)) {
      merged[row.key] = row.enabled;
    }
  }
  return merged;
}

export function isKnownFeatureFlagKey(key: string): key is FeatureFlagKey {
  return (KNOWN_FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}

export function isFeatureEnabled(
  flags: Record<string, boolean>,
  key: FeatureFlagKey,
): boolean {
  return flags[key] ?? DEFAULT_FEATURE_FLAG_VALUES[key] ?? false;
}

export function isAdminRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '');
  return message.includes('Admin access required');
}

export function isUnknownFlagError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '');
  return message.includes('Unknown feature flag key');
}

export function isMissingFeatureFlagsRpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '');
  const code = String((error as { code?: string }).code ?? '');
  return (
    code === 'PGRST202' ||
    message.includes('Could not find the function') ||
    message.includes('function public.get_feature_flags') ||
    message.includes('function public.set_feature_flag')
  );
}

export async function fetchFeatureFlags(): Promise<FeatureFlagRow[]> {
  const { data, error } = await getRpcClient().rpc('get_feature_flags');
  if (error) {
    throw new Error(error.message ?? 'Failed to fetch feature flags');
  }
  return (data as FeatureFlagRow[]) ?? [];
}

export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
): Promise<SetFeatureFlagResult> {
  if (!isKnownFeatureFlagKey(key)) {
    throw new Error(`Unknown feature flag key: ${key}`);
  }

  const { data, error } = await getRpcClient().rpc('set_feature_flag', {
    p_key: key,
    p_enabled: enabled,
  });
  if (error) {
    throw new Error(error.message ?? 'Failed to set feature flag');
  }
  return data as SetFeatureFlagResult;
}

/** Read deprecated localStorage value once (for migration messaging only). */
export function readLegacyShowDemoVideo(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LEGACY_FEATURE_FLAGS_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { showDemoVideo?: boolean };
    return typeof parsed.showDemoVideo === 'boolean' ? parsed.showDemoVideo : null;
  } catch {
    return null;
  }
}

export function clearLegacyFeatureFlagsStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_FEATURE_FLAGS_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
