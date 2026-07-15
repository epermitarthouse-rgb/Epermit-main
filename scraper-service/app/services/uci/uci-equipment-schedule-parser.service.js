"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");
const { buildConciseEvidence, evidenceFingerprint } = require("./uci-one-line-extractor.service.js");

const EQUIPMENT_HEADER_PATTERN =
  /\bTAG\b.*\bDESCRIPTION\b.*\b(?:VOLTS?|VOLTAGE)\b.*\bPHASE\b.*\bAMPS?\b/i;

const EQUIPMENT_ROW_PATTERN =
  /\b(\d{3,4}[A-Z]?)\s+([A-Z][A-Z0-9\s,./\-'"()]+?)\s+(\d{2,3})\s+V\s+(\d)\s+(\d+(?:\.\d+)?)\s+A\s+\d+\s+Hz(?:\s+(\d+(?:\.\d+)?)\s+W)?/gi;

/**
 * @param {string} text
 * @returns {boolean}
 */
function detectEquipmentScheduleText(text) {
  const hay = String(text ?? "");
  return (
    /\bEQUIPMENT\s+UTILITY\s+SCHEDULE\b/i.test(hay) ||
    (EQUIPMENT_HEADER_PATTERN.test(hay) && /\b\d{3}\s+[A-Z]/i.test(hay))
  );
}

/**
 * @param {string} description
 */
function shortenDescription(description) {
  return String(description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * @param {string} text
 * @returns {{ parseable: boolean, reason: string | null }}
 */
function assessEquipmentScheduleLayout(text) {
  const hay = String(text ?? "");
  if (!hay.trim()) {
    return { parseable: false, reason: "no_native_text" };
  }
  if (!EQUIPMENT_HEADER_PATTERN.test(hay)) {
    return { parseable: false, reason: "equipment_schedule_header_not_found" };
  }
  const rowProbe = EQUIPMENT_ROW_PATTERN.exec(hay);
  EQUIPMENT_ROW_PATTERN.lastIndex = 0;
  if (!rowProbe) {
    return { parseable: false, reason: "equipment_rows_not_structurally_recoverable" };
  }
  return { parseable: true, reason: null };
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {{ findings: Array<Record<string, unknown>>, layout: { parseable: boolean, reason: string | null } }}
 */
function extractEquipmentScheduleFindingsFromText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  const layout = assessEquipmentScheduleLayout(pageText);
  if (!layout.parseable) {
    return { findings: out, layout };
  }

  const push = (record) => {
    out.push(
      buildCandidateRecord({
        ...record,
        evidence_fingerprint: evidenceFingerprint(String(record.evidence_text ?? "")),
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        extraction_method: source.extraction_method ?? "equipment_schedule_pdf_text",
        external_application_id: source.external_application_id,
        is_project_total: false,
        aggregation_role: "detail_component",
        review_blocked_reason:
          record.review_blocked_reason ?? "Equipment schedule row — supporting detail",
      }),
    );
  };

  let match;
  while ((match = EQUIPMENT_ROW_PATTERN.exec(pageText)) !== null) {
    const tag = match[1];
    const description = shortenDescription(match[2]);
    const volts = Number(match[3]);
    const phase = match[4];
    const amps = Number(match[5]);
    const watts = match[6] != null ? Number(match[6]) : null;
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length);

    push({
      field_key: "equipment_schedule_tag",
      field_label: "Equipment tag",
      raw_value: tag,
      normalized_value: tag,
      unit: null,
      entity_type: "equipment",
      entity_name: tag,
      fact_type: "equipment_evidence",
      category: "equipment_schedule",
      evidence_text: evidence,
      confidence: 0.85,
      equipment_description: description,
    });

    push({
      field_key: "equipment_schedule_voltage",
      field_label: "Equipment voltage",
      raw_value: String(volts),
      normalized_value: volts,
      unit: "V",
      entity_type: "equipment",
      entity_name: tag,
      fact_type: "equipment_evidence",
      category: "equipment_schedule",
      evidence_text: evidence,
      confidence: 0.82,
      equipment_description: description,
    });

    push({
      field_key: "equipment_schedule_phase",
      field_label: "Equipment phase",
      raw_value: phase,
      normalized_value: phase,
      unit: "phase",
      entity_type: "equipment",
      entity_name: tag,
      fact_type: "equipment_evidence",
      category: "equipment_schedule",
      evidence_text: evidence,
      confidence: 0.8,
      equipment_description: description,
    });

    push({
      field_key: "equipment_schedule_amperage",
      field_label: "Equipment amperage",
      raw_value: String(amps),
      normalized_value: amps,
      unit: "A",
      entity_type: "equipment",
      entity_name: tag,
      fact_type: "equipment_evidence",
      category: "equipment_schedule",
      evidence_text: evidence,
      confidence: 0.82,
      equipment_description: description,
    });

    if (watts != null && Number.isFinite(watts)) {
      push({
        field_key: "equipment_schedule_watts",
        field_label: "Equipment watts",
        raw_value: String(watts),
        normalized_value: watts,
        unit: "W",
        entity_type: "equipment",
        entity_name: tag,
        fact_type: "electric_load",
        category: "equipment_schedule",
        evidence_text: evidence,
        confidence: 0.8,
        equipment_description: description,
        utility_type: "electric",
        energy_domain: "electric",
        capacity_type: "connected_load",
      });
    }
  }

  return { findings: dedupeEquipmentScheduleCandidates(out), layout };
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function dedupeEquipmentScheduleCandidates(candidates) {
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const c of candidates) {
    const key = [c.field_key, c.entity_name, c.page_number, c.normalized_value, c.unit].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

module.exports = {
  detectEquipmentScheduleText,
  assessEquipmentScheduleLayout,
  extractEquipmentScheduleFindingsFromText,
  dedupeEquipmentScheduleCandidates,
};
