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
    assert.equal(report.unresolved[0].classification, "new_canonical_required");
    assert.equal(report.unresolved[0].reason, "distinct_unresolved_regulated_utility");
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

describe("Maryland EIA-861 county utility reconciliation", () => {
  const SOMERSET_UTILITIES = [
    "A & N Electric Coop",
    "Choptank Electric Cooperative, Inc",
    "Delmarva Power",
  ];

  it("resolves A & N Electric Coop to a-n-electric-coop", () => {
    const result = reconcileEiaUtilityName("A & N Electric Coop");
    assert.equal(result.status, "resolved");
    assert.equal(result.provider_slug, "a-n-electric-coop");
    assert.equal(result.reason, "alias_match");
  });

  it("resolves reviewed A&N alias variants to the same slug", () => {
    for (const alias of [
      "A & N Electric Coop",
      "A&N Electric Cooperative",
      "A and N Electric Cooperative",
    ]) {
      const result = reconcileEiaUtilityName(alias);
      assert.equal(result.status, "resolved", alias);
      assert.equal(result.provider_slug, "a-n-electric-coop", alias);
    }
  });

  it("does not map A&N to Choptank, Delmarva Power, or SMECO", () => {
    const result = reconcileEiaUtilityName("A & N Electric Coop");
    assert.ok(!["choptank-electric", "delmarva-power", "smeco"].includes(result.provider_slug));
  });

  it("resolves all MD:Somerset county utilities without unresolved names", () => {
    const unresolved = [];
    for (const utilityName of SOMERSET_UTILITIES) {
      const result = reconcileEiaUtilityName(utilityName);
      if (result.status !== "resolved") {
        unresolved.push({ utility_name: utilityName, reason: result.reason });
      }
    }
    assert.deepEqual(unresolved, []);
  });

  it("county ingestion reconciliation reports zero unresolved for MD:Somerset", () => {
    const { buildCountyMap } = require("../scripts/ingest-eia861-county.js");
    const rows = SOMERSET_UTILITIES.map((utilityName, idx) => ({
      data_year: 2024,
      utility_id_eia: String(3503 + idx),
      utility_name: utilityName,
      short_form: utilityName,
      state: "MD",
      county: "Somerset",
    }));
    const { unresolved, store } = buildCountyMap(rows, ["MD"]);
    const somerset = store["MD:Somerset"];
    assert.ok(somerset);
    assert.deepEqual(
      /** @type {{ canonical_provider_slugs?: string[] }} */ (somerset).canonical_provider_slugs,
      ["a-n-electric-coop", "choptank-electric", "delmarva-power"],
    );
    assert.deepEqual(
      unresolved.filter((entry) => entry.county_key === "MD:Somerset"),
      [],
    );
  });

  it("existing polygon provider mappings remain unaffected", () => {
    const report = reconcileTerritoryProviderNames(MD_EIA_NAMES);
    assert.equal(report.totals.resolved, 9);
    assert.equal(report.totals.unresolved, 0);
    assert.equal(reconcileEiaUtilityName("CHOPTANK ELECTRIC COOPERATIVE, INC").provider_slug, "choptank-electric");
    assert.equal(reconcileEiaUtilityName("SOUTHERN MARYLAND ELEC COOP INC").provider_slug, "smeco");
  });

  it("seed dry-run schedules insert for A&N on first run", async () => {
    const existing = UTILITY_PROVIDER_DIRECTORY.filter((entry) => entry.slug !== "a-n-electric-coop").map(
      (entry, idx) => ({
        id: `uuid-${idx}`,
        slug: entry.slug,
        name: entry.display_name,
      }),
    );

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
    const anActions = result.providerActions.filter((a) => a.slug === "a-n-electric-coop");
    assert.equal(anActions.length, 1);
    assert.equal(anActions[0].action, "insert");

    const aliasNormalized = normalizeProviderAlias("A & N Electric Coop");
    assert.ok(result.aliasActions.some((a) => a.alias_normalized === aliasNormalized));
  });

  it("seed dry-run updates A&N without duplicate insert on later runs", async () => {
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
    const anActions = result.providerActions.filter((a) => a.slug === "a-n-electric-coop");
    assert.equal(anActions.length, 1);
    assert.equal(anActions[0].action, "update");
    assert.equal(
      result.providerActions.filter((a) => a.action === "insert" && a.slug === "a-n-electric-coop").length,
      0,
    );
  });

  it("catalog has no duplicate slugs after A&N addition", () => {
    const slugs = UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.ok(UTILITY_PROVIDER_DIRECTORY.some((p) => p.slug === "a-n-electric-coop"));
    assert.equal(
      UTILITY_PROVIDER_DIRECTORY.filter((p) => p.slug === "a-n-electric-coop").length,
      1,
    );
  });
});
