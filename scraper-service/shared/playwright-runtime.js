"use strict";

const fs = require("fs");
const { chromium } = require("playwright");
const { scraperRunsHeadless } = require("./browser.js");

/**
 * Whether headed Chromium can run in the current host environment.
 * Railway and other headless-only containers should stay headless even when
 * callers request headed mode for local debugging.
 * @returns {boolean}
 */
function canLaunchHeadedBrowser() {
  const forceHeaded = (process.env.SCRAPER_FORCE_HEADED || "").trim().toLowerCase();
  if (forceHeaded === "true" || forceHeaded === "1") return true;

  const forceHeadless = (process.env.SCRAPER_FORCE_HEADLESS || "").trim().toLowerCase();
  if (forceHeadless === "true" || forceHeadless === "1") return false;

  if (process.env.RAILWAY_ENVIRONMENT) return false;
  if (process.env.NODE_ENV === "production") {
    return Boolean((process.env.DISPLAY || "").trim());
  }
  return true;
}

/**
 * Resolve effective headless mode for a scraper launch request.
 * @param {{ headed?: boolean }} [callerInfo]
 * @returns {{ headless: boolean, headedRequested: boolean, headedHonored: boolean }}
 */
function resolveScraperHeadlessMode(callerInfo = {}) {
  const headedRequested = callerInfo.headed === true;
  const headedHonored = headedRequested && canLaunchHeadedBrowser();
  const headless = headedHonored ? false : scraperRunsHeadless();
  return { headless, headedRequested, headedHonored };
}

/**
 * @returns {string}
 */
function getPlaywrightPackageVersion() {
  try {
    const pkg = require("playwright/package.json");
    return String(pkg.version || "unknown");
  } catch (_) {
    return "unknown";
  }
}

/**
 * @returns {{ executablePath: string | null, executableExists: boolean }}
 */
function resolveChromiumExecutableInfo() {
  try {
    const executablePath = chromium.executablePath();
    return {
      executablePath,
      executableExists: Boolean(executablePath && fs.existsSync(executablePath)),
    };
  } catch (_) {
    return { executablePath: null, executableExists: false };
  }
}

/**
 * @returns {Record<string, unknown>}
 */
function getPlaywrightRuntimeDiagnostics() {
  const { executablePath, executableExists } = resolveChromiumExecutableInfo();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    playwrightVersion: getPlaywrightPackageVersion(),
    chromiumExecutablePath: executablePath,
    chromiumExecutableExists: executableExists,
    playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
    nodeEnv: process.env.NODE_ENV || null,
    railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || null,
    display: process.env.DISPLAY || null,
    headlessPolicy: scraperRunsHeadless(),
    headedLaunchSupported: canLaunchHeadedBrowser(),
  };
}

/**
 * Log sanitized Playwright runtime diagnostics at startup.
 */
function logPlaywrightRuntimeDiagnostics() {
  const diagnostics = getPlaywrightRuntimeDiagnostics();
  console.log(`  process.platform: ${diagnostics.platform}`);
  console.log(`  process.arch: ${diagnostics.arch}`);
  console.log(`  Node version: ${diagnostics.nodeVersion}`);
  console.log(`  Playwright version: ${diagnostics.playwrightVersion}`);
  console.log(`  NODE_ENV: ${diagnostics.nodeEnv || "(unset)"}`);
  console.log(
    `  Railway environment: ${diagnostics.railwayEnvironment || "(unset)"}`,
  );
  console.log(
    `  PLAYWRIGHT_BROWSERS_PATH: ${diagnostics.playwrightBrowsersPath || "(unset)"}`,
  );
  console.log(`  DISPLAY: ${diagnostics.display || "(unset)"}`);
  console.log(`  Headless policy: ${diagnostics.headlessPolicy}`);
  console.log(`  Headed launch supported: ${diagnostics.headedLaunchSupported}`);
  console.log(`  Chromium executable: ${diagnostics.chromiumExecutablePath || "(unresolved)"}`);
  console.log(`  Chromium executable exists: ${diagnostics.chromiumExecutableExists}`);
}

/**
 * @param {string} message
 * @returns {string}
 */
function sanitizePlaywrightErrorMessage(message) {
  return String(message || "unknown_error")
    .replace(/\/Users\/[^\s]+/g, "[path]")
    .replace(/\/home\/[^\s]+/g, "[path]")
    .slice(0, 500);
}

/**
 * Launch Chromium headless, open about:blank, and close cleanly.
 * @returns {Promise<{ ok: boolean, launchable: boolean, browser: "chromium", diagnostics: Record<string, unknown>, error?: { name: string, message: string } }>}
 */
async function probePlaywrightChromiumLaunch() {
  const diagnostics = getPlaywrightRuntimeDiagnostics();
  const { launchChromiumForScraper } = require("./playwright-launch-for-scraper.js");

  let browser;
  try {
    browser = await launchChromiumForScraper({
      label: "health-playwright",
      route: "GET /api/health/playwright",
      file: "playwright-runtime.js",
    });
    const page = await browser.newPage();
    await page.goto("about:blank", { waitUntil: "commit", timeout: 15000 });
    await page.close();
    await browser.close();
    return {
      ok: true,
      launchable: true,
      browser: "chromium",
      diagnostics,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const error = /** @type {Error} */ (err);
    return {
      ok: false,
      launchable: false,
      browser: "chromium",
      diagnostics,
      error: {
        name: error.name || "Error",
        message: sanitizePlaywrightErrorMessage(error.message),
      },
    };
  }
}

module.exports = {
  canLaunchHeadedBrowser,
  resolveScraperHeadlessMode,
  getPlaywrightPackageVersion,
  resolveChromiumExecutableInfo,
  getPlaywrightRuntimeDiagnostics,
  logPlaywrightRuntimeDiagnostics,
  sanitizePlaywrightErrorMessage,
  probePlaywrightChromiumLaunch,
};
