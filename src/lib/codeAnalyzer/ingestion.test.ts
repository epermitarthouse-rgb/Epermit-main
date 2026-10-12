import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTerminalIngestionStatus, shouldPollIngestionState } from "./ingestion.ts";

describe("shouldPollIngestionState", () => {
  it("polls while any ingestion job is non-terminal", () => {
    assert.equal(
      shouldPollIngestionState([{ status: "processing" }], [{ analyzer_processing_status: "completed" }]),
      true,
    );
    assert.equal(
      shouldPollIngestionState([{ status: "pending" }], [{ analyzer_processing_status: "completed" }]),
      true,
    );
  });

  it("polls while document analyzer_processing_status is queued or processing", () => {
    assert.equal(
      shouldPollIngestionState([], [{ analyzer_processing_status: "queued" }]),
      true,
    );
    assert.equal(
      shouldPollIngestionState([], [{ analyzer_processing_status: "processing" }]),
      true,
    );
  });

  it("stops polling when jobs and documents are idle", () => {
    assert.equal(
      shouldPollIngestionState(
        [{ status: "completed" }, { status: "failed" }],
        [{ analyzer_processing_status: "completed" }, { analyzer_processing_status: "not_started" }],
      ),
      false,
    );
  });
});

describe("isTerminalIngestionStatus", () => {
  it("treats completed and failed as terminal", () => {
    assert.equal(isTerminalIngestionStatus("completed"), true);
    assert.equal(isTerminalIngestionStatus("processing"), false);
  });
});
