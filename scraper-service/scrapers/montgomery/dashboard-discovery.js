/**
 * Montgomery County Avolve ProjectDox — dashboard (Home/Index) project discovery on the MAIN document only.
 * Row opens use javascript:launchRemote('Frame.aspx?...ProjectID=…') → /login/sso?url=… → WebUI.
 */

function montgomeryPopupUrlIsSsoBridge(url) {
  return !!url && /\/login\/sso/i.test(String(url));
}

function montgomeryProjectDetailEntryUrlOk(url, projectId) {
  const pid = String(projectId || "").trim();
  if (!url || !pid) return false;
  if (montgomeryPopupUrlIsSsoBridge(url)) return false;
  const hasPid =
    url.includes(`ProjectID=${pid}`) ||
    url.includes(`ProjectID%3D${pid}`) ||
    url.includes(`ProjectID%3d${pid}`);
  if (!hasPid) return false;
  return (
    /\/Project\/Index/i.test(url) ||
    /Frame\.aspx/i.test(url) ||
    /WebForms\/Frame\.aspx/i.test(url)
  );
}

/**
 * @param {import('playwright').Page} popup
 * @param {string} projectId
 * @param {string} permitNorm
 */
async function montgomeryPopupHasRealProjectDetail(popup, projectId, permitNorm) {
  const pid = String(projectId || "").trim();
  const u = String(popup.url() || "");
  if (montgomeryProjectDetailEntryUrlOk(u, pid)) return true;
  const leftSso = !montgomeryPopupUrlIsSsoBridge(u);
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
  return leftSso || dom.tabs || dom.permitHit || dom.idInBody;
}

/**
 * @param {import('playwright').Page} popup
 * @param {string} projectId
 * @param {string} permitNorm
 */
async function montgomeryWaitPopupProjectDetailReady(popup, projectId, permitNorm) {
  const deadline = Date.now() + 90000;
  let lastLoggedUrl = "";
  while (Date.now() < deadline) {
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const u = popup.url();
    if (u && u !== lastLoggedUrl && u !== "about:blank") {
      lastLoggedUrl = u;
      console.log("[Montgomery][discovery] popup navigate:", u);
    }
    if (await montgomeryPopupHasRealProjectDetail(popup, projectId, permitNorm)) {
      return true;
    }
    await popup.waitForTimeout(400).catch(() => {});
  }
  return false;
}

/** @param {string} fromUrl */
function montgomeryHomeIndexUrl(fromUrl) {
  if (!fromUrl) return "";
  try {
    const u = new URL(fromUrl);
    if (!/montgomeryco-md-us\.avolvecloud\.com/i.test(u.hostname)) return "";
    return `${u.origin}/Home/Index`;
  } catch (_) {
    return "";
  }
}

/**
 * Normalize configured portal URL to a discovery target: never use Login/Index as the goto target.
 * @param {string} dashboardUrl
 */
function montgomeryEffectiveDashboardGotoUrl(dashboardUrl) {
  const raw = String(dashboardUrl || "").trim().replace(/\/+$/, "");
  if (
    /montgomeryco-md-us\.avolvecloud\.com/i.test(raw) &&
    /\/Login\//i.test(raw)
  ) {
    const h = montgomeryHomeIndexUrl(raw);
    return h || raw;
  }
  return raw;
}

/**
 * True when URL is Montgomery portal app shell (not Login). Discovery may run on Home/Index or ProjectDox entry.
 * @param {string} url
 */
