/**
 * Scope for the Supabase Code Analyzer only.
 * Historical runs leave analysis_mode null and keep the original prompt.
 * A selected mode limits which code families are discussed. It does not verify compliance.
 */

export const ANALYSIS_MODES = ["both", "ibc_only", "local_only"] as const;
export type StoredAnalysisMode = (typeof ANALYSIS_MODES)[number];

export interface RegistryBaseCode {
  family: string;
  edition: string;
  discipline: string;
}

/** Facts copied from shared/code-registry/jurisdiction-editions.json (dc-2017-construction-codes). */
export const DC_2017_REGISTRY_SNAPSHOT = {
  id: "dc-2017-construction-codes",
  jurisdictionKey: "dc",
  edition: "2017",
  label: "2017 DC Construction Codes",
  baseIbcEdition: "2015",
  baseCodes: [
    { family: "IBC", edition: "2015", discipline: "building" },
    { family: "IRC", edition: "2015", discipline: "residential" },
    { family: "IEBC", edition: "2015", discipline: "existing_building" },
    { family: "IFC", edition: "2015", discipline: "fire" },
    { family: "IMC", edition: "2015", discipline: "mechanical" },
    { family: "IPC", edition: "2015", discipline: "plumbing" },
    { family: "IFGC", edition: "2015", discipline: "fuel_gas" },
    { family: "IECC", edition: "2015", discipline: "residential_energy" },
    { family: "NEC", edition: "2014", discipline: "electrical" },
    { family: "ASHRAE 90.1", edition: "2013", discipline: "commercial_energy" },
    { family: "IgCC", edition: "2012", discipline: "green_construction" },
  ] satisfies RegistryBaseCode[],
  referencedStandards: [
    { family: "NFPA 70", edition: "2014", status: "adopted_base_code" },
    { family: "ANSI/ASHRAE/IES 90.1", edition: "2013", status: "adopted_base_code" },
  ],
  /** Section ids copied from this record's transitionProvisions. They are not amendment body text. */
  recordedLocalSections: ["123", "123.1.1", "123.1.2", "123.1.3", "123.1.4", "123.1.5"],
  localAmendmentRecord: "DCMR Title 12, subtitles A–M",
  enforceableProvisionText: "unavailable",
} as const;

const MEP_DISCIPLINES = new Set(["electrical", "plumbing", "mechanical", "fire", "fuel_gas"]);

export interface PersistedAnalysisScope {
  mode: StoredAnalysisMode;
  label: string;
  jurisdictionKey: string;
  registryRecordId: string | null;
  adoptedEdition: string | null;
  baseIbcEdition: string | null;
  mepFamiliesOutsideIbc: string[];
  limitation: string;
  sourceCoverage: "adoption_metadata_only" | "registry_gap" | "selected_edition_not_in_registry";
  promptScope: string;
}

export function isStoredAnalysisMode(value: unknown): value is StoredAnalysisMode {
  return value === "both" || value === "ibc_only" || value === "local_only";
}

/** New runs only. Omitted mode defaults to Both. Unknown values are rejected. */
export function normalizeNewRunAnalysisMode(
  value: unknown,
): StoredAnalysisMode | { error: string } {
  if (value == null || value === "") return "both";
  if (isStoredAnalysisMode(value)) return value;
  return { error: "analysisMode must be both, ibc_only, or local_only" };
}

export function displayAnalysisMode(mode: string | null | undefined): string {
  if (mode === "both") return "Both — Base Code + Local Amendments";
  if (mode === "ibc_only") return "IBC Only";
  if (mode === "local_only") return "Local Only";
  return "Legacy review";
}

export function analysisModeShortLabel(mode: string | null | undefined): string {
  if (mode === "both") return "Both";
  if (mode === "ibc_only") return "IBC Only";
  if (mode === "local_only") return "Local Only";
  return "Legacy";
}

function mepFamilies(codes: readonly RegistryBaseCode[]): string[] {
  return codes
    .filter((code) => MEP_DISCIPLINES.has(code.discipline))
    .map((code) => `${code.family} ${code.edition}`);
}

