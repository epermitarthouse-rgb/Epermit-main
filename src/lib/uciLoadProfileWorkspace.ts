/**
 * Agent 2 load-profile workspace — presentation and derivation layer.
 * Uses existing load_summary contracts; does not invent engineering values.
 */

import {
  deduplicateCandidatesForDisplay,
  formatCandidateEntityLabel,
  formatCandidateFieldLabel,
  getLoadReviewTabCandidates,
  getLoadReviewTabCounts,
  getStage2MissingInputs,
  isConnectedLoadSatisfied,
  isPendingLoadReviewCandidate,
  isUnresolvedLoadCandidate,
  parseLoadProfileSummary,
  verifiedValueSatisfiesConnectedLoad,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";
import type { UciDocumentManifestEntry } from "@/lib/uciDocumentProcessing";

export type LoadDataLevel = 1 | 2 | 3 | 4 | 5;

export type LoadProfileWorkspaceState =
  | "not_analyzed"
  | "extraction_available"
  | "needs_review"
  | "missing_engineering_inputs"
  | "ready_for_service_sizing"
  | "ready_for_application_package"
  | "blocked";

export type WorkspaceSection =
  | "overview"
  | "source_documents"
  | "verified_inputs"
  | "load_schedule"
  | "service_sizing"
  | "review_queue"
  | "package_readiness";

export const DEFAULT_WORKSPACE_SECTION: WorkspaceSection = "overview";
export const WORKSPACE_SECTION_STORAGE_KEY = "uci-load-profile-workspace-section";

export function getLoadProfileScopeCopy({
  providerName,
  providerSlug,
  selectedApplicationId,
}: {
  providerName?: string | null;
  providerSlug?: string | null;
  selectedApplicationId?: string | null;
}): string {
  const normalizedName = providerName?.trim() || null;
  const normalizedSlug = providerSlug?.trim().toLowerCase() || null;
  const isPepco = normalizedSlug === "pepco";

  if (isPepco && selectedApplicationId) {
    return `Portal extraction is scoped to the selected ${normalizedName || "PEPCO"} application. Manual and project uploads do not require a portal application.`;
  }

  if (isPepco) {
    return `Select a ${normalizedName || "PEPCO"} application to scope portal extraction. Manual and project uploads do not require a portal application.`;
  }

  if (normalizedName) {
    return `Review ${normalizedName} documents from project and manual uploads. A portal application is not required.`;
  }

  return "Review project and manual-upload documents. A portal application is not required.";
}

export type DocumentCategory =
  | "service_application"
  | "one_line_diagram"
  | "panel_schedules"
  | "load_calculations"
  | "equipment_schedules"
  | "comcheck"
  | "electrical_specifications"
  | "other";

export type ChecklistItemStatus = "complete" | "missing" | "needs_review" | "not_applicable";

export type TemplateStatus = "none" | "draft" | "approved";

export type SourceDocumentStatus =
  | "parsed_candidates"
  | "parsed_no_candidates"
  | "pending"
  | "failed"
  | "needs_fallback";

export interface LoadProfileOverview {
  workspaceState: LoadProfileWorkspaceState;
  workspaceStateLabel: string;
  completionPercent: number;
  packageReady: boolean;
  connectedLoadSatisfied: boolean;
  verifiedProjectDemandSatisfied: boolean;
  hasOnlyPanelEvidence: boolean;
  humanReviewRequired: boolean;
  missingInputs: string[];
  blockingIssues: string[];
  lastExtractedAt: string | null;
  lastApprovalAt: string | null;
  templateStatus: TemplateStatus;
  templateName: string | null;
  templateVersion: string | null;
}

export interface SourceDocumentRow {
  documentKey: string;
  documentName: string;
  sourceLabel: string;
  sourceType: string;
  externalApplicationId: string | null;
  category: DocumentCategory;
  categoryLabel: string;
  processingStatus: "available" | "processed" | "failed" | "ranked";
  textExtractionStatus: "parsed" | "failed" | "unknown" | "not_attempted";
  pageCount: number | null;
  contentHash: string | null;
  candidateCount: number;
  findingsCount: number;
  failureReason: string | null;
  status: SourceDocumentStatus;
  statusLabel: string;
  statusReason: string | null;
  rankScore: number | null;
  rankReasons: string[];
}

export interface VerifiedInputRow {
  id: string;
  group: "project_service" | "equipment" | "panels" | "supporting";
  label: string;
  value: string;
  unit: string | null;
  dataLevel: LoadDataLevel;
  method: string;
  sourceDocument: string;
  page: number | null;
  evidence: string;
  approvedBy: string;
  approvedAt: string;
  reviewNote: string | null;
  entityLabel: string | null;
  satisfiesPackage: boolean;
}

export interface LoadScheduleRow {
  id: string;
  category: string;
  quantity: number | null;
  connectedLoad: number | null;
  continuousLoad: number | null;
  nonContinuousLoad: number | null;
  demandFactor: number | null;
  demandFactorSource: string | null;
  demandFactorDisplay: string;
  demandAdjustedLoad: number | null;
  unit: string | null;
  source: string;
  verificationStatus: "verified" | "unresolved";
  dataLevel: LoadDataLevel;
}

export interface LoadScheduleTotals {
  connectedKw: number | null;
  connectedKva: number | null;
  demandKw: number | null;
  demandKva: number | null;
  canFinalize: boolean;
  finalizeMessage: string;
}

export interface ServiceSizingField {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  origin: "extracted" | "user_entered" | "calculated" | "approved" | "needs_verification";
  source: string;
  evidence: string | null;
  approved: boolean;
}

export interface ServiceSizingRecommendation {
  status: "approved" | "requires_human_input" | "missing_inputs" | "needs_review";
  message: string;
  missingInputs: string[];
}

export interface PackageReadinessItem {
  key: string;
  label: string;
  status: ChecklistItemStatus;
  detail: string;
}

export interface ManualVerifiedInputPayload {
  field_key: string;
  value: string | number;
  unit?: string;
  entity_type?: string;
  entity_name?: string;
  source_document_name?: string;
  page_number?: number | null;
  evidence_text?: string;
  source_reference?: string;
  review_note?: string;
}

const PROJECT_CONNECTED_KEYS = new Set([
  "connected_load_kw",
  "connected_load_kva",
  "demand_load_kw",
  "demand_load_kva",
]);

const PROJECT_DEMAND_KEYS = new Set(["demand_load_kw", "demand_load_kva"]);

const PANEL_PREFIX = "panel_";

const SERVICE_FIELD_KEYS = new Set([
  "service_amperage",
  "requested_voltage",
  "service_voltage",
  "phase",
  "meter_count",
  "service_configuration",
  "wire_configuration",
  "construction_start_date",
  "construction_completion_date",
  "requested_in_service_date",
]);

const EQUIPMENT_COUNT_KEYS: Record<string, string> = {
  central_ac_count: "Central AC",
  central_heat_count: "Central heat",
};

const NUMERIC_UNIT_REQUIRED = new Set([
  ...PROJECT_CONNECTED_KEYS,
  "service_amperage",
  "requested_voltage",
  "service_voltage",
  "meter_count",
  ...Object.keys(EQUIPMENT_COUNT_KEYS),
]);

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  service_application: "Service application",
  one_line_diagram: "One-line diagram",
  panel_schedules: "Panel schedules",
  load_calculations: "Load calculations",
  equipment_schedules: "Equipment schedules",
  comcheck: "COMcheck",
  electrical_specifications: "Electrical specifications",
  other: "Other supporting documents",
};

