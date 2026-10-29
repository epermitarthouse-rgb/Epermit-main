import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sortAdjudicationQueue } from "../lib/adjudicateQueue.mjs";
import {
  applyAdjudicationDecision,
  emptyReviewState,
  metricsFromReviews,
} from "../lib/adjudicateSchema.mjs";
import { applyDecisionFile, applyMissedIssue, initAdjudication } from "../lib/adjudicateRunner.mjs";
import { benchmarkFindingId } from "../lib/benchmarkIds.mjs";
import { pickCropTarget } from "../lib/adjudicateCrops.mjs";
import { normalizeAutomatedAssessment } from "../lib/semanticAssess.mjs";

describe("benchmark identities", () => {
  it("derives stable UUIDs from wording and source hashes, not report IDs alone", () => {
    const left = benchmarkFindingId({
      clientReportId: "C-002",
      wordingSha256: "abc",
      sha256: "filehash",
      sheetNumber: "FP200",
    });
    const right = benchmarkFindingId({
      clientReportId: "DIFFERENT-REPORT-ID",
      wordingSha256: "abc",
      sha256: "filehash",
      sheetNumber: "FP200",
    });
    assert.equal(left, right);
    assert.match(left, /^[0-9a-f-]{36}$/);
  });
});

describe("adjudication queue and labels", () => {
  it("prioritizes critical then contradiction then insufficient then unresolved", () => {
    const queued = sortAdjudicationQueue([
      { clientReportId: "A1", severity: "advisory", automatedRetrieval: { assessment: "evidence_retrieved" } },
      { clientReportId: "U1", severity: "warning", automatedRetrieval: { assessment: "unresolved" } },
      { clientReportId: "I1", severity: "warning", automatedRetrieval: { assessment: "insufficient_evidence" } },
      { clientReportId: "X1", severity: "warning", automatedRetrieval: { assessment: "contradicted_candidate" } },
      { clientReportId: "C1", severity: "critical", automatedRetrieval: { assessment: "evidence_retrieved" } },
    ]);
    assert.deepEqual(queued.map((row) => row.clientReportId), ["C1", "X1", "I1", "U1", "A1"]);
    assert.equal(normalizeAutomatedAssessment("supported"), "evidence_retrieved");
  });

  it("keeps evidence and technical correctness independent in decisions", () => {
    const base = {
      benchmarkId: "b1",
      clientReportId: "C-002",
      review: emptyReviewState(),
    };
    const updated = applyAdjudicationDecision(base, {
      reviewerId: "reviewer-test",
      reviewerRole: "qa",
      overallOutcome: "false_positive",
      justification: "Numbers present but hydraulic conclusion is wrong.",
      dimensions: {
        evidenceGrounding: { outcome: "evidence_present", justification: "596.81 GPM visible" },
        technicalCorrectness: { outcome: "technically_incorrect", justification: "Inconsistency claim not sustained" },
        findingValidity: { outcome: "false_positive" },
      },
      professionallyVerified: false,
    });
    assert.equal(updated.review.dimensions.evidenceGrounding.outcome, "evidence_present");
    assert.equal(updated.review.dimensions.technicalCorrectness.outcome, "technically_incorrect");
    assert.equal(updated.review.professionallyVerified, false);
    assert.equal(updated.review.contributesToMetrics, false);
    assert.equal(updated.review.audit.length, 1);

    assert.throws(() => applyAdjudicationDecision(base, {
      reviewerId: "reviewer-test",
      overallOutcome: "confirmed_valid",
      professionallyVerified: true,
    }), /authorizeMetricsContribution/);
  });

  it("leaves precision Not measured until authorized verified reviews exist", () => {
    const metrics = metricsFromReviews([{ review: emptyReviewState() }]);
    assert.equal(metrics.precision, "Not measured");
    assert.equal(metrics.recall, "Not measured");
  });
});

describe("crop target selection", () => {
  it("selects the first candidate with a bbox", () => {
    const target = pickCropTarget({
      retrieval: {
        candidates: [
          { text: "no box", score: 1 },
          { text: "596.81 GPM", score: 0.9, bbox: { x: 1, y: 2, width: 3, height: 4 }, regionId: "r1" },
        ],
      },
    });
    assert.equal(target.source, "top_evidence_candidate");
    assert.equal(target.regionId, "r1");
  });
});

