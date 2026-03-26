const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function getAccelaDebugDir() {
  const dir = path.join(__dirname, "debug");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveCheckpointScreenshot(page, label) {
  if (!page || typeof page.screenshot !== "function") return Promise.resolve();
  const dir = getAccelaDebugDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `${ts}_${label}.png`);
  return page.screenshot({ path: file, fullPage: true }).then(
    () => {
      console.log(`  [CHECKPOINT] Saved ${label} → ${path.basename(file)}`);
    },
    () => {},
  );
}

async function findFieldInFrames(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) return el;
  }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const sel of selectors) {
      try {
        const el = await frame.$(sel);
        if (el && (await el.isVisible().catch(() => false))) return el;
      } catch (_) {}
    }
  }
  return null;
}

async function waitForAccelaLoad(pageOrFrame, timeoutMs = 30000) {
  if (typeof pageOrFrame.waitForLoadState === "function") {
    await pageOrFrame
      .waitForLoadState("networkidle", { timeout: timeoutMs })
      .catch(() => {});
  }
  await pageOrFrame
    .waitForSelector(".aca_loading, .ACA_Loading, .loading-mask", {
      state: "detached",
      timeout: 10000,
    })
    .catch(() => {});
  if (typeof pageOrFrame.waitForTimeout === "function") {
    await pageOrFrame.waitForTimeout(1500);
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function clickAccelaLink(pageOrFrame, selectors, label) {
  for (const sel of selectors) {
    try {
      const link = await pageOrFrame.$(sel);
      if (link && (await link.isVisible().catch(() => false))) {
        console.log(`     Clicking "${label}" via ${sel}...`);
        await link.click({ force: true }).catch(async () => {
          await pageOrFrame.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (el) el.click();
          }, sel);
        });
        await waitForAccelaLoad(pageOrFrame);
        return true;
      }
    } catch (clickErr) {
      console.log(
        `     ⚠️ Click failed for "${label}" (${sel}): ${clickErr.message}`,
      );
    }
  }

  console.log(`     "${label}" link not found — skipping`);
  return false;
}

/** Scoped nav container in record detail frame (Accela tab/dropdown bar). */
const NAV_SCOPE_SELECTORS = [
  "#ctl00_PlaceHolderMain_TabDataList",
  '[id*="TabDataList"]',
  '[id*="TabContainer"]',
  ".aca_tab_list",
  "ul.aca_tabs",
];

function isBaltimorePortal(page) {
  return !!(page && page._isBaltimore);
}

/** Child frames only (main frame excluded) for navigateToRecordInfoSection / navigateToPaymentsSection. */
function getAccelaChildFrames(page) {
  return page.frames().filter((f) => f !== page.mainFrame());
}

/**
 * Find first visible element matching any of the selectors in the given frame.
 */
async function findLinkInFrame(frame, selectors) {
  for (const sel of selectors) {
    try {
      const el = await frame.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return { el, sel };
    } catch (_) {}
  }
  return { el: null, sel: null };
}

/**
 * Find a visible anchor whose text content matches linkText (case-insensitive, trimmed), not by ID/class.
 * Search order: main page frame first, then each frame in the frames array.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames - Frames to search after main (e.g. child frames except main)
 * @param {string} linkText - Exact text to match (after trim, case-insensitive)
 * @returns {Promise<{ element: import('playwright').ElementHandle, context: import('playwright').Page | import('playwright').Frame } | null>}
 */
async function findLinkInAnyContext(page, frames, linkText) {
  const target = (linkText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!target) {
    console.log(`     [findLinkInAnyContext] empty linkText`);
    return null;
  }

  async function findVisibleMatchingLink(frameOrPage) {
    const links = await frameOrPage.$$("a");
    for (const el of links) {
      const raw = await el.textContent();
      const text = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text !== target) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      return el;
    }
    return null;
  }

  const mainFrame = page.mainFrame();
  try {
    const el = await findVisibleMatchingLink(mainFrame);
    if (el) {
      console.log(
        `     [findLinkInAnyContext] "${linkText}" found in main page (${mainFrame.url().substring(0, 80)}...)`,
      );
      return { element: el, context: page };
    }
  } catch (e) {
    console.log(`     [findLinkInAnyContext] main page search error: ${e.message}`);
  }

  const frameList = Array.isArray(frames) ? frames : [];
  for (let i = 0; i < frameList.length; i++) {
    const f = frameList[i];
    if (!f) continue;
    try {
      const el = await findVisibleMatchingLink(f);
      if (el) {
        console.log(
          `     [findLinkInAnyContext] "${linkText}" found in frames[${i}] (${f.url().substring(0, 80)}...)`,
        );
        return { element: el, context: f };
      }
    } catch (e) {
      console.log(`     [findLinkInAnyContext] frames[${i}] search error: ${e.message}`);
    }
  }

  console.log(`     [findLinkInAnyContext] "${linkText}" not found in any context`);
  return null;
}

/**
 * Clicks a link in the context of the frame/page that owns it, then waits for contentFrame to update.
 * @param {import('playwright').Page | import('playwright').Frame} context - Page or Frame where element lives
 * @param {import('playwright').ElementHandle} element
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame - Panel/frame whose DOM should change
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<boolean>} true if content change detected, false on click failure or timeout
 */
async function clickAndWaitForContent(context, element, contentFrame, timeoutMs = 8000) {
  if (!element) {
    console.log(`     [clickAndWaitForContent] skipped: no element`);
    return false;
  }
  if (!contentFrame || typeof contentFrame.evaluate !== "function") {
    console.log(`     [clickAndWaitForContent] skipped: invalid contentFrame`);
    return false;
  }
  let priorLen = 0;
  try {
    priorLen = await contentFrame.evaluate(
      () => (document.body ? document.body.innerHTML.length : 0),
    );
  } catch (e) {
    console.log(`     [clickAndWaitForContent] could not read contentFrame: ${e.message}`);
    return false;
  }
  try {
    await element.click({ force: true });
  } catch (e) {
    console.log(`     [clickAndWaitForContent] click failed: ${e.message}`);
    return false;
  }
  const target = contentFrame;
  await target.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
  try {
    await target.waitForFunction(
      (prev) => {
        const len = document.body ? document.body.innerHTML.length : 0;
        return len !== prev;
      },
      priorLen,
      { timeout: timeoutMs },
    );
    console.log(`     [clickAndWaitForContent] success: content panel updated (contentFrame)`);
    return true;
  } catch (e) {
    console.log(`     [clickAndWaitForContent] timeout after ${timeoutMs}ms waiting for content change`);
    return false;
  }
}

const RECORD_INFO_SECTION_NAMES = [
  "Record Details",
  "Processing Status",
  "Related Records",
  "Attachments",
  "Inspections",
];

/**
 * Poll main frame + frames until any submenu label is visible as an anchor (exact text match, case-insensitive).
 * Uses short waitForSelector attempts per hint per context within an overall timeoutMs budget.
 */
