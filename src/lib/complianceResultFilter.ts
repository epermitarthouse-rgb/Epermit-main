/** Sentinel for the results document filter: show every analyzed file. */
export const COMPLIANCE_RESULTS_FILTER_ALL = "all";

export interface ComplianceResultGroupRef {
  id: string;
  fileName: string;
  /** Persisted project_documents.id when available. */
  documentId?: string | null;
}

/**
 * Filter multi-document compliance result groups by the analyzer dropdown.
 * - `all` (or empty): return every group
 * - specific id: match group id, documentId, or optional file name
 */
export function filterComplianceResultGroups<T extends ComplianceResultGroupRef>(
  groups: T[],
  filterId: string,
  matchFileName?: string | null,
): T[] {
  if (!filterId || filterId === COMPLIANCE_RESULTS_FILTER_ALL) {
    return groups;
  }
  const name = matchFileName?.trim() || null;
  return groups.filter(
    (g) =>
      g.id === filterId ||
      g.documentId === filterId ||
      (name != null && g.fileName === name),
  );
}
