import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import phase2bCriticalRegression from "../../../eval/drawing-dataset/fixtures/phase2b-critical-regression.json" with { type: "json" };
import { buildAnalyzerUserPrompt, validateAnalyzerFindings } from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import {
  CROSS_SHEET_RETRIEVAL_BOUNDS,
  crossSheetRetrievalAuditMetadata,
  detectCrossSheetReferences,
  formatCrossSheetEvidencePrompt,
  isCrossSheetRetrievalEnabled,
  resolveSheetJobsForReferences,
  retrieveCrossSheetEvidence,
  selectSupportingExcerpt,
  type RetrievableSheetJob,
} from "../../../supabase/functions/_shared/analyzerCrossSheetRetrieval.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sheetJobs: RetrievableSheetJob[] = [
  {
    fileName: "A-1.03-00.pdf",
    detectedSheetNumber: "A-1.03-00",
    objectPath: "proj/run/a103.pdf",
    sheetJobId: "job-a103",
  },
  {
    fileName: "A-6.01.00.pdf",
    detectedSheetNumber: "A-6.01",
    objectPath: "proj/run/a601.pdf",
    sheetJobId: "job-a601",
  },
  {
    fileName: "M-3.0.pdf",
    detectedSheetNumber: "M-3.0",
    objectPath: "proj/run/m30.pdf",
    sheetJobId: "job-m30",
  },
  {
    fileName: "S-201.00.pdf",
    detectedSheetNumber: "S-201.00",
    objectPath: "proj/run/s201.pdf",
    sheetJobId: "job-s201",
  },
];

describe("Phase 3A cross-sheet retrieval feature flag", () => {
  it("defaults off and enables only for explicit true", () => {
    assert.equal(isCrossSheetRetrievalEnabled({ get: () => undefined }), false);
    assert.equal(isCrossSheetRetrievalEnabled({ get: () => "false" }), false);
    assert.equal(isCrossSheetRetrievalEnabled({ get: () => "true" }), true);
    assert.equal(isCrossSheetRetrievalEnabled({ get: () => "TRUE" }), true);
  });
});

describe("Phase 3A reference detection and resolution", () => {
  it("detects SEE SHEET / SEE DETAIL references with context", () => {
    const refs = detectCrossSheetReferences(
      "Absence of detailed penetration sections. SEE SHEET A-6.01 FOR CEILING FINISHES. Also SEE DETAIL 3 ON DRAWING M3.0 for refrigerant lines.",
    );
    const keys = refs.map((item) => item.key).sort();
    assert.deepEqual(keys, ["A6.01", "M3.0"]);
    assert.equal(refs.find((item) => item.key === "M3.0")?.detailNumber, "3");
  });

  it("resolves references against the submitted run sheet jobs", () => {
    const refs = detectCrossSheetReferences("SEE SHEET A-6.01 FOR CEILING FINISHES.");
    const resolved = resolveSheetJobsForReferences(refs, sheetJobs, "A-1.03-00.pdf");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].job?.fileName, "A-6.01.00.pdf");
    assert.equal(resolved[0].job?.objectPath, "proj/run/a601.pdf");
  });

  it("leaves missing references unresolved without inventing a sheet", () => {
    const refs = detectCrossSheetReferences("SEE DETAIL 2 ON DRAWING Z-9.99.");
    const resolved = resolveSheetJobsForReferences(refs, sheetJobs, "A-1.03-00.pdf");
    assert.equal(resolved[0].job, null);
  });
});

describe("Phase 3A bounded excerpt selection", () => {
  it("prefers hint-matching lines and stays within bounds", () => {
    const text = [
      "TITLE BLOCK M-3.0 MECHANICAL DETAILS",
      "RANDOM EQUIPMENT SCHEDULE LINE",
      "DETAIL 3 REFRIGERANT LINE INSULATION ARMAFLEX 1/2 IN",
      "UNRELATED NOTES ABOUT PAINT",
      "KEYED NOTE CONTINUES INSULATION THICKNESS",
    ].join("\n");
    const selected = selectSupportingExcerpt(text, ["detail 3", "insulat", "refrigerant"], 180);
    assert.match(selected.excerpt, /DETAIL 3|INSULATION|ARMAFLEX/i);
    assert.ok(selected.excerpt.length <= 180);
    assert.ok(selected.matchedHints.length >= 1);
  });
});

