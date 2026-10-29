import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessRetrieval, findDuplicateCandidates, sortFindingsForReview } from "../lib/semanticAssess.mjs";
import { recommendSemanticNextStep, runSemanticGrounding } from "../lib/semanticGrounding.mjs";
import { retrieveEvidenceCandidates } from "../lib/semanticRetrieve.mjs";

describe("semantic retrieval and assessment", () => {
  it("retrieves numeric and location-backed evidence without claiming verification", () => {
    const finding = {
      clientReportId: "C-002",
      severity: "critical",
      relativePath: "FP200 .pdf",
      original: {
        title: "Inconsistent Hydraulic Calculations",
        observation: "Flow demand appears inconsistent.",
        drawingEvidence: "Hydraulic Design box: Flow Demand: 596.81 GPM. Density: 0.15 GPM.",
        drawingLocation: "Top left of the sheet, Hydraulic Design box.",
      },
    };
    const page = {
      associations: [
        {
          text: "HYDRAULIC DESIGN",
          regionId: "band-drawing-field",
          regionKind: "drawing_field",
          origin: "machine_extracted",
          bbox: { x: 10, y: 500, width: 100, height: 12 },
        },
        {
          text: "596.81 GPM",
          regionId: "band-drawing-field",
          regionKind: "drawing_field",
          origin: "machine_extracted",
          bbox: { x: 20, y: 480, width: 60, height: 12 },
        },
        {
          text: "0.15 GPM",
          regionId: "band-drawing-field",
          regionKind: "drawing_field",
          origin: "machine_extracted",
          bbox: { x: 20, y: 460, width: 50, height: 12 },
        },
      ],
      clusters: [],
      relationships: [],
    };
    const retrieval = retrieveEvidenceCandidates(finding, page);
    assert.equal(retrieval.retrievalSuccess, true);
    assert.ok(retrieval.bestScore >= 0.45);
    assert.ok(retrieval.candidates.some((item) => (item.numberHits || []).includes("596.81")));
    const assessment = assessRetrieval(retrieval);
    assert.equal(assessment.automatedAssessment, "evidence_retrieved");
    assert.equal(assessment.professionallyVerified, false);
    assert.equal(assessment.verificationStatus, "not_professionally_verified");
  });

  it("marks absence claims with strong positive hits as contradicted candidates only", () => {
    const finding = {
      original: {
        drawingEvidence: "Absence of hydraulic design values on the plan.",
        observation: "The sheet lacks hydraulic numbers.",
        drawingLocation: "Hydraulic Design box",
      },
    };
    const retrieval = retrieveEvidenceCandidates(finding, {
      associations: [
        { text: "HYDRAULIC DESIGN 596.81 GPM DENSITY 0.15", regionId: "r1", regionKind: "drawing_field", origin: "machine_extracted" },
      ],
      clusters: [],
      relationships: [],
    });
    const assessment = assessRetrieval(retrieval);
    assert.equal(assessment.automatedAssessment, "contradicted_candidate");
    assert.equal(assessment.professionallyVerified, false);
  });

  it("prioritizes critical findings and detects duplicate candidates", () => {
    const ordered = sortFindingsForReview([
      { clientReportId: "A-1", severity: "advisory" },
      { clientReportId: "C-1", severity: "critical" },
      { clientReportId: "W-1", severity: "warning" },
    ]);
    assert.deepEqual(ordered.map((row) => row.clientReportId), ["C-1", "W-1", "A-1"]);
    const dupes = findDuplicateCandidates([
      {
        clientReportId: "W-1",
        relativePath: "A-1.pdf",
        original: { title: "ADA partition note", observation: "Missing ADA detail", drawingEvidence: "typical interior partition label" },
      },
      {
        clientReportId: "W-2",
        relativePath: "A-1.pdf",
        original: { title: "ADA partition note", observation: "Missing ADA detail", drawingEvidence: "typical interior partition label" },
      },
    ]);
    assert.equal(dupes.length, 1);
  });
});

