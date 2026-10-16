/**
 * User-facing document workflow model for Code Analyzer V2 (no raw backend labels).
 */
import { isTerminalIngestionStatus, type CodeAnalyzerIngestionJob } from "./ingestion";
import { isArchitecturalSheetFileName } from "./sheetFileName";
import type { CodeAnalyzerSheet } from "./model";
import { deriveDocumentCardStatus } from "./documentCardStatus";
import type { ComplianceBatchFileStatus } from "@/lib/complianceBatchProcessor";
import type { SheetJobSummary } from "./asyncRun";
import { failedSheetIdsForDocument } from "./retryWorkflow";

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
  | "Not analyzed"
  | "Excluded from analysis"
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
  /** @deprecated use showRetryFailedAnalysis */
  showRetryAnalysis: boolean;
  showRetryFailedAnalysis: boolean;
  showRetryOrganizing: boolean;
  /** Sheet ids with failed jobs on the active run (document-scoped retry). */
  retryFailedSheetIds: string[];
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
  if (isArchitecturalSheetFileName(doc.file_name)) {
    return {
      purpose: "Drawing",
      detail: "Plan sheets from this file are analyzed visually.",
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

type DocumentStatusFields = Pick<
  ConsolidatedDocumentCardModel,
  | "status"
  | "statusDetail"
  | "borderClass"
  | "showRetryAnalysis"
  | "showRetryFailedAnalysis"
  | "showRetryOrganizing"
  | "retryFailedSheetIds"
>;

function withRetryDefaults(
  fields: Omit<
    DocumentStatusFields,
    "showRetryAnalysis" | "showRetryFailedAnalysis" | "showRetryOrganizing" | "retryFailedSheetIds"
  > &
    Partial<
      Pick<
        DocumentStatusFields,
        "showRetryAnalysis" | "showRetryFailedAnalysis" | "showRetryOrganizing" | "retryFailedSheetIds"
      >
    >,
): DocumentStatusFields {
  return {
    showRetryAnalysis: false,
    showRetryFailedAnalysis: false,
    showRetryOrganizing: false,
    retryFailedSheetIds: [],
    ...fields,
  };
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
  /** True when a terminal compliance run finished and results are in effect (Step 5). */
  analysisSettled?: boolean;
}): DocumentStatusFields {
  const { doc, job } = input;

  if (job?.status === "failed") {
    const err = job.last_error?.trim();
    return withRetryDefaults({
      status: "Failed",
      statusDetail: err
        ? `Organization failed: ${err.slice(0, 160)}`
        : "Organization failed. Retry organizing or remove and re-upload if the problem persists.",
      borderClass: "border-destructive/40 bg-destructive/[0.04]",
      showRetryOrganizing: true,
    });
  }

  if (ingestionIsActive(job) || doc.analyzer_processing_status === "processing" || doc.analyzer_processing_status === "queued") {
    return withRetryDefaults({
      status: "Organizing",
      statusDetail: "PermitPilot is preparing plan sheets from this file.",
      borderClass: "border-gold/45 bg-gold/[0.05]",
    });
  }

  const terminalJob =
    job?.status === "completed" || job?.status === "partial";
  if (
    !terminalJob &&
    !doc.analyzer_class &&
    doc.document_type === "permit_drawing" &&
    (doc.analyzer_processing_status === "not_started" || !doc.analyzer_processing_status)
  ) {
    return withRetryDefaults({
      status: "Needs attention",
      statusDetail: "This file was not organized yet. Remove it or upload again through Add documents.",
      borderClass: "border-warning/40 bg-warning/[0.04]",
    });
  }

  const purpose = resolveDocumentPurpose(doc, input.includedSheets.filter((s) => !s.excluded).length);

  if (purpose.purpose === "Supporting document" || purpose.purpose === "Code modification form") {
    const organized =
      doc.analyzer_processing_status === "completed" ||
      doc.analyzer_processing_status === "partial" ||
      job?.status === "completed" ||
      job?.status === "partial";
    if (purpose.purpose === "Code modification form" && organized) {
      return withRetryDefaults({
        status: "Ready for analysis",
        statusDetail: "Form is stored for Code Modification review.",
        borderClass: "border-border bg-card",
      });
    }
    if (organized) {
      return withRetryDefaults({
        status: "Used as analysis context",
        statusDetail:
          purpose.purpose === "Supporting document"
            ? "Indexed for specification context during drawing analysis."
            : null,
        borderClass: "border-teal/30 bg-teal/[0.03]",
      });
    }
    return withRetryDefaults({
      status: "Organizing",
      statusDetail: "PermitPilot is preparing this supporting document.",
      borderClass: "border-gold/45 bg-gold/[0.05]",
    });
  }

  if (purpose.purpose === "Drawing") {
    const included = input.includedSheets.filter((s) => !s.excluded);
    const allSheets = input.includedSheets;
    const organized =
      doc.analyzer_processing_status === "completed" ||
      doc.analyzer_processing_status === "partial" ||
      job?.status === "completed" ||
      job?.status === "partial";

    if (input.analysisSettled && included.length === 0) {
      if (allSheets.length > 0 && allSheets.every((s) => s.excluded)) {
        return withRetryDefaults({
          status: "Excluded from analysis",
          statusDetail: "All plan sheets from this file were excluded from the drawing set.",
          borderClass: "border-border bg-muted/30",
        });
      }
      if (organized || allSheets.length === 0) {
        return withRetryDefaults({
          status: "Not analyzed",
          statusDetail:
            "No analyzable plan sheets were detected from this file. Detail-only or non-rasterized pages are not in the analysis set.",
          borderClass: "border-border bg-muted/25",
        });
      }
    }

    const card = deriveDocumentCardStatus({
      includedSheets: input.includedSheets,
      completedSheetIds: input.completedSheetIds,
      failedSheetIds: input.failedSheetIds,
      analyzing: input.analyzing,
      currentAnalyzingSheetId: input.currentAnalyzingSheetId,
      analysisStale: input.analysisStale,
      analysisSettled: input.analysisSettled,
    });

    const failedSheetIdsOnDoc = input.includedSheets
      .filter((s) => !s.excluded && input.failedSheetIds.has(s.id))
      .map((s) => s.id);

    if (card.status === "failed" || (card.counts.failed > 0 && card.counts.completed === 0)) {
      return withRetryDefaults({
        status: "Failed",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: true,
        showRetryFailedAnalysis: failedSheetIdsOnDoc.length > 0,
        retryFailedSheetIds: failedSheetIdsOnDoc,
      });
    }
    if (card.status === "partial" || card.counts.failed > 0) {
      return withRetryDefaults({
        status: "Needs attention",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
        showRetryAnalysis: true,
        showRetryFailedAnalysis: failedSheetIdsOnDoc.length > 0,
        retryFailedSheetIds: failedSheetIdsOnDoc,
      });
    }
    if (card.status === "completed") {
      return withRetryDefaults({
        status: "Completed",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
      });
    }
    if (card.status === "analyzing") {
      return withRetryDefaults({
        status: "Analyzing",
        statusDetail: card.progressLabel,
        borderClass: card.borderClass,
      });
    }
    if (card.status === "stale") {
      return withRetryDefaults({
        status: "Needs attention",
        statusDetail: "Drawing set changed — run Update Analysis.",
        borderClass: card.borderClass,
      });
    }

    if (included.length === 0 && organized && !input.analyzing) {
      return withRetryDefaults({
        status: "Not analyzed",
        statusDetail: "No analyzable plan sheets detected from this file.",
        borderClass: "border-border bg-muted/25",
      });
    }

    return withRetryDefaults({
      status: "Ready for analysis",
      statusDetail: card.progressLabel,
      borderClass: card.borderClass,
    });
  }

  return withRetryDefaults({
    status: "Needs attention",
    statusDetail: null,
    borderClass: "border-border bg-card",
  });
}

export function formatDocumentCountLabel(input: {
  purpose: DocumentPurposeLabel;
  includedSheetCount: number;
  totalPages: number | null;
  isPdf: boolean;
}): string | null {
  if (input.purpose === "Drawing") {
    if (input.includedSheetCount === 0) {
      return input.totalPages
        ? `${input.totalPages} page${input.totalPages === 1 ? "" : "s"} · no analyzable sheets detected`
        : "No analyzable sheets detected";
    }
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
  analysisSettled?: boolean;
  /** When set, refines retryFailedSheetIds per document from durable sheet jobs. */
  sheetJobs?: SheetJobSummary[];
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
      analysisSettled: input.analysisSettled,
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
    let retryFailedSheetIds = statusFields.retryFailedSheetIds;
    if (input.sheetJobs?.length) {
      retryFailedSheetIds = failedSheetIdsForDocument(doc.id, input.sheets, input.sheetJobs);
    }
    const showRetryFailedAnalysis =
      statusFields.showRetryFailedAnalysis || retryFailedSheetIds.length > 0;

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
      showRetryAnalysis: statusFields.showRetryAnalysis || showRetryFailedAnalysis,
      showRetryFailedAnalysis,
      showRetryOrganizing: statusFields.showRetryOrganizing,
      retryFailedSheetIds,
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
      showRetryFailedAnalysis: false,
      showRetryOrganizing: false,
      retryFailedSheetIds: [],
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
