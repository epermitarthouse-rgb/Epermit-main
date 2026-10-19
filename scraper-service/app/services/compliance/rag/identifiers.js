"use strict";

const SHEET_NUMBER_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/g;
const COMPACT_SHEET_RE = /\b((?:FP|LS|EN|CV)\d{2,4})\b/g;
const TAG_RE = /\b((?:KH|EL|WT|PT|HW|AHU|EF|RTU|VAV|FCU)-[A-Z0-9]+)\b/g;

/**
 * @param {string | null | undefined} fileName
 */
function sheetNumberFromName(fileName) {
  const base = String(fileName || "").split(/[/\\]/).pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  const match = stem.match(/[A-Z]{1,4}[-.]?\d+(?:\.\d+)*/i);
  return match ? match[0].toUpperCase() : null;
}

/**
 * @param {string} value
 */
function normalizeIdentifier(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, "");
}

/**
 * Equal sheet or tag ids. A trailing .00 is the same sheet, not a different one.
 * Short prefixes do not match a longer id.
 * @param {string} left
 * @param {string} right
 */
function identifiersEqual(left, right) {
  const a = normalizeIdentifier(left);
  const b = normalizeIdentifier(right);
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length < 4 || !long.startsWith(short)) return false;
  return /^(?:\.0+|0+)$/.test(long.slice(short.length));
}

/**
 * @param {string} value
 */
function isSheetNumber(value) {
  return /^[A-Z]{1,4}-\d/.test(String(value || "")) || /^(?:FP|LS|EN|CV)\d{2,4}$/.test(String(value || ""));
}

/**
 * Technical ids actually present in extracted text: sheet numbers and equipment tags.
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
function extractIdentifiers(text) {
  const body = String(text || "").toUpperCase();
  const found = new Set();
  for (const match of body.matchAll(SHEET_NUMBER_RE)) found.add(match[1].toUpperCase());
  for (const match of body.matchAll(COMPACT_SHEET_RE)) found.add(match[1].toUpperCase());
  for (const match of body.matchAll(TAG_RE)) found.add(match[1].toUpperCase());
  return [...found];
}

/**
 * Sheet numbers cited by this text, excluding the sheet itself.
 * @param {string | null | undefined} text
 * @param {string | null | undefined} currentSheet
 * @returns {string[]}
 */
function extractCrossSheetRefs(text, currentSheet) {
  return extractIdentifiers(text).filter((id) => isSheetNumber(id) && !identifiersEqual(id, currentSheet || ""));
}

module.exports = {
  sheetNumberFromName,
  extractIdentifiers,
  extractCrossSheetRefs,
  normalizeIdentifier,
  identifiersEqual,
  isSheetNumber,
};
