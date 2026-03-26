const crypto = require("crypto");

const MOMENTUM_BASE_URL = "https://momentum.princegeorgescountymd.gov";
const MOMENTUM_LOGIN_URL = `${MOMENTUM_BASE_URL}/login`;
const SESSION_TTL_MS = 25 * 60 * 1000;
const MAX_LOGIN_TIMEOUT = 60000;

const activeSessions = {};

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
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

async function momentumLogin(browser, credentials) {
  const { username, password } = credentials;
  console.log("  [Momentum Auth] Starting Liferay portal login flow");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(`  [Momentum Auth] Navigating to ${MOMENTUM_LOGIN_URL}`);
    await page.goto(MOMENTUM_LOGIN_URL, {
      waitUntil: "networkidle",
      timeout: MAX_LOGIN_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`  [Momentum Auth] Landed on: ${currentUrl}`);

    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      console.log(
        "  [Momentum Auth] CAPTCHA detected — pausing for human intervention"
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

    const usernameSelectors = [
      '#_com_liferay_login_web_portlet_LoginPortlet_login',
      'input[name="_com_liferay_login_web_portlet_LoginPortlet_login"]',
      '#_58_login',
      'input[name="_58_login"]',
      'input[id*="login" i][type="text"]',
      'input[id*="login" i][type="email"]',
      'input[name*="login" i]',
      'input[name="login"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[type="email"]',
      'input[type="text"]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      usernameField = await page.$(sel);
      if (
        usernameField &&
        (await usernameField.isVisible().catch(() => false))
      ) {
        console.log(`  [Momentum Auth] Found username field: ${sel}`);
        break;
      }
      usernameField = null;
    }

    if (!usernameField) {
      console.log("  [Momentum Auth] Could not find username field");
      await context.close();
      return {
        success: false,
        error: "cannot_find_username_field",
        message: "Could not locate the username/email field on the Momentum login page.",
      };
    }

    await usernameField.fill(username);
    console.log("  [Momentum Auth] Filled username");

    const passwordSelectors = [
      '#_com_liferay_login_web_portlet_LoginPortlet_password',
      'input[name="_com_liferay_login_web_portlet_LoginPortlet_password"]',
      '#_58_password',
      'input[name="_58_password"]',
      'input[name="password"]',
      'input[type="password"]',
    ];

    let passwordField = null;
    for (const sel of passwordSelectors) {
      passwordField = await page.$(sel);
      if (
        passwordField &&
        (await passwordField.isVisible().catch(() => false))
      ) {
        console.log(`  [Momentum Auth] Found password field: ${sel}`);
        break;
      }
      passwordField = null;
    }

    if (!passwordField) {
      console.log("  [Momentum Auth] Could not find password field");
      await context.close();
      return {
        success: false,
        error: "cannot_find_password_field",
        message: "Could not locate the password field on the Momentum login page.",
      };
    }

    await passwordField.fill(password);
    console.log("  [Momentum Auth] Filled password");

    const hasCaptchaBeforeSubmit = await detectCaptcha(page);
    if (hasCaptchaBeforeSubmit) {
      console.log(
        "  [Momentum Auth] CAPTCHA detected before submit — pausing for human intervention"
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

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign In")',
      'button:has-text("Log In")',
      'button:has-text("Login")',
      'input[value="Sign In"]',
      'input[value="Log In"]',
      '.btn-primary[type="submit"]',
    ];

    let submitBtn = null;
    for (const sel of submitSelectors) {
      submitBtn = await page.$(sel);
      if (submitBtn && (await submitBtn.isVisible().catch(() => false))) {
        console.log(`  [Momentum Auth] Found submit button: ${sel}`);
        break;
      }
      submitBtn = null;
    }

    if (submitBtn) {
      await submitBtn.click();
    } else {
      console.log("  [Momentum Auth] No submit button found, pressing Enter");
      await page.keyboard.press("Enter");
    }

    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`  [Momentum Auth] After login URL: ${postLoginUrl}`);

    const isStillLoginPage =
      postLoginUrl.includes("/login") ||
      postLoginUrl.includes("/Login") ||
      postLoginUrl.includes("/signin") ||
      postLoginUrl.includes("/SignIn");

    if (isStillLoginPage) {
      const errorEl = await page.$(
        ".alert-danger, .portlet-msg-error, .error-message, [class*='error' i], [class*='alert' i]:not(.alert-info):not(.alert-success)"
      );
      const errorText = errorEl
        ? await errorEl.textContent().catch(() => "")
        : "";

      console.log(
        `  [Momentum Auth] Still on login page after submit${errorText ? `: ${errorText.trim()}` : ""}`
      );
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

    activeSessions[sessionToken] = {
      context,
      page,
      username,
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date(),
      portalUrl: MOMENTUM_BASE_URL,
    };

    console.log(
      `  [Momentum Auth] Login successful — session ${sessionToken.substring(0, 8)}... expires at ${expiresAt.toISOString()}`
    );

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      portalUrl: postLoginUrl,
    };
  } catch (err) {
    console.error(`  [Momentum Auth] Login error: ${err.message}`);
    await context.close().catch(() => {});
    return {
      success: false,
      error: "login_error",
      message: err.message,
    };
  }
}

function getMomentumSession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  if (new Date() > session.expiresAt) {
    console.log(
      `  [Momentum Auth] Session ${sessionToken.substring(0, 8)}... expired`
    );
    momentumLogout(sessionToken);
    return null;
  }

  session.lastActivity = new Date();
  return session;
}

async function checkSessionAlive(sessionToken) {
  const session = getMomentumSession(sessionToken);
  if (!session) return { alive: false, reason: "session_not_found_or_expired" };

  try {
    const currentUrl = session.page.url();

    const isSessionExpired =
      currentUrl.includes("/login") ||
      currentUrl.includes("/Login") ||
      currentUrl.includes("/signin") ||
      currentUrl.includes("/SignIn") ||
      currentUrl.includes("session-expired") ||
      currentUrl.includes("SessionExpired");

    if (isSessionExpired) {
      console.log(
        `  [Momentum Auth] Portal session expired (URL: ${currentUrl})`
      );
      return { alive: false, reason: "portal_session_expired" };
    }

    return {
      alive: true,
      expiresAt: session.expiresAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
    };
  } catch (err) {
    console.log(
      `  [Momentum Auth] Session check failed: ${err.message}`
    );
    return { alive: false, reason: "session_check_error" };
  }
}

async function momentumLogout(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    try {
      await session.page
        .goto(`${MOMENTUM_BASE_URL}/c/portal/logout`, {
          waitUntil: "networkidle",
          timeout: 10000,
        })
        .catch(() => {});
    } catch (err) {
      console.log(
        `  [Momentum Auth] Logout navigation error: ${err.message}`
      );
    }
    try {
      await session.context.close();
    } catch (err) {
      console.log(
        `  [Momentum Auth] Error closing context: ${err.message}`
      );
    }
    delete activeSessions[sessionToken];
    console.log(
      `  [Momentum Auth] Session ${sessionToken.substring(0, 8)}... destroyed`
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
        `  [Momentum Auth] Cleaning up expired session ${token.substring(0, 8)}...`
      );
      momentumLogout(token);
    }
  }
}, 60 * 1000);

module.exports = {
  momentumLogin,
  momentumLogout,
  getMomentumSession,
  checkSessionAlive,
  getActiveSessionCount,
  MOMENTUM_BASE_URL,
  MOMENTUM_LOGIN_URL,
  SESSION_TTL_MS,
};
