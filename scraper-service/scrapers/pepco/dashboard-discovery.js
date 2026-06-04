/**
 * PEPCO SIUP — dashboard application cards only (Phase 4A/4B).
 * Does not scrape overview/status/documents pages, download files, or perform writes.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { isScraperDebugArtifactsEnabled } = require("../../artifacts/debug-artifacts");

const SCRAPER_SERVICE_ROOT = path.join(__dirname, "..", "..");

const JOB_ID_RE = /\bPEPCO-[A-Z]+-\d+\b/i;

/**
 * @param {(msg: string) => void} [logger]
 */
function dbgLog(logger, msg) {
  if (typeof logger === "function") logger(msg);
}

function safeDir() {
  const dir = path.join(SCRAPER_SERVICE_ROOT, "debug");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

async function maybePersistDashboardArtifacts(page, label, extractedPayload) {
  if (!isScraperDebugArtifactsEnabled()) return;

  try {
    const dir = safeDir();
    const ts = Date.now();
    const safe = String(label || "pepco-dashboard").replace(/[^a-zA-Z0-9_-]/g, "_");

    const pngPath = path.join(dir, `${safe}-${ts}.png`);
    await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});

    const htmlPath = path.join(dir, `${safe}-${ts}.html`);
    const html = await page.content().catch(() => "");
    if (html) await fs.promises.writeFile(htmlPath, html, "utf8");

    const jsonPath = path.join(dir, `${safe}-${ts}-cards.json`);
    await fs.promises.writeFile(jsonPath, JSON.stringify(extractedPayload ?? {}, null, 2), "utf8");

    console.log("[PEPCO][dashboard-discovery] Debug artifacts:", { pngPath, htmlPath, jsonPath });
  } catch (_) {}
}

/**
 * @param {string} currentUrlStr
 * @returns {string | null}
 */
function resolvePepcoDashboardUrl(currentUrlStr) {
  try {
    const urlObj = new URL(String(currentUrlStr || ""));
    const m = urlObj.pathname.match(/^(.*?\/service-installation-upgrades-portal)(\/.*)?$/i);
    if (!m || !m[1]) return null;
    urlObj.pathname = `${m[1].replace(/\/$/i, "")}/dashboard`;
    urlObj.search = "";
    urlObj.hash = "";
    return urlObj.toString();
  } catch {
    return null;
  }
}

/**
 * @param {import("playwright").Page} page
 * @param {number} timeoutMs
 */
async function waitForDashboardShell(page, log, timeoutMs = 55000) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const sel = [
    'app-dashboard-application',
    '.app-dashboard-application',
    ".applications",
    ".application-card",
  ].join(", ");

  try {
    await page.locator(sel).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    dbgLog(log, `[PEPCO dashboard] Dashboard shell selectors not visible within ${timeoutMs}ms`);
    await page.locator(sel).first().waitFor({ state: "attached", timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
  }

  await page.waitForTimeout(800);
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function extractLabeled(raw, labels) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const low = ln.toLowerCase();

    for (const lab of labels) {
      if (low === lab.toLowerCase() && lines[i + 1]) return lines[i + 1];
      /** @example "Status Draft" single line */
      const prefix = `${lab.toLowerCase()}`;
      if (low.startsWith(`${prefix}:`) || low.startsWith(`${prefix} `))
        return ln.slice(prefix.length).replace(/^[:]\s*/, "").trim() || null;

      /** @example "Status\nDraft" */
      if (low === prefix && lines[i + 1]) return lines[i + 1];
    }
  }
  return null;
}

function extractJobIdFromText(raw) {
  const m = String(raw || "").match(JOB_ID_RE);
  return m ? m[0] : null;
}

/**
 * Prefer metadata block first line title, remainder address heuristic.
 *
 * @param {string} rawFull
 */
