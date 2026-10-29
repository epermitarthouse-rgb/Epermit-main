import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyTitleBlockConfirmation,
  canonicalSheetKey,
  matchSourceFiles,
  titleBlockTokens,
  upgradeUnmatchedFromTitleBlock,
} from "../lib/identity.mjs";

describe("sheet identity", () => {
  it("normalizes a trailing zero suffix without merging dotted sheet numbers", () => {
    assert.equal(canonicalSheetKey("EN-1.00-0.pdf").stripped, "EN-1.00");
    assert.equal(canonicalSheetKey("EN-1.00-00").stripped, "EN-1.00");
    assert.equal(canonicalSheetKey("P-1.0-00.pdf").stripped, "P-1.0");
    assert.equal(canonicalSheetKey("P-1.0").stripped, "P-1.0");
    assert.equal(canonicalSheetKey("FP200 .pdf").raw, "FP200");
    assert.equal(canonicalSheetKey("S-300.00.pdf").stripped, "S-300.00");
    assert.equal(canonicalSheetKey("A-1.00-00").raw, "A-1.00-00");
  });

  it("prefers an exact filename match over a suffix collision", () => {
    const files = [
      { relativePath: "P-1.1-00.pdf", filename: "P-1.1-00.pdf" },
      { relativePath: "P-1.1.pdf", filename: "P-1.1.pdf" },
    ];
    const identities = [
      { sheetNumber: "P-1.1-00", sheetTitle: "Long" },
      { sheetNumber: "P-1.1", sheetTitle: "Short" },
    ];
    const { fileMatches } = matchSourceFiles(files, identities);
    assert.equal(fileMatches[0].method, "filename_exact");
    assert.equal(fileMatches[0].sheetNumber, "P-1.1-00");
    assert.equal(fileMatches[1].sheetNumber, "P-1.1");
  });

  it("matches the run 649fdaa6 filename variants and leaves S-300 unmatched", () => {
    const files = [
      { relativePath: "EN-1.00-0.pdf", filename: "EN-1.00-0.pdf" },
      { relativePath: "P-1.0-00.pdf", filename: "P-1.0-00.pdf" },
      { relativePath: "FP200 .pdf", filename: "FP200 .pdf" },
      { relativePath: "S-204.00.pdf", filename: "S-204.00.pdf" },
      { relativePath: "S-300.00.pdf", filename: "S-300.00.pdf" },
    ];
    const identities = [
      { sheetNumber: "EN-1.00-00", sheetTitle: "Energy" },
      { sheetNumber: "P-1.0", sheetTitle: "Plumbing" },
      { sheetNumber: "FP200", sheetTitle: "Hydraulic" },
      { sheetNumber: "S-204.00", sheetTitle: "Sections" },
      { sheetNumber: "S-204.00", sheetTitle: "Special inspections" },
    ];
    const { fileMatches, unmatchedSheets } = matchSourceFiles(files, identities);
    const byFile = new Map(fileMatches.map((match) => [match.filename, match]));
    assert.equal(byFile.get("EN-1.00-0.pdf").method, "filename_suffix_normalized");
    assert.equal(byFile.get("EN-1.00-0.pdf").sheetNumber, "EN-1.00-00");
    assert.equal(byFile.get("P-1.0-00.pdf").sheetNumber, "P-1.0");
    assert.equal(byFile.get("FP200 .pdf").method, "filename_exact");
    assert.equal(byFile.get("S-204.00.pdf").identityCount, 2);
    assert.equal(byFile.get("S-300.00.pdf").method, "unmatched_file");
    assert.deepEqual(unmatchedSheets, []);
  });

  it("does not pick a sheet when two suffix keys collide", () => {
    const { fileMatches } = matchSourceFiles(
      [{ relativePath: "A-1.pdf", filename: "A-1.pdf" }],
      [
        { sheetNumber: "A-1-00", sheetTitle: "One" },
        { sheetNumber: "A-1-0", sheetTitle: "Two" },
      ],
    );
    assert.equal(fileMatches[0].method, "filename_suffix_ambiguous");
    assert.equal(fileMatches[0].sheetNumber, null);
  });

  it("reads title-block tokens from the bottom and right bands only", () => {
    const tokens = titleBlockTokens([
      { text: "SEE A-9.99", x: 20, y: 700 },
      { text: "A-1.00-00", x: 400, y: 30 },
    ], 500, 800);
    assert.deepEqual(tokens, ["A-1.00-00"]);
  });

  it("does not let a title-block token override a filename match", () => {
    const confirmed = applyTitleBlockConfirmation({
      relativePath: "A-1.00-00.pdf",
      filename: "A-1.00-00.pdf",
      sheetNumber: "A-1.00-00",
      method: "filename_exact",
      ambiguous: false,
      candidateSheetNumbers: ["A-1.00-00"],
      identityCount: 1,
    }, ["M-1.1"]);
    assert.equal(confirmed.sheetNumber, "A-1.00-00");
    assert.equal(confirmed.method, "filename_exact");
    assert.equal(confirmed.titleBlockStatus, "filename_sheet_not_in_title_block_text");
  });

  it("does not retarget a filename sheet id when the title block names a different sheet", () => {
    const base = applyTitleBlockConfirmation({
      relativePath: "S-300.00.pdf",
      filename: "S-300.00.pdf",
      sheetNumber: null,
      method: "unmatched_file",
      ambiguous: false,
      candidateSheetNumbers: [],
      identityCount: 0,
    }, ["S-204.00"]);
    const groups = [{
      sheetNumber: "S-204.00",
      key: canonicalSheetKey("S-204.00"),
      identities: [{ sheetNumber: "S-204.00" }, { sheetNumber: "S-204.00" }],
    }];
    const upgraded = upgradeUnmatchedFromTitleBlock(base, groups);
    assert.equal(upgraded.method, "unmatched_file");
    assert.equal(upgraded.sheetNumber, null);
    assert.equal(upgraded.titleBlockStatus, "filename_sheet_not_in_analyzed_set");
    assert.deepEqual(upgraded.titleBlockTokens, ["S-204.00"]);
  });

  it("can fill an unmatched file from one title-block token", () => {
    const base = applyTitleBlockConfirmation({
      relativePath: "ORPHAN.pdf",
      filename: "ORPHAN.pdf",
      sheetNumber: null,
      method: "unmatched_file",
      ambiguous: false,
      candidateSheetNumbers: [],
      identityCount: 0,
    }, ["FP200"]);
    const groups = [{
      sheetNumber: "FP200",
      key: canonicalSheetKey("FP200"),
      identities: [{ sheetNumber: "FP200" }],
    }];
    const upgraded = upgradeUnmatchedFromTitleBlock(base, groups);
    assert.equal(upgraded.method, "title_block_text");
    assert.equal(upgraded.sheetNumber, "FP200");
  });
});
