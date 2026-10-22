import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzerSelectionSignature,
  analyzerSubmissionAction,
  analyzerSubmissionPlan,
  clearPendingAnalyzerSheets,
  describeSelectionNotices,
  failedUploadDescriptors,
  mergePendingAnalyzerSheets,
  removePendingAnalyzerSheet,
  retainPendingSelectionForProject,
  type AnalyzerSheetFile,
  type AnalyzerUploadDescriptor,
} from "./pendingSelection.ts";

const MB = 1024 * 1024;

function sheet(name: string, size = 1024, type = "application/pdf"): AnalyzerSheetFile {
  return { name, size, type };
}

function batch(start: number, count: number): AnalyzerSheetFile[] {
  return Array.from({ length: count }, (_, index) => sheet(`sheet-${start + index}.pdf`));
}

describe("Supabase analyzer pending selection", () => {
  it("retains the first batch of 8 sheets", () => {
    const merged = mergePendingAnalyzerSheets([], batch(1, 8));
    assert.equal(merged.files.length, 8);
    assert.equal(merged.added.length, 8);
    assert.deepEqual(merged.notices, []);
  });

  it("appends a second batch of 20 to reach 28", () => {
    const first = mergePendingAnalyzerSheets([], batch(1, 8));
    const second = mergePendingAnalyzerSheets(first.files, batch(9, 20));
    assert.equal(second.files.length, 28);
    assert.equal(second.files[0].name, "sheet-1.pdf");
    assert.equal(second.files[27].name, "sheet-28.pdf");
  });

  it("appends a third batch of 54 to reach 82", () => {
    const first = mergePendingAnalyzerSheets([], batch(1, 8));
    const second = mergePendingAnalyzerSheets(first.files, batch(9, 20));
    const third = mergePendingAnalyzerSheets(second.files, batch(29, 54));
    assert.equal(third.files.length, 82);
    assert.equal(new Set(third.files.map((file) => file.name)).size, 82);
  });

  it("does not add duplicates from a later selection round", () => {
    const first = mergePendingAnalyzerSheets([], batch(1, 8));
    const second = mergePendingAnalyzerSheets(first.files, [
      sheet("sheet-1.pdf"),
      sheet(" Sheet-2.PDF "),
      sheet("sheet-9.pdf"),
    ]);
    assert.equal(second.files.length, 9);
    assert.equal(second.notices.filter((notice) => notice.code === "duplicate").length, 2);
  });

  it("leaves the count unchanged when the same files are selected again", () => {
    const first = mergePendingAnalyzerSheets([], batch(1, 8));
    const again = mergePendingAnalyzerSheets(first.files, first.files);
    assert.equal(again.files.length, 8);
    assert.equal(again.added.length, 0);
    assert.equal(again.notices.length, 8);
    assert.match(describeSelectionNotices(again.notices) || "", /already selected/);
  });

  it("appends a dropped batch with the same merge used by the file picker", () => {
    const picked = mergePendingAnalyzerSheets([], batch(1, 8));
    const dropped = mergePendingAnalyzerSheets(picked.files, batch(9, 4));
    assert.equal(dropped.files.length, 12);
    assert.deepEqual(dropped.added.map((file) => file.name), [
      "sheet-9.pdf",
      "sheet-10.pdf",
      "sheet-11.pdf",
      "sheet-12.pdf",
    ]);
  });

  it("removes one selected sheet", () => {
    const selected = mergePendingAnalyzerSheets([], batch(1, 8)).files;
    const next = removePendingAnalyzerSheet(selected, 2);
    assert.equal(next.length, 7);
    assert.equal(next.some((file) => file.name === "sheet-3.pdf"), false);
    assert.equal(removePendingAnalyzerSheet(selected, -1).length, 8);
  });

  it("clears the entire pending selection", () => {
    assert.deepEqual(clearPendingAnalyzerSheets(), []);
  });

  it("partially accepts files up to the combined 100-sheet limit", () => {
    const existing = batch(1, 98);
    const merged = mergePendingAnalyzerSheets(existing, batch(200, 5));
    assert.equal(merged.files.length, 100);
    assert.equal(merged.added.length, 2);
    assert.equal(merged.notices.filter((notice) => notice.code === "sheet_limit").length, 3);
    assert.equal(merged.files[0].name, "sheet-1.pdf");
  });

  it("enforces the combined 250 MB limit without removing accepted files", () => {
    const existing = [sheet("kept.pdf", 240 * MB)];
    const merged = mergePendingAnalyzerSheets(existing, [
      sheet("too-large-for-total.pdf", 12 * MB),
      sheet("fits.pdf", 8 * MB),
    ]);
    assert.equal(merged.files.length, 2);
    assert.deepEqual(merged.files.map((file) => file.name), ["kept.pdf", "fits.pdf"]);
    assert.equal(merged.notices[0].code, "total_limit");
    assert.equal(merged.notices[0].fileName, "too-large-for-total.pdf");
  });

  it("rejects a sheet over 15 MB and keeps valid siblings", () => {
    const existing = [sheet("kept.pdf", MB)];
    const merged = mergePendingAnalyzerSheets(existing, [
      sheet("huge.pdf", 16 * MB),
      sheet("ok.pdf", 2 * MB),
    ]);
    assert.deepEqual(merged.files.map((file) => file.name), ["kept.pdf", "ok.pdf"]);
    assert.equal(merged.notices[0].code, "oversized");
  });

  it("keeps existing files when a batch mixes invalid and valid files", () => {
    const existing = [sheet("kept.pdf")];
    const merged = mergePendingAnalyzerSheets(existing, [
      sheet("notes.txt", 100, "text/plain"),
      sheet("added.pdf"),
    ]);
    assert.deepEqual(merged.files.map((file) => file.name), ["kept.pdf", "added.pdf"]);
    assert.equal(merged.notices[0].code, "unsupported");
    assert.equal(merged.notices[0].fileName, "notes.txt");
  });

  it("ignores mutation and a second start while submission is in flight", () => {
    const existing = batch(1, 8);
    const locked = mergePendingAnalyzerSheets(existing, batch(9, 20), { locked: true });
    assert.equal(locked.blocked, true);
    assert.equal(locked.files.length, 8);
    assert.equal(analyzerSubmissionAction({
      inFlight: true,
      projectId: "project-1",
      files: existing,
      draft: null,
    }), "ignore");
  });

  it("plans one run and 82 jobs, then resumes that run instead of creating another", () => {
    const first = mergePendingAnalyzerSheets([], batch(1, 8));
    const second = mergePendingAnalyzerSheets(first.files, batch(9, 20));
    const third = mergePendingAnalyzerSheets(second.files, batch(29, 54));
    const plan = analyzerSubmissionPlan(third.files);
    assert.equal(plan.runs, 1);
    assert.equal(plan.jobs, 82);
    const draft = {
      projectId: "project-1",
      signature: analyzerSelectionSignature(third.files),
    };
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: third.files,
      draft,
    }), "resume");
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: third.files,
      draft: null,
    }), "create");
  });

  it("updates a settled run instead of creating another one", () => {
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: batch(1, 1),
      draft: null,
      runStatus: "completed",
    }), "update");
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: batch(1, 1),
      draft: null,
      runStatus: "cancelled",
    }), "update");
  });

  it("does not start a second run while analysis is processing", () => {
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: batch(1, 1),
      draft: null,
      runStatus: "processing",
    }), "blocked");
    assert.equal(analyzerSubmissionAction({
      inFlight: false,
      projectId: "project-1",
      files: batch(1, 1),
      draft: null,
      runStatus: "queued",
    }), "blocked");
  });

  it("retries only failed upload descriptors for the saved run", () => {
    const uploads: AnalyzerUploadDescriptor[] = [
      { path: "a", token: "a", fileName: "a.pdf", fileSize: 1, jobId: "job-a" },
      { path: "b", token: "b", fileName: "b.pdf", fileSize: 1, jobId: "job-b" },
    ];
    assert.deepEqual(
      failedUploadDescriptors(uploads, ["job-b"]).map((upload) => upload.jobId),
      ["job-b"],
    );
  });

  it("clears a pending selection when the project changes and preserves it during submission", () => {
    const files = batch(1, 8);
    assert.equal(retainPendingSelectionForProject("project-1", "project-2", files, false).length, 0);
    assert.equal(retainPendingSelectionForProject("project-1", "project-2", files, true).length, 8);
    assert.equal(retainPendingSelectionForProject("project-1", "project-1", files, false).length, 8);
  });
});
