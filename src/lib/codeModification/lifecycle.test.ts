import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_TYPE_DC_MODIFICATION,
  ANALYSIS_TYPE_STANDARD,
  pickCurrentRun,
  pickDisplayRun,
  type CodeAnalyzerRun,
} from "../codeAnalyzer/model.ts";
import {
  computeFormFingerprint,
  computeFormsFingerprint,
  computeModificationSourceFingerprint,
  formDocumentIdsMatch,
  modificationSheetFingerprint,
  shouldMarkModificationReviewStale,
} from "./model.ts";

function run(
  partial: Partial<CodeAnalyzerRun> & { id: string; status: CodeAnalyzerRun["status"] },
): CodeAnalyzerRun {
  return {
    project_id: "p1",
    user_id: "u1",
    jurisdiction: "dc",
    project_type: "commercial",
    code_year: "2021",
    analysis_mode: "modification",
    analysis_type: ANALYSIS_TYPE_DC_MODIFICATION,
    form_document_id: "form-1",
    source_fingerprint: "",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    completed_at: "2026-08-01T00:00:00Z",
    ...partial,
  };
}

describe("code modification review lifecycle", () => {
  const formFp = computeFormFingerprint({ formDocumentId: "form-1", updatedAt: "t1", pageCount: 3 });
  const sheetsAfterFirst = modificationSheetFingerprint([{ source_document_id: "a", page_number: 1 }]);
  const firstFp = computeModificationSourceFingerprint(formFp, sheetsAfterFirst);

  it("marks the review stale when a drawing is added", () => {
    const afterAdd = computeModificationSourceFingerprint(
      formFp,
      modificationSheetFingerprint([
        { source_document_id: "a", page_number: 1 },
        { source_document_id: "b", page_number: 1 },
      ]),
    );
    assert.equal(
      shouldMarkModificationReviewStale({
        runStatus: "current",
        runFingerprint: firstFp,
        currentFingerprint: afterAdd,
      }),
      true,
    );
  });

  it("marks the review stale when a drawing is removed", () => {
    const before = computeModificationSourceFingerprint(
      formFp,
      modificationSheetFingerprint([
        { source_document_id: "a", page_number: 1 },
        { source_document_id: "b", page_number: 1 },
      ]),
    );
    const after = computeModificationSourceFingerprint(
      formFp,
      modificationSheetFingerprint([{ source_document_id: "a", page_number: 1 }]),
    );
    assert.notEqual(before, after);
    assert.equal(
      shouldMarkModificationReviewStale({
        runStatus: "current",
        runFingerprint: before,
        currentFingerprint: after,
      }),
      true,
    );
  });

  it("marks the review stale when the form is replaced", () => {
    const replacedForm = computeFormFingerprint({
      formDocumentId: "form-2",
      updatedAt: "t2",
      pageCount: 3,
    });
    assert.notEqual(formFp, replacedForm);
    assert.equal(
      shouldMarkModificationReviewStale({
        runStatus: "current",
        runFingerprint: firstFp,
        currentFingerprint: computeModificationSourceFingerprint(replacedForm, sheetsAfterFirst),
        formChanged: true,
      }),
      true,
    );
  });

  it("fingerprint includes both form identity and included sheets", () => {
    assert.match(firstFp, /form-1/);
    assert.match(firstFp, /a:1/);
    assert.equal(firstFp.includes("form:"), true);
    assert.equal(firstFp.includes("sheets:"), true);
  });

  it("marks the review stale when a second CM document is added", () => {
    const singleFormFp = computeFormsFingerprint([
      { formDocumentId: "form-1", updatedAt: "t1", pageCount: 3 },
    ]);
    const multiFormFp = computeFormsFingerprint([
      { formDocumentId: "form-1", updatedAt: "t1", pageCount: 3 },
      { formDocumentId: "form-2", updatedAt: "t2", pageCount: 2 },
    ]);
    assert.notEqual(singleFormFp, multiFormFp);
    assert.equal(
      shouldMarkModificationReviewStale({
        runStatus: "current",
        runFingerprint: computeModificationSourceFingerprint(singleFormFp, sheetsAfterFirst),
        currentFingerprint: computeModificationSourceFingerprint(multiFormFp, sheetsAfterFirst),
        formChanged: true,
      }),
      true,
    );
  });

  it("matches legacy single-form document ids for hydration", () => {
    assert.equal(formDocumentIdsMatch(["form-1"], ["form-1"]), true);
    assert.equal(formDocumentIdsMatch(["form-1"], ["form-1", "form-2"]), false);
    assert.equal(formDocumentIdsMatch(undefined, []), true);
  });

  it("Update Review creates a new current modification run without touching standard", () => {
    const previous = run({
      id: "mod-old",
      status: "superseded",
      source_fingerprint: firstFp,
    });
    const next = run({
      id: "mod-new",
      status: "current",
      source_fingerprint: computeModificationSourceFingerprint(
        formFp,
        modificationSheetFingerprint([
          { source_document_id: "a", page_number: 1 },
          { source_document_id: "b", page_number: 1 },
        ]),
      ),
      completed_at: "2026-08-04T00:00:00Z",
    });
    const standard = run({
      id: "std-current",
      status: "current",
      analysis_type: ANALYSIS_TYPE_STANDARD,
      analysis_mode: "both",
      form_document_id: null,
    });
    const runs = [previous, next, standard];
    assert.equal(pickCurrentRun(runs, ANALYSIS_TYPE_DC_MODIFICATION)?.id, "mod-new");
    assert.equal(pickDisplayRun(runs, ANALYSIS_TYPE_DC_MODIFICATION)?.id, "mod-new");
    assert.equal(pickCurrentRun(runs, ANALYSIS_TYPE_STANDARD)?.id, "std-current");
    assert.notEqual(previous.source_fingerprint, next.source_fingerprint);
  });
});
