import assert from "node:assert/strict";
import {
  effectiveResponseStatus,
  exportResponseApprovalLabel,
  formatResponseForExport,
  nextStatusAfterDraftSave,
} from "./responseApproval.ts";

assert.equal(
  effectiveResponseStatus({ response_text: "Hello", response_status: null, grounded_generated_at: "2026-01-01" }),
  "AI Generated",
);

assert.equal(
  effectiveResponseStatus({ response_text: "Hello", response_status: "Approved" }),
  "Approved",
);

assert.equal(
  nextStatusAfterDraftSave(
    { response_text: "x", response_status: null, change_request_note: "Fix sheet ref" },
    "Edited text",
  ),
  "Awaiting Approval",
);

assert.equal(
  nextStatusAfterDraftSave(
    {
      response_text: "AI text",
      response_status: null,
      ai_generated_response_text: "AI text",
    },
    "AI text",
  ),
  "AI Generated",
);

assert.equal(
  exportResponseApprovalLabel({ response_text: "x", response_status: "Draft" }),
  "Draft (not approved for submission)",
);

assert.match(
  formatResponseForExport({ response_text: "Reply", response_status: "AI Generated" }),
  /\[Response approval: AI Generated\]/,
);

assert.equal(
  formatResponseForExport({ response_text: "Reply", response_status: "Approved" }),
  "Reply",
);

console.log("responseApproval.selftest: ok");
