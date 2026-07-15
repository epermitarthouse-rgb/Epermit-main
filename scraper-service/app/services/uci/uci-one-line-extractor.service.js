"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");

const SERVICE_CONTEXT_PATTERN =
  /\b(SERVICE|MDP|MAIN\s+DISTRIBUTION|DISCONNECT|SWITCHBOARD|SWITCHGEAR|METER|CT\s+CABINET|TRANSFORMER|UTILITY|INCOMING|FEEDER|PANEL(?:BOARD)?)\b/i;

/**
 * @param {string} evidence
 */
function hasServiceContext(evidence) {
  return SERVICE_CONTEXT_PATTERN.test(evidence);
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeOneLinePhase(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  if (/^3/.test(t) || /THREE/.test(t)) return "3";
  if (/^1/.test(t) || /SINGLE/.test(t)) return "1";
  return null;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function detectOneLineDiagramText(text) {
  const hay = String(text ?? "");
  return (
    /\bONE[\s-]*LINE\b/i.test(hay) ||
    /\bSINGLE[\s-]*LINE\b/i.test(hay) ||
    (/\bMDP\b/i.test(hay) && /\b\d+\s*A\b/i.test(hay) && /\d+\/\d+\s*V/i.test(hay))
  );
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractOneLineFindingsFromText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  if (!pageText.trim()) return out;

  const push = (record) => {
    out.push(
      buildCandidateRecord({
        ...record,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        extraction_method: source.extraction_method ?? "one_line_pdf_text",
        external_application_id: source.external_application_id,
      }),
    );
  };

  const panelBlockRegex =
    /PANEL(?:BOARD)?\s*["']?([^"'\s,]+)["']?\s*(\d+(?:\.\d+)?)\s*A[,\s]+(\d+\/\d+)\s*V[,\s]*(\d+)[\s-]*(?:PH|Ø|PHASE)/gi;
  let match;
  while ((match = panelBlockRegex.exec(pageText)) !== null) {
    const entityName = String(match[1]).trim();
    const amps = match[2];
    const voltage = match[3];
    const phaseRaw = match[4];
    const start = Math.max(0, match.index - 60);
    const end = Math.min(pageText.length, match.index + match[0].length + 60);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();

    push({
      field_key: "service_amperage",
      field_label: "Panel rating",
      raw_value: String(amps),
      normalized_value: Number(amps),
      unit: "A",
      entity_type: "panel",
      entity_name: entityName,
      fact_type: "panel_fact",
      evidence_text: evidence,
      confidence: 0.85,
    });
    push({
      field_key: "service_voltage",
      field_label: "Service voltage",
      raw_value: voltage,
      normalized_value: voltage,
      unit: "V",
      entity_type: "panel",
      entity_name: entityName,
      fact_type: "panel_fact",
      evidence_text: evidence,
      confidence: 0.9,
    });
    const phase = normalizeOneLinePhase(phaseRaw);
    if (phase) {
      push({
        field_key: "phase",
        field_label: "Phase",
        raw_value: `${phaseRaw}-PH`,
        normalized_value: phase,
        unit: "phase",
        entity_type: "panel",
        entity_name: entityName,
        fact_type: "panel_fact",
        evidence_text: evidence,
        confidence: 0.85,
      });
    }
  }

  const slashVoltageRegex = /(\d{2,3}\/\d{2,3})\s*V/gi;
  while ((match = slashVoltageRegex.exec(pageText)) !== null) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(pageText.length, match.index + match[0].length + 80);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!hasServiceContext(evidence)) continue;
    push({
      field_key: "service_voltage",
      field_label: "Service voltage",
      raw_value: match[1],
      normalized_value: match[1],
      unit: "V",
      entity_type: "project_service",
      entity_name: null,
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.88,
    });
  }

  const disconnectRegex =
    /(\d+(?:\.\d+)?)\s*A[,\s]+(\d+)[\s-]*POLE[,\s]+(?:NEMA[^,]*)?(?:[^,]*DISCONNECT|FUSED|SWITCH)/gi;
  while ((match = disconnectRegex.exec(pageText)) !== null) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(pageText.length, match.index + match[0].length + 80);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    push({
      field_key: "service_amperage",
      field_label: "Service disconnect rating",
      raw_value: String(match[1]),
      normalized_value: Number(match[1]),
      unit: "A",
      entity_type: "service_disconnect",
      entity_name: "Service disconnect",
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.82,
    });
  }

  const serviceAmpRegex = /(?:^|[^0-9])(\d{2,4})\s*A(?:IC)?\b/gi;
  while ((match = serviceAmpRegex.exec(pageText)) !== null) {
    const amps = match[1];
    const start = Math.max(0, match.index - 90);
    const end = Math.min(pageText.length, match.index + match[0].length + 90);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!hasServiceContext(evidence)) continue;
    if (/\bAIC\b/i.test(evidence) && !/\b(?:MLO|MDP|PANEL|DISCONNECT|CT|METER)\b/i.test(evidence)) {
      continue;
    }
    if (/\bMLO\b/i.test(evidence) && /PANEL/i.test(evidence)) {
      const panelName = evidence.match(/PANEL\s*["']?([^"'\s,]+)["']?/i);
      push({
        field_key: "service_amperage",
        field_label: "Panel rating",
        raw_value: String(amps),
        normalized_value: Number(amps),
        unit: "A",
        entity_type: "panel",
        entity_name: panelName ? panelName[1] : null,
        fact_type: "panel_fact",
        evidence_text: evidence,
        confidence: 0.75,
      });
      continue;
    }
    if (/\bCT\s+CABINET\b/i.test(evidence) || /\bMETER\b/i.test(evidence)) {
      push({
        field_key: "service_amperage",
        field_label: "Service entrance rating",
        raw_value: String(amps),
        normalized_value: Number(amps),
        unit: "A",
        entity_type: "meter_service",
        entity_name: "CT cabinet / meter",
        fact_type: "project_service_fact",
        evidence_text: evidence,
        confidence: 0.8,
      });
    }
  }

  const phaseRegex = /(\d+)[\s-]*(?:PH|Ø|PHASE)\b/gi;
  while ((match = phaseRegex.exec(pageText)) !== null) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(pageText.length, match.index + match[0].length + 90);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!hasServiceContext(evidence)) continue;
    const phase = normalizeOneLinePhase(match[1]);
    if (!phase) continue;
    push({
      field_key: "phase",
      field_label: "Phase",
      raw_value: match[0].trim(),
      normalized_value: phase,
      unit: "phase",
      entity_type: "project_service",
      entity_name: null,
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.8,
    });
  }

  const wireRegex = /(\d+)[\s-]*(?:W|WIRE)\b/gi;
  while ((match = wireRegex.exec(pageText)) !== null) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(pageText.length, match.index + match[0].length + 90);
    const evidence = pageText.slice(start, end).replace(/\s+/g, " ").trim();
    if (!/\d+\/\d+\s*V/i.test(evidence) && !hasServiceContext(evidence)) continue;
    push({
      field_key: "wire_configuration",
      field_label: "Wire configuration",
      raw_value: `${match[1]}-wire`,
      normalized_value: match[1],
      unit: "wire",
      entity_type: "project_service",
      entity_name: null,
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.78,
    });
  }

  if (/\bCT\s+CABINET\b/i.test(pageText) && /\bMETER\b/i.test(pageText)) {
    const idx = pageText.search(/\bCT\s+CABINET\b/i);
    const evidence = pageText.slice(Math.max(0, idx - 40), idx + 120).replace(/\s+/g, " ").trim();
    push({
      field_key: "meter_count",
      field_label: "Meter / CT cabinet",
      raw_value: "present",
      normalized_value: 1,
      unit: "count",
      entity_type: "meter_service",
      entity_name: "CT cabinet and meter",
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.7,
    });
  }

  if (/\bTRANSFORMER\b/i.test(pageText)) {
    const idx = pageText.search(/\bTRANSFORMER\b/i);
    const evidence = pageText.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, " ").trim();
    push({
      field_key: "service_configuration",
      field_label: "Transformer",
      raw_value: "pad-mounted transformer",
      normalized_value: null,
      unit: null,
      entity_type: "transformer",
      entity_name: "Pad-mounted transformer",
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.65,
      review_blocked_reason: "Transformer rating not parsed from native text",
    });
  }

  if (/\bSWITCHGEAR\b/i.test(pageText)) {
    const idx = pageText.search(/\bSWITCHGEAR\b/i);
    const evidence = pageText.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, " ").trim();
    push({
      field_key: "service_configuration",
      field_label: "Switchgear",
      raw_value: "switchgear",
      normalized_value: null,
      unit: null,
      entity_type: "switchgear",
      entity_name: "Switchgear",
      fact_type: "project_service_fact",
      evidence_text: evidence,
      confidence: 0.6,
      review_blocked_reason: "Switchgear details require layout review",
    });
  }

  return dedupeOneLineCandidates(out);
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function dedupeOneLineCandidates(candidates) {
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const c of candidates) {
    const key = [
      c.field_key,
      c.entity_name,
      c.page_number,
      c.raw_value,
      c.entity_type,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

module.exports = {
  detectOneLineDiagramText,
  extractOneLineFindingsFromText,
  dedupeOneLineCandidates,
  normalizeOneLinePhase,
};
