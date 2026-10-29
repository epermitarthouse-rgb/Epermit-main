import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessDataset } from "../lib/acceptance.mjs";
import { buildDrawingDataset, parseBenchmarkCases, structurePage, wordingSha256 } from "../lib/buildDataset.mjs";
import { drawingPdf, storedZip } from "./helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fileRow(partial) {
  return {
    relativePath: "A.pdf",
    sha256: "abc",
    format: "pdf",
    bytes: 10,
    processingStatus: "extracted",
    pageCount: 1,
    duplicateOf: null,
    ...partial,
  };
}

describe("acceptance gate", () => {
  it("fails when a walked file or a pdf page is missing", () => {
    const missingFile = assessDataset({
      walkedFiles: 2,
      files: [fileRow({})],
      pages: [{ sha256: "abc", relativePath: "A.pdf", pageNumber: 1, captureClass: "empty_measured", unresolvedCount: 0, flags: [] }],
      unresolvedRegions: [],
      findings: [],
      mappings: [],
    });
    assert.equal(missingFile.accountabilityPassed, false);
    assert.match(missingFile.accountabilityIssues.map((item) => item.message).join(" "), /Walked 2/);

    const missingPage = assessDataset({
      walkedFiles: 1,
      files: [fileRow({ pageCount: 2 })],
      pages: [{ sha256: "abc", relativePath: "A.pdf", pageNumber: 1, captureClass: "empty_measured", unresolvedCount: 0, flags: [] }],
      unresolvedRegions: [],
      findings: [],
      mappings: [],
    });
    assert.equal(missingPage.accountabilityPassed, false);
    assert.match(missingPage.accountabilityIssues.map((item) => item.message).join(" "), /page 2/);
  });

  it("fails when finding wording is not the fixture wording", () => {
    const report = assessDataset({
      walkedFiles: 0,
      files: [],
      pages: [],
      unresolvedRegions: [],
      findings: [{ clientReportId: "W-001" }],
      mappings: [{ clientReportId: "W-001", wordingMatchesFixture: false, matchResult: "unmapped" }],
    });
    assert.equal(report.accountabilityPassed, false);
    assert.equal(report.precision, "Not measured");
    assert.equal(report.recall, "Not measured");
  });

  it("does not call a dataset complete when ink was not read", () => {
    const report = assessDataset({
      walkedFiles: 1,
      files: [fileRow({})],
      pages: [{ sha256: "abc", relativePath: "A.pdf", pageNumber: 1, captureClass: "partial_unread_ink", unresolvedCount: 2, flags: ["unread_ink"] }],
      unresolvedRegions: [
        { sha256: "abc", pageNumber: 1, cell: "r0c0" },
        { sha256: "abc", pageNumber: 1, cell: "r0c1" },
      ],
      findings: [],
      mappings: [],
    });
    assert.equal(report.accountabilityPassed, true);
    assert.equal(report.contentComplete, false);
    assert.equal(report.graphicReadingPerformed, false);
    assert.ok(report.contentIssues.some((item) => item.id.startsWith("ink:")));
  });
});

