import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  ANALYSIS_TYPE_STANDARD,
  allocateIncludedSheetKeys,
  computeSheetFingerprint,
  computeStandardRunFingerprint,
  filterAnnotationsForActiveAnalysis,
  isStandardComplianceRun,
  normalizeAnalysisInstructions,
  pickCurrentRun,
  pickDisplayRun,
  planPdfPageNumbers,
  planSourceFilePages,
  runAnalysisType,
  shouldMarkAnalysisStale,
  sheetDisplayName,
  type CodeAnalyzerRun,
} from "./model.ts";

function run(partial: Partial<CodeAnalyzerRun> & { id: string; status: CodeAnalyzerRun["status"] }): CodeAnalyzerRun {
  return {
    project_id: "p1",
    user_id: "u1",
    jurisdiction: "dc",
    project_type: "commercial",
    code_year: "2021",
    analysis_mode: "both",
    source_fingerprint: "",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    completed_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("planPdfPageNumbers", () => {
  it("does not collapse a multipage PDF to page 1", () => {
    const planned = planPdfPageNumbers(5);
    assert.deepEqual(planned.pageNumbers, [1, 2, 3, 4, 5]);
    assert.equal(planned.truncated, false);
    assert.equal(planned.totalPages, 5);
  });

  it("caps expansion and reports truncation", () => {
    const planned = planPdfPageNumbers(25, 20);
    assert.equal(planned.pageNumbers.length, 20);
    assert.equal(planned.pageNumbers[0], 1);
    assert.equal(planned.pageNumbers[19], 20);
    assert.equal(planned.truncated, true);
  });
});

describe("planSourceFilePages", () => {
  it("treats images as a single sheet", () => {
    assert.deepEqual(planSourceFilePages({ type: "image/png", name: "a.png" }).pageNumbers, [1]);
  });

  it("expands PDFs using the page count, not page 1 only", () => {
    const planned = planSourceFilePages({ type: "application/pdf", name: "set.pdf" }, 3);
    assert.deepEqual(planned.pageNumbers, [1, 2, 3]);
  });
});

describe("computeSheetFingerprint", () => {
  it("ignores excluded sheets and is order-independent", () => {
    const a = computeSheetFingerprint([
      { source_document_id: "b", page_number: 2 },
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "c", page_number: 1, excluded: true },
    ]);
    const b = computeSheetFingerprint([
      { source_document_id: "a", page_number: 1 },
      { source_document_id: "b", page_number: 2 },
    ]);
    assert.equal(a, b);
    assert.equal(a, "a:1|b:2");
  });
});

describe("computeStandardRunFingerprint", () => {
  it("includes staff guidance in the fingerprint", () => {
    const sheets = [{ source_document_id: "a", page_number: 1 }];
    const without = computeStandardRunFingerprint(sheets, "");
    const withInstr = computeStandardRunFingerprint(sheets, "Focus on egress");
    assert.equal(without, "a:1");
    assert.notEqual(without, withInstr);
    assert.match(withInstr, /instr:Focus on egress/);
  });

  it("normalizes instruction whitespace", () => {
    assert.equal(normalizeAnalysisInstructions("  a\r\nb  "), "a\nb");
  });
});

describe("shouldMarkAnalysisStale", () => {
  it("marks stale when a new drawing is pending after a current run", () => {
    assert.equal(
      shouldMarkAnalysisStale({
        runStatus: "current",
        runFingerprint: "a:1",
        currentFingerprint: "a:1",
        pendingSourceCount: 1,
      }),
      true,
    );
  });

  it("marks stale when an included sheet is removed", () => {
    assert.equal(
      shouldMarkAnalysisStale({
        runStatus: "current",
        runFingerprint: "a:1|b:1",
        currentFingerprint: "a:1",
        pendingSourceCount: 0,
      }),
      true,
    );
  });

  it("is not stale when the included set matches the current run", () => {
    assert.equal(
      shouldMarkAnalysisStale({
        runStatus: "current",
        runFingerprint: "a:1",
        currentFingerprint: "a:1",
        pendingSourceCount: 0,
      }),
      false,
    );
  });

  it("marks stale when staff guidance changes", () => {
    const sheets = "a:1";
    assert.equal(
      shouldMarkAnalysisStale({
        runStatus: "current",
        runFingerprint: `${sheets}||instr:old focus`,
        currentFingerprint: `${sheets}||instr:new focus`,
        pendingSourceCount: 0,
      }),
      true,
    );
  });
});

describe("pickDisplayRun / pickCurrentRun", () => {
  it("prefers current over stale", () => {
    const runs = [
      run({ id: "stale", status: "stale", completed_at: "2026-08-02T00:00:00Z" }),
      run({ id: "cur", status: "current", completed_at: "2026-08-03T00:00:00Z" }),
    ];
    assert.equal(pickCurrentRun(runs)?.id, "cur");
    assert.equal(pickDisplayRun(runs)?.id, "cur");
  });

  it("falls back to latest stale when no current run exists", () => {
    const runs = [
      run({ id: "old", status: "stale", completed_at: "2026-08-01T00:00:00Z" }),
      run({ id: "new", status: "stale", completed_at: "2026-08-04T00:00:00Z" }),
      run({ id: "sup", status: "superseded", completed_at: "2026-08-05T00:00:00Z" }),
    ];
    assert.equal(pickCurrentRun(runs), null);
    assert.equal(pickDisplayRun(runs)?.id, "new");
  });

  it("scopes current/display runs by analysis type and treats missing type as standard", () => {
    const runs = [
      run({
        id: "mod",
        status: "current",
        analysis_type: ANALYSIS_TYPE_DC_MODIFICATION,
        completed_at: "2026-08-05T00:00:00Z",
      }),
      run({
        id: "std-stale",
        status: "stale",
        analysis_type: ANALYSIS_TYPE_STANDARD,
        completed_at: "2026-08-04T00:00:00Z",
      }),
      run({ id: "legacy", status: "current" }),
    ];
    assert.equal(runAnalysisType(runs[2]), ANALYSIS_TYPE_STANDARD);
    assert.equal(isStandardComplianceRun(runs[0]), false);
    assert.equal(pickCurrentRun(runs)?.id, "legacy");
    assert.equal(pickDisplayRun(runs)?.id, "legacy");
    assert.equal(pickCurrentRun(runs, ANALYSIS_TYPE_DC_MODIFICATION)?.id, "mod");
    assert.equal(pickDisplayRun(runs, ANALYSIS_TYPE_STANDARD)?.id, "legacy");
  });
});

describe("filterAnnotationsForActiveAnalysis", () => {
  const rows = [
    { id: "legacy", data: { compliance_issue: true, title: "old" } },
    { id: "run-a", analysis_run_id: "run-a", data: { compliance_issue: true, analysis_run_id: "run-a" } },
    { id: "run-b", analysis_run_id: "run-b", data: { compliance_issue: true, analysis_run_id: "run-b" } },
    { id: "noise", data: { note: "nope" } },
  ];

  it("hydrates legacy annotations when the project has no analyzer runs", () => {
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: null,
      hasAnalyzerRuns: false,
    });
    assert.deepEqual(active.map((r) => r.id), ["legacy"]);
  });

  it("keeps only the current run when a current run exists", () => {
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: "run-b",
      hasAnalyzerRuns: true,
    });
    assert.deepEqual(active.map((r) => r.id), ["run-b"]);
  });

  it("excludes stale/historical findings when runs exist but none are current", () => {
    const active = filterAnnotationsForActiveAnalysis(rows, {
      currentRunId: null,
      hasAnalyzerRuns: true,
    });
    assert.equal(active.length, 0);
  });
});

