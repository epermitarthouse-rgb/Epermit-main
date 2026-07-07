/**
 * PEPCO / Exelon SIUP — login + MFA detection only (read-oriented).
 * Does not scrape dashboard, documents, or downloads.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { isScraperDebugArtifactsEnabled } = require("../../artifacts/debug-artifacts");

const SCRAPER_SERVICE_ROOT = path.join(__dirname, "..", "..");

function isLikelyLoginUrl(url) {
  const u = String(url || "").toLowerCase();
  return /login|signin|susi|b2clogin|authorize|oauth|microsoftonline/i.test(u);
}

/**
 * True when Azure B2C `.loadingBkg` overlay is visible and intercepting interaction.
 *
 * @param {import('playwright').Page} page
 */
async function isLoadingOverlayBlocking(page) {
  return page
    .evaluate(() => {
      const el = document.querySelector(".loadingBkg");
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (style.pointerEvents === "none") return false;
      return true;
    })
    .catch(() => false);
}

/**
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number }} [opts]
 */
async function waitForLoadingOverlayClear(page, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isLoadingOverlayBlocking(page))) return true;
    await page.waitForTimeout(200).catch(() => {});
  }
  return !(await isLoadingOverlayBlocking(page));
}

/**
 * @param {import('playwright').Page} page
 */
async function isEmailContactOptionVisible(page) {
  const maskedRow = page
    .getByText(/[a-zA-Z0-9][*‧·•\s\u2022]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    .first();
  if (await maskedRow.isVisible({ timeout: 350 }).catch(() => false)) return true;

  const emailRadio = page.getByRole("radio", { name: /\bemail\b/i }).first();
  if (await emailRadio.isVisible({ timeout: 350 }).catch(() => false)) return true;

  const emailBtn = page.getByRole("button", { name: /^\s*email\s*$/i }).first();
  if (await emailBtn.isVisible({ timeout: 350 }).catch(() => false)) return true;

  return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function isSendCodeButtonVisible(page) {
  const nameRes = [/send\s+verification\s+code/i, /send\s+code/i, /^continue$/i, /^next$/i];
  for (const re of nameRes) {
    const b = page.getByRole("button", { name: re }).first();
    if (await b.isVisible({ timeout: 350 }).catch(() => false)) return true;
    const l = page.getByRole("link", { name: re }).first();
    if (await l.isVisible({ timeout: 250 }).catch(() => false)) return true;
  }
  return false;
}

/**
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 * @param {string} reason
 */
async function logMfaHumanRequiredDiagnostics(page, log, reason) {
  const contactMethodVisible = await detectPepcoContactMethodScreen(page);
  const sendCodeVisible = await isSendCodeButtonVisible(page);
  const codeInputVisible = await isPepcoCodeEntryInputVisible(page);
  log(
    `MFA human_required reason=${reason} url=${page.url()} contactMethodVisible=${contactMethodVisible} sendCodeVisible=${sendCodeVisible} codeInputVisible=${codeInputVisible}`,
  );
}

/**
 * Wait until MFA contact-method UI is rendered and interactive.
 *
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number }} [opts]
 */
async function waitForMfaContactScreenReady(page, { timeoutMs = 35000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitForLoadingOverlayClear(page, { timeoutMs: 4000 }).catch(() => {});
    const title = await page.title().catch(() => "");
    const titleMatch = /choose multi factor authentication method/i.test(title);
    const contact = await detectPepcoContactMethodScreen(page);
    if (contact || titleMatch) {
      if (await isEmailContactOptionVisible(page)) return true;
      if (contact && titleMatch) return true;
    }
    if (await isPepcoCodeEntryInputVisible(page)) return true;
    await page.waitForTimeout(350).catch(() => {});
  }
  return false;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} startUrl
 * @param {(msg: string) => void} log
 */
async function returnMfaCodeInputRequired(page, startUrl, log) {
  await logMfaHumanRequiredDiagnostics(page, log, "mfa_email_code_input_required");
  return {
    status: "human_required",
    reason: "mfa_email_code_input_required",
    message: "Enter the PEPCO verification code sent by email.",
    currentUrl: page.url() || startUrl,
  };
}

/**
 * PEPCO / Azure — "Choose how you'd like us to contact you" (Text / Call / Email).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectPepcoContactMethodScreen(page) {
  const title = await page.title().catch(() => "");
  if (/choose multi factor authentication method/i.test(title)) {
    return true;
  }

  const raw = await page
    .evaluate(() => (document.body && document.body.innerText) || "")
    .catch(() => "");
  if (raw.length < 40) return false;
  const lower = raw.toLowerCase();
  const hasPrompt =
    raw.includes("Choose how you'd like us to contact you") ||
    lower.includes("choose how you'd like us to contact you for verification") ||
    lower.includes("a contact method is required") ||
    lower.includes("choose multi factor authentication method");
  const hasChannels =
    /\btext\b/i.test(raw) && /\bcall\b/i.test(raw) && /\bemail\b/i.test(raw);
  return hasPrompt && hasChannels;
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isPepcoCodeEntryScreen(page) {
  const title = await page.title().catch(() => "");
  if (/verification code|enter code|one.?time|verify your/i.test(title)) return true;

  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      return (
        /enter.*verification code|verification code has been sent|we('ve| have) sent.*code|enter the code|one.?time password|enter your code/.test(
          t,
        ) && !/choose how you'd like us to contact you|choose multi factor authentication method/.test(t)
      );
    })
    .catch(() => false);
}

/**
 * True when a dedicated MFA code input is visible (not the contact-method picker).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isPepcoCodeEntryInputVisible(page) {
  const url = page.url().toLowerCase();
  const onSelfAsserted = /selfasserted/i.test(url);
  const codeScreen = await isPepcoCodeEntryScreen(page);

  const otpSelectors = [
    'input[autocomplete="one-time-code"]',
    'input[name="verificationCode"]',
    'input[name="otpCode"]',
    'input[id*="verificationCode"]',
    'input[id*="VerificationCode"]',
    'input[id*="otpCode"]',
    'input[id*="OtpCode"]',
    'input[id*="otp"]',
    'input[name*="otp"]',
    'input[placeholder*="code"]',
    'input[aria-label*="code"]',
    'input[data-bind*="verificationCode"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
    "#otpCode",
    "#emailVerificationCode",
  ];

  for (const sel of otpSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
      if (onSelfAsserted || codeScreen || !(await detectPepcoContactMethodScreen(page))) {
        return true;
      }
    }
  }

  if (onSelfAsserted || codeScreen) {
    const textInputs = page.locator('input[type="text"]:visible, input:not([type]):visible');
    const n = await textInputs.count().catch(() => 0);
    if (n >= 1 && n <= 8) return true;
  }

  if (await detectPepcoContactMethodScreen(page)) return false;

  const n = await page.locator('input[inputmode="numeric"]').count().catch(() => 0);
  if (n >= 4) return true;
  return false;
}

/**
 * Click Email only (not Text / Call), then Send code / Continue / Next. Wait until OTP field is visible.
 *
 * @param {import('playwright').Page} page
 * @param {{ logger?: (m: string) => void }} [opts]
 * @returns {Promise<{ outcome: 'code_input_ready' | 'not_contact_screen' | 'needs_manual_contact' }>}
 */
async function selectPepcoEmailMfaMethod(page, opts = {}) {
  const log =
    typeof opts.logger === "function" ? opts.logger : (m) => console.log(`[PEPCO][login-flow] ${m}`);

  await waitForLoadingOverlayClear(page, { timeoutMs: 30000 });
  await waitForMfaContactScreenReady(page, { timeoutMs: 35000 });

  if (await isPepcoCodeEntryInputVisible(page)) {
    log("Verification code input ready");
    return { outcome: "code_input_ready" };
  }

  const title = await page.title().catch(() => "");
  const onContactScreen =
    (await detectPepcoContactMethodScreen(page)) ||
    /choose multi factor authentication method/i.test(title);

  if (!onContactScreen) {
    return { outcome: "not_contact_screen" };
  }

  log("MFA contact method screen detected");

  await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });

  let emailClicked = await clickPepcoEmailContactOption(page);
  if (!emailClicked) {
    await waitForLoadingOverlayClear(page, { timeoutMs: 10000 });
    await page.waitForTimeout(600).catch(() => {});
    emailClicked = await clickPepcoEmailContactOption(page);
  }
  if (!emailClicked) {
    return { outcome: "needs_manual_contact" };
  }
  log("Clicked Email contact method");

  await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
  await page.waitForTimeout(600).catch(() => {});

  let sent = await clickPepcoSendVerificationCodeOnly(page);
  if (!sent) {
    const continued = await clickPepcoMfaContinueOnly(page);
    if (continued) {
      await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
      await page.waitForTimeout(800).catch(() => {});
      sent = await clickPepcoSendVerificationCodeOnly(page);
    }
  }
  if (!sent) {
    sent = await clickPepcoSendCodeOrContinue(page);
  }
  if (sent) {
    log("Clicked Send Code after Email selection");
  }

  await waitForLoadingOverlayClear(page, { timeoutMs: 20000 });

  const codeReady = await waitForPepcoCodeInputReady(page, { timeoutMs: 45000, log });
  if (codeReady) {
    log("Verification code input ready");
    return { outcome: "code_input_ready" };
  }

  if (emailClicked && sent && !(await detectPepcoContactMethodScreen(page))) {
    if (await isPepcoCodeEntryScreen(page)) {
      log("Verification code input ready");
      return { outcome: "code_input_ready" };
    }
  }

  if (await detectPepcoContactMethodScreen(page)) {
    return { outcome: "needs_manual_contact" };
  }

  if (await isPepcoCodeEntryInputVisible(page)) {
    log("Verification code input ready");
    return { outcome: "code_input_ready" };
  }

  return { outcome: "needs_manual_contact" };
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function clickPepcoEmailContactOption(page) {
  await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });

  const maskedRow = page
    .getByText(/[a-zA-Z0-9][*‧·•\s\u2022]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    .first();
  try {
    if (await maskedRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await maskedRow.click({ timeout: 12000 }).catch(async () => {
        await maskedRow.locator("xpath=ancestor::button[1]").click({ timeout: 8000 }).catch(() => {});
      });
      return true;
    }
  } catch (_) {}

  const emailRadio = page.getByRole("radio", { name: /\bemail\b/i }).first();
  if (await emailRadio.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailRadio.click({ timeout: 12000 }).catch(() => {});
    return true;
  }

  const emailBtn = page.getByRole("button", { name: /^\s*email\s*$/i }).first();
  if (await emailBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emailBtn.click({ timeout: 12000 }).catch(() => {});
    return true;
  }

  const tiles = page.locator('[role="button"], button, a, label, div').filter({ hasText: /\bEmail\b/i });
  const n = await tiles.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 8); i++) {
    const t = tiles.nth(i);
    const txt = ((await t.innerText().catch(() => "")) || "").trim();
    if (!txt) continue;
    if (/\btext\b/i.test(txt) && txt.length < 20 && !/@/.test(txt)) continue;
    if (/\bcall\b/i.test(txt) && !/@/.test(txt) && txt.length < 30) continue;
    if (/\bemail\b/i.test(txt) || /@/.test(txt)) {
      if (await t.isVisible({ timeout: 800 }).catch(() => false)) {
        await t.click({ timeout: 12000 }).catch(() => {});
        return true;
      }
    }
  }

  return false;
}

