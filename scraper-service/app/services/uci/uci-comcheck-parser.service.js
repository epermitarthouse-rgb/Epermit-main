"use strict";

const { buildCandidateRecord } = require("./uci-load-candidate.service.js");

/**
 * @param {string} text
 * @returns {"lighting_interior"|"lighting_exterior"|"hvac_mechanical"|"compliance_checklist"|"unknown"}
 */
function detectComcheckReportSection(text) {
  const hay = String(text ?? "");
  if (/Mechanical\s+Systems\s+List/i.test(hay) || /\bDOAS-\d+/i.test(hay)) {
    return "hvac_mechanical";
  }
  if (/Exterior\s+Lighting/i.test(hay) || /Total\s+Tradable\s+Proposed\s+Watts/i.test(hay)) {
    return "lighting_exterior";
  }
  if (/Interior\s+Lighting/i.test(hay) || /Total\s+Proposed\s+Watts/i.test(hay)) {
    return "lighting_interior";
  }
  if (/Compliance\s+Certi/i.test(hay) && /Project\s+Information/i.test(hay)) {
    return "compliance_certificate";
  }
  if (/Inspection\s+Checklist|Complies\?\s+Comments/i.test(hay)) {
    return "compliance_checklist";
  }
  return "unknown";
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function detectComcheckReportText(text) {
  const hay = String(text ?? "");
  return /\bCOMcheck\b/i.test(hay) || /Compliance\s+Certi/i.test(hay) || /\bDOAS-\d+/i.test(hay);
}

/**
 * @param {string} text
 * @param {number} pageNumber
 * @param {object} source
 * @returns {Array<Record<string, unknown>>}
 */
function extractComcheckFindingsFromText(text, pageNumber, source) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pageText = String(text ?? "");
  if (!pageText.trim()) return out;

  const section = detectComcheckReportSection(pageText);
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
        extraction_method: source.extraction_method ?? "comcheck_pdf_text",
        external_application_id: source.external_application_id,
      }),
    );
  };

  if (section === "compliance_certificate" || pageNumber === 1) {
    extractComcheckProjectMetadata(pageText, pageNumber, push);
  }

  if (section === "lighting_interior") {
    const totalMatch = pageText.match(/Total\s+Proposed\s+Watts:\s*(\d+(?:\.\d+)?)/i);
    if (totalMatch) {
      push({
        field_key: "lighting_interior_total_watts",
        field_label: "Interior lighting total",
        raw_value: totalMatch[1],
        normalized_value: Number(totalMatch[1]),
        unit: "W",
        entity_type: "load_category",
        entity_name: "Interior lighting",
        fact_type: "electric_load",
        category: "load_category",
        evidence_text: totalMatch[0],
        confidence: 0.9,
        requires_human_review: true,
      });
    }
    const compliance = pageText.match(/Interior\s+Lighting\s+(PASSES|FAILS)/i);
    if (compliance) {
      push({
        field_key: "comcheck_compliance_status",
        field_label: "Interior lighting compliance",
        raw_value: compliance[1],
        normalized_value: compliance[1].toUpperCase(),
        unit: null,
        entity_type: "compliance",
        entity_name: "Interior lighting",
        fact_type: "compliance_evidence",
        category: "compliance_evidence",
        evidence_text: compliance[0],
        confidence: 0.85,
      });
    }
    out.push(...extractLightingFixtureRows(pageText, pageNumber, push, "interior"));
  }

  if (section === "lighting_exterior") {
    const totalMatch = pageText.match(/Total\s+Tradable\s+Proposed\s+Watts:\s*(\d+(?:\.\d+)?)/i);
    if (totalMatch) {
      push({
        field_key: "lighting_exterior_total_watts",
        field_label: "Exterior lighting total",
        raw_value: totalMatch[1],
        normalized_value: Number(totalMatch[1]),
        unit: "W",
        entity_type: "load_category",
        entity_name: "Exterior lighting",
        fact_type: "electric_load",
        category: "load_category",
        evidence_text: totalMatch[0],
        confidence: 0.9,
        requires_human_review: true,
      });
    }
    const compliance = pageText.match(/Exterior\s+Lighting\s+(PASSES|FAILS)/i);
    if (compliance) {
      push({
        field_key: "comcheck_compliance_status",
        field_label: "Exterior lighting compliance",
        raw_value: compliance[1],
        normalized_value: compliance[1].toUpperCase(),
        unit: null,
        entity_type: "compliance",
        entity_name: "Exterior lighting",
        fact_type: "compliance_evidence",
        category: "compliance_evidence",
        evidence_text: compliance[0],
        confidence: 0.85,
      });
    }
    out.push(...extractLightingFixtureRows(pageText, pageNumber, push, "exterior"));
  }

  if (section === "hvac_mechanical") {
    out.push(...extractHvacEquipmentRows(pageText, pageNumber, push));
    const compliance = pageText.match(/Mechanical\s+Compliance\s+Statement/i);
    if (compliance) {
      push({
        field_key: "comcheck_compliance_status",
        field_label: "HVAC compliance statement",
        raw_value: "present",
        normalized_value: "present",
        unit: null,
        entity_type: "compliance",
        entity_name: "Mechanical systems",
        fact_type: "compliance_evidence",
        category: "compliance_evidence",
        evidence_text: "Mechanical Compliance Statement present",
        confidence: 0.8,
      });
    }
  }

  return dedupeComcheckCandidates(out);
}

