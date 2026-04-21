const crypto = require("crypto");

const MONTGOMERY_BASE_URL = "https://permittingservices.montgomerycountymd.gov";
const MONTGOMERY_LOGIN_URL = `${MONTGOMERY_BASE_URL}/account/Login.aspx`;
const SESSION_TTL_MS = 25 * 60 * 1000;
const MAX_LOGIN_TIMEOUT = 60000;

const activeSessions = {};

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildSessionKey(baseUrl) {
  return `aspnet_webforms:${baseUrl}`;
}

async function montgomeryLogin(browser, credentials) {
  const username = credentials.username;
  const password = credentials.password;
  const baseUrl = credentials.baseUrl || MONTGOMERY_BASE_URL;
  const loginUrl = credentials.loginUrl || `${baseUrl}/account/Login.aspx`;

  console.log("  [Montgomery Auth] Starting ASP.NET WebForms login flow");

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(`  [Montgomery Auth] Navigating to ${loginUrl}`);
    await page.goto(loginUrl, {
      waitUntil: "networkidle",
      timeout: MAX_LOGIN_TIMEOUT,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`  [Montgomery Auth] Landed on: ${currentUrl}`);

    const emailField = await page.$(
      '[name="ctl00$dpsAOContentSection$txtLoginEmail"]'
    );
    if (!emailField) {
      const altEmailField = await page.$(
        'input[type="email"], input[type="text"][id*="Email" i], input[id*="Login" i][id*="Email" i]'
      );
      if (!altEmailField) {
        await context.close();
        return {
          success: false,
          error: "cannot_find_email_field",
          message: "Could not locate email/username field on login page",
        };
      }
      await altEmailField.fill(username);
      console.log("  [Montgomery Auth] Filled email (alt selector)");
    } else {
      await emailField.fill(username);
      console.log("  [Montgomery Auth] Filled email");
    }

    const passwordField = await page.$(
      '[name="ctl00$dpsAOContentSection$txtLoginPassword"]'
    );
    if (!passwordField) {
      const altPasswordField = await page.$(
        'input[type="password"]'
      );
      if (!altPasswordField) {
        await context.close();
        return {
          success: false,
          error: "cannot_find_password_field",
          message: "Could not locate password field on login page",
        };
      }
      await altPasswordField.fill(password);
      console.log("  [Montgomery Auth] Filled password (alt selector)");
    } else {
      await passwordField.fill(password);
      console.log("  [Montgomery Auth] Filled password");
    }

    const submitBtn = await page.$(
      '[name="ctl00$dpsAOContentSection$cmdLogin"]'
    );
    if (submitBtn) {
      await submitBtn.click();
      console.log("  [Montgomery Auth] Clicked login button");
    } else {
      const altSubmitBtn = await page.$(
        'input[type="submit"][value*="Log" i], button[type="submit"], input[type="submit"][value*="Sign" i]'
      );
      if (altSubmitBtn) {
        await altSubmitBtn.click();
        console.log("  [Montgomery Auth] Clicked login button (alt selector)");
      } else {
        await page.keyboard.press("Enter");
        console.log("  [Montgomery Auth] Pressed Enter to submit");
      }
    }

    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`  [Montgomery Auth] After login URL: ${postLoginUrl}`);

    const errorEl = await page.$(
      '.error-message, [id*="Error" i], [id*="error" i], .alert-danger, .validation-summary-errors, [id*="lblError" i], [id*="ValidationSummary" i]'
    );
    let errorText = "";
    if (errorEl) {
      errorText = await errorEl.textContent().catch(() => "");
      errorText = (errorText || "").trim();
    }

    const isStillOnLogin =
      postLoginUrl.toLowerCase().includes("login") &&
      !postLoginUrl.toLowerCase().includes("dashboard") &&
      !postLoginUrl.toLowerCase().includes("home") &&
      !postLoginUrl.toLowerCase().includes("welcome");

    if (isStillOnLogin && errorText) {
      await context.close();
      return {
        success: false,
        error: "login_failed",
        message:
          "Login failed — invalid credentials or account locked" +
          (errorText ? `: ${errorText}` : ""),
        doNotRetry: true,
      };
    }

    if (isStillOnLogin) {
      const pageContent = await page.textContent("body").catch(() => "");
      const hasError =
        pageContent.toLowerCase().includes("invalid") ||
        pageContent.toLowerCase().includes("incorrect") ||
        pageContent.toLowerCase().includes("failed");

      if (hasError) {
        await context.close();
        return {
          success: false,
          error: "login_failed",
          message: "Login failed — invalid credentials or account issue",
          doNotRetry: true,
        };
      }
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const sessionKey = buildSessionKey(baseUrl);

    activeSessions[sessionToken] = {
      context,
      page,
      username,
      password,
      baseUrl,
      sessionKey,
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date(),
      portalType: "aspnet_webforms",
      portalUrl: baseUrl,
    };

    console.log(
      `  [Montgomery Auth] Login successful — session ${sessionToken.substring(0, 8)}... expires at ${expiresAt.toISOString()}`
    );

    return {
      success: true,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      portalUrl: postLoginUrl,
      portalType: "aspnet_webforms",
    };
  } catch (err) {
    console.error(`  [Montgomery Auth] Login error: ${err.message}`);
    await context.close().catch(() => {});
    return {
      success: false,
      error: "login_error",
      message: err.message,
    };
  }
}

