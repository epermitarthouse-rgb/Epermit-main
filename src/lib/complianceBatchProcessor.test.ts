import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_MAX_BATCH_FILES,
  mergeComplianceFiles,
} from "./complianceUploadLimits.ts";
import {
  batchProgressPercent,
  canRemoveBatchFile,
  categorizeAnalysisError,
  computeComplianceOverallScore,
  countCompletedBatchFiles,
  countFailedBatchFiles,
  formatAnalysisCompletionToast,
  formatAnalysisErrorMessage,
  formatBatchProgressLabel,
  normalizeComplianceAnalysisResult,
  processComplianceBatch,
  type ComplianceBatchFile,
} from "./complianceBatchProcessor.ts";

function makeFile(name: string, type = "image/png"): File {
  return { name, type, size: 1024 } as File;
}

function makeBatchFile(name: string, overrides: Partial<ComplianceBatchFile> = {}): ComplianceBatchFile {
  return {
    id: `id-${name}`,
    file: makeFile(name),
    discipline: "general",
    status: "pending",
    ...overrides,
  };
}

describe("complianceUploadLimits batch", () => {
  it("allows up to sixteen source files per upload drop", () => {
    assert.equal(COMPLIANCE_MAX_BATCH_FILES, 16);
  });

  it("accepts multiple files up to the batch cap", () => {
    const incoming = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.png`));
    const { accepted, rejectedCount } = mergeComplianceFiles(2, incoming);
    assert.equal(accepted.length, 5);
    assert.equal(rejectedCount, 0);
    assert.equal(accepted.length + 2, 7);
  });

  it("rejects files beyond the batch cap without silently dropping silently-unreported extras", () => {
    const incoming = Array.from({ length: 4 }, (_, i) => makeFile(`f${i}.png`));
    const { accepted, rejectedCount } = mergeComplianceFiles(15, incoming);
    assert.equal(accepted.length, 1);
    assert.equal(rejectedCount, 3);
  });
});

function mockBase64() {
  return async () => "dGVzdA==";
}

describe("complianceBatchProcessor", () => {
  it("processes files sequentially", async () => {
    const order: string[] = [];
    const files = [makeBatchFile("a.png"), makeBatchFile("b.png"), makeBatchFile("c.png")];

    await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: null,
      canPersist: false,
      uploadDocument: async () => {
        throw new Error("should not upload");
      },
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async () => ({
        issues: [],
        summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
        jurisdictionNotes: "",
      }),
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
        if (patch.status === "analyzing" && file) {
          order.push(file.file.name);
        }
      },
      onProgress: () => {},
    });

    assert.deepEqual(order, ["a.png", "b.png", "c.png"]);
  });

  it("continues batch when one file fails", async () => {
    const files = [makeBatchFile("ok.png"), makeBatchFile("bad.png"), makeBatchFile("ok2.png")];
    let analyzeCalls = 0;

    const result = await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: null,
      canPersist: false,
      uploadDocument: async () => null,
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async () => {
        analyzeCalls += 1;
        if (analyzeCalls === 2) throw new Error("refused");
        return {
          issues: [],
          summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
          jurisdictionNotes: "",
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 1);
    assert.equal(files[0].status, "completed");
    assert.equal(files[1].status, "failed");
    assert.equal(files[2].status, "completed");
  });

  it("retries only failed files and reuses uploaded document id", async () => {
    const files = [
      makeBatchFile("done.png", { status: "completed", documentId: "doc-1" }),
      makeBatchFile("retry.png", {
        status: "failed",
        documentId: "doc-2",
        preparedImageFile: makeFile("retry-page1.png"),
        error: "temporary",
      }),
    ];
    let uploadCalls = 0;
    let analyzeCalls = 0;

    await processComplianceBatch({
      files,
      onlyFailed: true,
      analysisMode: "both",
      hasLocalAmendments: true,
      jurisdiction: "dc",
      projectType: "commercial",
      codeYear: "2021",
      projectId: "proj-1",
      canPersist: true,
      uploadDocument: async () => {
        uploadCalls += 1;
        return { id: "new-doc" };
      },
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async ({ codeType }) => {
        analyzeCalls += 1;
        assert.equal(codeType, "both");
        return {
          ibc: { issues: [], summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 }, jurisdictionNotes: "" },
          local: { issues: [], summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 }, jurisdictionNotes: "" },
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(uploadCalls, 0);
    assert.equal(analyzeCalls, 1);
    assert.equal(files[1].status, "completed");
    assert.equal(files[1].documentId, "doc-2");
    assert.equal(files[0].status, "completed");
  });

  it("uses one analyze request per file in both mode", async () => {
    const files = [makeBatchFile("a.png"), makeBatchFile("b.png")];
    let analyzeCalls = 0;

    await processComplianceBatch({
      files,
      analysisMode: "both",
      hasLocalAmendments: true,
      jurisdiction: "dc",
      projectType: "commercial",
      codeYear: "2021",
      projectId: null,
      canPersist: false,
      uploadDocument: async () => null,
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async ({ codeType }) => {
        analyzeCalls += 1;
        assert.equal(codeType, "both");
        return {
          ibc: { issues: [], summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 }, jurisdictionNotes: "" },
          local: { issues: [], summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 }, jurisdictionNotes: "" },
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(analyzeCalls, 2);
  });

  it("reports actual batch progress from completed files", async () => {
    const files = [makeBatchFile("a.png"), makeBatchFile("b.png")];
    const progressSnapshots: Array<{ completed: number; total: number; currentIndex: number }> = [];

    await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: null,
      canPersist: false,
      uploadDocument: async () => null,
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async () => ({
        issues: [],
        summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
        jurisdictionNotes: "",
      }),
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: (progress) => {
        progressSnapshots.push({
          completed: progress.completed,
          total: progress.total,
          currentIndex: progress.currentIndex,
        });
      },
    });

    assert.equal(progressSnapshots.at(-1)?.completed, 2);
    assert.equal(progressSnapshots.at(-1)?.total, 2);
    assert.equal(
      formatBatchProgressLabel({ total: 2, completed: 1, currentIndex: 2 }),
      "Analyzing 2 of 2 sheets",
    );
    assert.equal(batchProgressPercent({ total: 2, completed: 1, currentIndex: 2 }), 50);
  });

  it("uses sheet terminology for analysis progress labels", () => {
    assert.equal(
      formatBatchProgressLabel({ total: 33, completed: 30, currentIndex: 31 }),
      "Analyzing 31 of 33 sheets",
    );
    assert.equal(
      formatBatchProgressLabel({ total: 33, completed: 33, currentIndex: 33 }),
      "33 of 33 sheets analyzed",
    );
    assert.doesNotMatch(formatBatchProgressLabel({ total: 33, completed: 30, currentIndex: 31 }), /document/i);
  });

  it("shows failed sheet counts separately when analysis completes with failures", () => {
    assert.equal(
      formatBatchProgressLabel({ total: 33, completed: 33, currentIndex: 33, failed: 3 }),
      "30 completed, 3 failed — 33 total sheets",
    );
    assert.equal(
      formatBatchProgressLabel({ total: 13, completed: 2, currentIndex: 3 }, { retrying: true }),
      "Retrying 3 of 13 sheets",
    );
    assert.deepEqual(formatAnalysisCompletionToast({ total: 33, succeeded: 30, failed: 3 }), {
      type: "warning",
      message: "30 completed, 3 failed — 33 total sheets",
    });
    assert.doesNotMatch(
      formatBatchProgressLabel({ total: 33, completed: 33, currentIndex: 33, failed: 3 }),
      /document/i,
    );
  });

  it("refuses to silently analyze only page 1 of an unexpanded PDF", async () => {
    const files = [makeBatchFile("plan.pdf", { file: makeFile("plan.pdf", "application/pdf") })];

    const result = await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: "proj",
      canPersist: true,
      uploadDocument: async () => {
        throw new Error("should not upload an unexpanded PDF");
      },
      requestAnalysis: async () => {
        throw new Error("should not analyze an unexpanded PDF");
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(result.failed, 1);
    assert.equal(files[0].status, "failed");
    assert.match(files[0].error ?? "", /expanded into individual page images/i);
  });

  it("analyzes each prepared PDF page image and keeps page numbers associated", async () => {
    const files = [
      makeBatchFile("plan-page1.png", {
        file: makeFile("plan-page1.png"),
        preparedImageFile: makeFile("plan-page1.png"),
        documentId: "img-1",
        sourceDocumentId: "pdf-1",
        pageNumber: 1,
        sheetId: "sheet-1",
      }),
      makeBatchFile("plan-page2.png", {
        file: makeFile("plan-page2.png"),
        preparedImageFile: makeFile("plan-page2.png"),
        documentId: "img-2",
        sourceDocumentId: "pdf-1",
        pageNumber: 2,
        sheetId: "sheet-2",
      }),
    ];
    const analyzedPages: number[] = [];
    const savedPages: number[] = [];

    const result = await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: "proj",
      canPersist: true,
      uploadDocument: async () => {
        throw new Error("page images are already persisted");
      },
      requestAnalysis: async () => {
        return {
          issues: [],
          summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
          jurisdictionNotes: "",
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async (_result, documentId, _projectId, sheet) => {
        savedPages.push(sheet?.pageNumber ?? 0);
        analyzedPages.push(Number(documentId.replace("img-", "")));
      },
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(result.succeeded, 2);
    assert.deepEqual(savedPages, [1, 2]);
    assert.equal(files[0].pageNumber, 1);
    assert.equal(files[1].pageNumber, 2);
    assert.equal(files[0].sourceDocumentId, "pdf-1");
    assert.equal(files[1].sourceDocumentId, "pdf-1");
  });

  it("fetches sheet images lazily one at a time via fetchSheetImage", async () => {
    let concurrentFetches = 0;
    let maxConcurrent = 0;
    const fetchOrder: string[] = [];

    const files: ComplianceBatchFile[] = [
      {
        id: "s1",
        fileName: "a.png",
        discipline: "general",
        status: "pending",
        documentId: "doc-1",
      },
      {
        id: "s2",
        fileName: "b.png",
        discipline: "general",
        status: "pending",
        documentId: "doc-2",
      },
    ];

    await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: "proj-1",
      canPersist: true,
      uploadDocument: async () => {
        throw new Error("persisted sheets should not re-upload");
      },
      fetchSheetImage: async (item) => {
        concurrentFetches += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrentFetches);
        fetchOrder.push(item.fileName!);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrentFetches -= 1;
        const f = makeFile(item.fileName!);
        return { file: f, preparedImageFile: f };
      },
      requestAnalysis: async () => ({
        issues: [],
        summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
        jurisdictionNotes: "",
      }),
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(maxConcurrent, 1);
    assert.deepEqual(fetchOrder, ["a.png", "b.png"]);
    assert.equal(files[0].status, "completed");
    assert.equal(files[0].file, undefined);
    assert.equal(files[0].preparedImageFile, undefined);
    assert.equal(files[0].fileName, "a.png");
  });

  it("tracks completed and failed counts", () => {
    const files = [
      makeBatchFile("a.png", { status: "completed" }),
      makeBatchFile("b.png", { status: "failed" }),
      makeBatchFile("c.png", { status: "pending" }),
    ];
    assert.equal(countCompletedBatchFiles(files), 1);
    assert.equal(countFailedBatchFiles(files), 1);
  });

  it("allows removing pending or failed files before a new run", () => {
    assert.equal(canRemoveBatchFile("pending"), true);
    assert.equal(canRemoveBatchFile("analyzing"), false);
    assert.equal(canRemoveBatchFile("completed"), false);
    assert.equal(canRemoveBatchFile("failed"), true);
  });

  it("forces overallScore 100 when issues are empty (ignores AI-echoed 85)", () => {
    assert.equal(
      computeComplianceOverallScore({ critical: 0, warnings: 0, advisory: 0, totalIssues: 0 }),
      100,
    );
    const normalized = normalizeComplianceAnalysisResult(
      {
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          warnings: 0,
          advisory: 0,
          overallScore: 85,
        },
        jurisdictionNotes: "",
      },
      "ibc",
    );
    assert.equal(normalized.summary.totalIssues, 0);
    assert.equal(normalized.summary.overallScore, 100);
  });

  it("keeps a numeric AI score when issues are present", () => {
    const normalized = normalizeComplianceAnalysisResult(
      {
        issues: [
          {
            id: "1",
            category: "Egress",
            title: "t",
            description: "d",
            severity: "warning",
            codeReference: "IBC",
            codeYear: "2021",
            location: "l",
            suggestedFix: "f",
          },
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          warnings: 1,
          advisory: 0,
          overallScore: 92,
        },
      },
      "ibc",
    );
    assert.equal(normalized.summary.totalIssues, 1);
    assert.equal(normalized.summary.warnings, 1);
    assert.equal(normalized.summary.overallScore, 92);
  });

  it("categorizes analysis errors for user-facing messages", () => {
    assert.equal(categorizeAnalysisError("HTTP 429 rate limit exceeded"), "rate_limit");
    assert.equal(categorizeAnalysisError("Request timed out after 120s"), "timeout");
    assert.equal(categorizeAnalysisError("Invalid image format"), "unsupported_image");
    assert.equal(
      categorizeAnalysisError("The AI model could not analyze this drawing. Try a clearer plan sheet."),
      "parse",
    );
    assert.equal(
      formatAnalysisErrorMessage("503 Service Unavailable"),
      "Temporary analysis service error — retry this sheet.",
    );
    assert.equal(
      formatAnalysisErrorMessage("The AI model could not analyze this drawing."),
      "The AI model could not analyze this sheet — try a clearer export or retry.",
    );
  });

  it("retries only failed persisted sheets via fetchSheetImage (13 calls, not 21)", async () => {
    const failedSheets = Array.from({ length: 13 }, (_, i) => ({
      id: `sheet-fail-${i}`,
      fileName: `fail-${i}.png`,
      discipline: "general" as const,
      status: "failed" as const,
      documentId: `doc-${i}`,
      sheetId: `sheet-fail-${i}`,
      pageNumber: 1,
      sourceDocumentId: `src-${i}`,
    }));
    const completedSheets = Array.from({ length: 21 }, (_, i) => ({
      id: `sheet-ok-${i}`,
      fileName: `ok-${i}.png`,
      discipline: "general" as const,
      status: "completed" as const,
      documentId: `doc-ok-${i}`,
    }));
    const files = [...completedSheets, ...failedSheets];
    let analyzeCalls = 0;
    let fetchCalls = 0;

    await processComplianceBatch({
      files,
      onlyFailed: true,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: "proj-1",
      canPersist: true,
      uploadDocument: async () => {
        throw new Error("should not re-upload on retry");
      },
      fetchSheetImage: async (item) => {
        fetchCalls += 1;
        const f = makeFile(item.fileName ?? "retry.png");
        return { file: f, preparedImageFile: f };
      },
      requestAnalysis: async () => {
        analyzeCalls += 1;
        return {
          issues: [],
          summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
          jurisdictionNotes: "",
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(analyzeCalls, 13);
    assert.equal(fetchCalls, 13);
    assert.equal(files.filter((f) => f.status === "completed").length, 34);
  });

  it("auto-retries transient analysis failures with bounded attempts", async () => {
    const files = [makeBatchFile("retry.png")];
    let analyzeCalls = 0;

    await processComplianceBatch({
      files,
      analysisMode: "ibc",
      hasLocalAmendments: false,
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      projectId: null,
      canPersist: false,
      uploadDocument: async () => null,
      pdfFirstPageToImageFile: async (file) => file,
      requestAnalysis: async () => {
        analyzeCalls += 1;
        if (analyzeCalls < 3) throw new Error("503 Service Unavailable");
        return {
          issues: [],
          summary: { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 100 },
          jurisdictionNotes: "",
        };
      },
      readFileAsBase64: mockBase64(),
      saveAnalysisToDb: async () => {},
      onFileUpdate: (id, patch) => {
        const file = files.find((f) => f.id === id);
        if (file) Object.assign(file, patch);
      },
      onProgress: () => {},
    });

    assert.equal(analyzeCalls, 3);
    assert.equal(files[0].status, "completed");
  });
});
