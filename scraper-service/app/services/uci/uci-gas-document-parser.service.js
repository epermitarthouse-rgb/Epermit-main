"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");
const {
  classifyDocumentType,
  isConstructionScheduleDocument,
  normalizeRoleClassificationText,
} = require("./uci-document-classification.service.js");

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeGasPressureValue(raw) {
  const text = String(raw ?? "").trim();
  const numMatch =
    text.match(/^(?:0*(\d+(?:\.\d+)?))(?:\s*in\.?\s*w\.?\s*c\.?\s*)*$/i) ||
    text.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const num = Number(numMatch[1]);
  if (!Number.isFinite(num)) return null;
  return `${num} in. w.c.`;
}

/**
 * Collapse PDF extraction noise so label/value pairs stay on one logical line.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeGasPageText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/([A-Za-z])\s*\n\s*([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer filename for construction schedules — shared PDF headers often
 * mention "GAS LOAD PROFILE" and would otherwise mis-route date extraction.
 *
 * @param {string} name
 * @param {string} text
 */
function isGasConstructionScheduleDocument(name, text) {
  const filenameHaystack = normalizeRoleClassificationText(name);
  if (/\bCONSTRUCTION[\s-]*(SERVICE[\s-]*)?SCHEDULE\b/i.test(filenameHaystack)) {
    return true;
  }
  return isConstructionScheduleDocument({ file_name: name, text });
}

/**
 * @param {string} name
 * @param {string} text
 */
function hasGasDomainSignals(name, text) {
  const haystack = `${name} ${String(text ?? "").slice(0, 4000)}`;
  return (
    /\bGAS\b/i.test(name) ||
    /\b(BTU\s*\/?\s*H|BTUH|CFH|GAS[\s-]*LOAD|WASHINGTON[\s-]*GAS|\bWGL\b)\b/i.test(haystack)
  );
}

/**
 * @param {string} name
 * @param {string} text
 */