function isDcJurisdiction(jurisdictionKey: string, jurisdictionLabel: string): boolean {
  if (jurisdictionKey === "dc") return true;
  return /washington\s+d\.?\s*c|12a\s+dcmr|district of columbia/i.test(jurisdictionLabel);
}

export function isDc2017AnalyzerContext(input: {
  jurisdictionKey?: string;
  jurisdictionLabel?: string;
  codeEdition?: string;
  codeContext?: string;
}): boolean {
  return usesDc2017Record({
    jurisdictionKey: input.jurisdictionKey || "",
    jurisdictionLabel: input.jurisdictionLabel || "",
    codeEdition: input.codeEdition || "",
    codeContext: input.codeContext || "",
  });
}

function registryCode(discipline: string): RegistryBaseCode | undefined {
  return DC_2017_REGISTRY_SNAPSHOT.baseCodes.find((code) => code.discipline === discipline);
}

/** Adoption metadata for prompts. Provision text is not included and is not verified. */
export function dc2017EditionGuidance(): string {
  const building = registryCode("building");
  const electrical = registryCode("electrical");
  const plumbing = registryCode("plumbing");
  const mechanical = registryCode("mechanical");
  const fire = registryCode("fire");
  const fuel = registryCode("fuel_gas");
  const nfpa = DC_2017_REGISTRY_SNAPSHOT.referencedStandards.find((item) => item.family === "NFPA 70");
  const lines = [
    "Recorded adopted editions for the 2017 DC Construction Codes. This is registry adoption metadata only. Enforceable provision text is not available, and naming an edition does not verify a citation.",
  ];
  if (building) lines.push(`Building base code: ${building.edition} ${building.family}.`);
  if (electrical) {
    const nfpaNote = nfpa ? ` The registry records ${nfpa.family} ${nfpa.edition} as that electrical standard.` : "";
    lines.push(`Electrical: ${electrical.edition} ${electrical.family}.${nfpaNote} Do not cite IBC Chapter 27 or a different NEC edition.`);
  }
  if (plumbing) lines.push(`Plumbing: ${plumbing.edition} ${plumbing.family}. Do not cite an unrelated IBC chapter for plumbing provisions.`);
  if (mechanical) lines.push(`Mechanical: ${mechanical.edition} ${mechanical.family}. Do not cite an unrelated IBC chapter for mechanical provisions.`);
  if (fire) lines.push(`Fire: ${fire.edition} ${fire.family}.`);
  if (fuel) lines.push(`Fuel gas: ${fuel.edition} ${fuel.family}.`);
  lines.push(
    "A code reference must name the family and the applicable edition, and a section only when the drawing or the recorded adoption supports that section. State whether it is a base code or a local amendment when that is known.",
    "If a precise citation is not supported, leave suggested_code_reference empty. Do not write General Compliance, Could reference, Suggest referencing, or a guessed section.",
    `Local amendment record: ${DC_2017_REGISTRY_SNAPSHOT.localAmendmentRecord}. Do not invent a DCMR section number.`,
    "The selected analysis mode still controls which of these families may be discussed.",
  );
  return lines.join(" ");
}

function usesDc2017Record(input: {
  jurisdictionKey: string;
  jurisdictionLabel: string;
  codeEdition: string;
  codeContext: string;
}): boolean {
  if (!isDcJurisdiction(input.jurisdictionKey, input.jurisdictionLabel)) return false;
  return input.codeEdition === DC_2017_REGISTRY_SNAPSHOT.edition
    || input.codeContext === "2017 DC Construction Codes (2015 IBC base)";
}

function mepExclusionSentence(families: readonly string[]): string {
  const listed = families.length ? families.join(", ") : "the adopted electrical, plumbing, mechanical, and fire-protection codes";
  return `Electrical, plumbing, mechanical, and fire-protection provisions follow ${listed}. They are not reviewed as IBC provisions.`;
}

