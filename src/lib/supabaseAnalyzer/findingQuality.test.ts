import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import registry from "../../../shared/code-registry/jurisdiction-editions.json" with { type: "json" };
import {
  DC_2017_REGISTRY_SNAPSHOT,
  displayAnalysisMode,
  legacySupabaseAnalyzerPrompt,
  processorReviewPrompt,
  resolveAnalyzerReviewScope,
} from "./analysisMode.ts";
import {
  buildAnalyzerUserPrompt,
  sheetIdentityKeys,
  validateAnalyzerFindings,
  type AnalyzerValidationContext,
  type DraftAnalyzerFinding,
  type SubmittedSheetRef,
} from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import { buildSupabaseAnalyzerJsonExport } from "./exportDataset.ts";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding, SupabaseAnalyzerRun, SupabaseAnalyzerSheetJob } from "./client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dcContext = {
  jurisdictionKey: "dc",
  jurisdictionLabel: "Washington D.C. (12A DCMR)",
  codeEdition: "2017",
  codeContext: "2017 DC Construction Codes (2015 IBC base)",
};

function context(partial: Partial<AnalyzerValidationContext> = {}): AnalyzerValidationContext {
  return {
    analysisMode: "both",
    sheetIndex: [],
    sheetDiscipline: null,
    ...dcContext,
    ...partial,
  };
}

function draft(partial: Partial<DraftAnalyzerFinding> = {}): DraftAnalyzerFinding {
  return {
    category: "General",
    severity: "advisory",
    title: "Review observation",
    observation: "The sheet shows a specific condition that needs a closer look.",
    drawing_evidence: "Title block note visible at the lower right of the sheet.",
    drawing_location: "Title block",
    suggested_code_reference: "",
    recommendation: "Confirm the noted condition against the adopted text before design changes.",
    ...partial,
  };
}

const sheetIndex: SubmittedSheetRef[] = [
  { fileName: "M-2.0.pdf", detectedSheetNumber: "M-2.0", detectedSheetTitle: "Kitchen Hood Diagrams" },
  { fileName: "E-3.2-00.pdf", detectedSheetNumber: "E-3.2-00", detectedSheetTitle: "Electrical Details and Diagrams" },
  { fileName: "G-0.00-00.pdf", detectedSheetNumber: "G-0.00-00", detectedSheetTitle: "General Notes" },
  { fileName: "P-3.0.pdf", detectedSheetNumber: "P-3.0", detectedSheetTitle: "Plumbing" },
];

describe("sheet index", () => {
  it("matches normalized sheet ids and does not prefix-match a different sheet", () => {
    assert.deepEqual(sheetIdentityKeys("E-3.2-00.pdf"), ["E3.2"]);
    assert.deepEqual(sheetIdentityKeys("Refer to sheet E3.2"), ["E3.2"]);
    assert.deepEqual(sheetIdentityKeys("G-0.00-00"), ["G0.00"]);
    assert.deepEqual(sheetIdentityKeys("E-1.1"), ["E1.1"]);
    assert.deepEqual(sheetIdentityKeys("E-1.10"), ["E1.10"]);
    assert.equal(sheetIdentityKeys("E-1.1").some((key) => sheetIdentityKeys("E-11").includes(key)), false);
    const prompt = buildAnalyzerUserPrompt("M-2.0.pdf", sheetIndex);
    assert.match(prompt, /E-3\.2-00\.pdf/);
    assert.match(prompt, /Do not report it as missing/);
    assert.equal(prompt.includes("object_path"), false);
  });
});

