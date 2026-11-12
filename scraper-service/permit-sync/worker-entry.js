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
 *
 * Starting the worker never enqueues anything: it only claims jobs that a user, Sync now or the schedule queued.
 * Operations (D-097, D-098): one JSON log line per event; a liveness row in permit_sync_workers every
 * PERMIT_SYNC_WORKER_HEARTBEAT_MS; GET /health on PERMIT_SYNC_HEALTH_PORT (or PORT) when set; SIGTERM / SIGINT
 * stop claiming, ask the running pass to stop, and release the job (attempt given back) before exiting.
 * Tunables: PERMIT_SYNC_LEASE_TTL_SECONDS (300), PERMIT_SYNC_IDLE_MS (60000), PERMIT_SYNC_PERMIT_PAUSE_MS (0),
 * PERMIT_SYNC_DEEP_MAX_FILES / _MAX_BYTES / _MAX_FILE_BYTES / _MAX_ATTEMPTS (deep/policy.js).
 */

const os = require("node:os");
const { runLoop, supabaseWorkerRpc } = require("./core/worker");
const { AuthError, PortalChangedError } = require("./core/errors");
const { createDcAdapter } = require("./adapters/dc-projectdox/adapter");
const { DeferredError } = require("./core/errors");
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
  for (const k of ["PERMIT_SYNC_DEEP_MAX_FILES", "PERMIT_SYNC_DEEP_MAX_BYTES", "PERMIT_SYNC_LEASE_TTL_SECONDS", "PERMIT_SYNC_IDLE_MS",
    "PERMIT_SYNC_PERMIT_PAUSE_MS", "PERMIT_SYNC_WORKER_HEARTBEAT_MS", "PERMIT_SYNC_HEALTH_PORT"]) {
    if (env[k] !== undefined && env[k] !== "" && !/^[0-9]+$/.test(String(env[k]))) return { ok: false, reason: `${k} must be a non-negative integer` };
  }
  return { ok: true, reason: "ok" };
}

/**
 * D-061 worker side: hand the job back (no attempt spent, D-098) while a manual DC scrape that may use the
 * same login is active, so the account is never logged in twice at once. Runs before any browser is launched.
 */
async function deferWhileManualScrape({ supabase, username, now = new Date() }) {
  const credentialIds = await dcCredentialLock.sameLoginCredentialIds(supabase, username);
  if (await dcCredentialLock.manualDcScrapeActive(supabase, { credentialIds, now })) {
    throw new DeferredError("a manual DC scrape is using this portal login; deferred");
  }
}

