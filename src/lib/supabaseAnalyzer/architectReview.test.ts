import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import {
  architectReviewFingerprintSource,
  buildArchitectReviewModel,
  fingerprintArchitectReview,
} from "./architectReview.ts";
import { fetchAllPages, type PageResult } from "./pagedFetch.ts";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding } from "./client.ts";
import {
  deepFreeze,
  finding,
  fixtureDataset,
  job,
  review,
  run,
  shuffled,
  stressDataset,
  uuidFor,
} from "./fixtures/architectReviewFixtures.ts";

// Node 18 only exposes Web Crypto on globalThis behind a flag; browsers always do.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const CLIENT_INVENTORY = [
  ["Architectural", 22, 1, 26, 39, 66],
  ["Structural", 7, 1, 5, 12, 18],
  ["Mechanical", 8, 1, 8, 19, 28],
  ["Electrical", 13, 0, 16, 28, 44],
  ["Plumbing", 14, 0, 14, 34, 48],
  ["Fire Protection", 4, 1, 3, 6, 10],
  ["Demolition", 8, 0, 6, 16, 22],
  ["Energy", 1, 0, 1, 1, 2],
  ["Equipment", 3, 0, 3, 5, 8],
  ["General", 2, 0, 1, 5, 6],
] as const;

describe("Architect review model: 252-finding fixture (run 649fdaa6)", () => {
  it("reproduces the client PDF finding IDs and source sequence for every finding", () => {
    const { dataset, expected } = fixtureDataset();
    const model = buildArchitectReviewModel(dataset);
    assert.equal(model.findings.length, 252);
    assert.deepEqual(model.integrityIssues, []);
    for (const item of model.findings) {
      const source = expected.get(item.findingId);
      assert.ok(source, `unexpected finding ${item.findingId}`);
      assert.equal(item.reportId, source.clientReportId, `report id for source finding ${source.sourceFinding}`);
      assert.equal(item.sourceSequence, source.sourceFinding);
    }
    assert.deepEqual(model.findings.slice(0, 4).map((item) => item.reportId), ["C-001", "C-002", "C-003", "C-004"]);
  });

  it("matches the client severity totals and discipline inventory", () => {
    const model = buildArchitectReviewModel(fixtureDataset().dataset);
    assert.deepEqual(model.totals.published, { all: 252, critical: 4, warning: 83, advisory: 165, other: 0 });
    assert.deepEqual(model.totals.client, model.totals.published);
    assert.deepEqual(
      model.inventory.map((row) => [row.discipline, row.sheets, row.critical, row.warning, row.advisory, row.total]),
      CLIENT_INVENTORY.map((row) => [...row]),
    );
    assert.deepEqual(
      [model.inventoryTotal.sheets, model.inventoryTotal.critical, model.inventoryTotal.warning, model.inventoryTotal.advisory, model.inventoryTotal.total],
      [82, 4, 83, 165, 252],
    );
    assert.equal(model.coverage.length, 82);
    assert.ok(model.coverage.every((sheet) => sheet.outcome === "findings"));
    assert.equal(model.isFinal, true);
  });

  it("carries stored content, severity, citation and UUID verbatim without changing the input", () => {
    const { dataset } = fixtureDataset();
    const before = JSON.stringify(dataset);
    const model = buildArchitectReviewModel(deepFreeze(dataset));
    assert.equal(JSON.stringify(dataset), before);
    const stored = new Map(dataset.findings.map((item) => [item.id, item]));
    for (const item of model.findings) {
      const source = stored.get(item.findingId)!;
      assert.equal(item.severity, source.severity);
      assert.equal(item.title, source.title);
      assert.equal(item.observation, source.observation);
      assert.equal(item.drawingEvidence, source.drawing_evidence);
      assert.equal(item.drawingLocation, source.drawing_location);
      assert.equal(item.codeReference, source.suggested_code_reference);
      assert.equal(item.recommendation, source.recommendation);
      assert.equal(item.presentedRecommendation, source.recommendation);
    }
    assert.equal(model.findings.filter((item) => item.codeReference).length, 24);
  });

  it("assigns the same IDs regardless of the order rows arrive in", () => {
    const { dataset } = fixtureDataset();
    const reordered = { ...dataset, jobs: shuffled(dataset.jobs, 99), findings: shuffled(dataset.findings, 42) };
    const left = buildArchitectReviewModel(dataset).findings.map((item) => [item.findingId, item.reportId]);
    const right = buildArchitectReviewModel(reordered).findings.map((item) => [item.findingId, item.reportId]);
    assert.deepEqual(right, left);
  });
});