describe("documented requirements are not critical defects", () => {
  it("withholds a GFCI note that the drawing already requires", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "critical",
        title: "GFCI Circuit Breakers for Kitchen Equipment",
        observation: "Kitchen equipment must be protected with GFCI circuit breakers as per the notes on the drawing.",
        drawing_evidence: "General note 1 states all kitchen equipment must have GFCI protection per NEC requirements.",
        drawing_location: "General Notes",
        suggested_code_reference: "2017 DC Construction Codes, based on 2015 IBC.",
        recommendation: "Ensure installation of GFCI circuit breakers for all kitchen equipment to prevent electrical hazards.",
      }),
    ], context());
    assert.equal(result.published.length, 0);
    assert.deepEqual(result.withheld[0]?.rules, ["documented_requirement_restatement"]);
  });

  it("withholds an exit-door note that already states the requirement", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Life Safety",
        severity: "critical",
        title: "Exit Path and Door Compliance",
        observation: "Life Safety Note 4 indicates that exit doors must be operable from inside without special knowledge or effort.",
        drawing_evidence: "Life Safety Note 4 under section 3 Life Safety Notes.",
        drawing_location: "Middle left section of the sheet.",
        suggested_code_reference: "IBC 2015 Section 1008.1.9",
        recommendation: "Inspect all exit doors to verify compliance with egress requirements.",
      }),
    ], context());
    assert.equal(result.published.some((finding) => finding.severity === "critical"), false);
    assert.equal(result.withheld[0]?.rules.includes("documented_requirement_restatement"), true);
  });

  it("withholds a valve-access instruction that restates the drawing", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Plumbing",
        severity: "critical",
        title: "Valve Location Restrictions",
        observation: "All shut-off valves shall be located over suspended ceilings for accessibility. Do not locate in areas with drywall ceilings.",
        drawing_evidence: "ALL SHUT-OFF VALVES SHALL BE LOCATED OVER SUSPENDED CEILINGS FOR ACCESSIBILITY.",
        drawing_location: "Keyed notes section, point 2.",
        suggested_code_reference: "12A DCMR Section 703.1",
        recommendation: "Verify that valve locations are compliant and avoid drywall ceiling areas to ensure accessibility.",
      }),
    ], context());
    assert.equal(result.published.some((finding) => finding.severity === "critical"), false);
    assert.equal(result.withheld[0]?.rules.includes("documented_requirement_restatement"), true);
  });
});

describe("cross-sheet references", () => {
  it("does not claim E3.2 is absent when the submitted index contains it", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Mechanical",
        severity: "warning",
        title: "Hood and Fan Interlock Details",
        observation: "There is a reference to hood/fan interlock details on another drawing (E3.2) that is not included here.",
        drawing_evidence: "REFER E3.2 FOR HOOD/FAN INTERLOCK DETAILS in the drawing notes.",
        drawing_location: "Drawing notes, item 10.",
        suggested_code_reference: "2015 IMC Section 507.2",
        recommendation: "Review the interlock details in the referenced drawing to confirm compliance.",
      }),
    ], context({ sheetIndex, sheetDiscipline: "Mechanical" }));
    assert.equal(result.published.length, 1);
    const finding = result.published[0];
    assert.equal(finding.severity, "advisory");
    assert.match(finding.observation, /E-3\.2-00\.pdf/);
    assert.match(finding.observation, /does not establish compliance/);
    assert.doesNotMatch(finding.observation, /not included/i);
    assert.equal(finding.validation.independentlyVerified, false);
    assert.notEqual(finding.verification_status, "verified");
  });
});

describe("calculation comparisons", () => {
  it("does not treat 75 GPM versus 149.70 GPM as a violation when lesser-of is stated", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Plumbing",
        severity: "warning",
        title: "Potential Discrepancy in Flow Rate Selection",
        observation: "The flow rate used to select the grease interceptor is 75 GPM, based on the pipe size, while the flow rate by fixtures for a 2-minute drainage period is listed as 149.70 GPM.",
        drawing_evidence: "FLOW RATE CALCULATION shows pipe-size flow 75 GPM and fixture-based flow 149.70 GPM. The governing selection is the lesser of those two values.",
        drawing_location: "Flow rate calculation",
        suggested_code_reference: "2015 IPC Section 1003.3.4",
        recommendation: "Review the grease interceptor selection to ensure it accommodates the potential maximum flow rate of fixtures.",
      }),
    ], context({ sheetDiscipline: "Plumbing" }));
    assert.equal(result.published.length, 1);
    const finding = result.published[0];
    assert.equal(finding.severity, "advisory");
    assert.match(finding.observation, /lesser-of/i);
    assert.match(finding.observation, /149\.70 GPM/);
    assert.doesNotMatch(`${finding.observation} ${finding.recommendation}`, /maximum flow|potential maximum/i);
    assert.equal(finding.validation.independentlyVerified, false);
    assert.equal(finding.verification_status, "proposed_reference");
    assert.equal(finding.suggested_code_reference, "2015 IPC Section 1003.3.4");
  });

  it("keeps a sizing conflict that shows the selection missed the stated lesser-of result", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Plumbing",
        severity: "warning",
        title: "Grease interceptor exceeds the lesser-of result",
        observation: "The schedule selects 200 GPM, which is not the lesser of the 75 GPM pipe-size flow and the 149.70 GPM fixture flow.",
        drawing_evidence: "FLOW RATE CALCULATION: lesser of pipe size 75 GPM and fixtures 149.70 GPM. Scheduled interceptor: 200 GPM.",
        drawing_location: "Flow rate calculation",
        suggested_code_reference: "2015 IPC Section 1003.3.4",
        recommendation: "Revise the scheduled interceptor so it follows the lesser-of method printed on the sheet.",
      }),
    ], context({ sheetDiscipline: "Plumbing" }));
    assert.equal(result.published[0]?.severity, "warning");
    assert.match(result.published[0]?.observation || "", /not the lesser/);
  });
});

