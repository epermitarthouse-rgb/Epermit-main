/**
 * Export-audit contract for the Supabase Code Analyzer.
 * Events go in public.supabase_analyzer_audit_events (existing table). No new migration.
 * Request vs generation are separate. Client receipt is never recorded.
 */

export const ANALYZER_EXPORT_FORMATS = [
  "architect-review-pdf",
  "findings-register-xlsx",
  "sheet-order-pdf",
  "json",
] as const;
export type AnalyzerExportFormat = (typeof ANALYZER_EXPORT_FORMATS)[number];

export const ANALYZER_EXPORT_STAGES = ["requested", "generated", "failed"] as const;
export type AnalyzerExportStage = (typeof ANALYZER_EXPORT_STAGES)[number];

export const ANALYZER_EXPORT_EVENT_TYPE = {
  requested: "report_export_requested",
  generated: "report_generated",
  failed: "report_generation_failed",
} as const;

export const ANALYZER_EXPORT_CLIENT_RECEIPT = "not_recorded";

export const ANALYZER_EXPORT_GENERATION = {
  requested: "not_started",
  generated: "succeeded",
  failed: "failed",
} as const;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_VERSION_LENGTH = 80;
const MAX_ERROR_LENGTH = 200;
const MAX_FINDING_COUNT = 100_000;
const FORBIDDEN_PAYLOAD_KEYS = [
  "findings",
  "observation",
  "title",
  "recommendation",
  "modified_response",
  "drawing_evidence",
] as const;

export interface ExportAuditMetadata {
  format: AnalyzerExportFormat;
  stage: AnalyzerExportStage;
  report_version: string;
  fingerprint: string;
  model_version: string;
  layout_version: string;
  disclaimer_version: string;
  catalogue_version: null;
  published_findings: number;
  presented_findings: number;
  withdrawn_findings: number;
  presented_critical: number;
  presented_warning: number;
  presented_advisory: number;
  is_final: boolean;
  generation: (typeof ANALYZER_EXPORT_GENERATION)[AnalyzerExportStage];
  client_receipt: typeof ANALYZER_EXPORT_CLIENT_RECEIPT;
  error?: string;
}

export type ParsedExportAudit =
  | { ok: true; eventType: string; metadata: ExportAuditMetadata }
  | { ok: false; error: string };

export function reportIdentityKeywords(input: {
  fingerprintDigest: string;
  modelVersion: string;
  layoutVersion: string;
  disclaimerVersion: string;
}): string {
  return `report-version ${input.fingerprintDigest}; ${input.modelVersion}; ${input.layoutVersion}; ${input.disclaimerVersion}`;
}

export function isAnalyzerExportFormat(value: unknown): value is AnalyzerExportFormat {
  return typeof value === "string" && (ANALYZER_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isAnalyzerExportStage(value: unknown): value is AnalyzerExportStage {
  return typeof value === "string" && (ANALYZER_EXPORT_STAGES as readonly string[]).includes(value);
}

function readField(body: Record<string, unknown>, snake: string, camel: string): unknown {
  return body[snake] !== undefined ? body[snake] : body[camel];
}

function asTrimmedString(value: unknown, field: string, max = MAX_VERSION_LENGTH): string | { error: string } {
  if (typeof value !== "string") return { error: `${field} is required` };
  const trimmed = value.trim();
  if (!trimmed) return { error: `${field} is required` };
  if (trimmed.length > max) return { error: `${field} is too long` };
  return trimmed;
}

function asCount(value: unknown, field: string): number | { error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_FINDING_COUNT) {
    return { error: `${field} must be a whole number` };
  }
  return value;
}

function truncateError(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_ERROR_LENGTH);
}