function montgomeryPathOkForDashboardReadiness(url) {
  const u = String(url || "");
  if (!/montgomeryco-md-us\.avolvecloud\.com/i.test(u)) return false;
  if (/\/Login\//i.test(u)) return false;
  if (/\/Home\/Index/i.test(u)) return true;
  if (/\/ProjectDox\/index\.html/i.test(u)) return true;
  if (/\/ProjectDox\//i.test(u) && !/\/Login\//i.test(u)) return true;
  return false;
}

/**
 * After auth, try saved portal URL first (e.g. ProjectDox/index.html), then Home/Index — raw /Home/Index may 302 to Login if cookies expect app entry first.
 * @param {string} configuredDashboardUrl
 */
function montgomeryPortalNavigationCandidates(configuredDashboardUrl) {
  const s = String(configuredDashboardUrl || "").trim().replace(/\/+$/, "");
  const out = [];
  let origin = "";
  try {
    const u = new URL(
      s || "https://montgomeryco-md-us.avolvecloud.com/",
    );
    origin = /montgomeryco-md-us\.avolvecloud\.com/i.test(u.hostname)
      ? u.origin
      : "https://montgomeryco-md-us.avolvecloud.com";
  } catch (_) {
    origin = "https://montgomeryco-md-us.avolvecloud.com";
  }
  if (s && /montgomeryco-md-us\.avolvecloud\.com/i.test(s) && !/\/Login\//i.test(s)) {
    out.push(s);
  }
  const home = `${origin}/Home/Index`;
  const pdx = `${origin}/ProjectDox/index.html`;
  if (!out.includes(home)) out.push(home);
  if (!out.includes(pdx)) out.push(pdx);
  return [...new Set(out)];
}

/**
 * Main-frame snapshot for Montgomery Home/Index readiness (discovery must not run on Login/Index).
 * Content is read from the main document only (child frames ignored).
 * @param {import('playwright').Page} page
 */
async function montgomeryDashboardReadinessSnapshot(page) {
  let url = "";
  try {
    url = page.url();
  } catch (_) {}
  const hostOk = /montgomeryco-md-us\.avolvecloud\.com/i.test(url);
  const pathOk = montgomeryPathOkForDashboardReadiness(url);
  const dom = await page
    .evaluate(() => {
      const body = (document.body && document.body.innerText) || "";
      const html =
        (document.documentElement && document.documentElement.innerHTML) || "";
      const hasPdx = /ProjectDox\s+Dashboard/i.test(body);
      const hasMy = /My Projects/i.test(body);
      const hasOpen = /\bOpen\b/i.test(body);
      const hasDownloadFiles = /Download Files/i.test(body);
      const hasLaunch =
        !!document.querySelector('a[href*="launchRemote"]') ||
        html.includes("launchRemote(");
      const hasFramePid =
        (/Frame\.aspx/i.test(html) && /ProjectID=/i.test(html)) ||
        /Frame\.aspx\?[^"']*ProjectID=\d+/i.test(html);
      let projectLikeRows = 0;
      const permitRe = /\b[A-Z]{2,}[A-Z0-9]+-\d{3,}\b/;
      document
        .querySelectorAll(
          'table tbody tr, .ui-iggrid-table tbody tr, [role="row"]',
        )
        .forEach((tr) => {
          if (tr.closest("thead")) return;
          const t = (tr.textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 2 && t.length < 800 && permitRe.test(t))
            projectLikeRows += 1;
        });
      const hasGridOrTable = !!document.querySelector(
        'table tbody, .ui-iggrid-table tbody, [role="grid"], .ui-iggrid',
      );
      const tbodyTrCount = document.querySelectorAll(
        "table tbody tr, .ui-iggrid-table tbody tr",
      ).length;
      return {
        hasPdx,
        hasMy,
        hasOpen,
        hasDownloadFiles,
        hasLaunch,
        hasFramePid,
        projectLikeRows,
        hasGridOrTable,
        tbodyTrCount,
      };
    })
    .catch(() => ({
      hasPdx: false,
      hasMy: false,
      hasOpen: false,
      hasDownloadFiles: false,
      hasLaunch: false,
      hasFramePid: false,
      projectLikeRows: 0,
      hasGridOrTable: false,
      tbodyTrCount: 0,
    }));
  return { url, hostOk, pathOk, ...dom };
}

/**
 * OR-based readiness: must be on Montgomery app path (not Login); then any practical dashboard signal.
 * @returns {{ ok: boolean, reason: string, snap: object }}
 */
function montgomeryDiscoveryReadinessEval(snap) {
  if (!snap.hostOk || !snap.pathOk) {
    return { ok: false, reason: "not_app_path_or_login", snap };
  }
  if (snap.hasLaunch) {
    return { ok: true, reason: "launchRemote", snap };
  }
  if (snap.hasFramePid) {
    return { ok: true, reason: "frame.aspx+ProjectID", snap };
  }
  if (snap.projectLikeRows >= 1) {
    return {
      ok: true,
      reason: `permit_like_rows(${snap.projectLikeRows})`,
      snap,
    };
  }
  if (snap.hasMy) {
    return { ok: true, reason: "my_projects", snap };
  }
  if (snap.hasOpen) {
    return { ok: true, reason: "open", snap };
  }
  if (snap.hasDownloadFiles) {
    return { ok: true, reason: "download_files", snap };
  }
  if (snap.hasGridOrTable && snap.tbodyTrCount >= 1) {
    return { ok: true, reason: `tbody_tr(${snap.tbodyTrCount})`, snap };
  }
  if (snap.hasGridOrTable) {
    return { ok: true, reason: "grid_or_table", snap };
  }
  if (snap.hasPdx) {
    return { ok: true, reason: "projectdox_dashboard", snap };
  }
  return { ok: false, reason: "no_signals", snap };
}

function montgomeryReadinessLogLine(prefix, ev) {
  const s = ev.snap;
  console.log(
    `${prefix} accept=${ev.reason} url=${s.url} myProjects=${s.hasMy} open=${s.hasOpen} downloadFiles=${s.hasDownloadFiles} launchRemote=${s.hasLaunch} frameProjectID=${s.hasFramePid} permitRows=${s.projectLikeRows} tbodyTr=${s.tbodyTrCount} grid=${s.hasGridOrTable} pdxDash=${s.hasPdx}`,
  );
}

/**
 * After Avolve auth, wait for real Home/Index or navigate there once. Discovery runs only when readiness passes.
 * @param {import('playwright').Page} page
 * @param {string} configuredDashboardUrl — saved portal URL (may still be Login/Index)
 */
async function ensureMontgomeryPostLoginDashboard(page, configuredDashboardUrl) {
  const cfg = String(configuredDashboardUrl || "").trim();
  let afterFlowUrl = "";
  try {
    afterFlowUrl = page.url();
  } catch (_) {}
  console.log(
    `[Montgomery][post-login] URL after credential flow: ${afterFlowUrl}`,
  );

  const tryReadiness = async () => {
    const snap = await montgomeryDashboardReadinessSnapshot(page);
    return montgomeryDiscoveryReadinessEval(snap);
  };

  const t0 = Date.now();
  while (Date.now() - t0 < 22000) {
    const ev = await tryReadiness();
    if (ev.ok) {
      montgomeryReadinessLogLine(
        "[Montgomery][post-login] dashboard (no fallback)",
        ev,
      );
      console.log(
        `[Montgomery][post-login] final URL for discovery: ${ev.snap.url}`,
      );
      return ev.snap.url;
    }
    await page.waitForTimeout(450).catch(() => {});
  }

  const candidates = montgomeryPortalNavigationCandidates(cfg);
  console.log(
    `[Montgomery][post-login] auto dashboard wait exhausted; navigation tries: ${candidates.join(" | ")}`,
  );

  let lastEv = /** @type {{ ok: boolean, reason: string, snap: object } | null} */ (
    null
  );
  for (let ci = 0; ci < candidates.length; ci++) {
    const target = candidates[ci];
    console.log(
      `[Montgomery][post-login] goto ${ci + 1}/${candidates.length}: ${target}`,
    );
    try {
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e) {
      console.warn(
        "[Montgomery][post-login] goto error:",
        (e && e.message) || e,
      );
      continue;
    }
    await page.waitForLoadState("load").catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 18000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
    let afterGoto = "";
    try {
      afterGoto = page.url();
      console.log(`[Montgomery][post-login] URL after goto: ${afterGoto}`);
    } catch (_) {}
    if (/\/Login\//i.test(afterGoto)) {
      console.log(
        "[Montgomery][post-login] server kept Login URL after goto (session may not allow this path); next candidate if any",
      );
    }

    const t1 = Date.now();
    while (Date.now() - t1 < 22000) {
      lastEv = await tryReadiness();
      if (lastEv.ok) {
        try {
          console.log(
            `[Montgomery][post-login] URL after navigation settle: ${page.url()}`,
          );
        } catch (_) {}
        montgomeryReadinessLogLine(
          "[Montgomery][post-login] dashboard (after navigation)",
          lastEv,
        );
        console.log(
          `[Montgomery][post-login] final URL for discovery: ${lastEv.snap.url}`,
        );
        return lastEv.snap.url;
      }
      await page.waitForTimeout(500).catch(() => {});
    }
  }

  let stuckLogin = false;
  try {
    stuckLogin = /\/Login\//i.test(page.url());
  } catch (_) {}
  if (lastEv && lastEv.snap) {
    const s = lastEv.snap;
    console.log(
      `[Montgomery][post-login] readiness exhausted; last url=${s.url} pathOk=${s.pathOk} myProjects=${s.hasMy} open=${s.hasOpen} downloadFiles=${s.hasDownloadFiles} launchRemote=${s.hasLaunch} frameProjectID=${s.hasFramePid} permitRows=${s.projectLikeRows} tbodyTr=${s.tbodyTrCount} grid=${s.hasGridOrTable} pdxDash=${s.hasPdx}`,
    );
  }
  if (stuckLogin) {
    throw new Error(
      "Montgomery post-login: still on Login after navigation tries — /Home/Index likely redirects without an app entry session; confirm credentials or portal URL (use ProjectDox/index.html if that is your normal entry).",
    );
  }
  throw new Error(
    "Montgomery post-login: dashboard not ready (no signals on allowed app paths after navigation retries)",
  );
}

/**
 * Ensure we are on the portal Home/Index and My Projects / launchRemote is visible (main frame only).
 * @param {import('playwright').Page} page
 * @param {string} dashboardUrl
 */
async function waitForMontgomeryDashboardReady(page, dashboardUrl) {
  const wantRaw = String(dashboardUrl || "").trim().replace(/\/+$/, "");
  const want = montgomeryEffectiveDashboardGotoUrl(wantRaw);
  let cur = "";
  try {
    cur = page.url();
  } catch (_) {}
  const onDash =
    /montgomeryco-md-us\.avolvecloud\.com/i.test(cur) &&
    montgomeryPathOkForDashboardReadiness(cur);
  if (want && !onDash) {
    try {
      await page.goto(want, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (_) {}
  }
  await page.waitForTimeout(400);
  await Promise.race([
    page.waitForSelector('a[href*="launchRemote"]', { timeout: 24000 }),
    page.getByText("My Projects", { exact: false }).first().waitFor({ timeout: 24000 }),
  ]).catch(() => {});
}

/** @see pgc-eplan-scraper MAX_PAGER_PAGES */
const MAX_MONTGOMERY_DISCOVERY_PAGES = 25;

/**
 * Infragistics `grdProjects` paging + row fingerprint (AJAX; URL unchanged).
 * @param {import('playwright').Page} page
 */
async function readMontgomeryGrdProjectsPagingSnapshot(page) {
  return page.evaluate(() => {
    const grid = document.getElementById("grdProjects");
    const labelEl = document.getElementById("grdProjects_pager_label");
    const pagerLabel = labelEl
      ? String(labelEl.textContent || "").replace(/\s+/g, " ").trim()
      : "";

    const pager =
      document.getElementById("grdProjects_pager") ||
      grid?.closest(".ui-iggrid")?.querySelector(".ui-iggrid-paging") ||
      grid?.parentElement?.querySelector(".ui-iggrid-paging");

    let currentPage = 1;
    const curEl =
      pager?.querySelector(".ui-iggrid-pagelinkcurrent") ||
      grid?.querySelector(".ui-iggrid-pagelinkcurrent");
    if (curEl) {
      const t = (curEl.textContent || "").trim();
      if (/^\d+$/.test(t)) currentPage = parseInt(t, 10);
    }

    /** @type {{ start: number, end: number, total: number } | null} */
    let range = null;
    const rm = pagerLabel.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
    if (rm) {
      range = { start: +rm[1], end: +rm[2], total: +rm[3] };
      const pageSize = range.end - range.start + 1;
      if (
        pageSize > 0 &&
        (!curEl || !/^\d+$/.test((curEl.textContent || "").trim()))
      ) {
        currentPage = Math.floor((range.start - 1) / pageSize) + 1;
      }
    }

    const ids = [];
    let firstPermit = "";
    let rowCount = 0;
    if (grid) {
      const trs = grid.querySelectorAll(
        ".ui-iggrid-table tbody tr, table tbody tr",
      );
      for (const tr of trs) {
        if (tr.closest("thead")) continue;
        rowCount++;
        const a = tr.querySelector(
          'a[href^="javascript:"], a[href*="launchRemote"], a[href*="Frame.aspx"]',
        );
        if (rowCount === 1 && a) {
          firstPermit = String(a.textContent || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const cells = tr.querySelectorAll("td, [role='gridcell']");
          if (!firstPermit || firstPermit.length < 2) {
            firstPermit = String(cells[0]?.textContent || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          }
        }
        const href = a?.getAttribute("href") || "";
        const raw = String(href).replace(/%27/g, "'").replace(/%22/g, '"');
        const lr = raw.match(/launchRemote\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
        const payload = lr ? lr[1] : raw;
        let decoded = payload;
        try {
          decoded = decodeURIComponent(payload);
        } catch (_) {}
        const m =
          decoded.match(/ProjectID=(\d+)/i) ||
          payload.match(/ProjectID=(\d+)/i) ||
          decoded.match(/ProjectID%3D(\d+)/i);
        if (m) ids.push(m[1]);
      }
    }

    return {
      hasGrid: !!grid,
      pagerLabel,
      currentPage,
      range,
      rowCount,
      firstPermit,
      rowSignature: [...ids].sort().join(","),
    };
  });
}

/**
 * Click igGrid page N or Next; wait until label / rows / current page indicator change.
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof readMontgomeryGrdProjectsPagingSnapshot>>} beforeSnap
 */
async function advanceMontgomeryGrdProjectsPage(page, beforeSnap) {
  const wantPage = beforeSnap.currentPage + 1;
  console.log(
    `[Montgomery][grdProjects] pager click → dashboard page ${wantPage} (was ${beforeSnap.currentPage}) label="${beforeSnap.pagerLabel}" gridRows=${beforeSnap.rowCount} firstPermit=${beforeSnap.firstPermit || "n/a"}`,
  );

  const pager = page.locator("#grdProjects_pager").first();
  let clicked = false;

  if ((await pager.count()) > 0) {
    const byRole = pager
      .getByRole("link", { name: new RegExp(`^\\s*${wantPage}\\s*$`) })
      .first();
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.click({ timeout: 12000 });
      clicked = true;
    } else {
      const numLink = pager
        .locator("a.ui-iggrid-pagelink, .ui-iggrid-pagelink")
        .filter({ hasText: new RegExp(`^\\s*${wantPage}\\s*$`) })
        .first();
      if (await numLink.isVisible().catch(() => false)) {
        await numLink.click({ timeout: 12000 });
        clicked = true;
      }
    }
  }

  if (!clicked) {
    const nextLoc = page
      .locator(
        "#grdProjects_pager .ui-iggrid-nextpage:not(.ui-state-disabled), #grdProjects_pager .ui-iggrid-paging-next:not(.ui-state-disabled)",
      )
      .first();
    if (await nextLoc.isVisible().catch(() => false)) {
      await nextLoc.click({ timeout: 12000 });
      clicked = true;
    }
  }

  if (!clicked) {
    const fallback = page
      .locator(".ui-iggrid-paging .ui-iggrid-nextpage:not(.ui-state-disabled)")
      .first();
    if (await fallback.isVisible().catch(() => false)) {
      await fallback.click({ timeout: 12000 });
      clicked = true;
    }
  }

  if (!clicked) {
    console.log("[Montgomery][grdProjects] no pager control matched for advance");
    return false;
  }

  const prev = { ...beforeSnap };
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(220);
    const snap = await readMontgomeryGrdProjectsPagingSnapshot(page);
    if (
      snap.pagerLabel !== prev.pagerLabel ||
      snap.rowSignature !== prev.rowSignature ||
      snap.firstPermit !== prev.firstPermit ||
      snap.currentPage !== prev.currentPage
    ) {
      console.log(
        `[Montgomery][grdProjects] grid refreshed dashboard page=${snap.currentPage} label="${snap.pagerLabel}" rows=${snap.rowCount} firstPermit=${snap.firstPermit || "n/a"} sig=${snap.rowSignature.slice(0, 72)}`,
      );
      return true;
    }
  }

  console.warn(
    "[Montgomery][grdProjects] timeout waiting for AJAX grid refresh after pager click",
  );
  return false;
}

/**
 * One DOM snapshot of the My Projects grid (current page only).
 * When `#grdProjects` exists, only rows inside it are used (avoids extra DOM noise).
 * @param {import('playwright').Page} page
 */
async function collectMontgomeryDashboardProjectsFromDom(page) {
  return page.evaluate(() => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function parsePidFromHref(href) {
      if (!href) return "";
      const raw = String(href).replace(/%27/g, "'").replace(/%22/g, '"');
      const lr = raw.match(/launchRemote\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
      const payload = lr ? lr[1] : raw;
      let decoded = payload;
      try {
        decoded = decodeURIComponent(payload);
      } catch (_) {}
      const m =
        decoded.match(/ProjectID=(\d+)/i) ||
        payload.match(/ProjectID=(\d+)/i) ||
        decoded.match(/ProjectID%3D(\d+)/i) ||
        payload.match(/ProjectID%3D(\d+)/i);
      return m ? m[1] : "";
    }

    function rowTextCells(tr) {
      const cells = tr.querySelectorAll("td, th, [role='gridcell']");
      return Array.from(cells).map((c) => norm(c.textContent));
    }

    const out = [];
    const seen = new Set();

    function push(projNum, pid, desc, loc, status, href) {
      if (!pid && !projNum) return;
      const key = pid || projNum;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: pid || projNum,
        name: projNum || pid,
        projectNum: projNum || "",
        projectId: pid,
        description: desc || "",
        location: loc || "",
        status: status || "",
        tasks: "",
        href: href || "",
      });
    }

    const gridRoot = document.querySelector("#grdProjects");
    const rowSelectors = gridRoot
      ? "table tbody tr, .ui-iggrid-table tbody tr, [role='row']"
      : "table tbody tr, table tr, .ui-iggrid-table tbody tr, [role='row']";
    const root = gridRoot || document.body;

    root.querySelectorAll(rowSelectors).forEach((tr) => {
      if (tr.closest("thead")) return;
      if (gridRoot && !gridRoot.contains(tr)) return;
      const anchors = tr.querySelectorAll(
        'a[href^="javascript:"], a[href*="Frame.aspx"]',
      );
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (!/launchRemote|Frame\.aspx/i.test(href)) continue;
        const pid = parsePidFromHref(href);
        if (!pid) continue;
        const texts = rowTextCells(tr);
        let permit = norm(a.textContent);
        if (!permit || permit.length < 3) permit = texts[0] || "";
        const desc = texts[1] || "";
        const loc = texts[2] || "";
        const status = texts[3] || texts[4] || "";
        push(permit, pid, desc, loc, status, href);
        break;
      }
    });

    const linkRoot = gridRoot || document;
    linkRoot.querySelectorAll('a[href*="launchRemote"]').forEach((a) => {
      if (gridRoot && !gridRoot.contains(a)) return;
      const href = a.getAttribute("href") || "";
      const pid = parsePidFromHref(href);
      if (!pid) return;
      let permit = norm(a.textContent);
      if (!permit) {
        let el = a.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          const row = el.closest("tr, [role='row'], .ui-iggrid-row");
          if (row) {
            const tc = rowTextCells(row);
            if (tc[0] && tc[0].length >= 3) {
              permit = tc[0];
              break;
            }
          }
          el = el.parentElement;
        }
      }
      push(permit || pid, pid, "", "", "", href);
    });

    return out;
  });
}

/**
 * Legacy discovery when `#grdProjects` is absent — uses shared PGC pager heuristics.
 * @param {import('playwright').Page} page
 */
async function collectMontgomeryDashboardProjectsLegacyPager(page) {
  const pgc = require("../../pgc-eplan-scraper");
  const pagerGuess = await pgc.detectPaginationMode(page);
  let paginationMode = pagerGuess.mode;
  if (paginationMode === "view_all") paginationMode = "next_button";

  /** @type {Map<string, object>} */
  const uniqueByKey = new Map();
  let lastSignature = "";
  let advancedPastFirstPage = false;

  for (let i = 0; i < MAX_MONTGOMERY_DISCOVERY_PAGES; i++) {
    const pageNum = i + 1;
    let slice = await collectMontgomeryDashboardProjectsFromDom(page);
    if (slice.length === 0 && i === 0) {
      await page.waitForTimeout(800).catch(() => {});
      slice = await collectMontgomeryDashboardProjectsFromDom(page);
    }
    for (const p of slice) {
      const key =
        String(p.projectId || p.id || "").trim() ||
        String(p.projectNum || "").trim();
      if (!key) continue;
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, p);
    }
    console.log(
      `[Montgomery][discovery-paging] legacy page ${pageNum}/${MAX_MONTGOMERY_DISCOVERY_PAGES} slice=${slice.length} cumulative_unique=${uniqueByKey.size} mode=${paginationMode}`,
    );

    const idsOnPage = slice
      .map((p) => String(p.projectId || "").trim())
      .filter(Boolean);
    const sig = [...idsOnPage].sort().join(",");
    if (i > 0 && idsOnPage.length > 0 && sig === lastSignature) {
      console.log(
        "[Montgomery][discovery-paging] legacy same grid signature — stop",
      );
      break;
    }
    lastSignature = sig;

    const canPaginate =
      paginationMode === "next_button" ||
      paginationMode === "numbered_pages" ||
      paginationMode === "unknown";
    if (!canPaginate || paginationMode === "single_page") {
      console.log(
        `[Montgomery][discovery-paging] legacy no more pages (mode=${paginationMode})`,
      );
      break;
    }

    const preferNum = paginationMode === "numbered_pages";
    const advanced = await pgc.goToNextPage(page, preferNum);
    if (!advanced) {
      console.log(
        "[Montgomery][discovery-paging] legacy pager did not advance — stop",
      );
      break;
    }
    advancedPastFirstPage = true;
    if (paginationMode === "unknown" && advanced) paginationMode = "next_button";
    await pgc.waitForProjectGrid(page);
  }

  return { projects: Array.from(uniqueByKey.values()), advancedPastFirstPage };
}

/**
 * Scrape project rows from the main document (not child frames).
 * Uses Infragistics `grdProjects` pager (`grdProjects_pager`, `grdProjects_pager_label`) + AJAX refresh wait.
 * @param {import('playwright').Page} page
 */
async function collectMontgomeryDashboardProjects(page) {
  const pgc = require("../../pgc-eplan-scraper");
  await pgc.waitForProjectGrid(page);

  const bootSnap = await readMontgomeryGrdProjectsPagingSnapshot(page);
  const targetPermitLog =
    process.env.MONTGOMERY_DEBUG_TARGET_PERMIT?.trim() || "";

  if (!bootSnap.hasGrid) {
    console.log(
      "[Montgomery][discovery] no #grdProjects — using legacy pager path",
    );
    const legacy = await collectMontgomeryDashboardProjectsLegacyPager(page);
    if (legacy.advancedPastFirstPage) {
      console.log(
        "[Montgomery][discovery-paging] reload dashboard so follow-up row clicks run on page 1",
      );
      await page
        .reload({ waitUntil: "domcontentloaded", timeout: 45000 })
        .catch(() => {});
      await pgc.waitForProjectGrid(page);
    }
    return legacy.projects;
  }

  if (targetPermitLog) {
    console.log(
      `[Montgomery][grdProjects] debug targetPermit=${targetPermitLog}`,
    );
  }

  /** @type {Map<string, object>} */
  const uniqueByKey = new Map();
  let lastRowSignature = "";
  let advancedPastFirstPage = false;

  for (let i = 0; i < MAX_MONTGOMERY_DISCOVERY_PAGES; i++) {
    const snap = await readMontgomeryGrdProjectsPagingSnapshot(page);
    const dashPage = snap.currentPage;
    let slice = await collectMontgomeryDashboardProjectsFromDom(page);
    if (slice.length === 0 && i === 0) {
      await page.waitForTimeout(800).catch(() => {});
      slice = await collectMontgomeryDashboardProjectsFromDom(page);
    }

    for (const p of slice) {
      const key =
        String(p.projectId || p.id || "").trim() ||
        String(p.projectNum || "").trim();
      if (!key) continue;
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, p);
    }

    const targetHit =
      targetPermitLog &&
      slice.some(
        (p) =>
          String(p.projectNum || "")
            .trim()
            .toUpperCase() === targetPermitLog.toUpperCase(),
      );
    if (targetHit) {
      console.log(
        `[Montgomery][grdProjects] target permit visible on dashboard page ${dashPage}: ${targetPermitLog}`,
      );
    }

    console.log(
      `[Montgomery][grdProjects] dashboardPage=${dashPage} slice=${slice.length} cumulative_unique=${uniqueByKey.size} label="${snap.pagerLabel}" firstPermit=${snap.firstPermit || "n/a"} sig=${snap.rowSignature.slice(0, 80)}`,
    );

    if (i > 0 && snap.rowSignature && snap.rowSignature === lastRowSignature) {
      console.log(
        "[Montgomery][grdProjects] row signature unchanged after advance — stop",
      );
      break;
    }
    lastRowSignature = snap.rowSignature;

    const hasMore = !!(snap.range && snap.range.end < snap.range.total);
    if (!hasMore) {
      console.log(
        `[Montgomery][grdProjects] no more pages (end=${snap.range?.end ?? "?"} total=${snap.range?.total ?? "?"})`,
      );
      break;
    }

    const advanced = await advanceMontgomeryGrdProjectsPage(page, snap);
    if (!advanced) {
      console.log("[Montgomery][grdProjects] advance failed — stop");
      break;
    }
    advancedPastFirstPage = true;
    await pgc.waitForProjectGrid(page);
  }

  if (advancedPastFirstPage) {
    console.log(
      "[Montgomery][discovery-paging] reload dashboard so follow-up row clicks run on page 1",
    );
    await page
      .reload({ waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});
    await pgc.waitForProjectGrid(page);
  }

  return Array.from(uniqueByKey.values());
}

