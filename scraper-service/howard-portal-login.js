/**
 * Howard County Avolve B2C portal — credentials on howardco-md-us.avolvecloud.com.
 * Applicant sign-in (#localAccountForm / #next) is the primary automation path.
 */

"use strict";

const HOWARD_HOST = "howardco-md-us.avolvecloud.com";

/** @typedef {{ desc: string, sel: string }} HowardFieldSelector */

const HOWARD_USER_FIELD_CHAIN = /** @type {HowardFieldSelector[]} */ ([
  { desc: 'input[placeholder="Email Address"]', sel: 'input[placeholder="Email Address"]' },
  { desc: 'input[type="email"]', sel: 'input[type="email"]' },
  { desc: 'input[name="UserName"]', sel: 'input[name="UserName"]' },
  { desc: 'input[name="username"]', sel: 'input[name="username"]' },
  { desc: 'input[name="Email"]', sel: 'input[name="Email"]' },
  { desc: "input#UserName", sel: "input#UserName" },
  { desc: "input#signInName", sel: "input#signInName" },
  { desc: 'input[name="signInName"]', sel: 'input[name="signInName"]' },
  { desc: 'input[type="text"]', sel: 'input[type="text"]' },
]);

const HOWARD_PASSWORD_FIELD_CHAIN = /** @type {HowardFieldSelector[]} */ ([
  { desc: 'input[type="password"]', sel: 'input[type="password"]' },
  { desc: 'input[name="Password"]', sel: 'input[name="Password"]' },
  { desc: "input#password", sel: "input#password" },
]);

const SEL = {
  form: "#localAccountForm",
  email: "#signInName",
  password: "#password",
  next: "#next",
  pageErr: "#localAccountForm .error.pageLevel",
  itemErr: "#localAccountForm .error.itemLevel",
  working: "#localAccountForm .working",
  continueBtn: "#continue-button",
};

const POST_SUBMIT_SHORT_WAIT_MS = 1200;
const HOWARD_AUTH_REDIRECT_DEADLINE_MS = 60000;
/** Applicant PATH1/PATH2: no single wait or race segment longer than this (ms). */
const APPLICANT_SUBMIT_RACE_MS = 30000;

function howardPortalOrigin(dashboardUrl) {
  try {
    const u = new URL(String(dashboardUrl || "").trim());
    if (new RegExp(HOWARD_HOST, "i").test(u.hostname)) return u.origin;
  } catch (_) {}
  return `https://${HOWARD_HOST}`;
}

function isStillOnHowardB2cAuthorizePage(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.hostname.toLowerCase() !== "howardb2cprod.b2clogin.com") return false;
    return u.pathname.toLowerCase().includes("/oauth2/v2.0/authorize");
  } catch (_) {
    return false;
  }
}

function hostnameIsHowardAvolve(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase() === HOWARD_HOST.toLowerCase();
  } catch (_) {
    return false;
  }
}

