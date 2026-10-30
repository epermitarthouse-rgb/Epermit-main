import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import phase2bCriticalRegression from "../../../eval/drawing-dataset/fixtures/phase2b-critical-regression.json" with { type: "json" };
import {
  buildAnalyzerUserPrompt,
  validateAnalyzerFindings,
  type DraftAnalyzerFinding,
} from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import {
  VISUAL_EVIDENCE_BOUNDS,
  VISUAL_EVIDENCE_VERSION,
  assessDoorFromText,
  assessGuardrailFromText,
  assessHydraulicFromText,
  buildVisualEvidenceLookForChecklist,
  buildVisualEvidencePacks,
  classifyVisualEvidenceTopics,
  formatVisualEvidencePrompt,
  isVisualEvidenceEnabled,
  retrieveVisualEvidence,
  visualEvidenceAuditMetadata,
} from "../../../supabase/functions/_shared/analyzerVisualEvidence.ts";
import { isCrossSheetRetrievalEnabled } from "../../../supabase/functions/_shared/analyzerCrossSheetRetrieval.ts";
import { legacySupabaseAnalyzerPrompt } from "../../../supabase/functions/_shared/analyzerReviewScope.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const A6_TEXT = [
  "DOOR SCHEDULE",
  "MARK DOOR 11 TYPE A",
  "1 EA PANIC HARDWARE V. DUPRIN",
  "1 EA LOCKSET SCHLAGE",
  "PROVIDE FIRE-RATED GASKETS FOR DOOR",
  "EXIT DOORS SHALL REMAIN UNLOCKED WHENEVER THE BUILDING IS OCCUPIED",
  "SEE DETAIL 2 ON DRAWING A-6.00",
].join("\n");

const A306_TEXT = [
  "WALL SECTION DETAIL 4",
  "PIPE RAILING AT ROOF GUARD RAIL",
  "3'-6\" MIN. HEIGHT",
  "EXTEND GUARD TO ADJACENT WALL",
].join("\n");

const FP200_TEXT = [
  "HYDRAULIC DESIGN INFORMATION",
  "DENSITY 0.15 GPM/FT2",
  "DISCHARGE AREA 1524",
  "HOSE ALLOWANCE 100 GPM",
  "FLOW DEMAND 328.6 GPM",
  "PRESSURE DEMAND 78 PSI",
].join("\n");

function context() {
  const fixture = phase2bCriticalRegression as {
    validationContext?: Record<string, unknown>;
    sheetIndexForProvisional?: Array<Record<string, unknown>>;
  };
  return {
    analysisMode: (fixture.validationContext?.analysisMode || "full_set") as never,
    jurisdictionKey: String(fixture.validationContext?.jurisdictionKey || "dc"),
    jurisdictionLabel: String(fixture.validationContext?.jurisdictionLabel || "District of Columbia"),
    codeEdition: String(fixture.validationContext?.codeEdition || "2017"),
    codeContext: String(fixture.validationContext?.codeContext || "2017 DC Construction Codes"),
    sheetIndex: (fixture.sheetIndexForProvisional || []) as never,
  };
}

function envMap(entries: Record<string, string | undefined>): { get(key: string): string | undefined } {
  return { get: (key) => entries[key] };
}

