"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocumentUtilityScope,
  isBlockedCrossUtilityAutoInclude,
  shouldAutoIncludeDocument,
  formatProvenanceLabel,
  resolveScopedProjectDocuments,
  linkProjectDocumentsToCoordination,
  unlinkProjectDocumentFromCoordination,
  getLoadProfileDocumentScope,
} = require("../app/services/uci/uci-coordination-document-links.service.js");
const { runLoadProfileAnalysis } = require("../app/services/uci/uci-load-profile.service.js");
const { importDocumentFindingsToLoadProfile } = require("../app/services/uci/uci-document-findings-bridge.service.js");
const { discoverAllUciDocuments } = require("../app/services/uci/uci-document-processing.service.js");

const PROJECT_ID = "proj-1";
const GAS_COORD = "coord-gas-1";
const USER_ID = "user-1";

function gasRecord(overrides = {}) {
  return {
    id: GAS_COORD,
    project_id: PROJECT_ID,
    tenant_id: "tenant-1",
    utility_provider_id: "prov-gas",
    utility_type: "gas",
    metadata: {
      uci_provider_mapping: {
        method: "human_assisted",
        provider_slug: "washington-gas",
      },
    },
    utility_providers: { slug: "washington-gas", name: "Washington Gas", utility_type: "gas" },
    ...overrides,
  };
}

function projectDoc(overrides = {}) {
  return {
    id: "doc-1",
    project_id: PROJECT_ID,
    document_type: "other",
    file_name: "file.pdf",
    file_path: `${PROJECT_ID}/file.pdf`,
    file_type: "application/pdf",
    description: "",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockSupabase(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      const filters = [];
      const state = { mode: "select", patch: null, insertRow: null };

      const matches = (row) =>
        filters.every((f) => {
          if (f.op === "in") return f.values.map(String).includes(String(row[f.column]));
          if (f.op === "is") {
            if (f.value == null) return row[f.column] == null;
            return row[f.column] === f.value;
          }
          return String(row[f.column]) === String(f.value);
        });

      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        in(column, values) {
          filters.push({ column, values, op: "in" });
          return api;
        },
        is(column, value) {
          filters.push({ column, value, op: "is" });
          return api;
        },
        order() {
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: store.find(matches) ?? null, error: null });
        },
        single() {
          if (state.mode === "insert" && state.insertRow) {
            return Promise.resolve({ data: state.insertRow, error: null });
          }
          const row = store.find(matches);
          if (row && state.mode === "update" && state.patch) Object.assign(row, state.patch);
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = row;
          if (!row.id) {
            const copy = { id: `${table}-${store.length + 1}`, ...row };
            store.push(copy);
            state.insertRow = copy;
          } else {
            store.push(row);
          }
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.patch = patch;
          return api;
        },
        then(resolve, reject) {
          try {
            if (state.mode === "update") {
              const row = store.find(matches);
              if (row && state.patch) Object.assign(row, state.patch);
              return resolve({ data: row ?? null, error: null });
            }
            if (state.mode === "insert") {
              return resolve({ data: state.insertRow, error: null });
            }
            return resolve({ data: store.filter(matches), error: null });
          } catch (err) {
            if (reject) return reject(err);
            throw err;
          }
        },
      };
      return api;
    },
  };
}

