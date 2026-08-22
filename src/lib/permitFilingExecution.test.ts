import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PERMIT_FILING_EXECUTION_ENABLED,
  PERMIT_FILING_PREFLIGHT_ENABLED,
} from '../components/permit-wizard/permitFilingWip.ts';
import {
  describeExecutionOutcome,
  parseExecutionInvokeResult,
} from './permitFilingExecution.ts';

describe('permitFilingWip capability gates', () => {
  it('enables Pre-Flight and execution for the full client workflow', () => {
    assert.equal(PERMIT_FILING_PREFLIGHT_ENABLED, true);
    assert.equal(PERMIT_FILING_EXECUTION_ENABLED, true);
  });
});

describe('permitFilingExecution outcomes', () => {
  it('surfaces human intervention for captcha/MFA', () => {
    const outcome = describeExecutionOutcome({
      status: 'failed',
      requires_human_intervention: true,
      error: 'Captcha detected during login',
      current_step: 'authentication',
    });
    assert.equal(outcome.tone, 'warning');
    assert.match(outcome.title, /Human intervention/i);
  });

  it('reports submission success only with confirmation data', () => {
    const outcome = describeExecutionOutcome({
      status: 'submitted',
      submission_completed: true,
      confirmation_number: 'ABC-123',
    });
    assert.equal(outcome.tone, 'success');
    assert.match(outcome.detail, /ABC-123/);
  });

  it('parses invoke payloads', () => {
    const parsed = parseExecutionInvokeResult({ status: 'failed', current_step: 'form_filing' });
    assert.equal(parsed?.current_step, 'form_filing');
  });
});

describe('scraper execution route synchronization', () => {
  const routesPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../scraper-service/app/register-execution-routes.js',
  );

  it('awaits file/submit automation before returning success', () => {
    const source = readFileSync(routesPath, 'utf8');
    assert.match(source, /const result = await permitWizardFile\(/);
    assert.match(source, /const result = await permitWizardSubmit\(/);
    assert.match(source, /const result = await filePromise/);
    assert.match(source, /const result = await submitPromise/);
    assert.doesNotMatch(source, /message: "Form filing started"/);
    assert.doesNotMatch(source, /message: "Submission finalization started"/);
  });
});
