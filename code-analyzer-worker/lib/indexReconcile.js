"use strict";

const { OCR_INDEX_HEADING } = require("./ocrLines.js");

/** Same keys as src/lib/codeAnalyzer/indexCompleteness.ts canonicalSheetNumber. */
function stripRevisionSuffix(label) {
  return String(label || "").trim().replace(/(?<=\d)(?:[.-]0{1,2}){1,2}$/, "");
}

function canonicalSheetNumber(label) {
  return stripRevisionSuffix(label).toUpperCase().replace(/[\s\-_.]/g, "");
}

function credible(key) {
  return /^[A-Z]{1,3}\d{1,4}(?:\.\d+)?$/.test(key) || /^G\d{2,4}$/.test(key);
}

/** Sheet number of an uploaded sheet: its label, else the leading token of its file name. */
function uploadedSheetNumber(sheet) {
  if (sheet.sheet_label && String(sheet.sheet_label).trim()) return canonicalSheetNumber(sheet.sheet_label);
  const base = stripRevisionSuffix(String(sheet.file_name || "").replace(/\.[a-z0-9]+$/i, "").replace(/-page\d+$/i, "").trim());
  const token = (base.match(/^[A-Z]{1,3}[-.]?\d{1,4}(?:[.-]\d{1,2})*/i) || [])[0];
  return token ? canonicalSheetNumber(token) : "";
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * An OCR row that matches no upload is a misread when it is a fragment (no non-zero digit) or
 * one character from an uploaded number ("P-20" for P-2.0); otherwise it is a sheet the index
 * lists that was not uploaded. It is reported either way, never turned into a match.
 */
function classifyUnmatched(key, uploadedKeys) {
  if (!/[1-9]/.test(key)) return "ocr_fragment";
  const near = [...uploadedKeys].find((uploaded) => editDistanceAtMostOne(uploaded, key));
  return near ? "likely_misread" : "not_uploaded";
}

/**
 * Index completeness from the OCR index line the worker stored for the index sheet. Runs after
 * sheet text is indexed, so a "no index" snapshot taken before OCR finished is replaced. An index
 * read from text or the vision extract is never overwritten.
 */
async function reconcileOcrIndex(supabase, { projectId, eligibleSheets, prior }) {
  if (prior?.hasIndex && prior.indexSource && prior.indexSource !== "ocr") return null;
  const ids = eligibleSheets.map((sheet) => sheet.id);
  if (!ids.length) return null;
  const { data: chunks } = await supabase
    .from("code_analyzer_drawing_chunks")
    .select("sheet_id, chunk_text, created_at")
    .eq("project_id", projectId)
    .eq("superseded", false)
    .in("sheet_id", ids)
    .ilike("chunk_text", `%${OCR_INDEX_HEADING}%`)
    .order("created_at", { ascending: false })
    .limit(20);
  const chunk = (chunks || []).find((row) => String(row.chunk_text || "").includes(OCR_INDEX_HEADING));
  if (!chunk) return null;
  const line = String(chunk.chunk_text).slice(chunk.chunk_text.indexOf(OCR_INDEX_HEADING) + OCR_INDEX_HEADING.length).split(/\r?\n/)[0];
  const rows = new Map();
  for (const raw of line.split(/\s+/).filter(Boolean)) {
    const key = canonicalSheetNumber(raw);
    if (!key || !credible(key) || rows.has(key)) continue;
    rows.set(key, raw);
  }
  if (rows.size < 5) return null;

  const indexSheetId = chunk.sheet_id;
  const compared = eligibleSheets.filter((sheet) => sheet.id !== indexSheetId);
  const uploadedByKey = new Map();
  for (const sheet of compared) {
    const key = uploadedSheetNumber(sheet);
    if (!key) continue;
    if (!uploadedByKey.has(key)) uploadedByKey.set(key, []);
    uploadedByKey.get(key).push(sheet);
  }
  const indexSheet = eligibleSheets.find((sheet) => sheet.id === indexSheetId);
  const indexKey = indexSheet ? uploadedSheetNumber(indexSheet) : "";
  const uploadedKeys = new Set(uploadedByKey.keys());
  const matched = new Set([...rows.keys()].filter((key) => uploadedKeys.has(key)));

  const missing = [];
  const unmatchedIndexRows = [];
  for (const [key, raw] of rows) {
    if (matched.has(key) || key === indexKey) continue;
    const kind = classifyUnmatched(key, uploadedKeys);
    if (kind === "not_uploaded") missing.push({ sheetNumber: key, rawLabel: raw, title: null });
    else unmatchedIndexRows.push({ sheetNumber: key, rawLabel: raw, reason: kind });
  }
  const extra = [];
  for (const [key, sheets] of uploadedByKey) {
    if (rows.has(key)) continue;
    for (const sheet of sheets) extra.push({ sheetNumber: key, rawLabel: sheet.sheet_label || sheet.file_name, title: null });
  }
  const duplicates = [...uploadedByKey.entries()]
    .filter(([, sheets]) => sheets.length > 1)
    .map(([sheetNumber, sheets]) => ({ sheetNumber, rawLabels: sheets.map((sheet) => sheet.file_name), sheetIds: sheets.map((sheet) => sheet.id) }));

  return {
    status: missing.length === 0 && extra.length === 0 && duplicates.length === 0 ? "complete" : "incomplete",
    hasIndex: true,
    indexSheetId,
    indexSource: "ocr",
    expectedCount: rows.size,
    actualCount: compared.length,
    comparedSheetCount: compared.length,
    matchedCount: [...uploadedKeys].filter((key) => rows.has(key)).length,
    missing,
    extra,
    duplicates,
    numberingInconsistencies: [],
    unmatchedIndexRows,
    indexReadNote: "Read by OCR from the index graphic. An uploaded sheet listed as not on the index may be a row OCR could not read; check the index sheet.",
    reconciledAt: new Date().toISOString(),
  };
}

module.exports = { reconcileOcrIndex, canonicalSheetNumber, uploadedSheetNumber, classifyUnmatched };
