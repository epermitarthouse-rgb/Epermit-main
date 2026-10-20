"use strict";

/**
 * Element-level structured evidence layered over drawingStructure v1.
 * Text boxes are anchors, never represented as physical element boundaries.
 * Associations are observed, inferred, or candidate; only an independent
 * verifier may promote a relationship to verified.
 */

const crypto = require("crypto");
const base = require("./drawingStructure.js");
const { ELEMENTS, reconcileCalculation } = require("../review/evaluation.js");

const SCHEMA_VERSION = "1.1";
const EXTRACTOR_VERSION = "drawing-structure-2";
const LOW_CONFIDENCE = 0.55;
const REQUIREMENT_RE =
  /\b(?:shall|must|required|provide[ds]?|minimum|min\.?|maximum|max\.?|typical|typ\.|general notes?|code requires?)\b/i;
const SCHEDULE_RE = /\b(?:door|window|partition|wall|finish|room|equipment|fixture|panel|beam|column|footing|foundation|damper|valve|sprinkler)?\s*schedule\b/i;
const REFERENCE_RE =
  /\b(?:see|refer(?:ence)?\s+to|detail|section|elevation)\b[^.\n]{0,70}?([A-Z]{1,3}-\d{1,3}(?:\.\d{1,2})?)(?:\s*[/.-]\s*(\d{1,3}))?/gi;
const DIMENSION_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:"|″|''|in(?:ch(?:es)?)?|ft|feet|gpm|cfm|psi|gal|amps?|a|kw|kva|volts?|v)\b|\b(\d+)\s*['′]\s*-?\s*(\d+)?(?:\s*["″])?/gi;

const INSTANCE_TYPES = [
  ...ELEMENTS.filter((element) => new Set([
    "grease_interceptor", "mixing_valve", "floor_drain", "cleanout", "backflow",
    "fire_damper", "exhaust_hood", "rooftop_equipment", "duct", "piping",
    "emergency_lighting", "exit_sign", "gfci", "sprinkler", "fdc", "guard",
    "handrail", "stair", "seating", "toilet_clearance", "accessory", "counter",
    "fire_rated_assembly", "egress_path", "glazing", "door", "accessible_route",
  ]).has(element.id)).map((element) => ({
    id: element.id,
    re: element.mention || element.claim,
    discipline: element.owners?.[0] || null,
  })),
  { id: "window", re: /\bwindows?\b/i, discipline: "A" },
  { id: "wall", re: /\b(?:walls?|partitions?)\b/i, discipline: "A" },
  { id: "room", re: /\brooms?\b|\b(?:office|kitchen|toilet|storage|lobby|vestibule)\s+\d*[A-Z]?\b/i, discipline: "A" },
  { id: "corridor", re: /\bcorridors?\b/i, discipline: "A" },
  { id: "exit", re: /\bexits?\b/i, discipline: "A" },
  { id: "ramp", re: /\bramps?\b/i, discipline: "A" },
  { id: "beam", re: /\bbeams?\b|\bW\d{1,2}X\d{1,3}\b/i, discipline: "S" },
  { id: "column", re: /\bcolumns?\b|\bCOL\.?\s*[A-Z0-9-]+\b/i, discipline: "S" },
  { id: "foundation", re: /\bfootings?\b|\bfoundations?\b|\bgrade beams?\b/i, discipline: "S" },
  { id: "mechanical_equipment", re: /\b(?:RTU|AHU|FCU|VAV|EF|MAU|CUH)[- ]?\d+[A-Z]?\b|\bmechanical equipment\b/i, discipline: "M" },
  { id: "valve", re: /\bvalves?\b|\b(?:TMV|PRV|RPZ)[- ]?\d*[A-Z]?\b/i, discipline: "P" },
  { id: "plumbing_fixture", re: /\b(?:WC|LAV|FD|FS|SH|UR)[- ]?\d+[A-Z]?\b|\bplumbing fixtures?\b/i, discipline: "P" },
  { id: "electrical_panel", re: /\b(?:panel|panelboard)\s*[A-Z0-9-]+\b|\b(?:MDP|LP|PP|DP)[- ]?\d+[A-Z]?\b/i, discipline: "E" },
  { id: "circuit", re: /\bcircuits?\b|\bCKT\.?\s*\d+\b/i, discipline: "E" },
  { id: "fire_alarm_device", re: /\b(?:FACP|NAC|strobe|horn|smoke detector|pull station)s?\b/i, discipline: "FP" },
];

