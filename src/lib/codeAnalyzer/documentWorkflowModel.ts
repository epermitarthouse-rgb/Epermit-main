/**
 * User-facing document workflow model for Code Analyzer V2 (no raw backend labels).
 */
import type { CodeAnalyzerIngestionJob } from "./ingestion";
import { isTerminalIngestionStatus } from "./ingestion";
import type { CodeAnalyzerSheet } from "./model";
import { deriveDocumentCardStatus } from "./documentCardStatus";
import type { ComplianceBatchFileStatus } from "@/lib/complianceBatchProcessor";

export type DocumentPurposeLabel =
  | "Drawing"
  | "Supporting document"
  | "Code modification form"
  | "Other";

export type DocumentUserStatusLabel =
  | "Uploading"
  | "Organizing"
  | "Ready for analysis"
  | "Analyzing"
  | "Used as analysis context"
  | "Completed"
  | "Needs attention"
  | "Failed";

export type WorkflowStepId = 1 | 2 | 3 | 4 | 5;

export interface WorkflowStepDefinition {
  id: WorkflowStepId;
  title: string;
  description: string;
}

export const WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  { id: 1, title: "Upload documents", description: "Add drawings, specs, and forms for this project." },
  { id: 2, title: "PermitPilot organizes files", description: "We detect drawing sheets vs supporting documents." },
  { id: 3, title: "Review drawing set", description: "Confirm which plan sheets will be analyzed." },
  { id: 4, title: "Run analysis", description: "Analyze drawings against the selected code." },
  { id: 5, title: "Review results", description: "Read findings and export your report." },
];

export interface ProjectDocumentMeta {
  id: string;
  file_name: string;
  document_type?: string | null;
  analyzer_class: string | null;
  analyzer_processing_status: string | null;
}

export interface PendingUploadMeta {
  id: string;
  name: string;
  status: ComplianceBatchFileStatus;
  error?: string;
}

export interface ConsolidatedDocumentCardModel {
  key: string;
  documentId: string | null;
  /** True when backed by a project_documents row (not a handoff placeholder). */
  isPersistedDocument: boolean;
  /** Persisted project_documents row eligible for bulk delete (excludes placeholders / session-only cards). */
  eligibleForBulkDelete: boolean;
  fileName: string;
  purpose: DocumentPurposeLabel;
  purposeDetail: string | null;
  status: DocumentUserStatusLabel;
  statusDetail: string | null;
  countLabel: string | null;
  showRemove: boolean;
  showCancelProcessing: boolean;
  showRetryAnalysis: boolean;
  ingestionJobId: string | null;
  borderClass: string;
}

export function isAnalyzerWorkflowDocument(doc: ProjectDocumentMeta): boolean {
  if (doc.analyzer_class) return true;
  const proc = doc.analyzer_processing_status;
  if (proc && proc !== "not_started") return true;
  if (doc.document_type === "specification" || doc.document_type === "permit_drawing") return true;
  return false;
}

export function resolveDocumentPurpose(
  doc: ProjectDocumentMeta,
  includedSheetCount: number,
): { purpose: DocumentPurposeLabel; detail: string | null } {
  const cls = doc.analyzer_class;
  if (cls === "code_modification_form") {
    return {
      purpose: "Code modification form",
      detail: "Used for Code Modification review when that mode is enabled.",
    };
  }
  if (cls === "specification" || cls === "supporting" || cls === "report") {
    return {
      purpose: "Supporting document",
      detail: "Referenced during analysis; plan sheets are not extracted from this file.",
    };
  }
  if (cls === "drawing_set" || cls === "schedule") {
    return {
      purpose: "Drawing",
      detail: "Plan sheets from this file are analyzed visually.",
    };
  }
  if (cls === "mixed") {
    if (includedSheetCount > 0) {
      return {
        purpose: "Drawing",
        detail: "Some pages are specs; only drawing pages become plan sheets.",
      };
    }
    return {
      purpose: "Supporting document",
      detail: "No drawing pages detected yet.",
    };
  }
  if (doc.document_type === "permit_drawing" || includedSheetCount > 0) {
    return {
      purpose: "Drawing",
      detail: includedSheetCount > 0 ? "Plan sheets from this file are analyzed visually." : null,
    };
  }
  if (doc.document_type === "specification") {
    return {
      purpose: "Supporting document",
      detail: "Referenced during analysis; plan sheets are not extracted from this file.",
    };
  }
  return { purpose: "Other", detail: null };
}