/** Legacy Howard app path (non-B2C). */
function isHowardAuthLandingSuccess(url) {
  const s = String(url || "");
  if (/\/Home\/SSOLanding/i.test(s) || /SSOLanding/i.test(s)) return true;
  if (
    new RegExp(HOWARD_HOST, "i").test(s) &&
    !/\/Login\//i.test(s) &&
    (/\/Home\//i.test(s) || /\/ProjectDox\//i.test(s))
  ) {
    return true;
  }
  return false;
}

/**
 * @param {import("playwright").Page} page
 * @param {string} url
 */
async function isHowardAuthSuccessState(page, url) {
  if (isHowardAuthLandingSuccess(url)) return true;
  if (hostnameIsHowardAvolve(url) && !/\/Login\//i.test(String(url || ""))) return true;
  const cont = await page
    .locator(SEL.continueBtn)
    .first()
    .isVisible()
    .catch(() => false);
  return !!cont;
}

/**
 * @param {import("playwright").Page} page
 * @param {string} attemptLabel
 */
async function logHowardApplicantPostSubmitDiag(page, url, attemptLabel) {
  const diag = await page
    .evaluate((s) => {
      function cs(el) {
        if (!el) return { display: "(none)", visibility: "(none)" };
        const st = window.getComputedStyle(el);
        return {
          display: st.display || "",
          visibility: st.visibility || "",
        };
      }
      function visText(el) {
        if (!el) return { visible: false, text: "" };
        const st = window.getComputedStyle(el);
        const hidden = st.display === "none" || st.visibility === "hidden";
        const t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
        const r = el.getBoundingClientRect();
        const box = r.width > 1 && r.height > 1;
        return { visible: !hidden && box, text: t };
      }
      const next = document.querySelector(s.next);
      const work = document.querySelector(s.working);
      const pe = document.querySelector(s.pageErr);
      const ie = document.querySelector(s.itemErr);
      const pv = visText(pe);
      const iv = visText(ie);
      return {
        nextDisabled: !!(next && next.disabled),
        working: cs(work),
        pageErrVisible: pv.visible,
        pageErrText: pv.text,
        itemErrVisible: iv.visible,
        itemErrText: iv.text,
      };
    }, {
      next: SEL.next,
      working: SEL.working,
      pageErr: SEL.pageErr,
      itemErr: SEL.itemErr,
    })
    .catch(() => ({
      nextDisabled: "(unknown)",
      working: { display: "(unknown)", visibility: "(unknown)" },
      pageErrVisible: false,
      pageErrText: "",
      itemErrVisible: false,
      itemErrText: "",
    }));

  const stillB2c = isStillOnHowardB2cAuthorizePage(url);
  console.log(
    `[Howard][auth] diag ${attemptLabel} url=${String(url).slice(0, 140)} stillOnB2cAuthorize=${stillB2c} nextDisabled=${diag.nextDisabled} workingDisplay=${diag.working.display} workingVisibility=${diag.working.visibility} pageErrVisible=${diag.pageErrVisible} pageErrText=${JSON.stringify(diag.pageErrText)} itemErrVisible=${diag.itemErrVisible} itemErrText=${JSON.stringify(diag.itemErrText)}`,
  );
}

/**
 * @returns {{ line: string, pageText: string, itemText: string }}
 */
async function collectHowardApplicantFormErrors(page) {
  const r = await page
    .evaluate((s) => {
      const pe = document.querySelector(s.pageErr);
      const ie = document.querySelector(s.itemErr);
      const pt = (pe && (pe.textContent || "").replace(/\s+/g, " ").trim()) || "";
      const it = (ie && (ie.textContent || "").replace(/\s+/g, " ").trim()) || "";
      const line = [pt, it].filter(Boolean).join(" | ");
      return { pageText: pt, itemText: it, combined: line };
    }, { pageErr: SEL.pageErr, itemErr: SEL.itemErr })
    .catch(() => ({ pageText: "", itemText: "", combined: "" }));
  return { line: r.combined || "", pageText: r.pageText || "", itemText: r.itemText || "" };
}

/**
 * Applicant fields: native HTMLInputElement value setter + input/change/blur (B2C/React-safe).
 * @param {import("playwright").Page} page
 * @param {string} inputCss
 * @param {string} value
 */
async function applyHowardApplicantFieldInputSequence(page, inputCss, value) {
  const loc = page.locator(inputCss).first();
  await loc.waitFor({ state: "visible", timeout: 20000 });
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el || !(el instanceof HTMLInputElement)) return;
      el.focus();
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (!desc || !desc.set) return;
      desc.set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    { sel: inputCss, val: String(value ?? "") },
  );
}

async function evalApplicantWorkingVisible(page) {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    }, SEL.working)
    .catch(() => false);
}

async function evalApplicantItemError(page) {
  return page
    .evaluate((sel) => {
      const ie = document.querySelector(sel);
      if (!ie) return { visible: false, text: "" };
      const st = window.getComputedStyle(ie);
      const hidden = st.display === "none" || st.visibility === "hidden";
      const r = ie.getBoundingClientRect();
      const vis = !hidden && r.height > 0 && r.width > 0;
      const t = (ie.textContent || "").replace(/\s+/g, " ").trim();
      return { visible: vis && t.length > 0, text: t };
    }, SEL.itemErr)
    .catch(() => ({ visible: false, text: "" }));
}

/**
 * After a single `page.click(#next)`: wait for .working (≤10s from click), then race until `clickStartMs + 30s`.
 * @returns {Promise<{ ok: boolean, reason: string, itemText?: string }>}
 */
