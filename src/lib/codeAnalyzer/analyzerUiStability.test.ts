import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzerDocsDiscoveryScope,
  analyzerSheetFingerprint,
  indexPrescreenEffectKey,
  sheetDocumentIdsKey,
  shouldClearPrescreenOnDatasetReload,
  shouldRunIndexPrescreen,
  shouldShowIndexCompletenessPanel,
  shouldWipePrescreenResultInEffect,
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

describe("shouldShowIndexCompletenessPanel", () => {
  const sampleResult = { status: "complete", expectedCount: 1, actualCount: 1 };

  it("stays visible after hydration when a valid prescreen result exists", () => {
    assert.equal(
      shouldShowIndexCompletenessPanel({
        persistedSheetCount: 33,
        result: sampleResult,
        loading: false,
      }),
      true,
    );
  });

  it("stays visible when sheets exist but hydration cleared transient state", () => {
    assert.equal(
      shouldShowIndexCompletenessPanel({
        persistedSheetCount: 33,
        result: sampleResult,
        loading: false,
        recheckError: null,
      }),
      true,
    );
  });

  it("shows loading shell before first result arrives", () => {
    assert.equal(
      shouldShowIndexCompletenessPanel({
        persistedSheetCount: 5,
        result: null,
        loading: true,
      }),
      true,
    );
  });

  it("hides when dataset is empty and no preserved result", () => {
    assert.equal(
      shouldShowIndexCompletenessPanel({
        persistedSheetCount: 0,
        result: null,
        loading: false,
      }),
      false,
    );
  });

  it("keeps panel mounted during recheck failure with last result", () => {
    assert.equal(
      shouldShowIndexCompletenessPanel({
        persistedSheetCount: 10,
        result: sampleResult,
        loading: false,
        recheckError: "Vision extract failed",
      }),
      true,
    );
  });
});

describe("prescreen clear semantics", () => {
  it("does not wipe prescreen result in effect when included count is transiently zero", () => {
    assert.equal(shouldWipePrescreenResultInEffect(0), false);
  });

  it("clears prescreen only on confirmed-empty dataset reload", () => {
    assert.equal(shouldClearPrescreenOnDatasetReload(0), true);
    assert.equal(shouldClearPrescreenOnDatasetReload(1), false);
  });

  it("historical-to-current hydration does not change prescreen effect key", () => {
    const key = indexPrescreenEffectKey({
      sheetFingerprint: "src-a:1|src-b:2",
      sheetDocIdsKey: "d1,d2",
      isModificationMode: false,
    });
    assert.equal(shouldRunIndexPrescreen(key, key), false);
  });
});
