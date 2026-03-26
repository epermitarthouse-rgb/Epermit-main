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
  if (lower.includes("avolvecloud.com") || lower.includes("projectdox"))
    return "projectdox";
  if (lower.includes("accela.com")) return "accela";
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
const MAX_SCRAPE_CUMULATIVE_SIZE = 500 * 1024 * 1024;
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
        () => cleanupSession(sessionId),
        15 * 60 * 1000,
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

    await performLogin(page, username, password, dashboardUrl);
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

    // Extract projects — also grab ProjectID from the javascript:launchRemote hrefs
    const projects = await page.evaluate(() => {
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

    console.log(`📋 Found ${projects.length} projects`);
    projects.forEach((p) =>
      console.log(`   ${p.projectNum} (ID: ${p.projectId})`),
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

    const sessionId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessions[sessionId] = {
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
    sessions[sessionId]._timeout = setTimeout(
      () => cleanupSession(sessionId),
      15 * 60 * 1000,
    );
    res.json({ sessionId, projectCount: projects.length, projects });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    if (browser) await browser.close().catch(() => {});
    if (isBrowserLaunchError(err)) {
      return sendBrowserLaunchError(res, err);
    }
    res.status(500).json({ error: err.message });
  }
});

function cleanupSession(sid) {
  const s = sessions[sid];
  if (s) {
    if (s._timeout) clearTimeout(s._timeout);
    if (s.browser) s.browser.close().catch(() => {});
    s.browser = null;
    s.context = null;
    s.page = null;
  }
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
    () => cleanupSession(sessionId),
    15 * 60 * 1000,
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

  // ─── 💾 SYNC TO SUPABASE (after scraping completes) ─────────────────────────
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const projectNum = project.projectNum;
    const currentData = session.data[project.id];
    if (!currentData) continue;
    let actualProjectId = null;

    const newHash = hashPortalData(currentData);

    try {
      console.log(`    🔄 Syncing ${projectNum} to Supabase...`);
      console.log(`    📌 projectId=${supabaseProjectId || "(none)"}, userId=${userId}, portalType=${currentData.portalType || "(none)"}`);

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
            const keptFolders = existingFolders.filter((f) => !newFolderNames.has(f.name));
            const mergedFolders = [...keptFolders, ...newFolders];
            newTabs.files = { ...existingTabs.files, ...newTabs.files, folders: mergedFolders };
            console.log(`    🔀 Folder-level merge: kept [${keptFolders.map(f => f.name).join(", ")}], updated [${[...newFolderNames].join(", ")}]`);
          }

          const merged = { ...existingTabs, ...newTabs };
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

        console.log(`    📝 DB WRITE: supabaseProjectId=${supabaseProjectId || "(none)"}, permit=${projectNum}, portalType=${mergedData.portalType || "(none)"}, targetRow=${actualProjectId}`);

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
          console.error("    ❌ Supabase create error:", createError.message, createError.details);
          continue;
        }
        if (created && created.length > 0) {
          actualProjectId = created[0].id;
          const writtenType = created[0].portal_data?.portalType || "(none)";
          console.log(`    📝 Created new project row=${actualProjectId}, written portalType=${writtenType}`);
        }
      }

      if (actualProjectId) {
        const { data: verify } = await supabase
          .from("projects")
          .select("id, permit_number, credential_id, portal_data")
          .eq("id", actualProjectId)
          .maybeSingle();
        if (verify) {
          console.log(`    🔍 DB verify: row=${verify.id}, permit=${verify.permit_number}, credential=${verify.credential_id || "(none)"}, portalType=${verify.portal_data?.portalType || "(none)"}`);
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
  } else {
    await performLogin(loginPage, session.username, session.password, session.dashboardUrl);
  }
  if (session.webUiBase && session.projects && session.projects.length > 0) {
    const firstProjectId = session.projects[0].projectId;
    if (firstProjectId) {
      const testPage = await context.newPage();
      await testPage.goto(
        `${session.webUiBase}/WebForms/Frame.aspx?tab=projectStatusTab&ProjectID=${firstProjectId}`,
        { waitUntil: 'networkidle', timeout: 90000 }
      ).catch(() => {});
      await testPage.waitForTimeout(2000);
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

async function extractFilesTab(_page, _context, session, commentsOnly = false, supabaseProjectId = null, targetFolder = null) {
  let page = _page;
  let context = _context;
  cleanupDownloadsDir();

  if (!session._scrapeCumulativeBytes) session._scrapeCumulativeBytes = 0;
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

async function downloadProjectDoxFile(page, context, fileId, fileName, webUiBase, session, projectId) {
  const downloadDir = getDownloadsDir();

  if (session && session._scrapeCumulativeBytes >= MAX_SCRAPE_CUMULATIVE_SIZE) {
    console.log(`      ⚠️ Cumulative download limit reached (${(session._scrapeCumulativeBytes / 1024 / 1024).toFixed(0)} MB / ${(MAX_SCRAPE_CUMULATIVE_SIZE / 1024 / 1024).toFixed(0)} MB). Skipping file: ${fileName}`);
    return { success: false, reason: "cumulative_limit" };
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

  const tryUploadAndClean = async (filePath, sizeMB, contentHash) => {
    const dupCheck = isDuplicate(contentHash);
    if (dupCheck.dup) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return { success: true, path: filePath, sizeMB, viewUrl: dupCheck.aliasUrl, contentHash, skippedDuplicate: true };
    }
    if (!projectId) {
      console.log(`      ⚠️ No projectId — keeping file locally: ${fileName}`);
      registerHash(contentHash, "");
      return { success: true, path: filePath, sizeMB, viewUrl: "", contentHash };
    }
    const storagePath = `drawings/${projectId}/${fileName}`;
    const publicUrl = await uploadToSupabaseStorage(filePath, storagePath);
    if (publicUrl) {
      console.log(`      ☁️  Uploaded to Supabase Storage: ${storagePath}`);
      try { fs.unlinkSync(filePath); } catch (_) {}
      registerHash(contentHash, publicUrl);
      return { success: true, path: filePath, sizeMB, viewUrl: publicUrl, contentHash };
    }
    console.log(`      ⚠️ Supabase upload failed — keeping local copy: ${fileName}`);
    registerHash(contentHash, "");
    return { success: true, path: filePath, sizeMB, viewUrl: "", contentHash };
  };

  const existingPages = context.pages();
  for (const p of existingPages) {
    if (p !== page) {
      await p.close().catch(() => {});
    }
  }

  const PDF_MAGIC = Buffer.from("%PDF");

  function isFileContentType(ct) {
    return ct.includes("application/pdf") || ct.includes("application/octet-stream") ||
      ct.includes("image/") || ct.includes("application/zip") ||
      ct.includes("application/msword") || ct.includes("application/vnd.openxmlformats");
  }

  function isFileUrl(url) {
    return /\.(pdf|dwg|doc|docx|xlsx|jpg|png|zip)(\?|$)/i.test(url) ||
      /filehandler|filedownload|getfile|viewfile/i.test(url);
  }

  function hasValidPdfHeader(buffer) {
    return buffer && buffer.length >= 4 && buffer.slice(0, 4).equals(PDF_MAGIC);
  }

  const capturedResponses = [];
  const contextResponseHandler = async (response) => {
    const url = response.url();
    const ct = response.headers()["content-type"] || "";
    const status = response.status();
    if (status === 200 && (isFileContentType(ct) || isFileUrl(url))) {
      if (isJunkUrl(url)) return;
      try {
        const body = await response.body().catch(() => null);
        if (body && body.length >= MIN_FILE_SIZE) {
          if (ct.includes("text/html") || ct.includes("text/javascript") || ct.includes("text/css")) return;
          capturedResponses.push({ url, contentType: ct, body });
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

  try {
    const popupPromise = context.waitForEvent("page", { timeout: 20000 }).catch(() => null);

    const realResponsePromise = new Promise((resolve) => {
      let resolved = false;
      const handler = async (response) => {
        if (resolved) return;
        const ct = response.headers()["content-type"] || "";
        const url = response.url();
        if (response.status() === 200 && (isFileContentType(ct) || isFileUrl(url))) {
          if (!ct.includes("text/html") && !ct.includes("text/javascript") && !ct.includes("text/css")) {
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

    const gotRealResponse = await realResponsePromise;
    if (!gotRealResponse) {
      console.log(`      ⚠️ No real file response received within 20s for fileId ${fileId}, falling back to captured responses`);
    }
    await page.waitForTimeout(1000);
    popup = await popupPromise;

    if (popup) {
      popup.on("response", contextResponseHandler);
      console.log(`      🔗 Viewer popup opened: ${popup.url()}`);

      await popup.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
      await popup.waitForTimeout(3000);

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
        return await tryUploadAndClean(downloadPath, sizeMB, contentHash);
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

      if (fileSourceUrl) {
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
              return await tryUploadAndClean(downloadPath, sizeMB, contentHash);
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
          return await tryUploadAndClean(downloadPath, sizeMB, contentHash);
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
  cleanupSession(req.params.sessionId);
  res.json({ message: "Scrape cancelled", sessionId: req.params.sessionId });
});

app.post("/api/logout/:sessionId", (req, res) => {
  cleanupSession(req.params.sessionId);
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
  for (const sid of Object.keys(sessions)) cleanupSession(sid);
  process.exit(0);
});

async function startServer() {
  console.log("Playwright startup diagnostics:");
  const browserOk = await runPlaywrightStartupDiagnostics();
  if (!browserOk) {
    console.log("Server will start anyway; login/scrape will return 503 until Chromium is installed.");
  }

  app.listen(PORT, "0.0.0.0", () => {
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
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});