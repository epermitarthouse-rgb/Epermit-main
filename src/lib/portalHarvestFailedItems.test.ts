import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessFileRetryability,
  assessReportArtifactRetryability,
  buildPgcRetryArtifactPayload,
  collectPortalFailedItems,
  countRetryableFailedItems,
  filterRetryPayloadToSelectedFailedOnly,
  groupFailedItemsByFolderAndType,
  harvestStatusAfterRetry,
  mapReportArtifactStatusToRetryLiveState,
  summarizeRetryLiveResults,
  syncFailedItemsSelection,
  type PortalFailedItem,
} from "./portalHarvestFailedItems.ts";

describe("collectPortalFailedItems", () => {
  it("groups failed items by folder and type", () => {
    const items = collectPortalFailedItems({
      scrapeFileResults: [
        {
          id: "1",
          project_id: "p",
          scrape_job_id: "j",
          jurisdiction: "PGC",
          portal_file_id: "111",
          file_version: "1",
          file_name: "plan.pdf",
          folder_name: "Drawings",
          parent_folder: "Project",
          status: "failed",
          storage_path: null,
          public_url: null,
          source_url: null,
          mime_type: null,
          size_bytes: null,
          progress_current: null,
          progress_total: null,
          failure_code: "viewer_tab_missing",
          failure_message: "viewer_tab_missing",
          updated_at: "2026-07-01T00:00:00Z",
          created_at: "2026-07-01T00:00:00Z",
        },
      ],
      reportEntries: [
        {
          fileSlug: "plan-review-comments",
          reportName: "Plan Review Comments",
          pdfStatus: "failed",
          pdfError: "pdf_export_failed",
          excelStatus: "success",
          excelUrl: "https://x.supabase.co/storage/v1/object/public/a.xlsx",
        },
      ],
    });
    const groups = groupFailedItemsByFolderAndType(items);
    assert.ok(groups.length >= 2);
    assert.ok(groups.some((g) => g.artifactType === "file"));
    assert.ok(groups.some((g) => g.artifactType === "pdf"));
    assert.ok(!groups.some((g) => g.artifactType === "excel"));
  });

  it("excludes pending files and pending report artifacts", () => {
    const items = collectPortalFailedItems({
      folders: [
        {
          name: "Drawings",
          files: [
            { name: "a.pdf", fileId: "1", downloadStatus: "pending" },
            { name: "b.pdf", fileId: "2", downloadStatus: "failed", downloadError: "x" },
          ],
        },
      ],
      reportEntries: [
        {
          reportName: "Dept Review Status",
          fileSlug: "dept-review-status",
          pdfStatus: "pending",
          excelStatus: "failed",
          excelError: "excel_export_failed",
        },
      ],
    });
    assert.equal(items.some((i) => i.name === "a.pdf"), false);
    assert.equal(items.some((i) => i.artifactType === "pdf"), false);
    assert.equal(items.some((i) => i.artifactType === "excel"), true);
    assert.equal(items.length, 2);
  });

  it("marks missing metadata as not retryable", () => {
    assert.equal(assessFileRetryability({ fileId: "" }).retryable, false);
    assert.equal(
      assessReportArtifactRetryability({
        format: "pdf",
        status: "failed",
        reportName: "",
        reportSlug: "",
      }).retryable,
      false,
    );
    assert.equal(
      assessReportArtifactRetryability({
        format: "pdf",
        status: "not_available",
        reportName: "X",
        reportSlug: "x",
      }).retryable,
      false,
    );
  });
});

describe("buildPgcRetryArtifactPayload", () => {
  const failed: PortalFailedItem[] = [
    {
      id: "file:sfr:111:",
      name: "plan.pdf",
      folder: "Project / Drawings",
      artifactType: "file",
      failureReason: "x",
      lastAttempt: null,
      retryCount: 0,
      retryable: true,
      source: "scrape_file_results",
      fileId: "111",
    },
    {
      id: "file:sfr:222:",
      name: "ok.pdf",
      folder: "Project / Drawings",
      artifactType: "file",
      failureReason: "x",
      lastAttempt: null,
      retryCount: 0,
      retryable: true,
      source: "scrape_file_results",
      fileId: "222",
    },
    {
      id: "report:plan-review-comments:pdf",
      name: "Plan Review Comments",
      folder: "Reports",
      artifactType: "pdf",
      failureReason: "pdf_export_failed",
      lastAttempt: null,
      retryCount: 1,
      retryable: true,
      source: "report_artifact",
      reportSlug: "plan-review-comments",
      reportName: "Plan Review Comments",
      format: "pdf",
    },
    {
      id: "report:plan-review-comments:excel",
      name: "Plan Review Comments",
      folder: "Reports",
      artifactType: "excel",
      failureReason: "excel_export_failed",
      lastAttempt: null,
      retryCount: 0,
      retryable: false,
      notRetryableReason: "Missing metadata",
      source: "report_artifact",
      reportSlug: "plan-review-comments",
      reportName: "Plan Review Comments",
      format: "excel",
    },
  ];

  it("retries only selected failed items and excludes successful/non-selected", () => {
    const selectedIds = new Set(["file:sfr:111:", "report:plan-review-comments:pdf"]);
    const payload = filterRetryPayloadToSelectedFailedOnly(
      buildPgcRetryArtifactPayload(failed),
      selectedIds,
      failed,
    );
    assert.deepEqual(
      payload.files.map((f) => f.portalFileId),
      ["111"],
    );
    assert.equal(payload.reports.length, 1);
    assert.deepEqual(payload.reports[0].formats, ["pdf"]);
    assert.equal(payload.files.some((f) => f.portalFileId === "222"), false);
  });

  it("does not include non-retryable items even if selected", () => {
    const payload = buildPgcRetryArtifactPayload([
      failed[3],
      { ...failed[0], retryable: false, notRetryableReason: "no id", fileId: "" },
    ]);
    assert.equal(payload.files.length, 0);
    assert.equal(payload.reports.length, 0);
  });

  it("builds payload from only the user-selected subset (not all failed)", () => {
    const selectedOnly = [failed[0]];
    const payload = buildPgcRetryArtifactPayload(selectedOnly);
    assert.deepEqual(
      payload.files.map((f) => f.portalFileId),
      ["111"],
    );
    assert.equal(payload.reports.length, 0);
    assert.equal(payload.files.length, 1);
  });
});

