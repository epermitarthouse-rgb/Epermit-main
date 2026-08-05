/**
 * Read-only DesignCheck summary from persisted compliance annotations.
 * Mirrors AIComplianceAnalyzer load-existing shapes — does not call analyze APIs.
 */

export type DesignCheckSeverity = "critical" | "warning" | "advisory";
export type DesignCheckCodeType = "ibc" | "local";
export type DesignCheckImpactBucket =
  | "Life Safety"
  | "Accessibility"
  | "Administrative"
  | "Other";

export type DesignCheckFinding = {
  id: string;
  documentId: string | null;
  documentName: string;
  category: string;
  title: string;
  description: string;
  severity: DesignCheckSeverity;
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
  codeType?: DesignCheckCodeType;
};

export type DesignCheckSummaryCounts = {
  totalIssues: number;
  critical: number;
  warnings: number;
  advisory: number;
  overallScore: number;
};

export type DesignCheckDocumentRef = {
  id: string;
  fileName: string;
};

export type DesignCheckProjectSummary = {
  documents: DesignCheckDocumentRef[];
  findings: DesignCheckFinding[];
  summary: DesignCheckSummaryCounts;
  impact: Record<DesignCheckImpactBucket, number>;
  latestUpdatedAt: string | null;
  jurisdiction: string | null;
  projectType: string | null;
  codeYear: string | null;
  hasIbc: boolean;
  hasLocal: boolean;
};

/** Annotation data shape stored by the Code Compliance Analyzer. */
export type DesignCheckAnnotationData = {
  compliance_issue?: boolean;
  compliance_metadata?: boolean;
  codeType?: DesignCheckCodeType;
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  severity?: DesignCheckSeverity;
  codeReference?: string;
  codeYear?: string;
  location?: string;
  suggestedFix?: string;
  summary?: DesignCheckSummaryCounts;
  jurisdictionNotes?: string;
  jurisdiction?: string;
  projectType?: string;
  codeYear_meta?: string;
};

const LIFE_SAFETY = new Set([
  "life safety",
  "egress",
  "fire safety",
  "fire",
  "structural",
]);
const ACCESSIBILITY = new Set(["accessibility", "ada"]);
const ADMINISTRATIVE = new Set([
  "administrative",
  "zoning",
  "documentation",
  "admin",
]);

export function bucketImpactCategory(category: string | undefined | null): DesignCheckImpactBucket {
  const key = (category ?? "").trim().toLowerCase();
  if (!key) return "Other";
  if (LIFE_SAFETY.has(key) || key.includes("life safety") || key.includes("egress") || key.includes("fire")) {
    return "Life Safety";
  }
  if (ACCESSIBILITY.has(key) || key.includes("accessib") || key.includes("ada")) {
    return "Accessibility";
  }
  if (ADMINISTRATIVE.has(key) || key.includes("zoning") || key.includes("admin")) {
    return "Administrative";
  }
  return "Other";
}

/** Match FE analyzer load path when metadata summary is missing. */
export function recomputeOverallScore(counts: {
  critical: number;
  warnings: number;
  advisory: number;
  totalIssues: number;
}): number {
  if (counts.totalIssues === 0) return 100;
  return Math.max(0, 100 - counts.critical * 15 - counts.warnings * 5 - counts.advisory * 2);
}

export function summarizeFindings(findings: DesignCheckFinding[]): DesignCheckSummaryCounts {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const advisory = findings.filter((f) => f.severity === "advisory").length;
  const totalIssues = findings.length;
  return {
    totalIssues,
    critical,
    warnings,
    advisory,
    overallScore: recomputeOverallScore({ critical, warnings, advisory, totalIssues }),
  };
}

export function aggregateImpact(
  findings: DesignCheckFinding[],
): Record<DesignCheckImpactBucket, number> {
  const impact: Record<DesignCheckImpactBucket, number> = {
    "Life Safety": 0,
    Accessibility: 0,
    Administrative: 0,
    Other: 0,
  };
  for (const f of findings) {
    impact[bucketImpactCategory(f.category)] += 1;
  }
  return impact;
}

export type DesignCheckAnnotationRow = {
  id: string;
  document_id: string | null;
  updated_at?: string | null;
  data: unknown;
};

export type DesignCheckDocumentRow = {
  id: string;
  file_name?: string | null;
};

/**
 * Pure builder: turns annotation + document rows into a DesignCheck project summary.
 */
export function buildDesignCheckSummary(
  annotations: DesignCheckAnnotationRow[],
  documents: DesignCheckDocumentRow[],
): DesignCheckProjectSummary | null {
  const docNameById = new Map(
    documents.map((d) => [d.id, d.file_name?.trim() || "Untitled document"]),
  );

  const findings: DesignCheckFinding[] = [];
  const docIds = new Set<string>();
  let latestUpdatedAt: string | null = null;
  let jurisdiction: string | null = null;
  let projectType: string | null = null;
  let codeYear: string | null = null;
  let hasIbc = false;
  let hasLocal = false;
  let storedScore: number | null = null;

  for (const ann of annotations) {
    const d = (ann.data ?? {}) as DesignCheckAnnotationData;
    if (!d.compliance_issue && !d.compliance_metadata) continue;

    if (ann.document_id) docIds.add(ann.document_id);
    if (ann.updated_at && (!latestUpdatedAt || ann.updated_at > latestUpdatedAt)) {
      latestUpdatedAt = ann.updated_at;
    }

    if (d.compliance_metadata) {
      if (d.codeType === "local") hasLocal = true;
      else hasIbc = true;
      if (d.jurisdiction) jurisdiction = d.jurisdiction;
      if (d.projectType) projectType = d.projectType;
      if (d.codeYear_meta || d.codeYear) codeYear = d.codeYear_meta || d.codeYear || null;
      if (typeof d.summary?.overallScore === "number") {
        // Prefer latest metadata score when aggregating; final score may still recompute from issues.
        storedScore = d.summary.overallScore;
      }
      continue;
    }

    if (d.compliance_issue) {
      if (d.codeType === "local") hasLocal = true;
      else if (d.codeType === "ibc") hasIbc = true;

      const severity: DesignCheckSeverity =
        d.severity === "critical" || d.severity === "warning" || d.severity === "advisory"
          ? d.severity
          : "advisory";

      findings.push({
        id: d.id || ann.id,
        documentId: ann.document_id,
        documentName: ann.document_id
          ? docNameById.get(ann.document_id) ?? "Unknown document"
          : "Unknown document",
        category: d.category || "",
        title: d.title || "",
        description: d.description || "",
        severity,
        codeReference: d.codeReference || "",
        codeYear: d.codeYear || "",
        location: d.location || "",
        suggestedFix: d.suggestedFix || "",
        codeType: d.codeType,
      });
    }
  }

  if (docIds.size === 0 && findings.length === 0) {
    return null;
  }

  const computed = summarizeFindings(findings);
  // Prefer recomputed from issue rows (matches analyzer when loading issues);
  // fall back to stored metadata score only when there are metadata rows but no issue rows.
  const overallScore =
    findings.length > 0
      ? computed.overallScore
      : storedScore ?? computed.overallScore;

  return {
    documents: Array.from(docIds).map((id) => ({
      id,
      fileName: docNameById.get(id) ?? "Unknown document",
    })),
    findings,
    summary: { ...computed, overallScore },
    impact: aggregateImpact(findings),
    latestUpdatedAt,
    jurisdiction,
    projectType,
    codeYear,
    hasIbc,
    hasLocal,
  };
}
