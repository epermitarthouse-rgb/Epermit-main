/**
 * Phase 3A — Cross-sheet evidence retrieval (logical layers 4–6).
 *
 * Logical architecture (not separate services):
 * 1 Ingestion  2 Current-sheet GPT PDF  3 Sheet index
 * 4 Reference detection  5 Bounded retrieval  6 Provenance prompt assembly
 * 7 GPT-4o analysis  8 Persist-time validation  9 Client reporting / QE
 *
 * Failures must never stop baseline sheet analysis. Retrieved text is not
 * verified compliance. Production must not depend on the McDonald's eval dataset.
 */
import {
  sheetIdentityKeys,
  type SubmittedSheetRef,
} from "./analyzerFindingQuality.ts";

export const CROSS_SHEET_RETRIEVAL_VERSION = "phase3a.cross-sheet-retrieval.v1";

export const CROSS_SHEET_RETRIEVAL_BOUNDS = {
  maxSheets: 3,
  maxCharsPerSheet: 1200,
  maxTotalChars: 3500,
  downloadTimeoutMs: 12_000,
} as const;

const CROSS_SHEET_POINTER =
  /\b(?:see|refer(?:ence)?\s+to|refer)\b[^.\n]{0,80}\b(?:sheet|drawing|detail)\b|\bsee\s+detail\b|\bdetail\s+\d+\s+on\s+drawing\b/gi;
const SHEET_TOKEN_SOURCE =
  "\\b([A-Z]{1,4})\\s*[- ]?\\s*(\\d{1,3}\\.\\d{1,3})(?:\\s*-\\s*00)?\\b|\\b([A-Z]{1,4})\\s*-\\s*(\\d{1,3})(?:\\s*-\\s*00)?\\b";
const DETAIL_HINT = /\bdetail\s*(\d{1,3})\b/i;
const TOPIC_HINTS = [
  "penetration", "insulat", "refrigerant", "armaflex", "reinforc", "foundation",
  "masonry", "sprinkler", "hydraulic", "firestop", "shaft", "keyed", "note",
  "ceiling", "duct", "conduit", "dowel", "rebar",
];

export type RetrievalStatus =
  | "disabled"
  | "no_references"
  | "partial"
  | "retrieved"
  | "failed";

export interface RetrievableSheetJob extends SubmittedSheetRef {
  objectPath?: string | null;
  sheetJobId?: string | null;
}

export interface DetectedSheetReference {
  key: string;
  display: string;
  context: string;
  detailNumber: string | null;
}

export interface RetrievedSheetEvidence {
  fileName: string;
  detectedSheetNumber: string | null;
  objectPath: string | null;
  sheetJobId: string | null;
  status: "retrieved" | "unresolved" | "download_failed" | "empty_text" | "extract_failed";
  pageCount: number | null;
  excerpt: string;
  provenance: "machine_extracted_text_layer";
  matchedHints: string[];
  error: string | null;
}

export interface CrossSheetRetrievalPack {
  version: typeof CROSS_SHEET_RETRIEVAL_VERSION;
  enabled: boolean;
  status: RetrievalStatus;
  latencyMs: number;
  references: DetectedSheetReference[];
  sheets: RetrievedSheetEvidence[];
  promptBlock: string;
  notes: string[];
}

export interface CrossSheetRetrievalDeps {
  downloadPdf: (objectPath: string) => Promise<Uint8Array>;
  extractPdfText?: (bytes: Uint8Array) => Promise<{ pageCount: number; text: string; lowText: boolean }>;
  now?: () => number;
}

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function sheetTokenPattern(): RegExp {
  return new RegExp(SHEET_TOKEN_SOURCE, "gi");
}

/**
 * Env feature flag — default off so client-facing analyzer stays baseline.
 * Prefer ANALYZER_CROSS_SHEET_RETRIEVAL (settable on Edge). Legacy
 * SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL is also accepted if present.
 * Independent of ANALYZER_VISUAL_EVIDENCE.
 */
export function isCrossSheetRetrievalEnabled(
  env: { get(key: string): string | undefined } | undefined = undefined,
): boolean {
  const source = env ?? (typeof Deno !== "undefined" ? Deno.env : undefined);
  if (!source) return false;
  const value = source.get("ANALYZER_CROSS_SHEET_RETRIEVAL")
    ?? source.get("SUPABASE_ANALYZER_CROSS_SHEET_RETRIEVAL");
  return typeof value === "string" && value.toLowerCase() === "true";
}

