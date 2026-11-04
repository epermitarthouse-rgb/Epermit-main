/**
 * Phase 3 Stage 3 — Apple Vision OCR evidence packs (Mac worker → analyzer).
 *
 * Edge never runs Vision OCR. The Mac worker writes bounded packs; this module
 * only loads completed packs (or reports missing) and formats a prompt block.
 * Default-off. Activation is **run-scoped** via
 * `supabase_analyzer_runs.analysis_scope.stage3VisualEvidence === true`.
 * Global env `ANALYZER_STAGE3_VISUAL_EVIDENCE=false` is an emergency kill-switch.
 * Env `=true` alone does **not** enable Stage 3 for unrelated runs.
 * Independent of Stage 1–2 ANALYZER_VISUAL_EVIDENCE and Phase 3A CSR.
 * Failures / missing packs never block baseline PDF→GPT analysis.
 */
export const STAGE3_VISUAL_EVIDENCE_VERSION = "phase3.stage3-visual-evidence.v1";
/**
 * Annotation-level technical digest. Opt-in per run via
 * `analysis_scope.stage3EvidenceVersion === "v2"`; falls back v2 → v1 → PDF-only.
 */
export const STAGE3_VISUAL_EVIDENCE_V2_VERSION = "phase3.stage3-visual-evidence.v2";
export type Stage3EvidenceVersion =
  | typeof STAGE3_VISUAL_EVIDENCE_VERSION
  | typeof STAGE3_VISUAL_EVIDENCE_V2_VERSION;
export const STAGE3_EVIDENCE_VERSION_REGISTRY: Record<string, Stage3EvidenceVersion> = {
  v1: STAGE3_VISUAL_EVIDENCE_VERSION,
  v2: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
};

export const STAGE3_VISUAL_EVIDENCE_BOUNDS = {
  maxPacks: 3,
  maxCharsPerPack: 1200,
  maxTotalChars: 3200,
  /** Analyzer must not wait for a Mac worker — pack load is sync/near-sync only. */
  loadTimeoutMs: 50,
} as const;

export const STAGE3_VISUAL_EVIDENCE_V2_BOUNDS = {
  maxPacks: 1,
  maxCharsPerPack: 2600,
  maxTotalChars: 3200,
  loadTimeoutMs: 50,
} as const;

/** Must match eval/drawing-dataset/lib/stage3EvidenceEval.mjs V2_ANALYZER_HEADER (fixture-tested). */
export const STAGE3_V2_PROMPT_HEADER = [
  "Stage 3 Apple Vision OCR evidence v2 (machine-extracted; independentlyVerified=false). Not professionally verified. Quote before Critical absence. Omitted or missing items mean not recovered — not proof of absence.",
  "Reading rules: each \"- \" line is one printed annotation; \" / \" separates its rows. {A | B} = conflicting OCR readings of one place, neither confirmed. ?text = OCR format or glyph doubt; verify on the PDF before relying on it. (ctx?) = relation to nearby items unconfirmed. Never combine values from different lines.",
] as const;

export type Stage3PackStatus =
  | "evidence_recovered"
  | "partial_recovery"
  | "not_found"
  | "failed"
  | "stale"
  | "missing"
  | "disabled";

export type Stage3RunStatus =
  | "disabled"
  | "recovered"
  | "partial"
  | "missing"
  | "stale"
  | "failed";

export interface Stage3EvidencePack {
  id: string;
  sheetId: string;
  topic: string;
  status: string;
  promptBlock: string;
  extractedTexts?: string[];
  detailIdentifier?: string | null;
  bbox?: Record<string, unknown> | null;
  assessment?: Record<string, unknown> | null;
  provenance?: {
    origin?: string;
    method?: string;
    independentlyVerified?: boolean;
    uncertainty?: string;
    extractionMethod?: string;
    cacheKey?: string;
  };
  sourceFileSha256?: string;
  extractionVersion?: string;
  independentlyVerified?: false;
  /** v2 only: budget/omission report of the technical digest. */
  digest?: Record<string, unknown>;
  /** v2 only: annotation-level evidence model (rows, boxes, confidence, alternatives). */
  evidenceModel?: Record<string, unknown>;
}

