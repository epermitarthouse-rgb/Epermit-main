"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  RESET_SCOPE,
  isProductionSupabaseHost,
  auditCleanSlateReset,
  executeCleanSlateReset,
} = require("../app/services/uci/uci-clean-slate-reset.service.js");
const {
  stampCleanSlateMetadata,
  isMessageBeforeCleanSlate,
  readCleanSlateBoundary,
  scrubCoordinationMetadataForCleanSlate,
  listStaleRunMetadataKeys,
} = require("../app/services/uci/uci-clean-slate-run-boundary.util.js");
const { matchInboundToCoordination } = require("../app/services/uci/uci-communication-matcher.service.js");

function createMockSupabase(state) {
  const tables = state;
  return {
    from(table) {
      const rows = tables[table] || [];
      const ctx = {
        table,
        filters: [],
        inFilter: null,
        head: false,
        countExact: false,
        limitN: null,
        maybeSingleMode: false,
        updatePayload: null,
        deleteMode: false,
      };
      const builder = {
        select(_cols, opts) {
          if (opts?.head) ctx.head = true;
          if (opts?.count === "exact") ctx.countExact = true;
          return builder;
        },
        eq(col, val) {
          ctx.filters.push({ op: "eq", col, val });
          return builder;
        },
        in(col, vals) {
          ctx.inFilter = { col, vals };
          return builder;
        },
        order() {
          return builder;
        },
        limit(n) {
          ctx.limitN = n;
          return builder;
        },
        maybeSingle() {
          ctx.maybeSingleMode = true;
          return builder;
        },
        single() {
          ctx.maybeSingleMode = true;
          return builder;
        },
        update(payload) {
          ctx.updatePayload = payload;
          return builder;
        },
        delete() {
          ctx.deleteMode = true;
          return builder;
        },
        insert(row) {
          const list = tables[table] || (tables[table] = []);
          list.push(row);
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
        then(resolve, reject) {
          (async () => {
            try {
              if (ctx.deleteMode) {
                const before = rows.length;
                const kept = rows.filter((row) => !matchesFilters(row, ctx));
                tables[table] = kept;
                resolve({ data: null, error: null, count: before - kept.length });
                return;
              }
              if (ctx.updatePayload) {
                const target = rows.find((row) => matchesFilters(row, ctx));
                if (target) Object.assign(target, ctx.updatePayload);
                resolve({
                  data: ctx.maybeSingleMode ? target : rows.filter((row) => matchesFilters(row, ctx)),
                  error: null,
                });
                return;
              }
              let matched = rows.filter((row) => matchesFilters(row, ctx));
              if (ctx.limitN != null) matched = matched.slice(0, ctx.limitN);
              if (ctx.head && ctx.countExact) {
                resolve({ data: null, error: null, count: matched.length });
                return;
              }
              if (ctx.maybeSingleMode) {
                resolve({ data: matched[0] || null, error: null });
                return;
              }
              resolve({ data: matched, error: null, count: matched.length });
            } catch (err) {
              reject(err);
            }
          })();
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          remove: async () => ({ data: [], error: null }),
        };
      },
    },
  };
}

function matchesFilters(row, ctx) {
  for (const f of ctx.filters) {
    if (f.op === "eq" && String(row[f.col]) !== String(f.val)) return false;
  }
  if (ctx.inFilter) {
    const val = String(row[ctx.inFilter.col]);
    if (!ctx.inFilter.vals.map(String).includes(val)) return false;
  }
  return true;
}

describe("UCI clean-slate reset", () => {
  it("maps all preserve/delete/reset tables", () => {
    const tables = new Set(RESET_SCOPE.map((e) => `${e.table}:${e.action}`));
    assert.ok(tables.has("project_documents:delete"));
    assert.ok(tables.has("coordination_records:reset"));
    assert.ok(tables.has("microsoft_mailbox_connections:preserve"));
    assert.ok(tables.has("utility_providers:preserve"));
    assert.ok(tables.has("uci_document_registry_entries:delete"));
  });

  it("detects production Supabase hosts", () => {
    assert.equal(isProductionSupabaseHost("http://127.0.0.1:54321"), false);
    assert.equal(isProductionSupabaseHost("https://abc.supabase.co"), true);
  });

  it("stamps and reads clean_slate run boundary metadata", () => {
    const meta = stampCleanSlateMetadata(
      {
        lc_number: "451554",
        uci_provider_resolution: { status: "confirmed" },
        active_application_template: { "electric:new_service": { manifest: { version: "v2" } } },
      },
      { runId: "run-1", at: "2026-08-21T00:00:00.000Z" },
    );
    assert.equal(meta.lc_number, undefined);
    assert.equal(meta.active_application_template, undefined);
    assert.equal(meta.uci_provider_resolution.status, "confirmed");
    const boundary = readCleanSlateBoundary(meta);
    assert.equal(boundary?.run_id, "run-1");
    assert.equal(
      isMessageBeforeCleanSlate(meta, "2026-08-20T12:00:00.000Z"),
      true,
    );
    assert.equal(
      isMessageBeforeCleanSlate(meta, "2026-08-21T01:00:00.000Z"),
      false,
    );
  });

  it("dry-run audit returns counts without mutation", async () => {
    const projectId = "proj-1";
    const coordinationId = "coord-1";
    const tables = {
      projects: [{ id: projectId, name: "Portsmouth", utility_coordination_completed_at: "2026-01-01" }],
      coordination_records: [
        {
          id: coordinationId,
          project_id: projectId,
          utility_type: "electric",
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
          metadata: { lc_number: "451554" },
        },
      ],
      coordination_communications: [
        { id: "c1", coordination_record_id: coordinationId, project_id: projectId },
      ],
      coordination_applications: [
        { id: "a1", coordination_record_id: coordinationId, project_id: projectId },
      ],
      project_documents: [{ id: "d1", project_id: projectId, file_path: "p1/a.pdf" }],
      project_document_chunks: [{ id: "ch1", project_id: projectId, document_id: "d1" }],
      microsoft_mailbox_connections: [{ id: "mb1", mailbox_email: "ops@example.com" }],
      uci_unmatched_inbound_messages: [{ id: "u1", project_id: projectId }],
    };
    const supabase = createMockSupabase(tables);
    const audit = await auditCleanSlateReset(supabase, {
      projectId,
      coordinationId,
      dryRun: true,
    });
    assert.equal(audit.dry_run, true);
    assert.equal(tables.coordination_communications.length, 1);
    assert.equal(tables.project_documents.length, 1);
    const commRow = audit.table_audit.find((r) => r.table === "coordination_communications");
    assert.equal(commRow?.action, "delete");
    assert.equal(commRow?.rows, 1);
    const mailboxRow = audit.table_audit.find((r) => r.table === "microsoft_mailbox_connections");
    assert.equal(mailboxRow?.action, "preserve");
  });

  it("blocks production apply without explicit allow flag", async () => {
    const supabase = createMockSupabase({
      projects: [{ id: "p1", name: "X" }],
      coordination_records: [{ id: "c1", project_id: "p1", metadata: {} }],
      project_documents: [],
      microsoft_mailbox_connections: [],
    });
    await assert.rejects(
      () =>
        executeCleanSlateReset(supabase, {
          projectId: "p1",
          coordinationId: "c1",
          dryRun: false,
          supabaseUrl: "https://prod.supabase.co",
        }),
      (err) => err.code === "PRODUCTION_GUARD",
    );
  });

  it("rejects coordination/project mismatch", async () => {
    const supabase = createMockSupabase({
      projects: [{ id: "p1", name: "X" }],
      coordination_records: [{ id: "c1", project_id: "p2", metadata: {} }],
    });
    await assert.rejects(
      () =>
        auditCleanSlateReset(supabase, {
          projectId: "p1",
          coordinationId: "c1",
          dryRun: true,
        }),
      (err) => err.code === "COORDINATION_PROJECT_MISMATCH",
    );
  });

  it("matcher ignores pre-clean-slate inbound for stamped coordination", async () => {
    const supabase = createMockSupabase({
      coordination_records: [
        {
          id: "coord-1",
          project_id: "proj-1",
          utility_provider_id: "prov-1",
          metadata: stampCleanSlateMetadata({}, {
            runId: "run-2",
            at: "2026-08-21T10:00:00.000Z",
          }),
        },
      ],
      coordination_applications: [],
      utility_providers: [{ id: "prov-1", slug: "dominion" }],
      coordination_communications: [],
    });
    const match = await matchInboundToCoordination(
      supabase,
      {
        raw_subject: "DOM-DEMO ack LC 451554",
        raw_body: "ticket 123",
        sender: "demo@dominion.com",
        message_timestamp: "2026-08-20T09:00:00.000Z",
      },
      { projectId: "proj-1" },
    );
    assert.equal(match.matched, false);
  });

  it("scrubs prior-run metadata caches but preserves provider setup", () => {
    const scrubbed = scrubCoordinationMetadataForCleanSlate({
      uci_provider_resolution: { status: "confirmed" },
      uci_provider_mapping: { provider_slug: "dominion" },
      uci_site_address: { formatted: "100 Main St" },
      provider_setup: { confirmed: true },
      uci_document_processing: { applications: { x: { findings: [1, 2, 3] } } },
      stage2_readiness: { ready: true },
      stage_5_acknowledgment: { utility_pm: "Alex Morgan" },
      uci_cos_analysis: { status: "approved" },
      uci_meter_set: { scheduled_date: "2026-09-15" },
      closeout_artifacts: { utility_confirmation: {} },
      uci_closeout_package: { generated_at: "2026-01-01" },
      lc_number: "451554",
      active_application_template: { "electric:new_service": {} },
    });
    assert.equal(scrubbed.uci_provider_resolution.status, "confirmed");
    assert.equal(scrubbed.uci_provider_mapping.provider_slug, "dominion");
    assert.equal(scrubbed.uci_site_address.formatted, "100 Main St");
    assert.equal(scrubbed.provider_setup.confirmed, true);
    assert.equal(scrubbed.uci_document_processing, undefined);
    assert.equal(scrubbed.stage2_readiness, undefined);
    assert.equal(scrubbed.stage_5_acknowledgment, undefined);
    assert.equal(scrubbed.uci_cos_analysis, undefined);
    assert.equal(scrubbed.lc_number, undefined);
    assert.equal(listStaleRunMetadataKeys(scrubbed).length, 0);
  });

  it("apply deletes workflow rows and resets coordination in place", async () => {
    const projectId = "proj-1";
    const coordinationId = "coord-1";
    const tables = {
      projects: [{ id: projectId, name: "Portsmouth", utility_coordination_completed_at: "2026-01-01" }],
      coordination_records: [
        {
          id: coordinationId,
          project_id: projectId,
          utility_type: "electric",
          current_stage: 6,
          current_stage_state: "IN_PROGRESS",
          metadata: {
            lc_number: "451554",
            uci_provider_resolution: { status: "confirmed" },
            uci_document_processing: { applications: { a: { findings: [1] } } },
            stage_5_acknowledgment: { utility_pm: "Alex Morgan" },
            active_application_template: {
              "electric:new_service": {
                manifest: { version: "dominion-electric-full-demo-v2", required_documents: [{}, {}, {}, {}, {}, {}, {}, {}] },
              },
            },
          },
        },
      ],
      coordination_communications: [
        { id: "c1", coordination_record_id: coordinationId, project_id: projectId },
      ],
      coordination_applications: [
        { id: "a1", coordination_record_id: coordinationId, project_id: projectId },
      ],
      coordination_stage_transitions: [
        { id: "t1", coordination_record_id: coordinationId, project_id: projectId },
      ],
      coordination_costs: [],
      coordination_equipment: [],
      coordination_milestones: [],
      coordination_cos_design_records: [],
      submission_preparations: [],
      submission_validation_attempts: [],
      submission_transmission_attempts: [],
      uci_document_registry_entries: [],
      uci_coordination_document_links: [],
      uci_portal_harvest_links: [],
      uci_unmatched_inbound_messages: [{ id: "u1", project_id: projectId }],
      scrape_jobs: [],
      document_ingestion_jobs: [],
      project_documents: [{ id: "d1", project_id: projectId, file_path: "p1/a.pdf" }],
      project_document_chunks: [{ id: "ch1", project_id: projectId, document_id: "d1" }],
      document_comments: [],
      document_annotations: [],
      microsoft_mailbox_connections: [{ id: "mb1" }],
    };
    const supabase = createMockSupabase(tables);
    const result = await executeCleanSlateReset(supabase, {
      projectId,
      coordinationId,
      dryRun: false,
      supabaseUrl: "http://127.0.0.1:54321",
      runId: "run-test",
      resetAt: "2026-08-21T12:00:00.000Z",
    });
    assert.equal(result.applied, true);
    assert.equal(tables.coordination_communications.length, 0);
    assert.equal(tables.project_documents.length, 0);
    assert.equal(tables.uci_unmatched_inbound_messages.length, 0);
    assert.equal(tables.coordination_records[0].current_stage, 1);
    assert.equal(tables.coordination_records[0].current_stage_state, "NOT_STARTED");
    assert.equal(tables.coordination_records[0].metadata.lc_number, undefined);
    assert.equal(tables.coordination_records[0].metadata.active_application_template, undefined);
    assert.equal(tables.coordination_records[0].metadata.uci_document_processing, undefined);
    assert.equal(tables.coordination_records[0].metadata.stage_5_acknowledgment, undefined);
    assert.equal(tables.coordination_records[0].metadata.uci_provider_resolution.status, "confirmed");
    assert.ok(tables.coordination_records[0].metadata.uci_clean_slate);
    assert.equal(tables.projects[0].utility_coordination_completed_at, null);
    assert.equal(tables.microsoft_mailbox_connections.length, 1);
  });

  it("document registry cleared so new uploads receive fresh UUIDs", async () => {
    const projectId = "proj-1";
    const coordinationId = "coord-1";
    const tables = {
      projects: [{ id: projectId, name: "X" }],
      coordination_records: [{ id: coordinationId, project_id: projectId, metadata: {} }],
      uci_document_registry_entries: [
        {
          id: "reg-1",
          coordination_record_id: coordinationId,
          project_document_id: "old-doc",
        },
      ],
      project_documents: [{ id: "old-doc", project_id: projectId, file_path: "x.pdf" }],
      coordination_communications: [],
      coordination_applications: [],
      coordination_stage_transitions: [],
      coordination_costs: [],
      coordination_equipment: [],
      coordination_milestones: [],
      coordination_cos_design_records: [],
      submission_preparations: [],
      submission_validation_attempts: [],
      submission_transmission_attempts: [],
      uci_coordination_document_links: [],
      uci_portal_harvest_links: [],
      uci_unmatched_inbound_messages: [],
      scrape_jobs: [],
      document_ingestion_jobs: [],
      project_document_chunks: [],
      document_comments: [],
      document_annotations: [],
      microsoft_mailbox_connections: [],
    };
    const supabase = createMockSupabase(tables);
    await executeCleanSlateReset(supabase, {
      projectId,
      coordinationId,
      dryRun: false,
      supabaseUrl: "http://127.0.0.1:54321",
    });
    assert.equal(tables.uci_document_registry_entries.length, 0);
    assert.equal(tables.project_documents.length, 0);
  });
});