function deriveTitleAddress(rawFull) {
  const blob = String(rawFull || "");
  const lines = blob.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: null, address: null };

  const title =
    lines.find((ln) => /^project\b/i.test(ln) && ln.length > 10) ||
    lines.find((ln) => !/^(address|status|job id)$/i.test(ln)) ||
    lines[0];

  const idxTitle = Math.max(lines.indexOf(title), 0);
  let address = extractLabeled(blob, ["Address", "Project Address"]);
  if (!address && lines[idxTitle + 1] && lines[idxTitle + 1] !== title)
    address = lines[idxTitle + 1];

  const cleanTitle = title && /^address$/i.test(String(title).trim()) ? null : title;

  return {
    title: cleanTitle ?? null,
    address: address || null,
  };
}

/**
 * Phase 4A — extract PEPCO dashboard cards (no clicks).
 *
 * @param {import("playwright").Page} page
 * @param {{ logger?: (m: string) => void }} [opts]
 */
async function extractPepcoDashboardCards(page, opts = {}) {
  const logger = opts && typeof opts.logger === "function" ? opts.logger : null;
  const currentUrl = page.url();

  /** URL or DOM heuristic */
  const onLikelyDashboard =
    /\/service-installation-upgrades-portal\/dashboard/i.test(currentUrl) ||
    (await page
      .evaluate(() => {
        const h = (
          !!document.querySelector("app-dashboard-application") ||
          !!document.querySelector(".application-card") ||
          !!document.querySelector(".applications")
        );
        return h;
      })
      .catch(() => false));

  if (!onLikelyDashboard) {
    return {
      status: "failed",
      error_code: "NOT_ON_DASHBOARD",
      message: "PEPCO dashboard not detected (wrong URL or missing dashboard DOM).",
      currentUrl,
      cards_found: 0,
      cards: [],
    };
  }

  await waitForDashboardShell(page, logger);

  /** @typedef {{ index: number, rawText: string }} ExtractedBare */
  /** @type {ExtractedBare[]} */
  let extractedBare;
  try {
    extractedBare = await page.evaluate(() => {
      const root =
        /** @type {Element | Document} */ (
          document.querySelector("app-dashboard-application") ?? document.body
        );
      /** @example prefer cards */
      let cards = Array.from(root.querySelectorAll(".application-card"));
      if (!cards.length) cards = Array.from(root.querySelectorAll(".applications > *"));
      if (!cards.length) cards = [];

      /** @example single dashboard container */
      const out = [];

      cards.forEach((el, idx) => {
        const txt = (el instanceof HTMLElement && el.innerText) ? el.innerText.trim() : "";
        if (!txt || txt.length < 8) return;
        out.push({ index: idx, rawText: txt });
      });

      return out.length
        ? out
        : (() => {
            const appWrap = root.querySelector(".applications");
            if (appWrap && appWrap instanceof HTMLElement && appWrap.innerText.trim())
              return [{ index: 0, rawText: appWrap.innerText.trim() }];
            const one = root instanceof HTMLElement ? root.innerText.trim() : "";
            return one.length > 80 ? [{ index: 0, rawText: one }] : [];
          })();
    });
  } catch {
    extractedBare = [];
  }

  /** @type {object[]} */
  const cards = [];

  extractedBare.forEach((row, j) => {
    const idx = typeof row.index === "number" ? row.index : j;
    const rawText = typeof row.rawText === "string" ? row.rawText : "";
    if (!rawText || rawText.length < 8) return;

    let jobId = extractJobIdFromText(rawText);
    if (!jobId) {
      const jLine = extractLabeled(rawText, ["Job ID", "Job Id", "JOB ID"]);
      if (jLine) {
        const m2 = String(jLine).match(JOB_ID_RE);
        if (m2) jobId = m2[0];
      }
    }

    const statusTxt = extractLabeled(rawText, ["Status"]);
    const lastUpdated = extractLabeled(rawText, ["Last Updated"]);
    const dateSubmitted = extractLabeled(rawText, ["Date Submitted"]);

    const td = deriveTitleAddress(rawText);
    cards.push({
      index: idx,
      title: td.title,
      address: td.address ?? extractLabeled(rawText, ["Address"]),
      status: statusTxt,
      lastUpdated,
      dateSubmitted,
      jobId,
      rawText,
    });
  });

  dbgLog(logger, `[PEPCO dashboard] Extracted ${cards.length} dashboard card blob(s)`);

  const payload = {
    status: "completed",
    checkpoint: "dashboard_cards_extracted",
    currentUrl: page.url(),
    cards_found: cards.length,
    cards,
  };

  await maybePersistDashboardArtifacts(page, "pepco-dashboard-4a", payload);

  return payload;
}