/**
 * Click Send verification code / Send code only (not generic Continue).
 *
 * @param {import('playwright').Page} page
 */
async function clickPepcoSendVerificationCodeOnly(page) {
  await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });

  const nameRes = [/send\s+verification\s+code/i, /send\s+code/i];
  for (const re of nameRes) {
    const b = page.getByRole("button", { name: re }).first();
    try {
      if (await b.isVisible({ timeout: 1800 }).catch(() => false)) {
        if (!(await b.isEnabled().catch(() => false))) continue;
        await b.click({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(600).catch(() => {});
        return true;
      }
    } catch (_) {}
    const l = page.getByRole("link", { name: re }).first();
    try {
      if (await l.isVisible({ timeout: 800 }).catch(() => false)) {
        await l.click({ timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(600).catch(() => {});
        return true;
      }
    } catch (_) {}
  }
  return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function clickPepcoMfaContinueOnly(page) {
  await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
  const nameRes = [/^continue$/i, /^next$/i];
  for (const re of nameRes) {
    const b = page.getByRole("button", { name: re }).first();
    try {
      if (await b.isVisible({ timeout: 1500 }).catch(() => false)) {
        if (!(await b.isEnabled().catch(() => false))) continue;
        await b.click({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(600).catch(() => {});
        return true;
      }
    } catch (_) {}
  }
  return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function clickPepcoSendCodeOrContinue(page) {
  if (await clickPepcoSendVerificationCodeOnly(page)) return true;
  return clickPepcoMfaContinueOnly(page);
}

/**
 * Poll until OTP/code input or code-entry screen is ready.
 *
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number, log?: (m: string) => void }} [opts]
 */
async function waitForPepcoCodeInputReady(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 45000;
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await waitForLoadingOverlayClear(page, { timeoutMs: 4000 }).catch(() => {});
    if (await isPepcoCodeEntryInputVisible(page)) return true;
    if (await isPepcoCodeEntryScreen(page)) {
      await page.waitForTimeout(800).catch(() => {});
      if (await isPepcoCodeEntryInputVisible(page)) return true;
    }
    await page.waitForTimeout(450).catch(() => {});
  }

  log("code input not detected within wait window");
  return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function detectMfaScreen(page) {
  const url = page.url().toLowerCase();
  if (/b2clogin\.com|login\.microsoftonline\.com/i.test(url)) {
    if (/mfa|verify|otp|proof|challenge/i.test(url)) return true;
  }

  if (await detectPepcoContactMethodScreen(page)) {
    return true;
  }

  const bodyText = await page
    .evaluate(() => (document.body && document.body.innerText) || "")
    .catch(() => "");
  const lower = bodyText.toLowerCase();

  const textHints =
    /verification code|verify your identity|enter code|one[- ]time code|send.*code|email verification|security code|authenticator/.test(
      lower,
    );

  /** Narrow OTP-ish inputs (plain CSS — Playwright locator) */
  const otpSelectors = [
    'input[name="verificationCode"]',
    'input[id*="verificationCode"]',
    'input[id*="VerificationCode"]',
    'input[id*="otp"]',
    'input[name*="otp"]',
    'input[placeholder*="code"]',
    'input[aria-label*="code"]',
    'input[data-bind*="verificationCode"]',
  ];

  for (const sel of otpSelectors) {
    const loc = page.locator(sel).first();
    const vis = await loc.isVisible().catch(() => false);
    if (vis && (textHints || /verification|otp|code/i.test(sel))) return true;
  }

  if (textHints) return true;

  return false;
}

/**
 * After manual MFA — read-only checkpoint (no scraping of cards/documents).
 * @param {import('playwright').Page} page
 * @returns {Promise<{ phase: 'dashboard_ready' | 'mfa_pending' | 'unknown', currentUrl: string }>}
 */
async function assessPepcoPostMfaResumeState(page) {
  await page.waitForTimeout(400);
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  const currentUrl = page.url();
  const u = currentUrl.toLowerCase();

  if (/\/service-installation-upgrades-portal\/dashboard/i.test(currentUrl)) {
    return { phase: "dashboard_ready", currentUrl };
  }

  const domDashboard = await page
    .evaluate(() => {
      if (document.querySelector("app-dashboard-application")) return true;
      if (document.querySelector(".app-dashboard-application")) return true;
      if (document.querySelector(".applications")) return true;
      if (document.querySelector(".application-card")) return true;
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      return t.includes("service installation upgrades portal");
    })
    .catch(() => false);

  const onSiup = /\/service-installation-upgrades-portal\//i.test(currentUrl);

  if (domDashboard && onSiup && !isLikelyLoginUrl(currentUrl)) {
    return { phase: "dashboard_ready", currentUrl };
  }

  if (/b2clogin\.com/i.test(u) || /login\.microsoftonline\.com/i.test(u)) {
    return { phase: "mfa_pending", currentUrl };
  }

  if (await detectMfaScreen(page)) {
    return { phase: "mfa_pending", currentUrl };
  }

  let lowerBody = "";
  try {
    const raw = await page.evaluate(() => (document.body && document.body.innerText) || "");
    lowerBody = String(raw || "").toLowerCase();
  } catch {
    lowerBody = "";
  }
  if (
    (/verify/.test(lowerBody) && /code/.test(lowerBody)) ||
    /verification code/.test(lowerBody)
  ) {
    return { phase: "mfa_pending", currentUrl };
  }

  await maybeDebugScreenshot(page, { label: "pepco-resume-unknown" });

  return { phase: "unknown", currentUrl };
}

/**
 * @param {{ label?: string }} opts
 */
async function maybeDebugScreenshot(page, opts = {}) {
  if (!isScraperDebugArtifactsEnabled()) return;
  const label = opts.label || "pepco-login";
  const dir = path.join(SCRAPER_SERVICE_ROOT, "debug");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safe = String(label).replace(/[^a-zA-Z0-9_-]/g, "_");
    const fp = path.join(dir, `${safe}-${Date.now()}.png`);
    await page.screenshot({ path: fp, fullPage: true }).catch(() => {});
    console.log(`[PEPCO][login-flow] debug screenshot: ${fp}`);
  } catch (_) {}
}

/** Shown after automatic mailbox polling fails — keep manual Phase 3 resume */
const EMAIL_MFA_AUTO_FETCH_FAILED_MSG =
  "Could not fetch PEPCO MFA code automatically. Complete MFA manually, then click Resume.";

/** @example basic manual MFA prompt when automation is unavailable */
const EMAIL_MFA_MANUAL_ONLY_MSG = "PEPCO email verification code required.";

/** Shown when user-submitted MFA code is rejected by PEPCO */
const PEPCO_CODE_REJECTED_MSG =
  "The PEPCO verification code was not accepted. Please check the latest code and try again.";

/**
 * Best-effort: click MFA controls that expose / send email codes.
 *
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 */
async function tryTriggerEmailVerificationOption(page, log) {
  /** @example common Microsoft/Azure AD MFA tiles + PEPCO email-code entry */
  const clickable = [
    page.getByRole("button", { name: /\bemail\b/i }).first(),
    page.getByRole("link", { name: /\bemail\b/i }).first(),
    page.getByRole("button", { name: /\bsend\s+(?:verification\s+)?code\b/i }).first(),
    page.getByText(/\bsend\s+(?:verification\s+)?code\b/i).first(),
    page.getByText(/\bverification\s+code\b/i).first(),
    page.getByRole("button", { name: /\b(?:send|email)\b.*(?:code|verification)?/i }).first(),
    page.getByRole("button", { name: /\bverify\s+another\s+way\b/i }).first(),
    page.getByRole("button", { name: /\bsend\b.*(?:code)/i }).first(),
    page.getByText(/\bsend\s+code\b/i).first(),
  ];

  for (const c of clickable) {
    try {
      if (await c.isVisible({ timeout: 1200 }).catch(() => false)) {
        await c.click({ timeout: 14000 }).catch(() => {});
        log("clicked a plausible MFA email/send-code control");
        await page.waitForTimeout(2600).catch(() => {});
        try {
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        } catch (_) {}
        return;
      }
    } catch (_) {}
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} code
 * @param {(msg: string) => void} log
 */
async function fillOtpCodeInputsBestEffort(page, code, log) {
  const c = String(code || "").trim();
  if (!/^\d{4,8}$/.test(c)) {
    log("rejected OTP input (unsupported code shape)");
    return false;
  }

  const otpSelectors = [
    'input[name="verificationCode"]',
    'input[id*="verificationCode"]',
    'input[id*="VerificationCode"]',
    'input[id*="otp"]',
    'input[name*="otp"]',
    'input[name*="code"]',
    'input[id*="code"]',
    'input[placeholder*="code"]',
    'input[aria-label*="code"]',
    'input[data-bind*="verificationCode"]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
  ];

  for (const sel of otpSelectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 2400 }).catch(() => false)) {
        await loc.fill(c).catch(async () => {
          await loc.click({ trial: false }).catch(() => {});
          await loc.fill(c).catch(() => {});
        });
        log("entered verification code via MFA inputs");
        return true;
      }
    } catch (_) {}
  }

  /** @example single-digit boxes fallback */
  const boxes = await page.locator('input[inputmode="numeric"]').all();
  if (boxes.length >= c.length && c.length >= 6) {
    try {
      for (let i = 0; i < Math.min(boxes.length, c.length); i++) {
        const ch = c[i];
        const b = boxes[i];
        await b.click({ timeout: 3000 }).catch(() => {});
        await b.fill(ch).catch(() => {});
      }
      log("entered verification code digit-by-digit where possible");
      return true;
    } catch (_) {}
  }

  return false;
}

/**
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 */
async function clickVerificationSubmitBestEffort(page, log) {
  const submits = [
    page.getByRole("button", { name: /\b(?:verify|continue|submit|sign\s+in)\b/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first(),
  ];
  for (const b of submits) {
    try {
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) {
        await b.click({ timeout: 15000 }).catch(() => {});
        log("clicked post-OTP verification control");
        return true;
      }
    } catch (_) {}
  }
  await page.keyboard.press("Enter").catch(() => {});
  log("used Enter fallback after OTP");
  return true;
}

/** Safe: no OTP code values logged. */
async function maybePepcoSubmitCodeFailureScreenshot(page, tag) {
  if (!isScraperDebugArtifactsEnabled()) return;
  const dir = path.join(SCRAPER_SERVICE_ROOT, "debug");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `pepco-submit-code-failed-${Date.now()}.png`);
    await page.screenshot({ path: fp, fullPage: true }).catch(() => {});
    console.log(`[PEPCO][login-flow] submit-code debug screenshot: ${fp}${tag ? ` (${tag})` : ""}`);
  } catch (_) {}
}

/**
 * @param {import('playwright').Page} page
 */
async function peHasDashboardShellInDom(page) {
  return page
    .evaluate(() => {
      return !!(
        document.querySelector("app-dashboard-application") ||
        document.querySelector(".app-dashboard-application") ||
        document.querySelector(".applications") ||
        document.querySelector(".application-card")
      );
    })
    .catch(() => false);
}

/**
 * OTP/code inputs after submit (no contact-method filter).
 *
 * @param {import('playwright').Page} page
 */
async function isOtpLikeInputVisibleAfterSubmit(page) {
  const otpSelectors = [
    'input[autocomplete="one-time-code"]',
    'input[name="verificationCode"]',
    'input[id*="verificationCode"]',
    'input[id*="VerificationCode"]',
    'input[id*="otp"]',
    'input[name*="otp"]',
    'input[placeholder*="code"]',
    'input[aria-label*="code"]',
    'input[data-bind*="verificationCode"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
  ];
  for (const sel of otpSelectors) {
    if (await page.locator(sel).first().isVisible({ timeout: 350 }).catch(() => false)) return true;
  }
  return false;
}

/**
 * Heuristic: visible copy suggests wrong/invalid/expired code (no code values logged).
 *
 * @param {import('playwright').Page} page
 */
async function hasLikelyMfaRejectionLanguage(page) {
  return page
    .evaluate(() => {
      const t = (document.body && document.body.innerText) || "";
      return /\b(invalid|incorrect|wrong|expired)\b.*\b(code|verification|pin)\b|\bcould not verify\b|\bdid not match\b|\bthe code you entered\b|\brequest a new code\b|\btry again\b/i.test(
        t,
      );
    })
    .catch(() => false);
}

/**
 * Safe one-line diagnostics after OTP submit (URLs and booleans only).
 *
 * @param {import('playwright').Page} page
 * @param {(m: string) => void} log
 */
async function logPepcoMfaPostSubmitDiagnostics(page, log) {
  const url = page.url();
  const dashboardShell = await peHasDashboardShellInDom(page);
  const mfaInput = await isOtpLikeInputVisibleAfterSubmit(page);
  const rejectionLang = await hasLikelyMfaRejectionLanguage(page);
  log(
    `[PEPCO][MFA post-submit diag] url=${url} dashboardShell=${dashboardShell} mfaInputVisible=${mfaInput} rejectionLanguageLikely=${rejectionLang}`,
  );
}

/**
 * After Verify/Continue on OTP: wait for dashboard URL/DOM, adaptor redirect, rejection, or timeout.
 *
 * @param {import('playwright').Page} page
 * @param {(m: string) => void} log
 * @param {{ maxWaitMs?: number }} [options]
 * @returns {Promise<{ outcome: 'dashboard_ready' | 'code_rejected' | 'timeout_or_unknown', currentUrl: string }>}
 */
async function waitForPepcoPostOtpOutcome(page, log, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 90000;
  const pollMs = 450;
  const t0 = Date.now();
  let adaptorGraceMs = 0;
  const adaptorGraceCap = 40000;

  while (Date.now() - t0 < maxWaitMs) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const url = page.url();

    if (/\/service-installation-upgrades-portal\/dashboard/i.test(url)) {
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { outcome: "dashboard_ready", currentUrl: url };
    }

    if (/\/Pages\/Adaptor\.aspx/i.test(url) || /\/Adaptor\.aspx/i.test(url)) {
      if (adaptorGraceMs < adaptorGraceCap) {
        adaptorGraceMs += 1200;
        log("[PEPCO][MFA post-submit] intermediate Adaptor.aspx — waiting longer for redirect");
        await page.waitForTimeout(1200).catch(() => {});
        continue;
      }
    }

    const onSiup = /\/service-installation-upgrades-portal/i.test(url);
    if (onSiup && (await peHasDashboardShellInDom(page)) && !isLikelyLoginUrl(url)) {
      log("[PEPCO][MFA post-submit] Angular dashboard shell visible on SIUP — ready");
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { outcome: "dashboard_ready", currentUrl: url };
    }

    const rejectionLang = await hasLikelyMfaRejectionLanguage(page);
    const mfaInput = await isOtpLikeInputVisibleAfterSubmit(page);

    if (rejectionLang && mfaInput) {
      log("[PEPCO][MFA post-submit] rejection language + OTP field visible — code likely rejected");
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { outcome: "code_rejected", currentUrl: url };
    }

    if (rejectionLang && (await detectMfaScreen(page))) {
      log("[PEPCO][MFA post-submit] rejection language on MFA view");
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { outcome: "code_rejected", currentUrl: url };
    }

    await page.waitForTimeout(pollMs).catch(() => {});
  }

  log("[PEPCO][MFA post-submit] primary wait elapsed — running final diagnostics");
  await logPepcoMfaPostSubmitDiagnostics(page, log);
  return { outcome: "timeout_or_unknown", currentUrl: page.url() };
}

/**
 * Extra polling when URL is still settling (Angular / adaptor).
 *
 * @param {import('playwright').Page} page
 * @param {(m: string) => void} log
 * @returns {Promise<{ ok: boolean, currentUrl: string }>}
 */
async function retryDashboardDetectionAfterOtp(page, log) {
  for (let i = 0; i < 55; i++) {
    await page.waitForTimeout(400).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const u = page.url();
    if (/\/service-installation-upgrades-portal\/dashboard/i.test(u)) {
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { ok: true, currentUrl: u };
    }
    if (
      /\/service-installation-upgrades-portal/i.test(u) &&
      (await peHasDashboardShellInDom(page)) &&
      !isLikelyLoginUrl(u)
    ) {
      await logPepcoMfaPostSubmitDiagnostics(page, log);
      return { ok: true, currentUrl: u };
    }
  }
  await logPepcoMfaPostSubmitDiagnostics(page, log);
  return { ok: false, currentUrl: page.url() };
}

/**
 * Submit a PEPCO / Azure AD email MFA code the user entered in-app (Phase 4.5).
 * Does **not** log the code characters.
 *
 * @param {import('playwright').Page} page
 * @param {string} code
 * @param {{ logger?: (m: string) => void }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
async function submitPepcoMfaCode(page, code, opts = {}) {
  const log = typeof opts.logger === "function" ? opts.logger : (m) => console.log(`[PEPCO][login-flow] ${m}`);

  const c = String(code ?? "").trim();
  if (!/^\d{4,8}$/.test(c)) {
    return {
      status: "failed",
      error_code: "INVALID_CODE",
      message: "Verification code must be 4–8 digits.",
      currentUrl: page.url(),
    };
  }

  const typed = await fillOtpCodeInputsBestEffort(page, c, log);
  if (!typed) {
    return {
      status: "failed",
      error_code: "OTP_FIELD_NOT_FOUND",
      message: "Could not find the verification code field on this page.",
      currentUrl: page.url(),
    };
  }

  await clickVerificationSubmitBestEffort(page, log);
  await pauseForOAuthNavigation(page);

  const post = await waitForPepcoPostOtpOutcome(page, log, { maxWaitMs: 90000 });

  if (post.outcome === "dashboard_ready") {
    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl: post.currentUrl,
    };
  }

  if (post.outcome === "code_rejected") {
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: PEPCO_CODE_REJECTED_MSG,
      currentUrl: post.currentUrl,
    };
  }

  const retryDash = await retryDashboardDetectionAfterOtp(page, log);
  if (retryDash.ok) {
    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl: retryDash.currentUrl,
    };
  }

  const resume = await assessPepcoPostMfaResumeState(page);
  if (resume.phase === "dashboard_ready") {
    await logPepcoMfaPostSubmitDiagnostics(page, log);
    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl: resume.currentUrl,
    };
  }

  const rejectionAfter = await hasLikelyMfaRejectionLanguage(page);
  const mfaStill = await isOtpLikeInputVisibleAfterSubmit(page);
  if (rejectionAfter && (mfaStill || (await detectMfaScreen(page)))) {
    log("[PEPCO][MFA post-submit] final check: treating as code rejection");
    await logPepcoMfaPostSubmitDiagnostics(page, log);
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: PEPCO_CODE_REJECTED_MSG,
      currentUrl: page.url(),
    };
  }

  const currentUrl = page.url();
  if (/\/service-installation-upgrades-portal/i.test(currentUrl) && !isLikelyLoginUrl(currentUrl) && (await peHasDashboardShellInDom(page))) {
    await logPepcoMfaPostSubmitDiagnostics(page, log);
    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl,
    };
  }

  await logPepcoMfaPostSubmitDiagnostics(page, log);
  return {
    status: "failed",
    error_code: "MFA_POST_SUBMIT_UNKNOWN",
    message: "Verification did not complete. Try again or restart dashboard discovery.",
    currentUrl,
  };
}

async function pauseForOAuthNavigation(page) {
  await page.waitForTimeout(2200).catch(() => {});
  try {
    await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  } catch (_) {}
}

function dashboardReadyOutcome(url) {
  return {
    status: "completed",
    checkpoint: "dashboard_ready",
    currentUrl: url,
    __pepcoAutomation: /** @type {const} */ ({
      attempted: true,
      succeeded: true,
    }),
  };
}

