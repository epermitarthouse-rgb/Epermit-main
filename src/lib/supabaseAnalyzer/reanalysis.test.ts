import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzerActionPresentation } from "../../../supabase/functions/_shared/analyzerSheetUpdate.ts";
import {
  cancelQueuedReanalysis,
  commitReanalysis,
  isObjectPathConflict,
  materializeReanalysis,
  missingStorageMessage,
  planReanalysis,
  reanalysisConfirmationCopy,
  reanalysisRequestKey,
  reanalysisStoredObjectPath,
  reanalyzeControls,
  ReanalysisSubmitLock,
  rewriteReuseObjectPaths,
  shouldRemoveStoredDrawing,
  splitStorageObjectPath,
  type ReanalysisStore,
  type ReanalysisStoreFinding,
  type ReanalysisStoreJob,
} from "../../../supabase/functions/_shared/analyzerReanalysis.ts";

const SOURCE_RUN = "run-source";
const PROJECT = "project-1";

function sheet(index: number, status = "completed"): ReanalysisStoreJob {
  const number = index + 1;
  const label = `A-${String(number).padStart(3, "0")}`;
  return {
    id: `job-${number}`,
    run_id: SOURCE_RUN,
    ordinal: number,
    original_file_name: `${label}.pdf`,
    file_size: 2048,
    detected_sheet_number: label,
    detected_sheet_title: `Sheet ${number}`,
    discipline: "Architectural",
    status,
    object_path: `${PROJECT}/${SOURCE_RUN}/${number}.pdf`,
  };
}

function findingsFor(jobs: readonly ReanalysisStoreJob[], count: number): ReanalysisStoreFinding[] {
  const saved = jobs.filter((job) => job.status !== "cancelled");
  return Array.from({ length: count }, (_, index) => ({
    id: `finding-${index + 1}`,
    run_id: SOURCE_RUN,
    sheet_job_id: saved[index % saved.length].id,
    is_published: true,
  }));
}

function makeStore(
  jobs: ReanalysisStoreJob[],
  findings: ReanalysisStoreFinding[],
  analysisMode: string | null = null,
): ReanalysisStore {
  return {
    runs: [{
      id: SOURCE_RUN,
      project_id: PROJECT,
      status: "completed",
      analysis_mode: analysisMode,
      total_sheets: jobs.filter((job) => job.status !== "cancelled").length,
    }],
    jobs,
    findings,
    commits: new Map(),
  };
}

function sourceFingerprint(store: ReanalysisStore) {
  return JSON.stringify({
    run: store.runs.find((run) => run.id === SOURCE_RUN),
    jobs: store.jobs.filter((job) => job.run_id === SOURCE_RUN),
    findings: store.findings.filter((finding) => finding.run_id === SOURCE_RUN),
  });
}

function commit(
  store: ReanalysisStore,
  plan: ReturnType<typeof planReanalysis>,
  options?: { analysisMode?: unknown; requestId?: string; runId?: string },
) {
  let next = 0;
  return commitReanalysis(store, plan, {
    requestId: options?.requestId ?? "request-1",
    runId: options?.runId ?? "run-new",
    projectId: PROJECT,
    analysisMode: options && "analysisMode" in options ? options.analysisMode : "local_only",
    createJobId: () => {
      next += 1;
      return `new-job-${next}`;
    },
  });
}

