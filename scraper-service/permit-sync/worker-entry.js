"use strict";

/**
 * Standalone permit-sync worker process: `node permit-sync/worker-entry.js`.
 *
 * Off unless PERMIT_SYNC_WORKER_ENABLED=true AND PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3. Without both it
 * exits before claiming anything, so a misconfigured deploy cannot fail queued jobs.
 *
 * PERMIT_SYNC_MODE=json (default): JSON pass only; the HTTP app is not loaded.
 * PERMIT_SYNC_MODE=deep (D-055): the guard runs in deep mode, login is the manual `performLogin`, and after
 * each permit's JSON pass the manual DC scraper runs in the same browser session (permit-sync/deep). The
 * HTTP app closure is loaded without listening. It never shares a browser with the HTTP service.
 */

const os = require("node:os");
const { runLoop, supabaseWorkerRpc } = require("./core/worker");
const { AuthError, PortalChangedError } = require("./core/errors");
const { createDcAdapter } = require("./adapters/dc-projectdox/adapter");
const { TransientError } = require("./core/errors");
const dcCredentialLock = require("../lib/dc-credential-lock");
const { createDcLiveTransport, LIVE_APPROVAL_VALUE } = require("./adapters/dc-projectdox/live-transport");
const { ADAPTER_KEY: DC_KEY } = require("./adapters/dc-projectdox/normalize");
const {
  looksLikeEncryptedEnvelope,
  resolveStoredPortalPassword,
} = require("../app/services/portal-credentials/portal-credentials-crypto");

function syncMode(env) {
  return env.PERMIT_SYNC_MODE || "json";
}

/** PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS="11105,9187" narrows every claimed job to those DC ProjectIDs (D-074). */
function workerScope(env) {
  const raw = String(env.PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS || "").trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The pipeline functions compare the Bearer token with their SUPABASE_SERVICE_ROLE_KEY, which is the legacy
 * service_role JWT (D-075). An sb_secret_ key cannot be sent as a Bearer, so the agent trigger stays off for it.
 * @returns {"legacy_service_role_jwt"|"sb_secret"|"unknown"}
 */
function serviceKeyFormat(key) {
  const k = String(key || "");
  if (k.startsWith("sb_secret_")) return "sb_secret";
  if (k.startsWith("eyJ")) {
    try {
      const claims = JSON.parse(Buffer.from(k.split(".")[1] || "", "base64url").toString("utf8"));
      if (claims && claims.role === "service_role") return "legacy_service_role_jwt";
    } catch (_) {
      return "unknown";
    }
  }
  return "unknown";
}

function startupCheck(env) {
  if (env.PERMIT_SYNC_WORKER_ENABLED !== "true") return { ok: false, reason: "PERMIT_SYNC_WORKER_ENABLED is not true" };
  if (env.PERMIT_SYNC_LIVE_PORTAL_APPROVED !== LIVE_APPROVAL_VALUE) return { ok: false, reason: "live portal access not approved (A-3)" };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" };
  if (!env.PORTAL_CREDENTIALS_ENCRYPTION_KEY) return { ok: false, reason: "PORTAL_CREDENTIALS_ENCRYPTION_KEY missing" };
  if (!["json", "deep"].includes(syncMode(env))) return { ok: false, reason: `unknown PERMIT_SYNC_MODE ${env.PERMIT_SYNC_MODE}` };
  const scope = workerScope(env);
  if (scope && !scope.every((id) => /^[0-9]{1,12}$/.test(id))) return { ok: false, reason: "PERMIT_SYNC_ONLY_PORTAL_RECORD_IDS must be numeric DC ProjectIDs" };
  for (const k of ["PERMIT_SYNC_DEEP_MAX_FILES", "PERMIT_SYNC_DEEP_MAX_BYTES"]) {
    if (env[k] !== undefined && env[k] !== "" && !/^[0-9]+$/.test(String(env[k]))) return { ok: false, reason: `${k} must be a non-negative integer` };
  }
  return { ok: true, reason: "ok" };
}

/**
 * D-061 worker side: wait (retryable) while a manual DC scrape that may use the same login is active,
 * so the account is never logged in twice at once. Runs before any browser is launched.
 */
async function deferWhileManualScrape({ supabase, username, now = new Date() }) {
  const credentialIds = await dcCredentialLock.sameLoginCredentialIds(supabase, username);
  if (await dcCredentialLock.manualDcScrapeActive(supabase, { credentialIds, now })) {
    throw new TransientError("a manual DC scrape is using this portal login; deferred");
  }
}

/**
 * @param {{ supabase: any, env?: NodeJS.ProcessEnv, launchContext: Function, createTransport?: Function, log?: Function,
 *   lock?: Function, loadDcDeep?: Function, createDeepPass?: Function, pipeline?: object|null }} deps
 *   loadDcDeep / createDeepPass / pipeline are used in deep mode only
 */
function buildOpenAdapter({
  supabase, env = process.env, launchContext, createTransport = createDcLiveTransport, log = () => {},
  lock = deferWhileManualScrape, loadDcDeep = null, createDeepPass = null, pipeline = null,
}) {
  const mode = syncMode(env);
  return async function openAdapter(job) {
    if (job.adapter_key !== DC_KEY) throw new PortalChangedError(`no adapter registered for ${job.adapter_key}`);
    const cred = await supabase.from("portal_credentials").select("portal_username, portal_password").eq("id", job.credential_id).single();
    if (cred.error || !cred.data) throw new AuthError("credential not found");
    if (!looksLikeEncryptedEnvelope(cred.data.portal_password)) throw new AuthError("credential is not encrypted");
    const src = await supabase.from("permit_sync_sources").select("settings").eq("credential_id", job.credential_id).single();
    const settings = (src.data && src.data.settings) || {};
    let password;
    try {
      password = resolveStoredPortalPassword(cred.data.portal_password);
    } catch (_) {
      throw new AuthError("credential cannot be decrypted with the configured key");
    }
    const username = cred.data.portal_username;
    await lock({ supabase, username });
    const accountDownload = typeof settings.account_download === "boolean" ? settings.account_download : null;

    if (mode !== "deep") {
      const transport = await createTransport({ launchContext, username, password, env, log });
      return { adapter: createDcAdapter({ transport, accountDownload }), close: () => transport.close() };
    }

    const dcDeep = (loadDcDeep || require("./deep/app-loader").loadDcDeep)(env);
    const { withQuietConsole } = require("./deep/runner");
    const transport = await createTransport({
      launchContext,
      username,
      password,
      env,
      log,
      mode: "deep",
      // performLogin logs full URLs (OAuth state/code values); its output is dropped.
      login: (page) => withQuietConsole(() => dcDeep.performLogin(page, username, password, dcDeep.DEFAULT_DASHBOARD_URL)),
    });
    try {
      const makeDeepPass = createDeepPass || require("./deep/runner").createDeepPass;
      const { supabaseDeepRepo, supabaseDeepStorage } = require("./deep/repo");
      const deep = makeDeepPass({
        dcDeep, transport, repo: supabaseDeepRepo(supabase), storage: supabaseDeepStorage(supabase),
        pipeline, username, credentialId: job.credential_id, log, env,
      });
      return {
        adapter: createDcAdapter({ transport: deep.wrapTransport(transport), accountDownload }),
        afterPermit: deep.afterPermit,
        close: () => transport.close(),
      };
    } catch (err) {
      await transport.close().catch(() => {});
      throw err;
    }
  };
}

/** Deep mode accepts downloads: the manual file and report exports save through Playwright downloads. */
async function launchChromiumContext({ acceptDownloads = false } = {}) {
  const { launchChromiumForScraper } = require("../shared/playwright-launch-for-scraper.js");
  const browser = await launchChromiumForScraper({ label: "permit-sync-worker", route: "worker", file: "permit-sync/worker-entry.js" });
  const context = await browser.newContext({ acceptDownloads });
  return {
    context,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

async function main(env = process.env) {
  const check = startupCheck(env);
  if (!check.ok) {
    console.log(`[permit-sync] worker not started: ${check.reason}`);
    return 0;
  }
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const workerId = `${os.hostname()}:${process.pid}`;
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  const deep = syncMode(env) === "deep";
  let pipeline = null;
  const keyFormat = serviceKeyFormat(env.SUPABASE_SERVICE_ROLE_KEY);
  if (deep && env.PERMITPILOT_SERVICE_PIPELINE_SECRET && keyFormat !== "legacy_service_role_jwt") {
    console.log(`[permit-sync] agent trigger off: service key format ${keyFormat} is not accepted by the pipeline functions`);
  } else if (deep && env.PERMITPILOT_SERVICE_PIPELINE_SECRET) {
    const { createPipelineDriver } = require("./deep/pipeline");
    pipeline = createPipelineDriver({
      fetch: globalThis.fetch,
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      serviceSecret: env.PERMITPILOT_SERVICE_PIPELINE_SECRET,
      supabase,
    });
  }
  const scope = workerScope(env);
  const deepPolicy = require("./deep/policy");
  const limits = { ...deepPolicy.downloadLimits(env), ...deepPolicy.captureLimits(env) };
  console.log(`[permit-sync] mode=${deep ? "deep" : "json"} agent_trigger=${pipeline ? "on" : "off"} scope=${scope ? scope.join(",") : "all"}${deep ? ` max_files=${limits.maxFiles} max_bytes=${limits.maxBytes} max_file_bytes=${limits.maxFileBytes} max_attempts=${limits.maxAttempts}` : ""}`);
  await runLoop({
    rpc: supabaseWorkerRpc(supabase, { mode: deep ? "deep" : "json" }),
    scope,
    openAdapter: buildOpenAdapter({
      supabase,
      env,
      launchContext: () => launchChromiumContext({ acceptDownloads: deep }),
      pipeline,
      log: (e) => console.log(`[permit-sync] ${JSON.stringify({ code: e && e.code, step: e && e.step, state: e && e.state, at: e && e.at, blocked: e && e.blocked })}`),
    }),
    workerId,
    signal: controller.signal,
    // Supervised runs: claim at most one job, then exit, so a retry never logs in again unattended.
    once: env.PERMIT_SYNC_WORKER_ONCE === "true",
    onResult: (r) => {
      if (r && !r.idle) console.log(`[permit-sync] ${JSON.stringify({ job: r.jobId, outcome: r.outcome, code: r.code || null })}`);
    },
  });
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`[permit-sync] worker crashed: ${err && err.code ? err.code : "error"}`);
    process.exit(1);
  });
}

module.exports = { startupCheck, syncMode, workerScope, serviceKeyFormat, buildOpenAdapter, deferWhileManualScrape, main };
