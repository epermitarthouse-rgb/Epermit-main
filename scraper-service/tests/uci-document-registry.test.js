"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const recordsService = require("../app/services/uci/uci-records.service.js");
const appBuilder = require("../app/services/uci/uci-application-builder.service.js");
const templateService = require("../app/services/uci/uci-provider-application-template.service.js");

const ORIGINAL_GET_RECORD = recordsService.getCoordinationRecordById;
const ORIGINAL_VALIDATE_PROVIDER = appBuilder.validateProviderContext;
const ORIGINAL_FIND_DRAFT = appBuilder.findApplicationPackageDraft;
const ORIGINAL_RESOLVE_TEMPLATE = templateService.resolveApplicationTemplateManifest;

const COORD_ID = "f656209f-8fb5-4711-98ad-3e65801505db";
const PROJECT_ID = "13dbc43e-860f-435d-a8af-27dfe34f2322";
const USER_ID = "user-registry-1";

const DOMINION_TEMPLATE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../demo-assets/uci/dominion-electric-full-demo-v2.json"),
    "utf8",
  ),
);

const DOMINION_SYNTHETIC_FILES = [
  ["01_Synthetic_Load_Letter.pdf", "load_letter", "high"],
  ["02_Synthetic_One_Line_Service_Data.pdf", "single_line_diagram", "high"],
  ["03_Synthetic_Equipment_Schedule.pdf", "equipment_schedule", "high"],
  ["04_Synthetic_Construction_Schedule_Utility_Summary.pdf", "construction_schedule", "high"],
  ["05_Synthetic_Equipment_Cut_Sheet.pdf", "equipment_cut_sheet", "high"],
  ["06_Synthetic_LOA_UNSIGNED.pdf", "letter_of_authorization", "high"],
  ["07_Synthetic_Site_Utility_Plan_Data_Sheet.pdf", "site_plan", "high"],
  ["Load_Calculation_Worksheet.pdf", "load_calculation_worksheet", "high"],
];

/** @type {Record<string, unknown> | null} */
let registryService = null;

before(() => {
  installDominionTemplateMocks();
  delete require.cache[require.resolve("../app/services/uci/uci-document-registry.service.js")];
  registryService = require("../app/services/uci/uci-document-registry.service.js");
});

after(() => {
  recordsService.getCoordinationRecordById = ORIGINAL_GET_RECORD;
  appBuilder.validateProviderContext = ORIGINAL_VALIDATE_PROVIDER;
  appBuilder.findApplicationPackageDraft = ORIGINAL_FIND_DRAFT;
  templateService.resolveApplicationTemplateManifest = ORIGINAL_RESOLVE_TEMPLATE;
  delete require.cache[require.resolve("../app/services/uci/uci-document-registry.service.js")];
});

