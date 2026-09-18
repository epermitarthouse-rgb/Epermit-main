import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsvLine,
  parseJurisdictionCsv,
  jurisdictionCsvRowKey,
  csvRowsToRpcPayload,
} from './jurisdictionCsvParser';

describe('jurisdictionCsvParser', () => {
  it('parseCsvLine handles quoted commas', () => {
    assert.deepEqual(parseCsvLine('CA,"Los Angeles, City",12345'), [
      'CA',
      'Los Angeles, City',
      '12345',
    ]);
  });

  it('parseCsvLine handles escaped quotes', () => {
    assert.deepEqual(parseCsvLine('"City ""North""",TX,10'), ['City "North"', 'TX', '10']);
  });

  it('parseJurisdictionCsv parses valid rows and reports row errors', () => {
    const csv = [
      'state,place_name,fips_place,total_units,sf_1unit_units,duplex_units,mf_3plus_units',
      'CA,"Los Angeles, City",12345,5000,2000,200,2800',
      ',Missing State,,,,',
      'TEX,Bad State,,,,',
    ].join('\n');

    const result = parseJurisdictionCsv(csv);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].place_name, 'Los Angeles, City');
    assert.equal(result.rows[0].state, 'CA');
    assert.equal(result.rows[0].total_units, 5000);
    assert.ok(result.errors.length >= 2);
  });

  it('jurisdictionCsvRowKey normalizes case for dedup keys', () => {
    assert.equal(
      jurisdictionCsvRowKey({ place_name: 'Houston', state: 'TX' }),
      jurisdictionCsvRowKey({ place_name: 'houston', state: 'tx' }),
    );
  });

  it('csvRowsToRpcPayload maps parser rows to RPC payload', () => {
    const payload = csvRowsToRpcPayload([
      {
        state: 'TX',
        place_name: 'Houston',
        fips_place: '999',
        total_units: 100,
        sf_1unit_units: 50,
        duplex_units: 10,
        mf_3plus_units: 40,
        lineNumber: 2,
      },
    ]);

    assert.deepEqual(payload[0], {
      state: 'TX',
      place_name: 'Houston',
      fips_place: '999',
      total_units: 100,
      sf_1unit_units: 50,
      duplex_units: 10,
      mf_3plus_units: 40,
    });
  });
});
