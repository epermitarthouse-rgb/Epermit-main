import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArchitectReviewModel, fingerprintArchitectReview, ARCHITECT_REVIEW_MODEL_VERSION } from "./architectReview.ts";
import { BRANDED_REPORT_LAYOUT_VERSION, renderArchitectReviewPdf } from "./brandedReport.ts";
import {
  ANALYZER_EXPORT_CLIENT_RECEIPT,
  ANALYZER_EXPORT_EVENT_TYPE,
  ANALYZER_EXPORT_GENERATION,
  EXPORT_LAYOUT_VERSION,
  buildExportAuditContext,
  parseExportAuditRequest,
  recordExportAuditSafely,
  reportIdentityKeywords,
  withAnalyzerExportAudit,
} from "./exportAudit.ts";
import { FINDINGS_REGISTER_LAYOUT_VERSION, buildFindingsRegisterWorkbook, resolveExcelJS } from "./findingsRegister.ts";
import { DISCLAIMER_VERSION } from "./reportBranding.ts";
import { fixtureDataset, review } from "./fixtures/architectReviewFixtures.ts";
import ExcelJS from "exceljs";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));
const DIGEST = "a".repeat(64);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    format: "architect-review-pdf",
    stage: "requested",
    report_version: "aaaa-aaaa-aaaa",
    fingerprint: DIGEST,
    model_version: ARCHITECT_REVIEW_MODEL_VERSION,
    layout_version: BRANDED_REPORT_LAYOUT_VERSION,
    disclaimer_version: DISCLAIMER_VERSION,
    published_findings: 252,
    presented_findings: 251,
    withdrawn_findings: 1,
    presented_critical: 4,
    presented_warning: 82,
    presented_advisory: 165,
    is_final: true,
    ...overrides,
  };
}

