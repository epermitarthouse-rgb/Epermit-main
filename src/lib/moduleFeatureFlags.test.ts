import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_FLAG,
  DEFAULT_FEATURE_FLAG_VALUES,
  KNOWN_FEATURE_FLAG_KEYS,
  isFeatureEnabled,
} from './featureFlags';
import {
  getModuleFlagForPath,
  getModuleFlagForHref,
  isModuleRouteEnabled,
  isModuleHrefVisible,
  MODULE_FLAG_ROUTES,
  moduleFlagOffRendersPage,
} from './moduleFeatureFlags';

const __dirname = dirname(fileURLToPath(import.meta.url));

const moduleMigrationSql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260918220000_module_feature_flags.sql'),
  'utf8',
);
const appSidebarSource = readFileSync(
  join(__dirname, '../components/layout/AppSidebar.tsx'),
  'utf8',
);
const commandPaletteSource = readFileSync(
  join(__dirname, '../components/navigation/CommandPalette.tsx'),
  'utf8',
);
const protectedRouteSource = readFileSync(
  join(__dirname, '../components/auth/ProtectedRoute.tsx'),
  'utf8',
);
const moduleFlagGateSource = readFileSync(
  join(__dirname, '../components/auth/ModuleFlagGate.tsx'),
  'utf8',
);
const governanceSource = readFileSync(
  join(__dirname, './governanceConstants.ts'),
  'utf8',
);

/** Explicit all-OFF map for gating tests (independent of ON defaults). */
const allOffFlags = Object.fromEntries(
  KNOWN_FEATURE_FLAG_KEYS.map((k) => [k, false]),
) as Record<(typeof KNOWN_FEATURE_FLAG_KEYS)[number], boolean>;

function flagsWith(key: keyof typeof FEATURE_FLAG, enabled: boolean) {
  return {
    ...DEFAULT_FEATURE_FLAG_VALUES,
    [FEATURE_FLAG[key]]: enabled,
  };
}

