/**
 * Prince George's County ePlan — Task 8: SSRS ReportViewer exports (PDF + Excel).
 *
 * CLI: run this file directly. Production: `runPgcProductionPipeline` is used from server.js
 * (login/session listing lives in server; uploads + Supabase sync happen there).
 *
 * Usage (from repo root or scraper-service) — CLI harness only:
 *   export PGC_EPLAN_EMAIL=...
 *   export PGC_EPLAN_PASSWORD=...
 *   node scraper-service/pgc-eplan-scraper.js
 *
 * Production (server.js): credentials come from the app session (saved portal settings),
 * not from env. performPgcLogin does not fall back to PGC_EPLAN_* env vars.
 *
 * Env (CLI only):
 *   PGC_EPLAN_EMAIL, PGC_EPLAN_PASSWORD (required for direct `node` run)
 *   PGC_LOGIN_ONLY_HARNESS=1 — run login → Home → My Projects bootstrap only (no scraping)
 *   PGC_DETAIL_OPEN_HARNESS=1 — after login+Home, find PGC_TARGET_PERMIT row, open detail, verify tab chrome (no tab scrape)
 *   PGC_EPLAN_LOGIN_URL (optional override)
 *   PGC_WEBUI_BASE (optional) — override ProjectDox Web UI origin if auto-detect fails
 *   PGC_PROJECTDOX_API_ORIGIN (optional) — override API host (default: eplans.princegeorgescountymd.gov)
 *   PGC_PORTAL_ORIGIN (optional) — host for /ProjectDox/ReportViewer.aspx (default: origin of PGC_DASHBOARD_URL)
 *   SCRAPER_HEADLESS / PLAYWRIGHT_HEADLESS (same semantics as server.js)
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const pgcProgress = require("./pgc-progress-logger");

// Load .env from scraper-service first, then repo root (do not require server.js).
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const PGC_BASE =
  process.env.PGC_BASE?.trim().replace(/\/$/, "") ||
  "https://eplans.princegeorgescountymd.gov";
const PGC_WEBUI =
  process.env.PGC_WEBUI?.trim().replace(/\/$/, "") ||
  "https://eplans.princegeorgescountymd.gov/ProjectDoxWebUI";
const PGC_API =
  process.env.PGC_API?.trim().replace(/\/$/, "") ||
  `${PGC_BASE}/ProjectDoxWebAPI`;

const PGC_LOGIN_URL_DEFAULT =
  `${PGC_BASE}/Portal/Login/Index/PGC-Prod`;
const PGC_DASHBOARD_URL =
  `${PGC_BASE}/Portal/Home/Index`;
const LOGIN_FAIL_SHOT = path.join(__dirname, "pgc-login-failed.png");

const PGC_SCREENSHOT_BEST_EFFORT_MS = 8000;

/**
 * @param {import('playwright').Page} page
 * @param {string} filePath
 * @param {boolean} [fullPage]
 */
async function pgcScreenshotBestEffort(page, filePath, fullPage = false) {
  try {
    await page.screenshot({
      path: filePath,
      fullPage,
      timeout: PGC_SCREENSHOT_BEST_EFFORT_MS,
    });
  } catch (e) {
    console.warn(
      "[PGC] Screenshot best-effort failed:",
      e?.message || String(e),
    );
  }
}

/**
 * Deep post-login diagnostics (Playwright vs manual Chrome): DOM, storage, cookies, spinners, screenshot.
 * @param {import('playwright').Page} page
 * @param {string} tag
 * @param {{ fullPage?: boolean }} [opts]
 */
async function capturePgcPostLoginDiagnosticsBundle(page, tag, opts = {}) {
  const fullPage = !!opts.fullPage;
  const evalResult = await page
    .evaluate(() => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const bodyText = norm(document.body?.innerText || "");
      const bodyVisible = bodyText.slice(0, 1000);
      const spinnerSelectors = [
        ".spinner",
        ".loading",
        "#loading",
        ".loading-overlay",
        ".page-loading",
        ".k-loading-mask",
        ".ui-widget-overlay",
        ".ui-progressbar",
        "[aria-busy='true']",
        "[class*='loading']",
        "[class*='spinner']",
        "[class*='Loader']",
        "[id*='loading']",
        "[id*='Loading']",
        "[id*='spinner']",
      ];
      /** @type {{ selector: string, text: string, tag: string, id: string, className: string }[]} */
      const visibleSpinners = [];
      for (const sel of spinnerSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const st = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const visible =
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            Number(st.opacity || "1") > 0.05 &&
            r.width > 0 &&
            r.height > 0;
          if (visible) {
            visibleSpinners.push({
              selector: sel,
              text: norm(el.textContent || "").slice(0, 200),
              tag: el.tagName || "",
              id: el.id || "",
              className: String(el.className || "").slice(0, 120),
            });
          }
        });
      }
      const lower = bodyText.toLowerCase();
      const loadingPhrasesHit = [
        "loading",
        "please wait",
        "one moment",
        "processing",
        "hang tight",
        "retrieving",
      ].filter((p) => lower.includes(p));
      return {
        readyState: document.readyState,
        bodyVisibleSnippet: bodyVisible,
        iframeCount: document.querySelectorAll("iframe").length,
        localStorageKeys: Object.keys(window.localStorage || {}),
        sessionStorageKeys: Object.keys(window.sessionStorage || {}),
        visibleSpinners,
        loadingPhrasesHit,
      };
    })
    .catch(() => ({
      readyState: "evaluate-failed",
      bodyVisibleSnippet: "",
      iframeCount: -1,
      localStorageKeys: [],
      sessionStorageKeys: [],
      visibleSpinners: [],
      loadingPhrasesHit: [],
    }));

  const url = page.url();
  const title = (await page.title().catch(() => "")) || "";
  const cookieUrls = [PGC_BASE, PGC_DASHBOARD_URL, PGC_WEBUI].filter(Boolean);
  const allCookies = await page.context().cookies(cookieUrls).catch(() => []);
  const portalCookies = allCookies.filter((c) => {
    const d = String(c.domain || "").toLowerCase().replace(/^\./, "");
    return (
      d.includes("princegeorgescountymd.gov") ||
      d.includes("eplans")
    );
  });

  const shotPath = path.join(
    __dirname,
    `pgc-post-login-${tag}-${Date.now()}.png`,
  );
  await pgcScreenshotBestEffort(page, shotPath, fullPage);

  console.log(`[PGC] Post-login diagnostics [${tag}] URL:`, url);
  console.log(`[PGC] Post-login diagnostics [${tag}] title:`, title);
  console.log(
    `[PGC] Post-login diagnostics [${tag}] readyState:`,
    evalResult.readyState,
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] bodyText[0..1000]:`,
    evalResult.bodyVisibleSnippet || "(empty)",
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] iframeCount:`,
    evalResult.iframeCount,
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] localStorage keys:`,
    evalResult.localStorageKeys,
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] sessionStorage keys:`,
    evalResult.sessionStorageKeys,
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] portal cookie names (${portalCookies.length}):`,
    portalCookies.map((c) => c.name),
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] spinner-like elements (sample):`,
    (evalResult.visibleSpinners || []).slice(0, 15),
  );
  console.log(
    `[PGC] Post-login diagnostics [${tag}] loading phrases in body:`,
    evalResult.loadingPhrasesHit,
  );
  console.log(`[PGC] Post-login diagnostics [${tag}] screenshot:`, shotPath);

  return {
    ...evalResult,
    url,
    title,
    portalCookies,
    screenshotPath: shotPath,
  };
}

/**
 * @param {import('playwright').Page} page
 */
async function evaluatePgcHomeRenderSignals(page) {
  return page.evaluate(() => {
    const norm = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const bodyText = norm(document.body?.innerText || "");
    const lower = bodyText.toLowerCase();
    const readyState = document.readyState;
    const rows = Array.from(
      document.querySelectorAll(
        ".ui-iggrid-table tbody tr, table tbody tr, [role='grid'] [role='row']",
      ),
    );
    let substantiveRows = 0;
    for (const tr of rows) {
      const t = norm(tr.textContent || "");
      if (t.length >= 12 && !/^number$/i.test(t)) substantiveRows++;
    }
    const pager = !!document.querySelector(
      ".ui-iggrid-paging, .ui-iggrid-nextpage, .ui-iggrid-pagelink, .ui-iggrid-pages",
    );
    const listContainer = !!document.querySelector(
      ".ui-iggrid, .ui-iggrid-table, .ui-iggrid-results, [role='grid'], table.ui-iggrid-table",
    );
    const keywordHit =
      lower.includes("my projects") ||
      lower.includes("projectdox") ||
      lower.includes("view projects") ||
      (lower.includes("dashboard") && bodyText.length > 50);
    const cardLike =
      document.querySelectorAll(
        "[class*='card'][class*='project'], .project-card, [data-project-id]",
      ).length > 0;
    return {
      readyState,
      bodyLen: bodyText.length,
      substantiveRows,
      pager,
      listContainer,
      keywordHit,
      cardLike,
      snippet: bodyText.slice(0, 240),
    };
  });
}

/**
 * @param {Awaited<ReturnType<typeof evaluatePgcHomeRenderSignals>>} s
 */
function homeRenderedFromSignals(s) {
  if (!s || typeof s !== "object") return false;
  if (s.substantiveRows >= 1) return true;
  if (s.pager && s.bodyLen >= 25) return true;
  if (s.listContainer && s.keywordHit && s.bodyLen >= 35) return true;
  if (s.cardLike && s.bodyLen >= 25) return true;
  if (s.keywordHit && s.bodyLen >= 80) return true;
  return false;
}

/**
 * Strict post-login gate: Home must show list/pager/dashboard text before project discovery.
 * @param {import('playwright').Page} page
 * @param {{ captureDiagnosticsOnFailure?: boolean }} [opts] — set false to skip failure screenshots (e.g. login harness)
 */
async function assertPgcHomeBootstrapped(page, opts = {}) {
  const captureOnFail = opts.captureDiagnosticsOnFailure !== false;
  const poll = async (maxMs, stepMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const sig = await evaluatePgcHomeRenderSignals(page).catch(() => null);
      if (sig && homeRenderedFromSignals(sig)) return sig;
      await page.waitForTimeout(stepMs);
    }
    return null;
  };

  let sig = await poll(12000, 500);
  if (!sig) {
    await page.waitForTimeout(2000);
    sig = await poll(8000, 500);
  }
  if (!sig || !homeRenderedFromSignals(sig)) {
    try {
      const current = page.url();
      const target =
        /^https?:\/\//i.test(current) && /\/Portal\/Home/i.test(current)
          ? current
          : PGC_DASHBOARD_URL;
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e) {
      console.warn("[PGC] Home bootstrap reload skipped:", e?.message || e);
    }
    await page.waitForTimeout(1500);
    sig = await poll(12000, 500);
  }

  const final =
    sig && homeRenderedFromSignals(sig)
      ? sig
      : await evaluatePgcHomeRenderSignals(page).catch(() => null);
  if (!final || !homeRenderedFromSignals(final)) {
    const detail = final
      ? `readyState=${final.readyState} bodyLen=${final.bodyLen} rows=${final.substantiveRows} pager=${final.pager} list=${final.listContainer}`
      : "no signals";
    console.error("[PGC] Home bootstrap failure detail:", detail);
    if (captureOnFail) {
      await capturePgcPostLoginDiagnosticsBundle(page, "home-bootstrap-failed", {
        fullPage: true,
      }).catch(() => {});
    }
    throw new Error("PGC Home page failed to render after login");
  }
}

/**
 * @param {string} [dashboardOrLoginUrl]
 * @returns {string}
 */
function resolvePgcLoginUrl(dashboardOrLoginUrl) {
  const fallback = PGC_LOGIN_URL_DEFAULT;
  if (!dashboardOrLoginUrl || typeof dashboardOrLoginUrl !== "string")
    return fallback;
  const t = dashboardOrLoginUrl.trim();
  if (!t) return fallback;
  try {
    const u = new URL(t);
    if (/\/login/i.test(u.pathname)) return t;
    return `${u.origin}/Portal/Login/Index/PGC-Prod`;
  } catch {
    return fallback;
  }
}

/**
 * @param {string} [url]
 */
function isPgcEplanHost(url) {
  if (!url || typeof url !== "string") return false;
  return url.toLowerCase().includes("eplans.princegeorgescountymd.gov");
}

const PGC_PORTAL_ORIGIN =
  process.env.PGC_PORTAL_ORIGIN?.trim().replace(/\/$/, "") ||
  (() => {
    try {
      return new URL(PGC_DASHBOARD_URL).origin;
    } catch {
      return "https://eplans.princegeorgescountymd.gov";
    }
  })();

/** Task 8 — wait after report navigation before probing ReportViewer. */
const TASK8_REPORT_POST_NAV_MS = 3500;

/** Task 4: number of unique projects to open for detail tab proof (raise locally only). */
const DETAIL_SAMPLE_LIMIT = 3;

/** Task 6 — per-file size cap (bytes). */
const TASK6_MAX_FILE_BYTES = 50 * 1024 * 1024;
const TASK6_MAX_FILE_KB = Math.floor(TASK6_MAX_FILE_BYTES / 1024);
const TASK6_DOWNLOAD_DELAY_MS = 500;
const TASK6_MAX_DOWNLOAD_ATTEMPTS = 25;

/** Task 7 — cap unique markup PDF GETs per sampled project (safety). */
const TASK7_MAX_UNIQUE_MARKUP_DOWNLOADS = 40;

const MAX_PAGER_PAGES = 25;

/** Verified PGC ProjectDoxWebUI /Project/Index tab names (not Frame.aspx). */
const PGC_PROJECT_UI_INDEX = `${PGC_WEBUI}/Project/Index`;

const PGC_DETAIL_TABS = {
  info: { tabName: "infoTab", extraParams: "projectTab=TabProjectInfo" },
  status: { tabName: "projectStatusTab", extraParams: "" },
  tasks: { tabName: "tasksTab", extraParams: "" },
};

/** @deprecated PGC uses Project/Index only — kept so old call sites that pass tab keys still map. */
const PGC_TAB_PARAMS = {
  info: "infoTab",
  status: "projectStatusTab",
  tasks: "tasksTab",
};

/** Task 5 — PGC ProjectDox Web API (same host as portal; override if tenant differs). */
const PGC_PROJECTDOX_API_ORIGIN =
  process.env.PGC_PROJECTDOX_API_ORIGIN?.trim().replace(/\/$/, "") ||
  "https://eplans.princegeorgescountymd.gov";

/** @typedef {'view_all'|'next_button'|'numbered_pages'|'single_page'|'unknown'} PaginationMode */

function scraperRunsHeadless() {
  const raw = (
    process.env.SCRAPER_HEADLESS ||
    process.env.PLAYWRIGHT_HEADLESS ||
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

function normalizeText(s) {
  if (s == null) return "";
  return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} href
 * @param {string} onclick
 * @param {string} [dataExtra]
 * @returns {string} numeric id string or ""
 */
function extractProjectIdFromLink(href, onclick, dataExtra = "") {
  const pool = `${href || ""} ${onclick || ""} ${dataExtra || ""}`;
  let m = pool.match(/ProjectID\s*=\s*['"]?(\d+)/i);
  if (m) return m[1];
  m = pool.match(/[?&]ProjectID\s*=\s*(\d+)/i);
  if (m) return m[1];
  m = pool.match(/project[_-]?id\s*[=:]\s*['"]?(\d+)/i);
  if (m) return m[1];
  return "";
}

async function launchBrowser() {
  return chromium.launch({
    headless: scraperRunsHeadless(),
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });
}

/**
 * Poll DOM for any login email/username input (shared by full scraper and login harness).
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
async function waitForPgcLoginField(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = await page
      .evaluate(() => {
        const selectors = [
          "#Email",
          'input[type="email"]',
          "#UserName",
          'input[name="Email"]',
          'input[name="UserName"]',
          'input[id*="Email"]',
          'input[id*="User"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          return sel;
        }
        return null;
      })
      .catch(() => null);
    if (hit) return hit;
    await page.waitForTimeout(500);
  }
  return null;
}

/**
 * Login-only harness: open login, detect fields, submit, reach Home with real My Projects / grid signals.
 * No screenshots on the hot path; logs only URL, title, readyState, body snippet, and failed request URLs.
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 * @param {string} loginUrl
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'PASS' | 'FAIL',
 *   reason?: string,
 *   failedRequestUrls: string[],
 *   signals?: Awaited<ReturnType<typeof evaluatePgcHomeRenderSignals>>,
 * }>}
 */
async function runPgcLoginOnlyHarness(page, email, password, loginUrl) {
  /** @type {string[]} */
  const failedRequestUrls = [];
  const onRequestFailed = (req) => {
    failedRequestUrls.push(req.url());
  };
  page.on("requestfailed", onRequestFailed);

  const harnessLog = async (phase) => {
    const url = page.url();
    const title = (await page.title().catch(() => "")) || "";
    const { readyState, snippet } = await page
      .evaluate(() => {
        const norm = (s) =>
          String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const bodyText = norm(document.body?.innerText || "");
        return {
          readyState: document.readyState,
          snippet: bodyText.slice(0, 280),
        };
      })
      .catch(() => ({ readyState: "evaluate-failed", snippet: "" }));
    console.log(`[PGC-HARNESS] ${phase} URL:`, url);
    console.log(`[PGC-HARNESS] ${phase} title:`, title);
    console.log(`[PGC-HARNESS] ${phase} readyState:`, readyState);
    console.log(`[PGC-HARNESS] ${phase} bodySnippet:`, snippet || "(empty)");
    console.log(
      `[PGC-HARNESS] ${phase} failedRequestUrls (${failedRequestUrls.length}):`,
      failedRequestUrls,
    );
  };

  try {
    await page.goto(loginUrl, {
      waitUntil: "commit",
      timeout: 30000,
    });
    await page.waitForTimeout(1200);
    await harnessLog("after-login-commit");

    let domReady = true;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch {
      domReady = false;
    }
    if (!domReady) {
      try {
        await page.goto(loginUrl, { waitUntil: "load", timeout: 30000 });
      } catch {
        /* best-effort */
      }
      await page.waitForTimeout(1000);
      try {
        await page.goto(loginUrl, { waitUntil: "commit", timeout: 30000 });
      } catch {
        /* best-effort */
      }
      await page.waitForTimeout(1000);
    }

    let loginFieldSelector = await waitForPgcLoginField(page, 20000);
    if (!loginFieldSelector) {
      await page
        .goto(loginUrl, { waitUntil: "commit", timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      loginFieldSelector = await waitForPgcLoginField(page, 12000);
    }
    if (!loginFieldSelector) {
      await harnessLog("FAIL-no-login-field");
      return {
        ok: false,
        status: "FAIL",
        reason: "Login form field not detected",
        failedRequestUrls: [...failedRequestUrls],
      };
    }
    await harnessLog("login-field-ready");

    await page.waitForTimeout(1500);

    await page.evaluate(
      (creds) => {
        const first = (selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
          }
          return null;
        };
        const emailField = first([
          "#Email",
          'input[type="email"]',
          "#UserName",
          'input[name="Email"]',
          'input[name="UserName"]',
          'input[id*="Email"]',
          'input[id*="User"]',
        ]);
        const passwordField = first([
          "#Password",
          'input[type="password"]',
          'input[name="Password"]',
          'input[id*="Password"]',
        ]);
        if (!emailField || !passwordField) return;

        emailField.value = creds.email;
        passwordField.value = creds.password;

        emailField.dispatchEvent(new Event("input", { bubbles: true }));
        emailField.dispatchEvent(new Event("change", { bubbles: true }));
        passwordField.dispatchEvent(new Event("input", { bubbles: true }));
        passwordField.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { email: email || "", password: password || "" },
    );

    await page.evaluate(() => {
      const form = document.querySelector("form");
      if (form) form.submit();
    });

    const homeUrlOk = await page
      .waitForURL(/\/Portal\/Home\/Index/i, { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    await page
      .waitForFunction(() => !window.location.href.includes("Login"), {
        timeout: 15000,
      })
      .catch(() => {});
    await page
      .waitForLoadState("domcontentloaded", { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(800);

    await harnessLog("after-submit-navigation");

    const urlAfterNav = page.url();
    const stillOnLoginPath =
      /\/Login\//i.test(urlAfterNav) || /\/login\//i.test(urlAfterNav);
    if (!homeUrlOk && stillOnLoginPath) {
      await harnessLog("FAIL-still-on-login");
      return {
        ok: false,
        status: "FAIL",
        reason: "Did not reach Portal/Home after submit",
        failedRequestUrls: [...failedRequestUrls],
      };
    }

    try {
      await assertPgcHomeBootstrapped(page, {
        captureDiagnosticsOnFailure: false,
      });
    } catch (e) {
      await harnessLog("FAIL-home-bootstrap");
      return {
        ok: false,
        status: "FAIL",
        reason: e?.message || String(e),
        failedRequestUrls: [...failedRequestUrls],
      };
    }

    const sig = await evaluatePgcHomeRenderSignals(page).catch(() => null);
    const contentOk = sig && homeRenderedFromSignals(sig);
    if (!contentOk) {
      await harnessLog("FAIL-empty-project-content");
      return {
        ok: false,
        status: "FAIL",
        reason: "Home loaded but project list / My Projects content not confirmed",
        failedRequestUrls: [...failedRequestUrls],
        signals: sig || undefined,
      };
    }

    await harnessLog("PASS-home-ready");
    lastAuthUrl = page.url();
    lastAuthTitle = (await page.title().catch(() => "")) || "";

    return {
      ok: true,
      status: "PASS",
      reason: "Home rendered with non-empty project content",
      failedRequestUrls: [...failedRequestUrls],
      signals: sig,
    };
  } catch (e) {
    await harnessLog("FAIL-exception").catch(() => {});
    return {
      ok: false,
      status: "FAIL",
      reason: e?.message || String(e),
      failedRequestUrls: [...failedRequestUrls],
    };
  } finally {
    page.off("requestfailed", onRequestFailed);
  }
}

/** Filled after successful login checks. */
let lastAuthTitle = "";
let lastAuthUrl = "";

/**
 * @param {import('playwright').Page} page
 */
/**
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 * @param {string} loginUrl
 * @param {{ credentialsSource?: string }} [opts]
 */
async function performPgcLogin(page, email, password, loginUrl, opts = {}) {
  const credEmail = String(email ?? "").trim();
  const credPassword = password != null ? String(password) : "";
  if (!credEmail || credPassword === "") {
    console.error(
      "[PGC] Saved portal credentials lookup: missing username or password (no env fallback)",
    );
    throw new Error("pgc_saved_portal_credentials_missing");
  }
  const credentialsSource = opts.credentialsSource ?? "inline_arguments";
  pgcProgress.pgcLogDetail("login_attempt", {
    credentialsSource,
    envCredentialFallback: false,
    loginUrl,
  });
  pgcProgress.pgcLogLoginStart(loginUrl);

  console.log("[PGC] Navigating to login:", loginUrl);
  const initialConsoleErrors = [];
  const initialPageErrors = [];
  const initialFailedRequests = [];
  const initialBadResponses = [];
  const onInitialConsole = (msg) => {
    const type = msg.type();
    if (type !== "error") return;
    const txt = msg.text();
    initialConsoleErrors.push(txt);
    console.warn("[PGC] Initial-load console error:", txt);
  };
  const onInitialPageError = (err) => {
    const msg = (err && err.message) || String(err);
    initialPageErrors.push(msg);
    console.warn("[PGC] Initial-load pageerror:", msg);
  };
  const onInitialRequestFailed = (req) => {
    const failure = req.failure();
    const payload = {
      url: req.url(),
      method: req.method(),
      errorText: failure?.errorText || "unknown",
    };
    initialFailedRequests.push(payload);
    console.warn(
      "[PGC] Initial-load requestfailed:",
      payload.errorText,
      payload.method,
      payload.url,
    );
  };
  const onInitialResponse = (res) => {
    const status = res.status();
    if (status < 400) return;
    const payload = { status, url: res.url() };
    initialBadResponses.push(payload);
    console.warn("[PGC] Initial-load HTTP error response:", status, payload.url);
  };
  page.on("console", onInitialConsole);
  page.on("pageerror", onInitialPageError);
  page.on("requestfailed", onInitialRequestFailed);
  page.on("response", onInitialResponse);

  const captureInitialLoginSnapshot = async (tag) => {
    const diag = await page
      .evaluate(() => {
        const norm = (s) =>
          String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const bodyText = norm(document.body?.innerText || "");
        const bodyHtml = String(document.body?.innerHTML || "").slice(0, 1000);
        const spinnerSelectors = [
          ".spinner",
          ".loading",
          ".loading-overlay",
          ".k-loading-mask",
          ".ui-widget-overlay",
          "[aria-busy='true']",
          "[class*='loading']",
          "[class*='spinner']",
        ];
        const visibleSpinners = spinnerSelectors
          .map((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const st = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const visible =
              st.display !== "none" &&
              st.visibility !== "hidden" &&
              r.width > 0 &&
              r.height > 0;
            if (!visible) return null;
            return {
              selector: sel,
              text: norm(el.textContent || "").slice(0, 180),
            };
          })
          .filter(Boolean);
        return {
          readyState: document.readyState,
          bodyTextSnippet: bodyText.slice(0, 1000),
          bodyHtmlSnippet: bodyHtml,
          iframeCount: document.querySelectorAll("iframe").length,
          visibleSpinners,
        };
      })
      .catch(() => ({
        readyState: "unavailable",
        bodyTextSnippet: "",
        bodyHtmlSnippet: "",
        iframeCount: -1,
        visibleSpinners: [],
      }));
    const curUrl = page.url();
    const curTitle = (await page.title().catch(() => "")) || "";
    const shotPath = path.join(
      __dirname,
      `pgc-login-initial-${tag}-${Date.now()}.png`,
    );
    await pgcScreenshotBestEffort(page, shotPath, false);

    const text = String(diag.bodyTextSnippet || "").toLowerCase();
    const html = String(diag.bodyHtmlSnippet || "").toLowerCase();
    const spinnerOnly =
      (diag.visibleSpinners || []).length > 0 &&
      String(diag.bodyTextSnippet || "").trim().length < 80;
    const blankPage =
      String(diag.bodyTextSnippet || "").trim().length === 0 &&
      String(diag.bodyHtmlSnippet || "").trim().length < 50;
    const accessDenied =
      /access denied|forbidden|403|not authorized|permission denied/.test(text) ||
      /access denied|forbidden|403|not authorized|permission denied/.test(html);
    const challengeInterstitial =
      /checking your browser|verify you are human|captcha|cloudflare|attention required|perimeterx|incapsula|akamai/.test(
        text,
      ) ||
      /cf-challenge|captcha|challenge-form|hcaptcha|g-recaptcha/.test(html);
    const classification = accessDenied
      ? "access_denied_or_bot_block"
      : challengeInterstitial
        ? "challenge_or_interstitial"
        : blankPage
          ? "blank_page"
          : spinnerOnly
            ? "spinner_only_shell"
            : "content_present_or_partial";

    console.log(`[PGC] Initial login diagnostics (${tag}) — URL:`, curUrl);
    console.log(`[PGC] Initial login diagnostics (${tag}) — title:`, curTitle);
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — readyState:`,
      diag.readyState,
    );
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — bodyText[0..1000]:`,
      diag.bodyTextSnippet || "(empty)",
    );
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — bodyHtml[0..1000]:`,
      diag.bodyHtmlSnippet || "(empty)",
    );
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — frames:`,
      diag.iframeCount,
    );
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — spinners:`,
      diag.visibleSpinners || [],
    );
    console.log(
      `[PGC] Initial login diagnostics (${tag}) — screenshot:`,
      shotPath,
    );
    console.warn(
      `[PGC] Initial login diagnostics (${tag}) — classification: ${classification}`,
    );
    return { classification, diag, curUrl, curTitle };
  };

  try {
    console.log("[PGC] Initial login navigation attempt: waitUntil=commit");
    await page.goto(loginUrl, {
      waitUntil: "commit",
      timeout: 30000,
    });
    await page.waitForTimeout(1200);
    await captureInitialLoginSnapshot("commit");

    let domReady = true;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
      console.log("[PGC] Initial login DOM readiness: domcontentloaded succeeded");
    } catch (e) {
      domReady = false;
      console.warn(
        "[PGC] Initial login DOM readiness: domcontentloaded failed:",
        e?.message || e,
      );
    }

    if (!domReady) {
      console.log("[PGC] Fallback navigation attempt: waitUntil=load");
      try {
        await page.goto(loginUrl, { waitUntil: "load", timeout: 30000 });
        console.log("[PGC] Fallback result: waitUntil=load succeeded");
      } catch (eLoad) {
        console.warn(
          "[PGC] Fallback result: waitUntil=load failed:",
          eLoad?.message || eLoad,
        );
      }
      await page.waitForTimeout(1000);
      await captureInitialLoginSnapshot("fallback-load");

      console.log("[PGC] Fallback navigation attempt: waitUntil=commit");
      try {
        await page.goto(loginUrl, { waitUntil: "commit", timeout: 30000 });
        console.log("[PGC] Fallback result: waitUntil=commit succeeded");
      } catch (eCommit) {
        console.warn(
          "[PGC] Fallback result: waitUntil=commit failed:",
          eCommit?.message || eCommit,
        );
      }
      await page.waitForTimeout(1000);
      await captureInitialLoginSnapshot("fallback-commit");
    }

    let loginFieldSelector = await waitForPgcLoginField(page, 20000);
    if (!loginFieldSelector) {
      console.warn(
        "[PGC] Login field not found after staged checks. Retrying navigation once (waitUntil=commit).",
      );
      await page.goto(loginUrl, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await captureInitialLoginSnapshot("retry-no-form");
      loginFieldSelector = await waitForPgcLoginField(page, 12000);
    }
    if (!loginFieldSelector) {
      await captureInitialLoginSnapshot("no-login-field");
      throw new Error(
        "Login form field not detected after staged commit/poll/retry flow",
      );
    }
    console.log("[PGC] Login form readiness selector:", loginFieldSelector);
  } finally {
    console.log(
      "[PGC] Initial login diagnostics summary:",
      JSON.stringify(
        {
          failedRequests: initialFailedRequests.length,
          badResponses: initialBadResponses.length,
          consoleErrors: initialConsoleErrors.length,
          pageErrors: initialPageErrors.length,
        },
        null,
        2,
      ),
    );
    page.off("console", onInitialConsole);
    page.off("pageerror", onInitialPageError);
    page.off("requestfailed", onInitialRequestFailed);
    page.off("response", onInitialResponse);
  }
  await page.waitForTimeout(1500);
  await page.waitForTimeout(1500);

  await page.evaluate(
    (creds) => {
      const first = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      const emailField = first([
        "#Email",
        'input[type="email"]',
        "#UserName",
        'input[name="Email"]',
        'input[name="UserName"]',
        'input[id*="Email"]',
        'input[id*="User"]',
      ]);
      const passwordField = first([
        "#Password",
        'input[type="password"]',
        'input[name="Password"]',
        'input[id*="Password"]',
      ]);
      if (!emailField || !passwordField) return;

      emailField.value = creds.email;
      passwordField.value = creds.password;

      emailField.dispatchEvent(new Event("input", { bubbles: true }));
      emailField.dispatchEvent(new Event("change", { bubbles: true }));
      passwordField.dispatchEvent(new Event("input", { bubbles: true }));
      passwordField.dispatchEvent(new Event("change", { bubbles: true }));
    },
    {
      email: credEmail,
      password: credPassword,
    },
  );

  console.log("[PGC] Credentials filled");

  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const onRequestFailed = (req) => {
    const failure = req.failure();
    const payload = {
      url: req.url(),
      method: req.method(),
      errorText: failure?.errorText || "unknown",
    };
    failedRequests.push(payload);
    console.warn(
      "[PGC] Post-login requestfailed:",
      payload.errorText,
      payload.method,
      payload.url,
    );
  };
  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const txt = msg.text();
    consoleErrors.push(txt);
    console.warn("[PGC] Post-login console error:", txt);
  };
  const onPageError = (err) => {
    const msg = (err && err.message) || String(err);
    pageErrors.push(msg);
    console.warn("[PGC] Post-login pageerror:", msg);
  };
  const badResponses = [];
  const onBadResponse = (res) => {
    const status = res.status();
    if (status < 400) return;
    badResponses.push({ status, url: res.url() });
    console.warn("[PGC] Post-login HTTP error response:", status, res.url());
  };

  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onBadResponse);

  await page.evaluate(() => {
    const form = document.querySelector("form");
    if (form) form.submit();
  });

  try {
    const homeUrlOk = await page
      .waitForURL(/\/Portal\/Home\/Index/i, { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    if (!homeUrlOk) {
      console.warn(
        "[PGC] Post-login waitForURL(/Portal/Home/Index) timed out — current URL:",
        page.url(),
      );
    }

    await page
      .waitForFunction(
        () => !window.location.href.includes("Login"),
        { timeout: 15000 },
      )
      .catch(() => {});

    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);

    await capturePgcPostLoginDiagnosticsBundle(page, "immediate-after-submit", {
      fullPage: true,
    });

    const readinessSelectors = [
      "table tbody tr",
      ".ui-iggrid-table tbody tr",
      "a[href*='ProjectID=']",
      "[role='grid'] [role='row']",
    ];
    let loggedInElementSelector = "";
    const pollDeadline = Date.now() + 45000;
    let poll = 0;
    while (Date.now() < pollDeadline && !loggedInElementSelector) {
      poll += 1;
      for (const sel of readinessSelectors) {
        const ok = await page
          .locator(sel)
          .first()
          .isVisible({ timeout: 1200 })
          .catch(() => false);
        if (ok) {
          loggedInElementSelector = sel;
          break;
        }
      }
      if (loggedInElementSelector) break;
      if (poll % 4 === 0) {
        const sig = await evaluatePgcHomeRenderSignals(page).catch(() => null);
        console.warn(
          "[PGC] Post-login still waiting for real dashboard content — poll",
          poll,
          sig ? JSON.stringify(sig) : "no signals",
        );
      }
      await page.waitForTimeout(2000);
    }

    const postBundle = await capturePgcPostLoginDiagnosticsBundle(
      page,
      "after-readiness-poll",
      { fullPage: true },
    );

    const url = postBundle.url;
    const title = postBundle.title;
    const stillOnLoginPath = /\/Login\//i.test(url) || /\/login\//i.test(url);
    const looksAuthenticated =
      /\/Portal\/Home\//i.test(url) ||
      /\/ProjectDox\//i.test(url) ||
      /\/ViewProjects/i.test(url) ||
      (/\/Portal\//i.test(url) && !stillOnLoginPath);
    const titleOk = /projectdox/i.test(title);

    pgcProgress.pgcLogLoginOk(credentialsSource);
    pgcProgress.pgcLogDetail("login_post_success", {
      url,
      title,
      postBundle,
      loggedInElementSelector,
      failedRequests,
      badResponses,
      consoleErrors,
      pageErrors,
      summary: {
        failedRequests: failedRequests.length,
        httpErrors: badResponses.length,
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
      },
    });

    const hasSpinner = (postBundle.visibleSpinners || []).length > 0;
    const hasBootstrapError =
      pageErrors.length > 0 ||
      consoleErrors.some((m) =>
        /(uncaught|referenceerror|typeerror|syntaxerror|failed to load|bootstrap)/i.test(
          String(m || ""),
        ),
      );
    const hasBlockedResources =
      failedRequests.length > 0 || badResponses.length > 0;
    const hasSessionHints =
      postBundle.portalCookies.length > 0 &&
      (postBundle.sessionStorageKeys || []).length > 0;
    const contentReady = !!loggedInElementSelector;

    if (hasSpinner) {
      const firstSpinner = postBundle.visibleSpinners[0];
      console.warn(
        "[PGC] Loading shell detected after login:",
        firstSpinner?.selector || "(unknown)",
        firstSpinner?.tag || "",
        firstSpinner?.id || "",
        firstSpinner?.className || "",
        "| text:",
        firstSpinner?.text || "",
      );
    }

    if (!contentReady) {
      let cause = "automation_detection_symptom";
      if (hasBootstrapError) cause = "js_bootstrap_failure";
      else if (hasBlockedResources) cause = "blocked_resource";
      else if (!hasSessionHints || stillOnLoginPath)
        cause = "missing_cookie_or_session_state";
      else if (hasSpinner || (postBundle.loadingPhrasesHit || []).length)
        cause = "stuck_loading_shell";
      console.warn(
        `[PGC] Post-login rendered content missing. Probable cause: ${cause}`,
      );
      console.warn("[PGC] Post-login failed requests count:", failedRequests.length);
      console.warn("[PGC] Post-login HTTP 4xx/5xx responses:", badResponses.length);
      console.warn("[PGC] Post-login console errors count:", consoleErrors.length);
      console.warn("[PGC] Post-login page errors count:", pageErrors.length);
    }

    lastAuthUrl = url;
    lastAuthTitle = title;

    if (stillOnLoginPath && !contentReady) {
      throw new Error(`Still on login page. URL: ${url} title: ${title}`);
    }
    if (!looksAuthenticated && !contentReady && !titleOk) {
      throw new Error(`Post-login page unclear. URL: ${url} title: ${title}`);
    }
  } finally {
    page.off("requestfailed", onRequestFailed);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onBadResponse);
  }
}

async function waitForProjectGrid(page) {
  await page
    .waitForSelector(
      'table tbody tr, .ui-iggrid-table tbody tr, [role="grid"] [role="row"]',
      { state: "visible", timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Inspect DOM for diagnostics (Task 3 Part A). Runs in browser.
 */
async function inspectDashboardStructure(page) {
  /** @type {any} */
  const report = await page.evaluate(() => {
    function pidFromAttr(el) {
      if (!el) return "";
      const href = el.getAttribute("href") || "";
      const onclick = el.getAttribute("onclick") || "";
      let data = "";
      for (const attr of el.attributes || []) {
        const n = attr.name.toLowerCase();
        if (
          n.includes("project") ||
          n === "data-args" ||
          n.startsWith("data-")
        ) {
          data += " " + attr.value;
        }
      }
      const pool = href + " " + onclick + " " + data;
      let m = pool.match(/ProjectID\s*=\s*['"]?(\d+)/i);
      if (m) return { id: m[1], via: "regex" };
      m = pool.match(/[?&]ProjectID\s*=\s*(\d+)/i);
      if (m) return { id: m[1], via: "query" };
      m = pool.match(/launchRemote\s*\(\s*['"]([^'"]+)['"]/i);
      if (m && /ProjectID=/i.test(m[1])) {
        const mm = m[1].match(/ProjectID=(\d+)/i);
        if (mm) return { id: mm[1], via: "launchRemote" };
      }
      return { id: "", via: "" };
    }

    function bestPidInRow(tr) {
      const candidates = tr.querySelectorAll(
        "a, button, [onclick], td, [data-projectid], [data-project-id]",
      );
      for (const el of candidates) {
        const r = pidFromAttr(el);
        if (r.id) return { ...r, tag: el.tagName };
      }
      const r2 = pidFromAttr(tr);
      if (r2.id) return { ...r2, tag: tr.tagName };
      return { id: "", via: "", tag: "" };
    }

    const igRows = document.querySelectorAll(".ui-iggrid-table tbody tr");
    const tableRows = document.querySelectorAll("table tbody tr");
    let igWithPid = 0;
    let tableWithPid = 0;
    for (const tr of igRows) {
      if (bestPidInRow(tr).id) igWithPid++;
    }
    for (const tr of tableRows) {
      if (bestPidInRow(tr).id) tableWithPid++;
    }

    let rowSelector = "table tbody tr";
    if (igWithPid >= tableWithPid && igWithPid > 0)
      rowSelector = ".ui-iggrid-table tbody tr";
    else if (tableWithPid === 0 && igWithPid === 0) {
      if (igRows.length > tableRows.length) rowSelector = ".ui-iggrid-table tbody tr";
    }

    const sampleRow =
      rowSelector === ".ui-iggrid-table tbody tr"
        ? document.querySelector(".ui-iggrid-table tbody tr")
        : document.querySelector("table tbody tr");
    const samplePid = sampleRow ? bestPidInRow(sampleRow) : { id: "", via: "" };
    const sampleLink = sampleRow?.querySelector("a");
    const linkDebug = sampleLink
      ? {
          href: (sampleLink.getAttribute("href") || "").slice(0, 200),
          onclick: (sampleLink.getAttribute("onclick") || "").slice(0, 200),
        }
      : null;

    return {
      rowSelector,
      igRowCount: igRows.length,
      tableRowCount: tableRows.length,
      igWithPid,
      tableWithPid,
      sampleLinkPattern: linkDebug,
      sampleExtractVia: samplePid.via,
    };
  });

  console.log("[PGC] Structure — detected row selector:", report.rowSelector);
  console.log(
    "[PGC] Structure — ig rows / with ProjectID:",
    report.igRowCount,
    "/",
    report.igWithPid,
  );
  console.log(
    "[PGC] Structure — table rows / with ProjectID:",
    report.tableRowCount,
    "/",
    report.tableWithPid,
  );
  console.log(
    "[PGC] Structure — sample link href/onclick (trimmed):",
    JSON.stringify(report.sampleLinkPattern),
  );
  console.log("[PGC] Structure — sample ProjectID via:", report.sampleExtractVia || "(none)");
  return report;
}

/**
 * Read project rows from current DOM. Rows without projectID are counted but not returned.
 * @returns {Promise<{ rows: object[], skippedNoProjectId: number, rawScanned: number, linkPatternSummary: string }>}
 */
async function readProjectRows(page) {
  /** @type {any} */
  const pack = await page.evaluate(() => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }

    function pidFromEl(el) {
      if (!el) return "";
      const href = el.getAttribute("href") || "";
      const onclick = el.getAttribute("onclick") || "";
      let data = "";
      for (const attr of el.attributes || []) {
        const n = attr.name.toLowerCase();
        if (
          n.includes("project") ||
          n.startsWith("data-") ||
          n === "data-args"
        ) {
          data += " " + attr.value;
        }
      }
      const pool = href + " " + onclick + " " + data;
      let m = pool.match(/ProjectID\s*=\s*['"]?(\d+)/i);
      if (m) return m[1];
      m = pool.match(/[?&]ProjectID\s*=\s*(\d+)/i);
      if (m) return m[1];
      m = pool.match(/project[_-]?id\s*[=:'"]\s*['"]?(\d+)/i);
      if (m) return m[1];
      m = pool.match(/launchRemote\s*\(\s*['"]([^'"]+)['"]/i);
      if (m && /ProjectID=/i.test(m[1])) {
        const mm = m[1].match(/ProjectID=(\d+)/i);
        if (mm) return mm[1];
      }
      return "";
    }

    function pidFromRow(tr) {
      const tryEls = tr.querySelectorAll("a, button, [onclick]");
      for (const el of tryEls) {
        const p = pidFromEl(el);
        if (p) return { projectID: p, source: el.tagName + ":href/onclick" };
      }
      for (const td of tr.querySelectorAll("td")) {
        const p = pidFromEl(td);
        if (p) return { projectID: p, source: "td" };
      }
      const pTr = pidFromEl(tr);
      if (pTr) return { projectID: pTr, source: "tr" };
      return { projectID: "", source: "" };
    }

    function isHeaderishRow(tr) {
      if (tr.closest("thead")) return true;
      const cells = tr.querySelectorAll("td, th");
      if (!cells.length) return true;
      if (tr.querySelector("th") && !tr.querySelector("td")) return true;
      const text = norm(tr.textContent || "");
      if (/^project(\s+number)?$/i.test(text)) return true;
      const joined = Array.from(cells)
        .map((c) => norm(c.textContent))
        .join("|");
      if (
        /project|permit|description|location|status|task/i.test(joined) &&
        cells.length <= 6
      ) {
        const dataLinks = tr.querySelector("a[href*='ProjectID'], a[onclick*='ProjectID']");
        if (!dataLinks) return true;
      }
      return false;
    }

    const trSet = new Set();
    const selectors = [".ui-iggrid-table tbody tr", "table tbody tr"];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((tr) => trSet.add(tr));
    }

    /** @type {any[]} */
    const rows = [];
    let rawScanned = 0;
    let skippedNoProjectId = 0;
    const patternHits = { href: 0, onclick: 0, launchRemote: 0, other: 0 };

    for (const tr of trSet) {
      if (isHeaderishRow(tr)) continue;
      rawScanned++;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 1) {
        skippedNoProjectId++;
        continue;
      }

      const { projectID, source } = pidFromRow(tr);
      if (!projectID) {
        skippedNoProjectId++;
        continue;
      }

      const link = tr.querySelector("a") || tr.querySelector("button");
      const projectNumber = norm(
        link?.textContent || tds[0]?.textContent || "",
      );
      const description = norm(tds[1]?.textContent || "");
      const location = norm(tds[2]?.textContent || "");
      let status = "";
      if (tds.length >= 4) {
        const stCell = tds[tds.length - 1];
        const inner = stCell?.querySelector("button, a.btn, span.badge, a");
        status = norm(inner?.textContent || stCell?.textContent || "");
      }
      if (status && status.length > 2 && status.length % 2 === 0) {
        const half = status.substring(0, status.length / 2);
        if (status === half + half) status = half;
      }

      const href = link?.getAttribute("href") || "";
      const on = link?.getAttribute("onclick") || "";
      if (/ProjectID=/i.test(href)) patternHits.href++;
      else if (/launchRemote/i.test(on)) patternHits.launchRemote++;
      else if (/ProjectID=/i.test(on)) patternHits.onclick++;
      else patternHits.other++;

      rows.push({
        projectNumber,
        description,
        location,
        status,
        projectID: String(projectID),
        _linkSource: source,
      });
    }

    return {
      rows,
      skippedNoProjectId,
      rawScanned,
      linkPatternSummary: JSON.stringify(patternHits),
    };
  });

  return {
    rows: pack.rows.map((r) => {
      const { _linkSource, ...rest } = r;
      return {
        ...rest,
        projectNumber: normalizeText(rest.projectNumber),
        description: normalizeText(rest.description),
        location: normalizeText(rest.location),
        status: normalizeText(rest.status),
        _linkSource,
      };
    }),
    skippedNoProjectId: pack.skippedNoProjectId,
    rawScanned: pack.rawScanned,
    linkPatternSummary: pack.linkPatternSummary,
  };
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<{ mode: PaginationMode, viewAllVisible: boolean, hasNext: boolean, hasNumberedPager: boolean }>}
 */
async function detectPaginationMode(page) {
  const viewAll = page.locator(
    'a:has-text("View All"), button:has-text("View All"), a:has-text("View all projects"), button:has-text("View all projects"), :text-matches("View All\\\\s+Project", "i")',
  ).first();
  const viewAllVisible = await viewAll.isVisible().catch(() => false);

  const hasNext =
    (await page
      .locator(
        '.ui-iggrid-nextpage:not(.ui-state-disabled), .ui-iggrid-paging-next:not(.ui-state-disabled), a:has-text("Next"):not([aria-disabled="true"]), button:has-text("Next"):not([disabled])',
      )
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .getByRole("link", { name: /next/i })
      .first()
      .isVisible()
      .catch(() => false));

  const hasNumberedPager = await page
    .locator(
      '.ui-iggrid-paging-item, .ui-iggrid-pagelink, [class*="iggrid-paging"] a, ul.pagination a',
    )
    .first()
    .isVisible()
    .catch(() => false);

  /** @type {PaginationMode} */
  let mode = "unknown";
  if (viewAllVisible) mode = "view_all";
  else if (hasNext || hasNumberedPager) {
    mode = hasNumberedPager ? "numbered_pages" : "next_button";
  } else {
    mode = "single_page";
  }

  return {
    mode,
    viewAllVisible,
    hasNext,
    hasNumberedPager,
  };
}

/**
 * @param {import('playwright').Page} page
 */
async function clickViewAllIfPresent(page) {
  const locators = [
    page.getByRole("link", { name: /view\s+all/i }),
    page.getByRole("button", { name: /view\s+all/i }),
    page.locator('a:has-text("View All")'),
    page.locator('button:has-text("View All")'),
    page.locator(':text-matches("View All\\\\s+Projects?", "i")'),
  ];
  for (const loc of locators) {
    const el = loc.first();
    if (await el.isVisible().catch(() => false)) {
      console.log("[PGC] Clicking View All–style control");
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        el.click({ timeout: 15000 }),
      ]);
      await page.waitForTimeout(2500);
      await waitForProjectGrid(page);
      return true;
    }
  }
  return false;
}

/**
 * Click "next" in an Ignite UI style numbered pager (active page → following page link).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function goToNumberedNextPage(page) {
  const clicked = await page.evaluate(() => {
    const pager =
      document.querySelector(".ui-iggrid-paging") ||
      document.querySelector('[class*="iggrid-paging"]');
    if (!pager) return false;
    const items = Array.from(
      pager.querySelectorAll(
        "a, .ui-iggrid-pagelink, .ui-iggrid-paging-item, span.ui-iggrid-pagelink",
      ),
    );
    let activeIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const cls = el.className || "";
      if (
        /ui-state-active|ui-state-focus|selected|current|active/i.test(cls)
      ) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx >= 0) {
      for (let j = activeIdx + 1; j < items.length; j++) {
        const cand = items[j];
        const t = (cand.textContent || "").trim();
        if (/^\d+$/.test(t) || /next|›|»/i.test(t)) {
          (cand instanceof HTMLElement ? cand : cand.parentElement)?.click();
          return true;
        }
      }
    }
    const numLinks = items.filter((el) => /^\d+$/.test(
      (el.textContent || "").trim(),
    ));
    const currentEl = numLinks.find((el) =>
      /ui-state-active|selected|current/i.test(el.className || ""),
    );
    if (currentEl) {
      const n = parseInt((currentEl.textContent || "").trim(), 10);
      const target = numLinks.find(
        (el) => parseInt((el.textContent || "").trim(), 10) === n + 1,
      );
      if (target) {
        target.click();
        return true;
      }
    }
    return false;
  });
  if (clicked) {
    await page.waitForTimeout(1200);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await waitForProjectGrid(page);
  }
  return clicked;
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function goToNextPage(page, preferNumbered = false) {
  if (preferNumbered) {
    if (await goToNumberedNextPage(page)) return true;
  }
  const nextLocators = [
    page.locator(".ui-iggrid-nextpage:not(.ui-state-disabled)").first(),
    page.locator(".ui-iggrid-paging-next:not(.ui-state-disabled)").first(),
    page.getByRole("button", { name: /^next$/i }),
    page.getByRole("link", { name: /^next$/i }),
  ];
  for (const loc of nextLocators) {
    if (await loc.isVisible().catch(() => false)) {
      await loc.click({ timeout: 10000 });
      await page.waitForTimeout(1200);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await waitForProjectGrid(page);
      return true;
    }
  }
  if (!preferNumbered && (await goToNumberedNextPage(page))) return true;
  return false;
}

function rowSignatureFromIds(ids) {
  return [...ids].sort().join(",");
}

/**
 * @param {import('playwright').Page} page
 * @param {{ initialMode: PaginationMode, viewAllVisible: boolean, targetPermit?: string }} ctx
 */
async function collectAllProjects(page, ctx) {
  await assertPgcHomeBootstrapped(page);
  let paginationMode = ctx.initialMode;
  let pagesVisited = 1;
  let viewAllClicked = false;
  let rawRowsScanned = 0;
  let validRowsWithProjectId = 0;
  let skippedNoProjectIdTotal = 0;
  /** @type {Map<string, object>} */
  const uniqueById = new Map();
  let duplicateRowsSkipped = 0;
  let lastSignature = "";
  /** First-page link histogram only (per-page counts, not summed across pagination). */
  let linkPatternSummary = "{}";
  const targetPermit = normalizeText(
    ctx.targetPermit || process.env.PGC_TARGET_PERMIT || "62227-2024-CIEU",
  );
  if (paginationMode === "view_all") {
    paginationMode = "next_button";
  }

  for (let i = 0; i < MAX_PAGER_PAGES; i++) {
    const pageNum = i + 1;
    console.log(`[PGC] Searching projects page ${pageNum}`);
    const pack = await readProjectRows(page);
    if (pack.rows.length === 0) {
      await page.waitForTimeout(800);
      const retryPack = await readProjectRows(page);
      if (retryPack.rows.length > 0) {
        pack.rows = retryPack.rows;
        pack.rawScanned = retryPack.rawScanned;
        pack.skippedNoProjectId = retryPack.skippedNoProjectId;
        pack.linkPatternSummary = retryPack.linkPatternSummary;
      }
    }
    if (i === 0) linkPatternSummary = pack.linkPatternSummary;
    skippedNoProjectIdTotal += pack.skippedNoProjectId;
    rawRowsScanned += pack.rawScanned;
    validRowsWithProjectId += pack.rows.length;

    const idsOnPage = pack.rows.map((r) => r.projectID);
    const sig = rowSignatureFromIds(idsOnPage);

    if (i > 0 && sig === lastSignature && idsOnPage.length > 0) {
      console.log("[PGC] Pagination — same row signature as previous page; stopping.");
      break;
    }
    lastSignature = sig;

    let newOnThisPage = 0;
    for (const row of pack.rows) {
      const id = row.projectID;
      if (uniqueById.has(id)) {
        duplicateRowsSkipped++;
        continue;
      }
      const { _linkSource, ...clean } = row;
      uniqueById.set(id, clean);
      newOnThisPage++;
    }
    const foundTarget = targetPermit
      ? pack.rows.some(
          (r) =>
            normalizeText(r.projectNumber).toLowerCase() ===
            targetPermit.toLowerCase(),
        )
      : false;
    if (foundTarget) {
      console.log(`[PGC] Found target permit on page ${pageNum}`);
      break;
    }

    if (i > 0 && newOnThisPage === 0) {
      console.log("[PGC] Pagination — no new project IDs on this page; stopping.");
      break;
    }

    let canPaginate =
      paginationMode === "next_button" ||
      paginationMode === "numbered_pages" ||
      paginationMode === "unknown";

    if (!canPaginate || paginationMode === "single_page") break;

    const preferNum = paginationMode === "numbered_pages";
    const advanced = await goToNextPage(page, preferNum);
    if (advanced) {
      console.log(
        `[PGC] Target not found on page ${pageNum}, moving to page ${pageNum + 1}`,
      );
    }
    if (paginationMode === "unknown" && advanced) paginationMode = "next_button";

    if (!advanced) {
      if (paginationMode === "numbered_pages" && i === 0) {
        console.log(
          "[PGC] Pagination — numbered mode detected but could not advance; stopping.",
        );
      }
      break;
    }
    pagesVisited++;
    if (pagesVisited >= MAX_PAGER_PAGES) {
      console.log("[PGC] Pagination — max pages reached:", MAX_PAGER_PAGES);
      break;
    }
  }

  const projects = Array.from(uniqueById.values());
  const targetFound = targetPermit
    ? projects.some(
        (p) =>
          normalizeText(p.projectNumber).toLowerCase() ===
          targetPermit.toLowerCase(),
      )
    : false;
  return {
    projects,
    paginationMode,
    pagesVisited,
    viewAllClicked,
    rawRowsScanned,
    validRowsWithProjectId,
    uniqueProjectCount: projects.length,
    skippedNoProjectId: skippedNoProjectIdTotal,
    duplicateRowsSkipped,
    linkPatternSummary,
    targetFound,
  };
}

// ─── Task 4: PGC Project/Index URLs (verified) ─────────────────────────────

/**
 * @param {string} projectID
 * @param {string} tabName e.g. projectStatusTab, infoTab, tasksTab, correctionsTab
 * @param {string} [extraParams]
 */
function buildPgcTabUrl(projectID, tabName, extraParams = "") {
  const base = `${PGC_PROJECT_UI_INDEX}?tab=${encodeURIComponent(tabName)}&ProjectID=${encodeURIComponent(String(projectID))}`;
  return extraParams ? `${base}&${extraParams}` : base;
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function resolvePgcWebUiBases(page) {
  /** @type {string[]} */
  const out = [];
  const env = process.env.PGC_WEBUI_BASE?.trim();
  if (env) out.push(env.replace(/\/$/, ""));
  out.push("https://eplans.princegeorgescountymd.gov/ProjectDoxWebUI");
  let portalOrigin = "";
  try {
    portalOrigin = new URL(page.url()).origin;
  } catch (_) {}
  if (portalOrigin) out.push(portalOrigin.replace(/\/$/, ""));
  return [...new Set(out.filter(Boolean))];
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectId
 * @param {string} tabName
 * @param {string} [extraParams]
 */
async function gotoPgcProjectTab(page, projectId, tabName, extraParams = "") {
  /**
   * Wait for tab-specific hydrated content (not just shell/chrome).
   * @param {string} t
   */
  const waitForHydratedTabContent = async (t) => {
    /** @type {string[]} */
    let selectors = [];
    if (t === "infoTab") {
      selectors = ["table tr", "dt", "dd"];
    } else if (t === "projectStatusTab") {
      selectors = [
        "#projectStatusTab table",
        "#projectStatusTab table tr",
        "#projectStatusTab dl",
        "#projectStatusTab .ui-iggrid-table tbody tr",
      ];
    } else if (t === "tasksTab") {
      selectors = [".ui-iggrid-table tbody tr", "table tbody tr"];
    } else if (t === "filesTab") {
      selectors = [
        "#folderTree li.ui-igtree-node",
        ".ui-iggrid-table",
        ".ui-iggrid",
      ];
    } else if (t === "correctionsTab") {
      selectors = [
        "#correctionsTab",
        "#correctionsTab select",
        "#correctionsTab .ui-iggrid-table tbody tr",
        "#correctionsTab table tbody tr",
        "#correctionsTab label",
      ];
    } else {
      return true;
    }
    const timeout = 12000;
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout });
        return true;
      } catch (_) {}
    }
    await page.waitForTimeout(800);
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout });
        return true;
      } catch (_) {}
    }
    return false;
  };

  const url = buildPgcTabUrl(projectId, tabName, extraParams);
  /** @type {string[]} */
  const errors = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const u = page.url();
    if (/\/login/i.test(u) || /sessionended|session\s*end/i.test(u)) {
      errors.push("login/session after Project/Index navigation");
      return { ok: false, url: u, errors, triedUrl: url, baseUsed: PGC_PROJECT_UI_INDEX };
    }
    await page
      .waitForSelector(
        'body, table, .ui-iggrid, [role="tablist"], iframe, main, [class*="project"]',
        { timeout: 25000 },
      )
      .catch(() => {});
    const hydrated = await waitForHydratedTabContent(tabName);
    if (!hydrated) {
      errors.push(`tab content not hydrated for ${tabName}`);
    }
    return {
      ok: hydrated,
      url: u,
      baseUsed: PGC_PROJECT_UI_INDEX,
      triedUrl: url,
      errors,
    };
  } catch (e) {
    errors.push((e && e.message) || String(e));
    return { ok: false, url: page.url(), errors, triedUrl: url, baseUsed: null };
  }
}

/** Legacy multi-base Frame.aspx navigation — unused for PGC Project/Index. */
async function gotoProjectTab(page, bases, projectId, tabParam) {
  return gotoPgcProjectTab(page, projectId, tabParam, "");
}

/**
 * @param {import('playwright').Page} page
 * @returns {import('playwright').Page | import('playwright').Frame}
 */
async function getContentTarget(page) {
  await page.waitForTimeout(200);
  const frames = page.frames();
  for (const f of frames) {
    try {
      const u = f.url();
      if (/Project\/Index/i.test(u) && f !== page.mainFrame()) return f;
    } catch (_) {}
  }
  const byMatch = page.frames().filter((f) => /Frame\.aspx/i.test(f.url()));
  if (byMatch.length) return byMatch[byMatch.length - 1];
  return page;
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function extractLabelValuePairs(target) {
  return target.evaluate(() => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st) return false;
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity || "1") === 0
      ) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function collectPairsFromTable(tableEl) {
      /** @type {{ label: string, value: string }[]} */
      const rows = [];
      tableEl.querySelectorAll("tr").forEach((tr) => {
        if (!isVisible(tr)) return;
        const cells = tr.querySelectorAll("td, th");
        if (cells.length < 2) return;
        const label = norm(cells[0].textContent).replace(/:\s*$/, "");
        const value = norm(cells[1].textContent);
        if (label && value && label.length < 200 && value.length < 2000) {
          rows.push({ label, value });
        }
      });
      return rows;
    }
    /** @type {{ label: string, value: string }[]} */
    const pairs = [];
    const visibleTables = Array.from(document.querySelectorAll("table")).filter((t) =>
      isVisible(t),
    );
    let best = [];
    for (const t of visibleTables) {
      const got = collectPairsFromTable(t);
      if (got.length > best.length) best = got;
    }
    if (best.length) pairs.push(...best);
    else {
      document.querySelectorAll("table tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td, th");
        if (cells.length < 2) return;
        const label = norm(cells[0].textContent).replace(/:\s*$/, "");
        const value = norm(cells[1].textContent);
        if (label && value && label.length < 200 && value.length < 2000) {
          pairs.push({ label, value });
        }
      });
    }
    document.querySelectorAll("dt").forEach((dt) => {
      let dd = dt.nextElementSibling;
      if (dd && dd.tagName.toLowerCase() !== "dd") {
        const sib = dd.querySelector && dd.querySelector("dd");
        if (sib) dd = sib;
      }
      if (dd && dd.tagName && dd.tagName.toLowerCase() === "dd") {
        pairs.push({
          label: norm(dt.textContent).replace(/:\s*$/, ""),
          value: norm(dd.textContent),
        });
      }
    });
    return pairs;
  });
}

/**
 * Preserve visible 2-column info table rows (including blank values).
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function extractInfoTableRows(target) {
  return target.evaluate(() => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st) return false;
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const tables = Array.from(document.querySelectorAll("table")).filter((t) =>
      isVisible(t),
    );
    let bestRows = [];
    for (const t of tables) {
      const rows = [];
      t.querySelectorAll("tr").forEach((tr) => {
        if (!isVisible(tr)) return;
        const cells = tr.querySelectorAll("th, td");
        if (cells.length < 2) return;
        const label = norm(cells[0].textContent).replace(/:\s*$/, "");
        const value = norm(cells[1].textContent);
        if (!label) return;
        rows.push({ label, value });
      });
      if (rows.length > bestRows.length) bestRows = rows;
    }
    return {
      rows: bestRows,
      table: {
        headers: ["Field", "Value"],
        rows: bestRows.map((r) => ({ Field: r.label, Value: r.value || "" })),
      },
    };
  });
}

function cleanDateish(/** @type {string|null} */ s) {
  if (s == null || s === "") return null;
  const t = normalizeText(s);
  const m = t.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (m) return m[1];
  const m2 = t.match(/(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  return t || null;
}

/**
 * @param {{ label: string, value: string }[]} pairs
 */
function mapInfoSchema(pairs) {
  const labels = pairs.map((p) => `${p.label}`.toLowerCase());
  const valFor = (/** @type {RegExp} */ re) => {
    const i = pairs.findIndex((p) => re.test(p.label));
    return i >= 0 ? pairs[i].value : null;
  };

  const projectNumber =
    valFor(/project\s*(#|number|no\.?)\b/i) ||
    valFor(/^permit\b/i) ||
    valFor(/record\s*#/i);
  const caseName =
    valFor(/case\s*name/i) ||
    valFor(/project\s*name/i) ||
    valFor(/^name$/i);
  const loc =
    valFor(/location/i) ||
    valFor(/site\s*address/i) ||
    valFor(/address/i);
  const caseType =
    valFor(/case\s*type/i) ||
    valFor(/permit\s*type/i) ||
    valFor(/^type$/i);
  const contactEmail =
    valFor(/e-?mail/i) ||
    valFor(/contact.*e-?mail/i);
  const status = valFor(/^status$/i) || valFor(/\bstatus\b/i);
  const startRaw =
    valFor(/project\s*start/i) ||
    valFor(/\bstart\s*date\b/i) ||
    valFor(/^start$/i);
  const endRaw =
    valFor(/project\s*end/i) ||
    valFor(/\bend\s*date\b/i) ||
    valFor(/anticipated\s*completion/i) ||
    valFor(/^end$/i);

  return {
    projectNumber: projectNumber ? normalizeText(projectNumber) : null,
    caseName: caseName ? normalizeText(caseName) : null,
    location: loc ? normalizeText(loc) : null,
    caseType: caseType ? normalizeText(caseType) : null,
    contactEmail: contactEmail ? normalizeText(contactEmail) : null,
    status: status ? normalizeText(status) : null,
    projectStart: cleanDateish(startRaw),
    projectEnd: cleanDateish(endRaw),
    _labelMatchCount: pairs.length,
    _labelsSample: labels.slice(0, 12),
  };
}

// ─── PGC Info tab — safe surface checks + guarded extraction (PGC only) ─────

/**
 * @param {import('playwright').Page | import('playwright').Frame} p
 */
async function safeUrl(p) {
  try {
    return p.url() || "";
  } catch {
    return "";
  }
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} p
 */
async function safeTitle(p) {
  try {
    return ((await p.title()) || "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} p
 */
async function safeBodyText(p) {
  try {
    return await p.evaluate(
      () => (document.body && document.body.innerText) || "",
    );
  } catch {
    return "";
  }
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} p
 * @param {string[]} selectors
 * @returns {Promise<string[]>}
 */
async function getVisibleTexts(p, selectors) {
  try {
    return await p.evaluate((sels) => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      /** @type {string[]} */
      const out = [];
      for (const sel of sels) {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (!(el instanceof Element)) return;
            const st = window.getComputedStyle(el);
            if (!st || st.display === "none" || st.visibility === "hidden")
              return;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return;
            const t = norm(el.textContent);
            if (t) out.push(t.slice(0, 400));
          });
        } catch {
          /* skip bad selector */
        }
      }
      return out;
    }, selectors);
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, unknown>} obj
 */
function looksLikeTaskData(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  if (keys.some((k) => /^(action|assignee|task|workflow)$/.test(k)))
    return true;
  const pool = JSON.stringify(obj).toLowerCase();
  const needles = [
    '"action"',
    "accept",
    "complete",
    "workflow",
    "task",
    "assigned",
    "department review",
    "routing slip",
    "task name",
  ];
  return needles.some((n) => pool.includes(n));
}

/**
 * @param {Record<string, unknown>} obj
 */
function isValidProjectInfoShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = [
    "permit_number",
    "project_number",
    "project_id",
    "project_name",
    "address",
    "status",
  ];
  let n = 0;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) n += 1;
  }
  return n >= 2;
}

/**
 * @param {{ label: string, value: string }[]} pairs
 * @returns {Record<string, string>}
 */
function parseInfoKeyValues(pairs) {
  /** @type {Record<string, string>} */
  const out = {};
  const rules = [
    [/permit\s*#?|permit\s*number/i, "permit_number"],
    [/project\s*#|project\s*number/i, "project_number"],
    [/project\s*id/i, "project_id"],
    [/project\s*name|case\s*name/i, "project_name"],
    [/^status$|application\s*status/i, "status"],
    [/address|location|site/i, "address"],
    [/applicant/i, "applicant"],
    [/owner/i, "owner"],
    [/description/i, "description"],
  ];
  for (const { label, value } of pairs) {
    const L = String(label || "").trim();
    const V = String(value || "").trim();
    if (!L) continue;
    for (const [re, key] of rules) {
      if (re.test(L)) {
        if (V && !out[key]) out[key] = V;
        break;
      }
    }
  }
  return out;
}

/**
 * @param {{ label: string, value: string }[]} pairs
 */
function looksLikeTaskDataFromPairs(pairs) {
  const blob = pairs
    .map((p) => `${p.label} ${p.value}`)
    .join(" ")
    .toLowerCase();
  return /\baction\b.*\b(accept|complete)\b|\bassignee\b|\btask\s*name\b|\brouting\s*slip\b|\bdepartment\s*review\b/i.test(
    blob,
  );
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {{ projectID?: string, projectNumber?: string }} project
 */
async function inspectProjectDetailSurface(target, project) {
  const url = await safeUrl(target);
  const title = await safeTitle(target);
  const body = await safeBodyText(target);
  const bodyNorm = body.replace(/\u00a0/g, " ");
  const bodyLower = bodyNorm.toLowerCase();
  const onSsoBridge = /\/Portal\/login\/sso/i.test(url);
  const permit = normalizeText(project.projectNumber || "");
  const pid = String(project.projectID || "").trim();
  const hasPermit =
    !!permit && bodyLower.includes(permit.toLowerCase());
  const hasProjectId = !!pid && bodyNorm.includes(pid);

  const tabPhrases = [
    "Project Information",
    "Project Info",
    "Project Status",
    "Files",
    "Reports",
    "Workflow",
    "Tasks",
  ];
  const tabHints = tabPhrases.filter((p) => bodyNorm.includes(p));

  const infoLabels = [
    "Permit Number",
    "Project Number",
    "Project Name",
    "Status",
    "Address",
    "Applicant",
    "Owner",
  ];
  const infoLabelHints = infoLabels.filter((p) => bodyNorm.includes(p));

  const ok =
    !onSsoBridge &&
    (hasPermit ||
      hasProjectId ||
      tabHints.length >= 2 ||
      infoLabelHints.length >= 2);

  return {
    url,
    title,
    onSsoBridge,
    hasPermit,
    hasProjectId,
    tabHints,
    infoLabelHints,
    ok,
  };
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {string} [label]
 */
async function logInfoContextSnapshot(target, label = "BeforeInfoExtract") {
  const url = await safeUrl(target);
  const title = await safeTitle(target);
  const body = await safeBodyText(target);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);
  pgcProgress.pgcLogDetail(`info_context_snapshot:${label}`, {
    label,
    url,
    title,
    bodyLinesSample: lines,
  });
  console.log(
    `[PGC] Info context snapshot [${label}] → pgc-debug-detail.log`,
  );
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function collectPgcInfoTableCandidates(target) {
  return target
    .evaluate(() => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      function isVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (!st || st.display === "none" || st.visibility === "hidden")
          return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      const infoLabelRe =
        /permit\s*#|permit\s*number|project\s*#|project\s*number|project\s*name|project\s*id|^status$|address|applicant|owner|description|location|site\s*address/i;
      const tables = Array.from(document.querySelectorAll("table")).filter(
        isVisible,
      );
      /** @type {{ tableIndex: number, infoLabelHits: number, pairs: { label: string, value: string }[], describe: string }[]} */
      const out = [];
      tables.forEach((table, tableIndex) => {
        /** @type {{ label: string, value: string }[]} */
        const pairs = [];
        let infoLabelHits = 0;
        let taskyHeader = false;
        table.querySelectorAll("tr").forEach((tr) => {
          if (!isVisible(tr)) return;
          const cells = tr.querySelectorAll("td, th");
          if (cells.length < 2) return;
          const label = norm(cells[0].textContent).replace(/:\s*$/, "");
          const value = norm(cells[1].textContent);
          const ll = label.toLowerCase();
          if (/^action$/i.test(label) || /^assignee$/i.test(label))
            taskyHeader = true;
          if (infoLabelRe.test(label)) infoLabelHits += 1;
          if (label && label.length < 200)
            pairs.push({ label, value: value || "" });
        });
        const ttext = norm(table.textContent).toLowerCase();
        if (taskyHeader && infoLabelHits < 2) return;
        if (/\baction\b/.test(ttext) && /\baccept\b/.test(ttext) && infoLabelHits < 2)
          return;
        if (infoLabelHits === 0 && pairs.length < 4) return;
        out.push({
          tableIndex,
          infoLabelHits,
          pairs,
          describe: `table[index=${tableIndex}] infoLabelHits=${infoLabelHits}`,
        });
      });
      out.sort((a, b) => b.infoLabelHits - a.infoLabelHits);
      return out;
    })
    .catch(() => []);
}

/**
 * Guarded Info extraction for PGC project detail / Project Info surfaces only.
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {{ projectID?: string, projectNumber?: string }} project
 * @param {Awaited<ReturnType<typeof inspectProjectDetailSurface>>} surface
 */
async function extractPgcProjectInfoGuarded(target, project, surface) {
  /** @type {{ selector: string, reason: string, preview: string }[]} */
  const rejected = [];

  if (!surface.ok) {
    return {
      info: null,
      info_debug: {
        reason: "invalid_detail_surface",
        surface,
        rejected,
      },
    };
  }

  const candidates = await collectPgcInfoTableCandidates(target);
  if (!candidates.length) {
    return {
      info: null,
      info_debug: {
        reason: "no_info_table_candidates",
        surface,
        rejected,
      },
    };
  }

  for (const cand of candidates) {
    const parsed = parseInfoKeyValues(cand.pairs);
    const preview = JSON.stringify(parsed).slice(0, 220);
    if (
      looksLikeTaskData(parsed) ||
      looksLikeTaskDataFromPairs(cand.pairs)
    ) {
      rejected.push({
        selector: cand.describe,
        reason: "task_like",
        preview,
      });
      console.warn(
        "[PGC] Info candidate rejected (task-like):",
        cand.describe,
        preview,
      );
      continue;
    }
    if (!isValidProjectInfoShape(parsed)) {
      rejected.push({
        selector: cand.describe,
        reason: "invalid_info_shape",
        preview,
      });
      console.warn(
        "[PGC] Info candidate rejected (shape):",
        cand.describe,
        preview,
      );
      continue;
    }

    const nonEmptyPairs = cand.pairs.filter((p) => p.label && p.value);
    const info = {
      ...mapInfoSchema(cand.pairs),
      projectInfo: cand.pairs.map((p) => ({
        key: p.label,
        value: p.value || "",
      })),
      keyValues: cand.pairs.map((p) => ({
        key: p.label,
        value: p.value || "",
      })),
      tables: [
        {
          headers: ["Field", "Value"],
          rows: cand.pairs.map((p) => ({
            Field: p.label,
            Value: p.value || "",
          })),
        },
      ],
      _nonEmptyPairsCount: nonEmptyPairs.length,
      _pgcParsedInfo: parsed,
      _pgcInfoGuarded: true,
    };

    return {
      info,
      info_debug: {
        ok: true,
        surface,
        accepted: cand.describe,
        rejected,
      },
    };
  }

  return {
    info: null,
    info_debug: {
      reason: "no_candidate_passed_validation",
      surface,
      rejected,
    },
  };
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {{ projectID?: string, projectNumber?: string }} project
 */
async function extractProjectInfo(target, project) {
  const surface = await inspectProjectDetailSurface(target, project);
  pgcProgress.pgcLogDetail("project_info_surface_check", { project, surface });
  console.log(
    `[PGC] Info detail surface | ok:${surface.ok} → detail:pgc-debug-detail.log`,
  );
  if (!surface.ok) {
    return {
      info: null,
      info_debug: { reason: "invalid_detail_surface", surface },
    };
  }
  return extractPgcProjectInfoGuarded(target, project, surface);
}

/**
 * PGC ProjectDox Status tab: scrape `#projectStatusTab` in document order (AJAX-loaded panel).
 * Returns ordered `sections` plus legacy `keyValues` / `tables` for older clients.
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function extractStatusTabData(target) {
  return target.evaluate(() => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st) return false;
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity || "1") === 0
      ) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    /** @param {Element} el */
    function isEmphasized(el) {
      try {
        const st = window.getComputedStyle(el);
        const color = (st.color || "").toLowerCase();
        if (/rgb\(255,\s*0,\s*0\)|rgb\(200,\s*0,\s*0\)|rgb\(192,\s*0,\s*0\)|rgb\(220,\s*20,\s*60\)|#f00|#ff0000|#c00|#e00|red/.test(color)) {
          return true;
        }
        const cls = (el.className && String(el.className).toLowerCase()) || "";
        if (
          /(\bred\b|\berror\b|\bwarning\b|\bdanger\b|\brequired\b|\binvalid\b)/.test(
            cls,
          )
        ) {
          return true;
        }
        const inline = ((el.getAttribute("style") || "") + "").toLowerCase();
        if (/color\s*:\s*red|color\s*:\s*#f00|color\s*:\s*rgb\(255/.test(inline)) {
          return true;
        }
      } catch (_) {}
      return false;
    }
    /**
     * @param {Node} node
     * @returns {{ type: 'text', value: string } | { type: 'link', text: string, href: string, target?: string }[]}
     */
    function serializeInline(node) {
      /** @type {{ type: 'text', value: string } | { type: 'link', text: string, href: string, target?: string }} */
      const out = [];
      function flushText(buf) {
        const t = norm(buf.join(""));
        if (t) out.push({ type: "text", value: t });
      }
      let textBuf = [];
      function walk(n) {
        if (n.nodeType === 3) {
          textBuf.push(n.textContent || "");
          return;
        }
        if (n.nodeType !== 1) return;
        const el = /** @type {Element} */ (n);
        const tag = el.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") return;
        if (tag === "br") {
          flushText(textBuf);
          textBuf = [];
          out.push({ type: "text", value: "\n" });
          return;
        }
        if (tag === "a") {
          const hrefRaw = el.getAttribute("href");
          const hrefTrim = hrefRaw != null ? String(hrefRaw).trim() : "";
          const onclk = (el.getAttribute("onclick") || "").trim();
          const target = el.getAttribute("target") || undefined;
          const linkText = norm(el.textContent) || hrefTrim || "link";
          const hrefUsable =
            hrefTrim &&
            hrefTrim !== "#" &&
            !/^javascript:\s*void\s*\(\s*0\s*\)\s*;?\s*$/i.test(hrefTrim);
          if (hrefUsable) {
            flushText(textBuf);
            textBuf = [];
            out.push({
              type: "link",
              text: linkText || hrefTrim,
              href: hrefTrim,
              target,
              ...(onclk ? { onclick: onclk } : {}),
            });
            return;
          }
          if (onclk) {
            flushText(textBuf);
            textBuf = [];
            out.push({
              type: "link",
              text: linkText,
              href: hrefTrim || "",
              target,
              onclick: onclk,
            });
            return;
          }
        }
        for (const c of el.childNodes) walk(c);
      }
      walk(node);
      flushText(textBuf);
      return out;
    }
    function segmentsToPlain(segs) {
      return segs.map((s) => (s.type === "link" ? s.text : s.value)).join("");
    }
    /** @param {{ type: string }[]} segs */
    function collectLinksFromSegments(segs, acc) {
      for (const s of segs) {
        if (s.type === "link" && (s.href || s.onclick))
          acc.push({
            text: s.text,
            href: s.href || "",
            target: s.target,
            ...(s.onclick ? { onclick: s.onclick } : {}),
          });
      }
    }
    /**
     * @param {HTMLTableElement} table
     */
    function extractTableSection(table) {
      if (!isVisible(table)) return null;
      const captionEl = table.querySelector("caption");
      const title = captionEl ? norm(captionEl.textContent) : undefined;
      /** @type {string[]} */
      let headers = [];
      const thead = table.querySelector("thead");
      if (thead) {
        const hRow = thead.querySelector("tr");
        if (hRow && isVisible(hRow)) {
          headers = Array.from(hRow.querySelectorAll("th, td"))
            .filter(isVisible)
            .map((c) => norm(c.textContent));
        }
      }
      if (!headers.length && table.closest) {
        const gridRoot = table.closest(".ui-iggrid, .ui-widget");
        const headTable =
          gridRoot &&
          gridRoot.querySelector &&
          gridRoot.querySelector(".ui-iggrid-headertable");
        if (headTable) {
          const hRow =
            headTable.querySelector("tr[data-header-row]") ||
            headTable.querySelector("thead tr") ||
            headTable.querySelector("tr");
          if (hRow && isVisible(hRow)) {
            headers = Array.from(hRow.querySelectorAll("th, td"))
              .filter((c) => isVisible(c) && c.getAttribute("data-skip") !== "true")
              .map((c) => norm(c.textContent))
              .filter(Boolean);
          }
        }
      }
      let trList = Array.from(table.querySelectorAll("tbody tr"));
      if (!trList.length) {
        trList = Array.from(table.querySelectorAll("tr")).filter(
          (tr) => !tr.closest("thead"),
        );
      }
      trList = trList.filter(
        (tr) =>
          isVisible(tr) &&
          !tr.classList.contains("ui-iggrid-filterrow") &&
          tr.getAttribute("data-role") !== "filterrow",
      );
      /** @type {{ text: string, segments: object[], emphasized: boolean }[][]} */
      const dataRows = [];
      for (const tr of trList) {
        let cells = Array.from(tr.querySelectorAll("th, td")).filter(isVisible);
        if (cells.length > 1) {
          cells = cells.filter(
            (c) =>
              !c.classList.contains("ui-iggrid-rowselector-class") &&
              c.getAttribute("data-role") !== "rs",
          );
        }
        if (cells.length < 1) continue;
        const cellPayloads = cells.map((cell) => {
          const segments = serializeInline(cell);
          return {
            text: norm(cell.innerText || cell.textContent || ""),
            segments,
            emphasized: isEmphasized(cell),
          };
        });
        dataRows.push(cellPayloads);
      }
      if (!headers.length && dataRows.length) {
        const first = dataRows[0];
        const firstText = first.map((c) => c.text);
        const looksHeader =
          dataRows.length >= 2 &&
          first.every((c) => c.text.length < 120) &&
          firstText.some(Boolean);
        if (looksHeader) {
          headers = firstText.map((t, i) => t || `Column ${i + 1}`);
          dataRows.shift();
        } else {
          const n = first.length;
          headers = Array.from({ length: n }, (_, i) => `Column ${i + 1}`);
        }
      } else if (headers.length && dataRows.length) {
        const n = Math.max(headers.length, ...dataRows.map((r) => r.length));
        while (headers.length < n) {
          headers.push(`Column ${headers.length + 1}`);
        }
      }
      if (!dataRows.length) return null;
      const rowsText = dataRows.map((cells) => {
        const o = {};
        headers.forEach((h, i) => {
          const c = cells[i];
          o[h] = c ? c.text : "";
        });
        return o;
      });
      return {
        type: "table",
        title,
        headers,
        rows: rowsText,
        rowCells: dataRows,
        classHint: table.className || undefined,
      };
    }
    /**
     * @param {HTMLDListElement} dl
     */
    function extractDlSection(dl) {
      if (!isVisible(dl)) return null;
      /** @type {{ key: string, valueText: string, segments: object[], emphasized?: boolean }[]} */
      const items = [];
      const dts = Array.from(dl.querySelectorAll(":scope > dt")).filter(isVisible);
      for (const dt of dts) {
        const key = norm(dt.textContent).replace(/:\s*$/, "");
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName && dd.tagName.toLowerCase() !== "dd") {
          dd = dd.nextElementSibling;
        }
        if (!dd || !isVisible(dd)) continue;
        const segments = serializeInline(dd);
        const valueText = segmentsToPlain(segments) || norm(dd.innerText || "");
        if (!key && !valueText) continue;
        items.push({
          key,
          valueText,
          segments,
          emphasized: isEmphasized(dd),
        });
      }
      if (!items.length) return null;
      return {
        type: "kv_list",
        items,
        classHint: dl.className || undefined,
      };
    }
    /**
     * @param {HTMLUListElement | HTMLOListElement} list
     */
    function extractListSection(list) {
      if (!isVisible(list)) return null;
      const items = [];
      for (const li of list.querySelectorAll(":scope > li")) {
        if (!isVisible(li)) continue;
        const segments = serializeInline(li);
        const text = segmentsToPlain(segments) || norm(li.innerText || "");
        if (!text) continue;
        items.push({
          text,
          segments,
          emphasized: isEmphasized(li),
        });
      }
      if (!items.length) return null;
      return {
        type: "task_list",
        items,
        classHint: list.className || undefined,
      };
    }
    /**
     * @param {HTMLElement} div
     */
    function extractDivGridSection(div) {
      if (!isVisible(div)) return null;
      const rows = Array.from(div.querySelectorAll(":scope > .row")).filter(isVisible);
      if (rows.length < 1) return null;
      /** @type {{ text: string, segments: object[], emphasized: boolean }[][]} */
      const dataRows = [];
      for (const row of rows) {
        const cells = Array.from(
          row.querySelectorAll(":scope > .cell, :scope > div"),
        ).filter(isVisible);
        if (cells.length < 2) continue;
        dataRows.push(
          cells.map((cell) => ({
            text: norm(cell.innerText || cell.textContent || ""),
            segments: serializeInline(cell),
            emphasized: isEmphasized(cell),
          })),
        );
      }
      if (!dataRows.length) return null;
      const n = Math.max(...dataRows.map((r) => r.length));
      const headers = Array.from({ length: n }, (_, i) => `Column ${i + 1}`);
      const rowsText = dataRows.map((cells) => {
        const o = {};
        headers.forEach((h, i) => {
          o[h] = cells[i] ? cells[i].text : "";
        });
        return o;
      });
      return {
        type: "table",
        title: undefined,
        headers,
        rows: rowsText,
        rowCells: dataRows,
        classHint: (div.className || "") + " div.table-grid",
      };
    }
    /**
     * True if host has any visible table / dl / ul / ol (any depth), excluding script islands.
     * @param {HTMLElement} host
     */
    function subtreeHasVisibleStructured(host) {
      if (!host || !(host instanceof Element)) return false;
      for (const el of host.querySelectorAll("table, dl, ul, ol")) {
        if (el.closest("script, style, noscript")) continue;
        if (isVisible(el)) return true;
      }
      return false;
    }
    /**
     * Visible ProjectDox-style div.table with at least one .row (any depth under host).
     * @param {HTMLElement} host
     */
    function subtreeHasVisibleDivTable(host) {
      if (!host || !(host instanceof Element)) return false;
      for (const d of host.querySelectorAll("div.table")) {
        if (!isVisible(d)) continue;
        const row = d.querySelector(":scope > .row");
        if (row && isVisible(row)) return true;
      }
      return false;
    }
    /**
     * @param {HTMLElement} rootPanel
     */
    function walkPanel(rootPanel) {
      /** @type {object[]} */
      const sections = [];
      function recurse(container) {
        for (const child of Array.from(container.children)) {
          if (!(child instanceof HTMLElement)) continue;
          if (!isVisible(child)) continue;
          const tag = child.tagName.toLowerCase();
          if (tag === "script" || tag === "style" || tag === "noscript") continue;
          if (tag === "table") {
            const sec = extractTableSection(child);
            if (sec) sections.push(sec);
            continue;
          }
          if (tag === "dl") {
            const sec = extractDlSection(child);
            if (sec) sections.push(sec);
            continue;
          }
          if (tag === "ul" || tag === "ol") {
            const sec = extractListSection(child);
            if (sec) sections.push(sec);
            continue;
          }
          if (tag === "hr") {
            sections.push({ type: "divider" });
            continue;
          }
          if (/^h[1-6]$/.test(tag)) {
            const t = norm(child.textContent);
            if (t)
              sections.push({
                type: "text_block",
                title: t,
                classHint: child.className || undefined,
              });
            continue;
          }
          if (tag === "p" || tag === "blockquote") {
            const segments = serializeInline(child);
            if (segments.length)
              sections.push({
                type: "text_block",
                segments,
                classHint: child.className || undefined,
              });
            continue;
          }
          if (
            tag === "div" &&
            child.classList &&
            child.classList.contains("table")
          ) {
            const g = extractDivGridSection(child);
            if (g) {
              sections.push(g);
              continue;
            }
          }
          if (tag === "div" || tag === "section" || tag === "article") {
            if (
              subtreeHasVisibleStructured(child) ||
              subtreeHasVisibleDivTable(child)
            ) {
              recurse(child);
              continue;
            }
            const segments = serializeInline(child);
            const plain = segmentsToPlain(segments);
            if (plain.length > 0) {
              const onlyLinks =
                segments.length > 0 &&
                segments.every((s) => s.type === "link");
              if (onlyLinks && segments.length) {
                /** @type {{ text: string, href: string, target?: string, onclick?: string }[]} */
                const links = [];
                for (const s of segments) {
                  if (s.type === "link" && (s.href || s.onclick))
                    links.push({
                      text: s.text,
                      href: s.href || "",
                      target: s.target,
                      ...(s.onclick ? { onclick: s.onclick } : {}),
                    });
                }
                if (links.length)
                  sections.push({
                    type: "links",
                    links,
                    classHint: child.className || undefined,
                  });
              } else {
                sections.push({
                  type: "text_block",
                  segments,
                  classHint: child.className || undefined,
                });
              }
            } else {
              recurse(child);
            }
            continue;
          }
          if (tag === "a") {
            const hrefRaw = child.getAttribute("href");
            const hrefTrim = hrefRaw != null ? String(hrefRaw).trim() : "";
            const onclk = (child.getAttribute("onclick") || "").trim();
            const hrefUsable =
              hrefTrim &&
              hrefTrim !== "#" &&
              !/^javascript:\s*void\s*\(\s*0\s*\)\s*;?\s*$/i.test(hrefTrim);
            if (hrefUsable || onclk) {
              sections.push({
                type: "links",
                links: [
                  {
                    text: norm(child.textContent) || hrefTrim || "link",
                    href: hrefUsable ? hrefTrim : "",
                    target: child.getAttribute("target") || undefined,
                    ...(onclk ? { onclick: onclk } : {}),
                  },
                ],
              });
            }
          }
        }
      }
      recurse(rootPanel);
      return sections;
    }
    const panel =
      document.querySelector("#projectStatusTab") ||
      document.querySelector('[id="projectStatusTab"]');
    /** @type {HTMLElement | null} */
    let root = panel instanceof HTMLElement ? panel : null;
    let rootSelector = "#projectStatusTab";
    if (!root || !norm(root.innerText || "")) {
      const selectors = [
        "main",
        "#content",
        ".content",
        ".container",
        ".container-fluid",
        "body",
      ];
      root = null;
      rootSelector = "";
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement && isVisible(el)) {
          root = el;
          rootSelector = sel;
          break;
        }
      }
      if (!root) root = document.body;
    }
    const sections = root ? walkPanel(root) : [];
    /** @type {{ key: string, value: string }[]} */
    const keyValues = [];
    /** @type {{ headers: string[], rows: Record<string, string>[], title?: string }[]} */
    const tables = [];
    /** @type {{ text: string, href: string, target?: string }[]} */
    const flatLinks = [];
    const kvSeen = new Set();
    function addKv(key, value) {
      const k = norm(key).replace(/:\s*$/, "");
      const v = norm(value);
      if (!k) return;
      const sig = `${k.toLowerCase()}::${v.toLowerCase()}`;
      if (kvSeen.has(sig)) return;
      kvSeen.add(sig);
      keyValues.push({ key: k, value: v });
    }
    for (const sec of sections) {
      if (sec.type === "kv_list" && Array.isArray(sec.items)) {
        for (const it of sec.items) {
          addKv(it.key, it.valueText || "");
          collectLinksFromSegments(it.segments || [], flatLinks);
        }
      } else if (sec.type === "table") {
        tables.push({
          headers: sec.headers || [],
          rows: sec.rows || [],
          title: sec.title,
        });
        if (Array.isArray(sec.rowCells)) {
          for (const row of sec.rowCells) {
            for (const cell of row) {
              collectLinksFromSegments(cell.segments || [], flatLinks);
            }
          }
        }
      } else if (sec.type === "task_list" && Array.isArray(sec.items)) {
        for (const it of sec.items) {
          collectLinksFromSegments(it.segments || [], flatLinks);
        }
      } else if (sec.type === "text_block" && Array.isArray(sec.segments)) {
        collectLinksFromSegments(sec.segments, flatLinks);
      } else if (sec.type === "links" && Array.isArray(sec.links)) {
        for (const L of sec.links) {
          if (L.href)
            flatLinks.push({
              text: L.text || L.href,
              href: L.href,
              target: L.target,
            });
        }
      }
    }
    const blockText = (root && (root.innerText || "")) || "";
    return {
      sections,
      keyValues,
      tables,
      links: flatLinks,
      meta: {
        rootSelector,
        approach: "projectStatusTab-ordered-sections",
        panelFound: !!(panel && panel instanceof HTMLElement),
        sectionCount: sections.length,
        bodySnippet: norm(blockText).slice(0, 500),
      },
    };
  });
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function extractTasksTabData(target) {
  return target.evaluate(() => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }
    function pickFirstNonEmpty(arr) {
      for (const v of arr) {
        const t = norm(v);
        if (t) return t;
      }
      return "";
    }
    let workflowState = "";
    const hs = document.querySelectorAll(
      "h1, h2, .workflow-state, [class*='workflow'], [class*='WFlow']",
    );
    if (hs.length) {
      workflowState = norm(
        Array.from(hs)
          .map((h) => h.textContent)
          .join(" · ")
          .slice(0, 500),
      );
    }

    /** @type {object[]} */
    const tasks = [];
    /** @type {{ key: string, value: string }[]} */
    const workflowKeyValues = [];
    /** @type {Record<string, string>} */
    const workflowRecord = {};
    const seen = new Set();
    const seenWorkflowKv = new Set();
    const workflowLabelRe =
      /^(name|coordinator\s*group|state|integration\s*mode|version|started|completed)$/i;

    const addWorkflowKv = (key, value) => {
      const k = norm(key).replace(/:\s*$/, "");
      const v = norm(value);
      if (!k || !v) return;
      const sig = `${k.toLowerCase()}::${v.toLowerCase()}`;
      if (seenWorkflowKv.has(sig)) return;
      seenWorkflowKv.add(sig);
      workflowKeyValues.push({ key: k, value: v });
      if (!(k in workflowRecord)) workflowRecord[k] = v;
    };

    /** @type {{ headers: string[], rows: Record<string,string>[], title?: string }[]} */
    const tables = [];
    /** @type {Record<string, string>[]} */
    const workflowRows = [];
    /** @type {Record<string, string>[]} */
    const taskRows = [];
    const visibleTables = Array.from(
      document.querySelectorAll(".ui-iggrid-table, table"),
    );
    for (const table of visibleTables) {
      const headers = Array.from(
        table.querySelectorAll("thead th, tr:first-child th"),
      )
        .map((th) => norm(th.textContent))
        .filter(Boolean);
      let hdrs = headers.slice();
      const rows = [];
      table.querySelectorAll("tbody tr, tr").forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td"));
        if (cells.length < 2) return;
        const vals = cells.map((td) => norm(td.textContent));
        if (!hdrs.length) hdrs = vals.map((_, i) => `Col ${i + 1}`);
        const row = {};
        hdrs.forEach((h, i) => {
          row[h] = vals[i] ?? "";
        });
        rows.push(row);
      });
      if (!hdrs.length || !rows.length) continue;
      const hLine = hdrs.join(" ").toLowerCase();
      const isWorkflowTable =
        /(coordinator|integration mode|version|started|completed)/i.test(hLine) ||
        /(name|state)/i.test(hLine) && rows.length <= 10;
      const isTasksTable =
        /(action|task|project|group|status|priority|due|created|case type|description)/i.test(
          hLine,
        ) || rows.length > 10;
      if (isWorkflowTable) {
        tables.push({ headers: hdrs, rows, title: "Workflows" });
        workflowRows.push(...rows);
      } else if (isTasksTable) {
        tables.push({ headers: hdrs, rows, title: "Tasks" });
        taskRows.push(...rows);
      }
    }

    if (!taskRows.length) {
      const selectors = [".ui-iggrid-table tbody tr", "table tbody tr"];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((tr) => {
          const tds = tr.querySelectorAll("td");
          if (tds.length < 2) return;
          const texts = Array.from(tds).map((td) => norm(td.textContent));
          const first = texts[0] || "";
          const second = pickFirstNonEmpty(texts.slice(1));
          if (workflowLabelRe.test(first) && second) {
            addWorkflowKv(first, second);
            return;
          }
          const raw = norm(tr.innerText);
          if (raw.length < 3 || seen.has(raw)) return;
          seen.add(raw);
          tasks.push({
            taskName: first || null,
            assignee: texts[1] || null,
            state: texts[2] || null,
            dueDate: texts[3] || texts[texts.length - 1] || null,
            rawText: raw.slice(0, 800),
          });
        });
        if (tasks.length) break;
      }
    }

    // Fallback workflow key/value scrape for layouts outside task grid
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("th, td");
      if (cells.length < 2) return;
      const k = norm(cells[0].textContent).replace(/:\s*$/, "");
      const v = norm(cells[1].textContent);
      if (!workflowLabelRe.test(k) || !v) return;
      addWorkflowKv(k, v);
    });

    const workflows = workflowKeyValues.length ? [workflowRecord] : [];
    if (workflowRows.length && !workflows.length) workflows.push(workflowRows[0]);
    if (taskRows.length) {
      for (const r of taskRows) {
        tasks.push({
          taskName: r["Task"] || r["Action"] || r["Name"] || null,
          assignee: r["Group"] || r["Assignee"] || null,
          state: r["Status"] || r["State"] || null,
          dueDate: r["Due Date"] || r["Created"] || null,
          rawText: norm(Object.values(r).join(" ")).slice(0, 800),
        });
      }
    }

    return {
      workflowState: workflowState || null,
      tasks,
      workflows,
      workflowKeyValues,
      tables,
      _approach: "split task rows vs workflow key/value rows",
    };
  });
}

/**
 * @param {import('playwright').Page} page
 */
async function maybeClickProjectInfoSubtab(page) {
  for (const fr of page.frames()) {
    try {
      const loc = fr.locator("a:has-text('Project Info')").first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click({ timeout: 8000 }).catch(() => {});
        return "clicked Project Info in frame";
      }
    } catch (_) {}
  }
  try {
    const loc = page.locator("a:has-text('Project Info')").first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.click({ timeout: 8000 }).catch(() => {});
      return "clicked Project Info (top)";
    }
  } catch (_) {}
  return null;
}

function pgcRegexEscape(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * launchRemote opens /Portal/login/sso?url=… — Frame.aspx in the query is NOT yet project detail.
 * @param {string} url
 */
function pgcPopupUrlIsSsoBridge(url) {
  return !!url && /\/Portal\/login\/sso/i.test(String(url));
}

/**
 * PGC My Projects permit links use launchRemote → window.open('/Portal/login/sso?url=' + encodeURIComponent(href)),
 * then the popup completes SSO and lands on Frame.aspx / Project/Index with ProjectID.
 * @param {string} url
 * @param {string} projectId
 */
function pgcProjectDetailEntryUrlOk(url, projectId) {
  const pid = String(projectId || "").trim();
  if (!url || !pid) return false;
  if (pgcPopupUrlIsSsoBridge(url)) return false;
  const hasPid =
    url.includes(`ProjectID=${pid}`) ||
    url.includes(`ProjectID%3D${pid}`) ||
    url.includes(`ProjectID%3d${pid}`);
  if (!hasPid) return false;
  return (
    /\/Project\/Index/i.test(url) ||
    /\/Frame\.aspx/i.test(url) ||
    /WebForms\/Frame\.aspx/i.test(url)
  );
}

/**
 * True only when the popup is past the SSO bridge and shows real project UI (per user criteria).
 * Does not succeed on SSO URL alone; does not use ProjectID in the SSO query as proof of detail.
 * @param {import('playwright').Page} popup
 * @param {string} projectId
 * @param {string} permitNorm
 */
async function pgcPopupHasRealProjectDetail(popup, projectId, permitNorm) {
  const pid = String(projectId || "").trim();
  const u = String(popup.url() || "");
  if (pgcProjectDetailEntryUrlOk(u, pid)) return true;

  const leftSsoBridge = !pgcPopupUrlIsSsoBridge(u);
  const dom = await popup
    .evaluate(
      ({ id, permit }) => {
        const body = (document.body && document.body.innerText) || "";
        const tabs = !!document.querySelector(
          '[role="tablist"], .ui-tab, a[href*="tab="], [href*="tasksTab"], [href*="infoTab"], [href*="projectStatusTab"]',
        );
        const permitHit =
          !!permit &&
          body.toLowerCase().includes(String(permit).toLowerCase());
        const idInBody = !!id && body.includes(id);
        return { tabs, permitHit, idInBody };
      },
      { id: pid, permit: permitNorm || "" },
    )
    .catch(() => ({ tabs: false, permitHit: false, idInBody: false }));

  const tabChrome = dom.tabs;
  const bodyContext = dom.permitHit || dom.idInBody;
  return leftSsoBridge || tabChrome || bodyContext;
}

/**
 * Wait for launchRemote popup to finish SSO bridge and show project UI.
 * @param {import('playwright').Page} popup
 * @param {string} projectId
 * @param {string} permitNorm
 */
async function pgcWaitPopupProjectDetailReady(popup, projectId, permitNorm) {
  const pid = String(projectId || "").trim();
  const deadline = Date.now() + 90000;
  let lastLoggedUrl = "";
  while (Date.now() < deadline) {
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const u = popup.url();
    if (u && u !== lastLoggedUrl && u !== "about:blank") {
      lastLoggedUrl = u;
      console.log("[PGC] Dashboard popup URL:", u);
    }
    if (await pgcPopupHasRealProjectDetail(popup, pid, permitNorm)) {
      return true;
    }
    await popup.waitForTimeout(400).catch(() => {});
  }
  return false;
}

/**
 * After a dashboard project click: if launchRemote opened a popup, keep that Page for scraping (SSO → Frame/Index).
 * If same-tab navigation, keep using `page`. Returns { url, detailPage } where detailPage is set only for popup flow.
 * @param {import('playwright').Page} page
 * @param {string} projectId
 * @param {string} permitNorm
 * @param {Promise<import('playwright').Page | null>} popupPromise
 * @returns {Promise<{ url: string, detailPage: import('playwright').Page | null }>}
 */
async function pgcFinishDashboardOpenAfterClick(
  page,
  projectId,
  permitNorm,
  popupPromise,
) {
  const pid = String(projectId || "").trim();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    for (let i = 0; i < 50; i++) {
      const u = popup.url();
      if (
        u &&
        u !== "about:blank" &&
        !u.startsWith("chrome-error://")
      ) {
        break;
      }
      await popup.waitForTimeout(200).catch(() => {});
    }
    console.log("[PGC] Dashboard row open — popup initial URL:", popup.url());
    const ready = await pgcWaitPopupProjectDetailReady(
      popup,
      pid,
      permitNorm,
    );
    const verified = await pgcPopupHasRealProjectDetail(
      popup,
      pid,
      permitNorm,
    );
    if (ready && verified) {
      console.log(
        "[PGC] Dashboard row open — popup project detail ready:",
        popup.url(),
      );
      return { url: popup.url(), detailPage: popup };
    }
    if (pgcPopupUrlIsSsoBridge(popup.url())) {
      console.log("[PGC] Popup stayed on SSO bridge, falling back");
    }
    await popup.close().catch(() => {});
    return { url: page.url(), detailPage: null };
  }
  try {
    await page.waitForURL(
      (u) => pgcProjectDetailEntryUrlOk(u, pid),
      { timeout: 28000 },
    );
  } catch (_) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(
      () => {},
    );
  }
  await page.waitForTimeout(600);
  const u = page.url();
  if (pgcProjectDetailEntryUrlOk(u, pid)) {
    return { url: u, detailPage: null };
  }
  return { url: u, detailPage: null };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectId
 * @param {string} permitNorm
 * @param {() => Promise<void>} clickFn
 * @returns {Promise<{ url: string, detailPage: import('playwright').Page | null }>}
 */
async function pgcRunDashboardOpenClick(page, projectId, permitNorm, clickFn) {
  const popupPromise = page
    .waitForEvent("popup", { timeout: 20000 })
    .catch(() => null);
  await clickFn();
  return pgcFinishDashboardOpenAfterClick(
    page,
    projectId,
    permitNorm,
    popupPromise,
  );
}

/**
 * Open a project from My Projects using the real grid row / link (no redundant Home goto when already there).
 * @param {import('playwright').Page} page
 * @param {string} dashboardUrl
 * @param {string} projectId
 * @param {{ projectNumber?: string }} [opts]
 */
async function openProjectViaDashboardRow(page, dashboardUrl, projectId, opts = {}) {
  const pid = String(projectId || "").trim();
  const permit = normalizeText(opts.projectNumber || "");
  if (!pid) return { ok: false, reason: "empty projectId" };

  const current = page.url();
  if (pgcProjectDetailEntryUrlOk(current, pid)) {
    return {
      ok: true,
      url: current,
      alreadyOpen: true,
      skippedDashboardGoto: true,
      via: "already-open",
      detailPage: null,
    };
  }

  const onPortalHome = /\/Portal\/Home\/Index/i.test(current);
  if (!onPortalHome) {
    try {
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (e) {
      return {
        ok: false,
        reason: `goto dashboard failed: ${(e && e.message) || String(e)}`,
      };
    }
  }

  await page
    .waitForSelector("table tbody tr, .ui-iggrid-table tbody tr", {
      timeout: 15000,
    })
    .catch(() => {});
  await waitForProjectGrid(page);

  /** @type {{ label: string, loc: import('playwright').Locator }[]} */
  const locatorAttempts = [];
  if (permit) {
    const esc = pgcRegexEscape(permit);
    locatorAttempts.push({
      label: "row-remote-content-permit",
      loc: page
        .locator(".ui-iggrid-table tbody tr, table tbody tr")
        .filter({ hasText: new RegExp(esc, "i") })
        .locator("a.remote-content")
        .first(),
    });
    locatorAttempts.push({
      label: "role-link-exact-permit",
      loc: page
        .getByRole("link", {
          name: new RegExp(`^\\s*${esc}\\s*$`, "i"),
        })
        .first(),
    });
  }
  locatorAttempts.push(
    {
      label: "remote-content-launchRemote-ProjectID",
      loc: page
        .locator(`a.remote-content[href*="launchRemote"][href*="${pid}"]`)
        .first(),
    },
    {
      label: "launchRemote-href-with-ProjectID",
      loc: page.locator(`a[href*="launchRemote"][href*="${pid}"]`).first(),
    },
    {
      label: "href-ProjectID-plain",
      loc: page.locator(`a[href*="ProjectID=${pid}"]`).first(),
    },
    {
      label: "href-ProjectID-encoded",
      loc: page.locator(`a[href*="ProjectID%3D${pid}"]`).first(),
    },
    {
      label: "onclick-ProjectID",
      loc: page.locator(`a[onclick*="ProjectID=${pid}"]`).first(),
    },
    {
      label: "any-onclick-ProjectID",
      loc: page.locator(`[onclick*="ProjectID=${pid}"]`).first(),
    },
  );

  for (const { label, loc } of locatorAttempts) {
    try {
      if ((await loc.count()) === 0) continue;
      const first = loc.first();
      await first.scrollIntoViewIfNeeded().catch(() => {});
      const href = (await first.getAttribute("href")) || "";
      const onclick = (await first.getAttribute("onclick")) || "";
      const tagName =
        (await first.evaluate((el) => el.tagName).catch(() => "")) || "";
      console.log("[PGC] Dashboard row open trace —", label, {
        tagName,
        href: href.slice(0, 220),
        onclick: onclick.slice(0, 220),
      });
      const { url: afterUrl, detailPage } = await pgcRunDashboardOpenClick(
        page,
        pid,
        permit,
        async () => {
          await first
            .click({ timeout: 12000 })
            .catch(async () => {
              await first.click({ timeout: 12000, force: true });
            });
        },
      );
      if (detailPage || pgcProjectDetailEntryUrlOk(afterUrl, pid)) {
        return {
          ok: true,
          url: afterUrl,
          via: label,
          detailPage: detailPage || null,
        };
      }
    } catch (_) {
      /* try next */
    }
  }

  const popupPromise = page
    .waitForEvent("popup", { timeout: 20000 })
    .catch(() => null);
  const evalRes = await page
    .evaluate(
      ({ id, permitText }) => {
        const norm = (s) =>
          String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const rowSels = [".ui-iggrid-table tbody tr", "table tbody tr"];
        const re = new RegExp(`ProjectID[=\\'"]?${id}\\b`, "i");
        const permitLower = permitText
          ? String(permitText).toLowerCase()
          : "";

        /**
         * @param {HTMLTableRowElement} tr
         */
        function pickOpener(tr) {
          const seq = [
            'a.remote-content[href*="launchRemote"]',
            `a.remote-content[href*="ProjectID=${id}"]`,
            `a.remote-content[href*="ProjectID%3D${id}"]`,
            'a[href*="launchRemote"]',
            `a[href*="ProjectID=${id}"]`,
            `a[href*="ProjectID%3D${id}"]`,
            `a[onclick*="${id}"]`,
            'a[onclick*="ProjectID"]',
            'button[onclick*="ProjectID"]',
            'td[onclick*="ProjectID"]',
            '[onclick*="launchRemote"]',
          ];
          for (const sel of seq) {
            const el = tr.querySelector(sel);
            if (!el) continue;
            const h = el.getAttribute("href") || "";
            const oc = el.getAttribute("onclick") || "";
            if (
              h.includes(id) ||
              oc.includes(id) ||
              /launchRemote/i.test(h + oc) ||
              (/ProjectID/i.test(h + oc) &&
                (h.includes(id) || oc.includes(id)))
            ) {
              return {
                el,
                tagName: el.tagName || "",
                href: h,
                onclick: oc,
                via: `evaluate:${sel}`,
              };
            }
          }
          const rcPerm = tr.querySelector("a.remote-content");
          if (rcPerm && permitLower) {
            const rt = norm(rcPerm.textContent || "").toLowerCase();
            if (rt === permitLower || rt.includes(permitLower)) {
              return {
                el: rcPerm,
                tagName: rcPerm.tagName || "",
                href: rcPerm.getAttribute("href") || "",
                onclick: rcPerm.getAttribute("onclick") || "",
                via: "evaluate:remote-content-permit",
              };
            }
          }
          const links = tr.querySelectorAll("a");
          for (const el of links) {
            const t = norm(el.textContent || "").toLowerCase();
            if (
              permitLower &&
              (t === permitLower || t.includes(permitLower))
            ) {
              return {
                el,
                tagName: el.tagName || "",
                href: el.getAttribute("href") || "",
                onclick: el.getAttribute("onclick") || "",
                via: "evaluate:permit-text-link",
              };
            }
          }
          const first = tr.querySelector(
            "a[href], a[onclick], button[onclick], td[onclick], [onclick]",
          );
          if (first) {
            return {
              el: first,
              tagName: first.tagName || "",
              href: first.getAttribute("href") || "",
              onclick: first.getAttribute("onclick") || "",
              via: "evaluate:first-actionable",
            };
          }
          return null;
        }

        for (const rs of rowSels) {
          for (const tr of document.querySelectorAll(rs)) {
            if (tr.closest("thead")) continue;
            const html = tr.innerHTML || "";
            const text = norm(tr.textContent || "");
            const idHit = re.test(html) || html.includes(id);
            const permitHit =
              permitLower && text.toLowerCase().includes(permitLower);
            if (!idHit && !permitHit) continue;
            const pick = pickOpener(tr);
            if (!pick || !pick.el) continue;
            pick.el.click();
            return {
              ok: true,
              tagName: pick.tagName,
              href: pick.href,
              onclick: pick.onclick,
              via: pick.via,
            };
          }
        }
        return { ok: false, via: "", tagName: "", href: "", onclick: "" };
      },
      { id: pid, permitText: permit },
    )
    .catch(() => ({
      ok: false,
      via: "evaluate-error",
      tagName: "",
      href: "",
      onclick: "",
    }));

  if (evalRes && evalRes.ok) {
    console.log("[PGC] Dashboard row open trace — evaluate:", {
      via: evalRes.via,
      tagName: evalRes.tagName,
      href: String(evalRes.href || "").slice(0, 220),
      onclick: String(evalRes.onclick || "").slice(0, 220),
    });
    const { url: afterUrl, detailPage } = await pgcFinishDashboardOpenAfterClick(
      page,
      pid,
      permit,
      popupPromise,
    );
    if (detailPage || pgcProjectDetailEntryUrlOk(afterUrl, pid)) {
      return {
        ok: true,
        url: afterUrl,
        via: evalRes.via || "evaluate-click",
        detailPage: detailPage || null,
      };
    }
  }

  return { ok: false, reason: "no dashboard row/link opened project detail" };
}

/**
 * Paginate My Projects until a row matches the permit / project number text.
 * @param {import('playwright').Page} page
 * @param {string} dashboardUrl
 * @param {string} targetPermitRaw e.g. 62227-2024-CIEU
 */
async function findPgcPermitRowPaginated(page, dashboardUrl, targetPermitRaw) {
  const targetPermit = normalizeText(targetPermitRaw);
  if (!targetPermit) {
    return { ok: false, reason: "empty target permit" };
  }

  const current = page.url();
  if (!/\/Portal\/Home\/Index/i.test(current)) {
    try {
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (e) {
      return {
        ok: false,
        reason: `goto dashboard failed: ${(e && e.message) || String(e)}`,
      };
    }
  }

  await page
    .waitForSelector("table tbody tr, .ui-iggrid-table tbody tr", {
      timeout: 15000,
    })
    .catch(() => {});
  await waitForProjectGrid(page);

  const pagerGuess = await detectPaginationMode(page);
  let paginationMode = pagerGuess.mode;
  if (paginationMode === "view_all") paginationMode = "next_button";

  let lastSignature = "";
  for (let i = 0; i < MAX_PAGER_PAGES; i++) {
    const pack = await readProjectRows(page);
    const row = pack.rows.find(
      (r) =>
        normalizeText(r.projectNumber).toLowerCase() ===
        targetPermit.toLowerCase(),
    );
    if (row) {
      return {
        ok: true,
        row,
        pagesVisited: i + 1,
        paginationMode,
      };
    }

    const idsOnPage = pack.rows.map((r) => r.projectID);
    const sig = rowSignatureFromIds(idsOnPage);
    if (i > 0 && sig === lastSignature && idsOnPage.length > 0) break;
    lastSignature = sig;

    const canPaginate =
      paginationMode === "next_button" ||
      paginationMode === "numbered_pages" ||
      paginationMode === "unknown";
    if (!canPaginate || paginationMode === "single_page") break;

    const preferNum = paginationMode === "numbered_pages";
    const advanced = await goToNextPage(page, preferNum);
    if (!advanced) break;
    await waitForProjectGrid(page);
  }

  return {
    ok: false,
    reason: `permit not found on My Projects: ${targetPermit}`,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectId
 * @param {string} permitText
 */
async function evaluatePgcProjectDetailContext(page, projectId, permitText) {
  const pid = String(projectId || "").trim();
  const permit = normalizeText(permitText);
  return page
    .evaluate(
      ({ id, permitNorm }) => {
        const href = String(location.href || "");
        const urlOk =
          !/\/Portal\/login\/sso/i.test(href) &&
          (/\/Project\/Index/i.test(href) ||
            /\/Frame\.aspx/i.test(href) ||
            /WebForms\/Frame\.aspx/i.test(href)) &&
          (href.includes(`ProjectID=${id}`) ||
            href.includes(`ProjectID%3D${id}`) ||
            href.includes(`ProjectID%3d${id}`));
        const body = String(document.body?.innerText || "");
        const bodyHasPermit =
          !permitNorm ||
          body.toLowerCase().includes(String(permitNorm).toLowerCase());
        let tabNameHits = 0;
        const names = [
          "infoTab",
          "projectStatusTab",
          "tasksTab",
          "filesTab",
          "correctionsTab",
        ];
        for (const a of document.querySelectorAll("a[href]")) {
          const h = a.getAttribute("href") || "";
          if (!/tab=/i.test(h)) continue;
          if (names.some((n) => h.includes(n))) tabNameHits++;
        }
        const tablist = !!document.querySelector('[role="tablist"]');
        const genericTab = !!document.querySelector(
          '.ui-tab, a[href*="tab="], [href*="tasksTab"], [href*="infoTab"]',
        );
        const tabsOk =
          urlOk &&
          (tablist || tabNameHits >= 2 || (tabNameHits >= 1 && genericTab));
        return {
          urlOk,
          bodyHasPermit,
          tablist,
          tabNameHits,
          genericTab,
          tabsOk,
        };
      },
      { id: pid, permitNorm: permit },
    )
    .catch(() => ({
      urlOk: false,
      bodyHasPermit: false,
      tablist: false,
      tabNameHits: 0,
      genericTab: false,
      tabsOk: false,
    }));
}

/**
 * Open project from My Projects with the same strategies as openProjectViaDashboardRow,
 * logging URL before/after click and the chosen element selector / href / onclick.
 * @param {import('playwright').Page} page
 * @param {string} dashboardUrl
 * @param {string} projectId
 * @param {{ projectNumber?: string }} [opts]
 */
async function openPgcDashboardRowWithTrace(page, dashboardUrl, projectId, opts = {}) {
  const pid = String(projectId || "").trim();
  const permit = normalizeText(opts.projectNumber || "");
  /** @type {Record<string, unknown>} */
  const trace = {
    beforeUrl: "",
    afterUrl: "",
    selectorUsed: "",
    tagName: "",
    href: "",
    onclick: "",
    via: "",
  };

  const logOpen = (msg, extra) => {
    if (extra !== undefined) {
      console.log(`[PGC-DETAIL-HARNESS] ${msg}`, extra);
    } else {
      console.log(`[PGC-DETAIL-HARNESS] ${msg}`);
    }
  };

  if (!pid) {
    return { ok: false, reason: "empty projectId", trace };
  }

  const current = page.url();
  if (pgcProjectDetailEntryUrlOk(current, pid)) {
    const u = current;
    trace.beforeUrl = current;
    trace.afterUrl = current;
    trace.via = "already-open";
    trace.selectorUsed = "(none — already on detail)";
    trace.href = "(n/a)";
    trace.onclick = "(n/a)";
    logOpen(
      "openAction: already on project entry URL for this ProjectID (no click)",
    );
    logOpen("URL before/after (no navigation):", current);
    return {
      ok: true,
      url: u,
      alreadyOpen: true,
      skippedDashboardGoto: true,
      detailPage: null,
      trace,
    };
  }

  const onPortalHome = /\/Portal\/Home\/Index/i.test(current);
  if (!onPortalHome) {
    try {
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (e) {
      return {
        ok: false,
        reason: `goto dashboard failed: ${(e && e.message) || String(e)}`,
        trace,
      };
    }
  }

  await page
    .waitForSelector("table tbody tr, .ui-iggrid-table tbody tr", {
      timeout: 15000,
    })
    .catch(() => {});
  await waitForProjectGrid(page);

  /** @type {{ desc: string, loc: import('playwright').Locator }[]} */
  const locatorSpecs = [];
  if (permit) {
    const esc = pgcRegexEscape(permit);
    locatorSpecs.push({
      desc: "row-remote-content-permit",
      loc: page
        .locator(".ui-iggrid-table tbody tr, table tbody tr")
        .filter({ hasText: new RegExp(esc, "i") })
        .locator("a.remote-content")
        .first(),
    });
    locatorSpecs.push({
      desc: "role-link-exact-permit",
      loc: page
        .getByRole("link", {
          name: new RegExp(`^\\s*${esc}\\s*$`, "i"),
        })
        .first(),
    });
  }
  locatorSpecs.push(
    {
      desc: `locator:a.remote-content[href*="launchRemote"][href*="${pid}"]`,
      loc: page
        .locator(`a.remote-content[href*="launchRemote"][href*="${pid}"]`)
        .first(),
    },
    {
      desc: `locator:a[href*="launchRemote"][href*="${pid}"]`,
      loc: page.locator(`a[href*="launchRemote"][href*="${pid}"]`).first(),
    },
    {
      desc: `locator:a[href*="ProjectID=${pid}"]`,
      loc: page.locator(`a[href*="ProjectID=${pid}"]`).first(),
    },
    {
      desc: `locator:a[href*="ProjectID%3D${pid}"]`,
      loc: page.locator(`a[href*="ProjectID%3D${pid}"]`).first(),
    },
    {
      desc: `locator:a[onclick*="ProjectID=${pid}"]`,
      loc: page.locator(`a[onclick*="ProjectID=${pid}"]`).first(),
    },
    {
      desc: `locator:[onclick*="ProjectID=${pid}"]`,
      loc: page.locator(`[onclick*="ProjectID=${pid}"]`).first(),
    },
  );

  for (const { desc, loc } of locatorSpecs) {
    try {
      if ((await loc.count()) === 0) continue;
      const first = loc.first();
      await first.scrollIntoViewIfNeeded().catch(() => {});
      trace.beforeUrl = page.url();
      const elMeta = await first
        .evaluate((el) => ({
          tagName: el.tagName || "",
          href: el.getAttribute("href") || "",
          onclick: el.getAttribute("onclick") || "",
        }))
        .catch(() => ({ tagName: "", href: "", onclick: "" }));
      trace.selectorUsed = desc;
      trace.tagName = elMeta.tagName;
      trace.href = elMeta.href;
      trace.onclick = elMeta.onclick
        ? elMeta.onclick.slice(0, 800)
        : "(none)";
      trace.via = desc;
      logOpen("openAction URL before click:", trace.beforeUrl);
      logOpen("openAction selector:", trace.selectorUsed);
      logOpen("openAction tagName:", trace.tagName);
      logOpen("openAction href:", trace.href);
      logOpen("openAction onclick:", trace.onclick);
      const { url: afterOpenUrl, detailPage } = await pgcRunDashboardOpenClick(
        page,
        pid,
        permit,
        async () => {
          await first
            .click({ timeout: 12000 })
            .catch(async () => {
              await first.click({ timeout: 12000, force: true });
            });
        },
      );
      trace.afterUrl = afterOpenUrl;
      logOpen("openAction URL after click:", trace.afterUrl);
      if (detailPage || pgcProjectDetailEntryUrlOk(trace.afterUrl, pid)) {
        return {
          ok: true,
          url: trace.afterUrl,
          via: desc,
          detailPage: detailPage || null,
          trace,
        };
      }
    } catch {
      /* try next */
    }
  }

  trace.beforeUrl = page.url();
  logOpen("openAction URL before row evaluate-click:", trace.beforeUrl);

  const popupPromise = page
    .waitForEvent("popup", { timeout: 20000 })
    .catch(() => null);
  const evalResult = await page
    .evaluate(
      ({ id, permitText }) => {
        const norm = (s) =>
          String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const rowSels = [".ui-iggrid-table tbody tr", "table tbody tr"];
        const re = new RegExp(`ProjectID[=\\'"]?${id}\\b`, "i");
        const permitLower = permitText
          ? String(permitText).toLowerCase()
          : "";

        function pickOpener(tr) {
          const seq = [
            'a.remote-content[href*="launchRemote"]',
            `a.remote-content[href*="ProjectID=${id}"]`,
            `a.remote-content[href*="ProjectID%3D${id}"]`,
            'a[href*="launchRemote"]',
            `a[href*="ProjectID=${id}"]`,
            `a[href*="ProjectID%3D${id}"]`,
            `a[onclick*="${id}"]`,
            'a[onclick*="ProjectID"]',
            'button[onclick*="ProjectID"]',
            'td[onclick*="ProjectID"]',
            '[onclick*="launchRemote"]',
          ];
          for (const sel of seq) {
            const el = tr.querySelector(sel);
            if (!el) continue;
            const h = el.getAttribute("href") || "";
            const oc = el.getAttribute("onclick") || "";
            if (
              h.includes(id) ||
              oc.includes(id) ||
              /launchRemote/i.test(h + oc) ||
              (/ProjectID/i.test(h + oc) &&
                (h.includes(id) || oc.includes(id)))
            ) {
              return {
                el,
                tagName: el.tagName || "",
                href: h,
                onclick: oc,
                via: `evaluate:${sel}`,
              };
            }
          }
          const rcPerm = tr.querySelector("a.remote-content");
          if (rcPerm && permitLower) {
            const rt = norm(rcPerm.textContent || "").toLowerCase();
            if (rt === permitLower || rt.includes(permitLower)) {
              return {
                el: rcPerm,
                tagName: rcPerm.tagName || "",
                href: rcPerm.getAttribute("href") || "",
                onclick: rcPerm.getAttribute("onclick") || "",
                via: "evaluate:remote-content-permit",
              };
            }
          }
          const links = tr.querySelectorAll("a");
          for (const el of links) {
            const t = norm(el.textContent || "").toLowerCase();
            if (
              permitLower &&
              (t === permitLower || t.includes(permitLower))
            ) {
              return {
                el,
                tagName: el.tagName || "",
                href: el.getAttribute("href") || "",
                onclick: el.getAttribute("onclick") || "",
                via: "evaluate:permit-text-link",
              };
            }
          }
          const first = tr.querySelector(
            "a[href], a[onclick], button[onclick], td[onclick], [onclick]",
          );
          if (first) {
            return {
              el: first,
              tagName: first.tagName || "",
              href: first.getAttribute("href") || "",
              onclick: first.getAttribute("onclick") || "",
              via: "evaluate:first-actionable",
            };
          }
          return null;
        }

        for (const rs of rowSels) {
          for (const tr of document.querySelectorAll(rs)) {
            if (tr.closest("thead")) continue;
            const html = tr.innerHTML || "";
            const text = norm(tr.textContent || "");
            const idHit = re.test(html) || html.includes(id);
            const permitHit =
              permitLower && text.toLowerCase().includes(permitLower);
            if (!idHit && !permitHit) continue;
            const pick = pickOpener(tr);
            if (!pick || !pick.el) continue;
            pick.el.click();
            return {
              ok: true,
              tagName: pick.tagName,
              href: pick.href,
              onclick: pick.onclick,
              via: pick.via,
              rowTextSnippet: text.slice(0, 120),
            };
          }
        }
        return {
          ok: false,
          via: "",
          tagName: "",
          href: "",
          onclick: "",
          rowTextSnippet: "",
        };
      },
      { id: pid, permitText: permit },
    )
    .catch(() => ({
      ok: false,
      via: "evaluate-error",
      tagName: "",
      href: "",
      onclick: "",
      rowTextSnippet: "",
    }));

  if (evalResult && evalResult.ok) {
    trace.selectorUsed = `evaluate → ${evalResult.via}`;
    trace.tagName = evalResult.tagName || "";
    trace.href = evalResult.href || "";
    trace.onclick = evalResult.onclick
      ? String(evalResult.onclick).slice(0, 800)
      : "(none)";
    trace.via = evalResult.via || "evaluate-click";
    trace.rowTextSnippet = evalResult.rowTextSnippet;
    logOpen("openAction selector (evaluate path):", trace.selectorUsed);
    logOpen("openAction tagName:", trace.tagName);
    logOpen("openAction href:", trace.href);
    logOpen("openAction onclick:", trace.onclick);
    logOpen("openAction row text snippet:", evalResult.rowTextSnippet || "");
    const { url: evAfterUrl, detailPage: evDetail } =
      await pgcFinishDashboardOpenAfterClick(
        page,
        pid,
        permit,
        popupPromise,
      );
    trace.afterUrl = evAfterUrl;
    logOpen("openAction URL after click:", trace.afterUrl);
    if (evDetail || pgcProjectDetailEntryUrlOk(trace.afterUrl, pid)) {
      return {
        ok: true,
        url: trace.afterUrl,
        via: trace.via,
        detailPage: evDetail || null,
        trace,
      };
    }
  }

  return {
    ok: false,
    reason: "no dashboard row/link opened project detail",
    trace,
  };
}

/**
 * Preconditions: authenticated; Home / My Projects grid can render (caller typically runs assertPgcHomeBootstrapped).
 * Finds permit, opens detail from the row, verifies Project/Index tab chrome — does not scrape tab bodies.
 * @param {import('playwright').Page} page
 * @param {{ dashboardUrl?: string, targetPermit?: string }} [opts]
 */
async function runPgcDetailOpenOnlyHarness(page, opts = {}) {
  const dashboardUrl = opts.dashboardUrl || PGC_DASHBOARD_URL;
  const targetPermit =
    normalizeText(
      opts.targetPermit ||
        process.env.PGC_TARGET_PERMIT ||
        "62227-2024-CIEU",
    );

  const result = {
    ok: false,
    status: /** @type {'PASS' | 'FAIL'} */ ("FAIL"),
    reason: "",
    targetPermit,
    projectID: /** @type {string|undefined} */ (undefined),
    pagesVisited: 0,
    openResult: /** @type {Record<string, unknown>|null} */ (null),
    detailContext: /** @type {Awaited<ReturnType<typeof evaluatePgcProjectDetailContext>>|null} */ (
      null
    ),
  };

  console.log("[PGC-DETAIL-HARNESS] target permit:", targetPermit);

  try {
    await assertPgcHomeBootstrapped(page, {
      captureDiagnosticsOnFailure: false,
    });
  } catch (e) {
    result.reason = e?.message || String(e);
    console.log("[PGC-DETAIL-HARNESS] FAIL — Home not bootstrapped:", result.reason);
    return result;
  }

  const found = await findPgcPermitRowPaginated(
    page,
    dashboardUrl,
    targetPermit,
  );
  if (!found.ok || !found.row) {
    result.reason = found.reason || "row not found";
    console.log("[PGC-DETAIL-HARNESS] FAIL — find row:", result.reason);
    return result;
  }

  result.projectID = String(found.row.projectID);
  result.pagesVisited = found.pagesVisited || 0;
  console.log(
    "[PGC-DETAIL-HARNESS] found row projectID=%s pagesVisited=%s linkSource=%s",
    result.projectID,
    result.pagesVisited,
    found.row._linkSource || "(unknown)",
  );

  const openRes = await openPgcDashboardRowWithTrace(
    page,
    dashboardUrl,
    result.projectID,
    { projectNumber: found.row.projectNumber || targetPermit },
  );
  result.openResult = openRes;

  if (!openRes.ok) {
    result.reason = openRes.reason || "open from row failed";
    console.log("[PGC-DETAIL-HARNESS] FAIL — open:", result.reason);
    return result;
  }

  /** @type {import('playwright').Page | null} */
  const harnessSsoPopup = openRes.detailPage || null;
  const detailCtxPage = harnessSsoPopup || page;
  try {
    result.detailContext = await evaluatePgcProjectDetailContext(
      detailCtxPage,
      result.projectID,
      found.row.projectNumber || targetPermit,
    );

    if (!result.detailContext.tabsOk) {
      result.reason = `project detail context missing (urlOk=${result.detailContext.urlOk} tablist=${result.detailContext.tablist} tabNameHits=${result.detailContext.tabNameHits} genericTab=${result.detailContext.genericTab} bodyHasPermit=${result.detailContext.bodyHasPermit})`;
      console.log("[PGC-DETAIL-HARNESS] FAIL —", result.reason);
      console.log(
        "[PGC-DETAIL-HARNESS] detailContext:",
        JSON.stringify(result.detailContext),
      );
      return result;
    }

    result.ok = true;
    result.status = "PASS";
    result.reason = "Project detail open with tab chrome";
    console.log("[PGC-DETAIL-HARNESS] PASS —", result.reason);
    console.log(
      "[PGC-DETAIL-HARNESS] detailContext:",
      JSON.stringify(result.detailContext),
    );
    return result;
  } finally {
    try {
      if (harnessSsoPopup && !harnessSsoPopup.isClosed()) {
        await harnessSsoPopup.close();
      }
    } catch (_) {}
  }
}

// ─── Task 5 — PGC workflow from corrections payload + task list metadata ───

/**
 * @typedef {{
 *  projectID?: string | null,
 *  wflowInstanceID?: string | null,
 *  userID?: string | null,
 *  wflowTaskID?: string | null,
 *  wflowActivityID?: string | null,
 *  groupID?: string | null,
 *  wflowReviewCycleID?: string | null
 * }} PgcCorrectionsRequestContext
 */

function appendIfPresent(q, key, value) {
  if (value == null) return;
  const s = String(value).trim();
  if (!s) return;
  q.set(key, s);
}

/**
 * @param {unknown} root
 * @param {string[]} keys
 * @returns {string | null}
 */
function pickDeepField(root, keys) {
  if (!root || typeof root !== "object") return null;
  const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
  const queue = [root];
  const seen = new Set();
  let iter = 0;
  while (queue.length && iter < 8000) {
    iter += 1;
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const it of cur) queue.push(it);
      continue;
    }
    const obj = /** @type {Record<string, unknown>} */ (cur);
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && keySet.has(k.toLowerCase())) {
        const s = String(v).trim();
        if (s) return s;
      }
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return null;
}

/**
 * @param {unknown} taskListMeta
 * @param {string} projectID
 * @param {string | null} [hintWflowId]
 * @returns {PgcCorrectionsRequestContext}
 */
function buildCorrectionsRequestContext(taskListMeta, projectID, hintWflowId = null) {
  const ctx = /** @type {PgcCorrectionsRequestContext} */ ({
    projectID: String(projectID),
    userID: pickDeepField(taskListMeta, ["userID", "UserID", "userId", "UserId"]),
    wflowTaskID: pickDeepField(taskListMeta, [
      "wflowTaskID",
      "WFlowTaskID",
      "wflowtaskid",
      "taskID",
      "TaskID",
    ]),
    wflowActivityID: pickDeepField(taskListMeta, [
      "wflowActivityID",
      "WFlowActivityID",
      "activityID",
      "ActivityID",
    ]),
    groupID: pickDeepField(taskListMeta, [
      "groupID",
      "GroupID",
      "reviewGroupID",
      "ReviewGroupID",
    ]),
    wflowReviewCycleID: pickDeepField(taskListMeta, [
      "wflowReviewCycleID",
      "WFlowReviewCycleID",
      "reviewCycleID",
      "ReviewCycleID",
    ]),
  });
  return {
    ...ctx,
    // Allow task list metadata to recover missing workflow context.
    wflowInstanceID:
      hintWflowId ||
      pickDeepField(taskListMeta, [
        "wflowInstanceID",
        "WFlowInstanceID",
        "wflowInstanceId",
        "WFlowInstanceId",
      ]),
  };
}

/**
 * @param {string | null | undefined} wflowInstanceID
 * @param {PgcCorrectionsRequestContext} [ctx]
 */
function pgcCorrectionsProbeUrl(wflowInstanceID, ctx = {}) {
  const q = new URLSearchParams();
  appendIfPresent(q, "retrieveFilterOptions", "true");
  appendIfPresent(q, "projectID", ctx.projectID);
  appendIfPresent(q, "userID", ctx.userID);
  appendIfPresent(q, "wflowInstanceID", wflowInstanceID ?? null);
  appendIfPresent(q, "wflowTaskID", ctx.wflowTaskID);
  appendIfPresent(q, "wflowActivityID", ctx.wflowActivityID);
  appendIfPresent(q, "groupID", ctx.groupID);
  appendIfPresent(q, "wflowReviewCycleID", ctx.wflowReviewCycleID);
  return `${PGC_PROJECTDOX_API_ORIGIN}/ProjectDoxWebAPI/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?${q.toString()}`;
}

/**
 * Same endpoint with ProjectID first (PGC returns WorkflowInstance + Corrections).
 * @param {string} projectID
 * @param {"ProjectID"|"projectID"} [idParam]
 */
function pgcCorrectionsProbeUrlByProject(projectID, idParam = "ProjectID", ctx = {}) {
  const q = new URLSearchParams();
  appendIfPresent(q, "retrieveFilterOptions", "true");
  appendIfPresent(q, "wflowInstanceID", ctx.wflowInstanceID || null);
  appendIfPresent(q, "userID", ctx.userID);
  appendIfPresent(q, "wflowTaskID", ctx.wflowTaskID);
  appendIfPresent(q, "wflowActivityID", ctx.wflowActivityID);
  appendIfPresent(q, "groupID", ctx.groupID);
  appendIfPresent(q, "wflowReviewCycleID", ctx.wflowReviewCycleID);
  q.set(idParam, String(projectID));
  return `${PGC_PROJECTDOX_API_ORIGIN}/ProjectDoxWebAPI/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?${q.toString()}`;
}

function pgcGetWorkflowTaskListUrl(projectID) {
  return `${PGC_PROJECTDOX_API_ORIGIN}/ProjectDoxWebAPI/WorkflowAggregate/GetWorkflowTaskList?projectID=${encodeURIComponent(
    String(projectID),
  )}`;
}

/**
 * @param {unknown} root
 * @returns {{ wflowInstanceID: string, wflowInstanceStateName: string | null, instanceName: string | null } | null}
 */
function extractWorkflowInstanceFromReviewPayload(root) {
  if (!root || typeof root !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (root);
  const wi = r.WorkflowInstance ?? r.workflowInstance;
  if (!wi || typeof wi !== "object") return null;
  const w = /** @type {Record<string, unknown>} */ (wi);
  const id =
    w.WFlowInstanceID ?? w.WFlowInstanceId ?? w.wflowInstanceID ?? w.wflowInstanceId;
  if (id == null || String(id).trim() === "") return null;
  const st = w.WFlowInstanceStateName ?? w.wflowInstanceStateName ?? null;
  const nm = w.InstanceName ?? w.instanceName ?? null;
  return {
    wflowInstanceID: String(id),
    wflowInstanceStateName:
      st != null ? normalizeText(String(st)) || null : null,
    instanceName: nm != null ? normalizeText(String(nm)) || null : null,
  };
}

/**
 * @param {unknown} json
 * @returns {{ id: string | null, workflowInstance: ReturnType<typeof extractWorkflowInstanceFromReviewPayload>, source: string | null }}
 */
function pickWFlowInstanceIdFromCorrectionsBody(json) {
  const wfObj = extractWorkflowInstanceFromReviewPayload(json);
  if (wfObj?.wflowInstanceID) {
    return {
      id: wfObj.wflowInstanceID,
      workflowInstance: wfObj,
      source: "WorkflowInstance",
    };
  }
  if (!json || typeof json !== "object") {
    return { id: null, workflowInstance: null, source: null };
  }
  const root = /** @type {Record<string, unknown>} */ (json);
  const arr = /** @type {unknown[]} */ (
    root.Corrections ?? root.corrections ?? []
  );
  if (!Array.isArray(arr)) {
    return { id: null, workflowInstance: null, source: null };
  }
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const id = o.WFlowInstanceID ?? o.wflowInstanceID;
    if (id != null && String(id).trim() !== "") {
      return {
        id: String(id),
        workflowInstance: null,
        source: "CorrectionRow",
      };
    }
  }
  return { id: null, workflowInstance: null, source: null };
}

/**
 * Try project-scoped corrections, then lowercase projectID param, then explicit instance.
 * @param {import('playwright').Page} page
 * @param {string} projectID
 * @param {string | null} [hintWflowId]
 */
async function fetchPgcCorrectionsPayload(
  page,
  projectID,
  hintWflowId = null,
  requestCtx = {},
) {
  const ctx = /** @type {PgcCorrectionsRequestContext} */ ({
    projectID: String(projectID),
    ...(requestCtx || {}),
  });
  if (hintWflowId && !ctx.wflowInstanceID) ctx.wflowInstanceID = String(hintWflowId);
  /** @type {string[]} */
  const urls = [];
  urls.push(pgcCorrectionsProbeUrlByProject(projectID, "ProjectID", ctx));
  urls.push(pgcCorrectionsProbeUrlByProject(projectID, "projectID", ctx));
  if (ctx.wflowInstanceID) urls.push(pgcCorrectionsProbeUrl(ctx.wflowInstanceID, ctx));
  // Back-compat attempts without optional context, but still no empty workflow params.
  urls.push(pgcCorrectionsProbeUrlByProject(projectID, "ProjectID"));
  urls.push(pgcCorrectionsProbeUrlByProject(projectID, "projectID"));
  if (hintWflowId) urls.push(pgcCorrectionsProbeUrl(hintWflowId));

  /** @type {{ ok: boolean, json: object | null, url: string | null, httpStatus: number }} */
  let last = { ok: false, json: null, url: null, httpStatus: 0 };
  for (const url of urls) {
    try {
      const res = await page.context().request.get(url, { timeout: 30000 });
      const text = await res.text();
      const json = parseJsonMaybe(text);
      last = { ok: res.ok(), json, url, httpStatus: res.status };
      if (!res.ok() || !json || typeof json !== "object") continue;
      const pick = pickWFlowInstanceIdFromCorrectionsBody(json);
      const corrs = /** @type {unknown[]} */ (
        /** @type {Record<string, unknown>} */ (json).Corrections ??
          /** @type {Record<string, unknown>} */ (json).corrections ??
          []
      );
      const hasCorr = Array.isArray(corrs) && corrs.length > 0;
      if (pick.id || hasCorr || extractWorkflowInstanceFromReviewPayload(json))
        return { ok: true, json, url, httpStatus: res.status };
    } catch (e) {
      last = {
        ok: false,
        json: null,
        url,
        httpStatus: 0,
      };
    }
  }
  return { ...last, ok: false };
}

/**
 * Supplementary task metadata only — not authoritative for WFlowInstanceID on PGC.
 * @param {import('playwright').Page} page
 * @param {string} projectID
 */
async function fetchPgcWorkflowTaskListMeta(page, projectID) {
  const urls = [
    pgcGetWorkflowTaskListUrl(projectID),
    `${PGC_PROJECTDOX_API_ORIGIN}/ProjectDoxWebAPI/WorkflowAggregate/GetWorkflowTaskList?ProjectID=${encodeURIComponent(
      String(projectID),
    )}`,
  ];
  for (const url of urls) {
    try {
      const res = await page.context().request.get(url, { timeout: 30000 });
      const text = await res.text();
      const json = parseJsonMaybe(text);
      if (res.ok() && json && typeof json === "object") {
        return { ok: true, url, json, httpStatus: res.status };
      }
    } catch (e) {
      /* next */
    }
  }
  return { ok: false, url: null, json: null, httpStatus: 0 };
}

/**
 * @param {string} text
 */
function parseJsonMaybe(text) {
  if (text == null || typeof text !== "string") return null;
  const t = text.trim();
  if (!t || t.startsWith("<")) return null;
  try {
    const j = JSON.parse(t);
    if (j && typeof j.d === "string") {
      try {
        return JSON.parse(j.d);
      } catch (_) {
        return j;
      }
    }
    if (j && j.d != null && typeof j.d === "object") return j.d;
    return j;
  } catch (_) {
    return null;
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function getWFlowInstanceFromTasksDom(page) {
  const frames = page.frames();
  /** @type {{ id: string, pattern: string, frameUrl?: string } | null} */
  let best = null;
  for (const fr of frames) {
    try {
      const got = await fr.evaluate(() => {
        function poolAttrs(el) {
          let s = "";
          if (!el || !el.attributes) return s;
          for (const a of el.attributes) {
            s += " " + a.name + "=" + a.value;
          }
          return s;
        }
        const dataNodes = document.querySelectorAll(
          "[data-wflowinstanceid], [data-WFlowInstanceID], [data-wFlowInstanceId]",
        );
        for (const n of dataNodes) {
          const v =
            n.getAttribute("data-wflowinstanceid") ||
            n.getAttribute("data-WFlowInstanceID") ||
            n.getAttribute("data-wFlowInstanceId") ||
            "";
          const id = String(v).trim();
          if (/^\d+$/.test(id))
            return { id, pattern: "data-wflowinstanceid-attribute" };
        }
        const cand = document.querySelectorAll(
          "a, button, tr, td, [onclick], span",
        );
        for (const el of cand) {
          const on = el.getAttribute("onclick") || "";
          const href = el.getAttribute("href") || "";
          const pool = on + " " + href + " " + poolAttrs(el);
          let m = pool.match(/wflowinstanceid\s*[=:]\s*['"]?(\d+)/i);
          if (!m) m = pool.match(/WFlowInstanceID\s*[=]\s*(\d+)/i);
          if (!m) m = pool.match(/GetWorkflow[^'"]*wflowInstanceID[=](\d+)/i);
          if (m && m[1]) return { id: m[1], pattern: "onclick-href-or-attr-regex" };
        }
        const wblocks = document.querySelectorAll(
          "[class*='workflow'], [id*='workflow'], [class*='WFlow']",
        );
        for (const block of wblocks) {
          const t = block.textContent || "";
          const m2 = t.match(/instance\s*#?\s*[:.]?\s*(\d{4,})/i);
          if (m2) return { id: m2[1], pattern: "workflow-block-text" };
        }
        return null;
      });
      if (got && got.id) {
        best = { ...got, frameUrl: fr.url().slice(0, 200) };
        break;
      }
    } catch (_) {}
  }
  return best;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectId
 * @param {string} dashboardUrl
 */
/**
 * @returns {Promise<{ ok: boolean, page: import('playwright').Page }>}
 */
async function ensureTasksTabOpen(page, projectId, dashboardUrl, projectNumber) {
  let p = page;
  let nav = await gotoPgcProjectTab(p, projectId, PGC_DETAIL_TABS.tasks.tabName, "");
  if (!nav.ok) {
    const rowOpen = await openProjectViaDashboardRow(
      p,
      dashboardUrl,
      projectId,
      projectNumber != null
        ? { projectNumber: String(projectNumber) }
        : {},
    );
    if (rowOpen.ok && rowOpen.detailPage) {
      p = rowOpen.detailPage;
    }
    if (rowOpen.ok) {
      nav = await gotoPgcProjectTab(p, projectId, PGC_DETAIL_TABS.tasks.tabName, "");
    }
  }
  if (!nav.ok) return { ok: false, page: p };
  await p.waitForTimeout(600);
  await getContentTarget(p);
  return { ok: true, page: p };
}

/**
 * @param {unknown} body
 */
function summarizeCorrectionsResponse(body) {
  if (body == null || typeof body !== "object") {
    return {
      correctionsCount: null,
      latestCycleCount: null,
      changemarkCount: null,
      commentCount: null,
      reviewGroupsCount: null,
      statusCounts: {},
      statusBuckets: {
        UnResolved: 0,
        Resolved: 0,
        "Info Only": 0,
        Question: 0,
        Other: 0,
      },
      hasCorrectionsArray: false,
      hasReviewGroupsArray: false,
      filterOptionsPresent: false,
      topLevelKeysSample: [],
      _note: "empty or non-object body",
    };
  }
  const root = /** @type {Record<string, unknown>} */ (body);
  const corrections = /** @type {unknown[]} */ (
    root.Corrections ?? root.corrections ?? []
  );
  const reviewGroups = /** @type {unknown[]} */ (
    root.ReviewGroups ?? root.reviewGroups ?? []
  );
  /** @type {Record<string, number>} */
  const statusCounts = {};
  let changemarkCount = 0;
  let commentCount = 0;

  /** PGC evidence: StatusName values such as UnResolved, Resolved, Info Only, Question */
  const statusBuckets = {
    UnResolved: 0,
    Resolved: 0,
    "Info Only": 0,
    Question: 0,
    Other: 0,
  };

  if (Array.isArray(corrections)) {
    for (const c of corrections) {
      if (!c || typeof c !== "object") continue;
      const co = /** @type {Record<string, unknown>} */ (c);
      const stNameRaw =
        co.StatusName ?? co.statusName ?? co.Status ?? co.CorrectionStatus ?? co.WFlowCorrectionStatus ?? co.State ?? "Unknown";
      const key = String(stNameRaw);
      statusCounts[key] = (statusCounts[key] || 0) + 1;
      const compact = normalizeText(String(stNameRaw)).toLowerCase().replace(/\s+/g, "");
      if (compact.includes("unresolved") || compact === "unresolved")
        statusBuckets.UnResolved += 1;
      else if (compact.includes("resolved")) statusBuckets.Resolved += 1;
      else if (compact.includes("infoonly") || compact.includes("info-only"))
        statusBuckets["Info Only"] += 1;
      else if (compact.includes("question")) statusBuckets.Question += 1;
      else statusBuckets.Other += 1;

      const cms = co.ChangeMarks ?? co.ChangeMarkList ?? co.ChangeMarkings;
      if (Array.isArray(cms)) changemarkCount += cms.length;
      else if (typeof co.ChangeMarkCount === "number")
        changemarkCount += co.ChangeMarkCount;
      const com = co.Comments ?? co.CommentList;
      if (Array.isArray(com)) commentCount += com.length;
      else if (typeof co.CommentCount === "number")
        commentCount += co.CommentCount;
    }
  }

  let latestCycleCount = null;
  if (Array.isArray(root.LatestReviewCycles))
    latestCycleCount = root.LatestReviewCycles.length;
  else if (typeof root.LatestCycleCount === "number")
    latestCycleCount = root.LatestCycleCount;
  else if (Array.isArray(root.CorrectionReviewCycles))
    latestCycleCount = root.CorrectionReviewCycles.length;

  const filterOptionsPresent =
    root.FilterOptions != null ||
    root.filterOptions != null ||
    root.RetrieveFilterOptions != null;

  return {
    correctionsCount: Array.isArray(corrections) ? corrections.length : null,
    latestCycleCount,
    changemarkCount: changemarkCount || null,
    commentCount: commentCount || null,
    reviewGroupsCount: Array.isArray(reviewGroups) ? reviewGroups.length : null,
    statusCounts,
    statusBuckets,
    hasCorrectionsArray: Array.isArray(corrections),
    hasReviewGroupsArray: Array.isArray(reviewGroups),
    filterOptionsPresent,
    topLevelKeysSample: Object.keys(root).slice(0, 35),
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} wflowInstanceID
 */
async function probeProjectCorrections(page, wflowInstanceID) {
  const url = pgcCorrectionsProbeUrl(wflowInstanceID);
  console.log("[PGC] Task 5 — Corrections probe:", url);
  try {
    const res = await page.context().request.get(url, { timeout: 30000 });
    const text = await res.text();
    const json = parseJsonMaybe(text);
    const summary = summarizeCorrectionsResponse(json);
    const looksJson =
      !!json || (text && text.trim().startsWith("{") && text.includes(":"));
    return {
      ok: res.ok() && json != null && typeof json === "object",
      httpStatus: res.status(),
      url,
      summary,
      parseFailed: res.ok() && !looksJson,
    };
  } catch (e) {
    return {
      ok: false,
      httpStatus: 0,
      url: pgcCorrectionsProbeUrl(wflowInstanceID),
      summary: summarizeCorrectionsResponse(null),
      parseFailed: true,
      error: (e && e.message) || String(e),
    };
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {object} project
 * @param {string[]} bases
 * @param {string} dashboardUrl
 */
async function resolveWorkflowAndProbeReviews(page, project, _bases, dashboardUrl) {
  const projectID = String(project.projectID);
  const projectNumber = project.projectNumber ?? null;
  const safeId = projectID.replace(/\D/g, "") || "unknown";
  const workflowFailShot = path.join(
    __dirname,
    `pgc-workflow-failed-${safeId}.png`,
  );

  const tasksTabRes = await ensureTasksTabOpen(
    page,
    projectID,
    dashboardUrl,
    project.projectNumber,
  );
  page = tasksTabRes.page;
  const tasksOpen = tasksTabRes.ok;
  if (!tasksOpen) {
    console.warn(`[PGC] Could not open tasks tab for projectID=${projectID}`);
  }

  /** @type {string | null} */
  let wflowInstanceID = null;
  let wflowInstanceStateName = null;
  let instanceName = null;
  /** @type {'workflow_instances_api' | 'tasklist_meta' | 'tasks_dom' | 'corrections_workflow_instance' | 'corrections_row' | 'missing'} */
  let source = "missing";

  if (tasksOpen) {
    try {
      const wfApiResult = await page.evaluate(async (pid) => {
        const res = await fetch(
          `https://eplans.princegeorgescountymd.gov/ProjectDoxWebAPI/Workflow/GetWorkflowInstances?projectID=${pid}`,
          { credentials: "include" },
        );
        if (!res.ok) return null;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const active =
          data.find((w) => w && w.WFlowInstanceStateName === "Active") || data[0];
        if (!active) return null;
        return {
          id: active.WFlowInstanceID != null ? String(active.WFlowInstanceID) : null,
          state:
            active.WFlowInstanceStateName != null
              ? String(active.WFlowInstanceStateName)
              : null,
          name: active.InstanceName != null ? String(active.InstanceName) : null,
        };
      }, projectID);
      if (wfApiResult?.id) {
        wflowInstanceID = wfApiResult.id;
        wflowInstanceStateName = wfApiResult.state || null;
        instanceName = wfApiResult.name || null;
        source = "workflow_instances_api";
        console.log(
          `[PGC] WFlowInstanceID=${wflowInstanceID} for projectID=${projectID}`,
        );
      } else {
        console.warn(
          `[PGC] WFlowInstanceID fetch returned no data for projectID=${projectID}`,
        );
      }
    } catch (err) {
      console.warn(
        `[PGC] WFlowInstanceID fetch failed for ${projectID}: ${(err && err.message) || err}`,
      );
    }
  }

  const taskListFetch = await fetchPgcWorkflowTaskListMeta(page, projectID);
  const ctxFromTaskList = buildCorrectionsRequestContext(
    taskListFetch.json,
    projectID,
    wflowInstanceID,
  );
  if (!wflowInstanceID && ctxFromTaskList.wflowInstanceID) {
    wflowInstanceID = String(ctxFromTaskList.wflowInstanceID);
    source = "tasklist_meta";
    console.log(
      `[PGC] WFlowInstanceID=${wflowInstanceID} for projectID=${projectID} (from task list metadata)`,
    );
  }
  if (!wflowInstanceID && tasksOpen) {
    const domFallback = await getWFlowInstanceFromTasksDom(page).catch(() => null);
    if (domFallback?.id) {
      wflowInstanceID = String(domFallback.id);
      source = "tasks_dom";
      console.log(
        `[PGC] WFlowInstanceID=${wflowInstanceID} for projectID=${projectID} (from tasks DOM: ${domFallback.pattern})`,
      );
    }
  }
  if (taskListFetch.ok) {
    console.log("[PGC] Task 5 — GetWorkflowTaskList (task metadata only):", taskListFetch.url);
  }

  const corrFetch = await fetchPgcCorrectionsPayload(
    page,
    projectID,
    wflowInstanceID,
    ctxFromTaskList,
  );
  /** @type {object | null} */
  let correctionsJson =
    corrFetch.ok && corrFetch.json && typeof corrFetch.json === "object"
      ? corrFetch.json
      : null;
  let correctionsFetchUrl = corrFetch.url;

  const wfPick = pickWFlowInstanceIdFromCorrectionsBody(correctionsJson);
  if (!wflowInstanceID && wfPick.id) {
    wflowInstanceID = wfPick.id;
    if (wfPick.source === "WorkflowInstance") source = "corrections_workflow_instance";
    else if (wfPick.source === "CorrectionRow") source = "corrections_row";
    const wfObj = wfPick.workflowInstance;
    wflowInstanceStateName = wfObj?.wflowInstanceStateName ?? wflowInstanceStateName;
    instanceName = wfObj?.instanceName ?? instanceName;
  } else if (!wflowInstanceID) {
    console.warn(`[PGC] No WFlowInstanceID found for projectID=${projectID}`);
  }

  /** @type {object | null} */
  let reviewProbe = null;

  if (correctionsJson && typeof correctionsJson === "object") {
    const summary = summarizeCorrectionsResponse(correctionsJson);
    reviewProbe = {
      ok: corrFetch.ok || summary.hasCorrectionsArray,
      httpStatus: corrFetch.httpStatus,
      correctionsCount: summary.correctionsCount,
      latestCycleCount: summary.latestCycleCount,
      changemarkCount: summary.changemarkCount,
      commentCount: summary.commentCount,
      reviewGroupsCount: summary.reviewGroupsCount,
      statusCounts: summary.statusCounts,
      statusBuckets: summary.statusBuckets,
      hasCorrectionsArray: summary.hasCorrectionsArray,
      hasReviewGroupsArray: summary.hasReviewGroupsArray,
      filterOptionsPresent: summary.filterOptionsPresent,
      topLevelKeysSample: summary.topLevelKeysSample,
      parseFailed: !corrFetch.ok && !summary.hasCorrectionsArray,
      error: null,
    };
  } else if (wflowInstanceID) {
    const probe = await probeProjectCorrections(page, wflowInstanceID);
    correctionsFetchUrl = probe.url;
    reviewProbe = {
      ok: probe.ok,
      httpStatus: probe.httpStatus,
      correctionsCount: probe.summary.correctionsCount,
      latestCycleCount: probe.summary.latestCycleCount,
      changemarkCount: probe.summary.changemarkCount,
      commentCount: probe.summary.commentCount,
      reviewGroupsCount: probe.summary.reviewGroupsCount,
      statusCounts: probe.summary.statusCounts,
      statusBuckets: probe.summary.statusBuckets,
      hasCorrectionsArray: probe.summary.hasCorrectionsArray,
      hasReviewGroupsArray: probe.summary.hasReviewGroupsArray,
      filterOptionsPresent: probe.summary.filterOptionsPresent,
      topLevelKeysSample: probe.summary.topLevelKeysSample,
      parseFailed: probe.parseFailed,
      error: probe.error || null,
    };
  }

  if (reviewProbe) {
    console.log(
      "[PGC] Task 5 — Corrections / review summary:",
      JSON.stringify(
        {
          wflowInstanceID,
          workflowSource: source,
          httpStatus: reviewProbe.httpStatus,
          correctionsCount: reviewProbe.correctionsCount,
          reviewGroupsCount: reviewProbe.reviewGroupsCount,
          statusBuckets: reviewProbe.statusBuckets,
          hasCorrectionsArray: reviewProbe.hasCorrectionsArray,
          hasReviewGroupsArray: reviewProbe.hasReviewGroupsArray,
        },
        null,
        2,
      ),
    );
  }

  if (source === "missing") {
    try {
      await page.screenshot({ path: workflowFailShot, fullPage: true });
      console.error("[PGC] Task 5 — Workflow screenshot:", workflowFailShot);
    } catch (_) {}
  }

  const payload = {
    projectID,
    projectNumber,
    workflow: {
      wflowInstanceID,
      source,
      wflowInstanceStateName,
      instanceName,
      workflowName: instanceName,
      rawWorkflowCount: wflowInstanceID ? 1 : 0,
      tasksDomPattern: null,
      correctionsPrimaryUrl: correctionsFetchUrl,
      taskListUrl: taskListFetch.url,
      taskListOk: taskListFetch.ok,
      userID: ctxFromTaskList.userID || null,
    },
    reviewProbe,
    correctionsProbeUrl: correctionsFetchUrl,
    correctionsJson,
    taskListMeta: taskListFetch.json,
  };

  console.log(
    "[PGC] Task 5 — workflow/review payload:",
    JSON.stringify(payload, null, 2),
  );

  return payload;
}

// ─── Task 6 — files tab DOM folders + controlled sample downloads ──────────

function pgcGetFolderFilesUrl(folderID) {
  const q = new URLSearchParams({
    folderID: String(folderID),
    listMode: "3",
    pageIndex: "0",
    pageSize: "999",
    pk: "FileID",
  });
  return `${PGC_API}/File/GetFolderFiles?${q.toString()}`;
}

/**
 * @param {unknown} data
 */
function parseGenericItemsArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = /** @type {Record<string, unknown>} */ (data);
  for (const key of [
    "Folders",
    "folders",
    "Items",
    "items",
    "Data",
    "data",
    "Results",
    "results",
    "Rows",
    "rows",
    "Files",
    "files",
  ]) {
    const v = o[key];
    if (Array.isArray(v)) return v;
  }
  const d = o.d;
  if (d && typeof d === "object") {
    const dObj = /** @type {Record<string, unknown>} */ (d);
    for (const key of ["Items", "items", "Folders", "folders", "Data"]) {
      const v = dObj[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/**
 * @param {object} raw
 */
function normalizeFolderRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const folderID =
    o.FolderID ?? o.folderID ?? o.FolderId ?? o.Id ?? o.ID ?? o.id;
  if (folderID == null) return null;
  const nameRaw =
    o.FolderName ?? o.folderName ?? o.Name ?? o.name ?? o.Title ?? o.title ?? "";
  const folderName = normalizeText(String(nameRaw)) || "(unnamed)";
  return { folderID: String(folderID), folderName };
}

/**
 * GetFolderFiles JSON matches the portal igGrid: FileName is often a short display label,
 * while OriginalFileName is the upload / "Original File Name" column (full name).
 * Prefer OriginalFileName when present so stored names match user expectation (e.g. not Sub.pdf).
 * @param {Record<string, unknown>} o
 */
function pickPgcFolderFileDisplayName(o) {
  const candidates = [
    o.OriginalFileName,
    o.originalFileName,
    o.DocumentName,
    o.documentName,
    o.FileName,
    o.fileName,
    o.Name,
    o.name,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const s = normalizeText(String(v));
    if (s) return s;
  }
  return "";
}

/**
 * @param {object} raw
 * @param {string} folderID
 * @param {string} folderName
 */
function normalizeFileRow(raw, folderID, folderName) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const fileID =
    o.FileID ?? o.fileID ?? o.fileId ?? o.DocumentID ?? o.documentId ?? o.Id ?? o.id;
  if (fileID == null) return null;
  const nameRaw = pickPgcFolderFileDisplayName(o);
  let fileSizeKB = null;
  const kb =
    o.FileSizeKB ?? o.fileSizeKB ?? o.SizeKB ?? o.sizeKB ?? o.FileSizeInKB;
  if (typeof kb === "number" && !Number.isNaN(kb)) fileSizeKB = kb;
  else if (typeof kb === "string" && /^\d/.test(kb)) {
    const n = parseFloat(kb);
    if (!Number.isNaN(n)) fileSizeKB = n;
  }
  const bytes =
    o.FileSizeBytes ?? o.fileSizeBytes ?? o.Size ?? o.size ?? o.FileSize ?? null;
  if (fileSizeKB == null && typeof bytes === "number" && bytes > 0) {
    fileSizeKB = Math.round(bytes / 1024);
  }
  const version =
    o.Version ?? o.version ?? o.FileVersion ?? o.fileVersion ?? null;
  const pageCount =
    typeof o.PageCount === "number"
      ? o.PageCount
      : typeof o.pageCount === "number"
        ? o.pageCount
        : null;
  const sheetSize =
    o.SheetSize != null
      ? String(o.SheetSize)
      : o.sheetSize != null
        ? String(o.sheetSize)
        : null;
  const uploadDateRaw =
    o.UploadDate ?? o.uploadDate ?? o.CreatedDate ?? o.createdDate ?? null;
  const uploadDate =
    uploadDateRaw != null ? normalizeText(String(uploadDateRaw)) : null;
  const hm = o.HasMarkups ?? o.hasMarkups ?? o.ContainsMarkups ?? o.hasRedlines;
  const hasMarkups =
    hm === true ||
    hm === 1 ||
    String(hm).toLowerCase() === "true";

  return {
    fileID: String(fileID),
    fileName: normalizeText(String(nameRaw)) || null,
    folderID: String(folderID),
    folderName,
    fileSizeKB,
    version: version != null ? normalizeText(String(version)) : null,
    pageCount,
    sheetSize,
    uploadDate,
    hasMarkups,
  };
}

function sanitizeLocalFileName(name) {
  let s = normalizeText(name || "") || "download";
  s = s.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  if (s.length > 180) s = s.slice(0, 180);
  return s || "file";
}

function guessExtensionFromMime(ct) {
  const c = (ct || "").toLowerCase();
  if (c.includes("pdf")) return ".pdf";
  if (c.includes("image/png")) return ".png";
  if (c.includes("image/jpeg")) return ".jpg";
  if (c.includes("tif")) return ".tiff";
  return "";
}

function makeAbsolutePortalUrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "#" || /^javascript:/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${PGC_BASE}${s}`;
  return `${PGC_BASE}/${s.replace(/^\/+/, "")}`;
}

function extractUrlFromOnclick(onclick) {
  const s = String(onclick || "");
  if (!s) return null;
  let m = s.match(/https?:\/\/[^'"\s)]+/i);
  if (m) return m[0];
  m = s.match(/['"]((?:\/|\.\.\/|\.\/)[^'"]+)['"]/);
  if (m) return m[1];
  return null;
}

/** Raw FileID GET pattern returns 404 on PGC — never use as primary download. */
function isDiscouragedPgcSyntheticFileDownloadUrl(u) {
  if (!u) return false;
  const s = String(u);
  return /\/File\/DownloadFile\b/i.test(s) && /[?&]FileID=/i.test(s);
}

/** UI/static paths that must never count as document downloads. */
function isDiscouragedPgcStaticAssetUrl(url) {
  if (!url) return true;
  const pathOnly = String(url).split(/[?#]/)[0].toLowerCase();
  if (/\/media\/img\//i.test(pathOnly)) return true;
  if (/\/projectdoxwebui\/media\//i.test(pathOnly)) return true;
  if (/\.(png|jpe?g|gif|svg|ico|webp|css|js|woff2?|map|eot|ttf)(\b|$)/i.test(pathOnly))
    return true;
  return false;
}

function pgcExpectedFilenameExtension(name) {
  const m = String(name || "")
    .trim()
    .toLowerCase()
    .match(/(\.[a-z0-9]{2,10})$/i);
  return m ? m[1].toLowerCase() : "";
}

/**
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {{ url?: string, status?: number, contentType?: string, contentDisposition?: string, byteLength?: number, buffer?: Buffer }} candidate
 */
function logPgcFileResponseRejected(fileMeta, candidate, rejectReason) {
  console.log(
    "[PGC] File response REJECTED:",
    fileMeta.name || fileMeta.fileId,
    "| reason:",
    rejectReason,
    "| url:",
    (candidate.url || "").slice(0, 220),
    "| status:",
    candidate.status,
    "| ct:",
    candidate.contentType,
    "| bytes:",
    candidate.byteLength ?? candidate.buffer?.length,
  );
}

/**
 * Strict validation: reject UI assets, wrong types vs expected extension, bad PDF magic.
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {{ url?: string, status?: number, contentType?: string, contentDisposition?: string, byteLength?: number, buffer?: Buffer }} candidate
 */
function isValidPgcFileResponse(fileMeta, candidate) {
  const url = String(candidate.url || "");
  const st = candidate.status ?? 0;
  const ct = (candidate.contentType || "").toLowerCase();
  const cd = (candidate.contentDisposition || "").toLowerCase();
  const buf = candidate.buffer;
  const len = candidate.byteLength ?? (buf ? buf.length : 0);
  const wantName = normalizeText(String(fileMeta.name || "")).toLowerCase();
  const base =
    wantName.includes("/") || wantName.includes("\\")
      ? wantName.replace(/.*[/\\]/, "")
      : wantName;
  const wantId = String(fileMeta.fileId || "").trim();
  const ext = pgcExpectedFilenameExtension(fileMeta.name);
  const pdfMagicOk =
    buf &&
    buf.length >= 4 &&
    buf.slice(0, 4).toString("latin1") === "%PDF";

  if (st !== 200) {
    return {
      ok: false,
      rejectReason: "http_non_200",
      summary: { url, status: st, contentType: ct, byteLength: len },
    };
  }
  if (isDiscouragedPgcStaticAssetUrl(url)) {
    return {
      ok: false,
      rejectReason: "static_asset_response",
      summary: { url, status: st, contentType: ct, byteLength: len },
    };
  }

  if (len > 0 && len < 500) {
    if (!(ext === ".pdf" && pdfMagicOk && len >= 64)) {
      return {
        ok: false,
        rejectReason: "tiny_payload_ui_asset",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
  }

  if (buf && buf.length >= 3) {
    const peek = buf.slice(0, 64).toString("utf8").toLowerCase();
    if (
      peek.includes("<!doctype") ||
      peek.includes("<html") ||
      peek.includes("<script")
    ) {
      return {
        ok: false,
        rejectReason: "html_error_body",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
  }

  const urlHasId = wantId && url.includes(wantId);
  const cdHasName = base && cd && cd.includes(base);
  const urlHasName = base && url.toLowerCase().includes(encodeURI(base).toLowerCase());

  if (ext === ".pdf") {
    if (ct.startsWith("image/")) {
      return {
        ok: false,
        rejectReason: "content_type_mismatch",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
    if (buf && buf.length >= 4) {
      const sig = buf.slice(0, 4).toString("latin1");
      if (sig !== "%PDF") {
        return {
          ok: false,
          rejectReason: "pdf_signature_missing",
          summary: { url, status: st, contentType: ct, byteLength: len },
        };
      }
      if (len >= 500) {
        return {
          ok: true,
          summary: { url, status: st, contentType: ct, byteLength: len },
        };
      }
    } else if (!buf || buf.length === 0) {
      if (!ct.includes("pdf") && !cd.includes(".pdf") && !cd.includes("pdf")) {
        return {
          ok: false,
          rejectReason: "content_type_mismatch",
          summary: { url, status: st, contentType: ct, byteLength: len },
        };
      }
    }
    const pdfCtOk = ct.includes("pdf") || ct.includes("octet-stream");
    const hinted =
      cdHasName ||
      urlHasId ||
      (base && url.toLowerCase().includes(base)) ||
      cd.includes("attachment");
    if (!hinted && !pdfCtOk && len > 0) {
      return {
        ok: false,
        rejectReason: "row_click_unrelated_response",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
  } else if (/\.(png|jpe?g|gif|tiff?|webp|bmp)$/i.test(ext)) {
    const need =
      ext === ".png"
        ? "image/png"
        : /\.jpe?g$/i.test(ext)
          ? "image/jpeg"
          : "image/";
    if (!ct.startsWith(need === "image/" ? "image/" : need)) {
      return {
        ok: false,
        rejectReason: "content_type_mismatch",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
  } else if (ext && ext !== "") {
    if (ct.includes("image/png") || ct.includes("image/gif")) {
      return {
        ok: false,
        rejectReason: "content_type_mismatch",
        summary: { url, status: st, contentType: ct, byteLength: len },
      };
    }
  }

  return { ok: true, summary: { url, status: st, contentType: ct, byteLength: len } };
}

/** Alias for strict download validation (viewer flow + row fetch). */
function isValidPgcDownloadedFile(candidate, fileMeta) {
  return isValidPgcFileResponse(fileMeta, candidate);
}

/** Brava / ActiveX viewer support traffic — not the document payload by default. */
function pgcUrlIsViewerSupportMetadata(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return true;
  if (/searchindices/i.test(u)) return true;
  if (/\/bravaserver\/search\//i.test(u)) return true;
  if (/\/bravaserver\/[^/]*\/search\//i.test(u)) return true;
  if (/bravaserver.*\/tiles?(\/|$)/i.test(u)) return true;
  if (/\/bravaserver\/raster\//i.test(u)) return true;
  if (/\/bravaserver\/vector\//i.test(u)) return true;
  if (/\/thumb(\/|$)/i.test(u)) return true;
  if (/configprovider\.aspx/i.test(u)) return true;
  if (/markuphandler\.aspx/i.test(u)) return true;
  if (/client\.html/i.test(u)) return true;
  return false;
}

/**
 * Real Brava export: `/BravaServer/publishtoformat/<doc>/<export>/pdf` (often on `:8443`).
 * @param {string} url
 */
function isPgcBravaPublishToPdfUrl(url) {
  const path = String(url || "").split(/[?#]/)[0];
  if (!/\/BravaServer\/publishtoformat\//i.test(path)) return false;
  return /\/pdf$/i.test(path);
}

/**
 * Validated published PDF from Brava publish-to-format only (not generic viewer GETs).
 * @param {{ url?: string, status?: number, contentType?: string, contentDisposition?: string, byteLength?: number, buffer?: Buffer }} candidate
 * @param {{ name?: string|null, fileId?: string|null }} _fileMeta
 */
function isValidPgcPublishedPdf(candidate, _fileMeta) {
  const url = String(candidate.url || "");
  if (!isPgcBravaPublishToPdfUrl(url)) {
    return {
      ok: false,
      rejectReason: "not_brava_publish_pdf_url",
      summary: { url },
    };
  }
  const st = candidate.status ?? 0;
  if (st !== 200) {
    return {
      ok: false,
      rejectReason: st === 0 ? "unreadable_brava_request" : "http_non_200",
      summary: { url, status: st },
    };
  }
  const buf = candidate.buffer;
  const len = candidate.byteLength ?? (buf ? buf.length : 0);
  if (!buf || len < 500) {
    return {
      ok: false,
      rejectReason: "no_document_payload_seen",
      summary: { url, byteLength: len },
    };
  }
  const sig = buf.slice(0, 4).toString("latin1");
  const ct = (candidate.contentType || "").toLowerCase();
  if (sig !== "%PDF" && !ct.includes("pdf")) {
    return {
      ok: false,
      rejectReason: "pdf_signature_missing",
      summary: { url, contentType: ct },
    };
  }
  const peek = buf.slice(0, 96).toString("utf8").toLowerCase();
  if (peek.includes("<!doctype") || peek.includes("<html")) {
    return {
      ok: false,
      rejectReason: "html_error_body",
      summary: { url },
    };
  }
  if (pgcUrlIsViewerSupportMetadata(url) || pgcUrlIsBravaNonPublishNoiseUrl(url)) {
    return {
      ok: false,
      rejectReason: "viewer_support_request_only",
      summary: { url },
    };
  }
  return { ok: true, summary: { url, byteLength: len, contentType: ct } };
}

/** URLs that may be logged but must never be chosen as the final document payload. */
function pgcUrlIsBravaNonPublishNoiseUrl(url) {
  const u = String(url || "").toLowerCase();
  if (/\/bravaserver\/search\//i.test(u)) return true;
  if (/\/bravaserver\/raster\//i.test(u)) return true;
  if (/\/bravaserver\/vector\//i.test(u)) return true;
  if (/\/thumb(\/|$)/i.test(u)) return true;
  if (/searchindices/i.test(u)) return true;
  if (/configprovider\.aspx/i.test(u)) return true;
  if (/markuphandler\.aspx/i.test(u)) return true;
  if (/client\.html/i.test(u)) return true;
  return false;
}

/**
 * Strict acceptance for bytes fetched from the viewer context (post–ActiveX open).
 * @param {{ url?: string, status?: number, contentType?: string, contentDisposition?: string, byteLength?: number, buffer?: Buffer }} candidate
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
function isValidPgcViewerDocument(candidate, fileMeta) {
  const url = String(candidate.url || "");
  if (pgcUrlIsViewerSupportMetadata(url)) {
    return {
      ok: false,
      rejectReason: "viewer_support_request_only",
      summary: { url, status: candidate.status },
    };
  }
  const st = candidate.status ?? 0;
  if (st === 0) {
    return {
      ok: false,
      rejectReason: "unreadable_brava_request",
      summary: { url, status: st },
    };
  }
  if (st !== 200) {
    return {
      ok: false,
      rejectReason: "http_non_200",
      summary: { url, status: st },
    };
  }
  const buf = candidate.buffer;
  const len = candidate.byteLength ?? (buf ? buf.length : 0);
  if (!buf || len === 0) {
    return {
      ok: false,
      rejectReason: "no_document_payload_seen",
      summary: { url, status: st, byteLength: len },
    };
  }
  return isValidPgcFileResponse(fileMeta, candidate);
}

/**
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {string} decision
 * @param {string} reason
 * @param {string} url
 * @param {Record<string, unknown>} [extra]
 */
function logPgcViewerDocCandidate(fileMeta, decision, reason, url, extra = {}) {
  console.log(
    "[PGC] Viewer document candidate:",
    fileMeta.name || fileMeta.fileId,
    "|",
    decision,
    "|",
    reason,
    "| url:",
    String(url).slice(0, 240),
    "|",
    JSON.stringify(extra),
  );
}

function pgcEscapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {Buffer} buf
 * @param {string} [contentType]
 * @param {string} [contentDisposition]
 */
function pgcBufferLooksLikeFileBinary(buf, contentType, contentDisposition) {
  const ct = (contentType || "").toLowerCase();
  const cd = (contentDisposition || "").toLowerCase();
  if (!buf || buf.length < 64) return false;
  const peek = buf.slice(0, 80).toString("utf8").toLowerCase();
  if (
    peek.includes("<!doctype") ||
    peek.includes("<html") ||
    peek.includes("<script") ||
    peek.includes("object reference") ||
    peek.includes("unexpected error")
  ) {
    return false;
  }
  if (cd.includes("attachment") && cd.includes("filename")) return true;
  if (cd.includes("inline") && /\.(pdf|png|jpe?g|gif|tiff?|zip)\b/i.test(cd))
    return true;
  if (ct.includes("application/pdf") || ct.includes("/pdf")) return true;
  if (ct.includes("octet-stream")) return true;
  if (ct.startsWith("image/")) return true;
  if (ct.includes("msword") || ct.includes("spreadsheet") || ct.includes("zip"))
    return true;
  const b0 = buf[0];
  const b1 = buf[1];
  if (b0 === 0x25 && b1 === 0x50) return true;
  if (b0 === 0x50 && b1 === 0x4b) return true;
  if (b0 === 0x89 && b1 === 0x50) return true;
  if (buf.length >= 512 && buf.slice(0, 256).includes(0)) return true;
  return false;
}

/**
 * Navigate to Files tab and log browser-truth context (URL, title, body sample, DOM hints).
 * @param {import('playwright').Page} page
 * @param {string} projectID
 */
async function openPgcFilesTab(page, projectID) {
  const nav = await gotoPgcProjectTab(page, String(projectID), "filesTab", "");
  const url = page.url();
  const title = (await page.title().catch(() => "")) || "";
  const lines = await page
    .evaluate(() => {
      const body = String(document.body?.innerText || "");
      return body
        .split(/\r?\n/)
        .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 40);
    })
    .catch(() => []);
  console.log("[PGC] Files tab context URL:", url);
  console.log("[PGC] Files tab context title:", title);
  console.log("[PGC] Files tab body lines (first ~40):", lines);
  const visible = await page
    .evaluate(() => ({
      folderTree: !!document.querySelector("#folderTree"),
      folderNodes: document.querySelectorAll("#folderTree li.ui-igtree-node")
        .length,
      gridRows: document.querySelectorAll(
        ".ui-iggrid-table tbody tr, table tbody tr",
      ).length,
      filesTabInHref: /tab=filestab/i.test(String(location.href || "")),
      filesTabLinkPresent: !!document.querySelector('a[href*="filesTab"]'),
    }))
    .catch(() => ({}));
  console.log(
    "[PGC] Files tab visible / structure:",
    JSON.stringify(visible),
  );
  return { ...nav, visible };
}

/**
 * DOM-truth snapshot of the Files tab folder tree (counts + first ~20 nodes).
 * @param {import('playwright').Page} page
 */
async function inspectPgcFolderTreeDom(page) {
  return page
    .evaluate(() => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      /** @type {string[]} */
      const containers = [];
      for (const sel of [
        "#folderTree",
        ".ui-igtree",
        "#divFolderTree",
        "[id*='FolderTree']",
      ]) {
        try {
          if (document.querySelector(sel)) containers.push(sel);
        } catch (_) {}
      }
      const nodeList = Array.from(
        document.querySelectorAll("#folderTree li.ui-igtree-node"),
      );
      const sampleNodes = nodeList.slice(0, 20).map((el, index) => {
        const a =
          el.querySelector && el.querySelector("a")
            ? el.querySelector("a")
            : null;
        const text = norm(a?.textContent || el.textContent || "");
        /** @type {Record<string, string>} */
        const dataAttrs = {};
        if (el.attributes) {
          for (const attr of el.attributes) {
            if (attr.name.startsWith("data-"))
              dataAttrs[attr.name] = String(attr.value || "").slice(0, 160);
          }
        }
        return {
          index,
          tag: el.tagName,
          id: el.id || null,
          className: String(el.className || "").slice(0, 140),
          visibleText: text.slice(0, 120),
          dataAttrs,
          dataValue: el.getAttribute("data-value"),
          dataPath: el.getAttribute("data-path"),
          ariaExpanded: el.getAttribute("aria-expanded"),
          href: a?.getAttribute("href")
            ? a.getAttribute("href").slice(0, 200)
            : null,
          onclick: (
            a?.getAttribute("onclick") ||
            el.getAttribute("onclick") ||
            ""
          ).slice(0, 220),
        };
      });
      let parentLike = 0;
      let childLike = 0;
      for (const el of nodeList) {
        const path = el.getAttribute("data-path") || "";
        const depth = (path.match(/_L/g) || []).length;
        if (depth <= 1) parentLike += 1;
        else childLike += 1;
      }
      return {
        containersFound: containers,
        totalTreeNodes: nodeList.length,
        parentLikeCount: parentLike,
        childLikeCount: childLike,
        sampleNodes,
      };
    })
    .catch(() => ({
      containersFound: [],
      totalTreeNodes: -1,
      parentLikeCount: 0,
      childLikeCount: 0,
      sampleNodes: [],
      error: "inspect_eval_failed",
    }));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} label
 */
async function logPgcFilesTreeSnapshot(page, label) {
  const url = page.url();
  const title = (await page.title().catch(() => "")) || "";
  const lines = await page
    .evaluate(() => {
      const body = String(document.body?.innerText || "");
      return body
        .split(/\r?\n/)
        .map((l) => l.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 40);
    })
    .catch(() => []);
  const tree = await inspectPgcFolderTreeDom(page);
  pgcProgress.pgcLogDetail(`files_tree_snapshot:${label}`, {
    url,
    title,
    bodyLines: lines,
    treeDom: tree,
  });
  console.log(
    `[PGC] Files tree snapshot [${label}] | lines:${lines.length} nodes:${Array.isArray(tree) ? tree.length : "?"} | detail → pgc-debug-detail.log`,
  );
}

/**
 * Locate folder tree node metadata (folderID-first; names disambiguate duplicates).
 * @param {import('playwright').Page} page
 * @param {{ folderID: string, folderName?: string, parentFolder?: string }} folderMeta
 */
async function findPgcFolderTreeNode(page, folderMeta) {
  const fid = String(folderMeta.folderID || "").trim();
  const fname = normalizeText(folderMeta.folderName || "").toLowerCase();
  const pnorm = normalizeText(folderMeta.parentFolder || "").toLowerCase();
  const n = await page
    .locator("#folderTree")
    .locator(`[data-value="${fid}"]`)
    .count()
    .catch(() => 0);
  if (n > 0) {
    return {
      found: true,
      strategy: "data-value-exact",
      locatorCount: n,
      detail: null,
    };
  }
  const deep = await page
    .evaluate(
      ({ fid, fname, pnorm }) => {
        function norm(s) {
          return String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        }
        const tree = document.querySelector("#folderTree");
        if (!tree) return { found: false, strategy: "no_folderTree" };
        const cand = Array.from(
          tree.querySelectorAll("li, a, span, div"),
        ).filter((el) => {
          const html = el.outerHTML || "";
          if (!html.includes(fid)) return false;
          const dv = el.getAttribute && el.getAttribute("data-value");
          if (dv === fid) return true;
          const oc = el.getAttribute && el.getAttribute("onclick");
          if (oc && oc.includes(fid)) return true;
          const id = el.id || "";
          if (id.includes(fid)) return true;
          return false;
        });
        for (const el of cand) {
          const li = el.closest && el.closest("li.ui-igtree-node");
          const a = li?.querySelector("a");
          const label = norm(a?.textContent || "");
          if (fname && label && !label.includes(fname) && fname !== label)
            continue;
          if (pnorm && li) {
            let p = li.parentElement;
            let sawParent = false;
            for (let i = 0; i < 8 && p; i += 1, p = p.parentElement) {
              const t = norm(p.textContent || "").slice(0, 200);
              if (t.includes(pnorm)) {
                sawParent = true;
                break;
              }
            }
            if (!sawParent && pnorm) continue;
          }
          return {
            found: true,
            strategy: "fid-in-markup-plus-label",
            tag: el.tagName,
            snippet: (el.outerHTML || "").replace(/\s+/g, " ").slice(0, 400),
          };
        }
        return { found: false, strategy: "no_match" };
      },
      { fid, fname, pnorm },
    )
    .catch(() => ({ found: false, strategy: "evaluate_error" }));
  return deep;
}

/**
 * Expand top-level parent branch so nested `data-value=childId` nodes mount.
 * @param {import('playwright').Page} page
 * @param {string} parentFolderName
 */
async function expandPgcParentFolder(page, parentFolderName) {
  const pnorm = normalizeText(parentFolderName || "").trim();
  if (!pnorm) {
    return {
      parentFound: false,
      parentExpanded: false,
      used: "empty_parent_name",
    };
  }
  const targetLower = pnorm.toLowerCase();

  const state = await page
    .evaluate((tLower) => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      }
      const lis = Array.from(
        document.querySelectorAll("#folderTree li.ui-igtree-node"),
      );
      for (const li of lis) {
        const path = li.getAttribute("data-path") || "";
        const depth = (path.match(/_L/g) || []).length;
        if (depth !== 1) continue;
        const a = li.querySelector("a");
        const label = norm(a?.textContent || "");
        if (!label.includes(tLower) && label !== tLower) continue;
        const expanded =
          li.classList.contains("ui-igtree-node-expanded") ||
          li.classList.contains("ui-state-expanded") ||
          li.getAttribute("aria-expanded") === "true";
        const expander = li.querySelector(
          ".ui-igtree-expander, [class*='igtree-expander'], span.ui-icon-triangle-1-e, span.ui-icon-triangle-1-s, .ui-icon",
        );
        return {
          found: true,
          expanded,
          hasExpander: !!expander,
        };
      }
      return { found: false, expanded: false, hasExpander: false };
    }, targetLower);

  if (!state.found) {
    const loc = page
      .locator("#folderTree li.ui-igtree-node")
      .filter({ hasText: new RegExp(pgcEscapeRegExp(pnorm), "i") })
      .first();
    const vis = await loc.isVisible().catch(() => false);
    if (vis) {
      const exp = loc
        .locator(".ui-igtree-expander, [class*='expander'], .ui-icon-triangle-1-e")
        .first();
      if (await exp.isVisible().catch(() => false)) {
        await exp.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        return {
          parentFound: true,
          parentExpanded: true,
          used: "playwright_expander",
        };
      }
      await loc.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      return { parentFound: true, parentExpanded: true, used: "playwright_li" };
    }
    return { parentFound: false, parentExpanded: false, used: "parent_not_found" };
  }

  if (state.expanded) {
    return {
      parentFound: true,
      parentExpanded: true,
      used: "already_expanded",
    };
  }

  const jsClick = await page.evaluate((tLower) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }
    const lis = Array.from(
      document.querySelectorAll("#folderTree li.ui-igtree-node"),
    );
    for (const li of lis) {
      const path = li.getAttribute("data-path") || "";
      if ((path.match(/_L/g) || []).length !== 1) continue;
      const a = li.querySelector("a");
      const label = norm(a?.textContent || "");
      if (!label.includes(tLower) && label !== tLower) continue;
      const expander = li.querySelector(
        ".ui-igtree-expander, [class*='igtree-expander'], span.ui-icon-triangle-1-e, span.ui-icon-triangle-1-s",
      );
      if (expander) {
        expander.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        return "js_expander";
      }
      if (a) {
        a.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        return "js_anchor";
      }
    }
    return null;
  }, targetLower);

  await page.waitForTimeout(700);
  return {
    parentFound: true,
    parentExpanded: !!jsClick,
    used: jsClick || "expand_failed_no_control",
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ knownFileNames?: string[], files?: { name?: string }[] }} folderMeta
 */
async function evaluatePgcFilesGridTruth(page, folderMeta) {
  const knownList = [
    ...(folderMeta.knownFileNames || []),
    ...(Array.isArray(folderMeta.files)
      ? folderMeta.files
          .map((x) => (x && typeof x === "object" ? x.name : x))
          .filter(Boolean)
      : []),
  ].map((s) => normalizeText(String(s)));

  return page
    .evaluate(({ knownNames }) => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const body = String(document.body?.innerText || "");
      const bodyL = body.toLowerCase();
      const m = body.match(/(\d+)\s+of\s+(\d+)\s+files/i);
      const y = m ? parseInt(m[2], 10) : 0;
      const grd = document.querySelector("#grdFiles");
      const gridHtml = grd ? grd.innerHTML : "";
      const templatePlaceholdersInGrid =
        /\$\{\s*FileID\s*\}/.test(gridHtml) ||
        /\$\{\s*FileName\s*\}/.test(gridHtml) ||
        /\$\{\s*Thumbnail\s*\}/.test(gridHtml);
      const dataIdRows = grd
        ? Array.from(grd.querySelectorAll("tr[data-id]"))
        : [];
      const viewFileAnchors = Array.from(
        document.querySelectorAll('a[href*="viewFile("]'),
      );
      const infoAnchors = Array.from(
        document.querySelectorAll('a[href*="viewInfo("]'),
      );
      let knownFilenameVisible = false;
      for (const n of knownNames) {
        const nn = norm(n).toLowerCase();
        if (nn.length > 2 && bodyL.includes(nn)) knownFilenameVisible = true;
      }
      const zeroOfZero = /\b0\s+of\s+0\s+files\b/i.test(bodyL);
      const rowTextsSample = dataIdRows.slice(0, 10).map((tr) =>
        norm(tr.innerText).slice(0, 220),
      );
      return {
        countText: m ? m[0] : null,
        totalY: y,
        dataIdRowCount: dataIdRows.length,
        viewFileLinkCount: viewFileAnchors.length,
        infoLinkCount: infoAnchors.length,
        templatePlaceholdersInGrid,
        zeroOfZeroFiles: zeroOfZero,
        knownFilenameVisible,
        rowTextsSample,
      };
    }, { knownNames: knownList })
    .catch(() => ({
      countText: null,
      totalY: 0,
      dataIdRowCount: 0,
      viewFileLinkCount: 0,
      infoLinkCount: 0,
      templatePlaceholdersInGrid: false,
      zeroOfZeroFiles: true,
      knownFilenameVisible: false,
      rowTextsSample: [],
    }));
}

/**
 * @param {import('playwright').Page} page
 * @param {{ knownFileNames?: string[], files?: unknown[] }} folderMeta
 * @param {string} label
 */
async function logPgcFilesGridTruth(page, folderMeta, label) {
  const url = page.url();
  const title = (await page.title().catch(() => "")) || "";
  const g = await evaluatePgcFilesGridTruth(page, folderMeta);
  pgcProgress.pgcLogDetail(`files_grid_truth:${label}`, { url, title, gridTruth: g });
  console.log(
    `[PGC] Files grid truth [${label}] | rows:${g.dataIdRowCount} viewFile:${g.viewFileLinkCount} | ${g.countText || "no count"} | detail → pgc-debug-detail.log`,
  );
  return g;
}

/**
 * Generic grid sanity after folder select: non-empty data, no template shell,
 * fingerprint changed when switching from a previous folder (debug-only filename hints).
 * @param {import('playwright').Page} page
 * @param {{
 *   folderID?: string,
 *   folderName?: string,
 *   parentFolder?: string,
 *   knownFileNames?: string[],
 *   expectedFilesCount?: number|null,
 * }} folderMeta
 * @param {{
 *   previousFingerprint?: string | null,
 *   currentFingerprint?: string,
 *   truth?: Awaited<ReturnType<typeof evaluatePgcFilesGridTruth>>,
 *   rowTexts?: string[],
 * }} [ctx]
 */
async function assertPgcGridBelongsToFolder(page, folderMeta, ctx = {}) {
  const truth =
    ctx.truth ?? (await evaluatePgcFilesGridTruth(page, folderMeta));
  const rowTexts =
    ctx.rowTexts ??
    (await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("#grdFiles tr[data-id]")).map(
          (tr) =>
            String(tr.innerText || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
        ),
      )
      .catch(() => []));
  const currentFingerprint =
    ctx.currentFingerprint ?? (await getPgcGridFingerprint(page));
  const prevFp = ctx.previousFingerprint;

  const knownList = [
    ...(folderMeta.knownFileNames || []),
    ...(Array.isArray(folderMeta.files)
      ? folderMeta.files
          .map((x) => (x && typeof x === "object" ? x.name : x))
          .filter(Boolean)
      : []),
  ].map((s) => normalizeText(String(s)));
  const bases = knownList
    .map((n) => {
      const nl = n.toLowerCase();
      return nl.includes("/") || nl.includes("\\")
        ? nl.replace(/.*[/\\]/, "")
        : nl;
    })
    .filter((b) => b.length > 2);
  let filenameHintMatch = false;
  for (const base of bases) {
    for (const rt of rowTexts) {
      if (rt.toLowerCase().includes(base)) {
        filenameHintMatch = true;
        break;
      }
    }
    if (filenameHintMatch) break;
  }
  pgcProgress.pgcLogDetail("pgc_grid_belong_filename_hints_debug", {
    folderID: folderMeta.folderID,
    parentFolder: folderMeta.parentFolder,
    folderName: folderMeta.folderName,
    filenameHintMatch,
    hintBasesSample: bases.slice(0, 12),
    rowTextsSample: rowTexts.slice(0, 8),
    dataIdRowCount: truth.dataIdRowCount,
    viewFileLinkCount: truth.viewFileLinkCount,
    fingerprintChanged:
      typeof prevFp === "string" &&
      prevFp.length > 0 &&
      currentFingerprint !== prevFp,
  });

  if (truth.templatePlaceholdersInGrid) {
    return {
      ok: false,
      error: "stale_grid_after_folder_switch",
      diagnostics: { reason: "template_placeholders", truth },
    };
  }

  const hasGridRows =
    truth.dataIdRowCount > 0 || truth.viewFileLinkCount > 0;
  if (!hasGridRows && !truth.zeroOfZeroFiles) {
    return {
      ok: false,
      error: "stale_grid_after_folder_switch",
      diagnostics: { reason: "no_rows_or_links", truth },
    };
  }

  const exp =
    folderMeta.expectedFilesCount != null &&
    !Number.isNaN(Number(folderMeta.expectedFilesCount))
      ? Number(folderMeta.expectedFilesCount)
      : null;
  if (exp != null && exp > 0 && !hasGridRows) {
    return {
      ok: false,
      error: "stale_grid_after_folder_switch",
      diagnostics: { reason: "expected_non_empty_folder", exp, truth },
    };
  }

  const hadPrevious =
    typeof prevFp === "string" && String(prevFp).length > 0;
  if (hadPrevious && currentFingerprint === prevFp) {
    console.log(
      "[PGC] Stale grid | folder",
      folderMeta.folderID,
      "| fingerprint unchanged after switch | detail → pgc-debug-detail.log",
    );
    pgcProgress.pgcLogDetail("stale_grid_fingerprint_unchanged", {
      folderID: folderMeta.folderID,
      truth,
    });
    return {
      ok: false,
      error: "stale_grid_after_folder_switch",
      diagnostics: {
        reason: "fingerprint_unchanged_after_folder_switch",
        truth,
        rowTextsSample: rowTexts.slice(0, 12),
      },
    };
  }

  return {
    ok: true,
    diagnostics: {
      filenameHintMatch,
      truth,
      rowTextsSample: rowTexts.slice(0, 8),
      currentFingerprint,
    },
  };
}

/**
 * Stable fingerprint of current #grdFiles rows (for folder-switch sanity).
 * @param {import('playwright').Page} page
 */
async function getPgcGridFingerprint(page) {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll("#grdFiles tr[data-id]"))
        .map((tr) =>
          String(tr.innerText || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .join("\n|#ROW#|\n"),
    )
    .catch(() => "");
}

/**
 * @param {import('playwright').Page} page
 * @param {{ knownFileNames?: string[], files?: { name?: string }[] }} folderMeta
 */
async function getPgcGridTruth(page, folderMeta) {
  return evaluatePgcFilesGridTruth(page, folderMeta);
}

/**
 * Strict grid vs harvest metadata (after stale guard passes elsewhere).
 * @param {{
 *   folderID?: string,
 *   folderName?: string,
 *   parentFolder?: string,
 *   knownFileNames?: string[],
 *   expectedFilesCount?: number|null,
 *   files?: { name?: string }[],
 * }} folderMeta
 * @param {Awaited<ReturnType<typeof evaluatePgcFilesGridTruth>>} truth
 * @param {string[]} rowTexts
 * @param {{ previousFingerprint?: string | null, currentFingerprint?: string }} [opts]
 */
function gridMatchesPgcFolder(folderMeta, truth, rowTexts, opts = {}) {
  const exp =
    folderMeta.expectedFilesCount != null &&
    !Number.isNaN(Number(folderMeta.expectedFilesCount))
      ? Number(folderMeta.expectedFilesCount)
      : null;

  const y = truth.totalY;
  const dr = truth.dataIdRowCount;
  const countExact =
    exp == null || exp <= 0 || y === exp || dr === exp;
  const countClose =
    exp != null &&
    exp > 0 &&
    dr > 0 &&
    Math.abs(dr - exp) <= Math.max(1, Math.min(3, Math.floor(exp * 0.2)));
  const countPlausible = countExact || countClose;

  const prev = opts.previousFingerprint;
  const cur = opts.currentFingerprint;
  const fpChanged =
    typeof prev === "string" &&
    prev.length > 0 &&
    typeof cur === "string" &&
    cur.length > 0 &&
    prev !== cur;
  const isFirstFolder = !prev || String(prev).length === 0;

  if (truth.templatePlaceholdersInGrid) {
    return { ok: false, error: "stale_grid_after_folder_switch" };
  }

  const hasGridRows = dr > 0 || truth.viewFileLinkCount > 0;
  if (!hasGridRows && !truth.zeroOfZeroFiles) {
    return { ok: false, error: "stale_grid_after_folder_switch" };
  }

  if (exp != null && exp > 0 && !hasGridRows) {
    return { ok: false, error: "stale_grid_after_folder_switch" };
  }

  if (isFirstFolder) {
    return hasGridRows ? { ok: true } : { ok: false, error: "stale_grid_after_folder_switch" };
  }

  if (fpChanged || countPlausible) {
    return { ok: true };
  }

  return { ok: false, error: "folder_grid_count_mismatch" };
}

/**
 * Close viewer tabs, dismiss UI noise, return to Files tab before the next folder.
 * @param {import('playwright').Page} mainPage
 * @param {string} projectID
 */
async function resetPgcFolderDownloadState(mainPage, projectID) {
  await mainPage.keyboard.press("Escape").catch(() => {});
  await mainPage.waitForTimeout(120);
  try {
    const pages = mainPage.context().pages();
    for (const p of pages) {
      if (p === mainPage) continue;
      const u = (p.url() || "").toLowerCase();
      if (
        /activexviewer\.aspx/i.test(u) ||
        /bravaserver/i.test(u) ||
        /reportviewer\.aspx/i.test(u)
      ) {
        await p.close().catch(() => {});
      }
    }
  } catch (_) {}
  await mainPage.keyboard.press("Escape").catch(() => {});
  await mainPage.waitForTimeout(100);
  if (projectID) {
    await openPgcFilesTab(mainPage, String(projectID));
    await mainPage.waitForTimeout(450);
  }
}

/**
 * Activate tree folder + verify grid; one retry after Files tab refresh on failure.
 * @param {import('playwright').Page} page
 * @param {{
 *   folderID: string,
 *   folderName?: string,
 *   parentFolder?: string,
 *   knownFileNames?: string[],
 *   expectedFilesCount?: number|null,
 *   files?: unknown[],
 * }} folderMeta
 * @param {unknown} _allFolderMeta reserved for future tree hints
 * @param {{ projectID: string, previousFingerprint?: string | null }} ctx
 */
async function activatePgcFolderAndVerifyGrid(
  page,
  folderMeta,
  _allFolderMeta,
  ctx,
) {
  const projectID = String(ctx.projectID || "");
  const prevFp = ctx.previousFingerprint;

  const attempt = async (tag) => {
    const sel = await openPgcChildFolder(page, folderMeta);
    if (!sel.ok) {
      return {
        ok: false,
        error: "folder_activation_failed",
        diagnostics: sel.diagnostics,
        tag,
      };
    }
    await page.waitForTimeout(450);
    const loaded = await verifyPgcFolderGridLoaded(page, folderMeta);
    if (!loaded.ok) {
      return {
        ok: false,
        error: "folder_activation_failed",
        diagnostics: { phase: "grid_load", loaded },
        tag,
      };
    }
    const truth = await getPgcGridTruth(page, folderMeta);
    const rowTexts = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("#grdFiles tr[data-id]")).map(
          (tr) =>
            String(tr.innerText || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
        ),
      )
      .catch(() => []);
    const currentFingerprint = await getPgcGridFingerprint(page);
    const belong = await assertPgcGridBelongsToFolder(page, folderMeta, {
      previousFingerprint: prevFp,
      currentFingerprint,
      truth,
      rowTexts,
    });
    if (!belong.ok) {
      return {
        ok: false,
        error: belong.error || "stale_grid_after_folder_switch",
        diagnostics: belong.diagnostics,
        tag,
      };
    }
    const strict = gridMatchesPgcFolder(folderMeta, truth, rowTexts, {
      previousFingerprint: prevFp,
      currentFingerprint,
    });
    if (!strict.ok) {
      return {
        ok: false,
        error: strict.error,
        diagnostics: { truth, rowTextsSample: rowTexts.slice(0, 10) },
        tag,
      };
    }
    return {
      ok: true,
      fingerprint: currentFingerprint,
      truth,
      tag,
    };
  };

  let r = await attempt("primary");
  if (r.ok) return r;

  console.warn(
    "[PGC] Folder activation retry after Files tab refresh |",
    folderMeta.folderID,
    folderMeta.parentFolder,
    "/",
    folderMeta.folderName,
    "| first:",
    r.error,
  );
  await openPgcFilesTab(page, projectID);
  await page.waitForTimeout(600);
  r = await attempt("retry");
  return r;
}

/**
 * Deterministic processing order from live folder metadata only (no permit-specific IDs).
 * @param {string[]} folderIds
 * @param {Map<string, { folder: { parentFolder?: string, folderName?: string } }[]>} byFolder
 */
function sortPgcFolderIdsForProcessing(folderIds, byFolder) {
  return [...folderIds].sort((a, b) => {
    const rowA = byFolder.get(a)?.[0];
    const rowB = byFolder.get(b)?.[0];
    const fa = rowA?.folder;
    const fb = rowB?.folder;
    const pa = String(fa?.parentFolder || "").toLowerCase();
    const pb = String(fb?.parentFolder || "").toLowerCase();
    if (pa !== pb) return pa.localeCompare(pb);
    const na = String(fa?.folderName || "").toLowerCase();
    const nb = String(fb?.folderName || "").toLowerCase();
    if (na !== nb) return na.localeCompare(nb);
    return String(a).localeCompare(String(b));
  });
}

/**
 * @param {string | null | undefined} rawError
 * @param {string} fallback
 */
function normalizePgcPerFileDownloadError(rawError, fallback) {
  const e = String(rawError || fallback || "unknown");
  const map = [
    [/folder_activation_failed/i, "folder_activation_failed"],
    [/stale_grid_after_folder_switch/i, "stale_grid_after_folder_switch"],
    [/folder_grid_count_mismatch/i, "folder_grid_count_mismatch"],
    [
      /folder_grid_expected_filename_not_visible/i,
      "folder_grid_expected_filename_not_visible",
    ],
    [/publish_menu_not_opened/i, "publish_menu_not_opened"],
    [/publish_to_pdf_item_not_found/i, "publish_to_pdf_item_not_found"],
    [/pdf_publish_dialog_not_found/i, "pdf_publish_dialog_not_found"],
    [/pdf_publish_button_not_clicked/i, "pdf_publish_button_not_clicked"],
    [/export_complete_popup_not_found/i, "export_complete_popup_not_found"],
    [/export_complete_ok_not_clicked/i, "export_complete_ok_not_clicked"],
    [/publishtoformat_pdf_not_seen/i, "publishtoformat_pdf_not_seen"],
    [
      /validation_failed|rejectReason|invalid.*pdf|rejected|not_brava_publish_pdf_url/i,
      "pdf_validation_failed",
    ],
    [/viewer_page_closed/i, "viewer_page_closed"],
    [/viewer_context_closed/i, "viewer_context_closed"],
    [/browser_closed/i, "browser_closed"],
    [/session_redirected_to_login/i, "session_redirected_to_login"],
    [/viewer_tab_missing/i, "viewer_tab_missing"],
    [/unknown_viewer_open_failure/i, "unknown_viewer_open_failure"],
    [/playwright_target_closed/i, "playwright_target_closed"],
    [/viewer_not_opened/i, "viewer_not_opened"],
    [/view_only_click_failed/i, "task_assignment_modal_not_handled"],
    [/viewer_opened_but_document_not_captured/i, "publishtoformat_pdf_not_seen"],
  ];
  for (const [re, code] of map) {
    if (re.test(e)) return code;
  }
  return e.length > 120 ? e.slice(0, 120) : e;
}

/**
 * @param {unknown} e
 */
function pgcIsPlaywrightTargetClosedError(e) {
  if (!e || typeof e !== "object") return false;
  const name = String(/** @type {{ name?: string }} */ (e).name || "");
  if (name === "TargetClosedError") return true;
  const msg = String(/** @type {{ message?: string }} */ (e).message || e || "");
  return (
    msg.includes("Target page, context or browser has been closed") ||
    (msg.includes("has been closed") &&
      (msg.includes("Target") || msg.includes("Browser has been closed")))
  );
}

/**
 * @param {import('playwright').Browser | null} browser
 */
function pgcIsBrowserConnected(browser) {
  try {
    if (!browser) return false;
    if (typeof browser.isConnected === "function") return browser.isConnected();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {import('playwright').Page | null | undefined} page
 */
function pgcIsPageAlive(page) {
  try {
    return !!(page && typeof page.isClosed === "function" && !page.isClosed());
  } catch (_) {
    return false;
  }
}

/**
 * @param {import('playwright').Page | null | undefined} page
 * @param {number} ms
 */
async function pgcSafePageWaitForTimeout(page, ms) {
  if (!pgcIsPageAlive(page)) {
    const err = new Error("Target page, context or browser has been closed");
    /** @type {any} */ (err).pgcRecoverable = true;
    throw err;
  }
  await /** @type {import('playwright').Page} */ (page).waitForTimeout(ms);
}

/**
 * @param {import('playwright').Page | null | undefined} page
 * @param {string} tag
 */
function pgcAssertPageUsable(page, tag) {
  if (!pgcIsPageAlive(page)) {
    const err = new Error(
      `Target page, context or browser has been closed (${tag})`,
    );
    /** @type {any} */ (err).pgcRecoverable = true;
    throw err;
  }
}

/**
 * @param {import('playwright').Page | null | undefined} page
 */
async function pgcDetectPgcSessionLossOnPage(page) {
  if (!pgcIsPageAlive(page))
    return { needsLogin: true, hint: "page_closed" };
  const u = String(page.url() || "").toLowerCase();
  if (/\/portal\/login\//i.test(u))
    return { needsLogin: true, hint: "portal_login_url" };
  if (/\/account\/login/i.test(u))
    return { needsLogin: true, hint: "account_login_url" };
  if (/openid|oauth|saml|waad|signin|sso/i.test(u) && !/projectdox/i.test(u))
    return { needsLogin: true, hint: "sso_bridge_url" };
  const body = await page
    .evaluate(() => (document.body && document.body.innerText) || "")
    .catch(() => "");
  const bl = body.slice(0, 2500).toLowerCase();
  if (
    /\bpassword\b/i.test(bl) &&
    /\b(user\s*name|username|email)\b/i.test(bl) &&
    !/my projects/i.test(bl)
  ) {
    return { needsLogin: true, hint: "login_form_body" };
  }
  return { needsLogin: false, hint: "" };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
function classifyPgcViewerCaptureError(page, fileMeta) {
  try {
    if (page && !page.isClosed()) return "viewer_not_opened";
  } catch (_) {
    return "viewer_context_closed";
  }
  try {
    if (!page) return "unknown_viewer_open_failure";
    if (page.isClosed()) return "viewer_page_closed";
  } catch (_) {
    return "viewer_context_closed";
  }
  return "viewer_tab_missing";
}

/**
 * @param {{
 *   task6Context: import('playwright').BrowserContext,
 *   task6Browser: import('playwright').Browser | null,
 *   projectID: string,
 *   project: object,
 *   folderMeta: object,
 *   previousGridFingerprint: string | null,
 *   allFoldersOut: object[],
 *   harvestOpts: {
 *     dashboardUrl?: string,
 *     relaunchBrowserAndRecover?: ((args: {
 *       projectID: string,
 *       project: object,
 *       dashboardUrl: string,
 *       reason?: string,
 *     }) => Promise<import('playwright').Page | null>) | null,
 *     recoveryCredentials?: {
 *       email: string,
 *       password: string,
 *       loginUrl?: string,
 *       credentialsSource?: string,
 *     } | null,
 *   },
 *   skipFolderActivation?: boolean,
 * }} state
 */
async function recoverPgcFilesSessionAndResume(state) {
  let task6Context = state.task6Context;
  let task6Browser = state.task6Browser;
  const {
    projectID,
    project,
    folderMeta,
    previousGridFingerprint,
    allFoldersOut,
    harvestOpts,
    skipFolderActivation = false,
  } = state;

  console.log("[PGC] Recovery start | reopening browser/page/files tab");

  const dashboardUrl = harvestOpts?.dashboardUrl || PGC_DASHBOARD_URL;
  const creds =
    harvestOpts?.recoveryCredentials ||
    (process.env.PGC_EPLAN_EMAIL && process.env.PGC_EPLAN_PASSWORD
      ? {
          email: process.env.PGC_EPLAN_EMAIL,
          password: process.env.PGC_EPLAN_PASSWORD,
          loginUrl:
            process.env.PGC_EPLAN_LOGIN_URL?.trim() || PGC_LOGIN_URL_DEFAULT,
          credentialsSource: "env_recovery",
        }
      : null);

  /** @type {import('playwright').Page | null} */
  let np = null;
  let relaunched = false;

  if (!pgcIsBrowserConnected(task6Browser)) {
    const relFn = harvestOpts?.relaunchBrowserAndRecover;
    if (!relFn) {
      console.log("[PGC] Recovery failed | browser closed");
      return {
        ok: false,
        code: "browser_closed",
        task6Context,
        task6Browser,
      };
    }
    try {
      np = await relFn({
        projectID,
        project,
        dashboardUrl,
        reason: "task6_browser_closed",
      });
    } catch (e) {
      console.log(
        "[PGC] Recovery failed | browser closed",
        "| relaunch:",
        /** @type {{ message?: string }} */ (e)?.message || e,
      );
      return {
        ok: false,
        code: "browser_closed",
        task6Context,
        task6Browser,
      };
    }
    if (!pgcIsPageAlive(np)) {
      console.log("[PGC] Recovery failed | browser closed");
      return {
        ok: false,
        code: "browser_closed",
        task6Context,
        task6Browser,
      };
    }
    relaunched = true;
    task6Context = np.context();
    task6Browser = task6Context.browser();
  } else {
    try {
      np = await task6Context.newPage();
    } catch (e) {
      const relFn = harvestOpts?.relaunchBrowserAndRecover;
      if (relFn) {
        try {
          np = await relFn({
            projectID,
            project,
            dashboardUrl,
            reason: "task6_context_closed",
          });
          if (pgcIsPageAlive(np)) {
            relaunched = true;
            task6Context = np.context();
            task6Browser = task6Context.browser();
          }
        } catch (_) {
          np = null;
        }
      }
      if (!pgcIsPageAlive(np)) {
        console.log("[PGC] Recovery failed | context closed");
        return {
          ok: false,
          code: "viewer_context_closed",
          task6Context,
          task6Browser,
        };
      }
    }
  }

  try {
    await np.goto(dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
  } catch (_) {}

  const loss = await pgcDetectPgcSessionLossOnPage(np);
  pgcProgress.pgcLogDetail("pgc_recovery_session_probe", {
    needsLogin: loss.needsLogin,
    hint: loss.hint,
  });
  if (loss.needsLogin) {
    if (!creds?.email || !creds?.password) {
      console.log(
        "[PGC] Recovery failed | login required but no credentials (set pipeline opts.recoveryCredentials or PGC_EPLAN_* for CLI recovery)",
      );
      await np.close().catch(() => {});
      return {
        ok: false,
        code: "session_redirected_to_login",
        task6Context,
        task6Browser,
      };
    }
    await performPgcLogin(
      np,
      String(creds.email).trim(),
      creds.password,
      creds.loginUrl || PGC_LOGIN_URL_DEFAULT,
      {
        credentialsSource:
          creds.credentialsSource || "pgc_recovery_saved_portal",
      },
    );
  }

  const permit = normalizeText(
    String(
      /** @type {{ projectNumber?: string }} */ (project).projectNumber || "",
    ),
  );
  const openRes = await openProjectViaDashboardRow(
    np,
    dashboardUrl,
    String(projectID),
    { projectNumber: permit },
  );
  if (!openRes.ok) {
    await np.close().catch(() => {});
    return {
      ok: false,
      code: "project_reopen_failed",
      task6Context,
      task6Browser,
    };
  }

  let work = np;
  if (openRes.detailPage) {
    work = openRes.detailPage;
    if (openRes.detailPage !== np) await np.close().catch(() => {});
  }

  await openPgcFilesTab(work, projectID);
  await work.waitForTimeout(550);

  const mustSkipActivation = relaunched || !!skipFolderActivation;
  if (mustSkipActivation) {
    console.log(
      "[PGC] Recovery OK | files tab open | skipping folder reactivation (resume current or next folder)",
    );
    return {
      ok: true,
      page: work,
      fingerprint: null,
      relaunched,
      skipFolderActivation: true,
      task6Context,
      task6Browser,
    };
  }

  const activation = await activatePgcFolderAndVerifyGrid(
    work,
    /** @type {any} */ (folderMeta),
    allFoldersOut,
    { projectID, previousFingerprint: previousGridFingerprint || null },
  );
  if (!activation.ok) {
    console.log(
      `[PGC] Recovery failed | folder grid | ${activation.error || "unknown"}`,
    );
    return {
      ok: false,
      code: String(activation.error || "folder_reactivation_failed"),
      page: work,
      task6Context,
      task6Browser,
    };
  }

  console.log(
    `[PGC] Recovery folder restored | ${folderMeta.parentFolder} / ${folderMeta.folderName}`,
  );
  return {
    ok: true,
    page: work,
    fingerprint: activation.fingerprint,
    relaunched,
    skipFolderActivation: false,
    task6Context,
    task6Browser,
  };
}

/**
 * @param {any} out
 * @param {{
 *   globalFailedFiles: { folderID: string, fileName: string, reason: string }[],
 *   totalFoldersNonEmptyProcessed: number,
 *   totalFilesAttemptedAll: number,
 *   totalOkAll: number,
 *   totalFailedAll: number,
 *   harvestAborted?: boolean,
 *   harvestAbortReason?: string,
 * }} partial
 */
function pgcAssignTask6MultiMeta(out, partial) {
  if (!out._meta) out._meta = {};
  out._meta.pgcMultiFolderDownload = {
    nonEmptyFoldersProcessed: partial.totalFoldersNonEmptyProcessed,
    filesAttempted: partial.totalFilesAttemptedAll,
    downloadsOk: partial.totalOkAll,
    failures: partial.totalFailedAll,
    failedFiles: partial.globalFailedFiles.slice(0, 500),
    harvestAborted: !!partial.harvestAborted,
    harvestAbortReason: partial.harvestAbortReason || "",
  };
  const cp = out._meta.task6Checkpoint;
  if (cp && typeof cp === "object") {
    out._meta.pgcMultiFolderDownload.foldersTotalNonEmpty =
      cp.foldersTotalNonEmpty;
    out._meta.pgcMultiFolderDownload.lastCompletedFolder =
      cp.lastCompletedFolder;
  }
}

/**
 * @param {any} out
 * @param {Record<string, unknown>} patch
 */
function pgcTask6PatchCheckpoint(out, patch) {
  if (!out._meta) out._meta = {};
  if (!out._meta.task6Checkpoint) out._meta.task6Checkpoint = {};
  Object.assign(out._meta.task6Checkpoint, patch);
}

/**
 * @param {{ folderID?: string, fileName?: string, reason?: string }[]} failedFiles
 */
function pgcLogTask6FailureBucketSummary(failedFiles) {
  /** @type {Record<string, { count: number, first: { folderID: string, fileName: string } }>} */
  const buckets = {};
  for (const row of failedFiles || []) {
    const reason = String(row.reason || "unknown");
    if (!buckets[reason]) {
      buckets[reason] = {
        count: 0,
        first: {
          folderID: String(row.folderID || ""),
          fileName: String(row.fileName || ""),
        },
      };
    }
    buckets[reason].count += 1;
  }
  const countsOnly = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.count]),
  );
  console.log("[PGC] Task 6 failure buckets |", JSON.stringify(countsOnly));
  pgcProgress.pgcLogDetail("task6_failure_bucket_firsts", buckets);
}

/**
 * @param {import('playwright').Page} page
 */
async function introspectPgcFilesTree(page) {
  return page
    .evaluate(() => {
      /** @type {Record<string, unknown>} */
      const out = {};
      out.hasProjectTree = typeof window.projectTree !== "undefined";
      try {
        if (window.projectTree && typeof window.projectTree === "object") {
          out.projectTreeKeys = Object.keys(
            /** @type {object} */ (window.projectTree),
          ).slice(0, 50);
        }
      } catch (_) {
        out.projectTreeKeys = [];
      }
      out.folderTreePresent = !!document.querySelector("#folderTree");
      out.jQueryPresent = typeof window.jQuery !== "undefined";
      try {
        const $ = window.jQuery;
        const el = document.querySelector("#folderTree");
        if ($ && el) {
          const $el = $(el);
          const d = $el.data();
          out.folderTreeJQueryDataKeys = d ? Object.keys(d) : [];
          const ig =
            $el.data("igTree") ||
            $el.data("igtree") ||
            $el.data("igTreeInternal") ||
            null;
          out.igTreeWidgetPresent = !!ig;
          if (ig && typeof ig === "object") {
            out.igTreeMethodSample = Object.keys(ig)
              .filter((k) => typeof (/** @type {any} */ (ig)[k]) === "function")
              .slice(0, 25);
          }
        }
      } catch (e) {
        out.jqueryInspectError = (e && e.message) || String(e);
      }
      return out;
    })
    .catch(() => ({ error: "introspect_eval_failed" }));
}

/**
 * @param {import('playwright').Page} page
 * @param {{ folderID: string }} folderMeta
 */
async function selectPgcFolderViaWidget(page, folderMeta) {
  const fid = String(folderMeta.folderID || "").trim();
  /** @type {string[]} */
  const attempts = [];
  const r = await page
    .evaluate((id) => {
      /** @type {string[]} */
      const log = [];
      try {
        const $ = window.jQuery;
        const root = document.querySelector("#folderTree");
        if (!$ || !root) {
          log.push("no_jquery_or_folderTree");
          return { ok: false, log };
        }
        const $root = $(root);
        const $node = $root.find(`[data-value="${id}"]`).first();
        if (!$node.length) {
          log.push("data-value_node_not_found");
          return { ok: false, log };
        }
        const $li = $node.closest("li.ui-igtree-node");
        const tree = $root.data("igTree") || $root.data("igtree");
        if (tree && typeof tree.select === "function" && $li.length) {
          try {
            tree.select($li[0]);
            log.push("igTree.select(li)");
          } catch (e) {
            log.push("igTree.select_error:" + (e && e.message));
          }
        }
        if (tree && typeof tree.expand === "function" && $li.length) {
          try {
            tree.expand($li[0]);
            log.push("igTree.expand(li)");
          } catch (e) {
            log.push("igTree.expand_error:" + (e && e.message));
          }
        }
        $node.trigger("mousedown").trigger("mouseup").trigger("click");
        log.push("jquery_trigger_click_chain_on_node");
        return { ok: true, log };
      } catch (e) {
        log.push("eval_error:" + (e && e.message));
        return { ok: false, log };
      }
    }, fid)
    .catch(() => ({ ok: false, log: ["evaluate_failed"] }));
  attempts.push(...(r.log || []));
  return { ok: !!r.ok, attempts };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ knownFileNames?: string[], files?: unknown[] }} folderMeta
 * @param {{ timeout?: number }} [opts]
 */
async function waitForPgcFilesGridData(page, folderMeta, opts = {}) {
  const timeout = opts.timeout ?? 22000;
  const start = Date.now();
  /** @type {Awaited<ReturnType<typeof evaluatePgcFilesGridTruth>> | null} */
  let last = null;
  while (Date.now() - start < timeout) {
    last = await evaluatePgcFilesGridTruth(page, folderMeta);
    const hasRowsOrLinks =
      last.dataIdRowCount > 0 || last.viewFileLinkCount > 0;
    const countOk = last.totalY > 0 && !last.zeroOfZeroFiles;
    const emptyShell =
      last.dataIdRowCount === 0 && last.viewFileLinkCount === 0;

    const falseSuccessEmpty =
      emptyShell &&
      (last.zeroOfZeroFiles || last.templatePlaceholdersInGrid);
    if (falseSuccessEmpty) {
      console.log(
        "[PGC] Files grid: rejecting false_success_empty_grid |",
        JSON.stringify({
          countText: last.countText,
          templatePlaceholdersInGrid: last.templatePlaceholdersInGrid,
          zeroOfZeroFiles: last.zeroOfZeroFiles,
        }),
      );
      return {
        ok: false,
        error: "false_success_empty_grid",
        gridTruth: last,
      };
    }

    if (hasRowsOrLinks || countOk) {
      return { ok: true, gridTruth: last };
    }

    await page.waitForTimeout(450);
  }
  return {
    ok: false,
    error: "grid_data_timeout",
    gridTruth: last,
  };
}

/**
 * Legacy DOM clicks on tree node (after widget path).
 * @param {import('playwright').Page} page
 * @param {string} fid
 * @param {{ clickStrategyUsed?: string | null }} diag
 */
async function legacyPgcDomClickChildFolder(page, fid, diag) {
  const treeRoot = page.locator("#folderTree");
  const byValue = treeRoot.locator(`[data-value="${fid}"]`).first();
  const strategies = [
    async () => {
      if (!(await byValue.isVisible().catch(() => false))) return false;
      await byValue.scrollIntoViewIfNeeded().catch(() => {});
      await byValue.click({ timeout: 10000 }).catch(() => {});
      return true;
    },
    async () => {
      const a = treeRoot.locator(`[data-value="${fid}"] a`).first();
      if (!(await a.isVisible().catch(() => false))) return false;
      await a.scrollIntoViewIfNeeded().catch(() => {});
      await a.click({ timeout: 8000 }).catch(() => {});
      return true;
    },
    async () => {
      if (!(await byValue.isVisible().catch(() => false))) return false;
      await byValue.click({ force: true, timeout: 8000 }).catch(() => {});
      return true;
    },
    async () =>
      page.evaluate((id) => {
        const el = document.querySelector(`#folderTree [data-value="${id}"]`);
        if (!el) return false;
        el.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        return true;
      }, fid),
  ];
  let i = 0;
  for (const fn of strategies) {
    const ok = await fn().catch(() => false);
    if (ok) {
      diag.clickStrategyUsed = `legacy_dom_${i}`;
      return true;
    }
    i += 1;
  }
  return false;
}

/**
 * Select Files-tab folder and wait until #grdFiles has real data (not template shell).
 * @param {import('playwright').Page} page
 * @param {{ folderID: string, folderName?: string, parentFolder?: string, knownFileNames?: string[], files?: unknown[] }} folderMeta
 */
async function selectPgcFilesFolder(page, folderMeta) {
  /** @type {Record<string, unknown>} */
  const diag = {
    folderID: folderMeta.folderID,
    folderName: folderMeta.folderName || "",
    parentFolder: folderMeta.parentFolder || "",
    parentFound: false,
    parentExpanded: false,
    childNodeFound: false,
    clickStrategyUsed: null,
    gridTruth: null,
    treeIntrospection: null,
    widgetSelection: null,
    error: null,
  };

  const fid = String(folderMeta.folderID || "").trim();
  if (!fid) {
    diag.error = "missing folderID";
    return { ok: false, diagnostics: diag };
  }

  const pexp = await expandPgcParentFolder(page, folderMeta.parentFolder || "");
  diag.parentFound = !!pexp.parentFound;
  diag.parentExpanded = !!pexp.parentExpanded;

  await page
    .waitForSelector(`#folderTree [data-value="${fid}"]`, { timeout: 12000 })
    .catch(() => {});

  let nodeInfo = await findPgcFolderTreeNode(page, folderMeta);
  if (!nodeInfo.found) {
    await page.waitForTimeout(800);
    nodeInfo = await findPgcFolderTreeNode(page, folderMeta);
  }
  diag.childNodeFound = !!nodeInfo.found;
  if (!nodeInfo.found) {
    diag.error = "child node not found";
    await logPgcFilesGridTruth(page, folderMeta, "fail-no-tree-node");
    return { ok: false, diagnostics: diag };
  }

  const intro = await introspectPgcFilesTree(page);
  diag.treeIntrospection = intro;
  pgcProgress.pgcLogDetail("files_tree_introspect", { folderMeta, intro });
  console.log("[PGC] Files tree introspect → pgc-debug-detail.log");

  const wSel = await selectPgcFolderViaWidget(page, folderMeta);
  diag.widgetSelection = wSel;
  await page.waitForTimeout(500);
  await page
    .waitForFunction(
      () => {
        const spin = document.querySelector(
          ".ui-igloading:visible, .k-loading-mask:visible",
        );
        return !spin;
      },
      { timeout: 8000 },
    )
    .catch(() => {});

  let wait = await waitForPgcFilesGridData(page, folderMeta, {
    timeout: 10000,
  });
  if (!wait.ok) {
    const legacyOk = await legacyPgcDomClickChildFolder(page, fid, diag);
    if (legacyOk) {
      await page.waitForTimeout(500);
      await page
        .waitForFunction(
          () => {
            const spin = document.querySelector(
              ".ui-igloading:visible, .k-loading-mask:visible",
            );
            return !spin;
          },
          { timeout: 8000 },
        )
        .catch(() => {});
      wait = await waitForPgcFilesGridData(page, folderMeta, {
        timeout: 16000,
      });
    }
  }

  const truth = await logPgcFilesGridTruth(page, folderMeta, "post-select");
  diag.gridTruth = truth;

  if (!wait.ok) {
    diag.error =
      wait.error === "false_success_empty_grid"
        ? "false_success_empty_grid"
        : wait.error || "grid_data_timeout";
    console.log(
      "[PGC] Files folder selection FAILED:",
      diag.error,
      JSON.stringify(truth, null, 2),
    );
    return { ok: false, diagnostics: diag };
  }

  diag.postClickGridRows = truth.dataIdRowCount;
  diag.postClickFileCountText = truth.countText;
  diag.knownFilenameVisible = truth.knownFilenameVisible;
  diag.zeroOfZeroFiles = truth.zeroOfZeroFiles;

  console.log(
    "[PGC] Files folder selection OK:",
    fid,
    folderMeta.folderName,
    "| data-id rows:",
    truth.dataIdRowCount,
    "| viewFile links:",
    truth.viewFileLinkCount,
    "| count:",
    truth.countText,
  );
  return { ok: true, diagnostics: diag };
}

/**
 * After child folder click: verify grid reflects files (not "0 of 0").
 * @param {import('playwright').Page} page
 * @param {{ knownFileNames?: string[], files?: unknown[] }} folderMeta
 */
async function verifyPgcFolderGridLoaded(page, folderMeta) {
  await page.waitForTimeout(400);
  const g = await evaluatePgcFilesGridTruth(page, folderMeta);
  const spinnerVisible = await page
    .evaluate(
      () =>
        !!document.querySelector(
          ".ui-igloading, .k-loading-mask, [class*='loading'][style*='display'][style*='block']",
        ),
    )
    .catch(() => false);

  const falseSuccess =
    g.zeroOfZeroFiles &&
    g.dataIdRowCount === 0 &&
    g.viewFileLinkCount === 0 &&
    g.templatePlaceholdersInGrid;

  const ok =
    !falseSuccess &&
    (g.dataIdRowCount > 0 ||
      g.viewFileLinkCount > 0 ||
      (g.totalY > 0 && !g.zeroOfZeroFiles));

  return {
    ok,
    postClickGridRows: g.dataIdRowCount,
    postClickFileCountText: g.countText,
    knownFilenameVisible: g.knownFilenameVisible,
    zeroOfZeroFiles: g.zeroOfZeroFiles,
    spinnerVisible,
    totalYFromBanner: g.totalY,
    dataIdRowCount: g.dataIdRowCount,
    viewFileLinkCount: g.viewFileLinkCount,
    templatePlaceholdersInGrid: g.templatePlaceholdersInGrid,
    rowTextsSample: g.rowTextsSample,
  };
}

/**
 * Click child folder in tree with fallbacks; optional grid verification.
 * @param {import('playwright').Page} page
 * @param {{ folderID: string, folderName?: string, parentFolder?: string, knownFileNames?: string[] }} folderMeta
 * @returns {Promise<{ ok: boolean, diagnostics: Record<string, unknown> }>}
 */
async function openPgcChildFolder(page, folderMeta) {
  return selectPgcFilesFolder(page, folderMeta);
}

/**
 * Re-open folder if grid no longer shows files.
 * @param {import('playwright').Page} page
 * @param {{ folderID: string, folderName?: string, parentFolder?: string, knownFileNames?: string[] }} folderMeta
 */
async function ensurePgcFolderGridReady(page, folderMeta) {
  const w = await waitForPgcFilesGridData(page, folderMeta, {
    timeout: 4000,
  });
  if (w.ok) return { ok: true, diagnostics: null, reverified: true };
  return selectPgcFilesFolder(page, folderMeta);
}

const PGC_FILE_GRID_TBODY_SEL =
  "table.ui-iggrid-table tbody, .ui-iggrid-table tbody, .ui-iggrid tbody";

/**
 * Find the file grid row for a known file (after folder activation). folderMeta is unused but kept for logs/callers.
 * @param {import('playwright').Page} page
 * @param {{ folderID?: string, knownFileNames?: string[] }} _folderMeta
 * @param {{ name?: string|null, fileId?: string|null, version?: string|null, uploadedDate?: string|null }} fileMeta
 */
async function findPgcFileGridRow(page, _folderMeta, fileMeta) {
  const wantName = normalizeText(String(fileMeta.name || "")).trim();
  const wantId = String(fileMeta.fileId || "").trim();
  const version = normalizeText(String(fileMeta.version ?? ""));
  const uploadedDate = normalizeText(String(fileMeta.uploadedDate ?? ""));

  const evalResult = await page
    .evaluate(
      ({ wantName, wantId, version, uploadedDate }) => {
        function norm(s) {
          return String(s || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
        const grd = document.querySelector("#grdFiles");
        /** @type {HTMLTableRowElement[]} */
        let rows = [];
        /** @type {"grd_dataid"|"grd_tbody"|"legacy"} */
        let gridMode = "legacy";
        if (grd) {
          const withId = Array.from(grd.querySelectorAll("tr[data-id]"));
          if (withId.length) {
            rows = withId;
            gridMode = "grd_dataid";
          } else {
            const tb = grd.querySelector("tbody");
            rows = tb ? Array.from(tb.querySelectorAll("tr")) : [];
            gridMode = rows.length ? "grd_tbody" : "legacy";
          }
        }
        if (gridMode === "legacy") {
          const tbody =
            document.querySelector("table.ui-iggrid-table tbody") ||
            document.querySelector(".ui-iggrid-table tbody") ||
            document.querySelector(".ui-iggrid tbody");
          rows = tbody ? Array.from(tbody.querySelectorAll("tr")) : [];
        }

        const wantLower = wantName.toLowerCase();
        const base =
          wantLower.includes("/") || wantLower.includes("\\")
            ? wantLower.replace(/.*[/\\]/, "")
            : wantLower;

        /** @type {{ idx: number, score: number, rowText: string, rowHtmlSnippet: string, matchedBy: string, fileIdSeenInRow: string | null, filenameSeenInRow: string | null, dataIdAttr: string | null, viewFileHref: string | null }[]} */
        const scored = [];

        rows.forEach((tr, idx) => {
          const rowText = norm(tr.innerText);
          if (rowText.length < 2) return;
          if (/^file\s*name$/i.test(rowText)) return;

          const html = tr.innerHTML || "";
          const tLower = rowText.toLowerCase();

          let score = 0;
          let matchedBy = "";
          /** @type {string | null} */
          let fileIdSeenInRow = null;
          /** @type {string | null} */
          let filenameSeenInRow = null;
          const dataIdAttr = tr.getAttribute("data-id");
          const vfA = tr.querySelector('a[href*="viewFile("]');
          const viewFileHref = vfA ? vfA.getAttribute("href") : null;
          const vfM = viewFileHref
            ? viewFileHref.match(/viewFile\s*\(\s*(\d+)\s*\)/i)
            : null;
          if (vfM) fileIdSeenInRow = vfM[1];

          const idMatch =
            wantId &&
            (html.includes(wantId) ||
              tLower.includes(wantId.toLowerCase()) ||
              dataIdAttr === wantId);
          if (wantId) {
            if (!fileIdSeenInRow) {
              const m = html.match(
                /(?:FileID|fileID|fileId)[\"']?\s*[:=]\s*[\"']?(\d+)/i,
              );
              if (m) fileIdSeenInRow = m[1];
            }
            if (fileIdSeenInRow === wantId) {
              score += 120;
              matchedBy = "viewFile_or_fileId_exact_in_row";
            } else if (idMatch) {
              score += 55;
              matchedBy = "fileId_in_row_markup";
            }
          }

          if (wantLower && tLower === wantLower) {
            score += 95;
            matchedBy = "exact_row_text_filename";
            filenameSeenInRow = wantName;
          } else if (base && tLower.includes(base)) {
            score += 75;
            matchedBy = "filename_in_row_text";
            filenameSeenInRow = base;
          }

          const links = Array.from(tr.querySelectorAll("a"));
          for (const a of links) {
            const at = norm(a.textContent).toLowerCase();
            if (wantLower && at === wantLower) {
              score += 40;
              matchedBy = "anchor_text_exact_filename";
              filenameSeenInRow = wantName;
              break;
            }
          }

          if (viewFileHref) score += 8;

          if (version && rowText.includes(version)) score += 4;
          if (
            uploadedDate &&
            uploadedDate.length >= 8 &&
            rowText.includes(uploadedDate.slice(0, 10))
          )
            score += 4;

          if (score > 0) {
            scored.push({
              idx,
              score,
              rowText: rowText.slice(0, 500),
              rowHtmlSnippet: html.replace(/\s+/g, " ").slice(0, 700),
              matchedBy,
              fileIdSeenInRow,
              filenameSeenInRow,
              dataIdAttr,
              viewFileHref,
            });
          }
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const minScore = wantId ? 50 : wantName ? 45 : 999;
        if (!best || best.score < minScore) {
          return {
            rowFound: false,
            rowIndex: -1,
            gridMode,
            diagnostics: {
              rowFound: false,
              rowText: "",
              rowHtmlSnippet: "",
              matchedBy: "none",
              fileIdSeenInRow: null,
              filenameSeenInRow: null,
              dataIdAttr: null,
              viewFileHref: null,
              candidatesConsidered: scored.length,
            },
          };
        }
        return {
          rowFound: true,
          rowIndex: best.idx,
          gridMode,
          diagnostics: {
            rowFound: true,
            rowText: best.rowText,
            rowHtmlSnippet: best.rowHtmlSnippet,
            matchedBy: best.matchedBy,
            fileIdSeenInRow: best.fileIdSeenInRow,
            filenameSeenInRow: best.filenameSeenInRow,
            dataIdAttr: best.dataIdAttr,
            viewFileHref: best.viewFileHref,
            score: best.score,
          },
        };
      },
      { wantName, wantId, version, uploadedDate },
    )
    .catch(() => ({
      rowFound: false,
      rowIndex: -1,
      gridMode: /** @type {"legacy"} */ ("legacy"),
      diagnostics: {
        rowFound: false,
        rowText: "",
        rowHtmlSnippet: "",
        matchedBy: "evaluate_failed",
        fileIdSeenInRow: null,
        filenameSeenInRow: null,
        dataIdAttr: null,
        viewFileHref: null,
      },
    }));

  if (!evalResult.rowFound || evalResult.rowIndex < 0) {
    pgcProgress.pgcLogDetail("findPgcFileGridRow_no_row", {
      file: wantName || wantId,
      diagnostics: evalResult.diagnostics,
    });
    console.log(
      `[PGC] findPgcFileGridRow | no row | ${wantName || wantId} (detail → pgc-debug-detail.log)`,
    );
    return {
      rowFound: false,
      rowLocator: null,
      diagnostics: evalResult.diagnostics,
    };
  }

  const rowLocator =
    evalResult.gridMode === "grd_dataid"
      ? page.locator("#grdFiles tr[data-id]").nth(evalResult.rowIndex)
      : evalResult.gridMode === "grd_tbody"
        ? page.locator("#grdFiles tbody tr").nth(evalResult.rowIndex)
        : page
            .locator(PGC_FILE_GRID_TBODY_SEL)
            .first()
            .locator("tr")
            .nth(evalResult.rowIndex);

  const rowAct = await resolvePgcFileRowAction(rowLocator, fileMeta);
  console.log(
    "[PGC] findPgcFileGridRow: OK |",
    wantName || wantId,
    "| idx:",
    evalResult.rowIndex,
    "| gridMode:",
    evalResult.gridMode,
    "|",
    evalResult.diagnostics.matchedBy,
    "| viewFile:",
    (rowAct.viewFileHref || "").slice(0, 120),
    "| data-id:",
    rowAct.dataIdAttr,
  );

  return {
    rowFound: true,
    rowLocator,
    diagnostics: { ...evalResult.diagnostics, rowAction: rowAct },
  };
}

/**
 * @param {import('playwright').Locator} rowLocator
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function resolvePgcFileRowAction(rowLocator, fileMeta) {
  const wantId = String(fileMeta.fileId || "").trim();
  return rowLocator
    .evaluate(
      (tr, wid) => {
        const vf = tr.querySelector('a[href*="viewFile("]');
        const vi = tr.querySelector('a[href*="viewInfo("]');
        const href = vf ? vf.getAttribute("href") : null;
        const infoHref = vi ? vi.getAttribute("href") : null;
        const dataId = tr.getAttribute("data-id");
        const vm = href
          ? href.match(/viewFile\s*\(\s*(\d+)\s*\)/i)
          : null;
        const fileIdFromHref = vm ? vm[1] : null;
        return {
          dataIdAttr: dataId,
          viewFileHref: href,
          viewInfoHref: infoHref,
          fileIdFromHref,
          idConsistent:
            !wid || !fileIdFromHref || fileIdFromHref === wid,
        };
      },
      wantId,
    )
    .catch(() => ({
      dataIdAttr: null,
      viewFileHref: null,
      viewInfoHref: null,
      fileIdFromHref: null,
      idConsistent: true,
    }));
}

/**
 * Task Assignment workflow: never Accept; use View Only only.
 * @param {import('playwright').Page} page
 * @param {Record<string, unknown>} [_context]
 */
async function handlePgcTaskAssignmentModal(page, _context) {
  await page.waitForTimeout(450);
  const assignmentVisible = await page
    .getByText(/Task\s+Assignment/i)
    .first()
    .isVisible()
    .catch(() => false);
  const pickViewOnly = async () => {
    const order = [
      page.getByRole("button", { name: /^\s*View Only\s*$/i }).first(),
      page.getByRole("link", { name: /^\s*View Only\s*$/i }).first(),
      page.locator("button:has-text('View Only')").first(),
      page.locator("a:has-text('View Only')").first(),
      page.locator(".ui-dialog-buttonpane button:has-text('View Only')").first(),
    ];
    for (const loc of order) {
      const v = await loc.isVisible().catch(() => false);
      if (v) {
        await loc.click({ timeout: 9000 }).catch(() => {});
        return true;
      }
    }
    return false;
  };

  if (assignmentVisible) {
    console.log(
      "[PGC] Task Assignment modal: detected — clicking View Only (not Accept)",
    );
    const ok = await pickViewOnly();
    await page.waitForTimeout(500);
    return {
      modalSeen: true,
      buttonUsed: ok ? "View Only" : null,
      error: ok ? null : "view_only_click_failed",
    };
  }

  const voOnly = await page
    .locator("text=View Only")
    .first()
    .isVisible()
    .catch(() => false);
  if (voOnly) {
    const ok = await pickViewOnly();
    await page.waitForTimeout(400);
    return {
      modalSeen: true,
      buttonUsed: ok ? "View Only" : null,
      error: ok ? null : "view_only_click_failed",
    };
  }

  return { modalSeen: false, buttonUsed: null, error: null };
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} rowLocator
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function openPgcViewerForFile(page, rowLocator, fileMeta) {
  const wantName = normalizeText(String(fileMeta.name || ""));
  const preClick = page.url();

  const rowDiag = await rowLocator
    .evaluate((tr) => {
      const vf = tr.querySelector('a[href*="viewFile("]');
      return {
        rowText: (tr.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400),
        snippet: tr.outerHTML.replace(/\s+/g, " ").slice(0, 520),
        dataId: tr.getAttribute("data-id"),
        viewFileHref: vf ? vf.getAttribute("href") : null,
      };
    })
    .catch(() => ({}));
  pgcProgress.pgcLogDetail("openPgcViewerForFile_row", {
    file: wantName || fileMeta.fileId,
    rowDiag,
  });

  const viewLink = rowLocator.locator('a[href*="viewFile("]').first();
  const namePat =
    wantName.length > 0
      ? new RegExp(pgcEscapeRegExp(wantName.slice(0, 120)), "i")
      : /./;
  const nameLink = rowLocator.locator("a").filter({ hasText: namePat }).first();
  const hasView = await viewLink.isVisible().catch(() => false);
  const clickTarget = hasView ? viewLink : nameLink;
  const clickedSelectorSummary = hasView
    ? "a[href*=viewFile]"
    : "filename_anchor_fallback";

  const ctx = page.context();
  /** @type {import('playwright').Page[]} */
  const newPages = [];
  const onPage = (p) => {
    newPages.push(p);
  };
  ctx.on("page", onPage);
  try {
    await clickTarget.scrollIntoViewIfNeeded().catch(() => {});
    await clickTarget.click({ timeout: 12000 }).catch(() => {});

    pgcAssertPageUsable(page, "openPgcViewer_post_click");
    await page.waitForTimeout(650);
    const modalRes = await handlePgcTaskAssignmentModal(page, {});
    if (modalRes.error) {
      return {
        error: modalRes.error,
        preClickUrl: preClick,
        modalHandled: false,
        clickedSelectorSummary,
        rowDiag,
        modalSeen: modalRes.modalSeen,
        viewerPage: null,
        viewerUrl: null,
      };
    }
    if (modalRes.modalSeen) {
      pgcProgress.pgcLogFileStep("task_assignment_modal", {
        message: "Task Assignment handled",
        meta: { buttonUsed: modalRes.buttonUsed || null },
        terminalLine: `[PGC] Step | task_assignment_modal | ${wantName || fileMeta.fileId} | ${modalRes.buttonUsed || "?"}`,
      });
    }

    pgcAssertPageUsable(page, "openPgcViewer_pre_viewer_poll");
    await page.waitForTimeout(1400);

    /** @type {import('playwright').Page | null} */
    let viewerPage = null;
    let viewerUrl = "";
    for (const p of newPages) {
      try {
        await p.waitForLoadState("domcontentloaded", { timeout: 14000 }).catch(() => {});
        const u = p.url();
        if (/ActiveXViewer\.aspx/i.test(u)) {
          viewerPage = p;
          viewerUrl = u;
          break;
        }
      } catch (_) {}
    }

    if (!viewerPage && /ActiveXViewer\.aspx/i.test(page.url())) {
      viewerPage = page;
      viewerUrl = page.url();
    }

    if (!viewerPage) {
      await page
        .waitForURL(/ActiveXViewer\.aspx/i, { timeout: 22000 })
        .catch(() => {});
      if (/ActiveXViewer\.aspx/i.test(page.url())) {
        viewerPage = page;
        viewerUrl = page.url();
      }
    }

    if (viewerPage && viewerUrl) {
      try {
        if (viewerPage.isClosed()) {
          viewerPage = null;
          viewerUrl = "";
        }
      } catch (_) {
        viewerPage = null;
        viewerUrl = "";
      }
    }

    const fileIdFromUrl =
      (viewerUrl && /FileID=(\d+)/i.exec(viewerUrl))?.[1] || null;
    pgcProgress.pgcLogDetail("viewer_url_capture", {
      preClick: preClick.slice(-200),
      viewerUrl,
      sameTab: viewerPage === page,
      fileIdFromUrl,
    });

    if (!viewerPage || !viewerUrl) {
      /** @type {string} */
      let viewerErr = "unknown_viewer_open_failure";
      try {
        if (page.isClosed()) viewerErr = "viewer_page_closed";
        else viewerErr = "viewer_tab_missing";
      } catch (_) {
        viewerErr = "viewer_context_closed";
      }
      for (const p of newPages) {
        if (p !== page) await p.close().catch(() => {});
      }
      return {
        error: viewerErr,
        preClickUrl: preClick,
        viewerUrl: null,
        modalHandled: !!modalRes.modalSeen,
        clickedSelectorSummary,
        rowDiag,
        viewerPage: null,
      };
    }

    pgcProgress.pgcLogFileStep("viewer_opened", {
      message: viewerUrl,
      meta: { fileIdFromUrl, sameTab: viewerPage === page },
      terminalLine: `[PGC] Step | viewer_opened | ${wantName || fileMeta.fileId}`,
    });

    return {
      error: null,
      preClickUrl: preClick,
      viewerUrl,
      viewerPage,
      modalHandled: !!modalRes.modalSeen,
      modalButtonUsed: modalRes.buttonUsed,
      clickedSelectorSummary,
      rowDiag,
      fileIdFromUrl,
      sameTab: viewerPage === page,
    };
  } finally {
    ctx.off("page", onPage);
  }
}

/**
 * @param {string} url
 * @param {string} contentType
 * @param {number} status
 */
function pgcClassifyViewerNetworkRecord(url, contentType, status) {
  const u = String(url || "");
  const ct = (contentType || "").toLowerCase();
  if (status === 0) return "unreadable_or_pending";
  if (isPgcBravaPublishToPdfUrl(u)) return "brava_publish_pdf";
  if (/searchindices/i.test(u)) return "brava_search_index";
  if (/bravaserver/i.test(u) && /\/search\//i.test(u)) return "brava_search_index";
  if (/\/bravaserver\/raster\//i.test(u)) return "brava_raster_demoted";
  if (/\/bravaserver\/vector\//i.test(u)) return "brava_vector_demoted";
  if (/\/thumb(\/|$)/i.test(u)) return "brava_thumb_demoted";
  if (/configprovider\.aspx/i.test(u)) return "brava_config_demoted";
  if (/markuphandler\.aspx/i.test(u)) return "brava_markup_meta_demoted";
  if (/client\.html/i.test(u)) return "brava_client_html_demoted";
  if (/:8443/i.test(u) && /bravaserver/i.test(u)) {
    if (/\.pdf(\?|$)/i.test(u) || ct.includes("pdf")) return "brava_pdf_candidate";
    if (/\bstream\b/i.test(u) || /\bfile\b/i.test(u) || /\bdocument\b/i.test(u))
      return "brava_stream_candidate";
    return "brava_port_other";
  }
  if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(u)) return "pdf_like";
  if (ct.startsWith("image/")) return "image_tile";
  if (/\btiles?\b/i.test(u)) return "viewer_tile";
  if (/\bstream\b/i.test(u)) return "stream_candidate";
  if (ct.includes("json") || ct.includes("xml")) return "metadata";
  return "other";
}

/**
 * @param {Array<Record<string, unknown>>} records
 * @param {import('playwright').Response} res
 */
function pgcPushViewerResponseRecord(records, res) {
  try {
    const req = res.request();
    const url = res.url();
    const status = res.status();
    const h = res.headers();
    const ct = (h["content-type"] || "").toLowerCase();
    const cd = h["content-disposition"] || "";
    const cl = h["content-length"] || "";
    const classification = pgcClassifyViewerNetworkRecord(url, ct, status);
    records.push({
      url,
      status,
      contentType: ct,
      contentDisposition: cd,
      contentLength: cl,
      resourceType: req.resourceType(),
      classification,
    });
  } catch (_) {}
}

/**
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Array<Record<string, unknown>>} responseRecords
 */
function capturePgcViewerDocumentRequests(fileMeta, responseRecords) {
  const interesting = (responseRecords || []).filter(
    (r) =>
      String(r.classification || "") !== "other" ||
      /:8443|brava|publishtoformat|searchindices|stream|document|file|load|pdf|tile/i.test(
        String(r.url || ""),
      ),
  );
  pgcProgress.pgcLogViewerRequestSummary(
    fileMeta,
    responseRecords || [],
    interesting.slice(-50),
  );
  return responseRecords;
}

/**
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function inspectPgcActiveXViewer(viewerPage, fileMeta) {
  const vUrl = viewerPage.url();
  const title = (await viewerPage.title().catch(() => "")) || "";
  let viewerOrigin = PGC_BASE;
  try {
    viewerOrigin = new URL(vUrl).origin;
  } catch (_) {}

  const snap = await viewerPage
    .evaluate(() => {
      const bodyText = String(document.body?.innerText || "");
      const bodyLines = bodyText
        .split(/\r?\n/)
        .map((l) => l.trim().slice(0, 220))
        .filter(Boolean)
        .slice(0, 40);
      const iframeSrcs = Array.from(
        document.querySelectorAll("iframe[src], frame[src]"),
      ).map((el) => el.getAttribute("src") || "");
      const embedSrcs = Array.from(
        document.querySelectorAll("embed[src], object[data]"),
      ).map((el) => el.getAttribute("src") || el.getAttribute("data") || "");
      const scriptSrcs = Array.from(document.scripts || [])
        .map((s) => s.src)
        .filter(Boolean);
      const allUrls = [...iframeSrcs, ...embedSrcs, ...scriptSrcs].filter(
        Boolean,
      );
      const port8443 = allUrls.filter((u) => u.includes(":8443"));
      const keywordHits = allUrls.filter((u) =>
        /brava|searchindices|tiles?|stream|document|file|load/i.test(u),
      );
      const controls = Array.from(
        document.querySelectorAll(
          "button, a[href], [role='button'], input[type='submit']",
        ),
      )
        .slice(0, 36)
        .map((el) =>
          String((el.textContent || el.getAttribute("title") || "") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 90),
        )
        .filter(Boolean);
      return {
        bodyLines,
        iframeSrcs,
        embedSrcs,
        scriptSrcs,
        port8443,
        keywordHits,
        controls,
      };
    })
    .catch(() => ({
      bodyLines: [],
      iframeSrcs: [],
      embedSrcs: [],
      scriptSrcs: [],
      port8443: [],
      keywordHits: [],
      controls: [],
    }));

  let sameOriginAccessible = false;
  try {
    await viewerPage.evaluate(() => document.documentElement.outerHTML.slice(0, 1));
    sameOriginAccessible = true;
  } catch (_) {
    sameOriginAccessible = false;
  }

  pgcProgress.pgcLogDetail("activex_viewer_inspect", {
    file: fileMeta.name || fileMeta.fileId,
    url: vUrl,
    title: title.slice(0, 200),
    sameOriginAccessible,
    viewerOrigin,
    dom: snap,
  });
  console.log(
    "[PGC] ActiveX viewer |",
    fileMeta.name || fileMeta.fileId,
    "| iframes:",
    snap.iframeSrcs?.length ?? 0,
    "| scripts:",
    snap.scriptSrcs?.length ?? 0,
    "| detail → pgc-debug-detail.log",
  );
}

/**
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function extractPgcViewerDocumentSource(viewerPage, fileMeta) {
  const raw = await viewerPage
    .evaluate(() => {
      /** @type {Set<string>} */
      const urls = new Set();
      /** @type {string[]} */
      const hints = [];
      document
        .querySelectorAll("iframe[src], frame[src], embed[src], object[data]")
        .forEach((el) => {
          const s =
            el.getAttribute("src") || el.getAttribute("data") || "";
          if (s) urls.add(s);
        });
      document.querySelectorAll("input[type='hidden']").forEach((inp) => {
        const v = inp.getAttribute("value") || "";
        if (
          /^https?:\/\//i.test(v) ||
          /\/Brava/i.test(v) ||
          /\bstream\b/i.test(v) ||
          /\bFileID\b/i.test(v)
        ) {
          if (v.length < 4000) urls.add(v);
        }
      });
      const w = window;
      for (const k of [
        "documentUrl",
        "fileUrl",
        "pdfUrl",
        "streamUrl",
        "documentPath",
        "filePath",
      ]) {
        try {
          const v = /** @type {unknown} */ (w)[k];
          if (typeof v === "string" && /^https?:\/\//i.test(v)) urls.add(v);
        } catch (_) {}
      }
      const inline = Array.from(
        document.querySelectorAll("script:not([src])"),
      )
        .map((s) => s.textContent || "")
        .join("\n")
        .slice(0, 480000);
      const re = /https?:\/\/[^\s'"<>]+/gi;
      let m;
      while ((m = re.exec(inline)) !== null) {
        let u = m[0].replace(/[,;)\]}>'"]+$/g, "");
        if (
          /brava|stream|document|file|load|FileID|tiles?|\.pdf(\?|$)/i.test(u)
        )
          urls.add(u);
      }
      document
        .querySelectorAll(
          "a[href*='download'], a[href*='.pdf'], a[href*='stream'], a[href*='document'], button",
        )
        .forEach((el) => {
          const href = el.getAttribute("href");
          if (href && /^https?:/i.test(href)) urls.add(href);
        });
      return { urls: [...urls], hints };
    })
    .catch(() => ({ urls: [], hints: [] }));

  pgcProgress.pgcLogDetail("viewer_document_source_extract", {
    file: fileMeta.name || fileMeta.fileId,
    urlCount: raw.urls.length,
    urlsSample: raw.urls.slice(0, 40),
    hints: raw.hints,
  });
  console.log(
    "[PGC] Viewer source extract |",
    fileMeta.name || fileMeta.fileId,
    "| urls:",
    raw.urls.length,
    "| detail → pgc-debug-detail.log",
  );
  return raw;
}

/**
 * @param {string} raw
 * @param {string} viewerOrigin
 */
function pgcAbsolutizeViewerUrl(raw, viewerOrigin) {
  const s = String(raw || "").trim();
  if (!s || /^javascript:/i.test(s) || /^blob:/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) {
    try {
      return new URL(s, viewerOrigin).href;
    } catch {
      return makeAbsolutePortalUrl(s);
    }
  }
  try {
    return new URL(s, viewerOrigin).href;
  } catch {
    return makeAbsolutePortalUrl(s);
  }
}

/**
 * @param {import('playwright').Page} viewerPage
 */
async function findPgcBravaContentFrame(viewerPage) {
  for (const f of viewerPage.frames()) {
    const u = f.url() || "";
    if (/\/BravaServer\//i.test(u) && /:8443/.test(u)) return f;
    if (/client\.html/i.test(u) && /brava/i.test(u)) return f;
  }
  const byPort = viewerPage.frames().find((f) => /:8443/.test(f.url() || ""));
  return byPort || null;
}

/**
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 */
function pgcBravaPublishSearchTargets(frame, viewerPage) {
  /** @type {(import('playwright').Page|import('playwright').Frame)[]} */
  const t = [];
  if (frame) t.push(frame);
  t.push(viewerPage);
  return t;
}

const PGC_BRAVA_PUBLISH_MENU_FAIL_PAGE_SHOT = path.join(
  __dirname,
  "pgc-brava-publish-menu-failed-page.png",
);
const PGC_BRAVA_PUBLISH_MENU_FAIL_FRAME_SHOT = path.join(
  __dirname,
  "pgc-brava-publish-menu-failed-frame.png",
);

/**
 * In-page scan for top-level Publish toolbar candidates (excludes "Publish to PDF").
 * @param {import('playwright').Page|import('playwright').Frame} handle
 */
async function pgcEvaluateBravaPublishCandidates(handle) {
  return handle
    .evaluate(() => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      function isVisible(el) {
        const st = window.getComputedStyle(el);
        if (
          st.display === "none" ||
          st.visibility === "hidden" ||
          parseFloat(st.opacity || "1") === 0
        )
          return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      }
      function isEnabled(el) {
        if (/** @type {HTMLButtonElement} */ (el).disabled) return false;
        if (el.getAttribute("aria-disabled") === "true") return false;
        return true;
      }
      const PUBLISH_TO_PDF = /publish\s+to\s+pdf/i;
      function textBlob(el) {
        return `${norm(el.textContent)} ${norm(el.getAttribute("title") || "")} ${norm(el.getAttribute("aria-label") || "")}`;
      }
      function excludesPublishToPdf(el) {
        return (
          !PUBLISH_TO_PDF.test(textBlob(el)) &&
          !PUBLISH_TO_PDF.test(norm(el.textContent))
        );
      }
      function isTopPublishCandidate(el) {
        if (!isVisible(el)) return false;
        if (!excludesPublishToPdf(el)) return false;
        const tb = textBlob(el).toLowerCase();
        if (!/\bpublish\b/.test(tb)) return false;
        const inner = norm(el.textContent);
        if (inner.length > 140) return false;
        if (/^publish\s+to\b/i.test(inner)) return false;
        return true;
      }
      function splitButtonInfo(el) {
        const combo = el.closest(
          '.dijitComboButton, .dijitDropDownButton, .dijitSplitButton, [class*="ComboButton"], [class*="DropDownButton"], [class*="SplitButton"]',
        );
        if (!combo) return { isSplit: false };
        const arrow = combo.querySelector(
          '.dijitArrowButtonInner, .dijitArrowButton, td.dijitDownArrowButton, [class*="ArrowButton"], .ui-button-icon-secondary',
        );
        const labelNode =
          combo.querySelector(".dijitButtonContents, .dijitButtonNode") || el;
        return {
          isSplit: true,
          hasArrow: !!arrow,
          comboClassSlice: String(combo.className || "").slice(0, 120),
          arrowTitle: arrow
            ? norm(
                arrow.getAttribute("title") ||
                  arrow.getAttribute("aria-label") ||
                  "",
              ).slice(0, 80)
            : "",
          labelTextSlice: norm(labelNode.textContent || "").slice(0, 80),
        };
      }
      const SELECTOR =
        'button, [role="button"], a, span, div[tabindex], .ui-button, .dijitButtonNode, .dijitButtonContents, span.dijitButtonText, [class*="dijitButton"], [class*="toolbar"] button, [class*="Toolbar"] button';
      const nodes = Array.from(document.querySelectorAll(SELECTOR));
      /** @type {number[]} */
      const indices = [];
      /** @type {object[]} */
      const report = [];
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!isTopPublishCandidate(el)) continue;
        let p = el.parentElement;
        let skipInner = false;
        while (p) {
          const pi = nodes.indexOf(p);
          if (pi >= 0 && isTopPublishCandidate(p)) {
            skipInner = true;
            break;
          }
          p = p.parentElement;
        }
        if (skipInner) continue;
        indices.push(i);
        const r = el.getBoundingClientRect();
        const text = norm(el.textContent).slice(0, 120);
        const title = norm(el.getAttribute("title") || "").slice(0, 120);
        const ariaLabel = norm(el.getAttribute("aria-label") || "").slice(0, 120);
        const role = el.getAttribute("role") || "(none)";
        const tag = el.tagName.toLowerCase();
        const className = String(el.className || "").slice(0, 180);
        let outerHTMLSnippet = "";
        try {
          outerHTMLSnippet = String(el.outerHTML || "").slice(0, 260);
        } catch (_) {}
        const tLower = `${text} ${title} ${ariaLabel}`.toLowerCase();
        const split = splitButtonInfo(el);
        report.push({
          index: i,
          tag,
          text,
          title,
          ariaLabel,
          role,
          className,
          visible: true,
          enabled: isEnabled(el),
          bbox: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
          outerHTMLSnippet,
          hasPublishWord: /\bpublish\b/i.test(tLower),
          hasPdfWord: /\bpdf\b/i.test(tLower),
          splitButton: split,
        });
      }
      return { selector: SELECTOR, indices, report };
    })
    .catch(() => ({ selector: "button", indices: [], report: [] }));
}

/**
 * Menu / floating layers after a Publish click (both Brava widget sets).
 * @param {import('playwright').Page|import('playwright').Frame} h
 */
async function pgcScanBravaPublishMenuLayersInHandle(h) {
  return h
    .evaluate(() => {
      const menuSelectors = [
        '[role="menu"]',
        ".ui-menu",
        ".dijitMenu",
        ".dijitMenuPopup",
        ".dropdown-menu",
        ".ig-tooltip",
        ".igpopover",
        ".ui-dialog",
        '[class*="MenuPopup"]',
        '[class*="menu-popup"]',
      ];
      const seen = new Set();
      /** @type {{ sel: string, textSample: string, htmlSnippet: string, hasPublishToPdf: boolean }[]} */
      const layers = [];
      for (const sel of menuSelectors) {
        let els;
        try {
          els = document.querySelectorAll(sel);
        } catch {
          continue;
        }
        els.forEach((el) => {
          if (el.getAttribute("hidden") != null) return;
          const st = window.getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden") return;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          const key = `${sel}|${Math.round(r.x)}|${Math.round(r.y)}|${Math.round(r.width)}`;
          if (seen.has(key)) return;
          seen.add(key);
          const txt = String(el.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 600);
          layers.push({
            sel,
            textSample: txt,
            htmlSnippet: String(el.outerHTML || "").slice(0, 380),
            hasPublishToPdf: /publish\s+to\s+pdf/i.test(txt),
          });
        });
      }
      return layers;
    })
    .catch(() => []);
}

/**
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 */
async function pgcInspectBravaPublishMenuLayerState(frame, viewerPage) {
  const frameLayers = frame ? await pgcScanBravaPublishMenuLayersInHandle(frame) : [];
  const pageLayers = await pgcScanBravaPublishMenuLayersInHandle(viewerPage);
  const submenuTexts = await pgcCollectBravaPublishSubmenuTexts(frame, viewerPage);
  const hasPublishToPdf =
    frameLayers.some((l) => l.hasPublishToPdf) ||
    pageLayers.some((l) => l.hasPublishToPdf) ||
    submenuTexts.some((t) => /publish\s+to\s+pdf/i.test(t));
  const meaningfulLayer = frameLayers.some((l) => l.textSample.length > 2) ||
    pageLayers.some((l) => l.textSample.length > 2);
  const visibleMenuCount = frameLayers.length + pageLayers.length;
  const opened =
    hasPublishToPdf ||
    submenuTexts.length > 0 ||
    (visibleMenuCount > 0 && meaningfulLayer);
  return {
    opened,
    visibleMenuCount,
    frameLayers,
    pageLayers,
    submenuTexts,
    hasPublishToPdf,
  };
}

/**
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {string} strategyName
 */
async function pgcLogPostClickBravaPublishMenuDiagnostics(
  frame,
  viewerPage,
  strategyName,
) {
  const state = await pgcInspectBravaPublishMenuLayerState(frame, viewerPage);
  const sample = {
    visibleMenuCount: state.visibleMenuCount,
    hasPublishToPdf: state.hasPublishToPdf,
    submenuTextsSample: state.submenuTexts.slice(0, 45),
    frameLayerSamples: state.frameLayers.slice(0, 6).map((l) => ({
      sel: l.sel,
      textSample: l.textSample.slice(0, 200),
      hasPublishToPdf: l.hasPublishToPdf,
      htmlSnippet: l.htmlSnippet.slice(0, 200),
    })),
    pageLayerSamples: state.pageLayers.slice(0, 6).map((l) => ({
      sel: l.sel,
      textSample: l.textSample.slice(0, 200),
      hasPublishToPdf: l.hasPublishToPdf,
      htmlSnippet: l.htmlSnippet.slice(0, 200),
    })),
  };
  pgcProgress.pgcLogDetail(`brava_post_click_menu_scan:${strategyName}`, sample);
  if (!state.opened) {
    pgcProgress.pgcLogDetail(`publish_menu_not_opened_after_click:${strategyName}`, {
      strategyName,
      visibleMenuCount: state.visibleMenuCount,
    });
    console.log(
      `[PGC] Brava | menu not open after click | ${strategyName}`,
    );
  }
  return state;
}

/**
 * @param {import('playwright').Locator} loc
 * @param {string} strategyName
 * @param {import('playwright').Page} viewerPage
 * @param {import('playwright').Frame|null} frame
 */
async function pgcApplyBravaPublishMenuClickStrategy(
  loc,
  strategyName,
  viewerPage,
  frame,
) {
  switch (strategyName) {
    case "A_normal_click":
      await loc.click({ timeout: 9000 }).catch(() => {});
      break;
    case "B_scroll_into_view_click":
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await viewerPage.waitForTimeout(120);
      await loc.click({ timeout: 9000 }).catch(() => {});
      break;
    case "C_force_click":
      await loc.click({ force: true, timeout: 9000 }).catch(() => {});
      break;
    case "D_mouse_center_bbox": {
      const box = await loc.boundingBox().catch(() => null);
      if (box) {
        await viewerPage.mouse.click(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
      }
      break;
    }
    case "E_js_click":
      await loc.evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      }).catch(() => {});
      break;
    case "F_split_arrow_click": {
      const arrow = loc
        .locator(
          '.dijitArrowButtonInner, .dijitArrowButton, td.dijitDownArrowButton, [class*="ArrowButton"], .ui-button-icon-secondary, .ui-splitbutton-menubutton',
        )
        .first();
      if (await arrow.isVisible().catch(() => false)) {
        await arrow.click({ timeout: 9000 }).catch(() => {});
      } else {
        const wrap = loc.locator(
          'xpath=ancestor::*[contains(@class,"dijitComboButton") or contains(@class,"dijitDropDownButton") or contains(@class,"dijitSplitButton")][1]',
        );
        if (await wrap.count().catch(() => 0)) {
          const a2 = wrap
            .locator(
              '.dijitArrowButtonInner, .dijitArrowButton, td.dijitDownArrowButton',
            )
            .first();
          if (await a2.isVisible().catch(() => false)) {
            await a2.click({ timeout: 9000 }).catch(() => {});
          }
        }
      }
      break;
    }
    case "G_keyboard_enter_space_arrowdown":
      await loc.focus().catch(() => {});
      await viewerPage.waitForTimeout(80);
      await viewerPage.keyboard.press("Enter").catch(() => {});
      await viewerPage.waitForTimeout(200);
      if (
        !(await pgcInspectBravaPublishMenuLayerState(frame, viewerPage)).opened
      ) {
        await viewerPage.keyboard.press("Space").catch(() => {});
        await viewerPage.waitForTimeout(200);
      }
      if (
        !(await pgcInspectBravaPublishMenuLayerState(frame, viewerPage)).opened
      ) {
        await viewerPage.keyboard.press("ArrowDown").catch(() => {});
      }
      break;
    default:
      break;
  }
}

/**
 * Poll until menu appears or attempts exhausted.
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 */
async function pgcWaitForBravaPublishMenuOpened(frame, viewerPage) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const state = await pgcInspectBravaPublishMenuLayerState(frame, viewerPage);
    if (state.opened) return state;
    await viewerPage.waitForTimeout(350);
  }
  return pgcInspectBravaPublishMenuLayerState(frame, viewerPage);
}

/**
 * Collect visible menu-ish item labels after top-level Publish opens (Brava / jQuery UI).
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 */
async function pgcCollectBravaPublishSubmenuTexts(frame, viewerPage) {
  /** @param {import('playwright').Page|import('playwright').Frame} t */
  const evalOne = (t) =>
    t
      .evaluate(() => {
        /** @type {string[]} */
        const out = [];
        const roots = Array.from(
          document.querySelectorAll(
            '[role="menu"]:not([hidden]), .ui-menu:visible, ul.ui-menu:visible, .dijitMenu:visible, .dijitMenuTable:visible, [class*="context-menu"]:visible, [class*="ContextMenu"]:visible',
          ),
        );
        for (const root of roots) {
          const items = root.querySelectorAll(
            '[role="menuitem"], li.ui-menu-item, li.ui-state-focus, a, span, div',
          );
          items.forEach((el) => {
            const tx = String(el.textContent || "")
              .replace(/\s+/g, " ")
              .trim();
            if (tx.length > 1 && tx.length < 140) out.push(tx);
          });
        }
        return [...new Set(out)];
      })
      .catch(() => []);

  let best = [];
  for (const t of pgcBravaPublishSearchTargets(frame, viewerPage)) {
    const arr = await evalOne(t);
    if (arr.length > best.length) best = arr;
  }
  return best;
}

/**
 * Step 1: click top-level Publish only; submenu must appear (not treated as success alone).
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   contextUsed?: 'frame'|'viewerPage',
 *   strategyUsed?: string,
 *   candidateSummary?: string,
 *   submenuTexts?: string[],
 * }>}
 */
async function openPgcBravaPublishMenu(frame, viewerPage, fileMeta) {
  const STRATEGIES = [
    "A_normal_click",
    "B_scroll_into_view_click",
    "C_force_click",
    "D_mouse_center_bbox",
    "E_js_click",
    "F_split_arrow_click",
    "G_keyboard_enter_space_arrowdown",
  ];

  /** @type {{ context: 'frame'|'viewerPage', data: Awaited<ReturnType<typeof pgcEvaluateBravaPublishCandidates>> }[]} */
  const diagBlocks = [];
  if (frame) {
    const data = await pgcEvaluateBravaPublishCandidates(frame);
    diagBlocks.push({ context: "frame", data });
    pgcProgress.pgcLogDetail("brava_publish_candidates_frame", {
      file: fileMeta.name || fileMeta.fileId,
      report: (data.report || []).map((r) => ({ ...r, splitButton: r.splitButton })),
      indices: data.indices,
    });
  } else {
    pgcProgress.pgcLogDetail("brava_publish_candidates_frame", {
      file: fileMeta.name || fileMeta.fileId,
      note: "no_brava_frame",
    });
  }
  const pageDiag = await pgcEvaluateBravaPublishCandidates(viewerPage);
  diagBlocks.push({ context: "viewerPage", data: pageDiag });
  pgcProgress.pgcLogDetail("brava_publish_candidates_viewerPage", {
    file: fileMeta.name || fileMeta.fileId,
    report: pageDiag.report || [],
    indices: pageDiag.indices,
  });
  const fc = frame ? diagBlocks.find((b) => b.context === "frame")?.data?.indices?.length ?? 0 : 0;
  const vc = pageDiag.indices?.length ?? 0;
  console.log(
    `[PGC] Brava candidates | ${fileMeta.name || fileMeta.fileId} | frame:${fc} viewerPage:${vc} (detail → pgc-debug-detail.log)`,
  );

  /** @type {{ context: 'frame'|'viewerPage', index: number, selector: string }[]} */
  const clickPlan = [];
  for (const block of diagBlocks) {
    if (block.context === "frame" && !frame) continue;
    const handle = block.context === "frame" ? frame : viewerPage;
    if (!handle) continue;
    const { selector, indices } = block.data;
    for (const idx of indices || []) {
      clickPlan.push({ context: block.context, index: idx, selector });
    }
  }

  const frameCandCount =
    diagBlocks.find((b) => b.context === "frame")?.data?.indices?.length ?? 0;
  const viewerCandCount =
    diagBlocks.find((b) => b.context === "viewerPage")?.data?.indices?.length ??
    0;

  /**
   * @param {() => import('playwright').Locator} resolveLoc
   * @param {string} candidateSummary
   */
  async function runStrategiesOnPublishCandidate(resolveLoc, candidateSummary) {
    for (const strategyName of STRATEGIES) {
      if (strategyName !== "A_normal_click") {
        await viewerPage.keyboard.press("Escape").catch(() => {});
        await viewerPage.waitForTimeout(120);
      }
      const loc = resolveLoc();
      if (!(await loc.isVisible().catch(() => false))) {
        pgcProgress.pgcLogDetail("brava_publish_strategy_skip_not_visible", {
          strategyName,
          candidateSummary,
        });
        continue;
      }
      pgcProgress.pgcLogDetail("brava_publish_strategy_attempt", {
        strategyName,
        candidateSummary,
      });
      await pgcApplyBravaPublishMenuClickStrategy(
        loc,
        strategyName,
        viewerPage,
        frame,
      );
      await viewerPage.waitForTimeout(400);
      await pgcLogPostClickBravaPublishMenuDiagnostics(
        frame,
        viewerPage,
        strategyName,
      );
      const settled = await pgcWaitForBravaPublishMenuOpened(frame, viewerPage);
      if (settled.opened) {
        const ctx =
          settled.frameLayers.length > 0 && settled.pageLayers.length === 0
            ? "frame"
            : settled.pageLayers.length > 0 && settled.frameLayers.length === 0
              ? "viewerPage"
              : settled.frameLayers.length >= settled.pageLayers.length
                ? "frame"
                : "viewerPage";
        pgcProgress.pgcLogDetail("brava_publish_submenu_opened", {
          file: fileMeta.name || fileMeta.fileId,
          contextUsed: ctx,
          strategyUsed: strategyName,
          candidateSummary,
          submenuTexts: settled.submenuTexts,
        });
        pgcProgress.pgcLogFileStep("publish_menu_opened", {
          meta: { contextUsed: ctx, strategyUsed: strategyName },
          terminalLine: `[PGC] Step | publish_menu_opened | ${fileMeta.name || fileMeta.fileId} | ${ctx} | ${strategyName}`,
        });
        return {
          ok: true,
          contextUsed: ctx,
          strategyUsed: strategyName,
          candidateSummary,
          submenuTexts: settled.submenuTexts,
        };
      }
    }
    return null;
  }

  for (const step of clickPlan) {
    const handle = step.context === "frame" ? frame : viewerPage;
    if (!handle) continue;
    const resolveLoc = () => handle.locator(step.selector).nth(step.index);
    const locProbe = resolveLoc();
    if (!(await locProbe.isVisible().catch(() => false))) continue;
    const inner = (await locProbe.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    const title =
      (await locProbe.getAttribute("title").catch(() => "")) || "";
    const aria =
      (await locProbe.getAttribute("aria-label").catch(() => "")) || "";
    if (/publish\s+to\s+pdf/i.test(`${inner} ${title} ${aria}`)) continue;

    const splitLog = await locProbe
      .evaluate((el) => {
        const combo = el.closest(
          '.dijitComboButton, .dijitDropDownButton, .dijitSplitButton, [class*="ComboButton"], [class*="DropDownButton"]',
        );
        if (!combo)
          return { isSplit: false, labelSnippet: "", arrowSnippet: "" };
        const arrow = combo.querySelector(
          '.dijitArrowButtonInner, .dijitArrowButton, td.dijitDownArrowButton',
        );
        const label =
          combo.querySelector(".dijitButtonContents, .dijitButtonNode") || el;
        return {
          isSplit: true,
          labelSnippet: String(label.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          arrowSnippet: arrow
            ? String(arrow.className || "").slice(0, 80)
            : "(no arrow node)",
        };
      })
      .catch(() => ({ isSplit: false, labelSnippet: "", arrowSnippet: "" }));

    if (splitLog.isSplit) {
      pgcProgress.pgcLogDetail("brava_publish_split_button", {
        context: step.context,
        index: step.index,
        labelSnippet: splitLog.labelSnippet,
        arrowSnippet: splitLog.arrowSnippet,
      });
    }

    const candidateSummary = `${step.context} selector.nth(${step.index}) text="${inner.slice(0, 60)}" split=${splitLog.isSplit}`;
    const got = await runStrategiesOnPublishCandidate(
      resolveLoc,
      candidateSummary,
    );
    if (got) return got;
  }

  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  for (const target of targets) {
    const ctx = target === viewerPage ? "viewerPage" : "frame";
    /** @type {(() => import('playwright').Locator)[]} */
    const legacyMakers = [
      () => target.getByRole("button", { name: /^Publish$/i }).first(),
      () => target.getByRole("menuitem", { name: /^Publish$/i }).first(),
      () =>
        target
          .locator(
            'button, [role="button"], a.toolbar-button, .ui-button, [class*="toolbar"] button',
          )
          .filter({ hasText: /^Publish$/i })
          .first(),
    ];
    for (let li = 0; li < legacyMakers.length; li++) {
      const mk = legacyMakers[li];
      const leg = mk();
      if (!(await leg.isVisible().catch(() => false))) continue;
      const tInner = (await leg.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .trim();
      if (/publish\s+to\s+pdf/i.test(tInner)) continue;
      if (/pdf/i.test(tInner) && /publish/i.test(tInner) && tInner.length > 12)
        continue;
      const candidateSummary = `${ctx} legacy[${li}] text="${tInner.slice(0, 60)}"`;
      const got = await runStrategiesOnPublishCandidate(mk, candidateSummary);
      if (got) return got;
    }
  }

  try {
    await viewerPage.screenshot({
      path: PGC_BRAVA_PUBLISH_MENU_FAIL_PAGE_SHOT,
      fullPage: false,
    });
    pgcProgress.pgcLogDetail("brava_publish_menu_fail_shot_page", {
      path: String(PGC_BRAVA_PUBLISH_MENU_FAIL_PAGE_SHOT),
    });
    pgcProgress.pgcLogDetail("brava_fail_screenshot_page", {
      path: PGC_BRAVA_PUBLISH_MENU_FAIL_PAGE_SHOT,
    });
  } catch (e) {
    console.warn("[PGC] Brava publish menu fail page screenshot failed:", e?.message || e);
  }
  if (frame) {
    try {
      const body = await frame.$("body");
      if (body) {
        await body.screenshot({ path: PGC_BRAVA_PUBLISH_MENU_FAIL_FRAME_SHOT });
        pgcProgress.pgcLogDetail("brava_publish_menu_fail_shot_frame", {
          path: String(PGC_BRAVA_PUBLISH_MENU_FAIL_FRAME_SHOT),
        });
        pgcProgress.pgcLogDetail("brava_fail_screenshot_frame", {
          path: PGC_BRAVA_PUBLISH_MENU_FAIL_FRAME_SHOT,
        });
      }
    } catch (e) {
      console.warn(
        "[PGC] Brava publish menu fail frame screenshot failed:",
        e?.message || e,
      );
    }
  }

  pgcProgress.emitPgcProgress("publish_menu_not_opened", {
    stage: "publish_menu_not_opened",
    status: "fail",
    message: "Publish menu did not open",
    meta: { candidateSummary: `candidates frame=${frameCandCount} viewerPage=${viewerCandCount}` },
    terminalLine: `[PGC] Brava | publish_menu_not_opened | ${fileMeta.name || fileMeta.fileId}`,
  });
  return {
    ok: false,
    error: "publish_menu_not_opened",
    contextUsed: undefined,
    strategyUsed: undefined,
    candidateSummary: `candidates frame=${frameCandCount} viewerPage=${viewerCandCount}`,
    submenuTexts: [],
  };
}

/**
 * Step 2: click submenu "Publish to PDF" (not the toolbar Publish again).
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function clickPgcBravaPublishToPdf(frame, viewerPage, fileMeta) {
  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  const logPublishToPdfClicked = (variant, extra = {}) => {
    pgcProgress.pgcLogDetail("brava_click_publish_to_pdf", {
      variant,
      file: fileMeta.name || fileMeta.fileId,
      ...extra,
    });
    pgcProgress.pgcLogFileStep("publish_to_pdf_clicked", {
      meta: { variant, ...extra },
      terminalLine: `[PGC] Step | publish_to_pdf_clicked | ${fileMeta.name || fileMeta.fileId}`,
    });
  };
  for (const target of targets) {
    const exact = target.getByText("Publish to PDF", { exact: true }).first();
    if (await exact.isVisible().catch(() => false)) {
      await exact.click({ timeout: 9000 }).catch(() => {});
      await viewerPage.waitForTimeout(500);
      logPublishToPdfClicked("exact_text");
      return { ok: true };
    }
    const roleItem = target.getByRole("menuitem", { name: /Publish to PDF/i }).first();
    if (await roleItem.isVisible().catch(() => false)) {
      await roleItem.click({ timeout: 9000 }).catch(() => {});
      await viewerPage.waitForTimeout(500);
      logPublishToPdfClicked("menuitem_role");
      return { ok: true };
    }
    const liPdf = target.locator("li").filter({ hasText: /Publish to PDF/i }).first();
    if (await liPdf.isVisible().catch(() => false)) {
      await liPdf.click({ timeout: 9000 }).catch(() => {});
      await viewerPage.waitForTimeout(500);
      logPublishToPdfClicked("list_item");
      return { ok: true };
    }
    const fallback = target
      .locator('[role="menuitem"], li.ui-menu-item, a, span, div')
      .filter({ hasText: /PDF/i });
    const n = await fallback.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 20); i += 1) {
      const el = fallback.nth(i);
      const tx = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      if (!tx || tx.length > 100) continue;
      if (/publish/i.test(tx) && /pdf/i.test(tx)) {
        await el.click({ timeout: 9000 }).catch(() => {});
        await viewerPage.waitForTimeout(500);
        logPublishToPdfClicked("fallback_pdf_text", { matchedText: tx.slice(0, 120) });
        return { ok: true };
      }
    }
  }
  pgcProgress.emitPgcProgress("publish_to_pdf_item_not_found", {
    stage: "publish_to_pdf_item_not_found",
    status: "fail",
    message: "Publish to PDF menu item not found",
    terminalLine: `[PGC] Brava | publish_to_pdf_item_not_found | ${fileMeta.name || fileMeta.fileId}`,
  });
  return { ok: false, error: "publish_to_pdf_item_not_found" };
}

/**
 * Step 3: PDF publish options dialog — click dialog `Publish`.
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function handlePgcPdfPublishOptionsDialog(frame, viewerPage, fileMeta) {
  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const target of targets) {
      const dlg = target
        .locator(
          '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible, [class*="dialog"]:visible',
        )
        .filter({ hasText: /PDF\s*publish\s*options/i })
        .first();
      if (await dlg.isVisible().catch(() => false)) {
        const title = await dlg
          .locator(".ui-dialog-title, .ui-dialog-titlebar, [class*='title'], h1, h2")
          .first()
          .innerText()
          .catch(() => "");
        const btnLoc = dlg.locator('button, [role="button"], input[type="button"]');
        const btnTexts = await btnLoc
          .allInnerTexts()
          .catch(() => []);
        const trimmed = btnTexts.map((s) => String(s || "").trim().slice(0, 80));
        pgcProgress.pgcLogDetail("pdf_publish_options_dialog", {
          file: fileMeta.name || fileMeta.fileId,
          title: title.replace(/\s+/g, " ").trim().slice(0, 200),
          buttons: trimmed.slice(0, 40),
        });
        console.log(
          `[PGC] Brava | PDF publish options dialog | ${fileMeta.name || fileMeta.fileId}`,
        );
        const pub = dlg
          .getByRole("button", { name: /^Publish$/i })
          .or(dlg.locator("button").filter({ hasText: /^Publish$/i }))
          .first();
        if (await pub.isVisible().catch(() => false)) {
          await pub.click({ timeout: 12000 }).catch(() => {});
          await viewerPage.waitForTimeout(600);
          pgcProgress.pgcLogFileStep("pdf_publish_dialog_ok", {
            message: "Publish clicked in PDF options dialog",
            terminalLine: `[PGC] Step | pdf_publish_dialog_ok | ${fileMeta.name || fileMeta.fileId}`,
          });
          return { ok: true };
        }
        pgcProgress.emitPgcProgress("pdf_publish_button_not_clicked", {
          stage: "pdf_publish_button_not_clicked",
          status: "fail",
          terminalLine: `[PGC] Brava | pdf_publish_button_not_clicked | ${fileMeta.name || fileMeta.fileId}`,
        });
        return { ok: false, error: "pdf_publish_button_not_clicked" };
      }
    }
    await viewerPage.waitForTimeout(280);
  }
  pgcProgress.emitPgcProgress("pdf_publish_dialog_not_found", {
    stage: "pdf_publish_dialog_not_found",
    status: "fail",
    terminalLine: `[PGC] Brava | pdf_publish_dialog_not_found | ${fileMeta.name || fileMeta.fileId}`,
  });
  return { ok: false, error: "pdf_publish_dialog_not_found" };
}

/**
 * Step 4: Export complete — OK.
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function handlePgcExportCompletePopup(frame, viewerPage, fileMeta) {
  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const target of targets) {
      const strict = target
        .locator(
          '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible, div[role="alertdialog"]:visible',
        )
        .filter({ hasText: /Export complete/i })
        .filter({ hasText: /Your file is ready to download/i })
        .first();
      const popup =
        (await strict.isVisible().catch(() => false))
          ? strict
          : target
              .locator(
                '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible',
              )
              .filter({ hasText: /Export complete/i })
              .first();
      if (await popup.isVisible().catch(() => false)) {
        const txt = (await popup.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 400);
        pgcProgress.pgcLogDetail("export_complete_popup", {
          file: fileMeta.name || fileMeta.fileId,
          textSample: txt,
        });
        console.log(
          `[PGC] Brava | Export complete popup | ${fileMeta.name || fileMeta.fileId}`,
        );
        const okBtn = popup
          .getByRole("button", { name: /^OK$/i })
          .or(popup.locator("button").filter({ hasText: /^OK$/i }))
          .first();
        if (await okBtn.isVisible().catch(() => false)) {
          await okBtn.click({ timeout: 10000 }).catch(() => {});
          await viewerPage.waitForTimeout(900);
          pgcProgress.pgcLogFileStep("export_complete_ok", {
            message: "Export complete OK clicked",
            terminalLine: `[PGC] Step | export_complete_ok | ${fileMeta.name || fileMeta.fileId}`,
          });
          return { ok: true };
        }
        pgcProgress.emitPgcProgress("export_complete_ok_not_clicked", {
          stage: "export_complete_ok_not_clicked",
          status: "fail",
          terminalLine: `[PGC] Brava | export_complete_ok_not_clicked | ${fileMeta.name || fileMeta.fileId}`,
        });
        return { ok: false, error: "export_complete_ok_not_clicked" };
      }
    }
    await viewerPage.waitForTimeout(320);
  }
  pgcProgress.emitPgcProgress("export_complete_popup_not_found", {
    stage: "export_complete_popup_not_found",
    status: "fail",
    terminalLine: `[PGC] Brava | export_complete_popup_not_found | ${fileMeta.name || fileMeta.fileId}`,
  });
  return { ok: false, error: "export_complete_popup_not_found" };
}

/**
 * Single scan: final Brava `publishtoformat/.../pdf` from tabs, frames, or captured responses.
 * @param {import('playwright').Page} viewerPage
 * @param {Array<Record<string, unknown>>} responseRecords
 * @returns {string | null}
 */
function pgcFindBravaPublishPdfUrl(viewerPage, responseRecords) {
  try {
    for (const p of viewerPage.context().pages()) {
      const u = p.url();
      if (isPgcBravaPublishToPdfUrl(u)) return u;
    }
  } catch (_) {}
  try {
    for (const f of viewerPage.frames()) {
      const u = f.url() || "";
      if (isPgcBravaPublishToPdfUrl(u)) return u;
    }
  } catch (_) {}
  for (const r of responseRecords || []) {
    const u = String(r.url || "");
    if (isPgcBravaPublishToPdfUrl(u)) return u;
  }
  return null;
}

/**
 * Log PDF URL once when first detected (tab / frame / network).
 * @param {string} url
 * @param {"tab"|"frame"|"network"} source
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {unknown} [networkStatus]
 */
function pgcLogBravaPublishPdfUrlFound(url, source, fileMeta, networkStatus) {
  const label =
    source === "network" ? "brava_pdf_url_network" : `brava_pdf_url_${source}`;
  pgcProgress.pgcLogDetail(label, {
    url,
    status: networkStatus,
    file: fileMeta.name || fileMeta.fileId,
  });
  pgcProgress.pgcLogFileStep("pdf_url_detected", {
    meta: {
      source,
      status: networkStatus,
      urlSnippet: url.slice(0, 200),
    },
    terminalLine: `[PGC] Step | pdf_url_detected | ${fileMeta.name || fileMeta.fileId} | ${source}`,
  });
}

/**
 * If the PDF publish options dialog is visible, click Publish once.
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {{ sawPdfOptionsDialog: boolean, pdfOptionsPublishMissing: boolean, pdfDialogOkLogged: boolean }} state
 */
async function tryPgcPdfPublishOptionsDialogOnce(
  frame,
  viewerPage,
  fileMeta,
  state,
) {
  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  for (const target of targets) {
    const dlg = target
      .locator(
        '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible, [class*="dialog"]:visible',
      )
      .filter({ hasText: /PDF\s*publish\s*options/i })
      .first();
    if (!(await dlg.isVisible().catch(() => false))) continue;
    state.sawPdfOptionsDialog = true;
    const title = await dlg
      .locator(".ui-dialog-title, .ui-dialog-titlebar, [class*='title'], h1, h2")
      .first()
      .innerText()
      .catch(() => "");
    const btnLoc = dlg.locator('button, [role="button"], input[type="button"]');
    const btnTexts = await btnLoc.allInnerTexts().catch(() => []);
    const trimmed = btnTexts.map((s) => String(s || "").trim().slice(0, 80));
    pgcProgress.pgcLogDetail("pdf_publish_options_dialog", {
      file: fileMeta.name || fileMeta.fileId,
      title: title.replace(/\s+/g, " ").trim().slice(0, 200),
      buttons: trimmed.slice(0, 40),
    });
    const pub = dlg
      .getByRole("button", { name: /^Publish$/i })
      .or(dlg.locator("button").filter({ hasText: /^Publish$/i }))
      .first();
    if (!(await pub.isVisible().catch(() => false))) {
      state.pdfOptionsPublishMissing = true;
      return;
    }
    await pub.click({ timeout: 10000 }).catch(() => {});
    await viewerPage.waitForTimeout(500);
    if (!state.pdfDialogOkLogged) {
      state.pdfDialogOkLogged = true;
      pgcProgress.pgcLogFileStep("pdf_publish_dialog_ok", {
        message: "Publish clicked in PDF options dialog",
        terminalLine: `[PGC] Step | pdf_publish_dialog_ok | ${fileMeta.name || fileMeta.fileId}`,
      });
    }
    return;
  }
}

/**
 * If Export complete popup is visible, click OK once.
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {{ sawExportPopup: boolean, exportOkMissing: boolean, exportOkLogged: boolean }} state
 */
async function tryPgcExportCompletePopupOnce(
  frame,
  viewerPage,
  fileMeta,
  state,
) {
  const targets = pgcBravaPublishSearchTargets(frame, viewerPage);
  for (const target of targets) {
    const strict = target
      .locator(
        '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible, div[role="alertdialog"]:visible',
      )
      .filter({ hasText: /Export complete/i })
      .filter({ hasText: /Your file is ready to download/i })
      .first();
    const popup =
      (await strict.isVisible().catch(() => false))
        ? strict
        : target
            .locator(
              '[role="dialog"]:visible, .ui-dialog:visible, .modal:visible',
            )
            .filter({ hasText: /Export complete/i })
            .first();
    if (!(await popup.isVisible().catch(() => false))) continue;
    state.sawExportPopup = true;
    const txt = (await popup.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    pgcProgress.pgcLogDetail("export_complete_popup", {
      file: fileMeta.name || fileMeta.fileId,
      textSample: txt,
    });
    console.log(
      `[PGC] Brava | Export complete popup | ${fileMeta.name || fileMeta.fileId}`,
    );
    const okBtn = popup
      .getByRole("button", { name: /^OK$/i })
      .or(popup.locator("button").filter({ hasText: /^OK$/i }))
      .first();
    if (!(await okBtn.isVisible().catch(() => false))) {
      state.exportOkMissing = true;
      return;
    }
    await okBtn.click({ timeout: 10000 }).catch(() => {});
    await viewerPage.waitForTimeout(700);
    if (!state.exportOkLogged) {
      state.exportOkLogged = true;
      pgcProgress.pgcLogFileStep("export_complete_ok", {
        message: "Export complete OK clicked",
        terminalLine: `[PGC] Step | export_complete_ok | ${fileMeta.name || fileMeta.fileId}`,
      });
    }
    return;
  }
}

/**
 * After "Publish to PDF", poll for final PDF URL while opportunistically handling
 * PDF options dialog and Export complete popup (either may be absent).
 * @param {import('playwright').Frame|null} frame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Array<Record<string, unknown>>} responseRecords
 * @param {{ timeoutMs?: number }} [opts]
 */
async function waitForPgcPostPublishSuccess(
  frame,
  viewerPage,
  fileMeta,
  responseRecords,
  opts = {},
) {
  const timeoutMs = opts.timeoutMs ?? 90000;
  const start = Date.now();
  /** @type {{ pdfUrlLogged: boolean }} */
  const urlState = { pdfUrlLogged: false };
  const uiState = {
    sawPdfOptionsDialog: false,
    pdfOptionsPublishMissing: false,
    pdfDialogOkLogged: false,
    sawExportPopup: false,
    exportOkMissing: false,
    exportOkLogged: false,
  };

  const resolveAndLogUrl = (rawUrl, source) => {
    if (!rawUrl) return null;
    let networkStatus;
    if (source === "network") {
      for (const r of responseRecords || []) {
        if (String(r.url || "") === rawUrl) {
          networkStatus = r.status;
          break;
        }
      }
    }
    if (!urlState.pdfUrlLogged) {
      urlState.pdfUrlLogged = true;
      pgcLogBravaPublishPdfUrlFound(
        rawUrl,
        source,
        fileMeta,
        networkStatus,
      );
    }
    return rawUrl;
  };

  const scanBravaPdfUrl = () => {
    try {
      for (const p of viewerPage.context().pages()) {
        const u = p.url();
        if (isPgcBravaPublishToPdfUrl(u)) return { url: u, source: "tab" };
      }
    } catch (_) {}
    try {
      for (const fr of viewerPage.frames()) {
        const u = fr.url() || "";
        if (isPgcBravaPublishToPdfUrl(u)) return { url: u, source: "frame" };
      }
    } catch (_) {}
    for (const r of responseRecords || []) {
      const u = String(r.url || "");
      if (isPgcBravaPublishToPdfUrl(u)) return { url: u, source: "network" };
    }
    return null;
  };

  while (Date.now() - start < timeoutMs) {
    let found = scanBravaPdfUrl();
    if (found) {
      const u = resolveAndLogUrl(found.url, found.source);
      if (u) return { ok: true, url: u };
    }

    await tryPgcPdfPublishOptionsDialogOnce(
      frame,
      viewerPage,
      fileMeta,
      uiState,
    );
    found = scanBravaPdfUrl();
    if (found) {
      const u = resolveAndLogUrl(found.url, found.source);
      if (u) return { ok: true, url: u };
    }

    await tryPgcExportCompletePopupOnce(frame, viewerPage, fileMeta, uiState);
    found = scanBravaPdfUrl();
    if (found) {
      const u = resolveAndLogUrl(found.url, found.source);
      if (u) return { ok: true, url: u };
    }

    await viewerPage.waitForTimeout(360);
  }

  const lastFound = scanBravaPdfUrl();
  if (lastFound) {
    const u = resolveAndLogUrl(lastFound.url, lastFound.source);
    if (u) return { ok: true, url: u };
  }

  if (uiState.pdfOptionsPublishMissing) {
    return { ok: false, error: "pdf_publish_button_not_clicked" };
  }
  if (uiState.exportOkMissing) {
    return { ok: false, error: "export_complete_ok_not_clicked" };
  }
  pgcProgress.emitPgcProgress("publishtoformat_pdf_not_seen", {
    stage: "publishtoformat_pdf_not_seen",
    status: "fail",
    terminalLine: `[PGC] Brava | publishtoformat_pdf_not_seen | ${fileMeta.name || fileMeta.fileId}`,
  });
  return { ok: false, error: "publishtoformat_pdf_not_seen" };
}

/**
 * Wait for navigation or network to expose `publishtoformat/.../pdf` (sole publish success signal).
 * @param {import('playwright').Page} viewerPage
 * @param {import('playwright').Frame|null} frame
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Array<Record<string, unknown>>} responseRecords
 * @param {{ timeoutMs?: number }} [opts]
 */
async function waitForPgcBravaPublishPdfResult(
  viewerPage,
  frame,
  fileMeta,
  responseRecords,
  opts = {},
) {
  const timeoutMs = opts.timeoutMs ?? 50000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      for (const p of viewerPage.context().pages()) {
        const u = p.url();
        if (isPgcBravaPublishToPdfUrl(u)) {
          pgcProgress.pgcLogDetail("brava_pdf_url_tab", { url: u, file: fileMeta.name || fileMeta.fileId });
          pgcProgress.pgcLogFileStep("pdf_url_detected", {
            meta: { source: "tab", urlSnippet: u.slice(0, 200) },
            terminalLine: `[PGC] Step | pdf_url_detected | ${fileMeta.name || fileMeta.fileId} | tab`,
          });
          return { url: u, error: null };
        }
      }
    } catch (_) {}
    try {
      for (const f of viewerPage.frames()) {
        const u = f.url() || "";
        if (isPgcBravaPublishToPdfUrl(u)) {
          pgcProgress.pgcLogDetail("brava_pdf_url_frame", { url: u, file: fileMeta.name || fileMeta.fileId });
          pgcProgress.pgcLogFileStep("pdf_url_detected", {
            meta: { source: "frame", urlSnippet: u.slice(0, 200) },
            terminalLine: `[PGC] Step | pdf_url_detected | ${fileMeta.name || fileMeta.fileId} | frame`,
          });
          return { url: u, error: null };
        }
      }
    } catch (_) {}
    for (const r of responseRecords) {
      const u = String(r.url || "");
      if (isPgcBravaPublishToPdfUrl(u)) {
        pgcProgress.pgcLogDetail("brava_pdf_url_network", {
          url: u,
          status: r.status,
          file: fileMeta.name || fileMeta.fileId,
        });
        pgcProgress.pgcLogFileStep("pdf_url_detected", {
          meta: { source: "network", status: r.status, urlSnippet: u.slice(0, 200) },
          terminalLine: `[PGC] Step | pdf_url_detected | ${fileMeta.name || fileMeta.fileId} | network`,
        });
        return { url: u, error: null };
      }
    }
    await viewerPage.waitForTimeout(380);
  }
  pgcProgress.emitPgcProgress("publishtoformat_pdf_not_seen", {
    stage: "publishtoformat_pdf_not_seen",
    status: "fail",
    terminalLine: `[PGC] Brava | publishtoformat_pdf_not_seen | ${fileMeta.name || fileMeta.fileId}`,
  });
  return { url: null, error: "publishtoformat_pdf_not_seen" };
}

/**
 * Full Brava UI path: Publish → Publish to PDF → flexible post-publish wait (dialog / popup / PDF URL).
 * Does not fetch bytes; returns `pdfUrl` when {@link waitForPgcPostPublishSuccess} resolves.
 * @param {import('playwright').Frame|null} bravaFrame
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Array<Record<string, unknown>>} responseRecords
 * @param {{ postPublishTimeoutMs?: number }} [opts]
 */
async function runPgcBravaPublishUiSequence(
  bravaFrame,
  viewerPage,
  fileMeta,
  responseRecords = [],
  opts = {},
) {
  const open = await openPgcBravaPublishMenu(bravaFrame, viewerPage, fileMeta);
  if (!open.ok) return open;
  const sub = await clickPgcBravaPublishToPdf(bravaFrame, viewerPage, fileMeta);
  if (!sub.ok) return sub;
  const wait = await waitForPgcPostPublishSuccess(
    bravaFrame,
    viewerPage,
    fileMeta,
    responseRecords,
    { timeoutMs: opts.postPublishTimeoutMs ?? 90000 },
  );
  if (!wait.ok) return { ok: false, error: wait.error };
  return { ok: true, pdfUrl: wait.url };
}

/**
 * @deprecated Use {@link runPgcBravaPublishUiSequence}.
 * @param {import('playwright').Page|import('playwright').Frame|null} frameOrNull
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 */
async function triggerPgcBravaPdfPublish(frameOrNull, viewerPage, fileMeta) {
  const frame =
    frameOrNull && typeof frameOrNull.page === "function"
      ? /** @type {import('playwright').Frame} */ (frameOrNull)
      : null;
  const r = await runPgcBravaPublishUiSequence(
    frame,
    viewerPage,
    fileMeta,
    [],
  );
  if (!r.ok) {
    pgcProgress.pgcLogDetail("brava_publish_ui_sequence_failed", {
      error: r.error,
      fileMeta,
    });
    console.log(
      `[PGC] Brava | UI sequence failed | ${r.error} | ${fileMeta.name || fileMeta.fileId}`,
    );
  }
}

/**
 * GET Brava `publishtoformat/.../pdf` and validate with {@link isValidPgcPublishedPdf}.
 * @param {import('playwright').BrowserContext} browserContext
 * @param {string} rawUrl
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {import('playwright').Page} viewerPage
 */
async function fetchPgcBravaPublishedPdf(
  browserContext,
  rawUrl,
  fileMeta,
  viewerPage,
) {
  let viewerOrigin = PGC_BASE;
  try {
    viewerOrigin = new URL(viewerPage.url()).origin;
  } catch (_) {}

  const url = pgcAbsolutizeViewerUrl(rawUrl, viewerOrigin);
  if (!url || !isPgcBravaPublishToPdfUrl(url)) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "not_brava_publish_pdf_url",
      String(rawUrl),
      {},
    );
    return { buffer: null, error: "not_brava_publish_pdf_url" };
  }

  pgcProgress.pgcLogDetail("brava_fetch_pdf_start", {
    url,
    file: fileMeta.name || fileMeta.fileId,
  });
  console.log(
    `[PGC] Brava | fetch published PDF | ${fileMeta.name || fileMeta.fileId}`,
  );

  try {
    const res = await browserContext.request.get(url, {
      timeout: 90000,
      maxRedirects: 20,
      failOnStatusCode: false,
    });
    const st = res.status();
    const ct = res.headers()["content-type"] || "";
    const cd = res.headers()["content-disposition"] || "";
    /** @type {Buffer} */
    let buf;
    try {
      buf = Buffer.from(await res.body());
    } catch (e) {
      logPgcViewerDocCandidate(
        fileMeta,
        "reject",
        "unreadable_brava_request",
        url,
        { err: (e && e.message) || String(e) },
      );
      return { buffer: null, error: "unreadable_brava_request" };
    }
    const cand = {
      url,
      status: st,
      contentType: ct,
      contentDisposition: cd,
      byteLength: buf.length,
      buffer: buf,
    };
    const v = isValidPgcPublishedPdf(cand, fileMeta);
    if (v.ok) {
      pgcProgress.pgcLogDetail("brava_pdf_validation", {
        file: fileMeta.name || fileMeta.fileId,
        bytes: buf.length,
        contentType: ct,
        status: st,
      });
      pgcProgress.pgcLogFileStep("pdf_validation_ok", {
        meta: { bytes: buf.length, contentType: ct.slice(0, 80) },
        terminalLine: `[PGC] Step | pdf_validation_ok | ${fileMeta.name || fileMeta.fileId} | ${buf.length} bytes`,
      });
      logPgcViewerDocCandidate(fileMeta, "accept", "brava_publish_pdf", url, {
        bytes: buf.length,
        status: st,
      });
      return {
        buffer: buf,
        url,
        contentType: ct,
        contentDisposition: cd,
        error: null,
      };
    }
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      v.rejectReason || "rejected",
      url,
      { bytes: buf.length, contentType: ct, status: st },
    );
    return { buffer: null, error: v.rejectReason || "rejected" };
  } catch (e) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "fetch_error",
      url,
      { err: (e && e.message) || String(e) },
    );
    return { buffer: null, error: "fetch_error" };
  }
}

/**
 * Highest-priority capture: Brava `publishtoformat/.../pdf` from network or after toolbar trigger.
 * @param {import('playwright').Page} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Array<Record<string, unknown>>} responseRecords
 * @param {import('playwright').BrowserContext} ctx
 * @param {{ allowTrigger?: boolean }} [opts]
 */
async function capturePgcBravaPublishResult(
  viewerPage,
  fileMeta,
  responseRecords,
  ctx,
  opts = {},
) {
  const allowTrigger = opts.allowTrigger !== false;

  const collectPublishUrls = () => {
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (const r of responseRecords) {
      const u = String(r.url || "");
      if (!isPgcBravaPublishToPdfUrl(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  };

  const tryAll = async () => {
    for (const u of collectPublishUrls()) {
      const got = await fetchPgcBravaPublishedPdf(ctx, u, fileMeta, viewerPage);
      if (got.buffer && !got.error) return got;
    }
    return null;
  };

  let got = await tryAll();
  if (got) return { ...got, captureKind: "brava_publish" };

  if (!allowTrigger) return { buffer: null, captureKind: null };

  const bravaFrame = await findPgcBravaContentFrame(viewerPage);
  pgcProgress.pgcLogDetail("brava_trigger_full_ui_sequence", {
    frameUrlSnippet: bravaFrame ? bravaFrame.url().slice(0, 400) : null,
    fileMeta,
  });
  console.log(
    `[PGC] Brava | triggering Publish→PDF UI | ${fileMeta.name || fileMeta.fileId}`,
  );

  const ui = await runPgcBravaPublishUiSequence(
    bravaFrame,
    viewerPage,
    fileMeta,
    responseRecords,
  );
  if (!ui.ok) {
    return {
      buffer: null,
      captureKind: null,
      publishFlowError: ui.error,
    };
  }

  await viewerPage.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await viewerPage.waitForTimeout(400);

  const primaryUrl =
    ui.pdfUrl ||
    pgcFindBravaPublishPdfUrl(viewerPage, responseRecords);
  /** @type {string | null} */
  let lastFetchErr = null;
  if (!primaryUrl) {
    const waitPdf = await waitForPgcBravaPublishPdfResult(
      viewerPage,
      bravaFrame,
      fileMeta,
      responseRecords,
      { timeoutMs: 35000 },
    );
    if (!waitPdf.url) {
      return {
        buffer: null,
        captureKind: null,
        publishFlowError: waitPdf.error || "publishtoformat_pdf_not_seen",
      };
    }
    got = await fetchPgcBravaPublishedPdf(
      ctx,
      waitPdf.url,
      fileMeta,
      viewerPage,
    );
  } else {
    got = await fetchPgcBravaPublishedPdf(
      ctx,
      primaryUrl,
      fileMeta,
      viewerPage,
    );
  }
  if (got && got.error) lastFetchErr = String(got.error);
  if (got && got.buffer && !got.error) {
    return { ...got, captureKind: "brava_publish" };
  }

  got = await tryAll();
  if (got) return { ...got, captureKind: "brava_publish" };

  return {
    buffer: null,
    captureKind: null,
    publishFlowError: lastFetchErr || "publishtoformat_pdf_not_seen",
  };
}

/**
 * Authenticated GET using browser storage state; validates with {@link isValidPgcViewerDocument}.
 * @param {import('playwright').BrowserContext} browserContext
 * @param {string} rawUrl
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {import('playwright').Page} viewerPage
 */
async function fetchPgcViewerDocument(browserContext, rawUrl, fileMeta, viewerPage) {
  let viewerOrigin = PGC_BASE;
  try {
    viewerOrigin = new URL(viewerPage.url()).origin;
  } catch (_) {}

  const url = pgcAbsolutizeViewerUrl(rawUrl, viewerOrigin);
  if (!url) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "invalid_url",
      String(rawUrl),
      {},
    );
    return { buffer: null, error: "invalid_url" };
  }
  if (isDiscouragedPgcStaticAssetUrl(url)) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "static_asset_response",
      url,
      {},
    );
    return { buffer: null, error: "static_asset_response" };
  }
  if (isPgcBravaPublishToPdfUrl(url)) {
    return fetchPgcBravaPublishedPdf(
      browserContext,
      rawUrl,
      fileMeta,
      viewerPage,
    );
  }
  if (pgcUrlIsViewerSupportMetadata(url)) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "viewer_support_request_only",
      url,
      {},
    );
    return { buffer: null, error: "viewer_support_request_only" };
  }

  try {
    const res = await browserContext.request.get(url, {
      timeout: 90000,
      maxRedirects: 20,
      failOnStatusCode: false,
    });
    const st = res.status();
    const ct = res.headers()["content-type"] || "";
    const cd = res.headers()["content-disposition"] || "";
    /** @type {Buffer} */
    let buf;
    try {
      buf = Buffer.from(await res.body());
    } catch (e) {
      logPgcViewerDocCandidate(
        fileMeta,
        "reject",
        "unreadable_brava_request",
        url,
        { err: (e && e.message) || String(e) },
      );
      return { buffer: null, error: "unreadable_brava_request" };
    }
    const cand = {
      url,
      status: st,
      contentType: ct,
      contentDisposition: cd,
      byteLength: buf.length,
      buffer: buf,
    };
    const v = isValidPgcViewerDocument(cand, fileMeta);
    if (v.ok) {
      logPgcViewerDocCandidate(fileMeta, "accept", "valid_document", url, {
        bytes: buf.length,
        contentType: ct,
        status: st,
      });
      return {
        buffer: buf,
        url,
        contentType: ct,
        contentDisposition: cd,
        error: null,
      };
    }
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      v.rejectReason || "rejected",
      url,
      { bytes: buf.length, contentType: ct, status: st },
    );
    return { buffer: null, error: v.rejectReason || "rejected" };
  } catch (e) {
    logPgcViewerDocCandidate(
      fileMeta,
      "reject",
      "fetch_error",
      url,
      { err: (e && e.message) || String(e) },
    );
    return { buffer: null, error: "fetch_error" };
  }
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
function pgcViewerSignalsRenderedPagesOnly(records) {
  const list = records || [];
  const tiles = list.filter(
    (r) =>
      Number(r.status) === 200 &&
      (String(r.classification || "") === "image_tile" ||
        String(r.classification || "") === "viewer_tile" ||
        /\btiles?\b/i.test(String(r.url || ""))),
  ).length;
  const pdfHit = list.some(
    (r) =>
      Number(r.status) === 200 &&
      (String(r.classification || "") === "pdf_like" ||
        String(r.classification || "") === "brava_pdf_candidate" ||
        String(r.classification || "") === "brava_publish_pdf" ||
        String(r.contentType || "").includes("pdf")),
  );
  const brava = list.some((r) =>
    /bravaserver|:8443/i.test(String(r.url || "")),
  );
  return brava && !pdfHit && tiles >= 2;
}

/**
 * Capture document bytes after ActiveXViewer loads (authenticated API request).
 * Pass `opts.responseRecords` mutated by a `page.on('response')` handler attached before this runs.
 * @param {import('playwright').Page | null} viewerPage
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {{ responseRecords?: Array<Record<string, unknown>> }} [opts]
 */
async function capturePgcViewerDocument(viewerPage, fileMeta, opts = {}) {
  if (!viewerPage) {
    return {
      error: "unknown_viewer_open_failure",
      buffer: null,
      url: null,
      contentType: "",
      contentDisposition: "",
      triedUrl: null,
    };
  }
  try {
    if (viewerPage.isClosed()) {
      return {
        error: "viewer_page_closed",
        buffer: null,
        url: null,
        contentType: "",
        contentDisposition: "",
        triedUrl: null,
      };
    }
  } catch (_) {
    return {
      error: "viewer_context_closed",
      buffer: null,
      url: null,
      contentType: "",
      contentDisposition: "",
      triedUrl: null,
    };
  }

  const responseRecords = opts.responseRecords || [];
  const ctx = viewerPage.context();

  await inspectPgcActiveXViewer(viewerPage, fileMeta);
  await viewerPage.waitForLoadState("domcontentloaded").catch(() => {});
  await viewerPage.waitForTimeout(1200);
  await viewerPage.waitForLoadState("networkidle", { timeout: 32000 }).catch(() => {});
  await viewerPage.waitForTimeout(2200);

  capturePgcViewerDocumentRequests(fileMeta, responseRecords);

  const publishFirst = await capturePgcBravaPublishResult(
    viewerPage,
    fileMeta,
    responseRecords,
    ctx,
    { allowTrigger: true },
  );
  if (publishFirst && publishFirst.buffer && !publishFirst.error) {
    return {
      buffer: publishFirst.buffer,
      url: publishFirst.url || null,
      contentType: publishFirst.contentType || "",
      contentDisposition: publishFirst.contentDisposition || "",
      error: null,
      captureKind: "brava_publish",
      triedUrl: publishFirst.url || null,
    };
  }
  if (publishFirst && publishFirst.publishFlowError && !publishFirst.buffer) {
    return {
      error: publishFirst.publishFlowError,
      publishFlowError: publishFirst.publishFlowError,
      buffer: null,
      url: null,
      contentType: "",
      contentDisposition: "",
      triedUrl: null,
    };
  }

  const dom = await extractPgcViewerDocumentSource(viewerPage, fileMeta);
  let viewerOrigin = PGC_BASE;
  try {
    viewerOrigin = new URL(viewerPage.url()).origin;
  } catch (_) {}

  const publishAfterDom = await capturePgcBravaPublishResult(
    viewerPage,
    fileMeta,
    responseRecords,
    ctx,
    { allowTrigger: false },
  );
  if (publishAfterDom && publishAfterDom.buffer && !publishAfterDom.error) {
    return {
      buffer: publishAfterDom.buffer,
      url: publishAfterDom.url || null,
      contentType: publishAfterDom.contentType || "",
      contentDisposition: publishAfterDom.contentDisposition || "",
      error: null,
      captureKind: "brava_publish",
      triedUrl: publishAfterDom.url || null,
    };
  }
  if (publishAfterDom && publishAfterDom.publishFlowError && !publishAfterDom.buffer) {
    return {
      error: publishAfterDom.publishFlowError,
      publishFlowError: publishAfterDom.publishFlowError,
      buffer: null,
      url: null,
      contentType: "",
      contentDisposition: "",
      triedUrl: null,
    };
  }

  /** @type {string[]} */
  const orderedUrls = [];
  const seen = new Set();
  const pushU = (u) => {
    const a = pgcAbsolutizeViewerUrl(u, viewerOrigin);
    if (!a || seen.has(a)) return;
    seen.add(a);
    orderedUrls.push(a);
  };

  for (const u of dom.urls || []) pushU(u);

  const DEMOTED = new Set([
    "brava_search_index",
    "brava_raster_demoted",
    "brava_vector_demoted",
    "brava_thumb_demoted",
    "brava_config_demoted",
    "brava_markup_meta_demoted",
    "brava_client_html_demoted",
    "unreadable_or_pending",
  ]);

  const priorityClass = new Set([
    "brava_publish_pdf",
    "brava_pdf_candidate",
    "pdf_like",
    "brava_stream_candidate",
    "stream_candidate",
  ]);
  const netSorted = [...responseRecords].sort((a, b) => {
    const ca = String(a.classification || "");
    const cb = String(b.classification || "");
    const rank = (c) => {
      if (c === "brava_publish_pdf") return 0;
      if (priorityClass.has(c)) return 1;
      return 2;
    };
    const ra = rank(ca);
    const rb = rank(cb);
    if (ra !== rb) return ra - rb;
    return String(b.url || "").length - String(a.url || "").length;
  });
  for (const r of netSorted) {
    const cls = String(r.classification || "");
    if (DEMOTED.has(cls)) continue;
    const ru = String(r.url || "");
    if (pgcUrlIsBravaNonPublishNoiseUrl(ru)) continue;
    pushU(ru);
  }

  for (const u of orderedUrls) {
    const got = await fetchPgcViewerDocument(ctx, u, fileMeta, viewerPage);
    if (got.buffer && !got.error) {
      return {
        buffer: got.buffer,
        url: got.url || u,
        contentType: got.contentType || "",
        contentDisposition: got.contentDisposition || "",
        error: null,
        captureKind: isPgcBravaPublishToPdfUrl(got.url || u)
          ? "brava_publish"
          : "viewer_flow",
      };
    }
  }

  if (pgcViewerSignalsRenderedPagesOnly(responseRecords)) {
    console.log(
      "[PGC] viewer_exposes_rendered_pages_only — no validated original binary captured for",
      fileMeta.name || fileMeta.fileId,
    );
    return {
      error: "viewer_opened_render_only_no_original_binary",
      buffer: null,
      url: null,
      contentType: "",
      contentDisposition: "",
      triedUrl: orderedUrls[0] || null,
    };
  }

  return {
    error: "no_document_payload_seen",
    buffer: null,
    url: null,
    contentType: "",
    contentDisposition: "",
    triedUrl: orderedUrls[0] || null,
  };
}

/**
 * Full PGC Files-tab download: row → Task Assignment → ActiveXViewer → validated bytes.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} rowLocator
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {string} destRoot
 * @param {{ debug?: boolean }} [opts]
 */
async function runPgcFileDownloadViaViewerFlow(
  page,
  rowLocator,
  fileMeta,
  destRoot,
  opts = {},
) {
  const debug = !!opts.debug;
  /** @type {Record<string, unknown>} */
  const out = {
    resolvedActionType: "viewer_flow",
    resolvedActionUrl: null,
    clickedSelectorSummary: null,
    httpStatus: null,
    contentType: null,
    byteLength: 0,
    downloaded: false,
    uploaded: false,
    error: null,
    localPath: null,
    finalFetchUrl: null,
    viewerUrl: null,
    modalHandled: false,
    preClickUrl: null,
  };

  const openRes = await openPgcViewerForFile(page, rowLocator, fileMeta);
  out.preClickUrl = openRes.preClickUrl;
  out.viewerUrl = openRes.viewerUrl || null;
  out.resolvedActionUrl = openRes.viewerUrl || null;
  out.modalHandled = !!openRes.modalHandled;
  out.clickedSelectorSummary = openRes.clickedSelectorSummary;

  const viewerPage = openRes.viewerPage;

  if (openRes.error) {
    out.error = openRes.error;
    if (viewerPage && viewerPage !== page) {
      await viewerPage.close().catch(() => {});
    }
    return out;
  }

  /** @type {Array<Record<string, unknown>>} */
  const responseRecords = [];
  const viewerRespHandler = (res) => {
    pgcPushViewerResponseRecord(responseRecords, res);
  };
  viewerPage.on("response", viewerRespHandler);
  /** @type {Awaited<ReturnType<typeof capturePgcViewerDocument>> | null} */
  let cap = null;
  try {
    cap = await capturePgcViewerDocument(viewerPage, fileMeta, {
      responseRecords,
    });
  } finally {
    viewerPage.off("response", viewerRespHandler);
  }

  if (!cap || !cap.buffer || cap.error || cap.publishFlowError) {
    out.error =
      (cap && (cap.publishFlowError || cap.error)) ||
      "viewer_opened_but_document_not_captured";
    logPgcFileResponseRejected(
      fileMeta,
      {
        url: (cap && cap.triedUrl) || "",
        status: 0,
        contentType: (cap && cap.contentType) || "",
        byteLength: 0,
      },
      out.error,
    );
    if (viewerPage && viewerPage !== page) {
      await viewerPage.close().catch(() => {});
    }
    return out;
  }

  const val =
    cap.captureKind === "brava_publish"
      ? isValidPgcPublishedPdf(
          {
            url: cap.url || "",
            status: 200,
            contentType: cap.contentType || "",
            contentDisposition: cap.contentDisposition || "",
            byteLength: cap.buffer.length,
            buffer: cap.buffer,
          },
          fileMeta,
        )
      : isValidPgcDownloadedFile(
          {
            url: cap.url || "",
            status: 200,
            contentType: cap.contentType || "",
            contentDisposition: cap.contentDisposition || "",
            byteLength: cap.buffer.length,
            buffer: cap.buffer,
          },
          fileMeta,
        );
  if (!val.ok) {
    logPgcFileResponseRejected(
      fileMeta,
      {
        url: cap.url,
        status: 200,
        contentType: cap.contentType,
        byteLength: cap.buffer.length,
        buffer: cap.buffer,
      },
      val.rejectReason || "validation_failed",
    );
    out.error = normalizePgcPerFileDownloadError(
      val.rejectReason,
      "pdf_validation_failed",
    );
    if (viewerPage && viewerPage !== page) {
      await viewerPage.close().catch(() => {});
    }
    return out;
  }

  if (cap.buffer.length > TASK6_MAX_FILE_BYTES) {
    out.error = `body too large (${cap.buffer.length})`;
    if (viewerPage && viewerPage !== page) {
      await viewerPage.close().catch(() => {});
    }
    return out;
  }

  await fs.promises.mkdir(destRoot, { recursive: true });
  let baseNm = sanitizeLocalFileName(
    fileMeta.name || `file-${fileMeta.fileId || "x"}`,
  );
  let ext = path.extname(baseNm);
  const stem = ext ? baseNm.slice(0, -ext.length) : baseNm;
  if (!ext) ext = guessExtensionFromMime(cap.contentType || "");
  let outPath = path.join(
    destRoot,
    baseNm.endsWith(ext) ? baseNm : stem + ext,
  );
  let n = 0;
  while (fs.existsSync(outPath)) {
    n += 1;
    outPath = path.join(
      destRoot,
      `${stem}_${fileMeta.fileId || "x"}_${n}${ext}`,
    );
  }
  await fs.promises.writeFile(outPath, cap.buffer);
  out.downloaded = true;
  out.byteLength = cap.buffer.length;
  out.contentType = cap.contentType || null;
  out.httpStatus = 200;
  out.localPath = outPath;
  out.finalFetchUrl = cap.url || openRes.viewerUrl;
  out.resolvedActionType =
    cap.captureKind === "brava_publish" ? "brava_publish_pdf" : "viewer_flow";

  console.log(
    "[PGC] Saved local file:",
    out.localPath,
    "| resolvedActionType:",
    out.resolvedActionType,
    "| bytes:",
    out.byteLength,
    "| finalFetchUrl:",
    String(out.finalFetchUrl || "").slice(0, 220),
    "| upload: runPgcProductionPipeline(uploadLocal) when configured",
  );

  if (viewerPage && viewerPage !== page) {
    await viewerPage.close().catch(() => {});
  }
  if (debug) {
    console.log(
      "[PGC] viewer_flow OK:",
      fileMeta.name,
      "| bytes:",
      out.byteLength,
      "|",
      out.resolvedActionType,
    );
  }
  return out;
}

/**
 * Collect candidate URLs only inside the resolved row.
 * @param {import('playwright').Locator} rowLocator
 * @param {{ fileName?: string|null, fileId?: string|null }} meta
 */
async function collectPgcFileRowCandidateUrlsScoped(rowLocator, meta) {
  const rawList = await rowLocator
    .evaluate(
      (tr, { fileId }) => {
        /** @type {string[]} */
        const out = [];
        tr.querySelectorAll("*").forEach((el) => {
          const href = el.getAttribute && el.getAttribute("href");
          if (href && !/^javascript:\s*void/i.test(href)) out.push(href);
          const oc = el.getAttribute && el.getAttribute("onclick");
          if (oc) {
            const m = oc.match(/https?:\/\/[^'")\s]+/i);
            if (m) out.push(m[0]);
          }
          if (el.attributes) {
            for (const a of el.attributes) {
              if (
                /^(data-url|data-href|data-src|data-fileurl|data-downloadurl)$/i.test(
                  a.name,
                ) &&
                a.value
              ) {
                out.push(a.value);
              }
            }
          }
        });
        return out;
      },
      { fileId: meta.fileId },
    )
    .catch(() => []);

  /** @type {string[]} */
  const abs = [];
  for (const r of rawList || []) {
    const u =
      makeAbsolutePortalUrl(r) || makeAbsolutePortalUrl(extractUrlFromOnclick(r));
    if (
      u &&
      !isDiscouragedPgcSyntheticFileDownloadUrl(u) &&
      !isDiscouragedPgcStaticAssetUrl(u)
    )
      abs.push(u);
  }
  return [...new Set(abs)];
}

/**
 * Resolve download/view action using only elements inside the file row (no page-wide network sniff).
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} rowLocator
 * @param {{ fileName?: string|null, fileId?: string|null }} meta
 * @param {{ debug?: boolean }} [opts]
 */
async function resolvePgcFileActionFromRow(page, rowLocator, meta, opts = {}) {
  const debug = !!opts.debug;
  const fileName = (meta.fileName && String(meta.fileName).trim()) || "";
  const fileId = meta.fileId != null ? String(meta.fileId) : "";
  const wantLower = fileName.toLowerCase();
  const base =
    wantLower.includes("/") || wantLower.includes("\\")
      ? wantLower.replace(/.*[/\\]/, "")
      : wantLower;

  /** @type {Record<string, unknown>} */
  const baseOut = {
    resolvedActionType: "none",
    resolvedActionUrl: null,
    clickedSelectorSummary: null,
    networkUrlsSample: [],
    errorReason: null,
    _download: null,
    _popup: null,
    _rowScoped: true,
  };

  const domUrls = await collectPgcFileRowCandidateUrlsScoped(rowLocator, meta);
  for (const u of domUrls) {
    if (u && !isDiscouragedPgcSyntheticFileDownloadUrl(u)) {
      baseOut.resolvedActionType = "direct_url";
      baseOut.resolvedActionUrl = u;
      baseOut.clickedSelectorSummary = "row_dom_href_or_data";
      if (debug) {
        console.log("[PGC] resolvePgcFileActionFromRow: direct_url", u.slice(0, 200));
      }
      return baseOut;
    }
  }

  /** @type {{ order: number, tag: string, title: string, text: string, idx: number }[]} */
  const plan = await rowLocator
    .evaluate((tr, { wantLower, base }) => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const els = Array.from(
        tr.querySelectorAll(
          "a[href], a[onclick], button, [role='button'], [onclick], img[title], span[title]",
        ),
      );
      /** @type {{ order: number, tag: string, title: string, text: string, idx: number }[]} */
      const items = [];
      els.forEach((el, idx) => {
        const tag = el.tagName.toLowerCase();
        const title = (el.getAttribute("title") || "").toLowerCase();
        const text = norm(el.textContent).toLowerCase();
        const href = (el.getAttribute("href") || "").toLowerCase();
        if (
          href &&
          (/\.(png|jpe?g|gif|svg|ico|css|js)\b/i.test(href) ||
            /\/media\/img\//i.test(href))
        )
          return;
        let order = 50;
        if (wantLower && text === wantLower) order = 5;
        else if (base && text.includes(base)) order = 12;
        else if (/view|open|download|file/i.test(title)) order = 20;
        else if (tag === "a" && text.length > 3) order = 35;
        items.push({
          order,
          tag,
          title: el.getAttribute("title") || "",
          text: norm(el.textContent).slice(0, 80),
          idx,
        });
      });
      items.sort((a, b) => a.order - b.order);
      return items;
    }, { wantLower, base })
    .catch(() => []);

  const handles = rowLocator.locator(
    "a[href], a[onclick], button, [role='button'], [onclick], img[title], span[title]",
  );
  const n = await handles.count().catch(() => 0);
  const tryIdxs = [...new Set((plan || []).map((p) => p.idx))];
  if (tryIdxs.length === 0) {
    for (let i = 0; i < Math.min(n, 10); i += 1) tryIdxs.push(i);
  }

  for (const i of tryIdxs.slice(0, 12)) {
    if (i < 0 || i >= n) continue;
    const handle = handles.nth(i);
    const vis = await handle.isVisible().catch(() => false);
    if (!vis) continue;
    const href = (await handle.getAttribute("href").catch(() => null)) || "";
    if (href && isDiscouragedPgcStaticAssetUrl(href)) continue;

    const tag = await handle
      .evaluate((el) => el.tagName.toLowerCase())
      .catch(() => "?");
    const title = (await handle.getAttribute("title").catch(() => "")) || "";
    baseOut.clickedSelectorSummary = `${tag}[${i}] title=${title.slice(0, 40)}`;

    const downloadP = page
      .waitForEvent("download", { timeout: 22000 })
      .catch(() => null);
    const popupP = page
      .context()
      .waitForEvent("page", { timeout: 14000 })
      .catch(() => null);

    await handle.scrollIntoViewIfNeeded().catch(() => {});
    await handle.click({ timeout: 9000 }).catch(() => {});

    const dl = await downloadP;
    if (dl) {
      baseOut.resolvedActionType = "download_event";
      baseOut._download = dl;
      baseOut.errorReason = null;
      if (debug) {
        console.log(
          "[PGC] resolvePgcFileActionFromRow: download_event",
          baseOut.clickedSelectorSummary,
        );
      }
      return baseOut;
    }

    const popup = await popupP;
    if (popup) {
      baseOut.resolvedActionType = "popup";
      baseOut._popup = popup;
      try {
        await popup
          .waitForLoadState("domcontentloaded", { timeout: 18000 })
          .catch(() => {});
        baseOut.resolvedActionUrl = popup.url();
      } catch (_) {}
      if (debug) {
        console.log("[PGC] resolvePgcFileActionFromRow: popup", baseOut.resolvedActionUrl);
      }
      return baseOut;
    }

    await page.waitForTimeout(350);
  }

  baseOut.errorReason = "click_produced_no_download_or_popup";
  return baseOut;
}

/**
 * @deprecated Use resolvePgcFileActionFromRow after findPgcFileGridRow.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} rowLocator
 * @param {{ fileName?: string|null, fileId?: string|null, folderID?: string, folderName?: string }} meta
 * @param {{ debug?: boolean }} [opts]
 */
async function resolvePgcFileDownloadAction(page, rowLocator, meta, opts) {
  if (!rowLocator) {
    return {
      resolvedActionType: "none",
      resolvedActionUrl: null,
      clickedSelectorSummary: null,
      networkUrlsSample: [],
      errorReason: "no_row_found",
      _download: null,
      _popup: null,
    };
  }
  return resolvePgcFileActionFromRow(page, rowLocator, meta, opts);
}

/**
 * Log DOM truth for a file row (anchors, onclick, data-*, snippet).
 * @param {import('playwright').Page} page
 * @param {{ fileId?: string|null, name?: string|null }} fileMeta
 * @param {string} label
 */
async function logPgcFileActionDiagnostics(page, fileMeta, label) {
  const ev = await page.evaluate(({ fileId, fileName }) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    const want = norm(fileName).toLowerCase();
    const fid = String(fileId || "");
    const rows = Array.from(
      document.querySelectorAll(".ui-iggrid-table tbody tr, table tbody tr"),
    );
    for (const tr of rows) {
      const t = norm(tr.innerText).toLowerCase();
      if (want && !t.includes(want)) continue;
      if (!want && fid && !t.includes(fid) && !String(tr.innerHTML).includes(fid))
        continue;
      const controls = Array.from(
        tr.querySelectorAll(
          "a, button, [role='button'], [onclick], span[class*='icon'], img",
        ),
      )
        .slice(0, 20)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const href = el.getAttribute("href");
          const onclick = el.getAttribute("onclick");
          const title = el.getAttribute("title");
          /** @type {Record<string, string>} */
          const data = {};
          for (const a of el.attributes) {
            if (a.name.startsWith("data-"))
              data[a.name] = String(a.value || "").slice(0, 220);
          }
          return {
            tag,
            text: norm(el.textContent).slice(0, 100),
            href: href ? href.slice(0, 400) : null,
            onclick: onclick ? onclick.slice(0, 400) : null,
            title: title ? title.slice(0, 160) : null,
            className: String(el.className || "").slice(0, 160),
            data,
          };
        });
      return {
        matched: true,
        rowText: norm(tr.innerText).slice(0, 500),
        htmlSnippet: tr.outerHTML.replace(/\s+/g, " ").trim().slice(0, 950),
        controls,
      };
    }
    return { matched: false, reason: "no_row_found" };
  }, { fileId: fileMeta.fileId, fileName: fileMeta.name });
  console.log(
    `[PGC] File action diagnostics [${label}] ${fileMeta.name || fileMeta.fileId}:`,
    JSON.stringify(ev, null, 2),
  );
}

/**
 * @param {import('playwright').Page} popup
 */
async function pgcTryExtractDocumentUrlFromViewerPage(popup) {
  return popup
    .evaluate(() => {
      const iframe = document.querySelector("iframe[src]");
      if (iframe) return iframe.getAttribute("src");
      const emb = document.querySelector("embed[src]");
      if (emb) return emb.getAttribute("src");
      const obj = document.querySelector("object[data]");
      if (obj) return obj.getAttribute("data");
      const a = document.querySelector(
        'a[href*=".pdf"], a[href*="Download"], a[download], a[href*="file"]',
      );
      return a ? a.getAttribute("href") : null;
    })
    .catch(() => null);
}

/**
 * @param {import('playwright').Page} page
 * @param {{ name?: string|null, fileId?: string|null }} fileMeta
 * @param {Record<string, unknown>} resolved from resolvePgcFileDownloadAction
 * @param {string} destRoot
 * @returns {Promise<Record<string, unknown>>}
 */
async function downloadPgcFileBinary(page, fileMeta, resolved, destRoot) {
  const dlObj = /** @type {import('playwright').Download|null} */ (
    resolved._download || null
  );
  const popup = /** @type {import('playwright').Page|null} */ (
    resolved._popup || null
  );

  /** @type {Record<string, unknown>} */
  const out = {
    resolvedActionType: resolved.resolvedActionType,
    resolvedActionUrl: resolved.resolvedActionUrl,
    clickedSelectorSummary: resolved.clickedSelectorSummary,
    httpStatus: null,
    contentType: null,
    byteLength: 0,
    downloaded: false,
    uploaded: false,
    error: resolved.errorReason || null,
    localPath: null,
    finalFetchUrl: null,
  };

  const writeBuf = async (buf, ct, cd, fetchUrl) => {
    if (buf.length > TASK6_MAX_FILE_BYTES) {
      out.error = `body too large (${buf.length})`;
      out.byteLength = buf.length;
      return false;
    }
    const val = isValidPgcFileResponse(fileMeta, {
      url: String(fetchUrl || ""),
      status: 200,
      contentType: ct,
      contentDisposition: cd,
      byteLength: buf.length,
      buffer: buf,
    });
    if (!val.ok) {
      logPgcFileResponseRejected(
        fileMeta,
        {
          url: fetchUrl,
          status: 200,
          contentType: ct,
          byteLength: buf.length,
          buffer: buf,
        },
        val.rejectReason || "validation_failed",
      );
      out.error = val.rejectReason || "validation_failed";
      out.contentType = ct || null;
      out.byteLength = buf.length;
      return false;
    }
    await fs.promises.mkdir(destRoot, { recursive: true });
    let baseNm =
      sanitizeLocalFileName(fileMeta.name || `file-${fileMeta.fileId || "x"}`);
    let ext = path.extname(baseNm);
    const stem = ext ? baseNm.slice(0, -ext.length) : baseNm;
    if (!ext) ext = guessExtensionFromMime(ct);
    let outPath = path.join(destRoot, baseNm.endsWith(ext) ? baseNm : stem + ext);
    let n = 0;
    while (fs.existsSync(outPath)) {
      n += 1;
      outPath = path.join(
        destRoot,
        `${stem}_${fileMeta.fileId || "x"}_${n}${ext}`,
      );
    }
    await fs.promises.writeFile(outPath, buf);
    out.downloaded = true;
    out.byteLength = buf.length;
    out.contentType = ct || null;
    out.httpStatus = 200;
    out.localPath = outPath;
    out.finalFetchUrl = fetchUrl || null;
    return true;
  };

  try {
    if (resolved.errorReason === "no_row_found") {
      out.error = "no_row_found";
      return out;
    }

    if (dlObj) {
      await fs.promises.mkdir(destRoot, { recursive: true });
      const suggested = dlObj.suggestedFilename();
      const tmp = path.join(
        destRoot,
        `.part-${Date.now()}-${sanitizeLocalFileName(suggested || fileMeta.name || "dl")}`,
      );
      await dlObj.saveAs(tmp);
      const buf = await fs.promises.readFile(tmp);
      try {
        await fs.promises.unlink(tmp);
      } catch (_) {}
      const ok = await writeBuf(
        buf,
        "application/octet-stream",
        "attachment",
        "playwright-download",
      );
      if (!ok && !out.error) out.error = "download_event_invalid_body";
      return out;
    }

    if (resolved.resolvedActionType === "direct_url" && resolved.resolvedActionUrl) {
      const url = String(resolved.resolvedActionUrl);
      if (isDiscouragedPgcStaticAssetUrl(url)) {
        logPgcFileResponseRejected(
          fileMeta,
          { url, status: 0, contentType: "", byteLength: 0 },
          "static_asset_response",
        );
        out.error = "static_asset_response";
        return out;
      }
      const res = await page.context().request.get(url, {
        timeout: 60000,
        maxRedirects: 20,
      });
      out.httpStatus = res.status();
      const ct = res.headers()["content-type"] || "";
      const cd = res.headers()["content-disposition"] || "";
      out.contentType = ct;
      if (!res.ok()) {
        out.error = `HTTP ${res.status()}`;
        return out;
      }
      const cl = res.headers()["content-length"];
      if (cl && parseInt(cl, 10) > TASK6_MAX_FILE_BYTES) {
        out.error = `Content-Length too large (${cl})`;
        return out;
      }
      const buf = await res.body();
      out.byteLength = buf.length;
      const ok = await writeBuf(buf, ct, cd, url);
      if (!ok && !out.error) out.error = "response_not_binary";
      return out;
    }

    if (popup) {
      try {
        let fetchUrl = String(resolved.resolvedActionUrl || popup.url());
        let res = await page.context().request.get(fetchUrl, {
          timeout: 60000,
          maxRedirects: 20,
        });
        let ct = res.headers()["content-type"] || "";
        let cd = res.headers()["content-disposition"] || "";
        out.httpStatus = res.status();
        if (res.ok() && !ct.toLowerCase().includes("text/html")) {
          const buf = await res.body();
          const ok = await writeBuf(buf, ct, cd, fetchUrl);
          if (ok) {
            await popup.close().catch(() => {});
            return out;
          }
        }
        const inner = await pgcTryExtractDocumentUrlFromViewerPage(popup);
        if (inner) {
          const abs = makeAbsolutePortalUrl(inner);
          if (
            abs &&
            !isDiscouragedPgcSyntheticFileDownloadUrl(abs) &&
            !isDiscouragedPgcStaticAssetUrl(abs)
          ) {
            res = await page.context().request.get(abs, {
              timeout: 60000,
              maxRedirects: 20,
            });
            ct = res.headers()["content-type"] || "";
            cd = res.headers()["content-disposition"] || "";
            out.httpStatus = res.status();
            if (res.ok()) {
              const buf = await res.body();
              const ok = await writeBuf(buf, ct, cd, abs);
              if (ok) {
                await popup.close().catch(() => {});
                return out;
              }
            }
          }
        }
        out.error = "viewer_opened_but_no_file_url_or_binary";
      } finally {
        await popup.close().catch(() => {});
      }
      return out;
    }

    if (!out.error) out.error = "no_download_action_found";
    return out;
  } catch (e) {
    out.error = (e && e.message) || String(e);
    return out;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectID
 */
async function getProjectFoldersFromFilesTab(page, projectID) {
  const filesTabUrl = `${PGC_WEBUI}/Project/Index?tab=filesTab&ProjectID=${encodeURIComponent(
    String(projectID),
  )}`;
  await page.goto(filesTabUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  try {
    await page.waitForSelector("#folderTree li.ui-igtree-node", {
      timeout: 15000,
    });
  } catch (err) {
    console.warn(
      `[PGC] Task 6 — #folderTree not found for project ${projectID}, skipping files`,
    );
    return [];
  }
  await page.waitForTimeout(1000);

  /** Optional "(N)" suffix on tree node labels — debug / cross-check only. */
  const domFolderHints = await page
    .evaluate(() => {
      /** @type {Record<string, number>} */
      const hints = {};
      for (const li of document.querySelectorAll(
        "#folderTree li.ui-igtree-node",
      )) {
        const v = li.getAttribute("data-value");
        if (!v) continue;
        const a = li.querySelector("a");
        const t = (a?.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const m = t.match(/\((\d+)\)\s*$/);
        if (m) hints[String(v)] = parseInt(m[1], 10);
      }
      return hints;
    })
    .catch(() => (/** @type {Record<string, number>} */ ({})));

  const parentFolders = await page.$$eval(
    "#folderTree li.ui-igtree-node",
    (nodes) =>
      nodes
        .map((node) => ({
          name: node.querySelector("a")?.textContent.trim() || "",
          folderID: node.getAttribute("data-value"),
          path: node.getAttribute("data-path"),
        }))
        .filter(
          (f) =>
            f.folderID &&
            f.path &&
            (f.path.match(/_L/g) || []).length === 1,
        ),
  );

  /** @type {{ folderID: string, folderName: string, parentName: string }[]} */
  const allChildFolders = [];
  /** @type {object[]} */
  const folderTreeDebug = [];

  for (const parent of parentFolders) {
    try {
      const children = await page.evaluate(async (folderID) => {
        const url =
          `https://eplans.princegeorgescountymd.gov/ProjectDoxWebAPI/Folder/GetFolders` +
          `?folderID=${folderID}` +
          `&path=PDEntityID:L${folderID}/@Children` +
          `&binding=textKey:RowTemplate,valueKey:EntityID,primaryKey:PDEntityID,childDataProperty:Children,expandedKey:Expanded,checkedKey:__checked__` +
          `&depth=1`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [];
        return await res.json();
      }, parent.folderID);

      folderTreeDebug.push({
        parent: parent.name,
        childCount: (children || []).length,
      });

      for (const child of children || []) {
        const childFolderID = child.FolderID || child.folderID;
        const childNameRaw =
          child.Name || child.name || String(childFolderID);
        if (!childFolderID) continue;
        const fidStr = String(childFolderID);
        allChildFolders.push({
          folderID: fidStr,
          folderName: normalizeText(String(childNameRaw).replace(/<[^>]+>/g, "")),
          parentName: normalizeText(parent.name || "") || "(parent)",
          domFileCountHint:
            domFolderHints[fidStr] != null && !Number.isNaN(domFolderHints[fidStr])
              ? domFolderHints[fidStr]
              : null,
        });
      }

      await page.waitForTimeout(200);
    } catch (err) {
      console.warn(
        `[PGC] Task 6 — GetFolders failed for "${parent.name}": ${(err && err.message) || err}`,
      );
    }
  }

  pgcProgress.pgcLogDetail("task6_folder_tree_introspection", {
    projectID,
    parentFolderCount: parentFolders.length,
    childFolderCount: allChildFolders.length,
    folderTreeDebug,
  });
  console.log(
    `[PGC] Task 6 folder tree | parents:${parentFolders.length} children:${allChildFolders.length} → pgc-debug-detail.log`,
  );
  return allChildFolders;
}

/**
 * @param {import('playwright').Page} page
 * @param {{ folderID: string, folderName: string }} folder
 */
async function getFolderFiles(page, folder) {
  const url = pgcGetFolderFilesUrl(folder.folderID);
  const result = await page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: "include" });
    if (!res.ok) return { ok: false, status: res.status, json: null };
    const text = await res.text();
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) };
    } catch {
      return { ok: true, status: res.status, json: null };
    }
  }, url);
  const items = parseGenericItemsArray(result.json);
  const files = items
    .map((row) =>
      normalizeFileRow(
        /** @type {object} */ (row),
        folder.folderID,
        folder.folderName,
      ),
    )
    .filter(Boolean);
  return {
    ok: !!result.ok,
    status: result.status || 0,
    url,
    files,
    parseOk: result.json != null,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {object} project Task 3 row
 * @param {{
 *   dashboardUrl?: string,
 *   recoveryCredentials?: {
 *     email: string,
 *     password: string,
 *     loginUrl?: string,
 *     credentialsSource?: string,
 *   } | null,
 *   relaunchBrowserAndRecover?: ((args: {
 *     projectID: string,
 *     project: object,
 *     dashboardUrl: string,
 *     reason?: string,
 *   }) => Promise<import('playwright').Page | null>) | null,
 * }} [harvestOpts]
 */
async function harvestProjectFilesAndSampleDownloads(
  page,
  project,
  harvestOpts = {},
) {
  const projectID = String(project.projectID);
  const safePid = projectID.replace(/\D/g, "") || "unknown";
  const failShot = path.join(__dirname, `pgc-files-failed-${safePid}.png`);
  const destRoot = path.join(__dirname, "pgc-downloads", safePid);

  /** @type {any} */
  const out = {
    projectID,
    foldersCount: 0,
    filesCount: 0,
    sampledDownloadsCount: 0,
    folders: /** @type {object[]} */ ([]),
    sampleFiles: /** @type {object[]} */ ([]),
    downloadedFiles: /** @type {object[]} */ ([]),
    _meta: {
      fileApiFailures: 0,
      largeFilesSkipped: 0,
      downloadAttempts: 0,
      downloadsOk: 0,
      uploadsOk: 0,
      failures: 0,
    },
  };

  /** @type {{ folderID: string, fileName: string, reason: string }[]} */
  let globalFailedFiles = [];
  let totalFoldersNonEmptyProcessed = 0;
  let totalFilesAttemptedAll = 0;
  let totalOkAll = 0;
  let totalFailedAll = 0;

  try {
    const folders = await getProjectFoldersFromFilesTab(page, projectID);
    out.foldersCount = folders.length;
    /** @type {any[]} */
    const allFiles = [];

    if (!folders.length) {
      console.log("[PGC] Task 6 — no folders for project", projectID);
      pgcProgress.pgcLogDetail("task6_harvest_payload_empty", out);
      console.log("[PGC] Task 6 — full harvest payload → pgc-debug-detail.log");
      return out;
    }

    for (const fol of folders) {
      try {
        const fp = await getFolderFiles(page, fol);
        if (!fp.ok) out._meta.fileApiFailures += 1;
        if (!fp.parseOk && fp.ok) out._meta.fileApiFailures += 1;
        allFiles.push(
          ...fp.files.map((f) => ({ ...f, parentFolder: fol.parentName })),
        );
        /** @type {object[]} */
        const folderFileEntries = (fp.files || []).map((fl) => ({
          name: fl.fileName || `file-${fl.fileID}`,
          fileId: fl.fileID,
          folderName: fol.folderName,
          status: "",
          reviewedBy: "",
          uploadedDate: fl.uploadDate || "",
          commentCount: 0,
          fileSizeKB: fl.fileSizeKB,
          version: fl.version,
          hasMarkups: fl.hasMarkups,
        }));
        out.folders.push({
          folderID: fol.folderID,
          folderName: fol.folderName,
          parentFolder: fol.parentName,
          filesCount: fp.files.length,
          domFileCountHint:
            fol.domFileCountHint != null ? fol.domFileCountHint : null,
          files: folderFileEntries,
        });
        await page.waitForTimeout(200);
      } catch (e) {
        out._meta.fileApiFailures += 1;
        out.folders.push({
          folderID: "",
          folderName: fol.folderName || "(unnamed)",
          parentFolder: fol.parentName || "(parent)",
          filesCount: 0,
          files: [],
        });
        console.warn(
          `[PGC] Task 6 — GetFolderFiles failed for ${fol.folderID}: ${(e && e.message) || e}`,
        );
      }
    }

    out.filesCount = allFiles.length;
    pgcProgress.pgcLogDetail("task6_per_folder_file_counts", {
      folders: out.folders.map((fo) => ({
        id: fo.folderID,
        name: fo.folderName,
        parent: fo.parentFolder,
        n: fo.filesCount,
        domHint: fo.domFileCountHint ?? null,
      })),
    });
    console.log(
      `[PGC] Task 6 file counts by folder → pgc-debug-detail.log | total files: ${out.filesCount}`,
    );
    pgcProgress.pgcLogFolderHarvestOk(out.filesCount, out.foldersCount);

    await openPgcFilesTab(page, projectID);
    await logPgcFilesTreeSnapshot(page, "harvest-post-open");

    let allFileRows = out.folders.flatMap((folder) =>
      (folder.files || []).map((file) => ({ folder, file })),
    );
    allFileRows.sort((a, b) => {
      const na = normalizeText(String(a.file?.name || "")).toLowerCase();
      const nb = normalizeText(String(b.file?.name || "")).toLowerCase();
      const c = na.localeCompare(nb);
      if (c !== 0) return c;
      return String(a.file?.fileID || "").localeCompare(
        String(b.file?.fileID || ""),
      );
    });

    /** @type {Map<string, typeof allFileRows>} */
    const byFolder = new Map();
    for (const row of allFileRows) {
      const fidKey = row.folder.folderID || "";
      if (!byFolder.has(fidKey)) byFolder.set(fidKey, []);
      byFolder.get(fidKey).push(row);
    }

    let debugFileOrdinal = 0;
    let previousGridFingerprint = "";

    globalFailedFiles = [];
    totalFoldersNonEmptyProcessed = 0;
    totalFilesAttemptedAll = 0;
    totalOkAll = 0;
    totalFailedAll = 0;

    const emptyKeyRows = byFolder.get("") || [];
    if (emptyKeyRows.length) {
      for (const row of emptyKeyRows) {
        const f = row.file;
        const fileSizeKB =
          typeof f.fileSizeKB === "number" && !Number.isNaN(f.fileSizeKB)
            ? f.fileSizeKB
            : null;
        if (fileSizeKB != null && fileSizeKB > TASK6_MAX_FILE_KB) {
          out._meta.largeFilesSkipped += 1;
          f.downloadStatus = "skipped_oversize";
          continue;
        }
        out._meta.downloadAttempts += 1;
        out._meta.failures += 1;
        f.downloadStatus = "failed";
        f.downloadError = "missing folder id";
        f._pgcDownloadResult = {
          resolvedActionType: "none",
          resolvedActionUrl: null,
          clickedSelectorSummary: null,
          httpStatus: null,
          contentType: null,
          byteLength: 0,
          downloaded: false,
          uploaded: false,
          error: "missing_folder_id",
        };
        out.sampleFiles.push({
          fileID: f.fileId,
          fileName: f.name,
          folderName: row.folder.folderName,
          downloaded: false,
        });
        globalFailedFiles.push({
          folderID: "",
          fileName: f.name,
          reason: "missing_folder_id",
        });
        totalFilesAttemptedAll += 1;
        totalFailedAll += 1;
      }
    }

    const folderIdsWithRows = [...byFolder.keys()].filter(
      (id) => id && (byFolder.get(id) || []).length > 0,
    );
    const orderedFolderIds = sortPgcFolderIdsForProcessing(
      folderIdsWithRows,
      byFolder,
    );

    pgcProgress.pgcSetRunHarvestTotals({
      foldersTotal: orderedFolderIds.length,
      filesTotal: allFileRows.length,
    });

    pgcTask6PatchCheckpoint(out, {
      foldersTotalNonEmpty: orderedFolderIds.length,
      recoveryAttempts: 0,
      browserRelaunchCount: 0,
    });

    let workPage = page;
    let task6Context = page.context();
    let task6Browser = task6Context.browser();

    for (let fidx = 0; fidx < orderedFolderIds.length; fidx++) {
      const folderID = orderedFolderIds[fidx];
      const rowsInFolder = byFolder.get(folderID);
      if (!rowsInFolder || !rowsInFolder.length) continue;

      const folderMeta = {
        folderID,
        folderName: rowsInFolder[0]?.folder?.folderName || "",
        parentFolder: rowsInFolder[0]?.folder?.parentFolder || "",
        expectedFilesCount:
          typeof rowsInFolder[0]?.folder?.filesCount === "number"
            ? rowsInFolder[0].folder.filesCount
            : rowsInFolder.length,
        knownFileNames: [
          ...new Set(
            rowsInFolder
              .map((r) => r.file?.name)
              .filter((n) => n && String(n).trim()),
          ),
        ],
        files: rowsInFolder.map((r) => ({ name: r.file?.name })),
      };

      pgcTask6PatchCheckpoint(out, {
        folderIndex: fidx + 1,
        folderId: folderID,
        folderLabel: `${folderMeta.parentFolder} / ${folderMeta.folderName}`,
        fileIndex: 0,
        fileName: "",
      });

      const applyRecoverResult = (hrec) => {
        if (!hrec.ok || !hrec.page) return false;
        workPage = hrec.page;
        task6Context = hrec.task6Context || workPage.context();
        task6Browser = hrec.task6Browser || task6Context.browser();
        if (hrec.relaunched) {
          pgcTask6PatchCheckpoint(out, {
            browserRelaunchCount:
              (out._meta.task6Checkpoint.browserRelaunchCount || 0) + 1,
          });
        }
        return true;
      };

      const healTask6Page = async () => {
        if (pgcIsPageAlive(workPage) && pgcIsBrowserConnected(task6Browser))
          return true;
        pgcTask6PatchCheckpoint(out, {
          recoveryAttempts:
            (out._meta.task6Checkpoint.recoveryAttempts || 0) + 1,
        });
        const hrec = await recoverPgcFilesSessionAndResume({
          task6Context,
          task6Browser,
          projectID,
          project,
          folderMeta,
          previousGridFingerprint,
          allFoldersOut: out.folders,
          harvestOpts,
          skipFolderActivation: true,
        });
        return applyRecoverResult(hrec);
      };

      if (!(await healTask6Page())) {
        console.log(
          "[PGC] Task 6 | skipping folder (no live page after recovery)",
        );
        let skAttempted = 0;
        let skFailed = 0;
        for (const row of rowsInFolder) {
          const f = row.file;
          const fileSizeKB =
            typeof f.fileSizeKB === "number" && !Number.isNaN(f.fileSizeKB)
              ? f.fileSizeKB
              : null;
          if (fileSizeKB != null && fileSizeKB > TASK6_MAX_FILE_KB) {
            out._meta.largeFilesSkipped += 1;
            f.downloadStatus = "skipped_oversize";
            continue;
          }
          out._meta.downloadAttempts += 1;
          out._meta.failures += 1;
          totalFilesAttemptedAll += 1;
          totalFailedAll += 1;
          skAttempted += 1;
          skFailed += 1;
          f.downloadStatus = "failed";
          f.downloadError = "task6_page_unavailable";
          f._pgcDownloadResult = {
            resolvedActionType: "none",
            resolvedActionUrl: null,
            clickedSelectorSummary: null,
            httpStatus: null,
            contentType: null,
            byteLength: 0,
            downloaded: false,
            uploaded: false,
            error: "task6_page_unavailable",
          };
          out.sampleFiles.push({
            fileID: f.fileId,
            fileName: f.name,
            folderName: row.folder.folderName,
            downloaded: false,
          });
          globalFailedFiles.push({
            folderID,
            fileName: f.name,
            reason: "task6_page_unavailable",
          });
          pgcProgress.pgcLogFileFailure(f.name, "task6_page_unavailable");
        }
        pgcProgress.pgcLogFolderSummary({
          parentFolder: folderMeta.parentFolder,
          folderName: folderMeta.folderName,
          expected: folderMeta.expectedFilesCount,
          attempted: skAttempted,
          ok: 0,
          failed: skFailed,
        });
        continue;
      }

      try {
        await resetPgcFolderDownloadState(workPage, projectID);
      } catch (re) {
        if (!pgcIsPlaywrightTargetClosedError(re)) throw re;
        pgcTask6PatchCheckpoint(out, {
          recoveryAttempts:
            (out._meta.task6Checkpoint.recoveryAttempts || 0) + 1,
        });
        const r2 = await recoverPgcFilesSessionAndResume({
          task6Context,
          task6Browser,
          projectID,
          project,
          folderMeta,
          previousGridFingerprint,
          allFoldersOut: out.folders,
          harvestOpts,
          skipFolderActivation: true,
        });
        if (!applyRecoverResult(r2)) {
          console.log(
            "[PGC] Task 6 | skipping folder (reset failed, recovery failed)",
          );
          let rsAttempted = 0;
          let rsFailed = 0;
          for (const row of rowsInFolder) {
            const f = row.file;
            const fileSizeKB =
              typeof f.fileSizeKB === "number" && !Number.isNaN(f.fileSizeKB)
                ? f.fileSizeKB
                : null;
            if (fileSizeKB != null && fileSizeKB > TASK6_MAX_FILE_KB) {
              out._meta.largeFilesSkipped += 1;
              f.downloadStatus = "skipped_oversize";
              continue;
            }
            out._meta.downloadAttempts += 1;
            out._meta.failures += 1;
            totalFilesAttemptedAll += 1;
            totalFailedAll += 1;
            rsAttempted += 1;
            rsFailed += 1;
            f.downloadStatus = "failed";
            f.downloadError = "task6_reset_recovery_failed";
            f._pgcDownloadResult = {
              resolvedActionType: "none",
              resolvedActionUrl: null,
              clickedSelectorSummary: null,
              httpStatus: null,
              contentType: null,
              byteLength: 0,
              downloaded: false,
              uploaded: false,
              error: "task6_reset_recovery_failed",
            };
            out.sampleFiles.push({
              fileID: f.fileId,
              fileName: f.name,
              folderName: row.folder.folderName,
              downloaded: false,
            });
            globalFailedFiles.push({
              folderID,
              fileName: f.name,
              reason: "task6_reset_recovery_failed",
            });
            pgcProgress.pgcLogFileFailure(f.name, "task6_reset_recovery_failed");
          }
          pgcProgress.pgcLogFolderSummary({
            parentFolder: folderMeta.parentFolder,
            folderName: folderMeta.folderName,
            expected: folderMeta.expectedFilesCount,
            attempted: rsAttempted,
            ok: 0,
            failed: rsFailed,
          });
          continue;
        }
        await resetPgcFolderDownloadState(workPage, projectID);
      }

      pgcProgress.pgcLogFolderStart({
        folderIndex: fidx + 1,
        foldersTotal: orderedFolderIds.length,
        folderID,
        folderName: folderMeta.folderName,
        parentFolder: folderMeta.parentFolder,
        expectedFiles: folderMeta.expectedFilesCount,
      });

      let folderAttempted = 0;
      let folderOk = 0;
      let folderFailed = 0;
      /** @type {string[]} */
      const folderFailedNames = [];

      const activation = await activatePgcFolderAndVerifyGrid(
        workPage,
        folderMeta,
        out.folders,
        {
          projectID,
          previousFingerprint: previousGridFingerprint || null,
        },
      );

      if (!activation.ok) {
        const actErr =
          activation.error || "folder_activation_failed";
        const actDiag = activation.diagnostics;
        for (const row of rowsInFolder) {
          const f = row.file;
          const fileSizeKB =
            typeof f.fileSizeKB === "number" && !Number.isNaN(f.fileSizeKB)
              ? f.fileSizeKB
              : null;
          if (fileSizeKB != null && fileSizeKB > TASK6_MAX_FILE_KB) {
            out._meta.largeFilesSkipped += 1;
            f.downloadStatus = "skipped_oversize";
            continue;
          }
          out._meta.downloadAttempts += 1;
          out._meta.failures += 1;
          totalFilesAttemptedAll += 1;
          totalFailedAll += 1;
          folderAttempted += 1;
          folderFailed += 1;
          folderFailedNames.push(f.name);
          f.downloadStatus = "failed";
          f.downloadError = actErr;
          f._pgcFolderActivation = actDiag;
          f._pgcDownloadResult = {
            resolvedActionType: "none",
            resolvedActionUrl: null,
            clickedSelectorSummary: null,
            httpStatus: null,
            contentType: null,
            byteLength: 0,
            downloaded: false,
            uploaded: false,
            error: actErr,
          };
          out.sampleFiles.push({
            fileID: f.fileId,
            fileName: f.name,
            folderName: row.folder.folderName,
            downloaded: false,
          });
          globalFailedFiles.push({
            folderID,
            fileName: f.name,
            reason: actErr,
          });
          pgcProgress.pgcLogFileFailure(f.name, actErr);
        }
        pgcProgress.pgcLogFolderSummary({
          parentFolder: folderMeta.parentFolder,
          folderName: folderMeta.folderName,
          expected: folderMeta.expectedFilesCount,
          attempted: folderAttempted,
          ok: folderOk,
          failed: folderFailed,
        });
        if (folderFailedNames.length) {
          pgcProgress.pgcLogDetail("folder_failed_names_sample", {
            folderID,
            names: folderFailedNames.slice(0, 24),
          });
        }
        continue;
      }

      previousGridFingerprint =
        activation.fingerprint || (await getPgcGridFingerprint(workPage));
      totalFoldersNonEmptyProcessed += 1;
      pgcProgress.pgcLogFolderGridVerified();

      let fileOrdinal = 0;
      let abandonRestOfFolder = false;
      files_loop: for (const row of rowsInFolder) {
        const f = row.file;
        const fileSizeKB =
          typeof f.fileSizeKB === "number" && !Number.isNaN(f.fileSizeKB)
            ? f.fileSizeKB
            : null;
        if (fileSizeKB != null && fileSizeKB > TASK6_MAX_FILE_KB) {
          out._meta.largeFilesSkipped += 1;
          f.downloadStatus = "skipped_oversize";
          continue;
        }

        fileOrdinal += 1;
        pgcProgress.pgcLogFileStart({
          fileIndex: fileOrdinal,
          filesInFolder: rowsInFolder.length,
          fileId: String(f.fileId || ""),
          fileName: f.name || "",
        });
        pgcTask6PatchCheckpoint(out, {
          fileIndex: fileOrdinal,
          fileName: f.name || "",
        });

        let recoveryUsedForFile = false;
        let downloadCompletedThisFile = false;
        let countedDownloadAttemptForFile = false;

        file_attempt: while (true) {
          try {
            pgcAssertPageUsable(workPage, "task6_before_grid_ready");

            const gridReady = await ensurePgcFolderGridReady(
              workPage,
              folderMeta,
            );
            if (!gridReady.ok) {
              out._meta.downloadAttempts += 1;
              out._meta.failures += 1;
              totalFilesAttemptedAll += 1;
              totalFailedAll += 1;
              folderAttempted += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              const d = gridReady.diagnostics;
              const reason =
                (d && d.error) || "grid_not_ready_before_download";
              f.downloadError = String(reason);
              f._pgcFolderActivation = d;
              f._pgcDownloadResult = {
                resolvedActionType: "none",
                resolvedActionUrl: null,
                clickedSelectorSummary: null,
                httpStatus: null,
                contentType: null,
                byteLength: 0,
                downloaded: false,
                uploaded: false,
                error: "folder_grid_not_verified",
              };
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: "folder_grid_not_verified",
              });
              pgcProgress.pgcLogFileFailure(f.name, "folder_grid_not_verified");
              pgcProgress.pgcLogDetail("grid_not_ready", {
                file: f.name,
                reason,
                d,
              });
              break file_attempt;
            }

            const gridBelongs = await assertPgcGridBelongsToFolder(
              workPage,
              folderMeta,
            );
            if (!gridBelongs.ok) {
              out._meta.downloadAttempts += 1;
              out._meta.failures += 1;
              totalFilesAttemptedAll += 1;
              totalFailedAll += 1;
              folderAttempted += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              f.downloadError = String(
                gridBelongs.error || "stale_grid_after_folder_switch",
              );
              f._pgcGridAssert = gridBelongs.diagnostics;
              f._pgcDownloadResult = {
                resolvedActionType: "none",
                resolvedActionUrl: null,
                clickedSelectorSummary: null,
                httpStatus: null,
                contentType: null,
                byteLength: 0,
                downloaded: false,
                uploaded: false,
                error: "stale_grid_after_folder_switch",
              };
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: f.downloadError,
              });
              pgcProgress.pgcLogFileFailure(
                f.name,
                String(f.downloadError || "stale_grid_after_folder_switch"),
              );
              break file_attempt;
            }

            const rowLookup = await findPgcFileGridRow(workPage, folderMeta, {
              name: f.name,
              fileId: f.fileId,
              version: f.version,
              uploadedDate: f.uploadedDate,
            });
            if (!rowLookup.rowFound || !rowLookup.rowLocator) {
              out._meta.downloadAttempts += 1;
              out._meta.failures += 1;
              totalFilesAttemptedAll += 1;
              totalFailedAll += 1;
              folderAttempted += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              f.downloadError = "no_row_found";
              f._pgcFileRowLookup = rowLookup.diagnostics;
              f._pgcDownloadResult = {
                resolvedActionType: "none",
                resolvedActionUrl: null,
                clickedSelectorSummary: null,
                httpStatus: null,
                contentType: null,
                byteLength: 0,
                downloaded: false,
                uploaded: false,
                error: "no_row_found",
              };
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: "no_row_found",
              });
              pgcProgress.pgcLogFileFailure(f.name, "no_row_found");
              pgcProgress.pgcLogDetail("no_row_found", {
                file: f.name,
                diagnostics: rowLookup.diagnostics,
              });
              break file_attempt;
            }

            pgcProgress.pgcLogRowFound(f.name);

            if (!countedDownloadAttemptForFile) {
              out._meta.downloadAttempts += 1;
              totalFilesAttemptedAll += 1;
              folderAttempted += 1;
              countedDownloadAttemptForFile = true;
            }

            const debug = debugFileOrdinal < 3;
            if (debug) {
              await logPgcFileActionDiagnostics(
                workPage,
                { fileId: f.fileId, name: f.name },
                `early-${debugFileOrdinal + 1}`,
              );
            }

            const bin = await runPgcFileDownloadViaViewerFlow(
              workPage,
              rowLookup.rowLocator,
              { name: f.name, fileId: f.fileId },
              destRoot,
              { debug },
            );

            if (debug) {
              pgcProgress.pgcLogDetail("viewer_flow_summary", {
                file: f.name,
                viewerUrl: bin.viewerUrl
                  ? String(bin.viewerUrl).slice(0, 400)
                  : null,
                modalHandled: bin.modalHandled,
                err: bin.error,
              });
            }

            const normErr = bin.downloaded
              ? null
              : normalizePgcPerFileDownloadError(
                  bin.error,
                  "download failed",
                );
            f._pgcDownloadResult = {
              ...bin,
              error: normErr || bin.error || null,
            };

            if (bin.downloaded && bin.localPath) {
              out._meta.downloadsOk += 1;
              out.sampledDownloadsCount += 1;
              totalOkAll += 1;
              folderOk += 1;
              f.downloadStatus = "ok";
              f.downloadError = null;
              f.localPath = bin.localPath;
              f.contentType = bin.contentType || null;
              f.downloadUrl =
                bin.finalFetchUrl || bin.resolvedActionUrl || null;
              out.downloadedFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderID: row.folder.folderID,
                folderName: row.folder.folderName,
                parentFolder: row.folder.parentFolder || null,
                localPath: bin.localPath,
                contentType: bin.contentType || null,
                downloadUrl:
                  bin.finalFetchUrl || bin.resolvedActionUrl || null,
                _pgcDownloadResult: { ...f._pgcDownloadResult },
              });
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: true,
                localPath: bin.localPath,
              });
              pgcProgress.pgcLogFileSuccess(
                f.name,
                String(bin.resolvedActionType || "viewer_flow"),
                bin.byteLength || 0,
              );
              if (debug) {
                pgcProgress.pgcLogDetail("file_download_ok_debug", {
                  file: f.name,
                  folderID,
                  contentType: bin.contentType,
                });
              }
              downloadCompletedThisFile = true;
            } else {
              out._meta.failures += 1;
              totalFailedAll += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              f.downloadError = normErr || bin.error || "download failed";
              f.downloadUrl =
                bin.finalFetchUrl || bin.resolvedActionUrl || null;
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: f.downloadError,
              });
              pgcProgress.pgcLogFileFailure(
                f.name,
                String(f.downloadError || "download failed"),
              );
              if (debug) {
                pgcProgress.pgcLogDetail("file_download_fail_debug", {
                  file: f.name,
                  httpStatus: bin.httpStatus,
                  contentType: bin.contentType,
                  rawError: bin.error,
                });
              }
            }

            debugFileOrdinal += 1;
            pgcAssertPageUsable(workPage, "task6_before_file_delay");
            await pgcSafePageWaitForTimeout(
              workPage,
              TASK6_DOWNLOAD_DELAY_MS,
            );
            break file_attempt;
          } catch (loopErr) {
            const recoverable =
              pgcIsPlaywrightTargetClosedError(loopErr) ||
              !!(/** @type {any} */ (loopErr).pgcRecoverable);
            if (!recoverable) throw loopErr;

            const em = String(
              /** @type {{ message?: string }} */ (loopErr).message || loopErr,
            );
            console.log(
              `[PGC] RECOVERABLE ERROR | ${em} | folder=${folderMeta.parentFolder}/${folderMeta.folderName} | file=${f.name}`,
            );
            pgcProgress.pgcLogDetail("pgc_recoverable_run_interruption", {
              message: em,
              folderID,
              parentFolder: folderMeta.parentFolder,
              folderName: folderMeta.folderName,
              fileName: f.name,
              recoveryUsed: recoveryUsedForFile,
              downloadCompletedThisFile,
            });

            if (downloadCompletedThisFile) {
              if (!recoveryUsedForFile) {
                recoveryUsedForFile = true;
                pgcTask6PatchCheckpoint(out, {
                  recoveryAttempts:
                    (out._meta.task6Checkpoint.recoveryAttempts || 0) + 1,
                });
                const rec = await recoverPgcFilesSessionAndResume({
                  task6Context,
                  task6Browser,
                  projectID,
                  project,
                  folderMeta,
                  previousGridFingerprint,
                  allFoldersOut: out.folders,
                  harvestOpts,
                });
                if (rec.ok) {
                  applyRecoverResult(rec);
                  if (rec.fingerprint)
                    previousGridFingerprint = rec.fingerprint;
                }
              }
              break file_attempt;
            }

            if (recoveryUsedForFile) {
              console.log("[PGC] Recovery failed | browser closed");
              console.log("[PGC] Current file marked failed");
              console.log(
                "[PGC] Continuing to next folder after failed recovery",
              );
              out._meta.failures += 1;
              if (!countedDownloadAttemptForFile) {
                out._meta.downloadAttempts += 1;
                totalFilesAttemptedAll += 1;
                folderAttempted += 1;
                countedDownloadAttemptForFile = true;
              }
              totalFailedAll += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              f.downloadError = "playwright_target_closed";
              f._pgcDownloadResult = {
                resolvedActionType: "none",
                resolvedActionUrl: null,
                clickedSelectorSummary: null,
                httpStatus: null,
                contentType: null,
                byteLength: 0,
                downloaded: false,
                uploaded: false,
                error: "playwright_target_closed",
              };
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: "playwright_target_closed",
              });
              pgcProgress.pgcLogFileFailure(f.name, "playwright_target_closed");
              abandonRestOfFolder = true;
              break files_loop;
            }

            recoveryUsedForFile = true;
            pgcTask6PatchCheckpoint(out, {
              recoveryAttempts:
                (out._meta.task6Checkpoint.recoveryAttempts || 0) + 1,
            });
            const rec = await recoverPgcFilesSessionAndResume({
              task6Context,
              task6Browser,
              projectID,
              project,
              folderMeta,
              previousGridFingerprint,
              allFoldersOut: out.folders,
              harvestOpts,
            });

            if (rec.ok && rec.skipFolderActivation) {
              applyRecoverResult(rec);
              if (!downloadCompletedThisFile) {
                const failCode = "browser_relaunch_skip_folder";
                out._meta.failures += 1;
                if (!countedDownloadAttemptForFile) {
                  out._meta.downloadAttempts += 1;
                  totalFilesAttemptedAll += 1;
                  folderAttempted += 1;
                  countedDownloadAttemptForFile = true;
                }
                totalFailedAll += 1;
                folderFailed += 1;
                folderFailedNames.push(f.name);
                f.downloadStatus = "failed";
                f.downloadError = failCode;
                f._pgcDownloadResult = {
                  resolvedActionType: "none",
                  resolvedActionUrl: null,
                  clickedSelectorSummary: null,
                  httpStatus: null,
                  contentType: null,
                  byteLength: 0,
                  downloaded: false,
                  uploaded: false,
                  error: failCode,
                };
                out.sampleFiles.push({
                  fileID: f.fileId,
                  fileName: f.name,
                  folderName: row.folder.folderName,
                  downloaded: false,
                });
                globalFailedFiles.push({
                  folderID,
                  fileName: f.name,
                  reason: failCode,
                });
                pgcProgress.pgcLogFileFailure(f.name, failCode);
              }
              console.log(
                "[PGC] Continuing to next folder after browser relaunch recovery",
              );
              abandonRestOfFolder = true;
              break files_loop;
            }

            if (!rec.ok) {
              const failCode = rec.code || "playwright_target_closed";
              console.log(`[PGC] Recovery failed | ${failCode}`);
              console.log("[PGC] Current file marked failed");
              console.log(
                "[PGC] Continuing to next folder after failed recovery",
              );
              out._meta.failures += 1;
              if (!countedDownloadAttemptForFile) {
                out._meta.downloadAttempts += 1;
                totalFilesAttemptedAll += 1;
                folderAttempted += 1;
                countedDownloadAttemptForFile = true;
              }
              totalFailedAll += 1;
              folderFailed += 1;
              folderFailedNames.push(f.name);
              f.downloadStatus = "failed";
              f.downloadError = failCode;
              f._pgcDownloadResult = {
                resolvedActionType: "none",
                resolvedActionUrl: null,
                clickedSelectorSummary: null,
                httpStatus: null,
                contentType: null,
                byteLength: 0,
                downloaded: false,
                uploaded: false,
                error: failCode,
              };
              out.sampleFiles.push({
                fileID: f.fileId,
                fileName: f.name,
                folderName: row.folder.folderName,
                downloaded: false,
              });
              globalFailedFiles.push({
                folderID,
                fileName: f.name,
                reason: failCode,
              });
              pgcProgress.pgcLogFileFailure(f.name, failCode);
              if (rec.page) {
                workPage = rec.page;
                task6Context = rec.task6Context || workPage.context();
                task6Browser = rec.task6Browser || task6Context.browser();
              }
              abandonRestOfFolder = true;
              break files_loop;
            }

            applyRecoverResult(rec);
            if (rec.fingerprint)
              previousGridFingerprint = rec.fingerprint;
            console.log(`[PGC] Recovery resume | retry file: ${f.name}`);
            continue file_attempt;
          }
        }
      }

      if (abandonRestOfFolder) {
        for (const rowRem of rowsInFolder) {
          const fr = rowRem.file;
          if (
            fr.downloadStatus === "ok" ||
            fr.downloadStatus === "failed" ||
            fr.downloadStatus === "skipped_oversize"
          )
            continue;
          const fileSizeKBRem =
            typeof fr.fileSizeKB === "number" && !Number.isNaN(fr.fileSizeKB)
              ? fr.fileSizeKB
              : null;
          if (fileSizeKBRem != null && fileSizeKBRem > TASK6_MAX_FILE_KB) {
            out._meta.largeFilesSkipped += 1;
            fr.downloadStatus = "skipped_oversize";
            continue;
          }
          out._meta.downloadAttempts += 1;
          out._meta.failures += 1;
          totalFilesAttemptedAll += 1;
          totalFailedAll += 1;
          folderAttempted += 1;
          folderFailed += 1;
          folderFailedNames.push(fr.name);
          fr.downloadStatus = "failed";
          fr.downloadError = "folder_aborted_after_recovery";
          fr._pgcDownloadResult = {
            resolvedActionType: "none",
            resolvedActionUrl: null,
            clickedSelectorSummary: null,
            httpStatus: null,
            contentType: null,
            byteLength: 0,
            downloaded: false,
            uploaded: false,
            error: "folder_aborted_after_recovery",
          };
          out.sampleFiles.push({
            fileID: fr.fileId,
            fileName: fr.name,
            folderName: rowRem.folder.folderName,
            downloaded: false,
          });
          globalFailedFiles.push({
            folderID,
            fileName: fr.name,
            reason: "folder_aborted_after_recovery",
          });
          pgcProgress.pgcLogFileFailure(
            fr.name,
            "folder_aborted_after_recovery",
          );
        }
      }

      pgcTask6PatchCheckpoint(out, {
        lastCompletedFolder: `${folderMeta.parentFolder} / ${folderMeta.folderName}`,
        lastCompletedFolderId: folderID,
      });

      pgcProgress.pgcLogFolderSummary({
        parentFolder: folderMeta.parentFolder,
        folderName: folderMeta.folderName,
        expected: folderMeta.expectedFilesCount,
        attempted: folderAttempted,
        ok: folderOk,
        failed: folderFailed,
      });
      if (folderFailedNames.length) {
        pgcProgress.pgcLogDetail("folder_failed_names_sample", {
          folderID,
          names: folderFailedNames.slice(0, 24),
        });
      }
    }

    out._meta.pgcMultiFolderDownload = {
      nonEmptyFoldersProcessed: totalFoldersNonEmptyProcessed,
      filesAttempted: totalFilesAttemptedAll,
      downloadsOk: totalOkAll,
      failures: totalFailedAll,
      failedFiles: globalFailedFiles.slice(0, 500),
    };
    pgcLogTask6FailureBucketSummary(globalFailedFiles);
    pgcProgress.pgcLogDetail("task6_harvest_counters", {
      nonEmptyFoldersProcessed: totalFoldersNonEmptyProcessed,
      filesAttempted: totalFilesAttemptedAll,
      ok: totalOkAll,
      failed: totalFailedAll,
      failedFilesPreview: globalFailedFiles.slice(0, 40),
    });
    console.log(
      `[PGC] Task 6 complete | folders:${totalFoldersNonEmptyProcessed} | files:${totalFilesAttemptedAll} | ok:${totalOkAll} | failed:${totalFailedAll} | (full run summary at pipeline end)`,
    );

    if (
      out.filesCount > 0 &&
      out.sampledDownloadsCount === 0 &&
      allFileRows.length > 0
    ) {
      try {
        if (pgcIsPageAlive(page)) {
          await page.screenshot({ path: failShot, fullPage: true });
          console.error(
            "[PGC] Task 6 — file-layer screenshot (0 downloads):",
            failShot,
          );
        }
      } catch (_) {}
    }
  } catch (err) {
    out._meta.fileApiFailures += 1;
    console.error("[PGC] Task 6 — harvest error:", err.message || err);
    pgcAssignTask6MultiMeta(out, {
      globalFailedFiles,
      totalFoldersNonEmptyProcessed,
      totalFilesAttemptedAll,
      totalOkAll,
      totalFailedAll,
      harvestAborted: true,
      harvestAbortReason: String(
        /** @type {{ message?: string }} */ (err).message || err,
      ),
    });
    try {
      if (pgcIsPageAlive(page)) {
        await page.screenshot({ path: failShot, fullPage: true });
        console.error("[PGC] Task 6 — file-layer screenshot:", failShot);
      }
    } catch (_) {}
  }

  pgcProgress.pgcLogDetail("task6_harvest_payload_final", out);
  console.log(
    "[PGC] Task 6 — harvest payload |",
    out.filesCount,
    "files |",
    out.foldersCount,
    "folders | detail → pgc-debug-detail.log",
  );
  return out;
}

// ─── Task 7 — full corrections normalization + unique markup PDFs ─────────

/**
 * @param {unknown} raw
 * @returns {{ groupID: string|null, name: string|null, wflowReviewCycleID: string|null } | null}
 */
function normalizeReviewGroupRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const gid =
    o.GroupID ?? o.groupID ?? o.ReviewGroupID ?? o.reviewGroupID ?? o.ID ?? o.id;
  if (gid == null) return null;
  const nameRaw =
    o.Name ?? o.name ?? o.GroupName ?? o.groupName ?? o.Title ?? o.title ?? "";
  const wrc =
    o.WFlowReviewCycleID ?? o.wflowReviewCycleID ?? o.ReviewCycleID ?? null;
  const reviewCycleRaw =
    o.ReviewCycle ?? o.reviewCycle ?? o.CycleNumber ?? o.cycleNumber ?? null;
  return {
    groupID: String(gid),
    name: normalizeText(String(nameRaw)) || null,
    wflowReviewCycleID: wrc != null ? String(wrc) : null,
    reviewCycle:
      reviewCycleRaw != null ? normalizeText(String(reviewCycleRaw)) : null,
  };
}

/**
 * @param {unknown} rawGroups
 */
function normalizeReviewGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  return rawGroups.map(normalizeReviewGroupRow).filter(Boolean);
}

/**
 * @param {object} raw
 */
function normalizeCorrectionRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const correctionID =
    o.CorrectionID ??
    o.correctionID ??
    o.WFlowCorrectionID ??
    o.wflowCorrectionID ??
    o.ID ??
    o.id;
  if (correctionID == null) return null;

  const referenceNumber =
    o.ReferenceNumber ?? o.referenceNumber ?? o.RefNo ?? o.refNumber ?? null;
  const department =
    o.Department ?? o.department ?? o.DepartmentName ?? o.departmentName ?? null;
  const reviewerName =
    o.ReviewerName ?? o.reviewerName ?? o.Reviewer ?? o.reviewer ?? null;
  const statusID = o.StatusID ?? o.statusID ?? null;
  const statusName =
    o.StatusName ?? o.statusName ?? o.Status ?? o.status ?? o.State ?? null;
  const statusCompleted =
    o.StatusCompleted ??
    o.statusCompleted ??
    o.IsCompleted ??
    o.isCompleted ??
    null;
  const correctionType =
    o.CorrectionType ?? o.correctionType ?? o.Type ?? o.type ?? null;
  const commentText =
    o.CommentText ??
    o.commentText ??
    o.Comment ??
    o.comment ??
    o.Body ??
    null;
  const responseText =
    o.ResponseText ??
    o.responseText ??
    o.Response ??
    o.ApplicantResponse ??
    null;
  const fileID = o.FileID ?? o.fileID ?? o.fileId ?? null;
  const fileName = o.FileName ?? o.fileName ?? o.DocumentName ?? null;
  const markupPdfUrlRaw =
    o.MarkupPDFURL ??
    o.MarkupPdfUrl ??
    o.markupPdfUrl ??
    o.MarkupUrl ??
    o.markupURL ??
    null;
  const markupPdfUrl =
    markupPdfUrlRaw != null ? String(markupPdfUrlRaw).trim() || null : null;
  const reviewCycle =
    o.ReviewCycle ?? o.reviewCycle ?? o.CycleNumber ?? o.cycleNumber ?? null;
  const wflowReviewCycleID =
    o.WFlowReviewCycleID ?? o.wflowReviewCycleID ?? o.ReviewCycleID ?? null;

  let isLatestCycle = o.IsLatestCycle ?? o.isLatestCycle ?? null;
  if (typeof isLatestCycle === "string") {
    isLatestCycle = isLatestCycle.toLowerCase() === "true" || isLatestCycle === "1";
  }
  if (typeof isLatestCycle !== "boolean") isLatestCycle = null;

  const requireApplicantResponse =
    o.RequireApplicantResponse ?? o.requireApplicantResponse ?? null;
  const dateCreated =
    o.DateCreated ?? o.dateCreated ?? o.CreatedDate ?? o.createdDate ?? null;
  const wflowInstId = o.WFlowInstanceID ?? o.wflowInstanceID ?? null;
  const wflowTaskId = o.WFlowTaskID ?? o.wflowTaskID ?? null;
  const taskNameRaw = o.TaskName ?? o.taskName ?? null;
  const taskStatusRaw =
    o.TaskStatus ??
    o.taskStatus ??
    o.WFlowTaskStatusTypeID ??
    o.wflowTaskStatusTypeID ??
    null;

  return {
    correctionID: String(correctionID),
    referenceNumber:
      referenceNumber != null ? normalizeText(String(referenceNumber)) : null,
    department:
      department != null ? normalizeText(String(department)) : null,
    reviewerName:
      reviewerName != null ? normalizeText(String(reviewerName)) : null,
    statusID: statusID != null ? String(statusID) : null,
    statusName:
      statusName != null ? normalizeText(String(statusName)) : null,
    statusCompleted:
      typeof statusCompleted === "boolean"
        ? statusCompleted
        : statusCompleted != null
          ? Boolean(statusCompleted)
          : null,
    correctionType:
      correctionType != null ? normalizeText(String(correctionType)) : null,
    commentText: commentText != null ? normalizeText(String(commentText)) : null,
    responseText:
      responseText != null ? normalizeText(String(responseText)) : null,
    fileID: fileID != null ? String(fileID) : null,
    fileName: fileName != null ? normalizeText(String(fileName)) : null,
    markupPdfUrl,
    reviewCycle:
      reviewCycle != null ? normalizeText(String(reviewCycle)) : null,
    wflowReviewCycleID:
      wflowReviewCycleID != null ? String(wflowReviewCycleID) : null,
    isLatestCycle,
    requireApplicantResponse:
      typeof requireApplicantResponse === "boolean"
        ? requireApplicantResponse
        : requireApplicantResponse != null
          ? String(requireApplicantResponse).toLowerCase() === "true"
          : null,
    dateCreated:
      dateCreated != null ? normalizeText(String(dateCreated)) : null,
    wflowInstanceID: wflowInstId != null ? String(wflowInstId) : null,
    wflowTaskID: wflowTaskId != null ? String(wflowTaskId) : null,
    taskName: taskNameRaw != null ? normalizeText(String(taskNameRaw)) : null,
    taskStatus:
      taskStatusRaw != null ? normalizeText(String(taskStatusRaw)) : null,
  };
}

/**
 * Infer latest cycle when API omits IsLatestCycle.
 * @param {ReturnType<normalizeCorrectionRecord>[]} list
 */
function applyLatestCycleInference(list) {
  const nums = list
    .map((c) => c && c.wflowReviewCycleID)
    .filter((x) => x != null && String(x).length)
    .map((x) => parseInt(String(x), 10))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : null;
  return list.map((c) => {
    if (!c) return c;
    let latest = c.isLatestCycle;
    if (latest == null && max != null && c.wflowReviewCycleID != null) {
      const n = parseInt(String(c.wflowReviewCycleID), 10);
      if (!Number.isNaN(n) && n === max) latest = true;
    }
    return { ...c, isLatestCycle: latest === true ? true : latest === false ? false : null };
  });
}

/**
 * @param {string | null | undefined} markupPdfUrl
 */
function extractMarkupToken(markupPdfUrl) {
  if (markupPdfUrl == null || !String(markupPdfUrl).trim()) return null;
  const s = String(markupPdfUrl).trim();
  const m = s.match(/RetrieveMarkupPDF\/([^?\s#]+)/i);
  if (m) return m[1];
  const m2 = s.match(/([^/\\?]+\.pdf)\s*$/i);
  if (m2) return m2[1];
  return s.length > 160 ? s.slice(0, 160) : s;
}

/**
 * @param {string | null | undefined} markupPdfUrl
 */
function resolveMarkupDownloadUrl(markupPdfUrl) {
  if (markupPdfUrl == null || !String(markupPdfUrl).trim()) return null;
  const s = String(markupPdfUrl).trim();
  const origin = PGC_PROJECTDOX_API_ORIGIN;
  const basePath = `${origin}/ProjectDoxWebAPI/WorkflowChangemark/RetrieveMarkupPDF/`;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) {
    if (s.includes("RetrieveMarkupPDF")) return origin.replace(/\/$/, "") + s;
    return basePath + s.replace(/^\/+/, "");
  }
  const m = s.match(/RetrieveMarkupPDF\/([^?\s#]+)/i);
  if (m) return basePath + m[1];
  if (/\.pdf$/i.test(s)) return basePath + s.replace(/^\/+/, "");
  return basePath + encodeURIComponent(s);
}

/**
 * @param {ReturnType<normalizeCorrectionRecord>[]} latest
 */
function summarizeReviewCategories(latest) {
  let changemarkCount = 0;
  let commentCount = 0;
  let unresolvedCount = 0;
  let resolvedCount = 0;
  let infoOnlyCount = 0;
  let questionCount = 0;
  /** @type {Record<string, number>} */
  const statusCounts = {};

  for (const c of latest) {
    if (!c) continue;
    const stLabel = c.statusName ? normalizeText(String(c.statusName)) : "Unknown";
    const stKey = stLabel || "Unknown";
    statusCounts[stKey] = (statusCounts[stKey] || 0) + 1;
    const stl = stKey.toLowerCase();
    if (
      stl.includes("unresolved") ||
      stl === "open" ||
      stl === "new" ||
      stl.includes("pending")
    )
      unresolvedCount += 1;
    if (
      stl.includes("resolved") ||
      stl === "closed" ||
      stl.includes("complete")
    )
      resolvedCount += 1;
    if (stl.includes("info only") || stl.includes("info-only")) infoOnlyCount += 1;
    if (stl.includes("question")) questionCount += 1;

    const hasMarkup = !!(c.markupPdfUrl && String(c.markupPdfUrl).trim());
    const hasFile = !!(c.fileID && String(c.fileID).trim());
    const ct = String(c.correctionType || "").toLowerCase();
    if (hasMarkup || hasFile || ct.includes("change") || ct.includes("markup"))
      changemarkCount += 1;
    else commentCount += 1;
  }

  return {
    changemarkCount,
    commentCount,
    unresolvedCount,
    resolvedCount,
    infoOnlyCount,
    questionCount,
    statusCounts,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {object} project Task 3 row
 * @param {string | null | undefined} wflowInstanceID
 */
/**
 * @param {import('playwright').Page} page
 * @param {object} project
 * @param {string | null | undefined} wflowInstanceID
 * @param {{ preloadedCorrectionsJson?: object | null, preloadedCorrectionsUrl?: string | null }} [options]
 */
/** Marker so change-events target the same <select> across evaluate calls. */
const PGC_REVIEW_WORKFLOW_SELECT_ATTR = "data-pgc-review-workflow-select";

async function scrapePgcReviewWorkflowsFromDom(page, projectID) {
  const pid = String(projectID);

  const cleanupMarker = async () => {
    await page
      .evaluate((attr) => {
        document.querySelectorAll(`select[${attr}]`).forEach((el) => el.removeAttribute(attr));
      }, PGC_REVIEW_WORKFLOW_SELECT_ATTR)
      .catch(() => {});
  };

  const correctionsTabUrl = buildPgcTabUrl(pid, "correctionsTab", "");

  console.log("[PGC] Review | correctionsTab goto |", correctionsTabUrl);
  const nav = await gotoPgcProjectTab(page, pid, "correctionsTab", "");
  let landed = page.url();
  console.log("[PGC] Review | correctionsTab landed |", landed);
  if (!String(landed).includes("correctionsTab")) {
    await page.waitForTimeout(2000);
    landed = page.url();
    console.log("[PGC] Review | correctionsTab landed |", landed, "| after settle");
  }

  if (!String(landed).includes("correctionsTab")) {
    console.warn(
      "[PGC] Review | correctionsTab URL mismatch | expected tab=correctionsTab in URL | got:",
      landed,
    );
    await cleanupMarker();
    return [];
  }

  if (!nav.ok) {
    console.warn(
      "[PGC] Review | correctionsTab | hydration incomplete |",
      (nav.errors || []).join("; ") || "unknown",
    );
  }

  await page.waitForTimeout(1200);
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#correctionsTab");
        if (!root) return false;
        for (const s of root.querySelectorAll("select")) {
          if (s.options && s.options.length >= 2) return true;
        }
        return false;
      },
      { timeout: 22000, polling: 350 },
    );
    console.log("[PGC] Review | correctionsTab | review area settled (multi-option select)");
  } catch (_) {
    console.warn("[PGC] Review | correctionsTab | settle timeout (continuing dropdown scan)");
  }

  const resolveResult = await page.evaluate(
    ({ attr }) => {
      const PAGE_SIZE_LABELS = new Set(["5", "10", "20", "25", "50", "75", "100"]);

      function norm(s) {
        if (s == null) return "";
        return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      }

      function visible(el) {
        if (!el || !(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (!st || st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }

      function isPlaceholderOption(lab, val) {
        const t = norm(lab);
        if (/^\[?\s*select\s*one\s*\]?$/i.test(t)) return true;
        if (/please\s+select/i.test(t)) return true;
        if (!t && !String(val || "").trim()) return true;
        return false;
      }

      function looksLikePageSizeOnlyLabels(labels) {
        if (labels.length < 2) return true;
        return labels.every((lab) => {
          const t = norm(lab).trim();
          return PAGE_SIZE_LABELS.has(t) && /^\d+$/.test(t);
        });
      }

      function hasWorkflowLikeLabel(lab) {
        const t = norm(lab).trim();
        if (!t || isPlaceholderOption(t, "")) return false;
        if (PAGE_SIZE_LABELS.has(t)) return false;
        if (/^\d{1,3}$/.test(t)) return false;
        return /[a-zA-Z]/.test(t) || t.length > 4;
      }

      /** @param {HTMLSelectElement} sel */
      function allOptionLabels(sel) {
        return Array.from(sel.options).map((o) => norm(o.textContent || ""));
      }

      /** @param {HTMLSelectElement} sel */
      function actionableWorkflowOptions(sel) {
        return Array.from(sel.options)
          .map((o, idx) => ({
            value: String(o.value || ""),
            label: norm(o.textContent || ""),
            groupingId: o.getAttribute("groupingid") || "",
            optionIndex: idx,
          }))
          .filter((o) => !isPlaceholderOption(o.label, o.value));
      }

      /** @param {HTMLSelectElement} select */
      function summarizeSelect(select) {
        const id = select.id ? `#${select.id}` : "";
        const nm = select.name ? `[name=${JSON.stringify(select.name)}]` : "";
        const cls = select.className && String(select.className).trim().slice(0, 40);
        const clsBit = cls ? `.${cls.split(/\s+/)[0]}` : "";
        return [id || nm || clsBit || "select", visible(select) ? "visible" : "hidden"].join(" ");
      }

      /**
       * Priority: #correctionsTab → active #project-tabs panel → main content.
       * @returns {HTMLSelectElement[]}
       */
      function gatherSelectsInPriorityOrder() {
        /** @type {HTMLSelectElement[]} */
        const ordered = [];
        const seen = new Set();

        function addFrom(container) {
          if (!container) return;
          for (const s of container.querySelectorAll("select")) {
            if (!(s instanceof HTMLSelectElement) || !visible(s)) continue;
            if (seen.has(s)) continue;
            seen.add(s);
            ordered.push(s);
          }
        }

        addFrom(document.querySelector("#correctionsTab"));
        const tabs = document.querySelector("#project-tabs");
        if (tabs) {
          const active =
            tabs.querySelector(".ui-tabs-panel.ui-tabs-active") ||
            tabs.querySelector(".ui-tabs-panel:not(.ui-tabs-hide)") ||
            tabs.querySelector("[role='tabpanel'][aria-hidden='false']");
          addFrom(active || tabs);
        }
        addFrom(document.querySelector("#main-content, .main-content, #mainContent, main"));

        return ordered;
      }

      for (const s of document.querySelectorAll(`select[${attr}]`)) {
        s.removeAttribute(attr);
      }

      const selects = gatherSelectsInPriorityOrder();
      /** @type {string[]} */
      const rejectionLog = [];
      /** @type {object[]} */
      const candidateRows = [];
      /** @type {{ sel: HTMLSelectElement, score: number, actionable: { value: string, label: string, groupingId: string, optionIndex: number }[], first5: string[], optionCount: number }[]} */
      const scored = [];

      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const labels = allOptionLabels(sel);
        const first5 = labels.slice(0, 5);
        const base = { idx: i, optionCount: labels.length, first5Labels: first5 };

        if (labels.length < 2) {
          candidateRows.push({
            ...base,
            rejected: true,
            reason: "fewer than 2 options",
          });
          rejectionLog.push(`select[${i}] <2 options`);
          continue;
        }
        if (looksLikePageSizeOnlyLabels(labels)) {
          candidateRows.push({
            ...base,
            rejected: true,
            reason: "page-size-only",
          });
          rejectionLog.push(`select[${i}] page-size-only: ${labels.join(",")}`);
          continue;
        }

        const actionable = actionableWorkflowOptions(sel);
        if (actionable.length < 1) {
          candidateRows.push({
            ...base,
            rejected: true,
            reason: "only placeholder options",
          });
          rejectionLog.push(`select[${i}] placeholders only`);
          continue;
        }

        const firstLab = labels[0] || "";
        const hasSelectOneDefault = isPlaceholderOption(firstLab, sel.options[0] ? sel.options[0].value : "");
        const wfLikeN = actionable.filter((o) => hasWorkflowLikeLabel(o.label)).length;

        let score = actionable.length * 2 + (hasSelectOneDefault ? 25 : 0) + wfLikeN * 4;
        if (wfLikeN === 0 && actionable.length > 0) score -= 5;

        candidateRows.push({
          ...base,
          rejected: false,
          reason: null,
          score,
          hasSelectOneDefault,
          workflowLikeOptionCount: wfLikeN,
        });
        scored.push({ sel, score, actionable, first5, optionCount: labels.length });
      }

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];

      const ct = document.querySelector("#correctionsTab");
      const correctionsAreaSample = ct ? norm(ct.innerText || "").slice(0, 520) : "";

      if (!best) {
        return {
          options: [],
          summary: "none",
          rejectionLog,
          diagnostics: {
            visibleSelectCount: selects.length,
            candidates: candidateRows,
            correctionsAreaSample,
          },
        };
      }

      best.sel.setAttribute(attr, "1");
      return {
        options: best.actionable,
        summary: `${summarizeSelect(best.sel)} score=${best.score}`,
        rejectionLog,
        diagnostics: {
          visibleSelectCount: selects.length,
          candidates: candidateRows,
          correctionsAreaSample,
        },
      };
    },
    { attr: PGC_REVIEW_WORKFLOW_SELECT_ATTR },
  );

  const options = resolveResult.options || [];
  const rejectionLog = resolveResult.rejectionLog || [];
  const diag = resolveResult.diagnostics || {};

  console.log(
    "[PGC] Review | corrections selects visible |",
    diag.visibleSelectCount ?? 0,
    "in scan area",
  );

  for (const row of diag.candidates || []) {
    const head = (row.first5Labels || []).join(" | ");
    if (row.rejected) {
      console.warn(
        "[PGC] Review | workflow select candidate |",
        `idx=${row.idx} opts=${row.optionCount} REJECT ${row.reason} |`,
        head,
      );
    } else {
      console.log(
        "[PGC] Review | workflow select candidate |",
        `idx=${row.idx} opts=${row.optionCount} score=${row.score} selectOneDefault=${row.hasSelectOneDefault} wfLike=${row.workflowLikeOptionCount} |`,
        head,
      );
    }
  }

  for (const line of rejectionLog) {
    console.warn("[PGC] Review | workflow select rejected |", line);
  }

  if (options.length) {
    console.log("[PGC] Review | workflow dropdown selected |", resolveResult.summary);
    const optSummary = options.map((o) => o.label || o.value).join(", ");
    const clipped = optSummary.length > 220 ? `${optSummary.slice(0, 217)}…` : optSummary;
    console.log("[PGC] Review | workflow options (actionable) |", clipped);
  } else {
    console.warn("[PGC] Review | review dropdown not found");
    if (diag.correctionsAreaSample) {
      console.warn(
        "[PGC] Review | corrections area text sample |",
        diag.correctionsAreaSample.length > 400
          ? `${diag.correctionsAreaSample.slice(0, 397)}…`
          : diag.correctionsAreaSample,
      );
    }
    await cleanupMarker();
    return [];
  }

  /**
   * PGC corrections grid: each correction is 4+ <tr> sharing the same correctionid; row1 has class firstRow.
   * @returns {Promise<Record<string,string>[]>}
   */
  const readVisibleRows = async () =>
    page.evaluate(() => {
      function norm(s) {
        if (s == null) return "";
        return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      }
      function visible(el) {
        if (!el || !(el instanceof Element)) return false;
        const st = window.getComputedStyle(el);
        if (!st || st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      function correctionIdOf(tr) {
        return String(
          tr.getAttribute("correctionid") || tr.getAttribute("correctionId") || "",
        ).trim();
      }
      function cellText(td) {
        if (!td) return "";
        const inner = td.querySelector(".correction-data");
        if (inner) return norm(inner.textContent);
        return norm(td.textContent);
      }
      function stripRefPrefix(s) {
        let t = norm(s);
        t = t.replace(/^ref\.?\s*#\s*/i, "").trim();
        return t;
      }
      function gatherGroupRows(firstTr) {
        const out = [];
        let cur = firstTr;
        while (cur && cur.tagName === "TR") {
          out.push(cur); // collect ALL sibling rows, not just visible ones
          const next = cur.nextElementSibling;
          if (!next || (next instanceof HTMLElement && next.classList.contains("firstRow")))
            break;
          cur = next;
        }
        return out;
      }
      function pickChangemarkFromGroup(groupTrs) {
        for (const tr of groupTrs) {
          for (const td of tr.querySelectorAll("td")) {
            const t = norm(td.textContent || "");
            if (/changemark/i.test(t)) return t;
          }
        }
        return "";
      }
      function pickBestFileLink(groupTrs) {
        /** @type {HTMLAnchorElement[]} */
        const links = [];
        for (const tr of groupTrs) {
          tr.querySelectorAll("a[href]").forEach((a) => {
            if (a instanceof HTMLAnchorElement) links.push(a);
          });
        }
        for (const a of links) {
          const href = (a.getAttribute("href") || "").trim();
          if (!href || href === "#") continue;
          const txt = norm(a.textContent || "");
          if (/\.pdf(\?|$|[#])/i.test(href) || /\.pdf/i.test(txt)) {
            return {
              name: txt || href.split("/").pop().split("?")[0] || "",
              url: href,
            };
          }
        }
        for (const a of links) {
          const href = (a.getAttribute("href") || "").trim();
          if (/^https?:\/\//i.test(href)) {
            return {
              name: norm(a.textContent || "") || href.split("/").pop().split("?")[0] || "",
              url: href,
            };
          }
        }
        return { name: "", url: "" };
      }

      const firstRowCandidates = Array.from(
        document.querySelectorAll("tr.firstRow, tr[class*='firstRow']"),
      ).filter((tr) => visible(tr) && correctionIdOf(tr));

      /** @type {Set<string>} */
      const seenCid = new Set();
      /** @type {Record<string, string>[]} */
      const out = [];

      for (const tr of firstRowCandidates) {
        const cid = correctionIdOf(tr);
        if (!cid || seenCid.has(cid)) continue;
        seenCid.add(cid);

        const groupTrs = gatherGroupRows(tr);
        const row1 = groupTrs.find((r) => r.classList.contains("firstRow")) || tr;

        const refTd = row1.querySelector("td.refColumn");
        const deptTd = row1.querySelector("td.department");
        const dtTd = row1.querySelector("td.datetime");
        const cycleTd = row1.querySelector("td.cycle");
        const responseTd = row1.querySelector("td.commentResponse");

        let reviewer = "";
        const tds = Array.from(row1.querySelectorAll("td"));
        const deptIdx = tds.findIndex((td) => td.classList.contains("department"));
        if (deptIdx >= 0) {
          for (let i = deptIdx + 1; i < tds.length; i++) {
            const td = tds[i];
            if (
              td.classList.contains("datetime") ||
              td.classList.contains("cycle") ||
              td.classList.contains("commentResponse")
            )
              break;
            reviewer = cellText(td);
            break;
          }
        }
        if (!reviewer && tds.length >= 3) {
          const cand = tds[2];
          if (
            cand &&
            !cand.classList.contains("datetime") &&
            !cand.classList.contains("cycle") &&
            !cand.classList.contains("commentResponse")
          ) {
            reviewer = cellText(cand);
          }
        }

        let status = "";
        let commentText = "";
        let correctionType = "";
        for (const r of groupTrs) {
          const st = r.querySelector("td.status");
          if (st) status = cellText(st);
          const ct = r.querySelector("td.commentText, td.markupCommentText");
          if (ct && !commentText) {
            const inner = ct.querySelector(".correction-data");
            commentText = inner ? norm(inner.textContent) : norm(ct.textContent);
          }
          const ty = r.querySelector("td.correctionType");
          if (ty) correctionType = cellText(ty);
        }

        const changemarkNumber = pickChangemarkFromGroup(groupTrs);
        const { name: fileName, url: fileUrl } = pickBestFileLink(groupTrs);

        const refRaw = cellText(refTd);
        const row = {
          refNumber: stripRefPrefix(refRaw),
          changemarkNumber,
          department: cellText(deptTd),
          reviewer,
          datetime: cellText(dtTd),
          cycle: cellText(cycleTd),
          status,
          correctionType,
          commentText,
          responseText: cellText(responseTd),
          fileName,
          fileUrl,
          viewUrl: fileUrl,
        };

        if (Object.values(row).some((v) => String(v || "").trim().length > 0)) out.push(row);
      }

      return out;
    });

  /** @type {{ workflowName: string, rows: Record<string,string>[] }[]} */
  const workflowBuckets = [];
  /** TEMP: first-workflow correctionsTab HTML sample for DOM structure debugging. */
  let correctionsDomDebugDumped = false;
  for (const opt of options) {
    const wfName = opt.label || opt.value;
    console.log("[PGC] Review | workflow found |", wfName);
    await page
      .evaluate(
        ({ optionIndex, attr }) => {
          const sel = document.querySelector(`select[${attr}]`);
          if (!(sel instanceof HTMLSelectElement)) return;
          // Select by index so the correct groupingid is on selectedIndex
          sel.selectedIndex = optionIndex;
          if (window.$ || window.jQuery) {
            (window.$ || window.jQuery)(sel).trigger("change");
          } else {
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        },
        { optionIndex: opt.optionIndex, attr: PGC_REVIEW_WORKFLOW_SELECT_ATTR },
      )
      .catch(() => {});
    let surfaceOk = false;
    try {
      // Wait for the network request that fires after workflow change to complete
      await Promise.race([
        page.waitForResponse(
          (resp) =>
            resp.url().includes("GetProjectCorrectionsByCycleInstance") &&
            resp.status() === 200,
          { timeout: 15000 },
        ),
        page.waitForTimeout(15000),
      ]);
      // Give client-side filtering time to apply after XHR completes
      await page.waitForTimeout(1500);
      surfaceOk = true;
      console.log("[PGC] Review | XHR complete + grid filtered |", wfName);
    } catch (_) {
      surfaceOk = false;
      console.warn("[PGC] Review | XHR wait timed out |", wfName);
      await page.waitForTimeout(1500);
    }
    await page
      .waitForSelector(
        "#correctionsTab tr.firstRow[correctionid], #correctionsTab tr.firstRow[correctionId], #correctionsTab tr[correctionid].firstRow, #correctionsTab tr[correctionId].firstRow",
        { timeout: 22000 },
      )
      .catch(() => {});
    if (!correctionsDomDebugDumped) {
      correctionsDomDebugDumped = true;
      const domDump = await page.evaluate(() => {
        const ct = document.querySelector("#correctionsTab");
        return ct ? ct.innerHTML.slice(0, 3000) : document.body.innerHTML.slice(0, 3000);
      });
      console.log("[PGC DEBUG] corrections DOM after workflow select:", domDump);
    }
    /** @type {Record<string,string>[]} */
    const rows = [];
    const seen = new Set();
    const pushRows = (batch) => {
      for (const r of batch) {
        const sig = JSON.stringify(r);
        if (seen.has(sig)) continue;
        seen.add(sig);
        rows.push(r);
      }
    };
    pushRows(await readVisibleRows());
    for (let pageIdx = 0; pageIdx < 20; pageIdx += 1) {
      const clickedNext = await page
        .evaluate(() => {
          const candidates = [
            ".ui-iggrid-nextbutton:not(.ui-state-disabled)",
            "a[title='Next Page']:not(.ui-state-disabled)",
            "a[aria-label='Next']:not(.disabled)",
          ];
          for (const sel of candidates) {
            const btn = document.querySelector(sel);
            if (btn instanceof HTMLElement) {
              btn.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (!clickedNext) break;
      await page.waitForTimeout(900);
      pushRows(await readVisibleRows());
    }
    console.log("[PGC] Review | rows scraped |", wfName, "|", rows.length);
    workflowBuckets.push({
      workflowName: wfName,
      rows,
    });
  }

  await page
    .evaluate((attr) => {
      document.querySelectorAll(`select[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }, PGC_REVIEW_WORKFLOW_SELECT_ATTR)
    .catch(() => {});

  return workflowBuckets;
}

async function processProjectReviewsAndMarkups(
  page,
  project,
  wflowInstanceID,
  options = {},
) {
  const projectID = String(project.projectID);
  const safePid = projectID.replace(/\D/g, "") || "unknown";
  const failShot = path.join(__dirname, `pgc-reviews-failed-${safePid}.png`);

  /** @type {any} */
  const out = {
    projectID,
    wflowInstanceID: wflowInstanceID ? String(wflowInstanceID) : null,
    reviewGroupsCount: 0,
    rawCorrectionsCount: 0,
    latestCycleCorrectionsCount: 0,
    changemarkCount: 0,
    commentCount: 0,
    statusCounts: /** @type {Record<string, number>} */ ({}),
    unresolvedCount: 0,
    resolvedCount: 0,
    infoOnlyCount: 0,
    questionCount: 0,
    markupPdfUniqueCount: 0,
    markupPdfDownloadedCount: 0,
    markupPdfSkippedDuplicate: 0,
    workflowBuckets: /** @type {{ workflowName: string, rows: Record<string,string>[] }[]} */ ([]),
    correctionsSample: /** @type {object[]} */ ([]),
    latestCycleCorrections: /** @type {object[]} */ ([]),
    markupArtifacts: /** @type {object[]} */ ([]),
    skipped: false,
    error: null,
  };

  /** @type {object | null} */
  let json = null;
  /** @type {"available" | "unavailable"} */
  let correctionsApiSummary = "unavailable";

  if (
    options.preloadedCorrectionsJson &&
    typeof options.preloadedCorrectionsJson === "object"
  ) {
    json = options.preloadedCorrectionsJson;
    correctionsApiSummary = "available";
    console.log(
      "[PGC] Review | corrections api | preloaded",
      options.preloadedCorrectionsUrl || "",
    );
  } else if (wflowInstanceID) {
    const url = pgcCorrectionsProbeUrl(String(wflowInstanceID));
    try {
      const res = await page.context().request.get(url, { timeout: 30000 });
      const text = await res.text();
      const parsed = parseJsonMaybe(text);
      if (res.ok() && parsed != null && typeof parsed === "object") {
        json = parsed;
        correctionsApiSummary = "available";
      } else {
        const st = res.status();
        console.warn("[PGC] Review | corrections api unavailable | HTTP", st);
      }
    } catch (e) {
      console.warn(
        "[PGC] Review | corrections api unavailable |",
        (e && e.message) || String(e),
      );
    }
  } else {
    const pack = await fetchPgcCorrectionsPayload(page, projectID, null);
    if (pack.ok && pack.json && typeof pack.json === "object") {
      json = pack.json;
      correctionsApiSummary = "available";
      console.log("[PGC] Review | corrections api | project-scoped", pack.url);
    } else {
      console.warn("[PGC] Review | corrections api unavailable | project-scoped fetch failed");
    }
  }

  console.log("[PGC] Review | DOM workflows start");
  try {
    out.workflowBuckets = await scrapePgcReviewWorkflowsFromDom(page, projectID);
  } catch (e) {
    console.warn("[PGC] Review | DOM workflows error |", e?.message || e);
    out.workflowBuckets = [];
  }

  const domWorkflowCount = out.workflowBuckets.length;
  const domRowCount = out.workflowBuckets.reduce(
    (n, b) => n + (Array.isArray(b.rows) ? b.rows.length : 0),
    0,
  );

  if (json == null || typeof json !== "object") {
    out.latestCycleCorrections = [];
    out.markupArtifacts = [];
    out.skipped = domRowCount === 0;
    out.error =
      domRowCount === 0
        ? "no review data: corrections API unavailable and DOM workflows empty"
        : null;
    console.log(
      `[PGC] Review | summary | workflows:${domWorkflowCount} rows:${domRowCount} api:unavailable`,
    );
    if (domRowCount === 0) {
      try {
        await page.screenshot({ path: failShot, fullPage: true });
      } catch (_) {}
    }
    return out;
  }

  const wfFromBody = pickWFlowInstanceIdFromCorrectionsBody(json);
  if (wfFromBody.id) {
    out.wflowInstanceID = wfFromBody.id;
  }

  try {
    const root = /** @type {Record<string, unknown>} */ (json);
    const rawCorr = /** @type {unknown[]} */ (
      root.Corrections ?? root.corrections ?? []
    );
    const rawGroups = /** @type {unknown[]} */ (
      root.ReviewGroups ?? root.reviewGroups ?? []
    );

    const reviewGroups = normalizeReviewGroups(rawGroups);
    out.reviewGroupsCount = reviewGroups.length;

    const normalized = rawCorr
      .map((row) => normalizeCorrectionRecord(/** @type {object} */ (row)))
      .filter(Boolean);
    const withInference = applyLatestCycleInference(normalized);
    out.rawCorrectionsCount = withInference.length;
    console.log(
      "[PGC] Task 7 — raw corrections count (before latest filter):",
      out.rawCorrectionsCount,
    );

    const latestOnly = withInference.filter((c) => c && c.isLatestCycle === true);
    out.latestCycleCorrectionsCount = latestOnly.length;
    out.latestCycleCorrections = latestOnly.map((c) => ({
      correctionID: c.correctionID,
      referenceNumber: c.referenceNumber,
      department: c.department,
      reviewerName: c.reviewerName,
      statusID: c.statusID,
      statusName: c.statusName,
      statusCompleted: c.statusCompleted,
      correctionType: c.correctionType,
      commentText: c.commentText,
      responseText: c.responseText,
      fileID: c.fileID,
      fileName: c.fileName,
      markupPdfUrl: c.markupPdfUrl,
      markupPdfStoragePath: null,
      reviewCycle: c.reviewCycle,
      wflowReviewCycleID: c.wflowReviewCycleID,
      wflowInstanceID: c.wflowInstanceID,
      wflowTaskID: c.wflowTaskID,
      taskName: c.taskName,
      taskStatus: c.taskStatus,
      isLatestCycle: c.isLatestCycle,
      requireApplicantResponse: c.requireApplicantResponse,
      dateCreated: c.dateCreated,
    }));
    console.log(
      "[PGC] Task 7 — latest-cycle corrections:",
      out.latestCycleCorrectionsCount,
    );
    if (out.rawCorrectionsCount > 0 && out.latestCycleCorrectionsCount === 0) {
      console.warn(
        "[PGC] Task 7 — no corrections with isLatestCycle===true; check API flags / cycle IDs",
      );
    }

    const cats = summarizeReviewCategories(latestOnly);
    out.changemarkCount = cats.changemarkCount;
    out.commentCount = cats.commentCount;
    out.statusCounts = cats.statusCounts;
    out.unresolvedCount = cats.unresolvedCount;
    out.resolvedCount = cats.resolvedCount;
    out.infoOnlyCount = cats.infoOnlyCount;
    out.questionCount = cats.questionCount;

    const withMarkup = latestOnly.filter(
      (c) => c && c.markupPdfUrl && String(c.markupPdfUrl).trim(),
    );
    const uniqueUrls = new Set(
      withMarkup.map((c) => normalizeText(String(c.markupPdfUrl || ""))).filter(Boolean),
    );
    out.markupPdfUniqueCount = uniqueUrls.size;
    console.log(
      "[PGC] Task 7 — unique markup PDF URLs (latest cycle):",
      out.markupPdfUniqueCount,
    );
    out.markupPdfDownloadedCount = 0;
    out.markupPdfSkippedDuplicate = 0;
    out.markupArtifacts = [];
    console.log("[PGC] Task 7 — markup PDF download skipped — URL stored as text only");

    const sampleSrc = latestOnly.slice(0, 5);
    out.correctionsSample = sampleSrc.map((c) => {
      return {
        correctionID: c.correctionID,
        referenceNumber: c.referenceNumber,
        department: c.department,
        reviewerName: c.reviewerName,
        statusID: c.statusID,
        statusName: c.statusName,
        statusCompleted: c.statusCompleted,
        correctionType: c.correctionType,
        commentText:
          c.commentText != null && c.commentText.length > 400
            ? c.commentText.slice(0, 400) + "…"
            : c.commentText,
        responseText:
          c.responseText != null && c.responseText.length > 400
            ? c.responseText.slice(0, 400) + "…"
            : c.responseText,
        fileID: c.fileID,
        fileName: c.fileName,
        markupPdfUrl: c.markupPdfUrl,
        reviewCycle: c.reviewCycle,
        wflowReviewCycleID: c.wflowReviewCycleID,
        isLatestCycle: c.isLatestCycle,
        requireApplicantResponse: c.requireApplicantResponse,
        dateCreated: c.dateCreated,
        markupPdfStoragePath: null,
      };
    });

    out.skipped =
      domRowCount === 0 &&
      out.latestCycleCorrectionsCount === 0 &&
      out.reviewGroupsCount === 0;
    out.error = null;
    console.log(
      `[PGC] Review | summary | workflows:${domWorkflowCount} rows:${domRowCount} api:${correctionsApiSummary}`,
    );
    return out;
  } catch (err) {
    const msg = (err && err.message) || String(err);
    out.error = msg;
    if (domRowCount > 0) {
      out.error = null;
      out.skipped = false;
      out.latestCycleCorrections = out.latestCycleCorrections || [];
      console.warn("[PGC] Review | corrections enrichment failed (DOM rows kept):", msg);
    } else {
      out.skipped = true;
      console.error("[PGC] Review | corrections enrichment failure:", msg);
      try {
        await page.screenshot({ path: failShot, fullPage: true });
        console.error("[PGC] Review | screenshot:", failShot);
      } catch (_) {}
    }
    console.log(
      `[PGC] Review | summary | workflows:${domWorkflowCount} rows:${domRowCount} api:${correctionsApiSummary}`,
    );
    return out;
  }
}

// ─── Task 8 — SSRS ReportViewer exports (Excel + PDF) ───────────────────────

/**
 * @param {string} projectID
 * @param {string} wflowInstanceID
 */
/**
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
function extractWFlowInstanceIdFromViewerUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/(?:^|[?&])WFlowInstanceID=(\d+)/i);
  return m ? String(m[1]) : null;
}

function buildPgcReportUrls(projectID, wflowInstanceID) {
  const base = `${PGC_PORTAL_ORIGIN}/ProjectDox/ReportViewer.aspx`;
  const specs = [
    {
      fileSlug: "plan-review-comments",
      reportName: "Plan Review - Review Comments",
      reportPath: "/PDoxProdReportPGC/Plan Review - Review Comments",
    },
    {
      fileSlug: "dept-review-status",
      reportName: "Dynamic Review - Department Review Status",
      reportPath:
        "/PDoxProdReportPGC/Dynamic Review - Department Review Status",
    },
    {
      fileSlug: "workflow-routing-slip",
      reportName: "Dynamic Review - Workflow Routing Slip",
      reportPath:
        "/PDoxProdReportPGC/Dynamic Review - Workflow Routing Slip",
    },
  ];
  return specs.map((s) => {
    const q = new URLSearchParams({
      ReportPath: s.reportPath,
      DataSourceName: "DataSource1",
      ProjectID: String(projectID),
      WFlowInstanceID: String(wflowInstanceID),
      Timezone: "",
    });
    return {
      fileSlug: s.fileSlug,
      reportName: s.reportName,
      url: `${base}?${q.toString()}`,
    };
  });
}

/**
 * SSRS WebForms viewer often renders in an iframe with a dynamic ClientID (not always "ReportViewer1").
 * Wait until $find exposes exportReport and the viewer is not still loading.
 * @param {import('playwright').Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<{ frame: import('playwright').Frame, clientId: string } | null>}
 */
/** Washington parity: raw PNG as base64 string (no data: prefix) for portal_data.tabs.reports.pdfs[].screenshot */
const PGC_REPORT_SCREENSHOT_MAX_PNG_BYTES = 2 * 1024 * 1024;

/**
 * Capture SSRS report as PNG base64 while the viewer is visible (before export dialogs).
 * @param {import('playwright').Page} page
 * @param {{ frame: import('playwright').Frame, clientId: string } | null} viewerHandle
 * @returns {Promise<string | null>}
 */
async function capturePgcReportScreenshotBase64(page, viewerHandle) {
  try {
    let buf;
    if (
      viewerHandle &&
      viewerHandle.frame &&
      typeof viewerHandle.frame.screenshot === "function" &&
      !viewerHandle.frame.isDetached()
    ) {
      buf = await viewerHandle.frame.screenshot({ type: "png" });
    } else {
      buf = await page.screenshot({ fullPage: true, type: "png" });
    }
    if (!buf || buf.length < 80) return null;
    if (buf.length > PGC_REPORT_SCREENSHOT_MAX_PNG_BYTES) {
      console.warn(
        "[PGC] Reports | screenshot omitted (PNG exceeds cap)",
        buf.length,
      );
      return null;
    }
    const b64 = Buffer.from(buf).toString("base64");
    return b64;
  } catch (e) {
    console.warn(
      "[PGC] Reports | screenshot capture failed:",
      (e && e.message) || e,
    );
    return null;
  }
}

async function waitForPgcReportViewerHandle(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        if (frame.isDetached()) continue;
        const hit = await frame.evaluate(() => {
          const fn = /** @type {any} */ (window).$find;
          if (typeof fn !== "function") return null;
          /** @type {string[]} */
          const ids = [];
          ids.push("ReportViewer1", "ReportViewer");
          try {
            document.querySelectorAll("[id*='ReportViewer']").forEach((el) => {
              if (el.id) ids.push(el.id);
            });
          } catch (_) {}
          const uniq = [...new Set(ids)];
          for (const clientId of uniq) {
            try {
              const rv = fn.call(window, clientId);
              if (!rv || typeof rv.exportReport !== "function") continue;
              if (
                typeof rv.get_isLoading === "function" &&
                rv.get_isLoading()
              ) {
                continue;
              }
              return { clientId };
            } catch (_) {}
          }
          return null;
        });
        if (hit && hit.clientId) return { frame, clientId: hit.clientId };
      } catch (_) {}
    }
    await page.waitForTimeout(400);
  }
  return null;
}

/**
 * @param {import('playwright').Page} page
 */
async function waitForReportViewerReady(page) {
  const h = await waitForPgcReportViewerHandle(page, 30000);
  return !!h;
}

/**
 * GET with rs:Format= when client export does not emit a Playwright download (some hosts).
 * @param {import('playwright').Page} page
 * @param {string} viewerPageUrl
 * @param {string} format
 * @param {string} destPath
 */
async function tryPgcReportExportViaHttp(page, viewerPageUrl, format, destPath) {
  const exportUrl = pgcReportViewerUrlWithFormat(viewerPageUrl, format);
  try {
    const res = await page.request.get(exportUrl, {
      timeout: 120000,
      failOnStatusCode: false,
    });
    const status = res.status();
    const buf = Buffer.from(await res.body());
    if (status >= 400 || buf.length < 64) return false;
    const head = buf.slice(0, 240).toString("utf8").toLowerCase();
    if (
      head.includes("<html") ||
      head.includes("sessionended") ||
      head.includes("login") ||
      head.includes("useridsessionidmapping")
    ) {
      return false;
    }
    if (format === "PDF") {
      if (!buf.slice(0, 4).equals(Buffer.from("%PDF"))) return false;
    } else if (format === "EXCELOPENXML") {
      if (buf.slice(0, 2).toString("binary") !== "PK") return false;
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, buf);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} format EXCELOPENXML | PDF
 * @param {string} destPath
 * @param {{ frame: import('playwright').Frame, clientId: string } | null} [viewerHandle]
 * @param {string | null} [viewerPageUrlForHttp] page URL after goto (HTTP fallback)
 * @returns {Promise<{ ok: boolean, error?: string, retries?: number, viaHttp?: boolean }>}
 */
async function exportReportFormat(
  page,
  format,
  destPath,
  viewerHandle = null,
  viewerPageUrlForHttp = null,
) {
  async function doExport(handle) {
    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    await handle.frame.evaluate(
      ({ clientId, fmt }) => {
        const fn = /** @type {any} */ (window).$find;
        if (typeof fn !== "function") throw new Error("$find not available");
        const rv = fn.call(window, clientId);
        if (!rv || typeof rv.exportReport !== "function") {
          throw new Error("exportReport not available");
        }
        rv.exportReport(fmt);
      },
      { clientId: handle.clientId, fmt: format },
    );
    const download = await downloadPromise;
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await download.saveAs(destPath);
  }

  const handle =
    viewerHandle || (await waitForPgcReportViewerHandle(page, 15000));
  if (!handle) {
    const base = viewerPageUrlForHttp || page.url();
    if (
      base &&
      (await tryPgcReportExportViaHttp(page, base, format, destPath))
    ) {
      return { ok: true, retries: 0, viaHttp: true };
    }
    return { ok: false, error: "report viewer not ready", retries: 0 };
  }

  try {
    await doExport(handle);
    return { ok: true, retries: 0 };
  } catch (firstErr) {
    const msg = (firstErr && firstErr.message) || String(firstErr);
    pgcProgress.pgcLogDetail("task8_export_retry", { format, message: msg });
    await page.waitForTimeout(3000);
    const handle2 =
      (await waitForPgcReportViewerHandle(page, 20000)) || handle;
    try {
      await doExport(handle2);
      return { ok: true, retries: 1 };
    } catch (secondErr) {
      const base = viewerPageUrlForHttp || page.url();
      if (
        base &&
        (await tryPgcReportExportViaHttp(page, base, format, destPath))
      ) {
        return { ok: true, retries: 1, viaHttp: true };
      }
      return {
        ok: false,
        error: (secondErr && secondErr.message) || String(secondErr),
        retries: 1,
      };
    }
  }
}

function normalizeReportName(s) {
  return normalizeText(String(s || ""))
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match grid row label to normalized target set (exact or long substring), same idea as in-browser harvest.
 * @param {string} rawName
 * @param {Set<string>} wantedNormalized
 */
function pgcReportRowMatchesAnyTarget(rawName, wantedNormalized) {
  const k = normalizeReportName(rawName);
  if (!k) return false;
  if (wantedNormalized.has(k)) return true;
  for (const t of wantedNormalized) {
    if (t.length < 12) continue;
    if (k.includes(t) || t.includes(k)) return true;
  }
  return false;
}

/**
 * @param {string} a
 * @param {string} b
 */
function pgcReportNamesLooselyMatch(a, b) {
  const ka = normalizeReportName(a);
  const kb = normalizeReportName(b);
  if (ka && kb && ka === kb) return true;
  if (ka.length >= 12 && kb.length >= 12 && (ka.includes(kb) || kb.includes(ka)))
    return true;
  return false;
}

/**
 * Wait for igGrid report rows to have real body content (AJAX after domcontentloaded).
 * @param {import('playwright').Page} page
 */
async function waitForPgcReportsGridReady(page) {
  await page.waitForSelector("#grdReports", { timeout: 20000 }).catch(() => {});
  await page
    .waitForSelector("#grdReports tbody tr", { timeout: 20000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => {
        const trs = document.querySelectorAll("#grdReports tbody tr");
        if (!trs.length) return false;
        return Array.from(trs).some((tr) => {
          const st = window.getComputedStyle(tr);
          if (st.display === "none" || st.visibility === "hidden") return false;
          const tds = tr.querySelectorAll("td");
          if (tds.length < 1) return false;
          const txt = Array.from(tds)
            .map((td) => (td.textContent || "").replace(/\u00a0/g, " ").trim())
            .join(" ");
          return txt.length > 3;
        });
      },
      { timeout: 25000 },
    )
    .catch(() => {});
  await page.waitForTimeout(600);
}

/** Append rs:Format if not already present (ReportViewer GET export hint). */
function pgcReportViewerUrlWithFormat(viewerUrl, format) {
  const u = String(viewerUrl || "");
  if (!u) return u;
  if (/rs:Format=/i.test(u)) return u;
  return `${u}${u.includes("?") ? "&" : "?"}rs:Format=${encodeURIComponent(format)}`;
}

const PGC_TARGET_REPORT_NAMES = [
  "Dynamic Review - Department Review Status",
  "Dynamic Review - Workflow Routing Slip",
  "Plan Review - Review Comments",
];

/**
 * @param {string} nm
 * @param {number} i
 */
function pgcReportFileSlugFromTargetName(nm, i) {
  return (
    normalizeText(nm || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `report-${i + 1}`
  );
}

/**
 * Scrape visible report rows from PGC reports tab grid (#grdReports first).
 * @param {import('playwright').Page} page
 * @param {string} projectID
 */
async function scrapePgcReportsTabRows(page, projectID) {
  const url = `${PGC_WEBUI}/Project/Index?tab=reportsTab&ProjectID=${encodeURIComponent(
    String(projectID),
  )}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForPgcReportsGridReady(page);
  const targetNorm = PGC_TARGET_REPORT_NAMES.map((n) => normalizeReportName(n));
  /** @type {{ rowIndex: number, reportName: string, reportType: string, reportDescription: string, viewUrl: string | null, actionText: string | null, stableRowKey: string, nameCellSample: string }[]} */
  const rows = await page.evaluate((targets) => {
    function norm(s) {
      if (s == null) return "";
      return String(s).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }
    function rowKey(tr, idx) {
      const id =
        tr.getAttribute("data-id") ||
        tr.getAttribute("data-ig") ||
        tr.getAttribute("id") ||
        "";
      return id || `idx:${idx}`;
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st) return false;
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const targetKeys = targets;
    const targetSet = new Set(targetKeys);
    /** @type {{ rowIndex: number, reportName: string, reportType: string, reportDescription: string, viewUrl: string | null, actionText: string | null, stableRowKey: string, nameCellSample: string }[]} */
    const out = [];
    const seen = new Set();

    function reportCellKey(s) {
      return norm(String(s))
        .replace(/[\u2013\u2014\u2212]/g, "-")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    function rowMatchesTargets(nameRaw) {
      const k = reportCellKey(nameRaw);
      if (!k) return false;
      if (targetSet.has(k)) return true;
      for (const t of targetKeys) {
        if (t.length < 12) continue;
        if (k.includes(t) || t.includes(k)) return true;
      }
      return false;
    }

    function harvestFromTable(table, trList) {
      const headers = Array.from(
        table.querySelectorAll("thead th, thead tr th, tr:first-child th"),
      ).map((th) => norm(th.textContent).toLowerCase());
      const idxName = headers.findIndex((h) => /report.*name|^name$/.test(h));
      const idxType = headers.findIndex((h) => /report.*type|^type$/.test(h));
      const idxDesc = headers.findIndex((h) => /description|report.*desc/.test(h));
      let localRowIndex = -1;
      for (const tr of trList) {
        if (!isVisible(tr)) continue;
        if (tr.querySelector("th")) continue;
        localRowIndex += 1;
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 2) continue;
        const cols = tds.map((td) => norm(td.textContent));
        let reportName = "";
        let reportType = "";
        let reportDescription = "";
        if (idxName >= 0 || idxType >= 0 || idxDesc >= 0) {
          reportName = idxName >= 0 ? cols[idxName] || "" : cols[0] || "";
          reportType = idxType >= 0 ? cols[idxType] || "" : cols[1] || "";
          reportDescription = idxDesc >= 0 ? cols[idxDesc] || "" : cols[2] || "";
        } else {
          reportName = cols[0] || "";
          reportType = cols[1] || "";
          reportDescription = cols[2] || "";
        }
        const rnLower = reportName.toLowerCase().replace(/\s+/g, " ").trim();
        if (!reportName || /^action|icon|run$/i.test(reportName)) continue;
        if (reportName.length < 2) continue;
        if (!rowMatchesTargets(reportName)) continue;
        let nameCellSample = "";
        const nameTd =
          idxName >= 0 && tds[idxName]
            ? tds[idxName]
            : tds[0] || null;
        if (nameTd) nameCellSample = norm(nameTd.textContent).slice(0, 200);
        const nameAnchors = nameTd
          ? Array.from(nameTd.querySelectorAll("a"))
          : Array.from(tr.querySelectorAll("a"));
        const reportNameAnchor =
          nameAnchors.find(
            (a) =>
              norm(a.textContent).toLowerCase().includes(rnLower) ||
              rnLower.includes(norm(a.textContent).toLowerCase()),
          ) || nameAnchors[0];
        const actionNode =
          reportNameAnchor ||
          tr.querySelector("a[href], a[onclick], button[onclick], [onclick]");
        const viewUrlRaw =
          actionNode?.getAttribute("href") ||
          actionNode?.getAttribute("data-href") ||
          null;
        const viewUrl =
          viewUrlRaw && !/^javascript:/i.test(viewUrlRaw) ? viewUrlRaw : null;
        const actionText = actionNode ? norm(actionNode.textContent) : null;
        const sig = `${rnLower}::${reportType.toLowerCase()}::${reportDescription.toLowerCase()}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({
          rowIndex: localRowIndex,
          reportName,
          reportType,
          reportDescription,
          viewUrl,
          actionText,
          stableRowKey: rowKey(tr, localRowIndex),
          nameCellSample,
        });
      }
      return out.length > 0;
    }

    const grdTrs = Array.from(
      document.querySelectorAll("#grdReports tbody tr"),
    ).filter(isVisible);
    if (grdTrs.length) {
      const hostTable =
        document.querySelector("#grdReports")?.closest("table") ||
        document.querySelector("#grdReports");
      const tableEl =
        hostTable instanceof HTMLTableElement
          ? hostTable
          : document.querySelector(".ui-iggrid-table, table") || document.body;
      harvestFromTable(tableEl, grdTrs);
    }
    if (!out.length) {
      const tables = Array.from(
        document.querySelectorAll(".ui-iggrid-table, table"),
      ).filter((t) => isVisible(t));
      for (const table of tables) {
        const trList = Array.from(table.querySelectorAll("tbody tr, tr")).filter(
          isVisible,
        );
        if (harvestFromTable(table, trList)) break;
      }
    }
    return out;
  }, targetNorm);
  pgcProgress.pgcLogDetail("task8_reports_grid_scrape", {
    projectID,
    rowCount: rows.length,
    rows: rows.map((r) => ({
      reportName: r.reportName,
      stableRowKey: r.stableRowKey,
      hasStaticHref: !!r.viewUrl,
    })),
  });
  return rows;
}

/**
 * Pick best ReportViewer URL from captured candidates.
 * @param {string[]} urls
 */
function pickPgcReportViewerUrl(urls) {
  const list = (urls || []).filter(Boolean);
  const scored = list
    .filter((u) => /ReportViewer\.aspx/i.test(u) && /ReportPath=/i.test(u))
    .map((u) => ({ u, len: u.length }));
  if (!scored.length) return null;
  scored.sort((a, b) => b.len - a.len);
  return scored[0].u;
}

/**
 * Capture real ReportViewer.aspx URL by clicking the report row (window.open or same-tab).
 * Re-finds row by report name in #grdReports tbody tr (no nth-index on a broad selector).
 * @param {import('playwright').Page} page
 * @param {string} projectID
 * @param {string} reportName
 */
async function captureReportActionUrlFromRow(page, projectID, reportName) {
  const tabUrl = `${PGC_WEBUI}/Project/Index?tab=reportsTab&ProjectID=${encodeURIComponent(
    String(projectID),
  )}`;
  const nameTrim = String(reportName || "").trim();
  if (!nameTrim) return null;

  await page.goto(tabUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await waitForPgcReportsGridReady(page);

  /** @type {string[]} */
  const captured = [];
  const onReq = (req) => {
    const u = req.url();
    if (
      /ReportViewer\.aspx/i.test(u) &&
      (/ReportPath=/i.test(u) || /WFlowInstanceID=/i.test(u))
    ) {
      captured.push(u);
    }
  };
  page.on("request", onReq);

  const context = page.context();
  /** @type {import('playwright').Page | null} */
  let popup = null;

  try {
    const popupPromise = context
      .waitForEvent("page", { timeout: 12000 })
      .catch(() => null);
    const navPromise = page
      .waitForURL(/ReportViewer\.aspx/i, { timeout: 12000 })
      .catch(() => {});

    const row = page
      .locator("#grdReports tbody tr")
      .filter({ hasText: nameTrim })
      .first();
    const hasRow = (await row.count().catch(() => 0)) > 0;

    if (hasRow) {
      const nameLink = row.locator("a").filter({ hasText: nameTrim }).first();
      const hasNameLink = (await nameLink.count().catch(() => 0)) > 0;
      const clickTarget = hasNameLink ? nameLink : row.locator("a").first();
      if ((await clickTarget.count().catch(() => 0)) > 0) {
        await clickTarget.click({ timeout: 8000 }).catch(() => {});
      }
    } else {
      await page
        .evaluate((name) => {
          const want = String(name || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          const trs = document.querySelectorAll("#grdReports tbody tr");
          for (const tr of trs) {
            const t = (tr.textContent || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .toLowerCase();
            if (!t.includes(want)) continue;
            const links = tr.querySelectorAll("a");
            for (const a of links) {
              const at = (a.textContent || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .toLowerCase();
              if (at.includes(want) || want.includes(at)) {
                a.click();
                return "name_anchor";
              }
            }
            const first = tr.querySelector("a");
            if (first) {
              first.click();
              return "first_anchor";
            }
          }
          return null;
        }, nameTrim)
        .catch(() => null);
    }

    await navPromise;
    popup = await popupPromise;

    if (popup && !popup.isClosed()) {
      try {
        await popup
          .waitForLoadState("domcontentloaded", { timeout: 15000 })
          .catch(() => {});
        const pu = popup.url();
        if (/ReportViewer\.aspx/i.test(pu)) captured.push(pu);
      } catch (_) {}
      await popup.close().catch(() => {});
    }

    const mainU = page.url();
    if (/ReportViewer\.aspx/i.test(mainU)) captured.push(mainU);

    await page.waitForTimeout(800);
  } finally {
    page.off("request", onReq);
    if (popup && !popup.isClosed()) await popup.close().catch(() => {});
    await page.goto(tabUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await waitForPgcReportsGridReady(page);
  }

  const best = pickPgcReportViewerUrl(captured);
  pgcProgress.pgcLogDetail("task8_report_viewer_url_capture", {
    projectID,
    reportName: nameTrim,
    candidateCount: captured.length,
    picked: best
      ? best.length > 400
        ? `${best.slice(0, 400)}…`
        : best
      : null,
  });
  return best;
}

/**
 * @param {import('playwright').Page} page
 * @param {object} project Task 3 row
 * @param {string | null | undefined} wflowInstanceID
 * @param {{ dashboardUrl?: string | null }} [opts] — required for reports-only: open project from My Projects first so #grdReports loads
 */
async function processPgcSsrReportsForProject(
  page,
  project,
  wflowInstanceID,
  opts = {},
) {
  const projectID = String(project.projectID);
  const safePid = projectID.replace(/\D/g, "") || "unknown";
  const dashboardUrl = opts.dashboardUrl != null ? String(opts.dashboardUrl).trim() : "";

  let activePage = page;
  /** @type {import('playwright').Page | null} */
  let popupToClose = null;

  try {
    if (dashboardUrl) {
      const opened = await openProjectViaDashboardRow(
        page,
        dashboardUrl,
        projectID,
        { projectNumber: project.projectNumber },
      );
      if (!opened.ok) {
        console.warn(
          `[PGC] Reports | dashboard open | ${opened.reason || "failed"}`,
        );
      } else if (opened.detailPage && !opened.detailPage.isClosed()) {
        activePage = opened.detailPage;
        if (opened.detailPage !== page) popupToClose = opened.detailPage;
      }
    }

    let gridRows = [];
    try {
      console.log(`[PGC] Reports | start | project ${projectID}`);
      gridRows = await scrapePgcReportsTabRows(activePage, projectID);
      const wanted = new Set(PGC_TARGET_REPORT_NAMES.map(normalizeReportName));
      gridRows = gridRows.filter((r) =>
        pgcReportRowMatchesAnyTarget(r.reportName, wanted),
      );
      for (const r of gridRows) {
        console.log(`[PGC] Reports | row found | ${r.reportName}`);
        if (!r.viewUrl || /^javascript:/i.test(String(r.viewUrl))) {
          const actionUrl = await captureReportActionUrlFromRow(
            activePage,
            projectID,
            r.reportName,
          );
          if (actionUrl) {
            r.viewUrl = actionUrl;
            console.log(
              `[PGC] Reports | viewer url captured | ${r.reportName}`,
            );
          }
        }
      }
    } catch (e) {
      pgcProgress.pgcLogDetail("task8_reports_grid_error", {
        projectID,
        error: (e && e.message) || String(e),
      });
      console.log(`[PGC] Reports | grid scrape failed | ${projectID}`);
    }

    let effectiveWfid =
      wflowInstanceID != null && String(wflowInstanceID).trim() !== ""
        ? String(wflowInstanceID).trim()
        : null;
    if (!effectiveWfid) {
      for (const r of gridRows) {
        const fromUrl = extractWFlowInstanceIdFromViewerUrl(r.viewUrl);
        if (fromUrl) {
          effectiveWfid = fromUrl;
          console.log(
            `[PGC] Reports | WFlowInstanceID from report viewer URL | ${effectiveWfid}`,
          );
          break;
        }
      }
    }

    const wfid =
      effectiveWfid != null && String(effectiveWfid).trim() !== ""
        ? String(effectiveWfid).trim()
        : null;

    const builtSpecs = wfid ? buildPgcReportUrls(projectID, wfid) : [];
    /** @type {{ fileSlug: string, reportName: string, fallbackUrl: string | null }[]} */
    const specList = PGC_TARGET_REPORT_NAMES.map((nm, i) => {
      const b = builtSpecs.find(
        (s) =>
          normalizeReportName(s.reportName) === normalizeReportName(nm),
      );
      return {
        fileSlug: b?.fileSlug || pgcReportFileSlugFromTargetName(nm, i),
        reportName: nm,
        fallbackUrl: b?.url || null,
      };
    });

    const outDir = path.join(__dirname, "pgc-reports", safePid);
    await fs.promises.mkdir(outDir, { recursive: true });

    /** @type {any[]} */
    const reports = [];

    for (const spec of specList) {
      const hit = gridRows.find((r) =>
        pgcReportNamesLooselyMatch(r.reportName, spec.reportName),
      );
      const liveUrl =
        hit?.viewUrl && /^https?:\/\//i.test(String(hit.viewUrl).trim())
          ? String(hit.viewUrl).trim()
          : null;
      const navigateUrl = liveUrl || spec.fallbackUrl;
      const navSource = liveUrl ? "live" : spec.fallbackUrl ? "fallback" : "none";

      const entry = {
        fileSlug: spec.fileSlug,
        reportName: spec.reportName,
        reportType: hit?.reportType || "",
        reportDescription: hit?.reportDescription || "",
        reportUrl: navigateUrl || hit?.viewUrl || null,
        viewUrl: navigateUrl || hit?.viewUrl || null,
        downloadUrlExcel: navigateUrl
          ? pgcReportViewerUrlWithFormat(navigateUrl, "EXCELOPENXML")
          : null,
        downloadUrlPdf: navigateUrl
          ? pgcReportViewerUrlWithFormat(navigateUrl, "PDF")
          : null,
        excelAvailable: !!navigateUrl,
        pdfAvailable: !!navigateUrl,
        viewerReady: false,
        excelDownloaded: false,
        excelPath: null,
        pdfDownloaded: false,
        pdfPath: null,
        excelRetries: null,
        pdfRetries: null,
        exportUnavailable: false,
      };

      const failShot = path.join(
        __dirname,
        `pgc-reports-failed-${safePid}-${spec.fileSlug}.png`,
      );

      if (!navigateUrl) {
        entry.exportUnavailable = true;
        if (!wfid) {
          console.log(
            `[PGC] Reports | export skipped no wfid | ${spec.reportName}`,
          );
        } else {
          console.log(
            `[PGC] Reports | export skipped no url | ${spec.reportName}`,
          );
        }
        reports.push(entry);
        continue;
      }

      pgcProgress.pgcLogDetail("task8_report_navigate", {
        reportName: spec.reportName,
        source: navSource,
        url: navigateUrl,
      });

      try {
        await activePage.goto(navigateUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await activePage.waitForTimeout(TASK8_REPORT_POST_NAV_MS);

        const viewerHandle = await waitForPgcReportViewerHandle(activePage);
        entry.viewerReady = !!viewerHandle;

        const shotB64 = await capturePgcReportScreenshotBase64(
          activePage,
          viewerHandle,
        );
        if (shotB64) {
          entry.screenshot = shotB64;
          console.log(
            `[PGC] Reports | screenshot ok | ${spec.reportName} | ${Math.round(shotB64.length / 1024)}KB base64`,
          );
        }

        const excelPath = path.join(outDir, `${spec.fileSlug}.xlsx`);
        const pdfPath = path.join(outDir, `${spec.fileSlug}.pdf`);
        const viewerUrlForHttp = activePage.url();

        if (!viewerHandle) {
          const xResHttp = await exportReportFormat(
            activePage,
            "EXCELOPENXML",
            excelPath,
            null,
            viewerUrlForHttp,
          );
          entry.excelDownloaded = xResHttp.ok;
          entry.excelPath = xResHttp.ok ? excelPath : null;
          entry.excelRetries = xResHttp.retries;
          if (xResHttp.ok) {
            console.log(`[PGC] Reports | excel ok | ${spec.reportName}`);
          } else {
            console.log(`[PGC] Reports | excel fail | ${spec.reportName}`);
            pgcProgress.pgcLogDetail("task8_excel_fail", {
              reportName: spec.reportName,
              error: xResHttp.error,
            });
            try {
              await activePage.screenshot({ path: failShot, fullPage: true });
              pgcProgress.pgcLogDetail("task8_report_fail_shot", {
                reportName: spec.reportName,
                path: failShot,
              });
            } catch (_) {}
            reports.push(entry);
            continue;
          }

          const pResHttp = await exportReportFormat(
            activePage,
            "PDF",
            pdfPath,
            null,
            viewerUrlForHttp,
          );
          entry.pdfDownloaded = pResHttp.ok;
          entry.pdfPath = pResHttp.ok ? pdfPath : null;
          entry.pdfRetries = pResHttp.retries;
          if (pResHttp.ok) {
            console.log(`[PGC] Reports | pdf ok | ${spec.reportName}`);
          } else {
            console.log(`[PGC] Reports | pdf fail | ${spec.reportName}`);
            pgcProgress.pgcLogDetail("task8_pdf_fail", {
              reportName: spec.reportName,
              error: pResHttp.error,
            });
          }
          reports.push(entry);
          continue;
        }

        const xRes = await exportReportFormat(
          activePage,
          "EXCELOPENXML",
          excelPath,
          viewerHandle,
          viewerUrlForHttp,
        );
        entry.excelDownloaded = xRes.ok;
        entry.excelPath = xRes.ok ? excelPath : null;
        entry.excelRetries = xRes.retries;
        if (xRes.ok) {
          console.log(`[PGC] Reports | excel ok | ${spec.reportName}`);
        } else {
          console.log(`[PGC] Reports | excel fail | ${spec.reportName}`);
          pgcProgress.pgcLogDetail("task8_excel_fail", {
            reportName: spec.reportName,
            error: xRes.error,
          });
        }

        await activePage.waitForTimeout(1000);
        const viewerHandlePdf =
          (await waitForPgcReportViewerHandle(activePage)) || viewerHandle;
        const rvStill = !!viewerHandlePdf;
        if (!rvStill) {
          pgcProgress.pgcLogDetail("task8_pdf_skip_not_ready", {
            reportName: spec.reportName,
          });
          console.log(`[PGC] Reports | pdf fail | ${spec.reportName}`);
        } else {
          const pRes = await exportReportFormat(
            activePage,
            "PDF",
            pdfPath,
            viewerHandlePdf,
            viewerUrlForHttp,
          );
          entry.pdfDownloaded = pRes.ok;
          entry.pdfPath = pRes.ok ? pdfPath : null;
          entry.pdfRetries = pRes.retries;
          if (pRes.ok) {
            console.log(`[PGC] Reports | pdf ok | ${spec.reportName}`);
          } else {
            console.log(`[PGC] Reports | pdf fail | ${spec.reportName}`);
            pgcProgress.pgcLogDetail("task8_pdf_fail", {
              reportName: spec.reportName,
              error: pRes.error,
            });
          }
        }
      } catch (e) {
        pgcProgress.pgcLogDetail("task8_report_page_error", {
          fileSlug: spec.fileSlug,
          reportName: spec.reportName,
          error: (e && e.message) || String(e),
        });
        console.log(`[PGC] Reports | error | ${spec.reportName} | page`);
        try {
          await activePage.screenshot({ path: failShot, fullPage: true });
        } catch (_) {}
      }

      reports.push(entry);
    }

    if (gridRows.length && reports.length) {
      for (const entry of reports) {
        const match = gridRows.find((r) =>
          pgcReportNamesLooselyMatch(r.reportName, entry.reportName),
        );
        if (match) {
          entry.reportType = match.reportType || entry.reportType || "";
          entry.reportDescription =
            match.reportDescription || entry.reportDescription || "";
          if (match.viewUrl) {
            entry.reportUrl = match.viewUrl;
            entry.viewUrl = match.viewUrl;
            entry.downloadUrlExcel = `${match.viewUrl}${
              match.viewUrl.includes("?") ? "&" : "?"
            }rs:Format=EXCELOPENXML`;
            entry.downloadUrlPdf = `${match.viewUrl}${
              match.viewUrl.includes("?") ? "&" : "?"
            }rs:Format=PDF`;
          }
        }
      }
    }

    const payload = {
      projectID,
      wflowInstanceID: wfid,
      reports,
    };
    const foundCount = gridRows.length;
    const exportedCount = reports.filter(
      (r) => r.excelDownloaded || r.pdfDownloaded,
    ).length;
    console.log(
      `[PGC] Reports | summary | ${projectID} | found:${foundCount} exported:${exportedCount}`,
    );
    pgcProgress.pgcLogDetail("task8_report_export_payload", {
      ...payload,
      reports: (payload.reports || []).map((r) => {
        const { screenshot, ...rest } = r;
        return {
          ...rest,
          screenshotKb: screenshot ? Math.round(String(screenshot).length / 1024) : 0,
          screenshotPresent: !!screenshot,
        };
      }),
    });
    return payload;
  } finally {
    if (popupToClose && !popupToClose.isClosed()) {
      await popupToClose.close().catch(() => {});
    }
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {object} project row from Task 3
 * @param {string[]} bases
 * @param {string} dashboardUrl
 */
async function scrapeSingleProjectDetails(page, project, bases, dashboardUrl) {
  const projectID = project.projectID;
  const safeId = String(projectID).replace(/\D/g, "") || "unknown";
  const detailFailShot = path.join(
    __dirname,
    `pgc-project-detail-failed-${safeId}.png`,
  );

  /** @type {any} */
  const out = {
    projectID,
    dashboard: {
      projectNumber: project.projectNumber || null,
      description: project.description || null,
      location: project.location || null,
      status: project.status || null,
    },
    info: null,
    info_debug: null,
    statusTab: null,
    tasksTab: null,
    _meta: {
      detailNavigationPattern:
        "GET /ProjectDoxWebUI/Project/Index?tab=infoTab|projectStatusTab|tasksTab&ProjectID=",
      basesTried: ["Project/Index only (bases argument ignored for PGC tabs)"],
      tabUrls: /** @type {Record<string, string>} */ ({}),
      tabsOk: { info: false, status: false, tasks: false },
      notes: /** @type {string[]} */ ([]),
    },
  };

  let usedRowClick = false;
  /** @type {import('playwright').Page | null} */
  let ssoDetailPopup = null;

  /**
   * @param {"info"|"status"|"tasks"} tabKey
   */
  async function runTab(tabKey) {
    const spec = PGC_DETAIL_TABS[tabKey];
    if (!spec) return null;
    let nav = await gotoPgcProjectTab(
      page,
      projectID,
      spec.tabName,
      spec.extraParams,
    );
    if (!nav.ok && !usedRowClick) {
      const rowOpen = await openProjectViaDashboardRow(
        page,
        dashboardUrl,
        projectID,
        { projectNumber: project.projectNumber },
      );
      if (rowOpen.ok) {
        usedRowClick = true;
        if (rowOpen.detailPage) {
          ssoDetailPopup = rowOpen.detailPage;
          page = rowOpen.detailPage;
          out._meta.notes.push(
            "fallback: dashboard row click → SSO popup (launchRemote); using popup page",
          );
        }
        out._meta.notes.push(
          `fallback: dashboard row click → ${rowOpen.url}`,
        );
        nav = await gotoPgcProjectTab(
          page,
          projectID,
          spec.tabName,
          spec.extraParams,
        );
      }
    }
    if (!nav.ok) {
      out._meta.notes.push(
        `${tabKey}: navigation failed — ${(nav.errors || []).join("; ")}`,
      );
      return null;
    }
    out._meta.tabUrls[tabKey] = nav.url;
    if (!out._meta.detailBaseResolved) {
      out._meta.detailBaseResolved = nav.baseUsed;
      out._meta.detailEntryUrl = nav.url;
    }

    let target = await getContentTarget(page);
    if (tabKey === "info") {
      const sub = await maybeClickProjectInfoSubtab(page);
      if (sub) out._meta.notes.push(`info: ${sub}`);
      target = await getContentTarget(page);
      await target
        .waitForFunction(() => {
          const isVisible = (el) => {
            if (!el || !(el instanceof Element)) return false;
            const st = window.getComputedStyle(el);
            if (!st) return false;
            if (
              st.display === "none" ||
              st.visibility === "hidden" ||
              Number(st.opacity || "1") === 0
            )
              return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          for (const t of document.querySelectorAll("table")) {
            if (!isVisible(t)) continue;
            for (const tr of t.querySelectorAll("tr")) {
              if (!isVisible(tr)) continue;
              const cells = tr.querySelectorAll("td, th");
              if (cells.length < 2) continue;
              const k = (cells[0].textContent || "").replace(/\s+/g, " ").trim();
              if (k) return true;
            }
          }
          return false;
        }, { timeout: 15000 })
        .catch(() => {});

      await logInfoContextSnapshot(target, "BeforeInfoExtract");

      /** @type {{ info: any, info_debug: any }} */
      let guarded = await extractProjectInfo(target, project);

      if (guarded.info === null) {
        const altNav = await gotoPgcProjectTab(
          page,
          projectID,
          "projectInfoTab",
          "projectTab=TabProjectInfo",
        );
        if (altNav.ok) {
          out._meta.notes.push(
            "info: fallback to projectInfoTab&projectTab=TabProjectInfo",
          );
          out._meta.tabUrls.info = altNav.url;
          target = await getContentTarget(page);
          await target
            .waitForSelector("table tr, dt, dd", { timeout: 15000 })
            .catch(() => {});
          await logInfoContextSnapshot(
            target,
            "BeforeInfoExtract-afterAltTab",
          );
          guarded = await extractProjectInfo(target, project);
        }
      }

      if (guarded.info !== null) {
        out.info = guarded.info;
        out.info_debug = guarded.info_debug;
        out._meta.infoPairsCount =
          guarded.info._nonEmptyPairsCount ??
          (guarded.info.keyValues && guarded.info.keyValues.length) ??
          0;
        out._meta.tabsOk.info = true;
      } else {
        out.info = null;
        out.info_debug =
          guarded.info_debug ?? {
            reason: "info_extraction_failed",
            surface: null,
          };
        out._meta.tabsOk.info = false;
        out._meta.notes.push(
          "info: guarded extract returned null (see info_debug)",
        );
      }
    } else if (tabKey === "status") {
      const bodyText = await page
        .evaluate(() => document.body.innerText || "")
        .catch(() => "");
      if (
        bodyText.includes("unexpected error") ||
        bodyText.includes("Object reference")
      ) {
        console.warn(`[PGC] Status tab server error for project ${projectID} — skipping`);
        out._meta.notes.push("status: server error page detected");
      } else {
        await target
          .waitForFunction(() => {
            const panel = document.querySelector("#projectStatusTab");
            if (!panel) return false;
            const st = window.getComputedStyle(panel);
            if (st.display === "none" || st.visibility === "hidden") return false;
            const ptxt = (panel.innerText || "").replace(/\s+/g, " ").trim();
            if (ptxt.length < 8) return false;
            if (
              /time with jurisdiction|time with applicant|current non-?completed tasks|for more details|total files|unresolved|department/i.test(
                ptxt,
              )
            ) {
              return true;
            }
            if (panel.querySelector("table tr, dl, ul li, ol li, .ui-iggrid-table tbody tr")) {
              return true;
            }
            return false;
          }, { timeout: 20000 })
          .catch(() => {});
        out.statusTab = await extractStatusTabData(target);
        out._meta.tabsOk.status = true;
      }
    } else if (tabKey === "tasks") {
      out.tasksTab = await extractTasksTabData(target);
      out._meta.tabsOk.tasks = true;
    }
    return nav.url;
  }

  try {
    const permit = normalizeText(project.projectNumber || "");
    pgcProgress.pgcLogProjectOpenStart(String(projectID), permit);
    console.log(
      `[PGC] Opening target project row — ProjectID ${projectID}${permit ? ` (${permit})` : ""}`,
    );
    const initialOpen = await openProjectViaDashboardRow(
      page,
      dashboardUrl,
      String(projectID),
      { projectNumber: permit },
    );
    if (initialOpen.ok) {
      usedRowClick = true;
      if (initialOpen.detailPage) {
        ssoDetailPopup = initialOpen.detailPage;
        page = initialOpen.detailPage;
        out._meta.notes.push(
          "My Projects open: SSO popup (launchRemote) — scraping in popup page",
        );
      }
      out._meta.notes.push(
        `My Projects open → ${initialOpen.url}${initialOpen.via ? ` (${initialOpen.via})` : initialOpen.alreadyOpen ? " (already on detail)" : ""}`,
      );
      console.log("[PGC] Dashboard row open succeeded");
      pgcProgress.pgcLogProjectOpen(permit);
      console.log("[PGC] Project detail URL:", page.url());
      const urlHasProject =
        page.url().includes(`ProjectID=${projectID}`) ||
        page.url().includes(`ProjectID%3D${projectID}`) ||
        page.url().includes(`ProjectID%3d${projectID}`);
      const bodyHasPermit =
        !permit ||
        (await page
          .evaluate(
            (p) =>
              !!(document.body && document.body.innerText && document.body.innerText.includes(p)),
            permit,
          )
          .catch(() => false));
      const tabsHint = await page
        .evaluate(() =>
          !!document.querySelector(
            '[role="tablist"], .ui-tab, a[href*="tab="], [href*="tasksTab"], [href*="infoTab"]',
          ),
        )
        .catch(() => false);
      if (urlHasProject && (bodyHasPermit || tabsHint)) {
        console.log(`[PGC] Project detail page loaded for ${projectID}`);
      } else {
        console.warn(
          "[PGC] Project detail context check — URL has ProjectID:",
          urlHasProject,
          "permit in body:",
          bodyHasPermit,
          "tab chrome present:",
          tabsHint,
        );
      }
    } else {
      console.warn(
        "[PGC] My Projects row open failed upfront:",
        initialOpen.reason || "unknown",
        "— continuing with direct Project/Index navigation",
      );
    }

    await runTab("info");
    await runTab("status");
    await runTab("tasks");

    console.log(
      `[PGC] Detail payload project ${projectID}:`,
      JSON.stringify(
        {
          projectID: out.projectID,
          dashboard: out.dashboard,
          info: out.info,
          info_debug: out.info_debug,
          statusTab: out.statusTab,
          tasksTab: out.tasksTab,
        },
        null,
        2,
      ),
    );
    console.log(
      `[PGC] Detail diagnostics project ${projectID}:`,
      JSON.stringify(
        {
          detailEntryUrl: out._meta.detailEntryUrl,
          tabUrls: out._meta.tabUrls,
          tabsOk: out._meta.tabsOk,
          info_debug: out.info_debug,
          notes: out._meta.notes,
        },
        null,
        2,
      ),
    );

    const anyTab =
      out._meta.tabsOk.info ||
      out._meta.tabsOk.status ||
      out._meta.tabsOk.tasks;
    if (!anyTab) {
      try {
        await page.screenshot({ path: detailFailShot, fullPage: true });
        console.error(`[PGC] Detail screenshot (no tabs): ${detailFailShot}`);
      } catch (_) {}
      return {
        ok: false,
        out,
        error: new Error("No project detail tabs loaded"),
      };
    }

    return { ok: true, out };
  } catch (err) {
    out._meta.notes.push((err && err.message) || String(err));
    try {
      await page.screenshot({ path: detailFailShot, fullPage: true });
      console.error(`[PGC] Detail screenshot: ${detailFailShot}`);
    } catch (_) {}
    console.error(`[PGC] Detail scrape failed project ${projectID}:`, err.message || err);
    return { ok: false, out, error: err };
  } finally {
    try {
      if (ssoDetailPopup && !ssoDetailPopup.isClosed()) {
        await ssoDetailPopup.close();
      }
    } catch (_) {}
  }
}

/**
 * Full harvest for one PGC project (production). Uploads are optional via uploadLocal.
 * @param {import('playwright').Page} page
 * @param {object} proj row from collectAllProjects
 * @param {string[]} bases from resolvePgcWebUiBases
 * @param {string} dashboardUrl
 * @param {{ skipReports?: boolean, skipFiles?: boolean, skipDetail?: boolean, skipWorkflow?: boolean, skipReview?: boolean, uploadLocal?: (localPath: string, storageKey: string) => Promise<string|null>, storagePrefix?: string, recoveryCredentials?: { email: string, password: string, loginUrl?: string, credentialsSource?: string } | null, relaunchBrowserAndRecover?: ((args: { projectID: string, project: object, dashboardUrl: string, reason?: string }) => Promise<import('playwright').Page | null>) | null }} [opts]
 */
async function runPgcProductionPipeline(
  page,
  proj,
  bases,
  dashboardUrl,
  opts = {},
) {
  const skipReports = !!opts.skipReports;
  const skipFiles = !!opts.skipFiles;
  const skipDetail = !!opts.skipDetail;
  const skipWorkflow = !!opts.skipWorkflow;
  const skipReview = !!opts.skipReview;
  const uploadLocal = opts.uploadLocal || null;
  const storagePrefix = (opts.storagePrefix || "pgc").replace(/^\/+|\/+$/g, "");

  pgcProgress.pgcBeginRun({
    projectId: String(proj.projectID || ""),
    projectNumber: normalizeText(proj.projectNumber || ""),
  });

  /** @type {Awaited<ReturnType<typeof scrapeSingleProjectDetails>>} */
  let detailResult = { ok: true, out: null, skipped: true };
  if (!skipDetail) {
    detailResult = await scrapeSingleProjectDetails(
      page,
      proj,
      bases,
      dashboardUrl,
    );
  }

  /** @type {Awaited<ReturnType<typeof resolveWorkflowAndProbeReviews>>} */
  let workflowPack = {
    workflow: {
      wflowInstanceID: null,
      source: "missing",
      wflowInstanceStateName: null,
      instanceName: null,
      workflowName: null,
      rawWorkflowCount: 0,
      tasksDomPattern: null,
      correctionsPrimaryUrl: null,
      taskListUrl: null,
      taskListOk: false,
      userID: null,
    },
    reviewProbe: null,
    correctionsProbeUrl: null,
    correctionsJson: null,
    taskListMeta: null,
  };
  let wfid = null;

  if (!skipWorkflow) {
    workflowPack = await resolveWorkflowAndProbeReviews(
      page,
      proj,
      bases,
      dashboardUrl,
    );
    wfid = workflowPack.workflow?.wflowInstanceID || null;
  }

  /** @type {Awaited<ReturnType<typeof processProjectReviewsAndMarkups>> | object} */
  let reviewOut = {
    skipped: true,
    projectID: String(proj.projectID),
    wflowInstanceID: null,
    reviewGroupsCount: 0,
    rawCorrectionsCount: 0,
    latestCycleCorrectionsCount: 0,
    changemarkCount: 0,
    commentCount: 0,
    unresolvedCount: 0,
    resolvedCount: 0,
    statusCounts: {},
    latestCycleCorrections: [],
    markupArtifacts: [],
    markupPdfUniqueCount: 0,
    markupPdfDownloadedCount: 0,
  };
  if (!skipReview) {
    if (wfid) {
      reviewOut = await processProjectReviewsAndMarkups(page, proj, wfid, {
        preloadedCorrectionsJson: workflowPack.correctionsJson || null,
        preloadedCorrectionsUrl: workflowPack.correctionsProbeUrl || null,
      });
    }
  }

  /** @type {Record<string, string>} */
  const markupPublicByCorrectionId = {};
  if (!skipReview && uploadLocal && reviewOut.markupArtifacts?.length) {
    for (const art of reviewOut.markupArtifacts) {
      if (!art.localPath || !fs.existsSync(art.localPath)) continue;
      try {
        const base = path.basename(art.localPath);
        const url = await uploadLocal(
          art.localPath,
          `${storagePrefix}/markups/${base}`,
        );
        if (url) markupPublicByCorrectionId[art.correctionID] = url;
      } catch (e) {
        console.warn("[PGC] markup upload:", e.message || e);
      }
    }
  }

  if (
    !skipReview &&
    uploadLocal &&
    reviewOut.latestCycleCorrections?.length &&
    Object.keys(markupPublicByCorrectionId).length
  ) {
    for (const c of reviewOut.latestCycleCorrections) {
      const pub = markupPublicByCorrectionId[c.correctionID];
      if (pub) c.markupPdfPublicUrl = pub;
    }
  }

  /** @type {Awaited<ReturnType<typeof harvestProjectFilesAndSampleDownloads>>} */
  let filesOut = {
    projectID: String(proj.projectID),
    foldersCount: 0,
    filesCount: 0,
    sampledDownloadsCount: 0,
    folders: [],
    sampleFiles: [],
    downloadedFiles: [],
    _meta: {
      fileApiFailures: 0,
      largeFilesSkipped: 0,
      downloadAttempts: 0,
      downloadsOk: 0,
      uploadsOk: 0,
      failures: 0,
    },
  };
  if (!skipFiles) {
    filesOut = await harvestProjectFilesAndSampleDownloads(page, proj, {
      dashboardUrl,
      recoveryCredentials: opts.recoveryCredentials || null,
      relaunchBrowserAndRecover: opts.relaunchBrowserAndRecover || null,
    });
  }
  if (!skipFiles && uploadLocal && filesOut.downloadedFiles?.length) {
    for (const d of filesOut.downloadedFiles) {
      if (!d.localPath) continue;
      try {
        const safeName = sanitizeLocalFileName(d.fileName || d.fileID);
        const parentPart = sanitizeLocalFileName(d.parentFolder || "parent");
        const folderPart = sanitizeLocalFileName(d.folderName || "folder");
        const url = await uploadLocal(
          d.localPath,
          `${storagePrefix}/files/${parentPart}/${folderPart}/${d.fileID}_${safeName}`,
        );
        if (url) {
          d.publicUrl = url;
          filesOut._meta.uploadsOk = (filesOut._meta.uploadsOk || 0) + 1;
        } else {
          filesOut._meta.failures = (filesOut._meta.failures || 0) + 1;
        }
      } catch (e) {
        filesOut._meta.failures = (filesOut._meta.failures || 0) + 1;
        console.warn("[PGC] file upload:", e.message || e);
      }
    }
  }
  if (
    !skipFiles &&
    filesOut.folders?.length &&
    filesOut.downloadedFiles?.length
  ) {
    for (const folder of filesOut.folders) {
      for (const f of folder.files || []) {
        const hit = filesOut.downloadedFiles.find((df) => df.fileID === f.fileId);
        if (hit?.publicUrl) {
          f.viewUrl = hit.publicUrl;
          f.publicUrl = hit.publicUrl;
        }
        if (hit?.downloadUrl) {
          f.downloadUrl = hit.downloadUrl;
        }
      }
    }
  }

  /** @type {{ skipped?: boolean, projectID?: string, wflowInstanceID?: string | null, reports?: any[] }} */
  let reportsPayload = { skipped: true, reports: [] };
  if (!skipReports) {
    reportsPayload = await processPgcSsrReportsForProject(page, proj, wfid, {
      dashboardUrl: skipDetail ? dashboardUrl : "",
    });
    if (uploadLocal && reportsPayload.reports?.length) {
      for (const r of reportsPayload.reports) {
        const slug = r.fileSlug || "report";
        try {
          if (r.excelPath && fs.existsSync(r.excelPath)) {
            const u = await uploadLocal(
              r.excelPath,
              `${storagePrefix}/reports/${slug}.xlsx`,
            );
            if (u) r.excelPublicUrl = u;
          }
          if (r.pdfPath && fs.existsSync(r.pdfPath)) {
            const u = await uploadLocal(
              r.pdfPath,
              `${storagePrefix}/reports/${slug}.pdf`,
            );
            if (u) r.pdfPublicUrl = u;
          }
        } catch (e) {
          console.warn("[PGC] report upload:", e.message || e);
        }
      }
    }
  }

  pgcProgress.pgcFinalizeRun(filesOut, proj);

  const _pgcOmitTabs = {
    info: skipDetail,
    status: skipDetail,
    tasks: skipDetail,
    files: skipFiles,
    review: skipReview,
    reports: skipReports,
  };

  return {
    detailResult,
    workflowPack,
    reviewOut,
    filesOut,
    reportsPayload,
    markupPublicByCorrectionId,
    _pgcOmitTabs,
  };
}

async function main() {
  const email = process.env.PGC_EPLAN_EMAIL;
  const password = process.env.PGC_EPLAN_PASSWORD;
  const loginUrl =
    process.env.PGC_EPLAN_LOGIN_URL || PGC_LOGIN_URL_DEFAULT;
  const loginHarnessOnly =
    String(process.env.PGC_LOGIN_ONLY_HARNESS || "").trim() === "1";
  const detailOpenHarnessOnly =
    String(process.env.PGC_DETAIL_OPEN_HARNESS || "").trim() === "1";

  if (!email?.trim() || !password) {
    console.error(
      "Missing credentials. Set PGC_EPLAN_EMAIL and PGC_EPLAN_PASSWORD (see file header).",
    );
    process.exit(1);
  }

  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();

    if (loginHarnessOnly) {
      const harnessResult = await runPgcLoginOnlyHarness(
        page,
        email.trim(),
        password,
        loginUrl,
      );
      console.log(
        "[PGC-HARNESS] Final:",
        harnessResult.status,
        harnessResult.reason || "",
      );
      if (harnessResult.signals) {
        console.log(
          "[PGC-HARNESS] signals:",
          JSON.stringify(harnessResult.signals),
        );
      }
      process.exitCode = harnessResult.ok ? 0 : 1;
      return;
    }

    try {
      await performPgcLogin(page, email.trim(), password, loginUrl, {
        credentialsSource: "cli_harness",
      });
    } catch (err) {
      console.error("[PGC] Login failed:", err.message);
      await pgcScreenshotBestEffort(page, LOGIN_FAIL_SHOT, false);
      console.error("[PGC] Screenshot (if saved):", LOGIN_FAIL_SHOT);
      process.exitCode = 1;
      return;
    }

    await page.waitForURL(/\/Portal\/Home\/Index/i, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page
      .waitForSelector(
        "table tbody tr, .ui-iggrid-table tbody tr, a[href*='ProjectID='], [role='grid'] [role='row']",
        { timeout: 15000 },
      )
      .catch(() => {});
    console.log("[PGC] Skipping redundant Home navigation after successful login");

    try {
      await assertPgcHomeBootstrapped(page);
    } catch (err) {
      console.error("[PGC]", err.message);
      await pgcScreenshotBestEffort(page, LOGIN_FAIL_SHOT, false);
      process.exitCode = 1;
      return;
    }

    if (detailOpenHarnessOnly) {
      const detailRes = await runPgcDetailOpenOnlyHarness(page, {
        dashboardUrl: PGC_DASHBOARD_URL,
        targetPermit:
          process.env.PGC_TARGET_PERMIT || "62227-2024-CIEU",
      });
      console.log(
        "[PGC-DETAIL-HARNESS] Final:",
        detailRes.status,
        detailRes.reason || "",
      );
      process.exitCode = detailRes.ok ? 0 : 1;
      return;
    }

    const landingUrl = page.url();
    console.log("[PGC] Landing URL (dashboard):", landingUrl);

    const struct = await inspectDashboardStructure(page);
    const pagerGuess = await detectPaginationMode(page);
    console.log("[PGC] Pagination — initial detection:", pagerGuess.mode);
    console.log(
      "[PGC] Pagination — View All visible:",
      pagerGuess.viewAllVisible,
    );
    const collection = await collectAllProjects(page, {
      initialMode: pagerGuess.mode,
      viewAllVisible: pagerGuess.viewAllVisible,
      targetPermit: process.env.PGC_TARGET_PERMIT || "62227-2024-CIEU",
    });

    console.log(
      "[PGC] Link pattern histogram (href / launchRemote / onclick / other):",
      collection.linkPatternSummary,
    );

    console.log("[PGC] --- Summary ---");
    console.log("[PGC] Total raw rows scanned (accumulated):", collection.rawRowsScanned);
    console.log(
      "[PGC] Valid rows with projectID (before dedup):",
      collection.validRowsWithProjectId,
    );
    console.log("[PGC] Unique projects (deduped):", collection.uniqueProjectCount);
    console.log(
      "[PGC] Skipped rows (no recoverable projectID):",
      collection.skippedNoProjectId,
    );
    console.log(
      "[PGC] Duplicate row encounters (same projectID):",
      collection.duplicateRowsSkipped,
    );
    console.log("[PGC] Pagination mode (final):", collection.paginationMode);
    console.log("[PGC] Pages visited:", collection.pagesVisited);
    console.log("[PGC] View All clicked:", collection.viewAllClicked);
    console.log(
      "[PGC] Target permit found during paging search:",
      collection.targetFound === true,
    );
    console.log("[PGC] Row selector (structure probe):", struct.rowSelector);

    console.log(
      "[PGC] First 10 projects (sample):",
      JSON.stringify(collection.projects.slice(0, 10), null, 2),
    );

    const n = collection.projects.length;
    console.log(`Found ${n} unique PGC projects`);

    if (collection.projects.length === 0) {
      console.warn(
        "[PGC] Failure hint: no projects with projectID — check for no rows, rows without links, or links without ProjectID in href/onclick.",
      );
    }

    /** Task 4 — sample project detail tabs (Info / Status / Tasks). */
    const detailStats = {
      sampled: 0,
      detailSuccess: 0,
      detailFailed: 0,
      tabsReached: { info: 0, status: 0, tasks: 0 },
      missingTabRuns: { info: 0, status: 0, tasks: 0 },
    };

    /** Task 5 — WFlowInstanceID + corrections API probe (same sample as Task 4). */
    const task5Stats = {
      sampled: 0,
      workflowApiSuccess: 0,
      workflowDomFallback: 0,
      workflowMissing: 0,
      reviewProbeSuccess: 0,
      reviewProbeFailed: 0,
    };

    /** Task 6 — folders / file lists / sample downloads (same sample). */
    const task6Stats = {
      projectsProcessed: 0,
      foldersFound: 0,
      filesFound: 0,
      filesDownloaded: 0,
      largeFilesSkipped: 0,
      fileApiFailures: 0,
    };

    /** Task 7 — corrections normalization + markup PDFs (uses Task 5 WFlowInstanceID). */
    const task7Stats = {
      projectsProcessed: 0,
      skippedNoWorkflow: 0,
      reviewGroupsTotal: 0,
      rawCorrectionsTotal: 0,
      latestCorrectionsTotal: 0,
      uniqueMarkupsTotal: 0,
      markupsDownloadedTotal: 0,
    };

    /** Task 8 — SSRS ReportViewer (Excel + PDF). /project.wflowInstanceID required. */
    const task8Stats = {
      projectsAttempted: 0,
      projectsSkippedNoWf: 0,
      reportsAttempted: 0,
      excelExportsOk: 0,
      pdfExportsOk: 0,
      reportViewerFailures: 0,
      downloadFailures: 0,
    };

    if (collection.projects.length > 0) {
      const beforeDetail = page.url();
      if (!/\/Portal\/Home\/Index/i.test(beforeDetail)) {
        await page.goto(PGC_DASHBOARD_URL, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } else {
        console.log(
          "[PGC] Already on My Projects (Portal/Home/Index); skipping redundant goto before detail scrape",
        );
      }
      await page
        .waitForSelector("table tbody tr, .ui-iggrid-table tbody tr", {
          timeout: 15000,
        })
        .catch(() => {});
      await waitForProjectGrid(page);
      const bases = await resolvePgcWebUiBases(page);
      console.log("[PGC] Task 4 — WebUI base candidates (order tried):", bases);

      const sample = collection.projects.slice(0, DETAIL_SAMPLE_LIMIT);
      detailStats.sampled = sample.length;
      task5Stats.sampled = sample.length;
      console.log(
        `[PGC] Task 4 — detail sample: first ${sample.length} unique project(s) (limit=${DETAIL_SAMPLE_LIMIT})`,
      );

      for (const proj of sample) {
        try {
          const r = await scrapeSingleProjectDetails(
            page,
            proj,
            bases,
            PGC_DASHBOARD_URL,
          );
          const ok = r.ok;
          const t = (r.out && r.out._meta && r.out._meta.tabsOk) || {};
          if (t.info) detailStats.tabsReached.info += 1;
          else detailStats.missingTabRuns.info += 1;
          if (t.status) detailStats.tabsReached.status += 1;
          else detailStats.missingTabRuns.status += 1;
          if (t.tasks) detailStats.tabsReached.tasks += 1;
          else detailStats.missingTabRuns.tasks += 1;
          if (ok) detailStats.detailSuccess += 1;
          else detailStats.detailFailed += 1;
        } catch (e) {
          detailStats.detailFailed += 1;
          detailStats.missingTabRuns.info += 1;
          detailStats.missingTabRuns.status += 1;
          detailStats.missingTabRuns.tasks += 1;
          console.error("[PGC] Task 4 — project detail error (continuing):", e.message || e);
        }

        /** @type {string | null} */
        let wflowIdForReviews = null;
        /** @type {Awaited<ReturnType<typeof resolveWorkflowAndProbeReviews>> | null} */
        let w5Pack = null;
        try {
          w5Pack = await resolveWorkflowAndProbeReviews(
            page,
            proj,
            bases,
            PGC_DASHBOARD_URL,
          );
          const wf = w5Pack.workflow;
          wflowIdForReviews = wf.wflowInstanceID || null;
          if (!wf.wflowInstanceID) task5Stats.workflowMissing += 1;
          else if (wf.source === "tasks_dom")
            task5Stats.workflowDomFallback += 1;
          else task5Stats.workflowApiSuccess += 1;

          if (wf.wflowInstanceID && w5Pack.reviewProbe) {
            if (w5Pack.reviewProbe.ok) task5Stats.reviewProbeSuccess += 1;
            else task5Stats.reviewProbeFailed += 1;
          }
        } catch (wErr) {
          task5Stats.workflowMissing += 1;
          console.error(
            "[PGC] Task 5 — error (continuing):",
            wErr.message || wErr,
          );
        }

        try {
          const t7 = wflowIdForReviews
            ? await processProjectReviewsAndMarkups(
                page,
                proj,
                wflowIdForReviews,
                {
                  preloadedCorrectionsJson: w5Pack?.correctionsJson || null,
                  preloadedCorrectionsUrl: w5Pack?.correctionsProbeUrl || null,
                },
              )
            : {
                skipped: true,
                reviewGroupsCount: 0,
                rawCorrectionsCount: 0,
                latestCycleCorrectionsCount: 0,
                markupPdfUniqueCount: 0,
                markupPdfDownloadedCount: 0,
              };
          task7Stats.projectsProcessed += 1;
          if (t7.skipped) task7Stats.skippedNoWorkflow += 1;
          task7Stats.reviewGroupsTotal += t7.reviewGroupsCount || 0;
          task7Stats.rawCorrectionsTotal += t7.rawCorrectionsCount || 0;
          task7Stats.latestCorrectionsTotal += t7.latestCycleCorrectionsCount || 0;
          task7Stats.uniqueMarkupsTotal += t7.markupPdfUniqueCount || 0;
          task7Stats.markupsDownloadedTotal += t7.markupPdfDownloadedCount || 0;
        } catch (t7Err) {
          task7Stats.projectsProcessed += 1;
          console.error(
            "[PGC] Task 7 — error (continuing):",
            t7Err.message || t7Err,
          );
        }

        try {
          const h = await harvestProjectFilesAndSampleDownloads(page, proj, {
            dashboardUrl: PGC_DASHBOARD_URL,
            recoveryCredentials:
              process.env.PGC_EPLAN_EMAIL && process.env.PGC_EPLAN_PASSWORD
                ? {
                    email: process.env.PGC_EPLAN_EMAIL,
                    password: process.env.PGC_EPLAN_PASSWORD,
                    loginUrl:
                      process.env.PGC_EPLAN_LOGIN_URL?.trim() ||
                      PGC_LOGIN_URL_DEFAULT,
                    credentialsSource: "env_harness",
                  }
                : null,
          });
          task6Stats.projectsProcessed += 1;
          task6Stats.foldersFound += h.foldersCount || 0;
          task6Stats.filesFound += h.filesCount || 0;
          task6Stats.filesDownloaded += h.sampledDownloadsCount || 0;
          task6Stats.largeFilesSkipped += h._meta?.largeFilesSkipped || 0;
          task6Stats.fileApiFailures += h._meta?.fileApiFailures || 0;
        } catch (fErr) {
          task6Stats.projectsProcessed += 1;
          task6Stats.fileApiFailures += 1;
          console.error(
            "[PGC] Task 6 — error (continuing):",
            fErr.message || fErr,
          );
        }

        try {
          const t8 = await processPgcSsrReportsForProject(
            page,
            proj,
            wflowIdForReviews,
          );
          if (t8.skipped) {
            task8Stats.projectsSkippedNoWf += 1;
          } else {
            task8Stats.projectsAttempted += 1;
            for (const r of t8.reports || []) {
              task8Stats.reportsAttempted += 1;
              if (!r.viewerReady) {
                task8Stats.reportViewerFailures += 1;
                continue;
              }
              if (r.excelDownloaded) task8Stats.excelExportsOk += 1;
              else task8Stats.downloadFailures += 1;
              if (r.pdfDownloaded) task8Stats.pdfExportsOk += 1;
              else task8Stats.downloadFailures += 1;
            }
          }
        } catch (t8Err) {
          console.error(
            "[PGC] Task 8 — error (continuing):",
            t8Err.message || t8Err,
          );
        }
      }

      console.log(
        "[PGC] Task 4 — summary:",
        JSON.stringify(detailStats, null, 2),
      );
      console.log(
        "[PGC] Task 5 — summary:",
        JSON.stringify(task5Stats, null, 2),
      );
      console.log(
        "[PGC] Task 6 — summary:",
        JSON.stringify(task6Stats, null, 2),
      );
      console.log(
        "[PGC] Task 7 — summary:",
        JSON.stringify(task7Stats, null, 2),
      );
      console.log(
        "[PGC] Task 8 — summary:",
        JSON.stringify(task8Stats, null, 2),
      );
    }

    console.log("[PGC] Session check — reloading dashboard:", PGC_DASHBOARD_URL);
    await page.goto(PGC_DASHBOARD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector("table tbody tr", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const urlAfter = page.url();
    const titleAfter = (await page.title().catch(() => "")) || "";

    if (
      /\/login/i.test(urlAfter) ||
      /session\s*ended|log\s*in\s*again/i.test(titleAfter)
    ) {
      console.error(
        "[PGC] Session may have expired after second navigation. URL:",
        urlAfter,
        "title:",
        titleAfter,
      );
      process.exitCode = 1;
      return;
    }

    await waitForProjectGrid(page);
    const rowsAfter = (await readProjectRows(page)).rows.length;
    console.log("[PGC] Visible dedup-ready rows after reload (sample read):", rowsAfter);
    console.log("PGC session persisted");
    console.log("[PGC] Final authenticated landing URL:", urlAfter);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[PGC] Fatal:", err);
    process.exit(1);
  });
}

module.exports = {
  normalizeText,
  extractProjectIdFromLink,
  isPgcEplanHost,
  resolvePgcLoginUrl,
  buildPgcTabUrl,
  PGC_DASHBOARD_URL,
  PGC_LOGIN_URL_DEFAULT,
  performPgcLogin,
  runPgcLoginOnlyHarness,
  runPgcDetailOpenOnlyHarness,
  findPgcPermitRowPaginated,
  openPgcDashboardRowWithTrace,
  waitForPgcLoginField,
  assertPgcHomeBootstrapped,
  waitForProjectGrid,
  inspectDashboardStructure,
  detectPaginationMode,
  collectAllProjects,
  readProjectRows,
  resolvePgcWebUiBases,
  runPgcProductionPipeline,
  scrapeSingleProjectDetails,
};
