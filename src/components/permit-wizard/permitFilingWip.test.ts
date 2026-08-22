import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMIT_FILING_BETA_LABEL,
  PERMIT_FILING_EXECUTION_ENABLED,
  PERMIT_FILING_PREFLIGHT_ENABLED,
  PERMIT_FILING_WIP,
} from './permitFilingWip.ts';

describe('permitFilingWip capability gates', () => {
  it('enables Pre-Flight start and full execution workflow', () => {
    assert.equal(PERMIT_FILING_PREFLIGHT_ENABLED, true);
    assert.equal(PERMIT_FILING_EXECUTION_ENABLED, true);
    assert.equal(PERMIT_FILING_WIP, false);
  });

  it('uses Pre-Flight Beta labeling', () => {
    assert.equal(PERMIT_FILING_BETA_LABEL, 'Pre-Flight Beta');
  });
});
