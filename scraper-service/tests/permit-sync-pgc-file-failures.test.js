"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fail = require("../permit-sync/deep/pgc-file-failures");

test("a county viewer error is a portal render failure, and a blank viewer is not assumed blank", () => {
  assert.equal(fail.classifySurface({ text: "Unable to load the document", canvas: 0, publish: false }), fail.PORTAL_RENDER);
  assert.equal(fail.classifySurface({ text: "ProjectDox ActiveX Viewer", canvas: 0, publish: false }), null);
  assert.equal(fail.classifySurface({ text: "", canvas: 0, publish: false }), null);
});

test("publish stages are renamed only when the viewer shows a document", () => {
  const drawn = { text: "Page 1 of 4", canvas: 1, publish: true };
  const drawnNoMenu = { text: "Page 1 of 4", canvas: 1, publish: false };
  const blank = { text: "Viewer", canvas: 0, publish: false };
  assert.equal(fail.classifyStage("publishtoformat_pdf_not_seen", drawn), fail.PDF_RETRIEVAL);
  assert.equal(fail.classifyStage("pdf_publish_button_not_clicked", drawn), fail.PORTAL_PUBLISH);
  assert.equal(fail.classifyStage("publish_menu_not_opened", drawnNoMenu), fail.MENU_UNAVAILABLE);
  assert.equal(fail.classifyStage("publish_menu_not_opened", drawn), fail.PORTAL_PUBLISH);
  assert.equal(fail.classifyStage("publish_menu_not_opened", blank), "publish_menu_not_opened");
  assert.equal(fail.classifyStage("publishtoformat_pdf_not_seen", blank), "publishtoformat_pdf_not_seen");
  assert.equal(
    fail.classifyStage("publish_menu_not_opened", { text: "The document could not be loaded", canvas: 0, publish: false }),
    fail.PORTAL_RENDER,
  );
});

test("a file failure does not skip the files after it", () => {
  const breaker = fail.createStreakBreaker(5);
  for (let i = 0; i < 8; i += 1) assert.equal(breaker.note("publish_menu_not_opened"), false);
  assert.equal(breaker.note("portal_document_not_rendered"), false);
  assert.equal(fail.fileFailureSkipsRemainder(), false);
  assert.equal(fail.unattemptedDisposition(), "leave_queued");
});

test("a rendered page is published, and a viewer that stays blank is a portal failure", () => {
  assert.equal(fail.viewerDecision({ text: "Unable to load the document", canvas: 0 }), "portal_error");
  assert.equal(fail.viewerDecision({ text: "Page 1 of 3", canvas: 1, publish: true }), "publish");
  assert.equal(fail.viewerDecision({ text: "Viewer", canvas: 0, publish: true }), "waiting");
  assert.equal(fail.outcomeAfterReadyWait({ text: "Viewer", canvas: 0, publish: true }), fail.PORTAL_RENDER);
  assert.equal(fail.outcomeAfterReadyWait({ text: "Page 1 of 3", canvas: 1 }), "publish");
  assert.equal(fail.VIEWER_READY_MS, 12000);
  assert.equal(fail.codeOf("portal_changed: publish_menu_not_opened blocked POST"), "publish_menu_not_opened");
  assert.equal(fail.permitFileBudgetMs({ PERMIT_SYNC_PGC_PERMIT_FILE_BUDGET_MS: "0" }), 0);
});