function shouldParseAsGasDocument(name, text) {
  if (hasGasDomainSignals(name, text)) {
    return true;
  }
  const docType = classifyDocumentType({ file_name: name, text });
  // load_profile also matches electric load letters — never route those through gas parsing.
  if (docType === "load_profile") {
    return false;
  }
  return [
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
  const pageText = normalizeGasPageText(text);
  const name = String(source.source_document_name ?? "");

  if (isGasConstructionScheduleDocument(name, pageText)) {
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

  const btuUnitPattern = String.raw`(?:BTU\s*\/?\s*H|BTUH|BTU\s*(?:PER|\/)\s*H(?:OUR)?)`;
  const syntheticPrefix = String.raw`(?:\bSynthetic\s+requested\s+value\s+)?`;

  const connected =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\bConnected\\s+(?:Gas\\s+)?Load\\b\\s*[:.]?\\s*([\\d,]+)\\s*${btuUnitPattern}\\b`,
        "i",
      ),
    ) ||
    pageText.match(
      new RegExp(`\\bConnected\\s+(?:Gas\\s+)?Load\\b\\s*[:.]?\\s*([\\d,]+)\\s*${btuUnitPattern}\\b`, "i"),
    );
  if (connected) {
    const n = Number(String(connected[1]).replace(/,/g, ""));
    push("connected_load_btuh", connected[1], n, "BTU/h", connected[0]);
    push("connected_gas_equipment", connected[1], n, "BTU/h", connected[0]);
  }

  const design =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\b(?:Design|Requested(?:\\s*\\/\\s*Design)?)\\s+(?:Gas\\s+)?Load\\b\\s*[:.]?\\s*([\\d,]+)\\s*${btuUnitPattern}\\b`,
        "i",
      ),
    ) ||
    pageText.match(
      new RegExp(
        `\\b(?:Design|Requested(?:\\s*\\/\\s*Design)?|Requested)\\s+(?:Gas\\s+)?Load\\b\\s*[:.]?\\s*([\\d,]+)\\s*${btuUnitPattern}\\b`,
        "i",
      ),
    );
  if (design) {
    const n = Number(String(design[1]).replace(/,/g, ""));
    push("requested_load_btuh", design[1], n, "BTU/h", design[0]);
    push("btu_demand", design[1], n, "BTU/h", design[0]);
  }

  const pressure =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\b(?:Required\\s+)?(?:Delivery\\s+)?Pressure\\b\\s*[:.]?\\s*(0*\\d+(?:\\.\\d+)?)(?:\\s*in\\.?\\s*w\\.?\\s*c\\.?\\s*)+`,
        "i",
      ),
    ) ||
    pageText.match(/(?:^|[^\w])(0*\d+(?:\.\d+)?)\s*in\.?\s*w\.?\s*c\.?\b/i);
  if (pressure) {
    const normalizedPressure = normalizeGasPressureValue(pressure[1]);
    if (normalizedPressure) {
      push("pressure_requirements", pressure[0], normalizedPressure, "in. w.c.", pressure[0]);
    }
  }

  const meter =
    pageText.match(
      new RegExp(`${syntheticPrefix}\\bMeter\\s+(?:Quantity|Count)\\b\\s*[:.]?\\s*(\\d+)\\b`, "i"),
    ) ||
    pageText.match(/\bMeter\s+Count\b\s*[:.]?\s*(\d+)\b/i);
  if (meter) {
    push("meter_count", meter[1], Number(meter[1]), "count", meter[0]);
  }

  const serviceLine =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\b(?:Requested\\s+)?Service\\s+Line(?:\\s+Size)?\\b\\s*[:.]?\\s*([\\d\\-]+(?:\\s*[\\d\\/]+)?)\\s*(?:\"|in\\.?)?\\b`,
        "i",
      ),
    ) ||
    pageText.match(
      /\bService\s+Line\s+Size\b\s*[:.]?\s*([\d\-]+(?:\s*[\d\/]+)?)\s*(?:\"|in\.?)?\b/i,
    );
  if (serviceLine) {
    push("requested_service_line", serviceLine[1], serviceLine[1].trim(), "in", serviceLine[0]);
  }

  const regulator =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\b(?:Gas\\s+)?Regulator\\b\\s*[:.]?\\s*(Required|Yes|Needed)\\b`,
        "i",
      ),
    ) ||
    pageText.match(/\b(?:Gas\s+)?Regulator\b\s*[:.]?\s*(Required|Yes|Needed)\b/i) ||
    pageText.match(/\bGas\s+Regulator\b\s*[:.]?\s*([A-Za-z][A-Za-z\s-]{0,40})/i);
  if (regulator) {
    push("gas_regulator", regulator[1], String(regulator[1]).trim(), null, regulator[0]);
  }

  const location =
    pageText.match(
      new RegExp(`${syntheticPrefix}\\bMeter\\s+Location\\b\\s*[:\\-]?\\s*(.+?)(?:\\s+Synthetic\\s+requested\\s+value\\b|$)`, "i"),
    ) || pageText.match(/\bMeter\s+Location\b\s*[:\-]?\s*(.+)/i);
  if (location) {
    const value = String(location[1]).trim().split(/\r?\n/)[0].trim();
    if (value) push("meter_location", value, value, null, `Meter Location ${value}`);
  }

  const docType = classifyDocumentType({ file_name: name, text: pageText });
  if (docType === "equipment_schedule" || /\bEQUIPMENT\s+SCHEDULE\b/i.test(name)) {
    const totalBtu = pageText.match(
      new RegExp(
        `\\bTotal\\s+(?:Connected\\s+)?(?:Gas\\s+)?Load\\b\\s*[:.]?\\s*([\\d,]+)\\s*${btuUnitPattern}\\b`,
        "i",
      ),
    );
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
  const pageText = normalizeGasPageText(text);
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

  const datePattern = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})`;
  const syntheticPrefix = String.raw`(?:Synthetic\s+requested\s+value\s+)?`;

  const start =
    pageText.match(
      new RegExp(`${syntheticPrefix}\\bConstruction\\s+Start(?:\\s+Date)?\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"),
    ) ||
    pageText.match(new RegExp(`\\bConstruction\\s+Start(?:\\s+Date)?\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i")) ||
    pageText.match(
      new RegExp(`${syntheticPrefix}\\b(?:Ground\\s*break|Groundbreak)\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"),
    ) ||
    pageText.match(new RegExp(`\\b(?:Ground\\s*break|Groundbreak)\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"));
  if (start) push("construction_start_date", start[1]);

  const completion =
    pageText.match(
      new RegExp(
        `${syntheticPrefix}\\bConstruction\\s+Completion(?:\\s+Date)?\\b[^:\\n]{0,20}[:\\s]+${datePattern}`,
        "i",
      ),
    ) ||
    pageText.match(
      new RegExp(`\\bConstruction\\s+Completion(?:\\s+Date)?\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"),
    ) ||
    pageText.match(
      new RegExp(`${syntheticPrefix}\\bCompletion\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"),
    ) ||
    pageText.match(new RegExp(`\\bCompletion\\b[^:\\n]{0,20}[:\\s]+${datePattern}`, "i"));
  if (completion) push("construction_completion_date", completion[1]);

  const inService = pageText.match(
    new RegExp(
      `${syntheticPrefix}\\b(?:Requested\\s+)?In[\\s-]*Service(?:\\s+Date)?\\b[^:\\n]{0,20}[:\\s]+(\\d{4}-\\d{2}-\\d{2})`,
      "i",
    ),
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
  normalizeGasPageText,
  normalizeGasPressureValue,
  isGasConstructionScheduleDocument,
  extractGasDocumentFindingsFromText,
  extractGasConstructionScheduleDates,
  extractConstructionScheduleDatesFromText,
};
