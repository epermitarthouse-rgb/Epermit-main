"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");
const { buildConciseEvidence, evidenceFingerprint } = require("./uci-one-line-extractor.service.js");

/**
 * @param {string} text
 * @returns {boolean}
 */
function detectPanelScheduleText(text) {
  const hay = String(text ?? "");
  return (
    /\bPANEL\s+SCHEDULE\b/i.test(hay) ||
    (/\bPANELBOARD\b/i.test(hay) && /\bMLO\b/i.test(hay) && /\b\d{2,4}\s*A\b/i.test(hay))
  );
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractPanelScheduleFindingsFromText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  if (!pageText.trim()) return out;

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
        extraction_method: source.extraction_method ?? "panel_schedule_pdf_text",
        external_application_id: source.external_application_id,
        is_project_total: false,
        review_blocked_reason:
          record.review_blocked_reason ?? "Panel rating — not package service evidence",
      }),
    );
  };

  const mloRegex = /(\d{2,4})\s*A\s+MLO\s+(MDP|[A-Z])\s+PANELBOARD/gi;
  let match;
  while ((match = mloRegex.exec(pageText)) !== null) {
    const amps = Number(match[1]);
    const label = String(match[2]).trim();
    const isMdp = /^MDP$/i.test(label);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length);
    push({
      field_key: isMdp ? "main_distribution_panel_rating" : "panel_rating",
      field_label: isMdp ? "MDP rating" : `Panel ${label} rating`,
      raw_value: String(amps),
      normalized_value: amps,
      unit: "A",
      entity_type: isMdp ? "main_distribution_panel" : "panel",
      entity_name: label,
      fact_type: "panel_fact",
      category: isMdp ? "main_distribution_equipment" : "panel_rating",
      evidence_text: evidence,
      confidence: 0.82,
    });
  }

  const voltageRegex = /(\d{2,3}\/\d{2,3})\s*V[,\s]*(?:Wye,?\s*)?(\d+)\s*PH/gi;
  while ((match = voltageRegex.exec(pageText)) !== null) {
    const lineStart = Math.max(0, pageText.lastIndexOf("PANELBOARD", match.index));
    const context = pageText.slice(lineStart, match.index + match[0].length + 40);
    const panelMatch = context.match(/(\d{2,4})\s*A\s+MLO\s+(MDP|[A-Z])\s+PANELBOARD/i);
    if (!panelMatch) continue;
    const label = panelMatch[2];
    const isMdp = /^MDP$/i.test(label);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length);
    push({
      field_key: "service_voltage",
      field_label: "Panel voltage",
      raw_value: match[1],
      normalized_value: match[1],
      unit: "V",
      entity_type: isMdp ? "main_distribution_panel" : "panel",
      entity_name: label,
      fact_type: "panel_fact",
      category: "service_voltage",
      evidence_text: evidence,
      confidence: 0.8,
    });
    push({
      field_key: "phase",
      field_label: "Phase",
      raw_value: `${match[2]}PH`,
      normalized_value: match[2],
      unit: "phase",
      entity_type: isMdp ? "main_distribution_panel" : "panel",
      entity_name: label,
      fact_type: "panel_fact",
      category: "phase",
      evidence_text: evidence,
      confidence: 0.78,
    });
  }

  return dedupePanelScheduleCandidates(out);
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function dedupePanelScheduleCandidates(candidates) {
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const c of candidates) {
    const key = [
      c.field_key,
      c.entity_type,
      c.entity_name,
      c.page_number,
      c.normalized_value,
      c.evidence_fingerprint,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

module.exports = {
  detectPanelScheduleText,
  extractPanelScheduleFindingsFromText,
  dedupePanelScheduleCandidates,
};
