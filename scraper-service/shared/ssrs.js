"use strict";

/**
 * Proven SSRS / report viewer helpers from pgc-eplan-scraper.js (re-export only).
 */

const pgc = require("../pgc-eplan-scraper.js");

module.exports = {
  extractWFlowInstanceIdFromViewerUrl: pgc.extractWFlowInstanceIdFromViewerUrl,
  waitForPgcReportViewerHandle: pgc.waitForPgcReportViewerHandle,
  exportReportFormat: pgc.exportReportFormat,
  capturePgcReportScreenshotBase64: pgc.capturePgcReportScreenshotBase64,
  tryPgcReportExportViaHttp: pgc.tryPgcReportExportViaHttp,
  normalizeReportName: pgc.normalizeReportName,
  pgcReportViewerUrlWithFormat: pgc.pgcReportViewerUrlWithFormat,
  waitForPgcReportsGridReady: pgc.waitForPgcReportsGridReady,
  pgcReportRowMatchesAnyTarget: pgc.pgcReportRowMatchesAnyTarget,
  pgcReportNamesLooselyMatch: pgc.pgcReportNamesLooselyMatch,
};