/**
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.currentUrl
 * @param {(args: { requestedAt: Date }) => Promise<{ status?: string, code?: string, reason?: string } | undefined | null>} [opts.fetchEmailCode]
 * @param {(msg: string) => void} opts.log
 */
async function handlePepcoMfaBranch(opts) {
  const { page, currentUrl: startUrl } = opts;
  const fetchEmailCode = opts.fetchEmailCode;
  /** @type {(msg: string) => void} */
  const log = typeof opts.log === "function" ? opts.log : (m) => console.log(`[PEPCO][login-flow] ${m}`);

  await waitForLoadingOverlayClear(page, { timeoutMs: 30000 });

  let emailPrep = await selectPepcoEmailMfaMethod(page, { logger: log });
  if (emailPrep.outcome === "needs_manual_contact") {
    await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
    if (await isPepcoCodeEntryInputVisible(page) || (await isPepcoCodeEntryScreen(page))) {
      log("Verification code input ready");
      emailPrep = { outcome: "code_input_ready" };
    } else {
      log("MFA contact method automation incomplete; retrying email/send-code once");
      emailPrep = await selectPepcoEmailMfaMethod(page, { logger: log });
    }
  }

  if (emailPrep.outcome === "code_input_ready") {
    if (!fetchEmailCode) {
      return returnMfaCodeInputRequired(page, startUrl, log);
    }
  } else if (emailPrep.outcome === "needs_manual_contact") {
    await maybeDebugScreenshot(page, { label: "pepco-mfa-contact" });
    await logMfaHumanRequiredDiagnostics(page, log, "mfa_contact_method_selection_required");
    return {
      status: "human_required",
      reason: "mfa_contact_method_selection_required",
      message: "Select Email in the PEPCO browser, then continue.",
      currentUrl: page.url() || startUrl,
    };
  }

  if (!fetchEmailCode) {
    if (emailPrep.outcome === "not_contact_screen") {
      await tryTriggerEmailVerificationOption(page, log);
      await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
      if (await isPepcoCodeEntryInputVisible(page)) {
        return returnMfaCodeInputRequired(page, startUrl, log);
      }
    }
    await maybeDebugScreenshot(page, { label: "pepco-mfa" });
    return returnMfaCodeInputRequired(page, startUrl, log);
  }

  if (emailPrep.outcome === "not_contact_screen") {
    await tryTriggerEmailVerificationOption(page, log);
    await waitForLoadingOverlayClear(page, { timeoutMs: 15000 });
  }

  const requestedAt = new Date();

  /** @type {{ status?: string, reason?: string, code?: string } | undefined | null} */
  let poll = null;

  try {
    poll = await fetchEmailCode({ requestedAt });
  } catch (_) {
    poll = { status: "not_found", reason: "poll_threw" };
  }

  if (!poll || String(poll.status || "") !== "found" || !poll.code || String(poll.code).trim().length < 4) {
    await maybeDebugScreenshot(page, { label: "pepco-email-mfa-not-found" });
    let pollReason = "not_found_or_invalid";
    if (poll && poll.status === "not_found") {
      if (poll.reason === "timeout") pollReason = /** @type {const} */ ("timeout");
      else if (poll.reason === "failed") pollReason = /** @type {const} */ ("failed");
    }

    await logMfaHumanRequiredDiagnostics(page, log, "mfa_email_code_input_required");
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: EMAIL_MFA_AUTO_FETCH_FAILED_MSG,
      currentUrl: page.url() || startUrl,
      __pepcoAutomation: {
        attempted: true,
        succeeded: false,
        reason: pollReason,
      },
    };
  }

  const typed = await fillOtpCodeInputsBestEffort(page, String(poll.code), log);

  if (!typed) {
    await maybeDebugScreenshot(page, { label: "pepco-email-mfa-fill-failed" });
    await logMfaHumanRequiredDiagnostics(page, log, "mfa_email_code_input_required");
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: EMAIL_MFA_AUTO_FETCH_FAILED_MSG,
      currentUrl: page.url() || startUrl,
      __pepcoAutomation: { attempted: true, succeeded: false, reason: "otp_fill_failed" },
    };
  }

  await clickVerificationSubmitBestEffort(page, log);
  await pauseForOAuthNavigation(page);

  let url = page.url();
  if (/\/service-installation-upgrades-portal/i.test(url) && !isLikelyLoginUrl(url)) {
    log("completed automated MFA landing on SIUP");
    return dashboardReadyOutcome(url);
  }

  await page.waitForTimeout(1800).catch(() => {});
  url = page.url();
  if (/\/service-installation-upgrades-portal/i.test(url) && !isLikelyLoginUrl(url)) {
    log("completed automated MFA after additional wait");
    return dashboardReadyOutcome(url);
  }

  if (await detectMfaScreen(page)) {
    await maybeDebugScreenshot(page, { label: "pepco-email-mfa-still-pending" });
    await logMfaHumanRequiredDiagnostics(page, log, "mfa_email_code_input_required");
    return {
      status: "human_required",
      reason: "mfa_email_code_input_required",
      message: EMAIL_MFA_AUTO_FETCH_FAILED_MSG,
      currentUrl: url,
      __pepcoAutomation: { attempted: true, succeeded: false, reason: "mfa_still_visible" },
    };
  }

  await maybeDebugScreenshot(page, { label: "pepco-email-mfa-unknown-post-otp" });
  await logMfaHumanRequiredDiagnostics(page, log, "mfa_email_code_input_required");
  return {
    status: "human_required",
    reason: "mfa_email_code_input_required",
    message: EMAIL_MFA_AUTO_FETCH_FAILED_MSG,
    currentUrl: url,
    __pepcoAutomation: { attempted: true, succeeded: false, reason: "unknown_post_submit" },
  };
}

