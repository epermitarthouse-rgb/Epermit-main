"use strict";

/**
 * Structured drawing evidence built from text already read (PDF text layer and OCR words).
 * It does not call a model and does not invent a property or a relationship.
 * A value stays unbound unless the element and the value were read on the same line.
 * Proximity on that line is a relationship inference; the text itself is directly read.
 */

const crypto = require("crypto");
const { ELEMENTS, reconcileCalculation } = require("../review/evaluation.js");

const SCHEMA_VERSION = "1.0";
const EXTRACTOR_VERSION = "drawing-structure-1";

const DIMENSION_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:"|″|''|in(?:ch(?:es)?)?|ft|feet|gpm|cfm|psi|gal)\b|\b(\d+)\s*['′]\s*-?\s*(\d+)?(?:\s*["″])?/gi;
const REFERENCE_RE = /\b(?:see|detail|section|refer(?:ence)?)\b[^.\n]{0,60}?([A-Z]{1,3}-\d{1,3}(?:\.\d{1,2})?)/gi;
const REQUIREMENT_RE = /\b(?:shall|provide[ds]?|must|required|typical|typ\.|legend|general notes?|minimum|min\.)\b/i;
const LOW_CONFIDENCE = 0.55;

function factKey(fingerprint, kind, parts) {
  return crypto.createHash("sha256").update([fingerprint, kind, ...parts].join("|")).digest("hex").slice(0, 16);
}

function roundBox(box) {
  if (!box || !Number.isFinite(Number(box.x))) return null;
  const rounded = {
    x: Math.round(Number(box.x) * 10) / 10,
    y: Math.round(Number(box.y) * 10) / 10,
    width: Math.round(Number(box.width) * 10) / 10,
    height: Math.round(Number(box.height) * 10) / 10,
    unit: box.unit || "pdf-point",
  };
  return rounded.width === 0 && rounded.height === 0 ? null : rounded;
}

function lineKey(item) {
  const box = item.bbox;
  if (!box || !Number.isFinite(Number(box.y))) return null;
  const height = Math.max(Number(box.height) || 0, 4);
  return Math.round(Number(box.y) / height);
}

function linesFrom(items) {
  const placed = new Map();
  const loose = [];
  for (const item of items) {
    const key = lineKey(item);
    if (key == null) {
      loose.push(item);
      continue;
    }
    if (!placed.has(key)) placed.set(key, []);
    placed.get(key).push(item);
  }
  const groups = [];
  for (const band of placed.values()) {
    band.sort((a, b) => (Number(a.bbox?.x) || 0) - (Number(b.bbox?.x) || 0));
    let current = [];
    for (const item of band) {
      const prev = current[current.length - 1];
      const prevRight = prev?.bbox ? Number(prev.bbox.x) + Number(prev.bbox.width || 0) : 0;
      const gap = prev ? Number(item.bbox?.x || 0) - prevRight : 0;
      if (prev && gap > 36) {
        groups.push(current);
        current = [];
      }
      current.push(item);
    }
    if (current.length) groups.push(current);
  }
  for (const item of loose) groups.push([item]);
  return groups.map((group) => {
    const text = group.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
    const confidence = group.reduce((min, item) => (item.confidence == null ? min : Math.min(min, Number(item.confidence))), 1);
    return {
      text,
      items: group,
      confidence: group.some((item) => item.confidence != null) ? confidence : null,
      methods: [...new Set(group.map((item) => item.method).filter(Boolean))],
      bbox: roundBox(group.find((item) => item.bbox)?.bbox),
    };
  }).filter((line) => line.text);
}