async function waitForRecordInfoSubmenuAnchors(page, frames, timeoutMs = 5000) {
  const hints = [...RECORD_INFO_SECTION_NAMES];
  const contexts = [page.mainFrame(), ...(Array.isArray(frames) ? frames.filter(Boolean) : [])];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of contexts) {
      for (const hint of hints) {
        let baltimoreOnResponse = null;
        try {
          const safe = hint.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          await ctx.waitForSelector(`a:has-text("${safe}")`, {
            state: "visible",
            timeout: 400,
          });
          const el = await ctx.$(`a:has-text("${safe}")`);
          if (el && (await el.isVisible().catch(() => false))) {
            console.log(
              `     [Baltimore Nav] submenu visible (waitForSelector): ${hint}`,
            );
            return true;
          }
        } catch (_) {}
      }
    }
    await page.waitForTimeout(120);
  }
  console.log(
    `     [Baltimore Nav] submenu: no Record Info submenu anchor within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Poll until any of the given fee-related submenu labels is visible.
 */
async function waitForPaymentsSubmenuAnchors(page, frames, labels, timeoutMs = 5000) {
  const contexts = [page.mainFrame(), ...(Array.isArray(frames) ? frames.filter(Boolean) : [])];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of contexts) {
      for (const hint of labels) {
        try {
          const safe = hint.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          await ctx.waitForSelector(`a:has-text("${safe}")`, {
            state: "visible",
            timeout: 400,
          });
          const el = await ctx.$(`a:has-text("${safe}")`);
          if (el && (await el.isVisible().catch(() => false))) {
            console.log(
              `     [Baltimore Nav] Payments submenu visible (waitForSelector): ${hint}`,
            );
            return true;
          }
        } catch (_) {}
      }
    }
    await page.waitForTimeout(120);
  }
  console.log(
    `     [Baltimore Nav] Payments submenu: no matching anchor within ${timeoutMs}ms`,
  );
  return false;
}

/**
 * Baltimore: two-phase navigation for Record Info dropdown → submenu item → content panel.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames - Child frames to search (after main); main is always searched first inside helpers
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame - Panel whose DOM should update after submenu click
 * @param {"Record Details"|"Processing Status"|"Related Records"|"Attachments"|"Inspections"} sectionName
 * @returns {Promise<boolean>}
 */
async function navigateToRecordInfoSection(page, frames, contentFrame, sectionName) {
  if (!RECORD_INFO_SECTION_NAMES.includes(sectionName)) {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: invalid sectionName "${sectionName}"`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] navigateToRecordInfoSection: start → "${sectionName}"`,
  );

  const step1 = await findLinkInAnyContext(page, frames, "Record Info");
  if (!step1) {
    console.log(
      `     [Baltimore Nav] step 1 failed: Record Info dropdown trigger not found`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] step 1: clicking Record Info dropdown trigger`,
  );
  try {
    await step1.element.click({ force: true });
  } catch (e) {
    console.log(`     [Baltimore Nav] step 1 click failed: ${e.message}`);
    return false;
  }

  const submenuOk = await waitForRecordInfoSubmenuAnchors(page, frames, 5000);
  if (!submenuOk) {
    console.log(
      `     [Baltimore Nav] step 1→2: submenu did not become visible in time`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: locating submenu item "${sectionName}"`,
  );
  const step2 = await findLinkInAnyContext(page, frames, sectionName);
  if (!step2) {
    console.log(
      `     [Baltimore Nav] step 2 failed: submenu item "${sectionName}" not found`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: clicking "${sectionName}" and waiting for content panel`,
  );
  const contentOk = await clickAndWaitForContent(
    step2.context,
    step2.element,
    contentFrame,
    8000,
  );
  if (contentOk) {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: success → "${sectionName}"`,
    );
  } else {
    console.log(
      `     [Baltimore Nav] navigateToRecordInfoSection: content panel did not update after click`,
    );
  }
  return contentOk;
}

/**
 * Baltimore: Payments dropdown → Fees/Payments submenu → content panel.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame[]} frames
 * @param {import('playwright').Page | import('playwright').Frame} contentFrame
 * @returns {Promise<boolean>}
 */
async function navigateToPaymentsSection(page, frames, contentFrame) {
  console.log(`     [Baltimore Nav] navigateToPaymentsSection: start`);

  const step1 = await findLinkInAnyContext(page, frames, "Payments");
  if (!step1) {
    console.log(
      `     [Baltimore Nav] step 1 failed: Payments dropdown trigger not found`,
    );
    return false;
  }
  console.log(
    `     [Baltimore Nav] step 1: clicking Payments dropdown trigger`,
  );
  try {
    await step1.element.click({ force: true });
  } catch (e) {
    console.log(`     [Baltimore Nav] step 1 click failed: ${e.message}`);
    return false;
  }

  const feeSubmenuLabels = ["Fees / Payments", "Fees", "Payments", "Payment"];
  const submenuOk = await waitForPaymentsSubmenuAnchors(
    page,
    frames,
    feeSubmenuLabels,
    5000,
  );
  if (!submenuOk) {
    console.log(
      `     [Baltimore Nav] step 1→2: Payments submenu did not become visible in time`,
    );
    return false;
  }

  console.log(`     [Baltimore Nav] step 2: locating Fees / Payments submenu item`);
  let step2 = null;
  for (const label of feeSubmenuLabels) {
    step2 = await findLinkInAnyContext(page, frames, label);
    if (step2) break;
  }
  if (!step2) {
    console.log(
      `     [Baltimore Nav] step 2 failed: Fees / Payments submenu item not found`,
    );
    return false;
  }

  console.log(
    `     [Baltimore Nav] step 2: clicking Fees/Payments and waiting for content panel`,
  );
  const contentOk = await clickAndWaitForContent(
    step2.context,
    step2.element,
    contentFrame,
    8000,
  );
  if (contentOk) {
    console.log(`     [Baltimore Nav] navigateToPaymentsSection: success`);
  } else {
    console.log(
      `     [Baltimore Nav] navigateToPaymentsSection: content panel did not update after click`,
    );
  }
  return contentOk;
}

/**
 * Baltimore: Plan Review is a top-level tab on the main page (no Record Info dropdown).
 */
async function navigateToPlanReview(page, _contentFrame) {
  try {
    console.log("[Baltimore PlanReview Nav] looking for Plan Review tab");

    const found = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a, li, span, div")];
      const el = links.find((node) => {
        const t = node.innerText ? node.innerText.trim() : "";
        return t === "Plan Review";
      });
      if (el) {
        el.click();
        return true;
      }
      return false;
    });

    if (!found) {
      console.log("[Baltimore PlanReview Nav] Plan Review tab not found");
      console.log("[Baltimore PlanReview Nav] No Plan Review tab on this record");
      return false;
    }

    await new Promise((r) => setTimeout(r, 3000));
    console.log("[Baltimore PlanReview Nav] clicked, waited 3s");
    return true;
  } catch (err) {
    console.log("[Baltimore PlanReview Nav] ERROR:", err.message);
    return false;
  }
}

/**
 * Wait for a submenu link to become visible in ctx or main page (Baltimore: submenu may render outside record frame).
 * submenuSelectors: array of selectors that indicate submenu is open (e.g. "Record Details", "Processing Status").
 * Returns { visibleInCtx, visibleInMain }.
 */
async function waitForSubmenuVisible(page, ctx, submenuSelectors, waitMs) {
  const deadline = Date.now() + (waitMs || 2000);
  let visibleInCtx = false;
  let visibleInMain = false;
  while (Date.now() < deadline) {
    for (const sel of submenuSelectors) {
      try {
        if (ctx && ctx !== page.mainFrame()) {
          const el = await ctx.$(sel);
          if (el && (await el.isVisible().catch(() => false))) {
            visibleInCtx = true;
            break;
          }
        }
      } catch (_) {}
    }
    if (visibleInCtx) break;
    try {
      const mainEl = await page.mainFrame().$(submenuSelectors[0]);
      if (mainEl && (await mainEl.isVisible().catch(() => false))) visibleInMain = true;
    } catch (_) {}
    if (visibleInMain) break;
    await page.waitForTimeout(200);
  }
  return { visibleInCtx, visibleInMain };
}

/**
 * Expand "Record Info" dropdown so sub-items (Record Details, Processing Status, etc.) become visible.
 * For Baltimore: longer wait and wait for submenu to appear in ctx or main page.
 */
async function expandRecordInfoDropdown(ctx, page) {
  const selectors = [
    '[id*="TabDataList"] a:has-text("Record Info")',
    '#ctl00_PlaceHolderMain_TabDataList a:has-text("Record Info")',
    'a:has-text("Record Info")',
    'a[id*="RecordInfo"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await ctx.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`     [panel] Record Info dropdown: clicking expand`);
        await el.click({ force: true }).catch(() => {});
        const waitMs = isBaltimorePortal(page) ? 1200 : 800;
        await page.waitForTimeout(waitMs);
        if (isBaltimorePortal(page)) {
          const submenuIndicators = [
            'a:has-text("Record Details")',
            'a:has-text("Processing Status")',
            'a:has-text("Related Records")',
            'a:has-text("Attachments")',
            'a:has-text("Inspections")',
          ];
          const { visibleInCtx, visibleInMain } = await waitForSubmenuVisible(
            page,
            ctx,
            submenuIndicators,
            3500,
          );
          if (visibleInCtx) console.log(`     [panel] Record Info submenu: visible in record frame`);
          else if (visibleInMain) console.log(`     [panel] Record Info submenu: visible in main page`);
          else console.log(`     [panel] Record Info submenu: not detected after wait (will try multi-context click)`);
        }
        return true;
      }
    } catch (_) {}
  }
  console.log(`     [panel] Record Info: expand link not found`);
  return false;
}

/**
 * Expand "Payments" dropdown so "Fees" sub-item becomes visible.
 * For Baltimore: longer wait and wait for submenu to appear.
 */
async function expandPaymentsDropdown(ctx, page) {
  const selectors = [
    '[id*="TabDataList"] a:has-text("Payments")',
    '#ctl00_PlaceHolderMain_TabDataList a:has-text("Payments")',
    'a:has-text("Payments")',
    'a[id*="Payment"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await ctx.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        console.log(`     [panel] Payments dropdown: clicking expand`);
        await el.click({ force: true }).catch(() => {});
        const waitMs = isBaltimorePortal(page) ? 1200 : 800;
        await page.waitForTimeout(waitMs);
        if (isBaltimorePortal(page)) {
          const submenuIndicators = [
            'a:has-text("Fees")',
            'a:has-text("Payments")',
            'a:has-text("Payment")',
          ];
          const { visibleInCtx, visibleInMain } = await waitForSubmenuVisible(
            page,
            ctx,
            submenuIndicators,
            3500,
          );
          if (visibleInCtx) console.log(`     [panel] Payments submenu: visible in record frame`);
          else if (visibleInMain) console.log(`     [panel] Payments submenu: visible in main page`);
          else console.log(`     [panel] Payments submenu: not detected after wait (will try multi-context click)`);
        }
        return true;
      }
    } catch (_) {}
  }
  console.log(`     [panel] Payments: expand link not found`);
  return false;
}

/**
 * Find and return the first visible link matching selectors, searching ctx then (if Baltimore) main page and other frames.
 * Returns { link, frame, selectorUsed } or { link: null, frame: null, selectorUsed: null }.
 */
async function findPanelLinkMultiContext(ctx, page, selectors, label) {
  const { link, sel } = await findLinkInFrame(ctx, selectors);
  if (link) {
    console.log(`     [panel] "${label}": link found in record frame`);
    return { link, frame: ctx, selectorUsed: sel };
  }
  if (!isBaltimorePortal(page)) return { link: null, frame: null, selectorUsed: null };
  const main = page.mainFrame();
  if (main && main !== ctx) {
    const mainResult = await findLinkInFrame(main, selectors);
    if (mainResult.el) {
      console.log(`     [panel] "${label}": link found in main page`);
      return { link: mainResult.el, frame: main, selectorUsed: mainResult.sel };
    }
  }
  for (const frame of page.frames()) {
    if (frame === ctx || frame === main) continue;
    try {
      const fr = await findLinkInFrame(frame, selectors);
      if (fr.el) {
        console.log(`     [panel] "${label}": link found in frame ${frame.url().substring(0, 50)}`);
        return { link: fr.el, frame, selectorUsed: fr.sel };
      }
    } catch (_) {}
  }
  console.log(`     [panel] "${label}": link not found in any context`);
  return { link: null, frame: null, selectorUsed: null };
}

/**
 * Click a tab/panel link, optionally after expanding Record Info or Payments dropdown.
 * For Baltimore: search for link in record frame, then main page, then other frames; use Baltimore-specific selectors when provided.
 * Returns { found, panelVisible }. Takes checkpoint screenshot when panelVisible and checkpointLabel is set.
 */
async function clickAccelaNavPanel(ctx, page, selectors, label, options = {}) {
  const { expandRecordInfoFirst, expandPaymentsFirst, checkpointLabel } = options;
  if (expandRecordInfoFirst) await expandRecordInfoDropdown(ctx, page);
  if (expandPaymentsFirst) await expandPaymentsDropdown(ctx, page);

  console.log(`     [panel] click start: ${label}`);
  const { link, frame, selectorUsed } = await findPanelLinkMultiContext(ctx, page, selectors, label);
  if (link && frame) {
    try {
      console.log(`     [panel] clicking "${label}"`);
      await link.click({ force: true }).catch(async () => {
        if (selectorUsed && !selectorUsed.includes(":has-text") && frame.evaluate) {
          await frame.evaluate((s) => {
            const el = document.querySelector(s);
            if (el) el.click();
          }, selectorUsed);
        }
      });
      await waitForAccelaLoad(page);
      await page.waitForTimeout(1200);
      if (isBaltimorePortal(page)) {
        await page.waitForTimeout(500);
        console.log(`     [panel] panel load confirmed (record frame): ${label}`);
      }
      if (checkpointLabel) {
        await saveCheckpointScreenshot(page, checkpointLabel);
        console.log(`     [panel] visible confirmation: ${label}`);
      }
      return { found: true, panelVisible: true };
    } catch (err) {
      console.log(`     [panel] click failed for "${label}": ${err.message}`);
    }
  }
  console.log(`     [panel] "${label}" link not found — skipping`);
  return { found: false, panelVisible: false };
}

async function dumpPageDiagnostics(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => "(unknown)");
  const loginFormVisible = !!(await findFieldInFrames(page, [
    'input[type="password"]',
  ]));
  const logoutVisible = !!(await findFieldInFrames(page, [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
  ]));
  const welcomeVisible = !!(await findFieldInFrames(page, [
    "#ctl00_HeaderNavigation_lblWelcome",
    '[id*="lblWelcome"]',
  ]));
  const frames = page.frames();
  const frameInfo = frames.map(
    (f, i) => `${i}:${f.name() || "(unnamed)"}@${f.url().substring(0, 80)}`,
  );
  console.log(`  [DIAG:${label}] url=${url}`);
  console.log(`  [DIAG:${label}] title=${title}`);
  console.log(
    `  [DIAG:${label}] loginFormVisible=${loginFormVisible} logoutVisible=${logoutVisible} welcomeVisible=${welcomeVisible}`,
  );
  console.log(
    `  [DIAG:${label}] frames(${frames.length}): ${frameInfo.join(" | ")}`,
  );
}

async function findAuthLandmark(page) {
  const selectors = [
    'a:has-text("Logout")',
    'a:has-text("Log Out")',
    'a:has-text("Sign Out")',
    "#ctl00_HeaderNavigation_lblWelcome",
    'a:has-text("My Account")',
    'a:has-text("My Records")',
    '[id*="lblWelcome"]',
  ];
  return !!(await findFieldInFrames(page, selectors));
}

async function findLoginFrame(page) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const nameMatch = (frame.name() || "").toLowerCase().includes("login");
    const urlMatch = frame.url().toLowerCase().includes("login");
    if (nameMatch || urlMatch) {
      console.log(
        `  Found LoginFrame: name="${frame.name()}" url=${frame.url().substring(0, 100)}`,
      );
      return frame;
    }
  }
  return null;
}

async function findFieldInContext(context, selectors) {
  for (const sel of selectors) {
    try {
      const el = await context.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

async function dumpLoginFrameDiagnostics(frame, label) {
  if (!frame) {
    console.log(`  [DIAG:${label}] LoginFrame not available`);
    return;
  }
  const url = frame.url();
  const userStillVisible = !!(await findFieldInContext(frame, [
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[id*="UserId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ]));
  const passStillVisible = !!(await findFieldInContext(frame, [
    'input[type="password"]',
  ]));
  const btnDisabled = await frame
    .evaluate(() => {
      const btn = document.querySelector(
        'button[type="submit"], input[type="submit"], a[id*="btnLogin"]',
      );
      return btn
        ? btn.disabled || btn.getAttribute("disabled") !== null
        : "no_btn";
    })
    .catch(() => "eval_error");
  const errorText = await frame
    .evaluate(() => {
      const errorSels = [
        ".ACA_Error",
        ".error-message",
        '[id*="Error"]',
        '[id*="error"]',
        ".font11px",
        ".validation-summary-errors",
        '[class*="alert"]',
        '[class*="error"]',
      ];
      for (const sel of errorSels) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.textContent.trim())
          return el.textContent.trim().substring(0, 200);
      }
      return "";
    })
    .catch(() => "");
  console.log(`  [DIAG:${label}] LoginFrame url=${url}`);
  console.log(
    `  [DIAG:${label}] userFieldVisible=${userStillVisible} passFieldVisible=${passStillVisible} btnDisabled=${btnDisabled}`,
  );
  if (errorText) console.log(`  [DIAG:${label}] errorText="${errorText}"`);
}

async function accelaLogin(page, username, password, portalUrl) {
  const cleanUrl = portalUrl.replace(/\/$/, "").replace(/\/Login\.aspx$/i, "");
  const loginUrl = cleanUrl + "/Login.aspx";
  console.log(`  Navigating to Accela login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);

  const loginFrame = await findLoginFrame(page);

  const contexts = loginFrame ? [loginFrame, page] : [page];
  console.log(
    `  Login context: ${loginFrame ? "LoginFrame (primary)" : "main page (no LoginFrame found)"}`,
  );

  const userSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtUserId",
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[name*="userName"]',
    'input[id*="UserId"]',
    'input[id*="userId"]',
    'input[type="text"][id*="User"]',
    'input[type="email"]',
  ];

  let userField = null;
  let activeContext = null;
  for (const ctx of contexts) {
    userField = await findFieldInContext(ctx, userSelectors);
    if (!userField) {
      const textInputs = await ctx.$$('input[type="text"]').catch(() => []);
      for (const inp of textInputs) {
        if (await inp.isVisible().catch(() => false)) {
          userField = inp;
          break;
        }
      }
    }
    if (userField) {
      activeContext = ctx;
      break;
    }
  }
  if (!userField) {
    await dumpPageDiagnostics(page, "NO_USER_FIELD");
    await dumpLoginFrameDiagnostics(loginFrame, "NO_USER_FIELD");
    throw new Error(
      "Cannot find Accela username field in LoginFrame or main page",
    );
  }
  console.log(
    `  Found username field in ${activeContext === loginFrame ? "LoginFrame" : "main page"}`,
  );
  await userField.fill(username);
  console.log("  Filled username");

  const passSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtPassword",
    'input[name*="txtPassword"]',
    'input[name*="Password"]',
    'input[name*="password"]',
    'input[id*="Password"]',
    'input[id*="password"]',
    'input[type="password"]',
  ];

  const passField = await findFieldInContext(activeContext, passSelectors);
  if (!passField) {
    await dumpLoginFrameDiagnostics(loginFrame, "NO_PASS_FIELD");
    throw new Error("Cannot find Accela password field");
  }
  await passField.fill(password);
  console.log("  Filled password");

  const loginBtnSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_btnLogin",
    'input[name*="btnLogin"]',
    'a[id*="btnLogin"]',
    'a[id*="Login"]',
    'button:has-text("SIGN IN")',
    'button:has-text("Sign In")',
    'button:has-text("Log In")',
    'input[type="submit"]',
    'button[type="submit"]',
  ];

  let loginBtn = await findFieldInContext(activeContext, loginBtnSelectors);
  if (!loginBtn) {
    const allAnchors = await activeContext.$$("a").catch(() => []);
    for (const a of allAnchors) {
      const text = (await a.textContent().catch(() => "")).trim().toUpperCase();
      const visible = await a.isVisible().catch(() => false);
      if (
        visible &&
        (text === "SIGN IN" || text === "LOG IN" || text === "LOGIN")
      ) {
        loginBtn = a;
        break;
      }
    }
  }

  if (loginBtn) {
    console.log("  Clicking login button...");
    await loginBtn.click();
  } else {
    console.log("  No login button found, pressing Enter in active context");
    if (passField) await passField.press("Enter");
    else await page.keyboard.press("Enter");
  }

  console.log("  ⏳ Waiting for login to complete...");

  let loginSucceeded = false;

  for (let elapsed = 0; elapsed < 35000; elapsed += 2000) {
    await page.waitForTimeout(2000);

    if (loginFrame) {
      const frameStillExists = page.frames().some((f) => f === loginFrame);
      if (!frameStillExists) {
        console.log("  ✅ LoginFrame detached — login succeeded");
        loginSucceeded = true;
        break;
      }

      const loginFormGone = !(await findFieldInContext(loginFrame, [
        'input[type="password"]',
      ]));
      if (loginFormGone) {
        console.log(
          "  ✅ Login form disappeared from LoginFrame — login succeeded",
        );
        loginSucceeded = true;
        break;
      }
    }

    const authFound = await findAuthLandmark(page);
    if (authFound) {
      console.log("  ✅ Authenticated landmark found — login succeeded");
      loginSucceeded = true;
      break;
    }
  }

  if (loginSucceeded) {
    await page.waitForTimeout(2000);
    const url = page.url();
    console.log(`  ✅ Login confirmed. URL: ${url}`);
    await saveCheckpointScreenshot(page, "after_login");
    return url;
  }

  if (loginFrame) {
    const errorText = await loginFrame
      .evaluate(() => {
        const errorSels = [
          ".ACA_Error",
          ".error-message",
          '[id*="Error"]',
          '[id*="error"]',
          ".font11px",
          ".validation-summary-errors",
          '[class*="alert"]',
          '[class*="error"]',
        ];
        for (const sel of errorSels) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0 && el.textContent.trim())
            return el.textContent.trim().substring(0, 300);
        }
        return "";
      })
      .catch(() => "");

    if (errorText) {
      console.log(`  ❌ LoginFrame error: "${errorText}"`);
      await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_ERROR");
      await dumpPageDiagnostics(page, "LOGIN_ERROR");
      await page
        .screenshot({ path: "login_failed.png", fullPage: true })
        .catch(() => {});
      throw new Error(`Accela login failed — portal error: ${errorText}`);
    }
  }

  await dumpLoginFrameDiagnostics(loginFrame, "LOGIN_TIMEOUT");
  await dumpPageDiagnostics(page, "LOGIN_TIMEOUT");
  await page
    .screenshot({ path: "login_failed.png", fullPage: true })
    .catch(() => {});
  throw new Error(
    "Accela login failed — timed out waiting for authenticated state (login form persisted in LoginFrame)",
  );
}

async function searchPermit(page, portalUrl, permitNumber) {
  console.log(`  Searching for permit: ${permitNumber}`);

  const isAuth = await findAuthLandmark(page);
  if (!isAuth) {
    await dumpPageDiagnostics(page, "SEARCH_AUTH_CHECK");
    throw new Error(
      "AUTHENTICATION_LOST: No authenticated landmarks found before permit search.",
    );
  }
  console.log("  ✅ Authentication verified");

  const permitsTab = await findFieldInFrames(page, [
    "#Tab_Building",
    'a:has-text("Permits and Inspections")',
    'a:has-text("Permits & Inspections")',
    'a[title*="Permits"]',
    '#header_main_menu a:has-text("Permits")',
  ]);

  if (permitsTab) {
    console.log("  Clicking Permits tab...");
    await permitsTab.click();
    await waitForAccelaLoad(page);
    await page.waitForTimeout(3000);
    await saveCheckpointScreenshot(page, "after_permits_page");
  } else {
    const isPublicPage = await page.$(
      'a:has-text("Sign In"), a:has-text("Create an Account")',
    );
    if (isPublicPage) {
      throw new Error("Session dropped — redirected to public page.");
    }
    console.log(
      "  ⚠️ Permits tab not found, attempting to proceed on current page...",
    );
  }

  console.log("  ⏳ Waiting for records grid...");
  const gridAppeared = await page
    .waitForSelector(
      'table[id*="PermitList"] tr, table[id*="Record"] tr, .aca_grid_container tr td a, [id*="gview_List"] tr',
      { visible: true, timeout: 15000 },
    )
    .catch(() => null);

  if (!gridAppeared) {
    let gridInFrame = false;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameGrid = await frame
        .$("table tr td a, .aca_grid_container")
        .catch(() => null);
      if (frameGrid) {
        console.log(
          `  ✅ Grid found in frame: ${frame.name() || frame.url().substring(0, 60)}`,
        );
        gridInFrame = true;
        break;
      }
    }
    if (!gridInFrame) {
      await dumpPageDiagnostics(page, "NO_GRID");
      const anchorCount = await page.evaluate(
        () => document.querySelectorAll("a").length,
      );
      console.log(`  [DIAG:NO_GRID] Total anchors on page: ${anchorCount}`);
    }
  } else {
    await saveCheckpointScreenshot(page, "after_records_page");
  }

  console.log("  Scanning for permit link...");

  let foundLink = null;
  let foundFrame = null;
  let foundInfo = {};

  const permitLink = await page.$(`a:has-text("${permitNumber}")`);
  if (permitLink && (await permitLink.isVisible().catch(() => false))) {
    foundLink = permitLink;
    foundFrame = page;
    const href = (await permitLink.getAttribute("href").catch(() => "")) || "";
    const text = (await permitLink.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    foundInfo = {
      method: "has-text",
      text,
      href,
      frameName: "main",
      frameUrl: page.url(),
    };
  }

  if (!foundLink) {
    const allLinks = await page.$$("a");
    for (const link of allLinks) {
      const text = (await link.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .trim();
      if (text === permitNumber || text.includes(permitNumber)) {
        const visible = await link.isVisible().catch(() => false);
        if (visible) {
          const href = (await link.getAttribute("href").catch(() => "")) || "";
          foundLink = link;
          foundFrame = page;
          foundInfo = {
            method: "anchor-scan",
            text,
            href,
            frameName: "main",
            frameUrl: page.url(),
          };
          break;
        }
      }
    }
  }

  if (!foundLink) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const linkData = await frame
        .evaluate((target) => {
          const anchors = Array.from(document.querySelectorAll("a"));
          const match = anchors.find((a) => {
            const text = (a.textContent || "").replace(/\s+/g, " ").trim();
            return text.includes(target) && a.offsetWidth > 0;
          });
          if (match) {
            return {
              text: match.textContent.replace(/\s+/g, " ").trim(),
              href: match.href || "",
            };
          }
          return null;
        }, permitNumber)
        .catch(() => null);

      if (linkData) {
        foundFrame = frame;
        foundInfo = {
          method: "frame-evaluate",
          text: linkData.text,
          href: linkData.href,
          frameName: frame.name() || "(unnamed)",
          frameUrl: frame.url().substring(0, 100),
        };
        break;
      }
    }
  }

  if (!foundLink && !foundInfo.method) {
    const visibleTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .filter((a) => a.offsetWidth > 0)
        .slice(0, 25)
        .map((a) =>
          (a.textContent || "").replace(/\s+/g, " ").trim().substring(0, 80),
        );
    });
    console.log(
      "  Visible anchor texts:",
      JSON.stringify(visibleTexts.filter((t) => t.length > 0)),
    );
    await dumpPageDiagnostics(page, "PERMIT_NOT_FOUND");
    await page
      .screenshot({ path: "grid_not_found.png", fullPage: true })
      .catch(() => {});
    throw new Error(`Permit ${permitNumber} not found in the records list.`);
  }

  console.log(
    `  ✅ Found permit link: method=${foundInfo.method} text="${foundInfo.text}" href="${(foundInfo.href || "").substring(0, 100)}" frame=${foundInfo.frameName}`,
  );

  const urlBefore = page.url();

  if (foundLink) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      foundLink.click(),
    ]);
  } else if (foundFrame && foundInfo.method === "frame-evaluate") {
    await foundFrame
      .evaluate((target) => {
        const anchors = Array.from(document.querySelectorAll("a"));
        const match = anchors.find((a) => {
          const text = (a.textContent || "").replace(/\s+/g, " ").trim();
          return text.includes(target) && a.offsetWidth > 0;
        });
        if (match) match.click();
      }, permitNumber)
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  }

  await waitForAccelaLoad(page);

  console.log("  ⏳ Verifying record detail loaded...");
  const urlAfter = page.url();
  console.log(`  [DIAG:POST_CLICK] urlBefore=${urlBefore.substring(0, 100)}`);
  console.log(`  [DIAG:POST_CLICK] urlAfter=${urlAfter.substring(0, 100)}`);

  const allFrames = page.frames();
  let recordFrame = null;
  for (let i = 0; i < allFrames.length; i++) {
    const f = allFrames[i];
    const fUrl = f.url();
    const fName = f.name() || "(unnamed)";
    const preview = await f
      .evaluate(() => {
        return document.body
          ? document.body.innerText
              .substring(0, 300)
              .replace(/\s+/g, " ")
              .trim()
          : "";
      })
      .catch(() => "(inaccessible)");
    console.log(
      `  [DIAG:FRAME ${i}] name="${fName}" url=${fUrl.substring(0, 120)}`,
    );
    console.log(`  [DIAG:FRAME ${i}] preview="${preview.substring(0, 200)}"`);

    if (
      fUrl.includes("Cap/CapDetail") ||
      fUrl.includes("capDetail") ||
      fUrl.includes("Record") ||
      fUrl.includes("permit")
    ) {
      recordFrame = f;
      console.log(`  ✅ Record detail frame identified: ${fName}`);
    }
  }

  if (!recordFrame) {
    for (const f of allFrames) {
      const hasPermit = await f
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermit && f !== page.mainFrame()) {
        recordFrame = f;
        console.log(
          `  ✅ Record frame found by permit number match: ${f.name() || f.url().substring(0, 80)}`,
        );
        break;
      }
      if (hasPermit && f === page.mainFrame()) {
        console.log(`  ✅ Permit number found in main frame`);
      }
    }
  }

  await waitForRecordDetailStrong(page, recordFrame, permitNumber);
  await saveCheckpointScreenshot(page, "after_record_detail");
  page._recordFrame = recordFrame;
}

