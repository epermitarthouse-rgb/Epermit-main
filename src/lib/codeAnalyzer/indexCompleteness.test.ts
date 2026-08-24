import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actualLabelsFromSheets,
  compareIndexCompleteness,
  isLikelyIndexSheet,
  normalizeSheetNumber,
  parseIndexEntriesFromText,
  runIndexCompletenessPrescreen,
  inferSheetNumberFromLabel,
  type ActualSheetLabel,
  type IndexSheetEntry,
} from "./indexCompleteness.ts";
import type { CodeAnalyzerSheet } from "./model.ts";

function sheet(partial: Partial<CodeAnalyzerSheet> & { id: string }): CodeAnalyzerSheet {
  return {
    project_id: "p1",
    source_document_id: partial.source_document_id ?? "src-1",
    image_document_id: null,
    page_number: partial.page_number ?? 1,
    file_name: partial.file_name ?? "A-101.pdf",
    excluded: partial.excluded ?? false,
    created_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("normalizeSheetNumber", () => {
  it("treats separator variants as equivalent", () => {
    assert.equal(normalizeSheetNumber("A-101"), "A101");
    assert.equal(normalizeSheetNumber("A 101"), "A101");
    assert.equal(normalizeSheetNumber("a101"), "A101");
  });
});

describe("parseIndexEntriesFromText", () => {
  it("parses tabular index rows", () => {
    const text = `DRAWING INDEX
A-101  First Floor Plan
A-102  Second Floor Plan
A-201  Roof Plan`;
    const entries = parseIndexEntriesFromText(text);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]?.sheetNumber, "A101");
    assert.equal(entries[1]?.title, "Second Floor Plan");
  });
});

describe("compareIndexCompleteness", () => {
  const expected: IndexSheetEntry[] = [
    { sheetNumber: "A101", rawLabel: "A-101", title: "Floor Plan" },
    { sheetNumber: "A102", rawLabel: "A-102", title: "Roof" },
  ];

  it("reports complete on exact match with normalized equivalents", () => {
    const actual: ActualSheetLabel[] = [
      { sheetId: "s1", sheetNumber: "A101", rawLabel: "A101", sourceDocumentId: "d1", pageNumber: 1 },
      { sheetId: "s2", sheetNumber: "A102", rawLabel: "A-102", sourceDocumentId: "d2", pageNumber: 1 },
    ];
    const result = compareIndexCompleteness(expected, actual);
    assert.equal(result.status, "complete");
    assert.equal(result.missing.length, 0);
    assert.equal(result.extra.length, 0);
  });

  it("reports missing sheets", () => {
    const actual: ActualSheetLabel[] = [
      { sheetId: "s1", sheetNumber: "A101", rawLabel: "A-101", sourceDocumentId: "d1", pageNumber: 1 },
    ];
    const result = compareIndexCompleteness(expected, actual);
    assert.equal(result.status, "incomplete");
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]?.sheetNumber, "A102");
  });

  it("reports extra sheets", () => {
    const actual: ActualSheetLabel[] = [
      { sheetId: "s1", sheetNumber: "A101", rawLabel: "A-101", sourceDocumentId: "d1", pageNumber: 1 },
      { sheetId: "s2", sheetNumber: "A102", rawLabel: "A-102", sourceDocumentId: "d2", pageNumber: 1 },
      { sheetId: "s3", sheetNumber: "A103", rawLabel: "A-103", sourceDocumentId: "d3", pageNumber: 1 },
    ];
    const result = compareIndexCompleteness(expected, actual);
    assert.equal(result.extra.length, 1);
    assert.equal(result.extra[0]?.sheetNumber, "A103");
  });

  it("reports duplicate sheet numbers", () => {
    const actual: ActualSheetLabel[] = [
      { sheetId: "s1", sheetNumber: "A101", rawLabel: "A-101", sourceDocumentId: "d1", pageNumber: 1 },
      { sheetId: "s2", sheetNumber: "A101", rawLabel: "A101", sourceDocumentId: "d2", pageNumber: 1 },
      { sheetId: "s3", sheetNumber: "A102", rawLabel: "A-102", sourceDocumentId: "d3", pageNumber: 1 },
    ];
    const result = compareIndexCompleteness(expected, actual);
    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0]?.sheetIds.length, 2);
  });
});