function preferSpecificSheetKeys(entries: DetectedSheetReference[]): DetectedSheetReference[] {
  const sorted = [...entries].sort((left, right) => right.key.length - left.key.length);
  const kept: DetectedSheetReference[] = [];
  for (const entry of sorted) {
    const dominated = kept.some((prior) =>
      prior.key.startsWith(entry.key) && prior.key.length > entry.key.length
    );
    if (dominated) continue;
    kept.push(entry);
  }
  return kept.sort((left, right) => left.key.localeCompare(right.key));
}

export function detectCrossSheetReferences(text: string): DetectedSheetReference[] {
  const source = String(text || "");
  if (!source.trim()) return [];
  const found = new Map<string, DetectedSheetReference>();
  const pointerMatches = [...source.matchAll(CROSS_SHEET_POINTER)];
  for (const match of pointerMatches) {
    // Bound context to this pointer clause so adjacent references do not merge.
    const start = match.index || 0;
    const after = source.slice(start + (match[0]?.length || 0));
    const clauseEnd = after.search(/\.(?:\s|$)|(?:\bSEE\b|\bREFER(?:ENCE)?\s+TO\b|\bREFER\b)/i);
    const tail = clauseEnd >= 0 ? after.slice(0, clauseEnd) : after.slice(0, 48);
    const context = oneLine(source.slice(start, start + (match[0]?.length || 0) + Math.max(tail.length, 0)), 180);
    for (const token of context.toUpperCase().matchAll(sheetTokenPattern())) {
      const prefix = token[1] || token[3];
      const number = token[2] || token[4];
      if (!prefix || !number) continue;
      const key = `${prefix}${number}`;
      const detail = DETAIL_HINT.exec(context);
      const next = {
        key,
        display: String(token[0] || key).replace(/\s+/g, ""),
        context,
        detailNumber: detail?.[1] || null,
      };
      const prior = found.get(key);
      if (!prior || (next.detailNumber && !prior.detailNumber) || next.context.length > prior.context.length) {
        found.set(key, next);
      }
    }
  }
  return preferSpecificSheetKeys([...found.values()]);
}

export function resolveSheetJobsForReferences(
  references: DetectedSheetReference[],
  jobs: RetrievableSheetJob[],
  currentFileName: string,
): Array<{ reference: DetectedSheetReference; job: RetrievableSheetJob | null }> {
  const currentKeys = new Set(sheetIdentityKeys(currentFileName));
  return references.map((reference) => {
    if (currentKeys.has(reference.key)) {
      return { reference, job: null };
    }
    const job = jobs.find((item) => {
      const keys = [
        ...sheetIdentityKeys(item.fileName),
        ...sheetIdentityKeys(item.detectedSheetNumber),
      ];
      return keys.includes(reference.key);
    }) || null;
    return { reference, job };
  }).filter((item) => !currentKeys.has(item.reference.key));
}

export async function extractPdfTextLayer(bytes: Uint8Array): Promise<{
  pageCount: number;
  text: string;
  lowText: boolean;
}> {
  // Dynamic import keeps Node unit tests free of the Deno npm: specifier at module load.
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text || "")];
  const combined = pages.map((page) => String(page || "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return {
    pageCount: Number(totalPages) || pages.length || 1,
    text: combined,
    lowText: combined.length < 40,
  };
}

function hintTokens(reference: DetectedSheetReference, currentHints: string[]): string[] {
  const bag = `${reference.context} ${currentHints.join(" ")}`.toLowerCase();
  const hints = TOPIC_HINTS.filter((hint) => bag.includes(hint));
  if (reference.detailNumber) hints.push(`detail ${reference.detailNumber}`, reference.detailNumber);
  return [...new Set(hints)];
}

