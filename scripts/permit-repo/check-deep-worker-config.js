#!/usr/bin/env node
"use strict";

/**
 * Offline configuration check for the supervised local deep worker. No network, no portal, no database.
 * Prints names, formats and booleans only, never a value.
 *
 *   cd scraper-service && PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
 *     node ../scripts/permit-repo/check-deep-worker-config.js [--pipeline-secret-file ../.permitpilot-pipeline-secret.env.local]
 *
 * The run flags (PERMIT_SYNC_*) are taken from the shell when set, else from the planned one-permit run.
 */

const fs = require("node:fs");
const path = require("node:path");

const service = path.resolve(__dirname, "..", "..", "scraper-service");
const req = (m) => require(require.resolve(m, { paths: [service] }));
const parsed = req("dotenv").parse(fs.readFileSync(path.join(service, ".env")));

const PLANNED = {
  PERMIT_SYNC_WORKER_ENABLED: "true",
  PERMIT_SYNC_LIVE_PORTAL_APPROVED: "A-3",
  PERMIT_SYNC_MODE: "deep",
  PERMIT_SYNC_WORKER_ONCE: "true",
  PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS: "6364",
  PERMIT_SYNC_DEEP_MAX_FILES: "3",
  PERMIT_SYNC_DEEP_MAX_BYTES: String(20 * 1024 * 1024),
  SCRAPER_HEADLESS: "false",
};
const env = { ...parsed };
for (const [k, v] of Object.entries(PLANNED)) env[k] = process.env[k] !== undefined ? process.env[k] : v;

const i = process.argv.indexOf("--pipeline-secret-file");
if (i > 0) {
  const f = path.resolve(process.argv[i + 1]);
  const fileEnv = fs.existsSync(f) ? req("dotenv").parse(fs.readFileSync(f)) : {};
  env.PERMITPILOT_SERVICE_PIPELINE_SECRET = fileEnv.PERMITPILOT_SERVICE_PIPELINE_SECRET || "";
}

const entry = require(path.join(service, "permit-sync", "worker-entry.js"));
const policy = require(path.join(service, "permit-sync", "deep", "policy.js"));

function keyBytes(raw) {
  try {
    return Buffer.from(String(raw || "").trim(), "base64").length;
  } catch (_) {
    return 0;
  }
}

let chromium = { resolved: false };
try {
  const exe = req("playwright").chromium.executablePath();
  chromium = { resolved: Boolean(exe && fs.existsSync(exe)), browsers_path_set: Boolean(process.env.PLAYWRIGHT_BROWSERS_PATH) };
} catch (e) {
  chromium = { resolved: false, error: String(e && e.message).split("\n")[0].slice(0, 120) };
}

let supabaseRef = null;
try {
  supabaseRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];
} catch (_) {}

const secret = env.PERMITPILOT_SERVICE_PIPELINE_SECRET || "";
const out = {
  startup_check: entry.startupCheck(env),
  env_present: Object.fromEntries(
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PORTAL_CREDENTIALS_ENCRYPTION_KEY", "PERMITPILOT_SERVICE_PIPELINE_SECRET"].map((k) => [k, Boolean(env[k])]),
  ),
  supabase_project_ref: supabaseRef,
  service_key_format: entry.serviceKeyFormat(env.SUPABASE_SERVICE_ROLE_KEY),
  encryption_key_32_bytes: keyBytes(env.PORTAL_CREDENTIALS_ENCRYPTION_KEY) === 32,
  pipeline_secret: secret ? { present: true, length_ok: secret.length >= 32 } : { present: false },
  agent_trigger: secret && entry.serviceKeyFormat(env.SUPABASE_SERVICE_ROLE_KEY) === "legacy_service_role_jwt" ? "on" : "off",
  mode: entry.syncMode(env),
  scope: entry.workerScope(env),
  download_limits: policy.downloadLimits(env),
  headless: env.SCRAPER_HEADLESS !== "false",
  chromium,
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.startup_check.ok && out.encryption_key_32_bytes && chromium.resolved ? 0 : 1);