export interface Stage3VisualEvidenceResult {
  version: Stage3EvidenceVersion;
  enabled: boolean;
  status: Stage3RunStatus;
  latencyMs: number;
  sheetFileName: string;
  packs: Stage3EvidencePack[];
  promptBlock: string;
  notes: string[];
  cacheKey: string | null;
  workerOfflineOrMissing: boolean;
  /** Set only for runs that requested v2. */
  requestedVersion?: Stage3EvidenceVersion;
  /** Set only for v2 runs that did not deliver v2 (why v1 or PDF-only was used). */
  fallbackReason?: string | null;
}

type Stage3PackLoader = (ctx: {
  fileName: string;
  contentSha256?: string | null;
  objectPath?: string | null;
  projectId?: string | null;
  runId?: string | null;
  sheetJobId?: string | null;
}) => Promise<Stage3EvidencePack[] | null>;

export interface Stage3VisualEvidenceDeps {
  /** Load completed packs for this sheet. Must not block on OCR / Mac availability. */
  loadCompletedPacks?: Stage3PackLoader;
  /** v2 runs only: load the v2 technical-digest pack. */
  loadCompletedV2Packs?: Stage3PackLoader;
  now?: () => number;
}

function oneLine(value: string, max: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export type Stage3RunActivationSource = {
  id?: string | null;
  project_id?: string | null;
  analysis_scope?: unknown;
} | null | undefined;

export type Stage3JobActivationSource = {
  run_id?: string | null;
  project_id?: string | null;
} | null | undefined;

function stage3EnvValue(
  env: { get(key: string): string | undefined } | undefined,
): string | undefined {
  const source = env ?? (typeof Deno !== "undefined" ? Deno.env : undefined);
  if (!source) return undefined;
  return source.get("ANALYZER_STAGE3_VISUAL_EVIDENCE")
    ?? source.get("SUPABASE_ANALYZER_STAGE3_VISUAL_EVIDENCE");
}

/**
 * Emergency kill-switch. When env is explicitly `false`, Stage 3 is off for every run.
 */
export function isStage3VisualEvidenceGloballyBlocked(
  env: { get(key: string): string | undefined } | undefined = undefined,
): boolean {
  const value = stage3EnvValue(env);
  return typeof value === "string" && value.toLowerCase() === "false";
}

/**
 * Run opt-in stored on `analysis_scope.stage3VisualEvidence` (existing jsonb; no migration).
 */
export function isStage3VisualEvidenceRunAuthorized(run: Stage3RunActivationSource): boolean {
  const scope = run?.analysis_scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
  return (scope as Record<string, unknown>).stage3VisualEvidence === true;
}

/**
 * Run-scoped evidence version (`analysis_scope.stage3EvidenceVersion`). Absent → v1.
 * Unknown values resolve to v1 and are reported, never silently promoted.
 */
export function resolveStage3EvidenceVersion(run: Stage3RunActivationSource): {
  version: Stage3EvidenceVersion;
  requested: string | null;
  invalid: boolean;
} {
  const scope = run?.analysis_scope;
  const raw = scope && typeof scope === "object" && !Array.isArray(scope)
    ? (scope as Record<string, unknown>).stage3EvidenceVersion
    : undefined;
  if (raw == null || raw === "") return { version: STAGE3_VISUAL_EVIDENCE_VERSION, requested: null, invalid: false };
  const requested = String(raw);
  const version = STAGE3_EVIDENCE_VERSION_REGISTRY[requested]
    || (Object.values(STAGE3_EVIDENCE_VERSION_REGISTRY) as string[]).find((v) => v === requested) as Stage3EvidenceVersion | undefined;
  if (!version) return { version: STAGE3_VISUAL_EVIDENCE_VERSION, requested, invalid: true };
  return { version, requested, invalid: false };
}

/**
 * Server-side run authorization: optional job must belong to the run/project.
 */
export function assertStage3RunJobAuthorization(input: {
  run: Stage3RunActivationSource;
  job?: Stage3JobActivationSource;
}): boolean {
  const run = input.run;
  if (!run) return false;
  const job = input.job;
  if (!job) return true;
  if (job.run_id != null && run.id != null && String(job.run_id) !== String(run.id)) {
    return false;
  }
  if (
    job.project_id != null
    && run.project_id != null
    && String(job.project_id) !== String(run.project_id)
  ) {
    return false;
  }
  return true;
}

/**
 * Stage 3 is enabled only when the run opts in and the kill-switch is not engaged.
 * Global env `true` alone does not enable Stage 3 (avoids unrelated-job activation).
 */
export function isStage3VisualEvidenceEnabledForRun(input: {
  run?: Stage3RunActivationSource;
  job?: Stage3JobActivationSource;
  env?: { get(key: string): string | undefined };
}): boolean {
  if (isStage3VisualEvidenceGloballyBlocked(input.env)) return false;
  if (!isStage3VisualEvidenceRunAuthorized(input.run)) return false;
  return assertStage3RunJobAuthorization({ run: input.run, job: input.job });
}

/**
 * @deprecated Prefer `isStage3VisualEvidenceEnabledForRun`. Kept for tests/docs:
 * reports whether the legacy global env string is literally `true` (not sufficient alone).
 */
export function isStage3VisualEvidenceEnabled(
  env: { get(key: string): string | undefined } | undefined = undefined,
): boolean {
  const value = stage3EnvValue(env);
  return typeof value === "string" && value.toLowerCase() === "true";
}

/** Merge run-scoped Stage 3 opt-in into existing analysis_scope without dropping review fields. */
export function withStage3VisualEvidenceRunOptIn(
  analysisScope: Record<string, unknown> | null | undefined,
  enabled: boolean,
): Record<string, unknown> {
  const base = analysisScope && typeof analysisScope === "object" && !Array.isArray(analysisScope)
    ? { ...analysisScope }
    : {};
  if (enabled) {
    base.stage3VisualEvidence = true;
  } else {
    delete base.stage3VisualEvidence;
  }
  return base;
}

export function stage3CacheKey(input: {
  contentSha256: string;
  extractionMethod?: string;
  extractionVersion?: string;
}): string {
  const method = input.extractionMethod || "macos-vision";
  const version = input.extractionVersion || STAGE3_VISUAL_EVIDENCE_VERSION;
  return `${input.contentSha256}.${method}.${version}`;
}

function emptyResult(partial: {
  enabled: boolean;
  status: Stage3RunStatus;
  sheetFileName: string;
  latencyMs: number;
  notes?: string[];
  workerOfflineOrMissing?: boolean;
  cacheKey?: string | null;
}): Stage3VisualEvidenceResult {
  return {
    version: STAGE3_VISUAL_EVIDENCE_VERSION,
    enabled: partial.enabled,
    status: partial.status,
    latencyMs: partial.latencyMs,
    sheetFileName: partial.sheetFileName,
    packs: [],
    promptBlock: "",
    notes: partial.notes || [],
    cacheKey: partial.cacheKey ?? null,
    workerOfflineOrMissing: Boolean(partial.workerOfflineOrMissing),
  };
}

function truncatePackPrompt(pack: Stage3EvidencePack): string {
  const raw = String(pack.promptBlock || "").trim();
  if (!raw) return "";
  return raw.length <= STAGE3_VISUAL_EVIDENCE_BOUNDS.maxCharsPerPack
    ? raw
    : `${raw.slice(0, STAGE3_VISUAL_EVIDENCE_BOUNDS.maxCharsPerPack)}…`;
}

/**
 * Format Stage 3 OCR packs for the existing GPT-4o user prompt.
 * Never claims professional verification or compliance clearance.
 */
export function formatStage3VisualEvidencePrompt(result: Stage3VisualEvidenceResult): string {
  if (!result.enabled || !result.packs.length) return "";
  if (result.version === STAGE3_VISUAL_EVIDENCE_V2_VERSION) return formatStage3V2Prompt(result);
  const lines: string[] = [
    "Stage 3 Apple Vision OCR evidence (machine-extracted; independentlyVerified=false):",
    "Not professionally verified. Quote before Critical absence. Do not treat OCR recovery as verified compliance. Empty/missing packs mean not recovered — not proof of absence.",
    `stage3_status=${result.status} version=${result.version}`,
  ];
  let total = lines.join("\n").length;
  let used = 0;
  for (const pack of result.packs) {
    if (used >= STAGE3_VISUAL_EVIDENCE_BOUNDS.maxPacks) break;
    const block = truncatePackPrompt(pack);
    if (!block) continue;
    if (total + block.length + 2 > STAGE3_VISUAL_EVIDENCE_BOUNDS.maxTotalChars) break;
    lines.push(block);
    total += block.length + 2;
    used += 1;
  }
  if (result.notes.length) {
    lines.push(`stage3_notes: ${result.notes.map((note) => oneLine(note, 160)).join(" | ")}`);
  }
  return lines.join("\n");
}

/**
 * v2 block: reading rules header, then the digest. A digest longer than the room left is cut
 * at its last complete line — never inside an annotation. Room for the notes line is reserved.
 */
function formatStage3V2Prompt(result: Stage3VisualEvidenceResult): string {
  const bounds = STAGE3_VISUAL_EVIDENCE_V2_BOUNDS;
  const lines: string[] = [
    ...STAGE3_V2_PROMPT_HEADER,
    `stage3_status=${result.status} version=${STAGE3_VISUAL_EVIDENCE_V2_VERSION}`,
  ];
  const notesLine = result.notes.length
    ? `stage3_notes: ${result.notes.map((note) => oneLine(note, 160)).join(" | ")}`
    : "";
  let total = lines.join("\n").length + (notesLine ? notesLine.length + 1 : 0);
  let used = 0;
  for (const pack of result.packs) {
    if (used >= bounds.maxPacks) break;
    const room = Math.min(bounds.maxCharsPerPack, bounds.maxTotalChars - total - 1);
    const raw = String(pack.promptBlock || "").trim();
    if (!raw || room <= 0) continue;
    let block = raw;
    if (block.length > room) {
      const kept: string[] = [];
      let length = 0;
      for (const line of raw.split("\n")) {
        if (length + line.length + (kept.length ? 1 : 0) > room) break;
        kept.push(line);
        length += line.length + (kept.length > 1 ? 1 : 0);
      }
      block = kept.join("\n");
    }
    if (!block) continue;
    lines.push(block);
    total += block.length + 1;
    used += 1;
  }
  if (notesLine) lines.push(notesLine);
  return lines.join("\n");
}

function classifyPacks(packs: Stage3EvidencePack[]): Stage3RunStatus {
  if (!packs.length) return "missing";
  const statuses = packs.map((pack) => String(pack.status || ""));
  if (statuses.some((status) => status === "stale")) return "stale";
  if (statuses.every((status) => status.includes("recovered"))) return "recovered";
  if (statuses.some((status) => status.includes("recovered") || status.includes("partial"))) {
    return "partial";
  }
  if (statuses.some((status) => status === "failed")) return "failed";
  return "missing";
}

/**
 * Load completed Stage 3 packs only. Never runs OCR. Never waits for Mac worker.
 */
export async function retrieveStage3VisualEvidence(input: {
  enabled: boolean;
  fileName: string;
  contentSha256?: string | null;
  objectPath?: string | null;
  projectId?: string | null;
  runId?: string | null;
  sheetJobId?: string | null;
  deps?: Stage3VisualEvidenceDeps;
  /** Omitted or v1 → unchanged v1 behaviour. v2 → v2 pack, else v1 pack, else PDF-only. */
  evidenceVersion?: Stage3EvidenceVersion;
}): Promise<Stage3VisualEvidenceResult> {
  if (input.enabled && input.evidenceVersion === STAGE3_VISUAL_EVIDENCE_V2_VERSION) {
    return retrieveStage3V2WithFallback(input);
  }
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
    const loader = input.deps?.loadCompletedPacks;
    if (!loader) {
      return emptyResult({
        enabled: true,
        status: "missing",
        sheetFileName: input.fileName,
        latencyMs: (input.deps?.now || Date.now)() - started,
        notes: [
          "Stage 3 enabled but no pack loader configured; continuing baseline PDF analysis (fail-open).",
        ],
        workerOfflineOrMissing: true,
        cacheKey: input.contentSha256
          ? stage3CacheKey({ contentSha256: input.contentSha256 })
          : null,
      });
    }

    const packs = await loader({
      fileName: input.fileName,
      contentSha256: input.contentSha256 ?? null,
      objectPath: input.objectPath ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      sheetJobId: input.sheetJobId ?? null,
    }) || [];

    const normalized = packs.map((pack) => ({
      ...pack,
      independentlyVerified: false as const,
      provenance: {
        ...(pack.provenance || {}),
        independentlyVerified: false,
      },
    }));

    const status = classifyPacks(normalized);
    const notes: string[] = [];
    if (status === "missing") {
      notes.push("No completed Stage 3 OCR packs for this sheet; baseline PDF→GPT continues.");
    }
    if (status === "stale") {
      notes.push("Stage 3 pack marked stale (drawing hash/version mismatch); ignored for prompt.");
    }

    const usable = status === "stale"
      ? []
      : normalized.filter((pack) => {
        const packStatus = String(pack.status || "");
        return packStatus.includes("recovered") || packStatus.includes("partial");
      });

    const result: Stage3VisualEvidenceResult = {
      version: STAGE3_VISUAL_EVIDENCE_VERSION,
      enabled: true,
      status: usable.length ? (status === "partial" ? "partial" : "recovered") : status,
      latencyMs: (input.deps?.now || Date.now)() - started,
      sheetFileName: input.fileName,
      packs: usable,
      promptBlock: "",
      notes,
      cacheKey: input.contentSha256
        ? stage3CacheKey({ contentSha256: input.contentSha256 })
        : null,
      workerOfflineOrMissing: status === "missing",
    };
    result.promptBlock = formatStage3VisualEvidencePrompt(result);
    return result;
  } catch (error) {
    return emptyResult({
      enabled: true,
      status: "failed",
      sheetFileName: input.fileName,
      latencyMs: (input.deps?.now || Date.now)() - started,
      notes: [
        error instanceof Error
          ? `Stage 3 evidence failed open: ${error.message.slice(0, 240)}`
          : "Stage 3 evidence failed open.",
      ],
      workerOfflineOrMissing: true,
    });
  }
}

