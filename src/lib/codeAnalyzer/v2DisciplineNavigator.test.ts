import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISCIPLINE_LABELS } from "../../types/document.ts";
import { buildV2DisciplineNavigator, resolveV2DisciplineLabel } from "./v2DisciplineNavigator.ts";

describe("V2 discipline navigator", () => {
  it("uses stored sheet discipline instead of conflicting classification evidence", () => {
    assert.equal(
      resolveV2DisciplineLabel({
        storedDiscipline: "demolition",
        classificationDisciplines: ["architectural"],
      }),
      DISCIPLINE_LABELS.demolition,
    );
  });

  it("uses a single classification label when the stored discipline is general", () => {
    assert.equal(
      resolveV2DisciplineLabel({
        storedDiscipline: "general",
        classificationDisciplines: ["architecture"],
      }),
      DISCIPLINE_LABELS.architectural,
    );
  });

  it("does not choose Architectural when demolition and architectural evidence conflict", () => {
    assert.equal(
      resolveV2DisciplineLabel({
        storedDiscipline: null,
        classificationDisciplines: ["architectural", "demolition"],
      }),
      DISCIPLINE_LABELS.demolition,
    );
  });

  it("filters sheets and counts disciplines without dropping the full set", () => {
    const navigator = buildV2DisciplineNavigator({
      selectedKey: "all",
      sheets: [
        { id: "sheet-1", fileName: "A-101.pdf", imageDocumentId: "doc-1", discipline: "architectural" },
        { id: "sheet-2", fileName: "D-101.pdf", imageDocumentId: "doc-2", discipline: "demolition" },
      ],
      groups: [
        { id: "doc-1", fileName: "A-101.pdf", classificationDisciplines: ["structural"] },
        { id: "doc-2", fileName: "D-101.pdf", classificationDisciplines: ["architectural"] },
      ],
    });
    assert.equal(navigator.choices.find((choice) => choice.key === "all")?.count, 2);
    assert.equal(navigator.choices.find((choice) => choice.label === "Architectural")?.count, 1);
    assert.equal(navigator.choices.find((choice) => choice.label === "Demolition")?.count, 1);
    assert.deepEqual(navigator.visibleIds, ["doc-1", "doc-2"]);

    const filtered = buildV2DisciplineNavigator({
      selectedKey: "Demolition",
      sheets: [
        { id: "sheet-1", imageDocumentId: "doc-1", discipline: "architectural" },
        { id: "sheet-2", imageDocumentId: "doc-2", discipline: "demolition" },
      ],
      groups: [
        { id: "doc-1", fileName: "A-101.pdf" },
        { id: "doc-2", fileName: "D-101.pdf" },
      ],
    });
    assert.deepEqual(filtered.visibleIds, ["doc-2"]);
    assert.equal(filtered.selectedKey, "Demolition");
  });
});
