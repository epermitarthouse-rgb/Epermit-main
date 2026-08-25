/**
 * Generic material-property / numeric value conflict detection for Code Mod synthesis.
 * Compares values within the same measure context — not a domain rules engine.
 */

export interface MaterialValue {
  property: string;
  numericValue: number;
  unit: string;
  raw: string;
}

export interface MaterialValueConflict {
  property: string;
  left: MaterialValue;
  right: MaterialValue;
}

const PROPERTY_PATTERNS: Array<{ property: string; pattern: RegExp }> = [
  { property: "occupant_load", pattern: /\b(?:occupant\s*load|max(?:imum)?\s*occupant|occupants?)\b/i },
  { property: "common_path_distance", pattern: /\bcommon\s*path(?:\s*of\s*travel)?\b/i },
  { property: "door_width", pattern: /\b(?:door\s*)?width\b/i },
  { property: "fire_rating_hours", pattern: /\b(?:fire[-\s]?rated|hour[-\s]?rated|\d+\s*[-]?\s*hour)\b/i },
  { property: "signage_max", pattern: /\b(?:signage|maximum\s*occupant|max\s*occupant)\b/i },
  { property: "amperage", pattern: /\b(?:amp(?:ere)?s?|amperage)\b/i },
];

const GENERIC_NUMERIC =
  /(?<value>\d+(?:\.\d+)?)\s*(?:'|-\s*)?(?:(?<inches>\d+(?:\.\d+)?)\s*")?(?:\s*(?<unit>persons?|people|occupants?|occ\.?|hours?|hrs?|in(?:ch(?:es)?)?|ft|feet|')\b)?/gi;

function feetInchesToNumber(feet: number, inches = 0): number {
  return feet + inches / 12;
}

function parseNumericToken(raw: string, unitHint?: string | null): { value: number; unit: string } | null {
  const text = raw.trim();
  if (!text) return null;

  const feetInches = text.match(/(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/);
  if (feetInches) {
    return {
      value: feetInchesToNumber(Number(feetInches[1]), Number(feetInches[2])),
      unit: "ft",
    };
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
  if (plain) {
    const unit = normalizeUnit(unitHint);
    return { value: Number(plain[1]), unit };
  }
  return null;
}

function normalizeUnit(unit: string | null | undefined): string {
  const value = String(unit ?? "").toLowerCase();
  if (/person|people|occupant|occ/.test(value)) return "person";
  if (/hour|hr|^h$/.test(value)) return "hour";
  if (/inch|in|^"$/.test(value)) return "in";
  if (/ft|feet|'/.test(value)) return "ft";
  if (/amp|^a$/.test(value)) return "amp";
  return value || "unitless";
}

function inferProperty(text: string, index: number): string {
  const windowStart = Math.max(0, index - 80);
  const windowEnd = Math.min(text.length, index + 80);
  const context = text.slice(windowStart, windowEnd);
  for (const { property, pattern } of PROPERTY_PATTERNS) {
    if (pattern.test(context)) return property;
  }
  return "numeric_value";
}

/** Extract normalized material values from observation text. */
export function extractMaterialValues(text: string): MaterialValue[] {
  const normalized = String(text ?? "");
  if (!normalized.trim()) return [];

  const values: MaterialValue[] = [];
  for (const match of normalized.matchAll(/(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/gi)) {
    const raw = match[0];
    const index = match.index ?? 0;
    values.push({
      property: inferProperty(normalized, index),
      numericValue: feetInchesToNumber(Number(match[1]), Number(match[2])),
      unit: "ft",
      raw,
    });
  }

  for (const match of normalized.matchAll(GENERIC_NUMERIC)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const parsed = parseNumericToken(raw, match.groups?.unit);
    if (!parsed) continue;
    values.push({
      property: inferProperty(normalized, index),
      numericValue: parsed.value,
      unit: parsed.unit,
      raw,
    });
  }
  return values;
}

function extractMeasureLimit(measureText: string): { property: string; max: number; unit: string } | null {
  const measure = String(measureText ?? "");
  const belowMatch = measure.match(
    /(?:below|under|less than|maximum of|max(?:imum)?)\s+(\d+(?:\.\d+)?)(?:\s*'[-\s]*\d*(?:\.\d+)?\s*")?\s*(persons?|people|occupants?|occ\.?|ft|feet|in(?:ch(?:es)?)?|hours?|hrs?)?/i,
  );
  if (!belowMatch) return null;

  const property = inferProperty(measure, belowMatch.index ?? 0);
  return {
    property,
    max: Number(belowMatch[1]),
    unit: normalizeUnit(belowMatch[2]),
  };
}

function unitsCompatible(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === "unitless" || right === "unitless") return true;
  return false;
}

function valuesWithinMeasureLimit(
  left: MaterialValue,
  right: MaterialValue,
  measureText: string,
): boolean {
  const limit = extractMeasureLimit(measureText);
  if (!limit) return false;
  if (limit.property !== left.property && limit.property !== right.property) return false;
  if (!unitsCompatible(left.unit, limit.unit) && limit.unit !== "unitless") return false;
  return left.numericValue <= limit.max && right.numericValue <= limit.max;
}

/** Detect incompatible material values within the same measure context. */
export function detectMaterialValueConflicts(
  texts: string[],
  measureText = "",
): MaterialValueConflict[] {
  const byProperty = new Map<string, MaterialValue[]>();

  for (const text of texts) {
    for (const value of extractMaterialValues(text)) {
      const bucket = byProperty.get(value.property) ?? [];
      bucket.push(value);
      byProperty.set(value.property, bucket);
    }
  }

  const conflicts: MaterialValueConflict[] = [];
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
        const left = distinct[i]!;
        const right = distinct[j]!;
        if (!unitsCompatible(left.unit, right.unit)) continue;
        if (left.numericValue === right.numericValue) continue;
        if (valuesWithinMeasureLimit(left, right, measureText)) continue;
        conflicts.push({ property, left, right });
      }
    }
  }

  return conflicts;
}

export function materialValuesConflict(
  texts: string[],
  measureText = "",
): boolean {
  return detectMaterialValueConflicts(texts, measureText).length > 0;
}