function installDominionTemplateMocks() {
  recordsService.getCoordinationRecordById = async (_s, id) =>
    [
      {
        id: COORD_ID,
        project_id: PROJECT_ID,
        tenant_id: "tenant-1",
        utility_type: "electric",
        utility_provider_id: "dominion-1",
        metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
      },
    ].find((r) => String(r.id) === String(id)) ?? null;

  appBuilder.validateProviderContext = (record) => {
    const slug = record?.metadata?.uci_provider_mapping?.provider_slug;
    if (!slug) return { ok: false, message: "missing provider", code: "PROVIDER_MISSING" };
    return { ok: true, providerSlug: String(slug) };
  };

  appBuilder.findApplicationPackageDraft = async () => null;

  templateService.resolveApplicationTemplateManifest = async (_s, params) => ({
    template: {
      required_documents:
        params.providerSlug === "dominion" ? DOMINION_TEMPLATE.required_documents : [],
    },
    resolution: { source: "test" },
  });
}

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createRegistryMockSupabase(tables) {
  recordsService.getCoordinationRecordById = async (_s, id) =>
    (tables.coordination_records || []).find((r) => String(r.id) === String(id)) ?? null;

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
        order() {
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
              id: state.insertRow.id ?? `${table}-${store.length + 1}`,
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
          if (state.mode === "select") {
            const rows = store.filter((r) =>
              filters.every((f) => String(r[f.column]) === String(f.value)),
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

describe("uci-document-classifier", () => {
  it("classifies Dominion synthetic filenames with high confidence", () => {
    const { classifyDocumentRole } = require("../app/services/uci/uci-document-classifier.service.js");
    for (const [fileName, expectedRole, expectedConfidence] of DOMINION_SYNTHETIC_FILES) {
      const result = classifyDocumentRole({ file_name: fileName, document_type: "other" });
      assert.equal(result.detected_role, expectedRole, fileName);
      assert.equal(result.role_confidence, expectedConfidence, fileName);
      assert.equal(result.classification_review, "auto_accepted", fileName);
    }
  });

  it("maps confidence to review state per policy", () => {
    const { resolveClassificationReview } = require("../app/services/uci/uci-document-role-stages.js");
    assert.equal(resolveClassificationReview("high", "site_plan"), "auto_accepted");
    assert.equal(resolveClassificationReview("medium", "site_plan"), "review_recommended");
    assert.equal(resolveClassificationReview("low", "site_plan"), "needs_classification");
    assert.equal(resolveClassificationReview("high", "other"), "needs_classification");
  });

  it("infers LOA unsigned vs signed from filename", () => {
    const { inferSignatureStatus } = require("../app/services/uci/uci-document-classifier.service.js");
    assert.equal(
      inferSignatureStatus("letter_of_authorization", { file_name: "06_Synthetic_LOA_UNSIGNED.pdf" }),
      "unsigned",
    );
    assert.equal(
      inferSignatureStatus("letter_of_authorization", { file_name: "LOA_SIGNED.pdf" }),
      "signed",
    );
    assert.equal(inferSignatureStatus("site_plan", { file_name: "site.pdf" }), null);
  });

  it("accepts explicit hint role from upload context", () => {
    const { classifyDocumentRole } = require("../app/services/uci/uci-document-classifier.service.js");
    const result = classifyDocumentRole(
      { file_name: "unknown.pdf", document_type: "other" },
      { hintRole: "equipment_schedule", provenance: "manual_upload" },
    );
    assert.equal(result.detected_role, "equipment_schedule");
    assert.equal(result.classification_review, "auto_accepted");
  });
});

describe("uci-document-role-stages", () => {
  it("maps document types to normalized roles", () => {
    const { normalizeDocumentTypeToRole } = require("../app/services/uci/uci-document-role-stages.js");
    assert.equal(normalizeDocumentTypeToRole("one_line_diagram"), "single_line_diagram");
    assert.equal(normalizeDocumentTypeToRole("load-profile"), "load_letter");
    assert.equal(normalizeDocumentTypeToRole("class_of_service"), "class_of_service");
  });

  it("resolves authoritative stage consumers for roles", () => {
    const { resolveStageConsumersForRole } = require("../app/services/uci/uci-document-role-stages.js");
    assert.deepEqual(resolveStageConsumersForRole("load_letter"), [2]);
    assert.deepEqual(resolveStageConsumersForRole("load_calculation_worksheet"), [2, 3]);
    assert.deepEqual(resolveStageConsumersForRole("letter_of_authorization"), [3, 4]);
    assert.deepEqual(resolveStageConsumersForRole("closeout"), [9, 10]);
  });

  it("matches Dominion template slots from registry roles", () => {
    const {
      normalizeDocumentTypeToRole,
      matchProviderSlotsForRole,
    } = require("../app/services/uci/uci-document-role-stages.js");
    for (const req of DOMINION_TEMPLATE.required_documents) {
      const role = normalizeDocumentTypeToRole(req.key);
      const matched = matchProviderSlotsForRole(role, DOMINION_TEMPLATE.required_documents);
      assert.ok(matched.includes(req.key), `role ${role} should match slot ${req.key}`);
    }
  });
});

describe("uci-document-registry service", () => {
  it("prefers manual role over detected role for effective role", () => {
    assert.equal(registryService.resolveEffectiveRole("site_plan", "single_line_diagram"), "site_plan");
    assert.equal(registryService.resolveEffectiveRole(null, "equipment_schedule"), "equipment_schedule");
    assert.equal(registryService.resolveEffectiveRole("other", "equipment_schedule"), "equipment_schedule");
  });

  it("recomputes stage consumers and provider slots on override", async () => {
    const docId = "doc-loa-1";
    const tables = {
      coordination_records: [
        {
          id: COORD_ID,
          project_id: PROJECT_ID,
          tenant_id: "tenant-1",
          utility_type: "electric",
          utility_provider_id: "dominion-1",
          metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
        },
      ],
      project_documents: [
        {
          id: docId,
          project_id: PROJECT_ID,
          document_type: "other",
          file_name: "06_Synthetic_LOA_UNSIGNED.pdf",
          file_path: "path/loa.pdf",
          file_type: "application/pdf",
        },
      ],
      uci_document_registry_entries: [
        {
          id: "reg-1",
          coordination_record_id: COORD_ID,
          project_document_id: docId,
          project_id: PROJECT_ID,
          detected_role: "other",
          role_confidence: "low",
          manual_role: null,
          provenance: "manual_upload",
        },
      ],
    };

    const result = await registryService.overrideDocumentRole(createRegistryMockSupabase(tables), {
      coordinationRecordId: COORD_ID,
      projectDocumentId: docId,
      manualRole: "letter_of_authorization",
      userId: USER_ID,
    });

    assert.equal(result.effective_role, "letter_of_authorization");
    assert.deepEqual(result.stage_consumers, [3, 4]);
    assert.ok(result.provider_slot_keys.includes("letter_of_authorization"));
    assert.equal(result.classification_review, "auto_accepted");
  });

  it("reports provider requirements readiness for Dominion 8-doc template", async () => {
    const {
      enrichRegistryEntry,
      matchProviderSlotsForRole,
      resolveStageConsumersForRole,
    } = require("../app/services/uci/uci-document-role-stages.js");
    const roleStages = require("../app/services/uci/uci-document-role-stages.js");

    /** @type {Array<Record<string, unknown>>} */
    const registryEntries = [];
    /** @type {Array<Record<string, unknown>>} */
    const projectDocs = [];
    for (const [index, [fileName, role]] of DOMINION_SYNTHETIC_FILES.entries()) {
      const docId = `doc-${index + 1}`;
      projectDocs.push({
        id: docId,
        project_id: PROJECT_ID,
        document_type: "other",
        file_name: fileName,
        file_path: `path/${fileName}`,
        file_type: "application/pdf",
      });
      registryEntries.push({
        id: `reg-${index + 1}`,
        coordination_record_id: COORD_ID,
        project_document_id: docId,
        project_id: PROJECT_ID,
        detected_role: role,
        effective_role: role,
        role_confidence: "high",
        manual_role: null,
        classification_review: "auto_accepted",
        provenance: "manual_upload",
        signature_status: role === "letter_of_authorization" ? "unsigned" : null,
        provider_slot_keys: roleStages.matchProviderSlotsForRole(
          role,
          DOMINION_TEMPLATE.required_documents,
        ),
        stage_consumers: roleStages.resolveStageConsumersForRole(role),
        project_document: projectDocs[projectDocs.length - 1],
      });
    }

    const originalList = registryService.listDocumentRegistry;
    registryService.listDocumentRegistry = async () => ({
      coordination_record_id: COORD_ID,
      project_id: PROJECT_ID,
      documents: registryEntries.map((entry) =>
        registryService.enrichRegistryEntry(entry, DOMINION_TEMPLATE.required_documents),
      ),
      needs_review: [],
      total_count: registryEntries.length,
    });

    try {
      const status = await registryService.getProviderRequirementsStatus(
        createRegistryMockSupabase({
          coordination_records: [
            {
              id: COORD_ID,
              project_id: PROJECT_ID,
              tenant_id: "tenant-1",
              utility_type: "electric",
              utility_provider_id: "dominion-1",
              metadata: { uci_provider_mapping: { provider_slug: "dominion" } },
            },
          ],
          project_documents: projectDocs,
          uci_document_registry_entries: registryEntries,
        }),
        {
          coordinationRecordId: COORD_ID,
          userId: USER_ID,
        },
      );

      assert.equal(status.provider_slug, "dominion");
      assert.equal(status.readiness.total_count, 8);
      assert.equal(status.readiness.ready_count, 7);
      assert.equal(status.readiness.complete, false);
      assert.ok(status.missing_slots.length === 0);
      assert.ok(status.signature_required_slots.includes("letter_of_authorization"));
      const loaSlot = status.slots.find((s) => s.key === "letter_of_authorization");
      assert.equal(loaSlot?.ready, false);
      assert.equal(loaSlot?.signature_status, "unsigned");
    } finally {
      registryService.listDocumentRegistry = originalList;
    }
  });

  it("findRegistryMatchForSlot resolves provider slot from effective role", () => {
    const registryDocuments = [
      {
        project_document_id: "doc-sld",
        effective_role: "single_line_diagram",
        provider_slot_keys: ["single_line_diagram"],
        role_confidence: "high",
      },
    ];
    const match = registryService.findRegistryMatchForSlot(registryDocuments, "single_line_diagram", [
      "one_line",
      "single_line",
    ]);
    assert.equal(match?.project_document_id, "doc-sld");
  });
});

describe("uci-package-document-bridge registry integration", () => {
  it("prefers registry match over loose document_type auto-match", () => {
    const { resolvePackageDocumentSlots } = require("../app/services/uci/uci-package-document-bridge.service.js");
    const result = resolvePackageDocumentSlots({
      requiredDocuments: DOMINION_TEMPLATE.required_documents,
      projectDocuments: [
        {
          id: "doc-wrong-type",
          document_type: "site_plan",
          file_name: "wrongly_typed_one_line.pdf",
        },
        {
          id: "doc-correct",
          document_type: "other",
          file_name: "02_Synthetic_One_Line_Service_Data.pdf",
        },
      ],
      existingPackageDocuments: [],
      pepcoPortalFiles: [],
      registryDocuments: [
        {
          project_document_id: "doc-correct",
          effective_role: "single_line_diagram",
          provider_slot_keys: ["single_line_diagram"],
          role_confidence: "high",
          project_document: {
            id: "doc-correct",
            document_type: "other",
            file_name: "02_Synthetic_One_Line_Service_Data.pdf",
          },
        },
      ],
      accessContext: {
        projectId: PROJECT_ID,
        coordinationRecordId: COORD_ID,
        tenantId: "tenant-1",
      },
    });

    const sld = result.packageDocuments.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.status, "attached");
    assert.equal(sld?.project_document_id, "doc-correct");
    assert.equal(sld?.registry_role, "single_line_diagram");
    assert.equal(sld?.source, "project_documents");
  });
});