/**
 * Establish WebUI cookies: click dashboard launchRemote → SSO popup → wait for Frame/Project, then close popup.
 * Falls back to direct WebForms/Frame.aspx on webUiBase if no popup/detail.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} dashboardPage — main dashboard (stays open)
 * @param {{ projectId?: string, projectNum?: string }} firstProject
 * @param {string} webUiBase — projectdoxwebui origin from deriveWebUiBase
 */
async function warmWebUiAfterLogin(context, dashboardPage, firstProject, webUiBase) {
  const pid = String(firstProject.projectId || "").trim();
  const permit = String(firstProject.projectNum || "").trim();
  if (!pid) {
    console.log("[Montgomery][discovery] open: skipped (no ProjectID on row)");
    return { strategy: "skip-no-project-id", finalUrl: dashboardPage.url() };
  }

  console.log(
    `[Montgomery][discovery] open strategy: launchRemote → /login/sso → WebUI (projectId=${pid}${permit ? `, permit=${permit}` : ""})`,
  );

  const popupPromise = dashboardPage
    .waitForEvent("popup", { timeout: 25000 })
    .catch(() => null);

  const clickedById = await dashboardPage.evaluate((projectId) => {
    const anchors = Array.from(
      document.querySelectorAll('a[href^="javascript:"], a[href*="Frame.aspx"]'),
    );
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!/launchRemote|Frame\.aspx/i.test(href)) continue;
      const raw = String(href).replace(/%27/g, "'").replace(/%22/g, '"');
      const lr = raw.match(/launchRemote\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
      const payload = lr ? lr[1] : raw;
      let decoded = payload;
      try {
        decoded = decodeURIComponent(payload);
      } catch (_) {}
      const m =
        decoded.match(/ProjectID=(\d+)/i) ||
        payload.match(/ProjectID=(\d+)/i) ||
        decoded.match(/ProjectID%3D(\d+)/i);
      const id = m ? m[1] : "";
      if (id === String(projectId)) {
        a.click();
        return true;
      }
    }
    return false;
  }, pid);

  if (!clickedById && permit.length >= 2) {
    try {
      const esc = permit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const loc = dashboardPage
        .locator("tr, .ui-iggrid-table tbody tr, [role='row']")
        .filter({ hasText: new RegExp(esc, "i") })
        .locator('a[href*="launchRemote"], a[href*="Frame.aspx"]')
        .first();
      await loc.click({ timeout: 8000 });
    } catch (_) {}
  }

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(
      () => {},
    );
    for (let j = 0; j < 80; j++) {
      const u = popup.url();
      if (u && u !== "about:blank") break;
      await popup.waitForTimeout(120).catch(() => {});
    }
    const ready = await montgomeryWaitPopupProjectDetailReady(
      popup,
      pid,
      permit,
    );
    const finalUrl = popup.url();
    console.log(
      `[Montgomery][discovery] popup final URL: ${finalUrl} (detailReady=${ready})`,
    );
    await popup.close().catch(() => {});
    return { strategy: "launchRemote-popup-sso", finalUrl, detailReady: ready };
  }

  await dashboardPage.waitForTimeout(1500);
  let u = dashboardPage.url();
  if (montgomeryProjectDetailEntryUrlOk(u, pid)) {
    console.log(`[Montgomery][discovery] same-tab final URL: ${u}`);
    return { strategy: "launchRemote-same-tab", finalUrl: u };
  }

  const base = String(webUiBase || "").replace(/\/$/, "");
  if (!base) {
    console.log("[Montgomery][discovery] open fallback: no webUiBase");
    return { strategy: "no-webui-base", finalUrl: u };
  }
  console.log("[Montgomery][discovery] open fallback: direct WebForms/Frame.aspx on webUiBase");
  const testPage = await context.newPage();
  const warmUrl = `${base}/WebForms/Frame.aspx?tab=projectStatusTab&ProjectID=${encodeURIComponent(pid)}`;
  await testPage.goto(warmUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(
    () => {},
  );
  await testPage.waitForTimeout(1200);
  u = testPage.url();
  console.log(`[Montgomery][discovery] fallback final URL: ${u}`);
  await testPage.close().catch(() => {});
  return { strategy: "direct-webui-frame", finalUrl: u };
}

module.exports = {
  ensureMontgomeryPostLoginDashboard,
  waitForMontgomeryDashboardReady,
  collectMontgomeryDashboardProjects,
  warmWebUiAfterLogin,
};
