"use strict";

const DISCIPLINES = [
  {
    id: "architectural",
    label: "Architectural",
    prefixes: ["A", "G"],
    topics: ["partition", "door", "room", "wall", "plan"],
    emphasis: "Read plans, tags, legends, and enlarged plans. A tag on this sheet counts.",
  },
  {
    id: "egress_life_safety",
    label: "Egress and life safety",
    prefixes: ["A", "LS", "G"],
    topics: ["egress", "exit", "corridor", "occupant", "travel"],
    emphasis: "Review egress on architectural and egress sheets. Do not invent a corridor width.",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    prefixes: ["A"],
    topics: ["accessible", "clearance", "turning", "ramp"],
    emphasis: "Use dimensions and clearances that are actually printed.",
  },
  {
    id: "fire_protection",
    label: "Fire protection",
    prefixes: ["A", "FP", "E"],
    topics: ["fire", "rating", "sprinkler", "smoke"],
    emphasis: "Retrieve partition tags, legends, and sections before calling a rating missing.",
  },
  {
    id: "structural",
    label: "Structural",
    prefixes: ["S"],
    topics: ["structural", "inspection", "footing", "beam"],
    emphasis: "Review structural sheets as documents, including special inspections.",
  },
  {
    id: "mechanical",
    label: "Mechanical",
    prefixes: ["M", "EQ"],
    topics: ["mechanical", "schedule", "equipment", "hvac"],
    emphasis: "Read schedules and equipment plans. Do not treat an equipment plan as an architectural floor plan.",
  },
  {
    id: "electrical",
    label: "Electrical",
    prefixes: ["E"],
    topics: ["electrical", "lighting", "emergency", "panel", "gfci"],
    emphasis: "Read lighting notes and fixture schedules before reporting emergency lighting as missing.",
  },
  {
    id: "plumbing",
    label: "Plumbing",
    prefixes: ["P"],
    topics: ["plumbing", "fixture", "water", "drain", "arrester"],
    emphasis: "Read plumbing plans, schedules, and details. A note that already specifies the item is not a violation.",
  },
  {
    id: "equipment_coordination",
    label: "Equipment coordination",
    prefixes: ["EQ", "M", "FS", "K"],
    topics: ["equipment", "kitchen", "coordination"],
    emphasis: "Coordinate equipment with architectural and MEP sheets. Do not assert architectural dimensions that are not on this sheet.",
  },
  {
    id: "document_completeness",
    label: "Document completeness",
    prefixes: ["G", "S", "EN", "CV"],
    topics: ["cover", "index", "inspection", "certificate", "comcheck"],
    emphasis: "Review forms, covers, and certificates as documents. Do not score them as an architectural pass.",
  },
];

const QUESTIONS = [
  {
    id: "fire-rated-partition",
    disciplines: ["architectural", "fire_protection"],
    topics: ["fire rating", "partition", "wall type", "legend", "1 hr", "1-hour"],
    identifiers: [],
  },
  {
    id: "corridor-width",
    disciplines: ["egress_life_safety", "architectural"],
    topics: ["corridor", "exit access", "width"],
    identifiers: [],
  },
  {
    id: "emergency-lighting",
    disciplines: ["electrical", "fire_protection"],
    topics: ["emergency lighting", "emergency light"],
    identifiers: [],
  },
  {
    id: "plumbing-details",
    disciplines: ["plumbing"],
    topics: ["plumbing", "water hammer", "arrester", "fixture"],
    identifiers: [],
  },
  {
    id: "mechanical-schedule",
    disciplines: ["mechanical", "equipment_coordination"],
    topics: ["schedule", "equipment", "mechanical"],
    identifiers: [],
  },
  {
    id: "special-inspections",
    disciplines: ["structural", "document_completeness"],
    topics: ["special inspection", "statement of special inspections"],
    identifiers: [],
  },
  {
    id: "accessibility-route",
    disciplines: ["accessibility", "architectural"],
    topics: ["accessible route", "clearance", "door schedule"],
    identifiers: [],
  },
];

/**
 * @param {string | null | undefined} fileName
 */
function prefixOf(fileName) {
  const stem = String(fileName || "").split(/[/\\]/).pop() || "";
  const match = stem.match(/^([A-Z]{1,3})/i);
  return match ? match[1].toUpperCase() : "";
}

/**
 * A sheet can inform many disciplines. This never drops the sheet from review.
 * @param {{ fileName?: string | null; title?: string | null; contentClass?: string | null; discipline?: string | null }} sheet
 */
function applicableDisciplines(sheet) {
  const prefix = prefixOf(sheet.fileName || sheet.title);
  const blob = `${sheet.fileName || ""} ${sheet.title || ""} ${sheet.contentClass || ""} ${sheet.discipline || ""}`.toLowerCase();
  const matched = DISCIPLINES.filter((discipline) => {
    if (prefix && discipline.prefixes.includes(prefix)) return true;
    return discipline.topics.some((topic) => blob.includes(topic));
  });
  if (!matched.length) return DISCIPLINES.filter((discipline) => discipline.id === "document_completeness");
  return matched;
}

/**
 * @param {Array<{ id: string }>} disciplines
 * @param {{ fileName?: string | null; contentClass?: string | null }} sheet
 */
function questionsForDisciplines(disciplines, sheet) {
  const ids = new Set(disciplines.map((discipline) => discipline.id));
  const blob = `${sheet.fileName || ""} ${sheet.contentClass || ""}`.toLowerCase();
  return QUESTIONS.filter((question) => {
    if (!question.disciplines.some((id) => ids.has(id))) return false;
    if (question.id === "special-inspections") {
      return ids.has("structural") || /special inspection|\bs-300\b|\bs-3/i.test(blob);
    }
    return true;
  });
}

function disciplinePrompt(disciplines) {
  return disciplines
    .map((discipline) => `${discipline.label}: ${discipline.emphasis}`)
    .join("\n");
}

module.exports = {
  DISCIPLINES,
  QUESTIONS,
  applicableDisciplines,
  questionsForDisciplines,
  disciplinePrompt,
  prefixOf,
};
