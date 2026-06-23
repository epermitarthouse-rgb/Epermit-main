"use strict";

const assert = require("assert");
const {
  flattenAndDedupePgcWorkflowBuckets,
  mapPgcWorkflowBucketsToStructuredRows,
  applyPgcDomReviewCommentsBridge,
  dedupeKeyForPgcDomRow,
  isShowAllWorkflowBucket,
} = require("./pgcDomReviewStructuredRows.js");

const sampleRow = {
  correctionId: "991",
  refNumber: "1",
  cycle: "1",
  reviewer: "Jane Doe",
  correctionType: "Comment",
  fileName: "A-101.pdf",
  commentText: "Provide rated assembly detail.",
  status: "UnResolved",
  department: "Fire",
};

const showAllBucket = {
  workflowName: "Show All",
  rows: [sampleRow, { ...sampleRow, refNumber: "2", correctionId: "992" }],
};

const resolvedBucket = {
  workflowName: "Resolved",
  rows: [sampleRow],
};

assert(isShowAllWorkflowBucket(showAllBucket), "Show All bucket detected");
assert(
  flattenAndDedupePgcWorkflowBuckets([showAllBucket, resolvedBucket]).length === 2,
  "Show All preferred; status bucket duplicates excluded",
);

const structured = mapPgcWorkflowBucketsToStructuredRows([showAllBucket]);
assert.strictEqual(structured.length, 2);
assert.strictEqual(structured[0].ref, "1");
assert.strictEqual(structured[0].reviewed_by, "Jane Doe");
assert.strictEqual(structured[0].discussion, "Provide rated assembly detail.");
assert.strictEqual(structured[0].correctionId, "991");
assert.strictEqual(structured[0].department, "Fire");

const bridge = applyPgcDomReviewCommentsBridge([showAllBucket], []);
assert(bridge.applied, "bridge applied on empty reports");
assert.strictEqual(bridge.mappedCount, 2);
assert.strictEqual(bridge.reviewPdf.structuredRowsSource, "pgc-dom");
assert.strictEqual(bridge.reviewPdf.fileName, "Plan Review - Review Comments");

const excelPdf = {
  fileName: "Plan Review - Review Comments",
  structuredRows: [{ ref: "9", cycle: "1", reviewed_by: "X", type: "Comment", filename: "", discussion: "Excel", status: "Resolved" }],
  structuredRowsSource: "excel",
};
const noOverwrite = applyPgcDomReviewCommentsBridge([showAllBucket], [excelPdf]);
assert(!noOverwrite.applied, "does not overwrite Excel structuredRows");

assert(
  dedupeKeyForPgcDomRow(sampleRow).startsWith("cid:991"),
  "dedupe prefers correctionId",
);

console.log("pgcDomReviewStructuredRows.selftest.js: ok");
