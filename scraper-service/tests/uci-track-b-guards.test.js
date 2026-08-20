"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  canEnterStage7,
  canEnterStage8,
  canEnterStage9,
  canEnterStage10,
  canCompleteStage7,
  canCompleteStage8,
  canCompleteStage9,
  canCompleteStage10,
  isProjectUtilityCoordinationComplete,
  assertStage7to10Transition,
  stage9CompletedForCloseout,
  canGenerateCloseoutPdf,
} = require("../app/services/uci/uci-lifecycle-guards.service.js");

const settledCost = {
  id: "c1",
  actual_amount: 1000,
  client_approval_status: "approved",
  paid_at: "2026-08-10T00:00:00.000Z",
  client_billed_at: "2026-08-11T00:00:00.000Z",
  quickbooks_invoice_id: "QB-1",
};

describe("Track B guards", () => {
  it("keeps canEnterStage7 as Stage 6 COMPLETED + COS issued", () => {
    assert.equal(
      canEnterStage7({
        current_stage: 6,
        current_stage_state: "COMPLETED",
        class_of_service_issued_at: "2026-08-01",
      }),
      true,
    );
    assert.equal(
      canEnterStage7({
        current_stage: 6,
        current_stage_state: "IN_PROGRESS",
        class_of_service_issued_at: "2026-08-01",
      }),
      false,
    );
  });

  it("canCompleteStage7 requires approved paid internally billed costs; QB sync optional", () => {
    assert.equal(canCompleteStage7({}, [settledCost]), true);
    assert.equal(canCompleteStage7({}, []), false);
    assert.equal(
      canCompleteStage7({}, [{ ...settledCost, billing_hold: true, human_override_bill_at: null, client_billed_at: null }]),
      false,
    );
    assert.equal(
      canCompleteStage7({}, [
        {
          ...settledCost,
          quickbooks_invoice_id: null,
          qb_sync_status: "failed",
          qb_last_error: "[QB_SUBSCRIPTION_INACTIVE] subscription ended",
        },
      ]),
      true,
    );
    assert.equal(
      canCompleteStage7({}, [{ ...settledCost, quickbooks_invoice_id: null, client_billed_at: null, qb_sync_status: "retry" }]),
      false,
    );
  });

  it("stage7BlockReasons surfaces QB failure only after internal client invoice exists", () => {
    const { stage7BlockReasons } = require("../app/services/uci/uci-lifecycle-guards.service.js");
    const { BLOCKED_REASON_CODES } = require("../app/services/uci/uci-lifecycle-constants.js");
    const reasons = stage7BlockReasons([
      {
        id: "c1",
        actual_amount: 1150,
        client_approval_status: "approved",
        paid_at: "2026-08-10T00:00:00.000Z",
        client_billed_at: "2026-08-11T00:00:00.000Z",
        qb_sync_status: "retry",
      },
    ]);
    assert.ok(reasons.includes(BLOCKED_REASON_CODES.COST_QB_FAILED));
    assert.ok(!reasons.includes(BLOCKED_REASON_CODES.COST_APPROVAL_PENDING));

    const pendingInternal = stage7BlockReasons([
      {
        id: "c1",
        actual_amount: 1150,
        client_approval_status: "approved",
        paid_at: "2026-08-10T00:00:00.000Z",
        qb_sync_status: "retry",
      },
    ]);
    assert.ok(!pendingInternal.includes(BLOCKED_REASON_CODES.COST_QB_FAILED));
  });

  it("canEnterStage8 requires Stage 7 COMPLETED and settled costs", () => {
    assert.equal(
      canEnterStage8({ current_stage: 7, current_stage_state: "COMPLETED" }, [settledCost]),
      true,
    );
    assert.equal(
      canEnterStage8({ current_stage: 7, current_stage_state: "IN_PROGRESS" }, [settledCost]),
      false,
    );
  });

  it("canCompleteStage8 does not require installed", () => {
    const pending = {
      status: "pending",
      current_eta: "2026-09-01",
      last_check_in_at: "2026-08-20T00:00:00.000Z",
    };
    assert.equal(canCompleteStage8({}, [pending]), true);
    assert.equal(canCompleteStage8({}, [{ status: "on_order", current_eta: "2026-09-01" }]), true);
    assert.equal(canCompleteStage8({}, [{ status: "installed" }]), true);
    assert.equal(canCompleteStage8({}, [{ status: "pending", current_eta: "2026-09-01" }]), false);
  });

  it("canEnterStage9 allows entry without inspection release (explicit entry stays IN_PROGRESS)", () => {
    const record = { current_stage: 8, current_stage_state: "COMPLETED" };
    const equipment = [{ status: "on_order", current_eta: "2026-09-01" }];
    assert.equal(canEnterStage9(record, equipment), true);
  });

  it("canCompleteStage9 requires release, scheduled date, site readiness, meter_set milestone", () => {
    const record = {
      inspection_release_received_at: "2026-08-20",
      meter_set_scheduled_at: "2026-08-25",
      site_readiness_confirmed_at: "2026-08-24",
    };
    assert.equal(
      canCompleteStage9(record, [{ milestone_type: "meter_set", status: "scheduled" }]),
      true,
    );
    assert.equal(
      canCompleteStage9(record, [{ milestone_type: "meter_set_scheduled", status: "scheduled" }]),
      false,
    );
  });

  it("canEnterStage10 requires Stage 9 COMPLETED and Stage 9 predicates", () => {
    const record = {
      current_stage: 9,
      current_stage_state: "COMPLETED",
      inspection_release_received_at: "2026-08-20",
      meter_set_scheduled_at: "2026-08-25",
      site_readiness_confirmed_at: "2026-08-24",
    };
    assert.equal(
      canEnterStage10(record, [{ milestone_type: "meter_set", status: "completed" }]),
      true,
    );
  });

  it("closeout PDF requires Stage 9 COMPLETED or Stage 10+", () => {
    assert.equal(
      stage9CompletedForCloseout({ current_stage: 8, current_stage_state: "COMPLETED" }),
      false,
    );
    assert.equal(
      stage9CompletedForCloseout({ current_stage: 9, current_stage_state: "IN_PROGRESS" }),
      false,
    );
    assert.equal(
      stage9CompletedForCloseout({ current_stage: 9, current_stage_state: "COMPLETED" }),
      true,
    );
    assert.equal(
      canGenerateCloseoutPdf({ current_stage: 10, current_stage_state: "IN_PROGRESS" }),
      true,
    );
  });

  it("canCompleteStage10 hard-blocks missing artifacts or date conflict", () => {
    const ready = {
      energization_actual_date: "2026-09-01",
      energization_date_conflict: false,
      closeout_package_doc_id: "doc-1",
      metadata: {
        closeout_artifacts: {
          utility_confirmation: { doc_id: "u" },
          final_meter_reading: { doc_id: "m" },
          commissioning_signoff: { doc_id: "c" },
        },
      },
    };
    const costs = [{ id: "c1", paid_at: "2026-08-10", payment_method: "check" }];
    assert.equal(canCompleteStage10(ready, costs), true);
    assert.equal(canCompleteStage10({ ...ready, energization_date_conflict: true }, costs), false);
    assert.equal(canCompleteStage10({ ...ready, closeout_package_doc_id: null }, costs), false);
  });

  it("project complete is 2-of-2 not 1-of-2", () => {
    const a = { current_stage: 10, current_stage_state: "COMPLETED" };
    const b = { current_stage: 9, current_stage_state: "IN_PROGRESS" };
    assert.equal(isProjectUtilityCoordinationComplete([a]), true);
    assert.equal(isProjectUtilityCoordinationComplete([a, b]), false);
    assert.equal(
      isProjectUtilityCoordinationComplete([a, { current_stage: 10, current_stage_state: "COMPLETED" }]),
      true,
    );
  });

  it("blocks skipping Stage 7–10", () => {
    assert.throws(
      () =>
        assertStage7to10Transition(
          { current_stage: 6, current_stage_state: "COMPLETED", class_of_service_issued_at: "x" },
          8,
          "IN_PROGRESS",
          { costs: [settledCost] },
        ),
      /Cannot skip/,
    );
  });
});