describe("dataset build on a synthetic set", () => {
  it("keeps the frozen benchmark cases and does not treat them as accuracy labels", async () => {
    const source = await readFile(path.join(repoRoot, "src/lib/supabaseAnalyzer/qualityBenchmark.ts"), "utf8");
    const cases = parseBenchmarkCases(source);
    assert.equal(cases.filter((item) => item.use === "regression" && item.truth === "verified").length, 4);
    assert.equal(cases.filter((item) => item.use === "provisional").length, 7);
    assert.equal(cases.some((item) => item.use === "accuracy"), false);
  });

  it("accounts for corrupt, unexpected, duplicate, multi-page, and unmapped findings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drawing-dataset-"));
    const outDir = path.join(root, "out");
    try {
      const pdf = await drawingPdf();
      await writeFile(path.join(root, "A-1.00-00.pdf"), pdf);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.join(root, "dup"));
      await writeFile(path.join(root, "dup", "A-1.00-00.pdf"), pdf);
      await writeFile(path.join(root, "corrupt.pdf"), Buffer.from("%PDF-1.4\nbroken"));
      await writeFile(path.join(root, "notes.txt"), Buffer.from("skip me not"));
      await writeFile(path.join(root, "Archive.zip"), storedZip([{ name: "A-1.00-00.pdf", data: pdf }]));
      const findingsPath = path.join(root, "findings.json");
      const findings = {
        findings: [
          {
            clientReportId: "W-001",
            sourceFinding: 1,
            severity: "warning",
            discipline: "Architectural",
            sheetNumber: "A-1.00-00",
            sheetTitle: "Plan",
            title: "Width",
            observation: "The note states a clear width.",
            drawingEvidence: "GENERAL NOTES SHALL PROVIDE 36 IN CLEAR WIDTH",
            drawingLocation: "General notes",
            codeReference: null,
            recommendation: "Confirm the note.",
          },
          {
            clientReportId: "W-002",
            sourceFinding: 2,
            severity: "warning",
            discipline: "Architectural",
            sheetNumber: "Z-9.99",
            sheetTitle: "Missing",
            title: "Missing sheet",
            observation: "This identity has no file.",
            drawingEvidence: "No source file was provided for this identity.",
            drawingLocation: "n/a",
            codeReference: null,
            recommendation: "Obtain the sheet.",
          },
        ],
      };
      await writeFile(findingsPath, JSON.stringify(findings));
      const before = await readFile(findingsPath);
      const benchmarkPath = path.join(root, "benchmark.ts");
      await writeFile(benchmarkPath, "export const cases = [];\n");
      const first = await buildDrawingDataset({
        sourceDir: root,
        outDir,
        findingsPath,
        benchmarkPath,
        requireBaselineCounts: false,
      });
      assert.equal(first.assessment.accountabilityPassed, true);
      assert.equal(first.assessment.contentComplete, false);
      assert.equal(first.assessment.precision, "Not measured");
      assert.equal(first.assessment.recall, "Not measured");
      const after = await readFile(findingsPath);
      assert.equal(before.equals(after), true);
      const mapped = JSON.parse(await readFile(path.join(outDir, "finding-map.json"), "utf8"));
      assert.equal(mapped.findings.length, 2);
      const kept = mapped.findings[0];
      assert.equal(kept.wordingSha256, wordingSha256(kept.original));
      assert.equal(kept.original.observation, findings.findings[0].observation);
      assert.equal(kept.labelStatus, "unverified_model_output");
      assert.equal(kept.matchResult, "mapped");
      assert.equal(kept.grounding.status, "span_found");
      assert.equal(mapped.findings[1].matchResult, "unmapped");
      const coverage = await readFile(path.join(outDir, "coverage-report.md"), "utf8");
      assert.match(coverage, /NOT COMPLETE/);
      assert.match(coverage, /Not measured/);
      assert.match(coverage, /corrupt\.pdf/);
      assert.match(coverage, /notes\.txt/);
      assert.match(coverage, /Z-9\.99/);
      const second = await buildDrawingDataset({
        sourceDir: root,
        outDir,
        findingsPath,
        benchmarkPath,
        requireBaselineCounts: false,
      });
      assert.equal(second.assessment.counts.pdfPages, first.assessment.counts.pdfPages);
      assert.equal(second.assessment.counts.unresolvedRegions, first.assessment.counts.unresolvedRegions);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds a structured page without marking relationships verified", () => {
    const structured = structurePage({
      sourceFingerprint: "abc",
      documentId: "abc",
      fileName: "A-1.00-00.pdf",
      sheetNumber: "A-1.00-00",
      pageNumber: 1,
      pageText: "GENERAL NOTES SHALL PROVIDE 36 IN CLEAR",
      graphicalReadStatus: "text-layer",
      evidenceItems: [{
        str: "GENERAL NOTES SHALL PROVIDE 36 IN CLEAR",
        extractionMethod: "pdfjs-text-layer",
        region: { x: 40, y: 48, width: 200, height: 10, unit: "pdf-point", pageWidth: 612, pageHeight: 792 },
      }],
    });
    assert.equal(structured.origin, "machine_extracted");
    assert.equal(structured.independentlyVerified, false);
    assert.equal(structured.document.extraction.status, "partial");
    assert.equal(structured.document.extraction.last_attempt_at, undefined);
    assert.equal(structured.validationOk, true);
  });
});
