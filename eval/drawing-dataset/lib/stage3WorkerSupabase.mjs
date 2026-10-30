/**
 * Outbound-only Supabase helpers for the Mac Stage 3 worker.
 * Never uses SUPABASE_SERVICE_ROLE_KEY.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { STAGE3_EVIDENCE_FUNCTION } from "./stage3StorageUpload.mjs";
import { toAnalysisScopePreprocessSummary } from "./stage3OcrRunState.mjs";

function baseUrl() {
  return String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
}

function workerAuthHeaders() {
  const workerToken = process.env.STAGE3_WORKER_UPLOAD_TOKEN?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!workerToken) {
    throw new Error("stage3_worker_token_required");
  }
  if (!anonKey) {
    throw new Error("supabase_anon_key_required");
  }
  return {
    Authorization: `Bearer ${workerToken}`,
    apikey: anonKey,
    "Content-Type": "application/json",
    "x-stage3-worker-token": workerToken,
  };
}

export async function syncRunPreprocessSummary(state, options = {}) {
  const url = baseUrl();
  if (!url || options.dryRun) {
    return { status: "skipped_local", summary: toAnalysisScopePreprocessSummary(state) };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = `${url}/functions/v1/${STAGE3_EVIDENCE_FUNCTION}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: workerAuthHeaders(),
    body: JSON.stringify({
      action: "sync_run_preprocess",
      projectId: state.projectId,
      runId: state.runId,
      preprocess: toAnalysisScopePreprocessSummary(state),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `sync_run_preprocess_http_${response.status}`);
  }
  return payload;
}

export async function listRunSheetJobs({ projectId, runId }, options = {}) {
  const url = baseUrl();
  if (!url) throw new Error("supabase_url_required");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = `${url}/functions/v1/${STAGE3_EVIDENCE_FUNCTION}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: workerAuthHeaders(),
    body: JSON.stringify({
      action: "list_sheet_jobs",
      projectId,
      runId,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `list_sheet_jobs_http_${response.status}`);
  }
  return payload.jobs || [];
}

export async function downloadSheetPdfToCache({
  projectId,
  runId,
  sheetJobId,
  relativePath,
  contentSha256,
  cacheRoot,
}, options = {}) {
  const url = baseUrl();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!url) throw new Error("supabase_url_required");
  const endpoint = `${url}/functions/v1/${STAGE3_EVIDENCE_FUNCTION}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: workerAuthHeaders(),
    body: JSON.stringify({
      action: "download_drawing",
      projectId,
      runId,
      sheetJobId,
      contentSha256,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `download_drawing_http_${response.status}`);
  }
  const bytes = Buffer.from(String(payload.base64 || ""), "base64");
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (contentSha256 && actualSha !== String(contentSha256).toLowerCase()) {
    throw new Error("download_drawing_sha_mismatch");
  }
  const dir = path.join(path.resolve(cacheRoot), "drawings", runId);
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, relativePath.split("/").join("__"));
  await writeFile(outPath, bytes);
  return { pdfPath: outPath, bytes: bytes.length, sha256: actualSha };
}

export async function verifyStoredPack({
  projectId,
  runId,
  sheetJobId,
  contentSha256,
}, options = {}) {
  const url = baseUrl();
  if (!url) throw new Error("supabase_url_required");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const endpoint = `${url}/functions/v1/${STAGE3_EVIDENCE_FUNCTION}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: workerAuthHeaders(),
    body: JSON.stringify({
      action: "verify_pack",
      projectId,
      runId,
      sheetJobId,
      contentSha256: String(contentSha256 || "").toLowerCase(),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    httpStatus: response.status,
    ok: response.ok && payload.ok === true,
    ...payload,
  };
}

/**
 * Map local manifest sheets to live sheet-job IDs by original file name.
 * Does not invent IDs — unmatched sheets are reported as missing.
 */
export function mapManifestSheetsToJobs(sheets, jobs) {
  const byName = new Map();
  for (const job of jobs || []) {
    const name = String(job.original_file_name || "").trim().toLowerCase();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(job);
  }
  const mapped = [];
  const unmatched = [];
  const ambiguous = [];
  for (const sheet of sheets || []) {
    const key = String(sheet.relativePath || "").trim().toLowerCase();
    const candidates = byName.get(key) || [];
    if (candidates.length === 1) {
      mapped.push({
        sheetId: sheet.id,
        relativePath: sheet.relativePath,
        contentSha256: sheet.sha256,
        sheetJobId: candidates[0].id,
        detectedSheetNumber: candidates[0].detected_sheet_number || null,
      });
    } else if (candidates.length === 0) {
      unmatched.push({ sheetId: sheet.id, relativePath: sheet.relativePath });
    } else {
      ambiguous.push({
        sheetId: sheet.id,
        relativePath: sheet.relativePath,
        jobIds: candidates.map((job) => job.id),
      });
    }
  }
  return { mapped, unmatched, ambiguous };
}