describe("UCI Load Profile document scope classification", () => {
  it("classifies electric COS, one-line, panel, and load letter as electric", () => {
    assert.equal(classifyDocumentUtilityScope({ file_name: "PEPCO Class of Service.pdf" }).utilityType, "electric");
    assert.equal(classifyDocumentUtilityScope({ file_name: "E601 ELECTRICAL ONE-LINE DIAGRAMS.pdf" }).utilityType, "electric");
    assert.equal(classifyDocumentUtilityScope({ file_name: "E602 ELECTRICAL PANEL SCHEDULES.pdf" }).utilityType, "electric");
    assert.equal(classifyDocumentUtilityScope({ file_name: "Electric Load Letter.pdf" }).utilityType, "electric");
  });

  it("does not auto-include electric COS/one-line/panel/load letter on a gas record", () => {
    for (const name of [
      "COS_Design.pdf",
      "E601 ONE-LINE.pdf",
      "PANEL SCHEDULE.pdf",
      "Electric Load Letter.pdf",
    ]) {
      const classification = classifyDocumentUtilityScope({ file_name: name });
      assert.equal(
        shouldAutoIncludeDocument({
          classification,
          recordUtilityType: "gas",
          uploadedToRecord: false,
          inboundMatched: false,
        }),
        false,
        name,
      );
      assert.equal(isBlockedCrossUtilityAutoInclude(classification, "gas"), true, name);
    }
  });

  it("auto-includes high-confidence gas documents on a gas record", () => {
    const classification = classifyDocumentUtilityScope({ file_name: "Washington Gas Load Letter.pdf" });
    assert.equal(classification.utilityType, "gas");
    assert.equal(
      shouldAutoIncludeDocument({
        classification,
        recordUtilityType: "gas",
        uploadedToRecord: false,
        inboundMatched: false,
      }),
      true,
    );
  });

  it("preserves electric provenance labels on a gas record", () => {
    const record = gasRecord();
    const doc = projectDoc({ file_name: "Dominion Energy one-line.pdf" });
    const classification = classifyDocumentUtilityScope(doc);
    const label = formatProvenanceLabel(record, doc, {
      source_utility_type: classification.utilityType,
      relevance: "cross_utility",
      source_provider_name: "Dominion Energy",
    });
    assert.match(label, /Electric/i);
    assert.doesNotMatch(label, /^Gas\b/);
    assert.match(label, /Dominion Energy/);
  });
});

