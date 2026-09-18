import {
  FEATURE_FLAG,
  isFeatureEnabled,
  type FeatureFlagKey,
} from '@/lib/featureFlags';

/** Route prefixes and exact paths gated by module feature flags. */
export const MODULE_FLAG_ROUTES: Readonly<
  Record<FeatureFlagKey, readonly { kind: 'exact' | 'prefix'; path: string }[]>
> = {
  [FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO]: [],
  [FEATURE_FLAG.MODULE_DESIGN_CHECK]: [{ kind: 'exact', path: '/designcheck' }],
  [FEATURE_FLAG.MODULE_CODE_ANALYZER]: [{ kind: 'exact', path: '/code-compliance' }],
  [FEATURE_FLAG.MODULE_UTILITY_COORDINATION]: [{ kind: 'prefix', path: '/uci' }],
  [FEATURE_FLAG.MODULE_JURISDICTION_MAP]: [
    { kind: 'exact', path: '/jurisdictions/map' },
    { kind: 'prefix', path: '/jurisdictions/' },
  ],
  [FEATURE_FLAG.MODULE_PROVIDER_COMPARE]: [
    { kind: 'exact', path: '/jurisdictions/compare' },
    { kind: 'exact', path: '/jurisdiction-comparison' },
  ],
  [FEATURE_FLAG.MODULE_PERMIT_INTELLIGENCE]: [{ kind: 'exact', path: '/permit-intelligence' }],
  [FEATURE_FLAG.MODULE_PERMIT_FILING]: [{ kind: 'prefix', path: '/permit-wizard-filing' }],
  [FEATURE_FLAG.MODULE_RESPONSE_MATRIX]: [
    { kind: 'exact', path: '/response-matrix' },
    { kind: 'exact', path: '/comment-review' },
    { kind: 'exact', path: '/classified-comments' },
  ],
  [FEATURE_FLAG.MODULE_PORTAL_HARVEST]: [{ kind: 'exact', path: '/portal-data' }],
  [FEATURE_FLAG.MODULE_OPERATIONS_BOARD]: [{ kind: 'exact', path: '/operations' }],
  [FEATURE_FLAG.MODULE_DEMO]: [
    { kind: 'exact', path: '/demo' },
    { kind: 'exact', path: '/demo/mcdonalds' },
    { kind: 'exact', path: '/demo/mcd' },
  ],
};

/** Nav hrefs excluded from jurisdiction_map prefix (handled by other flags). */
const JURISDICTION_MAP_EXCLUDED = new Set([
  '/jurisdictions/map',
  '/jurisdictions/compare',
]);

/** Ordered module flags for first-match resolution (specific before broad). */
const MODULE_FLAG_RESOLUTION_ORDER: FeatureFlagKey[] = [
  FEATURE_FLAG.MODULE_DEMO,
  FEATURE_FLAG.MODULE_PERMIT_FILING,
  FEATURE_FLAG.MODULE_RESPONSE_MATRIX,
  FEATURE_FLAG.MODULE_PORTAL_HARVEST,
  FEATURE_FLAG.MODULE_OPERATIONS_BOARD,
  FEATURE_FLAG.MODULE_DESIGN_CHECK,
  FEATURE_FLAG.MODULE_CODE_ANALYZER,
  FEATURE_FLAG.MODULE_UTILITY_COORDINATION,
  FEATURE_FLAG.MODULE_PROVIDER_COMPARE,
  FEATURE_FLAG.MODULE_JURISDICTION_MAP,
  FEATURE_FLAG.MODULE_PERMIT_INTELLIGENCE,
];

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return pathname;
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

function pathMatchesRule(pathname: string, rule: { kind: 'exact' | 'prefix'; path: string }): boolean {
  if (rule.kind === 'exact') {
    return pathname === rule.path;
  }
  return pathname === rule.path || pathname.startsWith(`${rule.path}/`);
}

function pathMatchesFlag(pathname: string, flag: FeatureFlagKey): boolean {
  const rules = MODULE_FLAG_ROUTES[flag];
  if (!rules.length) return false;

  if (flag === FEATURE_FLAG.MODULE_JURISDICTION_MAP) {
    if (pathname === '/jurisdictions/map') return true;
    if (!pathname.startsWith('/jurisdictions/')) return false;
    if (JURISDICTION_MAP_EXCLUDED.has(pathname)) return false;
    // State landing: /jurisdictions/:stateCode (single segment after prefix)
    const rest = pathname.slice('/jurisdictions/'.length);
    return rest.length > 0 && !rest.includes('/');
  }

  return rules.some((rule) => pathMatchesRule(pathname, rule));
}

/** Returns the module flag key gating a pathname, or null if ungated. */
export function getModuleFlagForPath(pathname: string): FeatureFlagKey | null {
  const normalized = normalizePathname(pathname);
  for (const flag of MODULE_FLAG_RESOLUTION_ORDER) {
    if (pathMatchesFlag(normalized, flag)) return flag;
  }
  return null;
}

/** Nav/command href → module flag (query strings stripped). */
export function getModuleFlagForHref(href: string): FeatureFlagKey | null {
  const path = href.split('?')[0] ?? href;
  if (path.startsWith('/uci')) {
    return FEATURE_FLAG.MODULE_UTILITY_COORDINATION;
  }
  return getModuleFlagForPath(path);
}

export function isModuleRouteEnabled(
  pathname: string,
  flags: Record<string, boolean>,
): boolean {
  const flag = getModuleFlagForPath(pathname);
  if (!flag) return true;
  return isFeatureEnabled(flags, flag);
}

export function isModuleHrefVisible(
  href: string,
  flags: Record<string, boolean>,
): boolean {
  const flag = getModuleFlagForHref(href);
  if (!flag) return true;
  return isFeatureEnabled(flags, flag);
}
