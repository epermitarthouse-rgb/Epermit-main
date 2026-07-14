"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeLifecycleProposalChecksum,
  applyLifecycleProposal,
  rejectLifecycleProposal,
} = require("../app/services/uci/uci-lifecycle-proposal-actions.service.js");

const COORD_ID = "coord-lifecycle-actions";
const PROJECT_ID = "project-lifecycle-actions";
const USER_ID = "user-lifecycle-actions";

const baseProposal = {
  external_application_id: "app-123",
  provider_slug: "pepco",
  source_status: "In Design",
  proposed_stage: 5,
  proposed_state: "IN_PROGRESS",
  confidence: "high",
  reason: "Portal status maps to stage 5",
  automatic_transition_allowed: true,
  blocked_reason: null,
  applied: false,
  applied_at: null,
};

function makeRecord(overrides = {}) {
  const lastEvaluatedAt = "2026-07-14T12:00:00.000Z";
  return {
    id: COORD_ID,
    project_id: PROJECT_ID,
    current_stage: 4,
    current_stage_state: "IN_PROGRESS",
    metadata: {
      uci_lifecycle_proposals: {
        last_evaluated_at: lastEvaluatedAt,
        auto_apply_enabled: false,
        proposals: [baseProposal],
        applied_transition_id: null,
      },
    },
    ...overrides,
  };
}

function makeSupabase(record = makeRecord()) {
  let storedRecord = { ...record };
  const transitions = [];

  return {
    from(table) {
      if (table === "coordination_records") {
        const chain = {
          _table: "coordination_records",
          _filters: {},
          select() {
            return chain;
          },
          update(patch) {
            return {
              eq(_col, id) {
                return {
                  eq(_col2, projectId) {
                    storedRecord = {
                      ...storedRecord,
                      ...patch,
                      metadata: patch.metadata ?? storedRecord.metadata,
                    };
                    return {
                      select() {
                        return {
                          single: async () => ({ data: storedRecord, error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          eq(col, val) {
            chain._filters[col] = val;
            return chain;
          },
          maybeSingle: async () => {
            if (chain._filters.id && chain._filters.id !== storedRecord.id) {
              return { data: null, error: null };
            }
            return { data: storedRecord, error: null };
          },
        };
        return chain;
      }

      if (table === "coordination_stage_transitions") {
        return {
          insert(row) {
            const transition = {
              id: `transition-${transitions.length + 1}`,
              ...row,
              created_at: new Date().toISOString(),
            };
            transitions.push(transition);
            return {
              select() {
                return {
                  single: async () => ({ data: transition, error: null }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
    getStoredRecord: () => storedRecord,
    getTransitions: () => transitions,
  };
}

describe("uci-lifecycle-proposal-actions.service", () => {
  it("computes stable proposal checksum", () => {
    const checksum = computeLifecycleProposalChecksum(baseProposal, "2026-07-14T12:00:00.000Z");
    assert.equal(typeof checksum, "string");
    assert.equal(checksum.length, 16);
    assert.equal(
      checksum,
      computeLifecycleProposalChecksum(baseProposal, "2026-07-14T12:00:00.000Z"),
    );
  });

  it("applies lifecycle proposal with matching checksum", async () => {
    const supabase = makeSupabase();
    const checksum = computeLifecycleProposalChecksum(baseProposal, "2026-07-14T12:00:00.000Z");

    const result = await applyLifecycleProposal(supabase, {
      coordinationRecordId: COORD_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
      externalApplicationId: "app-123",
      proposalChecksum: checksum,
    });

    assert.equal(result.external_application_id, "app-123");
    assert.equal(result.transition.to_stage, 5);
    assert.equal(supabase.getTransitions().length, 1);

    const meta = supabase.getStoredRecord().metadata;
    const payload = /** @type {{ proposals?: Array<{ applied?: boolean }> }} */ (
      meta.uci_lifecycle_proposals
    );
    assert.equal(payload.proposals?.[0]?.applied, true);
  });

  it("rejects stale lifecycle proposal checksum", async () => {
    const supabase = makeSupabase();

    await assert.rejects(
      () =>
        applyLifecycleProposal(supabase, {
          coordinationRecordId: COORD_ID,
          projectId: PROJECT_ID,
          userId: USER_ID,
          externalApplicationId: "app-123",
          proposalChecksum: "stale-checksum",
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "PROPOSAL_STALE");
        return true;
      },
    );
  });

  it("rejects lifecycle proposal without stage transition", async () => {
    const supabase = makeSupabase();
    const checksum = computeLifecycleProposalChecksum(baseProposal, "2026-07-14T12:00:00.000Z");

    const result = await rejectLifecycleProposal(supabase, {
      coordinationRecordId: COORD_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
      externalApplicationId: "app-123",
      proposalChecksum: checksum,
      reason: "Manual review disagrees",
    });

    assert.equal(result.external_application_id, "app-123");
    assert.equal(supabase.getTransitions().length, 0);

    const meta = supabase.getStoredRecord().metadata;
    const payload = /** @type {{ proposals?: Array<{ rejected?: boolean }> }} */ (
      meta.uci_lifecycle_proposals
    );
    assert.equal(payload.proposals?.[0]?.rejected, true);
  });
});
