import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("CodeAnalyzerDocumentWorkflow hooks order", () => {
  it("declares analysisSettled before the document-card memo that reads it", () => {
    const source = readFileSync(
      new URL("./CodeAnalyzerDocumentWorkflow.tsx", import.meta.url),
      "utf8",
    );
    const declaration = source.indexOf("const analysisSettled =");
    const cardMemo = source.indexOf("const cards = useMemo(");
    assert.ok(declaration >= 0);
    assert.ok(cardMemo >= 0);
    assert.ok(
      declaration < cardMemo,
      "analysisSettled must be declared before the card memo or the analyzer white-screens",
    );
  });
});
