// Run: node --import tsx --test supabase/functions/_shared/centralBudgetScopes.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSourceScopes, planPermitPasses, planSweepPasses, sourceScopes } from "./centralBudgetScopes.ts";

const DC = "dc-projectdox";
const MONT = "montgomery-projectdox";

describe("central budget scopes per source (D-147)", () => {
  it("with no source scope the sweep is the single all-adapter pass on the env scope (pre-D-147)", () => {
    const s = sourceScopes([
      { adapter_key: DC, settings: { schedule: { enabled: true } } },
      { adapter_key: MONT, settings: {} },
    ]);
    assert.equal(hasSourceScopes(s), false);
    assert.deepEqual(planSweepPasses(s, "dc-backfill", 7), [{ adapterKey: null, budgetScope: "dc-backfill", permitIds: null }]);
    assert.deepEqual(planSweepPasses(s, "", 0), []);
    assert.deepEqual(planSweepPasses(s, "Not A Scope", 0), []);
    assert.deepEqual(planPermitPasses(s, "dc-backfill", ["p1"], []), [{ adapterKey: null, budgetScope: "dc-backfill", permitIds: ["p1"] }]);
  });

  it("a source scope applies to that adapter only; the others keep the env scope", () => {
    const s = sourceScopes([
      { adapter_key: DC, settings: {} },
      { adapter_key: MONT, settings: { central_budget_scope: "montgomery" } },
    ]);
    assert.deepEqual(planSweepPasses(s, "dc-backfill", 0), [
      { adapterKey: DC, budgetScope: "dc-backfill", permitIds: null },
      { adapterKey: MONT, budgetScope: "montgomery", permitIds: null },
    ]);
    // the order rotates per sweep so neither adapter always goes first
    assert.deepEqual(planSweepPasses(s, "dc-backfill", 1).map((p) => p.adapterKey), [MONT, DC]);
    // without the env scope only the adapter with its own budget runs
    assert.deepEqual(planSweepPasses(s, null, 0), [{ adapterKey: MONT, budgetScope: "montgomery", permitIds: null }]);
  });

  it("named permits are grouped by their adapter; an unknown permit is not processed", () => {
    const s = sourceScopes([{ adapter_key: MONT, settings: { central_budget_scope: "montgomery" } }, { adapter_key: DC, settings: null }]);
    const permits = [
      { id: "m1", adapter_key: MONT },
      { id: "d1", adapter_key: DC },
      { id: "m2", adapter_key: MONT },
    ];
    assert.deepEqual(planPermitPasses(s, "dc-backfill", ["m1", "d1", "m2", "gone"], permits), [
      { adapterKey: DC, budgetScope: "dc-backfill", permitIds: ["d1"] },
      { adapterKey: MONT, budgetScope: "montgomery", permitIds: ["m1", "m2"] },
    ]);
    assert.deepEqual(planPermitPasses(s, "dc-backfill", [], permits), []);
  });

  it("sources of one adapter naming different scopes give that adapter no pass at all", () => {
    const s = sourceScopes([
      { adapter_key: MONT, settings: { central_budget_scope: "montgomery" } },
      { adapter_key: MONT, settings: { central_budget_scope: "other-scope" } },
      { adapter_key: DC, settings: {} },
    ]);
    assert.deepEqual(s.conflicts, [MONT]);
    assert.deepEqual(planSweepPasses(s, "dc-backfill", 0), [{ adapterKey: DC, budgetScope: "dc-backfill", permitIds: null }]);
    assert.deepEqual(planPermitPasses(s, "dc-backfill", ["m1"], [{ id: "m1", adapter_key: MONT }]), []);
  });

  it("an invalid scope value in settings is ignored", () => {
    const s = sourceScopes([{ adapter_key: MONT, settings: { central_budget_scope: "Montgomery County!" } }]);
    assert.equal(hasSourceScopes(s), false);
    const t = sourceScopes([{ adapter_key: MONT, settings: { central_budget_scope: " montgomery " } }]);
    assert.equal(t.scopes.get(MONT), "montgomery");
  });
});