async function raceApplicantSubmitOutcomeAfterNextClick(page, pathLabel, clickStartMs) {
  const t0 = clickStartMs;
  const hardEnd = t0 + APPLICANT_SUBMIT_RACE_MS;
  const workingWaitEnd = Math.min(t0 + 10000, hardEnd);

  while (Date.now() < workingWaitEnd) {
    const url = page.url();
    if (await isHowardAuthSuccessState(page, url)) {
      return { ok: true, reason: `${pathLabel}:success-before-working` };
    }
    if (!isStillOnHowardB2cAuthorizePage(url)) {
      return { ok: true, reason: `${pathLabel}:left-authorize-before-working` };
    }
    if (await evalApplicantWorkingVisible(page)) break;
    await page.waitForTimeout(150);
  }

  let sawWorking = false;
  if (Date.now() < hardEnd && (await evalApplicantWorkingVisible(page))) {
    sawWorking = true;
  }

  while (Date.now() < hardEnd) {
    const url = page.url();
    if (await isHowardAuthSuccessState(page, url)) {
      return { ok: true, reason: `${pathLabel}:success` };
    }
    if (!isStillOnHowardB2cAuthorizePage(url)) {
      return { ok: true, reason: `${pathLabel}:left-b2c-authorize` };
    }
    const wv = await evalApplicantWorkingVisible(page);
    if (wv) sawWorking = true;
    const item = await evalApplicantItemError(page);
    if (sawWorking && !wv && item.visible && item.text) {
      return {
        ok: false,
        reason: `${pathLabel}:working-ended-item-error`,
        itemText: item.text,
      };
    }
    if (!sawWorking && item.visible && item.text && Date.now() > t0 + 2000) {
      return {
        ok: false,
        reason: `${pathLabel}:item-error-no-working`,
        itemText: item.text,
      };
    }
    await page.waitForTimeout(200);
  }

  const it = await evalApplicantItemError(page);
  return {
    ok: false,
    reason: `${pathLabel}:race-timeout`,
    itemText: it.text || "",
  };
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, itemText?: string }>}
 */
async function applicantPath1Submit(page) {
  console.log("[Howard][auth] PATH1: page.click(#next)");
  await page.click(SEL.next);
  const clickAt = Date.now();
  return raceApplicantSubmitOutcomeAfterNextClick(page, "PATH1", clickAt);
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, itemText?: string }>}
 */
async function applicantPath2Submit(page, username, password) {
  console.log(
    "[Howard][auth] PATH2: clear fields + page.type (delay 40) + Tab per field + page.click(#next)",
  );
  await page.locator(SEL.email).first().click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.locator(SEL.password).first().click({ clickCount: 3 });
  await page.keyboard.press("Backspace");

  await page.click(SEL.email);
  await page.type(SEL.email, String(username || ""), { delay: 40 });
  await page.keyboard.press("Tab");
  await page.click(SEL.password);
  await page.type(SEL.password, String(password || ""), { delay: 40 });
  await page.keyboard.press("Tab");

  const emailV = await page.locator(SEL.email).first().inputValue().catch(() => "");
  const pwdLen = (await page.locator(SEL.password).first().inputValue().catch(() => "")).length;
  console.log(
    `[Howard][auth] post-path2-type readback emailValue=${JSON.stringify(emailV)} passwordLen=${pwdLen}`,
  );

  await page.click(SEL.next);
  const clickAt = Date.now();
  return raceApplicantSubmitOutcomeAfterNextClick(page, "PATH2", clickAt);
}

/**
 * @param {import("playwright").Page} page
 * @returns {Promise<boolean>}
 */
async function tryHowardLocalAccountFormDomSubmit(page) {
  return page
    .evaluate((formSel) => {
      const form = document.querySelector(formSel);
      if (!form) return false;
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return true;
      } catch (_) {
        return false;
      }
    }, SEL.form)
    .catch(() => false);
}

/**
 * First selector in chain that is currently visible on `scope`.
 * @param {import("playwright").Locator} scope
 * @param {HowardFieldSelector[]} chain
 * @param {string} role
 */
