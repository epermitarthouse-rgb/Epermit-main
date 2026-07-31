import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DemoMcDonalds.tsx"), "utf8");
const badgeSource = readFileSync(
  join(__dirname, "..", "components", "permitpilot", "DemoDataBadge.tsx"),
  "utf8",
);
const tourSource = readFileSync(
  join(__dirname, "..", "components", "permitpilot", "GuidedTour.tsx"),
  "utf8",
);

describe("DemoMcDonalds disclosure + routing contracts", () => {
  it("uses the exact DemoDataBadge label string", () => {
    assert.match(badgeSource, /Demo data · illustrative only/);
    assert.match(badgeSource, /Demo data — illustrative only/);
    assert.match(source, /DemoDataBadge/);
    assert.match(source, /docs\/data-provenance\.md/);
  });

  it("marks the page internal-only / unapproved", () => {
    assert.match(source, /Internal only · unapproved for public use/);
    assert.match(source, /Not affiliated with, endorsed by, or sponsored by McDonald/);
  });

  it("links Explore Interactive Demo to /demos without inventing backends", () => {
    assert.match(source, /Explore Interactive Demo/);
    assert.match(source, /to="\/demos"/);
    assert.match(source, /upcoming:\s*true/);
  });

  it("preserves guided tour one-time storage key", () => {
    assert.match(tourSource, /commun-et:tour:demo-mcd/);
    assert.match(source, /autoStart/);
    assert.match(source, /Guided tour/);
  });

  it("reconciles jurisdiction copy to approved 50+ (not 42 portals)", () => {
    assert.match(source, /50\+ jurisdictions/);
    assert.doesNotMatch(source, /42 jurisdictional portals/);
  });

  it("does not claim ROI figures as measured", () => {
    assert.match(source, /Per-store impact, illustrative\./);
    assert.doesNotMatch(source, /Per-store impact, measured\./);
  });
});
