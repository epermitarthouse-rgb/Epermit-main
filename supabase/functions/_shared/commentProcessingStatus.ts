/**
 * Per-row processing status of parsed_comments in project mode (D-130). The classifier and router write it so an
 * incomplete classification or routing is visible instead of silently finalised:
 *   pending          not yet classified and routed
 *   processed        classified and routed
 *   failed           the model skipped the row; it is retried (attempts < MAX_COMMENT_ATTEMPTS)
 *   needs_attention  skipped MAX_COMMENT_ATTEMPTS times; set aside, left unrouted, shown to people
 * NULL = a row that predates tracking.
 *
 * Pure module.
 */

import { MAX_COMMENT_ATTEMPTS, isClassified, type Classification } from "./commentPrompts.ts";

export type ProcessingStatus = "pending" | "processed" | "failed" | "needs_attention";

export type ClassifierRow = { id: string; processing_attempts?: number | null };

export type RowUpdate = { id: string; patch: Record<string, string | number | null> };

/**
 * PostgREST filters for rows the project-mode classifier may (re)classify, ANDed together: unclassified, not
 * Approved (unless a portal row), not filled from a central result, not set by a person, not set aside.
 */
export const CLASSIFIER_ELIGIBLE_OR_FILTERS = [
  "and(discipline.is.null,ingest_source.eq.raw_ref)," +
    "and(discipline.is.null,status.neq.Approved)," +
    "and(discipline.eq.General,ingest_source.eq.raw_ref)," +
    "and(discipline.eq.General,status.neq.Approved)," +
    "and(discipline.eq.Unclassified,ingest_source.eq.raw_ref)," +
    "and(discipline.eq.Unclassified,status.neq.Approved)",
  "discipline_source.is.null,discipline_source.neq.human",
  "processing_status.is.null,processing_status.neq.needs_attention",
];

/** Updates after one classifier call: classified rows get a project_ai discipline; skipped rows count an attempt. */
export function classifierRowUpdates(chunk: ClassifierRow[], parsed: Map<number, Classification> | null): RowUpdate[] {
  return chunk.map((row, i): RowUpdate => {
    const c = parsed?.get(i);
    if (c) {
      return { id: row.id, patch: { discipline: c.discipline, discipline_source: "project_ai", processing_status: "pending", processing_error: null } };
    }
    const attempts = Number(row.processing_attempts ?? 0) + 1;
    return {
      id: row.id,
      patch: {
        processing_attempts: attempts,
        processing_status: attempts >= MAX_COMMENT_ATTEMPTS ? "needs_attention" : "failed",
        processing_error: parsed ? "not classified by the model" : "invalid model output",
      },
    };
  });
}

export type ClassifierLoopResult = {
  classified: number;
  failed: number;
  needs_attention: number;
  rows_sent: number;
  model_calls: number;
  stopped: "done" | "time" | "cap" | "write_failed";
};

/**
 * Project-mode classifier loop (D-130): pages through every eligible row (re-read from the database each time, so
 * it resumes anywhere) until none is left, the row cap is reached or the time budget runs out. A row the model
 * skips counts an attempt and leaves the eligible set after MAX_COMMENT_ATTEMPTS, so the loop always ends.
 */
export async function runClassifierLoop<R extends ClassifierRow>(input: {
  fetchEligible: (limit: number) => Promise<R[]>;
  classify: (chunk: R[]) => Promise<Map<number, Classification> | null>;
  write: (update: RowUpdate) => Promise<boolean>;
  onClassified?: (row: R, c: Classification) => Promise<void>;
  rowCap?: number;
  chunkSize: number;
  deadline: number;
  reserveMs: number;
  now?: () => number;
}): Promise<ClassifierLoopResult> {
  const now = input.now ?? (() => Date.now());
  const rowCap = input.rowCap ?? Number.POSITIVE_INFINITY;
  const out: ClassifierLoopResult = { classified: 0, failed: 0, needs_attention: 0, rows_sent: 0, model_calls: 0, stopped: "done" };
  for (;;) {
    if (out.rows_sent >= rowCap) return { ...out, stopped: "cap" };
    if (now() + input.reserveMs >= input.deadline) return { ...out, stopped: "time" };
    const rows = await input.fetchEligible(Math.min(input.chunkSize, rowCap - out.rows_sent));
    if (rows.length === 0) return out;
    const parsed = await input.classify(rows);
    out.model_calls += 1;
    out.rows_sent += rows.length;
    let written = 0;
    for (const [i, u] of classifierRowUpdates(rows, parsed).entries()) {
      if (!(await input.write(u))) continue;
      written += 1;
      if (u.patch.discipline != null) {
        out.classified += 1;
        if (input.onClassified) await input.onClassified(rows[i]!, parsed!.get(i)!);
      } else if (u.patch.processing_status === "needs_attention") out.needs_attention += 1;
      else out.failed += 1;
    }
    if (written === 0) return { ...out, stopped: "write_failed" };
  }
}

