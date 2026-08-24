import type { CodeAnalyzerSheet } from "./model";
import type { ComplianceBatchFileStatus } from "@/lib/complianceBatchProcessor";

export type DocumentCardStatus =
  | "uploading"
  | "ready"
  | "analyzing"
  | "completed"
  | "partial"
  | "failed"
  | "stale";

export type SheetChipStatus = "pending" | "analyzing" | "completed" | "failed" | "excluded";

export interface DocumentSheetCounts {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  analyzing: number;
}

export interface DocumentCardStatusInput {
  includedSheets: CodeAnalyzerSheet[];
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  analyzing: boolean;
  currentAnalyzingSheetId?: string | null;
  analysisStale?: boolean;
  /** Included sheets in this source document that are new since the last completed run. */
  newSheetIds?: Set<string>;
}

export interface DocumentCardPresentation {
  status: DocumentCardStatus;
  counts: DocumentSheetCounts;
  badgeLabel: string;
  progressLabel: string;
  borderClass: string;
  badgeVariant: "brand" | "success" | "warning" | "destructive" | "outline";
}

export function countDocumentSheetStates(input: {
  includedSheets: CodeAnalyzerSheet[];
  completedSheetIds: Set<string>;
  failedSheetIds: Set<string>;
  currentAnalyzingSheetId?: string | null;
}): DocumentSheetCounts {
  const included = input.includedSheets.filter((s) => !s.excluded);
  let completed = 0;
  let failed = 0;
  let analyzing = 0;

  for (const sheet of included) {
    if (input.currentAnalyzingSheetId && sheet.id === input.currentAnalyzingSheetId) {
      analyzing += 1;
    } else if (input.failedSheetIds.has(sheet.id)) {
      failed += 1;
    } else if (input.completedSheetIds.has(sheet.id)) {
      completed += 1;
    }
  }

  const total = included.length;
  const pending = Math.max(0, total - completed - failed - analyzing);
  return { total, completed, failed, pending, analyzing };
}

export function deriveSheetChipStatus(
  sheet: CodeAnalyzerSheet,
  input: {
    completedSheetIds: Set<string>;
    failedSheetIds: Set<string>;
    analyzing: boolean;
    currentAnalyzingSheetId?: string | null;
  },
): SheetChipStatus {
  if (sheet.excluded) return "excluded";
  if (input.analyzing && input.currentAnalyzingSheetId === sheet.id) return "analyzing";
  if (input.failedSheetIds.has(sheet.id)) return "failed";
  if (input.completedSheetIds.has(sheet.id)) return "completed";
  return "pending";
}

export function sheetChipClassName(status: SheetChipStatus): string {
  switch (status) {
    case "excluded":
      return "opacity-60 border-border bg-muted/40";
    case "failed":
      return "border-destructive/50 bg-destructive/5";
    case "completed":
      return "border-success/35 bg-success/[0.06]";
    case "analyzing":
      return "border-gold/50 bg-gold/[0.10] text-gold-deep";
    case "pending":
    default:
      return "border-border bg-muted/40";
  }
}

export function isDocumentStale(input: {
  analysisStale?: boolean;
  newSheetIds?: Set<string>;
  includedSheets: CodeAnalyzerSheet[];
}): boolean {
  if (!input.analysisStale) return false;
  const newIds = input.newSheetIds;
  if (!newIds || newIds.size === 0) return false;
  return input.includedSheets.some((s) => !s.excluded && newIds.has(s.id));
}

