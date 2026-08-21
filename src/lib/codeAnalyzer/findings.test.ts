import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeFindingsAfterReplace } from "./findings.ts";

describe("mergeFindingsAfterReplace", () => {
  it("replaces the same run+document instead of appending duplicates", () => {
    const existing = [
      { documentId: "d1", runId: "r1", title: "first" },
      { documentId: "d2", runId: "r1", title: "other" },
    ];
    const merged = mergeFindingsAfterReplace(existing, {
      documentId: "d1",
      runId: "r1",
      title: "retry",
    });
    assert.equal(merged.length, 2);
    assert.equal(merged.find((r) => r.documentId === "d1")?.title, "retry");
  });

  it("keeps findings from a previous run when a new run is saved", () => {
    const existing = [{ documentId: "d1", runId: "r1", title: "old" }];
    const merged = mergeFindingsAfterReplace(existing, {
      documentId: "d1",
      runId: "r2",
      title: "new",
    });
    assert.equal(merged.length, 2);
  });
});
