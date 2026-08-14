"use strict";

/**
 * Local DC session-handoff test for permit B2606607.
 * Starts a throwaway scraper on PORT 3017, logs in, scrapes status+tasks+info,
 * and asserts the active page stays on session.planreview (not SessionEnded/Okta).
 *
 * Does not commit/push/deploy. Sync may run after extraction (existing scrapeAll).
 *
 * Usage (from scraper-service):
 *   PORT=3017 node diagnostics/dc-session-handoff-b2606607.js
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const SCRAPER_ROOT = path.join(__dirname, "..");
const PORT = String(process.env.PORT || "3017");
const BASE = `http://127.0.0.1:${PORT}`;
const CREDENTIAL_ID = "de8592f9-69fc-4c71-8544-cb22bbbd5813";
const PERMIT = "B2606607";
const TABS = ["status", "tasks", "info"];

function loadEnvFile() {
  const envPath = path.join(SCRAPER_ROOT, ".env");
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].trim();
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health/playwright`);
      if (res.ok || res.status === 503) return;
    } catch (_) {}
    await sleep(800);
  }
  throw new Error("scraper health timeout");
}

async function main() {
  loadEnvFile();
  const {
    resolveStoredPortalPassword,
  } = require("../app/services/portal-credentials/portal-credentials-crypto.js");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: cred, error: credErr } = await supabase
    .from("portal_credentials")
    .select("portal_username, portal_password, login_url, user_id")
    .eq("id", CREDENTIAL_ID)
    .maybeSingle();
  if (credErr || !cred) {
    throw new Error(`credential: ${credErr?.message || "not found"}`);
  }

  const username = cred.portal_username;
  const password = resolveStoredPortalPassword(cred.portal_password);
  const portalUrl =
    String(cred.login_url || "")
      .replace(/\/+$/, "")
      .replace(/\/User\/Index$/i, "") ||
    "https://washington-dc-us.avolvecloud.com";

  // Prefer an existing project for this permit (sync target); allow null.
  let projectId = null;
  const { data: projects } = await supabase
    .from("projects")
    .select("id, permit_number, name")
    .ilike("permit_number", PERMIT)
    .limit(3);
  if (projects?.length) {
    projectId = projects[0].id;
    console.log(
      `[DC][handoff-test] supabase project=${projectId} name=${projects[0].name}`,
    );
  } else {
    console.log(
      `[DC][handoff-test] no supabase project for ${PERMIT}; scrape without projectId`,
    );
  }

  console.log(`[DC][handoff-test] starting scraper on ${BASE}…`);
  const child = spawn("node", ["server.js"], {
    cwd: SCRAPER_ROOT,
    env: {
      ...process.env,
      PORT,
      NODE_ENV: "development",
      ALLOW_DC_DIAGNOSTICS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logLines = [];
  const pushLog = (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    for (const line of text.split("\n")) {
      if (line.trim()) logLines.push(line);
    }
  };
  child.stdout.on("data", pushLog);
  child.stderr.on("data", pushLog);

  const shutdown = async () => {
    if (!child.killed) {
      child.kill("SIGTERM");
      await sleep(1500);
      if (!child.killed) child.kill("SIGKILL");
    }
  };

  try {
    await waitForHealth();
    console.log(`[DC][handoff-test] health ok`);

    const loginRes = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        portalUrl,
        permitNumber: PERMIT,
      }),
    });
    const loginJson = await loginRes.json();
    if (!loginRes.ok) {
      throw new Error(`login failed: ${JSON.stringify(loginJson)}`);
    }
    console.log(
      `[DC][handoff-test] login ok sessionId=${loginJson.sessionId} projects=${loginJson.projectCount} subtype=${loginJson.portalSubtype}`,
    );

    const found = (loginJson.projects || []).find(
      (p) => String(p.projectNum || "").toUpperCase() === PERMIT,
    );
    if (!found) {
      throw new Error(`permit ${PERMIT} not discovered after login`);
    }
    console.log(
      `[DC][handoff-test] discovered ${PERMIT} projectId=${found.projectId}`,
    );

    const scrapeRes = await fetch(`${BASE}/api/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: loginJson.sessionId,
        permitNumber: PERMIT,
        projectId: projectId || undefined,
        userId: cred.user_id || undefined,
        tabs: TABS,
      }),
    });
    const scrapeJson = await scrapeRes.json();
    if (!scrapeRes.ok) {
      throw new Error(`scrape start failed: ${JSON.stringify(scrapeJson)}`);
    }
    console.log(`[DC][handoff-test] scrape started: ${JSON.stringify(scrapeJson)}`);

    // Poll status
    let statusJson = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 12 * 60 * 1000) {
      await sleep(4000);
      const st = await fetch(
        `${BASE}/api/data/${loginJson.sessionId}`,
      );
      statusJson = await st.json();
      console.log(
        `[DC][handoff-test] status=${statusJson.status} progress=${statusJson.progress}/${statusJson.total} msg=${statusJson.message}`,
      );
      if (
        statusJson.status === "done" ||
        statusJson.status === "error" ||
        statusJson.status === "cancelled"
      ) {
        break;
      }
    }

    const dcLogs = logLines.filter((l) => /\[DC\]\[session\]/.test(l));
    const badUrls = logLines.filter(
      (l) =>
        /SessionEnded|SessionIDDoesNotExist|okta\.com.*logout|oauth2\/v2\.0\/logout/i.test(
          l,
        ) && /tab=|URL before extraction|active extraction/i.test(l),
    );
    const rebuilt = dcLogs.some((l) => /rebuilt=true|project session rebuilt/i.test(l));
    const activeOk = dcLogs.some((l) =>
      /active extraction page URL:.*session\.planreview\.dob\.dc\.gov\/Project\/Index/i.test(
        l,
      ),
    );

    // Inspect extracted tab data in session status payload
    const data = statusJson?.data || {};
    const projKeys = Object.keys(data);
    let extractedAny = false;
    const tabSummary = {};
    for (const k of projKeys) {
      const tabs = data[k]?.tabs || {};
      for (const t of TABS) {
        const td = tabs[t];
        if (!td) continue;
        const kv = Array.isArray(td.keyValues) ? td.keyValues.length : 0;
        const tables = Array.isArray(td.tables) ? td.tables.length : 0;
        const err = td.error || null;
        tabSummary[t] = { keyValues: kv, tables, error: err };
        if (!err && (kv > 0 || tables > 0)) extractedAny = true;
      }
    }

    const report = {
      loginSubtype: loginJson.portalSubtype,
      permitFound: true,
      projectId: found.projectId,
      scrapeStatus: statusJson?.status,
      activeOk,
      rebuilt,
      extractedAny,
      tabSummary,
      sampleDcLogs: dcLogs.slice(-30),
      badExtractionUrls: badUrls.slice(0, 10),
    };

    console.log("\n=== DC HANDOFF LOCAL TEST REPORT ===");
    console.log(JSON.stringify(report, null, 2));

    const pass =
      loginJson.portalSubtype === "dc-planreview" &&
      activeOk &&
      extractedAny &&
      badUrls.length === 0 &&
      (statusJson?.status === "done" || extractedAny);

    if (!pass) {
      process.exitCode = 2;
      console.error("[DC][handoff-test] FAIL");
    } else {
      console.log("[DC][handoff-test] PASS");
    }
  } finally {
    await shutdown();
  }
}

main().catch((err) => {
  console.error("[DC][handoff-test] FAILED:", err.message);
  process.exit(1);
});