describe("Supabase analyzer reanalysis", () => {
  it("reanalyzes one saved sheet from its storage path without a new upload or source changes", () => {
    const jobs = [sheet(0), sheet(1)];
    const findings = findingsFor(jobs, 4);
    const store = makeStore(jobs, findings, null);
    const before = sourceFingerprint(store);
    const sourceJob = store.jobs[0];
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: [sourceJob.id],
      incoming: [],
      confirmed: true,
      storageExists: () => true,
    });
    assert.equal(plan.accepted, true);
    assert.equal(plan.reuseCount, 1);
    assert.equal(plan.uploadCount, 0);
    assert.equal(plan.items[0]?.objectPath, sourceJob.object_path);
    assert.match(
      reanalysisConfirmationCopy(plan, "selected").intro,
      /1 saved drawing will be reanalyzed\. A new analysis will be created\. The current run will be kept\./,
    );

    const result = commit(store, plan, { analysisMode: "local_only" });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.uploads.length, 0);
    assert.equal(result.queued, 1);
    assert.equal(result.runId, "run-new");
    assert.notEqual(result.runId, SOURCE_RUN);

    const created = store.jobs.filter((job) => job.run_id === result.runId);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.status, "queued");
    assert.equal(created[0]?.object_path, sourceJob.object_path);
    assert.equal(store.jobs[0], sourceJob);
    assert.equal(sourceJob.status, "completed");
    assert.equal(sourceFingerprint(store), before);
    assert.equal(store.runs[0]?.analysis_mode, null);
    assert.equal(store.runs.find((run) => run.id === result.runId)?.analysis_mode, "local_only");
    assert.equal(store.findings, findings);
    assert.equal(store.findings.length, 4);
  });

  it("reanalyzes all 82 occupying sheets as a new run and keeps 396 source findings", () => {
    const jobs = Array.from({ length: 82 }, (_, index) => sheet(index));
    jobs.push(sheet(82, "cancelled"));
    const findings = findingsFor(jobs, 396);
    const store = makeStore(jobs, findings, null);
    const before = sourceFingerprint(store);
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      confirmed: true,
      storageExists: () => true,
    });
    assert.equal(plan.accepted, true);
    assert.equal(plan.reuseCount, 82);
    assert.equal(plan.uploadCount, 0);
    assert.equal(plan.totalSheets, 82);
    assert.equal(plan.items.some((item) => item.objectPath?.endsWith("/cancelled.pdf") || item.objectPath?.endsWith("/83.pdf")), false);
    for (const item of plan.items) {
      const source = jobs.find((job) => job.id === item.sourceJobId);
      assert.equal(item.objectPath, source?.object_path);
      assert.notEqual(source?.status, "cancelled");
    }
    assert.match(reanalysisConfirmationCopy(plan, "all").intro, /82 saved drawings will be reanalyzed/);
    assert.match(reanalysisConfirmationCopy(plan, "all").intro, /A new analysis will be created/);
    assert.match(reanalysisConfirmationCopy(plan, "all").intro, /The current run will be kept/);
    const occupyingPaths = jobs
      .filter((job) => job.status !== "cancelled")
      .map((job) => job.object_path);

    const result = commit(store, plan, { analysisMode: "both" });
    assert.equal(result.uploads.length, 0);
    assert.equal(result.queued, 82);
    const created = store.jobs.filter((job) => job.run_id === result.runId);
    assert.equal(created.length, 82);
    assert.equal(created.every((job) => job.status === "queued"), true);
    assert.deepEqual(created.map((job) => job.object_path), occupyingPaths);
    assert.equal(sourceFingerprint(store), before);
    assert.equal(store.findings.length, 396);
    assert.equal(store.findings.every((finding) => finding.run_id === SOURCE_RUN && finding.is_published), true);
    assert.equal(store.runs.find((run) => run.id === SOURCE_RUN)?.analysis_mode, null);
    assert.equal(store.runs.find((run) => run.id === result.runId)?.analysis_mode, "both");
  });

  it("combines selected reanalysis with a new PDF and a replacement without double-counting", () => {
    const jobs = [
      sheet(0),
      { ...sheet(1), detected_sheet_number: "S-201", original_file_name: "S-201.pdf", object_path: `${PROJECT}/${SOURCE_RUN}/s-201.pdf` },
    ];
    const store = makeStore(jobs, findingsFor(jobs, 2));
    const before = sourceFingerprint(store);
    const preview = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: jobs.map((job) => job.id),
      incoming: [
        { name: "A-001-rev.pdf", size: 4096, type: "application/pdf" },
        { name: "B-200.pdf", size: 3072, type: "application/pdf" },
      ],
      confirmed: false,
      storageExists: () => true,
    });
    assert.equal(preview.needsConfirmation, true);
    assert.equal(preview.accepted, false);
    assert.equal(commit(store, preview).ok, false);
    assert.equal(store.runs.length, 1);

    const replacement = preview.items.find((item) => item.fileName === "A-001-rev.pdf");
    assert.equal(replacement?.replaceJobId, jobs[0]?.id);
    const confirmed = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: jobs.map((job) => job.id),
      incoming: [
        { name: "A-001-rev.pdf", size: 4096, type: "application/pdf", replaceJobId: jobs[0]?.id },
        { name: "B-200.pdf", size: 3072, type: "application/pdf" },
      ],
      confirmed: true,
      storageExists: () => true,
    });
    assert.equal(confirmed.accepted, true);
    assert.equal(confirmed.reuseCount, 1);
    assert.equal(confirmed.uploadCount, 2);
    assert.equal(confirmed.added, 1);
    assert.equal(confirmed.replaced, 1);
    assert.equal(confirmed.totalSheets, 3);
    assert.equal(confirmed.items.some((item) => item.action === "reuse" && item.objectPath === jobs[0]?.object_path), false);
    assert.equal(confirmed.items.some((item) => item.action === "reuse" && item.objectPath === jobs[1]?.object_path), true);

    const result = commit(store, confirmed, { analysisMode: "ibc_only" });
    assert.equal(result.ok, true);
    assert.equal(result.uploads.length, 2);
    assert.equal(result.queued, 1);
    const created = store.jobs.filter((job) => job.run_id === result.runId);
    assert.equal(created.filter((job) => job.status === "upload_pending").length, 2);
    assert.equal(created.filter((job) => job.status === "queued").length, 1);
    assert.equal(sourceFingerprint(store), before);
    assert.equal(store.runs.find((run) => run.id === SOURCE_RUN)?.analysis_mode, null);
    assert.equal(store.runs.find((run) => run.id === result.runId)?.analysis_mode, "ibc_only");
  });

  it("rejects a missing storage object and does not queue any sheet", () => {
    const jobs = [sheet(0), sheet(1)];
    const store = makeStore(jobs, findingsFor(jobs, 2));
    const before = sourceFingerprint(store);
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      confirmed: true,
      storageExists: (objectPath) => objectPath !== jobs[1]?.object_path,
    });
    assert.equal(plan.accepted, false);
    assert.equal(plan.missing.length, 1);
    assert.equal(plan.missing[0]?.fileName, jobs[1]?.original_file_name);
    assert.match(plan.error || "", /were not queued/);
    assert.match(plan.error || "", /A-002/);
    assert.equal(missingStorageMessage(plan.missing), plan.error);
    const result = commit(store, plan);
    assert.equal(result.ok, false);
    assert.equal(result.created, false);
    assert.equal(result.queued, 0);
    assert.equal(store.runs.length, 1);
    assert.equal(store.jobs.every((job) => job.status === "completed"), true);
    assert.equal(sourceFingerprint(store), before);
  });

  it("does not create a second run when the same request is submitted twice", () => {
    const jobs = [sheet(0)];
    const store = makeStore(jobs, []);
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      confirmed: true,
      storageExists: () => true,
    });
    const lock = new ReanalysisSubmitLock();
    assert.equal(lock.tryAcquire(), true);
    assert.equal(lock.tryAcquire(), false);
    const first = commit(store, plan, { requestId: "same-request", runId: "run-new" });
    const second = commit(store, plan, { requestId: "same-request", runId: "run-new" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.runId, first.runId);
    assert.equal(store.runs.filter((run) => run.id !== SOURCE_RUN).length, 1);
    assert.equal(store.jobs.filter((job) => job.run_id === "run-new").length, 1);
    lock.release();
    assert.equal(lock.tryAcquire(), true);
    assert.equal(
      reanalysisRequestKey({
        sourceRunId: SOURCE_RUN,
        scope: "selected",
        jobIds: ["job-2", "job-1"],
        files: [],
        analysisMode: "both",
      }),
      reanalysisRequestKey({
        sourceRunId: SOURCE_RUN,
        scope: "selected",
        jobIds: ["job-1", "job-2"],
        files: [],
        analysisMode: "both",
      }),
    );
  });

  it("enforces the 100-sheet limit and lets a replacement keep the same count", () => {
    const jobs = Array.from({ length: 100 }, (_, index) => sheet(index));
    const tooMany = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      incoming: [{ name: "extra.pdf", size: 1024, type: "application/pdf" }],
      confirmed: true,
      storageExists: () => true,
    });
    assert.equal(tooMany.accepted, false);
    assert.match(tooMany.error || "", /100/);
    const store = makeStore(jobs, []);
    assert.equal(commit(store, tooMany).created, false);
    assert.equal(store.runs.length, 1);

    const replacement = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      incoming: [{ name: "A-001-rev.pdf", size: 4096, type: "application/pdf", replaceJobId: "job-1" }],
      confirmed: true,
      storageExists: () => true,
    });
    assert.equal(replacement.accepted, true);
    assert.equal(replacement.totalSheets, 100);
    assert.equal(replacement.reuseCount, 99);
    assert.equal(replacement.uploadCount, 1);
    assert.equal(replacement.items.some((item) => item.action === "reuse" && item.sourceJobId === "job-1"), false);
  });

  it("keeps a legacy source mode unchanged and cancels only the new run", () => {
    const jobs = [sheet(0), sheet(1), sheet(2)];
    const findings = findingsFor(jobs, 6);
    const store = makeStore(jobs, findings, null);
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: [jobs[0].id, jobs[1].id],
      confirmed: true,
      storageExists: () => true,
    });
    const invalid = commit(makeStore(jobs, findings, "ibc_only"), plan, { analysisMode: "sideways", requestId: "bad-mode" });
    assert.equal(invalid.ok, false);
    const result = commit(store, plan, { analysisMode: undefined, requestId: "mode-default" });
    assert.equal(store.runs.find((run) => run.id === SOURCE_RUN)?.analysis_mode, null);
    assert.equal(store.runs.find((run) => run.id === result.runId)?.analysis_mode, "both");

    const sourceJobs = store.jobs.filter((job) => job.run_id === SOURCE_RUN);
    const cancelled = cancelQueuedReanalysis(store, result.runId || "");
    assert.equal(store.runs.find((run) => run.id === SOURCE_RUN)?.status, "completed");
    assert.equal(store.runs.find((run) => run.id === result.runId)?.status, "cancelled");
    assert.deepEqual(
      cancelled.cancelledJobIds,
      store.jobs.filter((job) => job.run_id === result.runId).map((job) => job.id),
    );
    for (const job of store.jobs.filter((job) => job.run_id === result.runId)) {
      assert.equal(job.status, "cancelled");
      assert.equal(job.error_code, "run_cancelled");
    }
    for (const job of sourceJobs) {
      assert.equal(job.status, "completed");
      assert.equal(cancelled.cancelledJobIds.includes(job.id), false);
    }
    assert.equal(store.findings.every((finding) => finding.is_published && finding.run_id === SOURCE_RUN), true);
  });

  it("copies a reused object onto a unique key when the source key cannot be stored twice", () => {
    const jobs = [sheet(0)];
    const plan = planReanalysis({
      sourceRunId: SOURCE_RUN,
      jobs,
      selectedJobIds: "all",
      confirmed: true,
      storageExists: () => true,
    });
    let next = 0;
    const materialized = materializeReanalysis(plan, {
      runId: "run-new",
      projectId: PROJECT,
      analysisMode: "both",
      createJobId: () => `copy-job-${next += 1}`,
      reuseSourceKey: true,
    });
    assert.equal(materialized.ok, true);
    if (!materialized.ok) return;
    assert.equal(materialized.value.jobs[0]?.object_path, jobs[0]?.object_path);
    assert.equal(materialized.value.uploads.length, 0);
    const rewritten = rewriteReuseObjectPaths(materialized.value.jobs, PROJECT, "run-new");
    assert.equal(rewritten.copies.length, 1);
    assert.equal(rewritten.copies[0]?.from, jobs[0]?.object_path);
    assert.equal(rewritten.jobs[0]?.source_object_path, jobs[0]?.object_path);
    assert.notEqual(rewritten.jobs[0]?.object_path, jobs[0]?.object_path);
    assert.equal(rewritten.jobs[0]?.status, "queued");
    assert.equal(
      reanalysisStoredObjectPath({
        action: "reuse",
        sourceObjectPath: jobs[0]?.object_path || null,
        projectId: PROJECT,
        runId: "run-new",
        jobId: "copy-job-1",
        reuseSourceKey: false,
      }),
      rewritten.jobs[0]?.object_path,
    );
    assert.equal(isObjectPathConflict({
      code: "23505",
      message: 'duplicate key value violates unique constraint "supabase_analyzer_sheet_jobs_object_path_key"',
    }), true);
    assert.equal(isObjectPathConflict({ code: "23505", message: "duplicate run id" }), false);
    assert.equal(shouldRemoveStoredDrawing(0), true);
    assert.equal(shouldRemoveStoredDrawing(1), false);
    assert.deepEqual(splitStorageObjectPath(jobs[0]?.object_path || ""), {
      prefix: `${PROJECT}/${SOURCE_RUN}`,
      name: "1.pdf",
    });
  });

  it("disables reanalysis controls while submitting, processing, or cancelling", () => {
    const idle = reanalyzeControls({
      hasProject: true,
      runStatus: "completed",
      occupyingCount: 82,
      selectedCount: 1,
      submitting: false,
      cancelling: false,
    });
    assert.equal(idle.selectedDisabled, false);
    assert.equal(idle.allDisabled, false);
    assert.equal(idle.selectionDisabled, false);

    for (const input of [
      { submitting: true, cancelling: false, runStatus: "completed" },
      { submitting: false, cancelling: true, runStatus: "processing" },
      { submitting: false, cancelling: false, runStatus: "processing" },
      { submitting: false, cancelling: false, runStatus: "queued" },
      { submitting: false, cancelling: false, runStatus: "uploading" },
    ]) {
      const controls = reanalyzeControls({
        hasProject: true,
        occupyingCount: 82,
        selectedCount: 2,
        ...input,
      });
      assert.equal(controls.selectedDisabled, true);
      assert.equal(controls.allDisabled, true);
      assert.equal(controls.selectionDisabled, true);
    }

    const noneSelected = reanalyzeControls({
      hasProject: true,
      runStatus: "completed",
      occupyingCount: 82,
      selectedCount: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(noneSelected.selectedDisabled, true);
    assert.equal(noneSelected.allDisabled, false);

    const updateWithoutFiles = analyzerActionPresentation({
      hasProject: true,
      hasRun: true,
      runStatus: "completed",
      fileCount: 0,
      selectedSheetCount: 1,
      failedSheets: 0,
      submitting: false,
      cancelling: false,
    });
    assert.equal(updateWithoutFiles.primaryDisabled, false);
    assert.equal(updateWithoutFiles.primaryLabel, "Update Analysis");
  });
});