describe("semantic readiness gate", () => {
  it("keeps Phase 2B closed and precision/recall Not measured", () => {
    const ready = recommendSemanticNextStep({
      coverage: {
        total: 252,
        retrievalSuccessCount: 120,
        automatedAssessmentCounts: { evidence_retrieved: 80, contradicted_candidate: 5, insufficient_evidence: 40, unresolved: 127 },
        bySeverity: { critical: { total: 4 } },
      },
      accountability: {
        findingsUnchanged: true,
        inventoryFiles: 83,
        pdfFiles: 82,
      },
    });
    assert.equal(ready.decision, "semantic_grounding_ready_for_review");
    assert.equal(ready.startPhase2B, false);
    assert.equal(ready.precision, "Not measured");
    assert.equal(ready.recall, "Not measured");
  });
});

describe("semantic grounding runner", () => {
  it("evaluates every finding, preserves finding-map bytes, and writes reviewer pack", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "semantic-ground-"));
    try {
      const outDir = path.join(root, "out");
      await mkdir(path.join(outDir, "layout-full", "pages"), { recursive: true });
      const sha = "abc123";
      await writeFile(path.join(outDir, "layout-full", "pages", `${sha}.json`), JSON.stringify({
        associations: [
          { text: "HYDRAULIC DESIGN 596.81 GPM", regionId: "band-drawing-field", regionKind: "drawing_field", origin: "machine_extracted", bbox: { x: 1, y: 2, width: 3, height: 4 } },
        ],
        clusters: [],
        relationships: [],
      }));
      const findings = {
        findings: [
          {
            clientReportId: "C-001",
            wordingSha256: "c1",
            severity: "critical",
            discipline: "Fire Protection",
            sheetNumber: "FP200",
            relativePath: "FP200 .pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: {
              severity: "critical",
              title: "Hydraulic",
              observation: "Check flow",
              drawingEvidence: "Flow Demand: 596.81 GPM",
              drawingLocation: "Hydraulic Design box",
              recommendation: "Verify calculations.",
            },
            grounding: { status: "token_overlap" },
          },
          {
            clientReportId: "W-001",
            wordingSha256: "w1",
            severity: "warning",
            discipline: "Architectural",
            sheetNumber: "A-1",
            relativePath: "A-1.pdf",
            sha256: sha,
            labelStatus: "unverified_model_output",
            original: {
              severity: "warning",
              title: "Note",
              observation: "Something vague",
              drawingEvidence: "zzzz unmatched evidence phrase xyz",
              drawingLocation: "Somewhere",
              recommendation: "Review.",
            },
            grounding: { status: "span_not_in_extracted_text" },
          },
        ],
      };
      await writeFile(path.join(outDir, "finding-map.json"), JSON.stringify(findings));
      await writeFile(path.join(outDir, "inventory.json"), JSON.stringify({
        walkedFiles: 83,
        files: [
          { relativePath: "S-204.00.pdf", format: "pdf" },
          { relativePath: "S-300.00.pdf", format: "pdf" },
          { relativePath: "Archive.zip", format: "zip", processingStatus: "container_indexed" },
          ...Array.from({ length: 80 }, (_, i) => ({ relativePath: `X-${i}.pdf`, format: "pdf" })),
        ],
      }));
      await writeFile(path.join(outDir, "reconciliation.json"), JSON.stringify({
        fileMatches: [
          { relativePath: "S-204.00.pdf", identityCount: 2, method: "filename_exact" },
          { relativePath: "S-300.00.pdf", method: "unmatched_file" },
        ],
      }));
      const before = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      const result = await runSemanticGrounding({ outDir });
      const after = createHash("sha256").update(await readFile(path.join(outDir, "finding-map.json"))).digest("hex");
      assert.equal(before, after);
      assert.equal(result.findingsUnchanged, true);
      assert.equal(result.summary.records.length, 2);
      assert.equal(result.summary.records[0].clientReportId, "C-001");
      assert.equal(result.summary.precision, "Not measured");
      assert.equal(result.summary.recommendation.startPhase2B, false);
      assert.ok(existsSync(path.join(outDir, "semantic-ground/independent-review-pack.json")));
      assert.ok(existsSync(path.join(outDir, "semantic-ground/finding-evidence.json")));
      const pack = JSON.parse(await readFile(path.join(outDir, "semantic-ground/independent-review-pack.json"), "utf8"));
      assert.equal(pack.missedIssueSlots.length, 0);
      assert.equal(pack.reviewQueue[0].clientReportId, "C-001");
      assert.equal(result.summary.records.every((row) => row.professionallyVerified === false), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
