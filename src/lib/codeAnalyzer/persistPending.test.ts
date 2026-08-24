import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { persistPendingAnalyzerSources } from "./persistPending.ts";
import { COMPLIANCE_MAX_INCLUDED_SHEETS } from "./model.ts";
import type { CodeAnalyzerSheet } from "./model.ts";
import {
  formatUploadCompletionToast,
  shouldShowUploadProgress,
  type DrawingUploadProgress,
} from "./uploadBatchProgress.ts";

describe("persistPendingAnalyzerSources", () => {
  it("stores the original PDF and a sheet per page, not page 1 only", async () => {
    const uploads: string[] = [];
    const { sheets, warnings, failedSources } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "set.pdf", type: "application/pdf", size: 10 } as File,
          discipline: "architectural",
        },
      ],
      uploadDocument: async ({ file, parent_document_id }) => {
        uploads.push(`${file.name}|parent=${parent_document_id ?? "none"}`);
        if (file.name === "set.pdf") return { id: "pdf-1", file_name: file.name };
        if (file.name.includes("page1")) return { id: "img-1", file_name: file.name };
        if (file.name.includes("page2")) return { id: "img-2", file_name: file.name };
        if (file.name.includes("page3")) return { id: "img-3", file_name: file.name };
        return { id: `img-${file.name}`, file_name: file.name };
      },
      renderPdfPages: async () => ({
        totalPages: 3,
        truncated: false,
        pages: [
          { pageNumber: 1, file: { name: "set-page1.png", type: "image/png" } as File },
          { pageNumber: 2, file: { name: "set-page2.png", type: "image/png" } as File },
          { pageNumber: 3, file: { name: "set-page3.png", type: "image/png" } as File },
        ],
      }),
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.page_number}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });

    assert.equal(uploads[0], "set.pdf|parent=none");
    assert.ok(uploads.includes("set-page1.png|parent=pdf-1"));
    assert.ok(uploads.includes("set-page2.png|parent=pdf-1"));
    assert.ok(uploads.includes("set-page3.png|parent=pdf-1"));
    assert.equal(sheets.length, 3);
    assert.deepEqual(sheets.map((s) => s.page_number), [1, 2, 3]);
    assert.ok(sheets.every((s) => s.source_document_id === "pdf-1"));
    assert.deepEqual(sheets.map((s) => s.image_document_id), ["img-1", "img-2", "img-3"]);
    assert.equal(warnings.length, 0);
    assert.ok(sheets.every((s) => s.discipline === "architectural"));
    assert.deepEqual(failedSources, []);
  });

  it("persists demolition discipline on inserted sheets", async () => {
    const { sheets } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "demo-plan.png", type: "image/png", size: 10 } as File,
          discipline: "demolition",
        },
      ],
      uploadDocument: async ({ file }) => ({ id: "img-src", file_name: file.name }),
      renderPdfPages: async () => {
        throw new Error("should not rasterize a PNG");
      },
      insertSheet: async (row) =>
        ({
          id: "sheet-1",
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].discipline, "demolition");
  });

  it("treats a raster image as a single sheet using the source document as the image", async () => {
    const { sheets } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "plan.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
      ],
      uploadDocument: async ({ file }) => ({ id: "img-src", file_name: file.name }),
      renderPdfPages: async () => {
        throw new Error("should not rasterize a PNG");
      },
      insertSheet: async (row) =>
        ({
          id: "sheet-1",
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].page_number, 1);
    assert.equal(sheets[0].source_document_id, "img-src");
    assert.equal(sheets[0].image_document_id, "img-src");
  });

  it("marks overflow sheets excluded when adding beyond the included-sheet cap", async () => {
    const pendingFiles = Array.from({ length: COMPLIANCE_MAX_INCLUDED_SHEETS + 1 }, (_, i) => ({
      id: `p${i}`,
      file: { name: `A-${100 + i}.png`, type: "image/png", size: 10 } as File,
      discipline: "general" as const,
    }));
    const { sheets, warnings } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles,
      uploadDocument: async ({ file }) => ({ id: `doc-${file.name}`, file_name: file.name }),
      renderPdfPages: async () => {
        throw new Error("png only");
      },
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.source_document_id}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });
    assert.equal(sheets.length, COMPLIANCE_MAX_INCLUDED_SHEETS + 1);
    assert.equal(sheets.filter((s) => !s.excluded).length, COMPLIANCE_MAX_INCLUDED_SHEETS);
    assert.equal(sheets.filter((s) => s.excluded).length, 1);
    assert.equal(warnings.some((w) => /included-sheet cap/i.test(w)), true);
  });

  it("emits upload progress once per source file, not per PDF page", async () => {
    const progressEvents: Array<{ completed: number; total: number; phase: string }> = [];
    await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "set.pdf", type: "application/pdf", size: 10 } as File,
          discipline: "general",
        },
        {
          id: "p2",
          file: { name: "plan.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
      ],
      uploadDocument: async ({ file }) => ({ id: `doc-${file.name}`, file_name: file.name }),
      renderPdfPages: async () => ({
        totalPages: 3,
        truncated: false,
        pages: [
          { pageNumber: 1, file: { name: "set-page1.png", type: "image/png" } as File },
          { pageNumber: 2, file: { name: "set-page2.png", type: "image/png" } as File },
          { pageNumber: 3, file: { name: "set-page3.png", type: "image/png" } as File },
        ],
      }),
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.page_number}-${row.file_name}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
      onUploadProgress: (progress) => {
        progressEvents.push({
          completed: progress.completed,
          total: progress.total,
          phase: progress.phase,
        });
      },
    });

    const completionEvents = progressEvents.filter((e) => e.phase === "complete");
    assert.equal(completionEvents.length, 1);
    assert.equal(completionEvents[0]?.completed, 2);
    assert.equal(completionEvents[0]?.total, 2);
    assert.ok(progressEvents.some((e) => e.completed === 1 && e.phase === "uploading"));
  });

  it("continues when one source file fails and returns failedSources", async () => {
    const { sheets, failedSources } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "ok",
          file: { name: "ok.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
        {
          id: "bad",
          file: { name: "bad.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
        {
          id: "ok2",
          file: { name: "ok2.png", type: "image/png", size: 10 } as File,
          discipline: "general",
        },
      ],
      uploadDocument: async ({ file }) => {
        if (file.name === "bad.png") return null;
        return { id: `doc-${file.name}`, file_name: file.name };
      },
      renderPdfPages: async () => {
        throw new Error("png only");
      },
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.source_document_id}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });

    assert.equal(sheets.length, 2);
    assert.equal(failedSources.length, 1);
    assert.equal(failedSources[0]?.id, "bad");
    assert.equal(failedSources[0]?.fileName, "bad.png");
  });

  it("uploads multiple page images without separate user-facing completion events", async () => {
    let uploadCalls = 0;
    let progressCompleteCount = 0;

    await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        {
          id: "p1",
          file: { name: "set.pdf", type: "application/pdf", size: 10 } as File,
          discipline: "general",
        },
      ],
      uploadDocument: async ({ file }) => {
        uploadCalls += 1;
        return { id: `doc-${file.name}`, file_name: file.name };
      },
      renderPdfPages: async () => ({
        totalPages: 4,
        truncated: false,
        pages: Array.from({ length: 4 }, (_, i) => ({
          pageNumber: i + 1,
          file: { name: `set-page${i + 1}.png`, type: "image/png" } as File,
        })),
      }),
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.page_number}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
      onUploadProgress: (progress) => {
        if (progress.phase === "complete") progressCompleteCount += 1;
      },
    });

    assert.equal(uploadCalls, 5);
    assert.equal(progressCompleteCount, 1);
  });

  it("suppresses per-document success toasts for 4-file Code Mod drawing batch", async () => {
    let successToastCount = 0;
    const progressSnapshots: DrawingUploadProgress[] = [];
    const pendingFiles = ["A1.png", "A2.png", "A3.png", "A4.png"].map((name, i) => ({
      id: `p${i}`,
      file: { name, type: "image/png", size: 10 } as File,
      discipline: "general" as const,
    }));

    const persistUpload = async (opts: {
      file: File;
      document_type: string;
      description: string;
      parent_document_id?: string;
      suppressToasts?: boolean;
    }) => {
      if (!opts.suppressToasts) successToastCount += 1;
      return { id: `doc-${opts.file.name}`, file_name: opts.file.name };
    };

    const { failedSources } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles,
      uploadDocument: (opts) => persistUpload({ ...opts, suppressToasts: true }),
      renderPdfPages: async () => {
        throw new Error("png only");
      },
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.source_document_id}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
      onUploadProgress: (progress) => progressSnapshots.push({ ...progress }),
    });

    assert.equal(successToastCount, 0);
    assert.equal(failedSources.length, 0);
    assert.equal(Math.max(...progressSnapshots.map((p) => p.total)), 4);
    assert.equal(
      formatUploadCompletionToast({ total: 4, succeeded: 4, failed: 0 })?.message,
      "All 4 documents uploaded successfully",
    );
    assert.equal(shouldShowUploadProgress(progressSnapshots.at(-1)), false);
  });

  it("would emit one success toast per upload without suppressToasts", async () => {
    let successToastCount = 0;
    const pendingFiles = ["A1.png", "A2.png", "A3.png", "A4.png"].map((name, i) => ({
      id: `p${i}`,
      file: { name, type: "image/png", size: 10 } as File,
      discipline: "general" as const,
    }));

    await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles,
      uploadDocument: async () => {
        successToastCount += 1;
        return { id: "doc", file_name: "x.png" };
      },
      renderPdfPages: async () => {
        throw new Error("png only");
      },
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.source_document_id}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });

    assert.equal(successToastCount, 4);
  });

  it("returns partial failure summary for mixed upload results", async () => {
    const { failedSources } = await persistPendingAnalyzerSources({
      projectId: "proj",
      existingSheets: [],
      pendingFiles: [
        { id: "a", file: { name: "ok.png", type: "image/png", size: 10 } as File, discipline: "general" },
        { id: "b", file: { name: "bad.png", type: "image/png", size: 10 } as File, discipline: "general" },
        { id: "c", file: { name: "ok2.png", type: "image/png", size: 10 } as File, discipline: "general" },
        { id: "d", file: { name: "bad2.png", type: "image/png", size: 10 } as File, discipline: "general" },
      ],
      uploadDocument: async ({ file }) => {
        if (file.name === "bad.png") return null;
        return { id: `doc-${file.name}`, file_name: file.name };
      },
      renderPdfPages: async () => {
        throw new Error("png only");
      },
      insertSheet: async (row) =>
        ({
          id: `sheet-${row.source_document_id}`,
          created_at: "2026-08-21T00:00:00Z",
          ...row,
        }) as CodeAnalyzerSheet,
    });

    assert.equal(failedSources.length, 1);
    assert.deepEqual(formatUploadCompletionToast({ total: 4, succeeded: 3, failed: 1 }), {
      type: "warning",
      message: "3 of 4 documents uploaded — 1 failed",
    });
  });
});