const EMPTY_USERNAME_VALIDATION_MSG = "Email or Username is required.";

const B2C_USERNAME_SELECTORS = [
  "#signInName",
  'input[name="signInName"]',
  'input[type="email"]',
  'input[name="loginfmt"]',
  'input[name="identifier"]',
  'input[id*="signInName"]',
  'input[type="text"]:visible',
];

const B2C_PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="passwd"]',
  'input[name="password"]',
  "#password",
];

/**
 * @param {import('playwright').Page} page
 */
async function isSubmitControlReady(page) {
  const submitBtns = [
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first(),
    page.getByRole("button", { name: /sign\s*in/i }).first(),
    page.getByRole("button", { name: /^continue$/i }).first(),
    page.getByRole("button", { name: /^verify$/i }).first(),
  ];
  for (const b of submitBtns) {
    try {
      if (await b.isVisible({ timeout: 350 }).catch(() => false)) {
        if (await b.isEnabled().catch(() => false)) return true;
      }
    } catch (_) {}
  }
  return false;
}

/**
 * Wait for Azure B2C combined sign-in form to be interactive.
 *
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number, requireSubmit?: boolean }} [opts]
 */
async function waitForB2cFormReady(page, { timeoutMs = 15000, requireSubmit = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const formVis = await page
      .locator("#localAccountForm")
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    const signInVis = await page
      .locator("#signInName")
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    const passVis = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    const overlay = await isLoadingOverlayBlocking(page);
    const submitReady = requireSubmit ? await isSubmitControlReady(page) : true;

    if (formVis && signInVis && passVis && !overlay && submitReady) {
      return true;
    }
    await page.waitForTimeout(200).catch(() => {});
  }
  return false;
}

