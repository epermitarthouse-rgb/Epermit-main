"use strict";

/**
 * Development-only Washington DC ProjectDox post-login dashboard diagnostics.
 * Does not change production scrape/discovery logic.
 */

const fs = require("fs");
const path = require("path");

const MAX_HTML_CHARS = 120_000;
const MAX_TEXT_CHARS = 4_000;
const MAX_IFRAMES = 20;
const MAX_NETWORK = 80;
const READY_TIMEOUT_MS = 25_000;
const URL_STABLE_MS = 1_500;
const POLL_MS = 500;

const PERMIT_LIKE =
  /\b(?:B|D|BCIV|COM|COMBUILD|UTB|SIGN|SDP)[A-Z0-9-]{4,}\b/gi;

function isDcDiagnosticsEnabled() {
  const rail = String(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      "",
  ).toLowerCase();
  if (rail === "production" || rail === "prod") return false;
  if (process.env.ALLOW_DC_DIAGNOSTICS === "1") return true;
  if (rail === "development" || rail === "dev") return true;
  return process.env.NODE_ENV !== "production";
}

function redactUrl(u) {
  try {
    const url = new URL(String(u || ""));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(u || "").split("?")[0].slice(0, 240);
  }
}

function summarizeText(text) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > MAX_TEXT_CHARS
    ? `${t.slice(0, MAX_TEXT_CHARS)}…[truncated]`
    : t;
}

