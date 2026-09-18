import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rowToJurisdiction,
  jurisdictionToInsert,
  jurisdictionToUpdate,
  isJurisdictionVerified,
  createDefaultJurisdictionFormData,
} from '../types/jurisdiction';

describe('jurisdiction types and mappers', () => {
  it('rowToJurisdiction maps BPS/commercial columns', () => {
    const jurisdiction = rowToJurisdiction({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Houston',
      state: 'TX',
      city: 'Houston',
      county: 'Harris',
      fips_place: '12345',
      website_url: null,
      phone: null,
      email: null,
      address: null,
      reviewer_contacts: [],
      base_permit_fee: 100,
      plan_review_fee: 50,
      inspection_fee: 25,
      fee_notes: null,
      fee_schedule_url: null,
      plan_review_sla_days: 10,
      permit_issuance_sla_days: 5,
      inspection_sla_days: 2,
      avg_review_days_actual: 12,
      avg_issuance_days_actual: 6,
      expedited_available: false,
      expedited_fee_multiplier: 1.5,
      residential_units_2024: 1200,
      sf_1unit_units_2024: 800,
      duplex_units_2024: 100,
      mf_3plus_units_2024: 300,
      commercial_permits_2024: 400,
      total_permits_2024: 1600,
      is_high_volume: true,
      permit_portal_url: 'https://portal.example.com',
      data_source: 'manual_research',
      submission_methods: ['online'],
      accepted_file_formats: ['pdf'],
      special_requirements: null,
      notes: null,
      is_active: true,
      last_verified_at: '2026-01-01T00:00:00.000Z',
      verified_by: 'user-id',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    assert.equal(jurisdiction.commercial_permits_2024, 400);
    assert.equal(jurisdiction.permit_portal_url, 'https://portal.example.com');
    assert.equal(jurisdiction.is_high_volume, true);
    assert.equal(isJurisdictionVerified(jurisdiction), true);
  });

  it('jurisdictionToInsert computes is_high_volume from residential units', () => {
    const payload = jurisdictionToInsert(
      createDefaultJurisdictionFormData({
        name: 'Big City',
        state: 'CA',
        residential_units_2024: 1500,
      }),
    );

    assert.equal(payload.is_high_volume, true);
    assert.equal(payload.commercial_permits_2024, null);
  });

  it('jurisdictionToUpdate recomputes is_high_volume when residential units change', () => {
    const payload = jurisdictionToUpdate({ residential_units_2024: 10 });
    assert.equal(payload.is_high_volume, false);
  });
});
