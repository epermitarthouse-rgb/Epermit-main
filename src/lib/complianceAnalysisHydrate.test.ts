import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  complianceDocsHydrateKey,
  complianceResultsEmptyMessage,
  createGenerationGuard,
  mergeLoadedExistingAnalyses,
  resolveComplianceHydrateSource,
  resolveComplianceResultsEmptyKind,
  shouldShowComplianceKpiStrip,
} from "./complianceAnalysisHydrate.ts";

describe("complianceDocsHydrateKey", () => {
  it("is order-independent and ignores empties", () => {
    assert.equal(
      complianceDocsHydrateKey(["b", "a", ""]),
      complianceDocsHydrateKey(["a", "b"]),
    );
    assert.equal(complianceDocsHydrateKey([]), "");
  });
});

describe("createGenerationGuard", () => {
  it("marks only the latest token current so stale hydrates are ignored", () => {
    const guard = createGenerationGuard();
    const first = guard.next();
    assert.equal(guard.isCurrent(first), true);
    const second = guard.next();
    assert.equal(guard.isCurrent(first), false);
    assert.equal(guard.isCurrent(second), true);
    guard.invalidate();
    assert.equal(guard.isCurrent(second), false);
  });

  it("simulates project-change race: older All hydrate must not win", () => {
    const guard = createGenerationGuard();
    const hydrateA = guard.next();
    guard.invalidate();
    const hydrateRiverside = guard.next();
    assert.equal(guard.isCurrent(hydrateA), false);
    assert.equal(guard.isCurrent(hydrateRiverside), true);
  });

  it("simulates mount-with-All: empty list then docs arrive starts a new generation", () => {
    const guard = createGenerationGuard();
    assert.equal(complianceDocsHydrateKey([]), "");
    const token = guard.next();
    assert.equal(guard.isCurrent(token), true);
    const retry = guard.next();
    assert.equal(guard.isCurrent(token), false);
    assert.equal(guard.isCurrent(retry), true);
  });
});

describe("mergeLoadedExistingAnalyses", () => {
  const a = { documentId: "a", fileName: "a.pdf" };
  const b = { documentId: "b", fileName: "b.pdf" };
  const a2 = { documentId: "a", fileName: "a-v2.pdf" };

  it("replace mode swaps the full All set", () => {
    assert.deepEqual(mergeLoadedExistingAnalyses([a], [b], "replace"), [b]);
  });

  it("merge mode updates only requested document ids", () => {
    assert.deepEqual(mergeLoadedExistingAnalyses([a, b], [a2], "merge", ["a"]), [
      b,
      a2,
    ]);
  });
});

describe("resolveComplianceResultsEmptyKind / messages", () => {
  const base = {
    loading: false,
    loadFailed: false,
    analyzedDocCount: 0,
    resultGroupCount: 0,
    displayedGroupCount: 0,
    documentFilterIsAll: true,
    scoreFilterIsNot100: false,
  };

  it("returns none when groups are displayed", () => {
    assert.equal(
      resolveComplianceResultsEmptyKind({ ...base, displayedGroupCount: 2 }),
      "none",
    );
  });

  it("prefers loading over other empty reasons", () => {
    assert.equal(
      resolveComplianceResultsEmptyKind({
        ...base,
        loading: true,
        analyzedDocCount: 17,
      }),
      "loading",
    );
  });

  it("treats analyzed docs with zero hydrated groups as load_failed (All on land)", () => {
    assert.equal(
      resolveComplianceResultsEmptyKind({
        ...base,
        analyzedDocCount: 17,
        resultGroupCount: 0,
        documentFilterIsAll: true,
      }),
      "load_failed",
    );
    const msg = complianceResultsEmptyMessage("load_failed", 17);
    assert.match(msg ?? "", /Found 17 previously analyzed/);
  });

  it("does not report load_failed when no analyzed docs exist (sheet inventory only)", () => {
    assert.equal(resolveComplianceResultsEmptyKind(base), "no_analyzed_docs");
  });

  it("surfaces not-100 filter empties separately from load failure", () => {
    assert.equal(
      resolveComplianceResultsEmptyKind({
        ...base,
        analyzedDocCount: 17,
        resultGroupCount: 17,
        displayedGroupCount: 0,
        scoreFilterIsNot100: true,
      }),
      "filter_not_100",
    );
  });

  it("surfaces true zero-analyses empty state", () => {
    assert.equal(resolveComplianceResultsEmptyKind(base), "no_analyzed_docs");
    assert.match(
      complianceResultsEmptyMessage("no_analyzed_docs") ?? "",
      /No previously analyzed/,
    );
  });
});

describe("complianceResultsEmptyMessage", () => {
  it("avoids misleading analyzed-doc count in generic load failure copy", () => {
    const message = complianceResultsEmptyMessage("load_failed", 0);
    assert.match(message ?? "", /Failed to load previous analyses/);
    assert.doesNotMatch(message ?? "", /Found \d+ previously analyzed/);
  });
});

describe("shouldShowComplianceKpiStrip", () => {
  it("hides KPIs while loading or after hydrate failure", () => {
    assert.equal(
      shouldShowComplianceKpiStrip({
        loading: true,
        loadFailed: false,
        displayedGroupCount: 0,
        analyzedDocCount: 5,
        hydratedGroupCount: 0,
      }),
      false,
    );
    assert.equal(
      shouldShowComplianceKpiStrip({
        loading: false,
        loadFailed: true,
        displayedGroupCount: 0,
        analyzedDocCount: 5,
        hydratedGroupCount: 0,
      }),
      false,
    );
  });

  it("hides zero KPIs when analyzed docs exist but hydration produced no groups", () => {
    assert.equal(
      shouldShowComplianceKpiStrip({
        loading: false,
        loadFailed: false,
        displayedGroupCount: 0,
        analyzedDocCount: 47,
        hydratedGroupCount: 0,
      }),
      false,
    );
  });

  it("shows KPIs when displayed results exist", () => {
    assert.equal(
      shouldShowComplianceKpiStrip({
        loading: false,
        loadFailed: false,
        displayedGroupCount: 2,
        analyzedDocCount: 2,
        hydratedGroupCount: 2,
      }),
      true,
    );
  });
});

describe("resolveComplianceHydrateSource", () => {
  it("marks legacy projects without analyzer runs", () => {
    assert.equal(resolveComplianceHydrateSource(false, null, false), "legacy");
  });

  it("marks historical fallback separately from stale display runs", () => {
    assert.equal(resolveComplianceHydrateSource(true, null, true), "historical");
    assert.equal(resolveComplianceHydrateSource(true, "stale", false), "stale");
    assert.equal(resolveComplianceHydrateSource(true, "current", false), "current");
  });
});
