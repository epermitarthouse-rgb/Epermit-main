import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildDrawingDataset } from "../lib/buildDataset.mjs";
import { cellBox, novelTokens, shouldOcrCell, topLeftToPdfBox } from "../lib/hybridLayout.mjs";
import { recommendExpansion, runHybridPilot } from "../lib/hybridPilot.mjs";
import {
  DEFAULT_PILOT_SHEETS,
  disciplinesCovered,
  inventoryAccountability,
  resolvePilotSheets,
} from "../lib/hybridSelect.mjs";
import { drawingPdf } from "./helpers.mjs";

describe("hybrid pilot selection", () => {
  it("covers the six drawing disciplines and keeps S-204, S-300, and Archive.zip distinct", () => {
    const disciplines = disciplinesCovered();
    assert.deepEqual(disciplines, ["architectural", "electrical", "fire_protection", "mechanical", "plumbing", "structural"]);
    assert.equal(DEFAULT_PILOT_SHEETS.length, 8);
    assert.ok(DEFAULT_PILOT_SHEETS.some((sheet) => sheet.relativePath === "S-204.00.pdf"));
    assert.ok(DEFAULT_PILOT_SHEETS.some((sheet) => sheet.relativePath === "S-300.00.pdf"));
    const inventory = {
      walkedFiles: 83,
      files: [
        { relativePath: "A-1.00-00.pdf", format: "pdf", processingStatus: "extracted", sha256: "a" },
        { relativePath: "S-204.00.pdf", format: "pdf", processingStatus: "extracted", sha256: "b" },
        { relativePath: "S-300.00.pdf", format: "pdf", processingStatus: "extracted", sha256: "c" },
        { relativePath: "Archive.zip", format: "zip", processingStatus: "container_indexed" },
      ],
    };
    const account = inventoryAccountability({
      walkedFiles: 83,
      files: [
        ...inventory.files,
        ...Array.from({ length: 79 }, (_, index) => ({
          relativePath: `X-${index}.pdf`,
          format: "pdf",
          processingStatus: "extracted",
        })),
      ],
    });
    assert.equal(account.pdfCount, 82);
    assert.equal(account.requiredPresent, true);
    assert.equal(account.zipStatus, "container_indexed");
    const resolved = resolvePilotSheets(inventory, DEFAULT_PILOT_SHEETS.filter((sheet) => sheet.relativePath === "S-204.00.pdf"));
    assert.equal(resolved[0].present, true);
  });
});

describe("hybrid layout helpers", () => {
  it("converts top-left boxes to PDF user space and skips linework for OCR", () => {
    const box = topLeftToPdfBox({ x: 10, y: 20, width: 30, height: 8 }, 1728);
    assert.equal(box.origin, "bottom-left");
    assert.equal(box.y, 1700);
    assert.equal(shouldOcrCell({ hypothesizedGraphicKind: "linework" }), false);
    assert.equal(shouldOcrCell({ hypothesizedGraphicKind: "linework" }, { tinyFill: 20 }), true);
    assert.equal(shouldOcrCell({ hypothesizedGraphicKind: "dense_fill" }), false);
    assert.equal(shouldOcrCell({ hypothesizedGraphicKind: "empty" }), false);
    assert.equal(shouldOcrCell({ hypothesizedGraphicKind: "mixed_graphics" }), true);
    const cell = cellBox(0, 0, 800, 600);
    assert.equal(cell.id, "r0c0");
    assert.ok(cell.y > 400);
  });

  it("counts only tokens that are new against the baseline text", () => {
    const novel = novelTokens("GENERAL NOTES SCALE", "GENERAL NOTES PARTITION TYPE A CLEAR WIDTH");
    assert.deepEqual(novel, ["partition", "type", "clear", "width"]);
  });
});

