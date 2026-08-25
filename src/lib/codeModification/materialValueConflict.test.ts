import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectMaterialValueConflicts,
  materialValuesConflict,
} from "./materialValueConflict.ts";

describe("materialValueConflict", () => {
  it("C. detects occupant load numeric conflicts", () => {
    assert.equal(
      materialValuesConflict(
        ["Occupant load 48 per floor.", "Occupant load schedule shows 60 occupants."],
        "Maintain an occupant load below 49 people per floor",
      ),
      true,
    );
  });

  it("D. detects door width numeric conflicts", () => {
    assert.equal(
      materialValuesConflict(
        ["Door width 36 in noted on plan.", "Door width 32 in at corridor."],
        "Maintain minimum door width of 36 inches",
      ),
      true,
    );
  });

  it("E. treats compatible common-path values under the measure limit as non-conflicting", () => {
    assert.equal(
      materialValuesConflict(
        ["Common path of travel 72'-4\".", "Common path of travel 71'-0\"."],
        "Maintain a common path of travel distance of less than 75'-0\"",
      ),
      false,
    );
  });

  it("does not conflict unrelated numeric values", () => {
    const conflicts = detectMaterialValueConflicts(
      ["Level 1 area 1200 sf.", "Stair width 44 in."],
      "Provide egress improvements",
    );
    assert.equal(conflicts.length, 0);
  });

  it("A. does not conflict fire ratings on different assemblies (corridor 1h vs stair 2h)", () => {
    assert.equal(
      materialValuesConflict(
        [
          "2-HOUR fire rating at stair enclosure.",
          "1-hour corridor partitions; stair shaft 2-hour rated.",
          "Egress path to enclosed 2-hour stair.",
        ],
        "Provide a two-hour fire rated enclosed stairway serving all occupied levels",
      ),
      false,
    );
  });
});
