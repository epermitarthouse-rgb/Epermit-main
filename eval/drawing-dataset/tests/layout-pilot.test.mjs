import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDrawingDataset } from "../lib/buildDataset.mjs";
import {
  associateBlocksToRegions,
  clusterTextBlocks,
  groundEvidenceInRegions,
  proposeRelationships,
} from "../lib/layoutAssociate.mjs";
import { recommendLayoutExpansion, runLayoutPilot } from "../lib/layoutPilot.mjs";
import { DEFAULT_LAYOUT_SHEETS, resolveLayoutSheets } from "../lib/layoutSelect.mjs";
import { drawingPdf } from "./helpers.mjs";

describe("layout pilot selection", () => {
  it("keeps the five requested sheets including FP200 with its spaced filename", () => {
    assert.equal(DEFAULT_LAYOUT_SHEETS.length, 5);
    assert.ok(DEFAULT_LAYOUT_SHEETS.some((sheet) => sheet.relativePath === "FP200 .pdf"));
    assert.ok(DEFAULT_LAYOUT_SHEETS.some((sheet) => sheet.relativePath === "S-204.00.pdf"));
    const resolved = resolveLayoutSheets({
      files: [{ relativePath: "S-204.00.pdf", sha256: "abc", processingStatus: "extracted" }],
    }, DEFAULT_LAYOUT_SHEETS.filter((sheet) => sheet.relativePath === "S-204.00.pdf"));
    assert.equal(resolved[0].present, true);
  });
});

describe("layout association rules", () => {
  it("associates text by containment and does not invent proximity relationships", () => {
    const regions = [
      { id: "band-title-block", kind: "title_block", bbox: { x: 400, y: 0, width: 200, height: 800 } },
      { id: "band-drawing-field", kind: "drawing_field", bbox: { x: 0, y: 200, width: 400, height: 600 } },
      { id: "band-bottom-notes", kind: "notes_band", bbox: { x: 0, y: 0, width: 400, height: 200 } },
    ];
    const blocks = [
      { kind: "text_span", text: "A-1.00-00", bbox: { x: 420, y: 40, width: 40, height: 10 }, origin: "machine_extracted", extractionMethod: "pdfjs-text-layer" },
      { kind: "ocr_line", text: "12. BACKSHELF TYPE EXHAUST HOOD", bbox: { x: 20, y: 40, width: 180, height: 12 }, origin: "visual_interpretation", extractionMethod: "macos-vision" },
      { kind: "ocr_line", text: "12", bbox: { x: 80, y: 400, width: 10, height: 10 }, origin: "visual_interpretation", extractionMethod: "macos-vision" },
      { kind: "ocr_line", text: "SEE DETAIL A-3.04", bbox: { x: 90, y: 420, width: 80, height: 10 }, origin: "visual_interpretation", extractionMethod: "macos-vision" },
    ];
    const associations = associateBlocksToRegions(blocks, regions);
    assert.equal(associations[0].regionKind, "title_block");
    assert.equal(associations[1].regionKind, "notes_band");
    assert.equal(associations[2].regionKind, "drawing_field");

    const clusters = clusterTextBlocks(blocks);
    assert.ok(clusters.length >= 1);
    const relationships = proposeRelationships({ clusters, associations, regions, relativePath: "A-1.00-00.pdf" });
    assert.ok(relationships.some((item) => item.type === "sheet_reference"));
    assert.ok(relationships.some((item) => item.type === "note_number_to_callout"));
    assert.equal(relationships.every((item) => item.verificationStatus === "candidate"), true);
    assert.equal(relationships.every((item) => item.independentlyVerified === false), true);

    const nearOnly = proposeRelationships({
      clusters: [{ id: "c0", kind: "text_cluster", text: "DUCT", bbox: { x: 10, y: 10, width: 20, height: 10 } }],
      associations: [
        { regionId: "band-drawing-field", regionKind: "drawing_field", text: "DUCT", bbox: { x: 12, y: 12, width: 20, height: 10 } },
        { regionId: "band-drawing-field", regionKind: "drawing_field", text: "HOOD", bbox: { x: 40, y: 14, width: 20, height: 10 } },
      ],
      regions,
      relativePath: "M-3.0.pdf",
    });
    assert.equal(nearOnly.some((item) => item.type === "note_number_to_callout"), false);
  });

  it("grounds evidence inside associated region text without claiming verification", () => {
    const hit = groundEvidenceInRegions("BACKSHELF TYPE EXHAUST HOOD", [
      { text: "12. BACKSHELF TYPE EXHAUST HOOD", regionId: "band-bottom-notes", regionKind: "notes_band", origin: "visual_interpretation" },
    ]);
    assert.equal(hit.status, "span_found_in_region");
    assert.equal(hit.independentlyVerified, false);
    const miss = groundEvidenceInRegions("NO SUCH EVIDENCE SPAN HERE", [
      { text: "TITLE BLOCK ONLY", regionId: "band-title-block", regionKind: "title_block" },
    ]);
    assert.equal(miss.status, "span_not_in_region_text");
  });
});

describe("layout recommendation", () => {
  it("holds expansion when overlays or associations are weak", () => {
    const hold = recommendLayoutExpansion({
      sheets: [
        { regionCount: 1, associatedBlocks: 0, relationshipCandidates: 0, explicitRelationshipCandidates: 0, overlayWritten: false },
        { regionCount: 1, associatedBlocks: 0, relationshipCandidates: 0, explicitRelationshipCandidates: 0, overlayWritten: false },
      ],
      grounding: { baselineMatched: 0, layoutMatched: 0 },
      performance: { averageSheetMs: 1000 },
      toolsUsed: [],
      toolsSkipped: [],
    });
    assert.equal(hold.decision, "hold_layout_pilot");
    assert.equal(hold.precision, "Not measured");

    const expand = recommendLayoutExpansion({
      sheets: Array.from({ length: 5 }, () => ({
        regionCount: 5,
        associatedBlocks: 20,
        relationshipCandidates: 3,
        explicitRelationshipCandidates: 2,
        overlayWritten: true,
      })),
      grounding: { baselineMatched: 1, layoutMatched: 0 },
      performance: { averageSheetMs: 900 },
      toolsUsed: ["opencv"],
      toolsSkipped: [],
    });
    assert.equal(expand.decision, "expand_band_layout_to_82");
  });
});

describe("layout pilot over a frozen dataset", () => {
  it("preserves finding wording and writes layout pages with candidate provenance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "layout-pilot-"));
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
      const result = await runLayoutPilot({
        sourceDir: root,
        outDir,
        sheets: [{ relativePath: "A-1.00-00.pdf", discipline: "architectural", reason: "test" }],
        layoutFn: async (_pdf, outPath, overlayPath) => {
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
        },
      });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(result.findingsUnchanged, true);
      assert.equal(result.summary.precision, "Not measured");
      const page = JSON.parse(await readFile(path.join(outDir, "layout-pilot/pages", `${result.summary.sheets[0].sha256}.json`), "utf8"));
      assert.ok(page.regions.length >= 3);
      assert.equal(page.independentlyVerified, false);
      assert.ok(page.associations.some((item) => item.regionId));
      const comparison = await readFile(path.join(outDir, "layout-pilot/comparison.md"), "utf8");
      assert.match(comparison, /NOT COMPLETE/);
      assert.match(comparison, /A-1.00-00.pdf/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