describe("runIndexCompletenessPrescreen", () => {
  it("returns no_index when no index sheet is present", () => {
    const sheets = [
      sheet({ id: "s1", file_name: "A-101.pdf", sheet_label: "A-101" }),
      sheet({ id: "s2", file_name: "A-102.pdf", sheet_label: "A-102" }),
    ];
    const result = runIndexCompletenessPrescreen(sheets);
    assert.equal(result.status, "no_index");
    assert.equal(result.hasIndex, false);
  });

  it("detects index sheet and compares against uploaded labels", () => {
    const sheets = [
      sheet({ id: "idx", file_name: "Drawing Index.pdf" }),
      sheet({ id: "s1", file_name: "A-101.pdf", sheet_label: "A-101" }),
      sheet({ id: "s2", file_name: "A-102.pdf", sheet_label: "A-102" }),
    ];
    const indexText = `Drawing Index
A-101  First Floor
A-102  Second Floor`;
    const result = runIndexCompletenessPrescreen(sheets, {
      pageTextBySheetId: { idx: indexText },
    });
    assert.equal(result.hasIndex, true);
    assert.equal(result.status, "complete");
    assert.equal(result.expectedCount, 2);
  });

  it("E: detects Riverside mock index filename with G000 label (underscores in filename)", () => {
    const sheets = [
      sheet({
        id: "idx",
        file_name: "Riverside_MOCK_Drawing_Index_UAT-page1.png",
        sheet_label: "G000",
      }),
      sheet({ id: "s1", file_name: "A-101.pdf", sheet_label: "A-101" }),
      sheet({ id: "s2", file_name: "A-102.pdf", sheet_label: "A-102" }),
    ];
    const indexText = `DRAWING INDEX
G000  Cover
A-101  First Floor
A-102  Second Floor`;
    const result = runIndexCompletenessPrescreen(sheets, {
      pageTextBySheetId: { idx: indexText },
    });
    assert.equal(result.hasIndex, true);
    assert.equal(result.indexSheetId, "idx");
    assert.equal(result.expectedCount, 3);
  });
});

describe("inferSheetNumberFromLabel", () => {
  it("extracts numeric-only sheet numbers from labels", () => {
    assert.equal(inferSheetNumberFromLabel("001-COVER SHEET"), "001");
    assert.equal(inferSheetNumberFromLabel("G000"), "G000");
    assert.equal(inferSheetNumberFromLabel("A-101 First Floor"), "A101");
  });
});

describe("compareIndexCompleteness — Riverside UAT mock", () => {
  it("matches G000/001/002/003 uploads; missing only A009 and S003", () => {
    const indexText = `DRAWING INDEX
G000  Cover
001  Cover Sheet
002  Site Plan
003  Code Summary
A001  Floor Plan L1
A002  Floor Plan L2
A003  Floor Plan L3
A004  Floor Plan L4
A005  Floor Plan L5
A006  Floor Plan L6
A007  Floor Plan L7
A008  Floor Plan L8
A009  Floor Plan L9
S001  Sections
S002  Sections
S003  Sections`;

    const expected = parseIndexEntriesFromText(indexText);
    const actual: ActualSheetLabel[] = [
      { sheetId: "idx", sheetNumber: "G000", rawLabel: "G000", sourceDocumentId: "d0", pageNumber: 1 },
      { sheetId: "s001", sheetNumber: "001", rawLabel: "001-COVER SHEET", sourceDocumentId: "d1", pageNumber: 1 },
      { sheetId: "s002", sheetNumber: "002", rawLabel: "002-SITE PLAN", sourceDocumentId: "d2", pageNumber: 1 },
      { sheetId: "s003", sheetNumber: "003", rawLabel: "003-CODE SUMMARY", sourceDocumentId: "d3", pageNumber: 1 },
      ...["A001", "A002", "A003", "A004", "A005", "A006", "A007", "A008"].map((n, i) => ({
        sheetId: `a${i}`,
        sheetNumber: n,
        rawLabel: n,
        sourceDocumentId: `da${i}`,
        pageNumber: 1,
      })),
      { sheetId: "s1", sheetNumber: "S001", rawLabel: "S001", sourceDocumentId: "ds1", pageNumber: 1 },
      { sheetId: "s2", sheetNumber: "S002", rawLabel: "S002", sourceDocumentId: "ds2", pageNumber: 1 },
    ];

    const result = compareIndexCompleteness(expected, actual, { indexSheetId: "idx" });
    const missingNumbers = result.missing.map((m) => m.sheetNumber).sort();
    assert.deepEqual(missingNumbers, ["A009", "S003"]);
    assert.ok(result.extra.length >= 0);
  });
});

describe("isLikelyIndexSheet", () => {
  it("matches Drawing_Index with underscores in filename", () => {
    assert.equal(
      isLikelyIndexSheet({
        fileName: "Riverside_MOCK_Drawing_Index_UAT-page1.png",
        sheetLabel: "G000",
      }),
      true,
    );
  });
});
