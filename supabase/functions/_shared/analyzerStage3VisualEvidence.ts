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

export const STAGE3_VISUAL_EVIDENCE_BOUNDS = {
  maxPacks: 3,
  maxCharsPerPack: 1200,
  maxTotalChars: 3200,
  /** Analyzer must not wait for a Mac worker — pack load is sync/near-sync only. */
  loadTimeoutMs: 50,
} as const;

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
}

export interface Stage3VisualEvidenceResult {
  version: typeof STAGE3_VISUAL_EVIDENCE_VERSION;
  enabled: boolean;
  status: Stage3RunStatus;
  latencyMs: number;
  sheetFileName: string;
  packs: Stage3EvidencePack[];
  promptBlock: string;
  notes: string[];
  cacheKey: string | null;
  workerOfflineOrMissing: boolean;
}

export interface Stage3VisualEvidenceDeps {
  /** Load completed packs for this sheet. Must not block on OCR / Mac availability. */
  loadCompletedPacks?: (ctx: {
    fileName: string;
    contentSha256?: string | null;
    objectPath?: string | null;
    projectId?: string | null;
    runId?: string | null;
    sheetJobId?: string | null;
  }) => Promise<Stage3EvidencePack[] | null>;
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
}): Promise<Stage3VisualEvidenceResult> {
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
  };
}
