"use strict";

const crypto = require("crypto");
const { semanticDedupKey } = require("./uci-load-candidate.service.js");

/**
 * @param {Record<string, unknown>} finding
 */
function findingEvidenceFingerprint(finding) {
  const region = finding.bounding_region;
  const regionKey =
    region && typeof region === "object"
      ? `${region.x ?? ""}|${region.y ?? ""}|${region.width ?? ""}|${region.height ?? ""}`
      : "";
  return [
    finding.page_number ?? "",
    finding.field_key ?? "",
    finding.normalized_value ?? finding.raw_value ?? "",
    finding.unit ?? "",
    finding.entity_type ?? "",
    finding.entity_name ?? "",
    String(finding.evidence_text ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200),
    regionKey,
  ].join("|");
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function findingsSemanticallyEqual(a, b) {
  const keyA = [
    semanticDedupKey({
      field_key: a.field_key,
      source_content_hash: a.source_content_hash,
      source_document_name: a.source_document_name,
      page_number: a.page_number,
      normalized_value: a.normalized_value,
      unit: a.unit,
      evidence_text: a.evidence_text,
      entity_type: a.entity_type,
      entity_name: a.entity_name,
    }),
    String(a.entity_type ?? ""),
    String(a.entity_name ?? ""),
  ].join("::");
  const keyB = [
    semanticDedupKey({
      field_key: b.field_key,
      source_content_hash: b.source_content_hash,
      source_document_name: b.source_document_name,
      page_number: b.page_number,
      normalized_value: b.normalized_value,
      unit: b.unit,
      evidence_text: b.evidence_text,
      entity_type: b.entity_type,
      entity_name: b.entity_name,
    }),
    String(b.entity_type ?? ""),
    String(b.entity_name ?? ""),
  ].join("::");
  return keyA === keyB;
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function sameFindingFieldContext(a, b) {
  return (
    String(a.field_key ?? "") === String(b.field_key ?? "") &&
    String(a.entity_type ?? "") === String(b.entity_type ?? "") &&
    String(a.entity_name ?? "") === String(b.entity_name ?? "") &&
    String(a.page_number ?? "") === String(b.page_number ?? "") &&
    String(a.source_content_hash ?? "") === String(b.source_content_hash ?? "")
  );
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @param {Record<string, unknown>} incoming
 */
function mergeFindingProvenance(findings, incoming) {
  const semanticMatch = findings.find((f) => findingsSemanticallyEqual(f, incoming));
  const contextMatch = findings.find(
    (f) => sameFindingFieldContext(f, incoming) && !findingsSemanticallyEqual(f, incoming),
  );
  const match = semanticMatch ?? null;

  if (!match && !contextMatch) {
    findings.push(incoming);
    return findings;
  }

  if (contextMatch && !semanticMatch) {
    contextMatch.conflict = true;
    contextMatch.conflict_methods = [
      ...new Set([contextMatch.extraction_method, incoming.extraction_method].filter(Boolean).map(String)),
    ];
    contextMatch.requires_human_review = true;
    findings.push({
      ...incoming,
      finding_id: incoming.finding_id ?? `finding:${crypto.randomBytes(8).toString("hex")}`,
      conflict: true,
      conflict_with_finding_id: contextMatch.finding_id,
      requires_human_review: true,
    });
    return findings;
  }

  if (!match) {
    findings.push(incoming);
    return findings;
  }

  const methods = new Set(
    [match.extraction_method, incoming.extraction_method, ...(match.contributing_methods ?? [])]
      .filter(Boolean)
      .map(String),
  );
  match.contributing_methods = [...methods];
  match.extraction_method = [...methods].sort().join("+");

  const matchConf = match.confidence != null ? Number(match.confidence) : null;
  const incomingConf = incoming.confidence != null ? Number(incoming.confidence) : null;
  if (incomingConf != null && (matchConf == null || incomingConf > matchConf)) {
    match.confidence = incomingConf;
    if (incoming.evidence_text) match.evidence_text = incoming.evidence_text;
    if (incoming.bounding_region) match.bounding_region = incoming.bounding_region;
  }

  if (
    match.normalized_value != null &&
    incoming.normalized_value != null &&
    String(match.normalized_value) !== String(incoming.normalized_value)
  ) {
    match.conflict = true;
    match.conflict_methods = [...methods];
    match.requires_human_review = true;
    findings.push({
      ...incoming,
      finding_id: incoming.finding_id ?? `finding:${crypto.randomBytes(8).toString("hex")}`,
      conflict: true,
      conflict_with_finding_id: match.finding_id,
      requires_human_review: true,
    });
  }

  return findings;
}

/**
 * @param {Array<Record<string, unknown>>} existing
 * @param {Array<Record<string, unknown>>} incoming
 */
function mergeDocumentFindingsHybrid(existing, incoming) {
  let out = [...existing];
  for (const finding of incoming) {
    out = mergeFindingProvenance(out, finding);
  }
  return out;
}

/**
 * @param {number | null | undefined} confidence
 * @param {number} threshold
 */
function isOcrApprovalBlocked(confidence, threshold) {
  if (confidence == null || Number.isNaN(Number(confidence))) return true;
  return Number(confidence) < threshold;
}

module.exports = {
  findingEvidenceFingerprint,
  findingsSemanticallyEqual,
  mergeFindingProvenance,
  mergeDocumentFindingsHybrid,
  isOcrApprovalBlocked,
};
