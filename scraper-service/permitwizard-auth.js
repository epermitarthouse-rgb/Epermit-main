const crypto = require("crypto");

const PERMITWIZARD_URL = "https://permitwizard.dcra.dc.gov";
const ACCESS_DC_SSO_URL = "https://login.dc.gov";
const SESSION_TTL_MS = 25 * 60 * 1000;
const MAX_LOGIN_TIMEOUT = 60000;

const ACCELA_PORTAL_CONFIGS = {
  dc_dob: {
    baseUrl: "https://permitwizard.dcra.dc.gov",
    loginUrl: null,
    ssoType: "access_dc",
  },
  fairfax_county_va: {
    baseUrl: "https://plus.fairfaxcounty.gov/CitizenAccess",
    loginUrl: "https://plus.fairfaxcounty.gov/CitizenAccess/Account/Login.aspx",
    ssoType: "direct",
  },
  baltimore_city_md: {
    baseUrl: "https://aca-prod.accela.com/BALTIMORE",
    loginUrl: "https://aca-prod.accela.com/BALTIMORE/Account/Login.aspx",
    ssoType: "direct",
  },
  howard_county_md: {
    baseUrl: "https://dilp.howardcountymd.gov/CitizenAccess",
    loginUrl: "https://dilp.howardcountymd.gov/CitizenAccess/Account/Login.aspx",
    ssoType: "direct",
  },
  arlington_county_va: {
    baseUrl: "https://aca-prod.accela.com/ARLINGTONCO",
    loginUrl: "https://aca-prod.accela.com/ARLINGTONCO/Account/Login.aspx",
    ssoType: "direct",
  },
  anne_arundel_county_md: {
    baseUrl: "https://aca-prod.accela.com/aaco",
    loginUrl: "https://aca-prod.accela.com/aaco/Account/Login.aspx",
    ssoType: "direct",
  },
};

const activeSessions = {};

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildSessionKey(portalType, baseUrl) {
  return `${portalType}:${baseUrl}`;
}

function detectCaptcha(page) {
  return page.evaluate(() => {
    const hasCaptchaFrame = !!document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="hcaptcha"]'
    );
    const hasCaptchaDiv = !!document.querySelector(
      '.g-recaptcha, [data-sitekey], .h-captcha, #captcha, [id*="captcha" i], [class*="captcha" i]'
    );
    const hasCaptchaText = document.body.innerText
      .toLowerCase()
      .includes("verify you are human");
    return hasCaptchaFrame || hasCaptchaDiv || hasCaptchaText;
  });
}

async function handleAccessDCSSOLogin(page, username, password) {
  const url = page.url().toLowerCase();

  if (
    url.includes("login.dc.gov") ||
    url.includes("b2clogin") ||
    url.includes("access.dc.gov") ||
    url.includes("okta") ||
    url.includes("signin") ||
    url.includes("login")
  ) {
    console.log("  [Accela Auth] Detected SSO login page");

    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      return { success: false, error: "captcha_detected" };
    }

    if (url.includes("b2clogin.com")) {
      const oktaExchange = await page.$("#OktaExchange");
      if (oktaExchange) {
        await oktaExchange.click();
      } else {
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
      }
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(3000);
    }

    const usernameSelectors = [
      'input[name="identifier"]',
      'input[name="username"]',
      'input[name="email"]',
      "#okta-signin-username",
      'input[type="email"]',
      'input[id*="user" i]',
      'input[id*="email" i]',
      'input[type="text"]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      usernameField = await page.$(sel);
      if (
        usernameField &&
        (await usernameField.isVisible().catch(() => false))
      ) {
        break;
      }
      usernameField = null;
    }

    if (!usernameField) {
      return { success: false, error: "cannot_find_username_field" };
    }

    await usernameField.fill(username);
    console.log("  [Accela Auth] Filled username");

    const passwordSelectors = [
      'input[name="credentials.passcode"]',
      'input[name="password"]',
      "#okta-signin-password",
      'input[type="password"]',
    ];

    let passwordField = null;
    for (const sel of passwordSelectors) {
      passwordField = await page.$(sel);
      if (
        passwordField &&
        (await passwordField.isVisible().catch(() => false))
      ) {
        break;
      }
      passwordField = null;
    }

    if (!passwordField) {
      console.log("  [Accela Auth] Two-step login flow detected");
      const nextBtn = await page.$(
        'input[type="submit"], button[type="submit"]'
      );
      if (nextBtn) await nextBtn.click();
      else await page.keyboard.press("Enter");

      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      const hasCaptchaStep2 = await detectCaptcha(page);
      if (hasCaptchaStep2) {
        return { success: false, error: "captcha_detected" };
      }

      for (const sel of passwordSelectors) {
        passwordField = await page.$(sel);
        if (
          passwordField &&
          (await passwordField.isVisible().catch(() => false))
        ) {
          break;
        }
        passwordField = null;
      }

      if (!passwordField) {
        return { success: false, error: "cannot_find_password_field" };
      }
    }

    await passwordField.fill(password);
    console.log("  [Accela Auth] Filled password");

    const hasCaptchaBeforeSubmit = await detectCaptcha(page);
    if (hasCaptchaBeforeSubmit) {
      return { success: false, error: "captcha_detected" };
    }

    const submitBtn = await page.$(
      'input[type="submit"], button[type="submit"]'
    );
    if (submitBtn) await submitBtn.click();
    else await page.keyboard.press("Enter");

    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`  [Accela Auth] After login URL: ${postLoginUrl}`);

    if (
      postLoginUrl.includes("SSOLanding") ||
      postLoginUrl.includes("Home/SSO")
    ) {
      const continueBtn = await page.$(
        'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]'
      );
      if (continueBtn) {
        await continueBtn.click();
        await page
          .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    return { success: true };
  }

  return { success: true };
}

