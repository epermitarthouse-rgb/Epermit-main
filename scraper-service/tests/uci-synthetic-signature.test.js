"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  setSyntheticSignatureStatus,
} = require("../app/services/uci/uci-synthetic-checklist.service.js");
const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  SYNTHETIC_TEST_CHECKLIST_MODE,
} = require("../app/services/uci/uci-application-builder.service.js");

function buildApplication(signatureStatus = "unsigned") {
  const satisfied = signatureStatus === "signed_manual_verified";
  return {
    id: "app-1",
    coordination_record_id: "coord-1",
    project_id: "project-1",
    record_source: "agent_draft",
    idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
    load_summary: { analysis_status: "complete" },
    package_documents: [
      {
        key: "authorization",
        status: "attached",
        signature_required: true,
        signature_status: signatureStatus,
      },
    ],
    agent_draft_metadata: {
      application_package: {
        checklist_mode: SYNTHETIC_TEST_CHECKLIST_MODE,
        authoritative_requirements: false,
        load_profile_application_id: "load-1",
        package_status: satisfied ? "ready_for_review" : "incomplete",
        missing_documents: [],
        missing_fields: satisfied ? [] : ["authorization_signature"],
        signature_requirements: [
          {
            document_key: "authorization",
            requirement_key: "authorization_signature",
            signature_status: signatureStatus,
            satisfied,
          },
        ],
      },
    },
  };
}

function createUpdateOnlySupabase(application) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: "from", table });
      return {
        update(payload) {
          calls.push({ operation: "update", payload });
          return {
            eq(column, value) {
              calls.push({ operation: "eq", column, value });
              return {
                select() {
                  calls.push({ operation: "select" });
                  return {
                    async single() {
                      calls.push({ operation: "single" });
                      return { data: { ...application, ...payload }, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("UCI synthetic signature mutation", () => {
  it("marks signed and recomputes readiness with one bounded update", async () => {
    const application = buildApplication("unsigned");
    const supabase = createUpdateOnlySupabase(application);

    const result = await setSyntheticSignatureStatus(supabase, {
      applicationId: application.id,
      application,
      userId: "user-1",
      documentKey: "authorization",
      signatureStatus: "signed_manual_verified",
      reviewNote: "Reviewed signed LOA",
    });

    assert.equal(result.signature_status, "signed_manual_verified");
    assert.equal(result.package_status, "ready_for_review");
    assert.deepEqual(result.missing_fields, []);
    assert.equal(supabase.calls.filter((call) => call.operation === "from").length, 1);
    assert.equal(supabase.calls[0].table, "coordination_applications");
  });

  it("marks unsigned and restores only the signature readiness blocker", async () => {
    const application = buildApplication("signed_manual_verified");
    const supabase = createUpdateOnlySupabase(application);

    const result = await setSyntheticSignatureStatus(supabase, {
      applicationId: application.id,
      application,
      userId: "user-1",
      documentKey: "authorization",
      signatureStatus: "unsigned",
      reviewNote: "",
    });

    assert.equal(result.signature_status, "unsigned");
    assert.equal(result.package_status, "incomplete");
    assert.deepEqual(result.missing_fields, ["authorization_signature"]);
    assert.equal(supabase.calls.filter((call) => call.operation === "from").length, 1);
  });
});
