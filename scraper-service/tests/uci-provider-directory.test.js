"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  UTILITY_PROVIDER_DIRECTORY,
  AMBIGUOUS_PROVIDER_ALIASES,
} = require("../app/data/utility-provider-directory.catalog.js");
const {
  normalizeProviderAlias,
} = require("../app/services/uci/uci-provider-directory-normalize.service.js");
const {
  resolveProviderAlias,
  sortProvidersForDirectory,
  buildAliasIndex,
  expandCatalogAliases,
} = require("../app/services/uci/uci-provider-directory.service.js");
const {
  buildProviderSeedRow,
  SEED_UPDATE_COLUMNS,
} = require("../app/services/uci/uci-provider-directory-seed.service.js");
const {
  formatProvidersForApiResponse,
  ACTIVE_PROVIDER_COLUMNS,
} = require("../app/services/uci/uci-providers.service.js");

const LEGACY_PRIORITY_SLUGS = [
  "pepco",
  "bge",
  "washington-gas",
  "dominion",
  "fpl",
  "con-edison",
  "pseg",
  "eversource",
  "duke-energy",
  "georgia-power",
];

describe("UCI Row 3 — provider directory audit baseline", () => {
  it("documents pre-Row-3 risks: only 10 global templates, slug/name identity, no alias table", () => {
    const foundationPath = path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      "20260509120000_uci_foundation.sql",
    );
    const sql = fs.readFileSync(foundationPath, "utf8");
    const insertCount = (sql.match(/\('pepco'/g) || []).length;
    assert.ok(insertCount >= 1);
    assert.match(sql, /slug TEXT NOT NULL UNIQUE/);
    assert.doesNotMatch(sql, /utility_provider_aliases/);
    assert.equal(LEGACY_PRIORITY_SLUGS.length, 10);
  });

  it("row 3 canonical migration adds identity columns and alias table", () => {
    const migrationPath = path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      "20260716160000_row3_provider_directory_canonical.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");
    assert.match(sql, /display_name TEXT/);
    assert.match(sql, /canonical_name TEXT/);
    assert.match(sql, /cet_relationship BOOLEAN/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.utility_provider_aliases/);
    assert.match(sql, /alias_normalized TEXT NOT NULL/);
    assert.doesNotMatch(sql, /service_territory\s*=/i);
  });
});

describe("UCI Row 3 — alias normalization and resolution", () => {
  const index = buildAliasIndex();

  it("resolves PEPCO legal name, brand, and abbreviation to pepco", () => {
    for (const alias of ["PEPCO", "Potomac Electric Power Co", "POTOMAC ELECTRIC POWER CO"]) {
      const result = resolveProviderAlias(alias, { index });
      assert.equal(result.status, "found", alias);
      assert.equal(result.slug, "pepco");
    }
  });

  it("resolves Dominion Energy Virginia and Virginia Electric & Power Co to dominion", () => {
    for (const alias of ["Dominion Energy Virginia", "Virginia Electric & Power Co"]) {
      const result = resolveProviderAlias(alias, { index });
      assert.equal(result.status, "found", alias);
      assert.equal(result.slug, "dominion");
    }
  });

  it("resolves AEP Ohio and Ohio Power Co to aep-ohio", () => {
    for (const alias of ["AEP Ohio", "Ohio Power Co", "OHIO POWER CO"]) {
      const result = resolveProviderAlias(alias, { index });
      assert.equal(result.status, "found", alias);
      assert.equal(result.slug, "aep-ohio");
    }
  });

  it("keeps BGE electric and BGE gas as separate typed providers", () => {
    const electric = resolveProviderAlias("BGE", { index });
    const gas = resolveProviderAlias("BGE Gas", { index });
    assert.equal(electric.status, "found");
    assert.equal(electric.slug, "bge");
    const electricEntry = UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "bge");
    const gasEntry = UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "bge-gas");
    assert.equal(electricEntry?.utility_type, "electric");
    assert.equal(gasEntry?.utility_type, "gas");
    assert.equal(gas.status, "found");
    assert.equal(gas.slug, "bge-gas");
  });

  it("returns not_found for unknown aliases instead of guessing", () => {
    const result = resolveProviderAlias("Totally Unknown Utility Co", { index });
    assert.equal(result.status, "not_found");
    assert.equal(result.slug, null);
  });

  it("returns ambiguous for explicitly ambiguous Dominion Energy without qualifier", () => {
    const result = resolveProviderAlias("Dominion Energy", { index });
    assert.equal(result.status, "ambiguous");
    assert.ok(Array.isArray(result.candidate_slugs));
    assert.ok(result.candidate_slugs.length > 1);
    assert.equal(normalizeProviderAlias("Dominion Energy"), "dominion energy");
  });

  it("returns ambiguous for explicitly ambiguous Duke Energy without qualifier", () => {
    const result = resolveProviderAlias("Duke Energy", { index });
    assert.equal(result.status, "ambiguous");
    assert.ok(Array.isArray(result.candidate_slugs));
    assert.ok(result.candidate_slugs.length > 1);
    assert.equal(normalizeProviderAlias("Duke Energy"), "duke energy");
  });

  it("resolves Dominion Energy Virginia to dominion and Duke Energy Carolinas to duke-energy", () => {
    const dominion = resolveProviderAlias("Dominion Energy Virginia", { index });
    assert.equal(dominion.status, "found");
    assert.equal(dominion.slug, "dominion");

    const duke = resolveProviderAlias("Duke Energy Carolinas", { index });
    assert.equal(duke.status, "found");
    assert.equal(duke.slug, "duke-energy");
  });

  it("normalizes punctuation and corporate suffix variation deterministically", () => {
    assert.equal(
      normalizeProviderAlias("Potomac Electric Power Co."),
      normalizeProviderAlias("POTOMAC ELECTRIC POWER CO"),
    );
  });
});