export function resolveAnalyzerReviewScope(input: {
  mode: StoredAnalysisMode;
  jurisdictionKey: string;
  jurisdictionLabel: string;
  codeEdition: string;
  codeContext: string;
}): PersistedAnalysisScope {
  const label = displayAnalysisMode(input.mode);
  const dc2017 = usesDc2017Record(input);
  const mep = mepFamilies(DC_2017_REGISTRY_SNAPSHOT.baseCodes);
  const base: Omit<PersistedAnalysisScope, "limitation" | "sourceCoverage" | "promptScope" | "adoptedEdition" | "baseIbcEdition" | "registryRecordId"> = {
    mode: input.mode,
    label,
    jurisdictionKey: input.jurisdictionKey,
    mepFamiliesOutsideIbc: dc2017 ? mep : [],
  };

  if (!dc2017 && isDcJurisdiction(input.jurisdictionKey, input.jurisdictionLabel)) {
    const limitation = `The verified record is ${DC_2017_REGISTRY_SNAPSHOT.label} (${DC_2017_REGISTRY_SNAPSHOT.baseIbcEdition} IBC base). The selected edition is not that record, so that base edition is not applied.`;
    return {
      ...base,
      registryRecordId: null,
      adoptedEdition: null,
      baseIbcEdition: null,
      sourceCoverage: "selected_edition_not_in_registry",
      limitation,
      promptScope: scopePrompt(input.mode, {
        knownDc2017: false,
        dcSelectedOtherEdition: true,
        limitation,
      }),
    };
  }

  if (!dc2017) {
    const limitation = "No verified adopted-edition record is available for this jurisdiction. Local amendment text and an IBC edition are not invented.";
    return {
      ...base,
      registryRecordId: null,
      adoptedEdition: null,
      baseIbcEdition: null,
      sourceCoverage: "registry_gap",
      limitation,
      promptScope: scopePrompt(input.mode, {
        knownDc2017: false,
        dcSelectedOtherEdition: false,
        limitation,
      }),
    };
  }

  const adoptedEdition = DC_2017_REGISTRY_SNAPSHOT.label;
  const baseIbcEdition = DC_2017_REGISTRY_SNAPSHOT.baseIbcEdition;
  const limitation = input.mode === "ibc_only"
    ? `Building topics use the ${baseIbcEdition} IBC only. Local amendments are excluded. Electrical, plumbing, mechanical, and fire protection are outside this mode.`
    : input.mode === "local_only"
      ? `Local review uses the recorded ${DC_2017_REGISTRY_SNAPSHOT.localAmendmentRecord} adoption. Amendment body text is not in the authorized sources and is not invented.`
      : `${adoptedEdition} with the ${baseIbcEdition} IBC base for the building code, plus the recorded local amendment adoption. ${mepExclusionSentence(mep)} Amendment body text is not in the authorized sources.`;

  return {
    ...base,
    registryRecordId: DC_2017_REGISTRY_SNAPSHOT.id,
    adoptedEdition,
    baseIbcEdition,
    sourceCoverage: "adoption_metadata_only",
    limitation,
    promptScope: scopePrompt(input.mode, {
      knownDc2017: true,
      dcSelectedOtherEdition: false,
      limitation,
      mep,
    }),
  };
}

