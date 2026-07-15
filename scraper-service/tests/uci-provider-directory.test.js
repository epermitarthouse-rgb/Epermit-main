"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Documented priority provider directory (CET-2026-UCI-BACKEND-001 / Phase 5).
 * Single utility_type per seed row — multi-type variants in spec are regional and not inferred.
 */
const PRIORITY_PROVIDER_DIRECTORY = [
  { slug: "pepco", name: "PEPCO", utility_type: "electric" },
  { slug: "bge", name: "BGE", utility_type: "electric" },
  { slug: "washington-gas", name: "Washington Gas", utility_type: "gas" },
  { slug: "dominion", name: "Dominion Energy", utility_type: "electric" },
  { slug: "fpl", name: "Florida Power & Light", utility_type: "electric" },
  { slug: "con-edison", name: "Consolidated Edison", utility_type: "electric" },
  { slug: "pseg", name: "PSEG", utility_type: "electric" },
  { slug: "eversource", name: "Eversource Energy", utility_type: "electric" },
  { slug: "duke-energy", name: "Duke Energy", utility_type: "electric" },
  { slug: "georgia-power", name: "Georgia Power", utility_type: "electric" },
];

const PEPCO_VERIFIED_PORTAL_URL =
  "https://secure.pepco.com/service-installation-upgrades-portal/";

describe("UCI Row 3 — utility provider directory seed", () => {
  it("foundation migration seeds all 10 priority providers", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      "20260509120000_uci_foundation.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    for (const provider of PRIORITY_PROVIDER_DIRECTORY) {
      assert.match(sql, new RegExp(`\\('${provider.slug}', '${provider.name}', '${provider.utility_type}'\\)`));
    }
  });

  it("row 3 migration backfills documented portal metadata for global templates", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      "20260715150000_row3_provider_directory_metadata.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    assert.match(sql, /primary_portal_type = 'portal'/);
    assert.match(sql, /portal_credentials_ref = name/);

    for (const provider of PRIORITY_PROVIDER_DIRECTORY) {
      assert.match(sql, new RegExp(`'${provider.slug}'`));
    }

    assert.match(sql, new RegExp(PEPCO_VERIFIED_PORTAL_URL.replace(/\//g, "\\/")));
    const setClauses = sql.match(/SET[\s\S]*?WHERE/g) || [];
    for (const clause of setClauses) {
      assert.doesNotMatch(clause, /\bservice_territory\s*=/i);
      assert.doesNotMatch(clause, /\bownership_type\s*=/i);
    }
  });

  it("provider API columns exclude credential secrets", () => {
    const {
      ACTIVE_PROVIDER_COLUMNS,
    } = require("../app/services/uci/uci-providers.service.js");

    assert.match(ACTIVE_PROVIDER_COLUMNS, /slug/);
    assert.match(ACTIVE_PROVIDER_COLUMNS, /primary_portal_type/);
    assert.match(ACTIVE_PROVIDER_COLUMNS, /portal_url/);
    assert.doesNotMatch(ACTIVE_PROVIDER_COLUMNS, /portal_credentials_ref/);
    assert.doesNotMatch(ACTIVE_PROVIDER_COLUMNS, /portal_password/i);
  });

  it("portal credential labels align with seeded provider names", () => {
    const labels = PRIORITY_PROVIDER_DIRECTORY.map((p) => p.name);
    const unique = new Set(labels);
    assert.equal(unique.size, labels.length);
    assert.equal(labels.length, 10);
  });
});
