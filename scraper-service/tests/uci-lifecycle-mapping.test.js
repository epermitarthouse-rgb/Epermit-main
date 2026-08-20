"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateProposalGuards,
  selectPrimaryProposal,
  processLifecycleMappingAfterSync,
  buildProposalFromAdapter,
} = require("../app/services/uci/uci-lifecycle-mapping.service.js");
const {
  mapPortalStatusToLifecycle,
  pepcoAdapter,
} = require("../app/services/uci/adapters/pepco.adapter.js");
const { genericReadonlyAdapter } = require("../app/services/uci/adapters/generic-readonly.adapter.js");

const SAMPLE_APP = {
  applicationUuid: "11111111-2222-3333-4444-555555555555",
  overview: {
    projectName: "Wonder - Tenant Fit Out",
    jobId: "PEPCO-NB-0064620",
    statusName: "Contract Sent",
    actionRequired: true,
  },
  currentStatus: "Contract Sent",
  currentMilestone: "Engineering and Design",
  statusChanges: [
    {
      milestoneName: "Initiation",
      statusName: "Submitted",
      statusChangeDateTime: "2026-03-03T14:53:38.6592192+00:00",
    },
  ],
};

const CONTEXT = {
  coordinationRecordId: "coord-1",
  projectId: "proj-1",
  tenantId: null,
  providerSlug: "pepco",
  syncedAt: "2026-07-08T00:00:00.000Z",
};

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createLifecycleMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null, insertRow: null };

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            const copy = {
              ...state.insertRow,
              id: `${table}-${store.length + 1}`,
            };
            store.push(copy);
            return Promise.resolve({ data: copy, error: null });
          }
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        then(resolve, reject) {
          if (state.mode === "update") {
            const row = store.find((r) =>
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            if (row && state.updatePatch) Object.assign(row, state.updatePatch);
            return Promise.resolve({ error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: store, error: null }).then(resolve, reject);
        },
      };

      return api;
    },
  };
}

describe("UCI D1C PEPCO lifecycle mapping", () => {
  it("maps Contract Sent with action required to stage 7 BLOCKED", () => {
    const proposal = mapPortalStatusToLifecycle("Contract Sent", {
      action_required: true,
      portal_submitted_at: "2026-03-03T14:53:38.6592192+00:00",
      raw: SAMPLE_APP,
    });
    assert.ok(proposal);
    assert.equal(proposal.proposed_stage, 7);
    assert.equal(proposal.proposed_state, "BLOCKED");
    assert.equal(proposal.automatic_transition_allowed, true);
  });

  it("maps In Design to stage 6 AWAITING_UTILITY", () => {
    const proposal = mapPortalStatusToLifecycle("In Design", {
      action_required: false,
      portal_submitted_at: "2026-03-03T14:53:38.6592192+00:00",
      raw: SAMPLE_APP,
    });
    assert.ok(proposal);
    assert.equal(proposal.proposed_stage, 6);
    assert.equal(proposal.proposed_state, "AWAITING_UTILITY");
  });

  it("blocks Submitted without submission evidence from auto-apply", () => {
    const proposal = mapPortalStatusToLifecycle("Submitted", {
      action_required: false,
      portal_submitted_at: null,
      raw: { currentStatus: "Submitted" },
    });
    assert.ok(proposal);
    assert.equal(proposal.proposed_stage, 4);
    assert.equal(proposal.automatic_transition_allowed, false);
  });

  it("allows Submitted with status history evidence", () => {
    const proposal = mapPortalStatusToLifecycle("Submitted", {
      action_required: false,
      portal_submitted_at: "2026-03-03T14:53:38.6592192+00:00",
      raw: SAMPLE_APP,
    });
    assert.ok(proposal);
    assert.equal(proposal.automatic_transition_allowed, true);
  });

  it("returns null for unknown portal statuses", () => {
    const proposal = mapPortalStatusToLifecycle("Unknown Status", {
      action_required: false,
      raw: SAMPLE_APP,
    });
    assert.equal(proposal, null);
  });
});

