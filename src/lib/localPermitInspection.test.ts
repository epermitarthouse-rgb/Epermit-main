import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FEATURE_FLAG_VALUES, FEATURE_FLAG } from './featureFlags';
import {
  LOCAL_PERMIT_INSPECTION_VALUE,
  applyLocalInspectionFlags,
  assertPermitWritesAllowed,
  isLocalPermitInspection,
} from './localPermitInspection';

const DEV_ON = { DEV: true, VITE_LOCAL_PERMIT_INSPECTION: LOCAL_PERMIT_INSPECTION_VALUE };

describe('local read-only permit inspection', () => {
  it('needs a dev build, the env value and a loopback host, all three', () => {
    assert.equal(isLocalPermitInspection(DEV_ON, 'localhost'), true);
    assert.equal(isLocalPermitInspection(DEV_ON, '127.0.0.1'), true);
    assert.equal(isLocalPermitInspection({ ...DEV_ON, DEV: false }, 'localhost'), false, 'production build');
    assert.equal(isLocalPermitInspection({ DEV: true }, 'localhost'), false, 'env not set');
    assert.equal(isLocalPermitInspection({ ...DEV_ON, VITE_LOCAL_PERMIT_INSPECTION: 'true' }, 'localhost'), false, 'wrong value');
    assert.equal(isLocalPermitInspection(DEV_ON, 'app.permitpilot.com'), false, 'deployed host');
    assert.equal(isLocalPermitInspection(DEV_ON, 'localhost.evil.test'), false);
    assert.equal(isLocalPermitInspection(undefined, 'localhost'), false);
  });

  it('is off under node tests (no Vite env)', () => {
    assert.equal(isLocalPermitInspection(), false);
  });

  it('opens only module.central_permits and leaves other flags alone', () => {
    const flags = { ...DEFAULT_FEATURE_FLAG_VALUES, [FEATURE_FLAG.MODULE_DEMO]: false };
    assert.equal(applyLocalInspectionFlags(flags, false), flags);
    const on = applyLocalInspectionFlags(flags, true);
    assert.equal(on[FEATURE_FLAG.MODULE_CENTRAL_PERMITS], true);
    assert.equal(on[FEATURE_FLAG.MODULE_DEMO], false);
    assert.equal(flags[FEATURE_FLAG.MODULE_CENTRAL_PERMITS], false, 'input not mutated');
  });

  it('refuses writes while active', () => {
    assert.throws(() => assertPermitWritesAllowed('admin_request_permit_sync', true), /disabled in local read-only inspection/);
    assert.doesNotThrow(() => assertPermitWritesAllowed('admin_request_permit_sync', false));
  });
});
