"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  findLinkedOutboundEcho,
  ingestInboundEmailMessage,
} = require("../app/services/uci/uci-graph-inbound.service.js");

function createMockSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || [];
      const filters = [];
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          filters.push((row) => String(row[col] ?? "") === String(val ?? ""));
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        update(patch) {
          return {
            eq(col, val) {
              return {
                select() {
                  return {
                    async maybeSingle() {
                      const row = rows.find((r) => String(r[col]) === String(val));
                      if (!row) return { data: null, error: null };
                      Object.assign(row, patch);
                      return { data: row, error: null };
                    },
                  };
                },
                async then(resolve) {
                  const row = rows.find((r) => String(r[col]) === String(val));
                  if (row) Object.assign(row, patch);
                  resolve({ data: row || null, error: null });
                },
              };
            },
          };
        },
        async maybeSingle() {
          const matched = rows.filter((row) => filters.every((fn) => fn(row)));
          return { data: matched[0] || null, error: null };
        },
        then(resolve) {
          const matched = rows.filter((row) => filters.every((fn) => fn(row)));
          resolve({ data: matched, error: null });
        },
      };
      return api;
    },
  };
}

describe("UCI Graph inbound self-send echo", () => {
  it("links application package self-send to existing outbound transmission", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "out-1",
          coordination_record_id: "coord-1",
          direction: "outbound",
          raw_subject: "[TEST] Utility Coordination Application Package — McDonald's Highland Springs",
          sender: "ops@commun-et.com",
          recipient: "ops@commun-et.com",
          thread_id: "conv-abc",
          external_message_id: "graph-sent-1",
          needs_human_attention: false,
          agent_processed_metadata: {
            source: "stage4_live_transmit",
            stage5_handoff: true,
          },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const linked = await findLinkedOutboundEcho(supabase, {
      raw_subject: "[TEST] Utility Coordination Application Package — McDonald's Highland Springs",
      sender: "ops@commun-et.com",
      conversation_id: "conv-abc",
      thread_id: "conv-abc",
      external_message_id: "graph-inbox-copy",
      internet_message_id: "<mid@mail>",
      idempotency_key: "graph:<mid@mail>",
    });
    assert.ok(linked);
    assert.equal(linked.id, "out-1");
  });

  it("does not treat a utility reply in the same thread as an outbound echo", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "out-1",
          coordination_record_id: "coord-1",
          direction: "outbound",
          raw_subject: "[TEST] Utility Coordination Application Package — McDonald's",
          sender: "ops@commun-et.com",
          recipient: "utility@dominionenergy.com",
          thread_id: "conv-abc",
          agent_processed_metadata: { source: "stage4_live_transmit", stage5_handoff: true },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const linked = await findLinkedOutboundEcho(supabase, {
      raw_subject: "RE: [TEST] Utility Coordination Application Package — McDonald's",
      sender: "pm@dominionenergy.com",
      conversation_id: "conv-abc",
      thread_id: "conv-abc",
      external_message_id: "graph-utility-reply",
      idempotency_key: "graph:reply",
    });
    assert.equal(linked, null);
  });

  it("ingestInboundEmailMessage returns linked_outbound_echo without inserting inbound", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "out-1",
          coordination_record_id: "coord-1",
          direction: "outbound",
          raw_subject: "[TEST] Utility Coordination Application Package — McDonald's Highland Springs",
          sender: "ops@commun-et.com",
          recipient: "ops@commun-et.com",
          thread_id: "conv-abc",
          needs_human_attention: false,
          agent_processed_metadata: { source: "stage4_live_transmit", stage5_handoff: true },
        },
      ],
    };
    const supabase = createMockSupabase(tables);
    const result = await ingestInboundEmailMessage(supabase, {
      normalized: {
        raw_subject: "[TEST] Utility Coordination Application Package — McDonald's Highland Springs",
        sender: "ops@commun-et.com",
        conversation_id: "conv-abc",
        thread_id: "conv-abc",
        external_message_id: "graph-inbox-copy",
        internet_message_id: "<mid@mail>",
        idempotency_key: "graph:<mid@mail>",
        raw_body: "package",
        message_timestamp: new Date().toISOString(),
      },
    });
    assert.equal(result.status, "linked_outbound_echo");
    assert.equal(result.inserted, false);
    assert.equal(tables.coordination_communications.length, 1);
    assert.equal(tables.coordination_communications[0].needs_human_attention, false);
    assert.ok(tables.coordination_communications[0].agent_processed_metadata.inbound_echo);
  });
});