describe("Phase 3A retrieveCrossSheetEvidence", () => {
  it("returns disabled pack without downloading when flag is off", async () => {
    let downloads = 0;
    const pack = await retrieveCrossSheetEvidence({
      enabled: false,
      currentFileName: "A-1.03-00.pdf",
      currentPdfBytes: new Uint8Array([1, 2, 3]),
      sheetJobs,
      deps: {
        downloadPdf: async () => {
          downloads += 1;
          return new Uint8Array();
        },
      },
    });
    assert.equal(pack.status, "disabled");
    assert.equal(pack.promptBlock, "");
    assert.equal(downloads, 0);
  });

  it("retrieves bounded excerpts for C-001 style SEE SHEET references", async () => {
    const pack = await retrieveCrossSheetEvidence({
      enabled: true,
      currentFileName: "A-1.03-00.pdf",
      currentPdfBytes: new Uint8Array([1]),
      sheetJobs,
      deps: {
        extractPdfText: async (bytes) => {
          if (bytes[0] === 1) {
            return {
              pageCount: 1,
              text: "RCP notes. SEE SHEET A-6.01 FOR CEILING FINISHES AND PENETRATION DETAILS.",
              lowText: false,
            };
          }
          return {
            pageCount: 1,
            text: "A-6.01 CEILING DETAILS\nPENETRATION SECTION AT FIRESTOP AT SPRINKLER AND DUCT THROUGH RATED CEILING",
            lowText: false,
          };
        },
        downloadPdf: async (objectPath) => {
          assert.equal(objectPath, "proj/run/a601.pdf");
          return new Uint8Array([6]);
        },
      },
    });
    assert.equal(pack.status, "retrieved");
    assert.equal(pack.sheets[0]?.status, "retrieved");
    assert.match(pack.sheets[0]?.excerpt || "", /PENETRATION|FIRESTOP|CEILING/i);
    assert.match(pack.promptBlock, /machine-extracted/);
    assert.match(pack.promptBlock, /not verified code compliance/i);
    assert.equal(pack.sheets[0]?.provenance, "machine_extracted_text_layer");
  });

  it("retrieves M-3.0 context for C-003 style SEE DETAIL references", async () => {
    const pack = await retrieveCrossSheetEvidence({
      enabled: true,
      currentFileName: "M-1.4.pdf",
      currentPdfBytes: new Uint8Array([1]),
      sheetJobs,
      deps: {
        extractPdfText: async (bytes) => {
          if (bytes[0] === 1) {
            return {
              pageCount: 1,
              text: "KEYED NOTE 1: REFRIGERANT LINES UP THROUGH ROOF - SEE DETAIL 3 ON DRAWING M3.0.",
              lowText: false,
            };
          }
          return {
            pageCount: 1,
            text: "DETAIL 3 - REFRIGERANT PIPE INSULATION SHALL BE ARMAFLEX 3/4 IN THICK",
            lowText: false,
          };
        },
        downloadPdf: async () => new Uint8Array([3]),
      },
    });
    assert.ok(pack.sheets.some((sheet) => sheet.fileName === "M-3.0.pdf" && /ARMAFLEX|INSULATION/i.test(sheet.excerpt)));
  });

  it("records empty-text and download failures without inventing content", async () => {
    const pack = await retrieveCrossSheetEvidence({
      enabled: true,
      currentFileName: "A-1.03-00.pdf",
      currentPdfBytes: new Uint8Array([1]),
      sheetJobs,
      deps: {
        extractPdfText: async (bytes) => {
          if (bytes[0] === 1) {
            return {
              pageCount: 1,
              text: "SEE SHEET A-6.01 AND SEE DETAIL 1 ON DRAWING M-3.0",
              lowText: false,
            };
          }
          if (bytes[0] === 6) {
            return { pageCount: 1, text: "   ", lowText: true };
          }
          throw new Error("extract boom");
        },
        downloadPdf: async (objectPath) => {
          if (objectPath.includes("a601")) return new Uint8Array([6]);
          throw new Error("storage unavailable");
        },
      },
    });
    assert.equal(pack.status, "partial");
    assert.ok(pack.sheets.some((sheet) => sheet.status === "empty_text"));
    assert.ok(pack.sheets.some((sheet) => sheet.status === "download_failed"));
    assert.doesNotMatch(pack.promptBlock, /\bcompliant\b/i);
    assert.match(pack.promptBlock, /status=empty_text|status=download_failed/);
  });

  it("fails open when current-sheet extraction throws", async () => {
    const pack = await retrieveCrossSheetEvidence({
      enabled: true,
      currentFileName: "A-1.03-00.pdf",
      currentPdfBytes: new Uint8Array([1]),
      sheetJobs,
      deps: {
        extractPdfText: async () => {
          throw new Error("unpdf unavailable");
        },
        downloadPdf: async () => new Uint8Array(),
      },
    });
    assert.equal(pack.status, "failed");
    assert.equal(pack.promptBlock, "");
    assert.match(pack.notes.join(" "), /failed open|unpdf unavailable/i);
  });

  it("respects max sheet bound", async () => {
    assert.equal(CROSS_SHEET_RETRIEVAL_BOUNDS.maxSheets, 3);
    const manyJobs: RetrievableSheetJob[] = [
      ...sheetJobs,
      { fileName: "E-1.1-00.pdf", detectedSheetNumber: "E-1.1-00", objectPath: "proj/run/e11.pdf" },
      { fileName: "P-3.0.pdf", detectedSheetNumber: "P-3.0", objectPath: "proj/run/p30.pdf" },
    ];
    let downloads = 0;
    const pack = await retrieveCrossSheetEvidence({
      enabled: true,
      currentFileName: "G-0.00-00.pdf",
      currentPdfBytes: new Uint8Array([1]),
      sheetJobs: manyJobs,
      deps: {
        extractPdfText: async (bytes) => {
          if (bytes[0] === 1) {
            return {
              pageCount: 1,
              text: "SEE SHEET A-6.01. SEE DRAWING M-3.0. SEE SHEET S-201.00. SEE SHEET E-1.1-00. SEE SHEET P-3.0.",
              lowText: false,
            };
          }
          return { pageCount: 1, text: "SUPPORTING NOTE CONTENT ON REFERENCED SHEET", lowText: false };
        },
        downloadPdf: async () => {
          downloads += 1;
          return new Uint8Array([9]);
        },
      },
    });
    assert.ok(downloads <= CROSS_SHEET_RETRIEVAL_BOUNDS.maxSheets);
    assert.ok(pack.sheets.length <= CROSS_SHEET_RETRIEVAL_BOUNDS.maxSheets);
  });
});