describe("code references", () => {
  it("maps a wrong NEC edition with the registry and does not invent a section", () => {
    const original = "2015 NEC Section 250";
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "warning",
        title: "Kitchen receptacle breaker rating",
        observation: "Panel schedule circuit 12 is a 15A breaker, which conflicts with the equipment note requiring a 20A breaker for the kitchen receptacle.",
        drawing_evidence: "Panel schedule circuit 12: 15A. Equipment note: kitchen receptacle 20A breaker.",
        drawing_location: "Panel schedule",
        suggested_code_reference: original,
        recommendation: "Reconcile the breaker rating with the equipment note.",
      }),
    ], context({ sheetDiscipline: "Electrical" }));
    const finding = result.published[0];
    assert.equal(finding.suggested_code_reference, "NEC 2014 Section 250");
    assert.equal(finding.validation.originalCodeReference, original);
    assert.equal(finding.validation.editionMappingApplied, true);
    assert.equal(finding.validation.independentlyVerified, false);
    assert.equal(finding.verification_status, "proposed_reference");
    assert.equal(finding.severity, "warning");
  });

  it("maps NEC 2017 Article 210 onto the recorded 2014 edition", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "advisory",
        title: "Branch circuit note",
        observation: "The lighting schedule lists a 120V branch circuit, and the panel note conflicts with that voltage.",
        drawing_evidence: "Lighting schedule circuit L1 is marked 120V. Panel note for L1 is marked 277V.",
        drawing_location: "Lighting schedule",
        suggested_code_reference: "NEC 2017 - Article 210 Branch Circuits",
        recommendation: "Reconcile the circuit voltage shown in the schedule and the panel note.",
      }),
    ], context());
    assert.equal(result.published[0]?.suggested_code_reference, "NEC 2014 Article 210");
    assert.equal(result.published[0]?.validation.independentlyVerified, false);
  });

  it("drops a conversational NEC reference instead of inventing a section", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "advisory",
        title: "Junction box coordination",
        observation: "Note E12 tells the contractor to coordinate the roof-top junction box with the construction manager.",
        drawing_evidence: "Note E12 requires coordination for the roof-top camera junction box location.",
        drawing_location: "Plan notes",
        suggested_code_reference: "Could reference NEC articles pertaining to outlet box locations.",
        recommendation: "Record the coordinated junction box location on the sheet.",
      }),
    ], context());
    assert.equal(result.published[0]?.suggested_code_reference, null);
    assert.equal(result.published[0]?.verification_status, "unresolved_reference");
    assert.equal(JSON.stringify(result.published[0]?.suggested_code_reference).includes("210"), false);
    assert.equal(result.published[0]?.validation.independentlyVerified, false);
  });

  it("does not keep a suggested section number from a conversational citation", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "advisory",
        title: "Sign disconnect note",
        observation: "Note E18 says signs are provided with integral disconnect switches, and the sign schedule shows one sign without that callout.",
        drawing_evidence: "Note E18: signs are provided with integral disconnects. Sign schedule row S2 has no disconnect callout.",
        drawing_location: "Sign schedule",
        suggested_code_reference: "Suggest referencing NEC 600.6 for sign disconnect requirements if applicable.",
        recommendation: "Add the disconnect callout to sign S2 or explain why note E18 does not apply.",
      }),
    ], context());
    const serialized = JSON.stringify(result.published[0]?.suggested_code_reference);
    assert.equal(result.published[0]?.suggested_code_reference, null);
    assert.equal(serialized.includes("600.6"), false);
  });

  it("does not treat General Compliance as a verified code reference", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Architectural",
        severity: "advisory",
        title: "Soffit fire-resistance is not identified",
        observation: "Detail 6 draws a ceiling soffit transition, and no fire-resistance rating is identified for that assembly.",
        drawing_evidence: "Detail 6 CEILING TRANSITION W/ SOFFIT is drawn without a printed fire-resistance rating.",
        drawing_location: "Detail 6",
        suggested_code_reference: "2017 DC Construction Codes - General Compliance",
        recommendation: "Identify the fire-resistance rating of the soffit assembly if the adjacent occupancy requires one.",
      }),
    ], context());
    const finding = result.published[0];
    assert.equal(finding.suggested_code_reference, null);
    assert.equal(finding.verification_status, "unresolved_reference");
    assert.equal(finding.validation.citationIssues.includes("generic_compliance_label"), true);
    assert.equal(finding.validation.independentlyVerified, false);
    assert.notEqual(finding.verification_status, "verified");
  });

  it("removes IBC Chapter 27 from an electrical finding without substituting a section", () => {
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "warning",
        title: "Kitchen receptacle lacks the GFCI the note requires",
        observation: "The panel schedule shows the kitchen receptacle without GFCI protection, which conflicts with general note 1 requiring GFCI protection.",
        drawing_evidence: "Panel schedule circuit K-4: receptacle, no GFCI. General note 1: kitchen equipment must have GFCI protection.",
        drawing_location: "Panel schedule",
        suggested_code_reference: "IBC 2015, Chapter 27 (Electrical)",
        recommendation: "Show the GFCI protection required by general note 1 for circuit K-4.",
      }),
    ], context({ sheetDiscipline: "Electrical" }));
    const finding = result.published[0];
    assert.equal(finding.severity, "warning");
    assert.equal(finding.suggested_code_reference, null);
    assert.equal(finding.validation.citationIssues.includes("ibc_chapter_27_not_electrical_code"), true);
    assert.equal(JSON.stringify(finding.suggested_code_reference), "null");
  });

  it("does not rewrite a NEC edition when the jurisdiction is outside the DC 2017 record", () => {
    const reference = "2015 NEC Section 250";
    const result = validateAnalyzerFindings([
      draft({
        category: "Electrical",
        severity: "warning",
        title: "Kitchen receptacle breaker rating",
        observation: "Panel schedule circuit 12 is a 15A breaker, which conflicts with the equipment note requiring a 20A breaker.",
        drawing_evidence: "Panel schedule circuit 12: 15A. Equipment note: kitchen receptacle 20A breaker.",
        drawing_location: "Panel schedule",
        suggested_code_reference: reference,
        recommendation: "Reconcile the breaker rating with the equipment note.",
      }),
    ], context({
      jurisdictionKey: "maryland-msbc",
      jurisdictionLabel: "Maryland (MSBC)",
      codeEdition: "2021",
      codeContext: "Maryland (MSBC) — selected 2021 reference context",
    }));
    assert.equal(result.published[0]?.suggested_code_reference, reference);
    assert.equal(result.published[0]?.validation.editionMappingApplied, false);
    assert.match(result.published[0]?.validation.coverageLimitation || "", /not rewritten/);
    assert.equal(result.published[0]?.validation.independentlyVerified, false);
  });
});

