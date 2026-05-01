"use strict";

const fs = require("fs");
const ExcelJS = require("exceljs");

/**
 * Normalize SSRS Excel cell for Review Comments grids.
 * @returns {string}
 */
function stringifyReviewCommentsExcelCellValue(val) {
  if (val == null || val === "") return "";
  if (typeof val === "number") {
    if (Number.isFinite(val) && Math.abs(val % 1) < 1e-9 && Math.abs(val) < 2147483647) {
      return String(Math.round(val));
    }
    return String(val);
  }
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (val instanceof Date) return String(val.toISOString?.() ?? String(val));
  if (typeof val === "object") {
    if (Array.isArray(val.richText)) {
      return val.richText.map((part) => (part && String(part.text ?? "")) || "").join("");
    }
    if ("text" in val && typeof val.text === "string") return String(val.text);
    const res = val.result;
    if (res != null) return stringifyReviewCommentsExcelCellValue(res);
    if (val.text != null) return stringifyReviewCommentsExcelCellValue(val.text);
    try {
      return JSON.stringify(val);
    } catch (_) {
      return String(val);
    }
  }
  return String(val)
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/\s+/g, (m) => (m.includes("\n") ? m : " "))
    .trim();
}

/**
 * @param {string} normalizedUpper header cell trimmed + upper-cased single spaces
 */
function classifyMontgomeryReviewCommentsGridHeader(normalizedUpper) {
  const h = normalizedUpper.trim();
  if (!h) return null;
  if (/^REF\s*\#|^REF$/i.test(h.replace(/\./g, ""))) return "ref";
  if (h === "CYCLE") return "cycle";
  if (/^REVIEWED\s+BY$/i.test(h) || h === "REVIEWEDBY") return "reviewed_by";
  if (h === "TYPE") return "type";
  if (h === "FILENAME") return "filename";
  if (h === "DISCUSSION") return "discussion";
  if (h === "STATUS") return "status";
  return null;
}

/**
 * Locate the header row carrying all seven Montgomery Review Comments column titles.
 * @returns {{ columns: Record<string, number>, headerRowNum: number } | null}
 */
function findMontgomeryReviewCommentsExcelHeaderGrid(sheet) {
  const MAX_SCAN_ROWS = 120;
  const MAX_SCAN_COL = 48;
  for (let ri = 1; ri <= Math.min(MAX_SCAN_ROWS, sheet.actualRowCount || sheet.rowCount || MAX_SCAN_ROWS); ri++) {
    const row = sheet.getRow(ri);
    /** @type {Record<string, number>} */
    const colMap = {};
    for (let ci = 1; ci <= MAX_SCAN_COL; ci++) {
      const cell = row.getCell(ci);
      const raw =
        typeof cell?.text === "string"
          ? cell.text
          : stringifyReviewCommentsExcelCellValue(cell?.value ?? "");
      const norm = String(raw || "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
      const klass = classifyMontgomeryReviewCommentsGridHeader(norm);
      if (!klass) continue;
      if (colMap[klass]) continue;
      colMap[klass] = ci;
    }
    const filled = ["ref", "cycle", "reviewed_by", "type", "filename", "discussion", "status"].every(
      (key) => colMap[key],
    );
    if (filled) return { columns: colMap, headerRowNum: ri };
  }
  return null;
}

/**
 * @returns {Promise<Array<{ ref: string; cycle: string; reviewed_by: string; type: string; filename: string; discussion: string; status: string }>>}
 */
async function extractReviewCommentsStructuredRowsFromExcelBuffer(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  for (let si = 0; si < wb.worksheets.length; si++) {
    const sheet = wb.worksheets[si];
    if (!sheet) continue;
    const header = findMontgomeryReviewCommentsExcelHeaderGrid(sheet);
    if (!header) continue;
    const { columns } = header;
    const lastRows = Math.max(sheet.actualRowCount ?? 0, sheet.rowCount ?? 0, header.headerRowNum + 500);
    const start = header.headerRowNum + 1;
    const end = Math.min(Math.max(lastRows, header.headerRowNum + 2), 12000);

    const grab = (rk, key) => {
      const c = columns[key];
      if (!c) return "";
      const cell = sheet.getRow(rk).getCell(c);
      return stringifyReviewCommentsExcelCellValue(cell?.value ?? "");
    };

    for (let rk = start; rk <= end; rk++) {
      const refStr = grab(rk, "ref").trim();
      if (!refStr) continue;
      if (!/^\d{1,5}$/.test(refStr)) continue;

      out.push({
        ref: refStr,
        cycle: grab(rk, "cycle").trim(),
        reviewed_by: grab(rk, "reviewed_by").trim(),
        type: grab(rk, "type").trim(),
        filename: grab(rk, "filename").trim(),
        discussion: grab(rk, "discussion").trim(),
        status: grab(rk, "status").trim(),
      });
    }
    if (out.length) break;
  }
  return out;
}

/**
 * @param {string} excelPath
 */
async function extractReviewCommentsStructuredRowsFromExcelFile(excelPath) {
  if (!excelPath || !fs.existsSync(excelPath)) return [];
  return extractReviewCommentsStructuredRowsFromExcelBuffer(fs.readFileSync(excelPath));
}

module.exports = {
  extractReviewCommentsStructuredRowsFromExcelBuffer,
  extractReviewCommentsStructuredRowsFromExcelFile,
};
