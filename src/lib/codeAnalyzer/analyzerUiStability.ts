import { complianceDocsHydrateKey } from "@/lib/complianceAnalysisHydrate";
import { computeSheetFingerprint, type CodeAnalyzerSheet } from "./model";

/** Stable key for sheet document ids used by index prescreen downloads. */
export function sheetDocumentIdsKey(docIds: Iterable<string>): string {
  return complianceDocsHydrateKey(docIds);
}

/** Fingerprint of included analyzer sheets (order-independent). */
export function analyzerSheetFingerprint(sheets: CodeAnalyzerSheet[]): string {
  return computeSheetFingerprint(sheets);
}

/** Serialize run index completeness for stable effect deps (not object reference). */
export function serializeIndexCompleteness(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** Composite key for the index prescreen effect — unchanged key means no re-run / no loading flash. */
export function indexPrescreenEffectKey(input: {
  sheetFingerprint: string;
  sheetDocIdsKey: string;
  isModificationMode: boolean;
}): string {
  return [
    input.sheetFingerprint,
    input.sheetDocIdsKey,
    input.isModificationMode ? "mod" : "std",
  ].join("\0");
}

/** True when prescreen inputs changed and the effect should run (and show loading). */
export function shouldRunIndexPrescreen(prevKey: string, nextKey: string): boolean {
  return prevKey !== nextKey;
}

/** JSX guard for IndexCompletenessPanel — keep visible while loading/rechecking or when a result exists. */
export function shouldShowIndexCompletenessPanel(input: {
  persistedSheetCount: number;
  result: unknown;
  loading?: boolean;
  recheckError?: string | null;
}): boolean {
  if (input.result != null) return true;
  if (input.loading) return true;
  if (input.recheckError) return true;
  return input.persistedSheetCount > 0;
}

/**
 * Clear prescreen only when a dataset reload confirms zero included sheets.
 * Transient empty persistedSheets during project/hydration transitions must not wipe UI state.
 */
export function shouldClearPrescreenOnDatasetReload(includedSheetCount: number): boolean {
  return includedSheetCount === 0;
}

/**
 * Prescreen effect must not clear a valid result when included count hits zero mid-transition.
 * Explicit project switch and confirmed-empty reload handle clearing instead.
 */
export function shouldWipePrescreenResultInEffect(_includedSheetCount: number): boolean {
  return false;
}

/** Document discovery after save must not reset sheets/runs — only annotations + doc rows. */
export type AnalyzerDocsDiscoveryScope = "annotations_and_docs" | "full_dataset";

export function analyzerDocsDiscoveryScope(): AnalyzerDocsDiscoveryScope {
  return "annotations_and_docs";
}