/** Positive integer env value, or the fallback. */
function intEnv(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** One JSON line per event; callers pass codes, ids and counts only (no credentials, URLs or page text). */
function createLogger(write = (line) => console.log(line)) {
  return (level, event, fields = {}) => write(JSON.stringify({ ts: new Date().toISOString(), level, svc: "permit-sync-worker", event, ...fields }));
}

/**
 * Worker state for /health and the liveness row. Healthy while the loop is running and has made progress
 * (claimed, idled or finished a job) within staleMs; a job in progress counts as progress.
 */
function createWorkerState({ now = Date.now, staleMs }) {
  const st = { status: "starting", jobId: null, lastTickAt: now(), startedAt: now(), jobsRun: 0, lastOutcome: null };
  return {
    get: () => ({ ...st }),
    tick(patch = {}) { Object.assign(st, patch, { lastTickAt: now() }); },
    healthy() {
      if (st.status === "stopped") return false;
      if (st.status === "busy") return true;
      return now() - st.lastTickAt < staleMs;
    },
  };
}

function startHealthServer({ port, state, log }) {
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404).end();
      return;
    }
    const s = state.get();
    const ok = state.healthy();
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, status: s.status, job: s.jobId, jobs_run: s.jobsRun, last_tick_at: new Date(s.lastTickAt).toISOString() }));
  });
  server.listen(port, () => log("info", "health_listening", { port }));
  return server;
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
  const log = createLogger();
  const check = startupCheck(env);
  if (!check.ok) {
    log("warn", "worker_not_started", { reason: check.reason });
    return 0;
  }
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const workerId = `${os.hostname()}:${process.pid}`;
  const controller = new AbortController();
  const deep = syncMode(env) === "deep";
  const mode = deep ? "deep" : "json";
  const leaseTtlSeconds = intEnv(env, "PERMIT_SYNC_LEASE_TTL_SECONDS", 300);
  const idleMs = intEnv(env, "PERMIT_SYNC_IDLE_MS", 60000);
  const pauseMs = intEnv(env, "PERMIT_SYNC_PERMIT_PAUSE_MS", 0);
  const beatMs = intEnv(env, "PERMIT_SYNC_WORKER_HEARTBEAT_MS", 30000);
  const state = createWorkerState({ staleMs: Math.max(idleMs * 3, 5 * 60 * 1000) });
  const onSignal = (sig) => {
    if (controller.signal.aborted) return;
    log("info", "shutdown_requested", { signal: sig, job: state.get().jobId });
    state.tick({ status: "stopping" });
    controller.abort();
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  let pipeline = null;
  const keyFormat = serviceKeyFormat(env.SUPABASE_SERVICE_ROLE_KEY);
  if (deep && env.PERMITPILOT_SERVICE_PIPELINE_SECRET && keyFormat !== "legacy_service_role_jwt") {
    log("warn", "agent_trigger_off", { reason: `service key format ${keyFormat} is not accepted by the pipeline functions` });
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
  const details = {
    version: env.RAILWAY_GIT_COMMIT_SHA ? String(env.RAILWAY_GIT_COMMIT_SHA).slice(0, 12) : null,
    agent_trigger: Boolean(pipeline),
    scope: scope ? scope.length : "all",
    limits: deep ? { max_files: limits.maxFiles, max_bytes: limits.maxBytes, max_file_bytes: limits.maxFileBytes, max_attempts: limits.maxAttempts } : null,
    lease_ttl_seconds: leaseTtlSeconds,
  };
  log("info", "worker_started", { worker: workerId, mode, ...details });

  const rpc = supabaseWorkerRpc(supabase, { mode });
  const beat = async () => {
    const s = state.get();
    const rssMb = Math.round(process.memoryUsage().rss / 1048576);
    await rpc.workerBeat(workerId, s.status === "starting" ? "idle" : s.status, s.jobId, { ...details, rss_mb: rssMb, jobs_run: s.jobsRun, last_outcome: s.lastOutcome })
      .catch((err) => log("warn", "worker_heartbeat_failed", { error: String((err && err.message) || err).slice(0, 200) }));
  };
  const beatTimer = setInterval(() => { void beat(); }, beatMs);
  if (typeof beatTimer.unref === "function") beatTimer.unref();
  const healthPort = Number(env.PERMIT_SYNC_HEALTH_PORT || env.PORT || 0);
  const health = healthPort > 0 ? startHealthServer({ port: healthPort, state, log }) : null;
  state.tick({ status: "idle" });
  await beat();

  try {
    await runLoop({
      rpc,
      scope,
      leaseTtlSeconds,
      idleMs,
      pauseMs,
      openAdapter: buildOpenAdapter({
        supabase,
        env,
        launchContext: () => launchChromiumContext({ acceptDownloads: deep }),
        pipeline,
        log: (e) => log("info", "transport", { code: e && e.code, step: e && e.step, state: e && e.state, at: e && e.at, blocked: e && e.blocked }),
      }),
      workerId,
      signal: controller.signal,
      // Supervised runs: claim at most one job, then exit, so a retry never logs in again unattended.
      once: env.PERMIT_SYNC_WORKER_ONCE === "true",
      onClaim: (job) => {
        state.tick({ status: "busy", jobId: job.id });
        log("info", "job_claimed", { job: job.id, attempt: job.attempt_count, trigger: job.trigger, scope: job.options && job.options.only_portal_record_ids ? job.options.only_portal_record_ids.length : "all" });
        void beat();
      },
      onResult: (r) => {
        const s = state.get();
        if (r && !r.idle) {
          log(r.outcome === "completed" || r.outcome === "released" ? "info" : "warn", "job_finished", { job: r.jobId, outcome: r.outcome, code: r.code || null, permits_ok: r.metrics && r.metrics.permits_ok, permits_failed: r.metrics && r.metrics.permits_failed, duration_ms: r.metrics && r.metrics.duration_ms });
          state.tick({ status: controller.signal.aborted ? "stopping" : "idle", jobId: null, jobsRun: s.jobsRun + 1, lastOutcome: r.outcome });
          void beat();
        } else {
          if (r && r.error) log("warn", "claim_failed", { error: r.error });
          state.tick({ status: controller.signal.aborted ? "stopping" : "idle" });
        }
      },
    });
  } finally {
    clearInterval(beatTimer);
    state.tick({ status: "stopped", jobId: null });
    await rpc.workerBeat(workerId, "stopped", null, details).catch(() => {});
    if (health) health.close();
    log("info", "worker_stopped", { worker: workerId });
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`[permit-sync] worker crashed: ${err && err.code ? err.code : "error"}`);
    process.exit(1);
  });
}

module.exports = { startupCheck, syncMode, workerScope, serviceKeyFormat, buildOpenAdapter, deferWhileManualScrape, createLogger, createWorkerState, startHealthServer, intEnv, main };
