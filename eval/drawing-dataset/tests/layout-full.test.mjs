import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDrawingDataset } from "../lib/buildDataset.mjs";
import {
  recommendFullLayoutReadiness,
  runLayoutFull,
} from "../lib/layoutPilot.mjs";
import { paraphraseRegionCandidates } from "../lib/layoutSemanticPrep.mjs";
import {
  DISCIPLINE_VALIDATION_SAMPLES,
  disciplineFromFilename,
  listAllLayoutSheets,
  resolveValidationSamples,
} from "../lib/layoutSelect.mjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { storedZip } from "./helpers.mjs";

async function uniqueDrawingPdf(label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText(label, { x: 430, y: 36, size: 12, font });
  page.drawText("GENERAL NOTES SHALL PROVIDE 36 IN CLEAR WIDTH", { x: 40, y: 48, size: 11, font });
  return Buffer.from(await doc.save());
}

describe("layout full selection", () => {
  it("lists every extracted PDF and keeps Archive.zip out of the sheet set", () => {
    const inventory = {
      walkedFiles: 4,
      files: [
        { relativePath: "A-1.00-00.pdf", format: "pdf", sha256: "a", processingStatus: "extracted" },
        { relativePath: "S-204.00.pdf", format: "pdf", sha256: "b", processingStatus: "extracted" },
        { relativePath: "S-300.00.pdf", format: "pdf", sha256: "c", processingStatus: "extracted" },
        { relativePath: "Archive.zip", format: "zip", sha256: "d", processingStatus: "listed_not_unpacked" },
      ],
    };
    const sheets = listAllLayoutSheets(inventory);
    assert.equal(sheets.length, 3);
    assert.ok(sheets.every((sheet) => sheet.relativePath.endsWith(".pdf")));
    assert.equal(disciplineFromFilename("FP200 .pdf"), "fire_protection");
    assert.equal(disciplineFromFilename("EQ-1.00-0.pdf"), "equipment");
    const samples = resolveValidationSamples(inventory);
    assert.ok(samples.some((sample) => sample.relativePath === "S-204.00.pdf" && sample.present));
    assert.ok(DISCIPLINE_VALIDATION_SAMPLES.length >= 8);
  });
});

describe("semantic prep does not claim grounding", () => {
  it("ranks paraphrase candidates without verified status", () => {
    const prep = paraphraseRegionCandidates(
      "Provide clear width at the door opening per code",
      [
        { text: "DOOR OPENING SHALL HAVE CLEAR WIDTH", regionId: "band-notes", regionKind: "notes_band", origin: "visual_interpretation" },
        { text: "TITLE ONLY", regionId: "band-title-block", regionKind: "title_block" },
      ],
      { minSharedTokens: 2 },
    );
    assert.equal(prep.groundingClaimed, false);
    assert.equal(prep.independentlyVerified, false);
    assert.equal(prep.status, "paraphrase_token_overlap_candidate");
    assert.ok(prep.candidates.length >= 1);
    assert.notEqual(prep.status, "span_found_in_region");
  });
});

describe("full layout readiness gate", () => {
  it("requires 82 processed overlays and preserved identities before 2A.5 prep readiness", () => {
    const baseSheets = Array.from({ length: 82 }, (_, index) => ({
      relativePath: `X-${index}.pdf`,
      status: "processed",
      regionCount: 5,
      associatedBlocks: 10,
      overlayWritten: true,
      explicitRelationshipCandidates: index < 5 ? 1 : 0,
    }));
    baseSheets[0].relativePath = "S-204.00.pdf";
    baseSheets[1].relativePath = "S-300.00.pdf";
    const ready = recommendFullLayoutReadiness({
      coverage: {
        pdfFiles: 82,
        sheetsProcessed: 82,
        sheetsWithOverlays: 82,
        sheetsWithRegions: 82,
        sheetsRequested: 82,
        sheetsFailed: 0,
      },
      failures: [],
      accountability: {
        findings: 252,
        findingsUnchanged: true,
        s204IdentityCount: 2,
        s300MatchMethod: "unmatched_file",
      },
      toolsUsed: ["opencv"],
      toolsSkipped: [],
    });
    assert.equal(ready.decision, "layout_full_ready_for_2a5_prep");
    assert.equal(ready.startPhase2A5, false);
    assert.equal(ready.precision, "Not measured");

    const blocked = recommendFullLayoutReadiness({
      coverage: {
        pdfFiles: 82,
        sheetsProcessed: 80,
        sheetsWithOverlays: 80,
        sheetsWithRegions: 80,
        sheetsRequested: 82,
        sheetsFailed: 2,
      },
      failures: [{ relativePath: "A.pdf" }, { relativePath: "B.pdf" }],
      accountability: {
        findings: 252,
        findingsUnchanged: true,
        s204IdentityCount: 2,
        s300MatchMethod: "unmatched_file",
      },
      toolsUsed: [],
      toolsSkipped: [],
    });
    assert.equal(blocked.decision, "layout_full_needs_attention");
  });
});

