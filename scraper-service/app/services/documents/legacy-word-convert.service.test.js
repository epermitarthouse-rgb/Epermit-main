"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isLegacyDocFileName,
  isManualCommentLetterDocument,
} = require("./legacy-word-convert.service.js");

test("isLegacyDocFileName accepts .doc and rejects .docx", () => {
  assert.equal(isLegacyDocFileName("comments.doc"), true);
  assert.equal(isLegacyDocFileName("comments.docx"), false);
  assert.equal(isLegacyDocFileName("comments.pdf"), false);
});

test("isManualCommentLetterDocument requires correspondence manual upload description", () => {
  assert.equal(
    isManualCommentLetterDocument({
      document_type: "correspondence",
      description: "Manual comment letter upload (Comment Review)",
    }),
    true,
  );
  assert.equal(
    isManualCommentLetterDocument({
      document_type: "correspondence",
      description: "Other upload",
    }),
    false,
  );
  assert.equal(
    isManualCommentLetterDocument({
      document_type: "permit_drawing",
      description: "Manual comment letter upload (Comment Review)",
    }),
    false,
  );
});
