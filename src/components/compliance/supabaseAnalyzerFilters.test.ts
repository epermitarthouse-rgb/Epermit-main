import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildArchitectReviewModel, fingerprintArchitectReview } from "@/lib/supabaseAnalyzer/architectReview";
import { renderArchitectReviewPdf } from "@/lib/supabaseAnalyzer/brandedReport";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding } from "@/lib/supabaseAnalyzer/client";
import { buildSupabaseAnalyzerJsonExport, countSeverity } from "@/lib/supabaseAnalyzer/exportDataset";
import { deepFreeze, fixtureDataset, review } from "@/lib/supabaseAnalyzer/fixtures/architectReviewFixtures";
import {
  expansionForRunSeverity,
  nextRunSeverityFilter,
  reviewsByFindingForRun,
  type FindingSeverityFilter,
  type RunSeverityExpansion,
} from "@/lib/supabaseAnalyzer/reviewDecisions";
import { DrawingReviewList, FindingsMatrix } from "./supabaseAnalyzerPresentation";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

function reviewedDataset(): AnalyzerRunDataset {
  const { dataset } = fixtureDataset();
  const ids = new Map(buildArchitectReviewModel(dataset).findings.map((item) => [item.reportId, item.findingId]));
  return deepFreeze({
    ...dataset,
    reviews: [
      review(ids.get("C-001")!, "accepted"),
      review(ids.get("W-002")!, "modified", { modified_response: "Confirm the revision history." }),
      review(ids.get("A-010")!, "rejected"),
    ],
  });
}

const dataset = reviewedDataset();
const model = buildArchitectReviewModel(dataset);
const reviewsByFinding = reviewsByFindingForRun(dataset.reviews || [], dataset.run.id);
const findingsByJob = new Map<string, SupabaseAnalyzerFinding[]>();
for (const item of dataset.findings) findingsByJob.set(item.sheet_job_id, [...(findingsByJob.get(item.sheet_job_id) || []), item]);
const noop = () => {};

interface ViewState {
  severity: FindingSeverityFilter;
  sheetSeverity: Record<string, FindingSeverityFilter>;
  expansion: RunSeverityExpansion;
}

const initialState = (expanded: Iterable<string> = []): ViewState => ({
  severity: "all",
  sheetSeverity: {},
  expansion: { expandedJobIds: new Set(expanded), expansionBeforeFilter: null },
});

/** Mirrors the page: a summary card resolves the next filter, clears sheet overrides and updates expansion. */
function clickSummaryCard(state: ViewState, card: FindingSeverityFilter): ViewState {
  const target = nextRunSeverityFilter(state.severity, card);
  return {
    severity: target,
    sheetSeverity: {},
    expansion: expansionForRunSeverity(state.expansion, target, dataset.findings),
  };
}

function clickSheetFilter(state: ViewState, jobId: string, filter: FindingSeverityFilter): ViewState {
  return { ...state, sheetSeverity: { ...state.sheetSeverity, [jobId]: filter } };
}

function renderList(state: ViewState) {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(DrawingReviewList, {
      jobs: dataset.jobs,
      findingsByJob,
      severityFilter: state.severity,
      sheetSeverity: state.sheetSeverity,
      activeDiscipline: "all",
      onDiscipline: noop,
      onSheetSeverity: noop,
      reviewsByFinding,
      reportIdByFindingId: model.reportIdByFindingId,
      savingFindingId: null,
      onAccept: noop,
      onModify: noop,
      onReject: noop,
      expandedJobIds: state.expansion.expandedJobIds,
      onToggleJob: noop,
      expandedFindingIds: new Set<string>(),
      onToggleFinding: noop,
      onRetry: noop,
    })),
  );
  const sheetRows = (html.match(/data-testid="supabase-sheet-row"/g) || []).length;
  const cards = [...html.matchAll(
    /data-testid="supabase-finding-card" data-severity="(\w+)" data-decision="(\w+)" data-finding-id="([^"]+)" data-report-id="([^"]+)"/g,
  )].map((match) => ({ severity: match[1], decision: match[2], findingId: match[3], reportId: match[4] }));
  const sheetCount = (jobId: string) => html.match(new RegExp(`data-testid="sheet-finding-count-${jobId}"[^>]*>([^<]*)<`))?.[1];
  const sheetFilterPressed = (jobId: string, filter: FindingSeverityFilter) =>
    new RegExp(`aria-pressed="true" data-testid="sheet-filter-${jobId}-${filter}"`).test(html);
  return { html, sheetRows, cards, sheetCount, sheetFilterPressed };
}