describe("UCI Row 3 — catalog and seed safety", () => {
  it("includes all client-required electric and gas providers as distinct catalog entries", () => {
    const slugs = new Set(UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug));
    const required = [
      "pepco",
      "bge",
      "bge-gas",
      "delmarva-power",
      "potomac-edison",
      "smeco",
      "choptank-electric",
      "dominion",
      "novec",
      "appalachian-power",
      "rappahannock-electric",
      "pseg",
      "jcp-l",
      "atlantic-city-electric",
      "con-edison",
      "national-grid-ny",
      "national-grid-ma",
      "nyseg",
      "orange-and-rockland",
      "pseg-long-island",
      "peco",
      "ppl-electric",
      "duquesne-light",
      "delaware-electric-coop",
      "eversource",
      "united-illuminating",
      "duke-energy",
      "duke-energy-progress",
      "duke-energy-florida",
      "duke-energy-ohio",
      "dominion-energy-nc",
      "dominion-energy-sc",
      "santee-cooper",
      "georgia-power",
      "fpl",
      "tampa-electric",
      "fkec",
      "keys-energy",
      "aep-ohio",
      "wheeling-power",
      "mon-power",
      "alabama-power",
      "entergy-mississippi",
      "mississippi-power",
      "washington-gas",
    ];
    for (const slug of required) {
      assert.ok(slugs.has(slug), `missing catalog slug: ${slug}`);
    }
  });

  it("preserves legacy slugs for the original 10 seeded providers", () => {
    const slugs = new Set(UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug));
    for (const legacy of LEGACY_PRIORITY_SLUGS) {
      assert.ok(slugs.has(legacy), `legacy slug missing: ${legacy}`);
    }
  });

  it("seed row builder marks UX seed provenance and does not include portal secrets", () => {
    const row = buildProviderSeedRow(UTILITY_PROVIDER_DIRECTORY[0]);
    assert.equal(row.slug, "pepco");
    assert.equal(row.directory_source.seed, "client_ux_seed_2026_07_15");
    assert.ok(!("portal_credentials_ref" in row));
    assert.ok(!("portal_url" in row));
  });

  it("seed update columns exclude portal metadata and SLA fields", () => {
    assert.ok(SEED_UPDATE_COLUMNS.includes("display_name"));
    assert.ok(!SEED_UPDATE_COLUMNS.includes("portal_url"));
    assert.ok(!SEED_UPDATE_COLUMNS.includes("portal_credentials_ref"));
    assert.ok(!SEED_UPDATE_COLUMNS.includes("sla_acknowledgment_business_days"));
  });

  it("expandCatalogAliases deduplicates normalized aliases per provider", () => {
    const aliases = expandCatalogAliases(
      UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "pepco"),
    );
    const normalized = aliases.map((a) => a.alias_normalized);
    assert.equal(new Set(normalized).size, normalized.length);
    assert.ok(normalized.includes(normalizeProviderAlias("PEPCO")));
  });

  it("catalog alias expansion excludes broad Dominion Energy and Duke Energy seed aliases", () => {
    const dominion = UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "dominion");
    const duke = UTILITY_PROVIDER_DIRECTORY.find((p) => p.slug === "duke-energy");
    assert.ok(dominion);
    assert.ok(duke);
    assert.ok(!dominion.aliases.includes("Dominion Energy"));
    assert.ok(!duke.aliases.includes("Duke Energy"));

    const dominionExpanded = expandCatalogAliases(dominion).map((a) => a.alias_normalized);
    const dukeExpanded = expandCatalogAliases(duke).map((a) => a.alias_normalized);
    assert.ok(!dominionExpanded.includes("dominion energy"));
    assert.ok(!dukeExpanded.includes("duke energy"));
  });

  it("ambiguous alias registry retains dominion energy and duke energy as explicit ambiguous inputs", () => {
    const normalizedAmbiguous = AMBIGUOUS_PROVIDER_ALIASES.map((entry) =>
      normalizeProviderAlias(entry.alias),
    );
    assert.ok(normalizedAmbiguous.includes("dominion energy"));
    assert.ok(normalizedAmbiguous.includes("duke energy"));

    assert.equal(resolveProviderAlias("dominion energy", { index: buildAliasIndex() }).status, "ambiguous");
    assert.equal(resolveProviderAlias("duke energy", { index: buildAliasIndex() }).status, "ambiguous");
  });

  it("catalog has no duplicate slugs", () => {
    const slugs = UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("ambiguous alias registry matches catalog slugs", () => {
    const slugs = new Set(UTILITY_PROVIDER_DIRECTORY.map((p) => p.slug));
    for (const entry of AMBIGUOUS_PROVIDER_ALIASES) {
      for (const candidate of entry.candidate_slugs) {
        assert.ok(slugs.has(candidate), `${entry.alias} candidate missing: ${candidate}`);
      }
    }
  });
});

