/**
 * Full-set Stage 3 pack upload + server-side verify (no GPT).
 * Requires live run sheet-job IDs from list_sheet_jobs after analysis create.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadAuthoritativeDrawingManifest } from "./stage3DrawingManifest.mjs";
import { resolvePackPath, uploadLocalPackFile, buildStage3EvidenceObjectPath } from "./stage3StorageUpload.mjs";
import {
  listRunSheetJobs,
  mapManifestSheetsToJobs,
  syncRunPreprocessSummary,
  verifyStoredPack,
} from "./stage3WorkerSupabase.mjs";
import { loadRunState, saveRunState, setSheetStatus, toAnalysisScopePreprocessSummary } from "./stage3OcrRunState.mjs";

function normalizeBaseName(value) {
  return String(value || "").trim().toLowerCase();
}

export async function uploadAndVerifyFullSetPacks(options = {}) {
  const {
    workerRoot,
    datasetOut,
    projectId,
    runId,
    live = false,
    resume = true,
    dryRun = false,
    syncSupabase = true,
    maxSheets = null,
  } = options;

  if (!projectId || !runId) {
    throw new Error("projectId_and_runId_required");
  }

  const manifest = await loadAuthoritativeDrawingManifest(datasetOut);
  // Fetch live sheet-job IDs whenever --live is set (including --dry-run association checks).
  const jobs = live
    ? await listRunSheetJobs({ projectId, runId }, options)
    : (options.jobs || []);
  const association = mapManifestSheetsToJobs(manifest.sheets, jobs);
  if (association.unmatched.length || association.ambiguous.length) {
    return {
      status: "association_incomplete",
      pdfSheetCount: manifest.pdfSheetCount,
      jobCount: jobs.length,
      mapped: association.mapped.length,
      unmatched: association.unmatched,
      ambiguous: association.ambiguous,
      results: [],
    };
  }

  let targets = association.mapped;
  if (maxSheets != null) targets = targets.slice(0, Number(maxSheets));

  const results = [];
  for (const row of targets) {
    const packPath = resolvePackPath(workerRoot, row.sheetId, row.contentSha256);
    if (!existsSync(packPath)) {
      // Try basename variants used by older pack naming.
      const altNames = (await readdir(path.join(workerRoot, "packs")).catch(() => []))
        .filter((name) => name.endsWith(".json") && name.includes(row.contentSha256));
      if (!altNames.length) {
        results.push({
          ...row,
          status: "pack_missing_local",
          ocrCompleted: false,
          packStored: false,
          packRetrieved: false,
          promptReady: false,
        });
        continue;
      }
    }
    const resolvedPack = existsSync(packPath)
      ? packPath
      : path.join(workerRoot, "packs", (await readdir(path.join(workerRoot, "packs")))
        .find((name) => name.endsWith(".json") && name.includes(row.contentSha256)));

    if (dryRun || !live) {
      results.push({
        ...row,
        status: "dry_run_mapped",
        ocrCompleted: true,
        packStored: false,
        packRetrieved: false,
        promptReady: false,
        expectedPath: buildStage3EvidenceObjectPath({
          projectId,
          runId,
          sheetJobId: row.sheetJobId,
          contentSha256: row.contentSha256,
        }),
        packPath: resolvedPack,
      });
      continue;
    }

    if (resume) {
      const existing = await verifyStoredPack({
        projectId,
        runId,
        sheetJobId: row.sheetJobId,
        contentSha256: row.contentSha256,
      }, options);
      if (existing.ok) {
        results.push({
          ...row,
          status: "already_stored_verified",
          ocrCompleted: true,
          packStored: true,
          packRetrieved: true,
          promptReady: Boolean(existing.promptReady),
          objectPath: existing.objectPath,
          bytes: existing.bytes,
          packStatus: existing.packStatus,
        });
        continue;
      }
    }

    const uploaded = await uploadLocalPackFile({
      viaEdge: true,
      packPath: resolvedPack,
      projectId,
      runId,
      sheetJobId: row.sheetJobId,
      contentSha256: row.contentSha256,
    });
    const verified = await verifyStoredPack({
      projectId,
      runId,
      sheetJobId: row.sheetJobId,
      contentSha256: row.contentSha256,
    }, options);
    results.push({
      ...row,
      status: verified.ok ? "uploaded_and_verified" : "uploaded_verify_failed",
      ocrCompleted: true,
      packStored: true,
      packRetrieved: Boolean(verified.ok),
      promptReady: Boolean(verified.promptReady),
      objectPath: uploaded.objectPath || verified.objectPath,
      bytes: uploaded.bytes,
      packStatus: verified.packStatus || null,
      verifyError: verified.ok ? null : (verified.error || verified.issue || "verify_failed"),
    });
  }

  const state = (await loadRunState(workerRoot, runId)) || null;
  if (state) {
    for (const row of results) {
      if (!row.relativePath) continue;
      setSheetStatus(state, row.relativePath, {
        sheetJobId: row.sheetJobId,
        status: row.packRetrieved ? "completed" : (row.status === "pack_missing_local" ? "failed" : "completed"),
        packStatus: row.packStatus || (row.packRetrieved ? "evidence_recovered" : null),
        contentSha256: row.contentSha256,
      });
    }
    state.projectId = projectId;
    state.macWorkerLastHeartbeat = new Date().toISOString();
    await saveRunState(workerRoot, state);
    if (live && syncSupabase && !dryRun) {
      await syncRunPreprocessSummary(state, options);
    }
  }

  const summary = {
    status: "ok",
    pdfSheetCount: manifest.pdfSheetCount,
    jobCount: jobs.length,
    attempted: results.length,
    ocrCompleted: results.filter((row) => row.ocrCompleted).length,
    packStored: results.filter((row) => row.packStored).length,
    packRetrieved: results.filter((row) => row.packRetrieved).length,
    promptReady: results.filter((row) => row.promptReady).length,
    failed: results.filter((row) => !row.packRetrieved && row.status !== "dry_run_mapped").length,
    preprocess: state ? toAnalysisScopePreprocessSummary(state) : null,
    results,
  };
  return summary;
}

export function findLocalPackBySha(workerRoot, contentSha256) {
  const packsDir = path.join(workerRoot, "packs");
  if (!existsSync(packsDir)) return null;
  // Sync helper kept tiny for CLI; async callers should use uploadAndVerifyFullSetPacks.
  return { packsDir, contentSha256: normalizeBaseName(contentSha256) };
}
