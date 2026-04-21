/**
 * Montgomery County Avolve portal host login — establishes real portal cookies before Home/Index.
 * Isolated from generic performLogin (Washington / other Avolve tenants).
 */

"use strict";

const MONTGOMERY_HOST = "montgomeryco-md-us.avolvecloud.com";

function montgomeryPortalOrigin(dashboardUrl) {
  try {
    const u = new URL(String(dashboardUrl || "").trim());
    if (new RegExp(MONTGOMERY_HOST, "i").test(u.hostname)) return u.origin;
  } catch (_) {}
  return `https://${MONTGOMERY_HOST}`;
}

function montgomeryDefaultLoginFormUrl(dashboardUrl) {
  return `${montgomeryPortalOrigin(dashboardUrl)}/Login/Index/MontgomeryDPS-Prod`;
}

/**
 * @param {string[]} names
 */
function montgomeryAuthCookiePresence(names) {
  const set = new Set(names);
  return {
    __RequestVerificationToken: set.has("__RequestVerificationToken"),
    PortalJurisdiction: set.has("PortalJurisdiction"),
    SessionIDPD: set.has("SessionIDPD"),
    SessionIDPortal: set.has("SessionIDPortal"),
    ARRAffinity: set.has("ARRAffinity"),
    ARRAffinitySameSite: set.has("ARRAffinitySameSite"),
  };
}

/**
 * Strong portal session: jurisdiction + at least one portal session id.
 * @param {ReturnType<typeof montgomeryAuthCookiePresence>} p
 */
function montgomeryStrongPortalSession(p) {
  return !!(
    p.PortalJurisdiction &&
    (p.SessionIDPortal || p.SessionIDPD)
  );
}

