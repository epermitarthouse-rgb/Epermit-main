import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyResponseLifecycle,
  countLifecycleMetrics,
  parseResponseMatrixMetric,
} from "./responseMatrixMetrics.ts";

describe("classifyResponseLifecycle", () => {
  it("Needs Response when response_text is empty", () => {
    assert.equal(
      classifyResponseLifecycle({ response_text: null, response_status: null }),
      "needs-response",
    );
    assert.equal(
      classifyResponseLifecycle({
        response_text: "   ",
        response_status: "Draft",
      }),
      "needs-response",
    );
  });

  it("In Draft for AI Generated, Draft, Awaiting Approval, Changes Requested", () => {
    for (const response_status of [
      "AI Generated",
      "Draft",
      "Awaiting Approval",
      "Changes Requested",
    ] as const) {
      assert.equal(
        classifyResponseLifecycle({
          response_text: "Draft reply",
          response_status,
        }),
        "in-draft",
        response_status,
      );
    }
  });

  it("Accepted only when effectiveResponseStatus is Approved", () => {
    assert.equal(
      classifyResponseLifecycle({
        response_text: "Final reply",
        response_status: "Approved",
      }),
      "accepted",
    );
  });

  it("does not treat comment workflow status as Accepted", () => {
    // Legacy row with text but no response_status → Draft via effectiveResponseStatus
    assert.equal(
      classifyResponseLifecycle({
        response_text: "Some reply",
        response_status: null,
      }),
      "in-draft",
    );
  });

  it("partition sums to comment count", () => {
    const rows = [
      { response_text: "", response_status: null },
      { response_text: "a", response_status: "Draft" as const },
      { response_text: "b", response_status: "AI Generated" as const },
      { response_text: "c", response_status: "Awaiting Approval" as const },
      { response_text: "d", response_status: "Changes Requested" as const },
      { response_text: "e", response_status: "Approved" as const },
    ];
    const counts = countLifecycleMetrics(rows);
    assert.equal(
      counts.needsResponse + counts.inDraft + counts.accepted + counts.other,
      rows.length,
    );
    assert.equal(counts.needsResponse, 1);
    assert.equal(counts.inDraft, 4);
    assert.equal(counts.accepted, 1);
    assert.equal(counts.other, 0);
  });
});

describe("parseResponseMatrixMetric", () => {
  it("accepts known metric keys and rejects others", () => {
    assert.equal(parseResponseMatrixMetric("needs-response"), "needs-response");
    assert.equal(parseResponseMatrixMetric("in-draft"), "in-draft");
    assert.equal(parseResponseMatrixMetric("accepted"), "accepted");
    assert.equal(parseResponseMatrixMetric("cross-service"), null);
    assert.equal(parseResponseMatrixMetric(null), null);
  });
});