describe("Phase 3A prompt assembly and Phase 2B coexistence", () => {
  it("appends provenance-tagged excerpts only when provided", () => {
    const baseline = buildAnalyzerUserPrompt("A-1.03-00.pdf", sheetJobs);
    assert.equal(baseline.includes("Supporting excerpts"), false);
    const enhanced = buildAnalyzerUserPrompt("A-1.03-00.pdf", sheetJobs, {
      crossSheetEvidence: formatCrossSheetEvidencePrompt({
        status: "retrieved",
        notes: [],
        sheets: [{
          fileName: "A-6.01.00.pdf",
          detectedSheetNumber: "A-6.01",
          objectPath: "proj/run/a601.pdf",
          sheetJobId: "job-a601",
          status: "retrieved",
          pageCount: 1,
          excerpt: "PENETRATION FIRESTOP DETAIL",
          provenance: "machine_extracted_text_layer",
          matchedHints: ["penetration"],
          error: null,
        }],
      }),
    });
    assert.match(enhanced, /Supporting excerpts from referenced sheets/);
    assert.match(enhanced, /PENETRATION FIRESTOP DETAIL/);
    assert.match(enhanced, /machine_extracted_text_layer|provenance=/);
  });

  it("keeps C-001–C-004 and positive Critical controls under Phase 2B rules", () => {
    const provisionalSheetIndex = phase2bCriticalRegression.sheetIndexForProvisional || [];
    for (const item of phase2bCriticalRegression.cases) {
      const result = validateAnalyzerFindings([item.draft as never], {
        analysisMode: "both",
        jurisdictionKey: "dc",
        jurisdictionLabel: "Washington D.C. (12A DCMR)",
        codeEdition: "2017",
        codeContext: "2017 DC Construction Codes (2015 IBC base)",
        sheetIndex: provisionalSheetIndex,
        sheetDiscipline: item.draft.category,
      });
      assert.equal(result.published[0]?.severity, item.expectSeverity, item.id);
      assert.equal(result.withheld.length, 0, item.id);
    }
    for (const item of phase2bCriticalRegression.positiveControls || []) {
      const result = validateAnalyzerFindings([item.draft as never], {
        analysisMode: "both",
        jurisdictionKey: "dc",
        jurisdictionLabel: "Washington D.C. (12A DCMR)",
        codeEdition: "2017",
        codeContext: "2017 DC Construction Codes (2015 IBC base)",
        sheetIndex: provisionalSheetIndex,
        sheetDiscipline: item.draft.category,
      });
      assert.equal(result.published[0]?.severity, "critical", item.id);
      assert.equal(result.withheld.length, 0, item.id);
    }
  });

  it("records retrieval audit metadata without claiming verification", () => {
    const meta = crossSheetRetrievalAuditMetadata({
      version: "phase3a.cross-sheet-retrieval.v1",
      enabled: true,
      status: "partial",
      latencyMs: 42,
      references: [],
      sheets: [],
      promptBlock: "",
      notes: ["bounded"],
    });
    assert.equal(meta.cross_sheet_retrieval_enabled, true);
    assert.equal(meta.cross_sheet_retrieval_latency_ms, 42);
    assert.equal(meta.cross_sheet_retrieval_status, "partial");
  });

  it("wires the processor to fail-open retrieval and keep validateAnalyzerFindings", () => {
    const processor = readFileSync(
      join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"),
      "utf8",
    );
    assert.match(processor, /retrieveCrossSheetEvidence\(/);
    assert.match(processor, /isCrossSheetRetrievalEnabled\(/);
    assert.match(processor, /crossSheetRetrievalAuditMetadata\(/);
    assert.match(processor, /failed open/);
    assert.match(processor, /validateAnalyzerFindings\(/);
    assert.match(processor, /select\("id, original_file_name, detected_sheet_number, detected_sheet_title, discipline, object_path"\)/);
    assert.equal(processor.includes("AI CODE ANALYZER V2"), false);
  });
});