function getMontgomerySession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  if (new Date() > session.expiresAt) {
    console.log(
      `  [Montgomery Auth] Session ${sessionToken.substring(0, 8)}... expired`
    );
    montgomeryLogout(sessionToken);
    return null;
  }

  session.lastActivity = new Date();
  return session;
}

async function checkSessionAlive(sessionToken) {
  const session = getMontgomerySession(sessionToken);
  if (!session)
    return { alive: false, reason: "session_not_found_or_expired" };

  try {
    const currentUrl = session.page.url();

    const isSessionExpired =
      currentUrl.toLowerCase().includes("login") ||
      currentUrl.toLowerCase().includes("sessionexpired") ||
      currentUrl.toLowerCase().includes("timeout");

    if (isSessionExpired) {
      console.log(
        `  [Montgomery Auth] Portal session expired (URL: ${currentUrl})`
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
      `  [Montgomery Auth] Session check failed: ${err.message}`
    );
    return { alive: false, reason: "session_check_error" };
  }
}

async function montgomeryLogout(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    try {
      await session.context.close();
    } catch (err) {
      console.log(
        `  [Montgomery Auth] Error closing context: ${err.message}`
      );
    }
    delete activeSessions[sessionToken];
    console.log(
      `  [Montgomery Auth] Session ${sessionToken.substring(0, 8)}... destroyed`
    );
  }
}

async function reAuthenticate(browser, sessionToken) {
  const session = activeSessions[sessionToken];
  if (!session) return null;

  console.log(
    `  [Montgomery Auth] Re-authenticating session ${sessionToken.substring(0, 8)}...`
  );

  const credentials = {
    username: session.username,
    password: session.password,
    baseUrl: session.baseUrl,
  };

  await montgomeryLogout(sessionToken);

  const result = await montgomeryLogin(browser, credentials);
  return result;
}

function getActiveSessionCount() {
  return Object.keys(activeSessions).length;
}

setInterval(() => {
  const now = new Date();
  for (const [token, session] of Object.entries(activeSessions)) {
    if (now > session.expiresAt) {
      console.log(
        `  [Montgomery Auth] Cleaning up expired session ${token.substring(0, 8)}...`
      );
      montgomeryLogout(token);
    }
  }
}, 60 * 1000);

module.exports = {
  montgomeryLogin,
  getMontgomerySession,
  montgomeryLogout,
  checkSessionAlive,
  reAuthenticate,
  getActiveSessionCount,
  MONTGOMERY_BASE_URL,
  MONTGOMERY_LOGIN_URL,
  SESSION_TTL_MS,
};
