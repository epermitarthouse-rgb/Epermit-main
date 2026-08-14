import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../App.tsx"), "utf8");
const navSource = readFileSync(join(__dirname, "../lib/uciNavSections.ts"), "utf8");
const hookSource = readFileSync(join(__dirname, "../hooks/useUciApplicationBuilder.ts"), "utf8");
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");

describe("UCI Application Builder route wiring", () => {
  it("mounts the real builder at /uci/application-builder", () => {
    assert.match(appSource, /path="\/uci\/application-builder"/);
    assert.match(appSource, /<UciApplicationBuilder \/>/);
    assert.doesNotMatch(appSource, /to="\/uci\?section=application-builder"/);
  });

  it("points Builder navigation to the application-package workspace", () => {
    assert.match(navSource, /target: \{ kind: "drawer-tab", tab: "application-prep" \}/);
    assert.match(navSource, /id: "application-builder"/);
    assert.match(navSource, /id: "meter-set"[\s\S]*tab: "energization-closeout"/);
  });

  it("keeps Stages 2–4 package work in the coordination workspace", () => {
    assert.match(navSource, /Load, application & submission/);
    assert.match(dashboardSource, /<ApplicationPrepSection/);
    assert.match(dashboardSource, /<LoadProfileWorkspace/);
  });

  it("never enables live Pepco submission from the Builder hook", () => {
    assert.match(hookSource, /Never pass live_submission_confirmed/);
    assert.doesNotMatch(hookSource, /live_submission_confirmed:\s*true/);
  });
});