describe("supported discrepancies and scope", () => {
  const serious = draft({
    category: "Means of Egress",
    severity: "critical",
    title: "Exit door hardware requires a key from the inside",
    observation: "The door schedule shows the main exit door hardware as a classroom lock with key required from the inside, which conflicts with the life safety note that exit doors operate without special knowledge or effort.",
    drawing_evidence: "Door schedule mark EX-1: hardware classroom lock, key required from the inside. Life Safety Note 4: exit doors operable from inside without special knowledge.",
    drawing_location: "Door schedule",
    suggested_code_reference: "2015 IBC Section 1010.1.9",
    recommendation: "Revise the EX-1 hardware so the exit door is operable from the inside without a key.",
  });

  it("preserves a supported critical discrepancy and its matching IBC citation", () => {
    const result = validateAnalyzerFindings([serious], context());
    assert.equal(result.published.length, 1);
    assert.equal(result.withheld.length, 0);
    const finding = result.published[0];
    assert.equal(finding.severity, "critical");
    assert.equal(finding.suggested_code_reference, "2015 IBC Section 1010.1.9");
    assert.equal(finding.verification_status, "proposed_reference");
    assert.equal(finding.validation.outcome, "accepted");
    assert.equal(finding.validation.independentlyVerified, false);
    assert.equal(finding.validation.editionMappingApplied, false);
  });

  it("keeps Both, drops MEP findings from IBC Only, and drops base-code findings from Local Only", () => {
    const electrical = draft({
      category: "Electrical",
      severity: "warning",
      title: "Kitchen receptacle breaker rating",
      observation: "Panel schedule circuit 12 is a 15A breaker, which conflicts with the equipment note requiring a 20A GFCI breaker.",
      drawing_evidence: "Panel schedule circuit 12: 15A. Equipment note: kitchen receptacle 20A GFCI breaker.",
      drawing_location: "Panel schedule",
      suggested_code_reference: "NEC 2014 Article 210.8",
      recommendation: "Reconcile circuit 12 with the equipment note.",
    });
    const both = validateAnalyzerFindings([electrical], context({ analysisMode: "both" }));
    assert.equal(both.published[0]?.severity, "warning");
    assert.equal(both.published[0]?.suggested_code_reference, "NEC 2014 Article 210.8");

    const ibc = validateAnalyzerFindings([electrical], context({ analysisMode: "ibc_only" }));
    assert.equal(ibc.published.length, 0);
    assert.equal(ibc.withheld[0]?.rules.includes("outside_ibc_only_scope"), true);

    const local = validateAnalyzerFindings([serious], context({ analysisMode: "local_only" }));
    assert.equal(local.published.length, 0);
    assert.equal(local.withheld[0]?.rules.includes("outside_local_only_scope"), true);

    const localAmendment = validateAnalyzerFindings([
      draft({
        ...serious,
        observation: "The door schedule shows key required from the inside, which conflicts with the District of Columbia amendment note printed on this sheet.",
        suggested_code_reference: "12A DCMR Section 703.1",
      }),
    ], context({ analysisMode: "local_only" }));
    assert.equal(localAmendment.published.length, 1);
    assert.equal(localAmendment.published[0]?.severity, "critical");
    assert.equal(localAmendment.published[0]?.suggested_code_reference, null);
    assert.equal(localAmendment.published[0]?.validation.citationIssues.includes("unsupported_local_amendment"), true);
  });

  it("withholds a near-duplicate observation on the same sheet", () => {
    const door = draft({
      category: "Means of Egress",
      severity: "warning",
      title: "Exit door clear width",
      observation: "The door schedule shows the main exit door at 30 inches, which is less than the required 32 inches noted beside it.",
      drawing_evidence: "Door schedule EX-1 clear width 30 inches. Egress note: 32 inches minimum clear width.",
      drawing_location: "Door schedule",
      suggested_code_reference: "IBC 2015 Section 1010.1.1",
      recommendation: "Revise the scheduled clear width to the 32 inches stated in the egress note.",
    });
    const result = validateAnalyzerFindings([
      door,
      { ...door, title: "Exit door clear width conflict" },
    ], context());
    assert.equal(result.published.length, 1);
    assert.equal(result.published[0]?.severity, "warning");
    assert.equal(result.withheld[0]?.rules.includes("near_duplicate"), true);
  });

  it("rejects thin drawing evidence", () => {
    const result = validateAnalyzerFindings([
      draft({ drawing_evidence: "Note", severity: "critical" }),
    ], context());
    assert.equal(result.published.length, 0);
    assert.equal(result.withheld[0]?.rules.includes("thin_drawing_evidence"), true);
  });
});

