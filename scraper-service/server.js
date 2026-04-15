require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  accelaLogin: accelaScraperLogin,
  scrapeAccelaRecord,
} = require("./accela-scraper");
const pgcEplan = require("./pgc-eplan-scraper");
const montgomeryProjectDox = require("./montgomery-projectdox-scraper");
const montgomeryDashboardDiscovery = require("./montgomery-dashboard-discovery");
const { performMontgomeryPortalLogin } = require("./montgomery-portal-login");
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
} = require("./permitwizard-auth");
const { permitWizardFile, WIZARD_STEPS } = require("./permitwizard-filer");
const { permitWizardSubmit } = require("./permitwizard-submit");
const {
  momentumLogin,
  momentumLogout,
  getMomentumSession,
  checkSessionAlive: checkMomentumSessionAlive,
} = require("./momentum-auth");
const {
  montgomeryLogin,
  montgomeryLogout,
  getMontgomerySession,
  checkSessionAlive: checkMontgomerySessionAlive,
  reAuthenticate: reAuthenticateMontgomery,
} = require("./montgomery-auth");
const {
  energovLogin,
  energovLogout,
  getEnergovSession,
  checkSessionAlive: checkEnergovSessionAlive,
} = require("./energov-auth");
const { momentumFile } = require("./momentum-filer");
const { momentumSubmit } = require("./momentum-submit");
const { montgomeryFile } = require("./montgomery-filer");
const { montgomerySubmit } = require("./montgomery-submit");
const { energovFile } = require("./energov-filer");
const { energovSubmit } = require("./energov-submit");

// ─── Playwright browser launch reliability ───────────────────────────────────
const BROWSER_INSTALL_MESSAGE =
  "Playwright Chromium not installed. Run: npx playwright install chromium (or npm run install-browsers in scraper-service)";

function isBrowserLaunchError(err) {
  if (!err || !err.message) return false;
  const msg = err.message;
  return (
    /Executable doesn't exist/i.test(msg) ||
    /browserType\.launch/i.test(msg) ||
    /Playwright doesn't support/i.test(msg)
  );
}

function sendBrowserLaunchError(res, err) {
  console.error("❌ Browser launch failed:", err.message);
  res.status(503).json({
    error: BROWSER_INSTALL_MESSAGE,
    detail: err.message,
  });
}

/**
 * Headless on Railway/production hosts (no display). Local dev defaults to headed
 * for debugging. Override: SCRAPER_HEADLESS=true|false or PLAYWRIGHT_HEADLESS=true|false.
 * @returns {boolean}
 */