async function waitForRecordDetailStrong(page, recordFrame, permitNumber) {
  const contexts = recordFrame ? [recordFrame, page] : [page];
  const detailSignals = [
    '[id*="lblPermitNumber"]',
    '[id*="capNumber"]',
    '[id*="PermitNumber"]',
    '[id*="lblPermitType"]',
    '[id*="lblCapType"]',
    '[id*="lblPermitStatus"]',
    '[id*="lblCapStatus"]',
    '[id*="PermitDetailList"]',
    '[id*="CAPDetail"]',
    ".aca_page_title",
    '[id*="TabDataList"]',
  ];

  for (let elapsed = 0; elapsed < 20000; elapsed += 2000) {
    for (const ctx of contexts) {
      for (const sel of detailSignals) {
        const el = await ctx.$(sel).catch(() => null);
        if (el) {
          const text = await el
            .evaluate((e) => (e.textContent || "").trim().substring(0, 80))
            .catch(() => "");
          const ctxName =
            ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
          console.log(
            `  ✅ Record detail signal found: sel="${sel}" text="${text}" in ${ctxName}`,
          );
          return ctx;
        }
      }
      const hasPermitText = await ctx
        .evaluate((pn) => {
          return document.body ? document.body.innerText.includes(pn) : false;
        }, permitNumber)
        .catch(() => false);
      if (hasPermitText) {
        const ctxName =
          ctx === page ? "main" : ctx.name ? ctx.name() || "frame" : "frame";
        console.log(
          `  ✅ Permit number "${permitNumber}" found in ${ctxName} body text`,
        );
        return ctx;
      }
    }
    await page.waitForTimeout(2000);
  }

  console.log(
    "  ⚠️ No strong record detail signals found after 20s, proceeding with best-effort extraction",
  );
  await page
    .screenshot({ path: "record_not_loaded.png", fullPage: true })
    .catch(() => {});
  return contexts[0];
}

function getExtractionContext(page) {
  return page._recordFrame || page;
}

async function extractRecordHeader(page) {
  console.log("  📋 Extracting record header...");

  const ctx = getExtractionContext(page);
  const ctxLabel = ctx === page ? "main page" : "record frame";
  console.log(`  Extracting header from: ${ctxLabel}`);

  const header = await ctx.evaluate(() => {
    const result = {
      record_number: "",
      record_type: "",
      record_status: "",
      expiration_date: "",
      _diag: {},
    };

    const root =
      document.querySelector(".rec-left") ||
      document.querySelector('[id*="PlaceHolderMain"]') ||
      document.body;

    const preview = (root.innerText || "").replace(/\s+/g, " ").trim();
    result._diag.container =
      root.id || root.className || root.tagName || "unknown";
    result._diag.preview = preview.slice(0, 300);

    const permitEl =
      root.querySelector('[id*="lblPermitNumber"]') ||
      root.querySelector('[id*="PermitNumber"]');

    if (permitEl) {
      result.record_number = (permitEl.textContent || "").trim();
      result._diag.permit =
        permitEl.id || permitEl.className || permitEl.tagName;
    }

    const typeMatch = preview.match(
      /Record\s+[A-Z0-9-]+:\s*(.*?)\s+Record Status:/i,
    );
    if (typeMatch) {
      result.record_type = typeMatch[1].trim();
    }

    const statusMatch = preview.match(
      /Record Status:\s*(.*?)\s+Expiration Date:/i,
    );
    if (statusMatch) {
      result.record_status = statusMatch[1].trim();
    }

    const expMatch = preview.match(/Expiration Date:\s*([0-9/]+)/i);
    if (expMatch) {
      result.expiration_date = expMatch[1].trim();
    }

    return result;
  });

  const diag = header._diag || {};
  delete header._diag;

  console.log(
    `     Record: ${header.record_number || "unknown"} | Status: ${header.record_status || "unknown"}`,
  );
  console.log(
    `     [DIAG:HEADER] permit=${diag.permit || "none"} container=${diag.container || "none"}`,
  );
  console.log(`     [DIAG:HEADER] preview="${diag.preview || ""}"`);

  return header;
}

async function extractRecordDetails(page) {
  console.log("  📋 Extracting record details...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    const frames = getAccelaChildFrames(page);
    const contentFrame = ctx;
    const rdNavOk = await navigateToRecordInfoSection(
      page,
      frames,
      contentFrame,
      "Record Details",
    );
    if (!rdNavOk) {
      console.log("[Baltimore] Record Details — navigation failed");
      return { fields: {}, tables: [], screenshot: null };
    }
    await saveCheckpointScreenshot(page, "after_record_details").catch(() => {});
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Record Details")',
        'a:has-text("Record Details")',
        'a:has-text("Record Detail")',
        'a[id*="RecordDetail"]',
      ],
      "Record Details",
      { expandRecordInfoFirst: true, checkpointLabel: "after_record_details" },
    );

    if (!found) {
      console.log("     [panel] Record Details: link not found");
      return { fields: {}, tables: [], screenshot: null };
    }
  }

  await page.waitForTimeout(1500);

  const details = await ctx.evaluate(() => {
    const fields = {};
    const badLabels = new Set([
      "add",
      "cancel",
      "*name",
      "name",
      "name:",
      "description:",
      "record status:",
      "expiration date:",
    ]);

    const recordDetailKeywords = [
      "application name",
      "work location",
      "address",
      "parcel",
      "description",
      "job value",
      "project name",
      "applicant",
      "contractor",
      "fee",
      "parcel number",
      "lot",
      "block",
      "project #",
      "application #",
      "permit #",
      "location",
      "project number",
      "permit number",
      "record number",
      "type",
      "status",
      "expiration",
      "issued",
      "submitted",
      "received",
    ];

    const allTables = Array.from(document.querySelectorAll("table"));
    let candidateTables = allTables.filter((table) => {
      const text = (table.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return recordDetailKeywords.some((kw) => text.includes(kw));
    });

    const countLabelValueRows = (table) => {
      let count = 0;
      table.querySelectorAll("tr").forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((c) =>
          (c.textContent || "").replace(/\s+/g, " ").trim(),
        ).filter(Boolean);
        if (cells.length >= 2 && cells[0].length < 80 && cells[1].length < 400) count += 1;
      });
      return count;
    };

    if (candidateTables.length === 0 || candidateTables.every((t) => countLabelValueRows(t) < 2)) {
      const fallbackTables = allTables.filter((table) => {
        const text = (table.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length < 20) return false;
        const rows = table.querySelectorAll("tr");
        if (rows.length < 2) return false;
        return countLabelValueRows(table) >= 1;
      });
      if (fallbackTables.length > 0) {
        candidateTables = fallbackTables;
      }
    }

    for (const target of candidateTables) {
      const rows = target.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        if (cells.length < 2) return;

        const label = cells[0].replace(/:$/, "").trim();
        const value = cells[1].trim();

        if (!label || !value) return;
        if (label.length > 60) return;
        if (value.length > 300) return;
        if (badLabels.has(label.toLowerCase())) return;
        if (value.toLowerCase() === label.toLowerCase()) return;
        if (/^(add|cancel)$/i.test(value)) return;

        fields[label] = value;
      });
    }

    const rowsOut = Object.entries(fields).map(([key, value]) => ({
      key,
      value,
    }));

    return {
      tables: rowsOut.length
        ? [
            {
              title: "Record Details",
              headers: ["Field", "Value"],
              rows: rowsOut,
            },
          ]
        : [],
      fields,
    };
  });

  if (isBaltimorePortal(page)) {
    const recordDetails = await extractBaltimoreRecordDetails(ctx);
    console.log("[Baltimore] Record Details result:", recordDetails);
    if (Object.keys(recordDetails).length > 0) {
      Object.assign(details.fields, recordDetails);
      details.tables = [
        {
          title: "Record Details",
          headers: ["Field", "Value"],
          rows: Object.entries(details.fields).map(([key, value]) => ({ key, value })),
        },
      ];
    }
  }

  const detailScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  details.screenshot = detailScreenshot
    ? detailScreenshot.toString("base64")
    : null;

  const count = Object.keys(details.fields).length;
  console.log(`     [panel] Record Details: ${count} fields extracted`);
  if (count === 0) console.log("     [panel] Record Details: panel empty (no data)");
  return details;
}

async function extractProcessingStatus(page) {
  console.log("  📋 Extracting processing status...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Processing Status",
      );
      if (!navOk) {
        console.log(
          `  [Baltimore] Skipped Processing Status — navigation failed`,
        );
        return { departments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_processing_status").catch(
        () => {},
      );
    } catch (e) {
      console.log(
        `  [Baltimore] Skipped Processing Status — navigation failed`,
      );
      console.log(`  [Baltimore] ${e.message}`);
      return { departments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Processing Status")',
        'a:has-text("Processing Status")',
        'a[id*="ProcessingStatus"]',
        'a:has-text("Workflow")',
        'a:has-text("Workflow Status")',
        '[id*="TabDataList"] a:has-text("Status")',
      ],
      "Processing Status",
      { expandRecordInfoFirst: true, checkpointLabel: "after_processing_status" },
    );

    if (!found) {
      console.log("     [panel] Processing Status: link not found");
      return { departments: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const processingStatus = await extractBaltimoreProcessingStatus(page, contentFrame);
    console.log('[Baltimore] Processing Status result:', processingStatus);
    const departments = (processingStatus.workflowTasks || []).map((t) => ({
      name: t.task,
      status: t.status,
      statusIcon: "",
      date: "",
      details: "",
    }));
    const screenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;
    console.log(`     [panel] Processing Status: ${departments.length} departments/tasks extracted`);
    if (departments.length === 0) console.log("     [panel] Processing Status: panel empty (no data)");
    return { departments, screenshot: screenshotBase64 };
  }

  const expandButtons = await ctx
    .$$(
      '[id*="expand"], .collapse-icon, a[onclick*="expand"], img[src*="expand"], .aca_expand',
    )
    .catch(() => []);
  for (const btn of expandButtons) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);

  const departments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const depts = [];
    const rows = container.querySelectorAll(
      '[id*="WorkflowTask"], [id*="ProcessStatus"] tr, .workflow-task, li[id*="task"]',
    );

    rows.forEach((row) => {
      const nameEl = row.querySelector(
        '[id*="TaskName"], .task-name, td:first-child, span.ACA_SmLabel',
      );
      const statusEl = row.querySelector(
        '[id*="TaskStatus"], .task-status, [class*="status"]',
      );
      const dateEl = row.querySelector(
        '[id*="DueDate"], [id*="Date"], .task-date',
      );
      const detailEl = row.querySelector(
        '[id*="Comment"], [id*="Detail"], .task-detail',
      );

      const name = nameEl ? nameEl.textContent.trim() : "";
      const statusText = statusEl ? statusEl.textContent.trim() : "";

      const checkImg = row.querySelector(
        'img[src*="check"], img[src*="complete"], img[src*="green"]',
      );
      const clockImg = row.querySelector(
        'img[src*="clock"], img[src*="pending"], img[src*="yellow"], img[src*="wait"]',
      );
      let statusIcon = "";
      if (checkImg) statusIcon = "complete";
      else if (clockImg) statusIcon = "pending";

      if (name && name.length < 100) {
        depts.push({
          name,
          status: statusText,
          statusIcon,
          date: dateEl ? dateEl.textContent.trim() : "",
          details: detailEl ? detailEl.textContent.trim() : "",
        });
      }
    });

    if (depts.length === 0) {
      const allTables = container.querySelectorAll("table");
      for (const table of allTables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow) continue;
        const headers = Array.from(headerRow.querySelectorAll("th, td")).map(
          (h) => h.textContent.trim().toLowerCase(),
        );
        if (
          headers.some(
            (h) =>
              h.includes("task") ||
              h.includes("department") ||
              h.includes("step"),
          )
        ) {
          const dataRows = table.querySelectorAll("tr:not(:first-child)");
          dataRows.forEach((dr) => {
            const cells = dr.querySelectorAll("td");
            if (cells.length >= 2) {
              const checkImg = dr.querySelector(
                'img[src*="check"], img[src*="complete"], img[src*="green"]',
              );
              const clockImg = dr.querySelector(
                'img[src*="clock"], img[src*="pending"], img[src*="yellow"]',
              );
              depts.push({
                name: cells[0].textContent.trim(),
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                statusIcon: checkImg ? "complete" : clockImg ? "pending" : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                details: cells.length > 3 ? cells[3].textContent.trim() : "",
              });
            }
          });
          break;
        }
      }
    }

    return depts;
  });

  const screenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;

  console.log(`     [panel] Processing Status: ${departments.length} departments/tasks extracted`);
  if (departments.length === 0) console.log("     [panel] Processing Status: panel empty (no data)");
  return { departments, screenshot: screenshotBase64 };
}

async function extractBaltimoreProcessingStatus(page, contentFrame) {
  try {
    // Wait for the loading overlay to disappear in contentFrame
    try {
      await contentFrame.waitForFunction(
        () => {
          const blocker = document.getElementById("iframeBlocker");
          return (
            !blocker ||
            blocker.style.display === "none" ||
            !blocker.offsetParent
          );
        },
        { timeout: 10000 },
      );
      console.log("[Baltimore ProcessingStatus] Blocker cleared");
    } catch (e) {
      console.log("[Baltimore ProcessingStatus] Blocker wait timeout");
    }

    // Additional settle time
    await new Promise((r) => setTimeout(r, 1500));

    const tasks = await contentFrame.evaluate(() => {
      const results = [];

      // Find all elements containing task-like text with status icons
      // Processing Status rows are direct children of the main content area
      // Each row: status icon img + arrow button + department name text

      // Strategy: find all imgs in the page, check their parent rows
      const imgs = [...document.querySelectorAll("img")];

      for (const img of imgs) {
        const row =
          img.closest("li, tr, div.workflow_row, div[class*=\"row\"]") ||
          img.parentElement;
        if (!row) continue;

        const text = (row.innerText || "").trim();
        const firstLine = text.split("\n")[0].trim();

        if (!firstLine || firstLine.length < 3 || firstLine.length > 120)
          continue;

        // Must not be navigation/chrome noise
        const noise = [
          "logout",
          "cart",
          "collections",
          "logged in",
          "search",
          "home",
          "permits and",
          "licensed",
          "key to processing",
          "expand for",
          "microsoft",
          "notice",
          "translate",
          "language",
          "arabic",
          "chinese",
          "french",
          "korean",
          "spanish",
          "add to cart",
          "add to collection",
          "select",
          "active (plan review",
          "more details",
          "loading...",
          "original text",
          "schedule or request",
          "view entire tree",
          "create amendment",
          "add to cart",
          "add to collection",
        ];
        if (noise.some((n) => firstLine.toLowerCase().includes(n))) continue;

        // Row must be inside or after the Processing Status heading
        // Check if any ancestor or preceding text mentions Processing Status
        let el = row;
        let inSection = false;
        for (let i = 0; i < 10; i++) {
          if (!el) break;
          if ((el.innerText || "").includes("Processing Status")) {
            inSection = true;
            break;
          }
          el = el.parentElement;
        }
        if (!inSection) continue;

        // Derive status from img attributes
        let status = "Unknown";
        const hint = (
          (img.src || "") +
          (img.alt || "") +
          (img.title || "")
        ).toLowerCase();
        if (hint.includes("complete") || hint.includes("check"))
          status = "Complete";
        else if (hint.includes("previously") || hint.includes("orange"))
          status = "Previously Active";
        else if (hint.includes("active")) status = "Active";

        // Avoid duplicate task names
        if (results.some((r) => r.task === firstLine)) continue;

        results.push({ task: firstLine, status, expanded: false });
      }

      return results;
    });

    console.log(`[Baltimore ProcessingStatus] Extracted ${tasks.length} tasks`);

    if (tasks.length === 0) {
      const preview = await contentFrame.evaluate(() =>
        (document.body ? document.body.innerText : "no body").substring(0, 400),
      );
      console.log(
        "[Baltimore ProcessingStatus] WARNING: 0 tasks — innerText preview:",
        preview,
      );
    }

    return { workflowTasks: tasks };
  } catch (err) {
    console.log("[Baltimore ProcessingStatus] ERROR:", err.message);
    return { workflowTasks: [] };
  }
}