function collectItems(input) {
  const items = [];
  for (const item of input.evidenceItems || input.items || []) {
    const text = String(item.str || item.text || "").trim();
    if (!text || item.readable === false) continue;
    items.push({
      text,
      bbox: item.region || item.bbox || item.box || null,
      method: item.extractionMethod || item.method || "pdfjs-text-layer",
      confidence: item.confidence ?? null,
    });
  }
  for (const word of input.words || []) {
    const text = String(word.text || "").trim();
    if (text.length < 2) continue;
    items.push({
      text,
      bbox: word.box || null,
      method: "ocr",
      confidence: word.confidence ?? null,
      rotated: Boolean(word.rotated),
    });
  }
  return items;
}

function elementTypes(text) {
  const found = [];
  for (const element of ELEMENTS) {
    const re = element.mention || element.claim;
    if (re.test(text) && !found.includes(element.id)) found.push(element.id);
  }
  return found;
}

function parseDimensions(text) {
  const found = [];
  const source = String(text || "");
  for (const match of source.matchAll(DIMENSION_RE)) {
    const original = match[0].trim();
    let value = null;
    let unit = null;
    if (match[2] != null) {
      value = Number(match[2]) * 12 + Number(match[3] || 0);
      unit = "in";
    } else if (/gpm/i.test(original)) {
      value = Number(match[1]);
      unit = "gpm";
    } else if (/cfm/i.test(original)) {
      value = Number(match[1]);
      unit = "cfm";
    } else if (/psi/i.test(original)) {
      value = Number(match[1]);
      unit = "psi";
    } else if (/gal/i.test(original)) {
      value = Number(match[1]);
      unit = "gal";
    } else if (/ft|feet/i.test(original)) {
      value = Number(match[1]) * 12;
      unit = "in";
    } else {
      value = Number(match[1]);
      unit = "in";
    }
    if (!Number.isFinite(value)) continue;
    found.push({ original, value, unit });
  }
  return found;
}

function workStatus(text) {
  if (/\bdemoli(?:shed|tion)\b/i.test(text)) return "demolished";
  if (/\bexisting\b/i.test(text)) return "existing";
  if (/\b(?:proposed|new)\b/i.test(text)) return "proposed";
  return null;
}

function sheetNumberOf(input) {
  const label = String(input.sheetNumber || input.sheet?.sheet_label || "").trim();
  if (label) return label;
  const name = String(input.fileName || input.sheet?.file_name || "");
  const token = name.match(/[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,2})?/i);
  return token ? token[0] : null;
}

function extractionStatus(input, unreadableCount, factCount) {
  const graphic = String(input.graphicalReadStatus || "");
  if (!factCount && (graphic === "ocr_unavailable" || graphic === "no_page" || graphic === "unreadable")) return "failed";
  if (!factCount) return "failed";
  if (unreadableCount > 0 || graphic === "unreadable" || graphic === "text-layer") return "partial";
  return "completed";
}

/**
 * @param {Record<string, unknown>} input page text, evidence items, OCR words, sheet identity
 */