describe("syncFailedItemsSelection", () => {
  const allRetryable = ["file:sfr:111:", "file:sfr:222:", "report:plan-review-comments:pdf"];

  it("selects all retryable only when dialog opens (resetToAll)", () => {
    const next = syncFailedItemsSelection([], allRetryable, { resetToAll: true });
    assert.deepEqual([...next].sort(), [...allRetryable].sort());
  });

  it("does not expand selection to all on submit / live-state item updates", () => {
    const userSelected = new Set(["file:sfr:111:"]);
    // Simulate items refresh after Retry click (liveState queued/retrying) —
    // retryable IDs unchanged; selection must stay partial.
    const afterSubmit = syncFailedItemsSelection(userSelected, allRetryable, {
      resetToAll: false,
    });
    assert.deepEqual([...afterSubmit], ["file:sfr:111:"]);
    assert.equal(afterSubmit.has("file:sfr:222:"), false);
    assert.equal(afterSubmit.size, 1);

    const selectedItems: PortalFailedItem[] = [
      {
        id: "file:sfr:111:",
        name: "plan.pdf",
        folder: "Project / Drawings",
        artifactType: "file",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: true,
        source: "scrape_file_results",
        fileId: "111",
      },
      {
        id: "file:sfr:222:",
        name: "ok.pdf",
        folder: "Project / Drawings",
        artifactType: "file",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: true,
        source: "scrape_file_results",
        fileId: "222",
      },
    ];
    const payload = buildPgcRetryArtifactPayload(
      selectedItems.filter((i) => afterSubmit.has(i.id) && i.retryable),
    );
    assert.deepEqual(
      payload.files.map((f) => f.portalFileId),
      ["111"],
    );
    assert.equal(payload.reports.length, 0);
  });

  it("submit must not re-apply resetToAll even if dialog remounts with empty local state", () => {
    // Parent owns selection across remounts. A remounted dialog with empty local
    // state must sync with resetToAll:false using the parent's partial set —
    // never expand to all retryable IDs.
    const parentOwnedPartial = new Set(["file:sfr:111:"]);
    const afterRemount = syncFailedItemsSelection(
      parentOwnedPartial,
      allRetryable,
      { resetToAll: false },
    );
    assert.equal(afterRemount.size, 1);
    assert.deepEqual([...afterRemount], ["file:sfr:111:"]);

    // Contrast: resetToAll is reserved for dialog open only.
    const onOpen = syncFailedItemsSelection(new Set(), allRetryable, {
      resetToAll: true,
    });
    assert.equal(onOpen.size, allRetryable.length);
  });

  it("prunes IDs that are no longer retryable without adding others", () => {
    const prev = new Set(["file:sfr:111:", "file:sfr:222:"]);
    const next = syncFailedItemsSelection(prev, ["file:sfr:111:"], {
      resetToAll: false,
    });
    assert.deepEqual([...next], ["file:sfr:111:"]);
  });
});

describe("retry result helpers", () => {
  it("summarizes succeeded vs still failed", () => {
    const summary = summarizeRetryLiveResults([
      { liveState: "succeeded" },
      { liveState: "failed" },
      { liveState: "failed" },
      { liveState: "human_action_required" },
    ]);
    assert.deepEqual(summary, {
      succeeded: 1,
      stillFailed: 2,
      humanActionRequired: 1,
    });
  });

  it("maps PDF/Excel status to live retry states", () => {
    assert.equal(mapReportArtifactStatusToRetryLiveState("success"), "succeeded");
    assert.equal(mapReportArtifactStatusToRetryLiveState("failed"), "failed");
    assert.equal(mapReportArtifactStatusToRetryLiveState("exporting"), "retrying");
  });

  it("promotes harvest to Synced only when no failed/pending remain", () => {
    assert.equal(
      harvestStatusAfterRetry({
        failedRemaining: 0,
        pendingRemaining: 0,
        hadSuccess: true,
      }),
      "Synced",
    );
    assert.equal(
      harvestStatusAfterRetry({
        failedRemaining: 1,
        pendingRemaining: 0,
        hadSuccess: true,
      }),
      "Partial",
    );
  });

  it("counts retryable vs not", () => {
    const counts = countRetryableFailedItems([
      {
        id: "a",
        name: "a",
        folder: "f",
        artifactType: "file",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: true,
        source: "portal_file",
        fileId: "1",
      },
      {
        id: "b",
        name: "b",
        folder: "f",
        artifactType: "pdf",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: false,
        source: "report_artifact",
      },
    ]);
    assert.deepEqual(counts, { total: 2, retryable: 1, notRetryable: 1 });
  });
});
