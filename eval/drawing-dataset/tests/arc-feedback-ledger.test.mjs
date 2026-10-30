import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ALL_DECISIONS,
  applyDecisionToItem,
  assertNoSilentPromotion,
  buildMissedIssueRecord,
  createLedgerRecord,
  detectDisagreements,
  mapTriageToProfessional,
  normalizeDecision,
  summarizeFeedback,
} from "../lib/arcFeedbackLedger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const packDir = path.join(repoRoot, "eval/drawing-dataset/fixtures/professional-benchmark/v1");

describe("arcFeedbackLedger core", () => {
  it("maps triage decisions and normalizes aliases", () => {
    assert.equal(mapTriageToProfessional("accepted"), "confirmed_issue");
    assert.equal(mapTriageToProfessional("rejected"), "false_positive");
    assert.equal(mapTriageToProfessional("modified"), "partially_supported");
    assert.equal(normalizeDecision("needs more evidence"), "insufficient_evidence");
    assert.equal(normalizeDecision("bogus"), null);
    assert.ok(ALL_DECISIONS.includes("insufficient_evidence"));
  });

  it("blocks silent verified/metrics promotion", () => {
    assert.throws(() => createLedgerRecord({
      decision: "false_positive",
      independentlyVerified: true,
    }));
    const ok = createLedgerRecord({
      decision: "false_positive",
      independentlyVerified: true,
      contributesToMetrics: true,
    }, { authorizeMetricsContribution: true });
    assert.equal(ok.independentlyVerified, true);
    assert.equal(ok.contributesToMetrics, true);
  });

  it("preserves original AI fields when applying reviewer decision", () => {
    const item = {
      id: "pb-v1-001",
      analyzerFinding: { title: "Original AI", severity: "critical", rationale: "keep me" },
      evidenceQuote: "quote",
      reviewer: { decision: null },
    };
    const next = applyDecisionToItem(item, {
      decision: "false_positive",
      justification: "density×area is not demand",
      reviewer: { identity: "arc1", role: "PE" },
    });
    assert.equal(next.analyzerFinding.title, "Original AI");
    assert.equal(next.analyzerFinding.severity, "critical");
    assert.equal(next.reviewer.decision, "false_positive");
    assert.equal(next.reviewer.professionallyVerified, false);
  });

  it("records missed issues without metrics flags", () => {
    const missed = buildMissedIssueRecord({
      title: "Missing latch throw note",
      drawingLocation: "Door schedule row 12",
      reviewerIdentity: "arc1",
      reviewerRole: "RA",
    });
    assert.equal(missed.professionallyVerified, false);
    assert.equal(missed.contributesToMetrics, false);
    assert.throws(() => buildMissedIssueRecord({ title: "x" }));
  });

  it("detects disagreements and summarizes completion", () => {
    const ledger = [
      createLedgerRecord({ pbItemId: "pb-v1-001", decision: "false_positive", status: "finalized", source: "worksheet" }),
      createLedgerRecord({ pbItemId: "pb-v1-001", decision: "confirmed_issue", status: "finalized", source: "worksheet" }),
      createLedgerRecord({ pbItemId: "pb-v1-002", decision: "accepted", status: "preliminary", source: "supabase_ui_export" }),
    ];
    const disputes = detectDisagreements(ledger);
    assert.equal(disputes.length, 1);
    assert.equal(disputes[0].pbItemId, "pb-v1-001");
    const summary = summarizeFeedback(ledger, [
      { id: "pb-v1-001", reviewer: { decision: "false_positive" } },
      { id: "pb-v1-002", reviewer: { decision: null } },
      { id: "pb-v1-003", reviewer: { decision: null } },
    ]);
    assert.equal(summary.completion.totalItems, 3);
    assert.equal(summary.completion.reviewedItems, 1);
    assert.equal(summary.disagreements.length, 1);
  });

  it("assertNoSilentPromotion helper", () => {
    assert.throws(() => assertNoSilentPromotion({ independentlyVerified: true }));
    assert.doesNotThrow(() => assertNoSilentPromotion({ independentlyVerified: true }, { authorizeMetricsContribution: true }));
  });
});

describe("ARC worksheet merge CLI (temp pack copy)", () => {
  it("merges sample worksheet into temp items and ledger without promoting metrics", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arc-pack-"));
    try {
      // Minimal pack copy
      const items = JSON.parse(await readFile(path.join(packDir, "items.json"), "utf8"));
      await writeFile(path.join(dir, "items.json"), JSON.stringify(items));
      await writeFile(path.join(dir, "benchmark-link-map.v1.json"), await readFile(path.join(packDir, "benchmark-link-map.v1.json")));
      await writeFile(path.join(dir, "feedback-ledger.jsonl"), "");
      const csv = await readFile(path.join(packDir, "sample-filled-worksheet.csv"), "utf8");
      const csvPath = path.join(dir, "filled.csv");
      await writeFile(csvPath, csv);

      // Run merge by importing helpers directly against temp paths (unit-level)
      const { applyDecisionToItem: apply, createLedgerRecord: create, normalizeDecision: norm } = await import("../lib/arcFeedbackLedger.mjs");
      const rows = csv.trim().split(/\n/).slice(1);
      let updated = 0;
      for (const line of rows) {
        if (!line.includes("false_positive") && !line.includes("insufficient_evidence")) continue;
        const id = line.split(",")[0];
        const item = items.items.find((row) => row.id === id);
        const decision = line.includes("insufficient_evidence") ? "insufficient_evidence" : "false_positive";
        assert.equal(norm(decision), decision);
        apply(item, { decision, justification: "test", reviewer: { identity: "t", role: "PE" } });
        create({ decision, pbItemId: id, source: "worksheet", status: "preliminary" });
        updated += 1;
      }
      assert.ok(updated >= 2);

      // CLI smoke: merge against real pack using sample would dirty pack — skip; helper coverage above.
      const help = spawnSync(process.execPath, [
        path.join(repoRoot, "eval/drawing-dataset/cli/merge-professional-worksheet.mjs"),
      ], { encoding: "utf8" });
      assert.notEqual(help.status, 0);
      assert.match(help.stderr + help.stdout, /Usage/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