function buildDrawingDocument(input) {
  const fingerprint = String(input.sourceFingerprint || "unhashed");
  const page = Number(input.pageNumber || input.sheet?.page_number) || 1;
  const sheetNumber = sheetNumberOf(input);
  const items = collectItems(input);
  const lines = linesFrom(items);
  const methods = [...new Set(items.map((item) => item.method))];
  if (input.pageText && !methods.includes("pdfjs-text-layer")) methods.push("pdfjs-text-layer");

  const elements = new Map();
  const dimensions = [];
  const notes = [];
  const schedules = [];
  const references = [];
  const seen = new Set();

  const remember = (kind, text, bbox) => {
    const key = `${kind}|${text.toLowerCase()}|${bbox ? `${bbox.x},${bbox.y}` : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const line of lines) {
    const types = elementTypes(line.text);
    const requirement = REQUIREMENT_RE.test(line.text);
    const low = line.confidence != null && line.confidence < LOW_CONFIDENCE;
    const work = workStatus(line.text);
    for (const type of types) {
      const id = factKey(fingerprint, "element", [type, "sheet"]);
      if (!elements.has(type)) {
        elements.set(type, {
          id,
          type,
          tag: null,
          location: { page, bbox: line.bbox },
          properties: {},
          related_element_ids: [],
          related_sheet_refs: [],
          evidence_ids: [],
          work_status: work,
          inferred: false,
        });
      } else if (work && !elements.get(type).work_status) {
        elements.get(type).work_status = work;
      }
    }

    if (/\bSCHEDULE\b/i.test(line.text) && schedules.length < 20 && remember("schedule", line.text, line.bbox)) {
      schedules.push({
        id: factKey(fingerprint, "schedule", [line.text.slice(0, 80)]),
        text: line.text.slice(0, 400),
        original_text: line.text.slice(0, 400),
        page,
        bbox: line.bbox,
        confidence: line.confidence,
        low_confidence: low,
        inferred: false,
        binding_status: "read",
        limitation: "Schedule heading was read. Cells on other lines are separate facts and are not assumed to belong to this schedule.",
      });
    }

    if ((requirement || /\bNOTE\b/i.test(line.text)) && notes.length < 30 && remember("note", line.text, line.bbox)) {
      notes.push({
        id: factKey(fingerprint, "note", [line.text.slice(0, 80)]),
        text: line.text.slice(0, 400),
        original_text: line.text.slice(0, 400),
        page,
        bbox: line.bbox,
        confidence: line.confidence,
        low_confidence: low,
        inferred: false,
        binding_status: requirement ? "requirement_note" : "read",
        element_types: types,
      });
    }

    for (const match of line.text.matchAll(REFERENCE_RE)) {
      const ref = match[1].toUpperCase();
      if (references.length >= 30 || !remember("reference", ref, null)) continue;
      references.push({
        id: factKey(fingerprint, "reference", [ref, line.text.slice(0, 40)]),
        sheet_number: ref,
        text: line.text.slice(0, 240),
        original_text: match[0].slice(0, 240),
        page,
        bbox: line.bbox,
        inferred: false,
        binding_status: "read",
      });
      for (const type of types) {
        const element = elements.get(type);
        if (element && !element.related_sheet_refs.includes(ref)) element.related_sheet_refs.push(ref);
      }
    }

    for (const dim of parseDimensions(line.text)) {
      if (dimensions.length >= 100 || !remember("dimension", dim.original, line.bbox)) continue;
      const boundType = types.length === 1 ? types[0] : null;
      const status = requirement ? "requirement_note" : boundType ? "bound" : "unbound";
      const id = factKey(fingerprint, "dimension", [dim.original, String(line.bbox?.x ?? ""), String(line.bbox?.y ?? ""), status]);
      const element = boundType ? elements.get(boundType) : null;
      dimensions.push({
        id,
        original_text: dim.original,
        value_text: dim.original,
        value_numeric: dim.value,
        unit: dim.unit,
        binding_status: status,
        related_element_ids: element ? [element.id] : [],
        element_type: boundType,
        page,
        bbox: line.bbox,
        confidence: line.confidence,
        low_confidence: low,
        inferred: Boolean(boundType),
        relationship: boundType ? "same_line" : null,
      });
      if (element && status === "bound") {
        const property = /\b(?:width|clear)\b/i.test(line.text)
          ? "width"
          : /\bheight\b/i.test(line.text)
            ? "height"
            : /\b(?:hour|hr|fire)\b/i.test(line.text)
              ? "fire_rating"
              : "value";
        if (!element.properties[property]) {
          element.properties[property] = {
            value: dim.value,
            unit: dim.unit,
            original: dim.original,
            status: "read",
            confidence: line.confidence,
            evidence_ids: [id],
            inferred: true,
          };
        }
        element.evidence_ids.push(id);
      }
    }
  }

  const calculations = [];
  const text = String(input.pageText || lines.map((line) => line.text).join("\n"));
  const reconciled = reconcileCalculation({ title: text.slice(0, 4000), description: "" }, text);
  if (reconciled?.method) {
    calculations.push({
      id: factKey(fingerprint, "calculation", [reconciled.method.statement.slice(0, 80)]),
      method: reconciled.method.rule,
      statement: reconciled.method.statement,
      operands: reconciled.method.operands,
      governing: reconciled.governing,
      explained: reconciled.explained,
      original_text: reconciled.method.statement,
      inferred: false,
      binding_status: "read",
      limitation: "Operands of a stated method are not conflicting measurements.",
    });
  }

  const unreadable = (input.regions || input.unreadableRegions || [])
    .filter((region) => region && region.readable === false)
    .slice(0, 15)
    .map((region) => ({
      bbox: roundBox(region),
      limitation: region.limitations || "region_unreadable",
      page,
    }));

  const elementList = [...elements.values()].slice(0, 60);
  const factCount = elementList.length + dimensions.length + notes.length + schedules.length + calculations.length + references.length;
  const status = extractionStatus(input, unreadable.length, factCount);
  const contradictory = flagContradictions(elementList, dimensions, calculations);

  return {
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    file_id: input.documentId || input.sheet?.source_document_id || null,
    sheet_id: input.sheetId || input.sheet?.id || null,
    sheet_number: sheetNumber,
    file_name: input.fileName || input.sheet?.file_name || null,
    discipline: input.discipline || input.sheet?.discipline || null,
    revision: input.revision || input.sheet?.revision || null,
    page,
    source_fingerprint: fingerprint,
    extraction: {
      status,
      methods,
      coverage: {
        text_items: items.length,
        classified_facts: factCount,
        graphical_status: input.graphicalReadStatus || null,
        unreadable_regions: unreadable.length,
      },
      unreadable_regions: unreadable,
      limitations: [
        ...(status === "partial" ? ["Part of this sheet was not read. Unread regions are not evidence that a fact is absent."] : []),
        ...(status === "failed" ? ["Extraction failed. This sheet is not a complete structured record."] : []),
        ...(contradictory ? ["Two different values were read for the same element property and are not operands of one stated calculation."] : []),
      ],
    },
    elements: elementList,
    dimensions,
    notes,
    schedules,
    calculations,
    drawing_references: references,
  };
}

function flagContradictions(elements, dimensions, calculations) {
  const explained = new Set();
  for (const calculation of calculations) {
    for (const operand of calculation.operands || []) explained.add(Number(operand.value));
    if (calculation.governing) explained.add(Number(calculation.governing.value));
  }
  let found = false;
  for (const element of elements) {
    const bound = dimensions.filter((dim) => dim.binding_status === "bound" && dim.related_element_ids.includes(element.id));
    const byUnit = new Map();
    for (const dim of bound) {
      if (explained.has(dim.value_numeric)) continue;
      const list = byUnit.get(dim.unit) || [];
      list.push(dim.value_numeric);
      byUnit.set(dim.unit, list);
    }
    for (const values of byUnit.values()) {
      if (new Set(values).size > 1) {
        found = true;
        for (const dim of bound) {
          if (values.includes(dim.value_numeric)) dim.binding_status = "contradictory";
        }
      }
    }
  }
  return found;
}

function validateDrawingDocument(doc) {
  const errors = [];
  if (!doc || doc.schema_version !== SCHEMA_VERSION) errors.push("schema_version");
  if (!Array.isArray(doc.elements) || !Array.isArray(doc.dimensions)) errors.push("collections");
  if (!doc.extraction || !["queued", "extracting", "partial", "completed", "failed"].includes(doc.extraction.status)) {
    errors.push("status");
  }
  for (const dim of doc.dimensions || []) {
    if (dim.binding_status === "bound" && !(dim.related_element_ids || []).length) errors.push(`unbound_marked_bound:${dim.id}`);
    if (dim.value_numeric != null && typeof dim.value_numeric !== "number") errors.push(`value_type:${dim.id}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Compact document sent to a reviewer. Full facts stay in the database. */
function reviewDocument(doc) {
  if (!doc) return null;
  return {
    schema_version: doc.schema_version,
    extractor_version: doc.extractor_version,
    sheet_number: doc.sheet_number,
    file_name: doc.file_name,
    source_fingerprint: doc.source_fingerprint,
    extraction: {
      status: doc.extraction?.status || "failed",
      methods: doc.extraction?.methods || [],
      coverage: doc.extraction?.coverage || {},
      unreadable_count: doc.extraction?.unreadable_regions?.length || 0,
      limitations: doc.extraction?.limitations || [],
    },
    elements: (doc.elements || []).slice(0, 40).map((element) => ({
      id: element.id,
      type: element.type,
      tag: element.tag,
      properties: element.properties,
      related_sheet_refs: element.related_sheet_refs,
      work_status: element.work_status || null,
    })),
    dimensions: (doc.dimensions || []).slice(0, 80).map((dim) => ({
      id: dim.id,
      original_text: dim.original_text,
      value_numeric: dim.value_numeric,
      unit: dim.unit,
      binding_status: dim.binding_status,
      related_element_ids: dim.related_element_ids,
      element_type: dim.element_type,
      low_confidence: dim.low_confidence,
      inferred: dim.inferred,
    })),
    notes: (doc.notes || []).slice(0, 12).map((note) => ({
      id: note.id,
      text: String(note.text || "").slice(0, 240),
      binding_status: note.binding_status,
    })),
    schedules: (doc.schedules || []).slice(0, 8).map((item) => ({ id: item.id, text: String(item.text || "").slice(0, 160) })),
    calculations: doc.calculations || [],
    drawing_references: (doc.drawing_references || []).slice(0, 20),
    cross_sheet: (doc.cross_sheet || []).slice(0, 15),
  };
}

/**
 * When structured facts separated a measurement from the claimed element, the page-text
 * gate must not publish it. Missing facts are not treated as missing drawing content.
 */
function gateMeasuredFact(doc, claim, numbers) {
  if (!doc || !claim?.element || doc.extraction?.status === "failed") return null;
  const elements = (doc.elements || []).filter((element) => element.type === claim.element.id);
  if (!elements.length || !(doc.dimensions || []).length || !(numbers || []).length) return null;
  const elementIds = new Set(elements.map((element) => element.id));
  const mentions = (value) => numbers.some((number) => new RegExp(`(?<![\\d.])${String(number).replace(".", "\\.")}(?![\\d.])`).test(String(value || "")));
  const relevant = (doc.dimensions || []).filter((dim) => mentions(dim.original_text) || mentions(dim.value_text));
  if (!relevant.length) return null;
  const bound = relevant.filter((dim) => dim.binding_status === "bound" && (dim.related_element_ids || []).some((id) => elementIds.has(id)));
  if (bound.length) return null;
  if (relevant.every((dim) => dim.binding_status === "requirement_note")) {
    return {
      reason: "requirement_note_not_measurement",
      detail: `Structured extraction read ${numbers.join(" and ")} only in a requirement note, not as a measurement of the ${claim.element.label}. The check stays unresolved.`,
    };
  }
  return {
    reason: "value_not_bound_to_element",
    detail: `Structured extraction read ${numbers.join(" and ")} but did not tie ${relevant.length === 1 ? "it" : "them"} to the ${claim.element.label}. A value of another element, or a value with no element, does not establish it. The check stays unresolved.`,
  };
}

function summarizeForReview(doc) {
  const view = reviewDocument(doc);
  if (!view) return "";
  return [
    "STRUCTURED DRAWING FACTS (directly read; relationships marked inferred are same-line only; unbound values belong to no element):",
    JSON.stringify(view).slice(0, 3500),
  ].join("\n");
}

module.exports = {
  SCHEMA_VERSION,
  EXTRACTOR_VERSION,
  buildDrawingDocument,
  validateDrawingDocument,
  reviewDocument,
  gateMeasuredFact,
  summarizeForReview,
};