function ingestionIsActive(job: CodeAnalyzerIngestionJob | undefined): boolean {
  return Boolean(job && !isTerminalIngestionStatus(job.status));
}

export function resolveDocumentUserStatus(input: {
  doc: ProjectDocumentMeta;
  job: CodeAnalyzerIngestionJob | undefined;
  includedSheets: CodeAnalyzerSheet[];
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  analyzing: boolean;
  currentAnalyzingSheetId?: string | null;
  analysisStale?: boolean;
}): Pick<ConsolidatedDocumentCardModel, "status" | "statusDetail" | "borderClass" | "showRetryAnalysis"> {
  const { doc, job } = input;

  if (job?.status === "failed") {
    return {
      status: "Failed",
      statusDetail: "Organization failed. Remove and upload again, or retry when available.",
      borderClass: "border-destructive/40 bg-destructive/[0.04]",
      showRetryAnalysis: false,
    };
  }

  if (ingestionIsActive(job) || doc.analyzer_processing_status === "processing" || doc.analyzer_processing_status === "queued") {
    return {
      status: "Organizing",
      statusDetail: "PermitPilot is preparing plan sheets from this file.",
      borderClass: "border-gold/45 bg-gold/[0.05]",
      showRetryAnalysis: false,
    };
  }

  const terminalJob =
    job?.status === "completed" || job?.status === "partial";
  if (
    !terminalJob &&
    !doc.analyzer_class &&
    doc.document_type === "permit_drawing" &&
    (doc.analyzer_processing_status === "not_started" || !doc.analyzer_processing_status)
  ) {
    return {
      status: "Needs attention",
      statusDetail: "This file was not organized yet. Remove it or upload again through Add documents.",
      borderClass: "border-warning/40 bg-warning/[0.04]",
      showRetryAnalysis: false,
    };
  }

  const purpose = resolveDocumentPurpose(doc, input.includedSheets.filter((s) => !s.excluded).length);

  if (purpose.purpose === "Supporting document" || purpose.purpose === "Code modification form") {
    const organized =
      doc.analyzer_processing_status === "completed" ||
      doc.analyzer_processing_status === "partial" ||
      job?.status === "completed" ||
      job?.status === "partial";
    if (purpose.purpose === "Code modification form" && organized) {
      return {
        status: "Ready for analysis",
        statusDetail: "Form is stored for Code Modification review.",
        borderClass: "border-border bg-card",
        showRetryAnalysis: false,
      };
    }
    if (organized) {
      return {
        status: "Used as analysis context",
        statusDetail:
          purpose.purpose === "Supporting document"
            ? "Indexed for specification context during drawing analysis."
            : null,
        borderClass: "border-teal/30 bg-teal/[0.03]",
        showRetryAnalysis: false,
      };
    }
    return {
      status: "Organizing",
      statusDetail: "PermitPilot is preparing this supporting document.",
      borderClass: "border-gold/45 bg-gold/[0.05]",
      showRetryAnalysis: false,
    };
  }

  if (purpose.purpose === "Drawing") {
    const card = deriveDocumentCardStatus({
      includedSheets: input.includedSheets,
      completedSheetIds: input.completedSheetIds,
      failedSheetIds: input.failedSheetIds,
      analyzing: input.analyzing,
      currentAnalyzingSheetId: input.currentAnalyzingSheetId,
      analysisStale: input.analysisStale,
    });

    if (card.status === "failed" || (card.counts.failed > 0 && card.counts.completed === 0)) {
      return {
        status: "Failed",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: true,
      };
    }
    if (card.status === "partial" || card.counts.failed > 0) {
      return {
        status: "Needs attention",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: true,
      };
    }
    if (card.status === "completed") {
      return {
        status: "Completed",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: false,
      };
    }
    if (card.status === "analyzing") {
      return {
        status: "Analyzing",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: false,
      };
    }
    if (card.status === "stale") {
      return {
        status: "Needs attention",
        statusDetail: "Drawing set changed — run Update Analysis.",
        borderClass: card.borderClass,
        showRetryAnalysis: false,
      };
    }
    return {
      status: "Ready for analysis",
      statusDetail: card.progressLabel,
      borderClass: card.borderClass,
      showRetryAnalysis: false,
    };
  }

  return {
    status: "Needs attention",
    statusDetail: null,
    borderClass: "border-border bg-card",
    showRetryAnalysis: false,
  };
}