const CATEGORY_PATTERNS: Array<{ category: DocumentCategory; pattern: RegExp }> = [
  { category: "panel_schedules", pattern: /\bpanel[\s-]*schedule/i },
  { category: "one_line_diagram", pattern: /\b(one[\s-]*line|single[\s-]*line)/i },
  { category: "load_calculations", pattern: /\bload[\s-]*calc/i },
  { category: "equipment_schedules", pattern: /\bequipment[\s-]*(utility[\s-]*)?schedule/i },
  { category: "comcheck", pattern: /\bcom[\s-]*check/i },
  { category: "electrical_specifications", pattern: /\belectrical[\s-]*spec/i },
  { category: "service_application", pattern: /\bservice[\s-]*application/i },
];

export const MANUAL_VERIFIABLE_FIELD_OPTIONS = [
  { field_key: "connected_load_kw", label: "Connected load", unit: "kW", entity_type: "project_service" },
  { field_key: "connected_load_kva", label: "Connected load", unit: "kVA", entity_type: "project_service" },
  { field_key: "demand_load_kw", label: "Demand load", unit: "kW", entity_type: "project_service" },
  { field_key: "demand_load_kva", label: "Demand load", unit: "kVA", entity_type: "project_service" },
  { field_key: "service_amperage", label: "Service amperage", unit: "A", entity_type: "project_service" },
  { field_key: "requested_voltage", label: "Requested voltage", unit: "V", entity_type: "project_service" },
  { field_key: "service_voltage", label: "Service voltage", unit: "V", entity_type: "project_service" },
  { field_key: "phase", label: "Service phase", unit: "phase", entity_type: "project_service" },
  { field_key: "meter_count", label: "Meter count", unit: "count", entity_type: "project_service" },
  { field_key: "service_configuration", label: "Service configuration", unit: "", entity_type: "project_service" },
  { field_key: "wire_configuration", label: "Wire configuration", unit: "", entity_type: "project_service" },
  { field_key: "construction_start_date", label: "Construction start date", unit: "", entity_type: "project_service" },
  { field_key: "construction_completion_date", label: "Construction completion date", unit: "", entity_type: "project_service" },
  { field_key: "requested_in_service_date", label: "Requested in-service date", unit: "", entity_type: "project_service" },
] as const;

export function readStoredWorkspaceSection(): WorkspaceSection {
  if (typeof sessionStorage === "undefined") return DEFAULT_WORKSPACE_SECTION;
  const stored = sessionStorage.getItem(WORKSPACE_SECTION_STORAGE_KEY);
  const allowed: WorkspaceSection[] = [
    "overview",
    "source_documents",
    "verified_inputs",
    "load_schedule",
    "service_sizing",
    "review_queue",
    "package_readiness",
  ];
  return allowed.includes(stored as WorkspaceSection)
    ? (stored as WorkspaceSection)
    : DEFAULT_WORKSPACE_SECTION;
}

export function persistWorkspaceSection(section: WorkspaceSection): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(WORKSPACE_SECTION_STORAGE_KEY, section);
}

export function getDataLevelLabel(level: LoadDataLevel): string {
  switch (level) {
    case 1:
      return "Level 1 — Raw evidence";
    case 2:
      return "Level 2 — Candidate input";
    case 3:
      return "Level 3 — Verified input";
    case 4:
      return "Level 4 — Calculated schedule";
    case 5:
      return "Level 5 — Frozen package value";
    default:
      return `Level ${level}`;
  }
}

export function getCandidateDataLevel(candidate: UciLoadCandidate): LoadDataLevel {
  if (candidate.status === "approved") return 3;
  return 2;
}

export function getVerifiedDataLevel(): LoadDataLevel {
  return 3;
}

export function inferDocumentCategory(name: string, reasons: string[] = []): DocumentCategory {
  const combined = `${name} ${reasons.join(" ")}`;
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(combined)) return category;
  }
  return "other";
}

function sourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case "pepco_portal_document":
      return "Utility portal";
    case "project_document":
      return "Project document";
    case "manual_upload":
      return "Manual upload";
    case "provider_application":
      return "Application metadata";
    default:
      return "Supporting source";
  }
}

