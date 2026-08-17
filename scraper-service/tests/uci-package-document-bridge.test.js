"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  suggestPackageSlotForCandidate,
  extractPepcoPortalFiles,
  validatePepcoStoragePathForRecord,
  resolvePackageDocumentSlots,
  listPackageDocumentCandidates,
  confirmPackageDocumentMapping,
  removePackageDocumentMapping,
  pepcoCandidateId,
} = require("../app/services/uci/uci-package-document-bridge.service.js");
const {
  runApplicationPackageBuild,
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
} = require("../app/services/uci/uci-application-builder.service.js");
const { LOAD_PROFILE_IDEMPOTENCY_KEY } = require("../app/services/uci/uci-load-profile.service.js");
const { PROVIDER_SETUP_METHOD } = require("../app/services/uci/uci-provider-setup.service.js");

const TENANT_A = "tenant-a-0000-4000-8000-000000000101";
const PROJECT_ID = "proj-1";
const COORD_ID = "coord-1";
const EXT_APP_ID = "pepco-app-uuid-1";
const USER_ID = "user-1";

const E601_FILE = {
  documentName: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
  fileName: "E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf",
  status: "saved",
  storageStatus: "stored",
  storageBucket: "project-documents",
  storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_ID}/E601 - ELECTRICAL ONE-LINE DIAGRAMS.pdf`,
  contentHash: "hash-e601",
  idempotencyKey: "pepco:e601",
  downloadedAt: "2026-07-15T10:00:00.000Z",
};

const E602_FILE = {
  documentName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf",
  fileName: "E602 - ELECTRICAL PANEL SCHEDULES.pdf",
  status: "saved",
  storageStatus: "stored",
  storageBucket: "project-documents",
  storagePath: `uci/${TENANT_A}/${PROJECT_ID}/${COORD_ID}/pepco/${EXT_APP_ID}/E602 - ELECTRICAL PANEL SCHEDULES.pdf`,
  contentHash: "hash-e602",
  idempotencyKey: "pepco:e602",
  downloadedAt: "2026-07-15T10:00:00.000Z",
};

const HUMAN_ASSISTED_RECORD = {
  id: COORD_ID,
  project_id: PROJECT_ID,
  tenant_id: TENANT_A,
  utility_provider_id: "prov-1",
  utility_type: "electric",
  metadata: {
    uci_provider_mapping: { method: "human_assisted", provider_slug: "pepco" },
    pepco_application_detail_discovery: {
      applications: [
        {
          applicationUuid: EXT_APP_ID,
          documents: [
            {
              documentName: E601_FILE.documentName,
              documentType: "One Line Diagram",
            },
            {
              documentName: E602_FILE.documentName,
              documentType: "Panel Schedule",
            },
          ],
          downloadedFiles: [E601_FILE, E602_FILE],
        },
      ],
    },
  },
  utility_providers: { slug: "pepco", name: "PEPCO" },
};

const LOAD_PROFILE_DRAFT = {
  id: "app-load-1",
  record_source: "agent_draft",
  idempotency_key: LOAD_PROFILE_IDEMPOTENCY_KEY,
  application_type: "load_profile",
  coordination_record_id: COORD_ID,
  project_id: PROJECT_ID,
  load_summary: {
    version: "d2.1-v1",
    utility_type: "electric",
    analysis_status: "missing_inputs",
    calculated_values: {},
    missing_inputs: ["connected_equipment_or_load_data"],
    inputs_used: [],
    needs_verification: [],
    assumptions: { template_id: null, template_version: null, notes: [] },
    source_documents: [],
    generated_at: "2026-07-14T12:00:00.000Z",
    generated_by: "agent_2_load_profile",
    requires_human_review: true,
  },
};

/**
 * @param {Record<string, Array<Record<string, unknown>>>} tables
 */
function createBridgeMockSupabase(tables) {
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
            const copy = { ...state.insertRow, id: `${table}-${store.length + 1}` };
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
          const rows = store.filter((r) =>
            filters.every((f) => String(r[f.column]) === String(f.value)),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };

      return api;
    },
  };
}

describe("UCI package document bridge service", () => {
  it("suggests E601 as single_line_diagram with high confidence", () => {
    const suggestion = suggestPackageSlotForCandidate({
      fileName: E601_FILE.fileName,
      pepcoDocumentName: E601_FILE.documentName,
      pepcoDocumentType: "One Line Diagram",
    });
    assert.equal(suggestion.suggested_slot, "single_line_diagram");
    assert.equal(suggestion.confidence, "high");
    assert.ok(suggestion.suggestion_reason);
  });

  it("does not suggest panel schedules for package slots or connected load", () => {
    const suggestion = suggestPackageSlotForCandidate({
      fileName: E602_FILE.fileName,
      pepcoDocumentName: E602_FILE.documentName,
      pepcoDocumentType: "Panel Schedule",
    });
    assert.equal(suggestion.suggested_slot, null);
    assert.match(String(suggestion.suggestion_reason), /Excluded/i);
  });

  it("extracts PEPCO portal files from coordination metadata", () => {
    const files = extractPepcoPortalFiles(HUMAN_ASSISTED_RECORD);
    assert.equal(files.length, 2);
    assert.equal(files[0].pepco_document_type, "One Line Diagram");
    assert.equal(files[0].external_application_id, EXT_APP_ID);
  });

  it("merges project documents and PEPCO portal candidates", async () => {
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      project_documents: [
        {
          id: "doc-site",
          project_id: PROJECT_ID,
          document_type: "site_plan",
          file_name: "site-plan.pdf",
          created_at: "2026-07-14T00:00:00.000Z",
        },
      ],
    };
    const supabase = createBridgeMockSupabase(tables);
    const result = await listPackageDocumentCandidates(supabase, {
      coordinationRecordId: COORD_ID,
      projectId: PROJECT_ID,
    });

    assert.equal(result.project_id, PROJECT_ID);
    assert.equal(result.tenant_id, TENANT_A);
    assert.ok(result.candidates.some((c) => c.source_type === "project_document"));
    assert.ok(result.candidates.some((c) => c.source_type === "pepco_portal"));
    assert.equal(result.suggestions_by_slot.single_line_diagram.length, 1);
    assert.equal(result.suggestions_by_slot.equipment_cut_sheets.length, 0);
  });

  it("does not mark slots complete from suggestions alone", () => {
    const templateRequired = [
      { key: "single_line_diagram", label: "Single-line diagram", aliases: ["single_line"] },
      { key: "site_plan", label: "Site plan", aliases: ["site_plan"] },
      { key: "equipment_cut_sheets", label: "Equipment cut sheets", aliases: ["cut_sheet"] },
      { key: "letter_of_authorization", label: "LOA", aliases: ["loa"] },
    ];

    const pepcoFiles = extractPepcoPortalFiles(HUMAN_ASSISTED_RECORD).map((f) => ({
      ...f,
      coordination_record_id: COORD_ID,
      project_id: PROJECT_ID,
    }));

    const result = resolvePackageDocumentSlots({
      requiredDocuments: templateRequired,
      projectDocuments: [],
      existingPackageDocuments: [],
      pepcoPortalFiles: pepcoFiles,
      accessContext: {
        projectId: PROJECT_ID,
        coordinationRecordId: COORD_ID,
        tenantId: TENANT_A,
      },
    });

    assert.ok(result.missingDocuments.includes("single_line_diagram"));
    assert.ok(
      result.packageDocuments.every(
        (d) => d.key !== "single_line_diagram" || d.status === "missing",
      ),
    );
  });

  it("returns PEPCO candidates when idempotencyKey is missing (legacy scrape metadata)", async () => {
    const legacyFile = {
      ...E601_FILE,
      idempotencyKey: undefined,
    };
    delete legacyFile.idempotencyKey;

    const tables = {
      coordination_records: [
        {
          ...HUMAN_ASSISTED_RECORD,
          metadata: {
            pepco_application_detail_discovery: {
              applications: [
                {
                  applicationUuid: EXT_APP_ID,
                  documents: [{ documentName: legacyFile.documentName }],
                  downloadedFiles: [legacyFile],
                },
              ],
            },
          },
        },
      ],
      project_documents: [],
    };
    const supabase = createBridgeMockSupabase(tables);
    const result = await listPackageDocumentCandidates(supabase, {
      coordinationRecordId: COORD_ID,
      projectId: PROJECT_ID,
      externalApplicationId: EXT_APP_ID,
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].source_type, "pepco_portal");
    assert.ok(String(result.candidates[0].candidate_id).startsWith("pepco_portal:"));
    assert.equal(result.suggestions_by_slot.single_line_diagram.length, 1);
  });

  it("requires external application scope when multiple PEPCO applications exist", async () => {
    const multiAppRecord = {
      ...HUMAN_ASSISTED_RECORD,
      metadata: {
        ...HUMAN_ASSISTED_RECORD.metadata,
        pepco_application_detail_discovery: {
          applications: [
            {
              applicationUuid: EXT_APP_ID,
              documents: [{ documentName: E601_FILE.documentName }],
              downloadedFiles: [E601_FILE],
            },
            {
              applicationUuid: "pepco-app-uuid-2",
              documents: [{ documentName: E602_FILE.documentName }],
              downloadedFiles: [E602_FILE],
            },
          ],
        },
      },
    };
    const tables = {
      coordination_records: [multiAppRecord],
      project_documents: [],
    };
    const supabase = createBridgeMockSupabase(tables);

    await assert.rejects(
      () =>
        listPackageDocumentCandidates(supabase, {
          coordinationRecordId: COORD_ID,
          projectId: PROJECT_ID,
        }),
      (err) => {
        assert.equal(/** @type {{ code?: string }} */ (err).code, "PEPCO_APPLICATION_SCOPE_REQUIRED");
        assert.ok(Array.isArray(/** @type {{ available_applications?: unknown[] }} */ (err).available_applications));
        assert.equal(
          /** @type {{ available_applications?: unknown[] }} */ (err).available_applications?.length,
          2,
        );
        return true;
      },
    );
  });

  it("isolates candidates to the requested external PEPCO application", async () => {
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      project_documents: [],
    };
    const supabase = createBridgeMockSupabase(tables);
    const wonderOnly = await listPackageDocumentCandidates(supabase, {
      coordinationRecordId: COORD_ID,
      projectId: PROJECT_ID,
      externalApplicationId: EXT_APP_ID,
    });
    assert.equal(wonderOnly.external_application_id, EXT_APP_ID);
    assert.equal(wonderOnly.candidates.length, 2);
    assert.ok(
      wonderOnly.candidates.every((c) => c.external_application_id === EXT_APP_ID),
    );
  });

  it("marks slot attached after user confirmation and rebuild preserves mapping", async () => {
    const packageAppId = "pkg-app-1";
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      projects: [
        {
          id: PROJECT_ID,
          project_type: "tenant_improvement",
          description: "QSR",
          address: "100 Main St",
          city: "Washington",
          state: "DC",
          zip_code: "20001",
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT },
        {
          id: packageAppId,
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          draft_status: "draft",
          package_documents: [],
          agent_draft_metadata: {
            application_package: { package_status: "incomplete", missing_fields: [] },
          },
          load_summary: {},
        },
      ],
    };

    const supabase = createBridgeMockSupabase(tables);
    const candidateId = pepcoCandidateId(E601_FILE);
    assert.ok(candidateId);

    const confirmed = await confirmPackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
      candidateId,
      externalApplicationId: EXT_APP_ID,
    });

    const sld = confirmed.package_documents.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.status, "attached");
    assert.equal(sld?.source, "pepco_portal");
    assert.equal(sld?.user_confirmed, true);
    assert.equal(confirmed.missing_documents.includes("single_line_diagram"), false);
    const mappingHistory =
      confirmed.application.agent_draft_metadata.application_package.package_review.mapping_history;
    assert.equal(mappingHistory.length, 1);
    assert.equal(mappingHistory[0].item_key, "single_line_diagram");
    assert.equal(mappingHistory[0].prior_mapping, null);
    assert.equal(mappingHistory[0].next_mapping.file_name, E601_FILE.fileName);

    const rebuilt = await runApplicationPackageBuild(supabase, {
      coordinationRecordId: COORD_ID,
      userId: USER_ID,
    });
    const rebuiltSld = rebuilt.application.package_documents.find(
      (d) => d.key === "single_line_diagram",
    );
    assert.equal(rebuiltSld?.status, "attached");
    assert.equal(rebuiltSld?.source, "pepco_portal");
    assert.equal(rebuiltSld?.idempotency_key, "pepco:e601");
  });

  it("confirms legacy PEPCO files using storage-path candidate ids", async () => {
    const legacyFile = { ...E601_FILE };
    delete legacyFile.idempotencyKey;

    const packageAppId = "pkg-app-legacy";
    const tables = {
      coordination_records: [
        {
          ...HUMAN_ASSISTED_RECORD,
          metadata: {
            pepco_application_detail_discovery: {
              applications: [
                {
                  applicationUuid: EXT_APP_ID,
                  documents: [{ documentName: legacyFile.documentName }],
                  downloadedFiles: [legacyFile],
                },
              ],
            },
          },
        },
      ],
      projects: [
        {
          id: PROJECT_ID,
          project_type: "tenant_improvement",
          address: "100 Main St",
          city: "Washington",
          state: "DC",
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT },
        {
          id: packageAppId,
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          package_documents: [],
          agent_draft_metadata: {},
          load_summary: {},
        },
      ],
    };

    const supabase = createBridgeMockSupabase(tables);
    const candidateId = pepcoCandidateId(legacyFile);
    assert.ok(candidateId?.includes("pepco_portal:path:"));

    const confirmed = await confirmPackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
      candidateId,
      externalApplicationId: EXT_APP_ID,
    });

    const sld = confirmed.package_documents.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.status, "attached");
    assert.equal(sld?.storage_path, legacyFile.storagePath);
  });

  it("remove mapping returns slot to missing", async () => {
    const packageAppId = "pkg-app-2";
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      projects: [
        {
          id: PROJECT_ID,
          project_type: "tenant_improvement",
          address: "100 Main St",
          city: "Washington",
          state: "DC",
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT },
        {
          id: packageAppId,
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          package_documents: [
            {
              key: "single_line_diagram",
              label: "Single-line diagram",
              status: "attached",
              source: "pepco_portal",
              user_confirmed: true,
              idempotency_key: "pepco:e601",
              storage_path: E601_FILE.storagePath,
              confirmed_by: USER_ID,
              confirmed_at: "2026-07-15T11:00:00.000Z",
            },
          ],
          agent_draft_metadata: {},
          load_summary: {},
        },
      ],
    };

    const supabase = createBridgeMockSupabase(tables);
    const removed = await removePackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
    });

    const sld = removed.package_documents.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.status, "missing");
    assert.ok(removed.missing_documents.includes("single_line_diagram"));
  });

  it("invalidates mapping when portal file is no longer stored", () => {
    const templateRequired = [
      { key: "single_line_diagram", label: "Single-line diagram", aliases: ["single_line"] },
    ];

    const result = resolvePackageDocumentSlots({
      requiredDocuments: templateRequired,
      projectDocuments: [],
      existingPackageDocuments: [
        {
          key: "single_line_diagram",
          source: "pepco_portal",
          user_confirmed: true,
          idempotency_key: "pepco:missing",
          confirmed_at: "2026-07-15T11:00:00.000Z",
        },
      ],
      pepcoPortalFiles: extractPepcoPortalFiles(HUMAN_ASSISTED_RECORD).map((f) => ({
        ...f,
        coordination_record_id: COORD_ID,
        project_id: PROJECT_ID,
      })),
      accessContext: {
        projectId: PROJECT_ID,
        coordinationRecordId: COORD_ID,
        tenantId: TENANT_A,
      },
    });

    assert.ok(result.missingDocuments.includes("single_line_diagram"));
  });

  it("rejects cross-project storage paths", () => {
    const ok = validatePepcoStoragePathForRecord(E601_FILE.storagePath, {
      projectId: PROJECT_ID,
      coordinationRecordId: COORD_ID,
      tenantId: TENANT_A,
    });
    assert.equal(ok, true);

    const badProject = validatePepcoStoragePathForRecord(
      `uci/${TENANT_A}/other-project/${COORD_ID}/pepco/${EXT_APP_ID}/file.pdf`,
      { projectId: PROJECT_ID, coordinationRecordId: COORD_ID, tenantId: TENANT_A },
    );
    assert.equal(badProject, false);
  });

  it("rejects candidate confirmation when coordination project mismatches", async () => {
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      project_documents: [],
      coordination_applications: [
        {
          id: "pkg-wrong",
          coordination_record_id: COORD_ID,
          project_id: "other-project",
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          package_documents: [],
        },
      ],
    };
    const supabase = createBridgeMockSupabase(tables);

    await assert.rejects(
      () =>
        confirmPackageDocumentMapping(supabase, {
          applicationId: "pkg-wrong",
          userId: USER_ID,
          slotKey: "single_line_diagram",
          candidateId: pepcoCandidateId(E601_FILE),
        }),
      (err) => {
        assert.equal(
          /** @type {{ code?: string }} */ (err).code,
          "COORDINATION_PROJECT_MISMATCH",
        );
        return true;
      },
    );
  });

  it("keeps existing project_documents auto matching", () => {
    const templateRequired = [
      { key: "site_plan", label: "Site plan", aliases: ["site_plan", "civil_plan"] },
      { key: "single_line_diagram", label: "SLD", aliases: ["single_line"] },
      { key: "equipment_cut_sheets", label: "Cut sheets", aliases: ["cut_sheet"] },
      { key: "letter_of_authorization", label: "LOA", aliases: ["loa"] },
    ];

    const result = resolvePackageDocumentSlots({
      requiredDocuments: templateRequired,
      projectDocuments: [
        { id: "doc-1", document_type: "site_plan", file_name: "site.pdf" },
      ],
      existingPackageDocuments: [],
      pepcoPortalFiles: [],
      accessContext: {
        projectId: PROJECT_ID,
        coordinationRecordId: COORD_ID,
        tenantId: TENANT_A,
      },
    });

    const site = result.packageDocuments.find((d) => d.key === "site_plan");
    assert.equal(site?.status, "attached");
    assert.equal(site?.source, "project_documents");
    assert.equal(site?.user_confirmed, undefined);
  });

  it("rejects cross-tenant storage namespace on portal file validation", () => {
    const wrongTenant = validatePepcoStoragePathForRecord(E601_FILE.storagePath, {
      projectId: PROJECT_ID,
      coordinationRecordId: COORD_ID,
      tenantId: "tenant-b-0000-4000-8000-000000000102",
    });
    assert.equal(wrongTenant, false);
  });

  it("does not create duplicate storage on confirmation", async () => {
    const packageAppId = "pkg-app-3";
    const tables = {
      coordination_records: [HUMAN_ASSISTED_RECORD],
      projects: [
        {
          id: PROJECT_ID,
          project_type: "tenant_improvement",
          address: "100 Main St",
          city: "Washington",
          state: "DC",
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT },
        {
          id: packageAppId,
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          package_documents: [],
          agent_draft_metadata: {},
          load_summary: {},
        },
      ],
    };
    const supabase = createBridgeMockSupabase(tables);

    await confirmPackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
      candidateId: pepcoCandidateId(E601_FILE),
    });

    const pkg = tables.coordination_applications.find((a) => a.id === packageAppId);
    const sld = pkg?.package_documents?.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.storage_path, E601_FILE.storagePath);
    assert.equal(tables.project_documents.length, 0);

    const beforeNoOp = JSON.stringify(pkg);
    const noOp = await confirmPackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
      candidateId: pepcoCandidateId(E601_FILE),
    });
    assert.equal(noOp.no_change, true);
    assert.equal(noOp.message, "Already mapped");
    assert.equal(JSON.stringify(pkg), beforeNoOp);
  });

  it("preserves address snapshot metadata on mapping refresh", async () => {
    const packageAppId = "pkg-app-4";
    const tables = {
      coordination_records: [
        {
          ...HUMAN_ASSISTED_RECORD,
          metadata: {
            ...HUMAN_ASSISTED_RECORD.metadata,
            uci_provider_mapping: {
              method: PROVIDER_SETUP_METHOD,
              address_source_acknowledged: "portal_data_location",
            },
          },
        },
      ],
      projects: [
        {
          id: PROJECT_ID,
          project_type: "tenant_improvement",
          address: "",
          portal_data: { location: "200 Sheridan Rd NW, Washington DC" },
        },
      ],
      project_documents: [],
      coordination_applications: [
        { ...LOAD_PROFILE_DRAFT },
        {
          id: packageAppId,
          coordination_record_id: COORD_ID,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
          package_documents: [],
          agent_draft_metadata: {
            application_package: {
              project_address: {
                formatted: "200 Sheridan Rd NW, Washington DC",
                source: "portal_data_location",
              },
            },
          },
          load_summary: {},
        },
      ],
    };

    const supabase = createBridgeMockSupabase(tables);
    const result = await confirmPackageDocumentMapping(supabase, {
      applicationId: packageAppId,
      userId: USER_ID,
      slotKey: "single_line_diagram",
      candidateId: pepcoCandidateId(E601_FILE),
    });

    const pkgMeta = result.application.agent_draft_metadata.application_package;
    assert.equal(pkgMeta.project_address.formatted, "200 Sheridan Rd NW, Washington DC");
    assert.equal(pkgMeta.project_address.source, "portal_data_location");
    assert.equal(pkgMeta.missing_fields.includes("connected_load_data"), true);
  });
});