describe("layout full over a frozen mini dataset", () => {
  it("processes every PDF, writes overlays and semantic prep, and leaves findings unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "layout-full-"));
    const outDir = path.join(root, "out");
    try {
      await writeFile(path.join(root, "A-1.00-00.pdf"), await uniqueDrawingPdf("A-1"));
      await writeFile(path.join(root, "S-204.00.pdf"), await uniqueDrawingPdf("S-204"));
      await writeFile(path.join(root, "S-300.00.pdf"), await uniqueDrawingPdf("S-300"));
      await writeFile(path.join(root, "Archive.zip"), storedZip([{ name: "nested.pdf", data: "placeholder" }]));
      const findingsPath = path.join(root, "findings.json");
      await writeFile(findingsPath, JSON.stringify({
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
      }));
      await writeFile(path.join(root, "benchmark.ts"), "export const cases = [];\n");
      await buildDrawingDataset({
        sourceDir: root,
        outDir,
        findingsPath,
        benchmarkPath: path.join(root, "benchmark.ts"),
        requireBaselineCounts: false,
      });
      // Dual-title / unmatched methods are fixture-driven in the real set; for the mini
      // dataset we only assert the layout runner preserves finding-map bytes and writes outputs.
      const before = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      const layoutStub = async (_pdf, outPath, overlayPath) => {
        const record = {
          pageNumber: 1,
          pageWidth: 612,
          pageHeight: 792,
          regions: [
            { id: "band-title-block", kind: "title_block", bbox: { x: 400, y: 0, width: 212, height: 792 } },
            { id: "band-bottom-notes", kind: "notes_band", bbox: { x: 0, y: 0, width: 400, height: 200 } },
            { id: "band-drawing-field", kind: "drawing_field", bbox: { x: 0, y: 200, width: 400, height: 592 } },
          ],
          overlayPath,
          timingMs: 5,
        };
        await writeFile(outPath, JSON.stringify(record));
        await writeFile(overlayPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        return null;
      };
      const result = await runLayoutFull({
        sourceDir: root,
        outDir,
        layoutFn: layoutStub,
      });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(result.findingsUnchanged, true);
      assert.equal(result.summary.precision, "Not measured");
      assert.equal(result.summary.sheets.length, 3);
      assert.equal(result.summary.coverage.sheetsProcessed, 3);
      assert.equal(result.summary.coverage.sheetsWithOverlays, 3);
      assert.ok(existsSync(path.join(outDir, "layout-full/semantic-prep.json")));
      assert.ok(existsSync(path.join(outDir, "layout-full/coverage.json")));
      assert.ok(existsSync(path.join(outDir, "layout-full/reconciliation-layout.md")));
      const semantic = JSON.parse(await readFile(path.join(outDir, "layout-full/semantic-prep.json"), "utf8"));
      assert.equal(semantic.groundingClaimed, false);
      assert.equal(result.summary.grounding.groundingImprovedClaim, false);

      // Resume path: second run should use page cache without rewriting finding-map.
      const resumed = await runLayoutFull({
        sourceDir: root,
        outDir,
        layoutFn: async () => {
          throw new Error("layoutFn should not run on page cache hit");
        },
      });
      assert.equal(resumed.summary.sheets.every((sheet) => sheet.status === "cached"), true);
      assert.equal(createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex"), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