async function extractBaltimoreRelatedRecords(page, contentFrame) {
  try {

    // Helper to extract table rows from an evaluate context
    // Returns array of row objects using th headers as keys
    const extractTable = (tableEl) => {
      if (!tableEl) return [];
      const rows = [];
      const headers = [];
      const ths = tableEl.querySelectorAll('th');
      ths.forEach(th => headers.push(th.innerText.trim().toLowerCase()
        .replace(/\s+/g, '_')));

      const trs = tableEl.querySelectorAll('tr');
      trs.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 0) return;
        const row = {};
        tds.forEach((td, i) => {
          const key = headers[i] || ('col_' + i);
          row[key] = td.innerText.trim();
        });
        const vals = Object.values(row).join('').trim();
        if (vals.length > 0) rows.push(row);
      });
      return rows;
    };

    // Try main page first
    let rows = await page.evaluate(() => {
      function findRelatedRecordsTable() {
        const tables = [...document.querySelectorAll("table")];

        for (const table of tables) {
          // Check 1: table has Record Number header
          const ths = [...table.querySelectorAll("th")];
          const hasRecordNumHeader = ths.some((th) =>
            th.innerText.trim().toLowerCase().includes("record"),
          );
          if (hasRecordNumHeader) return table;

          // Check 2: ancestor heading contains "Related Records"
          let el = table.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!el) break;
            const heading = el.querySelector(
              "h2,h3,h4,caption,strong,b",
            );
            if (heading && heading.innerText.includes("Related Records")) {
              return table;
            }
            el = el.parentElement;
          }

          // Check 3: preceding sibling heading
          let prev = table.previousElementSibling;
          for (let i = 0; i < 5; i++) {
            if (!prev) break;
            if (prev.innerText && prev.innerText.includes("Related Records")) {
              return table;
            }
            prev = prev.previousElementSibling;
          }
        }
        return null;
      }

      function extractRowsFromTable(table) {
        const rows = [];
        const headerRow = table.querySelector("tr");
        if (!headerRow) return [];

        const headerCells = [...headerRow.querySelectorAll("th, td")];
        const headers = headerCells.map((c) =>
          c.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
        );

        const dataRows = [...table.querySelectorAll("tr")].slice(1);

        for (const tr of dataRows) {
          const tds = [...tr.querySelectorAll("td")];
          if (tds.length === 0) continue;

          const row = {};
          tds.forEach((td, i) => {
            const key = headers[i] || "col_" + i;
            row[key] = td.innerText.trim();
          });

          const allEmpty = Object.values(row).every(
            (v) => !v || v.trim() === "",
          );
          if (allEmpty) continue;

          const recordNum = row.record_number || row.col_0 || "";
          if (!recordNum || recordNum.trim() === "") continue;
          const lastRow = rows[rows.length - 1];
          const lastNum = lastRow
            ? lastRow.record_number || lastRow.col_0 || ""
            : "";
          if (recordNum && recordNum === lastNum) continue;
          rows.push(row);
        }

        return rows;
      }

      const table = findRelatedRecordsTable();
      if (!table) return [];
      return extractRowsFromTable(table);
    });

    // If main page found nothing, try contentFrame
    if (!rows || rows.length === 0) {
      rows = await contentFrame.evaluate(() => {
        function findRelatedRecordsTable() {
          const tables = [...document.querySelectorAll("table")];

          for (const table of tables) {
            const ths = [...table.querySelectorAll("th")];
            const hasRecordNumHeader = ths.some((th) =>
              th.innerText.trim().toLowerCase().includes("record"),
            );
            if (hasRecordNumHeader) return table;

            let el = table.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!el) break;
              const heading = el.querySelector(
                "h2,h3,h4,caption,strong,b",
              );
              if (heading && heading.innerText.includes("Related Records")) {
                return table;
              }
              el = el.parentElement;
            }

            let prev = table.previousElementSibling;
            for (let i = 0; i < 5; i++) {
              if (!prev) break;
              if (prev.innerText && prev.innerText.includes("Related Records")) {
                return table;
              }
              prev = prev.previousElementSibling;
            }
          }
          return null;
        }

        function extractRowsFromTable(table) {
          const rows = [];
          const headerRow = table.querySelector("tr");
          if (!headerRow) return [];

          const headerCells = [...headerRow.querySelectorAll("th, td")];
          const headers = headerCells.map((c) =>
            c.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
          );

          const dataRows = [...table.querySelectorAll("tr")].slice(1);

          for (const tr of dataRows) {
            const tds = [...tr.querySelectorAll("td")];
            if (tds.length === 0) continue;

            const row = {};
            tds.forEach((td, i) => {
              const key = headers[i] || "col_" + i;
              row[key] = td.innerText.trim();
            });

            const allEmpty = Object.values(row).every(
              (v) => !v || v.trim() === "",
            );
            if (allEmpty) continue;

            const recordNum = row.record_number || row.col_0 || "";
            if (!recordNum || recordNum.trim() === "") continue;
            const lastRow = rows[rows.length - 1];
            const lastNum = lastRow
              ? lastRow.record_number || lastRow.col_0 || ""
              : "";
            if (recordNum && recordNum === lastNum) continue;
            rows.push(row);
          }

          return rows;
        }

        const table = findRelatedRecordsTable();
        if (!table) return [];
        return extractRowsFromTable(table);
      });
      console.log('[Baltimore RelatedRecords] Found in: contentFrame');
    } else {
      console.log('[Baltimore RelatedRecords] Found in: main page');
    }

    console.log(`[Baltimore RelatedRecords] Extracted ${rows.length} records`);
    return { relatedRecords: rows || [] };

  } catch (err) {
    console.log('[Baltimore RelatedRecords] ERROR:', err.message);
    return { relatedRecords: [] };
  }
}

async function extractBaltimorePayments(page, contentFrame) {
  try {
    let result = await page.evaluate(() => {
      function findFeesTable() {
        const tables = [...document.querySelectorAll("table")];

        for (const table of tables) {
          const ths = [...table.querySelectorAll("th")];
          const headerText = ths
            .map((th) => th.innerText.toLowerCase())
            .join(" ");
          if (headerText.includes("amount") || headerText.includes("invoice")) {
            return table;
          }

          let prev = table.previousElementSibling;
          for (let i = 0; i < 5; i++) {
            if (!prev) break;
            if (
              prev.innerText &&
              (prev.innerText.includes("Fees") ||
                prev.innerText.includes("Paid"))
            ) {
              return table;
            }
            prev = prev.previousElementSibling;
          }
        }
        return null;
      }

      function extractFeeRows(table) {
        const fees = [];
        const ths = [...table.querySelectorAll("th")];
        const headers = ths.map((th) =>
          th.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
        );
        // Baltimore Fees table headers are: Date | Invoice Number | Amount
        // If headers are empty or wrong, force the correct mapping
        const normalizedHeaders = headers.map((h, i) => {
          if (h.includes("date") || i === 0) return "date";
          if (h.includes("invoice") || h.includes("number") || i === 1)
            return "invoice_number";
          if (h.includes("amount") || i === 2) return "amount";
          return h || "col_" + i;
        });

        table.querySelectorAll("tr").forEach((tr) => {
          const tds = [...tr.querySelectorAll("td")];
          if (tds.length === 0) return;
          const raw = {};
          tds.forEach((td, i) => {
            raw[normalizedHeaders[i] || "col_" + i] = td.innerText.trim();
          });
          const row = { date: "", invoice_number: "", amount: "" };
          for (const [k, v] of Object.entries(raw)) {
            const key = k.toLowerCase();
            if (key.includes("date")) row.date = v;
            else if (key.includes("invoice")) row.invoice_number = v;
            else if (key.includes("amount")) row.amount = v;
          }
          // Skip pagination/noise rows
          const rowText = Object.values(row).join(" ").toLowerCase();
          if (
            rowText.includes("prev") ||
            rowText.includes("next") ||
            rowText.includes("additional results") ||
            rowText.includes("total paid")
          )
            return;

          // Skip rows where amount cell doesn't look like money
          const amount = row.amount || "";
          if (!amount.includes("$") && !amount.match(/^\d/)) return;

          const nonempty =
            (row.date || row.invoice_number || row.amount || "").trim().length >
            0;
          if (nonempty) fees.push(row);
        });
        return fees;
      }

      function findTotalPaidFees() {
        const els = [...document.querySelectorAll("*")];
        for (const el of els) {
          const t = el.innerText || "";
          if (t.includes("Total paid fees:")) {
            return el.innerText.trim();
          }
        }
        return null;
      }

      const table = findFeesTable();
      const fees = table ? extractFeeRows(table) : [];
      const totalPaidFees = findTotalPaidFees();
      return { fees, totalPaidFees };
    });

    if (!result || !result.fees || result.fees.length === 0) {
      result = await contentFrame.evaluate(() => {
        function findFeesTable() {
          const tables = [...document.querySelectorAll("table")];

          for (const table of tables) {
            const ths = [...table.querySelectorAll("th")];
            const headerText = ths
              .map((th) => th.innerText.toLowerCase())
              .join(" ");
            if (headerText.includes("amount") || headerText.includes("invoice")) {
              return table;
            }

            let prev = table.previousElementSibling;
            for (let i = 0; i < 5; i++) {
              if (!prev) break;
              if (
                prev.innerText &&
                (prev.innerText.includes("Fees") ||
                  prev.innerText.includes("Paid"))
              ) {
                return table;
              }
              prev = prev.previousElementSibling;
            }
          }
          return null;
        }

        function extractFeeRows(table) {
          const fees = [];
          const ths = [...table.querySelectorAll("th")];
          const headers = ths.map((th) =>
            th.innerText.trim().toLowerCase().replace(/\s+/g, "_"),
          );
          // Baltimore Fees table headers are: Date | Invoice Number | Amount
          // If headers are empty or wrong, force the correct mapping
          const normalizedHeaders = headers.map((h, i) => {
            if (h.includes("date") || i === 0) return "date";
            if (h.includes("invoice") || h.includes("number") || i === 1)
              return "invoice_number";
            if (h.includes("amount") || i === 2) return "amount";
            return h || "col_" + i;
          });

          table.querySelectorAll("tr").forEach((tr) => {
            const tds = [...tr.querySelectorAll("td")];
            if (tds.length === 0) return;
            const raw = {};
            tds.forEach((td, i) => {
              raw[normalizedHeaders[i] || "col_" + i] = td.innerText.trim();
            });
            const row = { date: "", invoice_number: "", amount: "" };
            for (const [k, v] of Object.entries(raw)) {
              const key = k.toLowerCase();
              if (key.includes("date")) row.date = v;
              else if (key.includes("invoice")) row.invoice_number = v;
              else if (key.includes("amount")) row.amount = v;
            }
            // Skip pagination/noise rows
            const rowText = Object.values(row).join(" ").toLowerCase();
            if (
              rowText.includes("prev") ||
              rowText.includes("next") ||
              rowText.includes("additional results") ||
              rowText.includes("total paid")
            )
              return;

            // Skip rows where amount cell doesn't look like money
            const amount = row.amount || "";
            if (!amount.includes("$") && !amount.match(/^\d/)) return;

            const nonempty =
              (row.date || row.invoice_number || row.amount || "").trim()
                .length > 0;
            if (nonempty) fees.push(row);
          });
          return fees;
        }

        function findTotalPaidFees() {
          const els = [...document.querySelectorAll("*")];
          for (const el of els) {
            const t = el.innerText || "";
            if (t.includes("Total paid fees:")) {
              return el.innerText.trim();
            }
          }
          return null;
        }

        const table = findFeesTable();
        const fees = table ? extractFeeRows(table) : [];
        const totalPaidFees = findTotalPaidFees();
        return { fees, totalPaidFees };
      });
      console.log("[Baltimore Payments] Found in: contentFrame");
    } else {
      console.log("[Baltimore Payments] Found in: main page");
    }

    const fees = (result && result.fees) || [];
    const totalPaidFees =
      result && result.totalPaidFees != null ? result.totalPaidFees : null;
    console.log(`[Baltimore Payments] Extracted ${fees.length} fee rows`);

    return {
      fees,
      totalPaidFees,
      note: "Paginated — showing visible page only",
    };
  } catch (err) {
    console.log("[Baltimore Payments] ERROR:", err.message);
    return {
      fees: [],
      totalPaidFees: null,
      note: "Paginated — showing visible page only",
    };
  }
}

/**
 * Baltimore Plan Review: summary/status page is div/span (.pil-section, .pil-subsection-title, .pil-subsection-value).
 * Do NOT use table-based logic; scope extraction to Plan Review container only to avoid capturing Processing Status table.
 */
async function extractPlanReviewSummaryBaltimore(ctx) {
  return ctx.evaluate(() => {
    const summary = {};
    const downloadLinks = [];

    const sectionTitle = Array.from(document.querySelectorAll(".pil-section-title, [class*=\"section-title\"]")).find(
      (el) => (el.textContent || "").trim().toLowerCase().includes("plan review status"),
    );
    const container = sectionTitle ? sectionTitle.closest(".pil-section") || sectionTitle.parentElement : null;
    if (!container) {
      return { summary: {}, downloadLinks: [] };
    }

    container.querySelectorAll(".pil-subsection-title, [class*=\"subsection-title\"]").forEach((labelEl) => {
      const label = (labelEl.textContent || "").replace(/:$/, "").trim();
      if (!label) return;
      let valueEl = labelEl.nextElementSibling;
      if (!valueEl || !valueEl.classList || (!valueEl.classList.contains("pil-subsection-value") && !valueEl.className.includes("subsection-value"))) {
        const parent = labelEl.closest("div");
        if (parent) {
          const val = parent.querySelector(".pil-subsection-value, [class*=\"subsection-value\"]");
          if (val) valueEl = val;
        }
      }
      const value = valueEl ? (valueEl.textContent || "").replace(/\s+/g, " ").trim() : "";
      if (label.length < 100) summary[label] = value;
    });

    container.querySelectorAll("a.pil-button-link, a.pil-link, .pil-button-inline a, a[href]").forEach((a) => {
      const text = (a.textContent || "").trim();
      const href = (a.getAttribute("href") || "").trim();
      if (text && text.length < 200) downloadLinks.push({ label: text, href: href || "" });
    });

    const keyMap = {
      "Review Type": "reviewType",
      "Total Number of Files": "totalNumberOfFiles",
      "Time Elapsed": "timeElapsed",
      "Prescreen Review Comments (Unresolved)": "prescreenReviewComments",
      "Time with Jurisdiction": "timeWithJurisdiction",
      "Time with Applicant": "timeWithApplicant",
      "Status": "status",
      "Current Non-Completed Tasks": "currentNonCompletedTasks",
    };
    const normalized = {};
    Object.keys(keyMap).forEach((k) => {
      if (summary[k] !== undefined) normalized[keyMap[k]] = summary[k];
    });
    normalized.rawFields = summary;

    return { summary: normalized, downloadLinks };
  });
}