describe("Architect review model: reviewer decisions", () => {
  it("withdraws rejected findings from client output without renumbering or changing severity", () => {
    const { dataset } = fixtureDataset();
    const baseline = buildArchitectReviewModel(dataset);
    const rejected = baseline.findings.find((item) => item.reportId === "W-010")!;
    const modified = baseline.findings.find((item) => item.reportId === "C-002")!;
    const model = buildArchitectReviewModel({
      ...dataset,
      reviews: [
        review(rejected.findingId, "rejected"),
        review(modified.findingId, "modified", { modified_response: "Reconcile total demand with the full hydraulic calculation." }),
      ],
    });

    assert.deepEqual(
      model.findings.map((item) => [item.findingId, item.reportId, item.severity]),
      baseline.findings.map((item) => [item.findingId, item.reportId, item.severity]),
    );
    assert.deepEqual(model.withdrawnFindings.map((item) => item.reportId), ["W-010"]);
    assert.equal(model.clientFindings.length, 251);
    assert.ok(!model.clientFindings.some((item) => item.reportId === "W-010"));
    assert.deepEqual(model.totals.client, { all: 251, critical: 4, warning: 82, advisory: 165, other: 0 });
    assert.equal(model.totals.withdrawn, 1);
    assert.equal(model.inventoryTotal.warning, 82);

    const revised = model.findings.find((item) => item.reportId === "C-002")!;
    assert.equal(revised.severity, "critical");
    assert.equal(revised.recommendation, modified.recommendation);
    assert.equal(revised.presentedRecommendation, "Reconcile total demand with the full hydraulic calculation.");
    assert.equal(revised.recommendationRevised, true);
    assert.equal(revised.clientStatus, "included");
  });

  it("ignores decisions recorded against another run", () => {
    const { dataset } = fixtureDataset();
    const target = dataset.findings[0];
    const model = buildArchitectReviewModel({ ...dataset, reviews: [review(target.id, "rejected", { run_id: "other-run" })] });
    assert.equal(model.totals.withdrawn, 0);
  });
});

