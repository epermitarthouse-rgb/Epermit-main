/**
 * Prompts, output parsing and versions shared by the project and central modes of discipline-classifier-agent
 * and context-reference-engine (D-121). One module so both modes classify with the same prompt and the
 * central results carry the exact prompt version that produced them.
 *
 * Pure module: no Deno globals or network imports.
 */

export const DISCIPLINE_ENUM = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Fire",
  "Civil",
  "Energy",
  "Zoning",
  "Environmental",
  "Administrative",
  "Other",
] as const;

export type Discipline = (typeof DISCIPLINE_ENUM)[number];

export function isDiscipline(s: unknown): s is Discipline {
  return typeof s === "string" && (DISCIPLINE_ENUM as readonly string[]).includes(s);
}

/** Values the project-mode classifier treats as "not classified yet". */
export const UNCLASSIFIED_DISCIPLINES = new Set(["", "General", "Unclassified"]);

export function isClassified(discipline: string | null | undefined): boolean {
  return !UNCLASSIFIED_DISCIPLINES.has(String(discipline ?? "").trim());
}

export const CENTRAL_MODEL = "gpt-4o";
export const CLASSIFIER_PROMPT_VERSION = "classifier@2026-11-18.1";
export const CENTRAL_ENRICHMENT_PROMPT_VERSION = "enrichment-central@2026-11-18.1";
/**
 * Key of every central result (permit_comment_insights.processing_version). Changing the model or either prompt
 * changes it, which makes every permit due again; the AI budget (permit_ai_budgets) bounds what that can cost.
 */
export const CENTRAL_PROCESSING_VERSION = `central-v1|${CENTRAL_MODEL}|${CLASSIFIER_PROMPT_VERSION}|${CENTRAL_ENRICHMENT_PROMPT_VERSION}`;

/** Comments per classifier call and per enrichment call (unchanged from the project-mode agents). */
export const CLASSIFIER_CHUNK = 45;
export const ENRICHMENT_CHUNK = 20;
/** Output caps for central calls; they bound the budget reservation (aiCost.ts). */
export const CENTRAL_CLASSIFIER_MAX_TOKENS = 2048;
export const CENTRAL_ENRICHMENT_MAX_TOKENS = 4096;
/** Longest comment body sent to the model in central mode; longer bodies are cut and the result says so. */
export const CENTRAL_MAX_BODY_CHARS = 6000;
/** A comment the model skips this many times is set aside as needs_attention instead of being retried. */
export const MAX_COMMENT_ATTEMPTS = 3;
export const LOW_CONFIDENCE = 0.7;

export const CLASSIFIER_SYSTEM_PROMPT = `Classify each building permit review comment into exactly one discipline and provide a confidence score.

Available disciplines and what they cover:

- Structural: Load-bearing elements, foundations, framing, steel, concrete, structural calculations, wind/seismic design, IBC Chapter 16-23

- Architectural: Building envelope, egress, accessibility (ADA), room layouts, finishes, doors/windows, fire-rated assemblies, IBC Chapters 3-12

- Mechanical: Heating, cooling, ventilation, ductwork, IMC code references (use "Mechanical" for HVAC)

- Electrical: Power distribution, lighting, panels, NEC code references, electrical load calculations

- Plumbing: Water supply, drainage, fixtures, IPC code references

- Fire: Sprinklers, fire alarms, smoke detectors, fire suppression, NFPA references

- Civil: Site work, grading, stormwater, surveyor's plat, erosion control, utilities, site plans

- Zoning: Setbacks, lot coverage, FAR, height limits, use permits, zoning code references, variances

- Environmental: Lead abatement, asbestos, hazardous materials, DOEE permits, EPA requirements, environmental surveys, contamination

- Energy: Energy code compliance, IECC, green building requirements, insulation, energy modeling (use "Energy" for green/energy)

- Administrative: Document formatting, missing submissions, permit fees, application completeness, signatures, stamps, certifications

- Other: ONLY use this if the comment truly doesn't fit any category above. Most comments SHOULD fit into one of the specific disciplines.

IMPORTANT: Prefer specific disciplines over 'Other'. For example:
- Lead abatement → Environmental (not Other)
- Asbestos survey → Environmental (not Other)
- Cost estimate upload → Administrative (not Other)
- Surveyor's plat → Civil
- Demo permit → Administrative or Environmental depending on context
- DOEE permit → Environmental

Return a JSON object with a single key "classifications": an array of objects with:
- "index" (0-based position in the list)
- "discipline" (exactly one of: Architectural, Structural, Mechanical, Electrical, Plumbing, Fire, Civil, Energy, Zoning, Environmental, Administrative, Other)
- "confidence_score" (a numeric value between 0.00 and 1.00 indicating your certainty in the classification. Use 0.95+ for clear-cut cases, 0.70-0.94 for likely matches, and below 0.70 for uncertain/ambiguous comments)

One object per comment in the same order as provided.`;

export const CENTRAL_ENRICHMENT_SYSTEM_PROMPT = `You are a building code expert helping a design team triage permit review comments before any project documents are read.
For each comment (with its reviewing department, comment type, jurisdiction and discipline), return:
1. "code_reference": the code section the comment cites. If it cites none, the most likely applicable section for the jurisdiction
   (for example DCMR 12A for Washington DC building code, IBC, NEC, NFPA, IECC). Use "" when no code applies (for example an administrative request).
2. "guidance": one or two sentences of generic, project-independent guidance on what a response to this kind of comment usually needs.
   Never invent project facts (addresses, sheet numbers, dimensions, names).

Return ONLY a JSON object: {"items": [{"index": 0, "code_reference": "...", "guidance": "..."}, ...]}, one item per comment, same order.`;

