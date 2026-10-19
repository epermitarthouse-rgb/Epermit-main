"use strict";

const SHEET_NUMBER_RE = /\b([A-Z]{1,4}-\d+(?:\.\d+)*)\b/g;
const TAG_RE = /\b((?:KH|EL|WT|PT|HW)-[A-Z0-9]+)\b/g;

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
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
function extractIdentifiers(text) {
  const body = String(text || "");
  const found = new Set();
  for (const match of body.matchAll(SHEET_NUMBER_RE)) found.add(match[1].toUpperCase());
  for (const match of body.matchAll(TAG_RE)) found.add(match[1].toUpperCase());
  return [...found];
}

/**
 * @param {string} value
 */
function normalizeIdentifier(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, "");
}

module.exports = {
  sheetNumberFromName,
  extractIdentifiers,
  normalizeIdentifier,
};