function scopePrompt(
  mode: StoredAnalysisMode,
  facts: {
    knownDc2017: boolean;
    dcSelectedOtherEdition: boolean;
    limitation: string;
    mep?: string[];
  },
): string {
  const lines = [`Mode: ${displayAnalysisMode(mode)}.`, `Limitation: ${facts.limitation}`];
  if (facts.knownDc2017 && mode === "both") {
    lines.push(
      `Review the building code as ${DC_2017_REGISTRY_SNAPSHOT.baseIbcEdition} IBC together with recorded ${DC_2017_REGISTRY_SNAPSHOT.label} local amendments (${DC_2017_REGISTRY_SNAPSHOT.localAmendmentRecord}).`,
      mepExclusionSentence(facts.mep || []),
      "Electrical citations use the recorded NEC edition, not IBC Chapter 27 and not a different NEC year. Plumbing, mechanical, and fire citations use the recorded IPC, IMC, and IFC editions, not an unrelated IBC chapter.",
      "Leave suggested_code_reference empty when the family, edition, and a supported section cannot all be stated. Do not write General Compliance or Could reference.",
      "Do not invent local amendment text, numeric thresholds, or code sections that are not visible on the drawing.",
    );
  } else if (facts.knownDc2017 && mode === "ibc_only") {
    lines.push(
      `Review building-code topics under the ${DC_2017_REGISTRY_SNAPSHOT.baseIbcEdition} IBC only.`,
      "Do not apply District of Columbia local amendments.",
      "Do not apply the IBC to electrical, plumbing, mechanical, or fire-protection provisions, and do not perform a comprehensive MEP review.",
      "Do not cite NEC, IPC, IMC, or IFC sections in this mode.",
      "If this sheet is primarily electrical, plumbing, mechanical, or fire protection, return no findings.",
    );
  } else if (facts.knownDc2017 && mode === "local_only") {
    lines.push(
      `Discuss only the recorded local amendment adoption (${DC_2017_REGISTRY_SNAPSHOT.localAmendmentRecord}).`,
      "Do not review the base IBC as a local amendment.",
      "Do not cite a base IBC, NEC, IPC, IMC, or IFC section as a local amendment.",
      "Do not invent missing amendment text. If a local amendment cannot be stated from the drawing without inventing text, return no finding.",
    );
  } else if (mode === "ibc_only") {
    lines.push(
      "Do not assume the 2015 IBC or any other edition is adopted.",
      "Do not apply an IBC-only review to electrical, plumbing, mechanical, or fire-protection provisions.",
      "Do not invent model-code text.",
    );
  } else if (mode === "local_only") {
    lines.push(
      "No supported local amendment text is on record for this selection.",
      "Return no local-amendment findings rather than inventing amendment text.",
    );
  } else {
    lines.push(
      "Do not present the selected year as a verified adoption.",
      "Do not invent local amendment text.",
      "Do not treat electrical, plumbing, mechanical, or fire-protection provisions as IBC provisions.",
    );
  }
  return lines.join(" ");
}