describe("UCI Load Profile scoped analysis", () => {
  it("gas analysis ignores unrelated electric project documents by default", async () => {
    const record = gasRecord();
    const tables = {
      coordination_records: [record],
      projects: [{ id: PROJECT_ID, square_footage: 2000, address: "1 Main", city: "DC", state: "DC", zip_code: "20001" }],
      project_documents: [
        projectDoc({ id: "cos", file_name: "PEPCO Class of Service.pdf" }),
        projectDoc({ id: "oneline", file_name: "E601 ELECTRICAL ONE-LINE DIAGRAMS.pdf" }),
        projectDoc({ id: "load", file_name: "Electric Load Letter.pdf" }),
        projectDoc({ id: "gas-load", file_name: "Washington Gas Load Letter.pdf" }),
      ],
      coordination_equipment: [],
      coordination_applications: [],
      uci_coordination_document_links: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const result = await runLoadProfileAnalysis(createMockSupabase(tables), {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
      });
      const names = (result.load_summary.source_documents || []).map((d) => d.file_name);
      assert.ok(names.includes("Washington Gas Load Letter.pdf"));
      assert.ok(!names.includes("PEPCO Class of Service.pdf"));
      assert.ok(!names.includes("E601 ELECTRICAL ONE-LINE DIAGRAMS.pdf"));
      assert.ok(!names.includes("Electric Load Letter.pdf"));
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("multi-file gas upload links all selected documents and includes them", async () => {
    const record = gasRecord();
    const uploaded = [
      projectDoc({
        id: "up-1",
        file_name: "meter-photo.pdf",
        description: `Load Profile Analyzer upload · coordination ${GAS_COORD}`,
      }),
      projectDoc({
        id: "up-2",
        file_name: "site-notes.pdf",
        description: `Load Profile Analyzer upload · coordination ${GAS_COORD}`,
      }),
    ];
    const tables = {
      coordination_records: [record],
      project_documents: uploaded,
      uci_coordination_document_links: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const linked = await linkProjectDocumentsToCoordination(createMockSupabase(tables), {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["up-1", "up-2"],
        includedInAnalysis: true,
        linkOrigin: "manual",
      });
      assert.equal(linked.selected_for_analysis_count, 2);
      assert.deepEqual(linked.linked_document_ids.sort(), ["up-1", "up-2"]);
      assert.ok(linked.used.every((row) => row.included_in_analysis));
      assert.equal(tables.uci_coordination_document_links.length, 2);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("lets the operator opt in an electric document without relabeling it as gas", async () => {
    const record = gasRecord();
    const electric = projectDoc({
      id: "elec-1",
      file_name: "Dominion Energy one-line.pdf",
    });
    const tables = {
      coordination_records: [record],
      project_documents: [electric],
      uci_coordination_document_links: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const scopeBefore = await getLoadProfileDocumentScope(createMockSupabase(tables), {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
      });
      assert.equal(scopeBefore.used.length, 0);
      assert.equal(scopeBefore.other_project_documents.length, 1);

      const linked = await linkProjectDocumentsToCoordination(createMockSupabase(tables), {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["elec-1"],
        includedInAnalysis: true,
        linkOrigin: "manual",
      });
      assert.equal(linked.used.length, 1);
      assert.equal(linked.used[0].source_utility_type, "electric");
      assert.equal(linked.used[0].relevance, "cross_utility");
      assert.match(linked.used[0].provenance_label, /Electric/i);
      assert.doesNotMatch(linked.used[0].provenance_label, /^Gas\b/);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("does not create duplicate associations on repeated selection", async () => {
    const record = gasRecord();
    const tables = {
      coordination_records: [record],
      project_documents: [projectDoc({ id: "dup-1", file_name: "Washington Gas Load Letter.pdf" })],
      uci_coordination_document_links: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const supabase = createMockSupabase(tables);
      await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["dup-1"],
      });
      await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["dup-1"],
      });
      assert.equal(tables.uci_coordination_document_links.length, 1);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("unlinking removes the document from future analysis without deleting the project document", async () => {
    const record = gasRecord();
    const tables = {
      coordination_records: [record],
      project_documents: [projectDoc({ id: "keep-1", file_name: "Washington Gas Load Letter.pdf" })],
      uci_coordination_document_links: [],
      coordination_applications: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const supabase = createMockSupabase(tables);
      await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["keep-1"],
      });
      const unlinked = await unlinkProjectDocumentFromCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        projectDocumentId: "keep-1",
        userId: USER_ID,
      });
      assert.equal(unlinked.project_document_deleted, false);
      assert.equal(unlinked.project_document_present, true);
      assert.equal(tables.project_documents.length, 1);
      assert.equal(tables.uci_coordination_document_links[0].included_in_analysis, false);
      assert.ok(tables.uci_coordination_document_links[0].unlinked_at);

      const scoped = await resolveScopedProjectDocuments(supabase, { record, userId: USER_ID });
      assert.equal(scoped.scopedDocuments.length, 0);
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("re-analysis processes only currently included documents", async () => {
    const record = gasRecord();
    const tables = {
      coordination_records: [record],
      projects: [{ id: PROJECT_ID, square_footage: 1200, address: "2 Main", city: "DC", state: "DC", zip_code: "20001" }],
      project_documents: [
        projectDoc({ id: "gas-1", file_name: "Washington Gas Load Letter.pdf" }),
        projectDoc({ id: "elec-1", file_name: "Electric Load Letter.pdf" }),
      ],
      coordination_equipment: [],
      coordination_applications: [],
      uci_coordination_document_links: [],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const supabase = createMockSupabase(tables);
      await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["elec-1"],
      });
      await unlinkProjectDocumentFromCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        projectDocumentId: "elec-1",
        userId: USER_ID,
      });
      const result = await runLoadProfileAnalysis(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
      });
      const names = (result.load_summary.source_documents || []).map((d) => d.file_name);
      assert.ok(names.includes("Washington Gas Load Letter.pdf"));
      assert.ok(!names.includes("Electric Load Letter.pdf"));
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("opted-in electric documents contribute findings during import", async () => {
    const record = gasRecord({
      metadata: {
        uci_provider_mapping: { method: "human_assisted", provider_slug: "washington-gas" },
        uci_document_processing: {
          schema_version: "row-doc-v2",
          applications: {
            __manual__: {
              external_application_id: "",
              project_id: PROJECT_ID,
              tenant_id: "tenant-1",
              documents: [
                {
                  document_id: "uci_doc:elec",
                  source_type: "project_document",
                  source_document_id: "elec-1",
                  original_filename: "Electric Load Letter.pdf",
                  processing_status: "complete",
                  findings_count: 1,
                },
              ],
              findings: [
                {
                  finding_id: "f-elec-1",
                  document_id: "uci_doc:elec",
                  source_document_id: "elec-1",
                  field_key: "connected_load_kw",
                  raw_value: "200",
                  normalized_value: 200,
                  unit: "kW",
                  evidence_text: "connected load 200 kW",
                  source_content_hash: "hash-elec",
                  source_type: "project_document",
                  source_document_name: "Electric Load Letter.pdf",
                  extraction_method: "pdf_text",
                  uci_stages: ["agent_2_load_profile"],
                  category: "connected_load",
                  verification_status: "raw",
                  schema_version: "row-doc-v2",
                  project_id: PROJECT_ID,
                },
              ],
              findings_by_stage: {
                agent_2_load_profile: [
                  {
                    finding_id: "f-elec-1",
                    document_id: "uci_doc:elec",
                    source_document_id: "elec-1",
                    field_key: "connected_load_kw",
                    raw_value: "200",
                    normalized_value: 200,
                    unit: "kW",
                    evidence_text: "connected load 200 kW",
                    source_content_hash: "hash-elec",
                    source_type: "project_document",
                    source_document_name: "Electric Load Letter.pdf",
                    extraction_method: "pdf_text",
                    uci_stages: ["agent_2_load_profile"],
                    category: "connected_load",
                    verification_status: "raw",
                    schema_version: "row-doc-v2",
                    project_id: PROJECT_ID,
                  },
                ],
              },
            },
          },
        },
      },
    });
    const tables = {
      coordination_records: [record],
      project_documents: [projectDoc({ id: "elec-1", file_name: "Electric Load Letter.pdf" })],
      uci_coordination_document_links: [],
      coordination_applications: [
        {
          id: "draft-1",
          coordination_record_id: GAS_COORD,
          project_id: PROJECT_ID,
          record_source: "agent_draft",
          idempotency_key: "agent_2_load_profile:d2.1-v1",
          load_summary: {
            utility_type: "gas",
            candidate_values: [],
            verified_values: {},
            missing_inputs: [],
          },
        },
      ],
    };
    const originalGet = require("../app/services/uci/uci-records.service.js").getCoordinationRecordById;
    require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = async () => record;
    try {
      const supabase = createMockSupabase(tables);
      const skipped = await importDocumentFindingsToLoadProfile(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        externalApplicationId: "",
      });
      assert.ok(
        skipped.findings_skipped > 0 || skipped.candidates_created === 0,
        "unlinked electric findings must not import",
      );

      await linkProjectDocumentsToCoordination(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        projectDocumentIds: ["elec-1"],
        includedInAnalysis: true,
      });
      const imported = await importDocumentFindingsToLoadProfile(supabase, {
        coordinationRecordId: GAS_COORD,
        userId: USER_ID,
        externalApplicationId: "",
      });
      assert.ok(imported.candidates_created >= 1 || imported.candidates_reused >= 1);
      const draft = tables.coordination_applications[0];
      assert.ok(
        (draft.load_summary.candidate_values || []).some(
          (c) => String(c.source_document_id) === "elec-1" && c.status !== "stale",
        ),
      );
    } finally {
      require("../app/services/uci/uci-records.service.js").getCoordinationRecordById = originalGet;
    }
  });

  it("discoverAllUciDocuments honors an explicit included project-document set", () => {
    const record = gasRecord();
    const discovery = discoverAllUciDocuments(record, {
      externalApplicationId: "",
      projectDocuments: [
        projectDoc({
          id: "gas-1",
          file_name: "Washington Gas Load Letter.pdf",
          description: `Load Profile Analyzer upload · coordination ${GAS_COORD}`,
        }),
        projectDoc({
          id: "elec-1",
          file_name: "Electric Load Letter.pdf",
          description: `Load Profile Analyzer upload · coordination ${GAS_COORD}`,
        }),
      ],
      includedProjectDocumentIds: new Set(["gas-1"]),
    });
    assert.equal(discovery.documents.length, 1);
    assert.equal(discovery.documents[0].source_document_id, "gas-1");
  });
});
