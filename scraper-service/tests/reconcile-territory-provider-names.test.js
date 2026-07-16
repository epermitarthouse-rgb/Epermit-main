"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  parseArgs,
  loadPolygonUtilityNames,
  buildCountyReconcileReport,
  runStdinMode,
  STDIN_READ_TIMEOUT_MS,
} = require("../scripts/reconcile-territory-provider-names.js");

const SCRIPT_PATH = path.join(__dirname, "..", "scripts", "reconcile-territory-provider-names.js");
const DATA_DIR = path.join(__dirname, "..", "data", "territory", "electric");

describe("reconcile-territory-provider-names script", () => {
  it("parses --input-dir", () => {
    const args = parseArgs(["node", "script", "--input-dir", "data/territory/electric"]);
    assert.equal(args.inputDir, "data/territory/electric");
  });

  it("stdin mode preserves reconcile report format", () => {
    const stdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdout.push(String(chunk));
      return true;
    };
    try {
      runStdinMode(JSON.stringify(["BALTIMORE GAS & ELECTRIC CO"]));
      const report = JSON.parse(stdout.join(""));
      assert.equal(report.totals.resolved, 1);
      assert.equal(report.resolved[0].provider_slug, "bge");
      assert.ok(Array.isArray(report.unresolved));
      assert.ok(report.totals);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("stdin subprocess mode resolves known alias", () => {
    const proc = spawnSync("node", [SCRIPT_PATH], {
      input: JSON.stringify(["SOUTHERN MARYLAND ELEC COOP INC"]),
      encoding: "utf8",
      cwd: path.join(__dirname, ".."),
    });
    assert.equal(proc.status, 0, proc.stderr);
    const report = JSON.parse(proc.stdout);
    assert.equal(report.totals.resolved, 1);
    assert.equal(report.resolved[0].provider_slug, "smeco");
  });

  it("stdin mode with empty pipe completes without hanging", () => {
    const proc = spawnSync("node", [SCRIPT_PATH], {
      input: "",
      encoding: "utf8",
      cwd: path.join(__dirname, ".."),
      timeout: 2000,
    });
    assert.equal(proc.status, 0, proc.stderr);
    const report = JSON.parse(proc.stdout);
    assert.equal(report.totals.input, 0);
    assert.match(proc.stderr, /complete/);
  });

  it("input-dir mode completes against local Maryland territory data", () => {
    const proc = spawnSync(
      "node",
      [SCRIPT_PATH, "--input-dir", DATA_DIR],
      {
        encoding: "utf8",
        cwd: path.join(__dirname, ".."),
        timeout: 10000,
      },
    );
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stderr, /reading input files/);
    assert.match(proc.stderr, /loading provider catalog/);
    assert.match(proc.stderr, /reconciling polygon utility names/);
    assert.match(proc.stderr, /writing report/);
    assert.match(proc.stderr, /complete:/);

    const combined = JSON.parse(proc.stdout);
    assert.equal(combined.polygon.totals.resolved, 9);
    assert.equal(combined.polygon.totals.unresolved, 0);
    assert.equal(combined.county.totals.unresolved, 0);
  });

  it("loads polygon names from utilities_by_state.json", () => {
    const names = loadPolygonUtilityNames(DATA_DIR);
    assert.equal(names.length, 9);
    assert.ok(names.includes("BALTIMORE GAS & ELECTRIC CO"));
  });

  it("buildCountyReconcileReport resolves Somerset utilities", () => {
    const countyStore = {
      "MD:Somerset": {
        utilities: [
          "A & N Electric Coop",
          "Choptank Electric Cooperative, Inc",
          "Delmarva Power",
        ],
      },
    };
    const report = buildCountyReconcileReport(countyStore);
    assert.equal(report.totals.unresolved, 0);
    assert.equal(report.unique_utilities.totals.resolved, 3);
  });
});

describe("reconcile-territory-provider-names exports", () => {
  it("exposes stdin timeout constant", () => {
    assert.equal(STDIN_READ_TIMEOUT_MS, 5000);
  });
});