describe("UCI Row 3 — API presentation", () => {
  it("sorts CET relationship providers first, then display name", () => {
    const sorted = sortProvidersForDirectory([
      { slug: "z-co", display_name: "Z Utility", cet_relationship: false, utility_type: "electric" },
      { slug: "a-co", display_name: "A Utility", cet_relationship: true, utility_type: "electric" },
      { slug: "m-co", display_name: "M Utility", cet_relationship: true, utility_type: "electric" },
    ]);
    assert.equal(sorted[0].slug, "a-co");
    assert.equal(sorted[1].slug, "m-co");
    assert.equal(sorted[2].slug, "z-co");
  });

  it("filters providers by utility type for dropdown responses", () => {
    const rows = formatProvidersForApiResponse(
      [
        { slug: "bge", display_name: "BGE", utility_type: "electric" },
        { slug: "bge-gas", display_name: "BGE Gas", utility_type: "gas" },
      ],
      "gas",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].slug, "bge-gas");
    assert.equal(rows[0].label, "BGE Gas");
  });

  it("provider API columns expose directory fields but not credential secrets", () => {
    assert.match(ACTIVE_PROVIDER_COLUMNS, /display_name/);
    assert.match(ACTIVE_PROVIDER_COLUMNS, /cet_relationship/);
    assert.match(ACTIVE_PROVIDER_COLUMNS, /portal_key/);
    assert.doesNotMatch(ACTIVE_PROVIDER_COLUMNS, /portal_credentials_ref/);
  });
});

