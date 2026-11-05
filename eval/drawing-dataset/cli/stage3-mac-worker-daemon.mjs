#!/usr/bin/env node
/**
 * Always-on Mac Stage 3 watcher.
 *
 * Why the worker "stops": sync-full-set / loop are one-shot CLI processes — there is
 * no LaunchAgent by default. When the laptop sleeps or the terminal exits, OCR sync
 * stops and Stage 3 blocking runs sit at 0/82 forever.
 *
 * This daemon:
 *  1. Polls Supabase for Stage 3 full-coverage runs that are not terminal (configured projects, plus
 *     Supabase Analyzer V2 runs in any project)
 *  2. Runs sync-full-set --live --sync-supabase (uses local OCR cache; no re-OCR); Analyzer V2 runs
 *     use sync-run instead (every sheet of the run, 4x3 OCR, drawings outside the cache ingested)
 *  3. Heartbeats forever so new opted-in runs get packs without a manual terminal
 *
 * Env (loaded from repo .env + worker token file when missing):
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_ANON_KEY / VITE_SUPABASE_ANON_KEY
 *   STAGE3_WORKER_UPLOAD_TOKEN
 *   SUPABASE_SERVICE_ROLE_KEY (watch poll only — list incomplete Stage 3 runs)
 *   STAGE3_DAEMON_POLL_MS (default 60000)
 *   STAGE3_DAEMON_PROJECT_IDS (comma-separated; default McDonald's eval project)
 *   STAGE3_ALLOW_12X9 ("true" lets non-Analyzer-V2 runs opt into 12x9; default off)
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stage3ScopeArgs } from "../lib/stage3EvidenceConfig.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const datasetOut = path.resolve(root, "eval/drawing-dataset/out/mcd-649fdaa6");
const workerRoot = path.resolve(datasetOut, "stage3-mac-worker");
const workerCli = path.resolve(here, "stage3-mac-ocr-worker.mjs");
const logDir = path.join(workerRoot, "logs");
const logFile = path.join(logDir, "daemon.log");
const DEFAULT_PROJECT = "914c5b3c-87ff-4ba5-85d9-94e02db11bde";
const POLL_MS = Math.max(15_000, Number(process.env.STAGE3_DAEMON_POLL_MS || 60_000));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = value;
  }
}

function ensureEnv() {
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, "code-analyzer-worker/.env"));
  const tokenFile = path.join(workerRoot, ".stage3_worker_upload_token");
  if (!process.env.STAGE3_WORKER_UPLOAD_TOKEN && existsSync(tokenFile)) {
    process.env.STAGE3_WORKER_UPLOAD_TOKEN = readFileSync(tokenFile, "utf8").trim();
  }
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
}

function log(message, extra) {
  mkdirSync(logDir, { recursive: true });
  const line = `${new Date().toISOString()} ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}`;
  console.log(line);
  appendFileSync(logFile, `${line}\n`);
}

async function listBlockedStage3Runs(projectIds) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("watch_poll_requires_SUPABASE_URL_and_SUPABASE_SERVICE_ROLE_KEY");
  }
  // Configured projects (existing full-coverage runs) plus Supabase Analyzer V2 runs in any project.
  const filter = projectIds.map((id) => `"${id}"`).join(",");
  const scopeFilter = encodeURIComponent(`(project_id.in.(${filter}),analysis_scope->>analyzerVersion.eq.v2)`);
  const endpoint =
    `${url}/rest/v1/supabase_analyzer_runs`
    + `?select=id,project_id,status,analysis_scope,created_at`
    + `&or=${scopeFilter}`
    + `&status=in.(queued,processing,uploading)`
    + `&order=created_at.desc`
    + `&limit=20`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new Error(`list_runs_http_${response.status}`);
  }
  const rows = await response.json();
  return (rows || []).filter((row) => {
    const scope = row.analysis_scope || {};
    if (scope.stage3FullCoverageOcr !== true) return false;
    const prep = scope.stage3OcrPreprocess || {};
    return prep.terminal !== true;
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [workerCli, ...args], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function syncAnalyzerV2Run(projectId, runId) {
  log("sync_start", { projectId, runId, analyzerVersion: "v2", evidenceVersion: "v2", ocrGrid: "4x3" });
  const sync = await runCli(["sync-run", "--project", projectId, "--run", runId]);
  const tail = (sync.stdout || sync.stderr || "").slice(-1200);
  log("sync_done", { runId, analyzerVersion: "v2", code: sync.code, tail });
  return sync.code === 0;
}

async function syncRun(projectId, runId, scope = {}) {
  const {
    analyzerVersion, evidenceVersion, ocrGrid, syncArgs: versionArgs, buildArgs: gridArgs, ignored,
  } = stage3ScopeArgs(scope, { allowFineGrid: process.env.STAGE3_ALLOW_12X9 === "true" });
  for (const { event, value } of ignored) log(event, { runId, value, evidenceVersion });
  if (analyzerVersion === "v2") return syncAnalyzerV2Run(projectId, runId);
  log("sync_start", { projectId, runId, evidenceVersion, ocrGrid });
  const enqueue = await runCli([
    "enqueue-full",
    "--run", runId,
    "--project", projectId,
  ]);
  if (enqueue.code !== 0) {
    log("enqueue_failed", { runId, code: enqueue.code, stderr: enqueue.stderr.slice(-500) });
  }
  if (versionArgs.length) {
    const built = await runCli(["build-v2-packs", ...gridArgs]);
    if (built.code !== 0) {
      log("v2_build_incomplete", { runId, code: built.code, tail: (built.stdout || built.stderr || "").slice(-500) });
    }
  }
  const sync = await runCli([
    "sync-full-set",
    "--project", projectId,
    "--run", runId,
    "--live",
    "--sync-supabase",
    ...versionArgs,
  ]);
  const tail = (sync.stdout || sync.stderr || "").slice(-1200);
  log("sync_done", { runId, code: sync.code, tail });
  return sync.code === 0;
}

async function tick() {
  const projectIds = String(process.env.STAGE3_DAEMON_PROJECT_IDS || DEFAULT_PROJECT)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const blocked = await listBlockedStage3Runs(projectIds);
  if (!blocked.length) {
    log("idle_no_blocked_stage3_runs", { projectIds });
    return;
  }
  for (const run of blocked) {
    try {
      await syncRun(run.project_id, run.id, run.analysis_scope || {});
    } catch (error) {
      log("sync_error", { runId: run.id, error: String(error?.message || error) });
    }
  }
}

async function main() {
  ensureEnv();
  mkdirSync(logDir, { recursive: true });
  log("daemon_start", {
    pollMs: POLL_MS,
    workerCli,
    hasToken: Boolean(process.env.STAGE3_WORKER_UPLOAD_TOKEN),
    hasServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
  for (;;) {
    try {
      await tick();
    } catch (error) {
      log("tick_error", { error: String(error?.message || error) });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  log("fatal", { error: String(error?.message || error) });
  process.exit(1);
});
