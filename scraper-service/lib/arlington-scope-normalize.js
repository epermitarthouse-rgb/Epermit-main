"use strict";

const DEFAULT_TABS = ["info", "attachments", "plan_review"];

/**
 * Normalize Arlington permit numbers for durable job identity.
 * @param {string|null|undefined} permitNumber
 */
function normalizeArlingtonPermitNumber(permitNumber) {
  return `${permitNumber || ""}`.trim().toUpperCase();
}

/**
 * Canonical requested_scope for persistence and identity matching.
 * @param {object|null|undefined} raw
 */
function normalizeArlingtonRequestedScope(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const tabSet = new Set(
    (Array.isArray(input.tabs) ? input.tabs : DEFAULT_TABS)
      .map((t) => String(t).trim())
      .filter(Boolean),
  );
  const tabs = [...tabSet].sort();
  const planReviewScope = input.planReviewScope
    ? String(input.planReviewScope).trim()
    : "all";
  const autoContinueAttachments = input.autoContinueAttachments !== false;
  const autoContinueDownloads = input.autoContinueDownloads !== false;
  const downloadDocuments = input.downloadDocuments !== false;
  return {
    tabs: tabs.length > 0 ? tabs : [...DEFAULT_TABS].sort(),
    planReviewScope,
    autoContinueAttachments,
    autoContinueDownloads,
    downloadDocuments,
  };
}

/**
 * Deterministic scope identity key (order-independent).
 * @param {object|null|undefined} scope
 */
function buildArlingtonScopeKey(scope) {
  const norm = normalizeArlingtonRequestedScope(scope);
  const parts = [
    `tabs=${norm.tabs.join(",")}`,
    `pr=${norm.planReviewScope}`,
    `att=${norm.autoContinueAttachments ? 1 : 0}`,
    `dl=${norm.autoContinueDownloads ? 1 : 0}`,
    `docs=${norm.downloadDocuments ? 1 : 0}`,
  ];
  return parts.join("|");
}

module.exports = {
  DEFAULT_TABS,
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
  buildArlingtonScopeKey,
};
