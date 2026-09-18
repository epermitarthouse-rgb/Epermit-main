import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const managerSource = readFileSync(join(__dirname, 'JurisdictionManager.tsx'), 'utf8');
const formSource = readFileSync(join(__dirname, 'JurisdictionFormDialog.tsx'), 'utf8');
const csvSource = readFileSync(join(__dirname, 'JurisdictionCsvImportDialog.tsx'), 'utf8');
const adminSource = readFileSync(
  join(__dirname, '../../pages/JurisdictionAdmin.tsx'),
  'utf8',
);

describe('JurisdictionManager verification and delete safety', () => {
  it('shows verified and unverified states in the table', () => {
    assert.match(managerSource, /isJurisdictionVerified/);
    assert.match(managerSource, /Verified/);
    assert.match(managerSource, /Unverified/);
    assert.match(managerSource, /last_verified_at/);
  });

  it('does not use as any casts for volume fields', () => {
    assert.doesNotMatch(managerSource, /as any/);
    assert.match(managerSource, /jurisdiction\.is_high_volume/);
    assert.match(managerSource, /jurisdiction\.residential_units_2024/);
  });

  it('offers deactivate when subscriptions block delete', () => {
    assert.match(managerSource, /getSubscriptionCount/);
    assert.match(managerSource, /deactivateJurisdiction/);
    assert.match(managerSource, /hasBlockingSubscriptions/);
    assert.match(managerSource, /subscriptionBlockMessage/);
  });
});

describe('JurisdictionFormDialog completeness', () => {
  it('includes commercial/volume and portal fields', () => {
    assert.match(formSource, /commercial_permits_2024/);
    assert.match(formSource, /total_permits_2024/);
    assert.match(formSource, /permit_portal_url/);
    assert.match(formSource, /avg_review_days_actual/);
    assert.match(formSource, /fips_place/);
  });
});

describe('CSV import uses parser and RPC', () => {
  it('does not load entire jurisdictions table for dedup', () => {
    assert.match(csvSource, /parseJurisdictionCsv/);
    assert.match(csvSource, /bulk_upsert_jurisdiction_volume/);
    assert.doesNotMatch(csvSource, /\.select\('name, state'\)/);
  });

  it('supports skip and upsert modes', () => {
    assert.match(csvSource, /skip_existing/);
    assert.match(csvSource, /upsert_volume/);
  });
});

describe('JurisdictionAdmin coverage workflow', () => {
  it('integrates coverage requests tab and prefill flow', () => {
    assert.match(adminSource, /CoverageRequestsPanel/);
    assert.match(adminSource, /Coverage Requests/);
    assert.match(adminSource, /handleAddFromCoverage/);
    assert.match(adminSource, /formPrefill/);
  });
});
