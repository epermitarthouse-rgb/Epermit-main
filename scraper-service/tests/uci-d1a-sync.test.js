"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  applicationRowChanged,
} = require("../app/services/uci/uci-portal-application-sync.service.js");
const {
  communicationRowChanged,
} = require("../app/services/uci/uci-communication-sync.service.js");
const {
  milestoneRowChanged,
} = require("../app/services/uci/uci-milestone-sync.service.js");
const { upsertPortalApplications } = require("../app/services/uci/uci-portal-application-sync.service.js");
const { upsertPortalCommunications } = require("../app/services/uci/uci-communication-sync.service.js");
const { upsertPortalStatusEvents } = require("../app/services/uci/uci-milestone-sync.service.js");
const { pepcoAdapter } = require("../app/services/uci/adapters/pepco.adapter.js");

const SAMPLE_APP = {
  applicationUuid: "uuid-abc",
  overview: { jobId: "JOB-1", actionRequired: false },
  currentStatus: "In Design",
  currentMilestone: "Engineering and Design",
  statusLastUpdatedAt: "2026-06-01T00:00:00.000Z",
  statusChanges: [
    {
      milestoneName: "Engineering and Design",
      statusName: "In Design",
      statusChangeDateTime: "2026-06-01T00:00:00.000Z",
    },
  ],
  messages: [
    {
      statusChangeDisplayName: "In Design",
      senderMessage: "update",
      isInternalUser: false,
      messageDateTime: "2026-06-01T00:00:01.000Z",
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
function createMockSupabase(tables) {
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
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          const copy = { ...row, id: `${table}-${store.length + 1}` };
          store.push(copy);
          return Promise.resolve({ error: null });
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

describe("UCI D1A sync idempotency", () => {
  it("inserts application on first sync and skips identical second sync", async () => {
    const tables = {};
    const supabase = createMockSupabase(tables);
    const normalized = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    assert.ok(normalized);

    const first = await upsertPortalApplications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      applications: [normalized],
    });
    assert.equal(first.counts.inserted, 1);
    assert.equal(tables.coordination_applications.length, 1);
    assert.equal(tables.coordination_applications[0].record_source, "portal_sync");

    const second = await upsertPortalApplications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      applications: [normalized],
    });
    assert.equal(second.counts.skipped, 1);
    assert.equal(tables.coordination_applications.length, 1);
  });

  it("updates same application row when portal status changes", async () => {
    const tables = {};
    const supabase = createMockSupabase(tables);
    const normalized = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    assert.ok(normalized);
    await upsertPortalApplications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      applications: [normalized],
    });

    const changed = {
      ...normalized,
      portal_status: "Contract Sent",
      metadata: { ...normalized.metadata, changed: true },
    };
    const result = await upsertPortalApplications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      applications: [changed],
    });
    assert.equal(result.counts.updated, 1);
    assert.equal(tables.coordination_applications[0].portal_status, "Contract Sent");
  });

  it("skips portal sync when agent_draft row already exists", async () => {
    const tables = {
      coordination_applications: [
        {
          id: "app-1",
          coordination_record_id: "coord-1",
          provider_slug: "pepco",
          external_application_id: "uuid-abc",
          record_source: "agent_draft",
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const normalized = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    const result = await upsertPortalApplications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      applications: [/** @type {NonNullable<typeof normalized>} */ (normalized)],
    });
    assert.equal(result.counts.skipped, 1);
    assert.equal(tables.coordination_applications.length, 1);
    assert.equal(tables.coordination_applications[0].record_source, "agent_draft");
  });

  it("deduplicates communications and milestones", async () => {
    const tables = {};
    const supabase = createMockSupabase(tables);
    const comms = pepcoAdapter.normalizeMessages(SAMPLE_APP, CONTEXT);
    const events = pepcoAdapter.normalizeStatusEvents(SAMPLE_APP, CONTEXT);

    const commFirst = await upsertPortalCommunications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      communications: comms,
    });
    const commSecond = await upsertPortalCommunications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      communications: comms,
    });
    assert.equal(commFirst.counts.inserted, 1);
    assert.equal(commSecond.counts.skipped, 1);

    const msFirst = await upsertPortalStatusEvents(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      events,
    });
    const msSecond = await upsertPortalStatusEvents(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
      tenantId: null,
      providerSlug: "pepco",
      events,
    });
    assert.equal(msFirst.counts.inserted, 1);
    assert.equal(msSecond.counts.skipped, events.length);
    assert.equal(tables.coordination_milestones[0].milestone_type, "portal_status_event");
    assert.equal(tables.coordination_milestones[0].status, "completed");
  });
});

describe("UCI D1A row change detectors", () => {
  it("detects application row changes", () => {
    assert.equal(applicationRowChanged(null, { portal_status: "A" }), true);
    assert.equal(
      applicationRowChanged({ portal_status: "A", metadata: {} }, { portal_status: "A", metadata: {} }),
      false,
    );
  });

  it("detects communication row changes", () => {
    assert.equal(communicationRowChanged({ raw_body: "a" }, { raw_body: "b" }), true);
  });

  it("detects milestone row changes", () => {
    assert.equal(milestoneRowChanged({ portal_status: "A" }, { portal_status: "B" }), true);
  });
});
