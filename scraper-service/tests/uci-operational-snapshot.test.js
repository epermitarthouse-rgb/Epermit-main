"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getUciOperationalSnapshot,
  isAttentionCommunication,
  recentCommunicationsByRecord,
} = require("../app/services/uci/uci-operational-snapshot.service.js");

function makeSupabase({ applicationError = null, communicationError = null } = {}) {
  const calls = [];
  const tables = {
    coordination_records: [
      {
        id: "record-1",
        project_id: "project-1",
        utility_providers: { id: "provider-1", name: "PEPCO", display_name: "PEPCO" },
      },
    ],
    coordination_applications: [
      {
        id: "application-load",
        project_id: "project-1",
        coordination_record_id: "record-1",
        application_type: "load_profile",
        record_source: "agent_draft",
        idempotency_key: "agent_2_load_profile:d2.1-v1",
      },
      {
        id: "application-package",
        project_id: "project-1",
        coordination_record_id: "record-1",
        application_type: "new_service",
        record_source: "agent_draft",
        idempotency_key: "agent_3_application_package:d3-v1",
        submitted_at: null,
        provider_slug: "dominion",
        agent_draft_metadata: { application_package: { package_status: "ready_for_review" } },
      },
    ],
    coordination_communications: Array.from({ length: 7 }, (_, index) => ({
      id: `communication-${index + 1}`,
      project_id: "project-1",
      coordination_record_id: "record-1",
      direction: "inbound",
      classification: index === 6 ? null : "status_update",
      classification_confidence: index === 5 ? 0.5 : 0.95,
      needs_human_attention: index === 4,
      message_timestamp: new Date(Date.UTC(2026, 7, 17, 12, 0, 7 - index)).toISOString(),
      created_at: new Date(Date.UTC(2026, 7, 17, 12, 0, 7 - index)).toISOString(),
      agent_processed_metadata: {},
    })),
  };

  const client = {
    calls,
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      return { data: [{ id: "project-1", name: "Highland Springs" }], error: null };
    },
    from(table) {
      calls.push({ kind: "table", table });
      const chain = {
        select() {
          return chain;
        },
        in() {
          return chain;
        },
        order() {
          return chain;
        },
        then(resolve, reject) {
          const error =
            table === "coordination_applications"
              ? applicationError
              : table === "coordination_communications"
                ? communicationError
                : null;
          return Promise.resolve({ data: error ? null : tables[table], error }).then(
            resolve,
            reject,
          );
        },
      };
      return chain;
    },
  };
  return client;
}

describe("UCI operational snapshot", () => {
  it("uses one access RPC and three bulk table reads", async () => {
    const supabase = makeSupabase();
    const result = await getUciOperationalSnapshot(supabase, { userId: "user-1" });

    assert.equal(supabase.calls.length, 4);
    assert.equal(result.diagnostics.db_query_count, 4);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].project_name, "Highland Springs");
    assert.equal(result.records[0].applications.length, 2);
    assert.equal(
      result.records[0].applications.filter(
        (app) => app.idempotency_key === "agent_3_application_package:d3-v1",
      ).length,
      1,
    );
    assert.equal(result.records[0].applications.find((app) => app.id === "application-package")?.submitted_at, null);
    assert.equal(result.records[0].applications.find((app) => app.id === "application-package")?.provider_slug, "dominion");
    assert.equal(result.records[0].communications_recent.length, 5);
    assert.equal(result.records[0].attention_communications.length, 3);
    assert.equal(result.records[0].attention_count, 3);
  });

  it("returns records with partial coverage when an optional child query fails", async () => {
    const supabase = makeSupabase({
      communicationError: { message: "communications unavailable" },
    });
    const result = await getUciOperationalSnapshot(supabase, { userId: "user-1" });

    assert.equal(result.records.length, 1);
    assert.deepEqual(result.records[0].communications_recent, []);
    assert.deepEqual(result.diagnostics.partial_failures, ["communications"]);
  });

  it("classifies persisted attention rows without mutation", () => {
    assert.equal(
      isAttentionCommunication({
        direction: "inbound",
        needs_human_attention: true,
      }),
      true,
    );
    assert.equal(
      isAttentionCommunication({
        direction: "inbound",
        classification: null,
      }),
      true,
    );
    assert.equal(
      isAttentionCommunication({
        direction: "inbound",
        classification: "status_update",
        classification_confidence: 0.9,
      }),
      false,
    );
    assert.equal(
      isAttentionCommunication({
        direction: "outbound",
        classification: null,
        needs_human_attention: false,
        agent_processed_metadata: { source: "stage4_live_transmit", stage5_handoff: true },
        raw_subject: "Utility Coordination Application Package",
      }),
      false,
    );
  });

  it("caps recent messages independently for each record", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `a-${index}`,
        coordination_record_id: "a",
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `b-${index}`,
        coordination_record_id: "b",
      })),
    ];
    const grouped = recentCommunicationsByRecord(rows, 5);
    assert.equal(grouped.get("a").length, 5);
    assert.equal(grouped.get("b").length, 3);
  });
});
