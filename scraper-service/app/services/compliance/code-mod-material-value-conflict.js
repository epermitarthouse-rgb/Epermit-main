"use strict";

const PROPERTY_PATTERNS = [
  { property: "occupant_load", pattern: /\b(?:occupant\s*load|max(?:imum)?\s*occupant|occupants?)\b/i },
  { property: "common_path_distance", pattern: /\bcommon\s*path(?:\s*of\s*travel)?\b/i },
  { property: "door_width", pattern: /\b(?:door\s*)?width\b/i },
  { property: "fire_rating_hours", pattern: /\b(?:fire[-\s]?rated|hour[-\s]?rated|\d+\s*[-]?\s*hour)\b/i },
  { property: "signage_max", pattern: /\b(?:signage|maximum\s*occupant|max\s*occupant)\b/i },
  { property: "amperage", pattern: /\b(?:amp(?:ere)?s?|amperage)\b/i },
];

const ASSEMBLY_SCOPE_PATTERNS = [
  {
    scope: "stair",
    pattern: /\b(?:stair(?:way|well)?|stair\s*shaft|enclosed\s*stair|egress\s*stair)\b/i,
  },
  { scope: "corridor", pattern: /\b(?:corridor|hallway|passageway)\b/i },
  { scope: "partition", pattern: /\b(?:partition|barrier)\b/i },
  { scope: "door", pattern: /\b(?:door|opening)\b/i },
  { scope: "wall", pattern: /\b(?:wall|walls)\b/i },
];

const GENERIC_NUMERIC =
  /(?<value>\d+(?:\.\d+)?)\s*(?:'|-\s*)?(?:(?<inches>\d+(?:\.\d+)?)\s*")?(?:\s*(?<unit>persons?|people|occupants?|occ\.?|hours?|hrs?|in(?:ch(?:es)?)?|ft|feet|')\b)?/gi;

function feetInchesToNumber(feet, inches = 0) {
  return feet + inches / 12;
}

