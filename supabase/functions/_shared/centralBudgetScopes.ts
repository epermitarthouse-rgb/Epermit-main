/**
 * Which AI budget a central (permit-level) pass draws on (D-147). A permit_sync_sources row may name its own
 * budget in settings.central_budget_scope; the permits of that source's adapter are then processed against it,
 * and every other adapter against the project-wide CENTRAL_AI_BUDGET_SCOPE (the fallback). With no source scope
 * configured the plan is the single all-adapter pass used before D-147 (adapter null, the fallback scope).
 * An adapter whose sources name different scopes gets no pass at all (nothing is spent from a guessed budget).
 */

export const BUDGET_SCOPE = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export type SourceScopeRow = { adapter_key: string | null; settings: Record<string, unknown> | null };
export type PermitAdapterRow = { id: string; adapter_key: string | null };
export type CentralPassPlan = { adapterKey: string | null; budgetScope: string; permitIds: string[] | null };
export type SourceScopes = { scopes: Map<string, string>; conflicts: string[]; adapters: string[] };

function validScope(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return BUDGET_SCOPE.test(s) ? s : null;
}

/** Per-adapter budget scopes named by the sources, the adapters whose sources disagree, and every source adapter. */
export function sourceScopes(rows: SourceScopeRow[]): SourceScopes {
  const named = new Map<string, Set<string>>();
  const adapters = new Set<string>();
  for (const r of rows) {
    if (!r.adapter_key) continue;
    adapters.add(r.adapter_key);
    const s = validScope(r.settings?.central_budget_scope);
    if (!s) continue;
    if (!named.has(r.adapter_key)) named.set(r.adapter_key, new Set());
    named.get(r.adapter_key)!.add(s);
  }
  const scopes = new Map<string, string>();
  const conflicts: string[] = [];
  for (const [key, set] of named) {
    if (set.size === 1) scopes.set(key, [...set][0]);
    else conflicts.push(key);
  }
  return { scopes, conflicts: conflicts.sort(), adapters: [...adapters].sort() };
}

function scopeFor(s: SourceScopes, adapterKey: string, fallback: string | null): string | null {
  if (s.conflicts.includes(adapterKey)) return null;
  return s.scopes.get(adapterKey) ?? fallback;
}

/**
 * Passes for a cron sweep (every permit with work). `rotation` shifts the adapter order so one adapter with a large
 * backlog cannot use the sweep's time ahead of the others every time.
 */
export function planSweepPasses(s: SourceScopes, fallbackScope: string | null | undefined, rotation = 0): CentralPassPlan[] {
  const fallback = validScope(fallbackScope);
  if (s.scopes.size === 0 && s.conflicts.length === 0) {
    return fallback ? [{ adapterKey: null, budgetScope: fallback, permitIds: null }] : [];
  }
  const n = s.adapters.length;
  const start = n ? ((Math.trunc(rotation) % n) + n) % n : 0;
  const ordered = [...s.adapters.slice(start), ...s.adapters.slice(0, start)];
  const out: CentralPassPlan[] = [];
  for (const a of ordered) {
    const scope = scopeFor(s, a, fallback);
    if (scope) out.push({ adapterKey: a, budgetScope: scope, permitIds: null });
  }
  return out;
}

/** Passes for named permits (the deep worker's trigger after a sync): grouped by each permit's adapter. */
export function planPermitPasses(
  s: SourceScopes,
  fallbackScope: string | null | undefined,
  permitIds: string[],
  permits: PermitAdapterRow[],
): CentralPassPlan[] {
  const fallback = validScope(fallbackScope);
  if (!permitIds.length) return [];
  if (s.scopes.size === 0 && s.conflicts.length === 0) {
    return fallback ? [{ adapterKey: null, budgetScope: fallback, permitIds }] : [];
  }
  const adapterOf = new Map(permits.map((p) => [p.id, p.adapter_key]));
  const groups = new Map<string, string[]>();
  for (const id of permitIds) {
    const a = adapterOf.get(id);
    if (!a) continue;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(id);
  }
  const out: CentralPassPlan[] = [];
  for (const a of [...groups.keys()].sort()) {
    const scope = scopeFor(s, a, fallback);
    if (scope) out.push({ adapterKey: a, budgetScope: scope, permitIds: groups.get(a)! });
  }
  return out;
}

/** True when any source names its own scope (the plan then needs each permit's adapter). */
export function hasSourceScopes(s: SourceScopes): boolean {
  return s.scopes.size > 0 || s.conflicts.length > 0;
}
