import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSheetFingerprint,
  filterAnnotationsForActiveAnalysis,
  shouldMarkAnalysisStale,
} from "./model.ts";
import { mergeFindingsAfterReplace } from "./findings.ts";

describe("code analyzer drawing lifecycle", () => {
  it("add after completed analysis marks the current run stale", () => {
    const afterFirst = computeSheetFingerprint([{ source_document_id: "a", page_number: 1 }]);
    const afterAdd = computeSheetFingerprint([
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "b", page_number: 1 },
    ]);
    assert.equal(
      shouldMarkAnalysisStale({
        runStatus: "current",
        runFingerprint: afterFirst,
        currentFingerprint: afterAdd,
        pendingSourceCount: 0,
      }),
      true,
    );
  });

  it("update analysis includes the added drawing in the new fingerprint", () => {
    const included = [
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "b", page_number: 1 },
    ];
    assert.equal(computeSheetFingerprint(included), "a:1|b:1");
  });

  it("removing a drawing drops it from the fingerprint so its findings no longer belong to the current set", () => {
    const before = computeSheetFingerprint([
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "b", page_number: 1 },
    ]);
    const after = computeSheetFingerprint([{ source_document_id: "a", page_number: 1 }]);
    assert.notEqual(before, after);
    assert.equal(after.includes("b:1"), false);
  });

  it("rerun does not keep previous-run findings as active", () => {
    const rows = [
      { id: "old", analysis_run_id: "run-1", data: { compliance_issue: true } },
      { id: "new", analysis_run_id: "run-2", data: { compliance_issue: true } },
    ];
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: "run-2",
      hasAnalyzerRuns: true,
    });
    assert.deepEqual(active.map((r) => r.id), ["new"]);
  });

  it("failed retry replaces the same run+document instead of duplicating", () => {
    const afterRetry = mergeFindingsAfterReplace(
      [{ documentId: "img-1", runId: "run-1", n: 1 }],
      { documentId: "img-1", runId: "run-1", n: 2 },
    );
    assert.equal(afterRetry.length, 1);
    assert.equal(afterRetry[0].n, 2);
  });

  it("twice without changing files keeps the same fingerprint", () => {
    const sheets = [
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "a", page_number: 2 },
    ];
    assert.equal(computeSheetFingerprint(sheets), computeSheetFingerprint([...sheets].reverse()));
  });

  it("refresh hydrates legacy records when no analyzer runs exist", () => {
    const hydrated = filterAnnotationsForActiveAnalysis(
      [
        { id: "legacy", data: { compliance_issue: true, title: "Exit width" } },
        { id: "other", data: { note: "not compliance" } },
      ],
      { currentRunId: null, hasAnalyzerRuns: false },
    );
    assert.equal(hydrated.length, 1);
    assert.equal(hydrated[0].id, "legacy");
  });
});
