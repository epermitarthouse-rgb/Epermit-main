import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSubscriptionJurisdictionId,
  shouldSyncSubscriptionDenorm,
  isForeignKeyViolation,
  isMissingRpcError,
  subscriptionBlockMessage,
} from './jurisdictionSubscriptionIntegrity';

describe('jurisdictionSubscriptionIntegrity', () => {
  it('validates UUID subscription ids', () => {
    assert.equal(
      isValidSubscriptionJurisdictionId('550e8400-e29b-41d4-a716-446655440000'),
      true,
    );
    assert.equal(isValidSubscriptionJurisdictionId('not-a-uuid'), false);
    assert.equal(isValidSubscriptionJurisdictionId(''), false);
  });

  it('detects when denormalized subscription fields should sync', () => {
    assert.equal(
      shouldSyncSubscriptionDenorm({ name: 'Austin', state: 'TX' }, { name: 'Austin City' }),
      true,
    );
    assert.equal(
      shouldSyncSubscriptionDenorm({ name: 'Austin', state: 'TX' }, { state: 'TX' }),
      false,
    );
  });

  it('detects foreign key violation errors', () => {
    assert.equal(isForeignKeyViolation({ code: '23503' }), true);
    assert.equal(isForeignKeyViolation({ code: 'PGRST116' }), false);
  });

  it('detects missing RPC function errors', () => {
    assert.equal(
      isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' }),
      true,
    );
    assert.equal(isMissingRpcError({ code: '42501', message: 'permission denied' }), false);
  });

  it('formats subscription block messages', () => {
    assert.match(subscriptionBlockMessage(1), /1 active subscriber/);
    assert.match(subscriptionBlockMessage(3), /3 active subscribers/);
  });
});
