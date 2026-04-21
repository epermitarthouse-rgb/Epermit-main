"use strict";

/**
 * Documentation-only retention / ignore policy for runtime clutter.
 * Align with repo root .gitignore `scraper-service/*` patterns.
 * Disk PNG screenshots from Playwright are off by default; set SCRAPER_DEBUG_ARTIFACTS=1
 * to enable (see artifacts/debug-artifacts.js).
 */

const GITIGNORED_SCRAPER_ARTIFACT_PATTERNS = [
  "scraper-service/debug/",
  "scraper-service/PROBE_*.png",
  "scraper-service/grid_not_found.png",
  "scraper-service/debug_dashboard.png",
  "scraper-service/pgc-login-failed.png",
  "scraper-service/pgc-project-detail-failed-*.png",
  "scraper-service/pgc-workflow-failed-*.png",
  "scraper-service/pgc-files-failed-*.png",
  "scraper-service/pgc-downloads/",
  "scraper-service/pgc-markups/",
  "scraper-service/pgc-reviews-failed-*.png",
  "scraper-service/pgc-reports/",
  "scraper-service/pgc-reports-failed-*.png",
  "scraper-service/pgc-progress-events.jsonl",
  "scraper-service/pgc-run-summary.json",
  "scraper-service/pgc-debug-detail.log",
  // Montgomery local report exports (see scrapers/montgomery/projectdox-scraper.js — not always in root .gitignore)
  "scraper-service/mdc-reports/",
  "scraper-service/downloads/",
  "scraper-service/debug_report_popup.png",
  "scraper-service/pgc-login-initial-*.png",
  "scraper-service/pgc-post-login-*.png",
  "scraper-service/pgc-brava-publish-menu-failed-*.png",
  "scraper-service/login_failed.png",
  "scraper-service/record_not_loaded.png",
];

function getIgnoredArtifactPatterns() {
  return [...GITIGNORED_SCRAPER_ARTIFACT_PATTERNS];
}

module.exports = {
  getIgnoredArtifactPatterns,
};