describe("hybrid recommendation", () => {
  it("does not send all 82 sheets through Docling when layout recovery failed", () => {
    const hold = recommendExpansion({
      sheets: [
        { discipline: "architectural", baselineUnread: 37, remainingUnread: 37, novelOcrTokenCount: 0, ocrAttempted: true, doclingStatus: "failed" },
        { discipline: "mechanical", baselineUnread: 36, remainingUnread: 36, novelOcrTokenCount: 0, ocrAttempted: true, doclingStatus: "failed" },
      ],
      grounding: { baselineMatched: 0, hybridMatched: 0 },
      performance: { averageSheetMs: 1000 },
    });
    assert.equal(hold.decision, "do_not_expand_yet");
    assert.equal(hold.expandDocling, false);
    assert.equal(hold.precision, "Not measured");

    const expand = recommendExpansion({
      sheets: [
        { discipline: "architectural", baselineUnread: 37, remainingUnread: 4, novelOcrTokenCount: 20, ocrAttempted: true, doclingStatus: "ok", doclingMode: "parse" },
        { discipline: "mechanical", baselineUnread: 36, remainingUnread: 5, novelOcrTokenCount: 12, ocrAttempted: true, doclingStatus: "ok", doclingMode: "parse" },
      ],
      grounding: { baselineMatched: 0, hybridMatched: 2 },
      performance: { averageSheetMs: 8000 },
    });
    assert.equal(expand.decision, "expand_targeted_ocr_to_82");
    assert.equal(expand.expandDocling, false);
  });
});

describe("hybrid pilot over a frozen 2A.1 dataset", () => {
  it("keeps finding wording, writes isolated outputs, and does not treat fill as missing text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hybrid-pilot-"));
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
      await writeFile(path.join(root, "benchmark.ts"), "export const cases = [];\n");
      await buildDrawingDataset({
        sourceDir: root,
        outDir,
        findingsPath,
        benchmarkPath: path.join(root, "benchmark.ts"),
        requireBaselineCounts: false,
      });
      const before = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      const recovered = await runHybridPilot({
        sourceDir: root,
        outDir,
        skipDocling: true,
        sheets: [{ relativePath: "A-1.00-00.pdf", discipline: "architectural", reason: "test fixture" }],
        extractFn: async () => ({
          engine: "pymupdf",
          pages: [
            {
              pageNumber: 1,
              pageWidth: 612,
              pageHeight: 792,
              text: "A-1.00-00 GENERAL NOTES SHALL PROVIDE 36 IN CLEAR WIDTH",
              spans: [{
                text: "PYMUPDF ONLY TOKEN",
                bbox: { x: 40, y: 48, width: 80, height: 10, unit: "pdf-point", origin: "bottom-left" },
                extractionMethod: "pymupdf-text",
                origin: "machine_extracted",
              }],
              drawings: { count: 4, fill: 1, tinyFill: 0, cells: {}, largeRegions: [] },
              images: [],
              annotations: [],
              docling: { status: "skipped", mode: "off", items: [], tables: [] },
            },
            {
              pageNumber: 2,
              pageWidth: 612,
              pageHeight: 792,
              text: "",
              spans: [],
              drawings: { count: 1, fill: 1, tinyFill: 0, cells: {}, largeRegions: [] },
              images: [],
              annotations: [],
              docling: { status: "skipped", mode: "off" },
            },
          ],
        }),
        ocr: async () => ({
          engine: "injected",
          words: [{ text: "PARTITION TYPE A", confidence: 0.92, x: 0.2, y: 0.2, width: 0.3, height: 0.05, origin: "bottom-left" }],
        }),
      });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(recovered.findingsUnchanged, true);
      assert.equal(recovered.summary.precision, "Not measured");
      assert.equal(recovered.summary.grounding.findings, 1);
      const map = JSON.parse(await readFile(path.join(outDir, "hybrid-pilot/finding-grounding.json"), "utf8"));
      assert.equal(map.findings[0].original.observation, findings.findings[0].observation);
      assert.equal(map.findings[0].hybridGrounding.origin, "machine_extracted");
      const comparison = await readFile(path.join(outDir, "hybrid-pilot/comparison.md"), "utf8");
      assert.match(comparison, /NOT COMPLETE/);
      assert.match(comparison, /A-1.00-00.pdf/);
      const manifest = JSON.parse(await readFile(path.join(outDir, "hybrid-pilot/pages-manifest.json"), "utf8"));
      assert.equal(manifest.length, 2);
      const layoutFiles = JSON.parse(await readFile(path.join(outDir, "files", `${manifest[0].sha256}.json`), "utf8"));
      assert.equal(layoutFiles.pages.length, 2);
      const saved = JSON.parse(await readFile(path.join(outDir, "hybrid-pilot/pages", `${manifest[0].sha256}.json`), "utf8"));
      assert.ok(saved.pages[0].blocks.some((block) => block.extractionMethod === "pymupdf-text"));
      assert.ok(saved.pages[0].blocks.some((block) => block.origin === "machine_extracted"));
      assert.equal(saved.pages.every((page) => page.independentlyVerified === false), true);
      assert.match(saved.pages[0].provenancePolicy, /professionally verified/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