describe("Architect review fingerprint", () => {
  it("uses SHA-256 of the canonical content and ignores row order", async () => {
    const { dataset } = fixtureDataset();
    const fingerprint = await fingerprintArchitectReview(dataset);
    const expectedDigest = createHash("sha256").update(architectReviewFingerprintSource(dataset), "utf8").digest("hex");
    assert.equal(fingerprint.digest, expectedDigest);
    assert.match(fingerprint.label, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    const reordered = await fingerprintArchitectReview({
      ...dataset,
      jobs: shuffled(dataset.jobs, 1),
      findings: shuffled(dataset.findings, 2),
    });
    assert.equal(reordered.digest, fingerprint.digest);
  });

  it("changes when finding content, sheet metadata or any reviewer decision field changes", async () => {
    const { dataset } = fixtureDataset();
    const target = dataset.findings[17];
    const base = (await fingerprintArchitectReview(dataset)).digest;
    const withFinding = (patch: Partial<SupabaseAnalyzerFinding>): AnalyzerRunDataset => ({
      ...dataset,
      findings: dataset.findings.map((item) => (item.id === target.id ? { ...item, ...patch } : item)),
    });
    const accepted = { ...dataset, reviews: [review(target.id, "accepted")] };
    const variants: Array<[string, AnalyzerRunDataset]> = [
      ["observation", withFinding({ observation: `${target.observation} ` })],
      ["drawing evidence", withFinding({ drawing_evidence: `${target.drawing_evidence}.` })],
      ["location", withFinding({ drawing_location: "Elsewhere" })],
      ["citation", withFinding({ suggested_code_reference: "IBC 2015 §1004.3" })],
      ["recommendation", withFinding({ recommendation: "Different action." })],
      ["severity", withFinding({ severity: target.severity === "advisory" ? "warning" : "advisory" })],
      ["verification status", withFinding({ verification_status: "proposed_reference" })],
      ["sheet title", { ...dataset, jobs: dataset.jobs.map((item) => (item.id === target.sheet_job_id ? { ...item, detected_sheet_title: "Renamed" } : item)) }],
      ["review added", accepted],
      ["review decision", { ...dataset, reviews: [review(target.id, "rejected")] }],
      ["modified response", { ...dataset, reviews: [review(target.id, "modified", { modified_response: "Other wording." })] }],
      ["review time", { ...dataset, reviews: [review(target.id, "accepted", { decided_at: "2026-10-28T00:00:00Z" })] }],
      ["reviewer", { ...dataset, reviews: [review(target.id, "accepted", { decided_by: "reviewer-2" })] }],
    ];
    const digests = new Set([base]);
    for (const [label, variant] of variants) {
      const digest = (await fingerprintArchitectReview(variant)).digest;
      assert.notEqual(digest, base, `${label} must change the fingerprint`);
      digests.add(digest);
    }
    assert.equal(digests.size, variants.length + 1);
  });
});

describe("Architect review model: 1,200-finding stress fixture", () => {
  it("issues unique, stable IDs and complete coverage within budget", async () => {
    const dataset = stressDataset();
    const started = performance.now();
    const model = buildArchitectReviewModel(deepFreeze(dataset));
    const buildMs = performance.now() - started;
    const fingerprintStarted = performance.now();
    await fingerprintArchitectReview(dataset);
    const fingerprintMs = performance.now() - fingerprintStarted;

    assert.equal(model.findings.length, 1200);
    assert.equal(new Set(model.findings.map((item) => item.reportId)).size, 1200);
    assert.equal(new Set(model.findings.map((item) => item.findingId)).size, 1200);
    assert.deepEqual(model.findings.map((item) => item.sourceSequence).sort((a, b) => a - b), Array.from({ length: 1200 }, (_, index) => index + 1));
    assert.deepEqual(model.totals.published, { all: 1200, critical: 100, warning: 300, advisory: 800, other: 0 });
    assert.equal(model.withdrawnFindings.length, 100);
    assert.equal(model.clientFindings.length, 1100);
    assert.equal(model.coverage.length, 100);
    assert.equal(model.findings.at(-1)?.reportId, "A-800");
    assert.ok(buildMs < 1000, `model build took ${buildMs.toFixed(1)} ms`);
    assert.ok(fingerprintMs < 1000, `fingerprint took ${fingerprintMs.toFixed(1)} ms`);

    const again = buildArchitectReviewModel({ ...dataset, findings: shuffled(dataset.findings, 77), jobs: shuffled(dataset.jobs, 78) });
    assert.deepEqual(
      again.findings.map((item) => [item.findingId, item.reportId]),
      model.findings.map((item) => [item.findingId, item.reportId]),
    );
    console.log(`stress: build ${buildMs.toFixed(1)} ms, fingerprint ${fingerprintMs.toFixed(1)} ms`);
  });

  it("widens IDs instead of overflowing when one severity exceeds 999 findings", () => {
    const model = buildArchitectReviewModel(stressDataset({ severity: () => "advisory" }));
    assert.equal(model.findings[0].reportId, "A-0001");
    assert.equal(model.findings.at(-1)?.reportId, "A-1200");
  });
});

describe("Architect review model: integrity and draft state", () => {
  it("keeps an unrecognized stored severity unchanged and reports it", () => {
    const sheet = job({ id: "job-1", ordinal: 1 });
    const model = buildArchitectReviewModel({
      run: run({ total_sheets: 1 }),
      jobs: [sheet],
      findings: [
        finding({ id: uuidFor(1), sheet_job_id: "job-1", finding_index: 0, severity: "major" as SupabaseAnalyzerFinding["severity"] }),
        finding({ id: uuidFor(2), sheet_job_id: "job-1", finding_index: 1, severity: "warning" }),
      ],
    });
    assert.deepEqual(model.findings.map((item) => [item.reportId, item.severity]), [["W-001", "warning"], ["U-001", "major"]]);
    assert.equal(model.totals.published.other, 1);
    assert.equal(model.integrityIssues.length, 1);
  });

  it("marks incomplete runs as draft and lists failed and empty sheets in coverage", () => {
    const jobs = [
      job({ id: "job-a", ordinal: 1, status: "completed" }),
      job({ id: "job-b", ordinal: 2, status: "failed" }),
      job({ id: "job-c", ordinal: 3, status: "queued" }),
    ];
    const model = buildArchitectReviewModel({ run: run({ status: "processing", total_sheets: 3 }), jobs, findings: [] });
    assert.equal(model.isFinal, false);
    assert.deepEqual(model.coverage.map((row) => row.outcome), ["no_findings", "failed", "pending"]);
    const finished = buildArchitectReviewModel({
      run: run({ status: "completed_with_errors", total_sheets: 2 }),
      jobs: jobs.slice(0, 2),
      findings: [],
    });
    assert.equal(finished.isFinal, true);
  });

  it("excludes findings from another run and duplicate rows", () => {
    const sheet = job({ id: "job-1", ordinal: 1 });
    const one = finding({ id: uuidFor(1), sheet_job_id: "job-1", finding_index: 0, severity: "advisory" });
    const model = buildArchitectReviewModel({
      run: run({ total_sheets: 1 }),
      jobs: [sheet],
      findings: [one, { ...one }, finding({ id: uuidFor(2), sheet_job_id: "job-1", finding_index: 1, severity: "advisory", run_id: "other" })],
    });
    assert.equal(model.findings.length, 1);
    assert.equal(model.integrityIssues.length, 2);
  });
});

describe("Paged analyzer reads", () => {
  function server<T>(rows: T[], maxRows: number, options: { reportCount?: boolean; failAt?: number } = {}) {
    let calls = 0;
    const fetchPage = async (from: number, to: number): Promise<PageResult<T>> => {
      calls += 1;
      if (options.failAt !== undefined && from >= options.failAt) return { data: null, error: new Error("network") };
      const end = Math.min(to + 1, from + maxRows);
      return { data: rows.slice(from, end), error: null, count: options.reportCount === false ? null : rows.length };
    };
    return { fetchPage, calls: () => calls };
  }
  const rows = Array.from({ length: 1200 }, (_, index) => index);

  it("reads all 1,200 rows when the server caps responses at 1,000", async () => {
    const { fetchPage } = server(rows, 1000);
    assert.deepEqual(await fetchAllPages(fetchPage), rows);
  });

  it("reads all rows when the server cap is smaller than the page size", async () => {
    const { fetchPage, calls } = server(rows, 100);
    assert.deepEqual(await fetchAllPages(fetchPage), rows);
    assert.equal(calls(), 12);
  });

  it("reads all rows without a reported count by continuing to an empty page", async () => {
    const { fetchPage } = server(rows, 100, { reportCount: false });
    assert.deepEqual(await fetchAllPages(fetchPage), rows);
  });

  it("fails instead of returning a partial result", async () => {
    await assert.rejects(fetchAllPages(server(rows, 500, { failAt: 500 }).fetchPage), /network/);
    const shortServer = async (from: number): Promise<PageResult<number>> => ({
      data: from === 0 ? rows.slice(0, 300) : [],
      error: null,
      count: 1200,
    });
    await assert.rejects(fetchAllPages(shortServer), /Expected 1200 rows but received 300/);
  });
});
