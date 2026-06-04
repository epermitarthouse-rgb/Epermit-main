"use strict";

const { chromium } = require("playwright");
const { scraperRunsHeadless } = require("./browser.js");

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

  let headless = scraperRunsHeadless();
  if (callerInfo.headed === true) headless = false;

  const launchOptions = {
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  };

  const isQuickScrape = label === "quick-scrape";
  if (isQuickScrape) {
    console.log("[Quick Scrape] browser launch starting");
    console.log("[Quick Scrape] launch options:", JSON.stringify(launchOptions));
    console.log("[Quick Scrape] launching from:", file, route || "(login flow)");
  }

  try {
    const browser = await chromium.launch(launchOptions);
    if (isQuickScrape) console.log("[Quick Scrape] browser launch success");
    return browser;
  } catch (err) {
    if (isQuickScrape) {
      console.error("[Quick Scrape] browser launch failed:", err.message);
      console.error("[Quick Scrape] full error:", err);
    }
    throw err;
  }
}

module.exports = {
  launchChromiumForScraper,
  isBrowserLaunchError,
};