export function parseExportAuditRequest(input: unknown): ParsedExportAudit {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Export audit payload is required" };
  }
  const body = input as Record<string, unknown>;
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    if (body[key] !== undefined) {
      return { ok: false, error: "Export audit must not include finding content" };
    }
  }

  const format = readField(body, "format", "format");
  if (!isAnalyzerExportFormat(format)) return { ok: false, error: "Unsupported export format" };

  const stage = readField(body, "stage", "stage");
  if (!isAnalyzerExportStage(stage)) return { ok: false, error: "Unsupported export stage" };

  const reportVersion = asTrimmedString(readField(body, "report_version", "reportVersion"), "report_version", 64);
  if (typeof reportVersion !== "string") return { ok: false, error: reportVersion.error };

  const fingerprint = asTrimmedString(readField(body, "fingerprint", "fingerprint"), "fingerprint", 64);
  if (typeof fingerprint !== "string") return { ok: false, error: fingerprint.error };
  if (!FINGERPRINT_PATTERN.test(fingerprint)) return { ok: false, error: "fingerprint must be a SHA-256 digest" };

  const modelVersion = asTrimmedString(readField(body, "model_version", "modelVersion"), "model_version");
  if (typeof modelVersion !== "string") return { ok: false, error: modelVersion.error };

  const layoutVersion = asTrimmedString(readField(body, "layout_version", "layoutVersion"), "layout_version");
  if (typeof layoutVersion !== "string") return { ok: false, error: layoutVersion.error };

  const disclaimerVersion = asTrimmedString(
    readField(body, "disclaimer_version", "disclaimerVersion"),
    "disclaimer_version",
  );
  if (typeof disclaimerVersion !== "string") return { ok: false, error: disclaimerVersion.error };

  const published = asCount(readField(body, "published_findings", "publishedFindings"), "published_findings");
  if (typeof published !== "number") return { ok: false, error: published.error };

  const presented = asCount(readField(body, "presented_findings", "presentedFindings"), "presented_findings");
  if (typeof presented !== "number") return { ok: false, error: presented.error };

  const withdrawn = asCount(readField(body, "withdrawn_findings", "withdrawnFindings"), "withdrawn_findings");
  if (typeof withdrawn !== "number") return { ok: false, error: withdrawn.error };

  const presentedCritical = asCount(readField(body, "presented_critical", "presentedCritical"), "presented_critical");
  if (typeof presentedCritical !== "number") return { ok: false, error: presentedCritical.error };

  const presentedWarning = asCount(readField(body, "presented_warning", "presentedWarning"), "presented_warning");
  if (typeof presentedWarning !== "number") return { ok: false, error: presentedWarning.error };

  const presentedAdvisory = asCount(readField(body, "presented_advisory", "presentedAdvisory"), "presented_advisory");
  if (typeof presentedAdvisory !== "number") return { ok: false, error: presentedAdvisory.error };

  const isFinalRaw = readField(body, "is_final", "isFinal");
  if (typeof isFinalRaw !== "boolean") return { ok: false, error: "is_final must be a boolean" };

  const metadata: ExportAuditMetadata = {
    format,
    stage,
    report_version: reportVersion,
    fingerprint: fingerprint.toLowerCase(),
    model_version: modelVersion,
    layout_version: layoutVersion,
    disclaimer_version: disclaimerVersion,
    catalogue_version: null,
    published_findings: published,
    presented_findings: presented,
    withdrawn_findings: withdrawn,
    presented_critical: presentedCritical,
    presented_warning: presentedWarning,
    presented_advisory: presentedAdvisory,
    is_final: isFinalRaw,
    generation: ANALYZER_EXPORT_GENERATION[stage],
    client_receipt: ANALYZER_EXPORT_CLIENT_RECEIPT,
  };
  if (stage === "failed") {
    const error = truncateError(readField(body, "error", "error"));
    if (error) metadata.error = error;
  }
  return {
    ok: true,
    eventType: ANALYZER_EXPORT_EVENT_TYPE[stage],
    metadata,
  };
}

export interface ExportAuditInvokeInput {
  format: AnalyzerExportFormat;
  stage: AnalyzerExportStage;
  reportVersion: string;
  fingerprint: string;
  modelVersion: string;
  layoutVersion: string;
  disclaimerVersion: string;
  publishedFindings: number;
  presentedFindings: number;
  withdrawnFindings: number;
  presentedCritical: number;
  presentedWarning: number;
  presentedAdvisory: number;
  isFinal: boolean;
  error?: string;
}

export function exportAuditInvokeFields(input: ExportAuditInvokeInput): Record<string, unknown> {
  return {
    format: input.format,
    stage: input.stage,
    report_version: input.reportVersion,
    fingerprint: input.fingerprint,
    model_version: input.modelVersion,
    layout_version: input.layoutVersion,
    disclaimer_version: input.disclaimerVersion,
    published_findings: input.publishedFindings,
    presented_findings: input.presentedFindings,
    withdrawn_findings: input.withdrawnFindings,
    presented_critical: input.presentedCritical,
    presented_warning: input.presentedWarning,
    presented_advisory: input.presentedAdvisory,
    is_final: input.isFinal,
    error: input.error ?? null,
  };
}
