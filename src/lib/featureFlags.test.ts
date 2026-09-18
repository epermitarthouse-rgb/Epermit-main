import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __featureFlagsTestHooks,
  FEATURE_FLAG,
  fetchFeatureFlags,
  flagMapFromRows,
  isAdminRequiredError,
  isFeatureEnabled,
  isKnownFeatureFlagKey,
  isUnknownFlagError,
  mergeWithDefaults,
  setFeatureFlag,
  type FeatureFlagRow,
} from './featureFlags';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, '../../supabase/migrations/20260918200000_feature_flags_platform_control.sql'),
  'utf8',
);
const productTourSource = readFileSync(
  join(__dirname, '../components/home/ProductTourSection.tsx'),
  'utf8',
);
const panelSource = readFileSync(
  join(__dirname, '../components/admin/FeatureFlagsPanel.tsx'),
  'utf8',
);

const sampleRows: FeatureFlagRow[] = [
  {
    key: FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO,
    enabled: true,
    label: 'Platform Demo Video',
    description: 'Show demo',
    category: 'Homepage',
    updated_at: '2026-09-18T12:00:00.000Z',
    updated_by: '550e8400-e29b-41d4-a716-446655440000',
  },
];

describe('featureFlags helpers', () => {
  it('fetch failure defaults OFF via mergeWithDefaults', () => {
    const flags = mergeWithDefaults(null);
    assert.equal(isFeatureEnabled(flags, FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO), false);
  });

  it('mergeWithDefaults applies server values for known keys', () => {
    const flags = mergeWithDefaults(sampleRows);
    assert.equal(isFeatureEnabled(flags, FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO), true);
  });

  it('flagMapFromRows builds key map', () => {
    const map = flagMapFromRows(sampleRows);
    assert.equal(map[FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO], true);
  });

  it('isKnownFeatureFlagKey validates allowlist', () => {
    assert.equal(isKnownFeatureFlagKey(FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO), true);
    assert.equal(isKnownFeatureFlagKey('unknown.flag'), false);
  });

  it('isAdminRequiredError detects admin guard', () => {
    assert.equal(isAdminRequiredError({ message: 'Admin access required' }), true);
    assert.equal(isAdminRequiredError({ message: 'permission denied' }), false);
  });

  it('isUnknownFlagError detects unknown key guard', () => {
    assert.equal(
      isUnknownFlagError({ message: 'Unknown feature flag key: foo.bar' }),
      true,
    );
    assert.equal(isUnknownFlagError({ message: 'Admin access required' }), false);
  });
});

describe('featureFlags RPC client', () => {
  let rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }>;

  beforeEach(() => {
    rpcCalls = [];
    __featureFlagsTestHooks.setRpcClientOverride({
      rpc: mock.fn(async (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === 'get_feature_flags') {
          return { data: sampleRows, error: null };
        }
        if (fn === 'set_feature_flag') {
          const key = String(args?.p_key ?? '');
          if (key === 'unknown.flag') {
            return {
              data: null,
              error: { message: 'Unknown feature flag key: unknown.flag' },
            };
          }
          if (args?.p_enabled === true && key === FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO) {
            return {
              data: {
                key,
                enabled: true,
                changed: true,
                updated_at: '2026-09-18T12:01:00.000Z',
                updated_by: 'admin-user-id',
              },
              error: null,
            };
          }
          return {
            data: { key, enabled: Boolean(args?.p_enabled), changed: true },
            error: null,
          };
        }
        return { data: null, error: { message: 'unexpected rpc' } };
      }),
    });
  });

  afterEach(() => {
    __featureFlagsTestHooks.setRpcClientOverride(null);
  });

  it('admin can toggle a known flag', async () => {
    const result = await setFeatureFlag(FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO, true);
    assert.equal(result.enabled, true);
    assert.equal(result.changed, true);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, 'set_feature_flag');
    assert.equal(rpcCalls[0].args?.p_key, FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO);
  });

  it('non-admin cannot toggle (RPC error)', async () => {
    __featureFlagsTestHooks.setRpcClientOverride({
      rpc: async () => ({
        data: null,
        error: { message: 'Admin access required' },
      }),
    });
    await assert.rejects(
      () => setFeatureFlag(FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO, true),
      /Admin access required/,
    );
  });

  it('change persists via fetch after toggle (mock)', async () => {
    await setFeatureFlag(FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO, true);
    const rows = await fetchFeatureFlags();
    assert.equal(rows[0].enabled, true);
  });

  it('unknown flag keys cannot be mutated client-side', async () => {
    await assert.rejects(
      () => setFeatureFlag('unknown.flag' as typeof FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO, true),
      /Unknown feature flag key: unknown.flag/,
    );
    assert.equal(rpcCalls.length, 0);
  });

  it('unknown flag keys rejected by RPC', async () => {
    __featureFlagsTestHooks.setRpcClientOverride({
      rpc: async () => ({
        data: null,
        error: { message: 'Unknown feature flag key: unknown.flag' },
      }),
    });
    await assert.rejects(
      () => setFeatureFlag(FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO, true),
      /Unknown feature flag key/,
    );
  });

  it('fetch failure defaults OFF when merge applied to empty', async () => {
    __featureFlagsTestHooks.setRpcClientOverride({
      rpc: async () => ({ data: null, error: { message: 'network error' } }),
    });
    await assert.rejects(() => fetchFeatureFlags());
    const flags = mergeWithDefaults(undefined);
    assert.equal(isFeatureEnabled(flags, FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO), false);
  });
});

describe('feature flag migration SQL audit', () => {
  it('creates audit table and inserts audit row in set_feature_flag', () => {
    assert.match(migrationSql, /CREATE TABLE public\.feature_flag_audit/);
    assert.match(migrationSql, /INSERT INTO public\.feature_flag_audit/);
    assert.match(migrationSql, /Unknown feature flag key/);
    assert.match(migrationSql, /homepage\.show_demo_video/);
  });

  it('grants anon read on get_feature_flags', () => {
    assert.match(migrationSql, /GRANT EXECUTE ON FUNCTION public\.get_feature_flags\(\) TO anon, authenticated/);
  });
});

describe('ProductTourSection visibility wiring', () => {
  it('uses homepage.show_demo_video server flag', () => {
    assert.match(productTourSource, /FEATURE_FLAG\.HOMEPAGE_SHOW_DEMO_VIDEO/);
    assert.match(productTourSource, /useFeatureFlag/);
    assert.match(productTourSource, /PlatformDemoVideo/);
    assert.doesNotMatch(productTourSource, /flags\.showDemoVideo/);
    assert.doesNotMatch(productTourSource, /localStorage/);
    assert.doesNotMatch(productTourSource, /permitpulse_feature_flags/);
  });
});

describe('FeatureFlagsPanel server-backed UI', () => {
  it('shows business-friendly labels without internal key badges', () => {
    assert.match(panelSource, /Platform Demo Video/);
    assert.match(panelSource, /Show the interactive platform demo video/);
    assert.match(panelSource, /Last updated/);
    assert.match(panelSource, /toggleFlag/);
    assert.match(panelSource, /localStorage/);
    assert.doesNotMatch(panelSource, /Product visibility controls/);
    assert.doesNotMatch(panelSource, /Access Control/);
    assert.doesNotMatch(panelSource, /Railway env vars/);
    assert.doesNotMatch(panelSource, /font-mono/);
  });
});