export function deriveSourceDocumentStatus(
  doc: UciDocumentManifestEntry,
): Pick<SourceDocumentRow, "status" | "statusLabel" | "statusReason"> {
  const pageRecords = doc.page_records ?? [];
  if (doc.fallback_status === "unavailable") {
    return {
      status: "needs_fallback",
      statusLabel: "OCR/Vision fallback unavailable",
      statusReason: "Required fallback provider is disabled or not configured",
    };
  }
  if (doc.fallback_status === "attempted_failed") {
    if (Number(doc.findings_count ?? 0) > 0) {
      return {
        status: "parsed_candidates",
        statusLabel: "Parsed with fallback warning",
        statusReason:
          doc.failure_reason ||
          "Deterministic parsing succeeded, but one or more fallback pages failed",
      };
    }
    return {
      status: "needs_fallback",
      statusLabel: "OCR/Vision fallback failed",
      statusReason: doc.failure_reason || "Fallback was attempted but one or more pages failed",
    };
  }
  if (doc.fallback_status === "manual_review_required") {
    return {
      status: "needs_fallback",
      statusLabel: "Manual review required",
      statusReason: doc.failure_reason || "Automated extraction cannot resolve one or more pages",
    };
  }
  const fallbackPending =
    Number(doc.page_coverage?.fallback_pending ?? 0) > 0 ||
    pageRecords.some((page) =>
      [
        "vision_required",
        "vision_processing",
        "vision_failed",
        "ocr_required",
        "ocr_processing",
        "ocr_failed",
        "human_required",
      ].includes(String(page.status ?? "")),
    ) ||
    doc.findings_extraction_status === "vision_required_for_structured_findings";

  if (fallbackPending) {
    const count = Number(doc.page_coverage?.fallback_pending ?? 0);
    return {
      status: "needs_fallback",
      statusLabel: "Needs OCR/Vision fallback",
      statusReason:
        count > 0
          ? `${count} page${count === 1 ? "" : "s"} awaiting fallback processing`
          : doc.failure_reason || "Structured extraction requires fallback or manual review",
    };
  }

  if (doc.processing_status === "failed" || doc.processing_status === "unsupported") {
    return {
      status: "failed",
      statusLabel: "Failed processing",
      statusReason: doc.failure_reason || "Document processing failed",
    };
  }

  if (doc.processing_status === "pending" || doc.processing_status === "processing") {
    return {
      status: "pending",
      statusLabel: "Pending processing",
      statusReason:
        doc.processing_status === "processing"
          ? "Document processing is in progress"
          : "Document has not been processed",
    };
  }

  if (doc.findings_count > 0 || doc.findings_extraction_status === "findings_created") {
    return {
      status: "parsed_candidates",
      statusLabel: "Parsed — candidates found",
      statusReason: null,
    };
  }

  return {
    status: "parsed_no_candidates",
    statusLabel: "Parsed — no relevant candidates",
    statusReason:
      doc.findings_extraction_status === "no_supported_findings"
        ? "Parsing completed but produced no supported findings"
        : null,
  };
}

function hasProjectLevelVerifiedLoad(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.verified_values) return false;
  return Object.entries(summary.verified_values).some(
    ([key, entry]) =>
      PROJECT_CONNECTED_KEYS.has(key) && verifiedValueSatisfiesConnectedLoad(key, entry),
  );
}

export function hasVerifiedProjectDemand(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.verified_values) return false;
  return Object.entries(summary.verified_values).some(
    ([key, entry]) =>
      PROJECT_DEMAND_KEYS.has(key) && verifiedValueSatisfiesConnectedLoad(key, entry),
  );
}

function hasOnlyPanelVerifiedOrCandidateEvidence(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): boolean {
  if (!summary) return false;
  if (hasProjectLevelVerifiedLoad(summary)) return false;
  const verifiedPanel = Object.keys(summary.verified_values ?? {}).some((k) =>
    k.startsWith(PANEL_PREFIX),
  );
  const candidates = summary.candidate_values ?? [];
  const scoped = externalApplicationId
    ? candidates.filter(
        (c) => !c.external_application_id || c.external_application_id === externalApplicationId,
      )
    : candidates;
  const activePanel = scoped.some(
    (c) =>
      c.status !== "stale" &&
      c.status !== "rejected" &&
      (c.entity_type === "electrical_panel" || c.field_key.startsWith(PANEL_PREFIX)),
  );
  return verifiedPanel || activePanel;
}

