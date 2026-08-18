import { describe, expect, it } from "vitest";
import trackerRaw from "@/data/uciActionTracker.json";
import type { UciActionTrackerPayload } from "@/types/uciActionTracker";
import {
  assertTrackerPayload,
  defaultUciTrackerFilters,
  matchesUciTrackerFilters,
  mergeUciActionItem,
  pilotItems,
  countByStatus,
} from "@/lib/uciActionTracker";

const payload = trackerRaw as UciActionTrackerPayload;

describe("uciActionTracker data", () => {
  it("contains exactly 42 sequenced action items", () => {
    const result = assertTrackerPayload(payload);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(payload.items).toHaveLength(42);
  });

  it("applies audit corrections for critical rows", () => {
    const bySeq = Object.fromEntries(payload.items.map((i) => [i.sequence, i]));

    expect(bySeq[1].status).toBe("Complete");
    expect(bySeq[2].status).toBe("Production Verification Required");
    expect(bySeq[2].blockerGap.toLowerCase()).toContain("supabase");
    expect(bySeq[2].blockerGap.toLowerCase()).not.toContain("resend");
    expect(bySeq[3].status).toBe("Complete");
    expect(bySeq[4].status).toBe("Complete");

    expect(bySeq[5].status).toBe("Partial");
    expect(bySeq[5].subStatus).toMatch(/Electric scope: Complete/i);
    expect(bySeq[5].subStatus).toMatch(/Full Utility Provider Mapper: Partial/i);

    expect(bySeq[6].status).toBe("Partial");
    expect(bySeq[7].status).toBe("Scaffolded");
    expect(bySeq[7].spreadsheetNextAction.toLowerCase()).toContain("dry-run");
    expect(bySeq[7].nextAction.toLowerCase()).not.toMatch(/^implement pepco dry-run/);
    expect(bySeq[8].status).toBe("Partial");
    expect(bySeq[15].status).toBe("Scaffolded");
    expect(bySeq[23].status).toBe("Partial");
    expect(bySeq[23].spreadsheetStatus.toLowerCase()).toContain("not started");

    expect(bySeq[40].criticalPath).toBe(true);
    expect(bySeq[40].status).toBe("Not Started");
    expect(bySeq[42].status).toBe("Production Verification Required");
  });

  it("marks Phase 4/5 deferred rows as deferred scope", () => {
    const deferred = payload.items.filter((i) => i.sequence >= 27 && i.sequence <= 32);
    expect(deferred).toHaveLength(6);
    for (const row of deferred) {
      expect(row.scope).toBe("deferred");
      expect(row.status).toBe("Deferred");
    }
  });

  it("excludes deferred rows from pilot completion tallies", () => {
    const merged = payload.items.map((i) => mergeUciActionItem(i));
    const pilot = pilotItems(merged);
    expect(pilot.every((i) => i.scope === "pilot")).toBe(true);
    expect(pilot.length).toBe(36);
    const counts = countByStatus(merged);
    expect(counts.Deferred).toBe(6);
  });

  it("filters by status, scope, and search", () => {
    const merged = payload.items.map((i) => mergeUciActionItem(i));
    const scaffolded = merged.filter((i) =>
      matchesUciTrackerFilters(i, { ...defaultUciTrackerFilters, status: "Scaffolded" }),
    );
    expect(scaffolded.map((i) => i.sequence).sort((a, b) => a - b)).toEqual([7, 15]);

    const deferredOnly = merged.filter((i) =>
      matchesUciTrackerFilters(i, { ...defaultUciTrackerFilters, scope: "deferred" }),
    );
    expect(deferredOnly).toHaveLength(6);

    const searchHits = merged.filter((i) =>
      matchesUciTrackerFilters(i, {
        ...defaultUciTrackerFilters,
        search: "Mail.Send",
      }),
    );
    expect(searchHits.some((i) => i.sequence === 7 || i.sequence === 23)).toBe(true);
  });

  it("includes latest backend UCI test result note on row 16", () => {
    const row16 = payload.items.find((i) => i.sequence === 16)!;
    expect(row16.status).toBe("Partial");
    expect(row16.evidence?.testResult).toMatch(/559\/567/);
  });
});
