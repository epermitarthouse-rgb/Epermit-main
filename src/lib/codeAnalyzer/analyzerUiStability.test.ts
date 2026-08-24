import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzerDocsDiscoveryScope,
  analyzerSheetFingerprint,
  indexPrescreenEffectKey,
  serializeIndexCompleteness,
  sheetDocumentIdsKey,
  shouldRunIndexPrescreen,
} from "./analyzerUiStability.ts";

describe("indexPrescreenEffectKey / shouldRunIndexPrescreen", () => {
  const base = {
    sheetFingerprint: "src-a:1|src-b:2",
    sheetDocIdsKey: "d1,d2",
    isModificationMode: false,
    activeRunId: "run-1",
    activeRunIndexCompletenessJson: '{"complete":true}',
  };

  it("does not re-run when sheet fingerprint is unchanged (new array, same contents)", () => {
    const sheetsA = [
      { source_document_id: "src-a", page_number: 1, excluded: false },
      { source_document_id: "src-b", page_number: 2, excluded: false },
    ];
    const sheetsB = [
      { source_document_id: "src-b", page_number: 2, excluded: false },
      { source_document_id: "src-a", page_number: 1, excluded: false },
    ];
    const fpA = analyzerSheetFingerprint(sheetsA as never);
    const fpB = analyzerSheetFingerprint(sheetsB as never);
    assert.equal(fpA, fpB);

    const keyA = indexPrescreenEffectKey({ ...base, sheetFingerprint: fpA });
    const keyB = indexPrescreenEffectKey({ ...base, sheetFingerprint: fpB });
    assert.equal(shouldRunIndexPrescreen(keyA, keyB), false);
  });

  it("re-runs when included sheets change", () => {
    const prev = indexPrescreenEffectKey(base);
    const next = indexPrescreenEffectKey({
      ...base,
      sheetFingerprint: "src-a:1|src-c:3",
    });
    assert.equal(shouldRunIndexPrescreen(prev, next), true);
  });

  it("re-runs when active run id changes but sheet fingerprint is stable", () => {
    const prev = indexPrescreenEffectKey(base);
    const next = indexPrescreenEffectKey({ ...base, activeRunId: "run-2" });
    assert.equal(shouldRunIndexPrescreen(prev, next), true);
  });

  it("uses serialized completeness, not object identity", () => {
    const json = serializeIndexCompleteness({ missing: ["A1"], complete: false });
    const keyA = indexPrescreenEffectKey({ ...base, activeRunIndexCompletenessJson: json });
    const keyB = indexPrescreenEffectKey({
      ...base,
      activeRunIndexCompletenessJson: serializeIndexCompleteness({ missing: ["A1"], complete: false }),
    });
    assert.equal(shouldRunIndexPrescreen(keyA, keyB), false);
  });

  it("sheetDocumentIdsKey is order-independent", () => {
    assert.equal(sheetDocumentIdsKey(["b", "a"]), sheetDocumentIdsKey(["a", "b"]));
  });

  it("E: prescreen reruns when index sheet is added to an unchanged run", () => {
    const beforeFp = analyzerSheetFingerprint([
      { source_document_id: "src-a", page_number: 1, excluded: false },
    ] as never);
    const afterFp = analyzerSheetFingerprint([
      { source_document_id: "src-a", page_number: 1, excluded: false },
      { source_document_id: "src-index", page_number: 1, excluded: false },
    ] as never);
    const noIndexJson = serializeIndexCompleteness({ status: "no_index", hasIndex: false });
    const prev = indexPrescreenEffectKey({
      ...base,
      sheetFingerprint: beforeFp,
      activeRunIndexCompletenessJson: noIndexJson,
    });
    const next = indexPrescreenEffectKey({
      ...base,
      sheetFingerprint: afterFp,
      activeRunIndexCompletenessJson: noIndexJson,
    });
    assert.equal(shouldRunIndexPrescreen(prev, next), true);
  });

  it("F: prescreen idle when dataset unchanged (no loop)", () => {
    const key = indexPrescreenEffectKey(base);
    assert.equal(shouldRunIndexPrescreen(key, key), false);
  });
});

describe("analyzerDocsDiscoveryScope", () => {
  it("fetchDocsWithAnalysis does not reload the full analyzer dataset", () => {
    assert.equal(analyzerDocsDiscoveryScope(), "annotations_and_docs");
  });
});
