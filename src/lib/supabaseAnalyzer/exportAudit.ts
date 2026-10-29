/**
 * Client-side export audit: fire-and-forget around report generation.
 * Failures are logged and never thrown into the download path.
 * A recorded "generated" event means the file was produced locally, not that the browser delivered it.
 */
import {
  ARCHITECT_REVIEW_MODEL_VERSION,
  buildArchitectReviewModel,
  fingerprintArchitectReview,
} from "@/lib/supabaseAnalyzer/architectReview";
import { BRANDED_REPORT_LAYOUT_VERSION } from "@/lib/supabaseAnalyzer/brandedReport";
import type { AnalyzerRunDataset } from "@/lib/supabaseAnalyzer/client";
import { SUPABASE_ANALYZER_EXPORT_SCHEMA } from "@/lib/supabaseAnalyzer/exportDataset";
import { FINDINGS_REGISTER_LAYOUT_VERSION } from "@/lib/supabaseAnalyzer/findingsRegister";
import { DISCLAIMER_VERSION } from "@/lib/supabaseAnalyzer/reportBranding";
import {
  exportAuditInvokeFields,
  parseExportAuditRequest,
  type AnalyzerExportFormat,
  type ExportAuditInvokeInput,
} from "../../../supabase/functions/_shared/analyzerExportAudit.ts";

export {
  ANALYZER_EXPORT_CLIENT_RECEIPT,
  ANALYZER_EXPORT_EVENT_TYPE,
  ANALYZER_EXPORT_FORMATS,
  ANALYZER_EXPORT_GENERATION,
  ANALYZER_EXPORT_STAGES,
  parseExportAuditRequest,
  reportIdentityKeywords,
  type AnalyzerExportFormat,
  type AnalyzerExportStage,
  type ExportAuditMetadata,
} from "../../../supabase/functions/_shared/analyzerExportAudit.ts";

export const SHEET_ORDER_REPORT_LAYOUT_VERSION = "sheet-order-pdf.v1";

export const EXPORT_LAYOUT_VERSION: Record<AnalyzerExportFormat, string> = {
  "architect-review-pdf": BRANDED_REPORT_LAYOUT_VERSION,
  "findings-register-xlsx": FINDINGS_REGISTER_LAYOUT_VERSION,
  "sheet-order-pdf": SHEET_ORDER_REPORT_LAYOUT_VERSION,
  json: SUPABASE_ANALYZER_EXPORT_SCHEMA,
};

export type ExportAuditClientRequest = ExportAuditInvokeInput & {
  projectId: string;
  runId: string;
};

export async function buildExportAuditContext(
  dataset: AnalyzerRunDataset,
  format: AnalyzerExportFormat,
): Promise<Omit<ExportAuditClientRequest, "stage" | "error">> {
  const model = buildArchitectReviewModel(dataset);
  const fingerprint = await fingerprintArchitectReview(dataset);
  return {
    projectId: dataset.run.project_id,
    runId: dataset.run.id,
    format,
    reportVersion: fingerprint.label,
    fingerprint: fingerprint.digest,
    modelVersion: ARCHITECT_REVIEW_MODEL_VERSION,
    layoutVersion: EXPORT_LAYOUT_VERSION[format],
    disclaimerVersion: DISCLAIMER_VERSION,
    publishedFindings: model.totals.published.all,
    presentedFindings: model.totals.client.all,
    withdrawnFindings: model.totals.withdrawn,
    presentedCritical: model.totals.client.critical,
    presentedWarning: model.totals.client.warning,
    presentedAdvisory: model.totals.client.advisory,
    isFinal: model.isFinal,
  };
}

export async function recordExportAuditSafely(
  send: (request: ExportAuditClientRequest) => Promise<unknown>,
  request: ExportAuditClientRequest,
): Promise<boolean> {
  const parsed = parseExportAuditRequest(exportAuditInvokeFields(request));
  if (parsed.ok === false) {
    console.error("[supabase-analyzer] export audit payload was rejected", parsed.error);
    return false;
  }
  try {
    await send(request);
    return true;
  } catch (error) {
    console.error("[supabase-analyzer] export audit was not recorded", error);
    return false;
  }
}

export async function withAnalyzerExportAudit<T>(input: {
  send: (request: ExportAuditClientRequest) => Promise<unknown>;
  dataset: AnalyzerRunDataset;
  format: AnalyzerExportFormat;
  generate: () => Promise<T>;
}): Promise<T> {
  const context = await buildExportAuditContext(input.dataset, input.format).catch((error) => {
    console.error("[supabase-analyzer] export audit context failed", error);
    return null;
  });
  if (context) {
    await recordExportAuditSafely(input.send, { ...context, stage: "requested" });
  }
  try {
    const result = await input.generate();
    if (context) {
      await recordExportAuditSafely(input.send, { ...context, stage: "generated" });
    }
    return result;
  } catch (error) {
    if (context) {
      await recordExportAuditSafely(input.send, {
        ...context,
        stage: "failed",
        error: error instanceof Error ? error.message : "export failed",
      });
    }
    throw error;
  }
}