async function resolveFirstVisibleField(scope, chain, role) {
  for (const { desc, sel } of chain) {
    const loc = scope.locator(sel).first();
    const visible = await loc.isVisible().catch(() => false);
    if (visible) return { locator: loc, desc };
  }
  const tried = chain.map((c) => c.desc).join(", ");
  throw new Error(
    `Howard auth error: no visible ${role} field matched (${tried}). Check B2C page layout or entry URL.`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} username
 * @param {string} password
 * @param {string} dashboardUrl — saved portal URL (Howard B2C / entry)
 */
async function performHowardPortalLogin(page, username, password, dashboardUrl) {
  const origin = howardPortalOrigin(dashboardUrl);
  const startUrl = String(dashboardUrl || "").trim() || `${origin}/`;

  console.log("[Howard][auth] opening entry URL:", startUrl);
  await page.goto(startUrl, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(600);

  let pwdVisible = await page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!pwdVisible) {
    console.log("[Howard][auth] waiting for password field (B2C may be multi-step)…");
    await page
      .locator('input[type="password"]')
      .first()
      .waitFor({ state: "visible", timeout: 45000 })
      .catch(() => {});
    pwdVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible()
      .catch(() => false);
  }

  const formScoped = page
    .locator("form")
    .filter({ has: page.locator('input[type="password"]') })
    .first();
  const hasWrappedForm = (await formScoped.count()) > 0;
  const fieldScope = hasWrappedForm ? formScoped : page;

  if (hasWrappedForm) {
    await formScoped.waitFor({ state: "visible", timeout: 25000 });
  } else {
    console.log("[Howard][auth] no form+password wrapper; using visible page fields");
    await page
      .locator('input[type="password"]')
      .first()
      .waitFor({ state: "visible", timeout: 25000 })
      .catch(() => {});
  }

  const applicantFormVisible = await page
    .locator(SEL.form)
    .first()
    .isVisible()
    .catch(() => false);
  const applicantSignInVisible = await page
    .locator(SEL.email)
    .first()
    .isVisible()
    .catch(() => false);

  let userField;
  let passField;
  let usedApplicantPath = false;

  if (applicantFormVisible && applicantSignInVisible) {
    usedApplicantPath = true;
    console.log(
      `[Howard][auth] matched Howard selectors: form=${SEL.form} email=${SEL.email} password=${SEL.password} next=${SEL.next}`,
    );
    await page.locator(SEL.form).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await applyHowardApplicantFieldInputSequence(page, SEL.email, String(username || ""));
    await applyHowardApplicantFieldInputSequence(page, SEL.password, String(password || ""));
    const commitEmail = await page.locator(SEL.email).first().inputValue().catch(() => "");
    const commitPwdLen = (await page.locator(SEL.password).first().inputValue().catch(() => ""))
      .length;
    console.log(
      `[Howard][auth] post-path1-commit readback emailValue=${JSON.stringify(commitEmail)} passwordLen=${commitPwdLen}`,
    );
    userField = page.locator(SEL.email).first();
    passField = page.locator(SEL.password).first();
  } else {
    const userResolved = await resolveFirstVisibleField(
      fieldScope,
      HOWARD_USER_FIELD_CHAIN,
      "email/username",
    );
    const passResolved = await resolveFirstVisibleField(
      fieldScope,
      HOWARD_PASSWORD_FIELD_CHAIN,
      "password",
    );
    userField = userResolved.locator;
    passField = passResolved.locator;
    console.log(
      `[Howard][auth] matched Howard selectors (legacy): user=${userResolved.desc}, password=${passResolved.desc}`,
    );
    await userField.click();
    await userField.fill(String(username || ""));
    await passField.fill(String(password || ""));
  }

  let emailReadback = await userField.inputValue().catch(() => "");
  let passwordReadback = await passField.inputValue().catch(() => "");
  let emailHasText = String(emailReadback).trim().length > 0;
  let passwordLen = String(passwordReadback).length;

  console.log(
    `[Howard][auth] post-fill readback: emailHasText=${emailHasText}, passwordLen=${passwordLen}`,
  );

  if (!emailHasText || passwordLen === 0) {
    throw new Error(
      `Howard auth error: form fields not populated after fill (emailHasText=${emailHasText}, passwordLen=${passwordLen}). applicantPath=${usedApplicantPath}`,
    );
  }

  if (usedApplicantPath) {
    emailReadback = await page.locator(SEL.email).first().inputValue().catch(() => "");
    passwordReadback = await page.locator(SEL.password).first().inputValue().catch(() => "");
    emailHasText = String(emailReadback).trim().length > 0;
    passwordLen = String(passwordReadback).length;
    console.log(
      `[Howard][auth] post-fill readback (applicant #signInName/#password): emailHasText=${emailHasText}, passwordLen=${passwordLen}`,
    );
    if (!emailHasText || passwordLen === 0) {
      throw new Error(
        `Howard auth error: applicant fields empty after input sequence (emailHasText=${emailHasText}, passwordLen=${passwordLen})`,
      );
    }
  }

  async function finalizeSuccessRedirect(reason) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(800);
    const u = page.url();
    console.log(`[Howard][auth] success (${reason}):`, u.slice(0, 200));
    return u;
  }

  let url = page.url();

  if (usedApplicantPath) {
    await page.locator(SEL.next).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

    const r1 = await applicantPath1Submit(page);
    if (r1.ok) {
      console.log(`[Howard][auth] PATH1 succeeded: ${r1.reason}`);
      return finalizeSuccessRedirect(`applicant-${r1.reason}`);
    }
    console.log(
      `[Howard][auth] PATH1 failed before PATH2: reason=${r1.reason}${r1.itemText ? ` itemText=${JSON.stringify(r1.itemText)}` : ""}`,
    );

    const r2 = await applicantPath2Submit(page, username, password);
    if (r2.ok) {
      console.log(`[Howard][auth] PATH2 succeeded: ${r2.reason}`);
      return finalizeSuccessRedirect(`applicant-${r2.reason}`);
    }
    console.log(
      `[Howard][auth] PATH2 failed: reason=${r2.reason}${r2.itemText ? ` itemText=${JSON.stringify(r2.itemText)}` : ""}`,
    );
    const itemFinal =
      (r2.itemText || r1.itemText || (await evalApplicantItemError(page)).text || "").trim() ||
      "(none)";
    throw new Error(
      `Howard applicant login failed after PATH1 and PATH2. PATH1: ${r1.reason}. PATH2: ${r2.reason}. itemLevelError=${itemFinal}`,
    );
  } else {
    const submitScope = hasWrappedForm ? formScoped : page;
    const submit = submitScope
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in")',
      )
      .first();
    console.log("[Howard][auth] submit attempt: legacy primary button");
    await submit.click();
    await page.waitForTimeout(POST_SUBMIT_SHORT_WAIT_MS);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    url = page.url();
    console.log(
      `[Howard][auth] after legacy click: stillOnB2cAuthorize=${isStillOnHowardB2cAuthorizePage(url)} url=${url.slice(0, 120)}`,
    );
    if (await isHowardAuthSuccessState(page, url)) {
      return finalizeSuccessRedirect("post-legacy-click");
    }
    if (isStillOnHowardB2cAuthorizePage(url)) {
      await passField.focus().catch(() => {});
      await passField.press("Enter");
      await page.waitForTimeout(POST_SUBMIT_SHORT_WAIT_MS);
      url = page.url();
      if (await isHowardAuthSuccessState(page, url)) {
        return finalizeSuccessRedirect("post-legacy-Enter");
      }
    }
    if (isStillOnHowardB2cAuthorizePage(url)) {
      const domOk = await tryHowardLocalAccountFormDomSubmit(page);
      console.log(`[Howard][auth] legacy form submit invoked=${domOk}`);
      await page.waitForTimeout(POST_SUBMIT_SHORT_WAIT_MS);
      url = page.url();
      if (await isHowardAuthSuccessState(page, url)) {
        return finalizeSuccessRedirect("post-legacy-form");
      }
    }
  }

  if (!usedApplicantPath) {
    const deadline = Date.now() + HOWARD_AUTH_REDIRECT_DEADLINE_MS;
    while (Date.now() < deadline) {
      url = page.url();
      if (await isHowardAuthSuccessState(page, url)) {
        return finalizeSuccessRedirect("poll");
      }
      await page.waitForTimeout(500);
    }
  }

  url = page.url();
  if (!usedApplicantPath && (await isHowardAuthSuccessState(page, url))) {
    return finalizeSuccessRedirect("poll-final");
  }

  const errParts = await collectHowardApplicantFormErrors(page);
  const stillB2c = isStillOnHowardB2cAuthorizePage(url);
  let baseMsg;
  if (stillB2c && usedApplicantPath) {
    baseMsg =
      "Howard login failed: applicant sign-in button was triggered but session never left the B2C authorize page";
  } else if (stillB2c) {
    baseMsg =
      "Howard login failed: credentials were submitted but the session never left the B2C authorize page";
  } else if (/\/Login\//i.test(url)) {
    baseMsg =
      "Howard login failed: still on Howard Login after wait — check credentials or entry URL";
  } else {
    baseMsg = `Howard login failed: session never reached SSOLanding, ${HOWARD_HOST}, or #continue-button. Final URL: ${url}`;
  }
  console.log(`[Howard][auth] final failure: stillOnB2cAuthorize=${stillB2c} url=${url.slice(0, 220)}`);
  const append =
    errParts.line ||
    [errParts.pageText, errParts.itemText].filter((x) => String(x).trim()).join(" | ");
  if (append) {
    throw new Error(`${baseMsg}. ${append}`);
  }
  throw new Error(baseMsg);
}

module.exports = {
  performHowardPortalLogin,
  howardPortalOrigin,
  HOWARD_HOST,
};
