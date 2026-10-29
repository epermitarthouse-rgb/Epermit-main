/**
 * Prioritized adjudication queue for Phase 2A.6.
 * Critical → contradicted → insufficient → unresolved → evidence_retrieved → remainder.
 */
import { normalizeAutomatedAssessment } from "./semanticAssess.mjs";
import { QUEUE_BANDS } from "./adjudicateSchema.mjs";

function bandForRecord(record) {
  const severity = String(record.severity || "").toLowerCase();
  if (severity === "critical") return "critical";
  const assessment = normalizeAutomatedAssessment(
    record.assessment?.automatedAssessment
    || record.automatedRetrieval?.assessment
    || record.automatedAssessment,
  );
  if (assessment === "contradicted_candidate") return "contradicted_candidate";
  if (assessment === "insufficient_evidence") return "insufficient_evidence";
  if (assessment === "unresolved") return "unresolved";
  if (assessment === "evidence_retrieved") return "evidence_retrieved";
  return "remainder";
}

const BAND_RANK = Object.fromEntries(QUEUE_BANDS.map((band, index) => [band, index]));

export function sortAdjudicationQueue(records) {
  return [...(records || [])].sort((left, right) => {
    const bandDelta = (BAND_RANK[bandForRecord(left)] ?? 99) - (BAND_RANK[bandForRecord(right)] ?? 99);
    if (bandDelta !== 0) return bandDelta;
    const sevRank = { critical: 0, warning: 1, advisory: 2 };
    const sevDelta = (sevRank[String(left.severity || "").toLowerCase()] ?? 9)
      - (sevRank[String(right.severity || "").toLowerCase()] ?? 9);
    if (sevDelta !== 0) return sevDelta;
    return String(left.clientReportId || left.benchmarkId || "")
      .localeCompare(String(right.clientReportId || right.benchmarkId || ""));
  }).map((record, index) => ({
    ...record,
    queueBand: bandForRecord(record),
    queueOrder: index + 1,
  }));
}

export function summarizeQueueBands(records) {
  const counts = Object.fromEntries(QUEUE_BANDS.map((band) => [band, 0]));
  for (const record of records || []) {
    const band = record.queueBand || bandForRecord(record);
    if (Object.prototype.hasOwnProperty.call(counts, band)) counts[band] += 1;
  }
  return counts;
}
