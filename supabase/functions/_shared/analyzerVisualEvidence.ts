/**
 * Phase 3 Stage 1–2 — sheet-local visual evidence grounding (logical layers 4–6).
 *
 * Stage 1: sheet-class look-for checklist (quote-before-absence).
 * Stage 2: bounded text-layer topic packs via unpdf (reuse Phase 3A extractPdfTextLayer).
 *
 * Failures must never stop baseline sheet analysis. Packs are not verified compliance.
 * Independent of SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL (keep CSR default off).
 * Does not run macOS Vision OCR on Edge.
 */
import { extractPdfTextLayer } from "./analyzerCrossSheetRetrieval.ts";

export const VISUAL_EVIDENCE_VERSION = "phase3.visual-evidence.v1";

export const VISUAL_EVIDENCE_BOUNDS = {
  maxPacks: 3,
  maxCharsPerPack: 800,
  maxTotalChars: 2500,
  sparseTextChars: 200,
} as const;

export type VisualEvidenceTopic =
  | "door_schedule_and_hardware"
  | "guardrail_height"
  | "hydraulic_design";

export type VisualEvidencePackStatus =
  | "recovered"
  | "sparse_text"
  | "not_found"
  | "failed"
  | "disabled";

export type VisualEvidenceRunStatus =
  | "disabled"
  | "checklist_only"
  | "recovered"
  | "sparse_text"
  | "not_found"
  | "failed";

export interface VisualEvidencePack {
  id: string;
  topic: VisualEvidenceTopic;
  status: VisualEvidencePackStatus;
  extractedTexts: string[];
  detailHints: string[];
  charCount: number;
  regionKind: string | null;
  provenance: {
    origin: "machine_extracted_text_layer";
    method: "topic_window";
    independentlyVerified: false;
    uncertainty: string;
  };
  limitations: string[];
  assessment: Record<string, unknown> | null;
}

export interface VisualEvidenceResult {
  version: typeof VISUAL_EVIDENCE_VERSION;
  enabled: boolean;
  status: VisualEvidenceRunStatus;
  latencyMs: number;
  sheetFileName: string;
  topics: VisualEvidenceTopic[];
  packs: VisualEvidencePack[];
  checklistBlock: string;
  promptBlock: string;
  textLayerChars: number;
  lowText: boolean;
  notes: string[];
}

export interface VisualEvidenceDeps {
  extractPdfText?: (bytes: Uint8Array) => Promise<{ pageCount: number; text: string; lowText: boolean }>;
  now?: () => number;
}

