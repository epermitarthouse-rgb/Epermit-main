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
  isConnectedLoadSatisfied,
  isPendingLoadReviewCandidate,
  isUnresolvedLoadCandidate,
  parseLoadProfileSummary,
  verifiedValueSatisfiesConnectedLoad,
  type UciLoadCandidate,
  type UciLoadProfileSummary,
  type UciVerifiedLoadValue,
} from "@/lib/uciLoadProfile";

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

export interface LoadProfileOverview {
  workspaceState: LoadProfileWorkspaceState;
  workspaceStateLabel: string;
  completionPercent: number;
  packageReady: boolean;
  connectedLoadSatisfied: boolean;
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
  failureReason: string | null;
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

const PANEL_PREFIX = "panel_";

const SERVICE_FIELD_KEYS = new Set([
  "service_amperage",
  "requested_voltage",
  "service_voltage",
  "phase",
  "meter_count",
  "service_configuration",
  "wire_configuration",
]);

const EQUIPMENT_COUNT_KEYS: Record<string, string> = {
  central_ac_count: "Central AC",
  central_heat_count: "Central heat",
};

const NUMERIC_UNIT_REQUIRED = new Set([
  ...PROJECT_CONNECTED_KEYS,
  ...Array.from(SERVICE_FIELD_KEYS).filter((k) => k !== "phase" && k !== "service_configuration"),
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
  { field_key: "service_voltage", label: "Service voltage", unit: "V", entity_type: "project_service" },
  { field_key: "phase", label: "Service phase", unit: "phase", entity_type: "project_service" },
  { field_key: "meter_count", label: "Meter count", unit: "count", entity_type: "project_service" },
  { field_key: "service_configuration", label: "Service configuration", unit: "", entity_type: "project_service" },
  { field_key: "wire_configuration", label: "Wire configuration", unit: "", entity_type: "project_service" },
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
    case "provider_application":
      return "Application metadata";
    default:
      return "Supporting source";
  }
}

function hasProjectLevelVerifiedLoad(summary: UciLoadProfileSummary | null): boolean {
  if (!summary?.verified_values) return false;
  return Object.entries(summary.verified_values).some(
    ([key, entry]) =>
      PROJECT_CONNECTED_KEYS.has(key) && verifiedValueSatisfiesConnectedLoad(key, entry),
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
  } = {},
): LoadProfileOverview {
  const connectedLoadSatisfied = isConnectedLoadSatisfied(summary);
  const hasOnlyPanel = hasOnlyPanelVerifiedOrCandidateEvidence(
    summary,
    options.externalApplicationId,
  );
  const counts = getLoadReviewTabCounts(summary, options.externalApplicationId);
  const pending = counts.pending;
  const unresolved = counts.unresolved;
  const template = getTemplateStatus(summary);

  const blockingIssues: string[] = [];
  if (!summary) {
    return {
      workspaceState: "not_analyzed",
      workspaceStateLabel: "Not analyzed",
      completionPercent: 0,
      packageReady: false,
      connectedLoadSatisfied: false,
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
  if (summary.missing_inputs.length > 0) {
    blockingIssues.push(...summary.missing_inputs.map((m) => `Missing input: ${m.replace(/_/g, " ")}`));
  }

  let workspaceState: LoadProfileWorkspaceState = "extraction_available";
  if (summary.analysis_status === "blocked") workspaceState = "blocked";
  else if (pending > 0 || unresolved > 0) workspaceState = "needs_review";
  else if (summary.missing_inputs.length > 0 || !connectedLoadSatisfied)
    workspaceState = "missing_engineering_inputs";
  else if (connectedLoadSatisfied && counts.approved > 0) {
    const serviceVerified = hasVerifiedServiceFacts(summary);
    workspaceState = serviceVerified
      ? options.packageConnectedLoadSatisfied
        ? "ready_for_application_package"
        : "ready_for_service_sizing"
      : "missing_engineering_inputs";
  }

  const completionPercent = computeCompletionPercent(summary, connectedLoadSatisfied, counts);

  return {
    workspaceState,
    workspaceStateLabel: formatWorkspaceStateLabel(workspaceState),
    completionPercent,
    packageReady: options.packageStatus === "ready_for_review",
    connectedLoadSatisfied,
    hasOnlyPanelEvidence: hasOnlyPanel,
    humanReviewRequired: summary.requires_human_review,
    missingInputs: summary.missing_inputs,
    blockingIssues,
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
): number {
  let score = 0;
  if (summary) score += 15;
  if (summary.load_extraction?.last_extracted_at) score += 15;
  if (counts.approved > 0) score += 25;
  if (connectedLoadSatisfied) score += 25;
  if (counts.pending === 0 && counts.unresolved === 0) score += 10;
  if (summary.missing_inputs.length === 0) score += 10;
  return Math.min(100, score);
}

export function buildSourceDocumentRows(
  summary: UciLoadProfileSummary | null,
  externalApplicationId?: string | null,
): SourceDocumentRow[] {
  if (!summary) return [];
  const ext = externalApplicationId ?? summary.load_extraction?.external_application_id ?? null;
  const map = new Map<string, SourceDocumentRow>();

  const ranking = summary.load_extraction?.source_document_ranking ?? [];
  for (const item of ranking) {
    const name = String(item.file_name ?? "unknown");
    const key = `${item.source_type ?? "unknown"}:${name}`;
    const category = inferDocumentCategory(name, item.reasons ?? []);
    map.set(key, {
      documentKey: key,
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
      failureReason: null,
      rankScore: typeof item.score === "number" ? item.score : null,
      rankReasons: Array.isArray(item.reasons) ? item.reasons.map(String) : [],
    });
  }

  const candidates = summary.candidate_values ?? [];
  for (const c of candidates) {
    if (ext && c.external_application_id && c.external_application_id !== ext) continue;
    const name = c.source_document_name || "unknown";
    const key = `${c.source_type}:${name}`;
    const existing = map.get(key);
    const category = inferDocumentCategory(name, existing?.rankReasons ?? []);
    if (existing) {
      existing.candidateCount += 1;
      if (c.source_content_hash) existing.contentHash = c.source_content_hash;
    } else {
      map.set(key, {
        documentKey: key,
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
        failureReason: null,
        rankScore: null,
        rankReasons: [],
      });
    }
  }

  for (const failed of summary.load_extraction?.failed_documents ?? []) {
    const name = String(failed.document_name ?? "unknown");
    const key = `${failed.source_type ?? "unknown"}:${name}`;
    const category = inferDocumentCategory(name);
    const row = map.get(key);
    if (row) {
      row.processingStatus = "failed";
      row.textExtractionStatus = "failed";
      row.failureReason = failed.message;
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
        failureReason: failed.message,
        rankScore: null,
        rankReasons: [],
      });
    }
  }

  for (const doc of summary.source_documents ?? []) {
    const name = doc.file_name ?? "unknown";
    const key = `project_document:${name}`;
    if (!map.has(key)) {
      const category = inferDocumentCategory(name);
      map.set(key, {
        documentKey: key,
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
        failureReason: null,
        rankScore: null,
        rankReasons: [],
      });
    }
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

  const hasApprovedTemplate = getTemplateStatus(summary).status === "approved";
  const hasDemandFactors = false;
  const canFinalize = rows.length > 0 && hasApprovedTemplate && hasDemandFactors;

  return {
    connectedKw: sum("kW", "connectedLoad"),
    connectedKva: sum("kVA", "connectedLoad"),
    demandKw: sum("kW", "demandAdjustedLoad"),
    demandKva: sum("kVA", "demandAdjustedLoad"),
    canFinalize,
    finalizeMessage:
      rows.length === 0
        ? "No verified load schedule rows yet."
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

export function buildPackageReadinessChecklist(
  summary: UciLoadProfileSummary | null,
  options: {
    hasProjectAddress?: boolean;
    packageDocumentsComplete?: boolean;
    humanReviewComplete?: boolean;
  } = {},
): PackageReadinessItem[] {
  const connectedSatisfied = isConnectedLoadSatisfied(summary);
  const verified = summary?.verified_values ?? {};
  const hasScheduleRows = buildLoadScheduleRows(summary).length > 0;
  const onlyPanel = hasOnlyPanelVerifiedOrCandidateEvidence(summary);

  const item = (
    key: string,
    label: string,
    status: ChecklistItemStatus,
    detail: string,
  ): PackageReadinessItem => ({ key, label, status, detail });

  return [
    item(
      "project_address",
      "Project address",
      options.hasProjectAddress ? "complete" : "missing",
      options.hasProjectAddress ? "Address available for package" : "Project address required",
    ),
    item(
      "connected_load_data",
      "Verified connected-load value",
      connectedSatisfied ? "complete" : onlyPanel ? "needs_review" : "missing",
      connectedSatisfied
        ? "Project-level connected or demand load verified"
        : onlyPanel
          ? "Panel totals present but cannot satisfy connected_load_data"
          : "Approve a project/service connected or demand load, or enter one manually",
    ),
    item(
      "voltage",
      "Voltage",
      verified.service_voltage || verified.requested_voltage ? "complete" : "missing",
      verified.service_voltage || verified.requested_voltage
        ? "Service voltage verified"
        : "Service voltage not verified",
    ),
    item(
      "phase",
      "Phase",
      verified.phase ? "complete" : "missing",
      verified.phase ? "Service phase verified" : "Service phase not verified",
    ),
    item(
      "service_configuration",
      "Service configuration",
      verified.service_configuration || verified.wire_configuration ? "complete" : "needs_review",
      verified.service_configuration || verified.wire_configuration
        ? "Service configuration verified"
        : "Service configuration may be required",
    ),
    item(
      "meter_count",
      "Meter count",
      verified.meter_count ? "complete" : "not_applicable",
      verified.meter_count ? "Meter count verified" : "Verify if required by utility",
    ),
    item(
      "approved_load_schedule",
      "Approved load schedule",
      hasScheduleRows ? "needs_review" : "missing",
      hasScheduleRows
        ? "Verified rows exist — demand factors/template approval still required for finalization"
        : "No verified schedule rows",
    ),
    item(
      "required_documents",
      "Required documents",
      options.packageDocumentsComplete ? "complete" : "missing",
      options.packageDocumentsComplete
        ? "Required package documents attached"
        : "Complete document mapping in application package",
    ),
    item(
      "human_review",
      "Human review complete",
      options.humanReviewComplete ? "complete" : "needs_review",
      options.humanReviewComplete
        ? "Load profile review complete"
        : "Review and approve required inputs",
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

  const note = payload.review_note != null ? String(payload.review_note).trim() : "";
  const reference = payload.source_reference != null ? String(payload.source_reference).trim() : "";
  if (PROJECT_CONNECTED_KEYS.has(fieldKey) && !note && !reference && !payload.evidence_text) {
    return "Engineering note or source reference required for manual project load entry";
  }

  if (!payload.review_note?.trim()) {
    return "Reviewer confirmation note is required";
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
      serviceSizingSupported: false,
    };
  }
  if (t === "water" || t === "sewer" || t === "water_sewer") {
    return {
      utilityType: t,
      supportedUnits: ["DFU", "GPM"],
      scheduleSupported: false,
      serviceSizingSupported: false,
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
