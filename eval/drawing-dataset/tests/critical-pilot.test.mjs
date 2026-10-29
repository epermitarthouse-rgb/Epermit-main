import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyReviewState } from "../lib/adjudicateSchema.mjs";
import {
  buildCriticalAssessments,
  identifyUsabilityGaps,
  runCriticalPilot,
  CRITICAL_IDS,
} from "../lib/criticalPilot.mjs";

describe("critical pilot assessments", () => {
  it("separates C-002 evidence presence from invalid density×area reasoning", () => {
    const cases = new Map([
      ["C-001", { benchmarkId: "b1", original: { title: "t1" }, crop: { target: { bbox: { x: 1, y: 2, width: 3, height: 4 } } } }],
      ["C-002", { benchmarkId: "b2", original: { title: "Hydraulic" }, crop: { target: { bbox: { x: 1, y: 2, width: 3, height: 4 } } } }],
      ["C-003", { benchmarkId: "b3", original: { title: "Refrigerant" }, crop: { target: { bbox: { x: 1, y: 2, width: 3, height: 4 } } } }],
      ["C-004", { benchmarkId: "b4", original: { title: "Foundation" }, crop: { target: { bbox: { x: 1, y: 2, width: 3, height: 4 } } } }],
    ]);
    const rows = buildCriticalAssessments(cases);
    assert.equal(rows.length, 4);
    const c002 = rows.find((row) => row.clientReportId === "C-002");
    assert.equal(c002.dimensions.evidenceGrounding.outcome, "evidence_present");
    assert.equal(c002.dimensions.technicalCorrectness.outcome, "technically_incorrect");
    assert.equal(c002.overallOutcome, "false_positive");
    assert.equal(c002.professionallyVerified, false);
    assert.equal(c002.dimensions.evidenceGrounding.calculations.densityTimesAreaGpm, 228.6);
    assert.equal(c002.dimensions.evidenceGrounding.calculations.hoseAllowanceGpm, 250);
    const c003 = rows.find((row) => row.clientReportId === "C-003");
    assert.equal(c003.overallOutcome, "false_positive");
    assert.ok(identifyUsabilityGaps().some((gap) => gap.id === "crop-header-only"));
  });
});

describe("critical pilot runner", () => {
  it("applies provisional decisions without metrics contribution and preserves finding-map", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "critical-pilot-"));
    try {
      const outDir = path.join(root, "out");
      await mkdir(path.join(outDir, "adjudication", "cases"), { recursive: true });
      await mkdir(path.join(outDir, "adjudication", "decisions"), { recursive: true });
      await mkdir(path.join(outDir, "layout-full", "pages"), { recursive: true });

      const records = CRITICAL_IDS.map((id, index) => ({
        benchmarkId: `00000000-0000-5000-8000-00000000000${index + 1}`,
        clientReportId: id,
        wordingSha256: `w-${id}`,
        sourceFileSha256: `sha-${id}`,
        relativePath: `${id}.pdf`,
        sheetNumber: id,
        severity: "critical",
        discipline: "Test",
        original: {
          title: id,
          observation: "obs",
          drawingEvidence: "ev",
          drawingLocation: "loc",
          recommendation: "rec",
          codeReference: id === "C-003" ? "2015 IMC Chapter 11" : null,
        },
        automatedRetrieval: { assessment: "evidence_retrieved", retrievalSuccess: true, bestScore: 0.5 },
        retrieval: {
          candidates: [{ text: "sample", bbox: { x: 10, y: 20, width: 30, height: 40 }, score: 0.5, signals: [] }],
        },
        qualityFlags: [],
        specialNotes: id === "C-002" ? { exampleId: "C-002" } : null,
        crop: null,
        review: emptyReviewState(),
        professionallyVerified: false,
      }));

      await writeFile(path.join(outDir, "finding-map.json"), JSON.stringify({
        findings: records.map((row) => ({
          clientReportId: row.clientReportId,
          wordingSha256: row.wordingSha256,
          sha256: row.sourceFileSha256,
          original: row.original,
        })),
      }));
      await writeFile(path.join(outDir, "adjudication", "cases.json"), JSON.stringify({ records }, null, 2));
      for (const row of records) {
        await writeFile(path.join(outDir, "adjudication", "cases", `${row.benchmarkId}.json`), JSON.stringify(row, null, 2));
      }
      await writeFile(path.join(outDir, "adjudication", "audit-log.jsonl"), "");
      await writeFile(path.join(outDir, "adjudication", "independent-sheet-review.json"), JSON.stringify({
        sheets: [
          { relativePath: "A-1.03-00.pdf", missedIssues: [], review: { status: "pending" } },
          { relativePath: "FP200 .pdf", missedIssues: [], review: { status: "pending" } },
          { relativePath: "M-1.4.pdf", missedIssues: [], review: { status: "pending" } },
          { relativePath: "S-201.00.pdf", missedIssues: [], review: { status: "pending" } },
        ],
        confirmedMissedIssues: [],
      }, null, 2));
      await writeFile(path.join(outDir, "adjudication", "metrics.json"), JSON.stringify({
        precision: "Not measured",
        recall: "Not measured",
      }));

      // Map pilot relative paths used in assessments for independent review only;
      // cases use C-00x.pdf names but assessments hardcode real paths for independent markers.
      const before = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      const result = await runCriticalPilot({ outDir });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(result.summary.accountability.professionallyVerified, 0);
      assert.equal(result.summary.precision, "Not measured");
      assert.equal(result.summary.applied.every((row) => row.professionallyVerified === false), true);
      assert.equal(result.summary.applied.every((row) => row.contributesToMetrics === false), true);
      assert.ok(existsSync(path.join(outDir, "adjudication/critical-pilot/comparison.md")));
      const c002 = result.summary.assessments.find((row) => row.clientReportId === "C-002");
      assert.equal(c002.overallOutcome, "false_positive");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
