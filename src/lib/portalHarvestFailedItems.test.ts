import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessFileRetryability,
  assessReportArtifactRetryability,
  buildPgcRetryArtifactPayload,
  collectPortalFailedItems,
  countRetryableFailedItems,
  failedArtifactIdentityKey,
  filterRetryPayloadToSelectedFailedOnly,
  groupFailedItemsByFolderAndType,
  harvestStatusAfterRetry,
  mapReportArtifactStatusToRetryLiveState,
  selectCurrentFailedInventory,
  summarizeRetryLiveResults,
  syncFailedItemsSelection,
  type PortalFailedItem,
  type CollectPortalFailedItemsInput,
} from "./portalHarvestFailedItems.ts";
import type { ScrapeFileResult } from "./scrapeFileResultTypes.ts";

function sfr(partial: Partial<ScrapeFileResult> & {
  portal_file_id: string;
  status: ScrapeFileResult["status"];
  updated_at: string;
}): ScrapeFileResult {
  return {
    id: partial.id || `${partial.portal_file_id}-${partial.updated_at}`,
    project_id: partial.project_id || "proj-1",
    scrape_job_id: partial.scrape_job_id || "job-1",
    jurisdiction: partial.jurisdiction || "PGC",
    portal_file_id: partial.portal_file_id,
    file_version: partial.file_version ?? "2",
    file_name: partial.file_name || "file.pdf",
    folder_name: partial.folder_name || "Drawings",
    parent_folder: partial.parent_folder ?? null,
    status: partial.status,
    storage_path: partial.storage_path ?? null,
    public_url: partial.public_url ?? null,
    source_url: partial.source_url ?? null,
    mime_type: partial.mime_type ?? null,
    size_bytes: partial.size_bytes ?? null,
    progress_current: partial.progress_current ?? null,
    progress_total: partial.progress_total ?? null,
    failure_code: partial.failure_code ?? null,
    failure_message: partial.failure_message ?? null,
    updated_at: partial.updated_at,
    created_at: partial.created_at || partial.updated_at,
  };
}

describe("failedArtifactIdentityKey", () => {
  it("prefers projectId + fileId for files", () => {
    assert.equal(
      failedArtifactIdentityKey({
        projectId: "proj-1",
        artifactType: "file",
        fileId: "5113090",
        name: "A-122A.pdf",
      }),
      "file:proj-1:5113090",
    );
  });

  it("includes format for reports", () => {
    assert.equal(
      failedArtifactIdentityKey({
        projectId: "proj-1",
        artifactType: "pdf",
        reportSlug: "plan-review-comments",
        format: "pdf",
      }),
      "report:proj-1:plan-review-comments:pdf",
    );
  });
});

