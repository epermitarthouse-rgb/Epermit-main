"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  reconcileTerritoryProviderNames,
  isTerritoryUnsupportedManualName,
} = require("../app/services/uci/territory/territory-provider-reconciliation.service.js");
const { reconcileEiaUtilityName } = require("../app/services/uci/territory/territory-eia-name-resolver.service.js");
const {
  UTILITY_PROVIDER_DIRECTORY,
  TERRITORY_UNSUPPORTED_EIA_NAMES,
} = require("../app/data/utility-provider-directory.catalog.js");
const {
  normalizeProviderAlias,
} = require("../app/services/uci/uci-provider-directory-normalize.service.js");
const {
  resolveProviderAlias,
  expandCatalogAliases,
  buildAliasIndex,
} = require("../app/services/uci/uci-provider-directory.service.js");
const {
  buildProviderSeedRow,
  seedUtilityProviderDirectory,
} = require("../app/services/uci/uci-provider-directory-seed.service.js");

const MD_EIA_NAMES = [
  "BALTIMORE GAS & ELECTRIC CO",
  "POTOMAC ELECTRIC POWER CO",
  "SOUTHERN MARYLAND ELEC COOP INC",
  "CHOPTANK ELECTRIC COOPERATIVE, INC",
  "HAGERSTOWN LIGHT DEPARTMENT",
  "EASTON UTILITIES COMM",
  "THURMONT MUNICIPAL LIGHT CO",
  "TOWN OF BERLIN - (MD)",
  "TOWN OF WILLIAMSPORT - (MD)",
];

describe("Maryland territory provider reconciliation", () => {
  it("resolves SMECO EIA legal name to smeco", () => {
    const result = reconcileEiaUtilityName("SOUTHERN MARYLAND ELEC COOP INC");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "smeco");
  });

  it("resolves all reviewed Maryland EIA names from the local ingestion output", () => {
    const report = reconcileTerritoryProviderNames(MD_EIA_NAMES);
    assert.equal(report.totals.input, 9);
    assert.equal(report.totals.resolved, 9);
    assert.equal(report.totals.ambiguous, 0);
    assert.equal(report.totals.unresolved, 0);
    assert.equal(report.totals.unsupported_manual, 0);
    assert.ok(report.resolved.every((row) => row.provider_slug));
  });

  it("maps each municipal EIA name to its distinct municipal slug", () => {
    const expected = {
      "HAGERSTOWN LIGHT DEPARTMENT": "hagerstown-light",
      "EASTON UTILITIES COMM": "easton-utilities",
      "THURMONT MUNICIPAL LIGHT CO": "thurmont-municipal",
      "TOWN OF BERLIN - (MD)": "berlin-electric",
      "TOWN OF WILLIAMSPORT - (MD)": "williamsport-municipal",
    };
    for (const [eiaName, slug] of Object.entries(expected)) {
      const result = reconcileEiaUtilityName(eiaName);
      assert.equal(result.status, "resolved", eiaName);
      assert.equal(result.provider_slug, slug, eiaName);
    }
  });

  it("does not map municipals to BGE, PEPCO, or Potomac Edison", () => {
    const municipals = [
      "HAGERSTOWN LIGHT DEPARTMENT",
      "EASTON UTILITIES COMM",
      "THURMONT MUNICIPAL LIGHT CO",
      "TOWN OF BERLIN - (MD)",
      "TOWN OF WILLIAMSPORT - (MD)",
    ];
    for (const name of municipals) {
      const result = reconcileEiaUtilityName(name);
      assert.ok(!["bge", "pepco", "potomac-edison"].includes(result.provider_slug), name);
    }
  });

  it("does not fuzzy-guess unknown EIA names", () => {
    const report = reconcileTerritoryProviderNames(["Totally Unknown Utility LLC"]);
    assert.equal(report.totals.resolved, 0);
    assert.equal(report.totals.unresolved, 1);
    assert.equal(report.unresolved[0].reason, "no_matching_alias");
    assert.equal(report.unresolved[0].manual_confirmation_required, true);
  });

  it("routes explicitly unsupported names to unsupported_manual", () => {
    const original = [...TERRITORY_UNSUPPORTED_EIA_NAMES];
    TERRITORY_UNSUPPORTED_EIA_NAMES.push("EXAMPLE UNSUPPORTED UTILITY");
    try {
      assert.equal(isTerritoryUnsupportedManualName("EXAMPLE UNSUPPORTED UTILITY"), true);
      const report = reconcileTerritoryProviderNames(["EXAMPLE UNSUPPORTED UTILITY"]);
      assert.equal(report.totals.unsupported_manual, 1);
      assert.equal(report.unsupported_manual[0].status, "unsupported_manual");
      assert.equal(report.unsupported_manual[0].manual_confirmation_required, true);
      assert.equal(report.totals.unresolved, 0);
    } finally {
      TERRITORY_UNSUPPORTED_EIA_NAMES.length = 0;
      TERRITORY_UNSUPPORTED_EIA_NAMES.push(...original);
    }
  });

  it("separates resolved, ambiguous, unresolved, and unsupported_manual buckets", () => {
    const report = reconcileTerritoryProviderNames(["Dominion Energy", "UNKNOWN CO"]);
    assert.equal(report.totals.ambiguous, 1);
    assert.equal(report.totals.unresolved, 1);
    assert.equal(report.ambiguous[0].candidate_slugs.length > 1, true);
    assert.equal(report.unresolved[0].provider_slug, null);
  });
});