/**
 * @param {import('playwright').Locator} loc
 */
async function dispatchInputChangeBlur(loc) {
  await loc
    .evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    })
    .catch(() => {});
}

/**
 * @param {import('playwright').Locator} loc
 */
async function inputValueLength(loc) {
  const v = await loc.inputValue().catch(() => "");
  return String(v || "").length;
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 */
async function resolveVisibleInput(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: 4000 });
      const tag = await loc.evaluate((el) => el.tagName).catch(() => "");
      const typ = await loc.getAttribute("type").catch(() => "");
      if (String(typ).toLowerCase() === "password") continue;
      if (/^INPUT$/i.test(tag)) return loc;
    } catch (_) {}
  }
  return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 */
async function resolveVisiblePasswordInput(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: 4000 });
      return loc;
    } catch (_) {}
  }
  return null;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} value
 * @param {(msg: string) => void} log
 * @param {import('playwright').Locator} [existingLoc]
 */
async function fillUsernameFieldRobust(page, value, log, existingLoc) {
  await waitForB2cFormReady(page, { timeoutMs: 15000 });
  const loc =
    existingLoc || (await resolveVisibleInput(page, B2C_USERNAME_SELECTORS));
  if (!loc) return false;

  await loc.focus().catch(() => loc.click({ timeout: 3000 }).catch(() => {}));
  await loc.fill("").catch(() => {});
  await loc.fill(String(value)).catch(() => {});
  await dispatchInputChangeBlur(loc);
  await page.waitForTimeout(300).catch(() => {});

  let len = await inputValueLength(loc);
  log(`username field populated: ${len > 0 ? "yes" : "no"}${len > 0 ? ` (length=${len})` : ""}`);
  if (len === 0) return false;

  await page.waitForTimeout(250).catch(() => {});
  len = await inputValueLength(loc);
  return len > 0;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} value
 * @param {(msg: string) => void} log
 * @param {import('playwright').Locator} [existingLoc]
 */