describe("collectPortalFailedItems — latest-per-identity", () => {
  it("groups failed items by folder and type", () => {
    const items = collectPortalFailedItems({
      projectId: "proj-1",
      scrapeFileResults: [
        sfr({
          portal_file_id: "111",
          file_name: "plan.pdf",
          status: "failed",
          failure_message: "viewer_tab_missing",
          updated_at: "2026-07-01T00:00:00Z",
          parent_folder: "Project",
        }),
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

  it("counts duplicate historical failures once (A-122A)", () => {
    const items = collectPortalFailedItems({
      projectId: "proj-1",
      portalSnapshotAt: "2026-07-28T13:25:00Z",
      scrapeFileResults: [
        sfr({
          portal_file_id: "5113090",
          file_name: "A-122A - SECOND FLOOR RCP -PART A.pdf",
          status: "failed",
          failure_code: "publishtoformat_pdf_not_seen",
          failure_message: "publishtoformat_pdf_not_seen",
          updated_at: "2026-07-28T02:23:07Z",
          scrape_job_id: "old",
        }),
        sfr({
          portal_file_id: "5113090",
          file_name: "A-122A - SECOND FLOOR RCP -PART A.pdf",
          status: "failed",
          failure_code: "publish_menu_not_opened",
          failure_message: "publish_menu_not_opened",
          updated_at: "2026-07-28T13:19:37Z",
          scrape_job_id: "retry",
        }),
      ],
      folders: [
        {
          name: "3rd Party Architectural",
          folderID: "f1",
          files: [
            {
              fileId: "5113090",
              name: "A-122A - SECOND FLOOR RCP -PART A.pdf",
              downloadStatus: "failed",
              downloadError: "publish_menu_not_opened",
              retryCount: 2,
            },
          ],
        },
      ],
    });
    const matches = items.filter((i) => i.fileId === "5113090");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].failureReason, "publish_menu_not_opened");
    assert.ok((matches[0].attempts?.length || 0) >= 2);
  });

  it("latest success overrides older failures (removes from failed list)", () => {
    const items = collectPortalFailedItems({
      projectId: "proj-1",
      portalSnapshotAt: "2026-07-28T13:25:00Z",
      scrapeFileResults: [
        sfr({
          portal_file_id: "5113096",
          status: "failed",
          failure_message: "viewer_tab_missing",
          updated_at: "2026-07-28T02:00:00Z",
        }),
        sfr({
          portal_file_id: "5113096",
          status: "uploaded",
          public_url: "https://x.supabase.co/storage/v1/object/public/a.pdf",
          updated_at: "2026-07-28T13:20:00Z",
          scrape_job_id: "j2",
        }),
        sfr({
          portal_file_id: "5113090",
          file_name: "b.pdf",
          status: "failed",
          failure_message: "publish_menu_not_opened",
          updated_at: "2026-07-28T13:19:00Z",
          scrape_job_id: "j2",
        }),
      ],
      folders: [
        {
          name: "Drawings",
          files: [
            {
              fileId: "5113096",
              name: "a.pdf",
              downloadStatus: "ok",
              publicUrl: "https://x.supabase.co/storage/v1/object/public/a.pdf",
            },
            {
              fileId: "5113090",
              name: "b.pdf",
              downloadStatus: "failed",
              downloadError: "publish_menu_not_opened",
            },
          ],
        },
      ],
    });
    assert.equal(items.some((i) => i.fileId === "5113096"), false);
    assert.equal(items.some((i) => i.fileId === "5113090"), true);
    assert.equal(items.length, 1);
  });

  it("latest failure after a prior success remains retryable", () => {
    const items = collectPortalFailedItems({
      projectId: "proj-1",
      scrapeFileResults: [
        sfr({
          portal_file_id: "999",
          status: "uploaded",
          public_url: "https://x.supabase.co/storage/v1/object/public/x.pdf",
          updated_at: "2026-07-27T00:00:00Z",
        }),
        sfr({
          portal_file_id: "999",
          status: "failed",
          failure_message: "publish_menu_not_opened",
          updated_at: "2026-07-28T12:00:00Z",
          scrape_job_id: "later",
        }),
      ],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].fileId, "999");
    assert.equal(items[0].retryable, true);
    assert.equal(items[0].failureReason, "publish_menu_not_opened");
  });

  it("does not double-count portal_data + SFR for the same fileId (39 not 78)", () => {
    const failedIds = Array.from({ length: 39 }, (_, i) => `id-${i}`);
    const scrapeFileResults = failedIds.flatMap((id, i) => [
      sfr({
        portal_file_id: id,
        file_name: `file-${i}.pdf`,
        status: "failed",
        failure_message: "viewer_tab_missing",
        updated_at: "2026-07-28T02:00:00Z",
        file_version: "2",
        scrape_job_id: "old",
      }),
      sfr({
        portal_file_id: id,
        file_name: `file-${i}.pdf`,
        status: "failed",
        failure_message: "publish_menu_not_opened",
        updated_at: "2026-07-28T13:00:00Z",
        file_version: "2",
        scrape_job_id: "retry",
      }),
    ]);
    const folders = [
      {
        name: "Drawings",
        files: failedIds.map((id, i) => ({
          fileId: id,
          name: `file-${i}.pdf`,
          downloadStatus: "failed" as const,
          downloadError: "publish_menu_not_opened",
        })),
      },
    ];
    const input: CollectPortalFailedItemsInput = {
      projectId: "proj-1",
      portalSnapshotAt: "2026-07-28T13:25:00Z",
      scrapeFileResults,
      folders,
    };
    const card = selectCurrentFailedInventory(input);
    const modal = selectCurrentFailedInventory(input);
    assert.equal(card.counts.total, 39);
    assert.equal(card.counts.retryable, 39);
    assert.equal(modal.counts.total, card.counts.total);
    assert.equal(modal.counts.retryable, card.counts.retryable);
    assert.equal(card.items.length, 39);
  });

  it("outside and modal counts always match via selectCurrentFailedInventory", () => {
    const input: CollectPortalFailedItemsInput = {
      projectId: "proj-1",
      scrapeFileResults: [
        sfr({
          portal_file_id: "1",
          status: "failed",
          failure_message: "x",
          updated_at: "2026-07-28T01:00:00Z",
        }),
      ],
      folders: [
        {
          name: "D",
          files: [
            { fileId: "1", name: "a.pdf", downloadStatus: "failed", downloadError: "x" },
            { fileId: "2", name: "b.pdf", downloadStatus: "ok", publicUrl: "https://x/y" },
          ],
        },
      ],
      reportEntries: [
        {
          reportName: "R",
          fileSlug: "r",
          pdfStatus: "failed",
          pdfError: "pdf_export_failed",
        },
      ],
      portalSnapshotAt: "2026-07-28T13:00:00Z",
    };
    const a = selectCurrentFailedInventory(input);
    const b = selectCurrentFailedInventory(input);
    assert.deepEqual(a.counts, b.counts);
    assert.equal(a.items.length, b.items.length);
    assert.equal(a.counts.total, a.items.length);
  });

  it("excludes pending files and pending report artifacts", () => {
    const items = collectPortalFailedItems({
      projectId: "proj-1",
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
      id: "file:proj-1:111",
      identityKey: "file:proj-1:111",
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
      id: "file:proj-1:222",
      identityKey: "file:proj-1:222",
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
      id: "report:proj-1:plan-review-comments:pdf",
      identityKey: "report:proj-1:plan-review-comments:pdf",
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
      id: "report:proj-1:plan-review-comments:excel",
      identityKey: "report:proj-1:plan-review-comments:excel",
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
    const selectedIds = new Set([
      "file:proj-1:111",
      "report:proj-1:plan-review-comments:pdf",
    ]);
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
  const allRetryable = [
    "file:proj-1:111",
    "file:proj-1:222",
    "report:proj-1:plan-review-comments:pdf",
  ];

  it("selects all retryable only when dialog opens (resetToAll)", () => {
    const next = syncFailedItemsSelection([], allRetryable, { resetToAll: true });
    assert.deepEqual([...next].sort(), [...allRetryable].sort());
  });

  it("does not expand selection to all on submit / live-state item updates", () => {
    const userSelected = new Set(["file:proj-1:111"]);
    const afterSubmit = syncFailedItemsSelection(userSelected, allRetryable, {
      resetToAll: false,
    });
    assert.deepEqual([...afterSubmit], ["file:proj-1:111"]);
    assert.equal(afterSubmit.has("file:proj-1:222"), false);
    assert.equal(afterSubmit.size, 1);
  });

  it("submit must not re-apply resetToAll even if dialog remounts with empty local state", () => {
    const next = syncFailedItemsSelection([], allRetryable, { resetToAll: false });
    assert.equal(next.size, 0);
  });

  it("prunes IDs that are no longer retryable without adding others", () => {
    const prev = new Set(["file:proj-1:111", "file:proj-1:222"]);
    const next = syncFailedItemsSelection(prev, ["file:proj-1:111"], {
      resetToAll: false,
    });
    assert.deepEqual([...next], ["file:proj-1:111"]);
  });
});

describe("retry result helpers", () => {
  it("summarizes succeeded vs still failed", () => {
    const summary = summarizeRetryLiveResults([
      { liveState: "succeeded" },
      { liveState: "failed" },
      { liveState: "human_action_required" },
      { liveState: "retrying" },
    ]);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.stillFailed, 1);
    assert.equal(summary.humanActionRequired, 1);
  });

  it("maps PDF/Excel status to live retry states", () => {
    assert.equal(mapReportArtifactStatusToRetryLiveState("success"), "succeeded");
    assert.equal(mapReportArtifactStatusToRetryLiveState("failed"), "failed");
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
        identityKey: "a",
        name: "a",
        folder: "F",
        artifactType: "file",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: true,
        source: "portal_file",
      },
      {
        id: "b",
        identityKey: "b",
        name: "b",
        folder: "F",
        artifactType: "file",
        failureReason: "x",
        lastAttempt: null,
        retryCount: 0,
        retryable: false,
        source: "portal_file",
      },
    ]);
    assert.deepEqual(counts, { total: 2, retryable: 1, notRetryable: 1 });
  });
});
