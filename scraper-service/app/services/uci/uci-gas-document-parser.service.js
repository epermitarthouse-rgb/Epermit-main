"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");
const {
  classifyDocumentType,
  isConstructionScheduleDocument,
} = require("./uci-document-classification.service.js");

/**
 * @param {string} name
 * @param {string} text
 */
function shouldParseAsGasDocument(name, text) {
  const haystack = `${name} ${String(text ?? "").slice(0, 4000)}`;
  if (/\bGAS\b/i.test(name) || /\b(BTU\s*\/?\s*H|BTUH|GAS[\s-]*LOAD)\b/i.test(haystack)) {
    return true;
  }
  const docType = classifyDocumentType({ file_name: name, text });
  return [
    "load_profile",
    "equipment_schedule",
    "service_plan",
    "meter_regulator",
    "cut_sheet",
    "construction_schedule",
  ].includes(docType);
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {Record<string, unknown>} source
 */
function extractGasDocumentFindingsFromText(text, pageNumber, source) {
  const pageText = String(text ?? "");
  const name = String(source.source_document_name ?? "");
  const docType = classifyDocumentType({ file_name: name, text: pageText });

  if (docType === "construction_schedule" || isConstructionScheduleDocument({ file_name: name, text: pageText })) {
    return extractGasConstructionScheduleDates(pageText, pageNumber, source);
  }

  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const push = (field_key, raw_value, normalized_value, unit, evidence, confidence = 0.85) => {
    out.push(
      buildCandidateRecord({
        field_key,
        raw_value: String(raw_value),
        normalized_value,
        unit,
        entity_type: "project_service",
        entity_name: null,
        is_project_total: true,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: evidence.slice(0, 500),
        extraction_method: "pdf_text",
        confidence,
        external_application_id: source.external_application_id,
      }),
    );
  };

  const connected = pageText.match(
    /\bConnected\s+Load\b[^:\n]*[:\s]+([\d,]+)\s*BTU\s*\/?\s*H?\b/i,
  );
  if (connected) {
    const n = Number(String(connected[1]).replace(/,/g, ""));
    push("connected_load_btuh", connected[1], n, "BTU/h", connected[0]);
    push("connected_gas_equipment", connected[1], n, "BTU/h", connected[0]);
  }

  const design =
    pageText.match(
      /\b(?:Design|Requested(?:\/Design)?|Requested)\s+Load\b[^:\n]*[:\s]+([\d,]+)\s*BTU\s*\/?\s*H?\b/i,
    ) ||
    pageText.match(/\bRequested\s+Load\b[^:\n]*[:\s]+([\d,]+)\s*BTU\s*\/?\s*H?\b/i);
  if (design) {
    const n = Number(String(design[1]).replace(/,/g, ""));
    push("requested_load_btuh", design[1], n, "BTU/h", design[0]);
    push("btu_demand", design[1], n, "BTU/h", design[0]);
  }

  const pressure =
    pageText.match(
      /\b(?:Required\s+)?(?:Delivery\s+)?Pressure\b[^:\n]*[:\s]+([\d.]+)\s*in\.?\s*w\.?\s*c\.?\b/i,
    ) ||
    pageText.match(/\b([\d.]+)\s*in\.?\s*w\.?\s*c\.?\b/i);
  if (pressure) {
    push("pressure_requirements", pressure[0], `${pressure[1]} in w.c.`, "in w.c.", pressure[0]);
  }

  const meter =
    pageText.match(/\bMeter\s+(?:Quantity|Count)\b[^:\n]*[:\s]+(\d+)\b/i) ||
    pageText.match(/\bMeter\s+Count\b[^:\n]*[:\s]+(\d+)\b/i);
  if (meter) {
    push("meter_count", meter[1], Number(meter[1]), "count", meter[0]);
  }

  const serviceLine = pageText.match(
    /\b(?:Requested\s+)?Service\s+Line\b[^:\n]*[:\s]+([\d\-\/]+(?:[\s-]*[\d\/]+)?)\s*(?:\"|in\.?)?\b/i,
  );
  if (serviceLine) {
    push("requested_service_line", serviceLine[1], serviceLine[1], "in", serviceLine[0]);
  }

  const regulator =
    pageText.match(/\b(?:Gas\s+)?Regulator\b[^:\n]*[:\s]+(Required|Yes|Needed)\b/i) ||
    pageText.match(/\bGas\s+Regulator\b[^:\n]*[:\s]+([A-Za-z][A-Za-z\s-]{0,40})/i);
  if (regulator) {
    push("gas_regulator", regulator[1], String(regulator[1]).trim(), null, regulator[0]);
  }

  const location = pageText.match(/\bMeter\s+Location\b\s*[:\-]?\s*(.+)/i);
  if (location) {
    const value = String(location[1]).trim().split(/\r?\n/)[0].trim();
    if (value) push("meter_location", value, value, null, `Meter Location ${value}`);
  }

  if (docType === "equipment_schedule" || /\bEQUIPMENT\s+SCHEDULE\b/i.test(name)) {
    const totalBtu = pageText.match(/\bTotal\s+(?:Connected\s+)?(?:Gas\s+)?Load\b[^:\n]*[:\s]+([\d,]+)\s*BTU/i);
    if (totalBtu) {
      const n = Number(String(totalBtu[1]).replace(/,/g, ""));
      push("connected_gas_equipment", totalBtu[1], n, "BTU/h", totalBtu[0]);
    }
  }

  return out;
}

/**
 * Construction schedules contribute schedule dates only — not engineering load.
 *
 * @param {string} text
 * @param {number} pageNumber
 * @param {Record<string, unknown>} source
 */
function extractGasConstructionScheduleDates(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const push = (field_key, raw_value) => {
    out.push(
      buildCandidateRecord({
        field_key,
        raw_value: String(raw_value),
        normalized_value: String(raw_value),
        unit: null,
        entity_type: "project_service",
        entity_name: null,
        is_project_total: false,
        source_type: source.source_type,
        source_document_name: source.source_document_name,
        source_document_id: source.source_document_id,
        source_storage_path: source.source_storage_path,
        source_content_hash: source.source_content_hash,
        page_number: pageNumber,
        evidence_text: String(raw_value),
        extraction_method: "pdf_text",
        confidence: 0.8,
        external_application_id: source.external_application_id,
        aggregation_role: "schedule_date_only",
      }),
    );
  };

  const start =
    text.match(/\bConstruction\s+Start(?:\s+Date)?\b[^:\n]*[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i) ||
    text.match(/\b(?:Ground\s*break|Groundbreak)\b[^:\n]*[:\s]+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (start) push("construction_start_date", start[1]);

  const completion =
    text.match(
      /\bConstruction\s+Completion(?:\s+Date)?\b[^:\n]*[:\s]+(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i,
    ) ||
    text.match(/\bCompletion\b[^:\n]*[:\s]+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (completion) push("construction_completion_date", completion[1]);

  const inService = text.match(
    /\b(?:Requested\s+)?In[\s-]*Service(?:\s+Date)?\b[^:\n]*[:\s]+(\d{4}-\d{2}-\d{2})/i,
  );
  if (inService) push("requested_in_service_date", inService[1]);

  return out;
}

/**
 * @param {string} text
 */
function detectGasLoadDocumentText(text) {
  return shouldParseAsGasDocument("", text);
}

/** @deprecated use extractGasConstructionScheduleDates */
function extractConstructionScheduleDatesFromText(text, pageNumber, source) {
  return extractGasConstructionScheduleDates(text, pageNumber, source);
}

module.exports = {
  shouldParseAsGasDocument,
  detectGasLoadDocumentText,
  extractGasDocumentFindingsFromText,
  extractGasConstructionScheduleDates,
  extractConstructionScheduleDatesFromText,
};