async function fillPasswordFieldRobust(page, value, log, existingLoc) {
  await waitForB2cFormReady(page, { timeoutMs: 15000 });
  const loc =
    existingLoc || (await resolveVisiblePasswordInput(page, B2C_PASSWORD_SELECTORS));
  if (!loc) return false;

  await loc.focus().catch(() => loc.click({ timeout: 3000 }).catch(() => {}));
  await loc.fill("").catch(() => {});
  await loc.fill(String(value)).catch(() => {});
  await dispatchInputChangeBlur(loc);
  await page.waitForTimeout(250).catch(() => {});

  const len = await inputValueLength(loc);
  log(`password field populated: ${len > 0 ? "yes" : "no"}${len > 0 ? ` (length=${len})` : ""}`);
  return len > 0;
}

/**
 * @param {import('playwright').Page} page
 */
async function hasEmptyUsernameValidationError(page) {
  return page
    .evaluate((msg) => {
      const t = (document.body && document.body.innerText) || "";
      return t.includes(msg);
    }, EMPTY_USERNAME_VALIDATION_MSG)
    .catch(() => false);
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function getLoginValidationErrorText(page) {
  return page
    .evaluate((emptyMsg) => {
      const lines = ((document.body && document.body.innerText) || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (line.includes(emptyMsg)) return emptyMsg;
        if (
          /\b(invalid|incorrect|wrong|does not match|unable to sign|account.*locked|password.*expired)\b/i.test(
            line,
          ) &&
          line.length < 220
        ) {
          return line.slice(0, 200);
        }
      }
      return "";
    }, EMPTY_USERNAME_VALIDATION_MSG)
    .catch(() => "");
}

/**
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 */
async function clickSubmitButtonSafe(page, log) {
  const submitBtns = [
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first(),
    page.getByRole("button", { name: /sign\s*in/i }).first(),
    page.getByRole("button", { name: /^continue$/i }).first(),
    page.getByRole("button", { name: /^verify$/i }).first(),
  ];

  for (const b of submitBtns) {
    try {
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) {
        if (!(await b.isEnabled().catch(() => false))) continue;
        await b.click({ timeout: 15000 });
        log("clicked submit-style control");
        return true;
      }
    } catch (_) {}
  }

  await page.keyboard.press("Enter").catch(() => {});
  log("pressed Enter as fallback submit");
  return true;
}

