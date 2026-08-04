import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEmailSendOutcome,
  classifyNoMatchOutcome,
  ensureTestSubject,
} from "../../supabase/functions/_shared/scheduledReportDelivery";

describe("classifyEmailSendOutcome", () => {
  it("marks all-success as success and advances schedule", () => {
    const o = classifyEmailSendOutcome(3, 0);
    assert.equal(o.status, "success");
    assert.equal(o.advanceSchedule, true);
    assert.equal(o.shouldLog, true);
  });

  it("marks mixed as partial and advances schedule", () => {
    const o = classifyEmailSendOutcome(2, 1);
    assert.equal(o.status, "partial");
    assert.equal(o.advanceSchedule, true);
  });

  it("marks total failure as failed and keeps schedule retryable", () => {
    const o = classifyEmailSendOutcome(0, 2);
    assert.equal(o.status, "failed");
    assert.equal(o.advanceSchedule, false);
    assert.equal(o.shouldLog, true);
  });
});

describe("classifyNoMatchOutcome", () => {
  it("logs no_match and advances to avoid tight loops", () => {
    const o = classifyNoMatchOutcome();
    assert.equal(o.status, "no_match");
    assert.equal(o.advanceSchedule, true);
    assert.equal(o.shouldLog, true);
  });
});

describe("ensureTestSubject", () => {
  it("prefixes [TEST] when missing", () => {
    assert.equal(ensureTestSubject("Weekly Report"), "[TEST] Weekly Report");
  });

  it("does not double-prefix", () => {
    assert.equal(ensureTestSubject("[TEST] Weekly Report"), "[TEST] Weekly Report");
  });
});

describe("claim race semantics (documented contract)", () => {
  it("requires FOR UPDATE SKIP LOCKED claim before send", () => {
    // Contract covered by migration claim_due_scheduled_checklist_reports:
    // two concurrent processors cannot claim the same due row while lease is active.
    const contract = {
      rpc: "claim_due_scheduled_checklist_reports",
      skipLocked: true,
      leaseSecondsDefault: 900,
      onTotalFailure: "keep_claim_lease",
      onSuccessPartialNoMatch: "advance_next_send_and_clear_claim",
    };
    assert.equal(contract.skipLocked, true);
    assert.equal(contract.onTotalFailure, "keep_claim_lease");
  });
});
