"use strict";

/**
 * Accela Citizen Access tenant profiles — URL/discovery constants only.
 * Runtime behavior stays in accela-scraper.js; consume via resolveAccelaTenantProfile(portalUrl).
 */

/** @typedef {typeof ArlingtonAccelaProfile} AccelaTenantProfile */

const ArlingtonAccelaProfile = {
  key: "arlington_county_va",
  agencyCode: "ARLINGTONCO",
  baseUrl: "https://aca-prod.accela.com/ARLINGTONCO",
  loginPath: "/ARLINGTONCO/Account/Login.aspx",
  dashboardPath: "/ARLINGTONCO/Dashboard.aspx",
  myRecordsPath:
    "/ARLINGTONCO/Cap/MyRecordsCap.aspx?TabName=Home&TabList=Home",
  /** Sample grid ids used for diagnostics only; searches use table[id*="gdvPermitList"]. */
  recordListTableIdPrefixes: [
    "ctl00_PlaceHolderMain_CapList2_gdvPermitList",
    "ctl00_PlaceHolderMain_CapList4_gdvPermitList",
  ],
  recordInfoLabels: ["Record Info", "Record Details", "Record Detail"],
  usesAttachmentIframe: true,
  attachmentIframeSelector:
    "#ctl00_PlaceHolderMain_attachmentEdit_iframeAttachmentList",
  attachmentGridId: "attachmentList_gdvAttachmentList",
  /** Payments tab / extraction disabled for Arlington portal UX scope. */
  payments: {
    enabled: false,
  },
  planReview: {
    enabled: true,
    /** ERMS scrape + portal UI are limited to Plan Set Documents until scope expands. */
    scopePlanSetDocumentsOnly: true,
    /** Max wall time inside extractPlanReviewArlington (Plan Set + secondary tabs). */
    extractBudgetMs: 240000,
    /**
     * When true, Playwright clicks per-row download controls in the Plan Review iframe,
     * validates non-HTML bytes, uploads to Supabase (same path as Accela attachments).
     */
    downloadFromIntegratedIframe: true,
    /**
     * Stage 2: after Plan Set, also scrape+download Review Results, Approved, Project Info —
     * each tab is clicked and only the visible panel is scanned (no global table scrape).
     */
    planReviewIncludeSecondaryTabs: true,
    /** Wall clock budget per Stage-2 tab (click + extract + downloads); tab errors do not abort others. */
    perTabExtractBudgetMs: 45000,
    /** Record Info Attachments stay on the Attachments tab; never map into Plan Review. */
    mapDocumentsFromAttachments: false,
    topTabLabels: ["Plan Review"],
    expectedTabs: ["Plans & Documents"],
    /** Keys on portal_data.tabs.planReview.tabs (camelCase). */
    expectedTabKeys: {
      "Plans & Documents": "plansAndDocuments",
      "Review Results & Mark-ups": "reviewResultsAndMarkups",
      "Approved Documents": "approvedDocuments",
      "Project Information": "projectInformation",
    },
    allowUnusedMessage: true,
    unusedMessageIncludes: "this record does not use plan review",
  },
};

/**
 * @param {string | null | undefined} portalUrl — session.dashboardUrl / portal base
 * @returns {AccelaTenantProfile | null}
 */
function resolveAccelaTenantProfile(portalUrl) {
  if (!portalUrl || typeof portalUrl !== "string") return null;
  const u = portalUrl.toUpperCase();
  if (u.includes("ARLINGTONCO")) {
    return ArlingtonAccelaProfile;
  }
  return null;
}

module.exports = {
  ArlingtonAccelaProfile,
  resolveAccelaTenantProfile,
};