/**
 * Poll after submit until navigation, MFA, dashboard, or validation error.
 *
 * @param {import('playwright').Page} page
 * @param {string} startUrl
 * @param {{ maxWaitMs?: number }} [opts]
 */
async function waitForPostSubmitOutcome(page, startUrl, { maxWaitMs = 60000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const url = page.url();
    if (url !== startUrl) {
      return { outcome: "url_changed", url };
    }

    if (/\/service-installation-upgrades-portal/i.test(url) && !isLikelyLoginUrl(url)) {
      return { outcome: "dashboard", url };
    }

    if (await peHasDashboardShellInDom(page)) {
      return { outcome: "dashboard", url };
    }

    if (await detectPepcoContactMethodScreen(page)) {
      return { outcome: "mfa_contact", url };
    }

    if (await isPepcoCodeEntryInputVisible(page)) {
      return { outcome: "mfa_code", url };
    }

    if (await detectMfaScreen(page)) {
      return { outcome: "mfa", url };
    }

    if (await hasEmptyUsernameValidationError(page)) {
      return { outcome: "empty_username_error", url };
    }

    const validationError = await getLoginValidationErrorText(page);
    if (validationError) {
      return { outcome: "validation_error", url, validationError };
    }

    await page.waitForTimeout(450).catch(() => {});
  }

  return { outcome: "timeout", url: page.url() };
}

/**
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 * @param {{ error_code: string, message: string }} payload
 */
