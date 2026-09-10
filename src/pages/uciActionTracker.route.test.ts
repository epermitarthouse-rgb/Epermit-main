import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UCI Action Tracker admin wiring", () => {
  it("is not mounted under AdminLayout", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    assert.doesNotMatch(app, /path="uci-action-tracker"/);
    assert.doesNotMatch(app, /UciActionTracker/);
  });

  it("is not listed in admin-only hybrid nav", () => {
    const nav = readFileSync(resolve(__dirname, "../components/layout/hybridNav.ts"), "utf8");
    assert.doesNotMatch(nav, /href: "\/admin\/uci-action-tracker"/);
    assert.doesNotMatch(nav, /UCI Action Tracker/);
    const uciNav = readFileSync(resolve(__dirname, "../lib/uciNavSections.ts"), "utf8");
    assert.doesNotMatch(uciNav, /uci-action-tracker/);
  });
});