const TOPIC_PATTERNS: Record<VisualEvidenceTopic, RegExp> = {
  door_schedule_and_hardware:
    /\bDOOR\s+SCHEDULE\b|\bMARK\s+DOOR\b|\b(?:PANIC|LOCK(?:SET|GUARD)?|SCHLAGE|V\.?\s*DUPRIN|ALARM\s+LOCK|KEYLESS)\b|\bFIRE\s*RATED|\bFIRE[- ]RATING|\bUL\s*LABEL|\bEXIT\s+DOORS?\b|\bDIRECTION\s+OF\s+EGRESS\b/i,
  guardrail_height:
    /3\s*['′]\s*-?\s*6\s*"?\s*MIN\.?\s*HEIGHT|\bMIN\.?\s*HEIGHT(?:\s+FROM)?\b|\bGUARD\s*RAIL\b|\bPIPE\s+RAILING\b|\bEXTEND\s+GUARD\b/i,
  hydraulic_design:
    /\b(?:HYDRAULIC\s+DESIGN|DENSITY|DISCHARGE\s+AREA|HOSE\s+ALLOWANCE|FLOW\s+DEMAND|PRESSURE\s+DEMAND)\b/i,
};

const DOOR_LOCKING = /\b(?:PANIC|LOCK(?:SET|GUARD)?|SCHLAGE|V\.?\s*DUPRIN|ALARM\s+LOCK|KEYLESS|EGRESS)\b/i;
const DOOR_FIRE = /\bFIRE\s*RATED|\bFIRE[- ]RATING|\bUL\s*LABEL|\bOPENING\s+PROTECTIVE|\bGASKETS?\s+FOR\s+DOOR/i;
const DOOR_SCHEDULE = /\bDOOR\s+SCHEDULE\b|\bMARK\s+DOOR\b|\bDOOR\s*#?\s*\d+/i;
const GUARD_HEIGHT = /3\s*['′]\s*-?\s*6\s*"?\s*MIN\.?\s*HEIGHT|\bMIN\.?\s*HEIGHT(?:\s+FROM)?\b/i;
const GUARD_NOTE = /\bGUARD\s*RAIL\b|\bPIPE\s+RAILING\b|\bEXTEND\s+GUARD\b/i;
const DETAIL_HINT = /\bdetail\s*(\d{1,3})\b/gi;

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function stablePackId(sheetKey: string, topic: string, texts: string[]): string {
  const payload = `${sheetKey}|${topic}|${texts.slice(0, 5).join("|")}`;
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${sheetKey}.${topic}.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sheetKeyFromFileName(fileName: string): string {
  const cleaned = String(fileName || "").toUpperCase().replace(/\.PDF\b/g, "").trim();
  const match = cleaned.match(/\b([A-Z]{1,4})\s*[- ]?\s*(\d{1,3}(?:\.\d{1,3})?)/);
  if (match) return `${match[1]}${match[2]}`;
  return oneLine(cleaned.replace(/[^A-Z0-9]+/g, ""), 24) || "sheet";
}

/** Env feature flag — default off; independent of cross-sheet retrieval. */
export function isVisualEvidenceEnabled(
  env: { get(key: string): string | undefined } | undefined = undefined,
): boolean {
  const source = env ?? (typeof Deno !== "undefined" ? Deno.env : undefined);
  const value = source?.get("SUPABASE_ANALYZER_VISUAL_EVIDENCE");
  return typeof value === "string" && value.toLowerCase() === "true";
}

/**
 * Classify sheet-local topics from filename heuristics and optional text-layer signals.
 * Deterministic ordering for stable packs.
 */
export function classifyVisualEvidenceTopics(
  fileName: string,
  text = "",
): VisualEvidenceTopic[] {
  const name = String(fileName || "").toUpperCase();
  const body = String(text || "");
  const topics = new Set<VisualEvidenceTopic>();

  if (
    /\bA\s*[- ]?\s*6(?:\.\d+)?\b/.test(name)
    || /DOOR\s+SCHEDULE|DOOR\s+TYPES|HARDWARE/i.test(name)
    || DOOR_SCHEDULE.test(body)
    || DOOR_LOCKING.test(body)
    || DOOR_FIRE.test(body)
  ) {
    topics.add("door_schedule_and_hardware");
  }
  if (
    /\bA\s*[- ]?\s*3\.06\b/.test(name)
    || ((/SECTION|WALL\s+SECTION|DETAIL/i.test(name)) && GUARD_NOTE.test(body))
    || GUARD_HEIGHT.test(body)
    || GUARD_NOTE.test(body)
  ) {
    topics.add("guardrail_height");
  }
  if (
    /\bFP\s*\d|\bFIRE\s*PROTECTION|HYDRAULIC/i.test(name)
    || TOPIC_PATTERNS.hydraulic_design.test(body)
  ) {
    topics.add("hydraulic_design");
  }

  const order: VisualEvidenceTopic[] = [
    "door_schedule_and_hardware",
    "guardrail_height",
    "hydraulic_design",
  ];
  return order.filter((topic) => topics.has(topic));
}

export function buildVisualEvidenceLookForChecklist(
  fileName: string,
  topics: VisualEvidenceTopic[],
): string {
  if (!topics.length) return "";
  const lines: string[] = [
    "Visual evidence look-for (sheet-local; machine guidance only — not verified compliance):",
    "Before claiming Critical absence on these topics, quote the visible schedule/detail/note text from the attached PDF (or from any pack below). If you cannot locate it after looking, use advisory uncertainty — do not invent unread content.",
  ];
  for (const topic of topics) {
    if (topic === "door_schedule_and_hardware") {
      lines.push(
        `- Door schedule / locking / fire-rated openings (${oneLine(fileName, 80)}): quote MARK/hardware (panic, lockset, alarm lock) and fire-rating/UL/gasket notes before Critical locking or fire-rating absence.`,
      );
    } else if (topic === "guardrail_height") {
      lines.push(
        `- Guardrail / railing details: look for 3′-6″ MIN HEIGHT (or equivalent) with guard-rail / pipe railing language on the cited detail before Critical height absence. Do not clear from an unrelated MIN HEIGHT elsewhere.`,
      );
    } else if (topic === "hydraulic_design") {
      lines.push(
        `- Hydraulic design box: quote density, discharge area, hose allowance, and flow demand separately. Density × discharge area is not total FLOW DEMAND.`,
      );
    }
  }
  return lines.join("\n");
}

function splitWindows(text: string): string[] {
  const normalized = String(text || "").replace(/\r/g, "");
  if (!normalized.trim()) return [];
  const byLine = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (byLine.length >= 2) return byLine;
  // Single-line CAD/text extracts: slide windows on sentence-ish breaks.
  return normalized
    .split(/(?<=[.|;])\s+|\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
}

function collectTopicSnippets(text: string, topic: VisualEvidenceTopic, maxChars: number): string[] {
  const pattern = TOPIC_PATTERNS[topic];
  const windows = splitWindows(text);
  const hits: string[] = [];
  let used = 0;
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    if (!pattern.test(window)) continue;
    const neighbors = [windows[index - 1], window, windows[index + 1]]
      .filter(Boolean)
      .join(" | ");
    const snippet = oneLine(neighbors, Math.min(280, maxChars - used));
    if (!snippet || hits.includes(snippet)) continue;
    if (used + snippet.length > maxChars) break;
    hits.push(snippet);
    used += snippet.length + 1;
    if (hits.length >= 8) break;
  }
  return hits;
}

function detailHintsFromTexts(texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(DETAIL_HINT)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found].slice(0, 6);
}

export function assessGuardrailFromText(texts: string[]): Record<string, unknown> {
  const joined = texts.join("\n");
  const hasHeight = GUARD_HEIGHT.test(joined);
  const hasGuard = GUARD_NOTE.test(joined);
  if (!hasHeight) {
    return {
      status: "not_found",
      applicableToGuardrail: "unresolved",
      note: "No MIN HEIGHT / 3'-6\" string recovered in text layer.",
      independentlyVerified: false,
    };
  }
  if (!hasGuard) {
    return {
      status: "found_unassociated",
      applicableToGuardrail: "unresolved",
      note: "Height recovered; guard-rail language not in the same pack windows.",
      independentlyVerified: false,
    };
  }
  return {
    status: "associated_candidate",
    applicableToGuardrail: "likely_same_detail_candidate",
    note: "Height and guard-rail language co-occur in text-layer windows (candidate only).",
    independentlyVerified: false,
  };
}

function sequentialLabelValue(text: string, label: RegExp, value: RegExp): string | null {
  const windows = splitWindows(text);
  for (let index = 0; index < windows.length; index += 1) {
    if (!label.test(windows[index])) continue;
    for (let cursor = index; cursor < Math.min(windows.length, index + 4); cursor += 1) {
      const match = windows[cursor].match(value);
      if (match?.[1]) return match[1];
    }
  }
  const direct = text.match(new RegExp(`${label.source}[^\\n]{0,40}${value.source}`, "i"));
  return direct?.[1] || null;
}

export function assessHydraulicFromText(text: string): Record<string, unknown> {
  const densityRaw = sequentialLabelValue(text, /\bDENSITY\b/i, /([\d.]+)\s*GPM/i)
    || sequentialLabelValue(text, /\bDENSITY\b/i, /\b(0\.\d+)\b/);
  const areaRaw = sequentialLabelValue(text, /DISCHARGE\s+AREA/i, /([\d,]+)/);
  const hoseRaw = sequentialLabelValue(text, /HOSE\s+ALLOWANCE/i, /([\d.]+)\s*GPM/i);
  const flowRaw = sequentialLabelValue(text, /FLOW\s+DEMAND/i, /([\d.]+)\s*GPM/i);
  const densityVal = densityRaw != null ? Number(String(densityRaw).replace(/,/g, "")) : null;
  const areaVal = areaRaw != null ? Number(String(areaRaw).replace(/,/g, "")) : null;
  const hoseVal = hoseRaw != null ? Number(String(hoseRaw).replace(/,/g, "")) : null;
  const flowVal = flowRaw != null ? Number(String(flowRaw).replace(/,/g, "")) : null;
  const product = densityVal != null && areaVal != null ? Number((densityVal * areaVal).toFixed(4)) : null;
  return {
    values: {
      densityGpmPerSqFt: densityVal,
      dischargeAreaSqFt: areaVal,
      hoseAllowanceGpm: hoseVal,
      flowDemandGpm: flowVal,
      densityTimesArea: product,
    },
    relationships: {
      densityAreaEqualsFlowDemand: product != null && flowVal != null
        ? Math.abs(product - flowVal) <= Math.max(1, product * 0.02)
        : null,
    },
    interpretation:
      "Density × discharge area is a density-area quantity, not proof that FLOW DEMAND is wrong. Text-layer machine extraction only.",
    independentlyVerified: false,
  };
}

export function assessDoorFromText(texts: string[]): Record<string, unknown> {
  const joined = texts.join("\n");
  return {
    schedulePresent: DOOR_SCHEDULE.test(joined),
    lockingHardwareQuoted: DOOR_LOCKING.test(joined),
    fireRatingLanguageQuoted: DOOR_FIRE.test(joined),
    note: "Text-layer quotes contradict blanket absence only when hardware/fire notes are present. Schedule completeness still needs professional review.",
    independentlyVerified: false,
  };
}

export function buildVisualEvidencePacks(input: {
  fileName: string;
  text: string;
  topics: VisualEvidenceTopic[];
  lowText?: boolean;
}): VisualEvidencePack[] {
  const sheetKey = sheetKeyFromFileName(input.fileName);
  const text = String(input.text || "");
  const sparse = Boolean(input.lowText) || text.length < VISUAL_EVIDENCE_BOUNDS.sparseTextChars;
  const packs: VisualEvidencePack[] = [];
  let totalChars = 0;

  for (const topic of input.topics.slice(0, VISUAL_EVIDENCE_BOUNDS.maxPacks)) {
    const remaining = Math.min(
      VISUAL_EVIDENCE_BOUNDS.maxCharsPerPack,
      VISUAL_EVIDENCE_BOUNDS.maxTotalChars - totalChars,
    );
    if (remaining <= 40) break;

    const snippets = collectTopicSnippets(text, topic, remaining);
    let status: VisualEvidencePackStatus;
    if (snippets.length) status = "recovered";
    else if (sparse) status = "sparse_text";
    else status = "not_found";

    let assessment: Record<string, unknown> | null = null;
    if (topic === "guardrail_height") assessment = assessGuardrailFromText(snippets.length ? snippets : [text]);
    if (topic === "hydraulic_design") assessment = assessHydraulicFromText(text);
    if (topic === "door_schedule_and_hardware") assessment = assessDoorFromText(snippets);

    const limitations = [
      "Machine-extracted PDF text layer only — not professionally verified.",
      "not_found / sparse_text means not recovered from the examined text layer — not proof the drawing lacks the content.",
    ];
    if (sparse) {
      limitations.push("Text layer is sparse (common on CAD sheets); rely on the attached PDF and look-for checklist.");
    }

    const pack: VisualEvidencePack = {
      id: stablePackId(sheetKey, topic, snippets),
      topic,
      status,
      extractedTexts: snippets,
      detailHints: detailHintsFromTexts(snippets),
      charCount: snippets.reduce((sum, item) => sum + item.length, 0),
      regionKind: null,
      provenance: {
        origin: "machine_extracted_text_layer",
        method: "topic_window",
        independentlyVerified: false,
        uncertainty: "Text-layer topic windows. Not OCR Vision. Not verified compliance evidence.",
      },
      limitations,
      assessment,
    };
    packs.push(pack);
    totalChars += pack.charCount;
  }
  return packs;
}

export function formatVisualEvidencePrompt(result: Pick<
  VisualEvidenceResult,
  "checklistBlock" | "packs" | "status" | "notes" | "sheetFileName"
>): string {
  if (result.status === "disabled") return "";
  const parts: string[] = [];
  if (result.checklistBlock.trim()) parts.push(result.checklistBlock.trim());

  const usefulPacks = result.packs.filter((pack) => pack.status !== "disabled");
  if (usefulPacks.length) {
    parts.push(
      "Bounded sheet-local evidence packs (machine-extracted text layer):",
      "These packs are not verified code compliance. Quote them or the attached PDF before Critical absence claims. Empty/sparse packs mean not retrieved from the text layer — not proof of absence or compliance. Never downgrade a Critical finding solely because pack retrieval failed.",
    );
    for (const pack of usefulPacks) {
      parts.push(
        `- pack=${pack.id} | topic=${pack.topic} | status=${pack.status} | provenance=${pack.provenance.origin} | independentlyVerified=false`,
      );
      if (pack.detailHints.length) {
        parts.push(`  detailHints: ${pack.detailHints.join(", ")}`);
      }
      if (pack.extractedTexts.length) {
        parts.push(`  excerpts: ${pack.extractedTexts.join(" || ")}`);
      } else {
        parts.push(`  excerpts: (none — ${pack.status})`);
      }
      if (pack.assessment && pack.topic === "hydraulic_design") {
        const values = (pack.assessment.values || {}) as Record<string, unknown>;
        parts.push(
          `  hydraulicValues: density=${values.densityGpmPerSqFt ?? "n/a"} area=${values.dischargeAreaSqFt ?? "n/a"} hose=${values.hoseAllowanceGpm ?? "n/a"} flowDemand=${values.flowDemandGpm ?? "n/a"} (density×area≠flowDemand)`,
        );
      }
      if (pack.assessment && pack.topic === "guardrail_height") {
        parts.push(
          `  guardrailAssociation: ${String(pack.assessment.status || "unresolved")} (${String(pack.assessment.applicableToGuardrail || "unresolved")})`,
        );
      }
    }
  }
  if (result.notes.length) {
    parts.push(`Notes: ${result.notes.join(" ")}`);
  }
  return parts.join("\n");
}

function emptyResult(
  partial: Partial<VisualEvidenceResult> & Pick<VisualEvidenceResult, "status" | "enabled" | "sheetFileName">,
): VisualEvidenceResult {
  return {
    version: VISUAL_EVIDENCE_VERSION,
    enabled: partial.enabled,
    status: partial.status,
    latencyMs: partial.latencyMs || 0,
    sheetFileName: partial.sheetFileName,
    topics: partial.topics || [],
    packs: partial.packs || [],
    checklistBlock: partial.checklistBlock || "",
    promptBlock: partial.promptBlock || "",
    textLayerChars: partial.textLayerChars || 0,
    lowText: partial.lowText || false,
    notes: partial.notes || [],
  };
}

/**
 * Bounded sheet-local visual evidence. Never throws — returns failed/disabled instead.
 */
export async function retrieveVisualEvidence(input: {
  enabled: boolean;
  fileName: string;
  pdfBytes: Uint8Array;
  deps?: VisualEvidenceDeps;
}): Promise<VisualEvidenceResult> {
  const started = (input.deps?.now || Date.now)();
  if (!input.enabled) {
    return emptyResult({
      enabled: false,
      status: "disabled",
      sheetFileName: input.fileName,
      latencyMs: 0,
    });
  }

  try {
    const extract = input.deps?.extractPdfText || extractPdfTextLayer;
    const extracted = await extract(input.pdfBytes);
    const topics = classifyVisualEvidenceTopics(input.fileName, extracted.text);
    const checklistBlock = buildVisualEvidenceLookForChecklist(input.fileName, topics);
    const packs = buildVisualEvidencePacks({
      fileName: input.fileName,
      text: extracted.text,
      topics,
      lowText: extracted.lowText,
    });

    const recovered = packs.some((pack) => pack.status === "recovered");
    const sparse = packs.some((pack) => pack.status === "sparse_text")
      || extracted.lowText
      || extracted.text.length < VISUAL_EVIDENCE_BOUNDS.sparseTextChars;
    let status: VisualEvidenceRunStatus;
    if (recovered) status = "recovered";
    else if (topics.length && !packs.length) status = "checklist_only";
    else if (sparse && topics.length) status = "sparse_text";
    else if (topics.length) status = "not_found";
    else status = "checklist_only";

    const notes: string[] = [];
    if (!topics.length) {
      notes.push("No door/guardrail/hydraulic sheet-class signals; checklist omitted.");
    }
    if (sparse) {
      notes.push("Text layer sparse or low; look-for checklist still applies for the attached PDF.");
    }

    const result: VisualEvidenceResult = {
      version: VISUAL_EVIDENCE_VERSION,
      enabled: true,
      status: topics.length ? status : "checklist_only",
      latencyMs: (input.deps?.now || Date.now)() - started,
      sheetFileName: input.fileName,
      topics,
      packs,
      checklistBlock,
      promptBlock: "",
      textLayerChars: extracted.text.length,
      lowText: extracted.lowText,
      notes,
    };
    result.promptBlock = formatVisualEvidencePrompt(result);
    return result;
  } catch (error) {
    return emptyResult({
      enabled: true,
      status: "failed",
      sheetFileName: input.fileName,
      latencyMs: (input.deps?.now || Date.now)() - started,
      notes: [
        error instanceof Error
          ? `Visual evidence failed open: ${error.message.slice(0, 240)}`
          : "Visual evidence failed open.",
      ],
      promptBlock: "",
    });
  }
}

export function visualEvidenceAuditMetadata(result: VisualEvidenceResult): Record<string, unknown> {
  return {
    visual_evidence_version: result.version,
    visual_evidence_enabled: result.enabled,
    visual_evidence_status: result.status,
    visual_evidence_latency_ms: result.latencyMs,
    visual_evidence_pack_count: result.packs.length,
    visual_evidence_topics: result.topics,
    visual_evidence_char_count: result.packs.reduce((sum, pack) => sum + pack.charCount, 0),
    visual_evidence_text_layer_chars: result.textLayerChars,
    visual_evidence_low_text: result.lowText,
    visual_evidence_packs: result.packs.map((pack) => ({
      id: pack.id,
      topic: pack.topic,
      status: pack.status,
      char_count: pack.charCount,
      detail_hints: pack.detailHints,
      independently_verified: false,
      provenance: pack.provenance.origin,
    })),
    visual_evidence_notes: result.notes,
  };
}
