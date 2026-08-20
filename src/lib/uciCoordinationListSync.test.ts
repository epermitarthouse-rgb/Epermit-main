import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncSource = readFileSync(join(__dirname, "uciCoordinationListSync.ts"), "utf8");
const dashboardSource = readFileSync(join(__dirname, "..", "pages", "UciDashboard.tsx"), "utf8");

describe("uciCoordinationListSync", () => {
  it("patches list rows by coordination record id without replacing unrelated rows", () => {
    assert.match(syncSource, /patchCoordinationRecordInList/);
    assert.match(syncSource, /record\.id === updated\.id/);
    assert.match(syncSource, /current_stage/);
    assert.match(syncSource, /current_stage_state/);
  });

  it("finds coordination rows by utility type for provider reassignment", () => {
    assert.match(syncSource, /findCoordinationRecordForUtilityType/);
    assert.match(syncSource, /utility_type/);
  });
});

describe("UciDashboard list/workspace lifecycle sync", () => {
  it("mirrors canonical workspace record stage/state back into the coordination list", () => {
    assert.match(dashboardSource, /patchCoordinationRecordInList/);
    assert.match(dashboardSource, /syncCoordinationListRecord/);
    assert.match(dashboardSource, /getCoordinationDetail\(id\)/);
  });
});