function scraperRunsHeadless() {
  const raw = (process.env.SCRAPER_HEADLESS || process.env.PLAYWRIGHT_HEADLESS || "")
    .trim()
    .toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

/**
 * Single browser launch path: same as startup diagnostic. No executablePath,
 * no /root/.cache or Linux-specific overrides. Use Playwright-managed Chromium only.
 * @param {{ label?: string, route?: string, file?: string }} callerInfo - For logging (e.g. label: 'quick-scrape', route: 'POST /api/login', file: 'server.js')
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchChromiumForScraper(callerInfo = {}) {
  const label = callerInfo.label || "scraper";
  const route = callerInfo.route || "";
  const file = callerInfo.file || "server.js";
  const launchOptions = {
    headless: scraperRunsHeadless(),
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  };

  const isQuickScrape = label === "quick-scrape";
  if (isQuickScrape) {
    console.log("[Quick Scrape] browser launch starting");
    console.log("[Quick Scrape] launch options:", JSON.stringify(launchOptions));
    console.log("[Quick Scrape] launching from:", file, route || "(login flow)");
  }

  try {
    const browser = await chromium.launch(launchOptions);
    if (isQuickScrape) console.log("[Quick Scrape] browser launch success");
    return browser;
  } catch (err) {
    if (isQuickScrape) {
      console.error("[Quick Scrape] browser launch failed:", err.message);
      console.error("[Quick Scrape] full error:", err);
    }
    throw err;
  }
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
          cwd: __dirname,
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

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/view-file", express.static(path.join(__dirname, "downloads")));

const PORT = process.env.PORT || 3001;
const DEFAULT_DASHBOARD_URL = "https://washington-dc-us.avolvecloud.com";

const MIN_FILE_SIZE = 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_SCRAPE_CUMULATIVE_SIZE = 1000 * 1024 * 1024;
const MAX_DOWNLOADS_DIR_SIZE = 1 * 1024 * 1024 * 1024;

function getDownloadsDir() {
  const dir = path.join(__dirname, "downloads");
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

async function uploadToSupabaseStorage(localPath, storagePath) {
  const ready = await ensureStorageBucket();
  if (!ready) return null;
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

    const { data, error } = await supabase.storage
      .from(resolvedBucketId)
      .upload(sanitizedPath, fileBuffer, { contentType, upsert: true });

    if (error) {
      console.error(`      ❌ Supabase upload failed for ${sanitizedPath}:`, error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from(resolvedBucketId)
      .getPublicUrl(sanitizedPath);

    const publicUrl = urlData?.publicUrl || null;
    console.log(`      ✅ Public URL: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error(`      ❌ Supabase upload exception for ${storagePath}:`, err.message);
    return null;
  }
}

const sessions = {};

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

app.get("/api/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const interval = setInterval(() => {
    const s = sessions[sessionId];
    if (s) {
      res.write(
        `data: ${JSON.stringify({ status: s.status, message: s.message, progress: s.progress, total: s.total })}\n\n`,
      );
      if (s.status === "done" || s.status === "error" || s.status === "cancelled") {
        clearInterval(interval);
        res.end();
      }
    }
  }, 800);
  req.on("close", () => clearInterval(interval));
});

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
  const { username, password, portalUrl } = req.body;
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
        "Unsupported portal type. Supported: ProjectDox (avolvecloud.com) and Accela (accela.com)",
    });
  }

  const webUiBase =
    portalType === "projectdox" ? deriveWebUiBase(dashboardUrl) : null;
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
    const page = await context.newPage();

    if (portalType === "accela") {
      await accelaScraperLogin(page, username, password, dashboardUrl);
      console.log("✅ Accela login successful!");

      await page.screenshot({
        path: path.join(__dirname, "debug_dashboard.png"),
        fullPage: true,
      });

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
      const collection = await pgcEplan.collectAllProjects(page, {
        initialMode: pagerGuess.mode,
        viewAllVisible: pagerGuess.viewAllVisible,
      });

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

      await page.screenshot({
        path: path.join(__dirname, "debug_dashboard.png"),
        fullPage: true,
      });

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

    if (isMontgomeryProjectDox) {
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
      !page.url().includes("avolvecloud.com") ||
      page.url().includes("projectdoxwebui")
    ) {
      await page.goto(dashboardUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({
      path: path.join(__dirname, "debug_dashboard.png"),
      fullPage: true,
    });

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
    } else {
      // Extract projects — also grab ProjectID from the javascript:launchRemote hrefs (non-Montgomery portals)
      projects = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        document.querySelectorAll("table tr").forEach((tr) => {
          const cells = tr.querySelectorAll("td");
          if (cells.length >= 2) {
            const link = cells[0]?.querySelector("a");
            if (link) {
              const num = link.textContent.trim();
              const href = link.getAttribute("href") || "";
              // Extract ProjectID from javascript:launchRemote('Frame.aspx?tab=projectStatusTab&ProjectID=9187')
              const pidMatch = href.match(/ProjectID=(\d+)/);
              const projectId = pidMatch ? pidMatch[1] : "";

              if (num && !seen.has(num)) {
                seen.add(num);
                let status = (() => {
                  const cell = cells[3];
                  if (!cell) return "";
                  const btn = cell.querySelector("button, a.btn, span.badge, a");
                  if (btn) return btn.textContent.trim();
                  return cell.textContent.trim();
                })();
                if (status && status.length > 2 && status.length % 2 === 0) {
                  const half = status.substring(0, status.length / 2);
                  if (status === half + half) status = half;
                }
                results.push({
                  id: projectId || num,
                  name: num,
                  projectNum: num,
                  projectId,
                  description: cells[1]?.textContent?.trim() || "",
                  location: cells[2]?.textContent?.trim() || "",
                  status: status || "",
                  tasks: cells[4]?.textContent?.trim() || "",
                  href,
                });
              }
            }
          }
        });
        return results;
      });

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

const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function rearmSessionIdleTimeout(sid) {
  const s = sessions[sid];
  if (!s) return;
  if (s._timeout) clearTimeout(s._timeout);
  s._timeout = setTimeout(
    () => cleanupSession(sid, "idle_timeout"),
    SESSION_IDLE_TIMEOUT_MS,
  );
  console.log(`[Session][cleanup] rearmed sid=${sid} minutes=15`);
}

function cleanupSession(sid, reason = "unknown") {
  const s = sessions[sid];
  if (!s) return;
  if (reason === "idle_timeout" && s._scrapeActive === true) {
    console.log(
      `[Session][cleanup] skipped sid=${sid} reason=idle_timeout scrapeActive=true`,
    );
    rearmSessionIdleTimeout(sid);
    return;
  }
  console.log(
    `[Session][cleanup] sid=${sid} at=${new Date().toISOString()} browser=${!!s.browser} context=${!!s.context} reason=${reason}`,
  );
  if (s._timeout) clearTimeout(s._timeout);
  if (s.browser) s.browser.close().catch(() => {});
  s.browser = null;
  s.context = null;
  s.page = null;
}

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
  } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!session.browser)
    return res.status(400).json({ error: "Session expired." });
  if (session._timeout) clearTimeout(session._timeout);
  session._timeout = setTimeout(
    () => cleanupSession(sessionId, "idle_timeout"),
    SESSION_IDLE_TIMEOUT_MS,
  );

  if (session.portalType === "accela") {
    if (!permitNumber || String(permitNumber).trim() === "") {
      return res
        .status(400)
        .json({ error: "Accela scraping requires a permitNumber" });
    }
    const portalUrlStr = String(session.portalUrl || "");
    const accelaIsBaltimore = portalUrlStr.toUpperCase().includes("BALTIMORE");
    if (
      accelaIsBaltimore &&
      (!projectId || String(projectId).trim() === "")
    ) {
      return res.status(400).json({
        error:
          "Baltimore Accela scraping requires projectId (projects.id) for permit integrity and DB write",
      });
    }
    console.log(
      `[api/scrape accela] permitNumber=${String(permitNumber).trim()} projectId=${projectId || "(none)"} baltimore=${accelaIsBaltimore}`,
    );
    session.status = "scraping";
    session.total = 1;
    session.progress = 0;
    session.message = `Scraping Accela permit: ${permitNumber}`;
    res.json({
      message: "Accela scraping started",
      total: 1,
      portalType: "accela",
    });
    scrapeAccelaRecord(
      session,
      String(permitNumber).trim(),
      projectId,
      userId,
      supabase,
      hashPortalData,
      uploadToSupabaseStorage,
      sanitizeStorageKey,
    )
      .then(() => {
        if (session._cancelRequested) {
          console.log("   🛑 Accela scrape was cancelled — not marking as done");
          return;
        }
        session.status = "done";
        session.progress = 1;
        session.message = `Accela scrape complete for ${permitNumber}`;
        console.log(
          `   ✅ Accela sync complete — session status set to "done"`,
        );
      })
      .catch((err) => {
        session.status = "error";
        session.message = `Error: ${err.message}`;
        console.error("❌ Accela scrape error:", err.message);
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
    res.json({
      message: "PGC ePlan scraping started",
      total: session.total,
      portalType: "projectdox",
      portalSubtype: "pgc-eplan",
    });
    scrapePgcAll(
      session,
      targets,
      sessionId,
      projectId,
      userId,
      scrapeMode || "all",
    ).catch((err) => {
      session.status = "error";
      session.message = `Error: ${err.message}`;
      console.error("❌ PGC scrape error:", err);
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
    res.json({
      message: "Montgomery ProjectDox scraping started",
      total: session.total,
      portalType: "projectdox",
      portalSubtype: "montgomery-projectdox",
    });
    scrapeMontgomeryAll(
      session,
      targets,
      sessionId,
      projectId,
      userId,
      scrapeMode || "montgomery_quick",
    ).catch((err) => {
      session.status = "error";
      session.message = `Error: ${err.message}`;
      console.error("❌ Montgomery scrape error:", err);
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
    comments: ["files"],
    supporting_docs: ["files"],
  };

  if (scrapeMode && !SCRAPE_MODE_TABS[scrapeMode]) {
    return res.status(400).json({
      error: `Invalid scrapeMode: "${scrapeMode}". Valid modes: all, standard, files, comments, supporting_docs`,
    });
  }

  let tabsToUse;
  if (scrapeMode && SCRAPE_MODE_TABS[scrapeMode]) {
    tabsToUse = SCRAPE_MODE_TABS[scrapeMode];
  } else if (Array.isArray(tabsParam) && tabsParam.length > 0) {
    tabsToUse = tabsParam;
  } else {
    tabsToUse = TAB_DEFS.map((t) => t.key);
  }

  const commentsOnly = scrapeMode === "comments";
  const effectiveTargetFolder = scrapeMode === "supporting_docs" ? "supporting_docs" : (targetFolder || null);

  const tabCount = TAB_DEFS.filter((t) => tabsToUse.includes(t.key)).length;
  session.status = "scraping";
  session.total = targets.length * tabCount;
  session.progress = 0;
  session.data = {};
  res.json({
    message: "Scraping started",
    total: session.total,
    scrapeMode: scrapeMode || "all",
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
  ).catch((err) => {
    session.status = "error";
    session.message = `Error: ${err.message}`;
    console.error("❌", err);
  });
});

const TAB_DEFS = [
  { key: "status", label: "Status", param: "projectStatusTab" },
  { key: "files", label: "Files", param: "filesTab" },
  { key: "tasks", label: "Tasks", param: "tasksTab" },
  { key: "info", label: "Info", param: "infoTab" },
  { key: "reports", label: "Reports", param: "reportsTab" },
];

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

async function syncPortalDataToSupabase(
  session,
  projects,
  supabaseProjectId,
  userId,
  targetFolder = null,
) {
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const projectNum = project.projectNum;
    const currentData = session.data[project.id];
    if (!currentData) continue;
    let actualProjectId = null;

    const newHash = hashPortalData(currentData);

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
        await supabase
          .from("projects")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", actualProjectId);
      } else if (existingRow) {
        let mergedData = currentData;
        if (
          existingRow.portal_data &&
          existingRow.portal_data.tabs &&
          currentData.tabs
        ) {
          const existingTabs = existingRow.portal_data.tabs;
          const newTabs = currentData.tabs;

          if (targetFolder && newTabs.files && existingTabs.files) {
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
          if (
            currentData.portalSubtype === "montgomery-projectdox" &&
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
                "[Montgomery][status] merge kept existing tabs.status (new scrape had empty status)",
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
        const mergedHash = hashPortalData(mergedData);
        actualProjectId = existingRow.id;
        const updatePayload = {
          portal_status:
            currentData.dashboardStatus ||
            mergedData.dashboardStatus ||
            "Scraped",
          last_checked_at: new Date().toISOString(),
          portal_data: mergedData,
          portal_data_hash: mergedHash,
          permit_number: projectNum,
        };

        if (isMontgomeryPortalSubtypePayload(mergedData)) {
          logMontgomeryDebugPreSync(
            `exact portal_data for DB UPDATE row id=${actualProjectId} permit=${projectNum}`,
            mergedData,
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
          continue;
        }
        if (isMontgomeryPortalSubtypePayload(currentData)) {
          logMontgomeryDebugPreSync(
            `exact portal_data for DB INSERT (new project) permit=${projectNum}`,
            currentData,
          );
        }
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
            portal_status: currentData.dashboardStatus || "Unknown",
            last_checked_at: new Date().toISOString(),
            portal_data: currentData,
            portal_data_hash: newHash,
          })
          .select("id, portal_data");
        if (createError) {
          console.error(
            "    ❌ Supabase create error:",
            createError.message,
            createError.details,
          );
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
    }
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
  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch (e) {
    console.warn("[PGC] pdf-parse require failed:", e.message || e);
    return { text: "", numpages: 0, parseError: "pdf-parse unavailable" };
  }
  try {
    const data = await pdfParse(buf);
    let text = capPgcReportText(data && data.text ? String(data.text) : "");
    const numpages =
      data && typeof data.numpages === "number" ? data.numpages : 0;
    return { text, numpages, parseError: null };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn("[PGC] PDF buffer text extract failed:", msg);
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
    files: (fol.files || []).map((f) => ({
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
    })),
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
      rows: Array.isArray(wf.rows)
        ? wf.rows.map((r) => ({
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

  const reportEntries = (reportsPayload?.reports || []).map((r) => {
    const hasArtifact = !!(r.pdfPublicUrl || r.excelPublicUrl);
    const exportUnavailable = !!r.exportUnavailable;
    return {
      fileSlug: r.fileSlug,
      reportName: r.reportName,
      reportType: r.reportType || "",
      reportDescription: r.reportDescription || "",
      reportUrl: hasArtifact ? null : r.reportUrl || r.viewUrl || null,
      viewerUrl: hasArtifact ? null : r.viewUrl || r.reportUrl || null,
      viewerReady: r.viewerReady,
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
      url: r.pdfPublicUrl || r.excelPublicUrl || undefined,
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
    reportsPdfs.push(pdfEntry);
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
    files: (fol.files || []).map((f) => ({
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
    })),
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
    session.message = `${project.projectNum} → Montgomery harvest`;
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

  session.message = `Montgomery scraping complete! Syncing...`;
  console.log(`\n✅ [Montgomery] Done! Syncing to Supabase...`);
  await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    null,
  );

  if (session._cancelRequested) {
    console.log("   🛑 Montgomery scrape cancelled — not marking as done");
    return;
  }
  session.status = "done";
  session.message = `Montgomery complete: ${projects.length} project(s) synced.`;
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

async function scrapePgcAll(
  session,
  projects,
  _sessionId,
  supabaseProjectId,
  userId,
  scrapeMode,
) {
  const pgcOpts = pgcPipelineOptsFromScrapeMode(scrapeMode);

  session._scrapeCumulativeBytes = 0;
  session._downloadedHashes = new Map();

  let bases = session.pgcWebUiBases;
  if (!bases || !bases.length) {
    bases = await pgcEplan.resolvePgcWebUiBases(session.page);
    session.pgcWebUiBases = bases;
  }

  const dash = session.dashboardUrl || pgcEplan.PGC_DASHBOARD_URL;

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
      return;
    }
    const project = projects[i];
    session.message = `${project.projectNum} → PGC harvest`;
    console.log(
      `\n🟣 [PGC] [${i + 1}/${projects.length}] ${project.projectNum} (ID ${project.projectId})`,
    );
    let page;
    try {
      page = await session.context.newPage();
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
        },
      );

      session.data[project.id] = await mapPgcPipelineToPortalData(
        project,
        pipelineResult,
      );
    } catch (err) {
      console.error(`   ❌ [PGC] ${project.projectNum}:`, err.message);
      session.data[project.id] = {
        name: project.name,
        projectNum: project.projectNum,
        description: project.description || "",
        location: project.location || "",
        dashboardStatus: project.status || "",
        portalType: "projectdox",
        portalSubtype: "pgc-eplan",
        jurisdiction: "Prince George's County, MD",
        tabs: {
          info: { error: err.message, keyValues: [], tables: [] },
        },
      };
    } finally {
      if (page) await page.close().catch(() => {});
    }
    session.progress++;
  }

  session.message = `PGC scraping complete! Syncing...`;
  console.log(`\n✅ [PGC] Done! Syncing to Supabase...`);
  await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    null,
  );

  if (session._cancelRequested) {
    console.log("   🛑 PGC scrape cancelled — not marking as done");
    return;
  }
  session.status = "done";
  session.message = `PGC complete: ${projects.length} project(s) synced.`;
  console.log(`    ✅ PGC Supabase sync complete — session status set to "done"`);
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
) {
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
      const targetLabel = targetFolder === "supporting_docs" ? "Targeting: Supporting Documents" : null;
      session.message = targetLabel
        ? `${project.projectNum} → ${targetLabel}`
        : `${project.projectNum} → ${tab.label}`;
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
          );
          tabData.folders = filesResult.folders;
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
          const pdfs = await extractPDFsFromPage(page, context);
          tabData.pdfs = pdfs;
          console.log(
            `      ✓ ${tabData.keyValues.length} fields, ${tabData.tables.length} tables, ${pdfs.length} PDFs`,
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

  session.message = `Scraping complete! Syncing to database...`;
  console.log(`\n✅ Done! Syncing to Supabase...`);

  await syncPortalDataToSupabase(
    session,
    projects,
    supabaseProjectId,
    userId,
    targetFolder,
  );

  if (session._cancelRequested) {
    console.log("   🛑 Scrape was cancelled — not marking as done");
    return;
  }
  session.status = "done";
  session.message = `Scraping complete! ${projects.length} projects extracted and synced.`;
  console.log(`    ✅ Supabase sync complete — session status set to "done"`);
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
  const loginPage = await context.newPage();
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
  if (folderInfo && folderInfo.path) {
    const selector = folderInfo.path.startsWith('#')
      ? `${folderInfo.path} a`
      : `#folderTree li[data-path="${folderInfo.path}"] a`;
    await freshPage.click(selector).catch(async () => {
      const allLinks = await freshPage.$$('a');
      for (const link of allLinks) {
        const t = await link.textContent().catch(() => '');
        if (t.trim() === folderInfo.text) { await link.click(); break; }
      }
    });
    await freshPage.waitForSelector('.ui-iggrid-table tbody tr', { timeout: 60000 }).catch(() => {});
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

async function extractMontgomeryFilesTabLightweight(
  page,
  context,
  session,
  project,
  webUiBase,
  supabaseProjectId = null,
) {
  cleanupDownloadsDir();

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

async function extractFilesTab(_page, _context, session, commentsOnly = false, supabaseProjectId = null, targetFolder = null) {
  let page = _page;
  let context = _context;
  cleanupDownloadsDir();

  session._scrapeCumulativeBytes = 0;
  console.log(`[Montgomery Files] cumulative bytes reset to 0 at files scrape start`);
  if (!session._downloadedHashes) session._downloadedHashes = new Map();

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
        }))
        .filter((f) => f.text.includes("(")),
  );

  if (folderElements.length === 0) {
    console.log("     📁 No folders found via #folderTree, trying fallback selectors...");
    const fallbackFolders = await page.$$eval(
      'a[id*="FolderName"], a[id*="folderName"], td a[onclick*="Folder"], div.TreeNode a, span.TreeNode a',
      (els) =>
        els.map((el) => ({
          text: el.textContent.trim(),
          path: el.id || "",
        })).filter((f) => f.text.includes("("))
    );
    if (fallbackFolders.length > 0) {
      console.log(`     📁 Found ${fallbackFolders.length} folders via fallback`);
      folderElements.push(...fallbackFolders);
    }
  }

  console.log(`     📁 Found ${folderElements.length} folders`);

  const TARGET_FOLDER_MAP = {
    supporting_docs: /supporting\s*doc/i,
    drawings: /^drawings$/i,
  };

  if (targetFolder && TARGET_FOLDER_MAP[targetFolder]) {
    const pattern = TARGET_FOLDER_MAP[targetFolder];
    const before = folderElements.length;
    const filtered = folderElements.filter((f) => {
      const name = f.text.replace(/\s*\(.*$/, "").trim();
      return pattern.test(name);
    });
    if (filtered.length > 0) {
      folderElements.length = 0;
      folderElements.push(...filtered);
      console.log(`     🎯 targetFolder="${targetFolder}": filtered ${before} → ${folderElements.length} folders`);
    } else {
      console.log(`     ⚠️ targetFolder="${targetFolder}": no matching folder found among [${folderElements.map(f => f.text.replace(/\s*\(.*$/, "").trim()).join(", ")}]. Scraping all folders.`);
    }
  }

  let totalDownloadableCount = 0;

  for (let fi = 0; fi < folderElements.length; fi++) {
    const fInfo = folderElements[fi];
    const countMatch = fInfo.text.match(/\((\d+)/);
    const fileCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const folderName = fInfo.text.replace(/\s*\(.*$/, "").trim();
    console.log(`     📁 [${fi + 1}/${folderElements.length}] "${folderName}" (${fileCount} files)`);
    if (session) session.message = targetFolder ? `Targeting: ${folderName}...` : `Files → ${folderName}`;

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

      if (fInfo.path) {
        const selector = fInfo.path.startsWith("#")
          ? `${fInfo.path} a`
          : `#folderTree li[data-path="${fInfo.path}"] a`;
        await page.click(selector).catch(async () => {
          const allLinks = await page.$$("a");
          for (const link of allLinks) {
            const t = await link.textContent().catch(() => "");
            if (t.trim() === fInfo.text) { await link.click(); break; }
          }
        });
      }

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
          if (!name || name.length < 2 || seen.has(name)) return;
          seen.add(name);

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
        if (file.id) {
          console.log(`       📥 [${i + 1}/${filesFound.length}] Downloading via FileHandler: ${safeName}`);
          try {
            const dlResult = await downloadProjectDoxFile(page, context, file.id, safeName, webUiBase, session, supabaseProjectId);
            if (dlResult.success) {
              viewUrl = dlResult.viewUrl || "";
              downloadStatus = dlResult.skippedDuplicate ? "skipped_duplicate" : "success";
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
                  const retryResult = await downloadProjectDoxFile(page, context, file.id, safeName, webUiBase, session, supabaseProjectId);
                  if (retryResult.success) {
                    viewUrl = retryResult.viewUrl || "";
                    downloadStatus = retryResult.skippedDuplicate ? "skipped_duplicate" : "success";
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
        });
      }

      result.folders.push({
        name: folderName,
        fileCount: filesFound.length || fileCount,
        files: folderFiles,
      });
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

  return result;
}

async function extractPDFsFromPage(page, context) {
  const pdfData = [];

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

        // Save debug screenshot for first report
        if (i === 0) {
          await popup
            .screenshot({
              path: path.join(__dirname, "debug_report_popup.png"),
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

        // Capture full-page screenshot of the report
        let screenshotBase64 = "";
        try {
          const screenshotBuffer = await popup.screenshot({
            fullPage: true,
            type: "png",
          });
          screenshotBase64 = screenshotBuffer.toString("base64");
          console.log(
            `         📸 Screenshot: ${Math.round(screenshotBase64.length / 1024)}KB base64`,
          );
        } catch (ssErr) {
          console.log(`         ⚠️ Screenshot failed: ${ssErr.message}`);
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
          pdfData.push({
            fileName: reportName,
            text: cleaned,
            screenshot: screenshotBase64,
            pages: 1,
            url: finalUrl,
            info: { source: content.source },
          });
        } else {
          console.log(
            `         ⚠️ No meaningful content (${content?.text?.length || 0} chars, source: ${content?.source})`,
          );
          pdfData.push({
            fileName: reportName,
            text: "",
            pages: 0,
            error: "No content extracted",
          });
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
          pdfData.push({
            fileName: reportName,
            text: inlineContent,
            pages: 1,
            url: page.url(),
            info: { source: "inline" },
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
    const publicUrl = await uploadToSupabaseStorage(filePath, storagePath);
    if (publicUrl) {
      console.log(`      ☁️  Uploaded to Supabase Storage: ${storagePath}`);
      try { fs.unlinkSync(filePath); } catch (_) {}
      registerHash(contentHash, publicUrl);
      return {
        success: true,
        path: filePath,
        sizeMB,
        viewUrl: publicUrl,
        publicUrl,
        downloadUrl: meta.downloadUrl || null,
        fileSizeKB,
        contentHash,
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

  async function extractMontgomeryWebViewerFileFromPopup(targetPopup, metadata = {}) {
    await targetPopup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    await targetPopup.waitForLoadState("load", { timeout: 20000 }).catch(() => {});

    console.log(`[Montgomery Files] viewer popup page found | ${targetPopup.url() || "none"}`);
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
    console.log(
      `[Montgomery Files] viewer iframe found: ${viewerFrame.url().substring(0, 80)}`,
    );

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
      `[Montgomery Files] fileConfig from hash: ${JSON.stringify(fileConfig)}`,
    );

    if (!fileConfig?.fileID) {
      throw new Error("viewer_missing_file_config");
    }

    const context = targetPopup.context();
    const allCookies = await context.cookies([
      "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
    ]);

    const sessionCookie = allCookies.find((c) => c.name === "SessionID");
    if (!sessionCookie) {
      throw new Error("SessionID cookie not found");
    }

    const sessionId = sessionCookie.value;
    console.log(`[Montgomery Files] SessionID cookie found, length: ${sessionId.length}`);

    const webApiBase = "https://montgomeryco-md-us-projectdoxwebapi.avolvecloud.com";
    const retrieveUrl = `${webApiBase}/File/RetrieveFile?convertToPDF=true&inline=true&blackCADBackground=false&fileID=${fileConfig.fileID}`;
    console.log(`[Montgomery Files] fetching PDF: ${retrieveUrl}`);

    const response = await context.request.get(retrieveUrl, {
      headers: {
        sessionid: sessionId,
        Referer: "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com/",
        Origin: "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    console.log(
      `[Montgomery Files] PDF response: ${response.status()} ${response.headers()["content-type"]}`,
    );

    if (response.ok()) {
      const ct = response.headers()["content-type"] || "";
      if (ct.includes("pdf")) {
        const buffer = await response.body();
        if (
          buffer[0] === 0x25 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x44 &&
          buffer[3] === 0x46
        ) {
          console.log(`[Montgomery Files] valid PDF extracted, size: ${buffer.length}`);
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
        `[Montgomery Files] unexpected response body start: ${JSON.stringify(
          Array.from((await response.body()).slice(0, 20)),
        )}`,
      );
    }

    throw new Error(
      `PDF fetch failed: status=${response.status()} ct=${response.headers()["content-type"]}`,
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
      try {
        const body = await response.body().catch(() => null);
        if (body && body.length >= MIN_FILE_SIZE) {
          if (isHtmlLikeContentType(ct)) {
            logMontgomeryFinal(`rejected candidate reason = html_like_content_type ${ct}`);
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
      const MONTGOMERY_NON_DRAWINGS_RETRIEVE_TIMEOUT_MS = 120000;
      console.log(
        `[Montgomery][non-drawings] direct retrieve start | fileId=${fileId} | timeoutMs=${MONTGOMERY_NON_DRAWINGS_RETRIEVE_TIMEOUT_MS} | fileName="${fileName}"`,
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
            `[Montgomery][non-drawings] direct retrieve fail | status=0 | contentType=missing_SessionID`,
          );
          nonDrawingsResult = { success: false, reason: "no_session_id" };
        } else {
          const sessionIdVal = sessionCookie.value;
          const response = await context.request.get(retrieveUrl, {
            timeout: MONTGOMERY_NON_DRAWINGS_RETRIEVE_TIMEOUT_MS,
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
                  `[Montgomery][non-drawings] direct retrieve fail | reason=montgomery_webapi_timeout | fileId=${fileId} | fileName="${fileName}" | timeoutMs=${MONTGOMERY_NON_DRAWINGS_RETRIEVE_TIMEOUT_MS}`,
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
            `[Montgomery][non-drawings] direct retrieve fail | reason=montgomery_webapi_timeout | fileId=${fileId} | fileName="${fileName}" | timeoutMs=${MONTGOMERY_NON_DRAWINGS_RETRIEVE_TIMEOUT_MS}`,
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
          if (!isHtmlLikeContentType(ct) && !isViewerShellUrl(url)) {
            resolved = true;
            console.log(`      📡 Real file response for fileId ${fileId}: ${url.substring(0, 120)} (${ct})`);
            resolve(true);
          }
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

    await page.evaluate(() => { window.name = ""; });

    await page.evaluate((fid) => {
      if (typeof viewFile === "function") {
        viewFile(fid);
      } else if (typeof window.viewFile === "function") {
        window.viewFile(fid);
      } else {
        const link = document.querySelector(`a[href*="viewFile(${fid})"]`);
        if (link) link.click();
      }
    }, parseInt(fileId));

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

    if (popup) {
      popup.on("response", contextResponseHandler);
      console.log(`      🔗 Viewer popup opened: ${popup.url()}`);

      await popup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
      if (isMontgomeryAdapter && preferViewerRuntime) {
        try {
          console.log("[Montgomery Files] viewer runtime detected");
          logMontgomeryFinal("viewer runtime detected");
          const runtimeFile = await extractMontgomeryWebViewerFileFromPopup(popup, {
            fileId,
            fileName,
          });
          const runtimeBuffer = runtimeFile.buffer;
          logMontgomeryFinal(
            `document detected | viewerIndex=${runtimeFile.viewerIndex ?? -1} | ${runtimeFile.filename || fileName} | type=${runtimeFile.fileType || "unknown"} | pages=${runtimeFile.pages || 0}`,
          );
          logMontgomeryFinal("getDocumentCompletePromise resolved");
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
              `[Montgomery Files] cumulative cap hit after ${typeof result !== "undefined" ? result._meta.downloadsOk : "unknown"} files, total bytes: ${cumulative}`,
            );
            return { success: false, reason: "cumulative_cap" };
          }
          fs.writeFileSync(downloadPath, runtimeBuffer);
          if (session) session._scrapeCumulativeBytes = cumulative;
          const contentHash = computeHash(runtimeBuffer);
          const sizeMB = (runtimeBuffer.length / 1024 / 1024).toFixed(2);
          console.log(
            `[Montgomery Files] document detected | viewerIndex=${runtimeFile.viewerIndex ?? -1} | ${runtimeFile.filename || fileName} | type=${runtimeFile.fileType || "unknown"} | pages=${runtimeFile.pages || 0}`,
          );
          console.log("[Montgomery Files] getDocumentCompletePromise resolved");
          console.log(
            `[Montgomery Files] getFileData success | bytes=${runtimeBuffer.length}`,
          );
          const runtimeDownloadUrl =
            /^https?:\/\//i.test(runtimeFile.downloadLink || "") &&
            !isViewerShellUrl(runtimeFile.downloadLink)
              ? runtimeFile.downloadLink
              : null;
          logMontgomeryFinal(
            `resolved file source = ${runtimeDownloadUrl || "runtime:getFileData"}`,
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
            `[Montgomery Files] tryUploadAndClean result | fileId=${fileId} | success=${uploadResult?.success} | publicUrl=${uploadResult?.publicUrl || null} | reason=${uploadResult?.reason || null}`,
          );
          console.log(
            `[Montgomery Files] upload ${uploadResult?.publicUrl ? "success" : "fail"} | ${runtimeFile.filename || fileName}`,
          );
          return uploadResult;
        } catch (err) {
          console.log(
            `[Montgomery Files] runtime extraction failed | ${err?.message || err}`,
          );
          if (err && err.message === "viewer_missing_file_config") {
            logMontgomeryFinal("rejected candidate reason = viewer_missing_file_config");
            return { success: false, reason: "viewer_missing_file_config" };
          }
          logMontgomeryFinal(
            `rejected candidate reason = runtime_extraction_failed:${err?.message || err}`,
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
        const nonJunk = capturedResponses.filter((r) => !isJunkUrl(r.url));
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
  }

  return { success: false };
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

    // 5. Span pairs: bold/semibold span followed by value span
    document.querySelectorAll("span").forEach((span) => {
      const style = (window.getComputedStyle(span).fontWeight || "").toString();
      const cls = (span.className || "") + " ";
      const isBold = parseInt(style, 10) >= 600 || /bold|semibold/i.test(cls);
      if (!isBold) return;
      const lbl = span.textContent.trim().replace(/:$/, "").trim();
      if (!lbl || lbl.length > 80) return;
      let next = span.nextElementSibling;
      if (next && (next.tagName || "").toLowerCase() === "span")
        add(lbl, next.textContent);
      else if (span.nextSibling && span.nextSibling.nodeType === 3) {
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
      loginPassword = cred.portal_password;
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
      loginPassword = cred.portal_password;
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

// ─── Data / Export / Cleanup ─────────────────────────────────────────────────
app.get("/api/data/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({
    status: s.status,
    message: s.message,
    progress: s.progress,
    total: s.total,
    data: s.data,
  });
});

app.post("/api/scrape/cancel/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Session not found" });
  s._cancelRequested = true;
  s.status = "cancelled";
  s.message = "Scrape cancelled by user";
  console.log(`   🛑 Cancel requested for session ${req.params.sessionId}`);
  cleanupSession(req.params.sessionId, "http_cancel");
  res.json({ message: "Scrape cancelled", sessionId: req.params.sessionId });
});

app.post("/api/logout/:sessionId", (req, res) => {
  cleanupSession(req.params.sessionId, "http_logout");
  res.json({ message: "Closed" });
});

// ─── UPDATED EXPORT FUNCTION: Fixed Sorting ──────────────────────────────────
app.get("/api/export/:sessionId", async (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s?.data || Object.keys(s.data).length === 0)
    return res.status(404).json({ error: "No data" });

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "ProjectDox Scraper";

    // 1. Employee Sheet
    const empSheet = wb.addWorksheet("Work by Employee");
    empSheet.columns = [
      { header: "Employee / User", key: "emp", width: 25 },
      { header: "Project", key: "proj", width: 15 },
      { header: "Task / Workflow", key: "task", width: 40 },
      { header: "Status", key: "status", width: 15 },
      { header: "Cycle / Dept", key: "dept", width: 20 },
      { header: "Date", key: "date", width: 15 },
    ];

    const empRows = [];

    const addEmpRow = (empName, projNum, taskName, status, dept, date) => {
      if (!empName || empName.includes("Unassigned")) return;
      empRows.push({
        emp: empName,
        proj: projNum,
        task: taskName,
        status: status || "",
        dept: dept || "",
        date: date || "",
      });
    };

    for (const [pid, pd] of Object.entries(s.data)) {
      const taskTab = pd.tabs["tasks"];
      if (taskTab && taskTab.tables) {
        taskTab.tables.forEach((table) => {
          const findKey = (candidates) =>
            table.headers.find((h) =>
              candidates.some((c) => h.toLowerCase().includes(c)),
            );
          const userHeader = findKey([
            "assigned",
            "user",
            "owner",
            "department",
          ]);
          const taskHeader = findKey(["task", "workflow", "step", "activity"]);
          const statusHeader = findKey(["status"]);
          const dateHeader = findKey(["date", "due", "start"]);

          if (userHeader) {
            table.rows.forEach((row) => {
              addEmpRow(
                row[userHeader],
                pd.projectNum || pid,
                row[taskHeader] || "Unknown Task",
                row[statusHeader],
                "Workflow Task",
                row[dateHeader],
              );
            });
          }
        });
      }

      const infoTab = pd.tabs["info"];
      if (infoTab && infoTab.keyValues) {
        infoTab.keyValues.forEach((kv) => {
          const k = kv.key.toLowerCase();
          if (
            k.includes("applicant") ||
            k.includes("coordinator") ||
            k.includes("contact") ||
            k.includes("manager")
          ) {
            addEmpRow(
              kv.value,
              pd.projectNum || pid,
              kv.key,
              "Info Field",
              "",
              "",
            );
          }
        });
      }
    }

    empRows.sort((a, b) => a.emp.localeCompare(b.emp));
    empRows.forEach((row) => empSheet.addRow(row));
    styleSheet(empSheet);

    // 2. Summary Sheet (Original)
    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Project", key: "num", width: 18 },
      { header: "Description", key: "desc", width: 55 },
      { header: "Location", key: "loc", width: 35 },
      { header: "Status", key: "status", width: 15 },
      { header: "Fields", key: "fields", width: 12 },
    ];
    for (const [pid, pd] of Object.entries(s.data)) {
      let f = 0;
      Object.values(pd.tabs).forEach((t) => {
        if (t.keyValues) f += t.keyValues.length;
        if (t.tables) t.tables.forEach((tb) => (f += tb.rows.length));
      });
      summary.addRow({
        num: pd.projectNum || pid,
        desc: pd.description || "",
        loc: pd.location || "",
        status: pd.dashboardStatus || "",
        fields: f,
      });
    }
    styleSheet(summary);

    // 3. Detailed Tabs (Original)
    for (const tab of TAB_DEFS) {
      const sheet = wb.addWorksheet(tab.label);
      const allRows = [];
      for (const [pid, pd] of Object.entries(s.data)) {
        const td = pd.tabs[tab.key];
        if (!td || td.error) continue;
        td.keyValues?.forEach((kv) =>
          allRows.push({
            Project: pd.projectNum || pid,
            Type: "Field",
            Field: kv.key,
            Value: kv.value,
          }),
        );
        td.tables?.forEach((tbl, ti) =>
          tbl.rows.forEach((row) => {
            const fr = {
              Project: pd.projectNum || pid,
              Type: `Table ${ti + 1}`,
            };
            Object.entries(row).forEach(([k, v]) => (fr[k] = v));
            allRows.push(fr);
          }),
        );
      }
      if (allRows.length > 0) {
        const keys = [...new Set(allRows.flatMap((r) => Object.keys(r)))];
        sheet.columns = keys.map((k) => ({ header: k, key: k, width: 25 }));
        allRows.forEach((r) => sheet.addRow(r));
        styleSheet(sheet);
      } else {
        sheet.addRow(["No data"]);
      }
    }

    const fp = path.join(__dirname, `Export_${req.params.sessionId}.xlsx`);
    await wb.xlsx.writeFile(fp);
    res.download(fp, "ProjectDox_Export.xlsx", () => {
      try {
        fs.unlinkSync(fp);
      } catch (e) {}
    });
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: err.message });
  }
});

function styleSheet(sheet) {
  const r = sheet.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };
  r.alignment = { vertical: "middle" };
  r.height = 28;
  r.eachCell((c) => {
    c.border = { bottom: { style: "thin", color: { argb: "FF555577" } } };
  });
}

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  for (const sid of Object.keys(sessions)) cleanupSession(sid, "sigint");
  process.exit(0);
});

async function startServer() {
  console.log("Playwright startup diagnostics:");
  const browserOk = await runPlaywrightStartupDiagnostics();
  if (!browserOk) {
    console.log("Server will start anyway; login/scrape will return 503 until Chromium is installed.");
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
  const envName =
    process.env.NODE_ENV ||
    (process.env.RAILWAY_ENVIRONMENT ? "railway" : "development");
  console.log(
    `[SCRAPER SERVER] PID=${process.pid}, PORT=${PORT}, ENV=${envName}, READY`,
  );
  console.log(
    "[SCRAPER SERVER] Do not run multiple scraper server instances at the same time.",
  );
  console.log(`
╔══════════════════════════════════════════════════════╗
║  🏛️  ProjectDox Data Extractor                        ║
║  Server running at: http://localhost:${PORT}          ║
║  Export now includes "Work by Employee" Tab          ║
║  Automatic PDF Downloading Enabled (Option A)        ║
╚══════════════════════════════════════════════════════╝
  `);
  // ✅ Only open browser on your local machine
  if (!process.env.RAILWAY_ENVIRONMENT) {
    import("open")
      .then((mod) => mod.default(`http://localhost:${PORT}`))
      .catch(() => {});
  }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `[SCRAPER SERVER] PID=${process.pid}, PORT=${PORT}, BIND_FAILED=EADDRINUSE`,
      );
      console.error(
        "[SCRAPER SERVER] Another scraper instance is already running on this port.",
      );
    }
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});