describe("allocateIncludedSheetKeys", () => {
  it("keeps existing included sheets and excludes overflow new pages", () => {
    const existing = Array.from({ length: 39 }, (_, i) => ({
      source_document_id: "old",
      page_number: i + 1,
    }));
    const incoming = [
      { source_document_id: "new", page_number: 1 },
      { source_document_id: "new", page_number: 2 },
    ];
    const result = allocateIncludedSheetKeys(existing, incoming, 40);
    assert.equal(result.includedKeys.size, 40);
    assert.equal(result.includedKeys.has("new:1"), true);
    assert.equal(result.includedKeys.has("new:2"), false);
    assert.equal(result.excludedNewCount, 1);
  });

  it("includes up to forty single-page sheets", () => {
    const incoming = Array.from({ length: 40 }, (_, i) => ({
      source_document_id: `doc-${i}`,
      page_number: 1,
    }));
    const result = allocateIncludedSheetKeys([], incoming, 40);
    assert.equal(result.includedKeys.size, 40);
    assert.equal(result.excludedNewCount, 0);
  });

  it("excludes sheets beyond the forty-sheet cap", () => {
    const incoming = Array.from({ length: 41 }, (_, i) => ({
      source_document_id: `doc-${i}`,
      page_number: 1,
    }));
    const result = allocateIncludedSheetKeys([], incoming, 40);
    assert.equal(result.includedKeys.size, 40);
    assert.equal(result.excludedNewCount, 1);
  });
});

describe("sheetDisplayName", () => {
  it("includes page number for PDF-backed sheets", () => {
    assert.equal(
      sheetDisplayName({ file_name: "plans.pdf", page_number: 3, sourceIsPdf: true }),
      "plans · p.3",
    );
  });
});