describe('module feature flag allowlist', () => {
  it('registers 14 known flags (1 homepage + 13 modules)', () => {
    assert.equal(KNOWN_FEATURE_FLAG_KEYS.length, 14);
    assert.equal(Object.keys(DEFAULT_FEATURE_FLAG_VALUES).length, 14);
  });

  it('defaults existing module flags ON; homepage demo video and Permit Repository OFF', () => {
    assert.equal(DEFAULT_FEATURE_FLAG_VALUES[FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO], false);
    assert.equal(DEFAULT_FEATURE_FLAG_VALUES[FEATURE_FLAG.MODULE_CENTRAL_PERMITS], false);
    for (const key of KNOWN_FEATURE_FLAG_KEYS) {
      if (key === FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO || key === FEATURE_FLAG.MODULE_CENTRAL_PERMITS) continue;
      assert.equal(DEFAULT_FEATURE_FLAG_VALUES[key], true);
    }
  });

  it('gates /permit-queue, /permits and /admin/permit-sync behind central permits without touching nearby routes', () => {
    assert.equal(getModuleFlagForPath('/permit-queue'), FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
    assert.equal(getModuleFlagForPath('/permit-queue/abc'), FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
    assert.equal(getModuleFlagForPath('/permits'), FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
    assert.equal(getModuleFlagForPath('/permits/abc'), FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
    assert.equal(getModuleFlagForPath('/admin/permit-sync'), FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
    assert.equal(getModuleFlagForPath('/permit-intelligence'), FEATURE_FLAG.MODULE_PERMIT_INTELLIGENCE);
    assert.equal(getModuleFlagForPath('/permit-queuex'), null);
    assert.equal(getModuleFlagForPath('/baltimore/permits'), null);
    assert.equal(getModuleFlagForPath('/admin'), null);
    assert.equal(isModuleRouteEnabled('/permits', DEFAULT_FEATURE_FLAG_VALUES), false);
    assert.equal(isModuleHrefVisible('/permit-queue', DEFAULT_FEATURE_FLAG_VALUES), false);
    assert.equal(isModuleHrefVisible('/permit-queue', flagsWith('MODULE_CENTRAL_PERMITS', true)), true);
  });

  it('with the flag OFF only /permit-queue renders its own page (the placeholder); other gated routes redirect', () => {
    assert.equal(moduleFlagOffRendersPage('/permit-queue'), true);
    assert.equal(moduleFlagOffRendersPage('/permit-queue/'), true);
    assert.equal(moduleFlagOffRendersPage('/permit-queue/abc'), true);
    assert.equal(moduleFlagOffRendersPage('/permits'), false);
    assert.equal(moduleFlagOffRendersPage('/admin/permit-sync'), false);
    assert.equal(moduleFlagOffRendersPage('/designcheck'), false);
    assert.match(moduleFlagGateSource, /moduleFlagOffRendersPage\(location\.pathname\)\) return children/);
  });

  it('migration seeds 11 module flags default ON', () => {
    assert.match(moduleMigrationSql, /module\.design_check/);
    assert.match(moduleMigrationSql, /module\.demo/);
    assert.match(moduleMigrationSql, /category.*Modules/s);
    assert.equal((moduleMigrationSql.match(/'module\./g) ?? []).length, 11);
    assert.match(moduleMigrationSql, /'module\.design_check',\s*\n\s*true,/);
  });

  it('v2 flag migration stays on and does not disable Code Analyzer', () => {
    const v2Migration = readFileSync(
      join(__dirname, '../../supabase/migrations/20261022120000_code_analyzer_v2_flag_and_analysis_mode.sql'),
      'utf8',
    );
    assert.match(v2Migration, /'module\.code_analyzer_v2',\s*\n\s*true,/);
    assert.match(v2Migration, /analysis_mode IS NULL/);
    assert.doesNotMatch(v2Migration, /SET\s+enabled\s*=\s*false/i);
    assert.equal(DEFAULT_FEATURE_FLAG_VALUES[FEATURE_FLAG.MODULE_CODE_ANALYZER_V2], true);
    assert.equal(DEFAULT_FEATURE_FLAG_VALUES[FEATURE_FLAG.MODULE_CODE_ANALYZER], true);
  });
});

describe('getModuleFlagForPath route mapping', () => {
  const cases: Array<[string, keyof typeof FEATURE_FLAG | null]> = [
    ['/designcheck', 'MODULE_DESIGN_CHECK'],
    ['/code-analyzer', 'MODULE_CODE_ANALYZER'],
    ['/code-compliance', 'MODULE_CODE_ANALYZER_V2'],
    ['/uci', 'MODULE_UTILITY_COORDINATION'],
    ['/uci/inbox', 'MODULE_UTILITY_COORDINATION'],
    ['/uci/portal-harvest', 'MODULE_UTILITY_COORDINATION'],
    ['/uci/application-builder', 'MODULE_UTILITY_COORDINATION'],
    ['/jurisdictions/map', 'MODULE_JURISDICTION_MAP'],
    ['/jurisdictions/md', 'MODULE_JURISDICTION_MAP'],
    ['/jurisdictions/compare', 'MODULE_PROVIDER_COMPARE'],
    ['/jurisdiction-comparison', 'MODULE_PROVIDER_COMPARE'],
    ['/permit-intelligence', 'MODULE_PERMIT_INTELLIGENCE'],
    ['/permit-wizard-filing', 'MODULE_PERMIT_FILING'],
    ['/permit-wizard-filing/review/abc-123', 'MODULE_PERMIT_FILING'],
    ['/response-matrix', 'MODULE_RESPONSE_MATRIX'],
    ['/comment-review', 'MODULE_RESPONSE_MATRIX'],
    ['/classified-comments', 'MODULE_RESPONSE_MATRIX'],
    ['/portal-data', 'MODULE_PORTAL_HARVEST'],
    ['/operations', 'MODULE_OPERATIONS_BOARD'],
    ['/demo', 'MODULE_DEMO'],
    ['/demo/mcdonalds', 'MODULE_DEMO'],
    ['/demo/mcd', 'MODULE_DEMO'],
    ['/dashboard', null],
    ['/projects', null],
    ['/admin', null],
    ['/admin/feature-flags', null],
    ['/demos', null],
    ['/onboarding/authorization', null],
    ['/settings', null],
    ['/code-reference', null],
  ];

  for (const [path, expectedKey] of cases) {
    it(`maps ${path} → ${expectedKey ?? 'ungated'}`, () => {
      const flag = getModuleFlagForPath(path);
      if (expectedKey === null) {
        assert.equal(flag, null);
      } else {
        assert.equal(flag, FEATURE_FLAG[expectedKey]);
      }
    });
  }
});

describe('isModuleRouteEnabled', () => {
  it('blocks gated routes when flag OFF', () => {
    assert.equal(isModuleRouteEnabled('/designcheck', allOffFlags), false);
    assert.equal(isModuleRouteEnabled('/uci/inbox', allOffFlags), false);
    assert.equal(isModuleRouteEnabled('/portal-data', allOffFlags), false);
  });

  it('allows gated routes when flag ON', () => {
    const flags = flagsWith('MODULE_DESIGN_CHECK', true);
    assert.equal(isModuleRouteEnabled('/designcheck', flags), true);
  });

  it('leaves ungated routes accessible regardless of flags', () => {
    assert.equal(isModuleRouteEnabled('/dashboard', allOffFlags), true);
    assert.equal(isModuleRouteEnabled('/demos', allOffFlags), true);
    assert.equal(isModuleRouteEnabled('/projects/new', allOffFlags), true);
  });

  it('portal harvest is separate from UCI portal harvest path', () => {
    assert.equal(
      getModuleFlagForPath('/portal-data'),
      FEATURE_FLAG.MODULE_PORTAL_HARVEST,
    );
    assert.equal(
      getModuleFlagForPath('/uci/portal-harvest'),
      FEATURE_FLAG.MODULE_UTILITY_COORDINATION,
    );
  });
});

describe('getModuleFlagForHref nav helper', () => {
  it('treats all /uci hrefs as utility coordination', () => {
    assert.equal(
      getModuleFlagForHref('/uci?section=load-profile'),
      FEATURE_FLAG.MODULE_UTILITY_COORDINATION,
    );
  });
});

describe('nav visibility wiring (source assertions)', () => {
  it('AppSidebar filters hybridNav by module flags', () => {
    assert.match(appSidebarSource, /isModuleHrefVisible/);
    assert.match(appSidebarSource, /useFeatureFlags/);
    assert.match(appSidebarSource, /navVisible/);
  });

  it('CommandPalette filters palette items by module flags', () => {
    assert.match(commandPaletteSource, /isModuleHrefVisible/);
    assert.match(commandPaletteSource, /useFeatureFlags/);
  });

  it('ProtectedLayoutRoute wraps outlet with ModuleFlagGate', () => {
    assert.match(protectedRouteSource, /ModuleFlagGate/);
    assert.match(moduleFlagGateSource, /Navigate to="\/dashboard"/);
    assert.match(moduleFlagGateSource, /getModuleFlagForPath/);
  });

  it('ModuleFlagGate recovers from an unsettled feature-flag request', () => {
    assert.match(moduleFlagGateSource, /isError/);
    assert.match(moduleFlagGateSource, /refetch/);
    assert.match(moduleFlagGateSource, /This module could not be opened/);
    assert.doesNotMatch(moduleFlagGateSource, /isError \? children/);
  });

  it('ModuleFlagGate does not replace governance permissions', () => {
    assert.match(moduleFlagGateSource, /governance permissions remain/);
    assert.match(governanceSource, /user_feature_permissions/);
    assert.doesNotMatch(moduleFlagGateSource, /user_feature_permissions/);
    assert.doesNotMatch(moduleFlagGateSource, /FEATURE_KEYS/);
  });
});

describe('isModuleHrefVisible', () => {
  it('hides nav href when module flag OFF', () => {
    assert.equal(isModuleHrefVisible('/designcheck', allOffFlags), false);
    assert.equal(isModuleHrefVisible('/demos', allOffFlags), true);
  });

  it('shows nav href when module flag ON', () => {
    const flags = flagsWith('MODULE_CODE_ANALYZER', true);
    assert.equal(isModuleHrefVisible('/code-analyzer', flags), true);
    assert.equal(isModuleHrefVisible('/code-compliance', flags), true);
    assert.equal(
      isFeatureEnabled(flags, FEATURE_FLAG.MODULE_CODE_ANALYZER),
      true,
    );
  });

  it('hides Code Analyzer and Code Analyzer V2 independently', () => {
    const analyzerOnly = {
      ...DEFAULT_FEATURE_FLAG_VALUES,
      [FEATURE_FLAG.MODULE_CODE_ANALYZER]: true,
      [FEATURE_FLAG.MODULE_CODE_ANALYZER_V2]: false,
    };
    assert.equal(getModuleFlagForPath('/code-analyzer'), FEATURE_FLAG.MODULE_CODE_ANALYZER);
    assert.equal(getModuleFlagForPath('/code-compliance'), FEATURE_FLAG.MODULE_CODE_ANALYZER_V2);
    assert.equal(isModuleHrefVisible('/code-analyzer', analyzerOnly), true);
    assert.equal(isModuleRouteEnabled('/code-compliance', analyzerOnly), false);
    assert.equal(isModuleHrefVisible('/code-compliance', analyzerOnly), false);

    const v2Only = {
      ...DEFAULT_FEATURE_FLAG_VALUES,
      [FEATURE_FLAG.MODULE_CODE_ANALYZER]: false,
      [FEATURE_FLAG.MODULE_CODE_ANALYZER_V2]: true,
    };
    assert.equal(isModuleRouteEnabled('/code-analyzer', v2Only), false);
    assert.equal(isModuleHrefVisible('/code-compliance', v2Only), true);
  });
});

describe('MODULE_FLAG_ROUTES completeness', () => {
  it('every module flag has route rules except homepage', () => {
    const moduleFlags = KNOWN_FEATURE_FLAG_KEYS.filter(
      (k) => k !== FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO,
    );
    for (const flag of moduleFlags) {
      assert.ok(
        MODULE_FLAG_ROUTES[flag].length > 0,
        `expected routes for ${flag}`,
      );
    }
  });
});