describe("export audit contract", () => {
  it("stores request and generation as different events and never claims client receipt", () => {
    const requested = parseExportAuditRequest(payload({ stage: "requested" }));
    const generated = parseExportAuditRequest(payload({ stage: "generated" }));
    const failed = parseExportAuditRequest(payload({ stage: "failed", error: "renderer exploded" }));
    assert.equal(requested.ok, true);
    assert.equal(generated.ok, true);
    assert.equal(failed.ok, true);
    if (requested.ok !== true || generated.ok !== true || failed.ok !== true) return;
    assert.equal(requested.eventType, ANALYZER_EXPORT_EVENT_TYPE.requested);
    assert.equal(generated.eventType, ANALYZER_EXPORT_EVENT_TYPE.generated);
    assert.equal(failed.eventType, ANALYZER_EXPORT_EVENT_TYPE.failed);
    assert.notEqual(requested.eventType, generated.eventType);
    assert.equal(requested.metadata.generation, ANALYZER_EXPORT_GENERATION.requested);
    assert.equal(generated.metadata.generation, ANALYZER_EXPORT_GENERATION.generated);
    assert.equal(generated.metadata.client_receipt, ANALYZER_EXPORT_CLIENT_RECEIPT);
    assert.equal(generated.metadata.client_receipt, "not_recorded");
    assert.equal(generated.metadata.catalogue_version, null);
    assert.equal(failed.metadata.error, "renderer exploded");
    assert.equal(requested.metadata.error, undefined);
  });

  it("ignores a client-supplied delivery claim and rejects finding content", () => {
    const generated = parseExportAuditRequest(payload({
      stage: "generated",
      client_receipt: "delivered",
      generation: "delivered",
    }));
    assert.equal(generated.ok, true);
    if (generated.ok !== true) return;
    assert.equal(generated.metadata.client_receipt, "not_recorded");
    assert.equal(generated.metadata.generation, "succeeded");
    const leaked = parseExportAuditRequest(payload({ findings: [{ title: "Do not store this" }] }));
    assert.equal(leaked.ok, false);
    if (leaked.ok !== false) return;
    assert.match(leaked.error, /finding content/);
  });

  it("accepts camelCase from the browser and rejects a truncated fingerprint", () => {
    const parsed = parseExportAuditRequest({
      format: "findings-register-xlsx",
      stage: "generated",
      reportVersion: "bbbb-cccc-dddd",
      fingerprint: DIGEST.toUpperCase(),
      modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
      layoutVersion: FINDINGS_REGISTER_LAYOUT_VERSION,
      disclaimerVersion: DISCLAIMER_VERSION,
      publishedFindings: 10,
      presentedFindings: 9,
      withdrawnFindings: 1,
      presentedCritical: 1,
      presentedWarning: 2,
      presentedAdvisory: 6,
      isFinal: false,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok !== true) return;
    assert.equal(parsed.metadata.fingerprint, DIGEST);
    assert.equal(parsed.metadata.layout_version, FINDINGS_REGISTER_LAYOUT_VERSION);
    assert.equal(parsed.metadata.is_final, false);
    const bad = parseExportAuditRequest(payload({ fingerprint: "abcd" }));
    assert.equal(bad.ok, false);
  });
});

describe("export audit recording", () => {
  it("records requested then generated, and a send failure does not block the download", async () => {
    const events: string[] = [];
    const result = await withAnalyzerExportAudit({
      send: async (request) => {
        events.push(request.stage);
        if (request.stage === "generated") throw new Error("audit unavailable");
      },
      dataset: fixtureDataset().dataset,
      format: "architect-review-pdf",
      generate: async () => "bytes",
    });
    assert.equal(result, "bytes");
    assert.deepEqual(events, ["requested", "generated"]);
  });

  it("records failed generation after the renderer throws, without swallowing the error", async () => {
    const events: string[] = [];
    await assert.rejects(
      () => withAnalyzerExportAudit({
        send: async (request) => {
          events.push(`${request.stage}:${request.format}`);
        },
        dataset: fixtureDataset().dataset,
        format: "findings-register-xlsx",
        generate: async () => {
          throw new Error("workbook failed");
        },
      }),
      /workbook failed/,
    );
    assert.deepEqual(events, ["requested:findings-register-xlsx", "failed:findings-register-xlsx"]);
  });

  it("returns false from a rejected send instead of throwing", async () => {
    const recorded = await recordExportAuditSafely(
      async () => {
        throw new Error("network down");
      },
      {
        projectId: "project-1",
        runId: "run-1",
        format: "json",
        stage: "requested",
        reportVersion: "aaaa-aaaa-aaaa",
        fingerprint: DIGEST,
        modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
        layoutVersion: EXPORT_LAYOUT_VERSION.json,
        disclaimerVersion: DISCLAIMER_VERSION,
        publishedFindings: 0,
        presentedFindings: 0,
        withdrawnFindings: 0,
        presentedCritical: 0,
        presentedWarning: 0,
        presentedAdvisory: 0,
        isFinal: true,
      },
    );
    assert.equal(recorded, false);
  });

  it("builds PDF and Excel audit context from the same fingerprint, model and disclaimer", async () => {
    const { dataset } = fixtureDataset();
    const ids = new Map(buildArchitectReviewModel(dataset).findings.map((item) => [item.reportId, item.findingId]));
    const reviewed = {
      ...dataset,
      reviews: [review(ids.get("W-010")!, "rejected")],
    };
    const pdf = await buildExportAuditContext(reviewed, "architect-review-pdf");
    const excel = await buildExportAuditContext(reviewed, "findings-register-xlsx");
    const model = buildArchitectReviewModel(reviewed);
    const fingerprint = await fingerprintArchitectReview(reviewed);
    assert.equal(pdf.fingerprint, excel.fingerprint);
    assert.equal(pdf.fingerprint, fingerprint.digest);
    assert.equal(pdf.modelVersion, excel.modelVersion);
    assert.equal(pdf.disclaimerVersion, excel.disclaimerVersion);
    assert.equal(pdf.disclaimerVersion, DISCLAIMER_VERSION);
    assert.equal(pdf.layoutVersion, BRANDED_REPORT_LAYOUT_VERSION);
    assert.equal(excel.layoutVersion, FINDINGS_REGISTER_LAYOUT_VERSION);
    assert.equal(pdf.publishedFindings, 252);
    assert.equal(pdf.presentedFindings, 251);
    assert.equal(pdf.withdrawnFindings, 1);
    assert.equal(model.totals.withdrawn, 1);
    assert.equal(pdf.isFinal, true);
  });
});

describe("PDF and Excel report identity", () => {
  it("stamps the same keyword formula with format-specific layout versions", async () => {
    const dataset = fixtureDataset().dataset;
    const model = buildArchitectReviewModel(dataset);
    const fingerprint = await fingerprintArchitectReview(dataset);
    const generatedAt = new Date("2026-10-28T15:00:00Z");
    const pdf = renderArchitectReviewPdf({
      dataset,
      model,
      fingerprint,
      projectName: "Fixture project",
      generatedAt,
      logo: null,
    });
    const { workbook } = buildFindingsRegisterWorkbook(resolveExcelJS(ExcelJS), {
      dataset,
      model,
      fingerprint,
      projectName: "Fixture project",
      generatedAt,
    });
    const expectedPdf = reportIdentityKeywords({
      fingerprintDigest: fingerprint.digest,
      modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
      layoutVersion: BRANDED_REPORT_LAYOUT_VERSION,
      disclaimerVersion: DISCLAIMER_VERSION,
    });
    const expectedExcel = reportIdentityKeywords({
      fingerprintDigest: fingerprint.digest,
      modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
      layoutVersion: FINDINGS_REGISTER_LAYOUT_VERSION,
      disclaimerVersion: DISCLAIMER_VERSION,
    });
    const pdfBytes = Buffer.from(pdf.doc.output("arraybuffer")).toString("latin1");
    assert.ok(pdfBytes.includes(fingerprint.digest));
    assert.ok(pdfBytes.includes(ARCHITECT_REVIEW_MODEL_VERSION));
    assert.ok(pdfBytes.includes(BRANDED_REPORT_LAYOUT_VERSION));
    assert.ok(pdfBytes.includes(DISCLAIMER_VERSION));
    assert.equal(workbook.keywords, expectedExcel);
    assert.equal(expectedPdf.includes(BRANDED_REPORT_LAYOUT_VERSION), true);
    assert.equal(expectedExcel.includes(FINDINGS_REGISTER_LAYOUT_VERSION), true);
    assert.equal(expectedPdf.includes(fingerprint.digest), true);
    assert.equal(expectedExcel.includes(fingerprint.digest), true);
    assert.equal(expectedPdf.includes(ARCHITECT_REVIEW_MODEL_VERSION), true);
    assert.equal(expectedExcel.includes(DISCLAIMER_VERSION), true);
    assert.notEqual(expectedPdf, expectedExcel);
  });
});

describe("export audit wiring", () => {
  it("reuses supabase_analyzer_audit_events and does not add a table, processor call or delivery event", () => {
    const runs = readFileSync(join(here, "../../../supabase/functions/supabase-analyzer-runs/index.ts"), "utf8");
    const auditSql = readFileSync(join(here, "../../../supabase/migrations/20261022033000_supabase_code_analyzer.sql"), "utf8");
    const reviewSql = readFileSync(join(here, "../../../supabase/migrations/20261022153000_supabase_analyzer_finding_reviews.sql"), "utf8");
    const start = runs.indexOf('if (action === "record_export")');
    const unsupported = runs.indexOf('return json({ error: "Unsupported action" }');
    assert.ok(start > 0);
    const block = runs.slice(start, unsupported);
    assert.match(block, /parseExportAuditRequest/);
    assert.match(block, /supabase_analyzer_audit_events/);
    assert.equal(block.includes("triggerProcessor"), false);
    assert.equal(block.includes("supabase_analyzer_findings"), false);
    assert.equal(block.includes("supabase_analyzer_finding_reviews"), false);
    assert.match(runs, /action === "record_export" \? "member"/);
    assert.match(runs, /has_project_access/);
    assert.equal(runs.includes("report_exported"), false);
    assert.match(auditSql, /CREATE TABLE public\.supabase_analyzer_audit_events/);
    assert.equal(auditSql.includes("ON public.supabase_analyzer_audit_events FOR INSERT"), false);
    assert.match(reviewSql, /finding_review_saved/);
    assert.equal(reviewSql.includes("UPDATE public.supabase_analyzer_findings"), false);
  });
});