/**
 * @param {string} pageText
 * @param {number} pageNumber
 * @param {Function} push
 */
function extractComcheckProjectMetadata(pageText, pageNumber, push) {
  const reportTitle = pageText.match(/Report\s+Title:\s*([^:]+?)(?:\s+Report\s+Date:|$)/i);
  if (reportTitle) {
    push({
      field_key: "comcheck_project_title",
      field_label: "Project title",
      raw_value: reportTitle[1].trim(),
      normalized_value: reportTitle[1].trim(),
      unit: null,
      entity_type: "project_metadata",
      entity_name: null,
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: reportTitle[0],
      confidence: 0.92,
    });
  }

  const reportDate = pageText.match(
    /Report\s+Date:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}(?:,\s*[\d:]+\s*(?:AM|PM))?)/i,
  );
  if (reportDate) {
    push({
      field_key: "comcheck_report_date",
      field_label: "Report date",
      raw_value: reportDate[1].trim(),
      normalized_value: reportDate[1].trim(),
      unit: null,
      entity_type: "project_metadata",
      entity_name: null,
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: reportDate[0],
      confidence: 0.92,
    });
  }

  const energyCode = pageText.match(/\b(\d{4}\s+IECC)\b/i);
  if (energyCode) {
    push({
      field_key: "comcheck_energy_code",
      field_label: "Energy code",
      raw_value: energyCode[1],
      normalized_value: energyCode[1],
      unit: null,
      entity_type: "project_metadata",
      entity_name: null,
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: energyCode[0],
      confidence: 0.9,
    });
  }

  const climateZone = pageText.match(/\b([1-8][A-Ca-c])\s+Alteration\b/i);
  if (climateZone) {
    push({
      field_key: "comcheck_climate_zone",
      field_label: "Climate zone",
      raw_value: climateZone[1],
      normalized_value: climateZone[1],
      unit: null,
      entity_type: "project_metadata",
      entity_name: null,
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: climateZone[0],
      confidence: 0.8,
    });
  }

  const location = pageText.match(
    /\bIECC\s+(.+?)\s+([A-Za-z .'-]+,\s*[A-Za-z]+)\s+[1-8][A-Ca-c]\b/i,
  );
  if (location) {
    push({
      field_key: "comcheck_project_location",
      field_label: "Project location",
      raw_value: location[2].trim(),
      normalized_value: location[2].trim(),
      unit: null,
      entity_type: "project_metadata",
      entity_name: location[1].trim(),
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: `${location[1].trim()} — ${location[2].trim()}`,
      confidence: 0.75,
    });
  }

  const projectType = pageText.match(/\b(Alteration|New Construction|Addition)\b/i);
  if (projectType) {
    push({
      field_key: "comcheck_project_type",
      field_label: "Project type",
      raw_value: projectType[1],
      normalized_value: projectType[1],
      unit: null,
      entity_type: "project_metadata",
      entity_name: null,
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: `Project type: ${projectType[1]}`,
      confidence: 0.7,
    });
  }

  const floorArea = pageText.match(/Floor\s+Area[^0-9]*(\d+(?:\.\d+)?)/i);
  if (floorArea) {
    push({
      field_key: "comcheck_building_area",
      field_label: "Building area",
      raw_value: floorArea[1],
      normalized_value: Number(floorArea[1]),
      unit: "ft2",
      entity_type: "project_metadata",
      entity_name: "Building area",
      fact_type: "compliance_evidence",
      category: "compliance_evidence",
      evidence_text: floorArea[0],
      confidence: 0.78,
    });
  }
}

/**
 * @param {string} pageText
 * @param {number} pageNumber
 * @param {Function} push
 * @param {"interior"|"exterior"} scope
 */
function extractLightingFixtureRows(pageText, pageNumber, push, scope) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const fixtureRegex = /([A-Z]\d+):\s*([A-Z]\d+):\s*LED:\s*(\w+)/gi;
  let match;
  while ((match = fixtureRegex.exec(pageText)) !== null) {
    push({
      field_key: "lighting_fixture_row",
      field_label: "Lighting fixture",
      raw_value: match[1],
      normalized_value: null,
      unit: null,
      entity_type: "fixture",
      entity_name: match[1],
      fact_type: "electric_load",
      category: "load_category",
      evidence_text: match[0],
      confidence: 0.7,
      requires_human_review: true,
      fixture_scope: scope,
      fixture_control: match[3],
    });
  }
  return out;
}

