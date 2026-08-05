import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSubmitPgcRetryStart,
  createPgcRetryStartUiState,
  reducePgcRetryStartUi,
} from "./pgcRetryFailedStartUx.ts";

describe("pgcRetryFailedStartUx", () => {
  it("successful retry start closes modal and clears selection", () => {
    let state = createPgcRetryStartUiState({
      open: true,
      selectedIds: ["file:p:1", "file:p:2"],
    });
    state = reducePgcRetryStartUi(state, { type: "submit" });
    assert.equal(state.starting, true);
    assert.equal(state.open, true);

    state = reducePgcRetryStartUi(state, {
      type: "start_succeeded",
      jobId: "job-123",
    });
    assert.equal(state.open, false);
    assert.deepEqual(state.selectedIds, []);
    assert.equal(state.starting, false);
    assert.equal(state.startError, null);
  });

  it("failed retry start keeps modal open and surfaces error", () => {
    let state = createPgcRetryStartUiState({
      open: true,
      selectedIds: ["file:p:1"],
    });
    state = reducePgcRetryStartUi(state, { type: "submit" });
    state = reducePgcRetryStartUi(state, {
      type: "start_failed",
      error: "SCRAPER_OFFLINE",
    });
    assert.equal(state.open, true);
    assert.deepEqual(state.selectedIds, ["file:p:1"]);
    assert.equal(state.starting, false);
    assert.equal(state.startError, "SCRAPER_OFFLINE");
  });

  it("double submit is prevented while start is pending", () => {
    let state = createPgcRetryStartUiState({
      open: true,
      selectedIds: ["file:p:1"],
    });
    assert.equal(canSubmitPgcRetryStart(state), true);

    state = reducePgcRetryStartUi(state, { type: "submit" });
    assert.equal(state.starting, true);
    assert.equal(canSubmitPgcRetryStart(state), false);

    const again = reducePgcRetryStartUi(state, { type: "submit" });
    assert.equal(again.starting, true);
    assert.deepEqual(again.selectedIds, state.selectedIds);
    assert.equal(again.open, true);
  });

  it("cannot submit when closed or with empty selection", () => {
    assert.equal(
      canSubmitPgcRetryStart(
        createPgcRetryStartUiState({ open: false, selectedIds: ["a"] }),
      ),
      false,
    );
    assert.equal(
      canSubmitPgcRetryStart(
        createPgcRetryStartUiState({ open: true, selectedIds: [] }),
      ),
      false,
    );
  });
});