export function formatDocumentCountLabel(input: {
  purpose: DocumentPurposeLabel;
  includedSheetCount: number;
  totalPages: number | null;
  isPdf: boolean;
}): string | null {
  if (input.purpose === "Drawing") {
    if (input.includedSheetCount === 0) return input.totalPages ? `${input.totalPages} pages · no plan sheets yet` : null;
    const sheetPart = `${input.includedSheetCount} plan sheet${input.includedSheetCount === 1 ? "" : "s"}`;
    if (input.isPdf && input.totalPages && input.totalPages > input.includedSheetCount) {
      return `${sheetPart} from ${input.totalPages} pages`;
    }
    return sheetPart;
  }
  if (input.purpose === "Supporting document" && input.totalPages) {
    return `${input.totalPages} page${input.totalPages === 1 ? "" : "s"}`;
  }
  if (input.purpose === "Code modification form" && input.totalPages) {
    return `${input.totalPages} page${input.totalPages === 1 ? "" : "s"}`;
  }
  return null;
}

/** Persisted workflow cards eligible for bulk select/delete. */
export function isBulkSelectableDocumentCard(card: ConsolidatedDocumentCardModel): boolean {
  return (
    card.eligibleForBulkDelete &&
    card.isPersistedDocument &&
    card.showRemove &&
    Boolean(card.documentId)
  );
}

