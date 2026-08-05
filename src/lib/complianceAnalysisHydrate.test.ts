import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  complianceDocsHydrateKey,
  complianceResultsEmptyMessage,
  createGenerationGuard,
  mergeLoadedExistingAnalyses,
  resolveComplianceResultsEmptyKind,
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
    // Land on project A, start All hydrate
    const hydrateA = guard.next();
    // Switch to Riverside before A completes
    guard.invalidate();
    const hydrateRiverside = guard.next();
    // Stale A completion arrives
    assert.equal(guard.isCurrent(hydrateA), false);
    // Riverside completion is accepted
    assert.equal(guard.isCurrent(hydrateRiverside), true);
  });

  it("simulates mount-with-All: empty list then docs arrive starts a new generation", () => {
    const guard = createGenerationGuard();
    // Initial empty hydrate skipped — no token
    assert.equal(complianceDocsHydrateKey([]), "");
    // Docs arrive → All hydrate
    const token = guard.next();
    assert.equal(guard.isCurrent(token), true);
    // Same key success keeps token current; a retry gets a new token
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