describe("Phase 3 visual evidence feature flag", () => {
  it("defaults off and enables only for explicit true", () => {
    assert.equal(isVisualEvidenceEnabled({ get: () => undefined }), false);
    assert.equal(isVisualEvidenceEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "false" })), false);
    assert.equal(isVisualEvidenceEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "true" })), true);
    assert.equal(isVisualEvidenceEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "TRUE" })), true);
    assert.equal(
      isVisualEvidenceEnabled(envMap({ SUPABASE_ANALYZER_VISUAL_EVIDENCE: "true" })),
      true,
      "legacy SUPABASE_ name still accepted",
    );
  });

  it("stays independent of cross-sheet retrieval flag", () => {
    assert.equal(isVisualEvidenceEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "true" })), true);
    assert.equal(isCrossSheetRetrievalEnabled(envMap({ ANALYZER_VISUAL_EVIDENCE: "true" })), false);
    assert.equal(
      isCrossSheetRetrievalEnabled(envMap({
        ANALYZER_VISUAL_EVIDENCE: "true",
        ANALYZER_CROSS_SHEET_RETRIEVAL: "false",
      })),
      false,
    );
    assert.equal(
      isVisualEvidenceEnabled(envMap({ ANALYZER_CROSS_SHEET_RETRIEVAL: "true" })),
      false,
      "CSR alone must not enable visual evidence",
    );
  });

  it("preserves baseline user prompt construction when visual evidence is disabled", async () => {
    const sheets = [{ fileName: "A-6.00-00.pdf", detectedSheetNumber: "A-6.00" }];
    const baseline = buildAnalyzerUserPrompt("A-6.00-00.pdf", sheets);
    const off = await retrieveVisualEvidence({
      enabled: false,
      fileName: "A-6.00-00.pdf",
      pdfBytes: new Uint8Array([1]),
      deps: {
        extractPdfText: async () => {
          throw new Error("must not extract when disabled");
        },
      },
    });
    const withOff = buildAnalyzerUserPrompt("A-6.00-00.pdf", sheets, {
      visualEvidence: off.promptBlock || null,
      crossSheetEvidence: null,
    });
    assert.equal(off.status, "disabled");
    assert.equal(off.promptBlock, "");
    assert.equal(withOff, baseline);
    assert.doesNotMatch(withOff, /Visual evidence look-for|Bounded sheet-local evidence packs/);
  });

  it("evaluates Stage 1 checklist and Stage 2 packs separately without a second flag", () => {
    const checklist = buildVisualEvidenceLookForChecklist("FP200 .pdf", ["hydraulic_design"]);
    const packs = buildVisualEvidencePacks({
      fileName: "FP200 .pdf",
      text: FP200_TEXT,
      topics: ["hydraulic_design"],
    });
    assert.match(checklist, /Hydraulic design box/);
    assert.equal(packs[0]?.status, "recovered");
    const stage1Only = formatVisualEvidencePrompt({
      checklistBlock: checklist,
      packs: [],
      status: "checklist_only",
      notes: [],
      sheetFileName: "FP200 .pdf",
    });
    const stage12 = formatVisualEvidencePrompt({
      checklistBlock: checklist,
      packs,
      status: "recovered",
      notes: [],
      sheetFileName: "FP200 .pdf",
    });
    assert.match(stage1Only, /look-for/);
    assert.doesNotMatch(stage1Only, /Bounded sheet-local evidence packs/);
    assert.match(stage12, /Bounded sheet-local evidence packs/);
    assert.match(stage12, /FLOW DEMAND|flowDemand/i);
  });
});

describe("Phase 3 Stage 1 look-for checklist", () => {
  it("classifies A-6.00 / A-3.06 / FP200 topics from filename and text", () => {
    assert.deepEqual(
      classifyVisualEvidenceTopics("A-6.00-00.pdf", A6_TEXT),
      ["door_schedule_and_hardware"],
    );
    assert.deepEqual(
      classifyVisualEvidenceTopics("A-3.06-00.pdf", A306_TEXT),
      ["guardrail_height"],
    );
    assert.deepEqual(
      classifyVisualEvidenceTopics("FP200 .pdf", FP200_TEXT),
      ["hydraulic_design"],
    );
  });

  it("builds quote-before-absence checklist for classified topics", () => {
    const checklist = buildVisualEvidenceLookForChecklist("A-6.00-00.pdf", [
      "door_schedule_and_hardware",
    ]);
    assert.match(checklist, /quote before claiming Critical absence|Before claiming Critical absence/i);
    assert.match(checklist, /Door schedule|locking|fire-rated/i);
    assert.match(checklist, /not verified compliance/i);
  });

  it("system prompt documents visual evidence packs without enabling them", () => {
    const prompt = legacySupabaseAnalyzerPrompt({
      jurisdiction_label: "District of Columbia",
      code_context: "2017 DC Construction Codes",
      project_type: "commercial",
      jurisdiction_key: "dc",
      code_edition: "2017",
    });
    assert.match(prompt, /visual evidence look-for checklist|evidence packs/i);
    assert.match(prompt, /Never downgrade a Critical finding solely because visual evidence retrieval failed/);
  });
});

