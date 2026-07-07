"use strict";

const { chromium } = require("playwright");
const {
  resolveScraperHeadlessMode,
  resolveChromiumExecutableInfo,
  sanitizePlaywrightErrorMessage,
} = require("./playwright-runtime.js");

/**
 * Browser install / launch failures (used by routes and UCI discovery).
 * @param {unknown} err
 * @returns {boolean}
 */
function isBrowserLaunchError(err) {
  if (!err || !err.message) return false;
  const msg = err.message;
  return (
    /Executable doesn't exist/i.test(msg) ||
    /browserType\.launch/i.test(msg) ||
    /Playwright doesn't support/i.test(msg)
  );
}

/**
 * Single Chromium launch path for scraper-service (aligned with legacy register-execution-routes).
 * @param {{ label?: string, route?: string, file?: string, headed?: boolean }} callerInfo
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchChromiumForScraper(callerInfo = {}) {
  const label = callerInfo.label || "scraper";
  const route = callerInfo.route || "";
  const file = callerInfo.file || "server.js";

  const { headless, headedRequested, headedHonored } = resolveScraperHeadlessMode(callerInfo);
  const { executablePath, executableExists } = resolveChromiumExecutableInfo();

  const launchOptions = {
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  };

  const isQuickScrape = label === "quick-scrape";
  const shouldLogLaunch =
    isQuickScrape || label.startsWith("uci-pepco") || label === "health-playwright";

  if (shouldLogLaunch) {
    console.log(`[playwright] launch starting label=${label} headless=${headless}`);
    if (headedRequested && !headedHonored) {
      console.warn(
        `[playwright] headed=true requested for ${label} but host requires headless; continuing headless`,
      );
    }
    console.log(
      `[playwright] chromium executable exists=${executableExists} path=${executablePath || "(unresolved)"}`,
    );
    if (isQuickScrape) {
      console.log("[Quick Scrape] launch options:", JSON.stringify(launchOptions));
      console.log("[Quick Scrape] launching from:", file, route || "(login flow)");
    }
  }

  try {
    const browser = await chromium.launch(launchOptions);
    if (isQuickScrape) console.log("[Quick Scrape] browser launch success");
    return browser;
  } catch (err) {
    const message = sanitizePlaywrightErrorMessage(
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      `[playwright] launch failed label=${label} headless=${headless} executableExists=${executableExists} message=${message}`,
    );
    if (isQuickScrape) {
      console.error("[Quick Scrape] full error:", err);
    }
    throw err;
  }
}

module.exports = {
  launchChromiumForScraper,
  isBrowserLaunchError,
};