function normalizeUnit(unit) {
  const value = String(unit ?? "").toLowerCase();
  if (/person|people|occupant|occ/.test(value)) return "person";
  if (/hour|hr|^h$/.test(value)) return "hour";
  if (/inch|in|^"$/.test(value)) return "in";
  if (/ft|feet|'/.test(value)) return "ft";
  if (/amp|^a$/.test(value)) return "amp";
  return value || "unitless";
}

function parseNumericToken(raw, unitHint) {
  const text = raw.trim();
  if (!text) return null;

  const feetInches = text.match(/(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/);
  if (feetInches) {
    return { value: feetInchesToNumber(Number(feetInches[1]), Number(feetInches[2])), unit: "ft" };
  }
  const feetOnly = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')\b/i);
  if (feetOnly) return { value: Number(feetOnly[1]), unit: "ft" };
  const inches = text.match(/(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|")\b/i);
  if (inches) return { value: Number(inches[1]), unit: "in" };
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  if (hours) return { value: Number(hours[1]), unit: "hour" };
  const persons = text.match(/(\d+(?:\.\d+)?)\s*(?:persons?|people|occupants?|occ\.?)\b/i);
  if (persons) return { value: Number(persons[1]), unit: "person" };
  const amps = text.match(/(\d+(?:\.\d+)?)\s*A\b/i);
  if (amps) return { value: Number(amps[1]), unit: "amp" };
  const plain = text.match(/(\d+(?:\.\d+)?)/);
  if (plain) return { value: Number(plain[1]), unit: normalizeUnit(unitHint) };
  return null;
}

function inferProperty(text, index) {
  const windowStart = Math.max(0, index - 80);
  const windowEnd = Math.min(text.length, index + 80);
  const context = text.slice(windowStart, windowEnd);
  for (const { property, pattern } of PROPERTY_PATTERNS) {
    if (pattern.test(context)) return property;
  }
  return "numeric_value";
}

function inferAssemblyScope(text, index) {
  const windowStart = Math.max(0, index - 40);
  const windowEnd = Math.min(text.length, index + 40);
  const context = text.slice(windowStart, windowEnd);

  let bestScope = "general";
  let bestDistance = Infinity;

  for (const { scope, pattern } of ASSEMBLY_SCOPE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of context.matchAll(re)) {
      const matchIndex = (match.index ?? 0) + windowStart;
      const distance = Math.abs(matchIndex - index);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestScope = scope;
      }
    }
  }

  return bestScope;
}

function scopedPropertyKey(text, index, property) {
  if (property !== "fire_rating_hours") return property;
  return `${property}:${inferAssemblyScope(text, index)}`;
}

function extractMaterialValues(text) {
  const normalized = String(text ?? "");
  if (!normalized.trim()) return [];
  const values = [];

  for (const match of normalized.matchAll(/(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/gi)) {
    const property = inferProperty(normalized, match.index ?? 0);
    values.push({
      property: scopedPropertyKey(normalized, match.index ?? 0, property),
      numericValue: feetInchesToNumber(Number(match[1]), Number(match[2])),
      unit: "ft",
      raw: match[0],
    });
  }

  for (const match of normalized.matchAll(GENERIC_NUMERIC)) {
    const parsed = parseNumericToken(match[0], match.groups?.unit);
    if (!parsed) continue;
    const property = inferProperty(normalized, match.index ?? 0);
    values.push({
      property: scopedPropertyKey(normalized, match.index ?? 0, property),
      numericValue: parsed.value,
      unit: parsed.unit,
      raw: match[0],
    });
  }
  return values;
}

function extractMeasureLimit(measureText) {
  const measure = String(measureText ?? "");
  const belowMatch = measure.match(
    /(?:below|under|less than|maximum of|max(?:imum)?)\s+(\d+(?:\.\d+)?)(?:\s*'[-\s]*\d*(?:\.\d+)?\s*")?\s*(persons?|people|occupants?|occ\.?|ft|feet|in(?:ch(?:es)?)?|hours?|hrs?)?/i,
  );
  if (!belowMatch) return null;
  return {
    property: inferProperty(measure, belowMatch.index ?? 0),
    max: Number(belowMatch[1]),
    unit: normalizeUnit(belowMatch[2]),
  };
}

function unitsCompatible(left, right) {
  if (left === right) return true;
  if (left === "unitless" || right === "unitless") return true;
  return false;
}

function valuesWithinMeasureLimit(left, right, measureText) {
  const limit = extractMeasureLimit(measureText);
  if (!limit) return false;
  if (limit.property !== left.property && limit.property !== right.property) return false;
  if (!unitsCompatible(left.unit, limit.unit) && limit.unit !== "unitless") return false;
  return left.numericValue <= limit.max && right.numericValue <= limit.max;
}

function detectMaterialValueConflicts(texts, measureText = "") {
  const byProperty = new Map();
  for (const text of texts) {
    for (const value of extractMaterialValues(text)) {
      const bucket = byProperty.get(value.property) ?? [];
      bucket.push(value);
      byProperty.set(value.property, bucket);
    }
  }

  const conflicts = [];
  for (const [property, values] of byProperty.entries()) {
    if (property === "numeric_value") continue;
    const distinct = values.filter(
      (value, index, arr) =>
        arr.findIndex(
          (other) =>
            other.numericValue === value.numericValue &&
            other.unit === value.unit &&
            other.raw === value.raw,
        ) === index,
    );
    if (distinct.length < 2) continue;
    for (let i = 0; i < distinct.length; i += 1) {
      for (let j = i + 1; j < distinct.length; j += 1) {
        const left = distinct[i];
        const right = distinct[j];
        if (!unitsCompatible(left.unit, right.unit)) continue;
        if (left.numericValue === right.numericValue) continue;
        if (valuesWithinMeasureLimit(left, right, measureText)) continue;
        conflicts.push({ property, left, right });
      }
    }
  }
  return conflicts;
}

function materialValuesConflict(texts, measureText = "") {
  return detectMaterialValueConflicts(texts, measureText).length > 0;
}

module.exports = {
  extractMaterialValues,
  detectMaterialValueConflicts,
  materialValuesConflict,
};
