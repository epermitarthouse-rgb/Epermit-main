"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");

const AMP_CONTEXT_PATTERN =
  /\b(PANEL(?:BOARD)?|SERVICE|DISCONNECT|MAIN|MDP|MLO|SWITCHBOARD|SWITCHGEAR|BREAKER|FUSED|INCOMING|FEEDER)\b/i;

const SERVICE_ENTRANCE_PATTERN =
  /\b(SERVICE\s+ENTRANCE|INCOMING\s+SERVICE|UTILITY\s+SERVICE|REQUESTED\s+SERVICE|MAIN\s+SERVICE\s+SIZE|SERVICE\s+SIZE)\b/i;

const CONDUCTOR_PATTERN = /#[0-9/]+/i;
const AIC_PATTERN = /\b\d{1,3}(?:,\d{3})+\s*AIC\b|\b\d{4,}\s*AIC\b/i;
const BRANCH_CIRCUIT_PATTERN = /\b(EGAUGE|METER\s*\(|SURGE|RECEPTACLE|LIGHTING|HVAC|SPARE)\b/i;

/**
 * @param {string} text
 * @param {number} index
 * @param {number} [radius]
 */
function getLocalContext(text, index, radius = 110) {
  const hay = String(text ?? "");
  const start = Math.max(0, index - radius);
  const end = Math.min(hay.length, index + radius);
  return hay.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text
 * @param {number} index
 */
function getLocalLine(text, index) {
  const hay = String(text ?? "");
  const before = hay.lastIndexOf("\n", index);
  const after = hay.indexOf("\n", index);
  if (before === -1 && after === -1) {
    return getLocalContext(hay, index, 110);
  }
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? hay.length : after;
  return hay.slice(start, end).replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text
 * @param {number} matchIndex
 * @param {number} matchLength
 * @param {number} [maxLen]
 */
function buildConciseEvidence(text, matchIndex, matchLength, maxLen = 140) {
  const line = getLocalLine(text, matchIndex);
  if (!line) return "";

  const relStart = matchIndex - (text.lastIndexOf("\n", matchIndex) + 1);
  const relEnd = relStart + matchLength;
  const pad = 40;
  let start = Math.max(0, relStart - pad);
  let end = Math.min(line.length, relEnd + pad);

  if (start > 0) start = line.indexOf(" ", start) + 1 || start;
  if (end < line.length) {
    const nextSpace = line.lastIndexOf(" ", end);
    if (nextSpace > relEnd) end = nextSpace;
  }

  let excerpt = line.slice(start, end).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < line.length) excerpt = `${excerpt}…`;
  if (excerpt.length > maxLen) {
    const center = Math.floor((relStart + relEnd) / 2) - Math.floor(maxLen / 2);
    const sliceStart = Math.max(0, center);
    excerpt = `${sliceStart > 0 ? "…" : ""}${line.slice(sliceStart, sliceStart + maxLen).trim()}…`;
  }
  return excerpt;
}

/**
 * @param {string} evidence
 * @param {number} amps
 * @param {string} [rejectReason]
 */
function isValidAmperageMatch(evidence, amps, rejectReason = null) {
  if (rejectReason) return { valid: false, reason: rejectReason };
  if (!Number.isFinite(amps) || amps <= 0) {
    return { valid: false, reason: "zero_or_invalid_amperage" };
  }
  if (amps < 30 && BRANCH_CIRCUIT_PATTERN.test(evidence)) {
    return { valid: false, reason: "branch_circuit_rating" };
  }
  if (AIC_PATTERN.test(evidence)) {
    return { valid: false, reason: "aic_fault_current" };
  }
  if (CONDUCTOR_PATTERN.test(evidence) && !AMP_CONTEXT_PATTERN.test(evidence)) {
    return { valid: false, reason: "conductor_size_context" };
  }
  if (/\b3P\b/i.test(evidence) && !/\b\d+\s*A\b/i.test(evidence.replace(/\b3P\b/i, ""))) {
    return { valid: false, reason: "phase_not_amperage" };
  }
  if (/\(\d+\)\s*SETS?\b/i.test(evidence) && !/\bPANEL|MDP|DISCONNECT|SERVICE\b/i.test(evidence)) {
    return { valid: false, reason: "conductor_set_quantity" };
  }
  if (!AMP_CONTEXT_PATTERN.test(evidence)) {
    return { valid: false, reason: "missing_amp_context_token" };
  }
  return { valid: true, reason: null };
}

/**
 * @param {string} context
 * @returns {{ entityType: string, entityName: string | null, fieldKey: string, label: string }}
 */
function classifyPanelEntity(context) {
  const line = String(context ?? "");

  const panelAfterAmp = line.match(/(\d+(?:\.\d+)?)\s*A\s+MLO\s+["']?([A-Z])["']?\s+PANEL/i);
  if (panelAfterAmp) {
    return {
      entityType: "panel",
      entityName: panelAfterAmp[2],
      fieldKey: "panel_rating",
      label: "Panel rating",
    };
  }

  const panelLetter = line.match(/\bPANEL\s*["']?([A-Z])["']?\s+(\d+(?:\.\d+)?)\s*A/i);
  if (panelLetter) {
    return {
      entityType: "panel",
      entityName: panelLetter[1],
      fieldKey: "panel_rating",
      label: "Panel rating",
    };
  }

  const mdp = line.match(/\b(?:NEW\s+)?PANELBOARD\s*["']?(MDP)["']?/i);
  if (mdp) {
    return {
      entityType: "main_distribution_panel",
      entityName: "MDP",
      fieldKey: "main_distribution_panel_rating",
      label: "Main distribution panel rating",
    };
  }

  const namedPanel = line.match(/\bPANEL\s*["']?([A-Z0-9][A-Z0-9\-/.]{0,12})["']?/i);
  if (namedPanel && !/BOARDS?/i.test(namedPanel[1])) {
    return {
      entityType: "panel",
      entityName: namedPanel[1],
      fieldKey: "panel_rating",
      label: "Panel rating",
    };
  }

  return { entityType: "unidentified", entityName: "unidentified", fieldKey: "panel_rating", label: "Panel rating" };
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
 * @param {string} evidence
 */
function evidenceFingerprint(evidence) {
  return String(evidence ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function detectOneLineDiagramText(text) {
  const hay = String(text ?? "");
  if (/\bPANEL\s+SCHEDULE\b/i.test(hay) && !/\bONE[\s-]*LINE\b/i.test(hay)) {
    return false;
  }
  return (
    /\bONE[\s-]*LINE\b/i.test(hay) ||
    /\bSINGLE[\s-]*LINE\b/i.test(hay) ||
    (/\bMDP\b/i.test(hay) && /\b\d{2,4}\s*A\b/i.test(hay) && /\d+\/\d+\s*V/i.test(hay))
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
  /** @type {Array<Record<string, unknown>>} */
  const rejected = [];
  const pageText = String(text ?? "");
  if (!pageText.trim()) return out;

  const push = (record) => {
    const evidence = String(record.evidence_text ?? "");
    out.push(
      buildCandidateRecord({
        ...record,
        evidence_fingerprint: evidenceFingerprint(evidence),
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        extraction_method: source.extraction_method ?? "one_line_pdf_text",
        external_application_id: source.external_application_id,
        is_project_total: record.entity_type === "project_service",
        review_blocked_reason:
          record.review_blocked_reason ??
          (record.entity_type === "unidentified"
            ? "Entity could not be determined safely"
            : record.field_key?.includes("panel") || record.field_key?.includes("disconnect")
              ? "Panel/disconnect rating — not package service evidence"
              : null),
      }),
    );
  };

  const pushRejected = (raw, reason, evidence) => {
    rejected.push({ raw_value: raw, reason, evidence: evidence.slice(0, 120) });
  };

  const panelBlockRegex =
    /(?:NEW\s+)?PANELBOARD\s*["']?([^"'\s,]+)["']?\s*(\d{2,4})\s*A[,\s]+(\d+\/\d+)\s*V[,\s]*(\d+)[\s-]*(?:PH|Ø|PHASE)/gi;
  let match;
  while ((match = panelBlockRegex.exec(pageText)) !== null) {
    const entityName = String(match[1]).trim();
    const amps = Number(match[2]);
    const voltage = match[3];
    const phaseRaw = match[4];
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;

    const entityType =
      /^MDP$/i.test(entityName) ? "main_distribution_panel" : "panel";
    const ampFieldKey =
      entityType === "main_distribution_panel"
        ? "main_distribution_panel_rating"
        : "panel_rating";

    push({
      field_key: ampFieldKey,
      field_label: entityType === "main_distribution_panel" ? "MDP rating" : "Panel rating",
      raw_value: String(amps),
      normalized_value: amps,
      unit: "A",
      entity_type: entityType,
      entity_name: entityName,
      fact_type: "panel_fact",
      category: entityType === "main_distribution_panel" ? "main_distribution_equipment" : "panel_rating",
      evidence_text: evidence,
      confidence: 0.85,
    });
    push({
      field_key: "service_voltage",
      field_label: "Service voltage",
      raw_value: voltage,
      normalized_value: voltage,
      unit: "V",
      entity_type: entityType,
      entity_name: entityName,
      fact_type: "panel_fact",
      category: "service_voltage",
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
        entity_type: entityType,
        entity_name: entityName,
        fact_type: "panel_fact",
        category: "phase",
        evidence_text: evidence,
        confidence: 0.85,
      });
    }
  }

  const mloPanelRegex = /PANEL\s*["']?([A-Z])["']?\s+(\d{2,4})\s*A\s+MLO/gi;
  while ((match = mloPanelRegex.exec(pageText)) !== null) {
    const entityName = match[1];
    const amps = Number(match[2]);
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;
    push({
      field_key: "panel_rating",
      field_label: "Panel rating",
      raw_value: String(amps),
      normalized_value: amps,
      unit: "A",
      entity_type: "panel",
      entity_name: entityName,
      fact_type: "panel_fact",
      category: "panel_rating",
      evidence_text: evidence,
      confidence: 0.8,
    });
  }

  const slashVoltageRegex = /(\d{2,3}\/\d{2,3})\s*V/gi;
  while ((match = slashVoltageRegex.exec(pageText)) !== null) {
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;
    if (!AMP_CONTEXT_PATTERN.test(evidence) && !SERVICE_ENTRANCE_PATTERN.test(evidence)) continue;

    const entity = classifyPanelEntity(line);
    if (entity.entityType === "unidentified" && !SERVICE_ENTRANCE_PATTERN.test(evidence)) continue;

    push({
      field_key: "service_voltage",
      field_label: "Service voltage",
      raw_value: match[1],
      normalized_value: match[1],
      unit: "V",
      entity_type: entity.entityType === "unidentified" ? "project_service" : entity.entityType,
      entity_name: entity.entityName,
      fact_type: entity.entityType === "project_service" ? "project_service_fact" : "panel_fact",
      category: "service_voltage",
      evidence_text: evidence,
      confidence: 0.88,
    });
  }

  const disconnectRegex =
    /(\d{2,4})\s*A[,\s]+(\d+)[\s-]*POLE[,\s]+(?:NEMA[^,]*)?(?:[^,]*DISCONNECT|FUSED|SWITCH)/gi;
  while ((match = disconnectRegex.exec(pageText)) !== null) {
    const amps = Number(match[1]);
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;
    const check = isValidAmperageMatch(evidence, amps);
    if (!check.valid) {
      pushRejected(String(amps), check.reason, evidence);
      continue;
    }
    push({
      field_key: "disconnect_rating",
      field_label: "Disconnect rating",
      raw_value: String(amps),
      normalized_value: amps,
      unit: "A",
      entity_type: "service_equipment",
      entity_name: "Service disconnect",
      fact_type: "service_equipment_fact",
      category: "disconnect_rating",
      evidence_text: evidence,
      confidence: 0.82,
    });
  }

  const serviceAmpRegex = /(?<![#,/\d])(\d{2,4})(?![,/\d])\s*A(?!IC)\b/gi;
  while ((match = serviceAmpRegex.exec(pageText)) !== null) {
    const amps = Number(match[1]);
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;

    const precededByComma =
      match.index > 0 && pageText[match.index - 1] === ",";
    const check = isValidAmperageMatch(
      evidence,
      amps,
      precededByComma ? "thousands_separator_fragment" : null,
    );
    if (!check.valid) {
      pushRejected(String(amps), check.reason, evidence);
      continue;
    }

    if (SERVICE_ENTRANCE_PATTERN.test(evidence)) {
      push({
        field_key: "service_entrance_amperage",
        field_label: "Service entrance amperage",
        raw_value: String(amps),
        normalized_value: amps,
        unit: "A",
        entity_type: "project_service",
        entity_name: null,
        fact_type: "project_service_fact",
        category: "service_entrance",
        evidence_text: evidence,
        confidence: 0.85,
      });
      continue;
    }

    if (/\bMLO\b/i.test(evidence) && /\bPANEL\b/i.test(evidence)) {
      const entity = classifyPanelEntity(line);
      if (entity.entityType === "unidentified") {
        pushRejected(String(amps), "unidentified_panel_entity", evidence);
        continue;
      }
      push({
        field_key: entity.fieldKey,
        field_label: entity.label,
        raw_value: String(amps),
        normalized_value: amps,
        unit: "A",
        entity_type: entity.entityType,
        entity_name: entity.entityName,
        fact_type: "panel_fact",
        category: entity.entityType === "main_distribution_panel" ? "main_distribution_equipment" : "panel_rating",
        evidence_text: evidence,
        confidence: 0.75,
      });
      continue;
    }

    if (/\bDISCONNECT\b/i.test(evidence) || /\bFUSED\b/i.test(evidence)) {
      push({
        field_key: "disconnect_rating",
        field_label: "Disconnect rating",
        raw_value: String(amps),
        normalized_value: amps,
        unit: "A",
        entity_type: "service_equipment",
        entity_name: "Service disconnect",
        fact_type: "service_equipment_fact",
        category: "disconnect_rating",
        evidence_text: evidence,
        confidence: 0.78,
      });
      continue;
    }

    if (/\bCT\s+CABINET\b/i.test(evidence) || /\bMETER\b/i.test(evidence)) {
      pushRejected(String(amps), "meter_area_not_service_amperage", evidence);
      continue;
    }

    const entity = classifyPanelEntity(line);
    if (entity.entityType !== "unidentified") {
      push({
        field_key: entity.fieldKey,
        field_label: entity.label,
        raw_value: String(amps),
        normalized_value: amps,
        unit: "A",
        entity_type: entity.entityType,
        entity_name: entity.entityName,
        fact_type: "panel_fact",
        category: entity.entityType === "main_distribution_panel" ? "main_distribution_equipment" : "panel_rating",
        evidence_text: evidence,
        confidence: 0.72,
      });
    } else {
      pushRejected(String(amps), "unidentified_entity", evidence);
    }
  }

  const phaseRegex = /(\d+)[\s-]*(?:PH|Ø|PHASE)\b/gi;
  while ((match = phaseRegex.exec(pageText)) !== null) {
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;
    if (!AMP_CONTEXT_PATTERN.test(evidence)) continue;
    const phase = normalizeOneLinePhase(match[1]);
    if (!phase) continue;
    const entity = classifyPanelEntity(line);
    push({
      field_key: "phase",
      field_label: "Phase",
      raw_value: match[0].trim(),
      normalized_value: phase,
      unit: "phase",
      entity_type: entity.entityType === "unidentified" ? "project_service" : entity.entityType,
      entity_name: entity.entityName,
      fact_type: entity.entityType === "unidentified" ? "project_service_fact" : "panel_fact",
      category: "phase",
      evidence_text: evidence,
      confidence: 0.8,
    });
  }

  const wireRegex = /(\d+)[\s-]*(?:W|WIRE)\b/gi;
  while ((match = wireRegex.exec(pageText)) !== null) {
    const line = getLocalContext(pageText, match.index);
    const evidence = buildConciseEvidence(pageText, match.index, match[0].length) || line;
    if (!/\d+\/\d+\s*V/i.test(evidence) && !AMP_CONTEXT_PATTERN.test(evidence)) continue;
    const entity = classifyPanelEntity(line);
    push({
      field_key: "wire_configuration",
      field_label: "Wire configuration",
      raw_value: `${match[1]}-wire`,
      normalized_value: match[1],
      unit: "wire",
      entity_type: entity.entityType === "unidentified" ? "project_service" : entity.entityType,
      entity_name: entity.entityName,
      fact_type: entity.entityType === "unidentified" ? "project_service_fact" : "panel_fact",
      category: "wire_configuration",
      evidence_text: evidence,
      confidence: 0.78,
    });
  }

  if (/\bCT\s+CABINET\b/i.test(pageText)) {
    const idx = pageText.search(/\bCT\s+CABINET\b/i);
    const evidence = buildConciseEvidence(pageText, idx, 12);
    push({
      field_key: "ct_cabinet_present",
      field_label: "CT cabinet present",
      raw_value: "true",
      normalized_value: true,
      unit: null,
      entity_type: "meter_service",
      entity_name: "CT cabinet",
      fact_type: "metering_evidence",
      category: "metering_equipment",
      evidence_text: evidence,
      confidence: 0.82,
      review_blocked_reason: "Equipment presence — not a meter count",
    });
  }

  if (/\bMETER\b/i.test(pageText) && !/\bEGAUGE\b/i.test(pageText.slice(0, pageText.search(/\bMETER\b/i) + 20))) {
    const idx = pageText.search(/\b(?:CT\s+CABINET\s+AND\s+)?METER\b/i);
    if (idx >= 0) {
      const evidence = buildConciseEvidence(pageText, idx, 20);
      push({
        field_key: "meter_present",
        field_label: "Meter present",
        raw_value: "true",
        normalized_value: true,
        unit: null,
        entity_type: "meter_service",
        entity_name: "Meter",
        fact_type: "metering_evidence",
        category: "metering_equipment",
        evidence_text: evidence,
        confidence: 0.8,
        review_blocked_reason: "Equipment presence — meter count requires explicit quantity",
      });
    }
  }

  const meterCountMatch = pageText.match(/\b(\d+)\s+METERS?\b/i);
  if (meterCountMatch) {
    const qty = Number(meterCountMatch[1]);
    const idx = meterCountMatch.index ?? 0;
    const evidence = buildConciseEvidence(pageText, idx, meterCountMatch[0].length);
    push({
      field_key: "meter_count",
      field_label: "Meter count",
      raw_value: String(qty),
      normalized_value: qty,
      unit: "count",
      entity_type: "meter_service",
      entity_name: "Meter",
      fact_type: "project_service_fact",
      category: "meter_count",
      evidence_text: evidence,
      confidence: 0.75,
      requires_human_review: true,
      review_blocked_reason: "Inferred meter count requires human review",
    });
  }

  if (/\bTRANSFORMER\b/i.test(pageText)) {
    const idx = pageText.search(/\bTRANSFORMER\b/i);
    const evidence = buildConciseEvidence(pageText, idx, 30);
    push({
      field_key: "service_configuration",
      field_label: "Transformer",
      raw_value: "pad-mounted transformer",
      normalized_value: null,
      unit: null,
      entity_type: "transformer",
      entity_name: "Pad-mounted transformer",
      fact_type: "service_equipment_fact",
      category: "service_configuration",
      evidence_text: evidence,
      confidence: 0.65,
      review_blocked_reason: "Transformer rating not parsed from native text",
    });
  }

  if (/\bSWITCHGEAR\b/i.test(pageText)) {
    const idx = pageText.search(/\bSWITCHGEAR\b/i);
    const evidence = buildConciseEvidence(pageText, idx, 20);
    push({
      field_key: "service_configuration",
      field_label: "Switchgear",
      raw_value: "switchgear",
      normalized_value: null,
      unit: null,
      entity_type: "switchgear",
      entity_name: "Switchgear",
      fact_type: "service_equipment_fact",
      category: "service_configuration",
      evidence_text: evidence,
      confidence: 0.6,
      review_blocked_reason: "Switchgear details require layout review",
    });
  }

  const deduped = dedupeOneLineCandidates(out);
  if (rejected.length && deduped.length) {
    deduped[0].debug_rejected_amperage_matches = rejected;
  }
  return deduped;
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function dedupeOneLineCandidates(candidates) {
  const seen = new Map();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const c of candidates) {
    const key = [
      c.field_key,
      c.entity_type,
      c.entity_name,
      c.page_number,
      c.normalized_value,
      c.unit,
      c.evidence_fingerprint ?? evidenceFingerprint(String(c.evidence_text ?? "")),
    ].join("|");
    const existing = seen.get(key);
    if (existing) {
      const methods = new Set([
        ...(Array.isArray(existing.contributing_methods) ? existing.contributing_methods : [existing.extraction_method]),
        c.extraction_method,
      ]);
      existing.contributing_methods = [...methods];
      if ((c.confidence ?? 0) > (existing.confidence ?? 0)) {
        existing.confidence = c.confidence;
        existing.evidence_text = c.evidence_text;
      }
      continue;
    }
    seen.set(key, c);
    out.push(c);
  }
  return out;
}

module.exports = {
  detectOneLineDiagramText,
  extractOneLineFindingsFromText,
  dedupeOneLineCandidates,
  normalizeOneLinePhase,
  buildConciseEvidence,
  isValidAmperageMatch,
  evidenceFingerprint,
};
