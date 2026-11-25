"use strict";

/**
 * Prince George's file-viewer outcomes. A county error phrase is recognized immediately.
 * A viewer that still has no page and no canvas after the ready wait is a portal render
 * failure. A page or a canvas keeps the existing Publish-to-PDF path.
 */

const PORTAL_RENDER = "portal_document_not_rendered";
const PORTAL_PUBLISH = "portal_publish_failed";
const MENU_UNAVAILABLE = "publish_menu_unavailable";
const PDF_RETRIEVAL = "pdf_retrieval_failed";
const DEFERRED_STREAK = "deferred_after_repeated_portal_render";
const DEFERRED_BUDGET = "deferred_permit_file_budget";

const PORTAL_RENDER_MESSAGE = "Document could not be rendered by the Prince George's County portal. No downloadable content was available.";
const DEFERRED_STREAK_MESSAGE = "This file was not opened. Earlier files failed in the county viewer, and this one stays queued.";
const DEFERRED_BUDGET_MESSAGE = "This file was not opened because the permit's file pass reached its time limit. It stays queued.";

const RENDER_ERROR = /unable to (load|display|open)|failed to load|cannot display|could not be (loaded|opened|rendered)|no document to display|document (is )?not available/i;
const PAGE_LABEL = /\bpage\s+\d+\s+of\s+\d+/i;
/** How long to wait for a canvas, a page label, or a county error before the file is given up. */
const VIEWER_READY_MS = 12000;

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function renderStreakLimit(env = process.env) {
  return Math.floor(numberOr(env.PERMIT_SYNC_PGC_RENDER_FAILURE_LIMIT, 5));
}

function permitFileBudgetMs(env = process.env) {
  return Math.floor(numberOr(env.PERMIT_SYNC_PGC_PERMIT_FILE_BUDGET_MS, 45 * 60 * 1000));
}

function surfaceHasDocument(surface) {
  if (!surface) return false;
  if (Number(surface.canvas) > 0) return true;
  return PAGE_LABEL.test(String(surface.text || ""));
}

/** portal_document_not_rendered when the viewer text says the county could not display the file. */
function classifySurface(surface) {
  if (surface && RENDER_ERROR.test(String(surface.text || ""))) return PORTAL_RENDER;
  return null;
}

/**
 * What the open viewer is showing.
 * portal_error: the county says this file cannot be displayed.
 * publish: a page, a canvas, or a Publish control is present, so the PDF path still runs.
 * waiting: nothing has appeared yet.
 * @param {{ text?: string, canvas?: number, publish?: boolean }} surface
 * @returns {"portal_error"|"publish"|"waiting"}
 */
function viewerDecision(surface) {
  if (classifySurface(surface) === PORTAL_RENDER) return "portal_error";
  if (surfaceHasDocument(surface)) return "publish";
  return "waiting";
}

/**
 * After the ready wait, a viewer with no page and no canvas did not render.
 * A page or a canvas still goes through Publish to PDF.
 * @param {{ text?: string, canvas?: number, publish?: boolean }} surface
 * @returns {string}
 */
function outcomeAfterReadyWait(surface) {
  return viewerDecision(surface) === "publish" ? "publish" : PORTAL_RENDER;
}

/**
 * A file that fails does not skip the files after it. Successful and failed
 * documents are mixed in the same permit, so every later file is still opened.
 * @returns {false}
 */
function fileFailureSkipsRemainder() {
  return false;
}

/**
 * A file the time limit prevented us from opening is left queued.
 * It is not recorded as failed, empty, or captured.
 * @returns {"leave_queued"}
 */
function unattemptedDisposition() {
  return "leave_queued";
}

/**
 * Replace a publish stage only when the viewer surface supports the new code.
 * Otherwise the original stage is kept.
 */
function classifyStage(stage, surface) {
  const original = String(stage || "");
  if (classifySurface(surface) === PORTAL_RENDER) return PORTAL_RENDER;
  const doc = surfaceHasDocument(surface);
  if (!doc) return original;
  if (original === "publishtoformat_pdf_not_seen") return PDF_RETRIEVAL;
  if (original === "pdf_publish_button_not_clicked") return PORTAL_PUBLISH;
  if (original === "publish_menu_not_opened" && surface && !surface.publish) return MENU_UNAVAILABLE;
  if (original === "publish_menu_not_opened" && surface && surface.publish) return PORTAL_PUBLISH;
  return original;
}

function codeOf(error) {
  const text = String(error || "");
  const codes = [PORTAL_RENDER, PORTAL_PUBLISH, MENU_UNAVAILABLE, PDF_RETRIEVAL, "publish_menu_not_opened", DEFERRED_STREAK, DEFERRED_BUDGET];
  return codes.find((code) => text.includes(code)) || "";
}

function createStreakBreaker() {
  return {
    note() {
      return fileFailureSkipsRemainder();
    },
    success() {},
  };
}

module.exports = {
  PORTAL_RENDER,
  PORTAL_PUBLISH,
  MENU_UNAVAILABLE,
  PDF_RETRIEVAL,
  DEFERRED_STREAK,
  DEFERRED_BUDGET,
  VIEWER_READY_MS,
  PORTAL_RENDER_MESSAGE,
  DEFERRED_STREAK_MESSAGE,
  DEFERRED_BUDGET_MESSAGE,
  renderStreakLimit,
  permitFileBudgetMs,
  surfaceHasDocument,
  classifySurface,
  viewerDecision,
  outcomeAfterReadyWait,
  fileFailureSkipsRemainder,
  unattemptedDisposition,
  classifyStage,
  codeOf,
  createStreakBreaker,
};