function getLastApprovalAt(summary: UciLoadProfileSummary | null): string | null {
  if (!summary?.verified_values) return null;
  const dates = Object.values(summary.verified_values)
    .map((v) => v.approved_at)
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function verifiedKeysForMissingInput(missingInput: string): string[] {
  switch (missingInput) {
    case "connected_equipment_or_load_data":
      return [...PROJECT_CONNECTED_KEYS, "connected_equipment_or_load_data"];
    case "requested_voltage":
      return ["requested_voltage"];
    case "phase":
      return ["phase"];
    case "meter_count":
      return ["meter_count"];
    case "service_configuration":
      return ["service_configuration", "wire_configuration"];
    case "construction_schedule":
      return [
        "construction_start_date",
        "construction_completion_date",
        "requested_in_service_date",
      ];
    default:
      return [missingInput];
  }
}

function inputHasCandidate(summary: UciLoadProfileSummary, missingInput: string): boolean {
  const keys = verifiedKeysForMissingInput(missingInput);
  return (summary.candidate_values ?? []).some(
    (candidate) => candidate.status === "candidate" && keys.includes(candidate.field_key),
  );
}

function isCandidateBlockingStage2(
  candidate: UciLoadCandidate,
  missingInputs: string[],
): boolean {
  if (candidate.status !== "candidate") return false;
  return missingInputs.some((input) =>
    verifiedKeysForMissingInput(input).includes(candidate.field_key),
  );
}

export function getTemplateStatus(summary: UciLoadProfileSummary | null): {
  status: TemplateStatus;
  name: string | null;
  version: string | null;
} {
  const templateId = summary?.assumptions?.template_id ?? null;
  const templateVersion = summary?.assumptions?.template_version ?? null;
  if (!templateId) return { status: "none", name: null, version: null };
  return { status: "draft", name: templateId, version: templateVersion };
}

export function getLoadProfileOverview(
  summary: UciLoadProfileSummary | null,
  options: {
    externalApplicationId?: string | null;
    packageConnectedLoadSatisfied?: boolean;
    packageStatus?: string | null;
    stage2Completed?: boolean;
  } = {},
): LoadProfileOverview {
  const connectedLoadSatisfied = isConnectedLoadSatisfied(summary);
  const verifiedProjectDemandSatisfied = hasVerifiedProjectDemand(summary);
  const hasOnlyPanel = hasOnlyPanelVerifiedOrCandidateEvidence(
    summary,
    options.externalApplicationId,
  );
  const counts = getLoadReviewTabCounts(summary, options.externalApplicationId);
  const template = getTemplateStatus(summary);
  const effectiveMissingInputs = summary ? getStage2MissingInputs(summary) : [];
  const blockingReviewCandidates = summary
    ? (summary.candidate_values ?? []).filter((candidate) =>
        isCandidateBlockingStage2(candidate, effectiveMissingInputs),
      ).length
    : 0;

  const blockingIssues: string[] = [];
  if (!summary) {
    if (options.stage2Completed) {
      return {
        workspaceState: "ready_for_application_package",
        workspaceStateLabel: "Stage 2 complete",
        completionPercent: 100,
        packageReady: options.packageStatus === "ready_for_review",
        connectedLoadSatisfied: false,
        verifiedProjectDemandSatisfied: false,
        hasOnlyPanelEvidence: false,
        humanReviewRequired: false,
        missingInputs: [],
        blockingIssues: [],
        lastExtractedAt: null,
        lastApprovalAt: null,
        templateStatus: template.status,
        templateName: template.name,
        templateVersion: template.version,
      };
    }
    return {
      workspaceState: "not_analyzed",
      workspaceStateLabel: "Not analyzed",
      completionPercent: 0,
      packageReady: false,
      connectedLoadSatisfied: false,
      verifiedProjectDemandSatisfied: false,
      hasOnlyPanelEvidence: false,
      humanReviewRequired: true,
      missingInputs: [],
      blockingIssues: ["Run load profile analysis to begin"],
      lastExtractedAt: null,
      lastApprovalAt: null,
      templateStatus: template.status,
      templateName: template.name,
      templateVersion: template.version,
    };
  }

  if (summary.analysis_status === "blocked") {
    blockingIssues.push("Load profile analysis is blocked");
  }
  if (hasOnlyPanel && !connectedLoadSatisfied) {
    blockingIssues.push(
      "Panel-level evidence cannot satisfy project-level connected load requirement",
    );
  }
  if (effectiveMissingInputs.length > 0) {
    blockingIssues.push(
      ...effectiveMissingInputs.map((input) =>
        inputHasCandidate(summary, input)
          ? `Needs verification: ${input.replace(/_/g, " ")}`
          : `Missing input: ${input.replace(/_/g, " ")}`,
      ),
    );
  }

  let workspaceState: LoadProfileWorkspaceState = "extraction_available";
  if (summary.analysis_status === "blocked") workspaceState = "blocked";
  else if (blockingReviewCandidates > 0) workspaceState = "needs_review";
  else if (effectiveMissingInputs.length > 0 || !connectedLoadSatisfied)
    workspaceState = "missing_engineering_inputs";
  else if (connectedLoadSatisfied) {
    const serviceVerified = hasVerifiedServiceFacts(summary);
    workspaceState = serviceVerified
      ? options.packageConnectedLoadSatisfied
        ? "ready_for_application_package"
        : "ready_for_service_sizing"
      : "missing_engineering_inputs";
  }

  const completionPercent = computeCompletionPercent(
    summary,
    connectedLoadSatisfied,
    counts,
    effectiveMissingInputs,
  );

  return {
    workspaceState: options.stage2Completed ? "ready_for_application_package" : workspaceState,
    workspaceStateLabel: options.stage2Completed
      ? "Stage 2 complete"
      : formatWorkspaceStateLabel(workspaceState),
    completionPercent: options.stage2Completed ? 100 : completionPercent,
    packageReady: options.packageStatus === "ready_for_review",
    connectedLoadSatisfied,
    verifiedProjectDemandSatisfied,
    hasOnlyPanelEvidence: hasOnlyPanel,
    humanReviewRequired: options.stage2Completed ? false : summary.requires_human_review,
    missingInputs: options.stage2Completed ? [] : effectiveMissingInputs,
    blockingIssues: options.stage2Completed ? [] : blockingIssues,
    lastExtractedAt: summary.load_extraction?.last_extracted_at ?? null,
    lastApprovalAt: getLastApprovalAt(summary),
    templateStatus: template.status,
    templateName: template.name,
    templateVersion: template.version,
  };
}

function formatWorkspaceStateLabel(state: LoadProfileWorkspaceState): string {
  switch (state) {
    case "not_analyzed":
      return "Not analyzed";
    case "extraction_available":
      return "Extraction available";
    case "needs_review":
      return "Needs review";
    case "missing_engineering_inputs":
      return "Missing engineering inputs";
    case "ready_for_service_sizing":
      return "Ready for service sizing";
    case "ready_for_application_package":
      return "Ready for application package";
    case "blocked":
      return "Blocked";
    default:
      return state;
  }
}

function hasVerifiedServiceFacts(summary: UciLoadProfileSummary): boolean {
  const verified = summary.verified_values ?? {};
  return (
    Boolean(verified.phase) ||
    Boolean(verified.service_voltage || verified.requested_voltage) ||
    Boolean(verified.service_amperage)
  );
}

function computeCompletionPercent(
  summary: UciLoadProfileSummary,
  connectedLoadSatisfied: boolean,
  counts: ReturnType<typeof getLoadReviewTabCounts>,
  effectiveMissingInputs: string[] = summary.missing_inputs,
): number {
  let score = 0;
  if (summary) score += 15;
  if (summary.load_extraction?.last_extracted_at) score += 15;
  if (counts.approved > 0) score += 25;
  if (connectedLoadSatisfied) score += 25;
  if (
    (summary.candidate_values ?? []).every(
      (candidate) => !isCandidateBlockingStage2(candidate, effectiveMissingInputs),
    )
  ) {
    score += 10;
  }
  if (effectiveMissingInputs.length === 0) score += 10;
  return Math.min(100, score);
}

export function buildSourceDocumentRows(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
  manifestDocuments: UciDocumentManifestEntry[] = [],
): SourceDocumentRow[] {
  if (!summary && manifestDocuments.length === 0) return [];
  const ext = externalApplicationId ?? summary?.load_extraction?.external_application_id ?? null;
  const map = new Map<string, SourceDocumentRow>();
  const canonicalDocumentKey = (name: string) => name.trim().toLowerCase();

  const ranking = summary?.load_extraction?.source_document_ranking ?? [];
  for (const item of ranking) {
    const name = String(item.file_name ?? "unknown");
    const key = canonicalDocumentKey(name);
    const category = inferDocumentCategory(name, item.reasons ?? []);
    map.set(key, {
      documentKey: `${item.source_type ?? "unknown"}:${name}`,
      documentName: name,
      sourceLabel: sourceTypeLabel(String(item.source_type ?? "unknown")),
      sourceType: String(item.source_type ?? "unknown"),
      externalApplicationId: ext,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      processingStatus: "ranked",
      textExtractionStatus: "unknown",
      pageCount: null,
      contentHash: null,
      candidateCount: 0,
      findingsCount: 0,
      failureReason: null,
      status: "pending",
      statusLabel: "Pending processing",
      statusReason: "Ranked for processing; no processing result is recorded",
      rankScore: typeof item.score === "number" ? item.score : null,
      rankReasons: Array.isArray(item.reasons) ? item.reasons.map(String) : [],
    });
  }

  const candidates = summary?.candidate_values ?? [];
  for (const c of candidates) {
    if (ext && c.external_application_id && c.external_application_id !== ext) continue;
    if (c.status === "stale" || c.status === "rejected") continue;
    const name = c.source_document_name || "unknown";
    const key = canonicalDocumentKey(name);
    const existing = map.get(key);
    const category = inferDocumentCategory(name, existing?.rankReasons ?? []);
    if (existing) {
      existing.candidateCount += 1;
      if (c.source_content_hash) existing.contentHash = c.source_content_hash;
      existing.processingStatus = "processed";
      existing.textExtractionStatus = "parsed";
      existing.status = "parsed_candidates";
      existing.statusLabel = "Parsed — candidates found";
      existing.statusReason = null;
    } else {
      map.set(key, {
        documentKey: `${c.source_type}:${name}`,
        documentName: name,
        sourceLabel: sourceTypeLabel(c.source_type),
        sourceType: c.source_type,
        externalApplicationId: c.external_application_id ?? ext,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        processingStatus: "processed",
        textExtractionStatus: "parsed",
        pageCount: null,
        contentHash: c.source_content_hash,
        candidateCount: 1,
        findingsCount: 0,
        failureReason: null,
        status: "parsed_candidates",
        statusLabel: "Parsed — candidates found",
        statusReason: null,
        rankScore: null,
        rankReasons: [],
      });
    }
  }

  for (const failed of summary?.load_extraction?.failed_documents ?? []) {
    const name = String(failed.document_name ?? "unknown");
    const key = canonicalDocumentKey(name);
    const category = inferDocumentCategory(name);
    const row = map.get(key);
    if (row) {
      row.processingStatus = "failed";
      row.textExtractionStatus = "failed";
      row.failureReason = failed.message;
      row.status = "failed";
      row.statusLabel = "Failed processing";
      row.statusReason = failed.message;
    } else {
      map.set(key, {
        documentKey: key,
        documentName: name,
        sourceLabel: sourceTypeLabel(String(failed.source_type ?? "unknown")),
        sourceType: String(failed.source_type ?? "unknown"),
        externalApplicationId: ext,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        processingStatus: "failed",
        textExtractionStatus: "failed",
        pageCount: null,
        contentHash: null,
        candidateCount: 0,
        findingsCount: 0,
        failureReason: failed.message,
        status: "failed",
        statusLabel: "Failed processing",
        statusReason: failed.message,
        rankScore: null,
        rankReasons: [],
      });
    }
  }

  for (const doc of summary?.source_documents ?? []) {
    const name = doc.file_name ?? "unknown";
    const key = canonicalDocumentKey(name);
    if (!map.has(key)) {
      const category = inferDocumentCategory(name);
      map.set(key, {
        documentKey: `project_document:${name}`,
        documentName: name,
        sourceLabel: "Project document",
        sourceType: "project_document",
        externalApplicationId: ext,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        processingStatus: "available",
        textExtractionStatus: "not_attempted",
        pageCount: null,
        contentHash: null,
        candidateCount: 0,
        findingsCount: 0,
        failureReason: null,
        status: "pending",
        statusLabel: "Pending processing",
        statusReason: "Document is available but has not been processed",
        rankScore: null,
        rankReasons: [],
      });
    }
  }

  for (const doc of manifestDocuments) {
    if (ext && doc.external_application_id && doc.external_application_id !== ext) continue;
    const name = doc.original_filename || "unknown";
    const key = canonicalDocumentKey(name);
    const derived = deriveSourceDocumentStatus(doc);
    const existing = map.get(key);
    const processingStatus =
      doc.processing_status === "failed" || doc.processing_status === "unsupported"
        ? "failed"
        : doc.processing_status === "pending" || doc.processing_status === "processing"
          ? "available"
          : "processed";
    const textExtractionStatus =
      derived.status === "failed"
        ? "failed"
        : derived.status === "pending"
          ? "not_attempted"
          : "parsed";

    if (existing) {
      existing.documentKey = doc.document_id || existing.documentKey;
      existing.sourceType = doc.source_type || existing.sourceType;
      existing.sourceLabel = sourceTypeLabel(existing.sourceType);
      existing.processingStatus = processingStatus;
      existing.textExtractionStatus = textExtractionStatus;
      existing.pageCount = doc.page_count;
      existing.contentHash = doc.content_hash || existing.contentHash;
      existing.findingsCount = doc.findings_count;
      existing.failureReason = doc.failure_reason;
      existing.status = derived.status;
      existing.statusLabel = derived.statusLabel;
      existing.statusReason = derived.statusReason;
      continue;
    }

    const category = inferDocumentCategory(name, doc.document_roles ?? []);
    map.set(key, {
      documentKey: doc.document_id || `${doc.source_type}:${name}`,
      documentName: name,
      sourceLabel: sourceTypeLabel(doc.source_type),
      sourceType: doc.source_type,
      externalApplicationId: doc.external_application_id || ext,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      processingStatus,
      textExtractionStatus,
      pageCount: doc.page_count,
      contentHash: doc.content_hash || null,
      candidateCount: 0,
      findingsCount: doc.findings_count,
      failureReason: doc.failure_reason,
      status: derived.status,
      statusLabel: derived.statusLabel,
      statusReason: derived.statusReason,
      rankScore: null,
      rankReasons: [],
    });
  }

  return [...map.values()].sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
}

export function groupSourceDocumentsByCategory(
  rows: SourceDocumentRow[],
): Record<DocumentCategory, SourceDocumentRow[]> {
  const groups = Object.keys(CATEGORY_LABELS).reduce(
    (acc, key) => {
      acc[key as DocumentCategory] = [];
      return acc;
    },
    {} as Record<DocumentCategory, SourceDocumentRow[]>,
  );
  for (const row of rows) {
    groups[row.category].push(row);
  }
  return groups;
}

function verifiedEntryToRow(
  key: string,
  entry: UciVerifiedLoadValue,
): VerifiedInputRow {
  const isPanel = key.startsWith(PANEL_PREFIX);
  const isEquipment = key in EQUIPMENT_COUNT_KEYS;
  let group: VerifiedInputRow["group"] = "project_service";
  if (isPanel) group = "panels";
  else if (isEquipment) group = "equipment";
  else if (!SERVICE_FIELD_KEYS.has(key) && !PROJECT_CONNECTED_KEYS.has(key)) {
    group = "supporting";
  }

  return {
    id: key,
    group,
    label: formatCandidateFieldLabel(key),
    value: String(entry.value ?? ""),
    unit: entry.unit,
    dataLevel: 3,
    method: entry.method,
    sourceDocument: entry.source_document_name,
    page: entry.page_number,
    evidence: entry.evidence_text,
    approvedBy: entry.approved_by,
    approvedAt: entry.approved_at,
    reviewNote: entry.review_note,
    entityLabel: isPanel ? "Panel" : isEquipment ? EQUIPMENT_COUNT_KEYS[key] : "Project / service",
    satisfiesPackage: verifiedValueSatisfiesConnectedLoad(key, entry),
  };
}

export function buildVerifiedInputRows(
  summary: UciLoadProfileSummary | null,
): Record<VerifiedInputRow["group"], VerifiedInputRow[]> {
  const groups: Record<VerifiedInputRow["group"], VerifiedInputRow[]> = {
    project_service: [],
    equipment: [],
    panels: [],
    supporting: [],
  };
  if (!summary?.verified_values) return groups;
  for (const [key, entry] of Object.entries(summary.verified_values)) {
    const row = verifiedEntryToRow(key, entry);
    groups[row.group].push(row);
  }
  return groups;
}

export function buildLoadScheduleRows(summary: UciLoadProfileSummary | null): LoadScheduleRow[] {
  if (!summary?.verified_values) return [];
  const rows: LoadScheduleRow[] = [];
  const verifiedProjectDemandSatisfied = hasVerifiedProjectDemand(summary);
  for (const [key, entry] of Object.entries(summary.verified_values)) {
    if (key.startsWith(PANEL_PREFIX)) continue;
    const numeric =
      typeof entry.value === "number"
        ? entry.value
        : Number.isFinite(Number(entry.value))
          ? Number(entry.value)
          : null;
    const unit = entry.unit;
    const isLoad = PROJECT_CONNECTED_KEYS.has(key);
    const isEquipment = key in EQUIPMENT_COUNT_KEYS;

    if (!isLoad && !isEquipment) continue;

    rows.push({
      id: key,
      category: isEquipment ? EQUIPMENT_COUNT_KEYS[key] : formatCandidateFieldLabel(key),
      quantity: isEquipment ? numeric : null,
      connectedLoad: key.includes("connected") ? numeric : null,
      continuousLoad: null,
      nonContinuousLoad: null,
      demandFactor: null,
      demandFactorSource: null,
      demandFactorDisplay: verifiedProjectDemandSatisfied
        ? "N/A — verified demand provided"
        : "Unresolved",
      demandAdjustedLoad: key.includes("demand") ? numeric : null,
      unit,
      source: entry.source_document_name,
      verificationStatus: "verified",
      dataLevel: 3,
    });
  }
  return rows;
}

export function getLoadScheduleTotals(summary: UciLoadProfileSummary | null): LoadScheduleTotals {
  const rows = buildLoadScheduleRows(summary);
  const sum = (unit: string, field: "connectedLoad" | "demandAdjustedLoad") => {
    const values = rows
      .filter((r) => r.unit === unit && r[field] != null)
      .map((r) => r[field] as number);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };

  const verifiedProjectDemandSatisfied = hasVerifiedProjectDemand(summary);
  const hasApprovedTemplate = getTemplateStatus(summary).status === "approved";
  const hasDemandFactors = false;
  const canFinalize =
    rows.length > 0 &&
    (verifiedProjectDemandSatisfied || (hasApprovedTemplate && hasDemandFactors));

  return {
    connectedKw: sum("kW", "connectedLoad"),
    connectedKva: sum("kVA", "connectedLoad"),
    demandKw: sum("kW", "demandAdjustedLoad"),
    demandKva: sum("kVA", "demandAdjustedLoad"),
    canFinalize,
    finalizeMessage:
      rows.length === 0
        ? "No verified load schedule rows yet."
        : verifiedProjectDemandSatisfied
          ? "Verified project demand provided — no demand factor or template is required; finalize when engineering review is complete."
          : !hasApprovedTemplate || !hasDemandFactors
          ? "Load schedule cannot be finalized until approved engineering factors or template inputs are provided."
          : "Verified inputs present — finalize when engineering review is complete.",
  };
}

export function buildServiceSizingFields(
  summary: UciLoadProfileSummary | null,
): ServiceSizingField[] {
  if (!summary?.verified_values) return [];
  const fields: ServiceSizingField[] = [];
  const sizingKeys = [
    "demand_load_kw",
    "demand_load_kva",
    "connected_load_kw",
    "connected_load_kva",
    "service_amperage",
    "requested_service_amperage",
    "service_entrance_amperage",
    "service_voltage",
    "requested_voltage",
    "phase",
    "wire_configuration",
    "meter_count",
    "service_configuration",
  ];

  for (const key of sizingKeys) {
    const entry = summary.verified_values[key];
    if (!entry) continue;
    fields.push({
      key,
      label: formatCandidateFieldLabel(key),
      value: String(entry.value ?? ""),
      unit: entry.unit,
      origin:
        entry.method === "user_entered_and_verified"
          ? "user_entered"
          : entry.method === "template_calculated"
            ? "calculated"
            : "approved",
      source: entry.source_document_name,
      evidence: entry.evidence_text,
      approved: true,
    });
  }

  return fields;
}

export function getServiceSizingRecommendation(
  summary: UciLoadProfileSummary | null,
): ServiceSizingRecommendation {
  const calculated = summary?.calculated_values as
    | Record<string, { value?: unknown; source?: string } | unknown>
    | undefined;
  const calcSize =
    calculated && typeof calculated === "object"
      ? calculated.service_size && typeof calculated.service_size === "object"
        ? (calculated.service_size as { value?: unknown }).value
        : calculated.service_size
      : null;

  if (calcSize) {
    const needs = Array.isArray(summary?.needs_verification) ? summary.needs_verification : [];
    const oversized = summary && (summary as { oversized?: boolean }).oversized === true;
    return {
      status: needs.length || oversized ? "needs_review" : "approved",
      message: oversized
        ? `Calculated service ${String(calcSize)} exceeds 800A — human review required.`
        : `Calculated service size: ${String(calcSize)}${needs.includes("generic_qsr_fallback") ? " (generic QSR fallback — verify)" : ""}.`,
      missingInputs: [],
    };
  }

  if (!summary?.verified_values) {
    return {
      status: "missing_inputs",
      message: "Verified demand, voltage, and phase are required before service sizing review.",
      missingInputs: ["demand_load", "voltage", "phase"],
    };
  }

  const verified = summary.verified_values;
  const missingInputs: string[] = [];
  if (!hasVerifiedProjectDemand(summary)) missingInputs.push("demand_load");
  if (!verified.requested_voltage && !verified.service_voltage) missingInputs.push("voltage");
  if (!verified.phase) missingInputs.push("phase");

  if (missingInputs.length > 0) {
    return {
      status: "missing_inputs",
      message: `Missing verified service-sizing input${missingInputs.length === 1 ? "" : "s"}: ${missingInputs.join(", ").replace(/_/g, " ")}.`,
      missingInputs,
    };
  }

  if (verified.service_amperage) {
    return {
      status: "approved",
      message: "Verified service-size recommendation is available for final engineering review.",
      missingInputs: [],
    };
  }

  return {
    status: "requires_human_input",
    message:
      "Engineering recommendation requires human input. Verified demand, voltage, and phase are available, but no approved sizing rule or verified proposed service size exists.",
    missingInputs: [],
  };
}

export function buildPackageReadinessChecklist(
  summary: UciLoadProfileSummary | null,
  options: {
    hasProjectAddress?: boolean;
    packageDocumentsComplete?: boolean;
    humanReviewComplete?: boolean;
  } = {},
): PackageReadinessItem[] {
  const connectedSatisfied = isConnectedLoadSatisfied(summary);
  const verifiedProjectDemandSatisfied = hasVerifiedProjectDemand(summary);
  const verified = summary?.verified_values ?? {};
  const schedule = getLoadScheduleTotals(summary);
  const sizing = getServiceSizingRecommendation(summary);
  const onlyPanel = hasOnlyPanelVerifiedOrCandidateEvidence(summary);
  const activeCandidates = (summary?.candidate_values ?? []).filter(
    (candidate) => candidate.status === "candidate",
  );
  const hasCandidate = (...fieldKeys: string[]) =>
    activeCandidates.some((candidate) => fieldKeys.includes(candidate.field_key));
  const verificationStatus = (
    isVerified: boolean,
    candidateExists: boolean,
  ): ChecklistItemStatus => (isVerified ? "complete" : candidateExists ? "needs_review" : "missing");
  const hasProjectLoadCandidate = hasCandidate(
    ...PROJECT_CONNECTED_KEYS,
    "connected_equipment_or_load_data",
  );

  const item = (
    key: string,
    label: string,
    status: ChecklistItemStatus,
    detail: string,
  ): PackageReadinessItem => ({ key, label, status, detail });

  return [
    item(
      "connected_load_data",
      "Verified connected-load value",
      connectedSatisfied
        ? "complete"
        : onlyPanel || hasProjectLoadCandidate
          ? "needs_review"
          : "missing",
      connectedSatisfied
        ? "Project-level connected or demand load verified"
        : hasProjectLoadCandidate
          ? "Project/service load candidate exists and needs verification"
        : onlyPanel
          ? "Panel totals present but cannot satisfy connected_load_data"
          : "Approve a project/service connected or demand load, or enter one manually",
    ),
    item(
      "voltage",
      "Verified service voltage",
      verificationStatus(
        Boolean(verified.requested_voltage || verified.service_voltage),
        hasCandidate("requested_voltage", "service_voltage"),
      ),
      verified.requested_voltage || verified.service_voltage
        ? "Voltage verified for service-sizing review"
        : hasCandidate("requested_voltage", "service_voltage")
          ? "Voltage candidate exists and needs verification"
          : "No verified voltage exists",
    ),
    item(
      "phase",
      "Phase",
      verificationStatus(Boolean(verified.phase), hasCandidate("phase")),
      verified.phase
        ? "Service phase verified"
        : hasCandidate("phase")
          ? "Service phase candidate exists and needs verification"
          : "No service phase source or value exists",
    ),
    item(
      "service_configuration",
      "Service configuration",
      verificationStatus(
        Boolean(verified.service_configuration || verified.wire_configuration),
        hasCandidate("service_configuration", "wire_configuration"),
      ),
      verified.service_configuration || verified.wire_configuration
        ? "Service configuration verified"
        : hasCandidate("service_configuration", "wire_configuration")
          ? "Service configuration candidate exists and needs verification"
          : "No service configuration source or value exists",
    ),
    item(
      "approved_load_schedule",
      "Defensible load schedule",
      schedule.canFinalize ? "complete" : schedule.connectedKw != null || schedule.connectedKva != null ? "needs_review" : "missing",
      schedule.canFinalize
        ? verifiedProjectDemandSatisfied
          ? "Verified project demand provided — no demand factor or template is required"
          : schedule.finalizeMessage
        : schedule.finalizeMessage,
    ),
    item(
      "service_size_recommendation",
      "Service-size recommendation",
      sizing.status === "approved" || options.humanReviewComplete
        ? "complete"
        : sizing.status === "requires_human_input"
          ? "needs_review"
          : "missing",
      sizing.status === "approved"
        ? sizing.message
        : options.humanReviewComplete
          ? "Human engineering review accepted the sizing exception; no unapproved rule was invented"
          : sizing.message,
    ),
    item(
      "human_review",
      "Stage 2 engineering review",
      options.humanReviewComplete ? "complete" : "needs_review",
      options.humanReviewComplete
        ? "Load schedule and service sizing reviewed"
        : "Human approval is required before Stage 2 can be marked complete",
    ),
  ];
}

export function getDefaultReviewQueueTab(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): import("@/lib/uciLoadProfile").LoadReviewTab {
  const counts = getLoadReviewTabCounts(summary, externalApplicationId);
  if (counts.pending > 0) return "pending";
  if (counts.unresolved > 0) return "unresolved";
  if (counts.approved > 0) return "approved";
  return "pending";
}

export function prioritizeReviewCandidates(
  candidates: UciLoadCandidate[],
): UciLoadCandidate[] {
  const score = (c: UciLoadCandidate): number => {
    if (c.can_satisfy_package) return 100;
    if (SERVICE_FIELD_KEYS.has(c.field_key)) return 80;
    if (c.entity_type === "equipment") return 60;
    if (c.entity_type === "electrical_panel") return 40;
    if (c.generic_specification_reference) return 10;
    if (c.status === "stale") return 0;
    return 30;
  };
  return [...deduplicateCandidatesForDisplay(candidates)].sort((a, b) => score(b) - score(a));
}

export function validateManualVerifiedInput(
  payload: ManualVerifiedInputPayload,
): string | null {
  const fieldKey = String(payload.field_key ?? "").trim();
  if (!fieldKey) return "Field type is required";
  const option = MANUAL_VERIFIABLE_FIELD_OPTIONS.find((o) => o.field_key === fieldKey);
  if (!option) return "Unsupported field type";

  const value = payload.value;
  if (value == null || value === "") return "Value is required";

  const unit = payload.unit != null ? String(payload.unit).trim() : option.unit;
  if (NUMERIC_UNIT_REQUIRED.has(fieldKey) && !unit) {
    return "Unit is required for this engineering field";
  }

  if (fieldKey.endsWith("_kw") && unit && unit !== "kW") {
    return "Field and unit do not match (expected kW)";
  }
  if (fieldKey.endsWith("_kva") && unit && unit !== "kVA") {
    return "Field and unit do not match (expected kVA)";
  }
  if (fieldKey === "service_amperage" && unit && unit !== "A") {
    return "Service amperage requires unit A";
  }
  if ((fieldKey === "service_voltage" || fieldKey === "requested_voltage") && unit && unit !== "V") {
    return "Voltage requires unit V";
  }

  return null;
}

export function getUtilityTypeContracts(utilityType: string): {
  utilityType: string;
  supportedUnits: string[];
  scheduleSupported: boolean;
  serviceSizingSupported: boolean;
} {
  const t = utilityType.toLowerCase();
  if (t === "electric") {
    return {
      utilityType: t,
      supportedUnits: ["kW", "kVA", "A", "V", "phase", "count"],
      scheduleSupported: true,
      serviceSizingSupported: true,
    };
  }
  if (t === "gas") {
    return {
      utilityType: t,
      supportedUnits: ["BTU/h", "CFH", "psi"],
      scheduleSupported: false,
      serviceSizingSupported: true,
    };
  }
  if (t === "water" || t === "sewer" || t === "water_sewer") {
    return {
      utilityType: t,
      supportedUnits: ["DFU", "GPM"],
      scheduleSupported: false,
      serviceSizingSupported: true,
    };
  }
  if (t === "telecom") {
    return {
      utilityType: t,
      supportedUnits: ["count"],
      scheduleSupported: false,
      serviceSizingSupported: false,
    };
  }
  return {
    utilityType: t || "unknown",
    supportedUnits: [],
    scheduleSupported: false,
    serviceSizingSupported: false,
  };
}