/**
 * @param {string} pageText
 * @param {number} pageNumber
 * @param {Function} push
 */
function extractHvacEquipmentRows(pageText, pageNumber, push) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const blocks = pageText.split(/(?=\d+\s+DOAS-\d+)/i).filter((b) => /\bDOAS-\d+/i.test(b));

  for (const block of blocks) {
    const header = block.match(/(\d+)\s+(DOAS-\d+)\s*\(([^)]+)\)/i);
    if (!header) continue;
    const quantity = Number(header[1]);
    const equipmentId = header[2];
    const zoneType = header[3].trim();

    const heatingSection = block.match(/Heating:[\s\S]*?(?=Cooling:|$)/i);
    const coolingSection = block.match(/Cooling:[\s\S]*?(?=Mechanical|$)/i);

    if (heatingSection) {
      const heatMatch = heatingSection[0].match(/Capacity\s*=\s*(\d+(?:\.\d+)?)\s*kBtu\/h/i);
      const fuelMatch = heatingSection[0].match(/\b(Gas|Electric)\b/i);
      if (heatMatch) {
        push({
          field_key: "hvac_heating_capacity_kbtuh",
          field_label: "Heating capacity",
          raw_value: heatMatch[1],
          normalized_value: Number(heatMatch[1]),
          unit: "kBtu/h",
          entity_type: "hvac_equipment",
          entity_name: equipmentId,
          fact_type: fuelMatch && /gas/i.test(fuelMatch[1]) ? "gas_load" : "thermal_capacity",
          category: fuelMatch && /gas/i.test(fuelMatch[1]) ? "gas_load" : "thermal_capacity",
          evidence_text: block.slice(0, 280).replace(/\s+/g, " ").trim(),
          confidence: 0.88,
          requires_human_review: true,
          equipment_quantity: quantity,
          equipment_zone: zoneType,
          heating_fuel: fuelMatch ? fuelMatch[1] : null,
        });
      }
    }

    if (coolingSection) {
      const coolMatch = coolingSection[0].match(/Capacity\s*=\s*(\d+(?:\.\d+)?)\s*kBtu\/h/i);
      if (coolMatch) {
        push({
          field_key: "hvac_cooling_capacity_kbtuh",
          field_label: "Cooling thermal capacity",
          raw_value: coolMatch[1],
          normalized_value: Number(coolMatch[1]),
          unit: "kBtu/h",
          entity_type: "hvac_equipment",
          entity_name: equipmentId,
          fact_type: "thermal_capacity",
          category: "thermal_capacity",
          evidence_text: block.slice(0, 280).replace(/\s+/g, " ").trim(),
          confidence: 0.88,
          requires_human_review: true,
          equipment_quantity: quantity,
          equipment_zone: zoneType,
          review_blocked_reason: "Thermal capacity — not electric connected load",
        });
      }
    }

    push({
      field_key: "hvac_equipment_identifier",
      field_label: "HVAC equipment",
      raw_value: equipmentId,
      normalized_value: equipmentId,
      unit: null,
      entity_type: "hvac_equipment",
      entity_name: equipmentId,
      fact_type: "equipment_fact",
      category: "equipment_evidence",
      evidence_text: header[0],
      confidence: 0.9,
      equipment_quantity: quantity,
      equipment_zone: zoneType,
    });
  }

  return out;
}

/**
 * @param {Array<Record<string, unknown>>} candidates
 */
function dedupeComcheckCandidates(candidates) {
  const seen = new Set();
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const c of candidates) {
    const key = [c.field_key, c.entity_name, c.page_number, c.raw_value].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

module.exports = {
  detectComcheckReportText,
  detectComcheckReportSection,
  extractComcheckFindingsFromText,
  extractHvacEquipmentRows,
  extractComcheckProjectMetadata,
  dedupeComcheckCandidates,
};