describe("Phase 3 Stage 2 text-layer packs", () => {
  it("recovers door hardware and fire language from A-6.00-shaped text", () => {
    const packs = buildVisualEvidencePacks({
      fileName: "A-6.00-00.pdf",
      text: A6_TEXT,
      topics: ["door_schedule_and_hardware"],
    });
    assert.equal(packs.length, 1);
    assert.equal(packs[0].status, "recovered");
    assert.ok(packs[0].extractedTexts.some((text) => /PANIC|LOCKSET/i.test(text)));
    assert.ok(packs[0].extractedTexts.some((text) => /FIRE-RATED|GASKETS/i.test(text)));
    assert.equal(packs[0].provenance.independentlyVerified, false);
    const door = assessDoorFromText(packs[0].extractedTexts);
    assert.equal(door.lockingHardwareQuoted, true);
    assert.equal(door.fireRatingLanguageQuoted, true);
  });

  it("associates 3'-6\" MIN HEIGHT with guardrail language for A-3.06", () => {
    const packs = buildVisualEvidencePacks({
      fileName: "A-3.06-00.pdf",
      text: A306_TEXT,
      topics: ["guardrail_height"],
    });
    assert.equal(packs[0].status, "recovered");
    assert.ok(packs[0].extractedTexts.some((text) => /3\s*['′]\s*-?\s*6/i.test(text)));
    const assessment = assessGuardrailFromText(packs[0].extractedTexts);
    assert.equal(assessment.status, "associated_candidate");
    assert.equal(assessment.applicableToGuardrail, "likely_same_detail_candidate");
  });

  it("does not auto-clear height from generic MIN HEIGHT without guard language", () => {
    const assessment = assessGuardrailFromText(["WINDOW SILL 3'-6\" MIN. HEIGHT"]);
    assert.equal(assessment.status, "found_unassociated");
    assert.equal(assessment.applicableToGuardrail, "unresolved");
  });

  it("recovers FP200 hydraulic values and preserves density×area ≠ flow demand", () => {
    const packs = buildVisualEvidencePacks({
      fileName: "FP200 .pdf",
      text: FP200_TEXT,
      topics: ["hydraulic_design"],
    });
    assert.equal(packs[0].status, "recovered");
    const assessment = assessHydraulicFromText(FP200_TEXT);
    const values = assessment.values as Record<string, number | null>;
    assert.equal(values.densityGpmPerSqFt, 0.15);
    assert.equal(values.dischargeAreaSqFt, 1524);
    assert.equal(values.hoseAllowanceGpm, 100);
    assert.equal(values.flowDemandGpm, 328.6);
    assert.ok(values.densityTimesArea != null);
    assert.equal(
      (assessment.relationships as { densityAreaEqualsFlowDemand: boolean | null })
        .densityAreaEqualsFlowDemand,
      false,
    );
  });

  it("marks sparse CAD text honestly without inventing excerpts", () => {
    const packs = buildVisualEvidencePacks({
      fileName: "A-6.00-00.pdf",
      text: "TITLE A-6.00",
      topics: ["door_schedule_and_hardware"],
      lowText: true,
    });
    assert.equal(packs[0].status, "sparse_text");
    assert.equal(packs[0].extractedTexts.length, 0);
    assert.ok(packs[0].limitations.some((item) => /sparse/i.test(item)));
  });

  it("bounds packs and total prompt characters", () => {
    assert.equal(VISUAL_EVIDENCE_BOUNDS.maxPacks, 3);
    assert.equal(VISUAL_EVIDENCE_BOUNDS.maxTotalChars, 2500);
    const packs = buildVisualEvidencePacks({
      fileName: "A-6.00-00.pdf",
      text: A6_TEXT,
      topics: ["door_schedule_and_hardware", "guardrail_height", "hydraulic_design"],
    });
    assert.ok(packs.length <= VISUAL_EVIDENCE_BOUNDS.maxPacks);
    const chars = packs.reduce((sum, pack) => sum + pack.charCount, 0);
    assert.ok(chars <= VISUAL_EVIDENCE_BOUNDS.maxTotalChars);
  });

  it("uses stable pack ids across identical inputs", () => {
    const first = buildVisualEvidencePacks({
      fileName: "A-6.00-00.pdf",
      text: A6_TEXT,
      topics: ["door_schedule_and_hardware"],
    });
    const second = buildVisualEvidencePacks({
      fileName: "A-6.00-00.pdf",
      text: A6_TEXT,
      topics: ["door_schedule_and_hardware"],
    });
    assert.equal(first[0].id, second[0].id);
  });
});

describe("Phase 3 retrieveVisualEvidence fail-open", () => {
  it("returns disabled pack without extracting when flag is off", async () => {
    let extracts = 0;
    const result = await retrieveVisualEvidence({
      enabled: false,
      fileName: "A-6.00-00.pdf",
      pdfBytes: new Uint8Array([1, 2, 3]),
      deps: {
        extractPdfText: async () => {
          extracts += 1;
          return { pageCount: 1, text: A6_TEXT, lowText: false };
        },
      },
    });
    assert.equal(result.status, "disabled");
    assert.equal(result.promptBlock, "");
    assert.equal(extracts, 0);
  });

  it("builds prompt block with checklist and recovered packs when enabled", async () => {
    const result = await retrieveVisualEvidence({
      enabled: true,
      fileName: "FP200 .pdf",
      pdfBytes: new Uint8Array([1]),
      deps: {
        extractPdfText: async () => ({ pageCount: 1, text: FP200_TEXT, lowText: false }),
      },
    });
    assert.equal(result.enabled, true);
    assert.equal(result.status, "recovered");
    assert.match(result.promptBlock, /Visual evidence look-for/);
    assert.match(result.promptBlock, /hydraulic_design/);
    assert.match(result.promptBlock, /independentlyVerified=false/);
    assert.match(result.version, /phase3\.visual-evidence/);
    assert.equal(result.version, VISUAL_EVIDENCE_VERSION);
  });

  it("fails open when extract throws and does not populate prompt", async () => {
    const result = await retrieveVisualEvidence({
      enabled: true,
      fileName: "A-6.00-00.pdf",
      pdfBytes: new Uint8Array([1]),
      deps: {
        extractPdfText: async () => {
          throw new Error("boom");
        },
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.promptBlock, "");
    assert.ok(result.notes.some((note) => /failed open/i.test(note)));
  });

  it("injects visual evidence into user prompt without OCR claims", () => {
    const block = formatVisualEvidencePrompt({
      checklistBlock: buildVisualEvidenceLookForChecklist("A-6.00-00.pdf", [
        "door_schedule_and_hardware",
      ]),
      packs: buildVisualEvidencePacks({
        fileName: "A-6.00-00.pdf",
        text: A6_TEXT,
        topics: ["door_schedule_and_hardware"],
      }),
      status: "recovered",
      notes: [],
      sheetFileName: "A-6.00-00.pdf",
    });
    const prompt = buildAnalyzerUserPrompt("A-6.00-00.pdf", [], {
      visualEvidence: block,
    });
    assert.match(prompt, /PANIC|LOCKSET|FIRE-RATED/i);
    assert.doesNotMatch(prompt, /Vision OCR|professionally verified compliance evidence/i);
    assert.match(prompt, /not verified code compliance|not verified compliance/i);
  });

  it("records audit metadata without claiming verification", () => {
    const meta = visualEvidenceAuditMetadata({
      version: VISUAL_EVIDENCE_VERSION,
      enabled: true,
      status: "recovered",
      latencyMs: 12,
      sheetFileName: "FP200 .pdf",
      topics: ["hydraulic_design"],
      packs: [],
      checklistBlock: "",
      promptBlock: "",
      textLayerChars: 4000,
      lowText: false,
      notes: ["ok"],
    });
    assert.equal(meta.visual_evidence_enabled, true);
    assert.equal(meta.visual_evidence_status, "recovered");
    assert.equal(meta.visual_evidence_latency_ms, 12);
  });
});

describe("Phase 3 visual evidence preserves Critical controls", () => {
  it("keeps positive-control Criticals published (P-001… style)", () => {
    const controls = (
      phase2bCriticalRegression as {
        positiveControls?: Array<{ id: string; draft: DraftAnalyzerFinding; expectPublished?: boolean }>;
      }
    ).positiveControls || [];
    assert.ok(controls.length >= 3, "fixture should include positive Critical controls");
    for (const item of controls) {
      const result = validateAnalyzerFindings([item.draft], context());
      assert.equal(result.published.length, 1, item.id);
      assert.equal(result.published[0]?.severity, "critical", item.id);
      assert.equal(result.withheld.length, 0, item.id);
    }
  });

  it("wires processor fail-open visual evidence and keeps CSR independent", () => {
    const processor = readFileSync(
      join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"),
      "utf8",
    );
    assert.match(processor, /retrieveVisualEvidence\(/);
    assert.match(processor, /isVisualEvidenceEnabled\(/);
    assert.match(processor, /visualEvidenceAuditMetadata\(/);
    assert.match(processor, /visual evidence failed open/);
    assert.match(processor, /retrieveCrossSheetEvidence\(/);
    assert.match(processor, /isCrossSheetRetrievalEnabled\(/);
    assert.match(processor, /validateAnalyzerFindings\(/);
    assert.match(processor, /mergeVisualEvidencePromptBlocks\(/);
    assert.match(processor, /visualEvidence\?\.promptBlock/);
    assert.match(processor, /stage3Evidence\?\.promptBlock/);
    // Still a single PDF attachment path.
    const fileInputCount = [...processor.matchAll(/type:\s*"input_file"/g)].length;
    assert.equal(fileInputCount, 1);
  });
});
