import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFormFingerprint, computeFormsFingerprint } from "./model.ts";

describe("computeFormsFingerprint", () => {
  it("returns the same fingerprint as a single-form review for legacy compatibility", () => {
    const single = computeFormFingerprint({
      formDocumentId: "form-1",
      updatedAt: "t1",
      pageCount: 3,
    });
    const fromSet = computeFormsFingerprint([
      { formDocumentId: "form-1", updatedAt: "t1", pageCount: 3 },
    ]);
    assert.equal(fromSet, single);
  });

  it("orders multiple documents deterministically by document id", () => {
    const fp = computeFormsFingerprint([
      { formDocumentId: "form-b", updatedAt: "t2" },
      { formDocumentId: "form-a", updatedAt: "t1" },
    ]);
    assert.match(fp, /form-a/);
    assert.match(fp, /form-b/);
    assert.equal(fp.indexOf("form-a"), 0);
    assert.equal(fp.includes("||"), true);
  });

  it("changes when any document in the set changes", () => {
    const before = computeFormsFingerprint([
      { formDocumentId: "form-a", updatedAt: "t1" },
      { formDocumentId: "form-b", updatedAt: "t2" },
    ]);
    const after = computeFormsFingerprint([
      { formDocumentId: "form-a", updatedAt: "t1" },
      { formDocumentId: "form-b", updatedAt: "t3" },
    ]);
    assert.notEqual(before, after);
  });
});