export function selectSupportingExcerpt(
  fullText: string,
  hints: string[],
  maxChars: number,
): { excerpt: string; matchedHints: string[] } {
  const normalized = String(fullText || "").replace(/\r/g, "");
  if (!normalized.trim()) return { excerpt: "", matchedHints: [] };
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return { excerpt: oneLine(normalized, maxChars), matchedHints: [] };
  }
  const scored = lines.map((line, index) => {
    const lower = line.toLowerCase();
    const matched = hints.filter((hint) => lower.includes(hint.toLowerCase()));
    return { line, index, matched, score: matched.length };
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  const chosen: typeof scored = [];
  const matchedHints = new Set<string>();
  let used = 0;
  for (const row of scored) {
    if (row.score === 0 && chosen.length >= 4) break;
    if (used >= maxChars) break;
    if (chosen.some((item) => item.index === row.index)) continue;
    // Prefer a window around high-scoring lines.
    for (const neighbor of [row.index - 1, row.index, row.index + 1]) {
      if (neighbor < 0 || neighbor >= lines.length) continue;
      if (chosen.some((item) => item.index === neighbor)) continue;
      const text = lines[neighbor];
      if (used + text.length + 1 > maxChars) continue;
      chosen.push({ line: text, index: neighbor, matched: row.matched, score: row.score });
      used += text.length + 1;
      for (const hint of row.matched) matchedHints.add(hint);
    }
    if (chosen.length >= 12) break;
  }
  if (!chosen.length) {
    return { excerpt: oneLine(normalized, maxChars), matchedHints: [] };
  }
  chosen.sort((left, right) => left.index - right.index);
  return {
    excerpt: oneLine(chosen.map((item) => item.line).join(" | "), maxChars),
    matchedHints: [...matchedHints],
  };
}

export function formatCrossSheetEvidencePrompt(pack: Pick<CrossSheetRetrievalPack, "sheets" | "notes" | "status">): string {
  if (pack.status === "disabled" || pack.status === "no_references") return "";
  const lines: string[] = [
    "Supporting excerpts from referenced sheets (machine-extracted PDF text layer only):",
    "These excerpts are not verified code compliance. Do not invent content that is not present here or on the current sheet PDF.",
    "If an excerpt is empty or marked unreadable, treat the reference as unresolved for content—not as proof of absence or compliance. You may still report a sheet-local concern at an evidence-supported severity.",
  ];
  for (const sheet of pack.sheets) {
    const number = sheet.detectedSheetNumber || "number not detected";
    if (sheet.status === "retrieved" && sheet.excerpt) {
      lines.push(
        `- ${number} | ${sheet.fileName} | provenance=${sheet.provenance} | hints=${sheet.matchedHints.join(",") || "none"}`,
        `  excerpt: ${sheet.excerpt}`,
      );
    } else {
      lines.push(
        `- ${number} | ${sheet.fileName || "(unresolved)"} | status=${sheet.status}${sheet.error ? ` | ${oneLine(sheet.error, 160)}` : ""}`,
      );
    }
  }
  if (pack.notes.length) {
    lines.push(`Notes: ${pack.notes.join(" ")}`);
  }
  return lines.join("\n");
}

function emptyPack(partial: Partial<CrossSheetRetrievalPack> & Pick<CrossSheetRetrievalPack, "status" | "enabled">): CrossSheetRetrievalPack {
  return {
    version: CROSS_SHEET_RETRIEVAL_VERSION,
    enabled: partial.enabled,
    status: partial.status,
    latencyMs: partial.latencyMs || 0,
    references: partial.references || [],
    sheets: partial.sheets || [],
    promptBlock: partial.promptBlock || "",
    notes: partial.notes || [],
  };
}

/**
 * Bounded cross-sheet retrieval. Never throws — returns a failed/disabled pack instead.
 */
export async function retrieveCrossSheetEvidence(input: {
  enabled: boolean;
  currentFileName: string;
  currentPdfBytes: Uint8Array;
  sheetJobs: RetrievableSheetJob[];
  deps: CrossSheetRetrievalDeps;
}): Promise<CrossSheetRetrievalPack> {
  const started = (input.deps.now || Date.now)();
  if (!input.enabled) {
    return emptyPack({ enabled: false, status: "disabled", latencyMs: 0 });
  }

  try {
    const extract = input.deps.extractPdfText || extractPdfTextLayer;
    const current = await extract(input.currentPdfBytes);
    const references = detectCrossSheetReferences(current.text);
    if (!references.length) {
      return emptyPack({
        enabled: true,
        status: "no_references",
        latencyMs: (input.deps.now || Date.now)() - started,
        notes: current.lowText
          ? ["Current sheet text layer is sparse; cross-sheet pointers may be invisible to text extraction."]
          : [],
      });
    }

    const resolved = resolveSheetJobsForReferences(references, input.sheetJobs, input.currentFileName)
      .slice(0, CROSS_SHEET_RETRIEVAL_BOUNDS.maxSheets);
    const currentHints = TOPIC_HINTS.filter((hint) => current.text.toLowerCase().includes(hint));
    const sheets: RetrievedSheetEvidence[] = [];
    let totalChars = 0;
    const notes: string[] = [];

    for (const item of resolved) {
      if (!item.job?.objectPath) {
        sheets.push({
          fileName: item.job?.fileName || "",
          detectedSheetNumber: item.job?.detectedSheetNumber || item.reference.display,
          objectPath: null,
          sheetJobId: item.job?.sheetJobId || null,
          status: "unresolved",
          pageCount: null,
          excerpt: "",
          provenance: "machine_extracted_text_layer",
          matchedHints: [],
          error: item.job
            ? "Resolved sheet is missing a storage object path."
            : `Reference ${item.reference.display} was not found on the submitted sheet index.`,
        });
        continue;
      }
      if (totalChars >= CROSS_SHEET_RETRIEVAL_BOUNDS.maxTotalChars) {
        notes.push("Additional referenced sheets were skipped to keep retrieval bounded.");
        break;
      }
      try {
        const bytes = await input.deps.downloadPdf(item.job.objectPath);
        const extracted = await extract(bytes);
        if (extracted.lowText || !extracted.text.trim()) {
          sheets.push({
            fileName: item.job.fileName,
            detectedSheetNumber: item.job.detectedSheetNumber || null,
            objectPath: item.job.objectPath,
            sheetJobId: item.job.sheetJobId || null,
            status: "empty_text",
            pageCount: extracted.pageCount,
            excerpt: "",
            provenance: "machine_extracted_text_layer",
            matchedHints: [],
            error: "Text layer empty or unreadable for bounded excerpting.",
          });
          continue;
        }
        const remaining = Math.min(
          CROSS_SHEET_RETRIEVAL_BOUNDS.maxCharsPerSheet,
          CROSS_SHEET_RETRIEVAL_BOUNDS.maxTotalChars - totalChars,
        );
        const selected = selectSupportingExcerpt(
          extracted.text,
          hintTokens(item.reference, currentHints),
          remaining,
        );
        totalChars += selected.excerpt.length;
        sheets.push({
          fileName: item.job.fileName,
          detectedSheetNumber: item.job.detectedSheetNumber || null,
          objectPath: item.job.objectPath,
          sheetJobId: item.job.sheetJobId || null,
          status: "retrieved",
          pageCount: extracted.pageCount,
          excerpt: selected.excerpt,
          provenance: "machine_extracted_text_layer",
          matchedHints: selected.matchedHints,
          error: null,
        });
      } catch (error) {
        sheets.push({
          fileName: item.job.fileName,
          detectedSheetNumber: item.job.detectedSheetNumber || null,
          objectPath: item.job.objectPath,
          sheetJobId: item.job.sheetJobId || null,
          status: "download_failed",
          pageCount: null,
          excerpt: "",
          provenance: "machine_extracted_text_layer",
          matchedHints: [],
          error: error instanceof Error ? error.message.slice(0, 240) : "download_or_extract_failed",
        });
      }
    }

    const retrievedCount = sheets.filter((sheet) => sheet.status === "retrieved" && sheet.excerpt).length;
    const status: RetrievalStatus = retrievedCount > 0
      ? (sheets.some((sheet) => sheet.status !== "retrieved") ? "partial" : "retrieved")
      : "partial";
    const pack: CrossSheetRetrievalPack = {
      version: CROSS_SHEET_RETRIEVAL_VERSION,
      enabled: true,
      status,
      latencyMs: (input.deps.now || Date.now)() - started,
      references,
      sheets,
      promptBlock: "",
      notes,
    };
    pack.promptBlock = formatCrossSheetEvidencePrompt(pack);
    return pack;
  } catch (error) {
    return emptyPack({
      enabled: true,
      status: "failed",
      latencyMs: (input.deps.now || Date.now)() - started,
      notes: [
        error instanceof Error
          ? `Cross-sheet retrieval failed open: ${error.message.slice(0, 240)}`
          : "Cross-sheet retrieval failed open.",
      ],
      promptBlock: "",
    });
  }
}

export function crossSheetRetrievalAuditMetadata(pack: CrossSheetRetrievalPack): Record<string, unknown> {
  return {
    cross_sheet_retrieval_version: pack.version,
    cross_sheet_retrieval_enabled: pack.enabled,
    cross_sheet_retrieval_status: pack.status,
    cross_sheet_retrieval_latency_ms: pack.latencyMs,
    cross_sheet_reference_count: pack.references.length,
    cross_sheet_retrieved_count: pack.sheets.filter((sheet) => sheet.status === "retrieved").length,
    cross_sheet_sheets: pack.sheets.map((sheet) => ({
      file_name: sheet.fileName,
      detected_sheet_number: sheet.detectedSheetNumber,
      status: sheet.status,
      page_count: sheet.pageCount,
      excerpt_chars: sheet.excerpt.length,
      matched_hints: sheet.matchedHints,
      provenance: sheet.provenance,
      error: sheet.error,
    })),
    cross_sheet_notes: pack.notes,
  };
}
