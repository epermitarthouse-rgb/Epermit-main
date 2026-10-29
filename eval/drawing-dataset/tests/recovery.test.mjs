import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessDataset } from "../lib/acceptance.mjs";
import { classifyPageCells, graphicKind, rasterFeatures } from "../lib/cellClassify.mjs";
import { buildDrawingDataset, groundEvidence } from "../lib/buildDataset.mjs";
import { groundRecovered, recoverDrawingDataset } from "../lib/recoverDataset.mjs";
import { dedupeOcrWords } from "../lib/ocrRecover.mjs";
import { drawingPdf } from "./helpers.mjs";

describe("cell classification", () => {
  it("does not treat dense fill as missing text", () => {
    assert.equal(graphicKind(0.8, 0.2), "dense_fill");
    assert.equal(graphicKind(0.2, 0.7), "linework");
    const classified = classifyPageCells({
      rasterCells: [
        { cell: "r0c0", row: 0, col: 0, inkRatio: 0.8, edgeRatio: 0.2, hypothesizedGraphicKind: "dense_fill" },
        { cell: "r1c1", row: 1, col: 1, inkRatio: 0.2, edgeRatio: 0.5, hypothesizedGraphicKind: "mixed_graphics" },
        { cell: "r5c7", row: 5, col: 7, inkRatio: 0.2, edgeRatio: 0.5, hypothesizedGraphicKind: "mixed_graphics" },
      ],
      textItems: [],
      ocrWords: [{ text: "A-1.00-00", confidence: 0.9, box: { x: 2500, y: 40, width: 40, height: 10 } }],
      pageWidth: 2592,
      pageHeight: 1728,
      ocrAttempted: true,
    });
    assert.equal(classified[0].remainingUnread, false);
    assert.equal(classified[0].letteringStatus, "none_read");
    assert.equal(classified[1].remainingUnread, true);
    assert.equal(classified[2].zone, "title_block");
    assert.equal(classified[2].letteringStatus, "ocr_recovered");
    assert.deepEqual(classified[2].originNotes, ["visual_interpretation"]);
  });

  it("builds raster features for every grid cell", () => {
    const width = 16;
    const height = 12;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let i = 0; i < data.length; i += 4) {
      if (i / 4 < 8) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
    const cells = rasterFeatures({ data }, width, height);
    assert.equal(cells.length, 48);
  });
});

describe("OCR provenance", () => {
  it("drops overlapping duplicate OCR words and keeps the higher confidence", () => {
    const kept = dedupeOcrWords([
      { text: "NOTES", confidence: 0.6, box: { x: 10, y: 10, width: 40, height: 8 } },
      { text: "NOTES", confidence: 0.9, box: { x: 11, y: 10, width: 40, height: 8 } },
      { text: "x", confidence: 0.2, box: { x: 80, y: 10, width: 8, height: 8 } },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].confidence, 0.9);
  });
});

describe("acceptance after recovery", () => {
  it("requires a cell for every page slot and still does not claim completeness", () => {
    const cells = Array.from({ length: 48 }, (_, index) => ({ cell: `r${Math.floor(index / 8)}c${index % 8}` }));
    const report = assessDataset({
      walkedFiles: 1,
      files: [{ relativePath: "A.pdf", sha256: "abc", format: "pdf", processingStatus: "extracted", pageCount: 1, duplicateOf: null }],
      pages: [{ sha256: "abc", relativePath: "A.pdf", pageNumber: 1, captureClass: "graphics_classified", unresolvedCount: 0, flags: [] }],
      unresolvedRegions: [],
      cells,
      expectedCellsPerPage: 48,
      findings: [],
      mappings: [],
      ocrAttempted: true,
    });
    assert.equal(report.accountabilityPassed, true);
    assert.equal(report.contentComplete, false);
    assert.equal(report.graphicReadingPerformed, true);
    assert.equal(report.precision, "Not measured");
  });
});

describe("recovery over a frozen 2A.1 dataset", () => {
  it("keeps finding wording, classifies the graphic page, and maps OCR separately from the text layer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drawing-recover-"));
    const outDir = path.join(root, "out");
    try {
      await writeFile(path.join(root, "A-1.00-00.pdf"), await drawingPdf());
      const findingsPath = path.join(root, "findings.json");
      const findings = {
        findings: [{
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
        }],
      };
      await writeFile(findingsPath, JSON.stringify(findings));
      const before = await readFile(findingsPath);
      await writeFile(path.join(root, "benchmark.ts"), "export const cases = [];\n");
      await buildDrawingDataset({
        sourceDir: root,
        outDir,
        findingsPath,
        benchmarkPath: path.join(root, "benchmark.ts"),
        requireBaselineCounts: false,
      });
      const recovered = await recoverDrawingDataset({
        sourceDir: root,
        outDir,
        ocr: async () => ({
          engine: "injected",
          words: [{ text: "PARTITION TYPE A", confidence: 0.92, x: 0.2, y: 0.2, width: 0.3, height: 0.05, origin: "bottom-left" }],
        }),
      });
      const after = await readFile(findingsPath);
      assert.equal(before.equals(after), true);
      assert.equal(recovered.assessment.precision, "Not measured");
      assert.equal(recovered.assessment.recall, "Not measured");
      assert.equal(recovered.assessment.contentComplete, false);
      const map = JSON.parse(await readFile(path.join(outDir, "finding-map.json"), "utf8"));
      assert.equal(map.findings[0].original.observation, findings.findings[0].observation);
      assert.equal(map.findings[0].grounding.status, "span_found");
      assert.equal(map.findings[0].grounding.origin, "machine_extracted");
      const cells = (await readFile(path.join(outDir, "classified-cells.jsonl"), "utf8")).trim().split("\n");
      assert.equal(cells.length, 96);
      const pages = JSON.parse(await readFile(path.join(outDir, "pages-manifest.json"), "utf8"));
      assert.equal(pages.length, 2);
      assert.ok(pages.some((page) => page.ocrChars > 0));
      const ocr = (await readFile(path.join(outDir, "ocr-lines.jsonl"), "utf8")).trim();
      assert.match(ocr, /PARTITION TYPE A/);
      assert.match(ocr, /visual_interpretation/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("evidence grounding origins", () => {
  it("keeps a text-layer match distinct from an OCR-only match", () => {
    const text = groundEvidence("GENERAL NOTES SHALL PROVIDE 36 IN CLEAR WIDTH", [{ pageNumber: 1, text: "GENERAL NOTES SHALL PROVIDE 36 IN CLEAR WIDTH" }]);
    assert.equal(text.status, "span_found");
    const missing = groundEvidence("EXISTING STAIR TO REMAIN", [{ pageNumber: 1, text: "GENERAL NOTES" }]);
    assert.equal(missing.status, "span_not_in_extracted_text");
  });

  it("records token overlap as unverified inference, not a quoted span", () => {
    const overlap = groundRecovered(
      "Hydraulic Design box: Flow Demand: 596.81 GPM. Density: 0.15 GPM.",
      [{ pageNumber: 1, text: "TITLE BLOCK" }],
      [{ pageNumber: 1, lines: [{ text: "HYDRAULIC DESIGN FLOW DEMAND 596.81 GPM DENSITY 0.15" }] }],
    );
    assert.equal(overlap.status, "token_overlap");
    assert.equal(overlap.origin, "unverified_inference");
    assert.equal(overlap.independentlyVerified, false);
  });
});