describe("prompts and historical runs", () => {
  it("gives DC 2017 prompts the registry editions without changing legacy mode", () => {
    const record = (registry as Array<{
      id: string;
      referencedStandards?: Array<{ family: string; edition: string }>;
      transitionProvisions?: unknown;
    }>).find((item) => item.id === DC_2017_REGISTRY_SNAPSHOT.id);
    assert.ok(record);
    const nfpa = record.referencedStandards?.find((item) => item.family === "NFPA 70");
    assert.equal(nfpa?.edition, DC_2017_REGISTRY_SNAPSHOT.referencedStandards[0].edition);
    const transitionText = JSON.stringify(record.transitionProvisions);
    for (const section of DC_2017_REGISTRY_SNAPSHOT.recordedLocalSections) {
      assert.equal(transitionText.includes(section), true);
    }

    const base = {
      jurisdiction_label: dcContext.jurisdictionLabel,
      code_context: dcContext.codeContext,
      project_type: "Commercial (General)",
      jurisdiction_key: "dc",
      code_edition: "2017",
    };
    const legacy = processorReviewPrompt({ ...base, analysis_mode: null });
    assert.equal(legacy, legacySupabaseAnalyzerPrompt(base));
    assert.equal(legacy.includes("Analysis mode scope"), false);
    assert.equal(displayAnalysisMode(null), "Legacy review");
    assert.match(legacy, /explicit drawing requirement/);
    assert.match(legacy, /lesser-of/);
    assert.match(legacy, /2014 NEC/);
    assert.match(legacy, /NFPA 70 2014/);
    assert.match(legacy, /2015 IPC/);
    assert.match(legacy, /2015 IMC/);
    assert.match(legacy, /2015 IFC/);
    assert.match(legacy, /IBC Chapter 27/);

    const both = resolveAnalyzerReviewScope({ mode: "both", ...dcContext });
    assert.match(both.promptScope, /NEC 2014/);
    assert.match(both.promptScope, /not reviewed as IBC/);
    assert.match(both.promptScope, /IBC Chapter 27/);
    assert.match(both.promptScope, /General Compliance/);

    const ibc = processorReviewPrompt({ ...base, analysis_mode: "ibc_only" });
    assert.match(ibc, /Analysis mode scope/);
    assert.match(ibc, /2015 IBC only/);
    assert.match(ibc, /comprehensive MEP review/);
    assert.match(ibc, /Do not cite NEC, IPC, IMC, or IFC sections in this mode/);

    const local = processorReviewPrompt({ ...base, analysis_mode: "local_only" });
    assert.match(local, /DCMR Title 12/);
    assert.match(local, /Do not cite a base IBC, NEC, IPC, IMC, or IFC section as a local amendment/);

    const other = legacySupabaseAnalyzerPrompt({
      jurisdiction_label: "Maryland (MSBC)",
      code_context: "Maryland (MSBC) — selected 2021 reference context",
      project_type: "Commercial (General)",
    });
    assert.match(other, /Do not invent an IBC, NEC/);
    assert.doesNotMatch(other, /NEC 2014|2014 NEC/);
  });

  it("leaves stored historical findings unchanged and keeps validation out of the export", () => {
    const historical: SupabaseAnalyzerFinding = {
      id: "finding-historical",
      run_id: "run-1",
      sheet_job_id: "job-1",
      finding_index: 0,
      category: "Electrical",
      severity: "critical",
      title: "GFCI Circuit Breakers for Kitchen Equipment",
      observation: "Kitchen equipment must be protected with GFCI circuit breakers as per the notes on the drawing.",
      drawing_evidence: "General note 1 states all kitchen equipment must have GFCI protection per NEC requirements.",
      drawing_location: "General Notes",
      suggested_code_reference: "2017 DC Construction Codes, based on 2015 IBC.",
      recommendation: "Ensure installation of GFCI circuit breakers for all kitchen equipment.",
      ai_provider: "openai",
      ai_model: "gpt-4o",
      jurisdiction_key: "dc",
      code_edition: "2017",
      provenance_status: "model_generated_from_uploaded_pdf",
      verification_status: "proposed_reference",
      created_at: "2026-10-22T00:00:00.000Z",
    };
    Object.assign(historical, {
      raw_metadata: {
        validation: { originalCodeReference: "2015 NEC Section 250", independentlyVerified: false },
        source_object_path: "project/secret-object.pdf",
        openai_request_id: "req_secret",
      },
    });
    const run: SupabaseAnalyzerRun = {
      id: "07c02091-3456-7890-abcd-ef1234567890",
      project_id: "project-1",
      created_by: "user-secret",
      status: "completed",
      jurisdiction_key: "dc",
      jurisdiction_label: dcContext.jurisdictionLabel,
      project_type: "Commercial (General)",
      code_edition: "2017",
      code_context: dcContext.codeContext,
      analysis_mode: null,
      analysis_scope: null,
      source_coverage: "adoption_metadata_only",
      ai_provider: "openai",
      ai_model: "gpt-4o",
      total_sheets: 82,
      uploaded_sheets: 82,
      queued_sheets: 0,
      processing_sheets: 0,
      completed_sheets: 82,
      failed_sheets: 0,
      total_input_tokens: 10,
      total_output_tokens: 20,
      estimated_cost_usd: 1.25,
      budget_limit_usd: 20,
      started_at: null,
      completed_at: "2026-10-22T00:00:00.000Z",
      cancelled_at: null,
      created_at: "2026-10-22T00:00:00.000Z",
      updated_at: "2026-10-22T00:00:00.000Z",
    };
    const job: SupabaseAnalyzerSheetJob = {
      id: "job-1",
      run_id: run.id,
      project_id: run.project_id,
      ordinal: 1,
      original_file_name: "E-1.1-00.pdf",
      object_path: "project/secret-object.pdf",
      file_size: 1000,
      discipline: "Electrical",
      detected_sheet_number: "E-1.1-00",
      detected_sheet_title: "First Floor Plan - Electrical",
      status: "completed",
      attempt_count: 1,
      max_attempts: 3,
      last_error: null,
      error_code: null,
      input_tokens: 10,
      output_tokens: 20,
      estimated_cost_usd: 1.25,
      analysis_summary: "Historical summary",
      created_at: run.created_at,
      updated_at: run.updated_at,
    };
    const dataset: AnalyzerRunDataset = { run, jobs: [job], findings: [historical] };
    const exported = buildSupabaseAnalyzerJsonExport(dataset, "McDonald's", "2026-10-22T12:00:00.000Z");
    const serialized = JSON.stringify(exported);
    assert.equal(exported.run.analysisMode, null);
    assert.equal(exported.run.analysisModeLabel, "Legacy review");
    assert.equal(exported.sheets[0].findings[0].severity, "critical");
    assert.equal(exported.sheets[0].findings[0].codeReference, historical.suggested_code_reference);
    assert.equal(serialized.includes("secret-object"), false);
    assert.equal(serialized.includes("req_secret"), false);
    assert.equal(serialized.includes("user-secret"), false);
    assert.equal(serialized.includes("gpt-4o"), false);
    assert.equal(serialized.includes("originalCodeReference"), false);
    assert.equal(serialized.includes("independentlyVerified"), false);
    assert.equal(serialized.includes("estimated_cost"), false);
    assert.equal("validation" in exported.sheets[0].findings[0], false);

    const exportSource = readFileSync(join(__dirname, "exportDataset.ts"), "utf8");
    const reportSource = readFileSync(join(__dirname, "report.ts"), "utf8");
    const processor = readFileSync(join(__dirname, "../../../supabase/functions/supabase-analyzer-processor/index.ts"), "utf8");
    assert.equal(exportSource.includes("validateAnalyzerFindings"), false);
    assert.equal(reportSource.includes("validateAnalyzerFindings"), false);
    assert.match(processor, /validateAnalyzerFindings\(/);
    assert.match(processor, /buildAnalyzerUserPrompt\(/);
    const validateAt = processor.indexOf("validateAnalyzerFindings(");
    const insertAt = processor.indexOf(".insert(findingRows)");
    assert.equal(validateAt > 0 && validateAt < insertAt, true);
    assert.match(processor, /\.delete\(\)[\s\S]{0,120}\.eq\("sheet_job_id", job\.id\)/);
    assert.equal(/from\("supabase_analyzer_findings"\)[\s\S]{0,180}\.eq\("run_id"/.test(processor), false);
  });
});