describe("Maryland municipal catalog entries", () => {
  const municipalSlugs = [
    "hagerstown-light",
    "easton-utilities",
    "thurmont-municipal",
    "berlin-electric",
    "williamsport-municipal",
  ];

  it("adds municipal providers with electric type and municipal ownership", () => {
    for (const slug of municipalSlugs) {
      const entry = UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === slug);
      assert.ok(entry, slug);
      assert.equal(entry.utility_type, "electric");
      assert.equal(entry.ownership_type, "municipal");
      assert.equal(entry.cet_relationship, false);
      assert.match(String(entry.directory_source?.source ?? ""), /EIA/i);
    }
  });

  it("preserves existing smeco slug and does not create duplicate SMECO providers", () => {
    const smecoEntries = UTILITY_PROVIDER_DIRECTORY.filter((p) =>
      [p.slug, p.display_name, p.canonical_name].some((v) => /smeco/i.test(String(v))),
    );
    assert.equal(smecoEntries.length, 1);
    assert.equal(smecoEntries[0].slug, "smeco");
  });

  it("seed dry-run schedules the SMECO EIA legal alias without inserting duplicate providers", async () => {
    const existing = UTILITY_PROVIDER_DIRECTORY.map((entry, idx) => ({
      id: `uuid-${idx}`,
      slug: entry.slug,
      name: entry.display_name,
    }));

    const supabase = {
      from(table) {
        if (table === "utility_providers") {
          return {
            select() {
              return {
                is() {
                  return {
                    eq() {
                      return Promise.resolve({ data: existing, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await seedUtilityProviderDirectory(supabase, { dryRun: true });
    const smecoActions = result.providerActions.filter((a) => a.slug === "smeco");
    assert.equal(smecoActions.length, 1);
    assert.equal(smecoActions[0].action, "update");

    const smecoAliases = expandCatalogAliases(
      UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "smeco"),
    ).map((a) => a.alias_normalized);
    assert.ok(
      smecoAliases.includes(normalizeProviderAlias("SOUTHERN MARYLAND ELEC COOP INC")),
    );

    const resultAliasActions = result.aliasActions.map((a) => a.alias_normalized);
    assert.ok(
      resultAliasActions.includes(normalizeProviderAlias("SOUTHERN MARYLAND ELEC COOP INC")),
    );
  });

  it("catalog has no duplicate slugs after municipal additions", () => {
    const slugs = UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("municipal seed rows preserve EIA directory provenance", () => {
    const row = buildProviderSeedRow(
      UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "hagerstown-light"),
    );
    assert.equal(row.ownership_type, "municipal");
    assert.equal(row.directory_source.seed, "eia_md_territory_reconciliation_2026_07_17");
  });
});

describe("Maryland alias resolution via Row 3 index", () => {
  const index = buildAliasIndex();

  it("resolves SMECO abbreviation and EIA legal name to the same slug", () => {
    for (const alias of ["SMECO", "SOUTHERN MARYLAND ELEC COOP INC"]) {
      const result = resolveProviderAlias(alias, { index });
      assert.equal(result.status, "found", alias);
      assert.equal(result.slug, "smeco");
    }
  });
});
