"use strict";

/**
 * Extract utility-issued COS / design-review fields from parsed text.
 * Returns provenance-tagged values; uncertain extractions are flagged.
 */

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {string | null}
 */
function firstMatch(text, re) {
  const m = text.match(re);
  return m && m[1] != null ? String(m[1]).trim() : null;
}

/**
 * @param {unknown} value
 * @param {string} source
 * @param {number} [confidence]
 */
function field(value, source, confidence = 0.8) {
  if (value == null || value === "") return null;
  return {
    value,
    source,
    confidence,
    provenance: "utility_document",
  };
}

/**
 * @param {string} text
 */
function extractElectricFields(text) {
  const hay = String(text || "");
  /** @type {Record<string, unknown>} */
  const out = {};

  const voltage =
    firstMatch(
      hay,
      /(?:assigned|approved|service)\s+voltage\s*[:\-]?\s*([0-9]{2,4}\s*(?:Y\s*\/|\s*\/)\s*[0-9]{2,4}\s*V(?:olts?)?)/i,
    ) ||
    firstMatch(hay, /\b((?:120\s*\/\s*208|208\s*\/\s*120|208Y\s*\/\s*120|480Y\s*\/\s*277|120\/240)\s*V(?:olts?)?)\b/i) ||
    firstMatch(hay, /\b((?:208|240|277|480|120\/240|208Y\/120|480Y\/277)\s*V(?:olts?)?)\b/i) ||
    firstMatch(hay, /voltage\s*[:\-]?\s*([0-9]{2,4}\s*\/?\s*[0-9]{0,4}\s*V)/i);
  if (voltage) out.service_voltage = field(voltage.replace(/\s+/g, ""), "regex_voltage");

  const amps =
    firstMatch(hay, /(?:service\s+(?:capacity|size|amperage)|assigned\s+service)\s*[:\-]?\s*([0-9]{2,5})\s*A(?:mps?)?\b/i) ||
    firstMatch(hay, /\b([0-9]{2,5})\s*A(?:mp(?:ere)?s?)?\s+(?:service|pad[\s-]?mount|secondary)\b/i) ||
    firstMatch(hay, /\b([0-9]{3,5})\s*A\b/);
  if (amps) out.service_amperage = field(Number(amps), "regex_amperage");

  const phase =
    firstMatch(hay, /\b([123])\s*[\- ]?\s*ph(?:ase)?\b/i) ||
    firstMatch(hay, /\b(single[\s-]?phase|three[\s-]?phase|1[\s-]?phase|3[\s-]?phase)\b/i);
  if (phase) {
    const normalized = /3|three/i.test(phase) ? "3" : /1|single/i.test(phase) ? "1" : phase;
    out.phase = field(normalized, "regex_phase");
  }

  const wire =
    firstMatch(hay, /\b((?:3|4)[\s-]?wire)\b/i) ||
    firstMatch(hay, /(?:wire|service)\s+configuration\s*[:\-]?\s*([^\n.;,]{3,40})/i);
  if (wire) out.wire_configuration = field(wire, "regex_wire");

  const demand =
    firstMatch(hay, /(?:design\s+basis|demand(?:\s+load)?|submitted\s+demand)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*kW\b/i);
  if (demand) out.demand_load_kw = field(Number(demand), "regex_demand");

  const meterLoc =
    firstMatch(hay, /meter\s+location\s*[:\-]?\s*([^\n.;]{3,80})/i) ||
    firstMatch(hay, /approved\s+(?:meter\s+)?location\s*[:\-]?\s*([^\n.;]{3,80})/i);
  if (meterLoc) out.meter_location = field(meterLoc, "regex_meter_location");

  const meterCount =
    firstMatch(hay, /(?:number\s+of\s+meters|meter\s+(?:qty|quantity|count))\s*[:\-]?\s*([0-9]+)/i);
  if (meterCount) out.meter_count = field(Number(meterCount), "regex_meter_count");

  const transformer =
    firstMatch(hay, /transformer\s*[:\-]?\s*([^\n.;]{3,80})/i) ||
    firstMatch(hay, /\b([0-9]+(?:\.[0-9]+)?\s*kVA\s+pad[\s-]?mount)\b/i);
  if (transformer) out.transformer_specs = field(transformer, "regex_transformer");

  const conditions =
    firstMatch(hay, /(?:design\s+conditions?|customer\s+responsibilit(?:y|ies))\s*[:\-]?\s*([^\n]{5,200})/i) ||
    (/easement\s+required/i.test(hay) ? "Easement required" : null);
  if (conditions) out.design_conditions = field(conditions, "regex_conditions");

  const revision =
    /revised?\s+plans?|additional\s+documents?\s+required|resubmit|more\s+information\s+required/i.test(
      hay,
    );
  if (revision) {
    out.revision_required = field(true, "regex_revision");
    out.required_next_documents = field(
      firstMatch(hay, /(?:provide|submit|required)\s*[:\-]?\s*([^\n]{5,160})/i) ||
        "Revised plans / additional documents",
      "regex_next_docs",
    );
  }

  const ciac =
    firstMatch(hay, /(?:CIAC|contribution\s+in\s+aid(?:\s+of\s+construction)?)\s*(?:estimate|amount)?\s*[:\-]?\s*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i) ||
    firstMatch(hay, /additional\s+cost\s*[:\-]?\s*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i);
  if (ciac) {
    out.ciac_estimate = field(Number(String(ciac).replace(/,/g, "")), "regex_ciac");
  }

  const issued =
    firstMatch(hay, /(?:issued|effective|dated)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (issued) out.utility_evidence_issued_at = field(issued, "regex_issued_date");

  return out;
}

/**
 * @param {string} text
 */
function extractGasFields(text) {
  const hay = String(text || "");
  /** @type {Record<string, unknown>} */
  const out = {};
  const pressure =
    firstMatch(hay, /(?:delivery\s+)?pressure(?:\s+class)?\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:psig?|inches?\s*WC)?)/i);
  if (pressure) out.gas_pressure = field(pressure, "regex_gas_pressure");
  const line =
    firstMatch(hay, /(?:line|pipe)\s+size\s*[:\-]?\s*([0-9]+(?:\s*\/\s*[0-9]+)?\s*(?:inch|in|"|mm)?)/i);
  if (line) out.gas_line_size = field(line, "regex_gas_line");
  const regulator =
    firstMatch(hay, /regulator\s*[:\-]?\s*([^\n.;]{3,60})/i);
  if (regulator) out.gas_regulator = field(regulator, "regex_gas_regulator");
  return out;
}

/**
 * @param {string} text
 */
function extractWaterSewerFields(text) {
  const hay = String(text || "");
  /** @type {Record<string, unknown>} */
  const out = {};
  const meter =
    firstMatch(hay, /(?:water\s+)?meter\s+size\s*[:\-]?\s*([0-9]+(?:\s*\/\s*[0-9]+)?\s*(?:inch|in|")?)/i);
  if (meter) out.water_meter_size = field(meter, "regex_water_meter");
  const gpm =
    firstMatch(hay, /\b([0-9]+(?:\.[0-9]+)?)\s*GPM\b/i);
  if (gpm) out.water_gpm = field(Number(gpm), "regex_gpm");
  const dfu =
    firstMatch(hay, /\b([0-9]+(?:\.[0-9]+)?)\s*DFU\b/i);
  if (dfu) out.water_dfu = field(Number(dfu), "regex_dfu");
  return out;
}

/**
 * @param {string} text
 * @param {{ utilityType?: string }} [opts]
 */
function extractCosDesignFields(text, opts = {}) {
  const utilityType = String(opts.utilityType || "electric").toLowerCase();
  /** @type {Record<string, unknown>} */
  const fields = {};

  if (!utilityType || utilityType === "electric" || utilityType.includes("electric")) {
    Object.assign(fields, extractElectricFields(text));
  }
  if (!utilityType || utilityType === "gas" || utilityType.includes("gas")) {
    Object.assign(fields, extractGasFields(text));
  }
  if (
    !utilityType ||
    utilityType === "water" ||
    utilityType === "sewer" ||
    utilityType.includes("water") ||
    utilityType.includes("sewer")
  ) {
    Object.assign(fields, extractWaterSewerFields(text));
  }

  // Always try electric+gas+water lightly so multi-utility letters still extract
  if (utilityType === "electric") {
    Object.assign(fields, extractGasFields(text));
    Object.assign(fields, extractWaterSewerFields(text));
  }

  const values = Object.values(fields).filter(Boolean);
  const avgConfidence =
    values.length === 0
      ? 0
      : values.reduce((sum, f) => sum + Number(/** @type {any} */ (f).confidence || 0), 0) /
        values.length;

  return {
    fields,
    field_count: values.length,
    extraction_confidence: Number(avgConfidence.toFixed(3)),
    uncertain: values.length === 0 || avgConfidence < 0.6,
  };
}

module.exports = {
  extractElectricFields,
  extractGasFields,
  extractWaterSewerFields,
  extractCosDesignFields,
};
