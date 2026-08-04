import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "../App.tsx"), "utf8");
const navSource = readFileSync(join(__dirname, "../lib/uciNavSections.ts"), "utf8");
const pageSource = readFileSync(join(__dirname, "UciApplicationBuilder.tsx"), "utf8");
const hookSource = readFileSync(join(__dirname, "../hooks/useUciApplicationBuilder.ts"), "utf8");

describe("UCI Application Builder route wiring", () => {
  it("registers /uci/application-builder in App routes", () => {
    assert.match(appSource, /path="\/uci\/application-builder"/);
    assert.match(appSource, /UciApplicationBuilder/);
  });

  it("points Application Builder nav to the dedicated page", () => {
    assert.match(navSource, /href: "\/uci\/application-builder"/);
    assert.match(navSource, /id: "application-builder"/);
  });

  it("keeps all six Lovable sections and Coming Soon owner/billing protections", () => {
    assert.match(pageSource, /Service requested/);
    assert.match(pageSource, /Load profile/);
    assert.match(pageSource, /Site &amp; access|Site & access/);
    assert.match(pageSource, /Owner &amp; billing|Owner & billing/);
    assert.match(pageSource, /Drawings &amp; exhibits|Drawings & exhibits/);
    assert.match(pageSource, /Review &amp; submit|Review & submit/);
    assert.match(pageSource, /Federal Tax ID/);
    assert.match(pageSource, /Coming soon — PermitPilot has no secure UCI store/);
    assert.match(pageSource, /Never shown as passed without a real service/);
    assert.match(pageSource, /validation dry-run/);
    assert.doesNotMatch(pageSource, /Agent QA passed/);
    assert.doesNotMatch(pageSource, /Valvoline Leesburg Express/);
  });

  it("never enables live Pepco submission from the Builder hook", () => {
    assert.match(hookSource, /Never pass live_submission_confirmed/);
    assert.doesNotMatch(hookSource, /live_submission_confirmed:\s*true/);
  });
});