async function logLoginFailureDiagnostics(page, log, payload) {
  const title = await page.title().catch(() => "");
  const loginFormVisible = await page
    .locator("#localAccountForm")
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  const mfaVisible = await detectMfaScreen(page);
  const dashboardShell = await peHasDashboardShellInDom(page);
  const validationError = await getLoginValidationErrorText(page);

  log(`login failed error_code=${payload.error_code} message=${payload.message}`);
  log(
    `login failure diagnostics url=${page.url()} title=${title} loginFormVisible=${loginFormVisible} mfaVisible=${mfaVisible} dashboardShell=${dashboardShell}${validationError ? ` validationError=${validationError}` : ""}`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {(msg: string) => void} log
 * @param {{ error_code: string, message: string }} payload
 */
async function returnLoginFailure(page, log, payload) {
  await maybeDebugScreenshot(page, { label: "pepco-login-failed" });
  await logLoginFailureDiagnostics(page, log, payload);
  return {
    status: "failed",
    error_code: payload.error_code,
    message: payload.message,
    currentUrl: page.url(),
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 * @param {(msg: string) => void} log
 */
async function ensureBothFieldsPopulated(page, username, password, log) {
  const userLoc = await resolveVisibleInput(page, B2C_USERNAME_SELECTORS);
  const passLoc = await resolveVisiblePasswordInput(page, B2C_PASSWORD_SELECTORS);
  if (!userLoc || !passLoc) return false;

  let userLen = await inputValueLength(userLoc);
  if (userLen === 0) {
    log("username empty before submit; refilling once");
    if (!(await fillUsernameFieldRobust(page, username, log, userLoc))) return false;
    userLen = await inputValueLength(userLoc);
  }

  let passLen = await inputValueLength(passLoc);
  if (passLen === 0) {
    log("password empty before submit; refilling once");
    if (!(await fillPasswordFieldRobust(page, password, log, passLoc))) return false;
    passLen = await inputValueLength(passLoc);
  }

  return userLen > 0 && passLen > 0;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 * @param {(msg: string) => void} log
 * @param {(args: { requestedAt: Date }) => Promise<object | undefined | null>} [fetchEmailCode]
 * @param {{ isRetry?: boolean }} [opts]
 */
async function attemptB2cLoginSubmit(page, username, password, log, fetchEmailCode, opts = {}) {
  const isRetry = opts.isRetry === true;

  const ready = await waitForB2cFormReady(page, { timeoutMs: 15000, requireSubmit: true });
  if (!ready) {
    log("B2C form not fully ready before submit; continuing best-effort");
  }

  if (!(await ensureBothFieldsPopulated(page, username, password, log))) {
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: "Could not populate username and password before submit.",
    });
  }

  log("B2C form ready; submitting login");
  const startUrl = page.url();
  await clickSubmitButtonSafe(page, log);

  const post = await waitForPostSubmitOutcome(page, startUrl, { maxWaitMs: 60000 });
  let currentUrl = post.url || page.url();
  log(`after submit url=${currentUrl}`);

  if (post.outcome === "empty_username_error") {
    if (!isRetry) {
      log("PEPCO login form rejected empty username; retrying form fill once");
      await waitForB2cFormReady(page, { timeoutMs: 15000, requireSubmit: true });
      await fillUsernameFieldRobust(page, username, log);
      await fillPasswordFieldRobust(page, password, log);
      return attemptB2cLoginSubmit(page, username, password, log, fetchEmailCode, {
        isRetry: true,
      });
    }
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_USERNAME_BINDING_FAILED",
      message: "PEPCO login form cleared the username during submit.",
    });
  }

  if (post.outcome === "validation_error" && post.validationError) {
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: post.validationError,
    });
  }

  if (post.outcome === "dashboard") {
    return {
      status: "completed",
      checkpoint: "dashboard_ready",
      currentUrl,
    };
  }

  if (
    post.outcome === "mfa" ||
    post.outcome === "mfa_contact" ||
    post.outcome === "mfa_code" ||
    (await detectMfaScreen(page))
  ) {
    await waitForLoadingOverlayClear(page, { timeoutMs: 30000 });
    return handlePepcoMfaBranch({ page, fetchEmailCode, log, currentUrl });
  }

  // URL may have changed while MFA UI is still rendering (CombinedSigninAndSignup loading overlay).
  const pollDeadline = Date.now() + 35000;
  while (Date.now() < pollDeadline) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    if (await isLoadingOverlayBlocking(page)) {
      await page.waitForTimeout(400).catch(() => {});
      continue;
    }

    currentUrl = page.url();

    if (await hasEmptyUsernameValidationError(page)) {
      if (!isRetry) {
        log("PEPCO login form rejected empty username; retrying form fill once");
        await waitForB2cFormReady(page, { timeoutMs: 15000, requireSubmit: true });
        await fillUsernameFieldRobust(page, username, log);
        await fillPasswordFieldRobust(page, password, log);
        return attemptB2cLoginSubmit(page, username, password, log, fetchEmailCode, {
          isRetry: true,
        });
      }
      return returnLoginFailure(page, log, {
        error_code: "LOGIN_USERNAME_BINDING_FAILED",
        message: "PEPCO login form cleared the username during submit.",
      });
    }

    if (/\/service-installation-upgrades-portal/i.test(currentUrl) && !isLikelyLoginUrl(currentUrl)) {
      return {
        status: "completed",
        checkpoint: "dashboard_ready",
        currentUrl,
      };
    }

    if (await detectMfaScreen(page)) {
      await waitForLoadingOverlayClear(page, { timeoutMs: 30000 });
      return handlePepcoMfaBranch({ page, fetchEmailCode, log, currentUrl });
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return returnLoginFailure(page, log, {
    error_code: "LOGIN_FAILED",
    message: "Login did not reach MFA or dashboard; unexpected page state.",
  });
}

/**
 * @param {object} args
 * @param {import('playwright').Page} args.page
 * @param {string} args.loginUrl
 * @param {string} args.username
 * @param {string} args.password
 * @param {(msg: string) => void} [args.logger]
 * @param {(args: { requestedAt: Date }) => Promise<{ status?: string, code?: string, reason?: string } | undefined | null>} [args.fetchEmailCode]
 * @returns {Promise<object>}
 */
async function runPepcoLoginFlow({ page, loginUrl, username, password, logger, fetchEmailCode }) {
  const log = typeof logger === "function" ? logger : (m) => console.log(`[PEPCO][login-flow] ${m}`);

  try {
    await page.goto(String(loginUrl).trim(), {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
    log(`landed url=${page.url()}`);
  } catch (e) {
    await maybeDebugScreenshot(page, { label: "pepco-goto-failed" });
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const readyBeforeFill = await waitForB2cFormReady(page, { timeoutMs: 20000 });
  if (!readyBeforeFill) {
    log("B2C form not fully ready before fill; continuing best-effort");
  }

  let userLoc = await resolveVisibleInput(page, B2C_USERNAME_SELECTORS);
  if (!userLoc) {
    await maybeDebugScreenshot(page, { label: "pepco-no-username" });
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: "Could not find username/email field",
    });
  }

  if (!(await fillUsernameFieldRobust(page, username, log, userLoc))) {
    await maybeDebugScreenshot(page, { label: "pepco-no-username" });
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: "Could not populate username/email field",
    });
  }

  let passLoc = await resolveVisiblePasswordInput(page, B2C_PASSWORD_SELECTORS);

  if (!passLoc) {
    const nextCandidates = [
      page.getByRole("button", { name: /^next$/i }).first(),
      page.getByRole("button", { name: /^continue$/i }).first(),
      page.locator('button[type="submit"]').first(),
    ];
    for (const btn of nextCandidates) {
      try {
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click({ timeout: 8000 });
          log("clicked continue/next after username");
          await page.waitForTimeout(2000);
          break;
        }
      } catch (_) {}
    }

    await waitForB2cFormReady(page, { timeoutMs: 20000 });
    passLoc = await resolveVisiblePasswordInput(page, B2C_PASSWORD_SELECTORS);
  }

  if (!passLoc) {
    await maybeDebugScreenshot(page, { label: "pepco-no-password" });
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: "Could not find password field",
    });
  }

  if (!(await fillPasswordFieldRobust(page, password, log, passLoc))) {
    await maybeDebugScreenshot(page, { label: "pepco-no-password" });
    return returnLoginFailure(page, log, {
      error_code: "LOGIN_FAILED",
      message: "Could not populate password field",
    });
  }

  return attemptB2cLoginSubmit(page, username, password, log, fetchEmailCode);
}

module.exports = {
  runPepcoLoginFlow,
  detectMfaScreen,
  assessPepcoPostMfaResumeState,
  tryTriggerEmailVerificationOption,
  submitPepcoMfaCode,
  selectPepcoEmailMfaMethod,
  detectPepcoContactMethodScreen,
  isPepcoCodeEntryInputVisible,
  maybePepcoSubmitCodeFailureScreenshot,
  waitForB2cFormReady,
};
