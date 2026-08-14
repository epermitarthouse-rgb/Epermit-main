import type {
  UciDocumentReprocessOutcome,
  UciDocumentReprocessResponse,
} from "@/lib/uciDocumentProcessing";

export interface DocumentReprocessFailure {
  document_id: string;
  message: string;
}

export interface DocumentReprocessBatchResult {
  results: UciDocumentReprocessResponse[];
  failures: DocumentReprocessFailure[];
}

export async function executeSequentialDocumentReprocess(
  documentIds: string[],
  worker: (documentId: string) => Promise<UciDocumentReprocessResponse>,
  formatError: (error: unknown) => string,
  onProgress?: (completed: number) => void,
): Promise<DocumentReprocessBatchResult> {
  const results: UciDocumentReprocessResponse[] = [];
  const failures: DocumentReprocessFailure[] = [];
  for (const [index, documentId] of documentIds.entries()) {
    try {
      results.push(await worker(documentId));
    } catch (error: unknown) {
      failures.push({ document_id: documentId, message: formatError(error) });
    } finally {
      onProgress?.(index + 1);
    }
  }
  return { results, failures };
}

export function summarizeDocumentReprocessBatch(
  total: number,
  batch: DocumentReprocessBatchResult,
): {
  processed: number;
  parsed: number;
  stillNeedsFallback: number;
  failed: number;
  unchanged: number;
  message: string;
} {
  const parsed = batch.results.filter((result) =>
    ["parsed", "parsed_with_fallback_warning"].includes(result.outcome),
  ).length;
  const unchanged = batch.results.filter((result) => result.outcome === "unchanged").length;
  const stillNeedsFallback = batch.results.filter((result) =>
    ["still_needs_fallback", "fallback_unavailable", "manual_review_required"].includes(
      result.outcome,
    ),
  ).length;
  const failed =
    batch.failures.length +
    batch.results.filter((result) =>
      ["failed", "fallback_failed"].includes(result.outcome),
    ).length;
  const processed = batch.results.length + batch.failures.length;
  return {
    processed,
    parsed,
    stillNeedsFallback,
    failed,
    unchanged,
    message:
      `Batch reprocess complete — processed ${processed}/${total}` +
      ` · parsed ${parsed} · still needs fallback/review ${stillNeedsFallback}` +
      ` · failed ${failed} · unchanged ${unchanged}`,
  };
}

export function reprocessOutcomeTone(
  outcome: UciDocumentReprocessOutcome,
): "success" | "info" | "warning" | "error" {
  if (outcome === "parsed") return "success";
  if (outcome === "parsed_with_fallback_warning") return "warning";
  if (outcome === "unchanged") return "info";
  if (
    outcome === "still_needs_fallback" ||
    outcome === "fallback_unavailable" ||
    outcome === "manual_review_required"
  ) {
    return "warning";
  }
  return "error";
}
