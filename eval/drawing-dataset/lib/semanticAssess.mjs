/**
 * Automated evidence assessment for Phase 2A.5.
 * These statuses are machine assessments, not professional verification.
 */

import { normalizeText } from "./semanticRetrieve.mjs";
import { tokenizeEvidence } from "./layoutSemanticPrep.mjs";

export const AUTOMATED_STATUSES = [
  "evidence_retrieved",
  "contradicted_candidate",
  "insufficient_evidence",
  "unresolved",
];

/** @deprecated Use evidence_retrieved — kept only for reading older Phase 2A.5 artifacts. */
export const LEGACY_RETRIEVAL_SUPPORTED = "supported";

export function normalizeAutomatedAssessment(status) {
  if (status === LEGACY_RETRIEVAL_SUPPORTED || status === "supported") return "evidence_retrieved";
  return status;
}

const SEVERITY_RANK = { critical: 0, warning: 1, advisory: 2 };

export function severityRank(severity) {
  return SEVERITY_RANK[String(severity || "").toLowerCase()] ?? 9;
}

export function sortFindingsForReview(findings) {
  return [...(findings || [])].sort((left, right) => {
    const sev = severityRank(left.severity || left.original?.severity)
      - severityRank(right.severity || right.original?.severity);
    if (sev !== 0) return sev;
    return String(left.clientReportId).localeCompare(String(right.clientReportId));
  });
}

/**
 * Map retrieval results to an automated assessment.
 * `evidence_retrieved` means sheet text/regions matched the cited evidence string.
 * It does NOT mean the finding conclusion is technically correct or professionally verified.
 */
export function assessRetrieval(retrieval, options = {}) {
  const supportedFloor = options.supportedFloor ?? 0.45;
  const strongFloor = options.strongFloor ?? 0.7;
  const candidates = retrieval?.candidates || [];
  const query = retrieval?.query || {};
  if (!retrieval || retrieval.status === "no_layout_page") {
    return {
      automatedAssessment: "unresolved",
      confidence: "low",
      rationale: "No layout page was available for this finding sheet.",
      professionallyVerified: false,
      verificationStatus: "not_professionally_verified",
      retrievalSuccess: false,
    };
  }
  if (!candidates.length) {
    return {
      automatedAssessment: "unresolved",
      confidence: "low",
      rationale: "No evidence candidates met retrieval thresholds.",
      professionallyVerified: false,
      verificationStatus: "not_professionally_verified",
      retrievalSuccess: false,
    };
  }

  const best = candidates[0];
  const strongSignals = new Set(best.signals || []);
  const sharedCount = (best.sharedTokens || []).length;
  const hasHardSupport = strongSignals.has("full_normalized_span")
    || strongSignals.has("partial_span")
    || strongSignals.has("numeric_fact")
    || (sharedCount >= 3 && best.score >= supportedFloor)
    || (
      strongSignals.has("location_keyword")
      && strongSignals.has("technical_terminology")
      && best.score >= 0.55
    );

  const positivePresence = strongSignals.has("numeric_fact")
    || strongSignals.has("full_normalized_span")
    || strongSignals.has("partial_span")
    || (strongSignals.has("technical_terminology") && best.score >= 0.4);
  if (query.absenceClaim && positivePresence && best.score >= Math.min(supportedFloor, 0.4)) {
    // Finding asserts absence/missing content while positive sheet text was retrieved.
    return {
      automatedAssessment: "contradicted_candidate",
      confidence: "hypothesis",
      rationale: "Finding language suggests absence/missing content, but positive sheet text was retrieved. Candidate only — not a verified contradiction.",
      professionallyVerified: false,
      verificationStatus: "not_professionally_verified",
      retrievalSuccess: true,
      bestScore: best.score,
      primarySignals: best.signals,
    };
  }

  if (best.score >= supportedFloor && hasHardSupport) {
    return {
      automatedAssessment: "evidence_retrieved",
      confidence: best.score >= strongFloor ? "high_retrieval" : "moderate_retrieval",
      rationale: "Retrieved sheet text/region content matches cited evidence or distinctive facts. Does not prove the finding conclusion is correct (see C-002-style separation of evidence vs technical correctness).",
      professionallyVerified: false,
      verificationStatus: "not_professionally_verified",
      retrievalSuccess: true,
      bestScore: best.score,
      primarySignals: best.signals,
      legacyAlias: "supported",
    };
  }

  if (best.score >= 0.22) {
    return {
      automatedAssessment: "insufficient_evidence",
      confidence: "low",
      rationale: "Weak or partial candidates only. Not enough for automated support.",
      professionallyVerified: false,
      verificationStatus: "not_professionally_verified",
      retrievalSuccess: true,
      bestScore: best.score,
      primarySignals: best.signals,
    };
  }

  return {
    automatedAssessment: "unresolved",
    confidence: "low",
    rationale: "Candidates were too weak to classify.",
    professionallyVerified: false,
    verificationStatus: "not_professionally_verified",
    retrievalSuccess: false,
    bestScore: best.score,
  };
}