export function legacySupabaseAnalyzerPrompt(run: {
  jurisdiction_label: string;
  code_context: string;
  project_type: string;
  jurisdiction_key?: string;
  code_edition?: string;
}): string {
  const editionGuidance = isDc2017AnalyzerContext({
    jurisdictionKey: run.jurisdiction_key,
    jurisdictionLabel: run.jurisdiction_label,
    codeEdition: run.code_edition,
    codeContext: run.code_context,
  })
    ? dc2017EditionGuidance()
    : "No verified adopted-edition record is available for this selection. Do not invent an IBC, NEC, IPC, IMC, IFC, or local-amendment edition.";
  return `You are performing a preliminary professional review of one commercial permit drawing sheet.

Review context:
- Jurisdiction: ${run.jurisdiction_label}
- Selected adopted-code context: ${run.code_context}
- Project type: ${run.project_type}
- Source coverage: adoption metadata is recorded, but complete authoritative technical code text is not supplied.
- ${editionGuidance}

Rules:
1. Analyze only content actually visible in the attached drawing. Never infer a condition from the filename.
2. Every observation must quote or precisely describe its visible drawing evidence and location.
3. Do not call an observation a confirmed violation. Use conservative professional review language.
4. A code section is a proposed reference unless its authoritative text is present in the drawing itself. Syntax is not verification.
5. Do not invent numeric thresholds, local amendments, dimensions, labels, or code sections.
6. If the drawing is illegible or lacks enough evidence, return no finding for that topic.
7. Identify the printed sheet number, printed sheet title, and discipline from the drawing title block when visible.
8. Return no more than 12 high-value observations. Do not invent observations to reach a target count. An empty findings array is correct when the sheet does not show a review issue.
9. Before publishing a finding, classify it as one of: actual discrepancy; missing required information; conflicting information; explicit drawing requirement; general coordination note; further professional review. Publish a deficiency only for an actual discrepancy, a demonstrated omission, or a visible conflict.
10. An explicit drawing requirement or coordination note is not a violation. A note that correctly requires GFCI protection, exit-door operation, valve access, sealed penetrations, manufacturer compliance, or trade coordination is not evidence of noncompliance. Do not classify that note as critical or warning because the topic is life safety.
11. Severity must reflect evidence of a problem, not the importance of the subject. Critical requires a specific, supported, potentially serious discrepancy. Warning requires a credible deficiency, inconsistency, or unresolved technical concern. Advisory is for coordination, clarification, or follow-up. If the evidence does not show a discrepancy, omit the finding.
12. Do not treat a detail that is absent from this sheet as absent from the project. The user message may include a submitted sheet index built from filenames and detected sheet numbers. If that index contains the referenced sheet, do not report the sheet as missing, and do not claim the other sheet proves compliance. Its content was not reviewed in this request. If the index does not resolve the reference, say the reference is unresolved.
13. For a calculation, identify the observed inputs, units, and the governing formula or selection method printed on the sheet. State a computed result only when it follows from those inputs. Do not assume the larger of two intermediate values governs. If the sheet states a lesser-of, smaller-of, or minimum method, apply that method. Two different intermediate results are not a violation without the governing rule. If the rule is missing or ambiguous, do not assert a numerical code violation.
14. The observation for a deficiency must be able to answer: what the drawing shows; what inconsistency, omission, or potentially noncompliant condition is visible; why it is materially relevant; which supported code or technical rule applies, if one is actually known; and what additional evidence would resolve uncertainty.
15. Do not recommend "Ensure compliance with all applicable codes." Make the recommendation specific to the observed condition, or omit the finding. Do not publish a finding that only restates normal drawing content.
16. Before claiming required details or specifications are missing from the project, check whether the sheet points to another sheet or detail (SEE SHEET, SEE DETAIL, REFER TO). If that reference is on the submitted sheet index, do not conclude the content is absent from the project, and do not conclude compliance. You may still report a sheet-local concern at an evidence-supported severity. If supporting excerpts from the referenced sheet are included in the user message, use only that quoted text plus the current sheet PDF; still do not invent unread content.
17. For sprinkler hydraulic summaries, density × discharge area is not total FLOW DEMAND. Do not treat those different values as an inconsistency. Hose allowance is a separate listed quantity and does not by itself prove either value wrong.
18. Do not claim a specification is missing when the quoted drawing evidence already states that specification (for example reinforcement sizes, insulation products, or hose allowance).
19. Keyed-note numbers must match the numbered note you quote. Do not cite note N unless that number appears with the quoted note text.
20. Revision or drawing dates are not "future" unless they are after the analysis date you were given. Do not invent an analysis date.
21. Supporting excerpts from referenced sheets are machine-extracted text-layer snippets with provenance. They are not verified code compliance. An empty or failed excerpt means content was not retrieved—not that the detail is missing or compliant. Never downgrade a Critical finding solely because retrieval failed.`;
}

export function processorReviewPrompt(run: {
  analysis_mode?: string | null;
  analysis_scope?: { promptScope?: string } | null;
  jurisdiction_label: string;
  jurisdiction_key?: string;
  code_edition?: string;
  code_context: string;
  project_type: string;
}): string {
  const legacy = legacySupabaseAnalyzerPrompt(run);
  if (!isStoredAnalysisMode(run.analysis_mode)) return legacy;
  const promptScope = run.analysis_scope?.promptScope
    || resolveAnalyzerReviewScope({
      mode: run.analysis_mode,
      jurisdictionKey: run.jurisdiction_key || "",
      jurisdictionLabel: run.jurisdiction_label,
      codeEdition: run.code_edition || "",
      codeContext: run.code_context,
    }).promptScope;
  return `${legacy}

Analysis mode scope:
${promptScope}

This mode only limits the code families discussed. It does not verify compliance, and it does not supply missing code text.`;
}
