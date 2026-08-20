"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  UCI_COMMUNICATION_CATEGORIES,
  classifyCommunicationText,
  isValidCategory,
} = require("../app/services/uci/uci-communication-categories.js");
const {
  buildClassificationPatch,
  classifyCoordinationCommunications,
  reclassifyCommunication,
} = require("../app/services/uci/uci-communication-classifier.service.js");

describe("UCI D5 communication categories", () => {
  it("exposes all 11 client categories", () => {
    assert.equal(UCI_COMMUNICATION_CATEGORIES.length, 11);
    assert.ok(UCI_COMMUNICATION_CATEGORIES.includes("acknowledgment"));
    assert.ok(UCI_COMMUNICATION_CATEGORIES.includes("unclassified"));
  });

  it("validates category enum", () => {
    assert.equal(isValidCategory("ciac_invoice"), true);
    assert.equal(isValidCategory("invalid"), false);
  });
});

describe("UCI D5 keyword classifier", () => {
  it("classifies payment due as ciac_invoice", () => {
    const result = classifyCommunicationText("Contract Sent", "payment due soon");
    assert.equal(result.classification, "ciac_invoice");
    assert.ok(result.classification_confidence >= 0.75);
  });

  it("classifies missing documents as request_for_information", () => {
    const result = classifyCommunicationText("Information Required", "missing documents attached");
    assert.equal(result.classification, "request_for_information");
  });

  it("returns unclassified with human attention for generic text", () => {
    const result = classifyCommunicationText("Update", "routine notice");
    assert.equal(result.classification, "unclassified");
    assert.equal(result.needs_human_attention, true);
  });

  it("classifies Highland Springs acknowledgment fixture as acknowledgment", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const eml = readFileSync(
      join(__dirname, "../fixtures/track-b/emails/highland-springs-acknowledgment.eml"),
      "utf8",
    );
    const subject = eml.match(/^Subject: (.*)$/m)?.[1] || "";
    const body = eml.split(/\n\n/).slice(1).join("\n\n");
    const result = classifyCommunicationText(subject, body);
    assert.equal(result.classification, "acknowledgment");
    assert.ok(result.classification_confidence >= 0.75);
    assert.equal(result.needs_human_attention, false);
    assert.match(String(result.extracted_fields.utility_project_manager || ""), /Jordan Hale/);
    assert.match(String(result.extracted_fields.utility_ticket_number || ""), /DE-VA-451497|LC[- ]?451497/);
  });
});

describe("UCI D5 classifyCoordinationCommunications integration", () => {
  it("classifies unclassified portal rows and skips human reclassified rows", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: null,
          raw_subject: "Contract Sent",
          raw_body: "payment due",
          needs_human_attention: true,
          agent_processed_metadata: {},
        },
        {
          id: "comm-2",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "acknowledgment",
          raw_subject: "Initiated",
          raw_body: "application received",
          agent_processed_metadata: { human_reclassified: true },
        },
      ],
    };

    const supabase = createClassifierMockSupabase(tables);

    const result = await classifyCoordinationCommunications(supabase, {
      coordinationRecordId: "coord-1",
      projectId: "proj-1",
    });

    assert.equal(result.classified_count, 1);
    assert.equal(result.skipped_count, 1);
    assert.equal(tables.coordination_communications[0].classification, "ciac_invoice");
  });

  it("reclassifies communication with human override", async () => {
    const tables = {
      coordination_communications: [
        {
          id: "comm-1",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          classification: "unclassified",
          agent_processed_metadata: {},
        },
      ],
    };

    const supabase = createClassifierMockSupabase(tables);

    const result = await reclassifyCommunication(supabase, {
      communicationId: "comm-1",
      userId: "user-1",
      review: { classification: "acknowledgment", notes: "Confirmed by coordinator" },
    });

    assert.equal(result.classification, "acknowledgment");
    assert.equal(tables.coordination_communications[0].classification_confidence, 1);
    assert.equal(
      /** @type {{ human_reclassified?: boolean }} */ (
        tables.coordination_communications[0].agent_processed_metadata
      ).human_reclassified,
      true,
    );
  });

  it("rejects invalid reclassification category", async () => {
    const tables = {
      coordination_communications: [
        { id: "comm-1", project_id: "proj-1", agent_processed_metadata: {} },
      ],
    };
    const supabase = createClassifierMockSupabase(tables);

    await assert.rejects(
      () =>
        reclassifyCommunication(supabase, {
          communicationId: "comm-1",
          userId: "user-1",
          review: { classification: "not_a_category" },
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "INVALID_CLASSIFICATION");
        return true;
      },
    );
  });
});

describe("UCI D5 buildClassificationPatch", () => {
  it("preserves existing portal attention flag when classifying", async () => {
    const patch = await buildClassificationPatch({
      raw_subject: "Update",
      raw_body: "hello",
      needs_human_attention: true,
      agent_processed_metadata: { source: "portal_sync" },
    });
    assert.equal(patch.needs_human_attention, true);
    assert.ok(patch.agent_processed_metadata.agent_5_classification);
  });
});

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createClassifierMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", updatePatch: null };

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        or() {
          return api;
        },
        order() {
          return api;
        },
        range() {
          return api;
        },
        maybeSingle() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single() {
          const row = store.find((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        then(resolve, reject) {
          const rows = store.filter((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
            resolve,
            reject,
          );
        },
      };

      return api;
    },
  };
}