const jobsWith = (severity: string) => new Set(dataset.findings.filter((item) => item.severity === severity).map((item) => item.sheet_job_id));
const findingsOn = (jobId: string) => findingsByJob.get(jobId) || [];

describe("Supabase analyzer severity filters", () => {
  it("shows only the selected severity and the drawings that contain it", () => {
    const expected = { critical: 4, warning: 83, advisory: 165 } as const;
    for (const severity of ["critical", "warning", "advisory"] as const) {
      const view = renderList(clickSummaryCard(initialState(), severity));
      assert.equal(view.sheetRows, jobsWith(severity).size, `${severity} drawings`);
      assert.equal(view.cards.length, expected[severity], `${severity} findings`);
      assert.ok(view.cards.every((card) => card.severity === severity));
      const prefix = { critical: "C-", warning: "W-", advisory: "A-" }[severity];
      assert.ok(view.cards.every((card) => card.reportId.startsWith(prefix)));
    }
  });

  it("collapses back to the full list, and the reviewer's own open drawings, with All Findings", () => {
    const reviewerOpened = dataset.jobs.find((item) => !jobsWith("critical").has(item.id))!.id;
    const all = renderList(initialState([reviewerOpened]));
    assert.equal(all.sheetRows, 82);
    assert.equal(all.cards.length, findingsOn(reviewerOpened).length);

    let state = clickSummaryCard(initialState([reviewerOpened]), "critical");
    assert.equal(renderList(state).cards.length, 4);
    state = clickSummaryCard(state, "warning");
    assert.equal(renderList(state).cards.length, 83);
    state = clickSummaryCard(state, "advisory");
    assert.equal(renderList(state).cards.length, 165);
    state = clickSummaryCard(state, "all");
    assert.equal(state.severity, "all");
    assert.deepEqual([...state.expansion.expandedJobIds], [reviewerOpened]);
    const reset = renderList(state);
    assert.equal(reset.sheetRows, 82);
    assert.equal(reset.cards.length, findingsOn(reviewerOpened).length);
    assert.equal(reset.sheetCount(reviewerOpened), String(findingsOn(reviewerOpened).length));

    const toggledOff = clickSummaryCard(clickSummaryCard(initialState(), "warning"), "warning");
    assert.equal(toggledOff.severity, "all");
  });

  it("narrows one drawing with its own filter without changing the others", () => {
    const [first, second] = dataset.jobs
      .filter((item) => new Set(findingsOn(item.id).map((entry) => entry.severity)).size > 1)
      .map((item) => item.id);
    const state = clickSheetFilter(initialState([first, second]), first, "advisory");
    const view = renderList(state);
    const firstCards = view.cards.filter((card) => findingsOn(first).some((item) => item.id === card.findingId));
    const secondCards = view.cards.filter((card) => findingsOn(second).some((item) => item.id === card.findingId));
    const advisoryOnFirst = findingsOn(first).filter((item) => item.severity === "advisory").length;
    assert.equal(firstCards.length, advisoryOnFirst);
    assert.ok(firstCards.every((card) => card.severity === "advisory"));
    assert.equal(secondCards.length, findingsOn(second).length);
    assert.equal(view.sheetCount(first), `${advisoryOnFirst} of ${findingsOn(first).length}`);
    assert.equal(view.sheetCount(second), String(findingsOn(second).length));
    assert.ok(view.sheetFilterPressed(first, "advisory"));
    assert.ok(view.sheetFilterPressed(second, "all"));
    assert.equal(view.sheetRows, 82);
  });

  it("keeps drawing filters consistent with the global selection and lets one drawing widen", () => {
    let state = clickSummaryCard(initialState(), "critical");
    let view = renderList(state);
    const criticalJobs = [...jobsWith("critical")];
    for (const jobId of criticalJobs) {
      assert.ok(view.sheetFilterPressed(jobId, "critical"), `${jobId} shows the global selection`);
      assert.equal(view.sheetCount(jobId), `${findingsOn(jobId).filter((item) => item.severity === "critical").length} of ${findingsOn(jobId).length}`);
    }
    state = clickSheetFilter(state, criticalJobs[0], "all");
    view = renderList(state);
    assert.ok(view.sheetFilterPressed(criticalJobs[0], "all"));
    assert.equal(view.sheetRows, criticalJobs.length);
    assert.equal(view.cards.length, 4 - findingsOn(criticalJobs[0]).filter((item) => item.severity === "critical").length + findingsOn(criticalJobs[0]).length);

    state = clickSummaryCard(state, "warning");
    assert.deepEqual(state.sheetSeverity, {}, "a new global selection clears drawing overrides");
  });

  it("keeps report IDs, reviewer decisions and Accept, Modify and Reject under every filter", () => {
    const states: ViewState[] = [
      initialState(dataset.jobs.map((item) => item.id)),
      clickSummaryCard(initialState(), "critical"),
      clickSummaryCard(initialState(), "warning"),
      clickSummaryCard(initialState(), "advisory"),
      clickSheetFilter(initialState(dataset.jobs.map((item) => item.id)), dataset.jobs[0].id, "warning"),
    ];
    for (const state of states) {
      const view = renderList(state);
      assert.ok(view.cards.length > 0);
      for (const card of view.cards) {
        assert.equal(card.reportId, model.reportIdByFindingId.get(card.findingId));
        assert.equal(card.decision, reviewsByFinding.get(card.findingId)?.decision || "none");
      }
      for (const label of ["Accept", "Modify", "Reject"]) {
        assert.equal((view.html.match(new RegExp(`</svg>${label}</button>`, "g")) || []).length, view.cards.length, `${label} buttons`);
      }
    }
    const all = renderList(states[0]);
    assert.equal(all.cards.length, 252);
    assert.deepEqual(new Set(all.cards.map((card) => card.reportId)), new Set(model.findings.map((item) => item.reportId)));
  });

  it("keeps summary card counts on the full dataset whatever is selected", () => {
    const counts = countSeverity(dataset.findings);
    for (const active of ["all", "critical", "warning", "advisory"] as const) {
      const html = renderToStaticMarkup(createElement(FindingsMatrix, { counts, active, processing: false, onSelect: noop }));
      const values = [...html.matchAll(/data-testid="findings-matrix-(\w+)"[\s\S]*?font-display[^>]*>(\d+)</g)].map((match) => [match[1], Number(match[2])]);
      assert.deepEqual(values, [["all", 252], ["critical", 4], ["warning", 83], ["advisory", 165]]);
      assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
      assert.ok(html.includes(`aria-pressed="true" data-testid="findings-matrix-${active}"`));
    }
  });

  it("does not change the stored data, report fingerprint or exports", async () => {
    const generatedAt = new Date("2026-10-28T15:00:00Z");
    const exports = async () => {
      const fingerprint = await fingerprintArchitectReview(dataset);
      const pdf = renderArchitectReviewPdf({
        dataset,
        model: buildArchitectReviewModel(dataset),
        fingerprint,
        projectName: "Fixture project",
        generatedAt,
        logo: null,
      }).doc.output("arraybuffer");
      return {
        fingerprint: fingerprint.digest,
        json: JSON.stringify(buildSupabaseAnalyzerJsonExport(dataset, "Fixture project", generatedAt.toISOString())),
        pdf: Buffer.from(pdf).toString("base64"),
      };
    };
    const before = await exports();
    let state = initialState();
    for (const card of ["critical", "warning", "advisory", "all", "warning"] as const) {
      state = clickSummaryCard(state, card);
      renderList(state);
      state = clickSheetFilter(state, dataset.jobs[1].id, "advisory");
      renderList(state);
    }
    const after = await exports();
    assert.equal(after.fingerprint, before.fingerprint);
    assert.equal(after.json, before.json);
    assert.equal(after.pdf, before.pdf);
  });
});