describe("adjudication init and apply", () => {
  it("builds 252-scale workflow artifacts on a tiny fixture without claiming verification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adjudication-"));
    try {
      const outDir = path.join(root, "out");
      await mkdir(path.join(outDir, "semantic-ground"), { recursive: true });
      const sha = "sourcehash1";
      const findings = {
        findings: [
          {
            clientReportId: "C-002",
            wordingSha256: "w-c2",
            severity: "critical",
            sheetNumber: "FP200",
            relativePath: "FP200 .pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: {
              severity: "critical",
              title: "Hydraulic",
              observation: "Inconsistent",
              drawingEvidence: "596.81 GPM",
              drawingLocation: "Hydraulic Design box",
              recommendation: "Check",
              codeReference: null,
            },
          },
          {
            clientReportId: "W-009",
            wordingSha256: "w-w9",
            severity: "warning",
            sheetNumber: "A-1",
            relativePath: "A-1.pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: {
              severity: "warning",
              title: "Absence claim",
              observation: "Missing note",
              drawingEvidence: "Absence of note",
              drawingLocation: "Notes",
              recommendation: "Review",
              codeReference: null,
            },
          },
        ],
      };
      await writeFile(path.join(outDir, "finding-map.json"), JSON.stringify(findings));
      await writeFile(path.join(outDir, "inventory.json"), JSON.stringify({
        walkedFiles: 83,
        files: [
          { relativePath: "FP200 .pdf", format: "pdf", sha256: sha },
          { relativePath: "A-1.pdf", format: "pdf", sha256: sha },
          { relativePath: "S-204.00.pdf", format: "pdf", sha256: "s204" },
          { relativePath: "S-300.00.pdf", format: "pdf", sha256: "s300" },
          { relativePath: "Archive.zip", format: "zip", processingStatus: "container_indexed" },
          ...Array.from({ length: 78 }, (_, i) => ({ relativePath: `X-${i}.pdf`, format: "pdf", sha256: `x${i}` })),
        ],
      }));
      await writeFile(path.join(outDir, "reconciliation.json"), JSON.stringify({
        fileMatches: [
          { relativePath: "S-204.00.pdf", identityCount: 2, method: "filename_exact" },
          { relativePath: "S-300.00.pdf", method: "unmatched_file" },
        ],
      }));
      await writeFile(path.join(outDir, "semantic-ground", "finding-evidence.json"), JSON.stringify({
        records: [
          {
            clientReportId: "C-002",
            wordingSha256: "w-c2",
            severity: "critical",
            discipline: "Fire Protection",
            sheetNumber: "FP200",
            relativePath: "FP200 .pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: findings.findings[0].original,
            assessment: {
              automatedAssessment: "evidence_retrieved",
              retrievalSuccess: true,
              bestScore: 0.99,
              rationale: "numbers present",
            },
            retrieval: {
              candidates: [
                { text: "596.81 GPM", bbox: { x: 10, y: 20, width: 40, height: 12 }, regionId: "r1", regionKind: "drawing_field", score: 0.99, signals: ["numeric_fact"] },
              ],
            },
            qualityFlags: [],
          },
          {
            clientReportId: "W-009",
            wordingSha256: "w-w9",
            severity: "warning",
            discipline: "Architectural",
            sheetNumber: "A-1",
            relativePath: "A-1.pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: findings.findings[1].original,
            assessment: {
              automatedAssessment: "contradicted_candidate",
              retrievalSuccess: true,
              bestScore: 0.6,
            },
            retrieval: { candidates: [] },
            qualityFlags: [],
          },
        ],
      }));

      const before = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      const result = await initAdjudication({
        outDir,
        sourceDir: root,
        renderCrops: true,
        cropLimit: 2,
        cropFn: async (_pdf, outPath) => {
          await writeFile(outPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          return { status: "ok", outPath };
        },
      });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(result.summary.records.length, 2);
      assert.equal(result.summary.records[0].clientReportId, "C-002");
      assert.equal(result.summary.records[0].specialNotes.exampleId, "C-002");
      assert.equal(result.summary.records[1].queueBand, "contradicted_candidate");
      assert.equal(result.summary.precision, "Not measured");
      assert.equal(result.summary.verifiedVersusPending.professionallyCompletedReviews, 0);
      assert.ok(existsSync(path.join(outDir, "adjudication/independent-sheet-review.json")));
      assert.ok(existsSync(path.join(outDir, "adjudication/queue.json")));

      const decision = {
        benchmarkId: result.summary.records[0].benchmarkId,
        reviewerId: "local-test-reviewer",
        overallOutcome: "needs_more_evidence",
        justification: "Local workflow test only — not a professional review.",
        dimensions: {
          evidenceGrounding: { outcome: "evidence_present" },
          technicalCorrectness: { outcome: "technically_uncertain" },
          findingValidity: { outcome: "needs_more_evidence" },
        },
      };
      const applied = await applyDecisionFile({ outDir, decision });
      assert.equal(applied.record.review.overallOutcome, "needs_more_evidence");
      assert.equal(applied.record.review.professionallyVerified, false);
      assert.equal(applied.metrics.precision, "Not measured");

      const missed = await applyMissedIssue({
        outDir,
        issue: {
          relativePath: "FP200 .pdf",
          title: "Example missed issue slot",
          observation: "Workflow test placeholder observation",
          drawingEvidence: "n/a test",
          reviewerId: "local-test-reviewer",
        },
      });
      assert.ok(missed.issue.benchmarkMissedIssueId);
      assert.equal(missed.issue.professionallyVerified, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