const TAG_PATTERNS = {
  door: [/\b(?:DOOR|DR\.?)\s*(?:NO\.?|#|TAG)?\s*([A-Z]?\d{2,4}[A-Z]?)\b/i],
  window: [/\b(?:WINDOW|WIN\.?)\s*(?:NO\.?|#|TAG|TYPE)?\s*([A-Z]?\d{1,4}[A-Z]?)\b/i],
  wall: [/\b(?:WALL|PARTITION)\s*(?:TYPE|TAG)?\s*([A-Z]\d{1,3}[A-Z]?|\d{1,2}[A-Z])\b/i],
  fire_rated_assembly: [/\b(?:WALL|PARTITION)\s*(?:TYPE|TAG)?\s*([A-Z]\d{1,3}[A-Z]?|\d{1,2}[A-Z])\b/i],
  room: [/\b(?:ROOM|RM\.?)\s*(?:NO\.?|#)?\s*(\d{2,4}[A-Z]?)\b/i],
  mechanical_equipment: [/\b((?:RTU|AHU|FCU|VAV|EF|MAU|CUH)[- ]?\d+[A-Z]?)\b/i],
  rooftop_equipment: [/\b((?:RTU|AHU|FCU|VAV|EF|MAU|CUH)[- ]?\d+[A-Z]?)\b/i],
  fire_damper: [/\b((?:FSD|FD|SD)[- ]?\d+[A-Z]?)\b/i],
  grease_interceptor: [/\b((?:GI|GINT)[- ]?\d+[A-Z]?)\b/i],
  plumbing_fixture: [/\b((?:WC|LAV|FD|FS|SH|UR)[- ]?\d+[A-Z]?)\b/i],
  electrical_panel: [/\b((?:MDP|LP|PP|DP)[- ]?\d+[A-Z]?)\b/i, /\bPANEL(?:BOARD)?\s+([A-Z0-9-]+)\b/i],
  circuit: [/\b(?:CKT\.?|CIRCUIT)\s*([A-Z0-9-]+)\b/i],
  beam: [/\b(W\d{1,2}X\d{1,3})\b/i, /\bBEAM\s+([A-Z0-9-]+)\b/i],
  column: [/\bCOL(?:UMN)?\.?\s*([A-Z0-9-]+)\b/i],
  foundation: [/\b(?:FOOTING|FOUNDATION|GRADE BEAM)\s+([A-Z0-9-]+)\b/i],
};

function stableId(fingerprint, kind, parts) {
  return crypto
    .createHash("sha256")
    .update([fingerprint, kind, ...parts].join("|"))
    .digest("hex")
    .slice(0, 20);
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function boxOf(value) {
  const box = value?.bbox || value?.region || value?.box || value || null;
  if (!box || !finite(box.x) || !finite(box.y)) return null;
  const pageWidth = finite(box.pageWidth) ? Number(box.pageWidth) : null;
  const pageHeight = finite(box.pageHeight) ? Number(box.pageHeight) : null;
  const result = {
    x: Math.round(Number(box.x) * 10) / 10,
    y: Math.round(Number(box.y) * 10) / 10,
    width: Math.round(Number(box.width || 0) * 10) / 10,
    height: Math.round(Number(box.height || 0) * 10) / 10,
    unit: box.unit || "pdf-point",
    origin: box.origin || "bottom-left",
  };
  if (box.normalized) result.normalized = box.normalized;
  else if (pageWidth && pageHeight) {
    result.normalized = {
      x: result.x / pageWidth,
      y: 1 - (result.y + result.height) / pageHeight,
      width: result.width / pageWidth,
      height: result.height / pageHeight,
      origin: "top-left",
    };
  }
  return result;
}

function center(box) {
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function unionBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((box) => box.x));
  const minY = Math.min(...valid.map((box) => box.y));
  const maxX = Math.max(...valid.map((box) => box.x + box.width));
  const maxY = Math.max(...valid.map((box) => box.y + box.height));
  return {
    x: Math.round(minX * 10) / 10,
    y: Math.round(minY * 10) / 10,
    width: Math.round((maxX - minX) * 10) / 10,
    height: Math.round((maxY - minY) * 10) / 10,
    unit: valid[0].unit || "pdf-point",
    origin: valid[0].origin || "bottom-left",
  };
}

function collectItems(input) {
  const seen = new Set();
  const result = [];
  const add = (text, value, method, confidence, rotated) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const bbox = boxOf(value);
    if (!clean) return;
    const key = `${clean.toLowerCase()}|${bbox?.x ?? ""}|${bbox?.y ?? ""}|${method || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      text: clean,
      bbox,
      method: method || "unknown",
      confidence: confidence == null ? null : Number(confidence),
      rotated: Boolean(rotated),
    });
  };
  for (const item of input.evidenceItems || input.items || []) {
    if (item?.readable === false) continue;
    add(
      item?.str || item?.text,
      item?.region || item?.bbox || item?.box,
      item?.extractionMethod || item?.method || "pdfjs-text-layer",
      item?.confidence,
      false,
    );
  }
  for (const word of input.words || []) {
    add(word?.text, word?.box || word?.bbox, "ocr", word?.confidence, word?.rotated);
  }
  return result;
}

function spatialRows(items) {
  const placed = items.filter((item) => item.bbox);
  const loose = items.filter((item) => !item.bbox);
  const rows = [];
  for (const item of placed.sort((a, b) => b.bbox.y - a.bbox.y || a.bbox.x - b.bbox.x)) {
    const tolerance = Math.max(3, item.bbox.height * 0.7);
    let row = rows.find((candidate) => Math.abs(candidate.y - item.bbox.y) <= tolerance);
    if (!row) {
      row = { y: item.bbox.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.y = row.items.reduce((sum, entry) => sum + entry.bbox.y, 0) / row.items.length;
  }
  for (const item of loose) rows.push({ y: null, items: [item] });
  return rows.map((row, index) => {
    row.items.sort((a, b) => (a.bbox?.x || 0) - (b.bbox?.x || 0));
    return {
      id: `row-${index}`,
      y: row.y,
      items: row.items,
      text: row.items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
      bbox: unionBoxes(row.items.map((item) => item.bbox)),
      confidence: row.items.some((item) => item.confidence != null)
        ? Math.min(...row.items.filter((item) => item.confidence != null).map((item) => item.confidence))
        : null,
      methods: [...new Set(row.items.map((item) => item.method))],
    };
  });
}

function segmentedRows(rows) {
  const segments = [];
  for (const row of rows) {
    let current = [];
    const flush = () => {
      if (!current.length) return;
      const bbox = unionBoxes(current.map((item) => item.bbox));
      segments.push({
        id: `${row.id}:segment:${segments.length}`,
        y: row.y,
        items: current,
        text: current.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
        bbox,
        confidence: current.some((item) => item.confidence != null)
          ? Math.min(...current.filter((item) => item.confidence != null).map((item) => item.confidence))
          : null,
        methods: [...new Set(current.map((item) => item.method))],
      });
      current = [];
    };
    for (const item of row.items) {
      const prior = current[current.length - 1];
      const right = prior?.bbox ? prior.bbox.x + prior.bbox.width : 0;
      const gap = prior?.bbox && item.bbox ? item.bbox.x - right : 0;
      if (prior && gap > Math.max(30, (prior.bbox?.height || 6) * 4)) flush();
      current.push(item);
    }
    flush();
  }
  return segments.filter((row) => row.text);
}

function elementTypes(text) {
  const found = [];
  for (const definition of INSTANCE_TYPES) {
    definition.re.lastIndex = 0;
    if (definition.re.test(text) && !found.some((item) => item.id === definition.id)) found.push(definition);
  }
  return found;
}

function tagFor(type, text) {
  for (const pattern of TAG_PATTERNS[type] || []) {
    const match = String(text || "").match(pattern);
    if (!match?.[1]) continue;
    const tag = match[1].toUpperCase().replace(/\s+/g, "-");
    // Free words such as "PANEL FOR COOLING" or "COLD" are not tags.
    if (!/\d/.test(tag) && !/^(?:MDP|LP|PP|DP)$/.test(tag)) continue;
    return tag;
  }
  return null;
}

function distinctiveInstance(row, type, tag) {
  if (tag) return true;
  if (!row.bbox || row.text.length > 140 || row.bbox.width > 360) return false;
  if (SCHEDULE_RE.test(row.text) || REQUIREMENT_RE.test(row.text)) return false;
  const explicit = {
    room: /\b(?:ROOM|RM\.)\s*\d|\b(?:OFFICE|KITCHEN|TOILET|STORAGE|LOBBY|VESTIBULE)\s+\d/i,
    corridor: /\bCORRIDOR\s+\d/i,
    exit: /\bEXIT\s+\d/i,
    door: /\b(?:DOOR|DR\.)\s*[A-Z]?\d/i,
    window: /\b(?:WINDOW|WIN\.)\s*[A-Z]?\d/i,
    wall: /\b(?:WALL|PARTITION)\s+TYPE\s*[A-Z0-9]/i,
    fire_rated_assembly: /(?:\b(?:FIRE|RATED|\d+\s*(?:HR|HOUR))\b[^.;]{0,50}\b(?:WALL|PARTITION)\b)|(?:\b(?:WALL|PARTITION)\b[^.;]{0,50}\b(?:FIRE|RATED|\d+\s*(?:HR|HOUR))\b)/i,
    beam: /\b(?:BEAM\s+[A-Z0-9]|W\d+X\d+)\b/i,
    column: /\b(?:COLUMN|COL\.)\s*[A-Z0-9]/i,
    foundation: /\b(?:FOOTING|FOUNDATION|GRADE BEAM)\s+[A-Z0-9]/i,
  };
  if (explicit[type]?.test(row.text)) return true;
  return new Set([
    "grease_interceptor", "mixing_valve", "floor_drain", "cleanout", "backflow",
    "fire_damper", "exhaust_hood", "rooftop_equipment", "emergency_lighting",
    "exit_sign", "gfci", "sprinkler", "fdc", "guard", "handrail", "stair",
    "seating", "toilet_clearance", "counter", "glazing", "accessible_route",
  ]).has(type);
}

function observationStatus(row, tag) {
  if (tag) return "identified";
  if (row.bbox && row.text.length <= 160) return "located_ambiguous";
  return "ambiguous";
}

function evidenceRecord(fingerprint, page, row, sourceType = "text") {
  return {
    id: stableId(fingerprint, "evidence", [
      page,
      row.text.slice(0, 100),
      row.bbox?.x ?? "",
      row.bbox?.y ?? "",
    ]),
    page,
    original_content: row.text.slice(0, 1000),
    bbox: row.bbox,
    source_type: sourceType,
    extraction_methods: row.methods,
    confidence: row.confidence,
    status: row.confidence != null && row.confidence < LOW_CONFIDENCE ? "low_confidence" : "observed",
    directly_observed: true,
  };
}

function makeElements(input, rows, evidence, fingerprint, page) {
  const byIdentity = new Map();
  const evidenceByRow = new Map();
  for (const row of rows) {
    if (REQUIREMENT_RE.test(row.text)) continue;
    const types = elementTypes(row.text);
    if (!types.length) continue;
    const rowEvidence = evidenceRecord(fingerprint, page, row);
    evidence.push(rowEvidence);
    evidenceByRow.set(row.id, rowEvidence.id);
    for (const definition of types) {
      const tag = tagFor(definition.id, row.text);
      if (!distinctiveInstance(row, definition.id, tag)) continue;
      const anchor = row.bbox;
      // A tag is a durable identity. Without one, the source region distinguishes
      // recoverable instances; an unlocated generic mention is kept ambiguous once.
      const locationKey = anchor
        ? `${Math.round(anchor.x / 8)}:${Math.round(anchor.y / 8)}`
        : row.text.slice(0, 80).toLowerCase();
      const identity = tag ? `${definition.id}:tag:${tag}` : `${definition.id}:region:${locationKey}`;
      let element = byIdentity.get(identity);
      if (!element) {
        const id = stableId(fingerprint, "element", [page, definition.id, tag || locationKey]);
        element = {
          id,
          type: definition.id,
          discipline: input.discipline || input.sheet?.discipline || definition.discipline,
          tag,
          sheet_number: input.sheetNumber || input.sheet?.sheet_label || null,
          page,
          location: {
            page,
            text_anchor_bbox: anchor,
            physical_boundary: null,
            geometry_status: anchor ? "text_anchor_only" : "not_recovered",
            limitation: "The text anchor locates the label, not the physical boundary of the construction element.",
          },
          properties: {},
          associated_note_ids: [],
          associated_schedule_ids: [],
          related_sheet_refs: [],
          evidence_ids: [rowEvidence.id],
          confidence: row.confidence,
          extraction_status: observationStatus(row, tag),
          observation_status: "observed",
          work_status: /\bdemoli(?:shed|tion)\b/i.test(row.text)
            ? "demolished"
            : /\bexisting\b/i.test(row.text)
              ? "existing"
              : /\b(?:new|proposed)\b/i.test(row.text)
                ? "proposed"
                : null,
          ambiguity: tag ? null : "No unique drawing tag was read; identity is scoped to this observed region.",
        };
        byIdentity.set(identity, element);
      } else if (!element.evidence_ids.includes(rowEvidence.id)) {
        element.evidence_ids.push(rowEvidence.id);
      }
    }
  }
  return { elements: [...byIdentity.values()].slice(0, 200), evidenceByRow };
}

function parseValues(text) {
  const values = [];
  for (const match of String(text || "").matchAll(DIMENSION_RE)) {
    const original = match[0].trim();
    let value = null;
    let unit = null;
    if (match[2] != null) {
      value = Number(match[2]) * 12 + Number(match[3] || 0);
      unit = "in";
    } else {
      value = Number(match[1]);
      if (/gpm/i.test(original)) unit = "gpm";
      else if (/cfm/i.test(original)) unit = "cfm";
      else if (/psi/i.test(original)) unit = "psi";
      else if (/gal/i.test(original)) unit = "gal";
      else if (/kva/i.test(original)) unit = "kva";
      else if (/kw/i.test(original)) unit = "kw";
      else if (/amps?|\bA\b/i.test(original)) unit = "A";
      else if (/volts?|\bV\b/i.test(original)) unit = "V";
      else if (/ft|feet/i.test(original)) {
        value *= 12;
        unit = "in";
      } else unit = "in";
    }
    if (Number.isFinite(value)) values.push({ original, value, unit });
  }
  return values;
}

function propertyKind(text, unit) {
  if (unit === "gpm" || unit === "cfm") return /\b(?:capacity|rated)\b/i.test(text) ? "capacity" : "flow";
  if (unit === "A" || unit === "V" || unit === "kw" || unit === "kva") return "electrical_rating";
  if (/\bclear(?:ance)?|maneuvering|width\b/i.test(text)) return "clear_width";
  if (/\bheight|a\.?\s*f\.?\s*f\.?\b/i.test(text)) return "height";
  if (/\b(?:hour|hr|fire rated|rating)\b/i.test(text)) return "fire_rating";
  if (/\bspacing|o\.?\s*c\.?\b/i.test(text)) return "spacing";
  return "dimension";
}

function distanceBetween(a, b) {
  const left = center(a);
  const right = center(b);
  if (!left || !right) return Infinity;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function dimensionRole(row, value, calculations) {
  if (REQUIREMENT_RE.test(row.text)) return "requirement";
  if (calculations.some((calc) =>
    (calc.operands || []).some((operand) => Number(operand.value) === value.value) ||
    Number(calc.governing?.value) === value.value)) return "calculation_operand";
  if (["gpm", "cfm", "A", "V", "kw", "kva", "psi", "gal"].includes(value.unit)) return "technical_value";
  return "measured_dimension";
}

function makeDimensions(input, rows, elements, evidence, fingerprint, page, calculations) {
  const dimensions = [];
  for (const row of rows) {
    const values = parseValues(row.text);
    if (!values.length) continue;
    const rowEvidence = evidenceRecord(fingerprint, page, row, "measurement_text");
    if (!evidence.some((item) => item.id === rowEvidence.id)) evidence.push(rowEvidence);
    const rowTypes = elementTypes(row.text).map((item) => item.id);
    const sameRow = elements.filter((element) =>
      rowTypes.includes(element.type) &&
      element.evidence_ids.includes(rowEvidence.id));
    for (const value of values) {
      const role = dimensionRole(row, value, calculations);
      let bindingStatus = role === "requirement"
        ? "requirement_note"
        : role === "calculation_operand"
          ? "calculation_operand"
          : "unbound";
      let associationStatus = "none";
      let related = [];
      let basis = null;
      if (role !== "requirement" && role !== "calculation_operand" && sameRow.length === 1) {
        related = [sameRow[0].id];
        bindingStatus = "bound";
        associationStatus = "inferred";
        basis = {
          method: "same_text_row_with_single_element",
          evidence_ids: [rowEvidence.id],
          verified: false,
        };
      } else if (role !== "requirement" && role !== "calculation_operand" && row.bbox) {
        const candidates = elements
          .filter((element) => element.location?.text_anchor_bbox)
          .map((element) => ({
            element,
            distance: distanceBetween(row.bbox, element.location.text_anchor_bbox),
          }))
          .filter((entry) => entry.distance <= 72)
          .sort((a, b) => a.distance - b.distance);
        if (candidates.length && (!candidates[1] || candidates[0].distance < candidates[1].distance * 0.6)) {
          related = [candidates[0].element.id];
          bindingStatus = "candidate";
          associationStatus = "candidate";
          basis = {
            method: "spatial_proximity_without_recovered_leader",
            distance_points: Math.round(candidates[0].distance * 10) / 10,
            evidence_ids: [rowEvidence.id, ...candidates[0].element.evidence_ids],
            verified: false,
            limitation: "No dimension line, extension line, arrowhead, or leader endpoint was recovered.",
          };
        }
      }
      const id = stableId(fingerprint, "dimension", [
        page,
        value.original,
        row.bbox?.x ?? "",
        row.bbox?.y ?? "",
        role,
      ]);
      const dimension = {
        id,
        original_content: value.original,
        context_text: row.text.slice(0, 500),
        value_text: value.original,
        value_numeric: value.value,
        unit: value.unit,
        role,
        property: propertyKind(row.text, value.unit),
        binding_status: bindingStatus,
        association_status: associationStatus,
        related_element_ids: related,
        page,
        bbox: row.bbox,
        geometry: {
          text_anchor_bbox: row.bbox,
          dimension_line: null,
          extension_lines: [],
          leader: null,
          geometry_status: "text_anchor_only",
        },
        evidence_ids: [rowEvidence.id],
        extraction_methods: row.methods,
        confidence: row.confidence,
        extraction_status: row.confidence != null && row.confidence < LOW_CONFIDENCE ? "low_confidence" : "observed",
        directly_observed: true,
        association_basis: basis,
      };
      dimensions.push(dimension);
      if (bindingStatus === "bound") {
        const element = elements.find((candidate) => candidate.id === related[0]);
        if (element) {
          const key = dimension.property;
          const property = {
            value: value.value,
            unit: value.unit,
            original: value.original,
            status: "observed_value_in_inferred_association",
            confidence: row.confidence,
            evidence_ids: [rowEvidence.id, id],
            association_status: "inferred",
            independently_verified: false,
          };
          if (!element.properties[key]) element.properties[key] = property;
          else if (Array.isArray(element.properties[key])) element.properties[key].push(property);
          else element.properties[key] = [element.properties[key], property];
        }
      }
    }
  }
  return dimensions.slice(0, 300);
}

function cellGroups(row) {
  if (!row.items.length) return [];
  const groups = [];
  let current = [];
  for (const item of row.items) {
    const prior = current[current.length - 1];
    const priorRight = prior?.bbox ? prior.bbox.x + prior.bbox.width : 0;
    const gap = prior && item.bbox ? item.bbox.x - priorRight : 0;
    if (prior && gap > Math.max(18, (prior.bbox?.height || 6) * 3)) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) groups.push(current);
  return groups.map((items) => ({
    text: items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
    bbox: unionBoxes(items.map((item) => item.bbox)),
    confidence: items.some((item) => item.confidence != null)
      ? Math.min(...items.filter((item) => item.confidence != null).map((item) => item.confidence))
      : null,
    extraction_methods: [...new Set(items.map((item) => item.method))],
  })).filter((cell) => cell.text);
}

function tableRowsNear(titleRow, rows, bounds = {}) {
  if (!titleRow.bbox) return [];
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : titleRow.bbox.x - 80;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : titleRow.bbox.x + Math.max(900, titleRow.bbox.width + 500);
  const candidates = rows
    .filter((row) => row.id !== titleRow.id && row.bbox)
    .filter((row) => Math.abs(row.bbox.y - titleRow.bbox.y) <= 600)
    .map((row) => ({
      row,
      cells: cellGroups(row).filter((cell) => {
        const x = center(cell.bbox)?.x;
        return x != null && x >= minX && x <= maxX;
      }),
    }))
    .filter((entry) => entry.cells.length >= 2);
  const above = candidates.filter((entry) => entry.row.bbox.y > titleRow.bbox.y);
  const below = candidates.filter((entry) => entry.row.bbox.y < titleRow.bbox.y);
  const chosen = below.length >= 2 ? below : above;
  const sorted = chosen.sort((a, b) =>
    chosen === above ? a.row.bbox.y - b.row.bbox.y : b.row.bbox.y - a.row.bbox.y);
  const contiguous = [];
  let priorY = titleRow.bbox.y;
  for (const entry of sorted) {
    const gap = Math.abs(entry.row.bbox.y - priorY);
    if (contiguous.length && gap > 55) break;
    if (!contiguous.length && gap > 120) continue;
    contiguous.push(entry);
    priorY = entry.row.bbox.y;
  }
  return contiguous;
}

function tagFromCells(cells, headers) {
  const tagHeader = headers.find((header) => /\bTAG\b/i.test(header.text));
  if (!tagHeader?.bbox) return null;
  const headerIndex = headers.indexOf(tagHeader);
  const headerX = center(tagHeader.bbox)?.x;
  const cell = headerIndex === 0 && /^TAG\b/i.test(tagHeader.text)
    ? cells[0]
    : cells
        .filter((candidate) => candidate.bbox)
        .sort((a, b) => Math.abs(center(a.bbox).x - headerX) - Math.abs(center(b.bbox).x - headerX))[0];
  const token = cell?.text.match(/^\s*((?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z]{1,6}[- ]?\d{1,4}[A-Z]?)\b/i);
  if (token) return token[1].toUpperCase().replace(/\s+/g, "-");
  return null;
}

function makeSchedules(rows, fingerprint, page, evidence) {
  const schedules = [];
  const titles = segmentedRows(rows).filter((row) =>
    /^[A-Z0-9][A-Z0-9 &/()'-]{0,60}\bSCHEDULES?\s*:?\s*$/i.test(row.text) &&
    !/^\d/.test(row.text));
  for (const titleRow of titles.slice(0, 20)) {
    const neighbors = titles
      .filter((other) => other.id !== titleRow.id && other.bbox && Math.abs(other.bbox.y - titleRow.bbox.y) <= 24)
      .sort((a, b) => a.bbox.x - b.bbox.x);
    const left = neighbors.filter((other) => other.bbox.x < titleRow.bbox.x).pop();
    const right = neighbors.find((other) => other.bbox.x > titleRow.bbox.x);
    const bounds = {
      minX: left ? (left.bbox.x + left.bbox.width + titleRow.bbox.x) / 2 : titleRow.bbox.x - 80,
      maxX: right ? (titleRow.bbox.x + titleRow.bbox.width + right.bbox.x) / 2 : titleRow.bbox.x + Math.max(900, titleRow.bbox.width + 500),
    };
    const tableRows = tableRowsNear(titleRow, rows, bounds).slice(0, 80);
    const titleEvidence = evidenceRecord(fingerprint, page, titleRow, "schedule_title");
    if (!evidence.some((item) => item.id === titleEvidence.id)) evidence.push(titleEvidence);
    const headerIndex = tableRows
      .slice(0, 8)
      .map((entry, index) => ({
        index,
        score: entry.cells.reduce((score, cell) =>
          score + (/\bTAG\b/i.test(cell.text) ? 8 : 0) +
          (/\b(?:MANUFACTURER|MODEL|DESCRIPTION|TYPE|SIZE|CAPACITY|NOTES?)\b/i.test(cell.text) ? 2 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score)[0];
    const selectedHeaderIndex = headerIndex?.score > 0 ? headerIndex.index : 0;
    const headerEntry = tableRows[selectedHeaderIndex] || null;
    const headers = headerEntry
      ? headerEntry.cells.map((cell, index) => ({
          id: stableId(fingerprint, "schedule-header", [titleRow.text, index, cell.text]),
          column_index: index,
          text: cell.text,
          original_content: cell.text,
          bbox: cell.bbox,
          confidence: cell.confidence,
          extraction_methods: cell.extraction_methods,
          status: "observed",
        }))
      : [];
    const dataRows = [];
    for (const [rowIndex, entry] of tableRows.slice(headerEntry ? selectedHeaderIndex + 1 : 0).entries()) {
      const cells = entry.cells.map((cell, columnIndex) => ({
        id: stableId(fingerprint, "schedule-cell", [
          titleRow.text,
          rowIndex,
          columnIndex,
          cell.text,
          cell.bbox?.x ?? "",
          cell.bbox?.y ?? "",
        ]),
        column_index: columnIndex,
        header: headers[columnIndex]?.text || null,
        text: cell.text,
        original_content: cell.text,
        bbox: cell.bbox,
        confidence: cell.confidence,
        extraction_methods: cell.extraction_methods,
        status: cell.confidence != null && cell.confidence < LOW_CONFIDENCE ? "low_confidence" : "observed",
        merged_cell: headers.length > 0 && entry.cells.length !== headers.length,
      }));
      const rowEvidence = evidenceRecord(fingerprint, page, entry.row, "schedule_row");
      if (!evidence.some((item) => item.id === rowEvidence.id)) evidence.push(rowEvidence);
      dataRows.push({
        id: stableId(fingerprint, "schedule-row", [
          titleRow.text,
          rowIndex,
          entry.row.bbox?.y ?? "",
          cells.map((cell) => cell.text).join("|"),
        ]),
        row_index: rowIndex,
        tag: tagFromCells(cells, headers),
        cells,
        bbox: entry.row.bbox,
        evidence_ids: [rowEvidence.id],
        status: cells.some((cell) => cell.status === "low_confidence") ? "partial" : "observed",
      });
    }
    schedules.push({
      id: stableId(fingerprint, "schedule", [
        page,
        titleRow.text,
        titleRow.bbox?.x ?? "",
        titleRow.bbox?.y ?? "",
      ]),
      title: titleRow.text.slice(0, 300),
      original_content: titleRow.text.slice(0, 500),
      page,
      bbox: titleRow.bbox,
      headers,
      rows: dataRows,
      notes: [],
      evidence_ids: [titleEvidence.id],
      extraction_methods: titleRow.methods,
      confidence: titleRow.confidence,
      status: dataRows.length ? "partial" : "heading_only",
      limitation: dataRows.length
        ? "Rows and cells are spatially reconstructed from aligned text. Grid lines and merged-cell spans were not independently verified."
        : "A schedule heading was read, but no reliable aligned rows were reconstructed.",
    });
  }
  return schedules;
}

function scheduleElementType(title) {
  if (/\bDOOR\b/i.test(title)) return "door";
  if (/\bWINDOW\b/i.test(title)) return "window";
  if (/\b(?:PARTITION|WALL)\b/i.test(title)) return "wall";
  if (/\bPANEL\b/i.test(title)) return "electrical_panel";
  if (/\bBACKFLOW\b/i.test(title)) return "backflow";
  if (/\bVALVE\b/i.test(title)) return "valve";
  if (/\bINTERCEPTOR\b/i.test(title)) return "grease_interceptor";
  if (/\b(?:PLUMBING FIXTURE|FIXTURE)\b/i.test(title)) return "plumbing_fixture";
  if (/\b(?:WATER HEATER|EXPANSION TANK|PUMP|SEWAGE EJECTOR|MECHANICAL|EQUIPMENT)\b/i.test(title)) return "mechanical_equipment";
  if (/\b(?:BEAM|COLUMN|FOOTING|FOUNDATION)\b/i.test(title)) return "structural_member";
  return "scheduled_element";
}

function addScheduleElements(elements, schedules, fingerprint, page, discipline) {
  const existing = new Map(elements.filter((element) => element.tag).map((element) => [`${element.type}:${element.tag}`, element]));
  for (const schedule of schedules) {
    const type = scheduleElementType(schedule.title);
    for (const row of schedule.rows || []) {
      if (!row.tag) continue;
      const key = `${type}:${row.tag}`;
      let element = existing.get(key);
      if (!element) {
        element = {
          id: stableId(fingerprint, "element", [page, type, row.tag]),
          type,
          discipline,
          tag: row.tag,
          page,
          location: {
            page,
            text_anchor_bbox: row.bbox,
            physical_boundary: null,
            geometry_status: "schedule_row_reference",
            limitation: "The schedule row identifies an element but does not locate its physical boundary on a plan.",
          },
          properties: {},
          associated_note_ids: [],
          associated_schedule_ids: [schedule.id],
          related_sheet_refs: [],
          evidence_ids: [...row.evidence_ids],
          confidence: null,
          extraction_status: "identified_from_schedule",
          observation_status: "observed",
          work_status: null,
          ambiguity: null,
        };
        elements.push(element);
        existing.set(key, element);
      } else if (!element.associated_schedule_ids.includes(schedule.id)) {
        element.associated_schedule_ids.push(schedule.id);
      }
      const scheduleProperty = {
        schedule_id: schedule.id,
        schedule_title: schedule.title,
        row_id: row.id,
        cells: row.cells.map((cell) => ({
          header: cell.header,
          original_content: cell.original_content,
          bbox: cell.bbox,
          confidence: cell.confidence,
          status: cell.status,
        })),
        association_status: "inferred",
        basis: "exact_tag_in_spatially_reconstructed_schedule_row",
        independently_verified: false,
        evidence_ids: row.evidence_ids,
      };
      if (!Array.isArray(element.properties.schedule_rows)) element.properties.schedule_rows = [];
      if (!element.properties.schedule_rows.some((item) => item.row_id === row.id)) {
        element.properties.schedule_rows.push(scheduleProperty);
      }
    }
  }
}

function makeReferences(rows, fingerprint, page, evidence) {
  const references = [];
  for (const row of rows) {
    for (const match of row.text.matchAll(REFERENCE_RE)) {
      const sheet = match[1].toUpperCase();
      const detail = match[2] || null;
      const ev = evidenceRecord(fingerprint, page, row, "drawing_reference");
      if (!evidence.some((item) => item.id === ev.id)) evidence.push(ev);
      references.push({
        id: stableId(fingerprint, "reference", [page, sheet, detail || "", row.text]),
        sheet_number: sheet,
        detail_number: detail,
        original_content: match[0],
        context_text: row.text.slice(0, 500),
        page,
        bbox: row.bbox,
        evidence_ids: [ev.id],
        status: "observed",
        matching_basis: "explicit_drawing_reference",
      });
    }
  }
  return [...new Map(references.map((item) => [item.id, item])).values()].slice(0, 80);
}

function makeNotes(rows, fingerprint, page, evidence) {
  const notes = [];
  for (const row of rows) {
    if (!REQUIREMENT_RE.test(row.text) && !/\bNOTE\b/i.test(row.text)) continue;
    const ev = evidenceRecord(fingerprint, page, row, "note");
    if (!evidence.some((item) => item.id === ev.id)) evidence.push(ev);
    notes.push({
      id: stableId(fingerprint, "note", [page, row.text, row.bbox?.x ?? "", row.bbox?.y ?? ""]),
      text: row.text.slice(0, 1000),
      original_content: row.text.slice(0, 1000),
      page,
      bbox: row.bbox,
      element_types: elementTypes(row.text).map((item) => item.id),
      evidence_ids: [ev.id],
      extraction_methods: row.methods,
      confidence: row.confidence,
      observation_status: "observed",
      binding_status: REQUIREMENT_RE.test(row.text) ? "requirement_note" : "read",
    });
  }
  return notes.slice(0, 100);
}

function makeRelationships(elements, dimensions, schedules, notes, references, calculations, fingerprint) {
  const relationships = [];
  const push = (from, to, type, status, basis, evidenceIds = []) => {
    relationships.push({
      id: stableId(fingerprint, "relationship", [from, to, type, basis]),
      from_id: from,
      to_id: to,
      type,
      status,
      basis,
      evidence_ids: [...new Set(evidenceIds)],
      independently_verified: false,
    });
  };
  for (const dimension of dimensions) {
    for (const elementId of dimension.related_element_ids || []) {
      push(
        dimension.id,
        elementId,
        "measures",
        dimension.association_status,
        dimension.association_basis?.method || "unknown",
        dimension.association_basis?.evidence_ids || dimension.evidence_ids,
      );
    }
  }
  for (const schedule of schedules) {
    for (const row of schedule.rows || []) {
      const rowText = row.cells.map((cell) => cell.text).join(" ");
      const matches = elements.filter((element) => {
        if (!element.tag) return false;
        if (row.tag === element.tag) return true;
        return new RegExp(`(?<![A-Z0-9])${element.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Z0-9])`, "i").test(rowText);
      });
      for (const element of matches) {
        push(row.id, element.id, "schedule_row_describes", "inferred", "exact_tag_in_schedule_row", [
          ...row.evidence_ids,
          ...element.evidence_ids,
        ]);
        if (!element.associated_schedule_ids.includes(schedule.id)) element.associated_schedule_ids.push(schedule.id);
        if (!Array.isArray(element.properties.schedule_rows)) element.properties.schedule_rows = [];
        if (!element.properties.schedule_rows.some((item) => item.row_id === row.id)) {
          element.properties.schedule_rows.push({
            schedule_id: schedule.id,
            schedule_title: schedule.title,
            row_id: row.id,
            cells: row.cells.map((cell) => ({
              header: cell.header,
              original_content: cell.original_content,
              bbox: cell.bbox,
              confidence: cell.confidence,
              status: cell.status,
            })),
            association_status: "inferred",
            basis: "exact_tag_in_schedule_row",
            independently_verified: false,
            evidence_ids: row.evidence_ids,
          });
        }
      }
    }
  }
  for (const note of notes) {
    if ((note.element_types || []).length !== 1) continue;
    const matches = elements.filter((element) => element.type === note.element_types[0]);
    if (matches.length !== 1) continue;
    push(note.id, matches[0].id, "note_applies_to", "candidate", "single_element_type_on_sheet", [
      ...note.evidence_ids,
      ...matches[0].evidence_ids,
    ]);
  }
  for (const reference of references) {
    const contextTypes = elementTypes(reference.context_text).map((item) => item.id);
    for (const element of elements.filter((candidate) => contextTypes.includes(candidate.type))) {
      push(reference.id, element.id, "detail_reference_for", "inferred", "explicit_reference_same_context", [
        ...reference.evidence_ids,
        ...element.evidence_ids,
      ]);
      if (!element.related_sheet_refs.includes(reference.sheet_number)) {
        element.related_sheet_refs.push(reference.sheet_number);
      }
    }
  }
  for (const calculation of calculations) {
    const grease = elements.filter((element) => element.type === "grease_interceptor");
    if (grease.length && /\bINTERCEPTOR\b/i.test(calculation.statement || "")) {
      for (const element of grease) {
        const unambiguous = grease.length === 1;
        push(
          calculation.id,
          element.id,
          "calculation_governs",
          unambiguous ? "inferred" : "candidate",
          unambiguous
            ? "stated_calculation_target_and_single_identified_element_type"
            : "stated_calculation_target_but_multiple_untagged_element_candidates",
          [...(calculation.evidence_ids || []), ...element.evidence_ids],
        );
        if (unambiguous) {
          element.properties.calculation = {
            calculation_id: calculation.id,
            governing: calculation.governing,
            operands: calculation.operands,
            association_status: "inferred",
            basis: "stated_calculation_target_and_single_identified_element_type",
            independently_verified: false,
          };
        }
      }
    }
  }
  return relationships.slice(0, 400);
}

function calculationsFrom(text, fingerprint) {
  const reconciled = reconcileCalculation({ title: String(text || "").slice(0, 6000), description: "" }, text);
  if (!reconciled?.method) return [];
  return [{
    id: stableId(fingerprint, "calculation", [reconciled.method.statement]),
    method: reconciled.method.rule,
    statement: reconciled.method.statement,
    operands: reconciled.method.operands,
    governing: reconciled.governing,
    explained: reconciled.explained,
    original_content: reconciled.method.statement,
    observation_status: "observed",
    association_status: "observed_method",
    binding_status: "read",
    independently_verified: false,
    limitation: "The stated method connects these values; its operands are not treated as contradictory measurements.",
  }];
}

function upgradeCalculations(calculations, fingerprint) {
  return (calculations || []).map((calculation) => ({
    ...calculation,
    id: calculation.id || stableId(fingerprint, "calculation", [calculation.statement || calculation.original_text || "calculation"]),
    original_content: calculation.original_content || calculation.original_text || calculation.statement,
    observation_status: "observed",
    association_status: "observed_method",
    binding_status: "read",
    independently_verified: false,
  }));
}

function mergeById(prior, current) {
  const merged = new Map();
  for (const item of prior || []) merged.set(item.id, item);
  for (const item of current || []) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item });
  return [...merged.values()];
}

function mergeElements(prior, current) {
  const merged = new Map((prior || []).map((element) => [element.id, element]));
  for (const element of current || []) {
    const before = merged.get(element.id);
    merged.set(element.id, before
      ? {
          ...before,
          ...element,
          properties: { ...(before.properties || {}), ...(element.properties || {}) },
          evidence_ids: [...new Set([...(before.evidence_ids || []), ...(element.evidence_ids || [])])],
          associated_note_ids: [...new Set([...(before.associated_note_ids || []), ...(element.associated_note_ids || [])])],
          associated_schedule_ids: [...new Set([...(before.associated_schedule_ids || []), ...(element.associated_schedule_ids || [])])],
          related_sheet_refs: [...new Set([...(before.related_sheet_refs || []), ...(element.related_sheet_refs || [])])],
        }
      : element);
  }
  return [...merged.values()];
}

function mergeSchedules(prior, current) {
  const merged = new Map((prior || []).map((schedule) => [schedule.id, schedule]));
  for (const schedule of current || []) {
    const before = merged.get(schedule.id);
    merged.set(schedule.id, before
      ? {
          ...before,
          ...schedule,
          headers: mergeById(before.headers, schedule.headers),
          rows: mergeById(before.rows, schedule.rows),
          evidence_ids: [...new Set([...(before.evidence_ids || []), ...(schedule.evidence_ids || [])])],
        }
      : schedule);
  }
  return [...merged.values()];
}

function mergeDrawingDocuments(prior, current) {
  if (!prior) return current;
  if (!current) return prior;
  const extraction = {
    ...prior.extraction,
    ...current.extraction,
    methods: [...new Set([...(prior.extraction?.methods || []), ...(current.extraction?.methods || [])])],
    unreadable_regions: current.extraction?.unreadable_regions || prior.extraction?.unreadable_regions || [],
    limitations: [...new Set([...(prior.extraction?.limitations || []), ...(current.extraction?.limitations || [])])],
    retry_count: Math.max(Number(prior.extraction?.retry_count || 0), Number(current.extraction?.retry_count || 0)),
  };
  return {
    ...prior,
    ...current,
    extraction,
    elements: mergeElements(prior.elements, current.elements),
    dimensions: mergeById(prior.dimensions, current.dimensions),
    notes: mergeById(prior.notes, current.notes),
    schedules: mergeSchedules(prior.schedules, current.schedules),
    calculations: mergeById(prior.calculations, current.calculations),
    drawing_references: mergeById(prior.drawing_references, current.drawing_references),
    relationships: mergeById(prior.relationships, current.relationships),
    evidence: mergeById(prior.evidence, current.evidence),
  };
}

function attachSourceRefs(document) {
  const common = {
    file_id: document.file_id,
    source_fingerprint: document.source_fingerprint,
    sheet_number: document.sheet_number,
  };
  const attach = (fact) => {
    fact.source_ref = {
      ...common,
      page: fact.page || document.page || 1,
      evidence_ids: fact.evidence_ids || [],
    };
  };
  for (const key of ["elements", "dimensions", "notes", "calculations", "drawing_references", "relationships", "evidence"]) {
    for (const fact of document[key] || []) attach(fact);
  }
  for (const schedule of document.schedules || []) {
    attach(schedule);
    for (const row of schedule.rows || []) {
      attach(row);
      for (const cell of row.cells || []) {
        cell.source_ref = {
          ...common,
          page: schedule.page || document.page || 1,
          evidence_ids: row.evidence_ids || [],
        };
      }
    }
  }
}

function buildDrawingDocument(input) {
  const v1 = base.buildDrawingDocument(input);
  const fingerprint = String(input.sourceFingerprint || "unhashed");
  const page = Number(input.pageNumber || input.sheet?.page_number) || 1;
  const items = collectItems(input);
  const rows = spatialRows(items);
  const segments = segmentedRows(rows);
  const evidence = [];
  const calculations = v1.calculations?.length
    ? upgradeCalculations(v1.calculations, fingerprint)
    : calculationsFrom(input.pageText || rows.map((row) => row.text).join("\n"), fingerprint);
  for (const calculation of calculations) {
    const calculationEvidence = {
      id: stableId(fingerprint, "evidence", [page, "calculation", calculation.statement || ""]),
      page,
      original_content: calculation.statement,
      bbox: null,
      source_type: "calculation_text",
      extraction_methods: ["pdf_text_or_ocr"],
      confidence: null,
      status: "observed",
      directly_observed: true,
    };
    evidence.push(calculationEvidence);
    calculation.evidence_ids = [calculationEvidence.id];
  }
  const { elements } = makeElements(input, segments, evidence, fingerprint, page);
  const schedules = makeSchedules(rows, fingerprint, page, evidence);
  addScheduleElements(
    elements,
    schedules,
    fingerprint,
    page,
    input.discipline || input.sheet?.discipline || null,
  );
  const dimensions = makeDimensions(input, segments, elements, evidence, fingerprint, page, calculations);
  const notes = makeNotes(segments, fingerprint, page, evidence);
  const drawingReferences = makeReferences(segments, fingerprint, page, evidence);
  const relationships = makeRelationships(
    elements,
    dimensions,
    schedules,
    notes,
    drawingReferences,
    calculations,
    fingerprint,
  );
  const unreadable = (input.regions || [])
    .filter((region) => region?.readable === false)
    .map((region) => ({
      page,
      bbox: boxOf(region),
      limitation: region.limitations || "region_unreadable",
      retryable: true,
    }));
  const methods = [...new Set(items.map((item) => item.method).filter(Boolean))];
  const graphic = String(input.graphicalReadStatus || "");
  const partial = unreadable.length > 0 || ["unreadable", "ocr_unavailable", "text-layer"].includes(graphic);
  const retryCount = Number(input.retryCount || 0);
  const retryLimit = Number(input.retryLimit || 3);
  const document = {
    ...v1,
    schema_version: SCHEMA_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    extraction: {
      status: partial ? "partial" : items.length ? "completed" : "failed",
      methods,
      completed_methods: methods,
      coverage: {
        pages_total: 1,
        pages_attempted: 1,
        pages_completed: partial ? 0 : 1,
        text_items: items.length,
        evidence_records: evidence.length,
        classified_facts:
          elements.length + dimensions.length + notes.length + schedules.length +
          calculations.length + drawingReferences.length + relationships.length,
        graphical_status: input.graphicalReadStatus || null,
        unreadable_regions: unreadable.length,
      },
      unreadable_regions: unreadable,
      retry_count: retryCount,
      retry_limit: retryLimit,
      retry_status: partial
        ? retryCount >= retryLimit ? "exhausted" : "retryable"
        : "not_needed",
      last_attempt_at: new Date().toISOString(),
      limitations: [
        ...(partial
          ? ["Extraction remains partial. Unread regions are not evidence that drawing information is absent."]
          : []),
        ...(retryCount >= retryLimit && partial
          ? ["Automatic graphical retries are exhausted; targeted reviewer extraction or manual review is required."]
          : []),
        "Text-anchor geometry does not establish physical element boundaries.",
        "Inferred and candidate associations are not independently verified drawing relationships.",
      ],
    },
    elements,
    dimensions,
    notes,
    schedules,
    calculations,
    drawing_references: drawingReferences,
    relationships,
    evidence,
  };
  attachSourceRefs(document);
  const validation = validateDrawingDocument(document);
  if (!validation.ok) {
    document.extraction.status = "failed";
    document.extraction.limitations.push(...validation.errors.map((error) => `validation:${error}`));
  }
  return document;
}

function validateDrawingDocument(doc) {
  const errors = [];
  if (!doc || doc.schema_version !== SCHEMA_VERSION) errors.push("schema_version");
  for (const key of ["elements", "dimensions", "notes", "schedules", "calculations", "relationships", "evidence"]) {
    if (!Array.isArray(doc?.[key])) errors.push(`${key}:not_array`);
  }
  if (!["queued", "extracting", "partial", "completed", "failed"].includes(doc?.extraction?.status)) {
    errors.push("extraction:status");
  }
  const ids = new Set((doc?.elements || []).map((element) => element.id));
  const evidenceIds = new Set((doc?.evidence || []).map((item) => item.id));
  for (const key of ["elements", "dimensions", "notes", "calculations", "drawing_references", "relationships", "evidence"]) {
    for (const fact of doc?.[key] || []) {
      if (fact.source_ref?.source_fingerprint !== doc.source_fingerprint) {
        errors.push(`${key}:${fact.id}:source_ref`);
      }
    }
  }
  for (const schedule of doc?.schedules || []) {
    if (schedule.source_ref?.source_fingerprint !== doc.source_fingerprint) errors.push(`schedule:${schedule.id}:source_ref`);
    for (const row of schedule.rows || []) {
      if (row.source_ref?.source_fingerprint !== doc.source_fingerprint) errors.push(`schedule_row:${row.id}:source_ref`);
      for (const cell of row.cells || []) {
        if (cell.source_ref?.source_fingerprint !== doc.source_fingerprint) errors.push(`schedule_cell:${cell.id}:source_ref`);
      }
    }
  }
  for (const dimension of doc?.dimensions || []) {
    if (dimension.binding_status === "bound" && dimension.association_status !== "inferred" &&
        dimension.association_status !== "verified") errors.push(`dimension:${dimension.id}:association`);
    if (dimension.binding_status === "bound" &&
        !(dimension.related_element_ids || []).some((id) => ids.has(id))) {
      errors.push(`dimension:${dimension.id}:missing_element`);
    }
    if (dimension.binding_status === "candidate" && dimension.association_status !== "candidate") {
      errors.push(`dimension:${dimension.id}:candidate_status`);
    }
  }
  for (const relationship of doc?.relationships || []) {
    if (!["observed", "inferred", "candidate", "verified"].includes(relationship.status)) {
      errors.push(`relationship:${relationship.id}:status`);
    }
    if (relationship.status === "verified" && relationship.independently_verified !== true) {
      errors.push(`relationship:${relationship.id}:unverified_promotion`);
    }
    if ((relationship.evidence_ids || []).some((id) => !evidenceIds.has(id))) {
      errors.push(`relationship:${relationship.id}:missing_evidence`);
    }
  }
  return { ok: errors.length === 0, errors };
}

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
      retry_count: doc.extraction?.retry_count || 0,
      retry_limit: doc.extraction?.retry_limit || 0,
      retry_status: doc.extraction?.retry_status || null,
      limitations: doc.extraction?.limitations || [],
    },
    elements: (doc.elements || []).slice(0, 40).map((element) => ({
      id: element.id,
      type: element.type,
      discipline: element.discipline,
      tag: element.tag,
      location: {
        text_anchor_bbox: element.location?.text_anchor_bbox || null,
        geometry_status: element.location?.geometry_status || "not_recovered",
      },
      properties: element.properties,
      associated_schedule_ids: element.associated_schedule_ids,
      related_sheet_refs: element.related_sheet_refs,
      evidence_ids: element.evidence_ids,
      confidence: element.confidence,
      extraction_status: element.extraction_status,
      observation_status: element.observation_status,
      ambiguity: element.ambiguity,
    })),
    schedules: (doc.schedules || []).slice(0, 8).map((schedule) => ({
      id: schedule.id,
      title: schedule.title,
      status: schedule.status,
      headers: (schedule.headers || []).map((header) => header.text),
      rows: (schedule.rows || []).slice(0, 20).map((row) => ({
        id: row.id,
        tag: row.tag,
        cells: row.cells.map((cell) => ({
          header: cell.header,
          text: cell.text,
          status: cell.status,
        })),
        status: row.status,
      })),
      limitation: schedule.limitation,
    })),
    dimensions: (doc.dimensions || []).slice(0, 80).map((dimension) => ({
      id: dimension.id,
      original_content: dimension.original_content,
      value_numeric: dimension.value_numeric,
      unit: dimension.unit,
      role: dimension.role,
      property: dimension.property,
      binding_status: dimension.binding_status,
      association_status: dimension.association_status,
      related_element_ids: dimension.related_element_ids,
      geometry: dimension.geometry,
      evidence_ids: dimension.evidence_ids,
      confidence: dimension.confidence,
      association_basis: dimension.association_basis,
    })),
    calculations: doc.calculations || [],
    drawing_references: (doc.drawing_references || []).slice(0, 30),
    relationships: (doc.relationships || []).slice(0, 60),
    cross_sheet: (doc.cross_sheet || []).slice(0, 30),
  };
}

function measurementIsProven(dimension, elementIds) {
  if (!dimension) return false;
  if (dimension.role === "requirement" || dimension.role === "calculation_operand") return false;
  if (["calculation_operand", "candidate", "unbound", "requirement_note"].includes(dimension.binding_status)) return false;
  if (dimension.association_status === "candidate" || dimension.association_status === "none") return false;
  const tied = (dimension.related_element_ids || []).some((id) => elementIds.has(id));
  if (!tied) return false;
  return dimension.association_status === "verified"
    || (dimension.binding_status === "bound" && dimension.association_status === "inferred");
}

function gateMeasuredFact(doc, claim, numbers) {
  if (!doc || !claim?.element || doc.extraction?.status === "failed") return null;
  const relevantElements = (doc.elements || []).filter((element) => element.type === claim.element.id);
  if (!relevantElements.length || !numbers?.length) return null;
  const elementIds = new Set(relevantElements.map((element) => element.id));
  const mentions = (dimension) =>
    numbers.some((number) =>
      new RegExp(`(?<![\\d.])${String(number).replace(".", "\\.")}(?![\\d.])`)
        .test(String(dimension.original_content || dimension.value_text || "")));
  const dimensions = (doc.dimensions || []).filter(mentions);
  if (!dimensions.length) return null;
  if (dimensions.some((dimension) => measurementIsProven(dimension, elementIds))) return null;
  if (dimensions.every((dimension) => dimension.role === "requirement")) {
    return {
      reason: "requirement_note_not_measurement",
      detail: `Structured extraction read ${numbers.join(" and ")} only as a requirement, not as a measurement of the ${claim.element.label}.`,
    };
  }
  return {
    reason: "value_not_bound_to_element",
    detail: `Structured extraction did not establish ${numbers.join(" and ")} as a measurement of the ${claim.element.label}. Unbound values, calculation operands, and candidate proximity cannot prove that relationship. A text anchor locates the label, not a physical boundary.`,
  };
}

/**
 * A missing-attribute claim is not "not stated" when the element is on the sheet and the
 * only values are unbound, operands, or proximity candidates.
 */
function unboundMeasurement(doc, claim) {
  if (!doc || !claim?.element || doc.extraction?.status === "failed") return null;
  const relevantElements = (doc.elements || []).filter((element) => element.type === claim.element.id);
  if (!relevantElements.length) return null;
  const dimensions = doc.dimensions || [];
  if (!dimensions.length) return null;
  const elementIds = new Set(relevantElements.map((element) => element.id));
  if (dimensions.some((dimension) => measurementIsProven(dimension, elementIds))) return null;
  const attribute = (claim.attributes || [])[0] || "measurement";
  return {
    reason: "value_not_bound_to_element",
    detail: `Structured extraction found the ${claim.element.label}, but no dimension is bound to that element. Unbound values, calculation operands, and candidate proximity are not measurements of it. A text anchor locates the label, not a physical boundary, so the ${attribute} is not established as absent or compliant.`,
  };
}

function summarizeForReview(doc) {
  const view = reviewDocument(doc);
  if (!view) return "";
  return [
    "STRUCTURED DRAWING FACTS. Observed values are distinct from inferred/candidate associations. Candidate proximity cannot prove compliance. Text anchors are not physical boundaries:",
    JSON.stringify(view).slice(0, 7000),
  ].join("\n");
}

module.exports = {
  SCHEMA_VERSION,
  EXTRACTOR_VERSION,
  buildDrawingDocument,
  mergeDrawingDocuments,
  validateDrawingDocument,
  reviewDocument,
  gateMeasuredFact,
  unboundMeasurement,
  summarizeForReview,
};