async function retrieveStage3V2WithFallback(
  input: Parameters<typeof retrieveStage3VisualEvidence>[0],
): Promise<Stage3VisualEvidenceResult> {
  const now = input.deps?.now || Date.now;
  const started = now();
  const ctx = {
    fileName: input.fileName,
    contentSha256: input.contentSha256 ?? null,
    objectPath: input.objectPath ?? null,
    projectId: input.projectId ?? null,
    runId: input.runId ?? null,
    sheetJobId: input.sheetJobId ?? null,
  };
  let reason: string;
  const loader = input.deps?.loadCompletedV2Packs;
  if (!loader) {
    reason = "v2_loader_missing";
  } else {
    try {
      const packs = (await loader(ctx) || []).map((pack) => ({
        ...pack,
        independentlyVerified: false as const,
        provenance: { ...(pack.provenance || {}), independentlyVerified: false },
      }));
      const status = classifyPacks(packs);
      const usable = status === "stale"
        ? []
        : packs.filter((pack) => {
          const packStatus = String(pack.status || "");
          return pack.extractionVersion === STAGE3_VISUAL_EVIDENCE_V2_VERSION
            && (packStatus.includes("recovered") || packStatus.includes("partial"));
        });
      if (usable.length) {
        const result: Stage3VisualEvidenceResult = {
          version: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
          enabled: true,
          status: status === "partial" ? "partial" : "recovered",
          latencyMs: now() - started,
          sheetFileName: input.fileName,
          packs: usable,
          promptBlock: "",
          notes: [],
          cacheKey: input.contentSha256
            ? stage3CacheKey({ contentSha256: input.contentSha256, extractionVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION })
            : null,
          workerOfflineOrMissing: false,
          requestedVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
          fallbackReason: null,
        };
        result.promptBlock = formatStage3VisualEvidencePrompt(result);
        return result;
      }
      reason = packs.length ? `v2_pack_${status}` : "v2_pack_missing";
    } catch (error) {
      reason = `v2_load_failed:${error instanceof Error ? oneLine(error.message, 120) : "unknown"}`;
    }
  }

  const v1 = await retrieveStage3VisualEvidence({ ...input, evidenceVersion: STAGE3_VISUAL_EVIDENCE_VERSION });
  const fallback = v1.packs.length ? "v1" : "pdf_only";
  const result: Stage3VisualEvidenceResult = {
    ...v1,
    latencyMs: now() - started,
    notes: [`Stage 3 v2 evidence unavailable (${reason}); using ${fallback === "v1" ? "v1 pack" : "PDF only"}.`, ...v1.notes],
    requestedVersion: STAGE3_VISUAL_EVIDENCE_V2_VERSION,
    fallbackReason: `${reason}->${fallback}`,
  };
  result.promptBlock = formatStage3VisualEvidencePrompt(result);
  return result;
}