async function extractPlanReview(page) {
  console.log("  📋 Extracting plan review...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    // [Baltimore] Plan Review scraping disabled —
    // Plan Review tab not present on Baltimore ACA records
    // const prNavOk = await navigateToPlanReview(page, ctx);
    // if (prNavOk) {
    //   const planReview = await extractPlanReviewSummaryBaltimore(ctx);
    //   console.log("[Baltimore] Plan Review result:", planReview);
    // }
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
  }

  const { found } = await clickAccelaNavPanel(
    ctx,
    page,
    [
      '[id*="TabDataList"] a:has-text("Plan Review")',
      'a:has-text("Plan Review")',
      'a[id*="PlanReview"]',
    ],
    "Plan Review",
    { checkpointLabel: "after_plan_review" },
  );

  if (!found) {
    console.log("     [panel] Plan Review: link not found");
    return {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
  }

  await page.waitForTimeout(1500);

  const data = await ctx.evaluate(() => {
    const comments = [];
    const candidateTables = Array.from(document.querySelectorAll("table")).filter((table) => {
      const text = (table.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      return (
        text.includes("reviewer") ||
        text.includes("department") ||
        text.includes("comment") ||
        text.includes("review status")
      );
    });
    const root = candidateTables[0] || null;
    if (!root) return { comments: [], text: "" };
    root.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("td"))
        .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (cells.length >= 3) {
        comments.push({
          reviewer: cells[0] || "",
          department: cells[1] || "",
          comment: cells[2] || "",
          date: cells[3] || "",
        });
      }
    });
    const text = comments.length
      ? comments
          .map((c) =>
            [
              c.reviewer ? `Reviewer: ${c.reviewer}` : "",
              c.department ? `Department: ${c.department}` : "",
              c.comment ? `Comment: ${c.comment}` : "",
              c.date ? `Date: ${c.date}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n")
      : "";
    return { comments, text };
  });

  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const screenshotBase64 = screenshot ? screenshot.toString("base64") : null;
  console.log(`     [panel] Plan Review: ${data.comments.length} review comments extracted`);
  if (data.comments.length === 0) console.log("     [panel] Plan Review: panel empty (no data)");
  return {
    comments: data.comments,
    text: data.text,
    screenshot: screenshotBase64,
    planReviewSummary: null,
    downloadLinks: [],
  };
}

async function extractRelatedRecords(page) {
  console.log("  📋 Extracting related records...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Related Records",
      );
      if (!navOk) {
        console.log(
          `  [Baltimore] Skipped Related Records — navigation failed`,
        );
        return { records: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_related_records").catch(
        () => {},
      );
    } catch (e) {
      console.log(`  [Baltimore] Skipped Related Records — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { records: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Related Records")',
        'a:has-text("Related Records")',
        'a[id*="RelatedRecord"]',
        'a:has-text("Related Record")',
        'a[id*="Related"]',
      ],
      "Related Records",
      { expandRecordInfoFirst: true, checkpointLabel: "after_related_records" },
    );

    if (!found) {
      console.log("     [panel] Related Records: link not found");
      return { records: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const relatedRecords = await extractBaltimoreRelatedRecords(page, contentFrame);
    console.log('[Baltimore] Related Records result:', relatedRecords);
    const raw = relatedRecords.relatedRecords || [];
    const records = raw.map((row) => ({
      record_number: row.record_number ?? row.col_0 ?? "",
      record_type: row.record_type ?? row.col_1 ?? "",
      project_name: row.project_name ?? row.col_2 ?? "",
      date: row.date ?? row.col_3 ?? "",
      status: row.status ?? "",
    }));
    const relScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    console.log(`     [panel] Related Records: ${records.length} records extracted`);
    if (records.length === 0) console.log("     [panel] Related Records: panel empty (no data)");
    return {
      records,
      screenshot: relScreenshot ? relScreenshot.toString("base64") : null,
    };
  }

  const viewTree = await ctx.$(
    'a:has-text("View Entire Tree"), a:has-text("Entire Tree")',
  );
  if (viewTree && (await viewTree.isVisible().catch(() => false))) {
    await viewTree.click().catch(() => {});
    await waitForAccelaLoad(page);
  }

  const records = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const results = [];
    container
      .querySelectorAll('[id*="RelatedRecord"] tr, [id*="Related"] table tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const recordNum = cells[0].textContent.trim();
          if (recordNum && !recordNum.toLowerCase().includes("record number")) {
            results.push({
              record_number: recordNum,
              record_type: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              project_name: cells.length > 3 ? cells[3].textContent.trim() : "",
              date: cells.length > 4 ? cells[4].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const relScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     [panel] Related Records: ${records.length} records extracted`);
  if (records.length === 0) console.log("     [panel] Related Records: panel empty (no data)");
  return {
    records,
    screenshot: relScreenshot ? relScreenshot.toString("base64") : null,
  };
}

/**
 * Runs in browser: scrape attachment table rows from Accela content (main frame or iframe).
 * @param {boolean} [baltimoreIframeTable] - when true, prefer main `table` in iframe; rows are direct `tr` children
 */
function accelaExtractAttachmentRowsInPage(baltimoreIframeTable) {
  const _cSelsTail = [
    "#ctl00_PlaceHolderMain_uploadedFiles",
    '[id*="uploadedFiles"]',
    '[id*="AttachmentList"]',
    "#ctl00_PlaceHolderMain_PermitDetailList",
    "#ctl00_PlaceHolderMain_CAPDetail",
    '[id*="PlaceHolderMain"][id*="Detail"]',
    '[id*="PlaceHolderMain"][id*="Permit"]',
    '[id*="PlaceHolderMain"][id*="Record"]',
    '[id*="PlaceHolderMain"][id*="Cap"]',
    "#ctl00_PlaceHolderMain_TabDataList",
    "#ctl00_PlaceHolderMain_pnlContent",
    "#ctl00_PlaceHolderMain",
  ];
  const _cSels = baltimoreIframeTable
    ? [
        "table",
        ".document_status_list",
        '[class*="document_status"]',
        ..._cSelsTail,
      ]
    : [
        ".document_status_list",
        '[class*="document_status"]',
        ..._cSelsTail,
      ];
  let container = document.body;
  for (const s of _cSels) {
    const e = document.querySelector(s);
    if (e && e.textContent.trim().length > 10) {
      container = e;
      break;
    }
  }
  if (!container || !container.querySelectorAll) container = document.body;

  const results = [];
  const rowSel = baltimoreIframeTable
    ? "tr"
    : '[id*="Attachment"] tr, [id*="Document"] tr';
  const rowNodes =
    container && container.querySelectorAll
      ? container.querySelectorAll(rowSel)
      : [];
  rowNodes.forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) return;

    const name = cells[0].textContent.trim();

    // Skip pagination and action rows
    if (
      !name ||
      name.includes("< Prev") ||
      name.includes("Next >") ||
      /^\d+$/.test(name) ||
      name === "View Details" ||
      name === "Action" ||
      name === "Name" ||
      name.toLowerCase().includes("file name") ||
      name.toLowerCase().includes("document name")
    ) {
      return;
    }

    // Only keep rows that look like actual filenames or have a size value
    const hasSize = cells.length > 5 && cells[5].textContent.trim().length > 0;
    const looksLikeFile = name.includes(".") || hasSize;
    if (!looksLikeFile) return;

    if (name.length >= 200) return;

    const actionLinks = row.querySelectorAll("a");
    let hasDownload = false;
    for (const a of actionLinks) {
      const t = a.textContent.trim().toLowerCase();
      if (t.includes("download") || t.includes("view")) hasDownload = true;
    }
    results.push({
      name,
      record_id: cells.length > 1 ? cells[1].textContent.trim() : "",
      record_type: cells.length > 2 ? cells[2].textContent.trim() : "",
      entity_type: cells.length > 3 ? cells[3].textContent.trim() : "",
      type: cells.length > 4 ? cells[4].textContent.trim() : "",
      size: cells.length > 5 ? cells[5].textContent.trim() : "",
      latest_update: cells.length > 6 ? cells[6].textContent.trim() : "",
      rowIndex: Array.from(row.parentElement.children).indexOf(row),
      hasDownload,
    });
  });
  return results;
}

/** Normalize permit / record numbers for safe comparison (spacing, case). */
function normalizePermitNumberKey(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * TEMP (Baltimore): Only `tabs.info` (Record Details) + `tabs.attachments` in portalData;
 * other tab keys are omitted and their extractors are skipped. Set `false` to restore full portal payload.
 */
const BALTIMORE_MINIMAL_PORTAL_TABS = true;

/**
 * Parse __doPostBack('target','arg') for the "Next >" pager link in the attachment iframe.
 */
async function baltimoreParseAttachmentNextPostBack(frame) {
  return frame
    .evaluate(() => {
      const anchors = [...document.querySelectorAll("a")];
      const nextA = anchors.find((a) => {
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        return t === "Next >" || /^Next\s*>$/i.test(t);
      });
      if (!nextA) return null;
      const href = (nextA.getAttribute("href") || "").trim();
      const onclick = (nextA.getAttribute("onclick") || "").trim();
      const src = href.includes("__doPostBack")
        ? href
        : onclick.includes("__doPostBack")
          ? onclick
          : href;
      const m = /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(
        src,
      );
      if (!m) return null;
      return { target: m[1], argument: m[2] || "" };
    })
    .catch(() => null);
}

/**
 * Replay ASP.NET WebForms postback: serialize the iframe form, set __EVENT*, POST with cookies,
 * replace document (same-origin fetch). Primary Baltimore attachment pager — not UI click.
 */
async function baltimoreSubmitAttachmentIframeFormPost(
  frame,
  eventTarget,
  eventArgument,
) {
  return frame.evaluate(
    async ({ eventTarget: et, eventArgument: ea }) => {
      const form =
        document.getElementById("aspnetForm") ||
        document.querySelector("form#aspnetForm") ||
        document.forms[0];
      if (!form) return { ok: false, error: "no_form" };
      const rawAction = form.getAttribute("action") || window.location.pathname;
      const absAction = new URL(rawAction, window.location.href).href;
      const params = new URLSearchParams();
      for (const el of form.querySelectorAll("input, select, textarea")) {
        if (!el.name) continue;
        const tag = el.tagName.toLowerCase();
        if (tag === "input") {
          const type = (el.type || "text").toLowerCase();
          if (type === "submit" || type === "button") continue;
          if (type === "checkbox" || type === "radio") {
            if (el.checked) params.append(el.name, el.value);
          } else {
            params.append(el.name, el.value);
          }
        } else if (tag === "select") {
          for (const o of el.selectedOptions) {
            params.append(el.name, o.value);
          }
        } else {
          params.append(el.name, el.value);
        }
      }
      params.set("__EVENTTARGET", et);
      params.set("__EVENTARGUMENT", ea || "");
      try {
        const r = await fetch(absAction, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: window.location.href,
          },
          body: params.toString(),
        });
        const html = await r.text();
        if (!r.ok) {
          return {
            ok: false,
            status: r.status,
            error: "http_" + r.status,
          };
        }
        document.open();
        document.write(html);
        document.close();
        return { ok: true, status: r.status };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
    { eventTarget, eventArgument: eventArgument || "" },
  );
}

async function baltimoreReadAttachmentPageSignature(frame) {
  return frame
    .evaluate(() => {
      const vsEl = document.querySelector('input[name="__VIEWSTATE"]');
      const vs = vsEl ? vsEl.value || "" : "";
      const names = [...document.querySelectorAll("table tr td:first-child")]
        .map((c) => (c.textContent || "").trim())
        .filter(
          (t) =>
            t &&
            !t.includes("Next") &&
            !t.includes("Prev") &&
            !/^Name$/i.test(t),
        );
      return { viewStateTail: vs.slice(-64), rowKeys: names.sort().join("|") };
    })
    .catch(() => ({ viewStateTail: "", rowKeys: "" }));
}


async function downloadBaltimoreAttachmentForRow(page, att, frame, deps) {
  const {
    DOWNLOADS_DIR,
    supabaseProjectId,
    uploadFn,
    baltimoreRowFilenameLinkLocator,
    baltimoreDlState,
  } = deps;

  const iframeLinks = await frame
    .evaluate(() =>
      [...document.querySelectorAll("a")]
        .map((a) => a.innerText.trim())
        .filter(
          (t) =>
            t.length > 5 &&
            ![
              "Record ID",
              "Record Type",
              "Entity Type",
              "Latest Update",
              "Entity",
              "Next >",
              "< Prev",
              "Resubmit",
              "Actions",
              "View Details",
              "Name",
              "Size",
              "Type",
            ].includes(t),
        ),
    )
    .catch(() => []);
  const visibleFilenamesForLog = Array.isArray(iframeLinks)
    ? [...iframeLinks]
    : [];
  let link = baltimoreRowFilenameLinkLocator(frame, att.name);
  let found = (await link.count()) > 0;

  if (!found) {
    att.downloadStatus = "failed";
    att.downloadError = "link_not_found";
    console.log(
      `[Baltimore Attach] FAIL ${att.name} link_not_found filesOnPage=${JSON.stringify(visibleFilenamesForLog.slice(0, 12))}`,
    );
    return;
  }

  try {
    let baltimoreCapturePath = null;
    let baltimoreUploadKey = null;
    const context = page.context();
    const frameUrlsBefore = page.frames().map((f) => f.url());

    const capturedResponses = [];
    const onResponse = (resp) => {
      try {
        const headers = resp.headers();
        const ct = (headers["content-type"] || "").toLowerCase();
        const cd = (headers["content-disposition"] || "").toLowerCase();
        if (
          ct.includes("application/pdf") ||
          cd.includes("attachment") ||
          resp.url().toLowerCase().includes(".pdf")
        ) {
          capturedResponses.push(resp);
        }
      } catch (_) {}
    };
    baltimoreDlState.onResponse = onResponse;
    page.on("response", onResponse);

    let resolvedDownload = null;
    let popupPageAfterClick = null;
    let contextSpawnedAfterClick = null;

    if (!baltimoreDlState.clickCompareDone) {
      try {
        const popupPromiseM1 = page
          .waitForEvent("popup", { timeout: 12000 })
          .catch(() => null);
        const contextPagePromiseM1 = context
          .waitForEvent("page", { timeout: 12000 })
          .catch(() => null);
        const downloadPromiseM1 = page
          .waitForEvent("download", { timeout: 12000 })
          .catch(() => null);

        await link.click({ force: true });
        await new Promise((r) => setTimeout(r, 2500));
        const d1 = await downloadPromiseM1;
        const popupM1 = await popupPromiseM1;
        const ctxPageM1 = await contextPagePromiseM1;
        popupPageAfterClick = popupM1;
        contextSpawnedAfterClick = ctxPageM1;

        let download = d1;
        if (!download) {
          const downloadPromise2 = page
            .waitForEvent("download", { timeout: 25000 })
            .catch(() => null);
          const popupPromise2 = page
            .waitForEvent("popup", { timeout: 10000 })
            .catch(() => null);
          const contextPagePromise2 = context
            .waitForEvent("page", { timeout: 10000 })
            .catch(() => null);
          await frame
            .evaluate((fname) => {
              const norm = (s) =>
                (s || "").replace(/\s+/g, " ").trim();
              const rows = [...document.querySelectorAll("tr")];
              let a = null;
              for (const tr of rows) {
                const inRow = [...tr.querySelectorAll("a")];
                const hit = inRow.find(
                  (el) =>
                    norm(el.innerText) === norm(fname) ||
                    norm(el.textContent).includes(fname),
                );
                if (hit) {
                  a = hit;
                  break;
                }
              }
              if (!a) {
                return { error: "anchor not found for Method2 (row-scoped)" };
              }
              const href = (a.getAttribute("href") || "").trim();
              const onclickAttr = a.getAttribute("onclick") || "";
              const db =
                typeof window.__doPostBack === "function"
                  ? window.__doPostBack
                  : null;
              let invoked = null;
              if (db && href.includes("__doPostBack")) {
                const m = href.match(
                  /__doPostBack\s*\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/,
                );
                if (m) {
                  try {
                    db(m[1], m[2]);
                    invoked = {
                      type: "href__doPostBack",
                      target: m[1],
                      argument: m[2],
                    };
                  } catch (e) {
                    return {
                      error: "doPostBack threw: " + String(e.message),
                      href,
                    };
                  }
                }
              }
              if (!invoked && onclickAttr) {
                const code = onclickAttr.replace(
                  /^\s*javascript:\s*/i,
                  "",
                );
                try {
                  const fn = new Function(code);
                  fn.call(a);
                  invoked = { type: "onclick_newFunction" };
                } catch (e1) {
                  try {
                    (0, eval)(code);
                    invoked = { type: "onclick_eval" };
                  } catch (e2) {
                    return {
                      error:
                        "onclick failed: " +
                        String(e2.message),
                      onclickSnippet: onclickAttr.slice(0, 300),
                    };
                  }
                }
              }
              if (!invoked) {
                return {
                  error: "no invokable postback/onclick",
                  href,
                  onclickSnippet: onclickAttr.slice(0, 300),
                  doPostBackDefined:
                    typeof window.__doPostBack === "function",
                };
              }
              return {
                ok: true,
                invoked,
                href,
                onclickSnippet: onclickAttr.slice(0, 300),
                iframeUrlAfterInvoke: window.location.href,
                doPostBackDefined:
                  typeof window.__doPostBack === "function",
              };
            }, att.name)
            .catch((e) => ({ error: String(e.message) }));
          await new Promise((r) => setTimeout(r, 2500));
          download = await downloadPromise2;
          const popupM2 = await popupPromise2;
          const ctxPageM2 = await contextPagePromise2;
          if (popupM2) popupPageAfterClick = popupM2;
          if (ctxPageM2) contextSpawnedAfterClick = ctxPageM2;
        }

        resolvedDownload = download;
      } finally {
        baltimoreDlState.clickCompareDone = true;
      }
    } else {
      const popupPromise = page
        .waitForEvent("popup", { timeout: 12000 })
        .catch(() => null);
      const contextPagePromise = context
        .waitForEvent("page", { timeout: 12000 })
        .catch(() => null);
      const downloadPromise = page
        .waitForEvent("download", { timeout: 30000 })
        .catch(() => null);
      await link.click({ force: true });
      resolvedDownload = await downloadPromise;
      popupPageAfterClick = await popupPromise;
      contextSpawnedAfterClick = await contextPagePromise;
    }

    const saveAndUploadLocalFile = async (
      fileNameHint,
      bodyBuffer,
      sourceLabel,
    ) => {
      const safeName = (
        fileNameHint ||
        att.name ||
        `baltimore_${Date.now()}.pdf`
      ).replace(/[\\/:*?"<>|]/g, "_");
      const localPath = path.join(DOWNLOADS_DIR, safeName);
      fs.writeFileSync(localPath, bodyBuffer);
      const storagePath = `drawings/${supabaseProjectId}/${safeName}`;
      const publicUrl = await uploadFn(localPath, storagePath);
      if (publicUrl) {
        att.viewUrl = publicUrl;
        att.downloadStatus = "uploaded";
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
        console.log(
          `       ✅ Baltimore capture via ${sourceLabel}: ${safeName}`,
        );
      } else {
        att.downloadStatus = "local";
        att.viewUrl = "";
        console.log(
          `       ⚠️ Baltimore capture local only via ${sourceLabel}: ${safeName}`,
        );
      }
      return { safeName, storagePath, publicUrl };
    };

    let captured = false;

    // A) Native Playwright download event
    const download = resolvedDownload;
    if (download) {
      const fileName = download.suggestedFilename() || att.name;
      const localPath = path.join(DOWNLOADS_DIR, fileName);
      await download.saveAs(localPath);
      const storagePath = `drawings/${supabaseProjectId}/${fileName}`;
      const publicUrl = await uploadFn(localPath, storagePath);
      baltimoreUploadKey = storagePath;
      baltimoreCapturePath = "A(download event)";
      if (publicUrl) {
        att.viewUrl = publicUrl;
        att.downloadStatus = "uploaded";
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
      } else {
        att.downloadStatus = "local";
        att.viewUrl = "";
      }
      captured = true;
    }

    // B) popup/new page path
    let popupPage = popupPageAfterClick;
    const contextSpawnedPage = contextSpawnedAfterClick;
    if (!popupPage && contextSpawnedPage && contextSpawnedPage !== page) {
      popupPage = contextSpawnedPage;
    }
    if (!captured && popupPage) {
      await popupPage.waitForLoadState("domcontentloaded").catch(() => {});
      const popupUrl = popupPage.url();
      let popupDownloaded = false;
      const popupDl = await popupPage
        .waitForEvent("download", { timeout: 5000 })
        .catch(() => null);
      if (popupDl) {
        const popupName = popupDl.suggestedFilename() || att.name;
        const popupLocal = path.join(DOWNLOADS_DIR, popupName);
        await popupDl.saveAs(popupLocal);
        const popupStorage = `drawings/${supabaseProjectId}/${popupName}`;
        const popupUrlUploaded = await uploadFn(popupLocal, popupStorage);
        baltimoreUploadKey = popupStorage;
        baltimoreCapturePath = "B(popup download event)";
        if (popupUrlUploaded) {
          att.viewUrl = popupUrlUploaded;
          att.downloadStatus = "uploaded";
          try {
            fs.unlinkSync(popupLocal);
          } catch (_) {}
        } else {
          att.downloadStatus = "local";
          att.viewUrl = "";
        }
        captured = true;
        popupDownloaded = true;
      }
      if (!popupDownloaded && popupUrl && /pdf|fileupload|attachment/i.test(popupUrl)) {
        const popupResp = await context.request
          .get(popupUrl, { timeout: 20000 })
          .catch(() => null);
        if (popupResp && popupResp.ok()) {
          const headers = popupResp.headers();
          const ct = (headers["content-type"] || "").toLowerCase();
          const cd = (headers["content-disposition"] || "").toLowerCase();
          if (
            ct.includes("application/pdf") ||
            cd.includes("attachment") ||
            popupUrl.toLowerCase().includes(".pdf")
          ) {
            const buf = Buffer.from(await popupResp.body());
            const up = await saveAndUploadLocalFile(
              att.name,
              buf,
              "B(popup response)",
            );
            baltimoreUploadKey = up.storagePath;
            baltimoreCapturePath = "B(popup response)";
            captured = true;
          }
        }
      }
    }

    // C) response interception on original page
    if (!captured) {
      for (const resp of capturedResponses) {
        const headers = resp.headers();
        const ct = (headers["content-type"] || "").toLowerCase();
        const cd = (headers["content-disposition"] || "").toLowerCase();
        const isPdfLike =
          ct.includes("application/pdf") ||
          cd.includes("attachment") ||
          resp.url().toLowerCase().includes(".pdf");
        if (!isPdfLike) continue;
        const body = await resp.body().catch(() => null);
        if (body && body.length > 0) {
          const up = await saveAndUploadLocalFile(
            att.name,
            body,
            "C(response interception)",
          );
          baltimoreUploadKey = up.storagePath;
          baltimoreCapturePath = "C(response interception)";
          captured = true;
          break;
        }
      }
    }

    // D) frame navigation path
    if (!captured) {
      await page.waitForTimeout(1500);
      const frameUrlsAfter = page.frames().map((f) => f.url());
      const newOrChangedFrameUrl = frameUrlsAfter.find(
        (u) =>
          u &&
          !frameUrlsBefore.includes(u) &&
          /pdf|fileupload|attachment|download/i.test(u),
      );
      if (newOrChangedFrameUrl) {
        const frameResp = await context.request
          .get(newOrChangedFrameUrl, { timeout: 20000 })
          .catch(() => null);
        if (frameResp && frameResp.ok()) {
          const headers = frameResp.headers();
          const ct = (headers["content-type"] || "").toLowerCase();
          const cd = (headers["content-disposition"] || "").toLowerCase();
          if (
            ct.includes("application/pdf") ||
            cd.includes("attachment") ||
            newOrChangedFrameUrl.toLowerCase().includes(".pdf")
          ) {
            const buf = Buffer.from(await frameResp.body());
            const up = await saveAndUploadLocalFile(
              att.name,
              buf,
              "D(frame navigation)",
            );
            baltimoreUploadKey = up.storagePath;
            baltimoreCapturePath = "D(frame navigation)";
            captured = true;
          }
        }
      }
    }

    page.off("response", onResponse);
    baltimoreDlState.onResponse = null;

    if (!captured) {
      att.downloadStatus = "failed";
      att.downloadError = "click_no_download";
      console.log(`[Baltimore Attach] FAIL ${att.name} click_no_download`);
    } else if (
      att.viewUrl &&
      ["uploaded", "success"].includes(att.downloadStatus)
    ) {
      console.log(
        `[Baltimore Attach] OK ${att.name} path=${baltimoreCapturePath || "?"}`,
      );
    } else if (captured) {
      console.log(`[Baltimore Attach] FAIL ${att.name} captured_but_no_public_url`);
    }
  } catch (dlErr) {
    if (baltimoreDlState.onResponse) {
      page.off("response", baltimoreDlState.onResponse);
    }
    att.downloadStatus = "failed";
    att.downloadError = dlErr.message;
    console.log(`[Baltimore Attach] FAIL ${att.name} ${dlErr.message}`);
  }
}


async function extractAttachments(
  page,
  session,
  supabaseProjectId,
  supabase,
  uploadFn,
  sanitizeFn,
) {
  console.log("  📋 Extracting attachments...");
  const ctx = getExtractionContext(page);
  let baltimoreAttachmentFrame = null;

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Attachments",
      );
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Attachments — navigation failed`);
        return { attachments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_attachments").catch(() => {});

      // Wait for attachment iframe to load real content (async after navigation)
      baltimoreAttachmentFrame = null;
      const maxWait = 15000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const loaded = page.frames().find(
          (fr) =>
            fr.url().includes("AttachmentsList") ||
            fr.url().includes("FileUpload/A"),
        );
        if (loaded) {
          baltimoreAttachmentFrame = loaded;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!baltimoreAttachmentFrame) {
        console.log(
          "  [Baltimore Attachments] iframe never loaded — no attachments",
        );
        return { attachments: [], screenshot: null };
      }
      console.log(
        `  [Baltimore Attachments] iframe loaded: ${baltimoreAttachmentFrame.url().substring(0, 80)}`,
      );

      // Wait for table rows to appear inside the attachment iframe
      try {
        await baltimoreAttachmentFrame.waitForSelector("table tr", {
          timeout: 10000,
        });
      } catch (e) {
        console.log(
          "  [Baltimore Attachments] table never appeared in iframe",
        );
        return { attachments: [], screenshot: null };
      }
    } catch (e) {
      console.log(`  [Baltimore] Skipped Attachments — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { attachments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Attachments")',
        'a:has-text("Attachments")',
        'a:has-text("Attachment")',
        'a[id*="Attachment"]',
        'a:has-text("Documents")',
        'a[id*="Document"]',
        'a:has-text("Document")',
      ],
      "Attachments",
      { expandRecordInfoFirst: true, checkpointLabel: "after_attachments" },
    );

    if (!found) {
      console.log("     [panel] Attachments: link not found");
      return { attachments: [], screenshot: null };
    }
  }

  const DOWNLOADS_DIR = path.join(__dirname, "downloads");
  if (!fs.existsSync(DOWNLOADS_DIR))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const downloadedHashes = new Map();

  const rowHost = baltimoreAttachmentFrame || page;
  const captureBaltimoreIframeDiag = async (frame) => {
    if (!frame) {
      return {
        iframeUrl: "",
        readyState: "unknown",
        rowCount: 0,
        firstRowTexts: [],
        anchorCount: 0,
        firstAnchors: [],
        htmlLen: 0,
        hasPdfAnchor: false,
        hasPdfRow: false,
      };
    }
    return frame
      .evaluate(() => {
        const iframeUrl = window.location.href || "";
        const readyState = document.readyState || "";
        const body = document.body;
        const htmlLen = body ? body.innerHTML.length : 0;
        const rows = Array.from(document.querySelectorAll("tr"));
        const rowCount = rows.length;
        const firstRowTexts = rows
          .slice(0, 5)
          .map((r) => (r.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const anchors = Array.from(document.querySelectorAll("a"));
        const anchorCount = anchors.length;
        const firstAnchors = anchors.slice(0, 10).map((a) => ({
          text: (a.textContent || "").replace(/\s+/g, " ").trim(),
          href: a.getAttribute("href") || "",
        }));
        const hasPdfAnchor = anchors.some((a) =>
          ((a.textContent || "").toUpperCase().includes(".PDF")),
        );
        const hasPdfRow = rows.some((r) =>
          ((r.textContent || "").toUpperCase().includes(".PDF")),
        );
        return {
          iframeUrl,
          readyState,
          rowCount,
          firstRowTexts,
          anchorCount,
          firstAnchors,
          htmlLen,
          hasPdfAnchor,
          hasPdfRow,
        };
      })
      .catch(() => ({
        iframeUrl: "",
        readyState: "unknown",
        rowCount: 0,
        firstRowTexts: [],
        anchorCount: 0,
        firstAnchors: [],
        htmlLen: 0,
        hasPdfAnchor: false,
        hasPdfRow: false,
      }));
  };

  const waitForBaltimoreAttachmentContentReady = async (
    frame,
    label,
    timeoutMs = 15000,
    pollMs = 400,
  ) => {
    const start = Date.now();
    let lastSnap = null;
    let consecutiveEmptyHtml = 0;
    while (Date.now() - start < timeoutMs) {
      const snap = await captureBaltimoreIframeDiag(frame);
      lastSnap = snap;
      if (snap.htmlLen === 0) {
        consecutiveEmptyHtml++;
        if (consecutiveEmptyHtml >= 5) {
          consecutiveEmptyHtml = 0;
          await frame.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          await new Promise((r) => setTimeout(r, pollMs));
        }
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }
      consecutiveEmptyHtml = 0;
      const isReady =
        snap.readyState === "complete" &&
        snap.rowCount > 1 &&
        snap.htmlLen > 0;
      if (isReady) {
        return { ready: true, snap };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return { ready: false, snap: lastSnap };
  };

  /** Baltimore attachment download: row-scoped filename link (Playwright click only for file open, not paging). */
  const baltimoreRowFilenameLinkLocator = (frame, filename) => {
    const row = frame.locator("tr", { hasText: filename }).first();
    return row.locator("a").filter({ hasText: filename }).first();
  };

  const baltimoreDlState = {
    clickCompareDone: false,
    onResponse: null,
  };
  let attachments;
  if (baltimoreAttachmentFrame) {
    attachments = [];
    const seenNames = new Set();
    const seenPageSigs = new Set();
    const fr = baltimoreAttachmentFrame;
    const downloadDeps = {
      DOWNLOADS_DIR,
      supabaseProjectId,
      uploadFn,
      baltimoreRowFilenameLinkLocator,
      baltimoreDlState,
    };
    for (let pageIdx = 0; pageIdx < 50; pageIdx++) {
      const pageReady = await waitForBaltimoreAttachmentContentReady(
        fr,
        `baltimore_p${pageIdx}`,
      );
      if (!pageReady.ready) {
        console.log(
          `[Baltimore Attach] page ${pageIdx + 1} readiness timeout — stop`,
        );
        break;
      }
      const sigObj = await baltimoreReadAttachmentPageSignature(fr);
      const pageSig = `${sigObj.rowKeys}##${sigObj.viewStateTail}`;
      if (seenPageSigs.has(pageSig)) {
        console.log(
          `[Baltimore Attach] duplicate WebForms page signature — stop (page ${pageIdx + 1})`,
        );
        break;
      }
      seenPageSigs.add(pageSig);

      const batch = await fr.evaluate(accelaExtractAttachmentRowsInPage, true);
      const namesOnPage = batch.map((r) => r.name);
      console.log(
        `[Baltimore Attach] page ${pageIdx + 1} filenames: ${JSON.stringify(namesOnPage)}`,
      );

      for (const row of batch) {
        if (seenNames.has(row.name)) continue;
        seenNames.add(row.name);
        row._baltimorePageIndex = pageIdx;
        attachments.push(row);
        if (session) {
          session.message = `Attachments → page ${pageIdx + 1}: ${row.name}`;
        }
        try {
          await downloadBaltimoreAttachmentForRow(page, row, fr, downloadDeps);
        } catch (e) {
          row.downloadStatus = "failed";
          row.downloadError = e.message;
          console.log(`[Baltimore Attach] FAIL ${row.name} ${e.message}`);
        }
      }

      const nextPb = await baltimoreParseAttachmentNextPostBack(fr);
      if (!nextPb) {
        console.log(`[Baltimore Attach] no further pages (no Next > postback)`);
        break;
      }
      console.log(
        `[Baltimore Attach] form-post page ${pageIdx + 1}→${pageIdx + 2} __EVENTTARGET=${nextPb.target}`,
      );
      const postRes = await baltimoreSubmitAttachmentIframeFormPost(
        fr,
        nextPb.target,
        nextPb.argument,
      );
      if (!postRes.ok) {
        console.log(
          `[Baltimore Attach] WebForms POST failed: ${postRes.error || postRes.status}`,
        );
        break;
      }
    }
    const ok = attachments.filter((a) =>
      ["uploaded", "success"].includes(a.downloadStatus),
    ).length;
    const fail = attachments.filter((a) => a.downloadStatus === "failed")
      .length;
    console.log(
      `[Baltimore Attach] summary: found=${attachments.length} downloaded=${ok} failed=${fail}`,
    );
  } else {
    attachments = await ctx.evaluate(accelaExtractAttachmentRowsInPage);
  }
  console.log(
    `     [panel] Attachments: ${attachments.length} items extracted`,
  );
  if (attachments.length === 0) {
    console.log("     [panel] Attachments: panel empty (no data)");
  }
  console.log(
    `     Found ${attachments.length} attachments, attempting downloads...`,
  );

  if (!baltimoreAttachmentFrame) {
    for (let ai = 0; ai < attachments.length; ai++) {
      const att = attachments[ai];
      if (session)
        session.message = `Attachments → downloading ${ai + 1}/${attachments.length}: ${att.name}`;
      console.log(
        `       📥 [${ai + 1}/${attachments.length}] Downloading: ${att.name}`,
      );

      try {
        const rows = await rowHost.$$(
          '[id*="Attachment"] tr, [id*="Document"] tr',
        );
        let targetRow = null;
        const dataRows = [];
        for (const row of rows) {
          const firstCell = await row.$("td");
          if (firstCell) dataRows.push(row);
        }
        if (att.rowIndex !== undefined && att.rowIndex < dataRows.length) {
          targetRow = dataRows[att.rowIndex];
        } else {
          for (const row of dataRows) {
            const firstCell = await row.$("td");
            if (!firstCell) continue;
            const text = (await firstCell.textContent().catch(() => "")).trim();
            if (text === att.name) {
              targetRow = row;
              break;
            }
          }
        }
  
        if (!targetRow) {
          console.log(
            `       ⚠️ Could not re-locate row for "${att.name}" (index ${att.rowIndex}), skipping download`,
          );
          att.downloadStatus = "failed";
          att.downloadError = "row_not_found";
          continue;
        }
  
        const actionsLink = await targetRow.$(
          'a:has-text("Actions"), a:has-text("View"), a[id*="Action"]',
        );
        if (!actionsLink) {
          const downloadLink = await targetRow.$(
            'a[href*="Download"], a[href*="download"], a[onclick*="download"]',
          );
          if (downloadLink) {
            try {
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 30000 }),
                downloadLink.click(),
              ]);
              const safeDlName = (
                download.suggestedFilename() || att.name
              ).replace(/[^a-zA-Z0-9._-]/g, "_");
              const filePath = path.join(DOWNLOADS_DIR, safeDlName);
              await download.saveAs(filePath);
  
              const viewUrl = await tryUploadAccelaFile(
                filePath,
                safeDlName,
                supabaseProjectId,
                uploadFn,
                sanitizeFn,
                downloadedHashes,
              );
              att.viewUrl = viewUrl;
              att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
              console.log(
                `       ✅ Downloaded: ${att.name} → ${viewUrl || "(local)"}`,
              );
            } catch (dlErr) {
              console.log(
                `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
              );
              att.downloadStatus = "failed";
              att.downloadError = dlErr.message;
            }
            continue;
          }
  
          console.log(
            `       ⚠️ No Actions/Download link found for "${att.name}"`,
          );
          att.downloadStatus = "failed";
          att.downloadError = "no_download_link";
          continue;
        }
  
        await actionsLink.click().catch(() => {});
        await page.waitForTimeout(1000);
  
        const viewDetailsLink = await page.$(
          'a:has-text("View Details"), a:has-text("Detail"), [id*="ViewDetail"]',
        );
        if (
          viewDetailsLink &&
          (await viewDetailsLink.isVisible().catch(() => false))
        ) {
          await viewDetailsLink.click().catch(() => {});
          await waitForAccelaLoad(page);
        }
  
        const downloadBtn = await page.$(
          'a:has-text("Download"), input[value*="Download"], button:has-text("Download"), a[href*="Download"]',
        );
  
        if (downloadBtn && (await downloadBtn.isVisible().catch(() => false))) {
          try {
            const [download] = await Promise.all([
              page.waitForEvent("download", { timeout: 30000 }),
              downloadBtn.click(),
            ]);
            const suggestedName = download.suggestedFilename() || att.name;
            const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const filePath = path.join(DOWNLOADS_DIR, safeName);
            await download.saveAs(filePath);
  
            const viewUrl = await tryUploadAccelaFile(
              filePath,
              safeName,
              supabaseProjectId,
              uploadFn,
              sanitizeFn,
              downloadedHashes,
            );
            att.viewUrl = viewUrl;
            att.downloadStatus = viewUrl ? "success" : "uploaded_no_url";
            console.log(
              `       ✅ Downloaded: ${safeName} → ${viewUrl || "(local)"}`,
            );
          } catch (dlErr) {
            console.log(
              `       ⚠️ Download failed for ${att.name}: ${dlErr.message}`,
            );
            att.downloadStatus = "failed";
            att.downloadError = dlErr.message;
          }
        } else {
          console.log(`       ⚠️ No Download button found for "${att.name}"`);
          att.downloadStatus = "failed";
          att.downloadError = "no_download_button";
        }
  
        const backLink = await page.$(
          'a:has-text("Back"), a:has-text("Return"), a:has-text("Attachments")',
        );
        if (backLink && (await backLink.isVisible().catch(() => false))) {
          await backLink.click().catch(() => {});
          await waitForAccelaLoad(page);
        } else {
          await page.goBack().catch(() => {});
          await waitForAccelaLoad(page);
        }
      } catch (err) {
        console.log(
          `       ❌ Attachment error for "${att.name}": ${err.message}`,
        );
        att.downloadStatus = "failed";
        att.downloadError = err.message;
      }
    }
  }

  for (const att of attachments) {
    delete att.rowIndex;
    delete att.hasDownload;
    delete att._baltimorePageIndex;
  }

  const attScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  const downloadedCount = attachments.filter((a) =>
    ["success", "uploaded"].includes(a.downloadStatus),
  ).length;
  const failedCount = attachments.filter(
    (a) => a.downloadStatus === "failed",
  ).length;
  console.log(
    `     Attachments: ${attachments.length} found, ${downloadedCount} downloaded, ${failedCount} failed`,
  );
  const successfulFilenames = attachments
    .filter((a) => ["success", "uploaded"].includes(a.downloadStatus))
    .map((a) => a.name);
  console.log(
    `     [Attachment][SUMMARY] ${JSON.stringify({
      attachmentsFound: attachments.length,
      downloadedCount,
      failedCount,
      successfulFilenames,
      downloadedCountIncludesStatuses: ["success", "uploaded"],
    })}`,
  );
  return {
    attachments,
    screenshot: attScreenshot ? attScreenshot.toString("base64") : null,
  };
}

async function tryUploadAccelaFile(
  filePath,
  fileName,
  projectId,
  uploadFn,
  sanitizeFn,
  downloadedHashes,
) {
  if (!fs.existsSync(filePath)) return "";
  const fileBuffer = fs.readFileSync(filePath);

  if (fileBuffer.length < 1024) {
    console.log(
      `       ⚠️ File too small (${fileBuffer.length} bytes), skipping upload`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return "";
  }

  const contentHash = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const prev = downloadedHashes.get(contentHash);
  if (prev) {
    console.log(
      `       ⚠️ DUPLICATE: "${fileName}" same as "${prev.fileName}", aliasing URL`,
    );
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return prev.viewUrl || "";
  }

  if (!projectId || !uploadFn) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    downloadedHashes.set(contentHash, { fileName, viewUrl: "" });
    return "";
  }

  const storagePath = `drawings/${projectId}/${fileName}`;
  const publicUrl = await uploadFn(filePath, storagePath);
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
  downloadedHashes.set(contentHash, { fileName, viewUrl: publicUrl || "" });
  return publicUrl || "";
}

async function extractInspections(page) {
  console.log("  📋 Extracting inspections...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToRecordInfoSection(
        page,
        frames,
        ctx,
        "Inspections",
      );
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Inspections — navigation failed`);
        return {
          inspections: [],
          upcoming: [],
          completed: [],
          screenshot: null,
        };
      }
      await saveCheckpointScreenshot(page, "after_inspections").catch(() => {});
    } catch (e) {
      console.log(`  [Baltimore] Skipped Inspections — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return {
        inspections: [],
        upcoming: [],
        completed: [],
        screenshot: null,
      };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Inspections")',
        'a:has-text("Inspections")',
        'a:has-text("Inspection")',
        'a[id*="Inspection"]',
      ],
      "Inspections",
      { expandRecordInfoFirst: true, checkpointLabel: "after_inspections" },
    );

    if (!found) {
      console.log("     [panel] Inspections: link not found");
      return { inspections: [], upcoming: [], completed: [], screenshot: null };
    }
  }

  const inspData = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let mainContainer = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        mainContainer = e;
        break;
      }
    }

    const upcoming = [];
    const completed = [];
    const all = [];

    function parseInspectionTable(container, category) {
      const rows = container.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const type = cells[0].textContent.trim();
          if (
            type &&
            type.length < 200 &&
            !type.toLowerCase().includes("inspection type") &&
            !type.toLowerCase().includes("type")
          ) {
            const entry = {
              type,
              status: cells.length > 1 ? cells[1].textContent.trim() : "",
              date: cells.length > 2 ? cells[2].textContent.trim() : "",
              inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
              result: cells.length > 4 ? cells[4].textContent.trim() : "",
              category,
            };
            all.push(entry);
            if (category === "upcoming") upcoming.push(entry);
            else completed.push(entry);
          }
        }
      });
    }

    const upcomingSection = mainContainer.querySelector(
      '[id*="Upcoming"], [id*="upcoming"], [id*="Scheduled"], [id*="scheduled"]',
    );
    const completedSection = mainContainer.querySelector(
      '[id*="Completed"], [id*="completed"], [id*="History"], [id*="history"]',
    );

    if (upcomingSection) {
      const table =
        upcomingSection.closest("table") ||
        upcomingSection.querySelector("table") ||
        upcomingSection;
      parseInspectionTable(table, "upcoming");
    }
    if (completedSection) {
      const table =
        completedSection.closest("table") ||
        completedSection.querySelector("table") ||
        completedSection;
      parseInspectionTable(table, "completed");
    }

    if (all.length === 0) {
      mainContainer
        .querySelectorAll('[id*="Inspection"] tr, [id*="inspection"] tr')
        .forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            const type = cells[0].textContent.trim();
            if (
              type &&
              type.length < 200 &&
              !type.toLowerCase().includes("inspection type")
            ) {
              const statusText =
                cells.length > 1
                  ? cells[1].textContent.trim().toLowerCase()
                  : "";
              const category =
                statusText.includes("pass") ||
                statusText.includes("fail") ||
                statusText.includes("approved") ||
                statusText.includes("completed")
                  ? "completed"
                  : "upcoming";
              const entry = {
                type,
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
                result: cells.length > 4 ? cells[4].textContent.trim() : "",
                category,
              };
              all.push(entry);
              if (category === "upcoming") upcoming.push(entry);
              else completed.push(entry);
            }
          }
        });
    }

    if (all.length === 0) {
      const tables = mainContainer.querySelectorAll("table");
      for (const table of tables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow) continue;
        const headerText = (headerRow.innerText || "").toLowerCase();
        const looksLikeInspection =
          headerText.includes("inspection") ||
          (headerText.includes("type") && (headerText.includes("status") || headerText.includes("date")));
        if (!looksLikeInspection) continue;
        const dataRows = table.querySelectorAll("tr:not(:first-child)");
        dataRows.forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length >= 2) {
            const type = cells[0].textContent.trim();
            if (
              type &&
              type.length < 200 &&
              !type.toLowerCase().includes("inspection type") &&
              !type.toLowerCase().includes("type\n")
            ) {
              const statusText =
                cells.length > 1 ? cells[1].textContent.trim().toLowerCase() : "";
              const category =
                statusText.includes("pass") ||
                statusText.includes("fail") ||
                statusText.includes("approved") ||
                statusText.includes("completed")
                  ? "completed"
                  : "upcoming";
              const entry = {
                type,
                status: cells.length > 1 ? cells[1].textContent.trim() : "",
                date: cells.length > 2 ? cells[2].textContent.trim() : "",
                inspector: cells.length > 3 ? cells[3].textContent.trim() : "",
                result: cells.length > 4 ? cells[4].textContent.trim() : "",
                category,
              };
              all.push(entry);
              if (category === "upcoming") upcoming.push(entry);
              else completed.push(entry);
            }
          }
        });
        if (all.length > 0) break;
      }
    }

    return { all, upcoming, completed };
  });

  const inspScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(
    `     [panel] Inspections: ${inspData.all.length} extracted (${inspData.upcoming.length} upcoming, ${inspData.completed.length} completed)`,
  );
  if (inspData.all.length === 0) console.log("     [panel] Inspections: panel empty (no data)");
  return {
    inspections: inspData.all,
    upcoming: inspData.upcoming,
    completed: inspData.completed,
    screenshot: inspScreenshot ? inspScreenshot.toString("base64") : null,
  };
}

async function extractPayments(page) {
  console.log("  📋 Extracting payments...");
  const ctx = getExtractionContext(page);

  if (isBaltimorePortal(page)) {
    try {
      const frames = getAccelaChildFrames(page);
      const navOk = await navigateToPaymentsSection(page, frames, ctx);
      if (!navOk) {
        console.log(`  [Baltimore] Skipped Fees / Payments — navigation failed`);
        return { payments: [], screenshot: null };
      }
      await saveCheckpointScreenshot(page, "after_fees").catch(() => {});
    } catch (e) {
      console.log(`  [Baltimore] Skipped Fees / Payments — navigation failed`);
      console.log(`  [Baltimore] ${e.message}`);
      return { payments: [], screenshot: null };
    }
  } else {
    const { found } = await clickAccelaNavPanel(
      ctx,
      page,
      [
        '[id*="TabDataList"] a:has-text("Fees")',
        'a:has-text("Fees")',
        '[id*="TabDataList"] a:has-text("Payments")',
        'a:has-text("Payments")',
        'a:has-text("Payment")',
        'a[id*="Payment"]',
        'a[id*="Fee"]',
      ],
      "Payments / Fees",
      { expandPaymentsFirst: true, checkpointLabel: "after_fees" },
    );

    if (!found) {
      console.log("     [panel] Payments/Fees: link not found");
      return { payments: [], screenshot: null };
    }
  }

  if (isBaltimorePortal(page)) {
    const contentFrame = ctx;
    const baltimorePay = await extractBaltimorePayments(page, contentFrame);
    const payments = (baltimorePay.fees || []).map((f) => ({
      description: f.invoice_number || "",
      amount: f.amount || "",
      status: "",
      date: f.date || "",
    }));
    const payScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    console.log(`     [panel] Payments/Fees: ${payments.length} records extracted`);
    if (payments.length === 0) console.log("     [panel] Payments/Fees: panel empty (no data)");
    return {
      payments,
      screenshot: payScreenshot ? payScreenshot.toString("base64") : null,
    };
  }

  const payments = await ctx.evaluate(() => {
    const _cSels = [
      "#ctl00_PlaceHolderMain_PermitDetailList",
      "#ctl00_PlaceHolderMain_CAPDetail",
      '[id*="PlaceHolderMain"][id*="Detail"]',
      '[id*="PlaceHolderMain"][id*="Permit"]',
      '[id*="PlaceHolderMain"][id*="Record"]',
      '[id*="PlaceHolderMain"][id*="Cap"]',
      "#ctl00_PlaceHolderMain_TabDataList",
      "#ctl00_PlaceHolderMain_pnlContent",
      "#ctl00_PlaceHolderMain",
    ];
    let container = document.body;
    for (const s of _cSels) {
      const e = document.querySelector(s);
      if (e && e.textContent.trim().length > 10) {
        container = e;
        break;
      }
    }

    const results = [];
    container
      .querySelectorAll('[id*="Payment"] tr, [id*="Fee"] tr')
      .forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const desc = cells[0].textContent.trim();
          if (
            desc &&
            desc.length < 200 &&
            !desc.toLowerCase().includes("description")
          ) {
            results.push({
              description: desc,
              amount: cells.length > 1 ? cells[1].textContent.trim() : "",
              status: cells.length > 2 ? cells[2].textContent.trim() : "",
              date: cells.length > 3 ? cells[3].textContent.trim() : "",
            });
          }
        }
      });
    return results;
  });

  const payScreenshot = await page
    .screenshot({ fullPage: true })
    .catch(() => null);
  console.log(`     [panel] Payments/Fees: ${payments.length} records extracted`);
  if (payments.length === 0) console.log("     [panel] Payments/Fees: panel empty (no data)");
  return {
    payments,
    screenshot: payScreenshot ? payScreenshot.toString("base64") : null,
  };
}

async function scrapeAccelaRecord(
  session,
  permitNumber,
  supabaseProjectId,
  userId,
  supabase,
  hashPortalData,
  uploadToSupabaseStorage,
  sanitizeStorageKey,
) {
  const { portalUrl } = session;
  const page =
    session.page || (session.context ? session.context.pages()[0] : null);
  if (!page) {
    throw new Error(
      "No authenticated page found in session — cannot start Accela scrape",
    );
  }
  page._isBaltimore = (typeof portalUrl === "string" && portalUrl.toUpperCase().includes("BALTIMORE"));
  if (page._isBaltimore) {
    console.log("  [Baltimore] portal detected — using extended submenu wait and multi-context link search");
  }
  const currentUrl = page.url();
  console.log(`  [GUARD] Starting scrape on existing page. URL: ${currentUrl}`);
  if (currentUrl === "about:blank" || !currentUrl || currentUrl === "") {
    throw new Error(
      `Authenticated page is blank (url=${currentUrl}) — session may be corrupt`,
    );
  }
  const TIMEOUT = 600000;
  const startTime = Date.now();

  const checkTimeout = () => {
    if (Date.now() - startTime > TIMEOUT)
      throw new Error("Accela scraping timed out (10 minute limit)");
  };

  console.log(
    `[Scrape] requested projectId=${supabaseProjectId || "(none)"} permitNumber=${permitNumber}`,
  );

  try {
    session.message = `${permitNumber} → Searching...`;
    await searchPermit(page, portalUrl, permitNumber);
    checkTimeout();

    session.message = `${permitNumber} → Record Header`;
    const header = await extractRecordHeader(page);
    const visiblePermit = (header.record_number || "").trim();
    console.log(`[Scrape] visible permit loaded: ${visiblePermit || "(empty)"}`);
    if (page._isBaltimore) {
      if (!visiblePermit) {
        throw new Error(
          "PERMIT_VERIFY_FAILED: Baltimore record header did not expose permit number — aborting scrape (no DB write)",
        );
      }
      if (
        normalizePermitNumberKey(visiblePermit) !==
        normalizePermitNumberKey(permitNumber)
      ) {
        throw new Error(
          `PERMIT_MISMATCH visible=${visiblePermit} requested=${permitNumber} — aborting scrape (no DB write)`,
        );
      }
    } else if (
      visiblePermit &&
      normalizePermitNumberKey(visiblePermit) !==
        normalizePermitNumberKey(permitNumber)
    ) {
      throw new Error(
        `PERMIT_MISMATCH visible=${visiblePermit} requested=${permitNumber} — aborting scrape (no DB write)`,
      );
    }
    checkTimeout();

    const headerScreenshot = await page
      .screenshot({ fullPage: true })
      .catch(() => null);
    const headerScreenshotBase64 = headerScreenshot
      ? headerScreenshot.toString("base64")
      : null;

    let details = { fields: {}, tables: [], screenshot: null };
    try {
      session.message = `${permitNumber} → Record Details`;
      details = await extractRecordDetails(page);
    } catch (err) {
      console.log(`  [scrape] Record Details section error: ${err.message}`);
    }
    checkTimeout();

    let processingStatus = { departments: [], screenshot: null };
    if (!page._isBaltimore || !BALTIMORE_MINIMAL_PORTAL_TABS) {
      try {
        session.message = `${permitNumber} → Processing Status`;
        processingStatus = await extractProcessingStatus(page);
      } catch (err) {
        console.log(`  [scrape] Processing Status section error: ${err.message}`);
      }
    } else {
      console.log(
        "  [scrape] (skip) Processing Status — BALTIMORE_MINIMAL_PORTAL_TABS",
      );
    }
    checkTimeout();

    let planReview = {
      comments: [],
      text: "",
      screenshot: null,
      planReviewSummary: null,
      downloadLinks: [],
    };
    if (!page._isBaltimore || !BALTIMORE_MINIMAL_PORTAL_TABS) {
      try {
        session.message = `${permitNumber} → Plan Review`;
        planReview = await extractPlanReview(page);
      } catch (err) {
        console.log(`  [scrape] Plan Review section error: ${err.message}`);
      }
    } else {
      console.log("  [scrape] (skip) Plan Review — BALTIMORE_MINIMAL_PORTAL_TABS");
    }
    checkTimeout();

    let relatedRecords = { records: [], screenshot: null };
    if (!page._isBaltimore || !BALTIMORE_MINIMAL_PORTAL_TABS) {
      try {
        session.message = `${permitNumber} → Related Records`;
        relatedRecords = await extractRelatedRecords(page);
      } catch (err) {
        console.log(`  [scrape] Related Records section error: ${err.message}`);
      }
    } else {
      console.log(
        "  [scrape] (skip) Related Records — BALTIMORE_MINIMAL_PORTAL_TABS",
      );
    }
    checkTimeout();

    let attachments = { attachments: [], screenshot: null };
    try {
      session.message = `${permitNumber} → Attachments`;
      attachments = await extractAttachments(
        page,
        session,
        supabaseProjectId,
        supabase,
        uploadToSupabaseStorage,
        sanitizeStorageKey,
      );
    } catch (err) {
      console.log(`  [scrape] Attachments section error: ${err.message}`);
    }
    checkTimeout();

    let inspections = {
      inspections: [],
      upcoming: [],
      completed: [],
      screenshot: null,
    };
    if (!page._isBaltimore || !BALTIMORE_MINIMAL_PORTAL_TABS) {
      try {
        session.message = `${permitNumber} → Inspections`;
        inspections = await extractInspections(page);
      } catch (err) {
        console.log(`  [scrape] Inspections section error: ${err.message}`);
      }
    } else {
      console.log(
        "  [scrape] (skip) Inspections — BALTIMORE_MINIMAL_PORTAL_TABS",
      );
    }
    checkTimeout();

    let payments = { payments: [], screenshot: null };
    if (!page._isBaltimore || !BALTIMORE_MINIMAL_PORTAL_TABS) {
      try {
        session.message = `${permitNumber} → Payments`;
        payments = await extractPayments(page);
      } catch (err) {
        console.log(`  [scrape] Payments section error: ${err.message}`);
      }
    } else {
      console.log("  [scrape] (skip) Payments — BALTIMORE_MINIMAL_PORTAL_TABS");
    }

    const isBaltimore = page._isBaltimore === true;
    const portalData = {
      portalType: "accela",
      ...(isBaltimore ? { schemaVersion: 2 } : {}),
      name: header.record_number || permitNumber,
      projectNum: permitNumber,
      description: header.record_type || "",
      location:
        details.fields["Work Location"] ||
        details.fields["Address"] ||
        details.fields["Location"] ||
        "",
      dashboardStatus: header.record_status || "",
      tabs: {
        info: {
          tables: (() => {
            if (!isBaltimore) return details.tables;
            const keepAlways = new Set([
              "Record Number",
              "Record Type",
              "Record Status",
              "Expiration Date",
              "Work Location",
              "Applicant",
              "Licensed Professional",
              "Project Description",
            ]);
            const bareDupLabels = new Set([
              "primary phone",
              "secondary phone",
              "e-mail",
              "email",
            ]);
            const navOrSpell = /< Prev|Next >|Additional Results|spell check/i;
            const keepRow = ({ key, value }) => {
              const k = (key ?? "").trim();
              const v = String(value ?? "");
              if (keepAlways.has(k)) return true;
              if (k.includes(" - ")) return true;
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(k)) return false;
              if (navOrSpell.test(k) || navOrSpell.test(v)) return false;
              if (k.includes("Block:--") || k.includes("Lot:--")) return false;
              if (/^\d+\)/.test(k)) return false;
              if (/\wStatus:/i.test(k)) return false;
              if (bareDupLabels.has(k.toLowerCase())) return false;
              return true;
            };
            return details.tables.map((t) =>
              t.title === "Record Details" && Array.isArray(t.rows)
                ? { ...t, rows: t.rows.filter(keepRow) }
                : t,
            );
          })(),
          fields: header,
          keyValues: (() => {
            const rows = [
              ...(header.record_number
                ? [{ key: "Record Number", value: header.record_number }]
                : []),
              ...(header.record_type
                ? [{ key: "Record Type", value: header.record_type }]
                : []),
              ...(header.record_status
                ? [{ key: "Record Status", value: header.record_status }]
                : []),
              ...(header.expiration_date
                ? [{ key: "Expiration Date", value: header.expiration_date }]
                : []),
              ...Object.entries(details.fields).map(([key, value]) => ({
                key,
                value,
              })),
            ];
            if (!isBaltimore) return rows;

            const keepAlways = new Set([
              "Record Number",
              "Record Type",
              "Record Status",
              "Expiration Date",
              "Work Location",
              "Applicant",
              "Licensed Professional",
              "Project Description",
            ]);
            const bareDupLabels = new Set([
              "primary phone",
              "secondary phone",
              "e-mail",
              "email",
            ]);
            const navOrSpell = /< Prev|Next >|Additional Results|spell check/i;

            return rows.filter(({ key, value }) => {
              const k = (key ?? "").trim();
              const v = String(value ?? "");
              if (keepAlways.has(k)) return true;
              if (k.includes(" - ")) return true;
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(k)) return false;
              if (navOrSpell.test(k) || navOrSpell.test(v)) return false;
              if (k.includes("Block:--") || k.includes("Lot:--")) return false;
              if (/^\d+\)/.test(k)) return false;
              if (/\wStatus:/i.test(k)) return false;
              if (bareDupLabels.has(k.toLowerCase())) return false;
              return true;
            });
          })(),
          screenshot: details.screenshot,
        },
        status: {
          departments: processingStatus.departments,
          tables:
            processingStatus.departments.length > 0
              ? [
                  {
                    title: "Processing Status",
                    headers: ["Department", "Status", "Due Date", "Details"],
                    rows: processingStatus.departments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: processingStatus.screenshot,
        },
        reports: {
          pdfs: [
            ...(processingStatus.screenshot
              ? [
                  {
                    fileName: "Processing Status",
                    text: processingStatus.departments
                      .map(
                        (d) => `${d.name}: ${d.status} ${d.date} ${d.details}`,
                      )
                      .join("\n"),
                    screenshot: processingStatus.screenshot,
                    source: "accela",
                  },
                ]
              : []),
            ...(planReview.text && (!isBaltimore || planReview.comments.length > 0)
              ? [
                  {
                    fileName: "Plan Review - Review Comments",
                    text: planReview.text,
                    screenshot: planReview.screenshot,
                    source: "accela",
                    comments: planReview.comments,
                  },
                ]
              : []),
            ...(headerScreenshotBase64
              ? [
                  {
                    fileName: "Record Overview",
                    text: Object.entries(header)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n"),
                    screenshot: headerScreenshotBase64,
                    source: "accela",
                  },
                ]
              : []),
          ],
          keyValues: [],
          tables: [],
          ...(isBaltimore && planReview.planReviewSummary
            ? { planReviewSummary: planReview.planReviewSummary }
            : {}),
        },
        attachments: {
          tables:
            attachments.attachments.length > 0
              ? [
                  {
                    title: "Attachments",
                    headers: [
                      "Name",
                      "Record ID",
                      "Record Type",
                      "Entity Type",
                      "Type",
                      "Size",
                      "Last Updated",
                    ],
                    rows: attachments.attachments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: attachments.screenshot,
        },
        inspections: {
          tables: [
            ...(inspections.upcoming.length > 0
              ? [
                  {
                    title: "Upcoming Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.upcoming,
                  },
                ]
              : []),
            ...(inspections.completed.length > 0
              ? [
                  {
                    title: "Completed Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.completed,
                  },
                ]
              : []),
            ...(inspections.inspections.length > 0 &&
            inspections.upcoming.length === 0 &&
            inspections.completed.length === 0
              ? [
                  {
                    title: "Inspections",
                    headers: ["Type", "Status", "Date", "Inspector", "Result"],
                    rows: inspections.inspections,
                  },
                ]
              : []),
          ],
          keyValues: [],
          screenshot: inspections.screenshot,
        },
        payments: {
          tables:
            payments.payments.length > 0
              ? [
                  {
                    title: "Payments",
                    headers: ["Description", "Amount", "Status", "Date"],
                    rows: payments.payments,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: payments.screenshot,
        },
        relatedRecords: {
          tables:
            relatedRecords.records.length > 0
              ? [
                  {
                    title: "Related Records",
                    headers: [
                      "Record Number",
                      "Record Type",
                      "Status",
                      "Project Name",
                      "Date",
                    ],
                    rows: relatedRecords.records,
                  },
                ]
              : [],
          keyValues: [],
          screenshot: relatedRecords.screenshot,
        },
      },
    };

    if (isBaltimore && BALTIMORE_MINIMAL_PORTAL_TABS) {
      portalData.tabs = {
        info: portalData.tabs.info,
        attachments: portalData.tabs.attachments,
      };
    }
    console.log(
      "[PortalData] sections returned:",
      Object.keys(portalData.tabs),
      "(info = Record Details)",
    );

    session.data[permitNumber] = portalData;

    console.log(`  📊 Extraction summary: info.fields=${Object.keys(details.fields).length} | status.departments=${processingStatus.departments.length} | relatedRecords=${relatedRecords.records.length} | attachments=${attachments.attachments.length} | inspections=${inspections.inspections.length + inspections.upcoming.length + inspections.completed.length} | payments=${payments.payments.length}`);

    if (supabase && userId) {
      session.message = `${permitNumber} → Syncing to database...`;
      console.log(`\n  💾 Syncing ${permitNumber} to Supabase...`);
      console.log(
        `  📌 supabaseProjectId=${supabaseProjectId || "(none)"}, userId=${userId}, portalType=${portalData.portalType}`,
      );
      const newHash = hashPortalData(portalData);

      let existingRow = null;
      const selectFields = page._isBaltimore
        ? "id, portal_data_hash, portal_data, permit_number, user_id"
        : "id, portal_data_hash";

      if (page._isBaltimore) {
        if (!supabaseProjectId) {
          throw new Error(
            "Baltimore scrape requires projectId — refusing DB write",
          );
        }
        const { data: bRows, error: bErr } = await supabase
          .from("projects")
          .select(selectFields)
          .eq("id", supabaseProjectId)
          .limit(1);
        if (bErr || !bRows?.length) {
          throw new Error(
            `Baltimore scrape: projects row not found id=${supabaseProjectId}`,
          );
        }
        existingRow = bRows[0];
        if (
          normalizePermitNumberKey(existingRow.permit_number) !==
          normalizePermitNumberKey(permitNumber)
        ) {
          throw new Error(
            `Baltimore DB permit mismatch projects.id=${supabaseProjectId} dbPermit=${existingRow.permit_number} requested=${permitNumber}`,
          );
        }
      } else {
        if (supabaseProjectId) {
          const { data: rows } = await supabase
            .from("projects")
            .select(selectFields)
            .eq("id", supabaseProjectId);
          existingRow = rows && rows.length > 0 ? rows[0] : null;
        }
        if (!existingRow) {
          const { data: rows } = await supabase
            .from("projects")
            .select(selectFields)
            .eq("permit_number", permitNumber)
            .eq("user_id", userId);
          existingRow = rows && rows.length > 0 ? rows[0] : null;
        }
      }

      const isLegacyBaltimore =
        page._isBaltimore &&
        existingRow?.portal_data &&
        (existingRow.portal_data.schemaVersion == null || existingRow.portal_data.schemaVersion < 2);
      const forceOverwrite = isLegacyBaltimore;

      if (
        existingRow &&
        existingRow.portal_data_hash === newHash &&
        !forceOverwrite &&
        !page._isBaltimore
      ) {
        console.log(
          `  ⏭️ Data unchanged (hash match), skipping update for row ${existingRow.id}`,
        );
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", existingRow.id);
      } else if (existingRow) {
        if (forceOverwrite) {
          console.log(
            `  📌 Baltimore: forcing overwrite for row ${existingRow.id} (legacy schema)`,
          );
        }
        if (page._isBaltimore) {
          console.log(
            `  📌 Baltimore: full portal_data replace (attachments rows = this scrape only, no merge) projects.id=${existingRow.id}`,
          );
        }
        const updatePayload = {
          portal_status: header.record_status || "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: portalData,
          portal_data_hash: newHash,
          permit_number: permitNumber,
        };

        const { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("id", existingRow.id)
          .select("id, portal_data");

        if (error) {
          console.error("  ❌ Supabase error:", error.message);
        } else if (data && data.length > 0) {
          const writtenType = data[0].portal_data?.portalType || "(none)";
          console.log(
            `  ✅ Updated project row=${data[0].id}, written portalType=${writtenType}`,
          );
        }
      } else {
        if (page._isBaltimore) {
          throw new Error(
            "Baltimore scrape: missing projects row (should have been loaded by id)",
          );
        }
        const { data: created, error: createError } = await supabase
          .from("projects")
          .insert({
            user_id: userId,
            name: header.record_number || permitNumber,
            permit_number: permitNumber,
            description: header.record_type || "",
            address: portalData.location || "",
            jurisdiction: portalData.jurisdiction || "Unknown",
            status: "draft",
            portal_status: header.record_status || "Unknown",
            last_checked_at: new Date().toISOString(),
            portal_data: portalData,
            portal_data_hash: newHash,
          })
          .select("id, portal_data");
        if (createError) {
          console.error("  ❌ Supabase create error:", createError.message);
        } else if (created && created.length > 0) {
          const writtenType = created[0].portal_data?.portalType || "(none)";
          console.log(
            `  📝 Created new project row=${created[0].id}, written portalType=${writtenType}`,
          );
        }
      }

      if (existingRow || supabaseProjectId) {
        const verifyId = existingRow?.id || supabaseProjectId;
        const { data: verify } = await supabase
          .from("projects")
          .select("id, permit_number, credential_id, portal_data")
          .eq("id", verifyId)
          .maybeSingle();
        if (verify) {
          console.log(
            `  🔍 DB verify: row=${verify.id}, permit=${verify.permit_number}, credential=${verify.credential_id || "(none)"}, portalType=${verify.portal_data?.portalType || "(none)"}`,
          );
        }
      }
    }

    console.log(`  ✅ Accela scrape complete for ${permitNumber}`);
    return portalData;
  } catch (err) {
    throw err;
  }
}

/**
 * Baltimore Record Details: grouped div blocks — Work Location, Applicant, Licensed Professional,
 * Project Description, Owner; optional "More Details" expansion.
 */
async function extractBaltimoreRecordDetails(contentFrame) {
  try {
    /* More Details + section expands disabled temporarily (speed) — re-enable when fixed.
    try {
      const moreBtn = await contentFrame.$('text="More Details"');
      if (moreBtn) {
        await moreBtn.click();
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {}

    const sectionHeadings = [
      "Related Contacts",
      "Application Information",
      "Parcel Information",
      "Planning and Zoning Info",
      "Permit Dates and Internal Use",
      "Trade and Accessory Info",
      "Responsible Parties",
    ];
    for (const heading of sectionHeadings) {
      try {
        const el = await contentFrame.$(`text="${heading}"`);
        if (el) {
          await el.click();
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {}
    }
    */

    const fields = await contentFrame.evaluate(() => {
      const result = {};
      const clean = el => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
      const allEls = [...document.querySelectorAll('*')];

      // WORK LOCATION
      for (const el of allEls) {
        if (clean(el) === 'Work Location') {
          let sib = el.nextElementSibling;
          for (let i = 0; i < 8; i++) {
            if (!sib) break;
            const t = clean(sib);
            if (t && t.length < 100 && /\d/.test(t) &&
                t.indexOf('function') === -1 && t.indexOf('var ') === -1) {
              result['Work Location'] = t.replace(/\s*\*\s*$/, '').replace(/-+$/, '').trim();
              break;
            }
            sib = sib.nextElementSibling;
          }
          break;
        }
      }

      // NAMED BLOCKS
      const knownLabels = [
        'Applicant', 'Licensed Professional', 'Project Description', 'Owner'
      ];

      for (const label of knownLabels) {
        const candidates = allEls.filter(el => {
          const t = clean(el).replace(/:$/, '');
          return t === label;
        });

        for (const candidate of candidates) {
          const block = candidate.closest('td, li, div[class], p')
                        || candidate.parentElement;
          if (!block) continue;

          let value = clean(block);
          value = value.replace(label + ':', '').replace(label, '').trim();
          value = value.replace(/\s+/g, ' ').trim();

          if (value && value.length > 5 &&
              value.indexOf('< Prev') === -1 &&
              value.indexOf('Additional Results') === -1 &&
              value.indexOf('spell check') === -1 &&
              value.indexOf('function ') === -1 &&
              value.indexOf('var ') === -1 &&
              value.indexOf('__doPostBack') === -1 &&
              value.indexOf('searchWaterMark') === -1) {
            result[label] = value;
            break;
          }
        }
      }

      const moreDetails = {};

      // Related Contacts only (full More Details section loop disabled for speed)
      const relatedHeading = 'Related Contacts';
      const rcHeadingEl = allEls.find(el => {
        const t = (el.innerText || '').trim();
        return (t === relatedHeading || t === relatedHeading + ':') &&
               el.children.length <= 2;
      });
      if (rcHeadingEl) {
        const parent = rcHeadingEl.parentElement;
        if (parent) {
          const sectionData = {};
          const container = parent.nextElementSibling || parent;
          const tables = [...(container.querySelectorAll('table') || [])];

          for (const table of tables) {
            const rows = [...table.querySelectorAll('tr')];
            for (const row of rows) {
              const cells = [...row.querySelectorAll('td, th')];
              if (cells.length === 2) {
                const lbl = (cells[0].innerText || '').trim().replace(/:$/, '');
                const val = (cells[1].innerText || '').trim();
                if (lbl && val && lbl.length < 80 &&
                    lbl.indexOf('function') === -1) {
                  sectionData[lbl] = val;
                }
              } else if (cells.length > 2) {
                const headers = [...table.querySelectorAll('th')].map(
                  thEl => (thEl.innerText || '').trim()
                );
                if (headers.length > 0) {
                  if (!sectionData['_rows']) sectionData['_rows'] = [];
                  const rowObj = {};
                  cells.forEach((td, i) => {
                    const key = headers[i] || ('col_' + i);
                    rowObj[key] = (td.innerText || '').trim();
                  });
                  if (Object.values(rowObj).some(v => v)) {
                    sectionData['_rows'].push(rowObj);
                  }
                }
              }
            }
          }

          const divEls = [...(container.querySelectorAll('div, span, td') || [])];
          for (const el of divEls) {
            const t = (el.innerText || '').trim();
            if (t.endsWith(':') && t.length < 80 && el.children.length === 0) {
              const next = el.nextElementSibling;
              if (next) {
                const val = (next.innerText || '').trim();
                const lbl = t.replace(/:$/, '');
                if (val && val.indexOf('function') === -1 &&
                    val.indexOf('var ') === -1 && !sectionData[lbl]) {
                  sectionData[lbl] = val;
                }
              }
            }
          }

          if (Object.keys(sectionData).length > 0) {
            moreDetails[relatedHeading] = sectionData;
          }
        }
      }

      // Flatten moreDetails into top-level string key/value pairs
      for (const [section, sectionData] of Object.entries(moreDetails)) {
        if (typeof sectionData !== 'object') continue;
        for (const [lbl, val] of Object.entries(sectionData)) {
          if (lbl === '_rows') {
            // Skip row arrays for now — not renderable as simple strings
            continue;
          }
          if (typeof val === 'string' && val.trim()) {
            result[section + ' - ' + lbl] = val.trim();
          }
        }
      }

      return result;
    });

    const count = Object.keys(fields).length;
    console.log('[Baltimore RecordDetails] Extracted ' + count + ' fields');
    return fields;

  } catch(err) {
    console.log('[Baltimore RecordDetails] ERROR:', err.message);
    return {};
  }
}

module.exports = {
  accelaLogin,
  scrapeAccelaRecord,
  findLinkInAnyContext,
  clickAndWaitForContent,
  navigateToRecordInfoSection,
  navigateToPaymentsSection,
};

/*
 * Example usage (do not execute on module load):
 *
 *   const allFrames = page.frames();
 *   const recordFrame = page._recordFrame || page.mainFrame();
 *   const childFrames = allFrames.filter((f) => f !== page.mainFrame());
 *   const r = await findLinkInAnyContext(page, childFrames, "Processing Status");
 *   if (r) {
 *     await clickAndWaitForContent(r.context, r.element, recordFrame, 8000);
 *   }
 */
