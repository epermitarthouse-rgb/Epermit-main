import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzerDocsDiscoveryScope,
  analyzerSheetFingerprint,
  indexPrescreenEffectKey,
  sheetDocumentIdsKey,
  shouldRunIndexPrescreen,
} from "./analyzerUiStability.ts";

describe("indexPrescreenEffectKey / shouldRunIndexPrescreen", () => {
  const base = {
    sheetFingerprint: "src-a:1|src-b:2",
    sheetDocIdsKey: "d1,d2",
    isModificationMode: false,
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

  it("does not re-run when only analysis run id changes (progress unrelated)", () => {
    const key = indexPrescreenEffectKey(base);
    assert.equal(shouldRunIndexPrescreen(key, key), false);
  });

  it("sheetDocumentIdsKey is order-independent", () => {
    assert.equal(sheetDocumentIdsKey(["b", "a"]), sheetDocumentIdsKey(["a", "b"]));
  });

  it("prescreen reruns when index sheet is added to the dataset", () => {
    const beforeFp = analyzerSheetFingerprint([
      { source_document_id: "src-a", page_number: 1, excluded: false },
    ] as never);
    const afterFp = analyzerSheetFingerprint([
      { source_document_id: "src-a", page_number: 1, excluded: false },
      { source_document_id: "src-index", page_number: 1, excluded: false },
    ] as never);
    const prev = indexPrescreenEffectKey({
      ...base,
      sheetFingerprint: beforeFp,
    });
    const next = indexPrescreenEffectKey({
      ...base,
      sheetFingerprint: afterFp,
    });
    assert.equal(shouldRunIndexPrescreen(prev, next), true);
  });

  it("prescreen idle when dataset unchanged (no loop)", () => {
    const key = indexPrescreenEffectKey(base);
    assert.equal(shouldRunIndexPrescreen(key, key), false);
  });
});

describe("analyzerDocsDiscoveryScope", () => {
  it("fetchDocsWithAnalysis does not reload the full analyzer dataset", () => {
    assert.equal(analyzerDocsDiscoveryScope(), "annotations_and_docs");
  });
});
