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

  const pushPanelFacts = ({ label, amps, voltage, phase, wires, evidence }) => {
    const isMdp = /^MDP$/i.test(label);
    const entityType = isMdp ? "main_distribution_panel" : "panel";
    push({
      field_key: isMdp ? "main_distribution_panel_rating" : "panel_rating",
      field_label: isMdp ? "MDP rating" : `Panel ${label} rating`,
      raw_value: String(amps),
      normalized_value: Number(amps),
      unit: "A",
      entity_type: entityType,
      entity_name: label,
      fact_type: "panel_fact",
      category: isMdp ? "main_distribution_equipment" : "panel_rating",
      evidence_text: evidence,
      confidence: 0.9,
    });
    if (voltage) {
      push({
        field_key: "service_voltage",
        field_label: "Panel voltage",
        raw_value: voltage,
        normalized_value: voltage,
        unit: "V",
        entity_type: entityType,
        entity_name: label,
        fact_type: "panel_fact",
        category: "service_voltage",
        evidence_text: evidence,
        confidence: 0.88,
      });
    }
    if (phase) {
      push({
        field_key: "phase",
        field_label: "Panel phase",
        raw_value: `${phase}PH`,
        normalized_value: String(phase),
        unit: "phase",
        entity_type: entityType,
        entity_name: label,
        fact_type: "panel_fact",
        category: "phase",
        evidence_text: evidence,
        confidence: 0.86,
      });
    }
    if (wires) {
      push({
        field_key: "wire_configuration",
        field_label: "Panel wire configuration",
        raw_value: `${wires}W`,
        normalized_value: String(wires),
        unit: "wire",
        entity_type: entityType,
        entity_name: label,
        fact_type: "panel_fact",
        category: "wire_configuration",
        evidence_text: evidence,
        confidence: 0.86,
      });
    }
  };

  const pushPanelLoad = ({ label, kind, value, evidence }) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return;
    push({
      field_key: kind === "connected" ? "panel_connected_load_kva" : "panel_demand_load_kva",
      field_label: `Panel ${label} ${kind} load`,
      raw_value: String(value),
      normalized_value: normalized,
      unit: "kVA",
      entity_type: "electrical_panel",
      entity_name: label,
      fact_type: "electric_load",
      category: "panel_load",
      aggregation_role: "summary_total",
      utility_type: "electric",
      energy_domain: "electric",
      capacity_type: kind === "connected" ? "connected_load" : "demand_load",
      evidence_text: evidence,
      confidence: 0.9,
      review_blocked_reason: "Panel-level total — not a whole-project service total",
    });
  };

  /*
   * Revit text extraction commonly flattens two side-by-side schedules as:
   *   208/120 Wye, 3PH, 4W 208/120 Wye, 3PH, 4W
   *   PANELBOARD PANELBOARD
   *   A B
   *   200A MLO 200A MLO
   * Keep each pair as a bounded block so totals cannot drift to MDP or another panel.
   */
  const pairedHeaderRegex =
    /(\d{2,3}\/\d{2,3})\s*(?:Wye,?\s*)?(\d+)\s*PH,?\s*(\d+)\s*W\s+\1\s*(?:Wye,?\s*)?\2\s*PH,?\s*\3\s*W\s*\n\s*PANELBOARD\s+PANELBOARD\s*\n\s*(MDP|[A-Z])\s+(MDP|[A-Z])\s*\n\s*(\d{2,4})\s*A\s+MLO\s+(\d{2,4})\s*A\s+MLO/gi;
  const pairedBlocks = [];
  let pairMatch;
  while ((pairMatch = pairedHeaderRegex.exec(pageText)) !== null) {
    pairedBlocks.push({
      index: pairMatch.index,
      end: pairedHeaderRegex.lastIndex,
      voltage: pairMatch[1],
      phase: pairMatch[2],
      wires: pairMatch[3],
      labels: [pairMatch[4], pairMatch[5]],
      amps: [Number(pairMatch[6]), Number(pairMatch[7])],
      header: pairMatch[0].replace(/\s+/g, " ").trim(),
    });
  }

  for (let i = 0; i < pairedBlocks.length; i += 1) {
    const block = pairedBlocks[i];
    const end = pairedBlocks[i + 1]?.index ?? pageText.length;
    const segment = pageText.slice(block.index, end);
    for (let col = 0; col < block.labels.length; col += 1) {
      pushPanelFacts({
        label: block.labels[col],
        amps: block.amps[col],
        voltage: block.voltage,
        phase: block.phase,
        wires: block.wires,
        evidence: block.header,
      });
    }

    const connectedLine = segment.match(/TOTAL\s+CONN(?:ECTED)?\.?\s+LOAD:\s*([0-9.]+)\s*kVA[\s\S]{0,120}?TOTAL\s+CONN(?:ECTED)?\.?\s+LOAD:\s*([0-9.]+)\s*kVA/i);
    const demandLine = segment.match(/TOTAL\s+DEMAND\s+LOAD:\s*([0-9.]+)\s*kVA[\s\S]{0,120}?TOTAL\s+DEMAND\s+LOAD:\s*([0-9.]+)\s*kVA/i);
    for (let col = 0; col < block.labels.length; col += 1) {
      if (connectedLine?.[col + 1]) {
        pushPanelLoad({
          label: block.labels[col],
          kind: "connected",
          value: connectedLine[col + 1],
          evidence: `Panel ${block.labels[col]} TOTAL CONN. LOAD: ${connectedLine[col + 1]} kVA`,
        });
      }
      if (demandLine?.[col + 1]) {
        pushPanelLoad({
          label: block.labels[col],
          kind: "demand",
          value: demandLine[col + 1],
          evidence: `Panel ${block.labels[col]} TOTAL DEMAND LOAD: ${demandLine[col + 1]} kVA`,
        });
      }
    }
  }

  const mloRegex = /(\d{2,4})\s*A\s+MLO\s+(MDP|[A-Z])\s+PANELBOARD/gi;
  let match;
  while ((match = mloRegex.exec(pageText)) !== null) {
    const amps = Number(match[1]);
    const label = String(match[2]).trim();
    const isMdp = /^MDP$/i.test(label);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length);
    pushPanelFacts({ label, amps, evidence });
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