/** Merge Stage 1–2 and Stage 3 prompt blocks for buildAnalyzerUserPrompt. */
export function mergeVisualEvidencePromptBlocks(
  stage12: string | null | undefined,
  stage3: string | null | undefined,
): string | null {
  const left = String(stage12 || "").trim();
  const right = String(stage3 || "").trim();
  if (left && right) return `${left}\n\n${right}`;
  if (left) return left;
  if (right) return right;
  return null;
}

export function stage3VisualEvidenceAuditMetadata(
  result: Stage3VisualEvidenceResult,
): Record<string, unknown> {
  return {
    stage3_visual_evidence_version: result.version,
    stage3_visual_evidence_enabled: result.enabled,
    stage3_visual_evidence_status: result.status,
    stage3_visual_evidence_latency_ms: result.latencyMs,
    stage3_visual_evidence_pack_count: result.packs.length,
    stage3_visual_evidence_cache_key: result.cacheKey,
    stage3_visual_evidence_worker_missing: result.workerOfflineOrMissing,
    stage3_visual_evidence_packs: result.packs.map((pack) => ({
      id: pack.id,
      sheet_id: pack.sheetId,
      topic: pack.topic,
      status: pack.status,
      detail_identifier: pack.detailIdentifier || null,
      independently_verified: false,
      extraction_method: pack.provenance?.extractionMethod || pack.provenance?.method || null,
      source_sha256: pack.sourceFileSha256 || null,
    })),
    stage3_visual_evidence_notes: result.notes,
    ...(result.requestedVersion
      ? {
        stage3_evidence_requested_version: result.requestedVersion,
        stage3_evidence_fallback_reason: result.fallbackReason ?? null,
        stage3_evidence_prompt_chars: result.promptBlock.length,
        stage3_evidence_digest: result.packs
          .map((pack) => pack.digest)
          .filter((digest): digest is Record<string, unknown> => Boolean(digest))
          .map((digest) => ({
            shown: Array.isArray(digest.shown) ? digest.shown.length : null,
            omitted: Array.isArray(digest.omitted) ? digest.omitted.length : null,
            chars: digest.chars ?? null,
            max_chars: digest.maxChars ?? null,
          })),
      }
      : {}),
  };
}