export function findDuplicateCandidates(findings) {
  const rows = findings || [];
  const duplicates = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      if ((left.relativePath || left.original?.relativePath) !== (right.relativePath || right.original?.relativePath)) {
        continue;
      }
      const leftText = normalizeText(`${left.original?.title || ""} ${left.original?.observation || ""} ${left.original?.drawingEvidence || ""}`);
      const rightText = normalizeText(`${right.original?.title || ""} ${right.original?.observation || ""} ${right.original?.drawingEvidence || ""}`);
      const leftTokens = tokenizeEvidence(leftText);
      const rightTokens = tokenizeEvidence(rightText);
      if (leftTokens.length < 4 || rightTokens.length < 4) continue;
      const shared = leftTokens.filter((token) => rightTokens.includes(token));
      const ratio = shared.length / Math.max(leftTokens.length, rightTokens.length);
      if (ratio >= 0.72 || leftText === rightText) {
        duplicates.push({
          leftId: left.clientReportId,
          rightId: right.clientReportId,
          relativePath: left.relativePath,
          sharedRatio: Math.round(ratio * 1000) / 1000,
          independentlyVerified: false,
          note: "Possible duplicate finding pair on the same sheet. Automated heuristic only.",
        });
      }
    }
  }
  return duplicates;
}

export function flagQualityIssues(record) {
  const issues = [];
  const original = record.original || {};
  const assessment = record.assessment?.automatedAssessment;
  if (!original.drawingEvidence || String(original.drawingEvidence).trim().length < 8) {
    issues.push({
      type: "thin_drawing_evidence",
      note: "Finding provides little citable drawing evidence text.",
    });
  }
  if (assessment === "unresolved" && record.severity === "critical") {
    issues.push({
      type: "critical_unresolved",
      note: "Critical finding lacks automated retrieval support and needs reviewer attention first.",
    });
  }
  if (assessment === "contradicted_candidate") {
    issues.push({
      type: "possible_false_positive",
      note: "Automated contradiction candidate — finding may overstate absence or mismatch sheet content.",
    });
  }
  if (assessment === "insufficient_evidence" || assessment === "unresolved") {
    issues.push({
      type: "unsupported_citation_risk",
      note: "Cited evidence was not strongly retrieved from the mapped sheet text/OCR/regions.",
    });
  }
  const rec = String(original.recommendation || "");
  const sheetRefs = [...rec.matchAll(/\b([A-Z]{1,4}-?\d{1,3}(?:\.\d{1,3})?(?:-\d{1,2})?)\b/g)].map((m) => m[1]);
  if (sheetRefs.length && record.relativePath) {
    const mapped = String(record.sheetNumber || "").replace(/\s+/g, "");
    const pointsElsewhere = sheetRefs.some((ref) => normalizeText(ref) !== normalizeText(mapped)
      && !normalizeText(record.relativePath).includes(normalizeText(ref).replace(/-/g, "")));
    if (pointsElsewhere && (assessment === "insufficient_evidence" || assessment === "unresolved")) {
      issues.push({
        type: "cross_sheet_recommendation",
        note: "Recommendation references another sheet while local evidence retrieval is weak.",
        sheetRefs,
      });
    }
  }
  return issues.map((issue) => ({
    ...issue,
    independentlyVerified: false,
    professionallyVerified: false,
  }));
}

export function summarizeAssessments(records) {
  const counts = {
    evidence_retrieved: 0,
    contradicted_candidate: 0,
    insufficient_evidence: 0,
    unresolved: 0,
  };
  for (const row of records || []) {
    const key = normalizeAutomatedAssessment(row.assessment?.automatedAssessment);
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
  }
  const bySeverity = {};
  for (const row of records || []) {
    const sev = String(row.severity || "unknown").toLowerCase();
    if (!bySeverity[sev]) {
      bySeverity[sev] = {
        total: 0,
        evidence_retrieved: 0,
        contradicted_candidate: 0,
        insufficient_evidence: 0,
        unresolved: 0,
        retrievalSuccess: 0,
      };
    }
    bySeverity[sev].total += 1;
    const key = normalizeAutomatedAssessment(row.assessment?.automatedAssessment);
    if (Object.prototype.hasOwnProperty.call(bySeverity[sev], key)) bySeverity[sev][key] += 1;
    if (row.assessment?.retrievalSuccess) bySeverity[sev].retrievalSuccess += 1;
  }
  return {
    total: (records || []).length,
    automatedAssessmentCounts: counts,
    retrievalSuccessCount: (records || []).filter((row) => row.assessment?.retrievalSuccess).length,
    bySeverity,
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
    professionallyVerifiedCount: 0,
    note: "evidence_retrieved means automated text/region match only — not verified grounding or technical correctness.",
  };
}
