const crypto = require("crypto");

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

async function energovLogin(browser, credentials, config) {
  const baseUrl = config.baseUrl || credentials.baseUrl;
  if (!baseUrl) {
    return {
      success: false,
      error: "missing_base_url",
      message: "EnerGov base URL is required",
    };
  }

  const loginUrl =
    config.loginUrl ||
    credentials.loginUrl ||
    `${baseUrl.replace(/\/$/, "")}/#/login`;

  console.log(
    `  [EnerGov Auth] Starting login for ${baseUrl}`
  );

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(`  [EnerGov Auth] Navigating to ${loginUrl}`);
    await page.goto(loginUrl, {
      waitUntil: "networkidle",
      timeout: MAX_LOGIN_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    let currentUrl = page.url();
    console.log(`  [EnerGov Auth] Landed on: ${currentUrl}`);

    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      console.log(
        "  [EnerGov Auth] CAPTCHA detected — pausing for human intervention"
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

    const emailSelectors = [
      'input[name="email"]',
      'input[type="email"]',
      'input[id*="email" i]',
      'input[id*="user" i]',
      'input[name="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="user" i]',
      'input[type="text"]',
    ];

    let emailField = null;
    for (const sel of emailSelectors) {
      emailField = await page.$(sel);
      if (
        emailField &&
        (await emailField.isVisible().catch(() => false))
      ) {
        break;
      }
      emailField = null;
    }

    if (!emailField) {
      const signInBtn = await page.$(
        'a:has-text("Sign In"), a:has-text("Log In"), button:has-text("Sign In"), button:has-text("Log In"), a[href*="login" i]'
      );
      if (signInBtn) {
        console.log("  [EnerGov Auth] Clicking Sign In link to reveal login form");
        await signInBtn.click();
        await page
          .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(3000);

        for (const sel of emailSelectors) {
          emailField = await page.$(sel);
          if (
            emailField &&
            (await emailField.isVisible().catch(() => false))
          ) {
            break;
          }
          emailField = null;
        }
      }
    }

    if (!emailField) {
      await context.close();
      return {
        success: false,
        error: "cannot_find_email_field",
        message: "Could not locate the email/username input on the EnerGov login page",
      };
    }

    await emailField.fill(credentials.username);
    console.log("  [EnerGov Auth] Filled email/username");

    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[id*="password" i]',
      'input[placeholder*="password" i]',
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
      console.log("  [EnerGov Auth] Two-step login flow detected, submitting email first");
      const nextBtn = await page.$(
        'button[type="submit"], input[type="submit"]'
      );
      if (nextBtn) await nextBtn.click();
      else await page.keyboard.press("Enter");

      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);

      const hasCaptchaStep2 = await detectCaptcha(page);
      if (hasCaptchaStep2) {
        await context.close();
        return {
          success: false,
          error: "captcha_detected",
          message: "CAPTCHA detected after email step.",
          requiresHumanIntervention: true,
        };
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
        await context.close();
        return {
          success: false,
          error: "cannot_find_password_field",
          message: "Could not locate the password input on the EnerGov login page",
        };
      }
    }

    await passwordField.fill(credentials.password);
    console.log("  [EnerGov Auth] Filled password");

    const hasCaptchaBeforeSubmit = await detectCaptcha(page);
    if (hasCaptchaBeforeSubmit) {
      await context.close();
      return {
        success: false,
        error: "captcha_detected",
        message: "CAPTCHA detected before submit.",
        requiresHumanIntervention: true,
      };
    }

    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login")'
    );
    if (submitBtn) await submitBtn.click();
    else await page.keyboard.press("Enter");

    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    console.log(`  [EnerGov Auth] After login URL: ${finalUrl}`);

    const isStillLoginPage = await page.evaluate(() => {
      const url = window.location.href.toLowerCase();
      const hasLoginInUrl =
        url.includes("/login") ||
        url.includes("/signin") ||
        url.includes("login.aspx");
      const hasLoginForm =
        !!document.querySelector('input[type="password"]:not([style*="display: none"])');
      return hasLoginInUrl && hasLoginForm;
    });

    if (isStillLoginPage) {
      const errorEl = await page.$(
        ".error-message, .alert-danger, .validation-summary-errors, [class*='error' i], [class*='alert' i][class*='danger' i]"
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
    const sessionKey = `energov:${baseUrl}:${sessionToken}`;

    activeSessions[sessionToken] = {
      context,
      page,
      username: credentials.username,
      password: credentials.password,
      baseUrl,
      portalType: "energov",
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date(),
    };

    console.log(
      `  [EnerGov Auth] Login successful — session ${sessionToken.substring(0, 8)}... expires at ${expiresAt.toISOString()}`
    );

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      portalUrl: finalUrl,
    };
  } catch (err) {
    console.error(`  [EnerGov Auth] Login error: ${err.message}`);
    await context.close().catch(() => {});
    return {
      success: false,
      error: "login_error",
      message: err.message,
    };
  }
}

function getEnergovSession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  if (new Date() > session.expiresAt) {
    console.log(
      `  [EnerGov Auth] Session ${sessionToken.substring(0, 8)}... expired`
    );
    energovLogout(sessionToken);
    return null;
  }

  session.lastActivity = new Date();
  return session;
}

async function checkSessionAlive(sessionToken) {
  const session = getEnergovSession(sessionToken);
  if (!session) return { alive: false, reason: "session_not_found_or_expired" };

  try {
    const currentUrl = session.page.url();

    const isSessionExpired =
      currentUrl.includes("/login") ||
      currentUrl.includes("/signin") ||
      currentUrl.includes("SessionEnded");

    if (isSessionExpired) {
      console.log(
        `  [EnerGov Auth] Portal session expired (URL: ${currentUrl})`
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
      `  [EnerGov Auth] Session check failed: ${err.message}`
    );
    return { alive: false, reason: "session_check_error" };
  }
}

async function energovLogout(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    try {
      await session.context.close();
    } catch (err) {
      console.log(
        `  [EnerGov Auth] Error closing context: ${err.message}`
      );
    }
    delete activeSessions[sessionToken];
    console.log(
      `  [EnerGov Auth] Session ${sessionToken.substring(0, 8)}... destroyed`
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
        `  [EnerGov Auth] Cleaning up expired session ${token.substring(0, 8)}...`
      );
      energovLogout(token);
    }
  }
}, 60 * 1000);

module.exports = {
  energovLogin,
  energovLogout,
  getEnergovSession,
  checkSessionAlive,
  getActiveSessionCount,
  SESSION_TTL_MS,
};
