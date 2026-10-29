/**
 * Phase 2A.7 Critical finding validation pilot (C-001..C-004).
 * Assessments are provisional / AI-assisted unless authorizeMetricsContribution is set.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCropViaPython } from "./adjudicateCrops.mjs";
import { applyDecisionFile } from "./adjudicateRunner.mjs";
import { ADJUDICATION_VERSION } from "./adjudicateSchema.mjs";

export const CRITICAL_PILOT_VERSION = "phase2a7.critical-pilot.v1";
export const CRITICAL_IDS = ["C-001", "C-002", "C-003", "C-004"];
export const PROVISIONAL_REVIEWER_ID = "phase2a7-provisional-local-pilot";

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function calcC002() {
  const density = 0.15;
  const dischargeArea = 1524;
  const hoseAllowance = 250;
  const flowDemand = 596.81;
  const densityTimesArea = density * dischargeArea;
  return {
    densityGpmPerSqFt: density,
    dischargeAreaSqFt: dischargeArea,
    hoseAllowanceGpm: hoseAllowance,
    flowDemandGpm: flowDemand,
    densityTimesAreaGpm: densityTimesArea,
    densityTimesAreaPlusHoseGpm: densityTimesArea + hoseAllowance,
    sprinklerShareIfHoseSubtractedGpm: flowDemand - hoseAllowance,
    impliedDensityIfHoseSubtracted: (flowDemand - hoseAllowance) / dischargeArea,
    note: "NFPA 13 hydraulic FLOW DEMAND is a pipe-network calculation result, not density×area. Hose allowance is a separate line item on the same box.",
  };
}

export function buildCriticalAssessments(casesById) {
  const c001 = casesById.get("C-001");
  const c002 = casesById.get("C-002");
  const c003 = casesById.get("C-003");
  const c004 = casesById.get("C-004");
  const hydro = calcC002();

  return [
    {
      clientReportId: "C-001",
      benchmarkId: c001?.benchmarkId || null,
      relativePath: "A-1.03-00.pdf",
      title: c001?.original?.title,
      provisional: true,
      professionallyVerified: false,
      contributesToMetrics: false,
      dimensions: {
        evidenceGrounding: {
          outcome: "evidence_partial",
          summary: "A-1.03 is a reflected ceiling plan. Extracted notes direct finishes to A-6.01 and coordination to mechanical/electrical; no ceiling-penetration section callouts were retrieved on this sheet.",
          facts: [
            "Sheet notes include: SEE SHEET A-6.01 FOR CEILING FINISHES.",
            "Notes require GC coordination of HVAC diffusers with decor and mechanical plans.",
            "Sprinkler heads are flagged to coordinate with sprinkler drawings.",
            "A-6.01 content retrieved is ceiling finish/schedule material, not penetration firestopping sections.",
            "Penetration/firestop language appears on other discipline sheets (e.g. FP100, plumbing sheets), not as RCP sections on A-1.03.",
          ],
          coordinates: c001?.crop?.target?.bbox || null,
          limitations: [
            "Absence of penetration sections on one architectural RCP does not prove the set lacks them.",
            "Full visual review of every related detail sheet was not completed in this pilot.",
          ],
        },
        technicalCorrectness: {
          outcome: "technically_uncertain",
          summary: "Observing that penetration sections are not drawn on A-1.03 can be fair for that sheet, but treating that as a Critical set-level omission without checking FP/MEP penetration details is not established.",
          facts: [
            "Architectural RCPs commonly defer penetration firestopping to FP/MEP notes and details.",
            "FP100 includes penetration firestopping language for rated assemblies.",
          ],
          codeReferencesMentioned: [],
          codeReferencesVerified: false,
          limitations: ["No specific IBC/NFPA section was cited on the finding (codeReference null)."],
        },
        findingValidity: {
          outcome: "needs_more_evidence",
          summary: "Provisional: issue may be overstated as Critical based on a single RCP sheet. Needs qualified review of FP/MEP penetration details before validity is settled.",
        },
      },
      overallOutcome: "needs_more_evidence",
      justification: "Provisional pilot: A-1.03 lacks penetration sections locally, but cross-discipline sheets contain penetration guidance. Not enough to confirm or reject as a Critical finding.",
      crossReferencedSheets: ["A-6.01.00.pdf", "FP100.pdf"],
      potentialMissedIssuesReviewed: true,
      potentialMissedIssuesConfirmed: [],
    },
    {
      clientReportId: "C-002",
      benchmarkId: c002?.benchmarkId || null,
      relativePath: "FP200 .pdf",
      title: c002?.original?.title,
      provisional: true,
      professionallyVerified: false,
      contributesToMetrics: false,
      dimensions: {
        evidenceGrounding: {
          outcome: "evidence_present",
          summary: "Cited hydraulic values are present in the HYDRAULIC DESIGN (DENSITY/AREA) box on FP200.",
          facts: [
            "DENSITY: 0.15 GPM",
            "DISCHARGE AREA: 1524 ft²",
            "HOSE ALLOWANCE: 250.00 GPM (present on drawing; omitted from finding evidence text)",
            "FLOW DEMAND: 596.81 GPM",
            "# OF SPRINKLERS: 21; K-FACTOR: 5.6; OCCUPANCY: Ordinary Hazard Group 1; LOCATION: KITCHEN",
          ],
          coordinates: c002?.crop?.target?.bbox || null,
          calculations: hydro,
          limitations: ["Pressure demand 31.92 psi and safety factor also present; not needed for the density×area comparison."],
        },
        technicalCorrectness: {
          outcome: "technically_incorrect",
          summary: "Finding treats FLOW DEMAND as if it must equal density×discharge area (228.6 GPM). That comparison is not a valid hydraulic consistency check. Hose allowance is a separate listed value; even density×area+hose (478.6) is not required to equal calculated FLOW DEMAND.",
          facts: [
            `0.15 × 1524 = ${hydro.densityTimesAreaGpm} GPM (minimum density×area quantity, not system demand).`,
            `0.15 × 1524 + 250 hose = ${hydro.densityTimesAreaPlusHoseGpm} GPM (still not equal to FLOW DEMAND, and not required to be).`,
            "FLOW DEMAND on a density/area hydraulic summary is the calculated supply demand from the hydraulic analysis (pipe friction, fittings, balancing), which is expected to differ from density×area.",
            "Finding observation omitted HOSE ALLOWANCE 250.00 GPM printed in the same box.",
          ],
          codeReferencesMentioned: [],
          codeReferencesVerified: false,
          limitations: [
            "Full hydraulic calculation worksheets were not re-run in this pilot.",
            "Professional fire-protection engineer judgment still required for final disposition.",
          ],
        },
        findingValidity: {
          outcome: "false_positive",
          summary: "Provisional: numbers are real, but the inconsistency conclusion appears to rest on a mistaken identity between density×area and total hydraulic flow demand.",
        },
      },
      overallOutcome: "false_positive",
      justification: "Provisional pilot: evidence grounding succeeds; technical reasoning conflates density×area with FLOW DEMAND and ignores hose allowance. Do not treat as professionally verified.",
      crossReferencedSheets: [],
      potentialMissedIssuesReviewed: true,
      potentialMissedIssuesConfirmed: [],
    },
    {
      clientReportId: "C-003",
      benchmarkId: c003?.benchmarkId || null,
      relativePath: "M-1.4.pdf",
      title: c003?.original?.title,
      provisional: true,
      professionallyVerified: false,
      contributesToMetrics: false,
      dimensions: {
        evidenceGrounding: {
          outcome: "evidence_misleading",
          summary: "Keyed notes about refrigerant lines exist, but they are notes 1 and 2 (not note 22). Note 1 explicitly points to Detail 3 on M3.0.",
          facts: [
            "KEYED NOTE 1: REFRIGERANT LIQUID AND SUCTION LINES UP THROUGH ROOF... SEE DETAIL 3 ON DRAWING M3.0",
            "KEYED NOTE 2: REFRIGERANT LINES DOWN TO SODA SYSTEM (MULTIPLEX) IN BASEMENT.",
            "Finding location text cites 'Keyed Notes, note 22' — that note number was not recovered for these refrigerant lines.",
            "M-3.0 OCR includes FOAM INSULATION (ARMAFLEX) and refrigerant pipe installation notes.",
          ],
          coordinates: c003?.crop?.target?.bbox || null,
          limitations: ["Crop shows notes 1–2 clearly; note 22 may exist elsewhere on M-1.4 for a different topic and was not matched to refrigerant insulation."],
        },
        technicalCorrectness: {
          outcome: "technically_incorrect",
          summary: "Claim that insulation requirements are not provided overlooks the sheet's own cross-reference to M3.0 Detail 3, where foam insulation callouts were retrieved.",
          facts: [
            "Cross-reference on M-1.4: SEE DETAIL 3 ON DRAWING M3.0",
            "M-3.0 recovered text includes FOAM INSULATION (ARMAFLEX) associated with refrigerant piping details.",
            "Finding codeReference '2015 IMC Chapter 11' is chapter-level only; no section was validated.",
          ],
          codeReferencesMentioned: ["2015 IMC Chapter 11"],
          codeReferencesVerified: false,
          limitations: ["Insulation thickness schedule completeness on M-3.0 was not exhaustively verified line-by-line."],
        },
        findingValidity: {
          outcome: "false_positive",
          summary: "Provisional: primary sheet points to a detail that addresses refrigerant pipe insulation; raising Critical for missing insulation appears unsupported after cross-reference check.",
        },
      },
      overallOutcome: "false_positive",
      justification: "Provisional pilot: wrong note number cited; cross-referenced M3.0 detail includes insulation callouts. Not professionally verified.",
      crossReferencedSheets: ["M-3.0.pdf"],
      potentialMissedIssuesReviewed: true,
      potentialMissedIssuesConfirmed: [],
    },
    {
      clientReportId: "C-004",
      benchmarkId: c004?.benchmarkId || null,
      relativePath: "S-201.00.pdf",
      title: c004?.original?.title,
      provisional: true,
      professionallyVerified: false,
      contributesToMetrics: false,
      dimensions: {
        evidenceGrounding: {
          outcome: "evidence_present",
          summary: "Masonry and Foundation Notes panel exists and contains explicit reinforcement requirements in text.",
          facts: [
            "Header 'MASONRY AND FOUNDATION NOTES' retrieved at cited location.",
            "Notes include: REINFORCE ALL WALLS WITH #4 @ 48\" O.C., FULL HEIGHT, LAP 24\".",
            "Notes include hooked dowels into footings and filled cells in CMU foundation walls.",
            "Initial adjudication crop captured only the header; body notes required wider extraction.",
          ],
          coordinates: c004?.crop?.target?.bbox || null,
          limitations: ["Graphic wall/footing sections may live on S-202/S-203 rather than as enlarged details on S-201."],
        },
        technicalCorrectness: {
          outcome: "technically_uncertain",
          summary: "If the finding means no graphic section detail on S-201, that can be partly true; if it means reinforcement is unspecified, that conflicts with the written #4@48\" and dowel requirements on the same notes panel.",
          facts: [
            "S-202/S-203 filenames indicate wall sections exist in the set.",
            "Notes also say openings/sleeves refer to architectural and mechanical drawings.",
          ],
          codeReferencesMentioned: [],
          codeReferencesVerified: false,
          limitations: ["Whether graphic sections fully depict every reinforcement condition needs structural PE review."],
        },
        findingValidity: {
          outcome: "needs_more_evidence",
          summary: "Provisional: textual reinforcement is present; Critical validity depends on whether the intended gap is missing graphics versus missing requirements.",
        },
      },
      overallOutcome: "needs_more_evidence",
      justification: "Provisional pilot: notes specify reinforcement; claim of undetailed reinforcement is ambiguous. Expand review to S-202/S-203 sections before final validity.",
      crossReferencedSheets: ["S-202.00.pdf", "S-203.00.pdf"],
      potentialMissedIssuesReviewed: true,
      potentialMissedIssuesConfirmed: [],
    },
  ];
}

export function identifyUsabilityGaps() {
  return [
    {
      id: "crop-header-only",
      severity: "high",
      findingExample: "C-004",
      gap: "Default crop used the top-scoring short header bbox, omitting the notes body needed for review.",
      recommendation: "Prefer largest high-scoring notes cluster bbox, or pad/merge candidate boxes for note panels.",
    },
    {
      id: "absence-claim-retrieval-weak",
      severity: "high",
      findingExample: "C-001",
      gap: "Absence claims retrieve weak numeric/title hits instead of supporting negative-evidence analysis.",
      recommendation: "Special-case absence findings with cross-sheet search before scoring local retrieval success.",
    },
    {
      id: "cross-sheet-not-auto-followed",
      severity: "high",
      findingExample: "C-003",
      gap: "Reviewer must manually open M3.0 even when note text says SEE DETAIL 3 ON DRAWING M3.0.",
      recommendation: "Surface explicit sheet_reference relationships and one-click cross-sheet evidence packs in the case record.",
    },
    {
      id: "hydraulic-semantics-not-modeled",
      severity: "high",
      findingExample: "C-002",
      gap: "evidence_retrieved can be high while technical conclusion is wrong; UI must force separate dimension entry.",
      recommendation: "Keep C-002-style checklist mandatory for hydraulic findings (density×area vs flow demand vs hose).",
    },
    {
      id: "note-number-mismatch",
      severity: "medium",
      findingExample: "C-003",
      gap: "Finding cited note 22; drawing shows notes 1–2 for the refrigerant content.",
      recommendation: "Flag citation note numbers that do not appear adjacent to retrieved evidence.",
    },
    {
      id: "provisional-vs-verified-friction",
      severity: "medium",
      findingExample: "workflow",
      gap: "authorizeMetricsContribution gate is correct but easy to misunderstand during local pilots.",
      recommendation: "CLI should print a clear banner: provisional apply never sets professionallyVerified.",
    },
  ];
}

async function expandC004Crop(outDir, sourceDir, record, options = {}) {
  if (!sourceDir || !record) return null;
  const layoutPath = path.join(outDir, "layout-full", "pages", `${record.sourceFileSha256 || record.sha256}.json`);
  if (!existsSync(layoutPath)) return null;
  const page = JSON.parse(await readFile(layoutPath, "utf8"));
  const cluster = (page.clusters || []).find((item) => /REINFORCE ALL WALLS WITH #4/i.test(item.text || ""));
  if (!cluster?.bbox) return null;
  const cropDir = path.join(outDir, "adjudication", "critical-pilot", "crops");
  await mkdir(cropDir, { recursive: true });
  const pngPath = path.join(cropDir, `${record.benchmarkId}-notes-body.png`);
  const pdfPath = path.join(sourceDir, record.relativePath);
  const rendered = renderCropViaPython(pdfPath, pngPath, cluster.bbox, options);
  return {
    source: "expanded_notes_cluster",
    bbox: cluster.bbox,
    textSample: String(cluster.text || "").slice(0, 400),
    cropPath: rendered.status === "ok" ? pngPath : null,
    cropStatus: rendered.status,
    render: rendered,
  };
}

export async function runCriticalPilot(options) {
  const onProgress = options.onProgress || (() => {});
  const outRoot = options.outDir;
  const adjDir = path.join(outRoot, "adjudication");
  const pilotDir = path.join(adjDir, "critical-pilot");
  await mkdir(pilotDir, { recursive: true });

  const findingMapPath = path.join(outRoot, "finding-map.json");
  const findingMapBefore = await readFile(findingMapPath);
  const findingMapHash = sha256Text(findingMapBefore);
  const casesBundle = JSON.parse(await readFile(path.join(adjDir, "cases.json"), "utf8"));
  const casesById = new Map((casesBundle.records || []).map((row) => [row.clientReportId, row]));
  for (const id of CRITICAL_IDS) {
    if (!casesById.has(id)) throw new Error(`Missing adjudication case for ${id}`);
  }

  const assessments = buildCriticalAssessments(casesById);
  const c004 = casesById.get("C-004");
  const expanded = await expandC004Crop(outRoot, options.sourceDir, c004, options);
  if (expanded) {
    const row = assessments.find((item) => item.clientReportId === "C-004");
    row.expandedCrop = expanded;
    row.dimensions.evidenceGrounding.coordinates = expanded.bbox;
  }

  const applied = [];
  for (const assessment of assessments) {
    onProgress({ status: "adjudicate", clientReportId: assessment.clientReportId });
    const decision = {
      benchmarkId: assessment.benchmarkId,
      clientReportId: assessment.clientReportId,
      reviewerId: PROVISIONAL_REVIEWER_ID,
      reviewerRole: "local_provisional_pilot",
      overallOutcome: assessment.overallOutcome,
      justification: assessment.justification,
      dimensions: {
        evidenceGrounding: {
          outcome: assessment.dimensions.evidenceGrounding.outcome,
          justification: assessment.dimensions.evidenceGrounding.summary,
        },
        technicalCorrectness: {
          outcome: assessment.dimensions.technicalCorrectness.outcome,
          justification: assessment.dimensions.technicalCorrectness.summary,
        },
        findingValidity: {
          outcome: assessment.dimensions.findingValidity.outcome,
          justification: assessment.dimensions.findingValidity.summary,
        },
      },
      professionallyVerified: false,
      authorizeMetricsContribution: false,
      provisional: true,
      phase: "2A.7",
    };
    const result = await applyDecisionFile({
      outDir: outRoot,
      decision,
      now: options.now || new Date().toISOString(),
    });
    applied.push({
      clientReportId: assessment.clientReportId,
      benchmarkId: assessment.benchmarkId,
      overallOutcome: result.record.review.overallOutcome,
      professionallyVerified: result.record.review.professionallyVerified,
      contributesToMetrics: result.record.review.contributesToMetrics,
      auditEntries: result.record.review.audit.length,
    });
    await writeFile(
      path.join(pilotDir, `${assessment.clientReportId}.json`),
      JSON.stringify({ ...assessment, adjudicationApplied: applied.at(-1) }, null, 2),
    );
  }

  // Independent sheet review markers (no fabricated missed issues).
  const independentPath = path.join(adjDir, "independent-sheet-review.json");
  const independent = JSON.parse(await readFile(independentPath, "utf8"));
  const sheetPaths = ["A-1.03-00.pdf", "FP200 .pdf", "M-1.4.pdf", "S-201.00.pdf"];
  for (const relativePath of sheetPaths) {
    const sheet = independent.sheets.find((row) => row.relativePath === relativePath);
    if (!sheet) continue;
    sheet.review = {
      status: "pilot_reviewed_no_confirmed_missed_issues",
      reviewerId: PROVISIONAL_REVIEWER_ID,
      reviewedAt: options.now || new Date().toISOString(),
      noMissedIssuesObserved: true,
      notes: "Phase 2A.7 provisional independent pass focused on Critical finding context. No confirmed missed issues recorded; does not establish recall.",
      professionallyVerified: false,
    };
  }
  await writeFile(independentPath, JSON.stringify(independent, null, 2));

  const findingMapAfter = await readFile(findingMapPath);
  if (sha256Text(findingMapAfter) !== findingMapHash) {
    throw new Error("finding-map.json changed during critical pilot. Aborting.");
  }

  const usabilityGaps = identifyUsabilityGaps();
  const summary = {
    criticalPilotVersion: CRITICAL_PILOT_VERSION,
    adjudicationVersion: ADJUDICATION_VERSION,
    phase: "2A.7",
    productionNote: "Supabase analyzer / GPT-4o / DB / Edge / M1–M4 / Code Analyzer V2 unchanged.",
    methodologyNote: "Assessments are provisional local pilot results. Not professionally verified. Precision/recall remain Not measured.",
    precision: "Not measured",
    recall: "Not measured",
    falseNegativeRate: "Not measured",
    accountability: {
      findingsUnchanged: true,
      findingMapSha256: findingMapHash,
      criticalFindings: 4,
      professionallyVerified: 0,
      provisionalAssessments: assessments.length,
    },
    distinctions: {
      supportedFacts: [
        "C-002 hydraulic box values including hose allowance are on FP200.",
        "C-003 keyed refrigerant notes are 1 and 2 and cite M3.0 Detail 3.",
        "C-004 masonry/foundation notes include #4@48\" reinforcement text.",
        "C-001 A-1.03 points to A-6.01 for ceiling finishes, not penetration sections.",
      ],
      provisionalConclusions: assessments.map((row) => ({
        clientReportId: row.clientReportId,
        overallOutcome: row.overallOutcome,
        evidenceGrounding: row.dimensions.evidenceGrounding.outcome,
        technicalCorrectness: row.dimensions.technicalCorrectness.outcome,
        findingValidity: row.dimensions.findingValidity.outcome,
      })),
      requiresProfessionalJudgment: [
        "Final disposition of C-001 as Critical after FP/MEP penetration detail review.",
        "Fire-protection engineer confirmation of C-002 hydraulic interpretation.",
        "Mechanical code reviewer confirmation that M-3.0 insulation satisfies IMC intent for C-003.",
        "Structural PE confirmation whether S-201 notes + S-202/S-203 sections adequately detail reinforcement for C-004.",
      ],
    },
    applied,
    usabilityGaps,
    regressionRecommendations: usabilityGaps.map((gap) => ({
      id: gap.id,
      recommendation: gap.recommendation,
    })),
    assessments,
  };

  await writeFile(path.join(pilotDir, "assessments.json"), JSON.stringify({ assessments }, null, 2));
  await writeFile(path.join(pilotDir, "comparison.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(pilotDir, "comparison.md"), renderCriticalPilotReport(summary));
  await writeFile(path.join(pilotDir, "usability-gaps.json"), JSON.stringify({ gaps: usabilityGaps }, null, 2));

  return { summary, outDir: pilotDir, findingMapHash, findingsUnchanged: true };
}

export function renderCriticalPilotReport(summary) {
  const lines = [];
  lines.push("# Phase 2A.7 Critical finding validation pilot");
  lines.push("");
  lines.push("Status: provisional local assessments applied through adjudication workflow.");
  lines.push("Professionally verified: 0");
  lines.push("Precision: Not measured");
  lines.push("Recall: Not measured");
  lines.push("False-negative rate: Not measured");
  lines.push("");
  lines.push(summary.productionNote);
  lines.push(summary.methodologyNote);
  lines.push("");
  lines.push("## Outcomes (provisional)");
  lines.push("");
  lines.push("| ID | Evidence grounding | Technical correctness | Finding validity | Overall |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of summary.distinctions.provisionalConclusions) {
    lines.push(`| ${row.clientReportId} | ${row.evidenceGrounding} | ${row.technicalCorrectness} | ${row.findingValidity} | ${row.overallOutcome} |`);
  }
  lines.push("");
  lines.push("## Supported facts");
  lines.push("");
  for (const fact of summary.distinctions.supportedFacts) lines.push(`- ${fact}`);
  lines.push("");
  lines.push("## Requires professional judgment");
  lines.push("");
  for (const item of summary.distinctions.requiresProfessionalJudgment) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## C-002 hydraulic note");
  lines.push("");
  lines.push("Density×area (0.15×1524=228.6 GPM) is not the same quantity as FLOW DEMAND (596.81 GPM). Hose allowance 250 GPM is listed separately on the drawing.");
  lines.push("");
  lines.push("## Usability gaps");
  lines.push("");
  for (const gap of summary.usabilityGaps) {
    lines.push(`- **${gap.id}** (${gap.severity}, ${gap.findingExample}): ${gap.gap}`);
  }
  lines.push("");
  lines.push("No Phase 2B changes. No professionally verified metrics updates.");
  lines.push("");
  return lines.join("\n");
}