function sanitizeHtml(html) {
  let out = String(html || "");
  // Strip scripts/styles and obvious secret-bearing inputs.
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "<!--script removed-->");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "<!--style removed-->");
  out = out.replace(
    /(<input[^>]*\btype=["']?password["']?[^>]*)(value=["'][^"']*["'])/gi,
    "$1 value=\"[redacted]\"",
  );
  out = out.replace(
    /(authorization|access_token|refresh_token|password|passwd|secret)=([^&\s"']+)/gi,
    "$1=[redacted]",
  );
  if (out.length > MAX_HTML_CHARS) {
    out = `${out.slice(0, MAX_HTML_CHARS)}\n<!-- truncated -->`;
  }
  return out;
}

function uniqueStrings(arr, limit = 40) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Bounded readiness wait — diagnostics only.
 * @param {import('playwright').Page} page
 */
async function waitForDashboardReadiness(page) {
  const started = Date.now();
  const result = {
    timedOut: false,
    elapsedMs: 0,
    conditions: {
      urlStable: { ok: false, detail: null },
      networkIdle: { ok: false, detail: null },
      gridOrTableOrIframe: { ok: false, detail: null },
    },
    firstSuccess: null,
  };

  // 1) URL stability
  try {
    let last = page.url();
    let stableSince = Date.now();
    while (Date.now() - started < READY_TIMEOUT_MS) {
      await page.waitForTimeout(POLL_MS);
      const cur = page.url();
      if (cur === last) {
        if (Date.now() - stableSince >= URL_STABLE_MS) {
          result.conditions.urlStable = {
            ok: true,
            detail: redactUrl(cur),
          };
          break;
        }
      } else {
        last = cur;
        stableSince = Date.now();
      }
    }
    if (!result.conditions.urlStable.ok) {
      result.conditions.urlStable = {
        ok: false,
        detail: `unstable_or_timeout last=${redactUrl(page.url())}`,
      };
    }
  } catch (err) {
    result.conditions.urlStable = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 2) network idle (bounded)
  try {
    await page.waitForLoadState("networkidle", {
      timeout: Math.max(2_000, READY_TIMEOUT_MS - (Date.now() - started)),
    });
    result.conditions.networkIdle = { ok: true, detail: "networkidle" };
  } catch (err) {
    result.conditions.networkIdle = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // 3) poll for known indicators (main frame + child frames)
  const indicatorSelector = [
    "#grdProjects",
    "table tbody tr",
    ".ui-iggrid-table tbody tr",
    'a[href*="launchRemote"]',
    'a[href*="ProjectID"]',
    'iframe[src*="avolve"]',
    'iframe[src*="projectdox"]',
    'iframe[src*="Frame.aspx"]',
  ].join(", ");

  while (Date.now() - started < READY_TIMEOUT_MS) {
    try {
      const hit = await page.evaluate((sel) => {
        const main = document.querySelector(sel);
        if (main) {
          return {
            where: "main",
            tag: main.tagName,
            id: main.id || null,
            href: main.getAttribute?.("href") || null,
          };
        }
        return null;
      }, indicatorSelector);
      if (hit) {
        result.conditions.gridOrTableOrIframe = {
          ok: true,
          detail: hit,
        };
        break;
      }

      // Also check whether any iframe exists (even without matching src yet)
      const iframeCount = await page.locator("iframe").count();
      if (iframeCount > 0 && !result.conditions.gridOrTableOrIframe.ok) {
        result.conditions.gridOrTableOrIframe = {
          ok: false,
          detail: `iframes_present_count=${iframeCount}_no_selector_match_yet`,
        };
      }
    } catch (_) {
      /* keep polling */
    }
    await page.waitForTimeout(POLL_MS);
  }

  if (!result.conditions.gridOrTableOrIframe.detail) {
    result.conditions.gridOrTableOrIframe = {
      ok: false,
      detail: "no_grid_table_or_iframe_indicator",
    };
  }

  result.elapsedMs = Date.now() - started;
  result.timedOut = result.elapsedMs >= READY_TIMEOUT_MS - 50;
  result.firstSuccess =
    (result.conditions.urlStable.ok && "urlStable") ||
    (result.conditions.networkIdle.ok && "networkIdle") ||
    (result.conditions.gridOrTableOrIframe.ok && "gridOrTableOrIframe") ||
    null;

  return result;
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 */
async function captureFrameDomStats(frame) {
  return frame.evaluate(() => {
    const q = (sel) => document.querySelectorAll(sel).length;
    const text = (document.body && document.body.innerText) || "";
    const permitLike = Array.from(
      text.matchAll(
        /\b(?:B|D|BCIV|COM|COMBUILD|UTB|SIGN|SDP)[A-Z0-9-]{4,}\b/gi,
      ),
    ).map((m) => m[0]);
    const launchHrefs = Array.from(
      document.querySelectorAll('a[href*="launchRemote"]'),
    )
      .slice(0, 15)
      .map((a) => (a.getAttribute("href") || "").slice(0, 160));
    const projectIdHrefs = Array.from(
      document.querySelectorAll('a[href*="ProjectID"]'),
    )
      .slice(0, 15)
      .map((a) => (a.getAttribute("href") || "").slice(0, 160));
    return {
      url: location.href,
      title: document.title || "",
      counts: {
        grdProjects: q("#grdProjects"),
        tables: q("table"),
        tr: q("tr"),
        launchRemoteAnchors: q('a[href*="launchRemote"]'),
        projectIdAnchors: q('a[href*="ProjectID"]'),
        iframes: q("iframe"),
      },
      sampleLaunchHrefs: launchHrefs,
      sampleProjectIdHrefs: projectIdHrefs,
      permitLikeSample: Array.from(new Set(permitLike)).slice(0, 30),
      bodyTextLength: text.length,
      bodyTextSummary: text.replace(/\s+/g, " ").trim().slice(0, 1500),
    };
  });
}

/**
 * Lightweight page snapshot (no readiness wait / artifacts).
 * @param {import('playwright').Page} page
 * @param {{ label?: string }} [opts]
 */
async function captureLightPageSnapshot(page, opts = {}) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const ready = await page
    .evaluate(() => document.readyState)
    .catch(() => "unknown");
  let counts = null;
  let bodyTextSummary = "";
  let permitLikeSample = [];
  try {
    const stats = await captureFrameDomStats(page.mainFrame());
    counts = stats.counts;
    bodyTextSummary = summarizeText(stats.bodyTextSummary || "").slice(0, 800);
    permitLikeSample = stats.permitLikeSample || [];
  } catch (err) {
    counts = { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    label: opts.label || null,
    url: redactUrl(url),
    title,
    documentReadyState: ready,
    iframeCount: Math.max(0, page.frames().length - 1),
    counts,
    permitLikeSample: permitLikeSample.slice(0, 20),
    bodyTextSummary,
    hints: {
      looksLikeAvolveHost: /avolvecloud\.com/i.test(url),
      looksLikeProjectDoxWebUi: /projectdoxwebui/i.test(url),
      looksLikeLoginOrIdp:
        /b2clogin|okta\.com|login|signin|authorize/i.test(url),
      looksLikePlanReview: /planreview\.dob\.dc\.gov/i.test(url),
      looksLikeUserOrHome: /\/User\/|\/Home\//i.test(url),
    },
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ permitNumber?: string, artifactDir: string, runId: string }} opts
 */
async function captureDcDashboardDiagnostics(page, opts) {
  const permitNumber = String(opts.permitNumber || "").trim();
  const artifactDir = opts.artifactDir;
  const runId = opts.runId;
  fs.mkdirSync(artifactDir, { recursive: true });

  const redirectHistory = [];
  const onFrameNav = (frame) => {
    if (frame !== page.mainFrame()) return;
    redirectHistory.push({
      at: new Date().toISOString(),
      url: redactUrl(frame.url()),
    });
  };
  page.on("framenavigated", onFrameNav);

  const networkHits = [];
  const onResponse = async (response) => {
    try {
      const req = response.request();
      const u = req.url();
      const rt = req.resourceType();
      if (!["xhr", "fetch", "document"].includes(rt)) return;
      const lower = u.toLowerCase();
      if (
        !/project|dashboard|grid|permit|avolve|projectdox|home\/index|user\/index|grdprojects|launchremote|planreview|dob\.dc\.gov|api\//i.test(
          lower,
        )
      ) {
        return;
      }
      networkHits.push({
        status: response.status(),
        method: req.method(),
        resourceType: rt,
        url: redactUrl(u),
      });
    } catch (_) {
      /* ignore */
    }
  };
  page.on("response", onResponse);

  // Snapshot at the moment production discovery would typically start
  // (immediately after login / optional dashboard return — before readiness wait).
  let preReadiness = null;
  try {
    const preUrl = page.url();
    const preReady = await page
      .evaluate(() => document.readyState)
      .catch(() => "unknown");
    const preMain = await captureFrameDomStats(page.mainFrame()).catch(
      (err) => ({
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    const preIframeCount = Math.max(0, page.frames().length - 1);
    preReadiness = {
      url: redactUrl(preUrl),
      documentReadyState: preReady,
      iframeCount: preIframeCount,
      counts: preMain?.counts || null,
      permitLikeSample: preMain?.permitLikeSample || [],
      likelyEmptyForLegacyDiscovery:
        !preMain?.counts ||
        ((preMain.counts.grdProjects || 0) === 0 &&
          (preMain.counts.launchRemoteAnchors || 0) === 0 &&
          (preMain.counts.projectIdAnchors || 0) === 0 &&
          (preMain.counts.tr || 0) < 2),
    };
  } catch (err) {
    preReadiness = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const readiness = await waitForDashboardReadiness(page);

  // Stop listening before heavy captures
  page.off("framenavigated", onFrameNav);
  page.off("response", onResponse);

  const finalUrl = page.url();
  const title = await page.title().catch(() => "");
  const stillLoading = await page
    .evaluate(() => document.readyState)
    .catch(() => "unknown");

  const frames = page.frames();
  const iframeSummaries = [];
  for (const frame of frames.slice(0, MAX_IFRAMES)) {
    let frameTitle = "";
    try {
      frameTitle = await frame.title();
    } catch (_) {
      frameTitle = "(unavailable)";
    }
    let stats = null;
    try {
      stats = await captureFrameDomStats(frame);
    } catch (err) {
      stats = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
    iframeSummaries.push({
      name: frame.name() || null,
      url: redactUrl(frame.url()),
      title: frameTitle,
      isMain: frame === page.mainFrame(),
      stats,
    });
  }

  const mainStats =
    iframeSummaries.find((f) => f.isMain)?.stats ||
    (await captureFrameDomStats(page.mainFrame()).catch((err) => ({
      error: err instanceof Error ? err.message : String(err),
    })));

  const htmlRaw = await page.content().catch(() => "");
  const htmlSanitized = sanitizeHtml(htmlRaw);
  const htmlPath = path.join(artifactDir, `${runId}-dom.html`);
  fs.writeFileSync(htmlPath, htmlSanitized, "utf8");

  const screenshotPath = path.join(artifactDir, `${runId}-viewport.png`);
  await page
    .screenshot({ path: screenshotPath, fullPage: false })
    .catch(() => null);

  const allPermitLikes = uniqueStrings(
    iframeSummaries.flatMap((f) => f.stats?.permitLikeSample || []),
    50,
  );

  const targetPermitVisible = permitNumber
    ? allPermitLikes.some(
        (p) => p.toUpperCase() === permitNumber.toUpperCase(),
      )
    : null;

  return {
    permitNumber: permitNumber || null,
    capturedAt: new Date().toISOString(),
    finalUrl: redactUrl(finalUrl),
    pageTitle: title,
    documentReadyState: stillLoading,
    redirectHistory: redirectHistory.slice(-30),
    preReadiness,
    readiness,
    expectedDashboardHints: {
      looksLikeAvolveHost: /avolvecloud\.com/i.test(finalUrl),
      looksLikeProjectDoxWebUi: /projectdoxwebui/i.test(finalUrl),
      looksLikeLoginOrIdp:
        /b2clogin|okta\.com|login|signin|authorize/i.test(finalUrl),
      looksLikeUserOrHome: /\/User\/|\/Home\//i.test(finalUrl),
    },
    mainFrame: mainStats,
    frames: iframeSummaries.map((f) => ({
      name: f.name,
      url: f.url,
      title: f.title,
      isMain: f.isMain,
      counts: f.stats?.counts || null,
      permitLikeSample: f.stats?.permitLikeSample || [],
      error: f.stats?.error || null,
    })),
    iframeCount: Math.max(0, frames.length - 1),
    aggregateCounts: (() => {
      const agg = {
        grdProjects: 0,
        tables: 0,
        tr: 0,
        launchRemoteAnchors: 0,
        projectIdAnchors: 0,
        iframesInDom: 0,
      };
      for (const f of iframeSummaries) {
        const c = f.stats?.counts;
        if (!c) continue;
        agg.grdProjects += c.grdProjects || 0;
        agg.tables += c.tables || 0;
        agg.tr += c.tr || 0;
        agg.launchRemoteAnchors += c.launchRemoteAnchors || 0;
        agg.projectIdAnchors += c.projectIdAnchors || 0;
        agg.iframesInDom += c.iframes || 0;
      }
      return agg;
    })(),
    permitLikeSample: allPermitLikes,
    targetPermitVisible,
    networkProjectishRequests: networkHits.slice(0, MAX_NETWORK),
    artifacts: {
      htmlPath,
      screenshotPath,
      htmlBytes: Buffer.byteLength(htmlSanitized, "utf8"),
    },
  };
}

module.exports = {
  isDcDiagnosticsEnabled,
  waitForDashboardReadiness,
  captureDcDashboardDiagnostics,
  captureLightPageSnapshot,
  redactUrl,
  summarizeText,
};
