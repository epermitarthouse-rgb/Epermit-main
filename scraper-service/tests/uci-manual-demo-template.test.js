"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  resolveApplicationTemplateManifest,
  saveCoordinationApplicationTemplate,
} = require("../app/services/uci/uci-provider-application-template.service.js");

const DOMINION_V2 = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../demo-assets/uci/dominion-electric-full-demo-v2.json"),
    "utf8",
  ),
);

const DOMINION_SYNTHETIC_FILES = [
  ["01_Synthetic_Load_Letter.pdf", "load_letter"],
  ["02_Synthetic_One_Line_Service_Data.pdf", "single_line_diagram"],
  ["03_Synthetic_Equipment_Schedule.pdf", "equipment_schedule"],
  ["04_Synthetic_Construction_Schedule_Utility_Summary.pdf", "construction_schedule"],
  ["05_Synthetic_Equipment_Cut_Sheet.pdf", "equipment_cut_sheet"],
  ["06_Synthetic_LOA_UNSIGNED.pdf", "letter_of_authorization"],
  ["07_Synthetic_Site_Utility_Plan_Data_Sheet.pdf", "site_plan"],
];

function createManualDemoMockSupabase() {
  const providers = [
    {
      id: "cb8d891b-f992-4aff-a243-c448041c3a86",
      slug: "dominion",
      uci_application_templates: {
        "electric:new_service": {
          manifest: DOMINION_V2,
          stored_version: "dominion-electric-full-demo-v2",
        },
      },
    },
  ];
  const coordinationRecords = [
    {
      id: "f656209f-8fb5-4711-98ad-3e65801505db",
      project_id: "13dbc43e-860f-435d-a8af-27dfe34f2322",
      utility_type: "electric",
      utility_provider_id: "cb8d891b-f992-4aff-a243-c448041c3a86",
      metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
      utility_providers: { slug: "dominion" },
    },
  ];

  return {
    from(table) {
      const store = table === "utility_providers" ? providers : coordinationRecords;
      const filters = [];
      const state = { mode: "select", updatePatch: null };
      const api = {
        select: () => api,
        eq: (column, value) => {
          filters.push({ column, value });
          return api;
        },
        update: (patch) => {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        maybeSingle: () => {
          const row = store.find((entry) =>
            filters.every((filter) => String(entry[filter.column]) === String(filter.value)),
          );
          return Promise.resolve({ data: row ?? null, error: null });
        },
        single: () => {
          const row = store.find((entry) =>
            filters.every((filter) => String(entry[filter.column]) === String(filter.value)),
          );
          if (row && state.mode === "update" && state.updatePatch) {
            Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: row ?? null, error: null });
        },
      };
      return api;
    },
    _coordinationRecords: coordinationRecords,
  };
}

describe("UCI manual demo template flow (Portsmouth)", () => {
  it("shows zero requirements before coordination template activation despite global library", async () => {
    const supabase = createManualDemoMockSupabase();
    const record = supabase._coordinationRecords[0];

    const resolved = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: record.utility_provider_id,
      utilityType: "electric",
      coordinationMetadata: record.metadata,
    });

    assert.equal(resolved.template, null);
    assert.equal(resolved.resolution.status, "missing");
    assert.equal(resolved.template?.required_documents?.length ?? 0, 0);
  });

  it("exposes eight requirements after operator uploads v2 template to coordination", async () => {
    const supabase = createManualDemoMockSupabase();
    const record = supabase._coordinationRecords[0];

    await saveCoordinationApplicationTemplate(supabase, {
      coordinationId: record.id,
      record,
      utilityType: "electric",
      userId: "operator-demo",
      manifest: DOMINION_V2,
    });

    const updated = supabase._coordinationRecords[0];
    const resolved = await resolveApplicationTemplateManifest(supabase, {
      providerSlug: "dominion",
      providerId: record.utility_provider_id,
      utilityType: "electric",
      coordinationMetadata: updated.metadata,
    });

    assert.equal(resolved.resolution.source, "coordination_manual");
    assert.equal(resolved.resolution.status, "ready");
    assert.equal(resolved.template?.required_documents?.length, 8);
  });

  it("classifies seven synthetic PDFs and blocks unsigned LOA readiness", () => {
    const { classifyDocumentRole } = require("../app/services/uci/uci-document-classifier.service.js");
    const { matchProviderSlotsForRole } = require("../app/services/uci/uci-document-role-stages.js");
    const { inferSignatureStatus } = require("../app/services/uci/uci-document-classifier.service.js");

    let matchedSlots = 0;
    for (const [fileName, expectedRole] of DOMINION_SYNTHETIC_FILES) {
      const result = classifyDocumentRole({ file_name: fileName, document_type: "other" });
      assert.equal(result.detected_role, expectedRole, fileName);
      const slots = matchProviderSlotsForRole(expectedRole, DOMINION_V2.required_documents);
      assert.ok(slots.length > 0, fileName);
      matchedSlots += 1;
    }
    assert.equal(matchedSlots, 7);

    const loaStatus = inferSignatureStatus("letter_of_authorization", {
      file_name: "06_Synthetic_LOA_UNSIGNED.pdf",
    });
    assert.equal(loaStatus, "unsigned");

    const loaSlot = DOMINION_V2.required_documents.find((d) => d.key === "letter_of_authorization");
    assert.equal(loaSlot?.signature_required, true);
  });
});