async function handleStandardAccelaLogin(page, username, password) {
  console.log("  [Accela Auth] Performing standard Accela direct login");

  const hasCaptcha = await detectCaptcha(page);
  if (hasCaptcha) {
    return { success: false, error: "captcha_detected" };
  }

  const userIdSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtUserId",
    'input[name*="txtUserId"]',
    'input[name*="UserName"]',
    'input[id*="UserId" i]',
    'input[id*="UserName" i]',
    'input[type="text"]',
  ];

  let userIdField = null;
  for (const sel of userIdSelectors) {
    userIdField = await page.$(sel);
    if (userIdField && (await userIdField.isVisible().catch(() => false))) {
      break;
    }
    userIdField = null;
  }

  if (!userIdField) {
    return { success: false, error: "cannot_find_username_field" };
  }

  await userIdField.fill(username);
  console.log("  [Accela Auth] Filled user ID");

  const passwordSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_txtPassword",
    'input[name*="txtPassword"]',
    'input[name*="Password"]',
    'input[id*="Password" i]',
    'input[type="password"]',
  ];

  let passwordField = null;
  for (const sel of passwordSelectors) {
    passwordField = await page.$(sel);
    if (
      passwordField &&
      (await passwordField.isVisible().catch(() => false))
    ) {
      break;
    }
    passwordField = null;
  }

  if (!passwordField) {
    return { success: false, error: "cannot_find_password_field" };
  }

  await passwordField.fill(password);
  console.log("  [Accela Auth] Filled password");

  const hasCaptchaBeforeSubmit = await detectCaptcha(page);
  if (hasCaptchaBeforeSubmit) {
    return { success: false, error: "captcha_detected" };
  }

  const loginBtnSelectors = [
    "#ctl00_PlaceHolderMain_LoginBox_btnLogin",
    'input[name*="btnLogin"]',
    'a[id*="btnLogin"]',
    'input[type="submit"][value*="Sign In" i]',
    'input[type="submit"][value*="Login" i]',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  let loginBtn = null;
  for (const sel of loginBtnSelectors) {
    loginBtn = await page.$(sel);
    if (loginBtn && (await loginBtn.isVisible().catch(() => false))) {
      break;
    }
    loginBtn = null;
  }

  if (loginBtn) {
    await loginBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  await page
    .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(3000);

  const postLoginUrl = page.url();
  console.log(`  [Accela Auth] After login URL: ${postLoginUrl}`);

  return { success: true };
}

async function accelaLogin(browser, credentials, config) {
  const portalConfig = config || ACCELA_PORTAL_CONFIGS.dc_dob;
  const baseUrl = portalConfig.baseUrl;
  const ssoType = portalConfig.ssoType || "direct";
  const loginUrl = portalConfig.loginUrl || baseUrl;
  const username = credentials.username;
  const password = credentials.password;

  const label = portalConfig.label || baseUrl;
  console.log(`  [Accela Auth] Starting login for ${label} (ssoType: ${ssoType})`);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    const targetUrl = ssoType === "access_dc" ? baseUrl : loginUrl;
    console.log(`  [Accela Auth] Navigating to ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: MAX_LOGIN_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    let currentUrl = page.url();
    console.log(`  [Accela Auth] Landed on: ${currentUrl}`);

    if (currentUrl.includes("SessionEnded")) {
      const loginLink = await page.$(
        'a:has-text("Log in again"), a:has-text("Login"), a[href*="Login"]'
      );
      if (loginLink) {
        await loginLink.click();
        await page
          .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(2000);
        currentUrl = page.url();
      }
    }

    let loginResult;

    if (ssoType === "access_dc") {
      loginResult = await handleAccessDCSSOLogin(page, username, password);
    } else {
      loginResult = await handleStandardAccelaLogin(page, username, password);
    }

    if (!loginResult.success) {
      if (loginResult.error === "captcha_detected") {
        console.log(
          "  [Accela Auth] CAPTCHA detected — pausing for human intervention"
        );
        await context.close();
        return {
          success: false,
          error: "captcha_detected",
          message:
            "CAPTCHA detected during login. Please complete login manually or try again later.",
          requiresHumanIntervention: true,
        };
      }
      await context.close();
      return {
        success: false,
        error: loginResult.error,
        message: `Login failed: ${loginResult.error}`,
      };
    }

    const finalUrl = page.url();
    console.log(`  [Accela Auth] Final URL: ${finalUrl}`);

    const isStillLoginPage =
      finalUrl.includes("b2clogin") ||
      finalUrl.includes("SessionEnded") ||
      finalUrl.includes("okta.com/signin") ||
      finalUrl.includes("login.dc.gov") ||
      finalUrl.includes("Account/Login.aspx");

    if (isStillLoginPage) {
      const errorEl = await page.$(
        ".error-message, [id*='Error'], [id*='error'], .alert-danger, .ACA_Error, .ACA_SmLabel_FontSize_Error"
      );
      const errorText = errorEl
        ? await errorEl.textContent().catch(() => "")
        : "";

      await context.close();
      return {
        success: false,
        error: "login_failed",
        message:
          "Login failed — invalid credentials or account locked" +
          (errorText ? `: ${errorText.trim()}` : ""),
        doNotRetry: true,
      };
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const sessionKey = buildSessionKey("accela", baseUrl);

    activeSessions[sessionToken] = {
      context,
      page,
      username,
      password,
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date(),
      portalUrl: baseUrl,
      portalType: "accela",
      ssoType,
      sessionKey,
      portalConfig,
    };

    console.log(
      `  [Accela Auth] Login successful — session ${sessionToken.substring(0, 8)}... key=${sessionKey} expires at ${expiresAt.toISOString()}`
    );

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      portalUrl: finalUrl,
      portalType: "accela",
      sessionKey,
    };
  } catch (err) {
    console.error(`  [Accela Auth] Login error: ${err.message}`);
    await context.close().catch(() => {});
    return {
      success: false,
      error: "login_error",
      message: err.message,
    };
  }
}

async function permitWizardLogin(browser, username, password) {
  return accelaLogin(
    browser,
    { username, password },
    {
      ...ACCELA_PORTAL_CONFIGS.dc_dob,
      label: "DC DOB (PermitWizard)",
    }
  );
}

function getSession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  if (new Date() > session.expiresAt) {
    console.log(
      `  [Accela Auth] Session ${sessionToken.substring(0, 8)}... expired`
    );
    destroySession(sessionToken);
    return null;
  }

  session.lastActivity = new Date();
  return session;
}

function getAccelaSession(sessionToken) {
  return getSession(sessionToken);
}

async function checkSessionAlive(sessionToken) {
  const session = getSession(sessionToken);
  if (!session) return { alive: false, reason: "session_not_found_or_expired" };

  try {
    const currentUrl = session.page.url();

    const isSessionExpired =
      currentUrl.includes("SessionEnded") ||
      currentUrl.includes("Account/Login.aspx") ||
      currentUrl.includes("b2clogin") ||
      currentUrl.includes("login.dc.gov");

    if (isSessionExpired) {
      console.log(
        `  [Accela Auth] Portal session expired (URL: ${currentUrl})`
      );
      return { alive: false, reason: "portal_session_expired" };
    }

    return {
      alive: true,
      expiresAt: session.expiresAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      portalType: session.portalType,
      sessionKey: session.sessionKey,
    };
  } catch (err) {
    console.log(
      `  [Accela Auth] Session check failed: ${err.message}`
    );
    return { alive: false, reason: "session_check_error" };
  }
}

async function reAuthenticate(browser, sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  console.log(
    `  [Accela Auth] Re-authenticating session ${sessionToken.substring(0, 8)}...`
  );

  const { username, password, portalConfig } = session;

  await destroySession(sessionToken);

  const result = await accelaLogin(
    browser,
    { username, password },
    portalConfig
  );
  return result;
}

async function accelaLogout(sessionToken) {
  return destroySession(sessionToken);
}

async function destroySession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    try {
      await session.context.close();
    } catch (err) {
      console.log(
        `  [Accela Auth] Error closing context: ${err.message}`
      );
    }
    delete activeSessions[sessionToken];
    console.log(
      `  [Accela Auth] Session ${sessionToken.substring(0, 8)}... destroyed`
    );
  }
}

function getActiveSessionCount() {
  return Object.keys(activeSessions).length;
}

setInterval(() => {
  const now = new Date();
  for (const [token, session] of Object.entries(activeSessions)) {
    if (now > session.expiresAt) {
      console.log(
        `  [Accela Auth] Cleaning up expired session ${token.substring(0, 8)}...`
      );
      destroySession(token);
    }
  }
}, 60 * 1000);

module.exports = {
  permitWizardLogin,
  getSession,
  checkSessionAlive,
  reAuthenticate,
  destroySession,
  getActiveSessionCount,
  PERMITWIZARD_URL,
  SESSION_TTL_MS,
  accelaLogin,
  accelaLogout,
  getAccelaSession,
  ACCELA_PORTAL_CONFIGS,
};