export type CentralCommentInput = {
  body: string | null;
  department: string | null;
  comment_type: string | null;
  jurisdiction: string | null;
  discipline?: string | null;
};

function oneLine(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

export function centralBody(body: string | null | undefined): { text: string; truncated: boolean } {
  const text = String(body ?? "").trim();
  if (text.length <= CENTRAL_MAX_BODY_CHARS) return { text, truncated: false };
  return { text: text.slice(0, CENTRAL_MAX_BODY_CHARS), truncated: true };
}

function contextLine(c: CentralCommentInput, withDiscipline: boolean): string {
  const parts = [
    `Department: ${oneLine(c.department) || "unknown"}`,
    `Type: ${oneLine(c.comment_type) || "unknown"}`,
    `Jurisdiction: ${oneLine(c.jurisdiction) || "unknown"}`,
  ];
  if (withDiscipline) parts.push(`Discipline: ${oneLine(c.discipline) || "unknown"}`);
  return parts.join(" | ");
}

/** User message for a central classifier call. Only permit-level fields: no project, team or document data. */
export function centralClassifierUserContent(items: CentralCommentInput[]): string {
  return items.map((c, i) => `[${i}] ${contextLine(c, false)}\n${centralBody(c.body).text}`).join("\n\n");
}

export function centralEnrichmentUserContent(items: CentralCommentInput[]): string {
  return items.map((c, i) => `[${i}] ${contextLine(c, true)}\n${centralBody(c.body).text}`).join("\n\n");
}

function stripFence(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

export type Classification = { index: number; discipline: Discipline; confidence: number };

/**
 * Model output → one classification per index that was asked for. Indexes the model skipped are absent, so
 * the caller can count them as not processed (never silently as done). Unknown disciplines become "Other".
 */
export function parseClassifications(content: string | null | undefined, count: number): Map<number, Classification> | null {
  if (!content) return null;
  let data: unknown;
  try {
    data = JSON.parse(stripFence(content));
  } catch {
    return null;
  }
  const list = Array.isArray((data as { classifications?: unknown })?.classifications)
    ? (data as { classifications: unknown[] }).classifications
    : null;
  if (!list) return null;
  const out = new Map<number, Classification>();
  for (const raw of list) {
    const c = raw as { index?: unknown; discipline?: unknown; confidence_score?: unknown };
    const i = typeof c.index === "number" ? c.index : Number.NaN;
    if (!Number.isInteger(i) || i < 0 || i >= count || out.has(i)) continue;
    const confidence = typeof c.confidence_score === "number" && Number.isFinite(c.confidence_score)
      ? Math.max(0, Math.min(1, c.confidence_score))
      : 0.5;
    out.set(i, { index: i, discipline: isDiscipline(c.discipline) ? c.discipline : "Other", confidence });
  }
  return out;
}

export type EnrichmentItem = { index: number; code_reference: string; guidance: string };

export function parseCentralEnrichment(content: string | null | undefined, count: number): Map<number, EnrichmentItem> | null {
  if (!content) return null;
  let data: unknown;
  try {
    data = JSON.parse(stripFence(content));
  } catch {
    return null;
  }
  const list = Array.isArray((data as { items?: unknown })?.items) ? (data as { items: unknown[] }).items : Array.isArray(data) ? data : null;
  if (!list) return null;
  const out = new Map<number, EnrichmentItem>();
  list.forEach((raw, pos) => {
    const c = raw as { index?: unknown; code_reference?: unknown; guidance?: unknown };
    const i = typeof c.index === "number" ? c.index : pos;
    if (!Number.isInteger(i) || i < 0 || i >= count || out.has(i)) return;
    out.set(i, {
      index: i,
      code_reference: typeof c.code_reference === "string" ? oneLine(c.code_reference).slice(0, 200) : "",
      guidance: typeof c.guidance === "string" ? c.guidance.trim().slice(0, 1200) : "",
    });
  });
  return out;
}

function alnum(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Provenance of a code reference, decided from the text, not from the model: "cited" only when the reference
 * (or its section number) is written in the comment itself; otherwise "inferred". "none" when there is no reference.
 */
export function codeBasis(codeReference: string, body: string | null | undefined): "cited" | "inferred" | "none" {
  const ref = oneLine(codeReference);
  if (!ref) return "none";
  const text = alnum(String(body ?? ""));
  if (text.includes(alnum(ref))) return "cited";
  const section = ref.match(/\d+(?:[.-]\d+)+[a-z]?/i)?.[0];
  if (section && section.length >= 3 && text.includes(alnum(section))) return "cited";
  return "inferred";
}

export const PRELIMINARY_LIMITATION = "Preliminary AI analysis, not a verified code compliance review.";
export const NO_PROJECT_LIMITATION = "No project drawings or documents were read.";

export function centralLimitations(input: {
  basis: "cited" | "inferred" | "none";
  confidence: number | null;
  truncated: boolean;
  guidance: string;
}): string[] {
  const out = [PRELIMINARY_LIMITATION, NO_PROJECT_LIMITATION];
  if (input.basis === "inferred") out.push("Code reference inferred by AI; the reviewer did not cite it.");
  if (input.basis === "none") out.push("No applicable code reference identified.");
  if (input.confidence != null && input.confidence < LOW_CONFIDENCE) out.push("Low confidence in the discipline.");
  if (input.truncated) out.push(`Comment longer than ${CENTRAL_MAX_BODY_CHARS} characters; only the first part was analysed.`);
  if (!input.guidance) out.push("No guidance generated.");
  return out;
}