export function deriveDocumentCardStatus(input: DocumentCardStatusInput): DocumentCardPresentation {
  const counts = countDocumentSheetStates(input);
  const stale = isDocumentStale(input);

  if (stale && !input.analyzing) {
    return {
      status: "stale",
      counts,
      badgeLabel: "Needs update",
      progressLabel: "Drawing set changed since last analysis",
      borderClass: "border-gold/50 bg-gold/[0.08]",
      badgeVariant: "brand",
    };
  }

  if (input.analyzing && counts.total > 0 && counts.completed + counts.failed < counts.total) {
    return {
      status: "analyzing",
      counts,
      badgeLabel: "Analyzing",
      progressLabel: `${counts.completed} of ${counts.total} sheet${counts.total === 1 ? "" : "s"} analyzed`,
      borderClass: "border-gold/45 bg-gold/[0.05]",
      badgeVariant: "brand",
    };
  }

  if (counts.total === 0) {
    return {
      status: "ready",
      counts,
      badgeLabel: "Ready",
      progressLabel: "No included sheets",
      borderClass: "border-border bg-card",
      badgeVariant: "outline",
    };
  }

  if (counts.failed === counts.total) {
    return {
      status: "failed",
      counts,
      badgeLabel: "Failed",
      progressLabel: `${counts.failed} of ${counts.total} failed`,
      borderClass: "border-destructive/40 bg-destructive/[0.04]",
      badgeVariant: "destructive",
    };
  }

  if (counts.completed === counts.total && counts.failed === 0) {
    return {
      status: "completed",
      counts,
      badgeLabel: "Completed",
      progressLabel: `${counts.total} of ${counts.total} completed`,
      borderClass: "border-success/35 bg-success/[0.03]",
      badgeVariant: "success",
    };
  }

  if (counts.completed > 0 && counts.failed > 0 && counts.pending === 0 && !input.analyzing) {
    return {
      status: "partial",
      counts,
      badgeLabel: "Partial",
      progressLabel: `${counts.completed} completed · ${counts.failed} failed`,
      borderClass: "border-warning/40 bg-warning/[0.04]",
      badgeVariant: "warning",
    };
  }

  if (counts.completed === 0 && counts.failed === 0) {
    return {
      status: "ready",
      counts,
      badgeLabel: "Ready",
      progressLabel: "Ready for analysis",
      borderClass: "border-gold/30 bg-card",
      badgeVariant: "brand",
    };
  }

  if (counts.failed > 0) {
    return {
      status: "partial",
      counts,
      badgeLabel: "Partial",
      progressLabel: `${counts.completed} completed · ${counts.failed} failed`,
      borderClass: "border-warning/40 bg-warning/[0.04]",
      badgeVariant: "warning",
    };
  }

  return {
    status: "ready",
    counts,
    badgeLabel: "Ready",
    progressLabel: "Ready for analysis",
    borderClass: "border-gold/30 bg-card",
    badgeVariant: "brand",
  };
}

export function deriveUploadQueueCardStatus(
  status: ComplianceBatchFileStatus,
): Pick<DocumentCardPresentation, "status" | "badgeLabel" | "progressLabel" | "borderClass" | "badgeVariant"> {
  switch (status) {
    case "uploading":
    case "preparing":
      return {
        status: status === "uploading" ? "uploading" : "ready",
        badgeLabel: status === "uploading" ? "Uploading" : "Preparing",
        progressLabel: status === "uploading" ? "Upload in progress" : "Preparing upload",
        borderClass: "border-gold/45 bg-gold/[0.05] border-dashed",
        badgeVariant: "brand",
      };
    case "analyzing":
      return {
        status: "analyzing",
        badgeLabel: "Analyzing",
        progressLabel: "Analyzing sheet",
        borderClass: "border-gold/45 bg-gold/[0.05]",
        badgeVariant: "brand",
      };
    case "completed":
      return {
        status: "completed",
        badgeLabel: "Completed",
        progressLabel: "Upload complete",
        borderClass: "border-success/35 bg-success/[0.03] border-dashed border-teal/50",
        badgeVariant: "success",
      };
    case "failed":
      return {
        status: "failed",
        badgeLabel: "Failed",
        progressLabel: "Upload or analysis failed",
        borderClass: "border-destructive/40 bg-destructive/[0.04] border-dashed",
        badgeVariant: "destructive",
      };
    case "pending":
    default:
      return {
        status: "ready",
        badgeLabel: "Ready",
        progressLabel: "Queued for upload",
        borderClass: "border-dashed border-teal/50",
        badgeVariant: "brand",
      };
  }
}
