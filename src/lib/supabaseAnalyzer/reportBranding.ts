/**
 * Commun-ET branding and legal text for Supabase Code Analyzer deliverables.
 * Disclaimer wording is reproduced verbatim from the client reference report; change it only
 * with client approval and bump DISCLAIMER_VERSION so every report records which text it carried.
 */
export const DISCLAIMER_VERSION = "commun-et-disclaimer.2026-10-26";

export const REPORT_COMPANY = "Commun-ET, LLC";
export const REPORT_PRODUCT = "PermitPilot\u2122 Code Analyzer";
export const REPORT_TITLE = "Severity-Ordered Architect Review";
export const RUNNING_HEADER = "PERMITPILOT | ARCHITECT REVIEW";
export const FOOTER_NOTICE = "PRELIMINARY \u00b7 Architect of Record verification required \u00b7 Not a code determination";

/** Short form used in the Excel register header. Keep in lockstep with DISCLAIMER_VERSION. */
export const DISCLAIMER_SHORT =
  "ADVISORY ONLY. The Architect of Record must review and verify every flagged item. Not a code determination. Code references marked 'Suggested' name the governing chapter only and must be confirmed against the adopted source text.";

export const DISCLAIMER_HEADING = "PROFESSIONAL VERIFICATION REQUIRED";

/** Each paragraph is a list of runs; bold runs follow the reference layout. */
export const DISCLAIMER_PARAGRAPHS: ReadonlyArray<ReadonlyArray<{ text: string; bold?: boolean }>> = [
  [
    {
      text: "The observations in this report are produced by PermitPilot\u2122, Commun-ET's automated preliminary drawing review tool. They are advisory only. This report is not a code determination, not a professional opinion, and not an approval of any kind.",
    },
  ],
  [
    { text: "The Architect of Record must review and verify every item flagged in this report", bold: true },
    {
      text: " against the submitted drawings, the adopted code text, and project-specific applicability. An item flagged as a potential code issue is an indication for professional review, not a finding of non-compliance.",
    },
  ],
  [
    {
      text: "PermitPilot\u2122 does not replace the judgment of the design professional of record, the engineer of record, or the authority having jurisdiction. Commun-ET, LLC makes no representation that this report identifies every code issue present in the drawings, or that every item flagged is in fact a deficiency. All code references must be confirmed against the adopted source text.",
    },
  ],
];

export const VERIFICATION_RESTATEMENT: readonly string[] = [
  "These are automated preliminary drawing-review observations, advisory only. This report is not a code determination, professional opinion, approval, certification or an exhaustive deficiency list.",
  "The Architect of Record must verify every flagged item against the submitted drawings, adopted code text and project-specific applicability, with the relevant engineers and authority having jurisdiction. The source severity labels have not been independently validated or changed.",
];

export type Rgb = readonly [number, number, number];

export const REPORT_COLORS = {
  ink: [15, 23, 42] as Rgb,
  heading: [22, 52, 74] as Rgb,
  body: [31, 41, 55] as Rgb,
  muted: [100, 116, 139] as Rgb,
  accent: [234, 88, 12] as Rgb,
  link: [37, 99, 235] as Rgb,
  panel: [244, 246, 249] as Rgb,
  tableHeader: [226, 232, 240] as Rgb,
  rule: [226, 232, 240] as Rgb,
  critical: [179, 38, 30] as Rgb,
  warning: [181, 101, 29] as Rgb,
  advisory: [26, 82, 118] as Rgb,
  other: [75, 85, 99] as Rgb,
};