function montgomeryAppPathExcludingLogin(url) {
  const u = String(url || "");
  if (!new RegExp(MONTGOMERY_HOST, "i").test(u)) return false;
  if (/\/Login\//i.test(u)) return false;
  if (/\/Home\/Index/i.test(u)) return true;
  if (/\/ProjectDox\//i.test(u)) return true;
  return false;
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} origin
 */
async function readMontgomeryPortalCookiePresence(context, origin) {
  const cookies = await context.cookies(origin);
  const names = cookies.map((c) => c.name);
  return { names, presence: montgomeryAuthCookiePresence(names) };
}

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} origin
 */
async function logMontgomeryAuthCookieDebug(context, origin) {
  const { names, presence } = await readMontgomeryPortalCookiePresence(
    context,
    origin,
  );
  console.log(
    "[Montgomery][auth] cookie flags:",
    `__RequestVerificationToken=${presence.__RequestVerificationToken}`,
    `PortalJurisdiction=${presence.PortalJurisdiction}`,
    `SessionIDPD=${presence.SessionIDPD}`,
    `SessionIDPortal=${presence.SessionIDPortal}`,
    `ARRAffinity=${presence.ARRAffinity}`,
    `ARRAffinitySameSite=${presence.ARRAffinitySameSite}`,
    `| count=${names.length}`,
  );
  return { names, presence };
}

/**
 * Submit Montgomery portal login form with normal Playwright input + same-form submit (includes anti-forgery token).
 * Success = app path URL after submit, OR portal session cookies + successful Home/Index navigation.
 *
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 * @param {string} dashboardUrl — saved portal URL (e.g. ProjectDox/index.html)
 */
async function performMontgomeryPortalLogin(page, username, password, dashboardUrl) {
  const origin = montgomeryPortalOrigin(dashboardUrl);
  const loginFormUrl = montgomeryDefaultLoginFormUrl(dashboardUrl);
  const startUrl =
    String(dashboardUrl || "").trim() || loginFormUrl;

  console.log("[Montgomery][auth] opening entry URL:", startUrl);
  await page.goto(startUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(600);

  let pwdVisible = await page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
  if (!pwdVisible) {
    console.log(
      "[Montgomery][auth] password field not on entry page; goto login form:",
      loginFormUrl,
    );
    await page.goto(loginFormUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(600);
  }

  const formScoped = page
    .locator("form")
    .filter({ has: page.locator('input[type="password"]') })
    .first();
  const hasWrappedForm = (await formScoped.count()) > 0;

  /** @type {import('playwright').Locator} */
  let userField;
  /** @type {import('playwright').Locator} */
  let passField;
  /** @type {import('playwright').Locator} */
  let submit;

  if (hasWrappedForm) {
    await formScoped.waitFor({ state: "visible", timeout: 25000 });
    userField = formScoped
      .locator(
        'input[name="UserName"], input[name="username"], input[name="Email"], input#UserName, input[type="email"], input[type="text"]',
      )
      .first();
    passField = formScoped.locator('input[type="password"]').first();
    submit = formScoped
      .locator('button[type="submit"], input[type="submit"]')
      .first();
  } else {
    console.log(
      "[Montgomery][auth] no form+password wrapper; using visible page fields",
    );
    passField = page.locator('input[type="password"]').first();
    await passField.waitFor({ state: "visible", timeout: 25000 });
    userField = page
      .locator(
        'input[name="UserName"], input[name="username"], input[name="Email"], input#UserName, input[type="email"]',
      )
      .first();
    submit = page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Login")',
      )
      .first();
  }

  await userField.click();
  await userField.fill(String(username || ""));
  await userField.press("Tab");
  await passField.fill(String(password || ""));

  console.log(
    "[Montgomery][auth] submitting login form (same form as anti-forgery token)",
  );
  await submit.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  let url = page.url();
  console.log("[Montgomery][auth] URL after submit + network settle:", url);

  let { presence } = await logMontgomeryAuthCookieDebug(page.context(), origin);

  const pollDeadline = Date.now() + 28000;
  while (Date.now() < pollDeadline) {
    url = page.url();
    if (montgomeryAppPathExcludingLogin(url)) {
      await logMontgomeryAuthCookieDebug(page.context(), origin);
      console.log(
        "[Montgomery][auth] login OK: landed on app path without extra goto:",
        url,
      );
      return url;
    }
    if (montgomeryStrongPortalSession(presence)) {
      console.log(
        "[Montgomery][auth] portal session cookies detected after submit (waiting for URL or verify step)",
      );
      break;
    }
    ({ presence } = await readMontgomeryPortalCookiePresence(
      page.context(),
      origin,
    ));
    await page.waitForTimeout(400);
  }

  url = page.url();
  ({ presence } = await readMontgomeryPortalCookiePresence(
    page.context(),
    origin,
  ));

  if (!montgomeryStrongPortalSession(presence)) {
    await logMontgomeryAuthCookieDebug(page.context(), origin);
    if (/\/Login\//i.test(url)) {
      throw new Error(
        "Montgomery login failed: still on Login and missing SessionIDPortal/SessionIDPD or PortalJurisdiction cookies",
      );
    }
    if (!montgomeryAppPathExcludingLogin(url)) {
      throw new Error(
        "Montgomery login failed: no portal session cookies and URL is not an app path",
      );
    }
    await logMontgomeryAuthCookieDebug(page.context(), origin);
    return url;
  }

  if (montgomeryAppPathExcludingLogin(url)) {
    await logMontgomeryAuthCookieDebug(page.context(), origin);
    console.log("[Montgomery][auth] login OK: app path with session cookies:", url);
    return url;
  }

  const homeUrl = `${origin}/Home/Index`;
  console.log(
    "[Montgomery][auth] verify: goto Home/Index (session cookies present); current URL:",
    url,
  );
  await logMontgomeryAuthCookieDebug(page.context(), origin);

  try {
    await page.goto(homeUrl, { waitUntil: "networkidle", timeout: 60000 });
  } catch (e) {
    console.warn(
      "[Montgomery][auth] Home/Index goto failed:",
      (e && e.message) || e,
    );
    throw e;
  }
  await page.waitForTimeout(800);
  url = page.url();
  console.log("[Montgomery][auth] URL after verify goto Home/Index:", url);
  await logMontgomeryAuthCookieDebug(page.context(), origin);

  if (/\/Login\//i.test(url)) {
    throw new Error(
      "Montgomery login failed: /Home/Index redirected back to Login (session rejected)",
    );
  }
  if (!montgomeryAppPathExcludingLogin(url)) {
    throw new Error(
      `Montgomery login failed: unexpected URL after Home/Index verify: ${url}`,
    );
  }

  const marker = await page
    .getByText(/My Projects|ProjectDox Dashboard/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (marker) {
    console.log("[Montgomery][auth] dashboard text marker visible on page");
  }

  console.log("[Montgomery][auth] login OK; final URL:", url);
  return url;
}

module.exports = {
  performMontgomeryPortalLogin,
};
