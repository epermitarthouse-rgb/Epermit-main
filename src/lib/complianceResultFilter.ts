/** Sentinel for the results document filter: show every analyzed file. */
export const COMPLIANCE_RESULTS_FILTER_ALL = "all";

/** Sentinel for compliance score filter: show every result group. */
export const COMPLIANCE_SCORE_FILTER_ALL = "all";

/** Show only groups that are not fully compliant. */
export const COMPLIANCE_SCORE_FILTER_NOT_100 = "not_100";

export type ComplianceScoreFilter =
  | typeof COMPLIANCE_SCORE_FILTER_ALL
  | typeof COMPLIANCE_SCORE_FILTER_NOT_100;

export interface ComplianceResultGroupRef {
  id: string;
  fileName: string;
  /** Persisted project_documents.id when available. */
  documentId?: string | null;
}

export interface ComplianceScoreGroupRef extends ComplianceResultGroupRef {
  failed?: boolean;
  ibcResult?: {
    summary?: { overallScore?: number; totalIssues?: number };
    issues?: unknown[];
  } | null;
  localResult?: {
    summary?: { overallScore?: number; totalIssues?: number };
    issues?: unknown[];
  } | null;
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

function resultLooksNonCompliant(result: ComplianceScoreGroupRef["ibcResult"]): boolean {
  if (!result) return false;
  const score = result.summary?.overallScore;
  if (typeof score === "number" && score < 100) return true;
  const total = result.summary?.totalIssues;
  if (typeof total === "number" && total > 0) return true;
  if (Array.isArray(result.issues) && result.issues.length > 0) return true;
  return false;
}

/**
 * A group is not fully compliant when analysis failed, any code result scores
 * below 100, or any result reports issues.
 */
export function isNotFullyCompliantGroup(group: ComplianceScoreGroupRef): boolean {
  if (group.failed) return true;
  return resultLooksNonCompliant(group.ibcResult) || resultLooksNonCompliant(group.localResult);
}

/**
 * Filter result groups by compliance score mode.
 * - `all` (or empty): return every group
 * - `not_100`: only failed / score < 100 / has-issues groups
 */
export function filterComplianceGroupsByScore<T extends ComplianceScoreGroupRef>(
  groups: T[],
  scoreFilter: string,
): T[] {
  if (!scoreFilter || scoreFilter === COMPLIANCE_SCORE_FILTER_ALL) {
    return groups;
  }
  if (scoreFilter === COMPLIANCE_SCORE_FILTER_NOT_100) {
    return groups.filter(isNotFullyCompliantGroup);
  }
  return groups;
}