export const DISCIPLINE_ROUTING: Record<string, string> = {
  Structural: "Structural Engineer",
  Architectural: "Project Architect",
  "Mechanical/HVAC": "MEP Engineer",
  Mechanical: "MEP Engineer",
  Electrical: "MEP Engineer",
  Plumbing: "MEP Engineer",
  "Fire Protection": "Fire Protection Engineer",
  Fire: "Fire Protection Engineer",
  Civil: "Civil Engineer",
  Zoning: "Zoning Specialist",
  Environmental: "Environmental Consultant",
  "Green/Energy": "Energy Consultant",
  Energy: "Energy Consultant",
  Administrative: "Project Manager",
  Other: "Project Manager",
};

export const DEFAULT_ASSIGNEE = "Project Manager";

export type RouterRow = {
  id: string;
  discipline: string | null;
  assigned_to: string | null;
  assigned_to_source?: string | null;
  processing_status?: string | null;
};

/**
 * Routing plan. Only classified rows are routed (an unclassified row is never finalised as "Project Manager");
 * a label the router wrote earlier (source project_ai) is re-routed when the discipline changed; an assignment by a
 * person or of unknown origin is never touched. Unclassified rows are reported, not routed.
 */
export function planRouting(rows: RouterRow[]): {
  updates: RowUpdate[];
  routed: number;
  unclassified: number;
  needs_attention: number;
  summary: Record<string, number>;
} {
  const updates: RowUpdate[] = [];
  const summary: Record<string, number> = {};
  let unclassified = 0;
  let needsAttention = 0;
  for (const row of rows) {
    const assigned = String(row.assigned_to ?? "").trim();
    const routerOwned = row.assigned_to_source === "project_ai";
    if (row.assigned_to_source === "human" || (assigned && !routerOwned)) continue;
    if (row.processing_status === "needs_attention") {
      needsAttention++;
      continue;
    }
    const discipline = String(row.discipline ?? "").trim();
    if (!isClassified(discipline)) {
      unclassified++;
      if (row.processing_status !== "pending" && row.processing_status !== "failed") {
        updates.push({ id: row.id, patch: { processing_status: "pending" } });
      }
      continue;
    }
    const label = DISCIPLINE_ROUTING[discipline] ?? DEFAULT_ASSIGNEE;
    summary[label] = (summary[label] ?? 0) + 1;
    if (assigned === label && row.processing_status === "processed") continue;
    updates.push({ id: row.id, patch: { assigned_to: label, assigned_to_source: "project_ai", processing_status: "processed", processing_error: null } });
  }
  return { updates, routed: updates.filter((u) => u.patch.assigned_to).length, unclassified, needs_attention: needsAttention, summary };
}

/**
 * Project-side reconciliation of the rows that came from the permit repository: every row is in exactly one bucket,
 * so total = processed + pending + failed + needs_attention + untracked.
 */
export function reconcileRows(rows: Array<{ processing_status?: string | null }>): {
  total: number;
  processed: number;
  pending: number;
  failed: number;
  needs_attention: number;
  untracked: number;
} {
  const out = { total: rows.length, processed: 0, pending: 0, failed: 0, needs_attention: 0, untracked: 0 };
  for (const r of rows) {
    const s = r.processing_status;
    if (s === "processed" || s === "pending" || s === "failed" || s === "needs_attention") out[s]++;
    else out.untracked++;
  }
  return out;
}
