import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLIANCE_MAX_BATCH_FILES,
  mergeComplianceFiles,
} from "./complianceUploadLimits.ts";
import {
  batchProgressPercent,
  canRemoveBatchFile,
  computeComplianceOverallScore,
  countCompletedBatchFiles,
  countFailedBatchFiles,
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
    assert.equal(formatBatchProgressLabel({ total: 2, completed: 1, currentIndex: 2 }), "Analyzing 2 of 2");
    assert.equal(batchProgressPercent({ total: 2, completed: 1, currentIndex: 2 }), 50);
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
});
