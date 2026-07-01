"use strict";
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const {
  extractReviewCommentsStructuredRowsFromExcelBuffer,
  extractReviewCommentsStructuredRowsFromExcelFile,
} = require("../lib/reviewCommentsExcelStructuredRows.js");
const {
  mapPgcWorkflowBucketRowForPortal,
  applyPgcDomReviewCommentsBridge,
} = require("../lib/pgcDomReviewStructuredRows.js");
const AdmZip = require("adm-zip");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { isScraperDebugArtifactsEnabled } = require("../artifacts/debug-artifacts");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  accelaLogin: accelaScraperLogin,
  scrapeAccelaRecord,
  continueArlingtonPlanReviewDownloads,
  resumeArlingtonPlanReviewPendingDownloads,
  arlingtonPlanReviewScopeSupportsAutoContinue,
  arlingtonPlanReviewSessionBrowserUsable,
  detectAccelaHumanLoginRequired,
} = require("../accela-scraper");
const pgcEplan = require("../pgc-eplan-scraper");
const montgomeryProjectDox = require("../scrapers/montgomery/projectdox-scraper");
const montgomeryDashboardDiscovery = require("../scrapers/montgomery/dashboard-discovery");
const { performMontgomeryPortalLogin } = require("../scrapers/montgomery/portal-login");
const howardProjectDox = require("../scrapers/howard/projectdox-scraper");
const howardDashboardDiscovery = require("../scrapers/howard/dashboard-discovery");
const { performHowardPortalLogin } = require("../scrapers/howard/portal-login");
const { bootstrapHowardProjectDoxFromPortal } = require("../scrapers/howard/avolve-bootstrap");
const {
  permitWizardLogin,
  getSession: getPWSession,
  checkSessionAlive,
  reAuthenticate,
  destroySession: destroyPWSession,
  getActiveSessionCount,
  accelaLogin,
  accelaLogout,
  getAccelaSession,
} = require("../permitwizard-auth");
const { permitWizardFile, WIZARD_STEPS } = require("../permitwizard-filer");
const { permitWizardSubmit } = require("../permitwizard-submit");
const {
  momentumLogin,
  momentumLogout,
  getMomentumSession,
  checkSessionAlive: checkMomentumSessionAlive,
} = require("../momentum-auth");
const {
  montgomeryLogin,
  montgomeryLogout,
  getMontgomerySession,
  checkSessionAlive: checkMontgomerySessionAlive,
  reAuthenticate: reAuthenticateMontgomery,
} = require("../scrapers/montgomery/auth");
const {
  energovLogin,
  energovLogout,
  getEnergovSession,
  checkSessionAlive: checkEnergovSessionAlive,
} = require("../energov-auth");
const { momentumFile } = require("../momentum-filer");
const { momentumSubmit } = require("../momentum-submit");
const { montgomeryFile } = require("../scrapers/montgomery/filer");
const { montgomerySubmit } = require("../scrapers/montgomery/submit");
const { energovFile } = require("../energov-filer");
const { energovSubmit } = require("../energov-submit");
const {
  sessions,
  SESSION_IDLE_TIMEOUT_MS,
  cleanupSession,
  rearmSessionIdleTimeout,
} = require("./session/in-memory-store.js");
const scrapeEvents = require("../lib/scrape-events.js");
const { SCRAPE_STAGES } = require("../lib/scrape-stages.js");
const scrapeFileResults = require("../lib/scrape-file-results.js");
const scrapeLease = require("../lib/scrape-lease.js");
const arlingtonDurableJob = require("../lib/arlington-durable-job.js");
const arlingtonJobStore = require("../lib/arlington-job-store.js");
const arlingtonOrchestration = require("../lib/arlington-orchestration.js");
const { startArlingtonDurableWorkerLoop } = require("../lib/arlington-durable-worker-loop.js");
const { mirrorSessionProgress } = require("../lib/session-progress.js");

function publishScrapeOrchestration(session, opts = {}) {
  if (typeof session.publishScrapeProgress !== "function") return;
  void session.publishScrapeProgress(opts).catch(() => {});
}

const MONTGOMERY_RETRIEVE_TIMEOUT_MS = 120000;

const { scraperRunsHeadless } = require("../shared/browser.js");
const {
  launchChromiumForScraper,
  isBrowserLaunchError,
} = require("../shared/playwright-launch-for-scraper.js");

/** Scraper service root (parent of app/). Same as legacy server.js __dirname. */
const SCRAPER_ROOT = path.join(__dirname, "..");

// ─── Playwright browser launch reliability ───────────────────────────────────
const BROWSER_INSTALL_MESSAGE =
  "Playwright Chromium not installed. Run: npx playwright install chromium (or npm run install-browsers in scraper-service)";

function sendBrowserLaunchError(res, err) {
  console.error("❌ Browser launch failed:", err.message);
  res.status(503).json({
    error: BROWSER_INSTALL_MESSAGE,
    detail: err.message,
  });
}

async function runPlaywrightStartupDiagnostics() {
  let playwrightVersion = "unknown";
  try {
    const pkg = require("playwright/package.json");
    playwrightVersion = pkg.version || playwrightVersion;
  } catch (_) {}

  const platform = `${process.platform}/${process.arch}`;
  console.log(`  Playwright version: ${playwrightVersion}`);
  console.log(`  Platform: ${platform}`);
  console.log(`  Headless mode: ${scraperRunsHeadless()}`);

  let browser;
  try {
    browser = await launchChromiumForScraper({ label: "startup-diagnostic", file: "server.js", route: "runPlaywrightStartupDiagnostics" });
    await browser.close();
    console.log("  ✅ Playwright Chromium: launch OK");
    return true;
  } catch (err) {
    console.error("  ❌ Playwright Chromium: launch failed:", err.message);
    if (isBrowserLaunchError(err)) {
      console.log(`  → Run: npx playwright install chromium`);
      console.log(`  → Or:  npm run install-browsers (in scraper-service)`);
      try {
        console.log("  → Attempting automatic install...");
        execSync("npx playwright install chromium", {
          stdio: "inherit",
          cwd: SCRAPER_ROOT,
        });
        const retry = await launchChromiumForScraper({ label: "startup-diagnostic-retry", file: "server.js" });
        await retry.close();
        console.log("  ✅ Playwright Chromium: install + launch OK");
        return true;
      } catch (installErr) {
        console.error("  ❌ Auto-install failed:", installErr.message);
      }
    }
    return false;
  }
}

function detectPortalType(url) {
  if (!url) return "projectdox";
  const lower = url.toLowerCase();
  if (
    lower.includes("avolvecloud.com") ||
    lower.includes("projectdox") ||
    lower.includes("eplans.princegeorgescountymd.gov")
  ) {
    return "projectdox";
  }
  /** Howard County: users often save the Azure B2C authorize URL from the browser, not avolvecloud.com */
  if (
    lower.includes("howardb2cprod.b2clogin.com") ||
    (lower.includes("b2clogin.com") &&
      lower.includes("howardb2cprod") &&
      lower.includes("onmicrosoft.com"))
  ) {
    return "projectdox";
  }
  /** Accela Citizen Access on agency-hosted domains (e.g. plus.fairfaxcounty.gov/CitizenAccess). */
  if (lower.includes("citizenaccess")) return "accela";
  if (lower.includes("accela.com")) return "accela";
  console.log(`[detectPortalType] no match for url: "${url}" lower: "${lower}"`);
  return "unknown";
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(obj);
}

function hashPortalData(data) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(data))
    .digest("hex");
}

/** Register execution routes and orchestration on the shared HTTP app.
 * @param {import("express").Express} app
 */
function registerExecutionRoutes(app) {
const PORT = process.env.PORT || 3001;
const DEFAULT_DASHBOARD_URL = "https://washington-dc-us.avolvecloud.com";

const MIN_FILE_SIZE = 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_SCRAPE_CUMULATIVE_SIZE = 1000 * 1024 * 1024;
const MAX_DOWNLOADS_DIR_SIZE = 1 * 1024 * 1024 * 1024;

function getDownloadsDir() {
  const dir = path.join(SCRAPER_ROOT, "downloads");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDownloadsDirSize() {
  const dir = getDownloadsDir();
  try {
    const files = fs.readdirSync(dir);
    let total = 0;
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(dir, f));
        if (stat.isFile()) total += stat.size;
      } catch (e) {}
    }
    return total;
  } catch (e) {
    return 0;
  }
}

function cleanupDownloadsDir() {
  const dir = getDownloadsDir();
  const currentSize = getDownloadsDirSize();
  if (currentSize <= MAX_DOWNLOADS_DIR_SIZE) return;

  console.log(`⚠️ Downloads directory size ${(currentSize / 1024 / 1024).toFixed(0)} MB exceeds 1 GB limit. Cleaning up oldest files...`);
  try {
    const files = fs.readdirSync(dir)
      .map(f => {
        try {
          const stat = fs.statSync(path.join(dir, f));
          return { name: f, mtime: stat.mtimeMs, size: stat.size };
        } catch (e) {
          return null;
        }
      })
      .filter(f => f !== null)
      .sort((a, b) => a.mtime - b.mtime);

    let freed = 0;
    const target = currentSize - MAX_DOWNLOADS_DIR_SIZE;
    for (const file of files) {
      if (freed >= target) break;
      try {
        fs.unlinkSync(path.join(dir, file.name));
        freed += file.size;
        console.log(`   Deleted: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (e) {}
    }
    console.log(`   Freed ${(freed / 1024 / 1024).toFixed(0)} MB`);
  } catch (e) {
    console.error(`   ⚠️ Cleanup error: ${e.message}`);
  }
}

function deriveWebUiBase(dashboardUrl) {
  try {
    const u = new URL(dashboardUrl);
    const parts = u.hostname.split(".");
    if (parts.length >= 2 && parts[0]) {
      parts[0] = parts[0] + "-projectdoxwebui";
      return `${u.protocol}//${parts.join(".")}`;
    }
  } catch (e) {}
  return "https://washington-dc-us-projectdoxwebui.avolvecloud.com";
}

// ─── Supabase: load from .env ───────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { resolveStoredPortalPassword } = require("./services/portal-credentials/portal-credentials-crypto.js");

const STORAGE_BUCKET_SLUG = "project-drawings";
let resolvedBucketId = null;

async function ensureStorageBucket() {
  if (resolvedBucketId) return true;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const matched = buckets?.find((b) => b.id === STORAGE_BUCKET_SLUG);
    if (matched) {
      resolvedBucketId = matched.id;
      if (!matched.public) {
        await supabase.storage.updateBucket(resolvedBucketId, { public: true });
        console.log(`✅ Found bucket "${resolvedBucketId}" — set to public`);
      } else {
        console.log(`✅ Found bucket "${resolvedBucketId}"`);
      }
      return true;
    }
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET_SLUG, {
      public: true,
      fileSizeLimit: MAX_FILE_SIZE,
    });
    if (error) {
      console.error(`❌ Failed to create storage bucket "${STORAGE_BUCKET_SLUG}":`, error.message);
      return false;
    }
    resolvedBucketId = STORAGE_BUCKET_SLUG;
    console.log(`✅ Created storage bucket "${STORAGE_BUCKET_SLUG}"`);
    return true;
  } catch (err) {
    console.error(`❌ Storage bucket check failed:`, err.message);
    return false;
  }
}

function sanitizeStorageKey(key) {
  return key
    .split("/")
    .map((segment) =>
      segment
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "")
    )
    .join("/")
    .replace(/^\/+/, "");
}

function isSupabaseStorageObjectTooLargeError(message) {
  const m = String(message || "").toLowerCase();
  return (
    /maximum\s+allowed\s+size|object\s+too\s+large|file\s+too\s+large|payload\s+too\s+large|413/.test(m) ||
    (m.includes("size") && m.includes("exceed"))
  );
}

/** @returns {Promise<{ publicUrl: string | null, errorCode: string | null, errorMessage: string | null }>} */
async function uploadToSupabaseStorageResult(localPath, storagePath, uploadOpts = {}) {
  const ready = await ensureStorageBucket();
  if (!ready) return { publicUrl: null, errorCode: "bucket_unavailable", errorMessage: "bucket_unavailable" };
  try {
    const sanitizedPath = sanitizeStorageKey(storagePath);
    console.log(`      📤 Supabase upload key: "${sanitizedPath}" (bucket: ${resolvedBucketId})`);

    const fileBuffer = fs.readFileSync(localPath);
    const ext = path.extname(sanitizedPath).toLowerCase();
    const mimeTypes = {
      ".pdf": "application/pdf", ".dwg": "application/octet-stream",
      ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
      ".zip": "application/zip",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    /** @type {{ contentType: string; upsert: boolean; cacheControl?: string }} */
    const uploadPayload = {
      contentType,
      upsert: uploadOpts.upsert !== false,
    };
    if (uploadOpts.cacheControl != null && `${uploadOpts.cacheControl}` !== "") {
      uploadPayload.cacheControl = `${uploadOpts.cacheControl}`;
    }

    const { data, error } = await supabase.storage
      .from(resolvedBucketId)
      .upload(sanitizedPath, fileBuffer, uploadPayload);

    if (error) {
      const tooLarge = isSupabaseStorageObjectTooLargeError(error.message);
      console.error(`      ❌ Supabase upload failed for ${sanitizedPath}:`, error.message);
      return {
        publicUrl: null,
        errorCode: tooLarge ? "storage_object_too_large" : "storage_upload_failed",
        errorMessage: error.message || "upload_failed",
      };
    }

    const { data: urlData } = supabase.storage
      .from(resolvedBucketId)
      .getPublicUrl(sanitizedPath);

    const publicUrl = urlData?.publicUrl || null;
    console.log(`      ✅ Public URL: ${publicUrl}`);
    return { publicUrl, errorCode: null, errorMessage: null };
  } catch (err) {
    const tooLarge = isSupabaseStorageObjectTooLargeError(err?.message);
    console.error(`      ❌ Supabase upload exception for ${storagePath}:`, err.message);
    return {
      publicUrl: null,
      errorCode: tooLarge ? "storage_object_too_large" : "storage_upload_exception",
      errorMessage: err?.message || "exception",
    };
  }
}

async function uploadToSupabaseStorage(localPath, storagePath, uploadOpts = {}) {
  const r = await uploadToSupabaseStorageResult(localPath, storagePath, uploadOpts);
  return r.publicUrl;
}

// GET /, session API routes: app/http-app.js (createSharedHttpApp)

// ─── Login helper ────────────────────────────────────────────────────────────
async function performLogin(page, username, password, dashboardUrl) {
  await page.goto(dashboardUrl, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  let url = page.url();
  console.log(`  Landed on: ${url}`);

  if (url.includes("SessionEnded")) {
    const link = await page.$(
      'a:has-text("Log in again"), a:has-text("Login"), a[href*="Login"]',
    );
    if (link) {
      await link.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      url = page.url();
    }
  }
  if (url.includes("SSOLanding") || url.includes("Home/SSO")) {
    const btn = await page.$(
      'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]',
    );
    if (btn) {
      await btn.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      url = page.url();
    }
  }
  if (url.includes("b2clogin.com")) {
    const ab = await page.$("#OktaExchange");
    if (ab) await ab.click();
    else await page.click('button[type="submit"]');
    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
    url = page.url();
    console.log(`  After B2C: ${url}`);
  }
  if (
    url.includes("okta") ||
    url.includes("b2clogin") ||
    url.includes("login") ||
    url.includes("signin")
  ) {
    const uSel = [
      'input[name="identifier"]',
      "#okta-signin-username",
      'input[name="username"]',
      'input[type="email"]',
      'input[type="text"]:not([type="checkbox"]):not([type="radio"]):not([role="checkbox"])',
    ];
    let uF = null;
    for (const s of uSel) {
      uF = await page.$(s);
      if (uF && (await uF.isVisible().catch(() => false))) {
        const inputType = await uF.getAttribute("type").catch(() => "");
        if (inputType === "checkbox" || inputType === "radio") {
          uF = null;
          continue;
        }
        break;
      }
      uF = null;
    }
    if (!uF) throw new Error("Cannot find username field");
    await uF.fill(username);
    console.log("  Filled username");

    const pSel = [
      'input[name="credentials.passcode"]',
      "#okta-signin-password",
      'input[name="password"]',
      'input[type="password"]',
    ];
    let pF = null;
    for (const s of pSel) {
      pF = await page.$(s);
      if (pF && (await pF.isVisible().catch(() => false))) {
        const pType = await pF.getAttribute("type").catch(() => "");
        if (pType === "checkbox" || pType === "radio") {
          pF = null;
          continue;
        }
        break;
      }
      pF = null;
    }
    if (!pF) {
      console.log("  Two-step login...");
      const nb = await page.$('input[type="submit"], button[type="submit"]');
      if (nb) await nb.click();
      else await page.keyboard.press("Enter");
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
      for (const s of pSel) {
        pF = await page.$(s);
        if (pF && (await pF.isVisible().catch(() => false))) {
          const pType2 = await pF.getAttribute("type").catch(() => "");
          if (pType2 === "checkbox" || pType2 === "radio") {
            pF = null;
            continue;
          }
          break;
        }
        pF = null;
      }
      if (!pF) throw new Error("Cannot find password field");
    }
    await pF.fill(password);
    console.log("  Filled password");
    const sb = await page.$('input[type="submit"], button[type="submit"]');
    if (sb) await sb.click();
    else await page.keyboard.press("Enter");
    await page
      .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(3000);
    url = page.url();
    console.log(`  After login: ${url}`);
  }
  if (url.includes("SSOLanding") || url.includes("Home/SSO")) {
    const btn = await page.$(
      'button:has-text("Continue"), a:has-text("Continue"), input[value="Continue"]',
    );
    if (btn) {
      await btn.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  url = page.url();
  if (
    url.includes("b2clogin") ||
    url.includes("SessionEnded") ||
    url.includes("okta.com/signin")
  )
    throw new Error("Login failed");
  return url;
}

// ─── Analyze Drawing (AI Compliance) endpoint ──────────────────────────────
app.post("/api/analyze-drawing", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const token = authHeader.split(" ")[1];
    if (supabase) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: "Invalid or expired authentication token" });
      }
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured. Add OPENAI_API_KEY to your environment secrets." });
    }

    const OpenAI = require("openai").default || require("openai");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const { imageBase64, imageType = "image/png", jurisdiction, projectType = "Commercial", codeYear = "2021", codeType, disciplines } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "Image data is required" });
    }

    const jurisdictionAmendments = {
      'dc': `WASHINGTON D.C. BUILDING CODE AMENDMENTS (12A DCMR):\nThe District of Columbia adopts the IBC with the following key amendments:\n\nEGRESS & EXITS:\n- 12A DCMR 1004.5: Occupant load calculations for assembly spaces require additional 15% capacity factor\n- 12A DCMR 1006.3: Exit access travel distance reduced to 200 ft (unsprinklered) and 250 ft (sprinklered) for B occupancy\n- 12A DCMR 1017.2: Corridor width minimum 48" for all occupancies (stricter than IBC 44")\n\nFIRE SAFETY:\n- 12A DCMR 903.2.1: Automatic sprinkler systems required in all new buildings over 5,000 sq ft\n- 12A DCMR 903.2.9: Group R-2 occupancies require NFPA 13R systems minimum (no 13D allowed in D.C.)\n- 12A DCMR 907.2: Fire alarm systems required in buildings over 3 stories (not 4 as in IBC)\n\nACCESSIBILITY (D.C. Human Rights Act compliance):\n- 12A DCMR 1103.2.2: 10% of dwelling units in multi-family must be Type A units (IBC requires 2%)\n- 12A DCMR 1107.6: All primary entrances must be accessible (no exemptions for grade changes)\n- 12A DCMR 1109.2: D.C. requires grab bars at all water closets in public restrooms\n\nSTRUCTURAL:\n- 12A DCMR 1604.5: Snow load minimum 30 psf (higher than standard IBC for region)\n- 12A DCMR 1609.3: Wind design per ASCE 7 with 115 mph basic wind speed minimum\n\nHISTORIC PRESERVATION (unique to D.C.):\n- 12A DCMR 3412: Historic buildings within Historic Districts require HPRB approval\n- Work in L'Enfant Plan zones requires additional Historic Preservation Review Board compliance\n\nENERGY:\n- D.C. Green Building Act: Buildings over 10,000 sq ft must meet LEED certification or equivalent\n- 12A DCMR C402: Envelope requirements 10% more stringent than IECC`,
      'new-york': `NEW YORK CITY BUILDING CODE (NYC BC):\nNYC has its own building code separate from IBC with significant differences:\n\nEGRESS & EXITS:\n- NYC BC 1003.2: Minimum corridor width 44" but 60" in Group I-2 (hospitals)\n- NYC BC 1005.1: Egress capacity factors differ - 0.2" per occupant for stairs (IBC is 0.3")\n- NYC BC 1009.3: Stair width minimum 44" (IBC allows 36" in some cases)\n- NYC BC 1020.1: Exit access travel distance 200 ft max (sprinklered), 150 ft (unsprinklered)\n\nFIRE SAFETY:\n- NYC BC 903.2: Sprinklers required in ALL new buildings regardless of size (stricter than IBC)\n- NYC BC 907.2.1: Fire alarm required in buildings over 75 ft in height\n- NYC BC 3002.4: Standpipe systems required in buildings over 4 stories\n- Local Law 5/73: Retroactive fire safety requirements for existing high-rise buildings\n\nACCESSIBILITY:\n- NYC BC 1107: 5% of dwelling units must be Type A accessible (stricter than IBC 2%)\n- NYC BC 1109.2.1: At least one accessible entrance per 200 ft of street frontage\n- Local Law 58: Enhanced accessibility for places of public accommodation`,
      'california': `CALIFORNIA BUILDING CODE (CBC - Title 24):\nCalifornia adopts IBC with extensive amendments:\n\nACCESSIBILITY (Most Restrictive in U.S.):\n- CBC 11B-206.2.1: Accessible routes required from ALL parking spaces\n- CBC 11B-403.5.1: Corridor width minimum 48" clear (IBC allows 44")\n- CBC 11B-404.2.4: Maneuvering clearances at doors more restrictive than ADA\n- CBC 11B-603: Toilet room clearances require 60" turning space\n\nSEISMIC (VERY CRITICAL):\n- CBC 1613: California-specific seismic design requirements beyond IBC\n- CBC 1616: Site-specific ground motion procedures required for many buildings\n- Hospital (OSHPD) buildings have additional seismic requirements\n\nENERGY (Title 24 Part 6):\n- Most stringent energy code in U.S.\n- Solar-ready requirements for new construction\n- Cool roof requirements in climate zones 10-15`,
      'florida': `FLORIDA BUILDING CODE (FBC):\nFlorida adopts IBC with hurricane and high-velocity wind zone amendments:\n\nWIND DESIGN (CRITICAL):\n- FBC 1609: High-Velocity Hurricane Zone (HVHZ) requirements for Miami-Dade and Broward\n- Wind speeds up to 180 mph in HVHZ areas\n- Impact-resistant glazing or shutters required in coastal high-hazard areas\n\nFLOOD REQUIREMENTS:\n- FBC 3109: Coastal construction requirements\n- Buildings in V-zones must be elevated above base flood elevation\n- Breakaway walls required below design flood elevation`,
      'chicago': `CHICAGO BUILDING CODE (CBC):\nChicago has its own comprehensive building code separate from IBC:\n\nEGRESS:\n- Chicago BC 13-160: Corridor widths minimum 44", 66" for schools\n- Chicago BC 13-160-140: Exit stair requirements differ from IBC\n\nFIRE SAFETY:\n- Chicago BC 15-16: Sprinkler requirements for buildings over 80 ft\n- High-Rise Fire Safety Ordinance: Additional requirements for buildings over 80 ft`
    };

    const jurisdictionKey = jurisdiction?.toLowerCase().replace(/\s+/g, '-') || 'general';
    const jurisdictionContext = jurisdictionAmendments[jurisdictionKey] || '';
    const jurisdictionCitation = jurisdictionKey === 'dc' ? '12A DCMR'
      : jurisdictionKey === 'new-york' ? 'NYC BC'
      : jurisdictionKey === 'california' ? 'CBC'
      : jurisdictionKey === 'florida' ? 'FBC'
      : jurisdictionKey === 'chicago' ? 'Chicago BC'
      : 'IBC';

    const systemPrompt = `You are an expert building code compliance analyst with deep knowledge of:
- International Building Code (IBC) 2018, 2021, 2024
- International Residential Code (IRC) 2018, 2021, 2024
- NFPA 101 Life Safety Code
- ADA Accessibility Guidelines
- State and local amendments including NYC BC, California CBC, Florida FBC, Chicago BC, and D.C. 12A DCMR

${jurisdictionContext}

Analyze the provided architectural drawing/floor plan for code compliance issues.

For each issue found, provide:
1. Category (Egress, Fire Safety, Accessibility, Structural, MEP, Zoning, Life Safety)
2. Clear title describing the issue
3. Detailed description of the violation
4. Severity level (critical, warning, or advisory)
5. Specific code reference (e.g., "${jurisdictionCitation} Section 1005.1")
6. Location in the drawing (e.g., "Main corridor, north exit")
7. Suggested fix to resolve the issue

Consider the jurisdiction: ${jurisdiction || 'General IBC'} and project type: ${projectType || 'Commercial'}.
Use code year: ${codeYear || '2021'}.
${jurisdictionContext ? `IMPORTANT: Apply ${jurisdictionCitation} amendments which may be MORE RESTRICTIVE than base IBC. Always cite ${jurisdictionCitation} sections when jurisdiction-specific requirements apply.` : ''}

Be thorough but avoid false positives. Only report genuine code compliance concerns visible in the drawing.

You MUST respond with a valid JSON object in exactly this format:
{
  "issues": [
    {
      "id": "issue-1",
      "category": "Egress|Fire Safety|Accessibility|Structural|MEP|Zoning|Life Safety",
      "title": "Brief issue title",
      "description": "Detailed description of the violation",
      "severity": "critical|warning|advisory",
      "codeReference": "Specific code section reference",
      "codeYear": "${codeYear || '2021'}",
      "location": "Location in the drawing",
      "suggestedFix": "Recommended fix for the issue"
    }
  ],
  "jurisdictionNotes": "Notes about jurisdiction-specific requirements",
  "overallScore": 85
}`;

    const userPrompt = `Analyze this architectural drawing for building code compliance issues. 
Look for violations related to:
- Egress requirements (corridor widths, exit distances, door swings)
- Fire separation and rated assemblies
- Accessibility (ADA compliance, clearances, ramp slopes)
- Occupancy load calculations
- Stairway and handrail requirements
- Emergency lighting and signage
- Structural concerns visible in the plans

Provide a comprehensive analysis with specific code citations. Return ONLY valid JSON.`;

    console.log("[analyze-drawing] Calling OpenAI GPT-4o Vision...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageType};base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 4096,
      response_format: { type: "json_object" }
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      console.error("[analyze-drawing] No content in OpenAI response");
      return res.status(500).json({ error: "No response from AI model" });
    }

    let analysisData;
    try {
      analysisData = JSON.parse(content);
    } catch (parseError) {
      console.error("[analyze-drawing] Failed to parse OpenAI response:", content.substring(0, 500));
      return res.status(500).json({ error: "Invalid JSON response from AI model" });
    }

    const issues = analysisData.issues || [];
    const critical = issues.filter(i => i.severity === "critical").length;
    const warnings = issues.filter(i => i.severity === "warning").length;
    const advisory = issues.filter(i => i.severity === "advisory").length;

    const result = {
      issues: issues.map((issue, index) => ({
        ...issue,
        id: issue.id || `issue-${index + 1}`,
        codeYear: issue.codeYear || codeYear || "2021"
      })),
      summary: {
        totalIssues: issues.length,
        critical,
        warnings,
        advisory,
        overallScore: analysisData.overallScore || Math.max(0, 100 - (critical * 20) - (warnings * 10) - (advisory * 3))
      },
      jurisdictionNotes: analysisData.jurisdictionNotes || ""
    };

    console.log(`[analyze-drawing] Analysis complete: ${result.summary.totalIssues} issues found`);
    res.json(result);
  } catch (err) {
    console.error("[analyze-drawing] Error:", err.message);
    const safeMessage = err.message?.includes("API") || err.message?.includes("key") || err.message?.includes("token")
      ? "Analysis service error. Please try again."
      : (err.message || "Analysis failed");
    res.status(500).json({ error: safeMessage });
  }
});

// ─── Login endpoint ──────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  let { username, password, portalUrl } = req.body || {};
  const credentialIdRaw = req.body?.credentialId || req.body?.credential_id;
  let loginTargetPermit = String(
    req.body?.permitNumber || req.body?.permit_number || "",
  ).trim();

  if (credentialIdRaw && String(credentialIdRaw).trim()) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required when using credentialId",
      });
    }
    const token = authHeader.split(" ")[1];
    const { data: authData, error: authErr } = await supabase.auth.getUser(
      token,
    );
    const authedUser = authData?.user;
    if (authErr || !authedUser) {
      return res
        .status(401)
        .json({ error: "Invalid or expired authentication token" });
    }

    const { data: cred, error: credErr } = await supabase
      .from("portal_credentials")
      .select("user_id, portal_username, portal_password, login_url, permit_number")
      .eq("id", String(credentialIdRaw).trim())
      .maybeSingle();

    if (credErr || !cred) {
      return res.status(404).json({ error: "credential_not_found" });
    }
    if (cred.user_id !== authedUser.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    username = cred.portal_username;
    try {
      password = resolveStoredPortalPassword(cred.portal_password);
    } catch (_) {
      return res.status(500).json({
        error: "credential_decrypt_failed",
        message:
          "Saved portal credential could not be decrypted. Check server encryption key.",
      });
    }

    const credLogin = cred.login_url && String(cred.login_url).trim();
    if ((!portalUrl || !String(portalUrl).trim()) && credLogin) {
      portalUrl = credLogin;
    }
    const credPermit = cred.permit_number && String(cred.permit_number).trim();
    if (
      !loginTargetPermit &&
      credPermit &&
      credPermit.toUpperCase() !== "LEGACY"
    ) {
      loginTargetPermit = credPermit;
    }
  }

  console.log(`[login] raw portalUrl from body: ${JSON.stringify(req.body.portalUrl)}`);
  const dashboardUrl =
    portalUrl && portalUrl.trim()
      ? portalUrl
          .trim()
          .replace(/\/+$/, "")
          .replace(/\/User\/Index$/i, "")
      : DEFAULT_DASHBOARD_URL;
  const portalType = detectPortalType(dashboardUrl);
  console.log(`Portal URL: ${dashboardUrl}`);
  console.log(`Portal Type: ${portalType}`);

  if (portalType === "unknown") {
    return res.status(400).json({
      error:
        "Unsupported portal type. Supported: ProjectDox (avolvecloud.com) and Accela (accela.com or Citizen Access URLs)",
    });
  }

  let webUiBase =
    portalType === "projectdox" ? deriveWebUiBase(dashboardUrl) : null;
  if (
    portalType === "projectdox" &&
    howardProjectDox.isHowardProjectDoxHost(dashboardUrl)
  ) {
    webUiBase = howardProjectDox.DEFAULT_HOWARD_WEBUI;
  }
  if (webUiBase) console.log(`WebUI Base: ${webUiBase}`);
  let browser;
  try {
    console.log("🔐 Launching browser...");
    browser = await launchChromiumForScraper({ label: "quick-scrape", route: "POST /api/login", file: "server.js" });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      acceptDownloads: true,
    });
    let page = await context.newPage();

    if (portalType === "accela") {
      await accelaScraperLogin(page, username, password, dashboardUrl);
      console.log("✅ Accela login successful!");

      if (isScraperDebugArtifactsEnabled()) {
        await page.screenshot({
          path: path.join(SCRAPER_ROOT, "debug_dashboard.png"),
          fullPage: true,
        });
      }

      const sessionId =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessions[sessionId] = {
        status: "logged_in",
        portalType: "accela",
        portalUrl: dashboardUrl,
        projects: [],
        browser,
        context,
        page,
        username,
        password,
        dashboardUrl,
        message: "Logged in to Accela — ready to search permits",
        progress: 0,
        total: 0,
        data: {},
      };
      sessions[sessionId]._timeout = setTimeout(
        () => cleanupSession(sessionId, "idle_timeout"),
        SESSION_IDLE_TIMEOUT_MS,
      );
      return res.json({
        sessionId,
        projectCount: 0,
        projects: [],
        portalType: "accela",
        message:
          "Logged in to Accela. Use /api/scrape with permitNumber to search.",
      });
    }

    if (portalType === "projectdox" && pgcEplan.isPgcEplanHost(dashboardUrl)) {
      if (
        !String(username || "").trim() ||
        password == null ||
        String(password) === ""
      ) {
        if (browser) await browser.close().catch(() => {});
        return res.status(400).json({
          error: "pgc_saved_portal_credentials_missing",
        });
      }
      const loginUrlResolved = pgcEplan.resolvePgcLoginUrl(dashboardUrl);
      console.log("🟣 PGC ePlan login URL:", loginUrlResolved);
      await pgcEplan.performPgcLogin(page, username, password, loginUrlResolved, {
        credentialsSource: "saved_portal_settings",
      });
      console.log("✅ PGC login successful!");
      const postLoginUrl = page.url();
      const postLoginTitle = (await page.title().catch(() => "")) || "";
      console.log("[PGC] Post-login URL:", postLoginUrl);
      console.log("[PGC] Post-login title:", postLoginTitle);
      if (/\/Portal\/Home\/Index/i.test(postLoginUrl)) {
        console.log("[PGC] Skipping redundant Home navigation after successful login");
      } else {
        console.log(
          "[PGC] Login succeeded; continuing from current page context without forced Home navigation",
        );
      }
      const dashboardTarget = postLoginUrl || dashboardUrl.trim() || pgcEplan.PGC_DASHBOARD_URL;
      await pgcEplan.waitForProjectGrid(page);

      const pagerGuess = await pgcEplan.detectPaginationMode(page);
      const loginScrapeMode = String(req.body?.scrapeMode || "").trim();
      const collectOpts = {
        initialMode: pagerGuess.mode,
        viewAllVisible: pagerGuess.viewAllVisible,
        scrapeMode: loginScrapeMode || undefined,
      };
      if (pgcEplan.pgcIsFilesOnlyScrapeMode(loginScrapeMode)) {
        collectOpts.targetedCollectionOnly = true;
        console.log(
          `[PGC] Login Files Only mode (${loginScrapeMode}) — targeted dashboard search only`,
        );
      }
      if (loginTargetPermit) {
        collectOpts.targetPermit = loginTargetPermit;
        console.log(
          `[PGC] Login explicitTargetPermit=${loginTargetPermit} (skipping full dashboard enumeration when found)`,
        );
      }
      const loginTargetProjectId = String(
        req.body?.projectId || req.body?.project_id || "",
      ).trim();
      if (loginTargetProjectId) {
        collectOpts.targetProjectId = loginTargetProjectId;
        console.log(
          `[PGC] Login explicitTargetProjectId=${loginTargetProjectId} (match by ID during discovery)`,
        );
      }
      let collection;
      if (
        collectOpts.targetedCollectionOnly &&
        !loginTargetPermit &&
        !loginTargetProjectId
      ) {
        console.log(
          "[PGC] Login Files Only without permit/projectId — deferring dashboard target search to scrape phase",
        );
        collection = {
          projects: [],
          paginationMode: pagerGuess.mode,
          pagesVisited: 0,
          viewAllClicked: false,
          rawRowsScanned: 0,
          validRowsWithProjectId: 0,
          uniqueProjectCount: 0,
          skippedNoProjectId: 0,
          duplicateRowsSkipped: 0,
          linkPatternSummary: "{}",
          targetFound: false,
        };
      } else {
        collection = await pgcEplan.collectAllProjects(page, collectOpts);
      }

      const projects = collection.projects.map((p) => ({
        id: p.projectID,
        name: p.projectNumber,
        projectNum: p.projectNumber,
        projectId: p.projectID,
        description: p.description || "",
        location: p.location || "",
        status: p.status || "",
        tasks: "",
        href: "",
      }));

      console.log(`📋 PGC: found ${projects.length} projects`);

      if (isScraperDebugArtifactsEnabled()) {
        await page.screenshot({
          path: path.join(SCRAPER_ROOT, "debug_dashboard.png"),
          fullPage: true,
        });
      }

      const bases = await pgcEplan.resolvePgcWebUiBases(page);
      const sessionId =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessions[sessionId] = {
        status: "logged_in",
        portalType: "projectdox",
        portalSubtype: "pgc-eplan",
        projects,
        browser,
        context,
        page,
        username,
        password,
        dashboardUrl: dashboardTarget,
        webUiBase: bases[0] || deriveWebUiBase(dashboardTarget),
        pgcWebUiBases: bases,
        message: `PGC: found ${projects.length} projects`,
        progress: 0,
        total: 0,
        data: {},
      };
      sessions[sessionId]._timeout = setTimeout(
        () => cleanupSession(sessionId, "idle_timeout"),
        SESSION_IDLE_TIMEOUT_MS,
      );
      return res.json({
        sessionId,
        projectCount: projects.length,
        projects,
        portalType: "projectdox",
        portalSubtype: "pgc-eplan",
      });
    }

    const isMontgomeryProjectDox =
      montgomeryProjectDox.isMontgomeryProjectDoxHost(dashboardUrl);
    const isHowardProjectDox =
      howardProjectDox.isHowardProjectDoxHost(dashboardUrl);

    if (isHowardProjectDox) {
      await performHowardPortalLogin(page, username, password, dashboardUrl);
      const howardPdxPage = await bootstrapHowardProjectDoxFromPortal(
        page,
        context,
      );
      await page.close().catch(() => {});
      page = howardPdxPage;
    } else if (isMontgomeryProjectDox) {
      await performMontgomeryPortalLogin(
        page,
        username,
        password,
        dashboardUrl,
      );
      await montgomeryDashboardDiscovery.ensureMontgomeryPostLoginDashboard(
        page,
        dashboardUrl,
      );
    } else {
      await performLogin(page, username, password, dashboardUrl);
    }
    console.log("✅ Login successful!");

    if (
      !isHowardProjectDox &&
      (!page.url().includes("avolvecloud.com") ||
        page.url().includes("projectdoxwebui"))
    ) {
      await page.goto(dashboardUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
    }

    if (isScraperDebugArtifactsEnabled()) {
      await page.screenshot({
        path: path.join(SCRAPER_ROOT, "debug_dashboard.png"),
        fullPage: true,
      });
    }

    /** @type {Array<{ id: string, name: string, projectNum: string, projectId: string, description: string, location: string, status: string, tasks: string, href: string }>} */
    let projects;
    if (isMontgomeryProjectDox) {
      console.log(
        `[Montgomery][discovery] dashboard URL (main frame): ${page.url()}`,
      );
      await montgomeryDashboardDiscovery.waitForMontgomeryDashboardReady(
        page,
        dashboardUrl,
      );
      projects =
        await montgomeryDashboardDiscovery.collectMontgomeryDashboardProjects(
          page,
        );
      console.log(
        `[Montgomery][discovery] main DOM project rows: ${projects.length}`,
      );
      if (projects.length) {
        console.log(
          `[Montgomery][discovery] parsed ProjectIDs: ${projects
            .map((p) => p.projectId)
            .filter(Boolean)
            .join(", ")}`,
        );
      }
      if (projects.length > 0) {
        const firstProject = projects[0];
        console.log(
          `\n🔗 [Montgomery] Establishing WebUI session via ${firstProject.projectNum || firstProject.projectId}…`,
        );
        const warm = await montgomeryDashboardDiscovery.warmWebUiAfterLogin(
          context,
          page,
          firstProject,
          webUiBase,
        );
        console.log(
          `[Montgomery][discovery] open result: strategy=${warm.strategy} finalUrl=${warm.finalUrl}`,
        );
      }
    } else if (isHowardProjectDox) {
      console.log(`[Howard][discovery] ProjectDox shell URL: ${page.url()}`);
      projects = await howardDashboardDiscovery.collectHowardShellProjects(
        page,
      );
      if (projects.length > 0) {
        const firstProject = projects[0];
        console.log(
          `\n🔗 [Howard] WebUI warm via ${firstProject.projectNum || firstProject.projectId}…`,
        );
        const warm = await howardDashboardDiscovery.warmHowardWebUiAfterLogin(
          context,
          page,
          firstProject,
          webUiBase,
        );
        console.log(
          `[Howard][discovery] warm result: strategy=${warm.strategy} finalUrl=${warm.finalUrl}`,
        );
      }
    } else {
      // Washington / generic Avolve ProjectDox: same igGrid (#grdProjects) + pager as Montgomery; enumerate all pages.
      console.log(
        `[ProjectDox][discovery] collecting projects (paginated Avolve grid)…`,
      );
      await pgcEplan.waitForProjectGrid(page).catch(() => {});
      projects =
        await montgomeryDashboardDiscovery.collectMontgomeryDashboardProjects(
          page,
        );

      // ── CRITICAL: Establish WebUI session by navigating through a project link ──
      if (projects.length > 0) {
        const firstProject = projects[0];
        console.log(
          `\n🔗 Establishing WebUI session via project ${firstProject.projectNum}...`,
        );

        const [popup] = await Promise.all([
          context.waitForEvent("page", { timeout: 15000 }).catch(() => null),
          page.click(`a:has-text("${firstProject.projectNum}")`),
        ]);

        if (popup) {
          console.log(`   Popup opened: ${popup.url()}`);
          await popup.waitForLoadState("networkidle").catch(() => {});
          await popup.waitForTimeout(2000);
          console.log(`   Popup final URL: ${popup.url()}`);
          await popup.close();
        } else {
          console.log(
            "   No popup detected. Checking for iframe or navigation...",
          );
          await page.waitForTimeout(3000);
          const testPage = await context.newPage();
          await testPage.goto(
            `${webUiBase}/WebForms/Frame.aspx?tab=projectStatusTab&ProjectID=${firstProject.projectId}`,
            {
              waitUntil: "networkidle",
              timeout: 30000,
            },
          );
          await testPage.waitForTimeout(2000);
          await testPage.close();
        }
      }
    }

    console.log(`📋 Found ${projects.length} projects`);
    projects.forEach((p) =>
      console.log(`   ${p.projectNum} (ID: ${p.projectId})`),
    );

    let montgomeryWebUiBases = null;
    let howardWebUiBases = null;
    if (isMontgomeryProjectDox) {
      try {
        montgomeryWebUiBases = await montgomeryProjectDox.resolveMontgomeryWebUiBases(page);
        console.log(
          "🟢 Montgomery Avolve ProjectDox — web UI bases:",
          montgomeryWebUiBases,
        );
      } catch (e) {
        console.warn("[Montgomery] resolveMontgomeryWebUiBases:", e?.message || e);
      }
    }
    if (isHowardProjectDox) {
      try {
        howardWebUiBases = await howardProjectDox.resolveHowardWebUiBases(page);
        console.log("🟢 Howard Avolve ProjectDox — web UI bases:", howardWebUiBases);
      } catch (e) {
        console.warn("[Howard] resolveHowardWebUiBases:", e?.message || e);
      }
    }

    const sessionId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    /** @type {Record<string, unknown>} */
    const projectDoxSession = {
      status: "logged_in",
      portalType: "projectdox",
      projects,
      browser,
      context,
      page,
      username,
      password,
      dashboardUrl,
      webUiBase,
      message: `Found ${projects.length} projects`,
      progress: 0,
      total: 0,
      data: {},
    };
    if (isMontgomeryProjectDox) {
      projectDoxSession.portalSubtype = "montgomery-projectdox";
      if (montgomeryWebUiBases?.length) {
        projectDoxSession.montgomeryWebUiBases = montgomeryWebUiBases;
      }
    }
    if (isHowardProjectDox) {
      projectDoxSession.portalSubtype = "howard-projectdox";
      if (howardWebUiBases?.length) {
        projectDoxSession.howardWebUiBases = howardWebUiBases;
      }
    }
    sessions[sessionId] = projectDoxSession;
    sessions[sessionId]._timeout = setTimeout(
      () => cleanupSession(sessionId, "idle_timeout"),
      SESSION_IDLE_TIMEOUT_MS,
    );
    res.json({
      sessionId,
      projectCount: projects.length,
      projects,
      portalType: "projectdox",
      ...(isMontgomeryProjectDox && { portalSubtype: "montgomery-projectdox" }),
      ...(isHowardProjectDox && { portalSubtype: "howard-projectdox" }),
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    if (err.message === "pgc_saved_portal_credentials_missing") {
      return res.status(400).json({ error: "pgc_saved_portal_credentials_missing" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── Arlington Plan Review: continue pending downloads ───────────────────────
app.post("/api/accela/plan-review/continue-downloads", async (req, res) => {
  const {
    sessionId,
    projectId,
    permitNumber,
    scope,
    userId: userIdBody,
  } = req.body || {};

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const permitEarly = `${permitNumber || ""}`.trim();
  const projIdEarly = `${projectId || ""}`.trim();
  const sidPrefix = `${String(sessionId).slice(0, 10)}...`;
  console.log(
    `[PlanReviewContinue] request sessionId=${sidPrefix} projectId=${projIdEarly ? "set" : "missing"} userId=${userIdBody ? "set" : "missing"} permit=${permitEarly || "(missing)"} scope=${scope || "allPending"}`,
  );

  const session = sessions[sessionId];
  console.log(
    `[PlanReviewContinue] session exists=${!!session} hasBrowser=${!!session?.browser} hasContext=${!!session?.context} hasPage=${!!session?.page}`,
  );
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (!session.browser || !session.page) {
    return res.status(400).json({ error: "Session expired or browser not available" });
  }

  const portalUrlStr = String(session.portalUrl || "");
  if (!portalUrlStr.toUpperCase().includes("ARLINGTONCO")) {
    return res.status(400).json({
      error: "Continue Plan Review downloads is only supported for Arlington County Accela",
    });
  }

  const permit = permitEarly;
  const projId = projIdEarly;
  if (!permit) {
    return res.status(400).json({ error: "permitNumber is required" });
  }
  if (!projId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const userId = `${userIdBody || session.userId || ""}`.trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (session._timeout) clearTimeout(session._timeout);

  const accelaSid = String(sessionId);
  session._accelaSessionId = accelaSid;
  session.touchSessionKeepalive = (documentId) => {
    rearmSessionIdleTimeout(accelaSid);
    console.log(
      `[Session][keepalive] Arlington PlanReview continue download documentId=${documentId != null && `${documentId}`.trim() !== "" ? `${documentId}`.trim() : "?"}`,
    );
  };
  session._scrapeActive = true;
  session._activePlanReviewDownloads = 0;
  console.log(
    `[Session][scrape] active=true sid=${accelaSid} flow=arlington-plan-review-continue`,
  );

  try {
    const result = await continueArlingtonPlanReviewDownloads(session, {
      projectId: projId,
      permitNumber: permit,
      userId,
      supabase,
      hashPortalData,
      uploadToSupabaseStorage,
      sanitizeStorageKey,
      scope: scope || "allPending",
    });
    session.status = result.status;
    session.message = `Plan Review continue (${result.scope}): ${result.downloadedThisRun} downloaded this run`;
    return res.json(result);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`[api/accela/plan-review/continue-downloads] error: ${msg}`);
    session.status = "error";
    session.message = `Plan Review continue failed: ${msg}`;
    return res.status(500).json({
      status: "error",
      scope: scope || "allPending",
      permitNumber: permit,
      projectId: projId,
      error: msg,
    });
  } finally {
    session._scrapeActive = false;
    session._activePlanReviewDownloads = 0;
    console.log(
      `[Session][scrape] active=false sid=${accelaSid} flow=arlington-plan-review-continue`,
    );
    rearmSessionIdleTimeout(accelaSid);
  }
});

// ─── Arlington Plan Review: smart pending-only resume ────────────────────────
app.post("/api/accela/plan-review/resume-downloads", async (req, res) => {
  const logP = "[Arlington][PlanReview][Resume]";
  const {
    sessionId: sessionIdBody,
    projectId,
    permitNumber,
    userId: userIdBody,
    credentialId: credentialIdBody,
  } = req.body || {};

  const permit = `${permitNumber || ""}`.trim();
  const projId = `${projectId || ""}`.trim();
  if (!permit) {
    return res.status(400).json({ error: "permitNumber is required" });
  }
  if (!projId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const userId = `${userIdBody || ""}`.trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  /** @type {Record<string, unknown> | undefined} */
  let session =
    sessionIdBody && sessions[sessionIdBody]
      ? sessions[sessionIdBody]
      : undefined;
  let sessionId = sessionIdBody ? String(sessionIdBody) : "";
  let activeSessionFound = arlingtonPlanReviewSessionBrowserUsable(session);

  console.log(`${logP} active session found=${activeSessionFound}`);

  if (!activeSessionFound) {
    console.log(`${logP} session missing; starting login flow`);

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: "login_required",
        loginRequired: true,
        message:
          "Login required. Please complete Accela login, then resume pending downloads.",
        error: "Authentication required for automatic Accela login",
      });
    }
    const token = authHeader.split(" ")[1];
    const { data: authData, error: authErr } = await supabase.auth.getUser(
      token,
    );
    const authedUser = authData?.user;
    if (authErr || !authedUser || authedUser.id !== userId) {
      return res.status(401).json({
        status: "login_required",
        loginRequired: true,
        message:
          "Login required. Please complete Accela login, then resume pending downloads.",
        error: "Invalid or expired authentication token",
      });
    }

    let credentialId = `${credentialIdBody || ""}`.trim();
    if (!credentialId) {
      const { data: projRow } = await supabase
        .from("projects")
        .select("credential_id")
        .eq("id", projId)
        .maybeSingle();
      credentialId = `${projRow?.credential_id || ""}`.trim();
    }
    if (!credentialId) {
      return res.status(400).json({
        status: "login_required",
        loginRequired: true,
        message:
          "No portal credential linked to this project. Link a credential in Settings, then resume pending downloads.",
        error: "credential_not_linked",
      });
    }

    const { data: cred, error: credErr } = await supabase
      .from("portal_credentials")
      .select("user_id, portal_username, portal_password, login_url")
      .eq("id", credentialId)
      .maybeSingle();
    if (credErr || !cred || cred.user_id !== userId) {
      return res.status(404).json({
        error: "credential_not_found",
        message: "Portal credential not found for this project.",
      });
    }

    const username = cred.portal_username;
    let password;
    try {
      password = resolveStoredPortalPassword(cred.portal_password);
    } catch (_) {
      return res.status(500).json({
        error: "credential_decrypt_failed",
        message: "Saved portal credential could not be decrypted.",
      });
    }

    const portalUrlRaw =
      cred.login_url && String(cred.login_url).trim()
        ? String(cred.login_url).trim()
        : DEFAULT_DASHBOARD_URL;
    const dashboardUrl = portalUrlRaw
      .replace(/\/+$/, "")
      .replace(/\/User\/Index$/i, "");
    if (!dashboardUrl.toUpperCase().includes("ARLINGTONCO")) {
      return res.status(400).json({
        error:
          "Resume Plan Review downloads is only supported for Arlington County Accela",
      });
    }

    let browser;
    try {
      browser = await launchChromiumForScraper({
        label: "arlington-plan-review-resume",
        route: "POST /api/accela/plan-review/resume-downloads",
        file: "register-execution-routes.js",
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        acceptDownloads: true,
      });
      const page = await context.newPage();

      try {
        await accelaScraperLogin(page, username, password, dashboardUrl);
      } catch (loginErr) {
        const loginMsg =
          loginErr && loginErr.message ? loginErr.message : String(loginErr);
        const humanLogin = await detectAccelaHumanLoginRequired(page);
        if (humanLogin && browser) {
          sessionId =
            Date.now().toString(36) + Math.random().toString(36).slice(2);
          sessions[sessionId] = {
            status: "awaiting_manual_login",
            portalType: "accela",
            portalUrl: dashboardUrl,
            projects: [],
            browser,
            context,
            page,
            username,
            password,
            dashboardUrl,
            userId,
            message:
              "Accela login requires manual completion — complete login in browser, then resume.",
            progress: 0,
            total: 0,
            data: {},
          };
          sessions[sessionId]._timeout = setTimeout(
            () => cleanupSession(sessionId, "idle_timeout"),
            SESSION_IDLE_TIMEOUT_MS,
          );
          return res.json({
            status: "login_required",
            loginRequired: true,
            sessionId,
            permitNumber: permit,
            projectId: projId,
            message:
              "Login required. Please complete Accela login, then resume pending downloads.",
            error: loginMsg,
          });
        }
        if (browser) await browser.close().catch(() => {});
        throw loginErr;
      }

      sessionId =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      sessions[sessionId] = {
        status: "logged_in",
        portalType: "accela",
        portalUrl: dashboardUrl,
        projects: [],
        browser,
        context,
        page,
        username,
        password,
        dashboardUrl,
        userId,
        message: "Logged in to Accela — resuming Plan Review downloads",
        progress: 0,
        total: 0,
        data: {},
      };
      sessions[sessionId]._timeout = setTimeout(
        () => cleanupSession(sessionId, "idle_timeout"),
        SESSION_IDLE_TIMEOUT_MS,
      );
      session = sessions[sessionId];
      activeSessionFound = false;
    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      const msg = err && err.message ? err.message : String(err);
      console.error(`${logP} login error: ${msg}`);
      return res.status(500).json({
        status: "error",
        loginRequired: true,
        message:
          "Login required. Please complete Accela login, then resume pending downloads.",
        permitNumber: permit,
        projectId: projId,
        error: msg,
      });
    }
  }

  if (!session || !sessionId) {
    return res.status(400).json({
      status: "login_required",
      loginRequired: true,
      message:
        "Login required. Please complete Accela login, then resume pending downloads.",
      error: "Session not available",
    });
  }

  const humanLoginStill = await detectAccelaHumanLoginRequired(session.page);
  if (humanLoginStill) {
    if (session._timeout) clearTimeout(session._timeout);
    session._timeout = setTimeout(
      () => cleanupSession(sessionId, "idle_timeout"),
      SESSION_IDLE_TIMEOUT_MS,
    );
    return res.json({
      status: "login_required",
      loginRequired: true,
      sessionId,
      permitNumber: permit,
      projectId: projId,
      message:
        "Login required. Please complete Accela login, then resume pending downloads.",
    });
  }

  if (session._timeout) clearTimeout(session._timeout);
  session._accelaSessionId = String(sessionId);
  session.touchSessionKeepalive = (documentId) => {
    rearmSessionIdleTimeout(String(sessionId));
    console.log(
      `[Session][keepalive] Arlington PlanReview resume download documentId=${documentId != null && `${documentId}`.trim() !== "" ? `${documentId}`.trim() : "?"}`,
    );
  };
  session._scrapeActive = true;
  session._activePlanReviewDownloads = 0;
  console.log(
    `[Session][scrape] active=true sid=${sessionId} flow=arlington-plan-review-resume`,
  );

  try {
    const result = await resumeArlingtonPlanReviewPendingDownloads(session, {
      projectId: projId,
      permitNumber: permit,
      userId,
      supabase,
      hashPortalData,
      uploadToSupabaseStorage,
      sanitizeStorageKey,
    });
    session.status = result.status;
    session.message = `Plan Review resume: ${result.downloadedThisRun ?? 0} downloaded this run`;
    return res.json({
      ...result,
      sessionId,
      activeSessionFound,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error(`${logP} error: ${msg}`);
    session.status = "error";
    session.message = `Plan Review resume failed: ${msg}`;
    return res.status(500).json({
      status: "error",
      permitNumber: permit,
      projectId: projId,
      sessionId,
      error: msg,
    });
  } finally {
    session._scrapeActive = false;
    session._activePlanReviewDownloads = 0;
    console.log(
      `[Session][scrape] active=false sid=${sessionId} flow=arlington-plan-review-resume`,
    );
    rearmSessionIdleTimeout(String(sessionId));
  }
});

// ─── Scrape endpoint ─────────────────────────────────────────────────────────
app.post("/api/scrape", async (req, res) => {
  const {
    sessionId,
    projectIds,
    tabs: tabsParam,
    permitNumber,
    projectId,
    userId,
    scrapeMode,
    targetFolder,
    targetFolders: targetFoldersParam,
  } = req.body;
  const bodyKeys = req.body && typeof req.body === "object" ? Object.keys(req.body) : [];
  console.log(
    `[api/scrape] enter keys=${JSON.stringify(bodyKeys)} sessionId=${sessionId ? `${String(sessionId).slice(0, 10)}…` : "MISSING"} permit=${permitNumber != null && String(permitNumber).trim() !== "" ? "set" : "MISSING"} projectId=${projectId != null && String(projectId).trim() !== "" ? "set" : "MISSING"}`,
  );
  const session = sessions[sessionId];
  if (!session) {
    console.log("[api/scrape] reject: Session not found (wrong id, other server instance, or stale client)");
    return res.status(404).json({ error: "Session not found" });
  }
  if (!session.browser) {
    console.log("[api/scrape] reject: Session expired (browser cleared — idle cleanup, cancel, or crash)");
    return res.status(400).json({ error: "Session expired." });
  }
  if (session._timeout) clearTimeout(session._timeout);
  session._timeout = setTimeout(
    () => cleanupSession(sessionId, "idle_timeout"),
    SESSION_IDLE_TIMEOUT_MS,
  );

  const portalUrlForJobGate = String(session.portalUrl || "");
  const accelaIsArlingtonForJob =
    session.portalType === "accela" &&
    portalUrlForJobGate.toUpperCase().includes("ARLINGTONCO");

  let scrapeJobId = null;
  if (projectId && String(projectId).trim()) {
    const skipGenericJobInsert =
      accelaIsArlingtonForJob &&
      permitNumber != null &&
      String(permitNumber).trim() !== "";
    if (!skipGenericJobInsert) {
      const begun = await scrapeEvents.beginScrapeJob(
        supabase,
        session,
        req.body,
        sessionId,
      );
      scrapeJobId = begun.jobId || null;
    }
  }

  async function finalizeSessionScrapeJob(statusHint) {
    if (typeof session.finalizeScrapeJob !== "function") return;
    try {
      const status =
        statusHint ||
        (session._cancelRequested ? "cancelled" : session.status);
      await session.finalizeScrapeJob(status);
    } catch (err) {
      console.warn("[scrape-events] finalizeSessionScrapeJob:", err.message);
    }
  }

  if (session.portalType === "accela") {
    const portalUrlStrEarly = String(session.portalUrl || "");
    console.log(
      `[api/scrape accela] begin permit=${permitNumber != null && String(permitNumber).trim() !== "" ? String(permitNumber).trim() : "(missing)"} projectId=${projectId != null && String(projectId).trim() !== "" ? "set" : "(missing)"} portalUrl=${portalUrlStrEarly.slice(0, 96)}`,
    );
    if (!permitNumber || String(permitNumber).trim() === "") {
      console.log("[api/scrape accela] reject: missing permitNumber (e.g. legacy public/index.html only sends sessionId)");
      return res
        .status(400)
        .json({ error: "Accela scraping requires a permitNumber" });
    }
    const portalUrlStr = String(session.portalUrl || "");
    const accelaIsBaltimore = portalUrlStr.toUpperCase().includes("BALTIMORE");
    const accelaIsFairfax = portalUrlStr.toUpperCase().includes("FAIRFAX");
    const accelaIsArlington = portalUrlStr.toUpperCase().includes("ARLINGTONCO");
    if (
      accelaIsBaltimore &&
      (!projectId || String(projectId).trim() === "")
    ) {
      console.log("[api/scrape accela] reject: Baltimore requires projectId");
      return res.status(400).json({
        error:
          "Baltimore Accela scraping requires projectId (projects.id) for permit integrity and DB write",
      });
    }
    if (
      accelaIsFairfax &&
      (!projectId || String(projectId).trim() === "")
    ) {
      console.log("[api/scrape accela] reject: Fairfax requires projectId");
      return res.status(400).json({
        error:
          "Fairfax Accela scraping requires projectId (projects.id) for permit integrity and DB write",
      });
    }
    let baltimoreScrapeTabsArg;
    if (accelaIsBaltimore) {
      const allowed = new Set(["info", "attachments"]);
      const raw = Array.isArray(tabsParam) ? tabsParam : [];
      const filtered = [
        ...new Set(
          raw
            .map((k) => String(k).trim())
            .filter((k) => allowed.has(k)),
        ),
      ];
      baltimoreScrapeTabsArg =
        filtered.length > 0 ? filtered : ["info", "attachments"];
      console.log(
        `[api/scrape accela] permitNumber=${String(permitNumber).trim()} projectId=${projectId || "(none)"} baltimore=${accelaIsBaltimore} tabs=${JSON.stringify(baltimoreScrapeTabsArg)}`,
      );
    }

    let fairfaxScrapeTabsArg;
    if (accelaIsFairfax) {
      const allowed = new Set(["info", "attachments"]);
      const raw = Array.isArray(tabsParam) ? tabsParam : [];
      const filtered = [
        ...new Set(
          raw
            .map((k) => String(k).trim())
            .filter((k) => allowed.has(k)),
        ),
      ];
      fairfaxScrapeTabsArg =
        filtered.length > 0 ? filtered : ["info", "attachments"];
      console.log(
        `[api/scrape accela] permitNumber=${String(permitNumber).trim()} projectId=${projectId || "(none)"} fairfax=${accelaIsFairfax} tabs=${JSON.stringify(fairfaxScrapeTabsArg)}`,
      );
    }

    let arlingtonScrapeTabsArg;
    if (accelaIsArlington) {
      const allowed = new Set(["info", "attachments", "plan_review"]);
      const raw = Array.isArray(tabsParam) ? tabsParam : [];
      const filtered = [
        ...new Set(
          raw
            .map((k) => String(k).trim())
            .filter((k) => allowed.has(k)),
        ),
      ];
      const hadTabsPayload = raw.length > 0;
      arlingtonScrapeTabsArg =
        hadTabsPayload && filtered.length > 0
          ? filtered
          : hadTabsPayload
            ? ["info", "attachments", "plan_review"]
            : undefined;
      const prScopeRaw = req.body?.planReviewScope;
      const prModeRaw = req.body?.planReviewMode;
      if (prScopeRaw != null && `${prScopeRaw}`.trim() !== "") {
        session.arlingtonPlanReviewScope = `${prScopeRaw}`.trim();
      } else {
        session.arlingtonPlanReviewScope = undefined;
      }
      if (prModeRaw != null && `${prModeRaw}`.trim() !== "") {
        session.arlingtonPlanReviewMode = `${prModeRaw}`.trim();
      } else {
        session.arlingtonPlanReviewMode = undefined;
      }
      if (req.body?.downloadDocuments === false) {
        session.arlingtonDownloadDocuments = false;
      } else {
        session.arlingtonDownloadDocuments = undefined;
      }

      const hasPlanReviewTab =
        Array.isArray(arlingtonScrapeTabsArg) &&
        arlingtonScrapeTabsArg.includes("plan_review");
      const hasAttachmentsTab =
        Array.isArray(arlingtonScrapeTabsArg) &&
        arlingtonScrapeTabsArg.includes("attachments");
      const prScopeTrim = `${session.arlingtonPlanReviewScope || ""}`.trim();
      if (req.body?.autoContinueDownloads === false) {
        session.arlingtonAutoContinueDownloads = false;
        session.arlingtonAutoContinueAttachments = false;
      } else if (req.body?.autoContinueDownloads === true) {
        session.arlingtonAutoContinueDownloads = hasPlanReviewTab;
        session.arlingtonAutoContinueAttachments = hasAttachmentsTab;
      } else {
        session.arlingtonAutoContinueDownloads =
          hasPlanReviewTab &&
          arlingtonPlanReviewScopeSupportsAutoContinue(prScopeTrim);
        session.arlingtonAutoContinueAttachments = hasAttachmentsTab;
      }
      const maxCyclesRaw = Number(req.body?.autoContinueMaxCycles);
      session.arlingtonAutoContinueMaxCycles =
        Number.isFinite(maxCyclesRaw) && maxCyclesRaw > 0
          ? Math.min(Math.floor(maxCyclesRaw), 32)
          : 8;
      const delayRaw = Number(req.body?.autoContinueDelayMs);
      session.arlingtonAutoContinueDelayMs =
        Number.isFinite(delayRaw) && delayRaw >= 0
          ? Math.min(Math.floor(delayRaw), 60000)
          : 2000;
      const noProgRaw = Number(req.body?.autoContinueMaxNoProgressCycles);
      session.arlingtonAutoContinueMaxNoProgressCycles =
        Number.isFinite(noProgRaw) && noProgRaw > 0
          ? Math.min(Math.floor(noProgRaw), 10)
          : 2;

      console.log(
        `[api/scrape accela] permitNumber=${String(permitNumber).trim()} projectId=${projectId || "(none)"} arlington=${accelaIsArlington} tabs=${JSON.stringify(arlingtonScrapeTabsArg ?? "(legacy default)")} planReviewScope=${session.arlingtonPlanReviewScope ?? "(default)"} planReviewMode=${session.arlingtonPlanReviewMode ?? "(none)"} downloadDocuments=${session.arlingtonDownloadDocuments === false ? "false" : "(default)"} autoContinueDownloads=${session.arlingtonAutoContinueDownloads === true} autoContinueAttachments=${session.arlingtonAutoContinueAttachments === true}`,
      );
      if (projectId && String(projectId).trim()) {
        session.arlingtonDurableMode = true;
        console.log(
          "[Arlington][DurableJob] enabled for project-linked scrape (no scrape-wide wall)",
        );
      }
    } else if (
      !accelaIsBaltimore &&
      !accelaIsFairfax &&
      !accelaIsArlington
    ) {
      console.log(
        `[api/scrape accela] permitNumber=${String(permitNumber).trim()} projectId=${projectId || "(none)"} tenant=accela-generic`,
      );
    }
    session.status = "scraping";
    session.total = 1;
    session.progress = 0;
    publishScrapeOrchestration(session, {
      stage: SCRAPE_STAGES.OPENING_PROJECT,
      event_type: "scrape_started",
      user_message: `Opening Accela record for permit ${String(permitNumber).trim()}.`,
      progress_current: 0,
      progress_total: 1,
      dedupeKey: "accela_open",
      forceFeed: true,
    });
    mirrorSessionProgress(
      session,
      `Scraping Accela permit: ${permitNumber}`,
      {
        event_type: "permit_found",
        stage: SCRAPE_STAGES.OPENING_PROJECT,
        user_message: `Opening Accela record for permit ${String(permitNumber).trim()}.`,
        skipFeed: true,
      },
    );

    if (accelaIsArlington && projectId && String(projectId).trim()) {
      const requestedScope = arlingtonJobStore.normalizeArlingtonRequestedScope({
        tabs:
          arlingtonScrapeTabsArg || ["info", "attachments", "plan_review"],
        planReviewScope: session.arlingtonPlanReviewScope || "all",
        autoContinueAttachments:
          session.arlingtonAutoContinueAttachments !== false,
        autoContinueDownloads: session.arlingtonAutoContinueDownloads !== false,
        downloadDocuments: session.arlingtonDownloadDocuments !== false,
      });
      const enqueueResult = await arlingtonJobStore.enqueueOrGetArlingtonScrapeJob(
        supabase,
        {
          projectId: String(projectId).trim(),
          userId: userId ? String(userId).trim() : null,
          credentialId: session.credentialId || null,
          permitNumber: String(permitNumber).trim(),
          requestedScope,
          scraperSessionId: String(sessionId),
          metadata: {
            portal_subtype: session.portalSubtype || null,
            durable_worker: true,
          },
        },
      );
      scrapeJobId = enqueueResult.jobId;
      if (!scrapeJobId) {
        return res.status(500).json({ error: "Failed to enqueue Arlington scrape job" });
      }
      scrapeEvents.attachScrapeJobBridge(supabase, session, {
        jobId: scrapeJobId,
        projectId: String(projectId).trim(),
        permitNumber: String(permitNumber).trim(),
        jurisdiction: scrapeEvents.detectJurisdictionFromSession(session),
        scrapeMode: scrapeMode ? String(scrapeMode).trim() : null,
      }, { skipUiHeartbeat: true });
      session.arlingtonDurableWorkerEnqueued = true;
      session.status = "queued";
      session._scrapeActive = false;
      const reusedExisting = enqueueResult.reusedExisting;
      const jobRow = enqueueResult.job || {};
      const dispatch = enqueueResult.dispatch || {};
      const queuePosition = Number(dispatch.queuePosition) || 0;
      const currentlyRunningJobId = dispatch.currentlyRunningJobId || null;
      const userMessage = currentlyRunningJobId
        ? "Your scrape is queued — finishing the current worker cycle first."
        : queuePosition > 0
          ? "Your scrape is queued — it will run next."
          : reusedExisting
            ? "Attached to existing Arlington scrape job. Progress will update in portal data."
            : "Arlington scrape queued for durable worker. Progress will update in portal data.";
      publishScrapeOrchestration(session, {
        stage: SCRAPE_STAGES.QUEUED,
        event_type: reusedExisting ? "job_reused" : "job_queued",
        user_message: userMessage,
        dedupeKey: reusedExisting
          ? "arlington_durable_reused"
          : "arlington_durable_queued",
        forceFeed: true,
      });
      scrapeEvents.stopHeartbeat(scrapeJobId);
      return res.json({
        message: reusedExisting
          ? "Attached to existing Arlington scrape job"
          : "Arlington scrape queued for durable worker",
        total: 1,
        portalType: "accela",
        jobId: scrapeJobId,
        durableWorker: true,
        reusedExistingJob: reusedExisting,
        runIntent: dispatch.runIntent || jobRow.run_intent || "foreground",
        queuePosition,
        currentlyRunningJobId,
        status: jobRow.status || "queued",
        phase: jobRow.phase || "record_info",
        permitNumber: String(permitNumber).trim(),
        projectId: String(projectId).trim(),
      });
    }

    res.json({
      message: "Accela scraping started",
      total: 1,
      portalType: "accela",
      jobId: scrapeJobId,
    });
    session.arlingtonPlanReviewRetryOversizedDownloads =
      accelaIsArlington &&
      (req.body?.forceRetryOversizedDownloads === true ||
        req.body?.forceRetryOversized === true ||
        String(req.query?.forceRetryOversizedDownloads || "").toLowerCase() ===
          "true");
    const accelaSid = String(sessionId);
    session._accelaSessionId = accelaSid;
    session.touchSessionKeepalive = (documentId) => {
      rearmSessionIdleTimeout(accelaSid);
      console.log(
        `[Session][keepalive] Arlington PlanReview active download documentId=${documentId != null && `${documentId}`.trim() !== "" ? `${documentId}`.trim() : "?"}`,
      );
    };
    session._scrapeActive = true;
    session._activePlanReviewDownloads = 0;
    if (userId && String(userId).trim()) {
      session.userId = String(userId).trim();
    }
    console.log(`[Session][scrape] active=true sid=${accelaSid} flow=accela`);
    scrapeAccelaRecord(
      session,
      String(permitNumber).trim(),
      projectId,
      userId,
      supabase,
      hashPortalData,
      uploadToSupabaseStorage,
      sanitizeStorageKey,
      baltimoreScrapeTabsArg,
      fairfaxScrapeTabsArg,
      arlingtonScrapeTabsArg,
    )
      .then(async () => {
        if (session._cancelRequested) {
          console.log("   🛑 Accela scrape was cancelled — not marking as done");
          await finalizeSessionScrapeJob("cancelled");
          return;
        }
        if (accelaIsArlington && projectId && String(projectId).trim()) {
          const verification = await arlingtonDurableJob.finalizeArlingtonDurableJob(
            supabase,
            session,
            {
              permitNumber: String(permitNumber).trim(),
              requestedTabs: arlingtonScrapeTabsArg || [
                "info",
                "attachments",
                "plan_review",
              ],
            },
          );
          if (verification) {
            console.log(
              `[Arlington][DurableJob] verification complete=${verification.complete} finalStatus=${verification.finalStatus} blockers=${JSON.stringify(verification.blockers || [])}`,
            );
            if (!verification.complete) {
              const mapped =
                arlingtonOrchestration.mapVerificationToSessionStatus(verification);
              session.status = mapped;
              session.progress = 1;
              session.message = `Accela scrape partially complete for ${permitNumber}; ${verification.finalStatus}.`;
              await finalizeSessionScrapeJob(mapped);
              return;
            }
          }
        }
        if (session.arlingtonPartialSuccessPlanReviewFailed === true) {
          session.status = "partial_success_plan_review_failed";
          session.progress = 1;
          session.message = `Accela scrape finished with Plan Review unavailable for ${permitNumber}`;
          console.log(
            `   ⚠️ Accela sync ended — session status set to partial_success_plan_review_failed`,
          );
          await finalizeSessionScrapeJob("partial_success_plan_review_failed");
          return;
        }
        const prPending =
          session.arlingtonPlanReviewPartialPendingDownloads === true ||
          session.arlingtonPlanReviewTimedOutAfterProgress === true;
        const attPending =
          session.arlingtonAttachmentsPartialPending === true ||
          session.arlingtonAttachmentsTimedOutAfterProgress === true;
        if (attPending) {
          session.status = "partial_success_attachments_pending";
          session.progress = 1;
          session.message = `Accela scrape partially complete for ${permitNumber}; Attachments downloads pending and retryable.`;
          console.log(
            `   ⚠️ Accela sync ended — session status set to partial_success_attachments_pending`,
          );
          await finalizeSessionScrapeJob("partial_success_attachments_pending");
          return;
        }
        if (prPending) {
          session.status = "partial_success_plan_review_pending";
          session.progress = 1;
          session.message = `Accela scrape partially complete for ${permitNumber}; Plan Review downloads pending and retryable.`;
          console.log(
            `   ⚠️ Accela sync ended — session status set to partial_success_plan_review_pending`,
          );
          await finalizeSessionScrapeJob("partial_success_plan_review_pending");
          return;
        }
        session.status = "done";
        session.progress = 1;
        mirrorSessionProgress(
          session,
          `Accela scrape complete for ${permitNumber}`,
          {
            event_type: "scrape_completed",
            stage: "completed",
            status: "completed",
            user_message: `Scrape completed for permit ${String(permitNumber).trim()}.`,
          },
        );
        console.log(
          `   ✅ Accela sync complete — session status set to "done"`,
        );
        await finalizeSessionScrapeJob("done");
      })
      .catch(async (err) => {
        const timedOutMsg = `${err && err.message ? err.message : err}`;
        const hadPrProgress =
          session.arlingtonPlanReviewCheckpointSaved === true ||
          session.arlingtonPlanReviewPartialPendingDownloads === true;
        const hadAttProgress =
          session.arlingtonAttachmentsCheckpointSaved === true ||
          session.arlingtonAttachmentsPartialPending === true;
        if (
          hadAttProgress &&
          /Accela scraping timed out/i.test(timedOutMsg)
        ) {
          session.status = "partial_success_attachments_pending";
          session.progress = 1;
          session.message = `Accela scrape partially complete for ${permitNumber}; Attachments downloads pending and retryable.`;
          console.warn(
            `   ⚠️ Accela scrape hit global timeout after Attachments progress — partial_success_attachments_pending`,
          );
          await finalizeSessionScrapeJob("partial_success_attachments_pending");
          return;
        }
        if (hadPrProgress && /Accela scraping timed out/i.test(timedOutMsg)) {
          session.status = "partial_success_plan_review_pending";
          session.progress = 1;
          session.message = `Accela scrape partially complete for ${permitNumber}; Plan Review downloads pending and retryable.`;
          console.warn(
            `   ⚠️ Accela scrape hit global timeout after Plan Review progress — partial_success_plan_review_pending`,
          );
          await finalizeSessionScrapeJob("partial_success_plan_review_pending");
          return;
        }
        session.status = "error";
        mirrorSessionProgress(session, `Error: ${timedOutMsg}`, {
          event_type: "scrape_failed",
          stage: "failed",
          status: "failed",
          user_message:
            scrapeEvents.mapTechnicalErrorToUserMessage(timedOutMsg) ||
            "The scrape could not be completed.",
        });
        console.error("❌ Accela scrape error:", timedOutMsg);
        await finalizeSessionScrapeJob("error");
      })
      .finally(() => {
        session._scrapeActive = false;
        session._activePlanReviewDownloads = 0;
        console.log(`[Session][scrape] active=false sid=${accelaSid} flow=accela`);
        rearmSessionIdleTimeout(accelaSid);
      });
    return;
  }

  if (session.portalSubtype === "pgc-eplan") {
    if (
      !String(session.username || "").trim() ||
      session.password == null ||
      String(session.password) === ""
    ) {
      return res.status(400).json({ error: "pgc_saved_portal_credentials_missing" });
    }
    console.log("[PGC] Credentials source: saved_portal_settings (session)");
    console.log("[PGC] Env credential fallback: disabled (server)");
    let targets;
    if (permitNumber != null && String(permitNumber).trim() !== "") {
      const permitNorm = String(permitNumber).trim();
      targets = session.projects.filter(
        (p) =>
          String(p.projectNum || "").trim() === permitNorm ||
          pgcEplan.pgcPermitKeysMatch(p.projectNum, permitNorm),
      );
      if (targets.length === 0) {
        const pgcOptsEarly = pgcPipelineOptsFromScrapeMode(scrapeMode || "all");
        const pgcFilesOnlyEarly =
          pgcOptsEarly.skipDetail &&
          !pgcOptsEarly.skipFiles &&
          pgcOptsEarly.skipReports &&
          pgcOptsEarly.skipWorkflow &&
          pgcOptsEarly.skipReview;
        if (pgcFilesOnlyEarly) {
          targets = [
            {
              id: permitNorm,
              projectId: "",
              projectNum: permitNorm,
              name: permitNorm,
              description: "",
              location: "",
              status: "",
            },
          ];
          console.log(
            `[PGC] Files Only scrape — no login session row for ${permitNorm}; will resolve on dashboard at scrape phase`,
          );
        } else {
          return res.status(404).json({
            error: "No project found matching permit number: " + permitNumber,
          });
        }
      }
    } else {
      const ids = Array.isArray(projectIds) ? projectIds : [];
      targets =
        ids.length > 0
          ? session.projects.filter((p) =>
              ids.some((pid) => String(pid) === String(p.id)),
            )
          : session.projects;
    }
    session.status = "scraping";
    session.total = targets.length;
    session.progress = 0;
    session.data = {};
    publishScrapeOrchestration(session, {
      stage: SCRAPE_STAGES.OPENING_PROJECT,
      event_type: "scrape_started",
      user_message: `Opening ${targets.length} PGC project(s).`,
      progress_current: 0,
      progress_total: targets.length,
      dedupeKey: "pgc_open",
      forceFeed: true,
    });
    res.json({
      message: "PGC ePlan scraping started",
      total: session.total,
      portalType: "projectdox",
      portalSubtype: "pgc-eplan",
      jobId: scrapeJobId,
    });
    scrapeLease.acquireScrapeLease(session, sessionId, rearmSessionIdleTimeout);
    scrapePgcAll(
      session,
      targets,
      sessionId,
      projectId,
      userId,
      scrapeMode || "all",
      {
        devHarvestControls: parsePgcDevHarvestControls(req.body?.devHarvestControls),
      },
    )
      .then((result) => {
        if (result?.cancelled) {
          session.status = "cancelled";
          return finalizeSessionScrapeJob("cancelled");
        }
        return finalizeSessionScrapeJob(
          result?.withWarnings ? "partial_success" : "done",
        );
      })
      .catch(async (err) => {
      session.status = "error";
      mirrorSessionProgress(session, `Error: ${err.message}`, {
        event_type: "scrape_failed",
        stage: "failed",
        status: "failed",
        user_message:
          scrapeEvents.mapTechnicalErrorToUserMessage(err.message) ||
          "The scrape could not be completed.",
      });
      console.error("❌ PGC scrape error:", err);
      await finalizeSessionScrapeJob("error");
      })
      .finally(() => {
        const releaseReason = session._cancelRequested
          ? "cancelled"
          : session.status === "error"
            ? "failed"
            : "completed";
        scrapeLease.releaseScrapeLease(
          session,
          sessionId,
          rearmSessionIdleTimeout,
          releaseReason,
        );
      });
    return;
  }

  if (session.portalSubtype === "montgomery-projectdox") {
    if (
      !String(session.username || "").trim() ||
      session.password == null ||
      String(session.password) === ""
    ) {
      return res.status(400).json({
        error: "montgomery_saved_portal_credentials_missing",
      });
    }
    let targets;
    if (permitNumber != null && String(permitNumber).trim() !== "") {
      targets = session.projects.filter(
        (p) =>
          String(p.projectNum || "").trim() === String(permitNumber).trim(),
      );
      if (targets.length === 0) {
        return res.status(404).json({
          error: "No project found matching permit number: " + permitNumber,
        });
      }
    } else {
      const ids = Array.isArray(projectIds) ? projectIds : [];
      targets =
        ids.length > 0
          ? session.projects.filter((p) =>
              ids.some((pid) => String(pid) === String(p.id)),
            )
          : session.projects;
    }
    session.status = "scraping";
    session.total = targets.length;
    session.progress = 0;
    session.data = {};
    publishScrapeOrchestration(session, {
      stage: SCRAPE_STAGES.OPENING_PROJECT,
      event_type: "scrape_started",
      user_message: `Opening ${targets.length} Montgomery project(s).`,
      progress_current: 0,
      progress_total: targets.length,
      dedupeKey: "montgomery_open",
      forceFeed: true,
    });
    res.json({
      message: "Montgomery ProjectDox scraping started",
      total: session.total,
      portalType: "projectdox",
      portalSubtype: "montgomery-projectdox",
      jobId: scrapeJobId,
    });
    scrapeMontgomeryAll(
      session,
      targets,
      sessionId,
      projectId,
      userId,
      scrapeMode || "montgomery_quick",
    )
      .then(() => finalizeSessionScrapeJob("done"))
      .catch(async (err) => {
      session.status = "error";
      mirrorSessionProgress(session, `Error: ${err.message}`, {
        event_type: "scrape_failed",
        stage: "failed",
        status: "failed",
        user_message:
          scrapeEvents.mapTechnicalErrorToUserMessage(err.message) ||
          "The scrape could not be completed.",
      });
      console.error("❌ Montgomery scrape error:", err);
      await finalizeSessionScrapeJob("error");
    });
    return;
  }

  if (session.portalSubtype === "howard-projectdox") {
    if (
      !String(session.username || "").trim() ||
      session.password == null ||
      String(session.password) === ""
    ) {
      return res.status(400).json({
        error: "howard_saved_portal_credentials_missing",
      });
    }
    let targetsHoward;
    if (permitNumber != null && String(permitNumber).trim() !== "") {
      targetsHoward = session.projects.filter(
        (p) =>
          String(p.projectNum || "").trim() === String(permitNumber).trim(),
      );
      if (targetsHoward.length === 0) {
        return res.status(404).json({
          error: "No project found matching permit number: " + permitNumber,
        });
      }
    } else {
      const ids = Array.isArray(projectIds) ? projectIds : [];
      targetsHoward =
        ids.length > 0
          ? session.projects.filter((p) =>
              ids.some((pid) => String(pid) === String(p.id)),
            )
          : session.projects;
    }
    session.status = "scraping";
    session.total = targetsHoward.length;
    session.progress = 0;
    session.data = {};
    publishScrapeOrchestration(session, {
      stage: SCRAPE_STAGES.OPENING_PROJECT,
      event_type: "scrape_started",
      user_message: `Opening ${targetsHoward.length} Howard project(s).`,
      progress_current: 0,
      progress_total: targetsHoward.length,
      dedupeKey: "howard_open",
      forceFeed: true,
    });
    res.json({
      message: "Howard ProjectDox scraping started",
      total: session.total,
      portalType: "projectdox",
      portalSubtype: "howard-projectdox",
      jobId: scrapeJobId,
    });
    const howardScrapeMode = scrapeMode || "howard_quick";
    console.log(
      `[api/scrape howard] scrapeMode=${JSON.stringify(scrapeMode)} effective=${JSON.stringify(howardScrapeMode)} omitTabs=${JSON.stringify(howardPipelineOptsFromScrapeMode(howardScrapeMode))}`,
    );
    scrapeHowardAll(
      session,
      targetsHoward,
      sessionId,
      projectId,
      userId,
      howardScrapeMode,
    )
      .then(() => finalizeSessionScrapeJob("done"))
      .catch(async (err) => {
      session.status = "error";
      mirrorSessionProgress(session, `Error: ${err.message}`, {
        event_type: "scrape_failed",
        stage: "failed",
        status: "failed",
        user_message:
          scrapeEvents.mapTechnicalErrorToUserMessage(err.message) ||
          "The scrape could not be completed.",
      });
      console.error("❌ Howard scrape error:", err);
      await finalizeSessionScrapeJob("error");
    });
    return;
  }

  // permitNumber takes priority over projectIds
  let targets;
  if (permitNumber != null && String(permitNumber).trim() !== "") {
    targets = session.projects.filter(
      (p) => String(p.projectNum || "").trim() === String(permitNumber).trim(),
    );
    if (targets.length === 0) {
      return res.status(404).json({
        error: "No project found matching permit number: " + permitNumber,
      });
    }
  } else {
    const ids = Array.isArray(projectIds) ? projectIds : [];
    targets =
      ids.length > 0
        ? session.projects.filter((p) =>
            ids.some((pid) => String(pid) === String(p.id)),
          )
        : session.projects;
  }

  const SCRAPE_MODE_TABS = {
    all: ["status", "files", "tasks", "info", "reports"],
    standard: ["status", "tasks", "info", "reports"],
    files: ["files"],
    /** Washington/general ProjectDox: intake expects Review Comments PDFs under tabs.reports (not Files-only). */
    comments: ["reports"],
    supporting_docs: ["files"],
  };

  if (scrapeMode && !SCRAPE_MODE_TABS[scrapeMode]) {
    return res.status(400).json({
      error: `Invalid scrapeMode: "${scrapeMode}". Valid modes: all, standard, files, comments, supporting_docs`,
    });
  }

  const validTabKeys = new Set(TAB_DEFS.map((t) => t.key));
  const rawTabs = Array.isArray(tabsParam) ? tabsParam : [];
  const tabsFromRequest = rawTabs
    .map((k) => String(k).trim())
    .filter((k) => validTabKeys.has(k));

  let tabsToUse;
  if (tabsFromRequest.length > 0) {
    tabsToUse = tabsFromRequest;
  } else if (scrapeMode && SCRAPE_MODE_TABS[scrapeMode]) {
    tabsToUse = SCRAPE_MODE_TABS[scrapeMode];
  } else {
    tabsToUse = TAB_DEFS.map((t) => t.key);
  }

  const commentsOnly = scrapeMode === "comments";
  const effectiveTargetFolder = scrapeMode === "supporting_docs" ? "supporting_docs" : (targetFolder || null);

  const effectiveTargetFolders =
    tabsToUse.includes("files") && Array.isArray(targetFoldersParam)
      ? [
          ...new Set(
            targetFoldersParam
              .map((x) => String(x).trim())
              .filter((x) =>
                GENERIC_PROJECTDOX_TARGET_FOLDER_KEYS.has(x),
              ),
          ),
        ]
      : [];

  const filesSyncTargetHint =
    effectiveTargetFolders.length > 0
      ? effectiveTargetFolders.join("|")
      : effectiveTargetFolder || null;

  const tabCount = TAB_DEFS.filter((t) => tabsToUse.includes(t.key)).length;
  session.status = "scraping";
  session.total = targets.length * tabCount;
  session.progress = 0;
  session.data = {};
  publishScrapeOrchestration(session, {
    stage: SCRAPE_STAGES.OPENING_PROJECT,
    event_type: "scrape_started",
    user_message: `Opening ${targets.length} project(s) across ${tabCount} section(s).`,
    progress_current: 0,
    progress_total: session.total,
    dedupeKey: "projectdox_open",
    forceFeed: true,
  });
  res.json({
    message: "Scraping started",
    total: session.total,
    scrapeMode: scrapeMode || "all",
    jobId: scrapeJobId,
  });
  scrapeAll(
    session,
    targets,
    sessionId,
    tabsToUse,
    projectId,
    userId,
    commentsOnly,
    effectiveTargetFolder,
    effectiveTargetFolders,
    filesSyncTargetHint,
  )
    .then(() => finalizeSessionScrapeJob("done"))
    .catch(async (err) => {
    session.status = "error";
    mirrorSessionProgress(session, `Error: ${err.message}`, {
      event_type: "scrape_failed",
      stage: "failed",
      status: "failed",
      user_message:
        scrapeEvents.mapTechnicalErrorToUserMessage(err.message) ||
        "The scrape could not be completed.",
    });
    console.error("❌", err);
    await finalizeSessionScrapeJob("error");
  });
});

const TAB_DEFS = [
  { key: "status", label: "Status", param: "projectStatusTab" },
  { key: "files", label: "Files", param: "filesTab" },
  { key: "tasks", label: "Tasks", param: "tasksTab" },
  { key: "info", label: "Info", param: "infoTab" },
  { key: "reports", label: "Reports", param: "reportsTab" },
];

/** Allowed `targetFolders` keys for generic ProjectDox (Washington) POST /api/scrape */
const GENERIC_PROJECTDOX_TARGET_FOLDER_KEYS = new Set([
  "supporting_docs",
  "drawings",
  "supporting_documents",
  "approved_drawings",
  "approved_supporting_documents",
]);

const { createPortalCredentialsRouter } = require("./routes/portal-credentials.routes.js");

const { createExportApiRouter } = require("./routes/export-api.routes.js");
app.use(
  createExportApiRouter({
    sessions,
    tabDefs: TAB_DEFS,
    scraperRoot: SCRAPER_ROOT,
  }),
);

app.use(createPortalCredentialsRouter({ supabase }));

const { createQuickBooksRouter } = require("./routes/quickbooks.routes.js");
app.use("/api/quickbooks", createQuickBooksRouter({ supabase }));

const { createDocumentsRouter } = require("./routes/documents.routes.js");
app.use("/api/documents", createDocumentsRouter(supabase));

const { createMicrosoftRouter } = require("./routes/microsoft.routes.js");
app.use("/api/microsoft", createMicrosoftRouter({ supabase }));

const { createUciRouter } = require("./routes/uci.routes.js");
app.use("/api/uci", createUciRouter({ supabase }));

function isMontgomeryPortalSubtypePayload(data) {
  return (
    data &&
    typeof data === "object" &&
    data.portalSubtype === "montgomery-projectdox"
  );
}

function montgomeryDebugPortalDataStructuralSummary(pd) {
  if (!pd || typeof pd !== "object") {
    return { error: "portal_data missing or not an object" };
  }
  const tabs = pd.tabs && typeof pd.tabs === "object" ? pd.tabs : null;
  const tabKeys = tabs ? Object.keys(tabs) : [];
  return {
    portalType: pd.portalType,
    portalSubtype: pd.portalSubtype,
    topLevelKeys: Object.keys(pd),
    tabsKeys: tabKeys,
    tabsInfo: tabs ? tabs.info : "(tabs.info missing)",
    tabsStatus: tabs ? tabs.status : "(tabs.status missing)",
    tabsTasks: tabs ? tabs.tasks : "(tabs.tasks missing)",
    tabsReports: tabs ? tabs.reports : "(tabs.reports missing)",
  };
}

/** Long strings (e.g. report PDF text) truncated in debug JSON only. */
function stringifyMontgomeryPortalDataForDebugLog(data) {
  return JSON.stringify(
    data,
    (key, value) => {
      if (key === "text" && typeof value === "string" && value.length > 4000) {
        return `[truncated len=${value.length}] ${value.slice(0, 240)}…`;
      }
      if (key === "screenshot" && typeof value === "string" && value.length > 200) {
        return `[screenshot base64 len=${value.length}]`;
      }
      return value;
    },
    2,
  );
}

function logMontgomeryDebugInfoDupTabs(infoTab, phase) {
  console.log(`[Montgomery][debug][info-dup] phase=${phase}`);
  if (!infoTab || typeof infoTab !== "object") {
    console.log("[Montgomery][debug][info-dup] tabs.info missing or not object");
    return;
  }
  const pi = infoTab.projectInfo;
  const kv = infoTab.keyValues;
  const tbls = infoTab.tables;
  const piN = Array.isArray(pi) ? pi.length : 0;
  const kvN = Array.isArray(kv) ? kv.length : 0;
  const tbN = Array.isArray(tbls) ? tbls.length : 0;
  console.log(
    `[Montgomery][debug][info-dup] counts projectInfo=${piN} keyValues=${kvN} tables=${tbN}`,
  );
  (tbls || []).forEach((t, i) => {
    const hdrs = Array.isArray(t?.headers) ? t.headers : [];
    const rc = Array.isArray(t?.rows) ? t.rows.length : 0;
    console.log(
      `[Montgomery][debug][info-dup] tables[${i}] headers=${JSON.stringify(hdrs)} rowCount=${rc} origin=DOM pairs in extractMontgomeryInfoTab → normalizeMontgomeryInfoPairs → buildMontgomeryInfoFieldValueTable (synthesized Field/Value table, not a second DOM scrape)`,
    );
  });
  console.log(
    "[Montgomery][debug][info-dup] mapper: mapMontgomeryPipelineToPortalData sets tabs.info.projectInfo and tabs.info.keyValues as the SAME pairs (duplicate arrays) plus tabs.info.tables from scraper.",
  );
  console.log(
    "[Montgomery][debug][info-dup] UI (PortalDataViewer, non-PGC): renders Project Info from tabs.info.projectInfo when displayProjectInfo.length>0 AND also renders filteredInfoTables — both can show the same logical fields → duplicate display.",
  );
  console.log(
    "[Montgomery][debug][info-dup] UI: tabs.info.keyValues block only renders when displayProjectInfo.length===0, so keyValues vs projectInfo is usually mutually exclusive; duplication is projectInfo/table overlap.",
  );
}

function logMontgomeryDebugStatusDupTabs(statusTab, phase) {
  console.log(`[Montgomery][debug][status-dup] phase=${phase}`);
  if (!statusTab || typeof statusTab !== "object") {
    console.log("[Montgomery][debug][status-dup] tabs.status missing or not object");
    return;
  }
  const kvc = Array.isArray(statusTab.keyValues) ? statusTab.keyValues.length : 0;
  const tbc = Array.isArray(statusTab.tables) ? statusTab.tables.length : 0;
  const lkc = Array.isArray(statusTab.links) ? statusTab.links.length : 0;
  console.log(
    `[Montgomery][debug][status-dup] counts keyValues=${kvc} tables=${tbc} links=${lkc}`,
  );
  (statusTab.tables || []).forEach((t, i) => {
    const hdrs = Array.isArray(t?.headers) ? t.headers : [];
    const rc = Array.isArray(t?.rows) ? t.rows.length : 0;
    console.log(
      `[Montgomery][debug][status-dup] tables[${i}] headers=${JSON.stringify(hdrs)} rowCount=${rc} origin=synthesized in extractMontgomeryStatusTab from filtered keyValues (Field/Value), same source as keyValues array`,
    );
  });
  const sampleLink = (statusTab.links || [])[0];
  console.log(
    `[Montgomery][debug][status-dup] links sample: text=${JSON.stringify(sampleLink?.text ?? "")} hrefLen=${String(sampleLink?.href ?? "").length} hasOnclick=${!!(sampleLink?.onclick && String(sampleLink.onclick).trim())} hasResolved=${!!(sampleLink?.resolvedViewerUrl && String(sampleLink.resolvedViewerUrl).trim())}`,
  );
  console.log(
    "[Montgomery][debug][status-dup] UI (PortalDataViewer, non-PGC): renders BOTH keyValues block AND tables block with no mutual exclusion → duplicate rows when both non-empty.",
  );
}

function logMontgomeryDebugPreSync(tag, portalDataPayload) {
  console.log(`[Montgomery][debug][pre-sync] ${tag} — compact structural summary:`);
  console.log(
    JSON.stringify(
      montgomeryDebugPortalDataStructuralSummary(portalDataPayload),
      null,
      2,
    ),
  );
  console.log(`[Montgomery][debug][pre-sync] ${tag} — full portal_data (truncated long text fields):`);
  console.log(stringifyMontgomeryPortalDataForDebugLog(portalDataPayload));
  if (isMontgomeryPortalSubtypePayload(portalDataPayload)) {
    logMontgomeryDebugInfoDupTabs(portalDataPayload.tabs?.info, `pre-sync:${tag}`);
    logMontgomeryDebugStatusDupTabs(portalDataPayload.tabs?.status, `pre-sync:${tag}`);
  }
}

function logMontgomeryDebugPostSyncReadback(verifyRow) {
  const pd = verifyRow?.portal_data;
  console.log(
    `[Montgomery][debug][post-sync-readback] projects.id=${verifyRow?.id} — compact:`,
  );
  console.log(JSON.stringify(montgomeryDebugPortalDataStructuralSummary(pd), null, 2));
  console.log(
    `[Montgomery][debug][post-sync-readback] projects.id=${verifyRow?.id} — full portal_data from DB (truncated long text):`,
  );
  console.log(stringifyMontgomeryPortalDataForDebugLog(pd));
  if (isMontgomeryPortalSubtypePayload(pd)) {
    logMontgomeryDebugInfoDupTabs(pd.tabs?.info, "post-readback-db");
    logMontgomeryDebugStatusDupTabs(pd.tabs?.status, "post-readback-db");
  }
}

/**
 * How report popup screenshots are persisted on `portal_data.tabs.reports.pdfs[].screenshot`.
 * - full: full-page PNG base64 (large; use for local debugging)
 * - thumbnail: downscaled PNG via sharp (default; reduces JSONB UPDATE size)
 * - off: omit screenshot (PortalDataViewer falls back to pdf.text)
 *
 * Env: EPERMIT_REPORT_SCREENSHOT_MODE
 */
function getReportScreenshotMode() {
  const m = String(process.env.EPERMIT_REPORT_SCREENSHOT_MODE || "thumbnail")
    .trim()
    .toLowerCase();
  if (m === "full" || m === "thumbnail" || m === "off") return m;
  return "thumbnail";
}

let _sharpLoadFailed = false;
function tryRequireSharp() {
  if (_sharpLoadFailed) return null;
  try {
    return require("sharp");
  } catch (_) {
    _sharpLoadFailed = true;
    return null;
  }
}

const DEFAULT_REPORT_SCREENSHOT_MAX_B64_CHARS = 700000;

/**
 * @param {Buffer} pngBuffer
 * @returns {Promise<string>} base64 PNG (no data: prefix) or ""
 */
async function normalizeReportScreenshotBufferForPortalData(pngBuffer) {
  const mode = getReportScreenshotMode();
  if (mode === "off" || !pngBuffer || !pngBuffer.length) return "";
  if (mode === "full") return pngBuffer.toString("base64");
  const sharp = tryRequireSharp();
  if (!sharp) {
    console.warn(
      "[ReportScreenshot] mode=thumbnail requires sharp; npm install sharp in scraper-service, or set EPERMIT_REPORT_SCREENSHOT_MODE=full|off",
    );
    return "";
  }
  try {
    const out = await sharp(pngBuffer)
      .resize({
        width: 520,
        height: 20000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const b64 = out.toString("base64");
    console.log(
      `[ReportScreenshot] thumbnail: ${Math.round(pngBuffer.length / 1024)}KB png in -> ${Math.round(b64.length / 1024)}KB base64 out`,
    );
    return b64;
  } catch (e) {
    console.warn("[ReportScreenshot] thumbnail resize failed:", e.message);
    return "";
  }
}

/**
 * PGC / Montgomery pipelines pass through base64 from their scrapers; apply same mode as Washington.
 * @param {string} base64Png
 * @returns {Promise<string>}
 */
async function normalizeReportScreenshotBase64StringForPortalData(base64Png) {
  const mode = getReportScreenshotMode();
  if (mode === "off" || !base64Png || String(base64Png).length < 32) return "";
  const raw = String(base64Png).trim();
  if (mode === "full") return raw;
  try {
    const buf = Buffer.from(raw, "base64");
    return await normalizeReportScreenshotBufferForPortalData(buf);
  } catch (e) {
    console.warn("[ReportScreenshot] base64 decode failed:", e.message);
    return "";
  }
}

/** Drop unused SSRS html and oversized screenshots before Supabase write (defensive). */
function stripOversizedReportPdfPayloadFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  if (out.tabs?.reports?.pdfs && Array.isArray(out.tabs.reports.pdfs)) {
    const maxB64 = Number(
      process.env.EPERMIT_REPORT_SCREENSHOT_MAX_B64_CHARS ||
        DEFAULT_REPORT_SCREENSHOT_MAX_B64_CHARS,
    );
    out.tabs = {
      ...out.tabs,
      reports: {
        ...out.tabs.reports,
        pdfs: out.tabs.reports.pdfs.map((p) => {
          if (!p || typeof p !== "object") return p;
          const q = { ...p };
          if (Object.prototype.hasOwnProperty.call(q, "html")) {
            delete q.html;
          }
          if (typeof q.screenshot === "string" && q.screenshot.length > maxB64) {
            console.warn(
              `[ReportScreenshot] dropping oversized screenshot (${Math.round(q.screenshot.length / 1024)}KB base64) for ${q.fileName || "report"}`,
            );
            delete q.screenshot;
          }
          return q;
        }),
      },
    };
  }
  return out;
}

function stripPortalSyncTransientFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const o = { ...obj };
  delete o.portalFilesScrapeStatus;
  delete o.portalFilesScrapeLabel;
  return stripOversizedReportPdfPayloadFields(o);
}

/**
 * @returns {Promise<boolean>} true if every project row was written or safely skipped; false if any DB error.
 */
async function syncPortalDataToSupabase(
  session,
  projects,
  supabaseProjectId,
  userId,
  targetFolder = null,
  syncOptions = {},
) {
  const preserveFilesTabFromDb = syncOptions.preserveFilesTabFromDb === true;
  let syncOk = true;
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const projectNum = project.projectNum;
    const currentData = session.data[project.id];
    if (!currentData) continue;
    let actualProjectId = null;

    const newHash = hashPortalData(stripPortalSyncTransientFields(currentData));

    try {
      if (isMontgomeryPortalSubtypePayload(currentData)) {
        logMontgomeryDebugPreSync(
          `session.data scrape output (before DB merge/write) permit=${projectNum}`,
          currentData,
        );
      }

      console.log(`    🔄 Syncing ${projectNum} to Supabase...`);
      console.log(
        `    📌 projectId=${supabaseProjectId || "(none)"}, userId=${userId}, portalType=${currentData.portalType || "(none)"}`,
      );

      let existingRow = null;
      if (supabaseProjectId) {
        const { data: rows } = await supabase
          .from("projects")
          .select("id, portal_data_hash, portal_data")
          .eq("id", supabaseProjectId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
      }
      if (!existingRow) {
        const { data: rows } = await supabase
          .from("projects")
          .select("id, portal_data_hash, portal_data")
          .eq("permit_number", projectNum)
          .eq("user_id", userId);
        existingRow = rows && rows.length > 0 ? rows[0] : null;
      }

      if (existingRow && existingRow.portal_data_hash === newHash) {
        actualProjectId = existingRow.id;
        console.log(
          `    ⏭️  Data unchanged for ${projectNum} (hash match), skipping update for row ${actualProjectId}`,
        );
        if (isMontgomeryPortalSubtypePayload(currentData)) {
          console.log(
            `[Montgomery][debug][pre-sync] HASH MATCH — portal_data column not updated (only last_checked_at); scraped payload was logged above`,
          );
        }
        const { error: touchErr } = await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", actualProjectId);
        if (touchErr) {
          console.error(
            "    ❌ Supabase error (last_checked_at touch):",
            touchErr.message,
            touchErr.details,
          );
          syncOk = false;
          continue;
        }
      } else if (existingRow) {
        let mergedData = currentData;
        if (
          existingRow.portal_data &&
          existingRow.portal_data.tabs &&
          currentData.tabs
        ) {
          const existingTabs = existingRow.portal_data.tabs;
          const newTabs = currentData.tabs;

          if (
            newTabs.files &&
            existingTabs.files &&
            (targetFolder || currentData.portalFilesScrapeStatus === "in_progress")
          ) {
            const existingFolders = existingTabs.files.folders || [];
            const newFolders = newTabs.files.folders || [];
            const newFolderNames = new Set(newFolders.map((f) => f.name));
            const keptFolders = existingFolders.filter(
              (f) => !newFolderNames.has(f.name),
            );
            const mergedFolders = [...keptFolders, ...newFolders];
            newTabs.files = {
              ...existingTabs.files,
              ...newTabs.files,
              folders: mergedFolders,
            };
            console.log(
              `    🔀 Folder-level merge: kept [${keptFolders.map((f) => f.name).join(", ")}], updated [${[...newFolderNames].join(", ")}]`,
            );
          }

          const merged = { ...existingTabs, ...newTabs };
          if (preserveFilesTabFromDb && existingTabs.files) {
            merged.files = existingTabs.files;
            console.log(
              `    🔒 Preserving tabs.files from database (file reconcile already applied)`,
            );
          }
          if (
            (currentData.portalSubtype === "montgomery-projectdox" ||
              currentData.portalSubtype === "howard-projectdox") &&
            merged.status &&
            existingTabs.status
          ) {
            const ns = merged.status;
            const es = existingTabs.status;
            const newStatusEmpty =
              (!Array.isArray(ns.keyValues) || ns.keyValues.length === 0) &&
              (!Array.isArray(ns.links) || ns.links.length === 0) &&
              (!Array.isArray(ns.tables) || ns.tables.length === 0);
            const oldStatusHas =
              (Array.isArray(es.keyValues) && es.keyValues.length > 0) ||
              (Array.isArray(es.links) && es.links.length > 0) ||
              (Array.isArray(es.tables) && es.tables.length > 0);
            if (newStatusEmpty && oldStatusHas) {
              merged.status = JSON.parse(JSON.stringify(es));
              console.log(
                "[ProjectDox-MD][status] merge kept existing tabs.status (new scrape had empty status)",
              );
            }
          }
          mergedData = {
            ...existingRow.portal_data,
            ...currentData,
            tabs: merged,
          };
          const keptKeys = Object.keys(existingTabs).filter((k) => !newTabs[k]);
          if (keptKeys.length > 0) {
            console.log(
              `    🔀 Merged tabs: kept existing [${keptKeys.join(", ")}], updated [${Object.keys(newTabs).join(", ")}]`,
            );
          }
        }
        const mergedForDb = stripPortalSyncTransientFields(mergedData);
        const mergedHash = hashPortalData(mergedForDb);
        actualProjectId = existingRow.id;
        const portalStatusResolved =
          currentData.portalFilesScrapeStatus === "in_progress"
            ? currentData.portalFilesScrapeLabel || "Partial"
            : currentData.dashboardStatus ||
              mergedForDb.dashboardStatus ||
              "Scraped";
        const updatePayload = {
          portal_status: portalStatusResolved,
          last_checked_at: new Date().toISOString(),
          portal_data: mergedForDb,
          portal_data_hash: mergedHash,
          permit_number: projectNum,
        };

        if (isMontgomeryPortalSubtypePayload(mergedForDb)) {
          logMontgomeryDebugPreSync(
            `exact portal_data for DB UPDATE row id=${actualProjectId} permit=${projectNum}`,
            mergedForDb,
          );
        }

        console.log(
          `    📝 DB WRITE: supabaseProjectId=${supabaseProjectId || "(none)"}, permit=${projectNum}, portalType=${mergedData.portalType || "(none)"}, targetRow=${actualProjectId}`,
        );

        const { data, error } = await supabase
          .from("projects")
          .update(updatePayload)
          .eq("id", actualProjectId)
          .select("id, portal_data");

        if (error) {
          console.error("    ❌ Supabase error:", error.message, error.details);
          syncOk = false;
          continue;
        }

        if (data && Array.isArray(data) && data.length > 0) {
          const writtenType = data[0].portal_data?.portalType || "(none)";
          console.log(
            `    ✅ Updated project row=${data[0].id}, written portalType=${writtenType}`,
          );
        }
      } else {
        if (!userId) {
          console.error("    ❌ Cannot create project: userId not provided");
          syncOk = false;
          continue;
        }
        if (isMontgomeryPortalSubtypePayload(currentData)) {
          logMontgomeryDebugPreSync(
            `exact portal_data for DB INSERT (new project) permit=${projectNum}`,
            currentData,
          );
        }
        const insertPortalStatus =
          currentData.portalFilesScrapeStatus === "in_progress"
            ? currentData.portalFilesScrapeLabel || "Partial"
            : currentData.dashboardStatus || "Unknown";
        const insertPd = stripPortalSyncTransientFields(currentData);
        const { data: created, error: createError } = await supabase
          .from("projects")
          .insert({
            user_id: userId,
            name: currentData.projectNum || projectNum,
            permit_number: projectNum,
            description: currentData.description || "",
            address: currentData.location || "",
            jurisdiction: currentData.jurisdiction || "Washington DC",
            status: "draft",
            portal_status: insertPortalStatus,
            last_checked_at: new Date().toISOString(),
            portal_data: insertPd,
            portal_data_hash: newHash,
          })
          .select("id, portal_data");
        if (createError) {
          console.error(
            "    ❌ Supabase create error:",
            createError.message,
            createError.details,
          );
          syncOk = false;
          continue;
        }
        if (created && created.length > 0) {
          actualProjectId = created[0].id;
          const writtenType = created[0].portal_data?.portalType || "(none)";
          console.log(
            `    📝 Created new project row=${actualProjectId}, written portalType=${writtenType}`,
          );
        }
      }

      if (actualProjectId) {
        const { data: verify } = await supabase
          .from("projects")
          .select("id, permit_number, credential_id, portal_data")
          .eq("id", actualProjectId)
          .maybeSingle();
        if (verify) {
          console.log(
            `    🔍 DB verify: row=${verify.id}, permit=${verify.permit_number}, credential=${verify.credential_id || "(none)"}, portalType=${verify.portal_data?.portalType || "(none)"}`,
          );
          if (isMontgomeryPortalSubtypePayload(currentData)) {
            logMontgomeryDebugPostSyncReadback(verify);
          }
        }
      }

      if (actualProjectId) {
        const { error: credErr } = await supabase
          .from("portal_credentials")
          .update({ project_id: actualProjectId, permit_number: projectNum })
          .or(
            `project_id.eq.${actualProjectId},permit_number.eq.${projectNum}`,
          );
        if (credErr) {
          console.warn(
            "    ⚠️ Could not update portal_credentials project_id:",
            credErr.message,
          );
        }
      }
    } catch (dbErr) {
      console.error("    ❌ DB Error:", dbErr.message);
      syncOk = false;
    }
  }
  return syncOk;
}

function dedupeFilesByFileId(files) {
  const m = new Map();
  for (const fi of files || []) {
    const k =
      fi.fileId != null && String(fi.fileId) !== ""
        ? String(fi.fileId)
        : `${fi.name || ""}|${fi.folderName || ""}`;
    m.set(k, fi);
  }
  return [...m.values()];
}

function buildFilesFoldersSnapshotForSync(resultFolders, currentFolderName, currentFolderFiles) {
  const folders = (resultFolders || []).map((f) => ({
    ...f,
    files: dedupeFilesByFileId(f.files || []),
  }));
  if (currentFolderName && Array.isArray(currentFolderFiles)) {
    folders.push({
      name: currentFolderName,
      fileCount: currentFolderFiles.length,
      files: dedupeFilesByFileId(currentFolderFiles),
    });
  }
  return folders;
}

function countFilesInFoldersSnapshot(folders) {
  return (folders || []).reduce((s, f) => s + (f.files?.length || 0), 0);
}

async function pushFilesTabProgressToSupabase(
  session,
  projects,
  project,
  supabaseProjectId,
  userId,
  targetFolder,
  foldersSnapshot,
  logCtx,
) {
  if (!supabaseProjectId || !userId || !project) return;
  const pid = project.id;
  const prev =
    (session.data[pid] && session.data[pid].tabs && session.data[pid].tabs.files) || {};
  session.data[pid].tabs.files = {
    ...prev,
    folders: foldersSnapshot,
    filesScrapeStatus: logCtx?.filesScrapeStatus || "in_progress",
  };
  session.data[pid].portalFilesScrapeStatus = "in_progress";
  session.data[pid].portalFilesScrapeLabel = "Partial";
  const total = countFilesInFoldersSnapshot(foldersSnapshot);
  session._filesTabIncrementalTotalSynced = total;
  const trigger = logCtx?.trigger || "batch";
  const batchSize = logCtx?.batchSize ?? 0;
  const folderName = logCtx?.folderName || "(n/a)";
  console.log(
    `[Files][incremental-sync] triggered | trigger=${trigger} batchSize=${batchSize} folder="${folderName}" totalFilesInSnapshot=${total} project=${project.projectNum}`,
  );
  const syncOk = await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    targetFolder,
  );
  if (!syncOk) {
    console.error(
      "    ❌ Supabase sync failed during incremental files update (portal_data may be unchanged)",
    );
  }
  if (logCtx?.clearScrapeFlagsAfter) {
    session.data[pid].portalFilesScrapeStatus = null;
    session.data[pid].portalFilesScrapeLabel = null;
  }
}

const MAX_PGC_REPORT_PDF_TEXT_CHARS = 800_000;

function isPgcReviewCommentsReportName(reportName) {
  const n = String(reportName || "").toLowerCase();
  return (
    n.includes("review comments") &&
    !n.includes("review details") &&
    !n.includes("routing slip")
  );
}

/**
 * Shared SSRS Review Comments Excel → portal_data `structuredRows` (local file, then URL fallback).
 * Does not download, upload, or delete files — callers own I/O.
 * @param {object} opts
 * @param {object} opts.pdfEntry
 * @param {string} [opts.reportName]
 * @param {string} [opts.localExcelPath]
 * @param {string} [opts.excelUrl]
 * @param {string} [opts.logTag]
 */
async function attachReviewCommentsStructuredRowsToPdfEntry({
  pdfEntry,
  reportName,
  localExcelPath,
  excelUrl,
  logTag = "ReviewComments",
}) {
  const fileName = String(reportName || pdfEntry?.fileName || "");
  if (!pdfEntry || !isPgcReviewCommentsReportName(fileName)) {
    return { rowCount: 0, skipped: true, reason: "not_review_comments_report" };
  }

  const localPath = String(localExcelPath || "").trim();
  const url = String(excelUrl || "").trim();
  const localExcelExists = !!(localPath && fs.existsSync(localPath));

  if (!localExcelExists && !/^https:\/\//i.test(url)) {
    console.log(
      `[${logTag}][reports][excel-structured] skipped report=${JSON.stringify(fileName)} reason=no_excel_source`,
    );
    return { rowCount: 0, skipped: true, reason: "no_excel_source" };
  }

  /** @type {Array<{ ref: string; cycle: string; reviewed_by: string; type: string; filename: string; discussion: string; status: string }>} */
  let structuredRowsResult = [];
  let extractionSource = null;
  try {
    if (localExcelExists) {
      extractionSource = "local_file";
      structuredRowsResult =
        await extractReviewCommentsStructuredRowsFromExcelFile(localPath);
    }
    if (
      (!structuredRowsResult || structuredRowsResult.length === 0) &&
      /^https:\/\//i.test(url)
    ) {
      extractionSource = extractionSource || "url_fallback";
      const xBuf = await fetchUrlToBuffer(url);
      structuredRowsResult =
        await extractReviewCommentsStructuredRowsFromExcelBuffer(xBuf);
    }
  } catch (e) {
    console.warn(
      `[${logTag}][reports][excel-structured] parse failed report=${JSON.stringify(fileName)}`,
      (e && e.message) || e,
    );
    return { rowCount: 0, error: (e && e.message) || String(e) };
  }

  const rowCount = Array.isArray(structuredRowsResult)
    ? structuredRowsResult.length
    : 0;
  const refs = (structuredRowsResult ?? [])
    .map((r) => String(r?.ref ?? "").trim())
    .filter(Boolean);

  if (rowCount > 0) {
    pdfEntry.structuredRows = structuredRowsResult;
    pdfEntry.structuredRowsSource = "excel";
    console.log(
      `[${logTag}][reports][excel-structured] attached report=${JSON.stringify(fileName)} source=${extractionSource} rowCount=${rowCount} refs_first_5=${JSON.stringify(refs.slice(0, 5))}`,
    );
  } else {
    console.log(
      `[${logTag}][reports][excel-structured] no rows report=${JSON.stringify(fileName)} source=${extractionSource || "none"} localExcel=${localExcelExists} excelUrl=${url ? "yes" : "no"}`,
    );
  }

  return { rowCount, refs, extractionSource };
}

function capPgcReportText(text) {
  let t = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (t.length > MAX_PGC_REPORT_PDF_TEXT_CHARS) {
    t = t.slice(0, MAX_PGC_REPORT_PDF_TEXT_CHARS) + "\n\n[truncated]";
  }
  return t;
}

async function fetchUrlToBuffer(url) {
  const res = await fetch(String(url).trim(), {
    redirect: "follow",
    headers: { "User-Agent": "EpermitScraper/1.0" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * @param {Buffer} buf
 * @returns {Promise<{ text: string, numpages: number, parseError: string | null }>}
 */
async function extractTextFromPgcExportedPdfBuffer(buf) {
  if (!buf || !buf.length) {
    return { text: "", numpages: 0, parseError: null };
  }

  // pdfjs-dist v4 is ESM-only; use the legacy CJS build for Node.
  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } catch (e) {
    console.warn(
      "[PGC] pdfjs-dist require failed:",
      (e && e.message) || e,
    );
    return { text: "", numpages: 0, parseError: "pdfjs-dist unavailable" };
  }

  try {
    // pdfjs-dist expects a Uint8Array, not a Node Buffer.
    const uint8 = new Uint8Array(
      buf.buffer,
      buf.byteOffset,
      buf.byteLength,
    );
    const loadingTask = pdfjs.getDocument({
      data: uint8,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    const numpages = pdf.numPages;

    const X_GAP_TAB_THRESHOLD = 8;
    const Y_LINE_TOLERANCE = 2;

    const pageTexts = [];

    for (let pageNum = 1; pageNum <= numpages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const byY = new Map();
      for (const item of content.items) {
        if (!item || typeof item.str !== "string") continue;
        if (!item.str.length) continue;
        const y =
          Math.round(item.transform[5] / Y_LINE_TOLERANCE) *
          Y_LINE_TOLERANCE;
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({
          x: item.transform[4],
          width: item.width || 0,
          str: item.str,
        });
      }

      const ySorted = Array.from(byY.keys()).sort((a, b) => b - a);

      const lineStrings = [];
      for (const y of ySorted) {
        const items = byY.get(y).sort((a, b) => a.x - b.x);
        let lineStr = "";
        let prevEndX = null;
        for (const it of items) {
          if (prevEndX === null) {
            lineStr = it.str;
          } else {
            const gap = it.x - prevEndX;
            if (gap >= X_GAP_TAB_THRESHOLD) {
              lineStr += "\t" + it.str;
            } else if (gap > 0) {
              lineStr +=
                /\s$/.test(lineStr) || /^\s/.test(it.str)
                  ? it.str
                  : " " + it.str;
            } else {
              lineStr += it.str;
            }
          }
          prevEndX = it.x + (it.width || 0);
        }
        if (lineStr.trim().length) lineStrings.push(lineStr);
      }

      pageTexts.push(lineStrings.join("\n"));

      try {
        page.cleanup();
      } catch (_) {}
    }

    try {
      await pdf.destroy();
    } catch (_) {}

    const raw = pageTexts.join("\n\n");
    const text = capPgcReportText(raw);

    console.log(
      `[PGC] pdfjs extract ok pages=${numpages} rawLen=${raw.length} cappedLen=${text.length}`,
    );

    return { text, numpages, parseError: null };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn("[PGC] pdfjs-dist buffer extract failed:", msg);
    return { text: "", numpages: 0, parseError: msg };
  }
}

/**
 * Read plain text from a locally exported PGC report PDF for portal_data.tabs.reports.pdfs[].text
 * (Washington / comment-parser-agent compatible).
 * @param {string} pdfPath
 * @returns {Promise<{ text: string, numpages: number, parseError: string | null }>}
 */
async function extractTextFromPgcExportedPdf(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return { text: "", numpages: 0, parseError: null };
  }
  return extractTextFromPgcExportedPdfBuffer(fs.readFileSync(pdfPath));
}

/**
 * SSRS Excel export often has extractable text when PDF text layer is empty.
 * @param {Buffer} buf
 */
async function extractTextFromPgcExcelBuffer(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const lines = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const vals = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v == null) return;
        const s =
          typeof v === "object" && v != null && "text" in v
            ? String(v.text)
            : String(v);
        const t = s.replace(/\s+/g, " ").trim();
        if (t) vals.push(t);
      });
      if (vals.length) lines.push(vals.join("\t"));
    });
  });
  return capPgcReportText(lines.join("\n"));
}

async function extractTextFromPgcExcelFile(excelPath) {
  if (!excelPath || !fs.existsSync(excelPath)) return "";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const lines = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const vals = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v == null) return;
        const s =
          typeof v === "object" && v != null && "text" in v
            ? String(v.text)
            : String(v);
        const t = s.replace(/\s+/g, " ").trim();
        if (t) vals.push(t);
      });
      if (vals.length) lines.push(vals.join("\t"));
    });
  });
  return capPgcReportText(lines.join("\n"));
}

/**
 * Best-effort text for reports.pdfs[] (local PDF → public PDF URL → Excel for Review Comments).
 * @param {object} r — raw report from PGC pipeline
 */
async function buildPgcReportPdfEntryText(r) {
  let text = "";
  let numpages = 0;
  let parseError = null;

  if (r.pdfPath && fs.existsSync(r.pdfPath)) {
    const ex = await extractTextFromPgcExportedPdf(r.pdfPath);
    text = ex.text;
    numpages = ex.numpages;
    parseError = ex.parseError;
  }

  if (!String(text).trim() && r.pdfPublicUrl) {
    try {
      const buf = await fetchUrlToBuffer(r.pdfPublicUrl);
      const ex = await extractTextFromPgcExportedPdfBuffer(buf);
      if (String(ex.text).trim()) {
        text = ex.text;
        numpages = ex.numpages;
        parseError = null;
      }
    } catch (e) {
      console.warn(
        "[PGC] fetch PDF for text extract failed:",
        (e && e.message) || e,
      );
    }
  }

  if (!String(text).trim() && r._montgomeryAllowViewerHttpText) {
    const base = String(r.viewUrl || r.reportUrl || "").trim();
    if (base && /ReportViewer\.aspx/i.test(base)) {
      const pdfGet = pgcEplan.pgcReportViewerUrlWithFormat(base, "PDF");
      try {
        const buf = await fetchUrlToBuffer(pdfGet);
        const ex = await extractTextFromPgcExportedPdfBuffer(buf);
        if (String(ex.text).trim()) {
          text = ex.text;
          numpages = ex.numpages;
          parseError = null;
        }
      } catch (_) {
        /* Needs portal session cookies; scraper-local pdfPath / uploads are authoritative */
      }
      if (!String(text).trim()) {
        const xlGet = pgcEplan.pgcReportViewerUrlWithFormat(base, "EXCELOPENXML");
        try {
          const xbuf = await fetchUrlToBuffer(xlGet);
          const xt = await extractTextFromPgcExcelBuffer(xbuf);
          if (String(xt).trim()) {
            text = xt;
            parseError = null;
          }
        } catch (_) {}
      }
    }
  }

  if (!String(text).trim() && isPgcReviewCommentsReportName(r.reportName)) {
    if (r.excelPath && fs.existsSync(r.excelPath)) {
      try {
        const xt = await extractTextFromPgcExcelFile(r.excelPath);
        if (String(xt).trim()) {
          text = xt;
          parseError = null;
        }
      } catch (e) {
        console.warn(
          "[PGC] Excel local text extract failed:",
          (e && e.message) || e,
        );
      }
    }
    if (!String(text).trim() && r.excelPublicUrl) {
      try {
        const xbuf = await fetchUrlToBuffer(r.excelPublicUrl);
        const xt = await extractTextFromPgcExcelBuffer(xbuf);
        if (String(xt).trim()) {
          text = xt;
          parseError = null;
        }
      } catch (e) {
        console.warn(
          "[PGC] fetch Excel for text extract failed:",
          (e && e.message) || e,
        );
      }
    }
  }

  return { text, numpages, parseError };
}

async function mapPgcPipelineToPortalData(projectRow, pipelineResult) {
  const detail = pipelineResult.detailResult?.out;
  const info = detail?.info;
  const projectInfo = [];
  const infoTables = Array.isArray(info?.tables) ? info.tables : [];
  if (info) {
    const add = (k, v) => {
      if (v != null) projectInfo.push({ key: k, value: String(v) });
    };
    if (Array.isArray(info.projectInfo) && info.projectInfo.length) {
      info.projectInfo.forEach((kv) =>
        projectInfo.push({
          key: String(kv.key ?? kv.label ?? ""),
          value: String(kv.value ?? ""),
        }),
      );
    } else {
      add("Project #", info.projectNumber);
      add("Case name", info.caseName);
      add("Location", info.location);
      add("Case type", info.caseType);
      add("Contact email", info.contactEmail);
      add("Status", info.status);
      add("Project start", info.projectStart);
      add("Project end", info.projectEnd);
    }
  }

  const statusTab = detail?.statusTab;
  const statusKeyValues = Array.isArray(statusTab?.keyValues)
    ? statusTab.keyValues.map((kv) => ({
        key: String(kv.key ?? ""),
        value: String(kv.value ?? ""),
      }))
    : [];
  const statusTables = Array.isArray(statusTab?.tables) ? statusTab.tables : [];
  let statusSections = [];
  let statusLinksFlat = [];
  let statusMeta = null;
  try {
    if (Array.isArray(statusTab?.sections)) {
      statusSections = JSON.parse(JSON.stringify(statusTab.sections));
    }
    if (Array.isArray(statusTab?.links)) {
      statusLinksFlat = statusTab.links.map((L) => ({
        text: String(L.text ?? ""),
        href: String(L.href ?? ""),
        target: L.target != null ? String(L.target) : undefined,
        ...(L.onclick != null && String(L.onclick).trim()
          ? { onclick: String(L.onclick) }
          : {}),
      }));
    }
    if (statusTab?.meta && typeof statusTab.meta === "object") {
      statusMeta = JSON.parse(JSON.stringify(statusTab.meta));
    }
  } catch (e) {
    console.warn("[PGC] mapPgcPipelineToPortalData status clone:", e.message || e);
  }

  const tasksTab = detail?.tasksTab;
  const tasksKeyValues = [];
  if (tasksTab?.workflowState)
    tasksKeyValues.push({
      key: "Workflow state",
      value: tasksTab.workflowState,
    });
  if (Array.isArray(tasksTab?.workflowKeyValues)) {
    tasksTab.workflowKeyValues.forEach((kv) =>
      tasksKeyValues.push({
        key: String(kv.key ?? ""),
        value: String(kv.value ?? ""),
      }),
    );
  }
  const taskRows = (tasksTab?.tasks || []).map((t) => ({
    Task: t.taskName || "",
    Assignee: t.assignee || "",
    State: t.state || "",
    Due: t.dueDate || "",
  }));
  const tasksTables = Array.isArray(tasksTab?.tables) && tasksTab.tables.length
    ? tasksTab.tables
    : taskRows.length
      ? [{ headers: ["Task", "Assignee", "State", "Due"], rows: taskRows }]
      : [];

  const wf = pipelineResult.workflowPack;
  const reviewOut = pipelineResult.reviewOut;
  const filesOut = pipelineResult.filesOut;
  const reportsPayload = pipelineResult.reportsPayload;

  const folders = (filesOut?.folders || []).map((fol) => ({
    folderID: fol.folderID ?? null,
    folderName: fol.folderName || null,
    parentFolder: fol.parentFolder || null,
    filesCount: fol.filesCount ?? (fol.files?.length ?? 0),
    name: fol.folderName || `Folder ${fol.folderID}`,
    fileCount: fol.filesCount || (fol.files?.length ?? 0),
    ...(fol.folderActivationStatus && {
      folderActivationStatus: fol.folderActivationStatus,
    }),
    ...(fol.folderActivationError && {
      folderActivationError: fol.folderActivationError,
    }),
    files: (fol.files || []).map((f) => mapPgcPortalFileEntry(f, fol)),
  }));

  const reviewTab = {
    workflow: wf?.workflow || null,
    reviewProbe: wf?.reviewProbe || null,
    summary: {
      reviewGroupsCount: reviewOut?.reviewGroupsCount,
      rawCorrectionsCount: reviewOut?.rawCorrectionsCount,
      latestCycleCorrectionsCount: reviewOut?.latestCycleCorrectionsCount,
      changemarkCount: reviewOut?.changemarkCount,
      commentCount: reviewOut?.commentCount,
      unresolvedCount: reviewOut?.unresolvedCount,
      resolvedCount: reviewOut?.resolvedCount,
      statusCounts: reviewOut?.statusCounts,
    },
    workflowBuckets: (reviewOut?.workflowBuckets || []).map((wf) => ({
      workflowName: wf.workflowName || "",
      workflowValue: wf.workflowValue || "",
      workflowGroupingId: wf.workflowGroupingId || "",
      skippedStale: wf.skippedStale === true,
      rows: Array.isArray(wf.rows)
        ? wf.rows.map((r) => mapPgcWorkflowBucketRowForPortal(r, wf.workflowName))
        : [],
    })),
    latestCycleCorrections: (reviewOut?.latestCycleCorrections || []).map((c) => ({
      correctionID: c.correctionID || "",
      referenceNumber: c.referenceNumber || "",
      department: c.department || "",
      reviewerName: c.reviewerName || "",
      statusName: c.statusName || "",
      correctionType: c.correctionType || "",
      commentText: c.commentText || "",
      responseText: c.responseText || "",
      fileID: c.fileID || "",
      fileName: c.fileName || "",
      reviewCycle: c.reviewCycle || "",
      dateCreated: c.dateCreated || "",
    })),
  };

  const reportEntries = (reportsPayload?.reports || []).map((r) => {
    const exportUnavailable = !!r.exportUnavailable;
    return {
      fileSlug: r.fileSlug,
      reportName: r.reportName,
      reportType: r.reportType || "",
      reportDescription: r.reportDescription || "",
      /** Live SSRS ReportViewer URL — keep even when Supabase exports exist. */
      reportUrl: r.reportUrl || r.viewUrl || null,
      viewerUrl: r.viewUrl || r.reportUrl || null,
      viewerReady: r.viewerReady,
      /** Binary PDF exported from SSRS and uploaded to storage (not Excel, not parsed text). */
      pdfUrl: r.pdfPublicUrl || null,
      excelUrl: r.excelPublicUrl || null,
      excelDownloaded: r.excelDownloaded,
      pdfDownloaded: r.pdfDownloaded,
      exportUnavailable,
    };
  });

  const reportsTableRows = reportEntries.map((r) => ({
    "REPORT NAME": r.reportName,
    Status: r.viewerReady ? "Ready" : "Not ready",
  }));
  /** Washington-compatible pdfs[]: fileName, text, pages, url, pdfUrl, excelUrl, error, info */
  const reportsRaw = reportsPayload?.reports || [];
  const reportsPdfs = [];
  for (let i = 0; i < reportsRaw.length; i++) {
    const r = reportsRaw[i];
    const pdfEntry = {
      fileName: r.reportName,
      /**
       * Portal ReportViewer URL (same semantics as Washington extractPDFsFromPage).
       * Do not use pdfPublicUrl or excelPublicUrl here — those belong in pdfUrl / excelUrl only,
       * otherwise Excel can be mistaken for the report PDF when PDF upload is missing.
       */
      url:
        (r.viewUrl && String(r.viewUrl).trim()) ||
        (r.reportUrl && String(r.reportUrl).trim()) ||
        undefined,
      pdfUrl: r.pdfPublicUrl || undefined,
      excelUrl: r.excelPublicUrl || undefined,
      pages: 0,
      text: "",
      info: { source: "pgc-export" },
    };
    if (typeof r.screenshot === "string" && r.screenshot.length > 0) {
      pdfEntry.screenshot = r.screenshot;
    }
    const { text, numpages, parseError } = await buildPgcReportPdfEntryText(r);
    pdfEntry.text = text;
    pdfEntry.pages = numpages;
    if (!String(text || "").trim()) {
      if (parseError) {
        pdfEntry.error = parseError;
      } else {
        pdfEntry.error = "No text extracted from PDF or Excel";
      }
    }
    if (pdfEntry.screenshot) {
      pdfEntry.screenshot = await normalizeReportScreenshotBase64StringForPortalData(
        pdfEntry.screenshot,
      );
    }
    if (isPgcReviewCommentsReportName(r.reportName)) {
      const excelUrl = String(r.excelPublicUrl || r.excelHttpUrl || "").trim();
      const hasLocalExcel = !!(r.excelPath && fs.existsSync(r.excelPath));
      if (hasLocalExcel || excelUrl) {
        console.log(
          `[PGC][reports][excel-structured] Review Comments Excel found report=${JSON.stringify(r.reportName)} localExcel=${hasLocalExcel} excelUrl=${excelUrl ? "yes" : "no"}`,
        );
      }
      await attachReviewCommentsStructuredRowsToPdfEntry({
        pdfEntry,
        reportName: r.reportName,
        localExcelPath: r.excelPath,
        excelUrl,
        logTag: "PGC",
      });
    }
    reportsPdfs.push(pdfEntry);
  }

  const domBridge = applyPgcDomReviewCommentsBridge(
    reviewTab.workflowBuckets,
    reportsPdfs,
  );
  if (domBridge.applied) {
    reportsPdfs.length = 0;
    reportsPdfs.push(...domBridge.reportsPdfs);
  }

  const omit = pipelineResult._pgcOmitTabs || {};
  const skipTab = (k) => omit[k] === true;
  /** @type {Record<string, unknown>} */
  const tabs = {};
  if (!skipTab("info")) {
    tabs.info = {
      projectInfo,
      keyValues: projectInfo.map((kv) => ({ key: kv.key, value: kv.value })),
      tables: infoTables,
      info_debug: detail?.info_debug ?? null,
    };
  }
  if (!skipTab("status")) {
    tabs.status = {
      keyValues: statusKeyValues,
      tables: statusTables,
      sections: statusSections,
      links: statusLinksFlat,
      meta: statusMeta,
    };
  }
  if (!skipTab("tasks")) {
    tabs.tasks = { keyValues: tasksKeyValues, tables: tasksTables };
  }
  if (!skipTab("files")) {
    if (
      filesOut?.filesExtractionFailed ||
      filesOut?.sessionHandoffFailed
    ) {
      console.warn(
        `[PGC] mapPgcPipelineToPortalData: omitting tabs.files (${filesOut?.sessionHandoffFailed ? "session handoff failed" : "extraction failed"}: ${filesOut.filesExtractionError || "unknown"})`,
      );
    } else if (filesOut?.filesHarvestAuthoritative === false) {
      console.warn(
        `[PGC] mapPgcPipelineToPortalData: omitting tabs.files (harvest not authoritative; activationFailed=${filesOut._meta?.activationFailedFolders?.length ?? 0} downloadsOk=${filesOut._meta?.downloadsOk ?? 0})`,
      );
    } else {
      tabs.files = { folders, keyValues: [], tables: [] };
    }
  }
  if (!skipTab("review")) {
    tabs.review = reviewTab;
  }
  if (!skipTab("reports")) {
    tabs.reports = {
      tables: reportsTableRows.length
        ? [{ headers: ["REPORT NAME", "Status"], rows: reportsTableRows }]
        : [],
      pdfs: reportsPdfs,
      reportEntries,
    };
  } else if (domBridge.applied && domBridge.reviewPdf) {
    tabs.reports = {
      tables: [],
      pdfs: [domBridge.reviewPdf],
      reportEntries: [],
    };
    console.log(
      `[PGC] mapPgcPipelineToPortalData: reports tab synthesized for DOM bridge (${domBridge.mappedCount} structuredRows) despite skipReports`,
    );
  }

  return {
    name: projectRow.name,
    projectNum: projectRow.projectNum,
    description: projectRow.description || "",
    location: projectRow.location || "",
    dashboardStatus: projectRow.status || "",
    portalType: "projectdox",
    portalSubtype: "pgc-eplan",
    jurisdiction: "Prince George's County, MD",
    tabs,
  };
}

/**
 * Map Montgomery pipeline result → portal_data (same broad contract as PGC / ProjectDox).
 */
function isSupabaseStoragePublicUrl(url) {
  return /supabase\.co\/storage\//i.test(String(url || "").trim());
}

function isPgcEphemeralPortalFileUrl(url) {
  const s = String(url || "").trim();
  if (!s || isSupabaseStoragePublicUrl(s)) return false;
  if (/^blob:|^data:/i.test(s)) return false;
  if (
    /princegeorgescountymd\.gov|eplans\.princegeorges/i.test(s) &&
    /(ActiveXViewer|FileViewer|BravaServer|viewfile|sessionended|\/login\b)/i.test(
      s,
    )
  ) {
    return true;
  }
  if (/ProjectDox/i.test(s) && !isSupabaseStoragePublicUrl(s)) return true;
  return false;
}

function resolvePgcPortalFileOpenUrl(f) {
  const failed =
    String(f.downloadStatus || "").toLowerCase() === "failed" ||
    String(f.downloadStatus || "")
      .toLowerCase()
      .startsWith("failed_");
  if (failed) return null;

  for (const raw of [f.publicUrl, f.viewUrl, f.downloadUrl]) {
    const u = String(raw || "").trim();
    if (u && isSupabaseStoragePublicUrl(u)) return u;
  }
  for (const raw of [f.publicUrl, f.viewUrl, f.downloadUrl]) {
    const u = String(raw || "").trim();
    if (u && !isPgcEphemeralPortalFileUrl(u)) return u;
  }
  return null;
}

function mapPgcPortalFileEntry(f, fol) {
  const openUrl = resolvePgcPortalFileOpenUrl(f);
  const activationSkipped =
    String(f.downloadStatus || "").toLowerCase() === "activation_skipped";
  const failed =
    !activationSkipped &&
    (String(f.downloadStatus || "").toLowerCase() === "failed" ||
      String(f.downloadStatus || "")
        .toLowerCase()
        .startsWith("failed_"));
  const downloadStatus =
    f.downloadStatus || (openUrl ? "ok" : undefined);

  return {
    name: f.name || "file",
    fileId: f.fileId,
    folderName: f.folderName,
    parentFolder: fol.parentFolder || null,
    status: f.status || "",
    reviewedBy: f.reviewedBy || "",
    uploadedDate: f.uploadedDate || "",
    commentCount: f.commentCount ?? 0,
    publicUrl: openUrl || null,
    viewUrl: openUrl || null,
    downloadUrl: openUrl || null,
    fileSizeKB: f.fileSizeKB ?? null,
    version: f.version ?? null,
    hasMarkups: f.hasMarkups ?? false,
    ...(downloadStatus && { downloadStatus }),
    ...(failed &&
      f.downloadError && {
        downloadError: scrapeFileResults.sanitizeFailureMessage(f.downloadError),
      }),
    ...(fol.folderActivationStatus && {
      folderActivationStatus: fol.folderActivationStatus,
    }),
  };
}

function mapMontgomeryPortalFileEntry(f, fol) {
  const downloadStatus =
    f.downloadStatus || (f.publicUrl || f.viewUrl ? "success" : undefined);
  return {
    name: f.name || "file",
    fileId: f.fileId,
    folderName: f.folderName,
    parentFolder: fol.parentFolder || null,
    status: f.status || "",
    reviewedBy: f.reviewedBy || "",
    uploadedDate: f.uploadedDate || "",
    commentCount: f.commentCount ?? 0,
    viewUrl: f.viewUrl,
    publicUrl: f.publicUrl || f.viewUrl || null,
    downloadUrl: f.downloadUrl || null,
    fileSizeKB: f.fileSizeKB ?? null,
    version: f.version ?? null,
    hasMarkups: f.hasMarkups ?? false,
    ...(downloadStatus && { downloadStatus }),
    ...(f.downloadError && {
      downloadError: scrapeFileResults.sanitizeFailureMessage(f.downloadError),
    }),
  };
}

async function mapMontgomeryPipelineToPortalData(projectRow, pipelineResult) {
  const detail = pipelineResult.detailResult?.out;
  const info = detail?.info;
  const projectInfo = [];
  const infoTables = Array.isArray(info?.tables) ? info.tables : [];
  if (info) {
    const add = (k, v) => {
      if (v != null) projectInfo.push({ key: k, value: String(v) });
    };
    if (Array.isArray(info.projectInfo) && info.projectInfo.length) {
      info.projectInfo.forEach((kv) =>
        projectInfo.push({
          key: String(kv.key ?? kv.label ?? ""),
          value: String(kv.value ?? ""),
        }),
      );
    } else {
      add("Project #", info.projectNumber);
      add("Case name", info.caseName);
      add("Location", info.location);
      add("Case type", info.caseType);
      add("Contact email", info.contactEmail);
      add("Status", info.status);
      add("Project start", info.projectStart);
      add("Project end", info.projectEnd);
    }
  }

  const statusTab = detail?.statusTab;
  const statusKeyValues = Array.isArray(statusTab?.keyValues)
    ? statusTab.keyValues.map((kv) => ({
        key: String(kv.key ?? ""),
        value: String(kv.value ?? ""),
      }))
    : [];
  const statusTables = Array.isArray(statusTab?.tables) ? statusTab.tables : [];
  let statusSections = [];
  let statusLinksFlat = [];
  let statusMeta = null;
  try {
    if (Array.isArray(statusTab?.sections)) {
      statusSections = JSON.parse(JSON.stringify(statusTab.sections));
    }
    if (Array.isArray(statusTab?.links)) {
      statusLinksFlat = statusTab.links.map((L) => {
        const hrefDirect = String(L.href ?? "").trim();
        const resolved = String(L.resolvedViewerUrl ?? "").trim();
        const viewerU = String(L.viewerUrl ?? resolved).trim();
        const reportU = String(L.reportUrl ?? resolved).trim();
        return {
          text: String(L.text ?? ""),
          href: hrefDirect || viewerU || reportU,
          target: L.target != null ? String(L.target) : undefined,
          ...(L.onclick != null && String(L.onclick).trim()
            ? { onclick: String(L.onclick) }
            : {}),
          ...(resolved ? { resolvedViewerUrl: resolved } : {}),
          ...(viewerU ? { viewerUrl: viewerU } : {}),
          ...(reportU ? { reportUrl: reportU } : {}),
          ...(typeof L.hasResolved === "boolean" ? { hasResolved: L.hasResolved } : {}),
          ...(L.reportName != null && String(L.reportName).trim()
            ? { reportName: String(L.reportName) }
            : {}),
          ...(L.linkWflowInstanceID != null && String(L.linkWflowInstanceID).trim()
            ? { linkWflowInstanceID: String(L.linkWflowInstanceID) }
            : {}),
        };
      });
    }
    if (statusTab?.meta && typeof statusTab.meta === "object") {
      statusMeta = JSON.parse(JSON.stringify(statusTab.meta));
    }
  } catch (e) {
    console.warn("[Montgomery] map status clone:", e.message || e);
  }

  const tasksTab = detail?.tasksTab;
  const tasksKeyValues = [];
  if (tasksTab?.workflowState)
    tasksKeyValues.push({
      key: "Workflow state",
      value: tasksTab.workflowState,
    });
  if (Array.isArray(tasksTab?.workflowKeyValues)) {
    tasksTab.workflowKeyValues.forEach((kv) =>
      tasksKeyValues.push({
        key: String(kv.key ?? ""),
        value: String(kv.value ?? ""),
      }),
    );
  }
  const taskRows = (tasksTab?.tasks || []).map((t) => ({
    Task: t.taskName || "",
    Assignee: t.assignee || "",
    State: t.state || "",
    Due: t.dueDate || "",
  }));
  const tasksTables =
    Array.isArray(tasksTab?.tables) && tasksTab.tables.length
      ? tasksTab.tables
      : taskRows.length
        ? [{ headers: ["Task", "Assignee", "State", "Due"], rows: taskRows }]
        : [];

  const wf = pipelineResult.workflowPack;
  const reviewOut = pipelineResult.reviewOut;
  const filesOut = pipelineResult.filesOut;
  const reportsPayload = pipelineResult.reportsPayload;

  const folders = (filesOut?.folders || []).map((fol) => ({
    folderID: fol.folderID ?? null,
    folderName: fol.folderName || null,
    parentFolder: fol.parentFolder || null,
    filesCount: fol.filesCount ?? (fol.files?.length ?? 0),
    name: fol.folderName || `Folder ${fol.folderID}`,
    fileCount: fol.filesCount || (fol.files?.length ?? 0),
    files: (fol.files || []).map((f) => mapMontgomeryPortalFileEntry(f, fol)),
  }));

  const reviewTab = {
    workflow: wf?.workflow || null,
    reviewProbe: wf?.reviewProbe || null,
    summary: {
      reviewGroupsCount: reviewOut?.reviewGroupsCount,
      rawCorrectionsCount: reviewOut?.rawCorrectionsCount,
      latestCycleCorrectionsCount: reviewOut?.latestCycleCorrectionsCount,
      changemarkCount: reviewOut?.changemarkCount,
      commentCount: reviewOut?.commentCount,
      unresolvedCount: reviewOut?.unresolvedCount,
      resolvedCount: reviewOut?.resolvedCount,
      statusCounts: reviewOut?.statusCounts,
    },
    workflowBuckets: (reviewOut?.workflowBuckets || []).map((wfb) => ({
      workflowName: wfb.workflowName || "",
      rows: Array.isArray(wfb.rows)
        ? wfb.rows.map((r) => ({
            workflowName: r.workflowName || "",
            refNumber: r.refNumber || "",
            changemarkNumber: r.changemarkNumber || "",
            department: r.department || "",
            reviewer: r.reviewer || "",
            datetime: r.datetime || "",
            cycle: r.cycle || "",
            status: r.status || "",
            fileName: r.fileName || "",
            commentText: r.commentText || "",
          }))
        : [],
    })),
    latestCycleCorrections: (reviewOut?.latestCycleCorrections || []).map((c) => ({
      correctionID: c.correctionID || "",
      referenceNumber: c.referenceNumber || "",
      department: c.department || "",
      reviewerName: c.reviewerName || "",
      statusName: c.statusName || "",
      correctionType: c.correctionType || "",
      commentText: c.commentText || "",
      responseText: c.responseText || "",
      fileID: c.fileID || "",
      fileName: c.fileName || "",
      reviewCycle: c.reviewCycle || "",
      dateCreated: c.dateCreated || "",
    })),
  };

  const _mdcReportsRaw = reportsPayload?.reports || [];
  console.log(
    `[Montgomery][debug][reports] mapMontgomery pipeline reports count=${_mdcReportsRaw.length} skipped=${!!reportsPayload?.skipped}`,
  );
  console.log(
    `[Montgomery][reports-deep] mapper-input ${JSON.stringify(
      _mdcReportsRaw.map((r) => ({
        name: r.reportName,
        viewUrlLen: String(r.viewUrl || "").length,
        reportUrlLen: String(r.reportUrl || "").length,
        viewerReady: !!r.viewerReady,
        pdfHttpUrl: !!r.pdfHttpUrl,
        excelHttpUrl: !!r.excelHttpUrl,
        pdfPublicUrl: !!r.pdfPublicUrl,
        excelPublicUrl: !!r.excelPublicUrl,
        pdfDownloaded: !!r.pdfDownloaded,
        excelDownloaded: !!r.excelDownloaded,
      })),
    )}`,
  );
  _mdcReportsRaw.forEach((r, i) => {
    const vu = String(r.viewUrl || "").trim();
    const ru = String(r.reportUrl || "").trim();
    console.log(
      `[Montgomery][debug][reports] pipelineRaw[${i}] name=${JSON.stringify(r.reportName)} viewUrlLen=${vu.length} reportUrlLen=${ru.length} viewerReady=${!!r.viewerReady} exportUnavailable=${!!r.exportUnavailable} pdfDownloaded=${!!r.pdfDownloaded} excelDownloaded=${!!r.excelDownloaded} pdfPublicUrl=${r.pdfPublicUrl ? "yes" : "no"} excelPublicUrl=${r.excelPublicUrl ? "yes" : "no"}`,
    );
  });

  const reportEntries = _mdcReportsRaw.map((r) => {
    const exportUnavailable = !!r.exportUnavailable;
    const reportUrl = r.reportUrl || r.viewUrl || null;
    const viewerUrl = r.viewUrl || r.reportUrl || null;
    const wf =
      r.wflowInstanceIDInViewerUrl != null && String(r.wflowInstanceIDInViewerUrl).trim()
        ? String(r.wflowInstanceIDInViewerUrl).trim()
        : null;
    return {
      fileSlug: r.fileSlug,
      reportName: r.reportName,
      reportType: r.reportType || "",
      reportDescription: r.reportDescription || "",
      reportUrl,
      viewerUrl,
      viewerReady: !!r.viewerReady,
      pdfUrl: r.pdfPublicUrl || r.pdfHttpUrl || null,
      excelUrl: r.excelPublicUrl || r.excelHttpUrl || null,
      excelDownloaded: r.excelDownloaded,
      pdfDownloaded: r.pdfDownloaded,
      exportUnavailable,
      ...(r.exportError ? { exportError: String(r.exportError) } : {}),
      flags: {
        viewerUrlResolved: !!(viewerUrl && /^https?:\/\//i.test(String(viewerUrl))),
        ...(wf ? { wflowInstanceID: wf } : {}),
      },
    };
  });
  reportEntries.forEach((e, i) => {
    const vu = String(e.viewerUrl || "");
    const ru = String(e.reportUrl || "");
    console.log(
      `[Montgomery][debug][reports] portalDataReportEntry[${i}] name=${JSON.stringify(e.reportName)} viewerUrlHttp=${/^https?:\/\//i.test(vu)} reportUrlHttp=${/^https?:\/\//i.test(ru)} flags.viewerUrlResolved=${e.flags?.viewerUrlResolved} exportUnavailable=${e.exportUnavailable}`,
    );
  });
  console.log(
    `[Montgomery][reports-deep] mapper-output ${JSON.stringify(
      reportEntries.map((e) => ({
        name: e.reportName,
        viewerUrlLen: String(e.viewerUrl || "").length,
        reportUrlLen: String(e.reportUrl || "").length,
        viewerReady: e.viewerReady,
        pdfUrlLen: String(e.pdfUrl || "").length,
        excelUrlLen: String(e.excelUrl || "").length,
        viewerUrlResolved: !!(e.flags && e.flags.viewerUrlResolved),
        exportUnavailable: e.exportUnavailable,
      })),
    )}`,
  );

  const reportsTableRows = reportEntries.map((r) => {
    let status = "Not ready";
    if (r.pdfUrl || r.excelUrl) status = "Exported";
    else if (r.viewerReady || r.viewerUrl || r.reportUrl) status = "Ready";
    return {
      "REPORT NAME": r.reportName,
      Status: status,
    };
  });

  const reportsRaw = reportsPayload?.reports || [];
  const reportsPdfs = [];
  for (let i = 0; i < reportsRaw.length; i++) {
    const r = reportsRaw[i];
    const viewerFallback = r.viewUrl || r.reportUrl;
    const pdfEntry = {
      fileName: r.reportName,
      url:
        r.pdfPublicUrl ||
        r.excelPublicUrl ||
        r.pdfHttpUrl ||
        r.excelHttpUrl ||
        viewerFallback ||
        undefined,
      pdfUrl: r.pdfPublicUrl || r.pdfHttpUrl || undefined,
      excelUrl: r.excelPublicUrl || r.excelHttpUrl || undefined,
      pages: 0,
      text: "",
      info: { source: "montgomery-export" },
    };
    if (typeof r.screenshot === "string" && r.screenshot.length > 0) {
      pdfEntry.screenshot = r.screenshot;
    }
    const { text, numpages, parseError } = await buildPgcReportPdfEntryText(r);
    pdfEntry.text = text;
    pdfEntry.pages = numpages;
    if (pdfEntry.screenshot) {
      pdfEntry.screenshot = await normalizeReportScreenshotBase64StringForPortalData(
        pdfEntry.screenshot,
      );
    }
    const textLen = String(text || "").length;
    console.log(
      `[Montgomery][reports-fix] extracted text chars = ${textLen} | ${r.reportName || ""}`,
    );
    console.log(
      `[Montgomery][reports-deep] export report=${JSON.stringify(r.reportName || "")} mapper-pdfEntry-parse textChars=${textLen} pages=${numpages} parseError=${parseError || "null"} pdfEntryWillSetError=${!String(text || "").trim() ? (parseError || "no-text-generic") : "none"}`,
    );
    if (!String(text || "").trim()) {
      if (parseError) {
        pdfEntry.error = parseError;
      } else if (
        (r.pdfHttpUrl || r.excelHttpUrl || viewerFallback) &&
        /^https?:\/\//i.test(String(viewerFallback || r.pdfHttpUrl || r.excelHttpUrl || ""))
      ) {
        pdfEntry.error =
          "No text extracted; viewer/export URL present (session may be required for fetch)";
      } else if (r.exportUnavailable && !(r.pdfPath && fs.existsSync(r.pdfPath))) {
        pdfEntry.error = "No text extracted; export unavailable after viewer attempt";
      } else {
        pdfEntry.error = "No text extracted from PDF or Excel";
      }
    }
    console.log(
      `[Montgomery][debug][reports] pdfTextExtract i=${i} name=${JSON.stringify(r.reportName)} textLen=${textLen} parseError=${parseError || "(none)"} pdfEntry.error=${pdfEntry.error || "(none)"} hadLocalPdf=${!!(r.pdfPath && fs.existsSync(r.pdfPath))} hadLocalExcel=${!!(r.excelPath && fs.existsSync(r.excelPath))}`,
    );

    if (isPgcReviewCommentsReportName(r.reportName)) {
      await attachReviewCommentsStructuredRowsToPdfEntry({
        pdfEntry,
        reportName: r.reportName,
        localExcelPath: r.excelPath,
        excelUrl: r.excelPublicUrl || r.excelHttpUrl,
        logTag: "Montgomery",
      });
    }

    reportsPdfs.push(pdfEntry);
  }

  const omit = pipelineResult._montgomeryOmitTabs || {};
  const skipTab = (k) => omit[k] === true;
  /** @type {Record<string, unknown>} */
  const tabs = {};
  if (!skipTab("info")) {
    const infoHadSynthTables = Array.isArray(infoTables) && infoTables.length > 0;
    tabs.info = {
      projectInfo: projectInfo.map((kv) => ({ key: kv.key, value: kv.value })),
      keyValues: projectInfo.map((kv) => ({ key: kv.key, value: kv.value })),
      // Montgomery UI already renders projectInfo; omit duplicate Field/Value tables from scraper.
      tables: [],
      info_debug: detail?.info?.info_debug ?? null,
    };
    console.log(
      `[Montgomery][dedupe-fix] info tables suppressed: ${infoHadSynthTables ? "yes" : "no"}`,
    );
  }
  if (!skipTab("status")) {
    const statusHadSynthTables = Array.isArray(statusTables) && statusTables.length > 0;
    tabs.status = {
      keyValues: statusKeyValues,
      // Montgomery UI already renders keyValues; omit duplicate Field/Value tables from scraper.
      tables: [],
      sections: statusSections,
      links: statusLinksFlat,
      meta: statusMeta,
    };
    console.log(
      `[Montgomery][dedupe-fix] status tables suppressed: ${statusHadSynthTables ? "yes" : "no"}`,
    );
  }
  if (!skipTab("tasks")) {
    tabs.tasks = { keyValues: tasksKeyValues, tables: tasksTables };
  }
  if (!skipTab("files")) {
    tabs.files = { folders, keyValues: [], tables: [] };
  }
  if (!skipTab("review")) {
    tabs.review = reviewTab;
  }
  if (!skipTab("reports")) {
    tabs.reports = {
      tables: reportsTableRows.length
        ? [{ headers: ["REPORT NAME", "Status"], rows: reportsTableRows }]
        : [],
      pdfs: reportsPdfs,
      reportEntries,
    };
  }

  if (!skipTab("status")) {
    const st = tabs.status;
    const hasPayload =
      (Array.isArray(st?.keyValues) && st.keyValues.length > 0) ||
      (Array.isArray(st?.links) && st.links.length > 0);
    console.log(
      `[Montgomery][status] preserved through final payload = ${hasPayload ? "yes" : "no"}`,
    );
  }

  const infFinal = tabs.info;
  const stFinal = tabs.status;
  console.log(
    `[Montgomery][dedupe-fix] final info counts projectInfo=${Array.isArray(infFinal?.projectInfo) ? infFinal.projectInfo.length : 0} keyValues=${Array.isArray(infFinal?.keyValues) ? infFinal.keyValues.length : 0} tables=${Array.isArray(infFinal?.tables) ? infFinal.tables.length : 0}`,
  );
  console.log(
    `[Montgomery][dedupe-fix] final status counts keyValues=${Array.isArray(stFinal?.keyValues) ? stFinal.keyValues.length : 0} tables=${Array.isArray(stFinal?.tables) ? stFinal.tables.length : 0} links=${Array.isArray(stFinal?.links) ? stFinal.links.length : 0}`,
  );

  if (tabs.info) logMontgomeryDebugInfoDupTabs(tabs.info, "mapper-output");
  if (tabs.status) logMontgomeryDebugStatusDupTabs(tabs.status, "mapper-output");

  return {
    name: projectRow.name,
    projectNum: projectRow.projectNum,
    description: projectRow.description || "",
    location: projectRow.location || "",
    dashboardStatus: projectRow.status || "",
    portalType: "projectdox",
    portalSubtype: "montgomery-projectdox",
    jurisdiction: "Montgomery County, MD",
    tabs,
  };
}

/**
 * Howard uses the same portal_data shape as Montgomery; Howard pipeline sets `_howardOmitTabs`.
 */
async function mapHowardPipelineToPortalData(projectRow, pipelineResult) {
  const adapted = {
    ...pipelineResult,
    _montgomeryOmitTabs: pipelineResult._howardOmitTabs,
  };
  const out = await mapMontgomeryPipelineToPortalData(projectRow, adapted);
  const tabs = out.tabs && typeof out.tabs === "object" ? { ...out.tabs } : out.tabs;
  if (tabs?.reports?.pdfs && Array.isArray(tabs.reports.pdfs)) {
    tabs.reports = {
      ...tabs.reports,
      pdfs: tabs.reports.pdfs.map((p) => ({
        ...p,
        info: { ...(p.info || {}), source: "howard-export" },
      })),
    };
  }
  return {
    ...out,
    portalSubtype: "howard-projectdox",
    jurisdiction: "Howard County, MD",
    ...(tabs ? { tabs } : {}),
  };
}

/**
 * Omit tabs when value is true (same convention as Montgomery / PGC).
 * Mode matrix mirrors montgomeryPipelineOptsFromScrapeMode for parity; plus
 * howard_without_reports for Howard-only API callers.
 */
function howardPipelineOptsFromScrapeMode(scrapeMode) {
  const m = String(scrapeMode ?? "howard_quick").trim();
  const reviewOmitted = { review: true };

  if (m === "howard_quick") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_without_files") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: true,
      reports: false,
      ...reviewOmitted,
    };
  }
  if (m === "howard_without_reports") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: false,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_files_only") {
    return {
      info: true,
      status: true,
      tasks: true,
      files: false,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_reports_only") {
    return {
      info: true,
      status: true,
      tasks: true,
      files: true,
      reports: false,
      ...reviewOmitted,
    };
  }
  if (m === "howard_status_only") {
    return {
      info: true,
      status: false,
      tasks: true,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_tasks_only") {
    return {
      info: true,
      status: true,
      tasks: false,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_info_only") {
    return {
      info: false,
      status: true,
      tasks: true,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "howard_all") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: false,
      reports: false,
      ...reviewOmitted,
    };
  }
  return {
    info: false,
    status: false,
    tasks: false,
    files: true,
    reports: true,
    ...reviewOmitted,
  };
}

async function scrapeHowardAll(
  session,
  projects,
  _sessionId,
  supabaseProjectId,
  userId,
  scrapeMode,
) {
  const sid = String(_sessionId || "");
  try {
    session._scrapeActive = true;
    console.log(`[Session][scrape] active=true sid=${sid} flow=howard`);

    const omitTabs = howardPipelineOptsFromScrapeMode(scrapeMode);

    session._scrapeCumulativeBytes = 0;
    console.log("[Howard] session._scrapeCumulativeBytes reset to 0 at pipeline start");
    session._downloadedHashes = new Map();

    let bases = session.howardWebUiBases;
    if (!bases || !bases.length) {
      bases = await howardProjectDox.resolveHowardWebUiBases(session.page);
      session.howardWebUiBases = bases;
    }

    const dash =
      session.dashboardUrl && String(session.dashboardUrl).trim()
        ? String(session.dashboardUrl).trim()
        : "https://howardco-md-us.avolvecloud.com/Home/Index";
    const permitSanitize = (s) => {
      const t = String(s || "")
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .slice(0, 120);
      return t || "permit";
    };

    for (let i = 0; i < projects.length; i++) {
      if (session._cancelRequested) {
        console.log("   🛑 Howard scrape cancelled");
        return;
      }
      const project = projects[i];
      mirrorSessionProgress(session, `${project.projectNum} → Howard harvest`, {
        event_type: "section_started",
        stage: "howard_harvest",
        user_message: `Opening project ${project.projectNum} in Howard County portal.`,
        progress_current: session.progress,
        progress_total: session.total,
      });
      console.log(
        `\n🟢 [Howard] [${i + 1}/${projects.length}] ${project.projectNum} (ID ${project.projectId})`,
      );
      let page;
      try {
        page = await session.context.newPage();
        const storagePrefix = `drawings/${supabaseProjectId || "pending"}/howard/${permitSanitize(project.projectNum)}`;
        const uploadLocal = (localPath, key) =>
          pgcUploadLocalToSupabase(session, localPath, key);

        const pipelineResult = await howardProjectDox.runHowardProductionPipeline(
          page,
          {
            projectID: String(project.projectId),
            projectNumber: project.projectNum,
            description: project.description,
            location: project.location,
            status: project.status,
          },
          bases,
          dash,
          {
            _howardOmitTabs: omitTabs,
            uploadLocal,
            storagePrefix,
          },
        );

        session.data[project.id] = await mapHowardPipelineToPortalData(
          project,
          pipelineResult,
        );
      } catch (err) {
        console.error(`   ❌ [Howard] ${project.projectNum}:`, err.message);
        session.data[project.id] = {
          name: project.name,
          projectNum: project.projectNum,
          description: project.description || "",
          location: project.location || "",
          dashboardStatus: project.status || "",
          portalType: "projectdox",
          portalSubtype: "howard-projectdox",
          jurisdiction: "Howard County, MD",
          tabs: {
            info: { error: err.message, keyValues: [], tables: [] },
          },
        };
      } finally {
        if (page) await page.close().catch(() => {});
      }
      session.progress++;
    }

    mirrorSessionProgress(session, "Howard scraping complete! Syncing...", {
      event_type: "save_started",
      stage: "save",
      user_message: "Saving Howard County results to your project.",
    });
    console.log(`\n✅ [Howard] Done! Syncing to Supabase...`);
    const howardSyncOk = await syncPortalDataToSupabase(
      session,
      projects,
      supabaseProjectId,
      userId,
      null,
    );

    if (session._cancelRequested) {
      console.log("   🛑 Howard scrape cancelled — not marking as done");
      return;
    }
    if (!howardSyncOk) {
      session.status = "error";
      session.message =
        "Howard scrape finished but Supabase sync failed (check server logs).";
      console.error(
        `    ❌ Howard Supabase sync failed — session status set to "error"`,
      );
      return;
    }
    session.status = "done";
    mirrorSessionProgress(
      session,
      `Howard complete: ${projects.length} project(s) synced.`,
      {
        event_type: "scrape_completed",
        stage: "completed",
        status: "completed",
        user_message: `Scrape completed. ${projects.length} Howard County project(s) saved.`,
        progress_current: session.total,
        progress_total: session.total,
      },
    );
    console.log(`    ✅ Howard Supabase sync complete — session status set to "done"`);
  } finally {
    session._scrapeActive = false;
    console.log(`[Session][scrape] active=false sid=${sid} flow=howard`);
  }
}

/**
 * Omit tabs when value is true (same convention as PGC _pgcOmitTabs).
 * Reviews tab is always omitted (Montgomery corrections pipeline deferred).
 */
function montgomeryPipelineOptsFromScrapeMode(scrapeMode) {
  const m = String(scrapeMode ?? "montgomery_quick").trim();
  /** @type {Record<string, boolean>} */
  const reviewOmitted = { review: true };

  if (m === "montgomery_quick") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_without_files") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: true,
      reports: false,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_files_only") {
    return {
      info: true,
      status: true,
      tasks: true,
      files: false,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_reports_only") {
    return {
      info: true,
      status: true,
      tasks: true,
      files: true,
      reports: false,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_status_only") {
    return {
      info: true,
      status: false,
      tasks: true,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_tasks_only") {
    return {
      info: true,
      status: true,
      tasks: false,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_info_only") {
    return {
      info: false,
      status: true,
      tasks: true,
      files: true,
      reports: true,
      ...reviewOmitted,
    };
  }
  if (m === "montgomery_all") {
    return {
      info: false,
      status: false,
      tasks: false,
      files: false,
      reports: false,
      ...reviewOmitted,
    };
  }
  return {
    info: false,
    status: false,
    tasks: false,
    files: true,
    reports: true,
    ...reviewOmitted,
  };
}

async function scrapeMontgomeryAll(
  session,
  projects,
  _sessionId,
  supabaseProjectId,
  userId,
  scrapeMode,
) {
  const sid = String(_sessionId || "");
  try {
    session._scrapeActive = true;
    console.log(`[Session][scrape] active=true sid=${sid} flow=montgomery`);

  const omitTabs = montgomeryPipelineOptsFromScrapeMode(scrapeMode);

  session._scrapeCumulativeBytes = 0;
  console.log(`[Montgomery] session._scrapeCumulativeBytes reset to 0 at pipeline start`);
  session._downloadedHashes = new Map();

  let bases = session.montgomeryWebUiBases;
  if (!bases || !bases.length) {
    bases = await montgomeryProjectDox.resolveMontgomeryWebUiBases(session.page);
    session.montgomeryWebUiBases = bases;
  }

  const dash =
    session.dashboardUrl && String(session.dashboardUrl).trim()
      ? String(session.dashboardUrl).trim()
      : "https://montgomeryco-md-us.avolvecloud.com/Home/Index";
  const permitSanitize = (s) => {
    const t = String(s || "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, 120);
    return t || "permit";
  };

  for (let i = 0; i < projects.length; i++) {
    if (session._cancelRequested) {
      console.log("   🛑 Montgomery scrape cancelled");
      return;
    }
    const project = projects[i];
    mirrorSessionProgress(session, `${project.projectNum} → Montgomery harvest`, {
      event_type: "section_started",
      stage: "montgomery_harvest",
      user_message: `Opening project ${project.projectNum} in Montgomery County portal.`,
      progress_current: session.progress,
      progress_total: session.total,
    });
    console.log(
      `\n🟢 [Montgomery] [${i + 1}/${projects.length}] ${project.projectNum} (ID ${project.projectId})`,
    );
    let page;
    try {
      page = await session.context.newPage();
      const storagePrefix = `drawings/${supabaseProjectId || "pending"}/montgomery/${permitSanitize(project.projectNum)}`;
      const uploadLocal = (localPath, key) =>
        pgcUploadLocalToSupabase(session, localPath, key);

      const pipelineResult = await montgomeryProjectDox.runMontgomeryProductionPipeline(
        page,
        {
          projectID: String(project.projectId),
          projectNumber: project.projectNum,
          description: project.description,
          location: project.location,
          status: project.status,
        },
        bases,
        dash,
        {
          _montgomeryOmitTabs: omitTabs,
          uploadLocal,
          storagePrefix,
          harvestFiles: async (pipelinePage, pipelineProj, pipelineWebUiBase) =>
            extractMontgomeryFilesTabLightweight(
              pipelinePage,
              pipelinePage.context(),
              session,
              pipelineProj,
              pipelineWebUiBase,
              supabaseProjectId,
            ),
        },
      );

      session.data[project.id] = await mapMontgomeryPipelineToPortalData(
        project,
        pipelineResult,
      );
    } catch (err) {
      console.error(`   ❌ [Montgomery] ${project.projectNum}:`, err.message);
      session.data[project.id] = {
        name: project.name,
        projectNum: project.projectNum,
        description: project.description || "",
        location: project.location || "",
        dashboardStatus: project.status || "",
        portalType: "projectdox",
        portalSubtype: "montgomery-projectdox",
        jurisdiction: "Montgomery County, MD",
        tabs: {
          info: { error: err.message, keyValues: [], tables: [] },
        },
      };
    } finally {
      if (page) await page.close().catch(() => {});
    }
    session.progress++;
  }

  mirrorSessionProgress(session, "Montgomery scraping complete! Syncing...", {
    event_type: "save_started",
    stage: "save",
    user_message: "Saving Montgomery County results to your project.",
  });
  console.log(`\n✅ [Montgomery] Done! Syncing to Supabase...`);

  if (session._cancelRequested) {
    console.log("   🛑 Montgomery scrape cancelled — not marking as done");
    return;
  }

  const hasFileProgressJob =
    Boolean(session._scrapeJobId) && Boolean(supabaseProjectId);

  const montgomerySyncOk = await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    null,
    { preserveFilesTabFromDb: hasFileProgressJob },
  );

  if (!montgomerySyncOk) {
    session.status = "error";
    session.message =
      "Montgomery scrape finished but Supabase sync failed (check server logs).";
    console.error(
      `    ❌ Montgomery Supabase sync failed — session status set to "error"`,
    );
    return;
  }

  if (hasFileProgressJob) {
    const reconcileResult = await scrapeFileResults.reconcileRunFilesToPortalData(
      supabase,
      {
        projectId: supabaseProjectId,
        scrapeJobId: session._scrapeJobId,
        hashPortalData,
        requireSuccessfulJob: false,
      },
    );
    if (!reconcileResult.ok) {
      console.warn(
        `    ⚠️ Montgomery file reconcile skipped: ${reconcileResult.reason || "unknown"}`,
      );
    }
  }

  session.status = "done";
  mirrorSessionProgress(
    session,
    `Montgomery complete: ${projects.length} project(s) synced.`,
    {
      event_type: "scrape_completed",
      stage: "completed",
      status: "completed",
      user_message: `Scrape completed. ${projects.length} Montgomery County project(s) saved.`,
      progress_current: session.total,
      progress_total: session.total,
    },
  );
  console.log(`    ✅ Montgomery Supabase sync complete — session status set to "done"`);
  } finally {
    session._scrapeActive = false;
    console.log(`[Session][scrape] active=false sid=${sid} flow=montgomery`);
  }
}

async function pgcUploadLocalToSupabase(session, localPath, storagePath) {
  if (!fs.existsSync(localPath)) return null;
  const stat = fs.statSync(localPath);
  if (stat.size < MIN_FILE_SIZE) {
    console.warn(`      ⚠️ PGC upload skip (tiny file): ${storagePath}`);
    return null;
  }
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(`      ⚠️ PGC upload skip (oversize): ${storagePath}`);
    return null;
  }
  if (session) {
    const cumulative =
      (session._scrapeCumulativeBytes || 0) + stat.size;
    if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
      console.warn(
        `      ⚠️ PGC upload skipped (cumulative ${(cumulative / 1024 / 1024).toFixed(0)} MB cap)`,
      );
      return null;
    }
    session._scrapeCumulativeBytes = cumulative;
  }
  const buf = fs.readFileSync(localPath);
  const contentHash = crypto.createHash("sha256").update(buf).digest("hex");
  if (session?._downloadedHashes?.has(contentHash)) {
    const prev = session._downloadedHashes.get(contentHash);
    return prev?.viewUrl || null;
  }
  const url = await uploadToSupabaseStorage(localPath, storagePath);
  if (url && session?._downloadedHashes) {
    session._downloadedHashes.set(contentHash, {
      fileName: path.basename(storagePath),
      viewUrl: url || "",
    });
  }
  return url;
}

function cleanupPgcSuccessLocalArtifacts(pipelineResult) {
  if (!pipelineResult || typeof pipelineResult !== "object") return;

  const deleted = {
    task6Files: 0,
    task8Reports: 0,
  };
  const seenPaths = new Set();

  const unlinkIfEligible = (filePath) => {
    if (!filePath || typeof filePath !== "string") return false;
    if (seenPaths.has(filePath)) return false;
    seenPaths.add(filePath);
    if (!fs.existsSync(filePath)) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (_) {
      return false;
    }
  };

  const downloadedFiles = Array.isArray(pipelineResult.filesOut?.downloadedFiles)
    ? pipelineResult.filesOut.downloadedFiles
    : [];
  for (const f of downloadedFiles) {
    const localPath = String(f?.localPath || "").trim();
    const publicUrl = String(f?.publicUrl || "").trim();
    if (!localPath || !publicUrl) continue;
    if (unlinkIfEligible(localPath)) deleted.task6Files += 1;
  }

  const reports = Array.isArray(pipelineResult.reportsPayload?.reports)
    ? pipelineResult.reportsPayload.reports
    : [];
  for (const r of reports) {
    const excelPath = String(r?.excelPath || "").trim();
    const excelPublicUrl = String(r?.excelPublicUrl || "").trim();
    if (
      excelPath &&
      excelPath.toLowerCase().endsWith(".xlsx") &&
      excelPublicUrl
    ) {
      if (unlinkIfEligible(excelPath)) deleted.task8Reports += 1;
    }

    const pdfPath = String(r?.pdfPath || "").trim();
    const pdfPublicUrl = String(r?.pdfPublicUrl || "").trim();
    if (pdfPath && pdfPath.toLowerCase().endsWith(".pdf") && pdfPublicUrl) {
      if (unlinkIfEligible(pdfPath)) deleted.task8Reports += 1;
    }
  }

  if (deleted.task6Files || deleted.task8Reports) {
    console.log(
      `[PGC] Success-path local cleanup: task6=${deleted.task6Files}, task8=${deleted.task8Reports}`,
    );
  }
}

/**
 * Map UI scrapeMode (PGC-specific strings from dashboard) to runPgcProductionPipeline skips.
 * Omits unchanged tabs in mapPgcPipelineToPortalData so Supabase merge keeps prior data.
 */
function pgcPipelineOptsFromScrapeMode(scrapeMode) {
  const m = String(scrapeMode ?? "all").trim();
  const none = {
    skipDetail: false,
    skipWorkflow: false,
    skipReview: false,
    skipFiles: false,
    skipReports: false,
  };
  if (m === "scrape_without_files") {
    return { ...none, skipFiles: true };
  }
  if (m === "scrape_files_only") {
    return {
      skipDetail: true,
      skipWorkflow: true,
      skipReview: true,
      skipFiles: false,
      skipReports: true,
    };
  }
  if (m === "scrape_comments_only") {
    return {
      skipDetail: true,
      skipWorkflow: true,
      skipReview: true,
      skipFiles: true,
      skipReports: false,
    };
  }
  if (m === "scrape_review_tab") {
    return {
      skipDetail: true,
      skipWorkflow: false,
      skipReview: false,
      skipFiles: true,
      skipReports: true,
    };
  }
  if (m === "scrape_all" || m === "all") return { ...none };
  if (m === "standard") {
    return { ...none, skipFiles: true };
  }
  if (m === "files") {
    return {
      skipDetail: true,
      skipWorkflow: true,
      skipReview: true,
      skipFiles: false,
      skipReports: true,
    };
  }
  if (m === "comments" || m === "supporting_docs") {
    return {
      skipDetail: true,
      skipWorkflow: true,
      skipReview: true,
      skipFiles: true,
      skipReports: false,
    };
  }
  return { ...none };
}

/**
 * Dev-only harvest limits (explicit request body; ignored in production unless set).
 * @param {unknown} raw
 */
function parsePgcDevHarvestControls(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  };
  const mf = num(raw.maxFolders);
  if (mf != null && mf > 0) out.maxFolders = mf;
  const mfpf = num(raw.maxFilesPerFolder);
  if (mfpf != null && mfpf > 0) out.maxFilesPerFolder = mfpf;
  const sfi = num(raw.startFolderIndex);
  if (sfi != null && sfi > 0) out.startFolderIndex = sfi;
  const sfif = num(raw.startFileIndex);
  if (sfif != null && sfif > 0) out.startFileIndex = sfif;
  if (Array.isArray(raw.explicitFileIds) && raw.explicitFileIds.length > 0) {
    out.explicitFileIds = [
      ...new Set(
        raw.explicitFileIds.map((x) => String(x).trim()).filter(Boolean),
      ),
    ];
  }
  if (process.env.NODE_ENV === "production" && Object.keys(out).length === 0) {
    return null;
  }
  return Object.keys(out).length ? out : null;
}

async function scrapePgcAll(
  session,
  projects,
  _sessionId,
  supabaseProjectId,
  userId,
  scrapeMode,
  extraOpts = {},
) {
  const pgcOpts = pgcPipelineOptsFromScrapeMode(scrapeMode);
  const pgcFilesOnly =
    pgcOpts.skipDetail &&
    !pgcOpts.skipFiles &&
    pgcOpts.skipReports &&
    pgcOpts.skipWorkflow &&
    pgcOpts.skipReview;

  session._scrapeCumulativeBytes = 0;
  session._downloadedHashes = new Map();

  const fileProgress = scrapeFileResults.createFileProgressContext(
    session,
    supabase,
  );
  let uploadedCheckpointMap = new Map();
  if (fileProgress?.scrapeJobId) {
    const priorRows = await scrapeFileResults.listRunFiles(
      supabase,
      fileProgress.scrapeJobId,
    );
    uploadedCheckpointMap =
      scrapeFileResults.buildUploadedCheckpointMap(priorRows);
    if (uploadedCheckpointMap.size > 0) {
      console.log(
        `[PGC] Resuming harvest with ${uploadedCheckpointMap.size} checkpointed file(s)`,
      );
    }
  }

  const devHarvestControls =
    extraOpts.devHarvestControls ||
    parsePgcDevHarvestControls(extraOpts.devHarvestControlsRaw);

  let bases = session.pgcWebUiBases;
  if (!bases || !bases.length) {
    bases = await pgcEplan.resolvePgcWebUiBases(session.page);
    session.pgcWebUiBases = bases;
  }

  const dash = session.dashboardUrl || pgcEplan.PGC_DASHBOARD_URL;

  if (pgcFilesOnly && projects.length === 1 && session.page) {
    const resolved = await pgcEplan.resolvePgcExplicitTargetOnDashboard(
      session.page,
      dash,
      projects[0],
    );
    if (resolved.ok) {
      projects[0] = resolved.target;
    } else {
      session._pgcExplicitTargetResolveFailed = true;
      console.warn(
        `[PGC] Files Only explicit target not resolved on dashboard before harvest | permit=${projects[0].projectNum} projectId=${projects[0].projectId}`,
      );
    }
  }

  const permitSanitize = (s) => {
    const t = String(s || "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, 120);
    return t || "permit";
  };

  for (let i = 0; i < projects.length; i++) {
    if (session._cancelRequested) {
      console.log("   🛑 PGC scrape cancelled");
      session.status = "cancelled";
      return { cancelled: true, withWarnings: !!session._pgcScrapeWarnings };
    }
    const project = projects[i];
    mirrorSessionProgress(session, `${project.projectNum} → PGC harvest`, {
      event_type: "section_started",
      stage: "pgc_harvest",
      user_message: `Opening project ${project.projectNum} in PGC ePlan.`,
      progress_current: session.progress,
      progress_total: session.total,
    });
    console.log(
      `\n🟣 [PGC] [${i + 1}/${projects.length}] ${project.projectNum} (ID ${project.projectId})`,
    );
    let page;
    const ownsPage = !pgcFilesOnly;
    try {
      page = pgcFilesOnly ? session.page : await session.context.newPage();
      if (!page) {
        throw new Error("pgc_browser_page_unavailable");
      }
      const storagePrefix = `drawings/${supabaseProjectId || "pending"}/pgc/${permitSanitize(project.projectNum)}`;
      const uploadLocal = (localPath, key) =>
        pgcUploadLocalToSupabase(session, localPath, key);

      const loginUrlResolved = pgcEplan.resolvePgcLoginUrl(dash);
      const relaunchBrowserAndRecover = async ({
        projectID: _pid,
        project: _proj,
        dashboardUrl: dashUrl,
        reason,
      }) => {
        try {
          if (session.browser) await session.browser.close().catch(() => {});
        } catch (_) {}
        const browser = await launchChromiumForScraper({
          label: "pgc-task6-relaunch",
          file: "server.js",
        });
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          acceptDownloads: true,
        });
        const relPage = await context.newPage();
        session.browser = browser;
        session.context = context;
        session.page = relPage;
        await pgcEplan.performPgcLogin(
          relPage,
          session.username,
          session.password,
          pgcEplan.resolvePgcLoginUrl(dashUrl || dash),
          { credentialsSource: "saved_portal_settings" },
        );
        await pgcEplan.waitForProjectGrid(relPage).catch(() => {});
        session.pgcWebUiBases = await pgcEplan.resolvePgcWebUiBases(relPage);
        scrapeLease.refreshScrapeLease(
          session,
          _sessionId,
          rearmSessionIdleTimeout,
        );
        console.log(`[PGC] Browser relaunched (${reason || "task6"})`);
        return relPage;
      };
      const pipelineResult = await pgcEplan.runPgcProductionPipeline(
        page,
        {
          projectID: String(project.projectId),
          projectNumber: project.projectNum,
          description: project.description,
          location: project.location,
          status: project.status,
        },
        bases,
        dash,
        {
          skipReports: pgcOpts.skipReports,
          skipFiles: pgcOpts.skipFiles,
          skipDetail: pgcOpts.skipDetail,
          skipWorkflow: pgcOpts.skipWorkflow,
          skipReview: pgcOpts.skipReview,
          uploadLocal,
          storagePrefix,
          onScrapeProgress: (event) => {
            if (event.progress_current != null) {
              session.progress = Number(event.progress_current);
            }
            if (event.progress_total != null) {
              session.total = Number(event.progress_total);
            }
            mirrorSessionProgress(
              session,
              String(event.technical_message || event.user_message || "PGC scrape in progress."),
              {
                event_type: String(event.event_type || "section_progress"),
                stage: String(event.stage || "reports"),
                user_message: String(event.user_message || "Working…"),
                status: String(event.status || "running"),
                progress_current: event.progress_current ?? session.progress,
                progress_total: event.progress_total ?? session.total,
                metadata:
                  event.metadata && typeof event.metadata === "object"
                    ? event.metadata
                    : undefined,
              },
            );
          },
          recoveryCredentials:
            session.username &&
            session.password != null &&
            String(session.password) !== ""
              ? {
                  email: String(session.username).trim(),
                  password: session.password,
                  loginUrl: loginUrlResolved,
                  credentialsSource: "saved_portal_settings",
                }
              : null,
          relaunchBrowserAndRecover,
          fileProgress,
          uploadedCheckpointMap,
          devHarvestControls,
          refreshScrapeLease: () =>
            scrapeLease.refreshScrapeLease(
              session,
              _sessionId,
              rearmSessionIdleTimeout,
            ),
          isCancelRequested: () => !!session._cancelRequested,
          onFileAttemptStart: async (fields) => {
            if (!fileProgress) return;
            const base = {
              portalFileId: fields.portalFileId,
              fileVersion: fields.fileVersion,
              fileName: fields.fileName,
              folderName: fields.folderName,
              parentFolder: fields.parentFolder,
            };
            await scrapeFileResults.upsertFileDiscovered(fileProgress, base);
            await scrapeFileResults.markFileDownloading(fileProgress, base);
          },
          onFileFailed: async (fields) => {
            if (!fileProgress) return;
            await scrapeFileResults.markFileFailed(fileProgress, {
              portalFileId: fields.portalFileId,
              fileVersion: fields.fileVersion,
              fileName: fields.fileName,
              folderName: fields.folderName,
              parentFolder: fields.parentFolder,
              failureCode: fields.failureCode,
              failureMessage: fields.failureMessage,
            });
          },
          checkpointFile: async (fields) => {
            if (!fileProgress) return { ok: false };
            const storageKey = fields.storagePath;
            let publicUrl = fields.publicUrl || null;
            if (!publicUrl && fields.localPath && storageKey) {
              publicUrl = await uploadLocal(fields.localPath, storageKey);
            }
            if (!publicUrl) return { ok: false };
            await scrapeFileResults.markFileUploaded(fileProgress, {
              portalFileId: fields.portalFileId,
              fileVersion: fields.fileVersion,
              fileName: fields.fileName,
              folderName: fields.folderName,
              parentFolder: fields.parentFolder,
              storagePath: storageKey,
              publicUrl,
              sourceUrl: fields.sourceUrl,
              mimeType: fields.mimeType,
              sizeBytes: fields.sizeBytes,
              metadata: fields.metadata,
              progressCurrent: fields.progressCurrent,
              progressTotal: fields.progressTotal,
            });
            fileProgress.bumpProgressCurrent();
            return { ok: true, publicUrl };
          },
        },
      );

      if (pipelineResult.filesOut?.filesExtractionFailed) {
        pipelineResult._pgcOmitTabs = {
          ...(pipelineResult._pgcOmitTabs || {}),
          files: true,
        };
        session._pgcScrapeWarnings = true;
        const handoff = !!pipelineResult.filesOut.sessionHandoffFailed;
        mirrorSessionProgress(
          session,
          handoff
            ? `ProjectDox session could not be opened for ${project.projectNum}; previous files were preserved.`
            : `Files tab could not be refreshed for ${project.projectNum}; previous files were preserved.`,
          {
            event_type: "warning",
            stage: "files",
            status: "completed_with_warnings",
            user_message: handoff
              ? `Could not open ${project.projectNum} in ProjectDox (session ended). Previously downloaded files were preserved.`
              : `Files tab could not be refreshed for ${project.projectNum}. Previous files were preserved.`,
            technical_message:
              pipelineResult.filesOut.filesExtractionError ||
              (handoff
                ? "project_dox_session_handoff_failed"
                : "files_tree_not_found"),
          },
        );
      } else if (pipelineResult.filesOut?.filesHarvestAuthoritative === false) {
        pipelineResult._pgcOmitTabs = {
          ...(pipelineResult._pgcOmitTabs || {}),
          files: true,
        };
        session._pgcScrapeWarnings = true;
        const actN =
          pipelineResult.filesOut._meta?.activationFailedFolders?.length ?? 0;
        mirrorSessionProgress(
          session,
          `File downloads could not activate all folders for ${project.projectNum}; previous files were preserved.`,
          {
            event_type: "warning",
            stage: "files",
            status: "completed_with_warnings",
            user_message: `Some file folders could not be opened in the portal for ${project.projectNum}. Previously downloaded files were preserved.`,
            technical_message: `files_harvest_not_authoritative activation_failed_folders=${actN}`,
          },
        );
      }

      session.data[project.id] = await mapPgcPipelineToPortalData(
        project,
        pipelineResult,
      );
      cleanupPgcSuccessLocalArtifacts(pipelineResult);
    } catch (err) {
      console.error(`   ❌ [PGC] ${project.projectNum}:`, err.message);
      session._pgcScrapeWarnings = true;
      session.data[project.id] = await mapPgcPipelineToPortalData(project, {
        _pgcOmitTabs: {
          files: true,
          info: true,
          status: true,
          tasks: true,
          review: true,
          reports: true,
        },
        filesOut: {
          filesExtractionFailed: true,
          sessionHandoffFailed: true,
          filesExtractionError: err.message,
          filesHarvestAuthoritative: false,
        },
      });
    } finally {
      if (ownsPage && page) await page.close().catch(() => {});
    }
    session.progress++;
  }

  mirrorSessionProgress(session, "PGC scraping complete! Syncing...", {
    event_type: "save_started",
    stage: "save",
    user_message: "Saving PGC results to your project.",
  });
  console.log(`\n✅ [PGC] Done! Syncing to Supabase...`);
  const pgcSyncOk = await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    null,
  );

  if (session._cancelRequested) {
    console.log("   🛑 PGC scrape cancelled — not marking as done");
    return { withWarnings: !!session._pgcScrapeWarnings, cancelled: true };
  }
  if (!pgcSyncOk) {
    session.status = "error";
    session.message =
      "PGC scrape finished but Supabase sync failed (check server logs).";
    console.error(`    ❌ PGC Supabase sync failed — session status set to "error"`);
    return { withWarnings: false, syncOk: false };
  }
  const withWarnings = !!session._pgcScrapeWarnings;
  session.status = withWarnings ? "partial_success" : "done";
  mirrorSessionProgress(
    session,
    withWarnings
      ? `PGC complete with warnings: ${projects.length} project(s) synced.`
      : `PGC complete: ${projects.length} project(s) synced.`,
    {
      event_type: withWarnings ? "warning" : "scrape_completed",
      stage: "completed",
      status: withWarnings ? "completed_with_warnings" : "completed",
      user_message: withWarnings
        ? `Scrape completed with warnings. ${projects.length} PGC project(s) saved.`
        : `Scrape completed. ${projects.length} PGC project(s) saved.`,
      progress_current: session.total,
      progress_total: session.total,
    },
  );
  console.log(
    `    ✅ PGC Supabase sync complete — session status set to "${session.status}"`,
  );
  return { withWarnings, syncOk: true };
}

async function scrapeAll(
  session,
  projects,
  sessionId,
  tabsToUse,
  supabaseProjectId,
  userId,
  commentsOnly = false,
  targetFolder = null,
  targetFolders = null,
  filesSyncTargetHint = null,
) {
  const sid = String(sessionId || "");
  session._scrapeActive = true;
  console.log(
    `[Session][scrape] active=true sid=${sid} flow=generic_projectdox`,
  );
  try {
  const tabsFilter =
    tabsToUse && tabsToUse.length > 0 ? new Set(tabsToUse) : null;
  const tabsToScrape = tabsFilter
    ? TAB_DEFS.filter((t) => tabsFilter.has(t.key))
    : TAB_DEFS;

  session._scrapeCumulativeBytes = 0;
  session._downloadedHashes = new Map();

  console.log(`\n🔍 Scraping ${projects.length} projects...`);

  for (let pi = 0; pi < projects.length; pi++) {
    if (session._cancelRequested) {
      console.log("   🛑 Scrape cancelled by user — aborting project loop");
      return;
    }
    const project = projects[pi];
    console.log(
      `\n📂 [${pi + 1}/${projects.length}] ${project.projectNum} (ID: ${project.projectId})`,
    );
    session.data[project.id] = {
      name: project.name,
      projectNum: project.projectNum,
      description: project.description || "",
      location: project.location || "",
      dashboardStatus: project.status || "",
      portalType: session.portalType || "projectdox",
      tabs: {},
    };

    for (const tab of tabsToScrape) {
      if (session._cancelRequested) {
        console.log("   🛑 Scrape cancelled by user — aborting tab loop");
        return;
      }
      let targetLabel = null;
      if (tab.key === "files") {
        if (filesSyncTargetHint) {
          targetLabel = `Targeting: ${String(filesSyncTargetHint).split("|").join(", ")}`;
        } else if (targetFolder === "supporting_docs") {
          targetLabel = "Targeting: Supporting Documents";
        }
      }
      mirrorSessionProgress(
        session,
        targetLabel
          ? `${project.projectNum} → ${targetLabel}`
          : `${project.projectNum} → ${tab.label}`,
        {
          event_type: "section_started",
          stage: tab.key,
          user_message: targetLabel
            ? `Opening ${tab.label} (${targetLabel.replace(/^Targeting:\s*/i, "")}).`
            : `Opening ${tab.label}.`,
          progress_current: session.progress,
          progress_total: session.total,
        },
      );
      console.log(`   📑 ${tab.label}...${targetLabel ? ` (${targetLabel})` : ""}`);

      let context = session.context;
      let page;
      try {
        page = await context.newPage();
        const webUiUrl = `${session.webUiBase}/WebForms/Frame.aspx?tab=${tab.param}&ProjectID=${project.projectId}`;
        await page.goto(webUiUrl, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(2000);

        let pUrl = page.url();
        console.log(`     [DEBUG] ${tab.label} tab page URL: ${pUrl}`);
        if (pUrl.includes("SessionEnded") || pUrl.includes("b2clogin") || pUrl.includes("Login")) {
          console.log(`     ⚠️ Session expired on ${tab.label} tab (URL: ${pUrl}). Attempting re-login...`);
          try {
            await reinitializeBrowser(session);
            context = session.context;
            await page.close().catch(() => {});
            page = await context.newPage();
            const retryUrl = `${session.webUiBase}/WebForms/Frame.aspx?tab=${tab.param}&ProjectID=${project.projectId}`;
            await page.goto(retryUrl, { waitUntil: "networkidle", timeout: 90000 });
            await page.waitForTimeout(2000);
            pUrl = page.url();
            console.log(`     [DEBUG] ${tab.label} tab page URL after re-login: ${pUrl}`);
            if (pUrl.includes("SessionEnded") || pUrl.includes("b2clogin") || pUrl.includes("Login")) {
              console.log(`     ❌ Session still expired after re-login for ${tab.label} tab. Skipping extraction.`);
              const errTab = { error: "session_expired", keyValues: [], tables: [], links: [] };
              if (tab.key === "reports") errTab.pdfs = [];
              if (tab.key === "files") errTab.folders = [];
              session.data[project.id].tabs[tab.key] = errTab;
              if (page) await page.close().catch(() => {});
              session.progress++;
              continue;
            }
          } catch (reLoginErr) {
            console.log(`     ❌ Re-login failed for ${tab.label} tab: ${reLoginErr.message}`);
            const errTab = { error: "session_expired_relogin_failed", keyValues: [], tables: [], links: [] };
            if (tab.key === "reports") errTab.pdfs = [];
            if (tab.key === "files") errTab.folders = [];
            session.data[project.id].tabs[tab.key] = errTab;
            if (page) await page.close().catch(() => {});
            session.progress++;
            continue;
          }
        }

        // Ensure correct tab content is loaded
        if (tab.key === "info") {
          // ProjectDox Info tab has a "Project Info" sub-tab that needs clicking
          const projectInfoTab = await page.$(
            'a:has-text("Project Info"), [id*="projectInfo"], a[href*="projectInfo"]',
          );
          if (projectInfoTab) {
            console.log("     Clicking 'Project Info' sub-tab...");
            await projectInfoTab.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
          // Also try clicking the Info tab itself in case page loaded on wrong tab
          const infoTabLink = await page.$(
            'a[href*="infoTab"]:not([class*="active"]), li:not(.active) > a:has-text("Info")',
          );
          if (infoTabLink) {
            console.log("     Clicking 'Info' tab link...");
            await infoTabLink.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
        }

        if (tab.key === "reports") {
          // Make sure Reports tab content is loaded
          const reportsTabLink = await page.$(
            'a[href*="reportsTab"]:not([class*="active"]), li:not(.active) > a:has-text("Reports")',
          );
          if (reportsTabLink) {
            console.log("     Clicking 'Reports' tab link...");
            await reportsTabLink.click().catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForLoadState("networkidle").catch(() => {});
          }
        }

        const tabData = await extractPageData(page);
        if (tab.key === "status") {
          const refined = await extractProjectDoxStatusKeyValues(page);
          if (refined.length > 0) {
            const workflow = (tabData.keyValues || []).find((kv) =>
              /^workflow$/i.test(String(kv.key || "").trim()),
            );
            tabData.keyValues = refined;
            if (
              workflow &&
              !refined.some((kv) =>
                /^workflow$/i.test(String(kv.key || "").trim()),
              )
            ) {
              tabData.keyValues = [workflow, ...refined];
            }
            tabData.tables = [];
            console.log(
              `      📋 Status tab: using table-based keyValues (${tabData.keyValues.length} fields); cleared duplicate tables`,
            );
          }
        }
        if (tab.key === "info") {
          await page.waitForSelector("table tr", { timeout: 15000 }).catch(() => {
            console.log("     ⚠️ No table rows found on Info tab within 15s — page may be empty after session recovery");
          });
          const infoKeyValues = await page.evaluate(() => {
            const kvs = [];
            const seen = new Set();

            // The Project Info table has 2-column rows: label cell and value cell
            // Labels are bold text ending with ":"
            const allRows = document.querySelectorAll("table tr");

            for (const tr of allRows) {
              const cells = tr.querySelectorAll("td");
              // Support both 2-cell rows and 1-cell rows (empty value cell missing in DOM)
              if (cells.length < 1) continue;

              const labelCell = cells[0];
              const valueCell = cells.length >= 2 ? cells[1] : null;

              const boldEl = labelCell.querySelector("b, strong");
              let label = "";
              if (boldEl) {
                label = boldEl.textContent.trim();
              } else {
                label = labelCell.textContent.trim();
              }

              label = label.replace(/:$/, "").trim();

              if (!label || label.length > 50 || seen.has(label)) continue;
              if (label.toLowerCase().includes("filter")) continue;
              if (label.toLowerCase().includes("select")) continue;

              const rawValue = valueCell
                ? valueCell.textContent.trim().replace(/\s+/g, " ").trim()
                : "";
              const value = (rawValue || "").replace(/\u00a0/g, "").trim();

              seen.add(label);
              kvs.push({ key: label, value: value });
            }

            return kvs;
          });

          // DEBUG: log raw Project Info extraction for alignment bug (Cell Phone blank)
          console.log(
            "     [DEBUG] infoKeyValues count:",
            infoKeyValues.length,
          );
          const cellPhoneEntry = infoKeyValues.find((kv) =>
            /cell\s*phone/i.test(kv.key),
          );
          console.log(
            "     [DEBUG] Cell Phone in raw list:",
            cellPhoneEntry
              ? {
                  key: cellPhoneEntry.key,
                  valueLength: cellPhoneEntry.value?.length,
                  valuePreview: (cellPhoneEntry.value || "").slice(0, 20),
                }
              : "NOT FOUND",
          );
          console.log(
            "     [DEBUG] All keys in order:",
            infoKeyValues.map((k) => k.key),
          );

          // Filter out noise but keep Description (allow up to 1000 chars)
          const cleanKvs = infoKeyValues.filter((kv) => {
            if (kv.key === "") return false;
            if (kv.value.includes("Select One")) return false;
            if (kv.value.length > 1000) return false;
            return true;
          });

          // DC ProjectDox often produces malformed projectInfo (values as keys). Frontend will use
          // tabs.info.tables + portalData instead. Skip writing projectInfo when extraction looks wrong.
          const firstKey = cleanKvs[0]?.key ?? "";
          const looksLikePermitNumber =
            /^[A-Z]\d{6,}$/.test(firstKey.trim()) ||
            firstKey === project.projectNum;
          const looksLikeValueNotLabel = cleanKvs.some(
            (kv) => kv.key?.length > 50 || /^\d+$/.test(kv.key?.trim()),
          );
          const skipProjectInfo =
            looksLikePermitNumber || looksLikeValueNotLabel;

          if (cleanKvs.length > 0 && !skipProjectInfo) {
            console.log(
              `      📋 Extracted ${cleanKvs.length} Project Info fields: ${cleanKvs.map((k) => k.key).join(", ")}`,
            );
            tabData.projectInfo = cleanKvs;
          } else if (skipProjectInfo) {
            console.log(
              `      📋 Skipping projectInfo (DC ProjectDox-style extraction); frontend will use tables + portalData`,
            );
          }

          // Filter out malformed tables (those with huge headers > 100 chars)
          tabData.tables = (tabData.tables || []).filter((tbl) => {
            const hasHugeHeader = tbl.headers?.some((h) => h.length > 100);
            return !hasHugeHeader;
          });
        }
        if (tab.key === "files") {
          const filesResult = await extractFilesTab(
            page,
            context,
            session,
            commentsOnly,
            supabaseProjectId,
            targetFolder,
            { project, projects, userId },
            targetFolders,
            filesSyncTargetHint,
          );
          tabData.folders = filesResult.folders;
          if (filesResult.filesScrapeStatus) {
            tabData.filesScrapeStatus = filesResult.filesScrapeStatus;
          }
          const totalFiles = filesResult.folders.reduce(
            (s, f) => s + f.files.length,
            0,
          );
          const totalComments = filesResult.folders.reduce(
            (s, f) => s + f.files.reduce((s2, fi) => s2 + fi.commentCount, 0),
            0,
          );
          console.log(
            `      ✓ ${filesResult.folders.length} folders, ${totalFiles} files, ${totalComments} comments`,
          );
        } else if (tab.key === "reports") {
          const pdfs = await extractPDFsFromPage(page, context, {
            supabaseProjectId,
            project,
          });
          tabData.pdfs = pdfs;
          tabData.reportEntries = pdfs.map((p) => {
            const viewerUrl = p.url || null;
            const reportUrl = p.url || null;
            return {
              fileSlug: sanitizeStorageKey(p.fileName || "report"),
              reportName: p.fileName || "Report",
              reportType: "",
              reportDescription: "",
              reportUrl,
              viewerUrl,
              viewerReady: !!viewerUrl,
              pdfUrl: p.pdfPublicUrl || null,
              excelUrl: p.excelPublicUrl || null,
              excelDownloaded: !!p.excelPublicUrl,
              pdfDownloaded: !!p.pdfPublicUrl,
              exportUnavailable: !p.pdfPublicUrl && !p.excelPublicUrl,
              flags: {
                viewerUrlResolved: !!(
                  viewerUrl && /^https?:\/\//i.test(String(viewerUrl))
                ),
              },
            };
          });
          console.log(
            `      ✓ ${tabData.keyValues.length} fields, ${tabData.tables.length} tables, ${pdfs.length} PDFs, ${tabData.reportEntries.length} reportEntries`,
          );
        } else {
          console.log(
            `      ✓ ${tabData.keyValues.length} fields, ${tabData.tables.length} tables`,
          );
        }
        session.data[project.id].tabs[tab.key] = tabData;
      } catch (err) {
        console.error(`      ✗ ${err.message}`);
        const errTab = {
          error: err.message,
          keyValues: [],
          tables: [],
          links: [],
        };
        if (tab.key === "reports") errTab.pdfs = [];
        if (tab.key === "files") errTab.folders = [];
        session.data[project.id].tabs[tab.key] = errTab;

        if (isTargetClosedError(err)) {
          console.log(`      🔄 Browser crashed during ${tab.label} tab, attempting recovery...`);
          try {
            await reinitializeBrowser(session);
            console.log(`      ✅ Browser recovered for next tab`);
          } catch (recErr) {
            console.log(`      ❌ Browser recovery failed: ${recErr.message}`);
          }
        }
      }
      if (page) await page.close().catch(() => {});
      context = session.context;
      session.progress++;
    }
  }

  mirrorSessionProgress(session, "Scraping complete! Syncing to database...", {
    event_type: "save_started",
    stage: "save",
    user_message: "Saving results to your project.",
  });
  console.log(`\n✅ Done! Syncing to Supabase...`);

  const genericSyncOk = await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    filesSyncTargetHint || targetFolder,
  );

  if (session._cancelRequested) {
    console.log("   🛑 Scrape was cancelled — not marking as done");
    return;
  }
  if (!genericSyncOk) {
    session.status = "error";
    mirrorSessionProgress(
      session,
      "Scraping finished but Supabase sync failed (check server logs).",
      {
        event_type: "scrape_failed",
        stage: "save",
        status: "failed",
        user_message: "Results could not be saved. Please try again.",
      },
    );
    console.error(
      `    ❌ Supabase sync failed — session status set to "error"`,
    );
    return;
  }
  session.status = "done";
  mirrorSessionProgress(
    session,
    `Scraping complete! ${projects.length} projects extracted and synced.`,
    {
      event_type: "scrape_completed",
      stage: "completed",
      status: "completed",
      user_message: `Scrape completed. ${projects.length} project(s) saved.`,
      progress_current: session.total,
      progress_total: session.total,
    },
  );
  console.log(`    ✅ Supabase sync complete — session status set to "done"`);
  } finally {
    session._scrapeActive = false;
    console.log(
      `[Session][scrape] active=false sid=${sid} flow=generic_projectdox`,
    );
  }
}

function escapeCSSId(str) {
  return str.replace(/([^\w-])/g, "\\$1");
}

const MINI_RESET_INTERVAL = 10;

async function isPageAlive(pg) {
  try {
    await pg.evaluate(() => true);
    return true;
  } catch { return false; }
}

function isTargetClosedError(err) {
  const msg = (err && err.message || '').toLowerCase();
  return msg.includes('target closed') ||
    msg.includes('has been closed') ||
    msg.includes('session closed') ||
    msg.includes('browser disconnected') ||
    msg.includes('connection refused') ||
    msg.includes('browser has been closed') ||
    msg.includes('context has been closed');
}

async function reinitializeBrowser(session) {
  console.log('   🔄 Re-initializing browser after crash...');
  try { if (session.browser) await session.browser.close().catch(() => {}); } catch (_) {}
  const browser = await launchChromiumForScraper({ label: "reinitialize", route: "reinitializeBrowser", file: "server.js" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  let loginPage = await context.newPage();
  if (session.portalType === 'accela') {
    await accelaScraperLogin(loginPage, session.username, session.password, session.dashboardUrl);
  } else if (session.portalSubtype === 'pgc-eplan') {
    const loginUrlResolved = pgcEplan.resolvePgcLoginUrl(session.dashboardUrl);
    await pgcEplan.performPgcLogin(
      loginPage,
      session.username,
      session.password,
      loginUrlResolved,
      { credentialsSource: "saved_portal_settings" },
    );
    const dash = session.dashboardUrl || pgcEplan.PGC_DASHBOARD_URL;
    await loginPage.goto(dash, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await pgcEplan.waitForProjectGrid(loginPage).catch(() => {});
    try {
      const bases = await pgcEplan.resolvePgcWebUiBases(loginPage);
      if (bases?.length) session.pgcWebUiBases = bases;
    } catch (_) {}
  } else if (session.portalSubtype === "montgomery-projectdox") {
    await performMontgomeryPortalLogin(
      loginPage,
      session.username,
      session.password,
      session.dashboardUrl,
    );
    await montgomeryDashboardDiscovery
      .ensureMontgomeryPostLoginDashboard(loginPage, session.dashboardUrl)
      .catch((e) => {
        console.warn(
          "[Montgomery][post-login] reinit:",
          (e && e.message) || e,
        );
      });
    await loginPage.waitForTimeout(500);
    try {
      const bases = await montgomeryProjectDox.resolveMontgomeryWebUiBases(loginPage);
      if (bases?.length) session.montgomeryWebUiBases = bases;
    } catch (_) {}
  } else if (session.portalSubtype === "howard-projectdox") {
    await performHowardPortalLogin(
      loginPage,
      session.username,
      session.password,
      session.dashboardUrl,
    );
    const howardPdx = await bootstrapHowardProjectDoxFromPortal(loginPage, context);
    await loginPage.close().catch(() => {});
    loginPage = howardPdx;
    await loginPage.waitForTimeout(500);
    try {
      const hb = await howardProjectDox.resolveHowardWebUiBases(loginPage);
      if (hb?.length) session.howardWebUiBases = hb;
    } catch (_) {}
  } else {
    await performLogin(loginPage, session.username, session.password, session.dashboardUrl);
  }
  if (session.projects && session.projects.length > 0) {
    const firstProjectId = session.projects[0].projectId;
    if (firstProjectId) {
      const testPage = await context.newPage();
      let warmupUrl = null;
      if (session.portalSubtype === "pgc-eplan") {
        warmupUrl = pgcEplan.buildPgcTabUrl(firstProjectId, "projectStatusTab");
      } else if (
        session.portalSubtype === "montgomery-projectdox" &&
        session.webUiBase
      ) {
        warmupUrl = montgomeryProjectDox.buildMontgomeryProjectTabUrl(
          session.webUiBase,
          firstProjectId,
          "projectStatusTab",
        );
      } else if (
        session.portalSubtype === "howard-projectdox" &&
        session.webUiBase
      ) {
        warmupUrl = howardProjectDox.buildHowardProjectTabUrl(
          session.webUiBase,
          firstProjectId,
          "projectStatusTab",
        );
      } else if (session.webUiBase) {
        warmupUrl = `${session.webUiBase}/WebForms/Frame.aspx?tab=projectStatusTab&ProjectID=${firstProjectId}`;
      }
      if (warmupUrl) {
        await testPage
          .goto(warmupUrl, { waitUntil: "networkidle", timeout: 90000 })
          .catch(() => {});
      await testPage.waitForTimeout(2000);
      }
      await testPage.close();
    }
  }
  session.browser = browser;
  session.context = context;
  session.page = loginPage;
  console.log('   ✅ Browser re-initialized successfully');
  return { browser, context };
}

async function recreateFilesPage(context, webUiBase, pdxProjectId, folderInfo) {
  const pages = context.pages();
  for (let i = pages.length - 1; i >= 1; i--) {
    await pages[i].close().catch(() => {});
  }
  const freshPage = await context.newPage();
  const url = `${webUiBase}/WebForms/Frame.aspx?tab=filesTab&ProjectID=${pdxProjectId}`;
  await freshPage.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await freshPage.waitForTimeout(2000);
  if (
    folderInfo &&
    (folderInfo.path || folderInfo.value || folderInfo.text)
  ) {
    if (folderInfo.path) {
      const selector = folderInfo.path.startsWith("#")
        ? `${folderInfo.path} a`
        : `#folderTree li[data-path="${folderInfo.path}"] a`;
      await freshPage.click(selector).catch(async () => {
        const allLinks = await freshPage.$$("a");
        for (const link of allLinks) {
          const t = await link.textContent().catch(() => "");
          if (t.trim() === folderInfo.text) {
            await link.click();
            break;
          }
        }
      });
    } else if (folderInfo.value && String(folderInfo.value).trim()) {
      const v = String(folderInfo.value).trim();
      try {
        await freshPage.evaluate((folderValue) => {
          for (const li of document.querySelectorAll(
            "#folderTree li.ui-igtree-node",
          )) {
            if (li.getAttribute("data-value") !== String(folderValue)) continue;
            const a = li.querySelector("a");
            if (a) {
              a.click();
              return;
            }
          }
        }, v);
      } catch (_) {}
    } else if (folderInfo.text) {
      const allLinks = await freshPage.$$("a");
      for (const link of allLinks) {
        const t = await link.textContent().catch(() => "");
        if (t.trim() === folderInfo.text) {
          await link.click();
          break;
        }
      }
    }
    await freshPage
      .waitForSelector(".ui-iggrid-table tbody tr", { timeout: 60000 })
      .catch(() => {});
    await freshPage.waitForTimeout(2000);
  }
  return freshPage;
}

async function recoverPage(context, session, webUiBase, pdxProjectId, folderInfo) {
  try {
    const freshPage = await recreateFilesPage(context, webUiBase, pdxProjectId, folderInfo);
    return { page: freshPage, context };
  } catch (err) {
    if (isTargetClosedError(err)) {
      console.log('       🔄 Context also dead, re-initializing browser...');
      const reInit = await reinitializeBrowser(session);
      const freshPage = await recreateFilesPage(reInit.context, webUiBase, pdxProjectId, folderInfo);
      return { page: freshPage, context: reInit.context };
    }
    throw err;
  }
}

/** Dismiss Infragistics modal overlays that block folder/file clicks after viewer popups or errors. */
async function dismissProjectDoxFilesUiBlockers(page) {
  if (!page || page.isClosed?.()) return;
  try {
    await page.keyboard.press("Escape");
  } catch (_) {}
  try {
    await page.evaluate(() => {
      document
        .querySelectorAll(
          ".ui-igdialog-overlay, .ui-widget-overlay.ui-front, .ui-iggrid .ui-widget-overlay",
        )
        .forEach((el) => {
          try {
            el.remove();
          } catch (_) {}
        });
    });
  } catch (_) {}
  try {
    const closeBtn = await page
      .$(".ui-dialog-titlebar-close, [aria-label='Close'], button[title*='Close' i]")
      .catch(() => null);
    if (closeBtn) await closeBtn.click({ timeout: 2000 }).catch(() => {});
  } catch (_) {}
}

const MONTGOMERY_FILES_FOLDER_ALLOWLIST = [
  "Drawings",
  "Zoning Drawings",
  "Documents",
  "Supporting Documentation",
  "Approved",
  "Rejected",
  "Revisions",
  "Inspection Reports",
];

function normalizeProjectDoxFolderLabel(label) {
  return String(label || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\((?:\d+(?:\s*-\s*\d+\s*New)?)\)\s*$/i, "")
    .trim();
}

function normalizeProjectDoxDisplayLabel(label) {
  return String(label || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProjectDoxFileKeyPart(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isMontgomeryKnownFolderName(name) {
  return MONTGOMERY_FILES_FOLDER_ALLOWLIST.some(
    (allowed) =>
      normalizeProjectDoxFileKeyPart(allowed) ===
      normalizeProjectDoxFileKeyPart(name),
  );
}

function extractMontgomeryFolderExpectedCount(displayLabel) {
  const m = String(displayLabel || "").match(/\((\d+)(?:\s*-\s*\d+\s*New)?\)/i);
  return m ? parseInt(m[1], 10) : null;
}

function isMontgomeryRootFolderCandidate(folder, project) {
  const key = normalizeProjectDoxFolderLabel(
    folder?.displayName || folder?.name || "",
  );
  const projectNum = normalizeProjectDoxFolderLabel(
    project?.projectNumber || project?.projectNum || "",
  );
  if (!key || !projectNum) return false;
  return key === projectNum;
}

function isMontgomeryPlaceholderFileRow(file, folderDisplayName = "") {
  const name = normalizeProjectDoxDisplayLabel(file?.name || "");
  if (!name) return true;
  if (
    /^(upload files|upload|refresh|download selected version|open file for viewing|view file|select version)$/i.test(
      name,
    )
  ) {
    return true;
  }
  if (
    normalizeProjectDoxFolderLabel(name) ===
      normalizeProjectDoxFolderLabel(folderDisplayName) &&
    !String(file?.id || "").trim() &&
    !String(file?.status || "").trim() &&
    !String(file?.version || "").trim() &&
    !String(file?.reviewedBy || "").trim() &&
    !String(file?.uploadedDate || "").trim()
  ) {
    return true;
  }
  return false;
}

function pickValueByPatterns(record, patterns) {
  if (!record || typeof record !== "object") return "";
  const keys = Object.keys(record);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k));
    if (key && record[key] != null && String(record[key]).trim()) {
      return String(record[key]).trim();
    }
  }
  return "";
}

function buildMontgomeryFilesDedupeKey(file, folderName) {
  if (file?.id) return `id:${String(file.id).trim()}`;
  const name = normalizeProjectDoxFileKeyPart(file?.name);
  if (!name) return "";
  const version = normalizeProjectDoxFileKeyPart(file?.version);
  const status = normalizeProjectDoxFileKeyPart(file?.status);
  const uploadedDate = normalizeProjectDoxFileKeyPart(file?.uploadedDate);
  const parts = [`name:${name}`];
  if (version) parts.push(`version:${version}`);
  else if (status) parts.push(`status:${status}`);
  if (uploadedDate) parts.push(`date:${uploadedDate}`);
  if (!version && !status && !uploadedDate) {
    parts.push(`folder:${normalizeProjectDoxFileKeyPart(folderName)}`);
  }
  return parts.join("|");
}

async function readMontgomeryFilesGridState(page) {
  return await page.evaluate(() => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function cleanLabel(s) {
      return norm(s)
        .replace(/\s*\((?:\d+(?:\s*-\s*\d+\s*New)?)\)\s*$/i, "")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden";
    }
    function isPlaceholderName(s) {
      return /^(upload files|upload|refresh|download selected version|open file for viewing|view file|select version)$/i.test(
        norm(s),
      );
    }
    const rowNodes = Array.from(
      document.querySelectorAll(
        "#filesTab .ui-iggrid-table tbody tr, .ui-iggrid-table tbody tr, #filesTab table tbody tr",
      ),
    ).filter((tr) => isVisible(tr) && tr.querySelectorAll("td").length > 0);
    const rowSample = rowNodes
      .slice(0, 5)
      .map((tr) =>
        norm(
          Array.from(tr.querySelectorAll("td"))
            .map((td) => td.textContent || "")
            .join("|"),
        ),
      )
      .join("||");
    const selectedNode = Array.from(
      document.querySelectorAll("#folderTree li.ui-igtree-node, #folderTree .ui-igtree-node"),
    ).find((node) => {
      const cls = node.className || "";
      return (
        node.getAttribute("aria-selected") === "true" ||
        /selected|active|current/i.test(cls)
      );
    });
    const loading = !!document.querySelector(
      ".ui-iggrid-loading, .ui-igloading, .ui-iggrid .ui-widget-overlay, [aria-busy='true']",
    );
    let dataSourceCount = 0;
    try {
      const grid = Array.from(document.querySelectorAll(".ui-iggrid")).find(isVisible);
      const $ = window.jQuery || window.$;
      if ($ && grid && $(grid).data("igGrid")) {
        const gridApi = $(grid).data("igGrid");
        const raw =
          (gridApi?.dataSource?.dataView && gridApi.dataSource.dataView()) ||
          $(grid).igGrid("option", "dataSource") ||
          [];
        if (Array.isArray(raw)) {
          dataSourceCount = raw.filter((row) => {
            const name =
              norm(row?.FileName || row?.DocumentName || row?.Name || row?.File || "");
            return name && !isPlaceholderName(name);
          }).length;
        }
      }
    } catch (_) {}
    return {
      rowCount: rowNodes.length,
      dataSourceCount,
      selectedFolder: cleanLabel(selectedNode?.textContent || ""),
      loading,
      signature: `${rowNodes.length}::${dataSourceCount}::${rowSample}`,
    };
  });
}

async function waitForMontgomeryFilesGridToSettle(
  page,
  folder,
  previousSignature = "",
  timeoutMs = 12000,
) {
  const expected = normalizeProjectDoxFolderLabel(
    folder?.displayName || folder?.name || "",
  );
  const expectedCount = extractMontgomeryFolderExpectedCount(
    folder?.displayName || folder?.name || "",
  );
  const started = Date.now();
  let lastSignature = "";
  let stablePasses = 0;
  let lastState = null;

  while (Date.now() - started < timeoutMs) {
    const state = await readMontgomeryFilesGridState(page);
    const folderMatches =
      !expected || !state.selectedFolder || state.selectedFolder === expected;
    const changed =
      !previousSignature ||
      state.signature !== previousSignature ||
      state.selectedFolder === expected;
    const hasRealRows =
      (state.dataSourceCount || 0) > 0 || (state.rowCount || 0) > 0;
    const rowsReady =
      expectedCount == null || expectedCount === 0 ? true : hasRealRows;
    if (!state.loading && folderMatches && changed && rowsReady) {
      if (state.signature === lastSignature) stablePasses += 1;
      else stablePasses = 1;
      if (stablePasses >= 2) return state;
    } else {
      stablePasses = 0;
    }
    lastSignature = state.signature;
    lastState = state;
    await page.waitForTimeout(350);
  }

  return lastState || (await readMontgomeryFilesGridState(page));
}

async function discoverMontgomeryFilesFolders(page) {
  const allowed = MONTGOMERY_FILES_FOLDER_ALLOWLIST.map((name) => name.toLowerCase());
  const discovered = await page.evaluate((allowedNames) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function cleanLabel(s) {
      return norm(s)
        .replace(/\s*\((?:\d+(?:\s*-\s*\d+\s*New)?)\)\s*$/i, "")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden";
    }
    const nodes = Array.from(
      document.querySelectorAll("#folderTree li.ui-igtree-node, #folderTree .ui-igtree-node"),
    );
    const out = [];
    const seen = new Set();
    nodes.forEach((node, index) => {
      if (!isVisible(node)) return;
      const anchor =
        node.querySelector("a") ||
        node.querySelector(".ui-igtree-text") ||
        node.querySelector("span");
      const text = norm(anchor?.textContent || node.textContent || "");
      const name = cleanLabel(text);
      if (!name) return;
      const key = `${String(node.getAttribute("data-value") || "").trim()}::${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        index,
        name,
        displayName: text,
        folderId: String(node.getAttribute("data-value") || node.dataset?.value || "").trim(),
        dataPath: String(node.getAttribute("data-path") || "").trim(),
        allowed: allowedNames.includes(name.toLowerCase()),
      });
    });
    return out;
  }, allowed);

  const allowedFolders = discovered.filter((folder) => folder.allowed);
  const otherFolders = discovered.filter((folder) => !folder.allowed);
  return allowedFolders.length > 0
    ? [...allowedFolders, ...otherFolders]
    : discovered;
}

async function clickMontgomeryFilesFolder(page, folder) {
  const previousState = await readMontgomeryFilesGridState(page);
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const url = response.url();
        if (!/\/File\/GetFolderFiles\?/i.test(url)) return false;
        if (folder.folderId && !url.includes(`folderID=${folder.folderId}`)) return false;
        return true;
      },
      { timeout: 8000 },
    )
    .catch(() => null);

  const clicked = await page.evaluate((target) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function cleanLabel(s) {
      return norm(s)
        .replace(/\s*\((?:\d+(?:\s*-\s*\d+\s*New)?)\)\s*$/i, "")
        .trim();
    }
    const nodes = Array.from(
      document.querySelectorAll("#folderTree li.ui-igtree-node, #folderTree .ui-igtree-node"),
    );
    const exact = nodes.find((node) => {
      const nodeId = String(node.getAttribute("data-value") || node.dataset?.value || "").trim();
      const name = cleanLabel(node.textContent || "");
      return (
        (target.folderId && nodeId === String(target.folderId)) ||
        name === target.name
      );
    });
    const node = exact || nodes[target.index] || null;
    if (!node) return false;
    const clickTarget =
      node.querySelector("a") ||
      node.querySelector(".ui-igtree-text") ||
      node.querySelector("span") ||
      node;
    ["mouseover", "mousedown", "mouseup", "click"].forEach((type) => {
      clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    });
    if (typeof clickTarget.click === "function") clickTarget.click();
    return true;
  }, folder);

  if (!clicked) {
    throw new Error(`folder_click_failed:${folder.name}`);
  }

  const response = await responsePromise;
  let ajaxPayload = null;
  if (response) {
    ajaxPayload = await response.json().catch(() => null);
    await response.finished().catch(() => {});
  } else {
    await page.waitForTimeout(500);
  }

  const settled = await waitForMontgomeryFilesGridToSettle(
    page,
    folder,
    previousState.signature,
  );
  const selected = await getMontgomerySelectedFolderSnapshot(page);
  return { settled, ajaxPayload, selected };
}

function shapeMontgomeryAjaxFileRows(payload, folderDisplayName) {
  const items = Array.isArray(payload?.Items)
    ? payload.Items
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  return items.map((item) => ({
    name:
      pickValueByPatterns(item, [/^FileName$/i, /^DocumentName$/i, /^Name$/i]) ||
      "",
    id:
      pickValueByPatterns(item, [
        /^FileID$/i,
        /^fileId$/i,
        /^DocumentID$/i,
        /^ID$/i,
      ]) || "",
    status:
      pickValueByPatterns(item, [/^Status$/i, /ReviewStatus/i, /State/i]) || "",
    version:
      pickValueByPatterns(item, [/^Version$/i, /^Revision$/i]) || "",
    reviewedBy:
      pickValueByPatterns(item, [/^OrigAuthor$/i, /^UploadedBy$/i, /Reviewer/i]) ||
      "",
    uploadedDate:
      pickValueByPatterns(item, [/^UploadDate$/i, /^CreatedDate$/i, /Date/i]) ||
      "",
    fileSizeKB:
      Number(
        pickValueByPatterns(item, [/^FileSizeKB$/i, /^SizeKB$/i, /^Size$/i]) ||
          "",
      ) || null,
    downloadUrl:
      pickValueByPatterns(item, [/^URL$/i, /^DownloadURL$/i, /^ViewURL$/i]) ||
      "",
    folderName: folderDisplayName,
  }));
}

function mergeMontgomeryFileRows(sources, folderDisplayName) {
  const merged = new Map();
  let placeholderCount = 0;

  for (const source of sources) {
    for (const candidate of source || []) {
      const row = {
        name: normalizeProjectDoxDisplayLabel(candidate?.name || ""),
        id: String(candidate?.id || "").trim(),
        status: normalizeProjectDoxDisplayLabel(candidate?.status || ""),
        version: normalizeProjectDoxDisplayLabel(candidate?.version || ""),
        reviewedBy: normalizeProjectDoxDisplayLabel(candidate?.reviewedBy || ""),
        uploadedDate: normalizeProjectDoxDisplayLabel(candidate?.uploadedDate || ""),
        fileSizeKB:
          candidate?.fileSizeKB != null && candidate.fileSizeKB !== ""
            ? Number(candidate.fileSizeKB) || null
            : null,
        downloadUrl: String(candidate?.downloadUrl || "").trim(),
      };

      if (isMontgomeryPlaceholderFileRow(row, folderDisplayName)) {
        placeholderCount += 1;
        continue;
      }

      const key = buildMontgomeryFilesDedupeKey(row, folderDisplayName);
      if (!key) continue;

      const prev = merged.get(key) || {
        name: "",
        id: "",
        status: "",
        version: "",
        reviewedBy: "",
        uploadedDate: "",
        fileSizeKB: null,
        downloadUrl: "",
      };

      merged.set(key, {
        name: prev.name || row.name,
        id: prev.id || row.id,
        status: prev.status || row.status,
        version: prev.version || row.version,
        reviewedBy: prev.reviewedBy || row.reviewedBy,
        uploadedDate: prev.uploadedDate || row.uploadedDate,
        fileSizeKB: prev.fileSizeKB ?? row.fileSizeKB,
        downloadUrl: prev.downloadUrl || row.downloadUrl,
      });
    }
  }

  return { rows: [...merged.values()], placeholderCount };
}

function countMontgomeryFolderPayloadRows(payload) {
  return Array.isArray(payload?.Items)
    ? payload.Items.length
    : Array.isArray(payload?.items)
      ? payload.items.length
      : 0;
}

async function fetchMontgomeryFolderFilesPayload(page, projectID, folderId) {
  if (!projectID || !folderId) return null;
  return await page.evaluate(
    async ({ projectID: pid, folderId: fid }) => {
      const url = new URL("/File/GetFolderFiles", window.location.origin);
      url.searchParams.set("folderID", String(fid));
      url.searchParams.set("projectID", String(pid));
      url.searchParams.set("pageIndex", "0");
      url.searchParams.set("pageSize", "999");
      url.searchParams.set("listMode", "3");
      const r = await fetch(url.toString(), {
        credentials: "include",
        cache: "no-store",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    },
    { projectID, folderId },
  ).catch(() => null);
}

async function getMontgomerySelectedFolderSnapshot(page) {
  return await page
    .evaluate(() => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      function cleanLabel(s) {
        return norm(s)
          .replace(/\s*\((?:\d+(?:\s*-\s*\d+\s*New)?)\)\s*$/i, "")
          .trim();
      }
      const node = Array.from(
        document.querySelectorAll("#folderTree li.ui-igtree-node, #folderTree .ui-igtree-node"),
      ).find((el) => {
        const cls = el.className || "";
        return (
          el.getAttribute("aria-selected") === "true" ||
          /selected|active|current/i.test(cls)
        );
      });
      return {
        folderId: String(
          node?.getAttribute("data-value") || node?.dataset?.value || "",
        ).trim(),
        name: cleanLabel(node?.textContent || ""),
      };
    })
    .catch(() => ({ folderId: "", name: "" }));
}

async function waitForMontgomeryFolderPayload(page, projectID, folder, initialPayload = null) {
  const expectedCount = extractMontgomeryFolderExpectedCount(folder?.displayName || "");
  let payload = initialPayload;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0 || !payload) {
      payload = await fetchMontgomeryFolderFilesPayload(page, projectID, folder.folderId);
    }
    const rows = countMontgomeryFolderPayloadRows(payload);
    console.log(
      `[Montgomery Files] GetFolderFiles observed | ${folder.displayName} | rows=${rows}`,
    );
    if (expectedCount == null || expectedCount === 0 || rows > 0) {
      return payload;
    }
    await page.waitForTimeout(400);
  }
  return payload;
}

async function extractProjectDoxFilesGridRows(page, folder, ajaxPayload = null) {
  const harvested = await page.evaluate((folderDisplayName) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden";
    }
    function lowerList(values) {
      return values.map((value) => norm(value).toLowerCase());
    }
    function findIndex(headers, rxList) {
      return headers.findIndex((header) => rxList.some((rx) => rx.test(header)));
    }
    function pickField(record, patterns) {
      if (!record || typeof record !== "object") return "";
      const keys = Object.keys(record);
      for (const pattern of patterns) {
        const key = keys.find((k) => pattern.test(k));
        if (key && record[key] != null && String(record[key]).trim()) {
          return norm(record[key]);
        }
      }
      return "";
    }
    function mapRecord(record) {
      return {
        name:
          pickField(record, [/^file(name)?$/i, /^document(name)?$/i, /^name$/i]) ||
          "",
        id:
          pickField(record, [
            /^fileid$/i,
            /^file_id$/i,
            /^fileId$/i,
            /^id$/i,
            /^documentid$/i,
            /^documentId$/i,
            /^versionid$/i,
          ]) || "",
        status:
          pickField(record, [/^status$/i, /ReviewStatus/i, /State/i]) || "",
        version:
          pickField(record, [/^version$/i, /^revision$/i]) || "",
        reviewedBy:
          pickField(record, [/reviewedby/i, /reviewer/i, /uploadedby/i, /^OrigAuthor$/i]) ||
          "",
        uploadedDate:
          pickField(record, [/uploadeddate/i, /createddate/i, /^UploadDate$/i, /date/i]) ||
          "",
        fileSizeKB:
          Number(
            pickField(record, [/^FileSizeKB$/i, /^SizeKB$/i, /^Size$/i]) || "",
          ) || null,
        downloadUrl:
          pickField(record, [/^URL$/i, /^DownloadURL$/i, /^ViewURL$/i]) || "",
        folderName: folderDisplayName,
      };
    }

    const grids = Array.from(document.querySelectorAll(".ui-iggrid")).filter(isVisible);
    const grid = grids[0] || null;
    const headerTexts = grid
      ? Array.from(
          grid.querySelectorAll(
            ".ui-iggrid-headtable th, thead th, .ui-iggrid-header th, .ui-iggrid-headertext",
          ),
        ).map((el) => norm(el.textContent))
      : [];
    const headers = lowerList(headerTexts);

    let dataSource = [];
    try {
      const $ = window.jQuery || window.$;
      if ($ && grid && $(grid).data("igGrid")) {
        const gridApi = $(grid).data("igGrid");
        const ds =
          (gridApi?.dataSource?.dataView && gridApi.dataSource.dataView()) ||
          $(grid).igGrid("option", "dataSource");
        if (Array.isArray(ds)) dataSource = ds;
      }
    } catch (_) {}

    const nameIndex = findIndex(headers, [/^name$/, /file/i, /document/i, /drawing/i]);
    const statusIndex = findIndex(headers, [/status/i]);
    const versionIndex = findIndex(headers, [/version/i, /revision/i]);
    const reviewedByIndex = findIndex(headers, [/reviewed/i, /reviewer/i, /uploaded by/i]);
    const uploadedDateIndex = findIndex(headers, [/upload/i, /created/i, /date/i]);

    const rows = Array.from(
      document.querySelectorAll(
        "#filesTab .ui-iggrid-table tbody tr, .ui-iggrid-table tbody tr, #filesTab table tbody tr",
      ),
    ).filter((tr) => isVisible(tr) && tr.querySelectorAll("td").length > 0);

    const out = [];
    const seen = new Set();

    rows.forEach((row, rowIdx) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const cellTexts = cells.map((cell) => norm(cell.textContent));
      if (!cellTexts.some(Boolean)) return;

      const links = Array.from(row.querySelectorAll("a[href], a[onclick]"));
      let fileLink =
        row.querySelector('a[onclick*="viewFile"], a[onclick*="viewVersion"], a[onclick*="viewInfo"]') ||
        links.find((a) => {
          const text = norm(a.textContent);
          return text.length > 1 && !/view|download/i.test(text);
        }) ||
        links[0] ||
        null;

      const dsRow = dataSource[rowIdx] || null;
      const dsName = pickField(dsRow, [/^file(name)?$/i, /^document(name)?$/i, /^name$/i]);
      const name =
        norm(fileLink?.textContent) ||
        dsName ||
        (nameIndex >= 0 ? cellTexts[nameIndex] : "") ||
        cellTexts[0] ||
        "";
      if (!name) return;

      const rawPool = [fileLink?.getAttribute("onclick"), fileLink?.getAttribute("href")]
        .filter(Boolean)
        .join(" ");
      let fileId =
        pickField(dsRow, [
          /^fileid$/i,
          /^file_id$/i,
          /^fileId$/i,
          /^id$/i,
          /^documentid$/i,
          /^documentId$/i,
          /^versionid$/i,
        ]) ||
        String(row.getAttribute("data-id") || "").trim() ||
        String(fileLink?.getAttribute("data-fileid") || fileLink?.getAttribute("data-id") || "").trim();
      if (!/^\d+$/.test(fileId)) {
        const idMatch =
          rawPool.match(/fileID[=:](\d+)/i) ||
          rawPool.match(/viewFile\(\s*['"]?(\d+)/i) ||
          rawPool.match(/viewVersion\(\s*['"]?(\d+)/i) ||
          rawPool.match(/viewInfo\(\s*['"]?(\d+)/i) ||
          rawPool.match(/(\d{4,})/);
        fileId = idMatch ? String(idMatch[1]) : "";
      }

      const status =
        pickField(dsRow, [/^status$/i]) ||
        (statusIndex >= 0 ? cellTexts[statusIndex] : "") ||
        "";
      const version =
        pickField(dsRow, [/^version$/i, /^revision$/i]) ||
        (versionIndex >= 0 ? cellTexts[versionIndex] : "") ||
        "";
      const reviewedBy =
        pickField(dsRow, [/reviewedby/i, /reviewer/i, /uploadedby/i]) ||
        (reviewedByIndex >= 0 ? cellTexts[reviewedByIndex] : "") ||
        "";
      const uploadedDate =
        pickField(dsRow, [/uploadeddate/i, /createddate/i, /date/i]) ||
        (uploadedDateIndex >= 0 ? cellTexts[uploadedDateIndex] : "") ||
        "";

      const dedupeKey = `${fileId || `${name}|${version}|${uploadedDate}|${folderDisplayName}`}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      out.push({
        name,
        id: fileId || "",
        status,
        version,
        reviewedBy,
        uploadedDate,
        fileSizeKB:
          Number(
            pickField(dsRow, [/^FileSizeKB$/i, /^SizeKB$/i, /^Size$/i]) || "",
          ) || null,
        downloadUrl:
          pickField(dsRow, [/^URL$/i, /^DownloadURL$/i, /^ViewURL$/i]) || "",
        folderName: folderDisplayName,
      });
    });

    return {
      domRows: out,
      dataSourceRows: Array.isArray(dataSource) ? dataSource.map(mapRecord) : [],
    };
  }, folder.displayName);

  const payloadRows = shapeMontgomeryAjaxFileRows(ajaxPayload, folder.displayName);
  const merged = mergeMontgomeryFileRows(
    payloadRows.length > 0
      ? [payloadRows]
      : [harvested?.dataSourceRows || [], harvested?.domRows || []],
    folder.displayName,
  );
  return {
    ...merged,
    datasourceRowsBeforeCleanup: Math.max(
      harvested?.dataSourceRows?.length || 0,
      payloadRows.length,
    ),
    domRowsBeforeCleanup: harvested?.domRows?.length || 0,
  };
}

function montgomeryProjectFilesTabUrlMatches(url, projectID) {
  const u = String(url || "");
  const pid = String(projectID || "").trim();
  if (!pid) return false;
  if (!/\/Project\/Index/i.test(u)) return false;
  if (!/tab=filesTab/i.test(u)) return false;
  const esc = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`[?&]ProjectID=${esc}(?:&|$)`, "i").test(u);
}

async function resolveMontgomeryFilesTabPage(context, existingPage, webUiBase, projectID) {
  const pid = String(projectID || "").trim();
  const filesTabUrl = montgomeryProjectDox.buildMontgomeryProjectTabUrl(
    webUiBase,
    pid,
    "filesTab",
  );

  const classify = (p) => {
    if (!p || p.isClosed()) return null;
    let u = "";
    try {
      u = p.url();
    } catch (_) {
      return null;
    }
    if (!montgomeryProjectFilesTabUrlMatches(u, pid)) return null;
    return u;
  };

  const uExisting = classify(existingPage);
  if (uExisting) {
    console.log(
      `[Montgomery][page-recover] using existing files page projectID=${pid} url=${uExisting.slice(0, 200)}`,
    );
    return existingPage;
  }

  for (const p of context.pages()) {
    const u = classify(p);
    if (u) {
      console.log(
        `[Montgomery][page-recover] found replacement files page projectID=${pid} url=${u.slice(0, 200)}`,
      );
      return p;
    }
  }

  console.log(
    `[Montgomery][page-recover] reopened files page projectID=${pid} url=${filesTabUrl.slice(0, 200)}`,
  );
  const fresh = await context.newPage();
  await fresh.goto(filesTabUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await fresh.waitForSelector("#folderTree, .ui-igtree", { timeout: 20000 }).catch(() => {});
  await fresh.waitForTimeout(1000);
  return fresh;
}

function montgomeryFilesShouldReacquireWorkPage(workPage, { reason, errMessage }) {
  try {
    if (workPage && typeof workPage.isClosed === "function" && workPage.isClosed()) {
      return true;
    }
  } catch (_) {}
  const r = String(reason || "");
  if (r === "main_files_page_closed" || r === "viewer_missing_file_config") return true;
  const m = String(errMessage || "");
  if (/Target page, context or browser has been closed/i.test(m)) return true;
  return false;
}

function montgomeryFileProgressBase(fileProgress, file, folderDisplayName) {
  return {
    portalFileId: String(file.id),
    fileVersion: file.version,
    fileName: file.name,
    folderName: folderDisplayName,
    progressTotal: fileProgress.getProgressTotal(),
    progressCurrent: fileProgress.getProgressCurrent(),
  };
}

async function persistMontgomeryFileDownloadOutcome(
  fileProgress,
  file,
  folderDisplayName,
  safeName,
  supabaseProjectId,
  dlResult,
  downloadError,
) {
  if (!fileProgress || !file?.id) return;
  const base = montgomeryFileProgressBase(fileProgress, file, folderDisplayName);
  const storagePath =
    supabaseProjectId && safeName
      ? `drawings/${supabaseProjectId}/${safeName}`
      : null;

  if (dlResult?.success) {
    if (dlResult.skippedDuplicate) {
      await scrapeFileResults.markFileSkipped(fileProgress, {
        ...base,
        publicUrl: dlResult.publicUrl || dlResult.viewUrl || null,
        sourceUrl: dlResult.downloadUrl || null,
        failureCode: "duplicate",
      });
      return;
    }
    const sizeBytes =
      dlResult.fileSizeKB != null
        ? Math.round(Number(dlResult.fileSizeKB) * 1024)
        : null;
    await scrapeFileResults.markFileUploaded(fileProgress, {
      ...base,
      storagePath,
      publicUrl: dlResult.publicUrl || dlResult.viewUrl || null,
      sourceUrl: dlResult.downloadUrl || null,
      mimeType: /\.pdf$/i.test(file.name || "") ? "application/pdf" : null,
      sizeBytes,
    });
    fileProgress.bumpProgressCurrent();
    return;
  }

  await scrapeFileResults.markFileFailed(fileProgress, {
    ...base,
    failureCode: dlResult?.reason || downloadError || "download_failed",
    failureMessage: dlResult?.reason || downloadError || "download_failed",
  });
}

async function extractMontgomeryFilesTabLightweight(
  page,
  context,
  session,
  project,
  webUiBase,
  supabaseProjectId = null,
) {
  cleanupDownloadsDir();

  const fileProgress = scrapeFileResults.createFileProgressContext(session, supabase);
  session._montgomeryFileProgressEstimate = 0;

  const projectID = String(project?.projectID || project?.projectId || "");
  const filesTabUrl = montgomeryProjectDox.buildMontgomeryProjectTabUrl(
    webUiBase,
    projectID,
    "filesTab",
  );
  await page.goto(filesTabUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#folderTree, .ui-igtree", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  let workPage = page;

  const folders = await discoverMontgomeryFilesFolders(workPage);
  console.log(
    `[Montgomery][files] folders discovered = ${folders.map((folder) => folder.displayName).join(", ") || "(none)"}`,
  );

  const result = {
    projectID,
    foldersCount: 0,
    filesCount: 0,
    sampledDownloadsCount: 0,
    folders: [],
    sampleFiles: [],
    downloadedFiles: [],
    _meta: {
      fileApiFailures: 0,
      largeFilesSkipped: 0,
      downloadAttempts: 0,
      downloadsOk: 0,
      uploadsOk: 0,
      failures: 0,
    },
  };

  const uniqueFiles = new Map();

  for (const folder of folders) {
    if (isMontgomeryRootFolderCandidate(folder, project)) {
      console.log(`[Montgomery][files-fix] root skipped = ${folder.displayName}`);
      continue;
    }

    console.log(
      `[Montgomery][files-fix] selecting folder "${folder.displayName}"`,
    );
    try {
      workPage = await resolveMontgomeryFilesTabPage(
        context,
        workPage,
        webUiBase,
        projectID,
      );
      // For non-Drawings folders, try direct API fetch first
      // since the page state may be stale after processing many files
      const isDrawings = folder.displayName.toLowerCase().includes("drawing");
      let ajaxPayload = null;
      let selected = null;

      if (!isDrawings) {
        const directApiPayload = await fetchMontgomeryFolderFilesPayload(
          workPage,
          projectID,
          folder.folderId,
        );
        const directRows = countMontgomeryFolderPayloadRows(directApiPayload);
        if (directRows > 0) {
          ajaxPayload = directApiPayload;
          console.log(
            `[Montgomery Files] direct payload used | ${folder.displayName} | folderId=${folder.folderId || "none"} | rows=${directRows}`,
          );
        }
      }

      if (!ajaxPayload) {
        const clickedFolderResult = await clickMontgomeryFilesFolder(workPage, folder);
        ajaxPayload = clickedFolderResult.ajaxPayload;
        selected = clickedFolderResult.selected;
        console.log(
          `[Montgomery Files] folder selected | ${folder.displayName} | folderId=${folder.folderId || selected?.folderId || "none"}`,
        );
      }

      const directPayload = await waitForMontgomeryFolderPayload(
        workPage,
        projectID,
        folder,
        ajaxPayload,
      );
      const effectivePayload =
        countMontgomeryFolderPayloadRows(directPayload) > 0
          ? directPayload
          : ajaxPayload;
      if (countMontgomeryFolderPayloadRows(effectivePayload) > 0) {
        console.log(`[Montgomery Files] datasource refreshed | ${folder.displayName}`);
      }
      const {
        rows: filesFound,
        placeholderCount,
        datasourceRowsBeforeCleanup,
      } = await extractProjectDoxFilesGridRows(workPage, folder, effectivePayload);
      console.log(
        `[Montgomery][files-final] folder "${folder.displayName}" datasource rows before cleanup = ${datasourceRowsBeforeCleanup}`,
      );
      if (placeholderCount > 0) {
        console.log(
          `[Montgomery][files-fix] placeholder skipped = ${placeholderCount}`,
        );
      }
      console.log(
        `[Montgomery][files-final] folder "${folder.displayName}" real rows after cleanup = ${filesFound.length}`,
      );
      console.log(
        `[Montgomery][files-fix] folder "${folder.displayName}" real rows after cleanup = ${filesFound.length}`,
      );
      console.log(
        `[Montgomery Files] harvested rows | ${folder.displayName} | realRows=${filesFound.length}`,
      );

      session._montgomeryFileProgressEstimate =
        Number(session._montgomeryFileProgressEstimate || 0) + filesFound.length;
      if (fileProgress) {
        fileProgress.setProgressTotal(session._montgomeryFileProgressEstimate);
      }

      const folderFiles = [];
      let needMontgomeryFolderReselect = false;
      for (const file of filesFound) {
        workPage = await resolveMontgomeryFilesTabPage(
          context,
          workPage,
          webUiBase,
          projectID,
        );
        if (needMontgomeryFolderReselect) {
          needMontgomeryFolderReselect = false;
          try {
            const clickedFolderResult = await clickMontgomeryFilesFolder(
              workPage,
              folder,
            );
            await waitForMontgomeryFolderPayload(
              workPage,
              projectID,
              folder,
              clickedFolderResult.ajaxPayload,
            );
            console.log(
              `[Montgomery][page-recover] re-selected folder after page recovery | ${folder.displayName}`,
            );
          } catch (reassertErr) {
            console.log(
              `[Montgomery][page-recover] folder re-select failed | ${reassertErr?.message || reassertErr}`,
            );
          }
        }
        const dedupeKey = buildMontgomeryFilesDedupeKey(
          file,
          folder.name || folder.displayName,
        );
        const prior = dedupeKey ? uniqueFiles.get(dedupeKey) : null;
        if (prior) {
          if (fileProgress && file.id) {
            await scrapeFileResults.markFileSkipped(fileProgress, {
              ...montgomeryFileProgressBase(fileProgress, file, folder.displayName),
              publicUrl: prior.publicUrl || prior.viewUrl || null,
              sourceUrl: prior.downloadUrl || null,
              failureCode: "duplicate",
            });
          }
          folderFiles.push({
            name: file.name,
            fileId: file.id || undefined,
            folderName: folder.displayName,
            status: file.status || "",
            version: file.version || null,
            reviewedBy: file.reviewedBy || "",
            uploadedDate: file.uploadedDate || "",
            commentCount: 0,
            comments: [],
            viewUrl: prior.viewUrl || prior.downloadUrl || "",
            publicUrl: prior.publicUrl || null,
            downloadUrl: prior.downloadUrl || null,
            fileSizeKB: prior.fileSizeKB ?? file.fileSizeKB ?? null,
            downloadStatus: "skipped_duplicate",
          });
          continue;
        }

        let viewUrl = "";
        let publicUrl = null;
        let downloadUrl = file.downloadUrl || null;
        let fileSizeKB = file.fileSizeKB ?? null;
        let downloadStatus = null;
        let downloadError = null;

        if (file.id) {
          if (fileProgress) {
            await scrapeFileResults.upsertFileDiscovered(fileProgress, {
              ...montgomeryFileProgressBase(fileProgress, file, folder.displayName),
            });
            await scrapeFileResults.markFileDownloading(fileProgress, {
              ...montgomeryFileProgressBase(fileProgress, file, folder.displayName),
            });
          }
          result._meta.downloadAttempts += 1;
          const safeName = `${file.id}_${file.name.replace(/[/\\?%*:|"<>]/g, "-")}`;
          let dlResult = null;
          try {
            dlResult = await downloadMontgomeryProjectDoxFile(
              workPage,
              context,
              file.id,
              safeName,
              webUiBase,
              session,
              supabaseProjectId,
              folder.displayName,
            );
            if (dlResult.success) {
              publicUrl = dlResult.publicUrl || null;
              downloadUrl = dlResult.downloadUrl || downloadUrl || null;
              fileSizeKB = dlResult.fileSizeKB ?? fileSizeKB;
              viewUrl = publicUrl || downloadUrl || dlResult.viewUrl || "";
              downloadStatus = dlResult.skippedDuplicate
                ? "skipped_duplicate"
                : "success";
              result._meta.downloadsOk += 1;
              if (publicUrl) result._meta.uploadsOk += 1;
              if (dlResult.reason === "too_large") {
                result._meta.largeFilesSkipped += 1;
              }
              console.log(
                `[Montgomery][files-fix] file "${file.name}" resolved real file url = ${downloadUrl || "none"}`,
              );
              console.log(
                `[Montgomery][files-final] resolved file source = ${downloadUrl || "none"}`,
              );
              console.log(
                `[Montgomery][files-fix] file "${file.name}" upload ${publicUrl ? "success" : "fail"}`,
              );
              console.log(
                `[Montgomery][files-final] upload ${publicUrl ? "success" : "fail"} "${file.name}"`,
              );
            } else {
              downloadStatus = "failed";
              downloadError = dlResult.reason || "download_failed";
              console.log(
                `[Montgomery][files-fix] file "${file.name}" dlResult.success=false reason="${dlResult.reason}" keys=${Object.keys(dlResult).join(",")}`,
              );
              result._meta.failures += 1;
              if (downloadError === "too_large") {
                result._meta.largeFilesSkipped += 1;
              }
              console.log(
                `[Montgomery][files-fix] file "${file.name}" resolved real file url = none`,
              );
              console.log(
                `[Montgomery][files-fix] file "${file.name}" upload fail`,
              );
              console.log(`[Montgomery][files-final] resolved file source = none`);
              console.log(`[Montgomery][files-final] upload fail "${file.name}"`);
            }
          } catch (err) {
            downloadStatus = "failed";
            downloadError = err.message;
            result._meta.failures += 1;
            console.log(
              `[Montgomery][files-fix] file "${file.name}" resolved real file url = none`,
            );
            console.log(
              `[Montgomery][files-fix] file "${file.name}" upload fail`,
            );
            console.log(`[Montgomery][files-final] resolved file source = none`);
            console.log(`[Montgomery][files-final] upload fail "${file.name}"`);
          }
          await persistMontgomeryFileDownloadOutcome(
            fileProgress,
            file,
            folder.displayName,
            safeName,
            supabaseProjectId,
            dlResult,
            downloadError,
          );
          const failReason =
            dlResult && dlResult.success === false ? dlResult.reason : null;
          if (
            montgomeryFilesShouldReacquireWorkPage(workPage, {
              reason: failReason,
              errMessage: downloadError,
            })
          ) {
            console.log(
              `[Montgomery][page-recover] recovering after failure reason=${failReason || downloadError || "unknown"} fileId=${file.id}`,
            );
            workPage = await resolveMontgomeryFilesTabPage(
              context,
              workPage,
              webUiBase,
              projectID,
            );
            needMontgomeryFolderReselect = true;
          }
        }

        const shapedFile = {
          name: file.name,
          fileId: file.id || undefined,
          folderName: folder.displayName,
          status: file.status || "",
          version: file.version || null,
          reviewedBy: file.reviewedBy || "",
          uploadedDate: file.uploadedDate || "",
          commentCount: 0,
          comments: [],
          viewUrl,
          publicUrl,
          downloadUrl,
          fileSizeKB,
          ...(downloadStatus && { downloadStatus }),
          ...(downloadError && { downloadError }),
        };
        folderFiles.push(shapedFile);
        if (dedupeKey) {
          uniqueFiles.set(dedupeKey, {
            viewUrl,
            publicUrl,
            downloadUrl,
            fileSizeKB,
            downloadStatus,
          });
        }
        if (downloadStatus === "success") {
          result.downloadedFiles.push({
            name: file.name,
            fileId: file.id || undefined,
            folderName: folder.displayName,
            viewUrl,
          });
        }
      }

      result.folders.push({
        folderID: folder.folderId || null,
        folderName: folder.displayName,
        parentFolder: null,
        filesCount: folderFiles.length,
        name: folder.displayName,
        fileCount: folderFiles.length,
        files: folderFiles,
      });
    } catch (err) {
      result._meta.fileApiFailures += 1;
      console.log(`[Montgomery][files-fix] folder "${folder.displayName}" FAILED: ${err.message}`);
      console.log(
        `[Montgomery][files-fix] folder error stack: ${err.stack?.split("\n").slice(0, 3).join(" | ")}`,
      );
      result.folders.push({
        folderID: folder.folderId || null,
        folderName: folder.displayName,
        parentFolder: null,
        filesCount: 0,
        name: folder.displayName,
        fileCount: 0,
        files: [],
        folderError: err.message,
      });
    }
  }

  result.foldersCount = result.folders.length;
  result.filesCount = result.folders.reduce(
    (sum, folder) => sum + (folder.files?.length || 0),
    0,
  );
  result.sampledDownloadsCount = result.downloadedFiles.length;
  result.sampleFiles = result.folders
    .flatMap((folder) => folder.files || [])
    .slice(0, 5)
    .map((file) => ({
      name: file.name,
      fileId: file.fileId,
      folderName: file.folderName,
    }));

  console.log(
    `[Montgomery][files-fix] final folder output names = ${result.folders.map((folder) => folder.name).join(", ") || "(none)"}`,
  );
  console.log(`[Montgomery][files] total unique files = ${uniqueFiles.size}`);
  return result;
}

async function extractFilesTab(
  _page,
  _context,
  session,
  commentsOnly = false,
  supabaseProjectId = null,
  targetFolder = null,
  filesSyncContext = null,
  targetFolders = null,
  filesSyncTargetHint = null,
) {
  const syncHint =
    filesSyncTargetHint != null && String(filesSyncTargetHint).trim() !== ""
      ? String(filesSyncTargetHint).trim()
      : targetFolder || null;

  let page = _page;
  let context = _context;
  cleanupDownloadsDir();

  session._scrapeCumulativeBytes = 0;
  console.log(`[Montgomery Files] cumulative bytes reset to 0 at files scrape start`);
  if (!session._downloadedHashes) session._downloadedHashes = new Map();

  let filesSuccessfulForBatch = 0;
  const shouldFilesIncrementalSync =
    filesSyncContext &&
    filesSyncContext.project &&
    supabaseProjectId &&
    filesSyncContext.userId &&
    !commentsOnly;

  const currentUrl = page.url();
  if (currentUrl.includes('b2clogin') || currentUrl.includes('Login') || currentUrl.includes('SessionEnded')) {
    console.log("     ⚠️ Session expired during Files tab scraping, skipping files");
    return { folders: [], error: "Session expired" };
  }

  const pdxProjectId = (() => {
    try {
      const u = new URL(currentUrl);
      return u.searchParams.get('ProjectID') || '';
    } catch { return ''; }
  })();

  const webUiBase = (() => {
    try {
      const u = new URL(currentUrl);
      const parts = u.hostname.split(".");
      if (parts[0] && !parts[0].includes("projectdoxwebui")) {
        parts[0] = parts[0] + "-projectdoxwebui";
      }
      return `${u.protocol}//${parts.join(".")}`;
    } catch (e) {
      return "https://washington-dc-us-projectdoxwebui.avolvecloud.com";
    }
  })();

  console.log(`\n🕵️ Extracting Files tab (download + grid)...`);
  console.log(`     WebUI base for downloads: ${webUiBase}`);

  const discoveredDownloadUrls = [];
  const networkHandler = (request) => {
    const url = request.url();
    if (/file.*download|download.*file|filehandler|filehandler\.ashx/i.test(url)) {
      discoveredDownloadUrls.push(url);
    }
  };
  page.on("request", networkHandler);

  const result = { folders: [] };

  const folderElements = await page.$$eval(
    "#folderTree li.ui-igtree-node",
    (nodes) =>
      nodes
        .map((node) => ({
          text: node.querySelector("a")?.textContent.trim() || "",
          path: node.getAttribute("data-path"),
          value: node.getAttribute("data-value"),
        }))
        .filter((f) => {
          const t = (f.text || "").trim();
          if (!t) return false;
          const baseLabel = t.replace(/\s*\(.*$/, "").trim();
          const kw = /drawings|supporting|document|submission|plan|misc|correspondence|photo|image/i;
          const permitStyleRoot =
            !kw.test(baseLabel) &&
            (/^[A-Z]\d{5,}$/i.test(baseLabel) ||
              /^[A-Z]{2,}[A-Z0-9]{0,}\d{4,}$/i.test(baseLabel));
          if (permitStyleRoot) return false;
          if (f.text.includes("(")) return true;
          if (f.path && String(f.path).trim()) return true;
          if (f.value && String(f.value).trim()) return true;
          return false;
        }),
  );

  if (folderElements.length === 0) {
    console.log("     📁 No folders found via #folderTree, trying fallback selectors...");
    const fallbackFolders = await page.$$eval(
      'a[id*="FolderName"], a[id*="folderName"], td a[onclick*="Folder"], div.TreeNode a, span.TreeNode a',
      (els) =>
        els.map((el) => {
          const li = el.closest("li.ui-igtree-node");
          return {
            text: el.textContent.trim(),
            path: el.id || "",
            value: li ? li.getAttribute("data-value") : "",
          };
        }).filter((f) => {
          const t = (f.text || "").trim();
          if (!t) return false;
          const baseLabel = t.replace(/\s*\(.*$/, "").trim();
          const kw = /drawings|supporting|document|submission|plan|misc|correspondence|photo|image/i;
          const permitStyleRoot =
            !kw.test(baseLabel) &&
            (/^[A-Z]\d{5,}$/i.test(baseLabel) ||
              /^[A-Z]{2,}[A-Z0-9]{0,}\d{4,}$/i.test(baseLabel));
          if (permitStyleRoot) return false;
          if (f.text.includes("(")) return true;
          if (f.path && String(f.path).trim()) return true;
          if (f.value && String(f.value).trim()) return true;
          return false;
        }),
    );
    if (fallbackFolders.length > 0) {
      console.log(`     📁 Found ${fallbackFolders.length} folders via fallback`);
      folderElements.push(...fallbackFolders);
    }
  }

  const folderSeen = new Set();
  for (let i = folderElements.length - 1; i >= 0; i--) {
    const f = folderElements[i];
    const key = `${f.path || ""}|${f.value || ""}|${f.text || ""}`;
    if (folderSeen.has(key)) folderElements.splice(i, 1);
    else folderSeen.add(key);
  }

  console.log(`     📁 Found ${folderElements.length} folders`);

  const TARGET_FOLDER_MAP = {
    supporting_docs: /supporting\s*doc/i,
    drawings: /^drawings$/i,
    supporting_documents: /supporting\s*documents?/i,
    approved_drawings: /approved\s*drawings/i,
    approved_supporting_documents: /approved\s*supporting\s*documents/i,
  };

  const activeFolderKeys = [];
  if (targetFolder && TARGET_FOLDER_MAP[targetFolder]) {
    activeFolderKeys.push(targetFolder);
  }
  if (Array.isArray(targetFolders) && targetFolders.length > 0) {
    for (const k of targetFolders) {
      if (TARGET_FOLDER_MAP[k] && !activeFolderKeys.includes(k)) {
        activeFolderKeys.push(k);
      }
    }
  }

  if (activeFolderKeys.length > 0) {
    const patterns = activeFolderKeys.map((k) => TARGET_FOLDER_MAP[k]);
    const before = folderElements.length;
    const filtered = folderElements.filter((f) => {
      const name = f.text.replace(/\s*\(.*$/, "").trim();
      return patterns.some((p) => p.test(name));
    });
    if (filtered.length > 0) {
      folderElements.length = 0;
      folderElements.push(...filtered);
      console.log(
        `     🎯 targetFolders=[${activeFolderKeys.join(", ")}]: filtered ${before} → ${folderElements.length} folders`,
      );
    } else {
      console.log(
        `     ⚠️ targetFolders=[${activeFolderKeys.join(", ")}]: no matching folder found among [${folderElements.map((f) => f.text.replace(/\s*\(.*$/, "").trim()).join(", ")}]. Scraping all folders.`,
      );
    }
  }

  let totalDownloadableCount = 0;

  for (let fi = 0; fi < folderElements.length; fi++) {
    const fInfo = folderElements[fi];
    const countMatch = fInfo.text.match(/\((\d+)/);
    const fileCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const folderName = fInfo.text.replace(/\s*\(.*$/, "").trim();
    console.log(`     📁 [${fi + 1}/${folderElements.length}] "${folderName}" (${fileCount} files)`);
    if (session) {
      session.message = syncHint ? `Targeting: ${folderName}...` : `Files → ${folderName}`;
    }

    try {
      const browserDead = session.browser && !session.browser.isConnected();
      const pageDead = browserDead || !(await isPageAlive(page));
      if (pageDead) {
        console.log(`     🔄 ${browserDead ? 'Browser disconnected' : 'Page died'} before folder "${folderName}", recovering...`);
        try {
          if (browserDead) {
            console.log(`     🔄 Browser.isConnected() === false, full re-initialization required...`);
            const reInit = await reinitializeBrowser(session);
            context = reInit.context;
            page = await recreateFilesPage(context, webUiBase, pdxProjectId, null);
          } else {
            const recovered = await recoverPage(context, session, webUiBase, pdxProjectId, null);
            page = recovered.page;
            context = recovered.context;
          }
          console.log(`     ✅ Recovered before folder "${folderName}"`);
        } catch (recErr) {
          console.log(`     ❌ Could not recover: ${recErr.message}. Skipping remaining folders.`);
          for (let rfi = fi; rfi < folderElements.length; rfi++) {
            const rfName = folderElements[rfi].text.replace(/\s*\(.*$/, "").trim();
            const rfCount = (folderElements[rfi].text.match(/\((\d+)/) || [])[1] || 0;
            result.folders.push({ name: rfName, fileCount: parseInt(rfCount, 10), files: [], folderError: "browser_crashed" });
          }
          break;
        }
      }

      const clickFolderTreeFolder = async () => {
        if (fInfo.path) {
          const selector = fInfo.path.startsWith("#")
            ? `${fInfo.path} a`
            : `#folderTree li[data-path="${fInfo.path}"] a`;
          await page.click(selector).catch(async () => {
            const allLinks = await page.$$("a");
            for (const link of allLinks) {
              const t = await link.textContent().catch(() => "");
              if (t.trim() === fInfo.text) {
                await link.click();
                break;
              }
            }
          });
          return;
        }
        if (fInfo.value && String(fInfo.value).trim()) {
          const v = String(fInfo.value).trim();
          let clickedByValue = false;
          try {
            clickedByValue = await page.evaluate((folderValue) => {
              for (const li of document.querySelectorAll(
                "#folderTree li.ui-igtree-node",
              )) {
                if (li.getAttribute("data-value") !== String(folderValue))
                  continue;
                const a = li.querySelector("a");
                if (a) {
                  a.click();
                  return true;
                }
              }
              return false;
            }, v);
          } catch (_) {}
          if (clickedByValue) return;
        }
        const allLinks = await page.$$("a");
        for (const link of allLinks) {
          const t = await link.textContent().catch(() => "");
          if (t.trim() === fInfo.text) {
            await link.click();
            break;
          }
        }
      };
      await clickFolderTreeFolder();

      console.log(`       ⏳ Waiting for file grid...`);
      await page.waitForSelector(".ui-iggrid-table tbody tr", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const filesFound = await page.evaluate(() => {
        const rows = [];
        const seen = new Set();

        let gridDataSource = null;
        try {
          const grids = document.querySelectorAll("[id*='grid_files'], [id*='gridFiles'], [id*='FileGrid'], .ui-iggrid");
          for (const g of grids) {
            const $ = window.jQuery || window.$;
            if ($ && $(g).data("igGrid")) {
              const ds = $(g).igGrid("option", "dataSource");
              if (Array.isArray(ds) && ds.length > 0) {
                gridDataSource = ds;
                break;
              }
            }
          }
        } catch (e) {}

        const gridRows = document.querySelectorAll(".ui-iggrid-table tbody tr");
        gridRows.forEach((row, rowIdx) => {
          const cells = row.querySelectorAll("td");
          const allLinks = row.querySelectorAll("a");
          let fileLink = row.querySelector('a[onclick*="File"], a[href*="File"], a[onclick*="file"], .file-link');

          if (!fileLink && allLinks.length > 0) {
            for (const a of allLinks) {
              const t = a.textContent.trim();
              if (t.length > 2 && /\.\w{2,4}$/.test(t)) {
                fileLink = a;
                break;
              }
            }
          }
          if (!fileLink && allLinks.length > 0) {
            fileLink = allLinks[0];
          }
          if (!fileLink) return;

          const name = fileLink.textContent.trim();
          if (!name || name.length < 2) return;

          const rawOnclick = fileLink.getAttribute("onclick") || "";
          const href = fileLink.getAttribute("href") || "";
          let fileId = "";

          const idMatch = rawOnclick.match(/fileID[=:](\d+)/i) || href.match(/fileID[=:](\d+)/i);
          if (idMatch) fileId = idMatch[1];

          if (!fileId) {
            const rowDataId = row.getAttribute("data-id") || "";
            if (rowDataId && /^\d+$/.test(rowDataId)) fileId = rowDataId;
          }
          if (!fileId) {
            const fileLinkId = fileLink.getAttribute("data-fileid") || fileLink.getAttribute("data-id") || "";
            if (fileLinkId && /^\d+$/.test(fileLinkId)) fileId = fileLinkId;
          }
          if (!fileId) {
            const anyIdMatch = rawOnclick.match(/(\d{4,})/) || href.match(/(\d{4,})/);
            if (anyIdMatch) fileId = anyIdMatch[1];
          }
          if (!fileId && gridDataSource && gridDataSource[rowIdx]) {
            const dsRow = gridDataSource[rowIdx];
            const idField = dsRow.FileID || dsRow.fileID || dsRow.fileId || dsRow.Id || dsRow.id || dsRow.ID || dsRow.DocumentID || dsRow.documentId;
            if (idField) fileId = String(idField);
          }
          if (!fileId) {
            const pk = row.querySelector("td[aria-describedby*='FileID'], td[aria-describedby*='fileId'], td[aria-describedby*='ID']");
            if (pk) {
              const pkVal = pk.textContent.trim();
              if (/^\d+$/.test(pkVal)) fileId = pkVal;
            }
          }
          if (!fileId) {
            for (const cell of cells) {
              const ariaDesc = cell.getAttribute("aria-describedby") || "";
              if (/fileid|file_id|documentid/i.test(ariaDesc)) {
                const val = cell.textContent.trim();
                if (/^\d+$/.test(val)) { fileId = val; break; }
              }
            }
          }

          const rowDedupeKey = fileId
            ? `id:${fileId}`
            : `row:${rowIdx}:n:${name}`;
          if (seen.has(rowDedupeKey)) return;
          seen.add(rowDedupeKey);

          const cellTexts = Array.from(cells).map((c) => c.textContent.trim());
          let nameCol = cellTexts.findIndex(t => t === name);
          if (nameCol < 0) {
            nameCol = cellTexts.findIndex(t => t.includes(name));
          }
          if (nameCol < 0) {
            const linkParent = fileLink.closest("td");
            if (linkParent) {
              nameCol = Array.from(cells).indexOf(linkParent);
            }
          }
          const afterName = nameCol >= 0 ? nameCol + 1 : 1;

          rows.push({
            name,
            id: fileId,
            status: cellTexts[afterName] || "",
            reviewedBy: cellTexts[afterName + 2] || "",
            uploadedDate: cellTexts[afterName + 3] || "",
          });
        });
        return rows;
      });

      console.log(`       ✅ Found ${filesFound.length} files in grid`);

      if (filesFound.length === 0 && fileCount > 0) {
        const gridPageUrl = page.url();
        const sessionDead = gridPageUrl.includes("SessionEnded") || gridPageUrl.includes("b2clogin") || gridPageUrl.includes("Login");
        if (sessionDead) {
          console.log(`       ⚠️ Grid empty but folder claims ${fileCount} files — session expired (URL: ${gridPageUrl})`);
          result.folders.push({ name: folderName, fileCount, files: [], folderError: "session_expired" });
          continue;
        }
        console.log(`       ⚠️ Grid empty but folder claims ${fileCount} files — DOM may not have loaded after crash recovery`);
        result.folders.push({ name: folderName, fileCount, files: [], folderError: "browser_crashed" });
        continue;
      }

      if (filesFound.length > 0) {
        const sample = filesFound.slice(0, 3).map(f => ({ name: f.name, id: f.id, status: f.status }));
        console.log(`       📋 Sample files:`, JSON.stringify(sample));
        const withIds = filesFound.filter(f => f.id).length;
        console.log(`       🔑 Files with IDs: ${withIds}/${filesFound.length}`);
      }

      const folderSafe = folderName.replace(/[/\\?%*:|"<>\s]/g, "_").substring(0, 30);
      const folderFiles = [];
      let folderAborted = false;
      for (let i = 0; i < filesFound.length; i++) {
        if (folderAborted) {
          folderFiles.push({
            name: filesFound[i].name,
            fileId: filesFound[i].id,
            folderName,
            status: filesFound[i].status,
            reviewedBy: filesFound[i].reviewedBy,
            uploadedDate: filesFound[i].uploadedDate,
            commentCount: 0,
            comments: [],
            viewUrl: "",
            downloadStatus: "failed",
            downloadError: "Browser crashed and could not recover",
          });
          continue;
        }

        const file = filesFound[i];
        const rawSafe = file.name.replace(/[/\\?%*:|"<>]/g, "-");
        const safeName = file.id ? `${file.id}_${rawSafe}` : `${folderSafe}_${i}_${rawSafe}`;

        if (commentsOnly) {
          const skipStatuses = ["uploaded", "pending", "new", ""];
          if (skipStatuses.includes((file.status || "").toLowerCase().trim())) {
            folderFiles.push({
              name: file.name,
              fileId: file.id,
              folderName,
              status: file.status,
              reviewedBy: file.reviewedBy,
              uploadedDate: file.uploadedDate,
              commentCount: 0,
              comments: [],
              viewUrl: "",
            });
            continue;
          }
        }

        if (file.id) totalDownloadableCount++;

        if (totalDownloadableCount > 0 && totalDownloadableCount % MINI_RESET_INTERVAL === 0 && file.id) {
          console.log(`       🔄 Mini-reset after ${totalDownloadableCount} total downloads to free memory...`);
          try {
            const oldPage = page;
            page = await recreateFilesPage(context, webUiBase, pdxProjectId, fInfo);
            await oldPage.close().catch(() => {});
            console.log(`       ✅ Mini-reset complete, continuing downloads`);
          } catch (resetErr) {
            console.log(`       ⚠️ Mini-reset failed: ${resetErr.message}`);
            if (isTargetClosedError(resetErr)) {
              try {
                const recovered = await recoverPage(context, session, webUiBase, pdxProjectId, fInfo);
                page = recovered.page;
                context = recovered.context;
                console.log(`       ✅ Browser recovered after mini-reset failure`);
              } catch (recErr) {
                console.log(`       ❌ Recovery failed: ${recErr.message}. Marking remaining files as failed.`);
                folderAborted = true;
                folderFiles.push({
                  name: file.name, fileId: file.id, folderName, status: file.status,
                  reviewedBy: file.reviewedBy, uploadedDate: file.uploadedDate,
                  commentCount: 0, comments: [], viewUrl: "",
                  downloadStatus: "failed", downloadError: "Browser crashed and could not recover",
                });
                continue;
              }
            }
          }
        }

        let viewUrl = "";
        let downloadStatus = null;
        let downloadError = null;
        let dlResult = null;
        if (file.id) {
          console.log(`       📥 [${i + 1}/${filesFound.length}] Downloading via FileHandler: ${safeName}`);
          try {
            dlResult = await downloadProjectDoxFile(page, context, file.id, safeName, webUiBase, session, supabaseProjectId, {
              preferViewerRuntime: /drawing/i.test(folderName || ""),
            });
            if (dlResult.success) {
              viewUrl = dlResult.viewUrl || "";
              if (dlResult.skippedDuplicate) downloadStatus = "skipped_duplicate";
              else if (dlResult.uploadStorageError === "storage_object_too_large") {
                downloadStatus = "upload_skipped_oversized";
              } else downloadStatus = "success";
              console.log(`       🔗 viewUrl for ${safeName}: ${viewUrl || "(empty)"}`);
              await page.waitForTimeout(4000);
            } else {
              console.log(`       ⚠️ File download failed (${dlResult.reason || "unknown"}), continuing to next file: ${safeName}`);
              downloadStatus = "failed";
              downloadError = dlResult.reason || "download_failed";
            }
          } catch (dlErr) {
            console.log(`       ❌ Download exception for ${safeName}: ${dlErr.message}`);
            downloadStatus = "failed";
            downloadError = dlErr.message;

            if (isTargetClosedError(dlErr)) {
              console.log(`       🔄 Target closed — attempting recovery and retry...`);
              try {
                const recovered = await recoverPage(context, session, webUiBase, pdxProjectId, fInfo);
                page = recovered.page;
                context = recovered.context;
                console.log(`       ✅ Recovered, retrying file ${safeName}...`);
                try {
                  const retryResult = await downloadProjectDoxFile(page, context, file.id, safeName, webUiBase, session, supabaseProjectId, {
                    preferViewerRuntime: /drawing/i.test(folderName || ""),
                  });
                  if (retryResult.success) {
                    dlResult = retryResult;
                    viewUrl = retryResult.viewUrl || "";
                    if (retryResult.skippedDuplicate) downloadStatus = "skipped_duplicate";
                    else if (retryResult.uploadStorageError === "storage_object_too_large") {
                      downloadStatus = "upload_skipped_oversized";
                    } else downloadStatus = "success";
                    downloadError = null;
                    console.log(`       ✅ Retry succeeded for ${safeName}`);
                    await page.waitForTimeout(4000);
                  }
                } catch (retryErr) {
                  console.log(`       ⚠️ Retry also failed for ${safeName}: ${retryErr.message}`);
                }
              } catch (recErr) {
                console.log(`       ❌ Recovery failed: ${recErr.message}. Marking remaining files as failed.`);
                folderAborted = true;
              }
            }
          }
        }

        folderFiles.push({
          name: file.name,
          fileId: file.id,
          folderName,
          status: file.status,
          reviewedBy: file.reviewedBy,
          uploadedDate: file.uploadedDate,
          commentCount: 0,
          comments: [],
          viewUrl: viewUrl,
          ...(downloadStatus && { downloadStatus }),
          ...(downloadError && { downloadError }),
          ...(dlResult?.uploadStorageError && {
            uploadStorageError: dlResult.uploadStorageError,
          }),
          ...(dlResult?.uploadStorageMessage && {
            uploadStorageMessage: dlResult.uploadStorageMessage,
          }),
        });

        try {
          await dismissProjectDoxFilesUiBlockers(page);
          const mainU = page.url();
          if (mainU.includes("SessionEnded")) {
            console.log(
              `     ⚠️ Files tab SessionEnded after file row — reopening files tab`,
            );
            page = await recreateFilesPage(context, webUiBase, pdxProjectId, fInfo);
          }
        } catch (_) {}

        if (shouldFilesIncrementalSync && dlResult?.success) {
          filesSuccessfulForBatch++;
          const snapEvery3 = buildFilesFoldersSnapshotForSync(
            result.folders,
            folderName,
            folderFiles,
          );
          if (filesSuccessfulForBatch % 3 === 0) {
            await pushFilesTabProgressToSupabase(
              session,
              filesSyncContext.projects,
              filesSyncContext.project,
              supabaseProjectId,
              filesSyncContext.userId,
              syncHint,
              snapEvery3,
              {
                trigger: "every_3",
                batchSize: 3,
                folderName,
                filesScrapeStatus: "in_progress",
              },
            );
          }
        }
      }

      result.folders.push({
        name: folderName,
        fileCount: filesFound.length || fileCount,
        files: folderFiles,
      });

      if (shouldFilesIncrementalSync) {
        const snapFolderEnd = buildFilesFoldersSnapshotForSync(
          result.folders,
          null,
          null,
        );
        await pushFilesTabProgressToSupabase(
          session,
          filesSyncContext.projects,
          filesSyncContext.project,
          supabaseProjectId,
          filesSyncContext.userId,
          syncHint,
          snapFolderEnd,
          {
            trigger: "folder_end",
            batchSize: 0,
            folderName,
            filesScrapeStatus: "in_progress",
          },
        );
      }
    } catch (err) {
      console.log(`     ⚠️ Folder error: ${err.message}`);
      result.folders.push({
        name: folderName,
        fileCount: fileCount,
        files: [],
        ...(isTargetClosedError(err) && { folderError: "browser_crashed" }),
      });
      if (isTargetClosedError(err)) {
        console.log(`     🔄 Browser crashed during folder "${folderName}", attempting recovery for next folder...`);
        try {
          const recovered = await recoverPage(context, session, webUiBase, pdxProjectId, null);
          page = recovered.page;
          context = recovered.context;
          console.log(`     ✅ Recovered after folder error`);
        } catch (recErr) {
          console.log(`     ❌ Recovery failed: ${recErr.message}. Skipping remaining folders.`);
          for (let rfi = fi + 1; rfi < folderElements.length; rfi++) {
            const rfName = folderElements[rfi].text.replace(/\s*\(.*$/, "").trim();
            const rfCount = (folderElements[rfi].text.match(/\((\d+)/) || [])[1] || 0;
            result.folders.push({ name: rfName, fileCount: parseInt(rfCount, 10), files: [], folderError: "browser_crashed" });
          }
          break;
        }
      }
    }
  }
  try { page.removeListener("request", networkHandler); } catch (_) {}
  if (discoveredDownloadUrls.length > 0) {
    console.log(`     🔗 Discovered download URLs during scrape:`, discoveredDownloadUrls.slice(0, 5));
  }

  if (shouldFilesIncrementalSync) {
    const finalFolders = result.folders.map((f) => ({
      ...f,
      files: dedupeFilesByFileId(f.files || []),
    }));
    const pid = filesSyncContext.project.id;
    session.data[pid].tabs.files = {
      ...(session.data[pid].tabs.files || {}),
      folders: finalFolders,
      filesScrapeStatus: "complete",
    };
    session.data[pid].portalFilesScrapeStatus = "in_progress";
    const total = countFilesInFoldersSnapshot(finalFolders);
    console.log(
      `[Files][incremental-sync] triggered | trigger=extract_complete batchSize=0 folder="(all)" totalFilesInSnapshot=${total} project=${filesSyncContext.project.projectNum}`,
    );
    const filesFinalSyncOk = await syncPortalDataToSupabase(
      session,
      filesSyncContext.projects,
      supabaseProjectId,
      filesSyncContext.userId,
      syncHint,
    );
    if (!filesFinalSyncOk) {
      console.error(
        "    ❌ Supabase sync failed after files extract (final incremental sync)",
      );
    }
    session.data[pid].portalFilesScrapeStatus = null;
    session.data[pid].portalFilesScrapeLabel = null;
    result.filesScrapeStatus = "complete";
  }

  return result;
}

/**
 * SSRS ReportViewer GET export hints (rs:Format=) for generic ProjectDox / Washington.
 * @param {string} viewerPageUrl
 * @returns {{ pdfUrl?: string, excelUrl?: string }}
 */
function ssrsExportUrlsFromViewerPageUrl(viewerPageUrl) {
  const u = String(viewerPageUrl || "").trim();
  if (!u) return {};
  const hasReportViewerPath = /\/ReportViewer\.aspx(?:[?#]|$)/i.test(u);
  // Require an actual report identity so we do not emit export links for
  // portal/index/session URLs that merely mention viewer text.
  // Support both styles:
  //  1) key-based: ?ReportPath=... or ?WFlowInstanceID=...
  //  2) path-style SSRS identity: ?%2fFolder%2fReport or ?/Folder/Report
  let hasReportIdentity = false;
  try {
    const parsed = new URL(u);
    const keys = [...parsed.searchParams.keys()];
    hasReportIdentity = keys.some((k) =>
      /^(ReportPath|WFlowInstanceID)$/i.test(String(k || "").trim())
    );
    if (!hasReportIdentity) {
      hasReportIdentity = keys.some((k) =>
        String(k || "").trim().startsWith("/")
      );
    }
    if (!hasReportIdentity) {
      const rawSearch = String(parsed.search || "");
      hasReportIdentity = /(?:^|[?&])(?:%2[fF]|\/)[^&]+/.test(rawSearch);
    }
  } catch (_) {
    hasReportIdentity = /(?:^|[?&])(ReportPath|WFlowInstanceID)=/i.test(u) ||
      /(?:^|[?&])(?:%2[fF]|\/)[^&]+/.test(u);
  }
  if (!hasReportViewerPath || !hasReportIdentity) return {};

  // Remove any pre-existing rs:Format so each format URL is deterministic.
  const base = u
    .replace(/([?&])rs(?::|%3A)Format=[^&]*/gi, "$1")
    .replace(/([?&])rs(?::|%3A)Command=[^&]*/gi, "$1")
    .replace(/[?&]$/, "");

  const buildNativeSsrsExportUrl = (viewerUrl, format) => {
    try {
      const parsed = new URL(viewerUrl);
      const cleaned = `${parsed.origin}${parsed.pathname}${parsed.search}`.replace(
        /([?&])$/,
        "",
      );
      const join = cleaned.includes("?") ? "&" : "?";
      return `${cleaned}${join}rs:Format=${encodeURIComponent(format)}`;
    } catch (_) {
      const join = viewerUrl.includes("?") ? "&" : "?";
      return `${viewerUrl}${join}rs:Format=${encodeURIComponent(
        format,
      )}`;
    }
  };
  const out = {
    pdfUrl: buildNativeSsrsExportUrl(base, "PDF"),
    excelUrl: buildNativeSsrsExportUrl(base, "EXCELOPENXML"),
  };
  console.log(
    `[SSRS][export-url] viewer=${u} pdf=${out.pdfUrl} excel=${out.excelUrl}`,
  );
  return out;
}

async function extractPDFsFromPage(page, context, uploadOpts = {}) {
  const pdfData = [];
  const hasUploadContext = Boolean(
    uploadOpts?.supabaseProjectId && uploadOpts?.project,
  );
  const projectIdent = hasUploadContext
    ? String(
        uploadOpts.project?.projectNum ||
          uploadOpts.project?.projectID ||
          uploadOpts.project?.projectId ||
          uploadOpts.project?.id ||
          "unknown",
      ).replace(/[^a-zA-Z0-9._-]/g, "_")
    : null;
  const storagePrefix = hasUploadContext
    ? `drawings/${uploadOpts.supabaseProjectId}/washington/${projectIdent}`
    : null;

  const hasPdfMagic = (localPath) => {
    try {
      const buf = fs.readFileSync(localPath);
      return buf.slice(0, 5).toString("utf8") === "%PDF-";
    } catch (_) {
      return false;
    }
  };

  const hasXlsxMagic = (localPath) => {
    try {
      const buf = fs.readFileSync(localPath);
      return (
        buf.length >= 4 &&
        buf[0] === 0x50 &&
        buf[1] === 0x4b &&
        buf[2] === 0x03 &&
        buf[3] === 0x04
      );
    } catch (_) {
      return false;
    }
  };

  /** Washington Excel-only: binary diagnostics (no string/utf8 conversion of file body). */
  const logWashingtonExcelArtifactDiagnostics = (phase, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        console.log(
          `         [Washington][reports][excel-diag] ${phase}: missing path=${filePath}`,
        );
        return;
      }
      const buf = fs.readFileSync(filePath);
      const size = buf.length;
      const n = Math.min(16, buf.length);
      const head = buf.subarray(0, n);
      const hex16 = Buffer.from(head).toString("hex");
      const ascii16 = [...head]
        .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
        .join("");
      const pkZip =
        buf.length >= 4 &&
        buf[0] === 0x50 &&
        buf[1] === 0x4b &&
        buf[2] === 0x03 &&
        buf[3] === 0x04;
      console.log(
        `         [Washington][reports][excel-diag] ${phase}: path=${filePath} size=${size} hex16=${hex16} ascii16=${ascii16} pkZip=${pkZip} (EXCELOPENXML / xlsx zip)`,
      );
    } catch (e) {
      console.warn(
        `         [Washington][reports][excel-diag] ${phase}: read error ${e?.message || e}`,
      );
    }
  };

  /**
   * Washington Excel: verify OOXML package parts (ZIP) — transport can be OK while package is incomplete.
   * @returns {{ ok: boolean, entries: string[], missing: string[], error: string | null }}
   */
  const validateWashingtonXlsxOoxmlPackage = (filePath, reportLabel) => {
    const result = {
      ok: false,
      entries: /** @type {string[]} */ ([]),
      missing: /** @type {string[]} */ ([]),
      error: /** @type {string | null} */ (null),
    };
    try {
      const zip = new AdmZip(filePath);
      const rawEntries = zip
        .getEntries()
        .filter((e) => !e.isDirectory)
        .map((e) => String(e.entryName || "").replace(/\\/g, "/"));
      result.entries = [...new Set(rawEntries)].sort((a, b) =>
        a.localeCompare(b, "en"),
      );
      const lower = new Set(result.entries.map((n) => n.toLowerCase()));
      const hasPath = (p) => lower.has(p.toLowerCase());
      const hasWorksheet = [...lower].some((n) =>
        /^xl\/worksheets\/[^/]+\.xml$/i.test(n),
      );
      const checks = [
        { need: "[Content_Types].xml", pass: hasPath("[Content_Types].xml") },
        { need: "_rels/.rels", pass: hasPath("_rels/.rels") },
        { need: "xl/workbook.xml", pass: hasPath("xl/workbook.xml") },
        {
          need: "xl/_rels/workbook.xml.rels",
          pass: hasPath("xl/_rels/workbook.xml.rels"),
        },
        { need: "xl/worksheets/*.xml", pass: hasWorksheet },
      ];
      for (const c of checks) {
        if (!c.pass) result.missing.push(c.need);
      }
      result.ok = result.missing.length === 0;
    } catch (e) {
      result.error = (e && e.message) || String(e);
    }
    const sample = result.entries.slice(0, 60);
    const more =
      result.entries.length > 60
        ? ` (+${result.entries.length - 60} more entries not logged)`
        : "";
    console.log(
      `         [Washington][reports][xlsx-package] report=${JSON.stringify(
        reportLabel,
      )} structurallyValid=${result.ok} entryCount=${result.entries.length} missing=${JSON.stringify(
        result.missing,
      )}${result.error ? ` zipReadError=${JSON.stringify(result.error)}` : ""}`,
    );
    console.log(
      `         [Washington][reports][xlsx-package] zipEntriesSample=${JSON.stringify(
        sample,
      )}${more}`,
    );
    if (!result.ok && result.missing.length) {
      console.warn(
        `         [Washington][reports][xlsx-package] PACKAGE_DEFECT report=${JSON.stringify(
          reportLabel,
        )} missingParts=${JSON.stringify(result.missing)}`,
      );
    }
    return result;
  };

  const clickSsrsExportMenuTrigger = async (popup) =>
    popup.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const textOf = (el) =>
        String(el?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const candidates = Array.from(
        document.querySelectorAll("a, button, input, span, div"),
      );
      const trigger = candidates.find((el) => {
        if (!isVisible(el)) return false;
        const t = textOf(el);
        if (t === "export") return true;
        const id = String(el.getAttribute("id") || "").toLowerCase();
        const title = String(el.getAttribute("title") || "").toLowerCase();
        return id.includes("export") || title.includes("export");
      });
      if (!trigger) return false;
      if (trigger.tagName === "INPUT") {
        trigger.focus?.();
        trigger.click?.();
      } else {
        trigger.dispatchEvent(
          new MouseEvent("click", {
            view: window,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return true;
    });

  const hasSsrsFormatAnchor = async (popup, formatLabel) =>
    popup.evaluate((label) => {
      const wanted = String(label || "").trim().toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      return Array.from(document.querySelectorAll("a")).some((a) => {
        if (!isVisible(a)) return false;
        const txt = String(a.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return txt === wanted;
      });
    }, formatLabel);

  const clickSsrsFormatAnchor = async (popup, formatLabel) =>
    popup.evaluate((label) => {
      const wanted = String(label || "").trim().toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const anchor = Array.from(document.querySelectorAll("a")).find((a) => {
        if (!isVisible(a)) return false;
        const txt = String(a.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return txt === wanted;
      });
      if (!anchor) return false;
      anchor.dispatchEvent(
        new MouseEvent("click", {
          view: window,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    }, formatLabel);

  const downloadExportFromPopup = async (popup, localPath, reportName, format) => {
    await popup.bringToFront().catch(() => {});

    let anchorVisible = await hasSsrsFormatAnchor(popup, format);
    if (!anchorVisible) {
      const opened = await clickSsrsExportMenuTrigger(popup).catch(() => false);
      if (opened) await popup.waitForTimeout(400).catch(() => {});
      anchorVisible = await hasSsrsFormatAnchor(popup, format);
    }
    if (!anchorVisible) {
      throw new Error(`SSRS export anchor not found for format "${format}"`);
    }

    const downloadPromise = popup.waitForEvent("download", { timeout: 60000 });
    const clicked = await clickSsrsFormatAnchor(popup, format);
    if (!clicked) {
      throw new Error(`Failed to click SSRS export anchor for "${format}"`);
    }
    const download = await downloadPromise;
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await download.saveAs(localPath);
    if (format === "Excel") {
      logWashingtonExcelArtifactDiagnostics("after_saveAs", localPath);
    }
    console.log(
      `         [Washington][reports] popup export captured format=${format} report="${reportName}"`,
    );
    return true;
  };

  /** Washington Excel fallback: same as browser DevTools — ReportViewer1.exportReport('EXCELOPENXML'). */
  const downloadExcelViaReportViewerExportApi = async (
    popup,
    localPath,
    reportName,
  ) => {
    await popup.bringToFront().catch(() => {});
    const downloadPromise = popup.waitForEvent("download", {
      timeout: 90000,
    });
    await popup.evaluate(() => {
      const fn = /** @type {any} */ (window).$find;
      if (typeof fn !== "function") throw new Error("$find not available");
      const rv = fn("ReportViewer1");
      if (!rv || typeof rv.exportReport !== "function") {
        throw new Error("ReportViewer1.exportReport not available");
      }
      rv.exportReport("EXCELOPENXML");
    });
    const download = await downloadPromise;
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await download.saveAs(localPath);
    logWashingtonExcelArtifactDiagnostics(
      "after_saveAs_exportReportApi",
      localPath,
    );
    console.log(
      `         [Washington][reports] EXCELOPENXML via exportReport(ReportViewer1) report="${reportName}"`,
    );
  };

  const enrichReportWithPublicExports = async (popup, reportEntry, viewerUrl) => {
    if (!hasUploadContext || !popup || !reportEntry) return;
    const ssrsUrls = ssrsExportUrlsFromViewerPageUrl(viewerUrl);
    const slug = sanitizeStorageKey(reportEntry.fileName || "report");
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (ssrsUrls.pdfUrl) {
      let pdfPath = null;
      try {
        pdfPath = path.join(os.tmpdir(), `wa_report_${nonce}_${slug}.pdf`);
        await downloadExportFromPopup(
          popup,
          pdfPath,
          reportEntry.fileName,
          "PDF",
        );
        const pdfValid = hasPdfMagic(pdfPath);
        reportEntry.pdfValid = pdfValid;
        reportEntry.pdfPath = pdfPath;
        if (!pdfValid) {
          console.warn(
            `         [Washington][reports] PDF magic-bytes mismatch for "${reportEntry.fileName}" - skipping upload`,
          );
        } else {
          const publicUrl = await uploadToSupabaseStorage(
            pdfPath,
            `${storagePrefix}/reports/${slug}.pdf`,
          );
          if (publicUrl) {
            reportEntry.pdfPublicUrl = publicUrl;
            console.log(
              `         [Washington][reports] uploaded PDF -> ${publicUrl}`,
            );
          }
        }
      } catch (err) {
        console.warn(
          `         [Washington][reports] PDF download/upload error for "${reportEntry.fileName}": ${err?.message || err}`,
        );
      } finally {
        if (pdfPath && fs.existsSync(pdfPath)) {
          try {
            fs.unlinkSync(pdfPath);
          } catch (_) {}
        }
      }
    }

    if (ssrsUrls.excelUrl) {
      await popup
        .goto(viewerUrl, { waitUntil: "networkidle", timeout: 30000 })
        .catch(() => {});
      await popup.waitForTimeout(1500).catch(() => {});
      let excelPath = null;
      try {
        excelPath = path.join(os.tmpdir(), `wa_report_${nonce}_${slug}.xlsx`);
        await downloadExportFromPopup(
          popup,
          excelPath,
          reportEntry.fileName,
          "Excel",
        );
        let pkg = validateWashingtonXlsxOoxmlPackage(
          excelPath,
          reportEntry.fileName,
        );
        reportEntry.excelOoxmlPackageOk = pkg.ok;
        reportEntry.excelOoxmlMissing = pkg.missing;
        reportEntry.excelExportMethod = "anchor";

        if (!pkg.ok || pkg.error) {
          console.warn(
            `         [Washington][reports] Excel OOXML package incomplete after anchor export; retrying via ReportViewer1.exportReport(EXCELOPENXML) for "${reportEntry.fileName}"`,
          );
          if (fs.existsSync(excelPath)) {
            try {
              fs.unlinkSync(excelPath);
            } catch (_) {}
          }
          await popup
            .goto(viewerUrl, { waitUntil: "networkidle", timeout: 30000 })
            .catch(() => {});
          await popup.waitForTimeout(2000).catch(() => {});
          await downloadExcelViaReportViewerExportApi(
            popup,
            excelPath,
            reportEntry.fileName,
          );
          pkg = validateWashingtonXlsxOoxmlPackage(
            excelPath,
            `${reportEntry.fileName} (after exportReport API)`,
          );
          reportEntry.excelOoxmlPackageOk = pkg.ok;
          reportEntry.excelOoxmlMissing = pkg.missing;
          reportEntry.excelExportMethod = "exportReportApi";
        }

        const magicOk = hasXlsxMagic(excelPath);
        const excelValid =
          magicOk && pkg.ok && !pkg.error;
        reportEntry.excelValid = excelValid;
        reportEntry.excelPath = excelPath;

        if (!magicOk) {
          logWashingtonExcelArtifactDiagnostics(
            "before_upload_skipped_invalid_magic",
            excelPath,
          );
          console.warn(
            `         [Washington][reports] Excel magic-bytes mismatch for "${reportEntry.fileName}" - skipping upload`,
          );
        } else if (!pkg.ok || pkg.error) {
          logWashingtonExcelArtifactDiagnostics(
            "before_upload_skipped_invalid_ooxml",
            excelPath,
          );
          console.warn(
            `         [Washington][reports] Excel OOXML package still invalid for "${reportEntry.fileName}" missing=${JSON.stringify(pkg.missing)} err=${pkg.error || "none"} - skipping upload`,
          );
        } else {
          logWashingtonExcelArtifactDiagnostics("before_upload", excelPath);
          const publicUrl = await uploadToSupabaseStorage(
            excelPath,
            `${storagePrefix}/reports/${slug}.xlsx`,
          );
          if (publicUrl) {
            reportEntry.excelPublicUrl = publicUrl;
            console.log(
              `         [Washington][reports] uploaded Excel -> ${publicUrl}`,
            );
            try {
              const localBuf = fs.readFileSync(excelPath);
              const localSha = crypto
                .createHash("sha256")
                .update(localBuf)
                .digest("hex");
              const localHead32 = localBuf.subarray(0, 32).toString("hex");
              const res = await fetch(publicUrl, { redirect: "follow" });
              const remoteAb = await res.arrayBuffer();
              const remoteBuf = Buffer.from(remoteAb);
              const remoteSha = crypto
                .createHash("sha256")
                .update(remoteBuf)
                .digest("hex");
              const remoteHead32 = remoteBuf.subarray(0, 32).toString("hex");
              const bytesMatch =
                localBuf.length === remoteBuf.length && localSha === remoteSha;
              console.log(
                `         [Washington][reports][excel-roundtrip] report=${JSON.stringify(
                  reportEntry.fileName,
                )} httpStatus=${res.status} contentType=${JSON.stringify(
                  res.headers.get("content-type") || "",
                )} localSize=${localBuf.length} remoteSize=${remoteBuf.length} sha256Match=${bytesMatch}`,
              );
              console.log(
                `         [Washington][reports][excel-roundtrip] sha256 local=${localSha} remote=${remoteSha}`,
              );
              console.log(
                `         [Washington][reports][excel-roundtrip] first32hex local=${localHead32} remote=${remoteHead32}`,
              );
              if (!bytesMatch) {
                console.warn(
                  `         [Washington][reports][excel-roundtrip] BYTES_DIFFER_AFTER_UPLOAD report=${JSON.stringify(
                    reportEntry.fileName,
                  )}`,
                );
              }
            } catch (rtErr) {
              console.warn(
                `         [Washington][reports][excel-roundtrip] verify failed: ${rtErr?.message || rtErr}`,
              );
            }
          }
        }

        if (excelValid) {
          await attachReviewCommentsStructuredRowsToPdfEntry({
            pdfEntry: reportEntry,
            reportName: reportEntry.fileName,
            localExcelPath: excelPath,
            logTag: "Washington",
          });
        } else if (isPgcReviewCommentsReportName(reportEntry.fileName)) {
          console.log(
            `         [Washington][reports][excel-structured] skipped structured extract — invalid excel artifact for ${JSON.stringify(
              reportEntry.fileName,
            )}`,
          );
        }
      } catch (err) {
        console.warn(
          `         [Washington][reports] Excel download/upload error for "${reportEntry.fileName}": ${err?.message || err}`,
        );
      } finally {
        if (excelPath && fs.existsSync(excelPath)) {
          try {
            fs.unlinkSync(excelPath);
          } catch (_) {}
        }
      }
    }
  };

  const reportPageUrl = page.url();
  if (reportPageUrl.includes("SessionEnded") || reportPageUrl.includes("b2clogin") || reportPageUrl.includes("Login")) {
    console.log(`      ⚠️ Reports tab: session expired (URL: ${reportPageUrl}). Skipping PDF extraction.`);
    return pdfData;
  }

  await page.waitForSelector("table tr", { timeout: 15000 }).catch(() => {
    console.log("      ⚠️ No table rows found on Reports tab within 15s — page may be empty after session recovery");
  });

  // Get all report names from the visible table first
  const reportNames = await page.evaluate(() => {
    const names = [];
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length >= 3) {
        // Find any link or text in the second cell (Report Name column)
        const nameCell = cells[1];
        if (nameCell) {
          const link = nameCell.querySelector("a");
          const text = (link || nameCell).textContent.trim();
          if (
            text &&
            text.length > 5 &&
            !text.toLowerCase().includes("contains")
          ) {
            names.push(text);
          }
        }
      }
    });
    return names;
  });

  console.log(
    `      📄 Found ${reportNames.length} report names: ${reportNames.map((n) => '"' + n + '"').join(", ")}`,
  );

  if (reportNames.length === 0) {
    console.log("      ⚠️ No report names found in table");
    return pdfData;
  }

  // Click each report link by its text
  for (let i = 0; i < reportNames.length; i++) {
    const reportName = reportNames[i];
    console.log(
      `      📄 [${i + 1}/${reportNames.length}] Clicking: "${reportName}"`,
    );

    try {
      // Find the clickable link by text content
      const linkHandle = await page
        .locator(`a:has-text("${reportName}")`)
        .first()
        .elementHandle()
        .catch(() => null);

      if (!linkHandle) {
        console.log(
          `         ⚠️ Could not find clickable link for "${reportName}"`,
        );
        pdfData.push({
          fileName: reportName,
          text: "",
          pages: 0,
          error: "Link element not found on page",
        });
        continue;
      }

      // Set up popup listener BEFORE clicking
      const popupPromise = context
        .waitForEvent("page", { timeout: 25000 })
        .catch(() => null);

      // Click the link
      await linkHandle.click();
      console.log(`         Clicked, waiting for popup...`);

      const popup = await popupPromise;

      if (popup) {
        console.log(`         Popup detected: ${popup.url()}`);

        // Wait for the report to fully render
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await popup.waitForTimeout(3000);
        await popup.waitForLoadState("networkidle").catch(() => {});
        await popup.waitForTimeout(5000);

        const finalUrl = popup.url();
        console.log(`         Popup final URL: ${finalUrl}`);

        // Save debug screenshot for first report (optional; SCRAPER_DEBUG_ARTIFACTS=1)
        if (i === 0 && isScraperDebugArtifactsEnabled()) {
          await popup
            .screenshot({
              path: path.join(SCRAPER_ROOT, "debug_report_popup.png"),
              fullPage: true,
            })
            .catch(() => {});
          console.log(`         📸 debug_report_popup.png saved`);
        }

        // Extract text + full HTML from report popup (SSRS uses nested tables; capture HTML for direct render)
        const content = await popup.evaluate(() => {
          const ssrsSelectors = [
            '[id*="oReportDiv"]',
            '[id*="ReportDiv"]',
            '[id*="VisibleReportContent"]',
            '[id*="ReportViewerControl"]',
            '[id*="reportDiv"]',
          ];

          let targetEl = null;
          for (const sel of ssrsSelectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText && el.innerText.trim().length > 50) {
              targetEl = el;
              break;
            }
          }

          if (!targetEl) {
            const iframes = document.querySelectorAll("iframe");
            for (const iframe of iframes) {
              try {
                const doc =
                  iframe.contentDocument || iframe.contentWindow?.document;
                if (doc?.body?.innerText?.length > 50) {
                  targetEl = doc.body;
                  break;
                }
              } catch (e) {}
            }
          }

          if (!targetEl) {
            const clone = document.body.cloneNode(true);
            clone
              .querySelectorAll(
                "nav, header, footer, style, script, noscript, " +
                  "[id*='toolbar'], [id*='Toolbar'], [class*='toolbar'], " +
                  "button, select, input",
              )
              .forEach((el) => el.remove());
            targetEl = clone;
          }

          const text = targetEl.innerText?.trim() || "";
          const html = targetEl.innerHTML || "";

          return { text, html, source: "ssrs" };
        });

        // Full-page PNG then normalize (thumbnail/full/off via EPERMIT_REPORT_SCREENSHOT_MODE)
        let screenshotBase64 = "";
        if (getReportScreenshotMode() !== "off") {
          try {
            const screenshotBuffer = await popup.screenshot({
              fullPage: true,
              type: "png",
            });
            screenshotBase64 = await normalizeReportScreenshotBufferForPortalData(
              screenshotBuffer,
            );
            if (screenshotBase64) {
              console.log(
                `         📸 Screenshot: ${Math.round(screenshotBase64.length / 1024)}KB base64 (mode=${getReportScreenshotMode()})`,
              );
            }
          } catch (ssErr) {
            console.log(`         ⚠️ Screenshot failed: ${ssErr.message}`);
          }
        }
        if (content?.text && content.text.length > 50) {
          const cleaned = content.text
            .replace(
              /^(Export|Print|Refresh|Find\s*\|?\s*Next|Home|Logout|View Report|100%|\d+ of \d+).*$/gm,
              "",
            )
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          console.log(
            `         ✓ Extracted ${cleaned.length} chars, html: ${(content.html || "").length} (source: ${content.source})`,
          );
          console.log(`         [DEBUG] text length: ${cleaned?.length || 0}`);
          console.log(
            `         [DEBUG] html length: ${content?.html?.length || 0}`,
          );
          console.log(
            `         [DEBUG] html first 200 chars: ${(content?.html || "").substring(0, 200)}`,
          );
          const reportEntry = {
            fileName: reportName,
            text: cleaned,
            screenshot: screenshotBase64,
            pages: 1,
            url: finalUrl,
            info: { source: content.source },
            ...ssrsExportUrlsFromViewerPageUrl(finalUrl),
          };
          pdfData.push(reportEntry);
          await enrichReportWithPublicExports(popup, reportEntry, finalUrl);
        } else {
          console.log(
            `         ⚠️ No meaningful content (${content?.text?.length || 0} chars, source: ${content?.source})`,
          );
          const reportEntry = {
            fileName: reportName,
            text: "",
            pages: 0,
            error: "No content extracted",
            url: finalUrl,
            ...ssrsExportUrlsFromViewerPageUrl(finalUrl),
          };
          pdfData.push(reportEntry);
          await enrichReportWithPublicExports(popup, reportEntry, finalUrl);
        }

        await popup.close().catch(() => {});
      } else {
        // No popup — check if content appeared in an iframe on the same page
        console.log(
          `         ⚠️ No popup opened, checking page for iframe/overlay...`,
        );
        await page.waitForTimeout(3000);

        const inlineContent = await page.evaluate(() => {
          const iframes = document.querySelectorAll("iframe");
          for (const iframe of iframes) {
            try {
              const doc =
                iframe.contentDocument || iframe.contentWindow?.document;
              if (doc?.body?.innerText?.length > 100) return doc.body.innerText;
            } catch (e) {}
          }
          // Check for modal/overlay
          const modal = document.querySelector(
            "[class*='modal'], [class*='overlay'], [class*='dialog']",
          );
          if (modal?.innerText?.length > 100) return modal.innerText;
          return null;
        });

        if (inlineContent) {
          console.log(
            `         ✓ Found inline content: ${inlineContent.length} chars`,
          );
          const inlineViewerUrl = page.url();
          pdfData.push({
            fileName: reportName,
            text: inlineContent,
            pages: 1,
            url: inlineViewerUrl,
            info: { source: "inline" },
            ...ssrsExportUrlsFromViewerPageUrl(inlineViewerUrl),
          });
        } else {
          pdfData.push({
            fileName: reportName,
            text: "",
            pages: 0,
            error: "No popup or inline content",
          });
        }
      }
    } catch (err) {
      console.error(`         ✗ Error: ${err.message}`);
      pdfData.push({
        fileName: reportName,
        text: "",
        pages: 0,
        error: err.message,
      });
    }
  }

  return pdfData;
}

async function closeStaleMontgomeryViewerPopups(context, mainPage) {
  if (!context || !mainPage) return;
  let pages = [];
  try {
    pages = context.pages();
  } catch (_) {
    return;
  }
  for (const p of pages) {
    if (!p || p === mainPage) continue;
    let closed = false;
    try {
      if (typeof p.isClosed === "function" && p.isClosed()) continue;
      const url = p.url();
      if (
        /FileViewer|WebViewer|viewfile|File\/FileViewer/i.test(url) ||
        /WebViewer\/ui\/index\.html/i.test(url)
      ) {
        await p.close().catch(() => {});
        closed = true;
      }
    } catch (_) {
      if (!closed) await p.close().catch(() => {});
    }
  }
}

async function findMontgomeryViewerPopupForFileId(context, mainPage, requestedFileId) {
  const targetId = String(requestedFileId || "").trim();
  if (!targetId || !context) return null;
  let pages = [];
  try {
    pages = context.pages();
  } catch (_) {
    return null;
  }
  for (const p of pages) {
    if (!p || p === mainPage) continue;
    try {
      if (typeof p.isClosed === "function" && p.isClosed()) continue;
      const frame = p.frames().find(
        (f) => f.url().includes("WebViewer") && f.url().includes("index.html"),
      );
      if (!frame) continue;
      const fileConfig = await frame
        .evaluate(() => {
          try {
            const hash = window.location.hash;
            const customMatch = hash.match(/[?&#]custom=([^&#]+)/);
            if (!customMatch) return null;
            return JSON.parse(decodeURIComponent(customMatch[1]));
          } catch (_) {
            return null;
          }
        })
        .catch(() => null);
      if (fileConfig?.fileID != null && String(fileConfig.fileID) === targetId) {
        return p;
      }
    } catch (_) {}
  }
  return null;
}

async function downloadMontgomeryProjectDoxFile(
  page,
  context,
  fileId,
  fileName,
  webUiBase,
  session,
  projectId,
  folderDisplayName = "",
) {
  const isDrawingsFolder = String(folderDisplayName || "")
    .toLowerCase()
    .includes("drawing");
  return await downloadProjectDoxFile(
    page,
    context,
    fileId,
    fileName,
    webUiBase,
    session,
    projectId,
    {
      adapter: "montgomery",
      preferDirectRetrieve: false,
      preferViewerRuntime: isDrawingsFolder,
      montgomeryWebApiNonDrawingsDirect: !isDrawingsFolder,
    },
  );
}


let _downloadProjectDoxFileCallSeq = 0;

async function downloadProjectDoxFile(page, context, fileId, fileName, webUiBase, session, projectId, options = {}) {
  const downloadDir = getDownloadsDir();
  const adapter = String(options?.adapter || "").trim().toLowerCase();
  const preferDirectRetrieve = options?.preferDirectRetrieve === true;
  const preferViewerRuntime = options?.preferViewerRuntime === true;
  const montgomeryWebApiNonDrawingsDirect =
    options?.montgomeryWebApiNonDrawingsDirect === true;
  const origin = String(webUiBase || "").replace(/\/$/, "");
  const isMontgomeryAdapter = adapter === "montgomery";
  const logMontgomeryFinal = (message) => {
    if (isMontgomeryAdapter) console.log(`[Montgomery][files-final] ${message}`);
  };
  const pdoxCallId = ++_downloadProjectDoxFileCallSeq;

  if (session && session._scrapeCumulativeBytes >= MAX_SCRAPE_CUMULATIVE_SIZE) {
    console.log(`      ⚠️ Cumulative download limit reached (${(session._scrapeCumulativeBytes / 1024 / 1024).toFixed(0)} MB / ${(MAX_SCRAPE_CUMULATIVE_SIZE / 1024 / 1024).toFixed(0)} MB). Skipping file: ${fileName}`);
    const earlyResult = { success: false, reason: "cumulative_limit" };
    console.log(
      `[Montgomery Files] early return pre-popup | fileId=${fileId} | fileName="${fileName}" | result=${JSON.stringify(earlyResult)}`,
    );
    return earlyResult;
  }

  console.log(`      📥 Downloading file ID ${fileId}: ${fileName}`);

  const downloadPath = path.join(downloadDir, fileName);
  const cacheBuster = `_nocache=${Date.now()}_${fileId}`;

  function computeHash(buffer) {
    return crypto.createHash("md5").update(buffer).digest("hex");
  }

  function isDuplicate(contentHash) {
    if (!contentHash || !session?._downloadedHashes) return { dup: false };
    const prev = session._downloadedHashes.get(contentHash);
    if (prev) {
      console.log(`      ⚠️ DUPLICATE DETECTED: ${fileName} has same content (md5: ${contentHash}) as previously downloaded "${prev.fileName}". Aliasing viewUrl.`);
      return { dup: true, aliasUrl: prev.viewUrl || "" };
    }
    return { dup: false };
  }

  function registerHash(contentHash, viewUrl) {
    if (contentHash && session?._downloadedHashes) {
      session._downloadedHashes.set(contentHash, { fileName, viewUrl: viewUrl || "" });
    }
  }

  const JUNK_URL_PATTERNS = /pdfnet\.res|spinner\.gif|PDFNetCWasm|webviewer\.min|chunks\/|core\/.*\.js|ui\/.*\.css/i;

  function isJunkUrl(url) {
    return JUNK_URL_PATTERNS.test(url);
  }

  function isKnownFileEndpointUrl(u) {
    return /filehandler|retrievefile|getfile|viewfile|filedownload|\/File\/RetrieveFile|\/File\/Download|GetFile\.ashx|\/File\/GetFile/i.test(
      String(u || ""),
    );
  }

  function hasAttachmentDispositionHeader(h) {
    const cd = (h["content-disposition"] || h["Content-Disposition"] || "").toLowerCase();
    return /attachment|filename=/.test(cd);
  }

  function isBlobOrBrandingAssetUrl(u) {
    const s = String(u || "");
    if (/^blob:/i.test(s) || /^data:/i.test(s)) return true;
    return /\/Media\/|\/images\/|logo|favicon|brand|spinner|loading\.gif|\.ico(\?|$)|\/Content\/|webviewer\.min|chunks\//i.test(
      s,
    );
  }

  /** Do not treat weak octet-stream / blob / images as "real file" without endpoint, disposition, or PDF magic (body checked elsewhere). */
  function shouldAcceptRealFileResponseWithoutBody(response) {
    const u = response.url();
    const ct = (response.headers()["content-type"] || "").toLowerCase();
    if (isBlobOrBrandingAssetUrl(u)) return false;
    if (isViewerShellUrl(u)) return false;
    if (isHtmlLikeContentType(ct)) return false;
    if (isNonFileEndpointGif(u, ct)) return false;
    if (isJunkUrl(u)) return false;
    if (isMontgomeryAdapter && isMontgomeryIconNoiseUrl(u)) return false;
    if (ct.includes("application/pdf")) return true;
    if (isKnownFileEndpointUrl(u)) return true;
    if (hasAttachmentDispositionHeader(response.headers())) return true;
    if (ct.includes("application/octet-stream")) return false;
    if (/^image\//i.test(ct)) return false;
    if (isFileUrl(u)) return true;
    if (isFileContentType(ct) && !/^image\//i.test(ct)) return true;
    return false;
  }

  function passesStrongFileEvidenceAfterBody(u, ct, headers, body) {
    const h = headers || {};
    const cd = (h["content-disposition"] || h["Content-Disposition"] || "").toLowerCase();
    const url = String(u || "");
    if (isBlobOrBrandingAssetUrl(url)) return false;
    if (isViewerShellUrl(url)) return false;
    if (isHtmlLikeContentType(ct)) return false;
    if (isNonFileEndpointGif(url, ct)) return false;
    if (isJunkUrl(url)) return false;
    if (isMontgomeryAdapter && isMontgomeryIconNoiseUrl(url)) return false;
    if (ct.includes("application/pdf")) {
      return hasValidPdfHeader(body) || isKnownFileEndpointUrl(url);
    }
    if (isKnownFileEndpointUrl(url)) return true;
    if (/attachment|filename=/i.test(cd)) return true;
    if (ct.includes("application/octet-stream")) {
      if (body && hasValidPdfHeader(body)) return true;
      if (/\.(pdf|dwg|doc|docx|xlsx|zip)(\?|$)/i.test(url)) return true;
      return false;
    }
    if (/^image\//i.test(ct)) {
      return isKnownFileEndpointUrl(url) || /attachment|filename=/i.test(cd);
    }
    if (isFileContentType(ct) && !/^image\//i.test(ct)) return true;
    return false;
  }

  /** GIFs from static/UI paths (WebViewer spinners, loading.gif) are not downloads; real attachments use file endpoints. */
  function isNonFileEndpointGif(url, contentType) {
    if (!/image\/gif/i.test(String(contentType || ""))) return false;
    return !/filehandler|retrievefile|getfile|viewfile|filedownload|download|GetFile\.|\/File\//i.test(
      String(url || ""),
    );
  }

  const tryUploadAndClean = async (filePath, sizeMB, contentHash, meta = {}) => {
    const fileSizeKB =
      meta.fileSizeKB != null
        ? meta.fileSizeKB
        : Math.max(1, Math.round(Number(sizeMB || 0) * 1024));
    const dupCheck = isDuplicate(contentHash);
    if (dupCheck.dup) {
      console.log(
        `[Montgomery Files] skipped as duplicate hash | fileId=${fileId} | fileName="${fileName}" | hash=${contentHash}`,
      );
      try { fs.unlinkSync(filePath); } catch (_) {}
      return {
        success: true,
        path: filePath,
        sizeMB,
        viewUrl: dupCheck.aliasUrl,
        publicUrl: dupCheck.aliasUrl || null,
        downloadUrl: meta.downloadUrl || null,
        fileSizeKB,
        contentHash,
        skippedDuplicate: true,
      };
    }
    if (!projectId) {
      console.log(`      ⚠️ No projectId — keeping file locally: ${fileName}`);
      registerHash(contentHash, "");
      return {
        success: true,
        path: filePath,
        sizeMB,
        viewUrl: meta.downloadUrl || "",
        publicUrl: null,
        downloadUrl: meta.downloadUrl || null,
        fileSizeKB,
        contentHash,
      };
    }
    const storagePath = `drawings/${projectId}/${fileName}`;
    const upRes = await uploadToSupabaseStorageResult(filePath, storagePath);
    if (upRes.publicUrl) {
      console.log(`      ☁️  Uploaded to Supabase Storage: ${storagePath}`);
      try { fs.unlinkSync(filePath); } catch (_) {}
      registerHash(contentHash, upRes.publicUrl);
      return {
        success: true,
        path: filePath,
        sizeMB,
        viewUrl: upRes.publicUrl,
        publicUrl: upRes.publicUrl,
        downloadUrl: meta.downloadUrl || null,
        fileSizeKB,
        contentHash,
      };
    }
    if (upRes.errorCode === "storage_object_too_large") {
      console.log(
        `      ⚠️ Supabase storage object size limit — keeping local file; retrieve URL preserved: ${fileName}`,
      );
      registerHash(contentHash, meta.downloadUrl || "");
      return {
        success: true,
        path: filePath,
        sizeMB,
        viewUrl: meta.downloadUrl || "",
        publicUrl: null,
        downloadUrl: meta.downloadUrl || null,
        fileSizeKB,
        contentHash,
        uploadStorageError: "storage_object_too_large",
        uploadStorageMessage: upRes.errorMessage || null,
      };
    }
    console.log(`      ⚠️ Supabase upload failed — keeping local copy: ${fileName}`);
    registerHash(contentHash, "");
    return {
      success: true,
      path: filePath,
      sizeMB,
      viewUrl: meta.downloadUrl || "",
      publicUrl: null,
      downloadUrl: meta.downloadUrl || null,
      fileSizeKB,
      contentHash,
      uploadStorageError: upRes.errorCode || "storage_upload_failed",
    };
  };

  if (!isMontgomeryAdapter) {
    const existingPages = context.pages();
    for (const p of existingPages) {
      if (p !== page) {
        await p.close().catch(() => {});
      }
    }
  } else {
    console.log(
      `[Montgomery][page-recover] skipping pre-download page sweep | fileId=${fileId} | fileName="${fileName}"`,
    );
  }

  const PDF_MAGIC = Buffer.from("%PDF");

  function isFileContentType(ct) {
    return ct.includes("application/pdf") || ct.includes("application/octet-stream") ||
      ct.includes("image/") || ct.includes("application/zip") ||
      ct.includes("application/msword") || ct.includes("application/vnd.openxmlformats");
  }

  function isFileUrl(url) {
    return /\.(pdf|dwg|doc|docx|xlsx|jpg|png|zip)(\?|$)/i.test(url) ||
      /filehandler|filedownload|getfile|viewfile|retrievefile/i.test(url);
  }

  function hasValidPdfHeader(buffer) {
    return buffer && buffer.length >= 4 && buffer.slice(0, 4).equals(PDF_MAGIC);
  }

  function isViewerShellUrl(url) {
    return /\/File\/FileViewer\b|\/Scripts\/File\/WebViewer\/|\/ui\/index\.html\b/i.test(
      String(url || ""),
    );
  }

  function isHtmlLikeContentType(ct) {
    return /text\/html|text\/javascript|text\/css|application\/json/i.test(
      String(ct || ""),
    );
  }

  function isMontgomeryIconNoiseUrl(url) {
    return /\/Media\/img\/icons\/|ico_copy\.png/i.test(String(url || ""));
  }

  async function fetchBinaryViaPage(targetPage, rawUrl) {
    const fetchResult = await targetPage.evaluate(async (url) => {
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      const ct = r.headers.get("content-type") || "";
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const chunks = [];
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        let binary = "";
        for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
        chunks.push(btoa(binary));
      }
      return {
        ok: r.ok,
        status: r.status,
        finalUrl: r.url || url,
        contentType: ct,
        chunks,
        size: bytes.length,
      };
    }, rawUrl);

    if (!fetchResult?.ok) {
      throw new Error(`HTTP ${fetchResult?.status || "fetch_failed"}`);
    }
    if (
      isHtmlLikeContentType(fetchResult.contentType) ||
      isJunkUrl(fetchResult.finalUrl) ||
      isViewerShellUrl(fetchResult.finalUrl)
    ) {
      throw new Error("viewer_shell");
    }

    return {
      ...fetchResult,
      buffer: Buffer.concat((fetchResult.chunks || []).map((c) => Buffer.from(c, "base64"))),
    };
  }

  /** Avolve WebViewer iframe → hash fileConfig → Web API RetrieveFile (any tenant: Montgomery, Washington DC, …). */
  async function extractAvolveWebViewerFileFromPopup(targetPopup, metadata = {}) {
    await targetPopup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    await targetPopup.waitForLoadState("load", { timeout: 20000 }).catch(() => {});

    let webUiOrigin = "";
    try {
      webUiOrigin = new URL(targetPopup.url()).origin;
    } catch (_) {
      webUiOrigin = String(origin || "").replace(/\/$/, "");
    }
    const webApiOrigin = webUiOrigin.replace(/projectdoxwebui/gi, "projectdoxwebapi");
    const logPrefix = isMontgomeryAdapter ? "[Montgomery Files]" : "[ProjectDox Files][drawings-viewer]";

    console.log(`${logPrefix} viewer popup top URL: ${targetPopup.url() || "none"}`);
    logMontgomeryFinal(`viewer popup page = ${targetPopup.url() || "none"}`);

    const viewerFrame = await (async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        for (const frame of targetPopup.frames()) {
          const url = frame.url();
          if (url.includes("WebViewer") && url.includes("index.html")) {
            return frame;
          }
        }
        await targetPopup.waitForTimeout(500).catch(() => {});
      }
      return null;
    })();

    if (!viewerFrame) {
      throw new Error("viewer_frame_not_found");
    }
    const iframeUrl = viewerFrame.url();
    console.log(`${logPrefix} viewer iframe URL: ${iframeUrl.substring(0, 200)}`);
    logMontgomeryFinal(`viewer iframe src = ${iframeUrl.substring(0, 160)}`);

    const fileConfig = await viewerFrame
      .evaluate(() => {
        try {
          const hash = window.location.hash;
          const customMatch = hash.match(/[?&#]custom=([^&#]+)/);
          if (!customMatch) return null;
          return JSON.parse(decodeURIComponent(customMatch[1]));
        } catch (_) {
          return null;
        }
      })
      .catch(() => null);

    console.log(
      `${logPrefix} fileConfig fileID=${fileConfig?.fileID ?? "none"} fileName=${String(fileConfig?.fileName || metadata?.fileName || "").slice(0, 120)}`,
    );

    if (!fileConfig?.fileID) {
      throw new Error("viewer_missing_file_config");
    }

    const requestedFileId =
      metadata?.fileId != null ? String(metadata.fileId).trim() : "";
    if (
      requestedFileId &&
      String(fileConfig.fileID).trim() !== requestedFileId
    ) {
      throw new Error("stale_popup_file_id_mismatch");
    }

    const ctx = targetPopup.context();
    const allCookies = await ctx.cookies([webUiOrigin]);

    const sessionCookie = allCookies.find((c) => c.name === "SessionID");
    if (!sessionCookie) {
      throw new Error("SessionID cookie not found");
    }

    const sessionIdVal = sessionCookie.value;
    console.log(`${logPrefix} portal session cookie present for RetrieveFile`);

    const retrieveUrl = `${webApiOrigin}/File/RetrieveFile?convertToPDF=true&inline=true&blackCADBackground=false&fileID=${fileConfig.fileID}`;
    console.log(
      `${logPrefix} RetrieveFile start fileID=${fileConfig.fileID} timeoutMs=${MONTGOMERY_RETRIEVE_TIMEOUT_MS}`,
    );

    const response = await ctx.request.get(retrieveUrl, {
      timeout: MONTGOMERY_RETRIEVE_TIMEOUT_MS,
      headers: {
        sessionid: sessionIdVal,
        Referer: `${webUiOrigin}/`,
        Origin: webUiOrigin,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const respCt = response.headers()["content-type"] || "";
    console.log(
      `${logPrefix} RetrieveFile response fileID=${fileConfig.fileID} HTTP ${response.status()} ${respCt}`,
    );

    if (response.ok()) {
      let buffer;
      try {
        buffer = await response.body();
      } catch (bodyErr) {
        const bmsg = String(bodyErr?.message || bodyErr || "");
        console.log(
          `${logPrefix} RetrieveFile body read failed fileID=${fileConfig.fileID} reason=${/timeout|timed out/i.test(bmsg) ? "timeout" : "body_error"} timeoutMs=${MONTGOMERY_RETRIEVE_TIMEOUT_MS}`,
        );
        throw bodyErr;
      }
      if (buffer && buffer.length >= MIN_FILE_SIZE && hasValidPdfHeader(buffer)) {
        console.log(
          `${logPrefix} RetrieveFile ok fileID=${fileConfig.fileID} bytes=${buffer.length}`,
        );
        return {
          viewerIndex: 0,
          viewersCount: 1,
          filename: fileConfig.fileName || metadata?.fileName || "",
          fileType: "pdf",
          pages: 0,
          fileSize: buffer.length,
          downloadLink: retrieveUrl,
          buffer,
        };
      }
      if (respCt.includes("pdf") && buffer?.length >= MIN_FILE_SIZE) {
        if (
          buffer[0] === 0x25 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x44 &&
          buffer[3] === 0x46
        ) {
          console.log(
            `${logPrefix} RetrieveFile ok fileID=${fileConfig.fileID} bytes=${buffer.length}`,
          );
          return {
            viewerIndex: 0,
            viewersCount: 1,
            filename: fileConfig.fileName || metadata?.fileName || "",
            fileType: "pdf",
            pages: 0,
            fileSize: buffer.length,
            downloadLink: retrieveUrl,
            buffer,
          };
        }
      }
      console.log(
        `${logPrefix} RetrieveFile rejected fileID=${fileConfig.fileID} bytes=${buffer?.length ?? 0}`,
      );
    }

    throw new Error(
      `PDF fetch failed: status=${response.status()} ct=${respCt}`,
    );
  }

  const capturedResponses = [];
  const contextResponseHandler = async (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] || "";
    const status = response.status();
    if (isMontgomeryAdapter && isMontgomeryIconNoiseUrl(url)) return;
    if (status === 200 && (isFileContentType(ct) || isFileUrl(url))) {
      logMontgomeryFinal(
        `candidate real file response = ${url.substring(0, 180)} (${ct || "unknown"})`,
      );
      if (isJunkUrl(url)) {
        logMontgomeryFinal(`rejected candidate reason = junk_url ${url.substring(0, 160)}`);
        return;
      }
      if (isViewerShellUrl(url)) {
        logMontgomeryFinal(`rejected candidate reason = viewer_shell ${url.substring(0, 160)}`);
        return;
      }
      if (isNonFileEndpointGif(url, ct)) {
        console.log(
          `[PATCH-CHECK] contextResponseHandler gif guard rejecting url=${url.substring(0, 160)} ct=${ct}`,
        );
        logMontgomeryFinal(
          `rejected candidate reason = gif_ui_asset_not_file_endpoint ${url.substring(0, 160)}`,
        );
        return;
      }
      try {
        const body = await response.body().catch(() => null);
        if (body && body.length >= MIN_FILE_SIZE) {
          if (isHtmlLikeContentType(ct)) {
            logMontgomeryFinal(`rejected candidate reason = html_like_content_type ${ct}`);
            return;
          }
          if (!passesStrongFileEvidenceAfterBody(url, ct, response.headers(), body)) {
            logMontgomeryFinal(
              `rejected candidate reason = weak_file_evidence url=${url.substring(0, 120)} ct=${ct}`,
            );
            return;
          }
          capturedResponses.push({ url, contentType: ct, body });
        } else {
          logMontgomeryFinal(`rejected candidate reason = too_small ${body ? body.length : 0} bytes`);
        }
      } catch (e) {}
    }
  };

  const cacheRouteHandler = async (route) => {
    const req = route.request();
    const url = req.url();
    if (isFileContentType(req.headers()["accept"] || "") || isFileUrl(url) ||
        /filehandler|viewfile|getfile|filedownload/i.test(url)) {
      await route.continue({
        headers: {
          ...req.headers(),
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "If-None-Match": "",
          "If-Modified-Since": "",
        },
      });
    } else {
      await route.continue();
    }
  };
  await context.route("**/*", cacheRouteHandler);

  const allPages = context.pages();
  for (const p of allPages) p.on("response", contextResponseHandler);
  const onNewPageCapture = (newPage) => { newPage.on("response", contextResponseHandler); };
  context.on("page", onNewPageCapture);
  let popup = null;

  let montgomeryPageLifeFrameNavHandler = null;
  let montgomeryPageLifeContextPageHandler = null;
  let montgomeryPageLifeOnClose = null;
  let montgomeryPageLifeOnCrash = null;
  let montgomeryPageLifeContextOnClose = null;

  function logMontgomeryPageLife(tag) {
    if (!isMontgomeryAdapter) return;
    let url = "";
    try {
      url = page.url();
    } catch (e) {
      url = `(url_error:${e?.message || e})`;
    }
    let nPages = -1;
    let pagesUrls = "";
    try {
      const pages = context.pages();
      nPages = pages.length;
      pagesUrls = pages
        .map((p, i) => {
          try {
            return `[${i}]=${p.url().slice(0, 160)}`;
          } catch (_) {
            return `[${i}]=(url_err)`;
          }
        })
        .join(" | ");
    } catch (e2) {
      pagesUrls = `(context.pages error: ${e2?.message || e2})`;
    }
    let browserHint = "unknown";
    try {
      const b = context.browser();
      if (!b) browserHint = "browser_null";
      else browserHint = b.isConnected() ? "browser_connected" : "browser_disconnected";
    } catch (e3) {
      browserHint = `browser_check_error:${e3?.message || e3}`;
    }
    console.log(
      `[Montgomery][page-life] ${tag} fileId=${fileId} fileName="${fileName}" isClosed=${page.isClosed()} url=${String(url).slice(0, 280)} contextPages=${nPages} browserHint=${browserHint} pages=${pagesUrls.slice(0, 500)}`,
    );
  }

  try {
    if (isMontgomeryAdapter) {
      montgomeryPageLifeOnClose = () => {
        console.log(
          `[Montgomery][page-life] page closed fileId=${fileId} fileName="${fileName}"`,
        );
      };
      page.once("close", montgomeryPageLifeOnClose);
      montgomeryPageLifeOnCrash = () => {
        console.log(
          `[Montgomery][page-life] page crashed fileId=${fileId} fileName="${fileName}"`,
        );
      };
      page.once("crash", montgomeryPageLifeOnCrash);
      montgomeryPageLifeFrameNavHandler = (frame) => {
        try {
          if (frame === page.mainFrame()) {
            let u = "";
            try {
              u = frame.url();
            } catch (_) {
              u = "(frame_url_err)";
            }
            console.log(
              `[Montgomery][page-life] main-frame navigated fileId=${fileId} fileName="${fileName}" url=${String(u).slice(0, 220)}`,
            );
          }
        } catch (_) {}
      };
      page.on("framenavigated", montgomeryPageLifeFrameNavHandler);
      montgomeryPageLifeContextOnClose = () => {
        console.log(
          `[Montgomery][page-life] context closed fileId=${fileId} fileName="${fileName}"`,
        );
      };
      context.once("close", montgomeryPageLifeContextOnClose);
      montgomeryPageLifeContextPageHandler = (newPage) => {
        let u = "";
        try {
          u = newPage.url();
        } catch (_) {
          u = "(new_page_url_err)";
        }
        console.log(
          `[Montgomery][page-life] context new page fileId=${fileId} fileName="${fileName}" url=${String(u).slice(0, 220)}`,
        );
      };
      context.on("page", montgomeryPageLifeContextPageHandler);
    }

    if (montgomeryWebApiNonDrawingsDirect) {
      console.log(
        `[Montgomery][non-drawings] direct retrieve start | fileId=${fileId} | timeoutMs=${MONTGOMERY_RETRIEVE_TIMEOUT_MS} | fileName="${fileName}"`,
      );
      const webApiBase = "https://montgomeryco-md-us-projectdoxwebapi.avolvecloud.com";
      const retrieveUrl =
        `${webApiBase}/File/RetrieveFile?convertToPDF=true&inline=true&blackCADBackground=false&fileID=${encodeURIComponent(String(fileId))}`;
      let nonDrawingsResult = null;
      try {
        const allCookies = await context.cookies([
          "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
        ]);
        const sessionCookie = allCookies.find((c) => c.name === "SessionID");
        if (!sessionCookie) {
          console.log(
            `[Montgomery][non-drawings] direct retrieve fail | status=0 | contentType=missing_session`,
          );
          nonDrawingsResult = { success: false, reason: "no_session_id" };
        } else {
          const sessionIdVal = sessionCookie.value;
          const response = await context.request.get(retrieveUrl, {
            timeout: MONTGOMERY_RETRIEVE_TIMEOUT_MS,
            headers: {
              sessionid: sessionIdVal,
              Referer: "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com/",
              Origin: "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          const status = response.status();
          const ct = response.headers()["content-type"] || "";
          if (!response.ok()) {
            console.log(
              `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${ct}`,
            );
            nonDrawingsResult = { success: false, reason: "montgomery_webapi_http_error" };
          } else {
            let buffer;
            try {
              buffer = await response.body();
            } catch (bodyErr) {
              const bmsg = String(bodyErr?.message || bodyErr || "");
              if (/timeout|timed out|\d+ms exceeded/i.test(bmsg)) {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | reason=montgomery_webapi_timeout | fileId=${fileId} | fileName="${fileName}" | timeoutMs=${MONTGOMERY_RETRIEVE_TIMEOUT_MS}`,
                );
                nonDrawingsResult = { success: false, reason: "montgomery_webapi_timeout" };
              } else {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${bmsg} (body_error)`,
                );
                nonDrawingsResult = { success: false, reason: "montgomery_webapi_error" };
              }
            }
            if (!nonDrawingsResult) {
              if (!buffer || buffer.length < MIN_FILE_SIZE) {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${ct} | bytes=${buffer?.length ?? 0}`,
                );
                nonDrawingsResult = { success: false, reason: "too_small" };
              } else if (isHtmlLikeContentType(ct)) {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${ct} (html_like)`,
                );
                nonDrawingsResult = { success: false, reason: "html_response" };
              } else if (
                fileName.toLowerCase().endsWith(".pdf") &&
                !hasValidPdfHeader(buffer)
              ) {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${ct} (invalid_pdf)`,
                );
                nonDrawingsResult = { success: false, reason: "invalid_pdf_header" };
              } else if (buffer.length > MAX_FILE_SIZE) {
                console.log(
                  `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=${ct} (too_large)`,
                );
                nonDrawingsResult = { success: false, reason: "too_large" };
              } else {
                const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
                if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
                  console.log(
                    `[Montgomery][non-drawings] direct retrieve fail | status=${status} | contentType=cumulative_cap`,
                  );
                  nonDrawingsResult = { success: false, reason: "cumulative_cap" };
                } else {
                  console.log(
                    `[Montgomery][non-drawings] direct retrieve success | status=${status} | contentType=${ct} | bytes=${buffer.length}`,
                  );
                  fs.writeFileSync(downloadPath, buffer);
                  if (session) session._scrapeCumulativeBytes = cumulative;
                  const contentHash = computeHash(buffer);
                  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
                  nonDrawingsResult = await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
                    downloadUrl: retrieveUrl,
                    fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
                  });
                  if (nonDrawingsResult?.publicUrl) {
                    console.log(
                      `[Montgomery][non-drawings] upload success | fileId=${fileId} | fileName="${fileName}" | publicUrl=${nonDrawingsResult.publicUrl}`,
                    );
                  } else if (nonDrawingsResult?.success) {
                    console.log(
                      `[Montgomery][non-drawings] upload success | fileId=${fileId} | fileName="${fileName}" | publicUrl=(none)`,
                    );
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        const emsg = String(err?.message || err || "");
        if (/timeout|timed out|\d+ms exceeded/i.test(emsg)) {
          console.log(
            `[Montgomery][non-drawings] direct retrieve fail | reason=montgomery_webapi_timeout | fileId=${fileId} | fileName="${fileName}" | timeoutMs=${MONTGOMERY_RETRIEVE_TIMEOUT_MS}`,
          );
          nonDrawingsResult = { success: false, reason: "montgomery_webapi_timeout" };
        } else {
          console.log(
            `[Montgomery][non-drawings] direct retrieve fail | status=0 | contentType=${emsg}`,
          );
          nonDrawingsResult = { success: false, reason: "montgomery_webapi_error" };
        }
      }
      return nonDrawingsResult || { success: false, reason: "montgomery_non_drawings_direct_failed" };
    }

    const popupPromise = context.waitForEvent("page", { timeout: 20000 }).catch(() => null);

    const realResponsePromise = new Promise((resolve) => {
      let resolved = false;
      const handler = async (response) => {
        if (resolved) return;
        const ct = response.headers()["content-type"] || "";
        const url = response.url();
        if (isMontgomeryAdapter && isMontgomeryIconNoiseUrl(url)) return;
        if (response.status() === 200 && (isFileContentType(ct) || isFileUrl(url))) {
          if (!shouldAcceptRealFileResponseWithoutBody(response)) {
            if (isNonFileEndpointGif(url, ct)) {
              console.log(
                `[PATCH-CHECK] realResponsePromise gif guard rejecting url=${url.substring(0, 160)} ct=${ct}`,
              );
            }
            return;
          }
          console.log(
            `[PATCH-CHECK] realResponsePromise accepting candidate url=${url.substring(0, 160)} ct=${ct}`,
          );
          resolved = true;
          console.log(`      📡 Real file response for fileId ${fileId}: ${url.substring(0, 120)} (${ct})`);
          resolve(true);
        }
      };
      page.on("response", handler);
      const onNewPage = (newPage) => { newPage.on("response", handler); };
      context.on("page", onNewPage);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
        page.removeListener("response", handler);
        context.removeListener("page", onNewPage);
      }, 20000);
    });

    async function tryMontgomeryDirectRetrieve(targetPage, sourceLabel = "page") {
      if (!(adapter === "montgomery" && preferDirectRetrieve && origin && targetPage)) {
        return null;
      }
      const directCandidates = [
        `${origin}/File/RetrieveFile?inline=true&fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
        `${origin}/File/RetrieveFile?fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
      ];
      for (const candidate of directCandidates) {
        try {
          logMontgomeryFinal(`candidate real file response = ${candidate} [${sourceLabel}]`);
          const fetched = await fetchBinaryViaPage(targetPage, candidate);
          const buffer = fetched.buffer;
          if (buffer.length < MIN_FILE_SIZE) {
            logMontgomeryFinal(`rejected candidate reason = too_small ${buffer.length} bytes`);
            continue;
          }
          if (
            fileName.toLowerCase().endsWith(".pdf") &&
            !hasValidPdfHeader(buffer)
          ) {
            logMontgomeryFinal("rejected candidate reason = invalid_pdf_header");
            continue;
          }
          if (buffer.length > MAX_FILE_SIZE) {
            logMontgomeryFinal("rejected candidate reason = too_large");
            const earlyResult = { success: false, reason: "too_large" };
            console.log(
              `[Montgomery Files] early return pre-popup direct-retrieve | fileId=${fileId} | fileName="${fileName}" | result=${JSON.stringify(earlyResult)}`,
            );
            return earlyResult;
          }
          const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
          if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
            console.log(
              `[Montgomery Files] cumulative cap hit after ${typeof result !== "undefined" ? result._meta.downloadsOk : "unknown"} files, total bytes: ${cumulative}`,
            );
            logMontgomeryFinal("rejected candidate reason = cumulative_cap");
            const earlyResult = { success: false, reason: "cumulative_cap" };
            console.log(
              `[Montgomery Files] early return pre-popup direct-retrieve | fileId=${fileId} | fileName="${fileName}" | result=${JSON.stringify(earlyResult)}`,
            );
            return earlyResult;
          }
          fs.writeFileSync(downloadPath, buffer);
          if (session) session._scrapeCumulativeBytes = cumulative;
          const contentHash = computeHash(buffer);
          const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
          logMontgomeryFinal(`resolved file source = ${String(fetched.finalUrl || candidate).substring(0, 180)}`);
          const earlyResult = await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
            downloadUrl: String(fetched.finalUrl || candidate).replace(
              /([?&])_nocache=[^&]*/g,
              "$1",
            ).replace(/[?&]$/, ""),
            fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
          });
          console.log(
            `[Montgomery Files] early return pre-popup direct-retrieve | fileId=${fileId} | fileName="${fileName}" | result=${JSON.stringify({
              success: earlyResult?.success ?? null,
              reason: earlyResult?.reason || null,
              publicUrl: earlyResult?.publicUrl || null,
              downloadUrl: earlyResult?.downloadUrl || null,
              skippedDuplicate: !!earlyResult?.skippedDuplicate,
            })}`,
          );
          return earlyResult;
        } catch (err) {
          logMontgomeryFinal(`rejected candidate reason = ${err?.message || "fetch_failed"} [${sourceLabel}]`);
        }
      }
      return null;
    }

    if (adapter === "montgomery" && preferDirectRetrieve && origin) {
      const directRetrieveResult = await tryMontgomeryDirectRetrieve(page, "pre_popup");
      if (directRetrieveResult) {
        console.log(
          `[Montgomery Files] early return pre-popup main-flow | fileId=${fileId} | fileName="${fileName}" | result=${JSON.stringify({
            success: directRetrieveResult?.success ?? null,
            reason: directRetrieveResult?.reason || null,
            publicUrl: directRetrieveResult?.publicUrl || null,
            downloadUrl: directRetrieveResult?.downloadUrl || null,
            skippedDuplicate: !!directRetrieveResult?.skippedDuplicate,
          })}`,
        );
        return directRetrieveResult;
      }
    }

    if (isMontgomeryAdapter && page.isClosed()) {
      console.log(
        `[Montgomery Files] main files page closed before viewFile | fileId=${fileId} | fileName="${fileName}"`,
      );
      return { success: false, reason: "main_files_page_closed" };
    }

    logMontgomeryPageLife("before viewFile");

    if (isMontgomeryAdapter) {
      await closeStaleMontgomeryViewerPopups(context, page);
    }

    await page.evaluate(() => { window.name = ""; });

    const viewFileDom = await page.evaluate((fid) => {
      const out = {
        action: "noop",
        hadGlobalViewFile: typeof viewFile === "function",
        hadWindowViewFile: typeof window.viewFile === "function",
        hrefMatchCount: 0,
        onclickViewFileCount: 0,
        hrefSample: null,
        onclickSample: null,
      };
      try {
        out.hrefMatchCount = document.querySelectorAll(
          `a[href*="viewFile(${fid})"]`,
        ).length;
        out.onclickViewFileCount = document.querySelectorAll(
          `a[onclick*="viewFile"]`,
        ).length;
        const probe =
          document.querySelector(`a[href*="viewFile(${fid})"]`) ||
          document.querySelector(`a[onclick*="viewFile(${fid})"]`) ||
          document.querySelector(`a[onclick*="viewFile"]`);
        if (probe) {
          out.hrefSample = (probe.getAttribute("href") || "").slice(0, 220);
          out.onclickSample = (probe.getAttribute("onclick") || "").slice(0, 220);
        }
      } catch (e) {
        out.domProbeError = String(e);
      }
      if (typeof viewFile === "function") {
        viewFile(fid);
        out.action = "viewFile";
      } else if (typeof window.viewFile === "function") {
        window.viewFile(fid);
        out.action = "windowViewFile";
      } else {
        const link = document.querySelector(`a[href*="viewFile(${fid})"]`);
        if (link) {
          link.click();
          out.action = "linkClick";
        }
      }
      return out;
    }, parseInt(fileId, 10));

    let mainUrlAfterViewFile = "";
    let ctxPageCount = 0;
    try {
      mainUrlAfterViewFile = page.url().slice(0, 320);
    } catch (_) {
      mainUrlAfterViewFile = "(url_err)";
    }
    try {
      ctxPageCount = context.pages().length;
    } catch (_) {
      ctxPageCount = -1;
    }

    logMontgomeryPageLife("after viewFile");


    const gotRealResponse = await realResponsePromise;
    if (!gotRealResponse) {
      console.log(`      ⚠️ No real file response received within 20s for fileId ${fileId}, falling back to captured responses`);
    }
    logMontgomeryPageLife("before page.waitForTimeout");
    if (isMontgomeryAdapter) {
      try {
        await page.waitForTimeout(1000);
      } catch (e) {
        let url = "";
        try {
          url = page.url();
        } catch (_) {
          url = "(url_err)";
        }
        let nPages = -1;
        let pagesUrls = "";
        try {
          const pages = context.pages();
          nPages = pages.length;
          pagesUrls = pages
            .map((p, i) => {
              try {
                return `[${i}]=${p.url().slice(0, 160)}`;
              } catch (_) {
                return `[${i}]=(url_err)`;
              }
            })
            .join(" | ");
        } catch (e2) {
          pagesUrls = `context.pages:${e2?.message || e2}`;
        }
        let browserHint = "unknown";
        try {
          const b = context.browser();
          if (!b) browserHint = "browser_null";
          else browserHint = b.isConnected() ? "browser_connected" : "browser_disconnected";
        } catch (e3) {
          browserHint = `browser_check:${e3?.message || e3}`;
        }
        console.log(
          `[Montgomery][page-life] page.waitForTimeout threw fileId=${fileId} fileName="${fileName}" err=${e?.message || e} isClosed=${page.isClosed()} url=${String(url).slice(0, 280)} contextPages=${nPages} browserHint=${browserHint} allPages=${pagesUrls.slice(0, 800)}`,
        );
        throw e;
      }
    } else {
      await page.waitForTimeout(1000);
    }
    popup = await popupPromise;

    if (isMontgomeryAdapter) {
      const matchedPopup = await findMontgomeryViewerPopupForFileId(
        context,
        page,
        fileId,
      );
      if (matchedPopup) {
        if (popup && popup !== matchedPopup) {
          await popup.close().catch(() => {});
        }
        popup = matchedPopup;
      }
    }



    if (popup) {
      popup.on("response", contextResponseHandler);
      console.log(`      🔗 Viewer popup opened: ${popup.url()}`);

      await popup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
      try {
        if (popup.url().includes("SessionEnded")) {
          console.log(
            `      ⚠️ Viewer popup SessionEnded — closing; clearing main-tab overlay`,
          );
          await popup.close().catch(() => {});
          await dismissProjectDoxFilesUiBlockers(page);
          popup = null;
        }
      } catch (_) {}

      if (popup) {
      if (preferViewerRuntime) {
        const runViewerRuntimeExtraction = async (targetPopup) => {
          const runtimeFile = await extractAvolveWebViewerFileFromPopup(targetPopup, {
            fileId,
            fileName,
          });
          const runtimeBuffer = runtimeFile.buffer;
          logMontgomeryFinal(
            `document detected | viewerIndex=${runtimeFile.viewerIndex ?? -1} | ${runtimeFile.filename || fileName} | type=${runtimeFile.fileType || "unknown"} | pages=${runtimeFile.pages || 0}`,
          );
          logMontgomeryFinal(`getFileData success | bytes=${runtimeBuffer.length}`);
          if (runtimeBuffer.length <= 0) {
            throw new Error("empty_runtime_buffer");
          }
          if (
            fileName.toLowerCase().endsWith(".pdf") &&
            !hasValidPdfHeader(runtimeBuffer)
          ) {
            throw new Error("invalid_pdf_header");
          }
          if (runtimeBuffer.length > MAX_FILE_SIZE) {
            return { success: false, reason: "too_large" };
          }
          const cumulative = (session?._scrapeCumulativeBytes || 0) + runtimeBuffer.length;
          if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
            console.log(
              `[Montgomery Files] cumulative cap hit fileId=${fileId} totalBytes=${cumulative}`,
            );
            return { success: false, reason: "cumulative_cap" };
          }
          fs.writeFileSync(downloadPath, runtimeBuffer);
          if (session) session._scrapeCumulativeBytes = cumulative;
          const contentHash = computeHash(runtimeBuffer);
          const sizeMB = (runtimeBuffer.length / 1024 / 1024).toFixed(2);
          const runtimeDownloadUrl =
            /^https?:\/\//i.test(runtimeFile.downloadLink || "") &&
            !isViewerShellUrl(runtimeFile.downloadLink)
              ? runtimeFile.downloadLink
              : null;
          logMontgomeryFinal(
            `resolved file source = ${runtimeDownloadUrl ? "RetrieveFile" : "runtime:getFileData"}`,
          );
          const uploadResult = await tryUploadAndClean(
            downloadPath,
            sizeMB,
            contentHash,
            {
              downloadUrl: runtimeDownloadUrl,
              fileSizeKB:
                runtimeFile.fileSize > 0
                  ? Math.max(1, Math.round(runtimeFile.fileSize / 1024))
                  : Math.max(1, Math.round(runtimeBuffer.length / 1024)),
            },
          );
          console.log(
            `[Montgomery Files] upload fileId=${fileId} fileName="${fileName}" success=${!!uploadResult?.publicUrl} bytes=${runtimeBuffer.length}`,
          );
          await targetPopup.close().catch(() => {});
          return uploadResult;
        };

        try {
          console.log(
            isMontgomeryAdapter
              ? "[Montgomery Files] viewer runtime detected"
              : "[ProjectDox Files] Avolve WebViewer runtime (drawings)",
          );
          logMontgomeryFinal("viewer runtime detected");
          return await runViewerRuntimeExtraction(popup);
        } catch (err) {
          const errMsg = err?.message || String(err);
          console.log(
            `[Montgomery Files] runtime extraction failed fileId=${fileId} reason=${errMsg}`,
          );
          if (errMsg === "stale_popup_file_id_mismatch") {
            await popup.close().catch(() => {});
            const retryPopup = await findMontgomeryViewerPopupForFileId(
              context,
              page,
              fileId,
            );
            if (retryPopup) {
              try {
                return await runViewerRuntimeExtraction(retryPopup);
              } catch (retryErr) {
                console.log(
                  `[Montgomery Files] runtime retry failed fileId=${fileId} reason=${retryErr?.message || retryErr}`,
                );
              }
            }
            return { success: false, reason: "stale_popup_file_id_mismatch" };
          }
          if (errMsg === "viewer_missing_file_config") {
            logMontgomeryFinal("rejected candidate reason = viewer_missing_file_config");
            return { success: false, reason: "viewer_missing_file_config" };
          }
          logMontgomeryFinal(
            `rejected candidate reason = runtime_extraction_failed:${errMsg}`,
          );
        }
      } else {
        await popup.waitForTimeout(3000);
      }
      const viewerIframeSrc = await popup
        .evaluate(() => {
          const iframe = document.querySelector("iframe[src]");
          return iframe ? iframe.getAttribute("src") || "" : "";
        })
        .catch(() => "");
      logMontgomeryFinal(`viewer iframe src = ${viewerIframeSrc || "none"}`);

      const viewerCandidates = await popup
        .evaluate(() => {
          function abs(u) {
            try {
              return new URL(u, window.location.href).toString();
            } catch (_) {
              return "";
            }
          }
          function pushCandidate(out, raw) {
            const s = String(raw || "").trim();
            if (!s) return;
            const url = abs(s);
            if (url) out.push(url);
          }
          const out = [];
          pushCandidate(out, document.querySelector("iframe[src]")?.getAttribute("src"));
          document.querySelectorAll("embed[src], object[data], a[href]").forEach((el) => {
            pushCandidate(out, el.getAttribute("src") || el.getAttribute("data") || el.getAttribute("href"));
          });
          document.querySelectorAll("script").forEach((s) => {
            const text = s.textContent || "";
            const matches = text.match(/(?:https?:\/\/|\/)[^'"\s]+(?:RetrieveFile|File\/Download|GetFile|\.pdf|\.dwg|\.docx?|\.xlsx?)[^'"\s]*/gi) || [];
            matches.forEach((m) => pushCandidate(out, m));
          });
          return [...new Set(out)];
        })
        .catch(() => []);
      console.log(
        `[Montgomery Files] popup candidate urls | count=${Array.isArray(viewerCandidates) ? viewerCandidates.length : 0} | sample=${JSON.stringify((viewerCandidates || []).slice(0, 8))}`,
      );

      for (const candidate of viewerCandidates) {
        logMontgomeryFinal(`candidate real file response = ${candidate.substring(0, 180)}`);
        if (isJunkUrl(candidate)) {
          logMontgomeryFinal("rejected candidate reason = junk_url");
          continue;
        }
        if (isViewerShellUrl(candidate)) {
          logMontgomeryFinal("rejected candidate reason = viewer_shell");
          continue;
        }
        try {
          const fetched = await fetchBinaryViaPage(popup, candidate);
          const buffer = fetched.buffer;
          if (buffer.length < MIN_FILE_SIZE) {
            logMontgomeryFinal(`rejected candidate reason = too_small ${buffer.length} bytes`);
            continue;
          }
          if (
            fileName.toLowerCase().endsWith(".pdf") &&
            !hasValidPdfHeader(buffer)
          ) {
            logMontgomeryFinal("rejected candidate reason = invalid_pdf_header");
            continue;
          }
          if (buffer.length > MAX_FILE_SIZE) {
            logMontgomeryFinal("rejected candidate reason = too_large");
            return { success: false, reason: "too_large" };
          }
          const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
          if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
            console.log(
              `[Montgomery Files] cumulative cap hit after ${typeof result !== "undefined" ? result._meta.downloadsOk : "unknown"} files, total bytes: ${cumulative}`,
            );
            logMontgomeryFinal("rejected candidate reason = cumulative_cap");
            return { success: false, reason: "cumulative_cap" };
          }
          fs.writeFileSync(downloadPath, buffer);
          if (session) session._scrapeCumulativeBytes = cumulative;
          const contentHash = computeHash(buffer);
          const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
          logMontgomeryFinal(`resolved file source = ${String(fetched.finalUrl || candidate).substring(0, 180)}`);
          await popup.close().catch(() => {});
          return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
            downloadUrl: String(fetched.finalUrl || candidate).replace(/([?&])_nocache=[^&]*/g, "$1").replace(/[?&]$/, ""),
            fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
          });
        } catch (err) {
          logMontgomeryFinal(`rejected candidate reason = ${err?.message || "fetch_failed"}`);
        }
      }

      const [download] = await Promise.all([
        popup.waitForEvent("download", { timeout: 20000 }).catch(() => null),
        popup.evaluate(() => {
          const dlBtn = document.querySelector(
            'a[id*="download" i], button[id*="download" i], ' +
            'a[title*="download" i], button[title*="download" i], ' +
            'a[onclick*="download" i], button[onclick*="download" i], ' +
            '[id*="btnDownload"], [id*="lnkDownload"], ' +
            'a.download-link, .toolbar a[title*="Save"], ' +
            'a[id*="save" i], button[id*="save" i]'
          );
          if (dlBtn) {
            dlBtn.click();
            return "clicked_download";
          }
          return "no_download_button";
        }),
      ]);

      if (download) {
        await download.saveAs(downloadPath);
        const stat = fs.statSync(downloadPath);
        if (stat.size < MIN_FILE_SIZE) {
          console.log(`      ⚠️ File too small (${stat.size} bytes < ${MIN_FILE_SIZE} bytes min). Rejected: ${fileName}`);
          fs.unlinkSync(downloadPath);
          await popup.close().catch(() => {});
          return { success: false, reason: "too_small" };
        }
        const fileBuffer = fs.readFileSync(downloadPath);
        if (fileName.toLowerCase().endsWith(".pdf") && !hasValidPdfHeader(fileBuffer)) {
          console.log(`      ⚠️ Invalid PDF header (got ${JSON.stringify(fileBuffer.slice(0, 4).toString("ascii"))}). Corrupted file rejected: ${fileName}`);
          fs.unlinkSync(downloadPath);
          await popup.close().catch(() => {});
          return { success: false, reason: "corrupt_pdf" };
        }
        if (stat.size > MAX_FILE_SIZE) {
          console.log(`      ⚠️ File too large (${(stat.size / 1024 / 1024).toFixed(2)} MB > ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB max). Rejected: ${fileName}`);
          fs.unlinkSync(downloadPath);
          await popup.close().catch(() => {});
          return { success: false, reason: "too_large" };
        }
        const cumulative = (session?._scrapeCumulativeBytes || 0) + stat.size;
        if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
          console.log(
            `[Montgomery Files] cumulative cap hit after ${typeof result !== "undefined" ? result._meta.downloadsOk : "unknown"} files, total bytes: ${cumulative}`,
          );
          console.log(`      ⚠️ Would exceed cumulative cap (${(cumulative / 1024 / 1024).toFixed(0)} MB). Rejected: ${fileName}`);
          fs.unlinkSync(downloadPath);
          await popup.close().catch(() => {});
          return { success: false, reason: "cumulative_cap" };
        }
        if (session) session._scrapeCumulativeBytes = cumulative;
        const contentHash = computeHash(fileBuffer);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
        console.log(`      ✅ Downloaded via viewer download button: ${fileName} (${sizeMB} MB, md5: ${contentHash})`);
        await popup.close().catch(() => {});
        return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
          downloadUrl: isViewerShellUrl(popup.url()) ? null : popup.url(),
          fileSizeKB: Math.max(1, Math.round(stat.size / 1024)),
        });
      }

      const fileSourceUrl = await popup.evaluate(() => {
        const embed = document.querySelector("embed[src], object[data], iframe[src]");
        if (embed) return embed.getAttribute("src") || embed.getAttribute("data") || "";
        const viewer = document.querySelector("[id*='viewer'] canvas, [id*='Viewer'] canvas");
        if (viewer) {
          const scripts = document.querySelectorAll("script");
          for (const s of scripts) {
            const text = s.textContent || "";
            const urlMatch = text.match(/(?:fileUrl|documentUrl|pdfUrl|src)\s*[:=]\s*['"]([^'"]+)['"]/i);
            if (urlMatch) return urlMatch[1];
          }
        }
        const links = document.querySelectorAll("a[href]");
        for (const a of links) {
          const href = a.getAttribute("href") || "";
          if (href.match(/\.(pdf|dwg|doc|docx|xlsx|zip)(\?|$)/i) && !href.startsWith("javascript:")) {
            return href;
          }
        }
        return "";
      });

      if (fileSourceUrl && !isViewerShellUrl(fileSourceUrl) && !isJunkUrl(fileSourceUrl)) {
        console.log(`      🔗 Found file source URL in viewer: ${fileSourceUrl.substring(0, 150)}`);
        try {
          const fetchUrlWithBust = fileSourceUrl + (fileSourceUrl.includes("?") ? "&" : "?") + cacheBuster;
          const base64Data = await popup.evaluate(async (url) => {
            const r = await fetch(url, { credentials: "include", cache: "no-store" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const chunks = [];
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
              let binary = "";
              for (let j = 0; j < slice.length; j++) {
                binary += String.fromCharCode(slice[j]);
              }
              chunks.push(btoa(binary));
            }
            return { chunks, size: bytes.length };
          }, fetchUrlWithBust);

          const buffers = base64Data.chunks.map(c => Buffer.from(c, "base64"));
          const buffer = Buffer.concat(buffers);
          if (buffer.length < MIN_FILE_SIZE) {
            console.log(`      ⚠️ File too small (${buffer.length} bytes < ${MIN_FILE_SIZE} bytes min). Rejected: ${fileName}`);
          } else if (fileName.toLowerCase().endsWith(".pdf") && !hasValidPdfHeader(buffer)) {
            console.log(`      ⚠️ Invalid PDF header from viewer source (got ${JSON.stringify(buffer.slice(0, 4).toString("ascii"))}). Rejected: ${fileName}`);
          } else if (buffer.length > MAX_FILE_SIZE) {
            console.log(`      ⚠️ File too large (${(buffer.length / 1024 / 1024).toFixed(2)} MB > ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB max). Rejected: ${fileName}`);
          } else {
            const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
            if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
              console.log(`      ⚠️ Would exceed cumulative cap (${(cumulative / 1024 / 1024).toFixed(0)} MB). Rejected: ${fileName}`);
            } else {
              fs.writeFileSync(downloadPath, buffer);
              if (session) session._scrapeCumulativeBytes = cumulative;
              const contentHash = computeHash(buffer);
              const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
              console.log(`      ✅ Downloaded via viewer source URL: ${fileName} (${sizeMB} MB, md5: ${contentHash})`);
              await popup.close().catch(() => {});
              return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
                downloadUrl: fileSourceUrl.replace(/([?&])_nocache=[^&]*/g, "$1").replace(/[?&]$/, ""),
                fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
              });
            }
          }
        } catch (srcErr) {
          console.log(`      ⚠️ Failed to fetch viewer source URL: ${srcErr.message}`);
        }
      }

      const popupHtml = await popup.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          bodyText: document.body?.innerText?.substring(0, 500) || "",
          iframeCount: document.querySelectorAll("iframe").length,
          embedCount: document.querySelectorAll("embed, object").length,
          canvasCount: document.querySelectorAll("canvas").length,
          downloadLinks: Array.from(document.querySelectorAll("a")).filter(a => {
            const h = a.getAttribute("href") || "";
            const t = a.textContent || "";
            return /download|save/i.test(t) || /download|save/i.test(h);
          }).map(a => ({ text: a.textContent.trim().substring(0, 50), href: (a.getAttribute("href") || "").substring(0, 100) })),
        };
      });
      console.log(`      🔍 Viewer popup debug:`, JSON.stringify(popupHtml));

      await popup.close().catch(() => {});
      }
    }

    if (!popup && !isMontgomeryAdapter && origin) {
      console.log(
        `      ⚙️ Same-tab viewer (no popup): trying direct RetrieveFile + main-page scan for fileId ${fileId}`,
      );
      try {
        const originNorm = String(origin).replace(/\/$/, "");
        const webApiOrigin = originNorm.replace(/projectdoxwebui/gi, "projectdoxwebapi");
        if (webApiOrigin !== originNorm) {
          const waRetrieveUrls = [
            `${webApiOrigin}/File/RetrieveFile?convertToPDF=true&inline=true&blackCADBackground=false&fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
            `${webApiOrigin}/File/RetrieveFile?inline=true&fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
            `${webApiOrigin}/File/RetrieveFile?fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
          ];
          try {
            const allCookies = await context.cookies([originNorm, webApiOrigin]);
            const sessionCookie = allCookies.find((c) => c.name === "SessionID");
            if (sessionCookie) {
              const waHeaders = {
                sessionid: sessionCookie.value,
                Cookie: `SessionID=${sessionCookie.value}`,
                Referer: `${originNorm}/`,
                Origin: originNorm,
                "X-Requested-With": "XMLHttpRequest",
              };
              for (let wi = 0; wi < waRetrieveUrls.length; wi++) {
                const retrieveUrl = waRetrieveUrls[wi];
                try {
                  const response = await context.request.get(retrieveUrl, {
                    timeout: 120000,
                    headers: waHeaders,
                  });
                  const status = response.status();
                  const ct = response.headers()["content-type"] || "";
                  if (!response.ok()) {
                    continue;
                  }
                  const buffer = await response.body();
                  const isPdfName = fileName.toLowerCase().endsWith(".pdf");
                  let rejectReason = null;
                  if (buffer.length < MIN_FILE_SIZE) rejectReason = "too_small";
                  else if (isPdfName && !hasValidPdfHeader(buffer)) rejectReason = "bad_pdf_header";
                  else if (buffer.length > MAX_FILE_SIZE) rejectReason = "too_large";
                  else {
                    const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
                    if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
                      rejectReason = "cumulative_cap";
                    }
                  }
                  if (rejectReason) {
                    continue;
                  }
                  const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
                  fs.writeFileSync(downloadPath, buffer);
                  if (session) session._scrapeCumulativeBytes = cumulative;
                  const contentHash = computeHash(buffer);
                  const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
                  console.log(
                    `      ✅ Downloaded via same-tab Web API RetrieveFile: ${fileName} (${sizeMB} MB, md5: ${contentHash})`,
                  );
                  return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
                    downloadUrl: retrieveUrl.replace(/([?&])_nocache=[^&]*/g, "$1").replace(/[?&]$/, ""),
                    fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
                  });
                } catch (oneErr) {
                }
              }
            } else {
            }
          } catch (wErr) {
          }
        }

        const directCandidates = [
          `${origin}/File/RetrieveFile?inline=true&fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
          `${origin}/File/RetrieveFile?fileID=${encodeURIComponent(String(fileId))}&${cacheBuster}`,
        ];
        for (const candidate of directCandidates) {
          try {
            const fetched = await fetchBinaryViaPage(page, candidate);
            const buffer = fetched.buffer;
            if (buffer.length < MIN_FILE_SIZE) continue;
            if (
              fileName.toLowerCase().endsWith(".pdf") &&
              !hasValidPdfHeader(buffer)
            ) {
              continue;
            }
            if (buffer.length > MAX_FILE_SIZE) {
              return { success: false, reason: "too_large" };
            }
            const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
            if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
              return { success: false, reason: "cumulative_cap" };
            }
            fs.writeFileSync(downloadPath, buffer);
            if (session) session._scrapeCumulativeBytes = cumulative;
            const contentHash = computeHash(buffer);
            const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
            console.log(
              `      ✅ Downloaded via same-tab RetrieveFile: ${fileName} (${sizeMB} MB, md5: ${contentHash})`,
            );
            return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
              downloadUrl: String(fetched.finalUrl || candidate).replace(
                /([?&])_nocache=[^&]*/g,
                "$1",
              ).replace(/[?&]$/, ""),
              fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
            });
          } catch (_) {}
        }

        await page
          .waitForSelector("iframe[src], embed[src], object[data]", {
            timeout: 12000,
          })
          .catch(() => {});

        const sameTabViewerCandidates = await page
          .evaluate(() => {
            function abs(u) {
              try {
                return new URL(u, window.location.href).toString();
              } catch (_) {
                return "";
              }
            }
            function pushCandidate(out, raw) {
              const s = String(raw || "").trim();
              if (!s) return;
              const url = abs(s);
              if (url) out.push(url);
            }
            const out = [];
            pushCandidate(out, document.querySelector("iframe[src]")?.getAttribute("src"));
            document.querySelectorAll("embed[src], object[data], a[href]").forEach((el) => {
              pushCandidate(
                out,
                el.getAttribute("src") || el.getAttribute("data") || el.getAttribute("href"),
              );
            });
            document.querySelectorAll("script").forEach((s) => {
              const text = s.textContent || "";
              const matches =
                text.match(
                  /(?:https?:\/\/|\/)[^'"\s]+(?:RetrieveFile|File\/Download|GetFile|\.pdf|\.dwg|\.docx?|\.xlsx?)[^'"\s]*/gi,
                ) || [];
              matches.forEach((m) => pushCandidate(out, m));
            });
            return [...new Set(out)];
          })
          .catch(() => []);
        console.log(
          `      🔗 Same-tab candidate urls | count=${sameTabViewerCandidates.length} | sample=${JSON.stringify(sameTabViewerCandidates.slice(0, 8))}`,
        );

        for (const candidate of sameTabViewerCandidates) {
          if (isJunkUrl(candidate)) continue;
          if (isViewerShellUrl(candidate)) continue;
          try {
            const fetched = await fetchBinaryViaPage(page, candidate);
            const buffer = fetched.buffer;
            if (buffer.length < MIN_FILE_SIZE) continue;
            if (
              fileName.toLowerCase().endsWith(".pdf") &&
              !hasValidPdfHeader(buffer)
            ) {
              continue;
            }
            if (buffer.length > MAX_FILE_SIZE) {
              return { success: false, reason: "too_large" };
            }
            const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
            if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
              return { success: false, reason: "cumulative_cap" };
            }
            fs.writeFileSync(downloadPath, buffer);
            if (session) session._scrapeCumulativeBytes = cumulative;
            const contentHash = computeHash(buffer);
            const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
            console.log(
              `      ✅ Downloaded via same-tab candidate fetch: ${fileName} (${sizeMB} MB, md5: ${contentHash})`,
            );
            return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
              downloadUrl: String(fetched.finalUrl || candidate).replace(
                /([?&])_nocache=[^&]*/g,
                "$1",
              ).replace(/[?&]$/, ""),
              fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
            });
          } catch (_) {}
        }

        const sameTabFileSourceUrl = await page
          .evaluate(() => {
            const embed = document.querySelector("embed[src], object[data], iframe[src]");
            if (embed) return embed.getAttribute("src") || embed.getAttribute("data") || "";
            const viewer = document.querySelector("[id*='viewer'] canvas, [id*='Viewer'] canvas");
            if (viewer) {
              const scripts = document.querySelectorAll("script");
              for (const s of scripts) {
                const text = s.textContent || "";
                const urlMatch = text.match(
                  /(?:fileUrl|documentUrl|pdfUrl|src)\s*[:=]\s*['"]([^'"]+)['"]/i,
                );
                if (urlMatch) return urlMatch[1];
              }
            }
            const links = document.querySelectorAll("a[href]");
            for (const a of links) {
              const href = a.getAttribute("href") || "";
              if (href.match(/\.(pdf|dwg|doc|docx|xlsx|zip)(\?|$)/i) && !href.startsWith("javascript:")) {
                return href;
              }
            }
            return "";
          })
          .catch(() => "");

        if (
          sameTabFileSourceUrl &&
          !isViewerShellUrl(sameTabFileSourceUrl) &&
          !isJunkUrl(sameTabFileSourceUrl)
        ) {
          console.log(
            `      🔗 Same-tab file source URL: ${sameTabFileSourceUrl.substring(0, 150)}`,
          );
          try {
            const fetchUrlWithBust =
              sameTabFileSourceUrl +
              (sameTabFileSourceUrl.includes("?") ? "&" : "?") +
              cacheBuster;
            const base64Data = await page.evaluate(async (url) => {
              const r = await fetch(url, { credentials: "include", cache: "no-store" });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const buf = await r.arrayBuffer();
              const bytes = new Uint8Array(buf);
              const chunks = [];
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                let binary = "";
                for (let j = 0; j < slice.length; j++) {
                  binary += String.fromCharCode(slice[j]);
                }
                chunks.push(btoa(binary));
              }
              return { chunks, size: bytes.length };
            }, fetchUrlWithBust);

            const buffers = base64Data.chunks.map((c) => Buffer.from(c, "base64"));
            const buffer = Buffer.concat(buffers);
            if (buffer.length >= MIN_FILE_SIZE) {
              if (
                !fileName.toLowerCase().endsWith(".pdf") ||
                hasValidPdfHeader(buffer)
              ) {
                if (buffer.length <= MAX_FILE_SIZE) {
                  const cumulative = (session?._scrapeCumulativeBytes || 0) + buffer.length;
                  if (cumulative <= MAX_SCRAPE_CUMULATIVE_SIZE) {
                    fs.writeFileSync(downloadPath, buffer);
                    if (session) session._scrapeCumulativeBytes = cumulative;
                    const contentHash = computeHash(buffer);
                    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
                    console.log(
                      `      ✅ Downloaded via same-tab file source URL: ${fileName} (${sizeMB} MB, md5: ${contentHash})`,
                    );
                    return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
                      downloadUrl: sameTabFileSourceUrl.replace(
                        /([?&])_nocache=[^&]*/g,
                        "$1",
                      ).replace(/[?&]$/, ""),
                      fileSizeKB: Math.max(1, Math.round(buffer.length / 1024)),
                    });
                  }
                }
              }
            }
          } catch (srcErr) {
            console.log(`      ⚠️ Same-tab file source fetch failed: ${srcErr.message}`);
          }
        }

      } catch (sameTabErr) {
        console.log(`      ⚠️ Same-tab viewer extraction failed: ${sameTabErr.message}`);
      }
    }

    if (capturedResponses.length > 0) {
      console.log(`      🔗 Captured ${capturedResponses.length} file-like response(s) from viewFile call:`);
      capturedResponses.forEach((r, i) => console.log(`         [${i}] ${r.url.substring(0, 150)} (${r.contentType}, ${r.body.length} bytes, pdfHeader: ${hasValidPdfHeader(r.body)})`));
      const isPdf = fileName.toLowerCase().endsWith(".pdf");

      let best = null;
      if (isPdf) {
        const pdfResponses = capturedResponses.filter((r) =>
          r.contentType.includes("application/pdf") &&
          hasValidPdfHeader(r.body) &&
          !isJunkUrl(r.url)
        );
        const retrieveFileResponses = pdfResponses.filter((r) =>
          /RetrieveFile|File\/Download/i.test(r.url)
        );
        if (retrieveFileResponses.length > 0) {
          best = retrieveFileResponses.sort((a, b) => b.body.length - a.body.length)[0];
          console.log(`      📎 Selected RetrieveFile PDF response: ${best.url.substring(0, 150)} (${best.body.length} bytes)`);
        } else if (pdfResponses.length > 0) {
          best = pdfResponses.sort((a, b) => b.body.length - a.body.length)[0];
          console.log(`      📎 Selected application/pdf response: ${best.url.substring(0, 150)} (${best.body.length} bytes)`);
        }
        if (!best) {
          const fallback = capturedResponses.filter((r) =>
            hasValidPdfHeader(r.body) && !isJunkUrl(r.url)
          );
          if (fallback.length > 0) {
            best = fallback.sort((a, b) => b.body.length - a.body.length)[0];
            console.log(`      📎 Fallback: valid PDF header response: ${best.url.substring(0, 150)} (${best.body.length} bytes)`);
          }
        }
        if (!best) {
          console.log(`      ⚠️ No valid PDF response found among ${capturedResponses.length} captured responses.`);
        }
      } else {
        const nonJunk = capturedResponses.filter(
          (r) =>
            !isJunkUrl(r.url) &&
            passesStrongFileEvidenceAfterBody(r.url, r.contentType, {}, r.body),
        );
        best = nonJunk.length > 0
          ? nonJunk.sort((a, b) => b.body.length - a.body.length)[0]
          : null;
      }

      if (best && best.body.length <= MAX_FILE_SIZE) {
        const cumulative = (session?._scrapeCumulativeBytes || 0) + best.body.length;
        if (cumulative > MAX_SCRAPE_CUMULATIVE_SIZE) {
          console.log(`      ⚠️ Would exceed cumulative cap (${(cumulative / 1024 / 1024).toFixed(0)} MB). Skipping: ${fileName}`);
        } else {
          fs.writeFileSync(downloadPath, best.body);
          if (session) session._scrapeCumulativeBytes = cumulative;
          const contentHash = computeHash(best.body);
          const sizeMB = (best.body.length / 1024 / 1024).toFixed(2);
          console.log(`      ✅ Downloaded via captured response: ${fileName} (${sizeMB} MB, md5: ${contentHash}, url: ${best.url.substring(0, 150)})`);
          return await tryUploadAndClean(downloadPath, sizeMB, contentHash, {
            downloadUrl: best.url,
            fileSizeKB: Math.max(1, Math.round(best.body.length / 1024)),
          });
        }
      } else if (best) {
        console.log(`      ⚠️ Captured file too large (${(best.body.length / 1024 / 1024).toFixed(2)} MB > ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB max). Rejected: ${fileName}`);
      }
    } else if (!popup) {
      console.log(`      ⚠️ No viewer popup and no captured responses for viewFile(${fileId})`);
    }
  } catch (err) {
    console.log(`      ❌ Download error for ${fileName}: ${err.message}`);
  } finally {
    if (isMontgomeryAdapter) {
      try {
        if (montgomeryPageLifeFrameNavHandler) page.off("framenavigated", montgomeryPageLifeFrameNavHandler);
      } catch (_) {}
      try {
        if (montgomeryPageLifeContextPageHandler) context.removeListener("page", montgomeryPageLifeContextPageHandler);
      } catch (_) {}
      try {
        if (montgomeryPageLifeOnClose) page.off("close", montgomeryPageLifeOnClose);
      } catch (_) {}
      try {
        if (montgomeryPageLifeOnCrash) page.off("crash", montgomeryPageLifeOnCrash);
      } catch (_) {}
      try {
        if (montgomeryPageLifeContextOnClose) context.off("close", montgomeryPageLifeContextOnClose);
      } catch (_) {}
    }
    try { await context.unroute("**/*", cacheRouteHandler); } catch (_) {}
    try { context.removeListener("page", onNewPageCapture); } catch (_) {}
    try {
      for (const p of context.pages()) {
        p.removeListener("response", contextResponseHandler);
      }
    } catch (_) {}
    if (popup && popup !== page) await popup.close().catch(() => {});
    try {
      await dismissProjectDoxFilesUiBlockers(page);
    } catch (_) {}
  }

  return { success: false };
}

/**
 * DC / generic ProjectDox Status tab: generic extractPageData often mis-pairs bold
 * value spans (e.g. "72") as labels. Prefer 2-column table rows like the Info tab.
 */
async function extractProjectDoxStatusKeyValues(page) {
  try {
    const rows = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const push = (k, v) => {
        const key = String(k || "")
          .trim()
          .replace(/:$/, "")
          .trim();
        const val = String(v || "")
          .trim()
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!key || !val) return;
        if (key.length > 120 || val.length > 2000) return;
        if (/filter/i.test(key)) return;
        if (val.startsWith("Select One") || val.startsWith("Select All"))
          return;
        const sig = `${key}|${val}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        out.push({ key, value: val });
      };

      const looksLikeValueOnly = (s) => {
        const t = String(s || "").trim();
        if (!t) return true;
        if (/^\d+$/.test(t)) return true;
        if (/^\d+\s*days?\s+[\d.]+\s*hrs?$/i.test(t)) return true;
        if (/^(business|calendar)\s+days?$/i.test(t)) return true;
        return false;
      };

      const looksLikeLabelText = (s) => {
        const t = String(s || "").trim();
        if (!t) return false;
        if (/:$/.test(t)) return true;
        if (
          /^(review type|owner|total number|days calculated|time elapsed|current non|workflow|main contact)\b/i.test(
            t,
          )
        )
          return true;
        if (/^(total number of files|days calculated as)\b/i.test(t))
          return true;
        return false;
      };

      const extractRow = (tr) => {
        const cells = tr.querySelectorAll("td");
        let labelCell = cells[0];
        let valueCell = cells[1];
        if (!labelCell || !valueCell) {
          const th = tr.querySelector("th");
          const td = tr.querySelector("td");
          if (th && td) {
            labelCell = th;
            valueCell = td;
          } else return;
        }
        const boldEl = labelCell.querySelector("b, strong");
        let label = boldEl
          ? boldEl.textContent.trim()
          : labelCell.textContent.trim();
        label = label.replace(/:$/, "").trim();
        const rawValue = valueCell
          ? valueCell.textContent.trim().replace(/\s+/g, " ").trim()
          : "";
        const value = (rawValue || "").replace(/\u00a0/g, "").trim();
        if (!label || !value) return;
        if (label.toLowerCase().includes("filter")) return;
        if (label.toLowerCase().includes("select")) return;

        let L = label;
        let V = value;
        if (looksLikeValueOnly(L) && looksLikeLabelText(V)) {
          const t = L;
          L = V;
          V = t;
        }
        push(L, V);
      };

      const tables = Array.from(document.querySelectorAll("table"));
      const statusTable = tables.find((tbl) => {
        const sample = (tbl.textContent || "").slice(0, 4000);
        return (
          /review\s+type/i.test(sample) &&
          (/owner/i.test(sample) || /total\s+number\s+of\s+files/i.test(sample))
        );
      });
      if (statusTable) {
        statusTable.querySelectorAll("tr").forEach(extractRow);
      } else {
        document.querySelectorAll("table tr").forEach(extractRow);
      }

      return out;
    });
    const plausible =
      rows.length >= 2 &&
      rows.some((r) =>
        /review\s+type|owner|total\s+number|days\s+calculated|time\s+elapsed|current\s+non/i.test(
          String(r.key || ""),
        ),
      );
    return plausible ? rows : [];
  } catch (_) {
    return [];
  }
}

async function extractPageData(page) {
  const data = await page.evaluate(() => {
    const d = { keyValues: [], tables: [], links: [], rawText: "" };
    const seen = new Set();
    const add = (label, value) => {
      const k = label ? label.trim().replace(/:$/, "").trim() : "";
      const v = value ? String(value).trim() : "";
      const key = `${k}|${v}`;
      if (k && v && !seen.has(key)) {
        seen.add(key);
        d.keyValues.push({ key: k, value: v });
      }
    };

    // 1. Label + value: label followed by adjacent span, div, or p
    document.querySelectorAll("label").forEach((label) => {
      const lbl = label.textContent.trim().replace(/:$/, "").trim();
      if (!lbl) return;
      let next = label.nextElementSibling;
      while (next) {
        const tag = (next.tagName || "").toLowerCase();
        if (["span", "div", "p"].includes(tag)) {
          add(lbl, next.textContent);
          break;
        }
        if (["label", "dt"].includes(tag)) break;
        next = next.nextElementSibling;
      }
    });

    // 2. Definition lists: dt (key) + dd (value)
    document.querySelectorAll("dl").forEach((dl) => {
      const dts = dl.querySelectorAll("dt");
      dts.forEach((dt) => {
        const lbl = dt.textContent.trim().replace(/:$/, "").trim();
        if (!lbl) return;
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName.toLowerCase() !== "dd")
          dd = dd.nextElementSibling;
        if (dd) add(lbl, dd.textContent);
      });
    });

    // 3. Form fields: label with for, find element by ID
    document.querySelectorAll("label[for]").forEach((label) => {
      const forId = label.getAttribute("for");
      const lbl = label.textContent.trim().replace(/:$/, "").trim();
      if (!lbl || !forId) return;
      const el = document.getElementById(forId);
      if (el) {
        const v = el.getAttribute("value") || el.textContent || "";
        add(lbl, v);
      }
    });

    // 4. Div-based layouts: field-label/label/key/form-label + field-value/value/form-control
    const labelClasses = [
      "field-label",
      "label",
      "key",
      "form-label",
      "field-name",
      "col-label",
    ];
    const valueClasses = [
      "field-value",
      "value",
      "form-control",
      "field-data",
      "col-value",
    ];
    labelClasses.forEach((lc) => {
      document
        .querySelectorAll(`.${lc}, [class*="${lc}"]`)
        .forEach((labelEl) => {
          const lbl = labelEl.textContent.trim().replace(/:$/, "").trim();
          if (!lbl) return;
          let sibling = labelEl.nextElementSibling;
          while (sibling) {
            const cls = (sibling.className || "") + " ";
            if (valueClasses.some((vc) => cls.includes(vc))) {
              add(lbl, sibling.textContent);
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          if (!sibling && labelEl.parentElement) {
            Array.from(labelEl.parentElement.children).forEach((child) => {
              if (child === labelEl) return;
              const cls = (child.className || "") + " ";
              if (valueClasses.some((vc) => cls.includes(vc)))
                add(lbl, child.textContent);
            });
          }
        });
    });

    // 5. Span pairs: bold/semibold span followed by value span / link
    document.querySelectorAll("span").forEach((span) => {
      const style = (window.getComputedStyle(span).fontWeight || "").toString();
      const cls = (span.className || "") + " ";
      const isBold = parseInt(style, 10) >= 600 || /bold|semibold/i.test(cls);
      if (!isBold) return;
      const lbl = span.textContent.trim().replace(/:$/, "").trim();
      if (!lbl || lbl.length > 80) return;
      if (/^\d+$/.test(lbl)) return;
      if (/^\d+\s*days?\s+[\d.]+\s*hrs?$/i.test(lbl)) return;
      if (/^(business|calendar)\s+days?$/i.test(lbl)) return;
      let next = span.nextElementSibling;
      if (next) {
        const tag = (next.tagName || "").toLowerCase();
        if (tag === "span" || tag === "a" || tag === "b" || tag === "strong")
          add(lbl, next.textContent);
      } else if (span.nextSibling && span.nextSibling.nodeType === 3) {
        add(lbl, span.nextSibling.textContent);
      }
    });

    // 6. Two-cell table rows (existing)
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      if (cells.length === 2) {
        const label = cells[0].textContent.trim().replace(/:$/, "").trim();
        const value = cells[1].textContent.trim();
        add(label, value);
      }
    });

    document.querySelectorAll("table").forEach((table, ti) => {
      const headers = [];
      const hr = table.querySelector("thead tr, tr:has(th)");
      if (hr)
        hr.querySelectorAll("th, td").forEach((c) => {
          const h = c.textContent.trim();
          if (h) headers.push(h);
        });

      const rows = [];
      const dr = table.querySelectorAll("tbody tr, tr");
      dr.forEach((tr) => {
        if (tr === hr) return;
        // Ignore rows that look like headers (bold only)
        if (tr.querySelector("th") && !tr.querySelector("td")) return;

        const row = {};
        let has = false;
        tr.querySelectorAll("td").forEach((td, ci) => {
          const cn = headers[ci] || `Col_${ci}`;
          const t = td.textContent.trim();
          row[cn] = t;
          if (t) has = true;
        });
        if (has) rows.push(row);
      });
      if (rows.length > 0) d.tables.push({ headers, rows, tableIndex: ti });
    });

    d.keyValues = d.keyValues.filter((kv) => {
      if (/filter/i.test(kv.key)) return false;
      if (
        kv.value.startsWith("Select One") ||
        kv.value.startsWith("Select All")
      )
        return false;
      if (kv.value.length > 300) return false;
      return true;
    });

    const linkSeen = new Set();
    const LINK_LABEL_RE =
      /(?:workflow\s+routing\s+slip|view\s+report|routing\s+slip)/i;
    const tryAddLink = (a) => {
      const href = a.getAttribute("href");
      if (!href || href.trim() === "" || href === "#") return;
      const t = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || !LINK_LABEL_RE.test(t)) return;
      let abs;
      try {
        abs = new URL(href, location.href).href;
      } catch {
        return;
      }
      const low = abs.toLowerCase();
      if (
        low.startsWith("javascript:") ||
        low.startsWith("mailto:") ||
        low.startsWith("tel:")
      )
        return;
      if (!/^https?:\/\//i.test(abs)) return;
      if (linkSeen.has(abs)) return;
      if (d.links.length >= 40) return;
      linkSeen.add(abs);
      d.links.push({ text: t, href: abs });
    };

    document.querySelectorAll("a[href]").forEach(tryAddLink);

    return d;
  });
  return data;
}

// ─── PermitWizard Authentication Endpoints ──────────────────────────────────
app.post("/api/permitwizard/login", async (req, res) => {
  const { credentialId, username, password, userId } = req.body;

  let loginUsername = username;
  let loginPassword = password;

  if (credentialId && (!loginUsername || !loginPassword)) {
    try {
      const { data: cred, error } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, login_url")
        .eq("id", credentialId)
        .single();

      if (error || !cred) {
        return res.status(404).json({
          success: false,
          error: "credential_not_found",
          message: "Portal credential not found",
        });
      }

      loginUsername = cred.portal_username;
      try {
        loginPassword = resolveStoredPortalPassword(cred.portal_password);
      } catch (e) {
        return res.status(500).json({
          success: false,
          error: "credential_decrypt_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "credential_lookup_failed",
        message: err.message,
      });
    }
  }

  if (!loginUsername || !loginPassword) {
    return res.status(400).json({
      success: false,
      error: "missing_credentials",
      message: "Username and password are required (or provide credentialId)",
    });
  }

  let browser;
  try {
    console.log("🔐 [PermitWizard] Launching browser for SSO login...");
    browser = await launchChromiumForScraper({ label: "permitwizard-login", route: "POST /api/permitwizard/login", file: "server.js" });

    const result = await permitWizardLogin(
      browser,
      loginUsername,
      loginPassword,
    );

    if (!result.success) {
      await browser.close().catch(() => {});

      if (result.error === "captcha_detected") {
        return res.status(403).json(result);
      }
      if (result.doNotRetry) {
        return res.status(401).json(result);
      }
      return res.status(500).json(result);
    }

    const responseData = {
      success: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      portalUrl: result.portalUrl,
      message: "PermitWizard SSO login successful",
    };

    if (userId) {
      console.log(`  [PermitWizard] Login by user: ${userId}`);
    }

    res.json(responseData);
  } catch (err) {
    console.error("❌ [PermitWizard] Login error:", err.message);
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    res.status(500).json({
      success: false,
      error: "login_error",
      message: err.message,
    });
  }
});

app.get("/api/permitwizard/session/:sessionToken", async (req, res) => {
  const { sessionToken } = req.params;
  const status = await checkSessionAlive(sessionToken);
  res.json(status);
});

app.post("/api/permitwizard/reauth", async (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: "Session not found or expired. Perform a fresh login.",
    });
  }

  let browser;
  try {
    browser = await launchChromiumForScraper({ label: "permitwizard-reauth", route: "POST /api/permitwizard/reauth", file: "server.js" });
    const result = await reAuthenticate(browser, sessionToken);

    if (!result || !result.success) {
      await browser.close().catch(() => {});
      return res.status(401).json(
        result || {
          success: false,
          error: "reauth_failed",
          message: "Re-authentication failed",
        },
      );
    }

    res.json(result);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    res.status(500).json({
      success: false,
      error: "reauth_error",
      message: err.message,
    });
  }
});

app.post("/api/permitwizard/logout", async (req, res) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ error: "sessionToken is required" });
  }

  await destroyPWSession(sessionToken);
  res.json({ success: true, message: "PermitWizard session destroyed" });
});

app.get("/api/permitwizard/sessions/count", (req, res) => {
  res.json({ activeSessions: getActiveSessionCount() });
});

app.get("/api/permitwizard/wizard-steps", (req, res) => {
  res.json({ steps: WIZARD_STEPS });
});

app.post("/api/permitwizard/file", async (req, res) => {
  const { sessionToken, filingId, filingData } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message:
        "PermitWizard session not found or expired. Perform a fresh login.",
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address:
            resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype:
            resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work:
            resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value:
            resolvedFilingData.construction_value || filing.construction_value,
          property_type:
            resolvedFilingData.property_type || filing.property_type,
          estimated_fee:
            resolvedFilingData.estimated_fee || filing.estimated_fee,
        };

        if (!resolvedFilingData.professionals) {
          const { data: profs } = await supabase
            .from("filing_professionals")
            .select("*")
            .eq("filing_id", resolvedFilingId);
          if (profs && profs.length > 0) {
            resolvedFilingData.professionals = profs;
          }
        }

        if (!resolvedFilingData.documents) {
          const { data: docs } = await supabase
            .from("filing_documents")
            .select("*")
            .eq("filing_id", resolvedFilingId)
            .order("upload_order", { ascending: true });
          if (docs && docs.length > 0) {
            resolvedFilingData.documents = docs;
          }
        }
      }
    } catch (err) {
      console.log(
        `  [PermitWizard File] Could not load filing data: ${err.message}`,
      );
    }
  }

  if (!resolvedFilingData.property_address) {
    return res.status(400).json({
      success: false,
      error: "missing_address",
      message:
        "property_address is required in filingData or in the permit_filings record",
    });
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "form_filing",
      layer: 2,
      status: "running",
      input_data: {
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
        documents_count: (resolvedFilingData.documents || []).length,
        professionals_count: (resolvedFilingData.professionals || []).length,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(
      `  [PermitWizard File] Could not create agent_run: ${err.message}`,
    );
  }

  console.log(
    `\n🏛️ [PermitWizard File] Starting form filing for: ${resolvedFilingData.property_address}`,
  );

  res.json({
    success: true,
    message: "Form filing started",
    filing_id: resolvedFilingId,
    steps: WIZARD_STEPS,
  });

  permitWizardFile(sessionToken, resolvedFilingData, supabase)
    .then(async (result) => {
      console.log(
        `  [PermitWizard File] Filing complete: ${result.success ? "SUCCESS" : "FAILED"}`,
      );

      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              steps: result.steps,
              stopped_before_submit: result.stopped_before_submit,
              field_audits: result.field_audits,
              screenshots_count: (result.screenshots || []).length,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (err) {
        console.log(
          `  [PermitWizard File] Could not update agent_run: ${err.message}`,
        );
      }
    })
    .catch(async (err) => {
      console.error(`  [PermitWizard File] Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (_) {}
    });
});

// ─ ��─ PermitWizard Submission Finalization (Agent 08) ─────────────────────────
app.post("/api/permitwizard/submit", async (req, res) => {
  const { sessionToken, filingId, filingData } = req.body;

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  const session = getPWSession(sessionToken);
  if (!session) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message:
        "PermitWizard session not found or expired. Perform a fresh login.",
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address:
            resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype:
            resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work:
            resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value:
            resolvedFilingData.construction_value || filing.construction_value,
          property_type:
            resolvedFilingData.property_type || filing.property_type,
          estimated_fee:
            resolvedFilingData.estimated_fee || filing.estimated_fee,
        };
      }
    } catch (err) {
      console.log(
        `  [PermitWizard Submit] Could not load filing data: ${err.message}`,
      );
    }
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "submission_finalization",
      layer: 2,
      status: "running",
      input_data: {
        filing_id: resolvedFilingId,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(
      `  [PermitWizard Submit] Could not create agent_run: ${err.message}`,
    );
  }

  console.log(
    `\n🏛️ [PermitWizard Submit] Starting submission finalization for filing: ${resolvedFilingId}`,
  );

  res.json({
    success: true,
    message: "Submission finalization started",
    filing_id: resolvedFilingId,
  });

  permitWizardSubmit(sessionToken, resolvedFilingData, supabase)
    .then(async (result) => {
      console.log(
        `  [PermitWizard Submit] Finalization complete: ${result.success ? "SUCCESS" : "FAILED"}`,
      );

      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              application_id: result.application_id || null,
              confirmation_number: result.confirmation_number || null,
              confirmation_message: result.confirmation_message || null,
              validation: result.validation || null,
              screenshots_count: (result.screenshots || []).length,
              submitted_at: result.submitted_at || null,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");
      } catch (err) {
        console.log(
          `  [PermitWizard Submit] Could not update agent_run: ${err.message}`,
        );
      }

      if (!result.success && result.error !== "validation_failed") {
        try {
          await supabase
            .from("permit_filings")
            .update({
              filing_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", resolvedFilingId);
        } catch (_) {}
      }
    })
    .catch(async (err) => {
      console.error(`  [PermitWizard Submit] Fatal error: ${err.message}`);
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");

        await supabase
          .from("permit_filings")
          .update({
            filing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedFilingId);
      } catch (_) {}
    });
});

// ─── Multi-Municipality Filing Endpoints ─────────────────────────────────────
const VALID_PORTAL_TYPES = [
  "accela",
  "momentum_liferay",
  "aspnet_webforms",
  "energov",
];

app.post("/api/filing/login", async (req, res) => {
  const {
    portal_type,
    portal_config,
    credentialId,
    username,
    password,
    userId,
  } = req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  let loginUsername = username;
  let loginPassword = password;

  if (credentialId && (!loginUsername || !loginPassword)) {
    try {
      const { data: cred, error } = await supabase
        .from("portal_credentials")
        .select("portal_username, portal_password, login_url")
        .eq("id", credentialId)
        .single();

      if (error || !cred) {
        return res.status(404).json({
          success: false,
          error: "credential_not_found",
          message: "Portal credential not found",
        });
      }

      loginUsername = cred.portal_username;
      try {
        loginPassword = resolveStoredPortalPassword(cred.portal_password);
      } catch (e) {
        return res.status(500).json({
          success: false,
          error: "credential_decrypt_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "credential_lookup_failed",
        message: err.message,
      });
    }
  }

  if (!loginUsername || !loginPassword) {
    return res.status(400).json({
      success: false,
      error: "missing_credentials",
      message: "Username and password are required (or provide credentialId)",
    });
  }

  let browser;
  try {
    console.log(`[Filing] Launching browser for ${portal_type} login...`);
    browser = await launchChromiumForScraper({ label: "filing-login", route: "POST /api/filing/login", file: "server.js" });

    let result;
    const credentials = { username: loginUsername, password: loginPassword };
    const config = portal_config || {};

    switch (portal_type) {
      case "accela":
        result = await accelaLogin(browser, credentials, config);
        break;
      case "momentum_liferay":
        result = await momentumLogin(browser, credentials);
        break;
      case "aspnet_webforms":
        result = await montgomeryLogin(browser, credentials);
        break;
      case "energov":
        result = await energovLogin(browser, credentials, config);
        break;
    }

    if (!result.success) {
      await browser.close().catch(() => {});
      if (result.error === "captcha_detected") {
        return res.status(403).json(result);
      }
      if (result.doNotRetry) {
        return res.status(401).json(result);
      }
      return res.status(500).json(result);
    }

    const responseData = {
      success: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      portalUrl: result.portalUrl,
      portal_type,
      message: `${portal_type} login successful`,
    };

    if (userId) {
      console.log(`  [Filing] Login by user: ${userId} (${portal_type})`);
    }

    res.json(responseData);
  } catch (err) {
    console.error(`[Filing] Login error (${portal_type}):`, err.message);
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    res.status(500).json({
      success: false,
      error: "login_error",
      message: err.message,
    });
  }
});

app.get("/api/filing/session/:token", async (req, res) => {
  const { token } = req.params;
  const { portal_type } = req.query;

  if (portal_type && VALID_PORTAL_TYPES.includes(portal_type)) {
    let status;
    switch (portal_type) {
      case "accela":
        status = await checkSessionAlive(token);
        break;
      case "momentum_liferay":
        status = await checkMomentumSessionAlive(token);
        break;
      case "aspnet_webforms":
        status = await checkMontgomerySessionAlive(token);
        break;
      case "energov":
        status = await checkEnergovSessionAlive(token);
        break;
    }
    return res.json({ ...status, portal_type });
  }

  const accelaSession = getAccelaSession(token);
  if (accelaSession) {
    const status = await checkSessionAlive(token);
    return res.json({ ...status, portal_type: "accela" });
  }

  const momentumSession = getMomentumSession(token);
  if (momentumSession) {
    const status = await checkMomentumSessionAlive(token);
    return res.json({ ...status, portal_type: "momentum_liferay" });
  }

  const montgomerySession = getMontgomerySession(token);
  if (montgomerySession) {
    const status = await checkMontgomerySessionAlive(token);
    return res.json({ ...status, portal_type: "aspnet_webforms" });
  }

  const energovSession = getEnergovSession(token);
  if (energovSession) {
    const status = await checkEnergovSessionAlive(token);
    return res.json({ ...status, portal_type: "energov" });
  }

  res.json({ alive: false, reason: "session_not_found" });
});

app.post("/api/filing/file", async (req, res) => {
  const { portal_type, portal_config, sessionToken, filingId, filingData } =
    req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  let sessionLookup;
  switch (portal_type) {
    case "accela":
      sessionLookup =
        getAccelaSession(sessionToken) || getPWSession(sessionToken);
      break;
    case "momentum_liferay":
      sessionLookup = getMomentumSession(sessionToken);
      break;
    case "aspnet_webforms":
      sessionLookup = getMontgomerySession(sessionToken);
      break;
    case "energov":
      sessionLookup = getEnergovSession(sessionToken);
      break;
  }

  if (!sessionLookup) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: `${portal_type} session not found or expired. Perform a fresh login.`,
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address:
            resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype:
            resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work:
            resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value:
            resolvedFilingData.construction_value || filing.construction_value,
          property_type:
            resolvedFilingData.property_type || filing.property_type,
          estimated_fee:
            resolvedFilingData.estimated_fee || filing.estimated_fee,
        };

        if (!resolvedFilingData.professionals) {
          const { data: profs } = await supabase
            .from("filing_professionals")
            .select("*")
            .eq("filing_id", resolvedFilingId);
          if (profs && profs.length > 0) {
            resolvedFilingData.professionals = profs;
          }
        }

        if (!resolvedFilingData.documents) {
          const { data: docs } = await supabase
            .from("filing_documents")
            .select("*")
            .eq("filing_id", resolvedFilingId)
            .order("upload_order", { ascending: true });
          if (docs && docs.length > 0) {
            resolvedFilingData.documents = docs;
          }
        }
      }
    } catch (err) {
      console.log(`  [Filing File] Could not load filing data: ${err.message}`);
    }
  }

  if (!resolvedFilingData.property_address) {
    return res.status(400).json({
      success: false,
      error: "missing_address",
      message:
        "property_address is required in filingData or in the permit_filings record",
    });
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "form_filing",
      layer: 2,
      status: "running",
      input_data: {
        portal_type,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
        documents_count: (resolvedFilingData.documents || []).length,
        professionals_count: (resolvedFilingData.professionals || []).length,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [Filing File] Could not create agent_run: ${err.message}`);
  }

  console.log(
    `\n[Filing File] Starting ${portal_type} form filing for: ${resolvedFilingData.property_address}`,
  );

  res.json({
    success: true,
    message: "Form filing started",
    filing_id: resolvedFilingId,
    portal_type,
  });

  let filePromise;
  const config = portal_config || {};

  switch (portal_type) {
    case "accela":
      filePromise = permitWizardFile(
        sessionToken,
        resolvedFilingData,
        supabase,
        config,
      );
      break;
    case "momentum_liferay":
      filePromise = momentumFile(
        null,
        sessionToken,
        resolvedFilingData,
        supabase,
      );
      break;
    case "aspnet_webforms":
      filePromise = montgomeryFile(sessionToken, resolvedFilingData, supabase);
      break;
    case "energov":
      filePromise = energovFile(
        sessionToken,
        resolvedFilingData,
        config,
        supabase,
      );
      break;
  }

  filePromise
    .then(async (result) => {
      console.log(
        `  [Filing File] (${portal_type}) Filing complete: ${result.success ? "SUCCESS" : "FAILED"}`,
      );
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              portal_type,
              steps: result.steps,
              stopped_before_submit: result.stopped_before_submit,
              field_audits: result.field_audits,
              screenshots_count: (result.screenshots || []).length,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (err) {
        console.log(
          `  [Filing File] Could not update agent_run: ${err.message}`,
        );
      }
    })
    .catch(async (err) => {
      console.error(
        `  [Filing File] (${portal_type}) Fatal error: ${err.message}`,
      );
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "form_filing")
          .eq("status", "running");
      } catch (_) {}
    });
});

app.post("/api/filing/submit", async (req, res) => {
  const { portal_type, portal_config, sessionToken, filingId, filingData } =
    req.body;

  if (!portal_type || !VALID_PORTAL_TYPES.includes(portal_type)) {
    return res.status(400).json({
      success: false,
      error: "invalid_portal_type",
      message: `portal_type must be one of: ${VALID_PORTAL_TYPES.join(", ")}`,
    });
  }

  if (!sessionToken) {
    return res.status(400).json({
      success: false,
      error: "missing_session_token",
      message: "sessionToken is required",
    });
  }

  if (!filingId && (!filingData || !filingData.filing_id)) {
    return res.status(400).json({
      success: false,
      error: "missing_filing_id",
      message: "filingId or filingData.filing_id is required",
    });
  }

  let sessionLookup;
  switch (portal_type) {
    case "accela":
      sessionLookup =
        getAccelaSession(sessionToken) || getPWSession(sessionToken);
      break;
    case "momentum_liferay":
      sessionLookup = getMomentumSession(sessionToken);
      break;
    case "aspnet_webforms":
      sessionLookup = getMontgomerySession(sessionToken);
      break;
    case "energov":
      sessionLookup = getEnergovSession(sessionToken);
      break;
  }

  if (!sessionLookup) {
    return res.status(404).json({
      success: false,
      error: "session_not_found",
      message: `${portal_type} session not found or expired. Perform a fresh login.`,
    });
  }

  const resolvedFilingId = filingId || filingData.filing_id;
  let resolvedFilingData = filingData || {};
  resolvedFilingData.filing_id = resolvedFilingId;

  if (!resolvedFilingData.property_address && resolvedFilingId) {
    try {
      const { data: filing, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", resolvedFilingId)
        .single();

      if (!error && filing) {
        resolvedFilingData = {
          ...resolvedFilingData,
          filing_id: filing.id,
          property_address:
            resolvedFilingData.property_address || filing.property_address,
          permit_type: resolvedFilingData.permit_type || filing.permit_type,
          permit_subtype:
            resolvedFilingData.permit_subtype || filing.permit_subtype,
          review_track: resolvedFilingData.review_track || filing.review_track,
          scope_of_work:
            resolvedFilingData.scope_of_work || filing.scope_of_work,
          construction_value:
            resolvedFilingData.construction_value || filing.construction_value,
          property_type:
            resolvedFilingData.property_type || filing.property_type,
          estimated_fee:
            resolvedFilingData.estimated_fee || filing.estimated_fee,
        };
      }
    } catch (err) {
      console.log(
        `  [Filing Submit] Could not load filing data: ${err.message}`,
      );
    }
  }

  try {
    await supabase.from("agent_runs").insert({
      filing_id: resolvedFilingId,
      agent_name: "submission_finalization",
      layer: 2,
      status: "running",
      input_data: {
        portal_type,
        filing_id: resolvedFilingId,
        property_address: resolvedFilingData.property_address,
        permit_type: resolvedFilingData.permit_type,
      },
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.log(`  [Filing Submit] Could not create agent_run: ${err.message}`);
  }

  console.log(
    `\n[Filing Submit] Starting ${portal_type} submission for filing: ${resolvedFilingId}`,
  );

  res.json({
    success: true,
    message: "Submission finalization started",
    filing_id: resolvedFilingId,
    portal_type,
  });

  let submitPromise;
  const config = portal_config || {};

  switch (portal_type) {
    case "accela":
      submitPromise = permitWizardSubmit(
        sessionToken,
        resolvedFilingData,
        supabase,
      );
      break;
    case "momentum_liferay":
      submitPromise = momentumSubmit(
        null,
        sessionToken,
        resolvedFilingData,
        supabase,
      );
      break;
    case "aspnet_webforms":
      submitPromise = montgomerySubmit(
        sessionToken,
        resolvedFilingData,
        supabase,
      );
      break;
    case "energov":
      submitPromise = energovSubmit(
        sessionToken,
        resolvedFilingData,
        config,
        supabase,
      );
      break;
  }

  submitPromise
    .then(async (result) => {
      console.log(
        `  [Filing Submit] (${portal_type}) Finalization complete: ${result.success ? "SUCCESS" : "FAILED"}`,
      );
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: result.success ? "completed" : "failed",
            output_data: {
              portal_type,
              application_id: result.application_id || null,
              confirmation_number: result.confirmation_number || null,
              confirmation_message: result.confirmation_message || null,
              validation: result.validation || null,
              screenshots_count: (result.screenshots || []).length,
              submitted_at: result.submitted_at || null,
            },
            error_message: result.success ? null : result.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");
      } catch (err) {
        console.log(
          `  [Filing Submit] Could not update agent_run: ${err.message}`,
        );
      }

      if (!result.success && result.error !== "validation_failed") {
        try {
          await supabase
            .from("permit_filings")
            .update({
              filing_status: "failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", resolvedFilingId);
        } catch (_) {}
      }
    })
    .catch(async (err) => {
      console.error(
        `  [Filing Submit] (${portal_type}) Fatal error: ${err.message}`,
      );
      try {
        await supabase
          .from("agent_runs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("filing_id", resolvedFilingId)
          .eq("agent_name", "submission_finalization")
          .eq("status", "running");

        await supabase
          .from("permit_filings")
          .update({
            filing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", resolvedFilingId);
      } catch (_) {}
    });
});

app.post("/api/filing/logout", async (req, res) => {
  const { portal_type, sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ error: "sessionToken is required" });
  }

  if (portal_type && VALID_PORTAL_TYPES.includes(portal_type)) {
    switch (portal_type) {
      case "accela":
        await accelaLogout(sessionToken);
        break;
      case "momentum_liferay":
        await momentumLogout(sessionToken);
        break;
      case "aspnet_webforms":
        await montgomeryLogout(sessionToken);
        break;
      case "energov":
        await energovLogout(sessionToken);
        break;
    }
    return res.json({
      success: true,
      message: `${portal_type} session destroyed`,
    });
  }

  if (getAccelaSession(sessionToken)) {
    await accelaLogout(sessionToken);
    return res.json({ success: true, message: "accela session destroyed" });
  }
  if (getMomentumSession(sessionToken)) {
    await momentumLogout(sessionToken);
    return res.json({
      success: true,
      message: "momentum_liferay session destroyed",
    });
  }
  if (getMontgomerySession(sessionToken)) {
    await montgomeryLogout(sessionToken);
    return res.json({
      success: true,
      message: "aspnet_webforms session destroyed",
    });
  }
  if (getEnergovSession(sessionToken)) {
    await energovLogout(sessionToken);
    return res.json({ success: true, message: "energov session destroyed" });
  }

  res.json({
    success: true,
    message: "Session not found (may have already expired)",
  });
});

// ─── Generic Filing Re-Authentication ────────────────────────────────────────
app.post("/api/filing/reauth", async (req, res) => {
  const { portal_type, sessionToken } = req.body;

  if (!sessionToken) {
    return res
      .status(400)
      .json({ success: false, error: "sessionToken is required" });
  }

  try {
    let resolvedType = portal_type;
    if (!resolvedType) {
      if (getAccelaSession(sessionToken)) resolvedType = "accela";
      else if (getMomentumSession(sessionToken))
        resolvedType = "momentum_liferay";
      else if (getMontgomerySession(sessionToken))
        resolvedType = "aspnet_webforms";
      else if (getEnergovSession(sessionToken)) resolvedType = "energov";
    }

    if (!resolvedType) {
      return res.status(404).json({
        success: false,
        error: "session_not_found",
        message: "Session not found. Perform a fresh login.",
      });
    }

    let browser;
    switch (resolvedType) {
      case "accela":
        browser = await launchChromiumForScraper({ label: "filing-reauth-accela", route: "POST /api/filing/reauth", file: "server.js" });
        await reAuthenticate(browser, sessionToken);
        break;
      case "aspnet_webforms":
        browser = await launchChromiumForScraper({ label: "filing-reauth-montgomery", route: "POST /api/filing/reauth", file: "server.js" });
        await reAuthenticateMontgomery(browser, sessionToken);
        break;
      case "momentum_liferay":
      case "energov":
        return res.status(501).json({
          success: false,
          error: "reauth_not_supported",
          message: `Re-authentication not yet supported for ${resolvedType}. Perform a fresh login.`,
        });
      default:
        return res.status(400).json({
          success: false,
          error: "unsupported_portal_type",
          message: `Unsupported portal type: ${resolvedType}`,
        });
    }

    res.json({
      success: true,
      sessionToken,
      portal_type: resolvedType,
      message: "Re-authentication successful",
    });
  } catch (err) {
    console.error(`[Filing Reauth] Error:`, err.message);
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    res.status(500).json({
      success: false,
      error: "reauth_failed",
      message: err.message,
    });
  }
});

  return { PORT, runPlaywrightStartupDiagnostics, arlingtonWorker: startArlingtonDurableWorkerLoop({
    supabase,
    sessions,
    rearmSessionIdleTimeout,
    cleanupSession,
    hashPortalData,
    uploadToSupabaseStorage,
    sanitizeStorageKey,
  }) };
}

module.exports = {
  registerExecutionRoutes,
  runPlaywrightStartupDiagnostics,
};