describe("UCI D1C lifecycle guard rules", () => {
  it("blocks backward transitions", () => {
    const blocked = evaluateProposalGuards(7, {
      proposed_stage: 6,
      proposed_state: "AWAITING_UTILITY",
      confidence: "high",
      reason: "test",
      source_status: "In Design",
      automatic_transition_allowed: true,
    });
    assert.equal(blocked, "Backward lifecycle transitions are not allowed.");
  });

  it("blocks stage 10 proposals", () => {
    const blocked = evaluateProposalGuards(9, {
      proposed_stage: 10,
      proposed_state: "COMPLETED",
      confidence: "high",
      reason: "test",
      source_status: "Energized",
      automatic_transition_allowed: true,
    });
    assert.equal(blocked, "Stage 10 requires explicit energization confirmation.");
  });

  it("blocks stage 4 when submission is not confirmed", () => {
    const blocked = evaluateProposalGuards(3, {
      proposed_stage: 4,
      proposed_state: "AWAITING_UTILITY",
      confidence: "low",
      reason: "test",
      source_status: "Submitted",
      automatic_transition_allowed: false,
    });
    assert.equal(blocked, "Stage 4 requires confirmed portal submission.");
  });

  it("selects highest forward eligible proposal", () => {
    const primary = selectPrimaryProposal([
      {
        external_application_id: "a",
        provider_slug: "pepco",
        proposal: {
          proposed_stage: 6,
          proposed_state: "AWAITING_UTILITY",
          confidence: "medium",
          reason: "design",
          source_status: "In Design",
          automatic_transition_allowed: true,
        },
        blocked_reason: null,
      },
      {
        external_application_id: "b",
        provider_slug: "pepco",
        proposal: {
          proposed_stage: 7,
          proposed_state: "BLOCKED",
          confidence: "high",
          reason: "contract",
          source_status: "Contract Sent",
          automatic_transition_allowed: true,
        },
        blocked_reason: null,
      },
    ]);
    assert.ok(primary);
    assert.equal(primary.proposal.proposed_stage, 7);
  });
});

describe("UCI D1C lifecycle mapping after sync", () => {
  /** @type {string | undefined} */
  let prevAutoFlag;

  beforeEach(() => {
    prevAutoFlag = process.env.UCI_AUTO_STAGE_TRANSITIONS;
    delete process.env.UCI_AUTO_STAGE_TRANSITIONS;
  });

  afterEach(() => {
    if (prevAutoFlag === undefined) delete process.env.UCI_AUTO_STAGE_TRANSITIONS;
    else process.env.UCI_AUTO_STAGE_TRANSITIONS = prevAutoFlag;
  });

  it("persists lifecycle proposals in coordination metadata", async () => {
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 5,
          current_stage_state: "AWAITING_UTILITY",
          metadata: { existing: true },
        },
      ],
    };
    const supabase = createLifecycleMockSupabase(tables);
    const normalized = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    assert.ok(normalized);

    const result = await processLifecycleMappingAfterSync(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      providerSlug: "pepco",
      adapter: pepcoAdapter,
      rawApplications: [SAMPLE_APP],
      normalizedApplications: [normalized],
      coordinationRecord: tables.coordination_records[0],
    });

    assert.equal(result.status, "proposed");
    assert.equal(result.evaluated_count, 1);
    assert.equal(result.applied_count, 0);
    assert.equal(result.auto_apply_enabled, false);
    assert.equal(result.proposals[0].proposed_stage, 7);
    assert.equal(result.proposals[0].blocked_reason, null);

    const meta = /** @type {{ metadata?: Record<string, unknown> }} */ (
      tables.coordination_records[0]
    ).metadata;
    const payload = /** @type {{ proposals?: unknown[] }} */ (meta?.uci_lifecycle_proposals);
    assert.ok(payload);
    assert.equal(Array.isArray(payload.proposals) ? payload.proposals.length : 0, 1);
    assert.equal(meta?.existing, true);
  });

  it("auto-applies primary proposal when flag enabled", async () => {
    process.env.UCI_AUTO_STAGE_TRANSITIONS = "true";
    const tables = {
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          current_stage: 6,
          current_stage_state: "COMPLETED",
          class_of_service_issued_at: "2026-08-01T00:00:00.000Z",
          metadata: {},
        },
      ],
      coordination_stage_transitions: [],
      coordination_costs: [],
      coordination_equipment: [],
      coordination_milestones: [],
    };
    const supabase = createLifecycleMockSupabase(tables);
    const normalized = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    assert.ok(normalized);

    const result = await processLifecycleMappingAfterSync(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      providerSlug: "pepco",
      adapter: pepcoAdapter,
      rawApplications: [SAMPLE_APP],
      normalizedApplications: [normalized],
      coordinationRecord: tables.coordination_records[0],
    });

    assert.equal(result.status, "applied");
    assert.equal(result.applied_count, 1);
    assert.equal(tables.coordination_records[0].current_stage, 7);
    assert.equal(tables.coordination_records[0].current_stage_state, "BLOCKED");
    assert.equal(tables.coordination_stage_transitions.length, 1);
    assert.equal(tables.coordination_stage_transitions[0].triggered_by_type, "system");
  });

  it("generic adapter produces no proposals", () => {
    const proposal = buildProposalFromAdapter(
      genericReadonlyAdapter,
      { currentStatus: "Submitted" },
      {
        external_application_id: "x",
        portal_status: "Submitted",
        action_required: false,
      },
    );
    assert.equal(proposal, null);
  });
});