/**
 * Phase 4B — attach application IDs by clicking metadata/details per card then returning to dashboard.
 * Does **not** read `/overview` DOM — ID only from URL.
 *
 * @param {import("playwright").Page} page
 * @param {object[]} cards from extractPepcoDashboardCards
 */
async function capturePepcoApplicationIds(page, cards, opts = {}) {
  const logger = opts && typeof opts.logger === "function" ? opts.logger : null;

  if (!Array.isArray(cards) || cards.length === 0) {
    dbgLog(logger, "[PEPCO dashboard] capturePepcoApplicationIds: no cards to click");
    return {
      status: "completed",
      checkpoint: "dashboard_application_ids_captured",
      currentUrl: page.url(),
      cards_found: 0,
      application_ids_found: 0,
      cards: [],
    };
  }

  /** @typedef {{ index?: number }} CardLike */

  /** @type {object[]} */
  const out = [];

  cards.forEach((c) =>
    out.push({
      ...(typeof c === "object" && c ? /** @type {Record<string, unknown>} */ ({ ...c }) : {}),
    }),
  );

  const dashboardHref = resolvePepcoDashboardUrl(page.url());

  /** @example count visible cards reliably */
  const cardLoc = page.locator(".application-card");
  let nCards = await cardLoc.count().catch(() => 0);

  if (nCards === 0) {
    nCards = out.length || 0;
    dbgLog(
      logger,
      "[PEPCO dashboard] `.application-card` count is 0 — using extracted card count fallback for attempt loop",
    );
  }

  let applicationIdsFound = 0;

  for (let i = 0; i < out.length; i++) {
    const rowRef = /** @type {Record<string, unknown>} */ (out[i]);

    if (!dashboardHref) {
      rowRef.applicationIdError = "could_not_resolve_dashboard_home_url";
      continue;
    }

    try {
      await page.goto(String(dashboardHref), { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
      await waitForDashboardShell(page, logger, 55000).catch(() => {});

      const loc = cardLoc.nth(i);
      const meta = loc.locator(".application-metadata").first();
      const det = loc.locator(".application-details").first();

      let clickable = meta;
      if (!(await clickable.isVisible().catch(() => false)))
        clickable = (await det.isVisible().catch(() => false)) ? det : loc;

      await clickable.click({ timeout: 25000 }).catch(async () => {
        await loc.click({ timeout: 12000 }).catch(() => {});
      });

      await page
        .waitForURL(/\/service-installation-upgrades-portal\/application\/[^/]+\/overview/i, {
          timeout: 35000,
        })
        .catch(() => {});

      const urlAfter = page.url();
      const m = urlAfter.match(/\/service-installation-upgrades-portal\/application\/([^/]+)\/overview/i);
      const applicationId = m ? m[1].trim() : null;

      if (applicationId) {
        rowRef.applicationId = applicationId;
        rowRef.overviewUrl = urlAfter;
        applicationIdsFound += 1;
      } else {
        rowRef.applicationIdError = "overview_url_missing_or_unreadable";
      }
    } catch (e) {
      rowRef.applicationIdError = e instanceof Error ? e.message.slice(0, 400) : "click_or_nav_failed";
    }

    /** Navigate back for next iteration safety */
    if (dashboardHref) {
      try {
        await page.goto(String(dashboardHref), { waitUntil: "domcontentloaded", timeout: 90000 });
        await waitForDashboardShell(page, logger).catch(() => {});
      } catch (_) {}
    }
  }

  const envelope = {
    status: "completed",
    checkpoint: "dashboard_application_ids_captured",
    currentUrl: page.url(),
    cards_found: cards.length,
    application_ids_found: applicationIdsFound,
    cards: out,
  };

  await maybePersistDashboardArtifacts(page, "pepco-dashboard-4b", envelope);

  return envelope;
}

module.exports = {
  extractPepcoDashboardCards,
  capturePepcoApplicationIds,
  resolvePepcoDashboardUrl,
};