describe("UCI Row 3 — idempotent seed (mocked)", () => {
  it("seed dry-run updates existing slugs without inserting duplicates", async () => {
    const existing = LEGACY_PRIORITY_SLUGS.map((slug, idx) => ({
      id: `uuid-${idx}`,
      slug,
      name: slug,
      portal_url: slug === "pepco" ? "https://secure.pepco.com/service-installation-upgrades-portal/" : null,
      portal_credentials_ref: slug,
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
            update() {
              return {
                eq() {
                  return Promise.resolve({ error: null });
                },
              };
            },
            insert() {
              throw new Error("insert should not run in dry-run with full legacy set");
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const { seedUtilityProviderDirectory } = require("../app/services/uci/uci-provider-directory-seed.service.js");
    const result = await seedUtilityProviderDirectory(supabase, { dryRun: true });
    const legacyUpdates = result.providerActions.filter((a) => LEGACY_PRIORITY_SLUGS.includes(a.slug));
    assert.equal(legacyUpdates.length, LEGACY_PRIORITY_SLUGS.length);
    assert.ok(legacyUpdates.every((a) => a.action === "update"));
  });

  it("seed dry-run does not schedule upsert for broad dominion energy or duke energy aliases", async () => {
    const existing = LEGACY_PRIORITY_SLUGS.map((slug, idx) => ({
      id: `uuid-${idx}`,
      slug,
      name: slug,
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

    const { seedUtilityProviderDirectory } = require("../app/services/uci/uci-provider-directory-seed.service.js");
    const result = await seedUtilityProviderDirectory(supabase, { dryRun: true });
    const normalizedAliases = result.aliasActions.map((a) => a.alias_normalized);
    assert.ok(!normalizedAliases.includes("dominion energy"));
    assert.ok(!normalizedAliases.includes("duke energy"));
  });

  it("seed update preserves existing portal_url and UUID for PEPCO", async () => {
    const pepcoId = "pepco-uuid-stable";
    const pepcoPortalUrl = "https://secure.pepco.com/service-installation-upgrades-portal/";
    let pepcoUpdatePayload = null;

    /** @type {Map<string, { id: string, slug: string }>} */
    const providerStore = new Map([
      [
        "pepco",
        {
          id: pepcoId,
          slug: "pepco",
          name: "PEPCO",
          portal_url: pepcoPortalUrl,
          portal_credentials_ref: "PEPCO",
          sla_acknowledgment_business_days: 5,
        },
      ],
    ]);

    const supabase = {
      from(table) {
        if (table === "utility_providers") {
          return {
            select() {
              return {
                is() {
                  return {
                    eq() {
                      return Promise.resolve({
                        data: [...providerStore.values()],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(col, val) {
                  if (val === pepcoId) pepcoUpdatePayload = payload;
                  return Promise.resolve({ error: null });
                },
              };
            },
            insert(row) {
              const slug = String(row.slug).toLowerCase();
              const id = `id-${slug}`;
              providerStore.set(slug, { id, slug, ...row });
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({
                        data: { id, slug },
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "utility_provider_aliases") {
          return {
            upsert() {
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const { seedUtilityProviderDirectory } = require("../app/services/uci/uci-provider-directory-seed.service.js");
    const result = await seedUtilityProviderDirectory(supabase, { dryRun: false });
    const pepcoAction = result.providerActions.find((a) => a.slug === "pepco");
    assert.equal(pepcoAction?.action, "update");
    assert.equal(pepcoAction?.id, pepcoId);
    assert.ok(pepcoUpdatePayload);
    assert.ok(!("portal_url" in pepcoUpdatePayload));
    assert.ok(!("portal_credentials_ref" in pepcoUpdatePayload));
    assert.ok(!("sla_acknowledgment_business_days" in pepcoUpdatePayload));
    assert.equal(providerStore.get("pepco")?.id, pepcoId);
  });
});

describe("UCI Row 3 — PEPCO credential compatibility", () => {
  const { resolveProviderAlias } = require("../app/services/uci/uci-provider-directory.service.js");

  it("matches PEPCO portal credential labels via alias resolver", () => {
    for (const label of ["PEPCO", "pepco", "Potomac Electric Power Co"]) {
      const result = resolveProviderAlias(label);
      assert.equal(result.status, "found", label);
      assert.equal(result.slug, "pepco");
    }
  });
});

describe("UCI Row 3 — tenant isolation and coordination slug stability", () => {
  const {
    getActiveProvidersBySlugsForTenant,
  } = require("../app/services/uci/uci-providers-tenant.service.js");

  it("tenant provider resolution uses slug and excludes other-tenant custom rows", async () => {
    const tenantA = "tenant-a";
    const globalPepco = {
      id: "global-pepco",
      slug: "pepco",
      name: "PEPCO",
      display_name: "PEPCO",
      utility_type: "electric",
      is_active: true,
      is_global_template: true,
    };
    const tenantOnly = {
      id: "tenant-b-custom",
      slug: "tenant-b-only",
      name: "Tenant B Only",
      display_name: "Tenant B Only",
      utility_type: "electric",
      is_active: true,
      is_global_template: false,
    };

    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      or(filter) {
                        assert.match(filter, /tenant-a/);
                        return Promise.resolve({
                          data: [globalPepco],
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const { providers, missingSlugs } = await getActiveProvidersBySlugsForTenant(
      supabase,
      tenantA,
      ["pepco", "tenant-b-only"],
    );
    assert.equal(providers.length, 1);
    assert.equal(providers[0].slug, "pepco");
    assert.deepEqual(missingSlugs, ["tenant-b-only"]);
    assert.ok(!providers.some((p) => p.id === tenantOnly.id));
  });

  it("coordination init slugs remain stable after directory reconciliation", () => {
    for (const legacy of LEGACY_PRIORITY_SLUGS) {
      const result = resolveProviderAlias(legacy, { index: buildAliasIndex() });
      assert.equal(result.status, "found", legacy);
      assert.equal(result.slug, legacy);
    }
  });
});