export function bulkDeletableDocumentIds(cards: ConsolidatedDocumentCardModel[]): string[] {
  const ids = cards.filter(isBulkSelectableDocumentCard).map((c) => c.documentId);
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** @deprecated Use isBulkSelectableDocumentCard */
export const isBulkSelectableDrawingCard = isBulkSelectableDocumentCard;

/** @deprecated Use bulkDeletableDocumentIds */
export const bulkDeletableDrawingDocumentIds = bulkDeletableDocumentIds;

export function buildConsolidatedDocumentCards(input: {
  documents: ProjectDocumentMeta[];
  jobs: CodeAnalyzerIngestionJob[];
  sheets: CodeAnalyzerSheet[];
  pendingUploads: PendingUploadMeta[];
  /** Pending session uploads already enqueued — do not show duplicate pending cards. */
  handoffPendingIds?: Set<string>;
  /** Document ids that are handoff placeholders only — not deletable via project_documents. */
  placeholderDocumentIds?: Set<string>;
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  analyzing: boolean;
  currentAnalyzingSheetId?: string | null;
  analysisStale?: boolean;
}): ConsolidatedDocumentCardModel[] {
  const handoffPendingIds = input.handoffPendingIds ?? new Set<string>();
  const placeholderDocumentIds = input.placeholderDocumentIds ?? new Set<string>();
  const jobsByDoc = new Map<string, CodeAnalyzerIngestionJob>();
  for (const job of input.jobs) {
    const prev = jobsByDoc.get(job.document_id);
    if (!prev || new Date(job.created_at) > new Date(prev.created_at)) {
      jobsByDoc.set(job.document_id, job);
    }
  }

  const sheetsByDoc = new Map<string, CodeAnalyzerSheet[]>();
  for (const sheet of input.sheets) {
    const list = sheetsByDoc.get(sheet.source_document_id) ?? [];
    list.push(sheet);
    sheetsByDoc.set(sheet.source_document_id, list);
  }

  const cards: ConsolidatedDocumentCardModel[] = [];

  for (const doc of input.documents.filter(isAnalyzerWorkflowDocument)) {
    const docSheets = sheetsByDoc.get(doc.id) ?? [];
    const included = docSheets.filter((s) => !s.excluded);
    const job = jobsByDoc.get(doc.id);
    const { purpose, detail: purposeDetail } = resolveDocumentPurpose(doc, included.length);
    const statusFields = resolveDocumentUserStatus({
      doc,
      job,
      includedSheets: docSheets,
      completedSheetIds: input.completedSheetIds,
      failedSheetIds: input.failedSheetIds,
      analyzing: input.analyzing,
      currentAnalyzingSheetId: input.currentAnalyzingSheetId,
      analysisStale: input.analysisStale,
    });
    const isPdf =
      docSheets.length > 1 || doc.file_name.toLowerCase().endsWith(".pdf") || doc.document_type === "specification";
    const countLabel = formatDocumentCountLabel({
      purpose,
      includedSheetCount: included.length,
      totalPages: job?.total_pages ?? null,
      isPdf,
    });

    const isPersistedDocument = !placeholderDocumentIds.has(doc.id);
    cards.push({
      key: doc.id,
      documentId: doc.id,
      isPersistedDocument,
      eligibleForBulkDelete: isPersistedDocument,
      fileName: doc.file_name,
      purpose,
      purposeDetail,
      status: statusFields.status,
      statusDetail: statusFields.statusDetail,
      countLabel,
      showRemove: isPersistedDocument,
      showCancelProcessing: ingestionIsActive(job),
      showRetryAnalysis: statusFields.showRetryAnalysis,
      ingestionJobId: job?.id ?? null,
      borderClass: statusFields.borderClass,
    });
  }

  for (const pending of input.pendingUploads) {
    if (handoffPendingIds.has(pending.id)) continue;
    const uploading = pending.status === "uploading" || pending.status === "preparing";
    const failed = pending.status === "failed";
    cards.push({
      key: `pending:${pending.id}`,
      documentId: null,
      isPersistedDocument: false,
      eligibleForBulkDelete: false,
      fileName: pending.name,
      purpose: "Drawing",
      purposeDetail: "Will be organized after upload finishes.",
      status: uploading ? "Uploading" : failed ? "Failed" : "Uploading",
      statusDetail: uploading
        ? "Uploading to your project…"
        : failed
          ? pending.error ?? "Upload failed."
          : "Queued — upload starting…",
      countLabel: null,
      showRemove: pending.status === "pending" || failed,
      showCancelProcessing: false,
      showRetryAnalysis: false,
      ingestionJobId: null,
      borderClass: failed
        ? "border-destructive/40 bg-destructive/[0.04] border-dashed"
        : "border-dashed border-teal/40 bg-muted/20",
    });
  }

  cards.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return cards;
}

export function resolveActiveWorkflowStep(input: {
  hasAnyDocuments: boolean;
  anyOrganizing: boolean;
  includedSheetCount: number;
  analyzing: boolean;
  hasResults: boolean;
  analysisStale: boolean;
}): { activeStep: WorkflowStepId; nextHint: string } {
  if (!input.hasAnyDocuments) {
    return { activeStep: 1, nextHint: "Upload drawings and supporting PDFs to begin." };
  }
  if (input.anyOrganizing) {
    return { activeStep: 2, nextHint: "Wait for organization to finish before running analysis." };
  }
  if (input.analyzing) {
    return { activeStep: 4, nextHint: "Analysis is running — results will appear below when complete." };
  }
  if (input.hasResults && !input.analysisStale) {
    return { activeStep: 5, nextHint: "Review findings below or update analysis after changing the drawing set." };
  }
  if (input.includedSheetCount > 0) {
    return {
      activeStep: 3,
      nextHint: input.analysisStale
        ? "Drawing set changed — run Update Analysis when ready."
        : "Run analysis when the drawing set looks correct.",
    };
  }
  return {
    activeStep: 2,
    nextHint: "Add at least one drawing file with plan sheets to analyze.",
  };
}
