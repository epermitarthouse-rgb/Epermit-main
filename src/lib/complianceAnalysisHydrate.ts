/**
 * Helpers for hydrating Code Analyzer prior analyses (All / per-document).
 * Kept pure so race / empty-state behavior can be unit-tested without React.
 */

/** Stable key for the set of analyzed document ids (order-independent). */
export function complianceDocsHydrateKey(docIds: Iterable<string>): string {
  return Array.from(docIds).filter(Boolean).sort().join(",");
}

/**
 * Monotonic generation token so async fetch/hydrate completions from a
 * previous project or superseded request do not overwrite newer state.
 */
export function createGenerationGuard() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
    /** Invalidate in-flight work without starting a new request. */
    invalidate(): void {
      current += 1;
    },
    get current() {
      return current;
    },
  };
}

export type ComplianceResultsEmptyKind =
  | "loading"
  | "load_failed"
  | "no_analyzed_docs"
  | "filter_not_100"
  | "filter_document"
  | "none";

export interface ComplianceResultsEmptyInput {
  loading: boolean;
  loadFailed: boolean;
  analyzedDocCount: number;
  resultGroupCount: number;
  displayedGroupCount: number;
  documentFilterIsAll: boolean;
  scoreFilterIsNot100: boolean;
}

/**
 * Decide which empty-state copy to show under the results panel.
 * Returns `none` when there is something to render.
 */
export function resolveComplianceResultsEmptyKind(
  input: ComplianceResultsEmptyInput,
): ComplianceResultsEmptyKind {
  if (input.displayedGroupCount > 0) return "none";
  if (input.loading) return "loading";
  if (input.loadFailed && input.analyzedDocCount > 0) return "load_failed";
  if (input.analyzedDocCount === 0 && input.resultGroupCount === 0) {
    return "no_analyzed_docs";
  }
  if (input.scoreFilterIsNot100) return "filter_not_100";
  if (!input.documentFilterIsAll) return "filter_document";
  // Analyzed docs exist but hydrate produced nothing — treat as load failure.
  if (input.analyzedDocCount > 0 && input.resultGroupCount === 0) {
    return "load_failed";
  }
  return "filter_document";
}

export function complianceResultsEmptyMessage(
  kind: ComplianceResultsEmptyKind,
  analyzedDocCount = 0,
): string | null {
  switch (kind) {
    case "none":
      return null;
    case "loading":
      return "Loading previous analyses…";
    case "load_failed":
      return analyzedDocCount > 0
        ? `Found ${analyzedDocCount} previously analyzed document${analyzedDocCount === 1 ? "" : "s"}, but results failed to load. Try picking All again or refresh the page.`
        : "Failed to load previous analyses. Try refreshing the page.";
    case "no_analyzed_docs":
      return "No previously analyzed documents for this project yet. Upload drawings and run Analyze to create results.";
    case "filter_not_100":
      return "No analyses match “Not 100% compliant”.";
    case "filter_document":
      return "No analysis results to show for this filter.";
    default:
      return null;
  }
}

/**
 * Merge a full All-hydrate set (replace) or a partial per-doc hydrate (merge).
 */
export function mergeLoadedExistingAnalyses<T extends { documentId: string }>(
  prev: T[],
  incoming: T[],
  mode: "replace" | "merge",
  replaceIds?: string[],
): T[] {
  if (mode === "replace") return incoming;
  const ids = new Set(replaceIds ?? incoming.map((r) => r.documentId));
  return [...prev.filter((p) => !ids.has(p.documentId)), ...incoming];
}
