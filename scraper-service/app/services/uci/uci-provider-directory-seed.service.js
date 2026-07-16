"use strict";

const { UTILITY_PROVIDER_DIRECTORY } = require("../../data/utility-provider-directory.catalog.js");
const { expandCatalogAliases } = require("./uci-provider-directory.service.js");
const { normalizeProviderSlug } = require("./uci-provider-directory-normalize.service.js");

/** Columns safe to refresh from directory seed (never overwrite portal secrets/SLA with null). */
const SEED_UPDATE_COLUMNS = [
  "display_name",
  "canonical_name",
  "name",
  "utility_type",
  "ownership_type",
  "cet_relationship",
  "portal_key",
  "directory_source",
  "is_global_template",
  "is_active",
];

/**
 * @param {import("../../data/utility-provider-directory.catalog.js").ProviderCatalogEntry} entry
 */
function buildProviderSeedRow(entry) {
  const slug = normalizeProviderSlug(entry.slug);
  return {
    slug,
    name: entry.display_name,
    display_name: entry.display_name,
    canonical_name: entry.canonical_name,
    utility_type: entry.utility_type,
    ownership_type: entry.ownership_type ?? null,
    cet_relationship: Boolean(entry.cet_relationship),
    portal_key: entry.portal_key ?? slug,
    directory_source:
      entry.directory_source ??
      {
        row: "row3_provider_directory",
        seed: "client_ux_seed_2026_07_15",
        note: "UX seed — not authoritative territory data",
      },
    is_global_template: true,
    tenant_id: null,
    is_active: true,
  };
}

/**
 * Idempotent upsert of global template providers from catalog.
 * Preserves existing UUIDs, portal_url, portal_credentials_ref, SLA, contacts, notes.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]
 */
async function seedUtilityProviderDirectory(supabase, opts = {}) {
  /** @type {Array<{ slug: string, action: string, id?: string }>} */
  const providerActions = [];
  /** @type {Array<{ alias_normalized: string, action: string }>} */
  const aliasActions = [];

  const { data: existingRows, error: fetchErr } = await supabase
    .from("utility_providers")
    .select(
      "id, slug, name, display_name, canonical_name, utility_type, ownership_type, cet_relationship, portal_key, portal_url, portal_credentials_ref, primary_portal_type, sla_acknowledgment_business_days, sla_class_of_service_business_days, sla_ciac_confirmation_business_days, primary_contact, notes, automation_status",
    )
    .is("tenant_id", null)
    .eq("is_global_template", true);

  if (fetchErr) {
    throw Object.assign(new Error(fetchErr.message || "Failed to load providers"), {
      cause: fetchErr,
      code: "PROVIDER_DIRECTORY_SEED_FETCH_FAILED",
    });
  }

  const existingBySlug = new Map(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => [
      String(row.slug).toLowerCase(),
      row,
    ]),
  );

  for (const entry of UTILITY_PROVIDER_DIRECTORY) {
    const seedRow = buildProviderSeedRow(entry);
    const slug = seedRow.slug;
    const existing = existingBySlug.get(slug);

    if (opts.dryRun) {
      providerActions.push({ slug, action: existing ? "update" : "insert", id: existing?.id });
      continue;
    }

    if (existing) {
      const patch = {
        display_name: seedRow.display_name,
        canonical_name: seedRow.canonical_name,
        name: seedRow.name,
        utility_type: seedRow.utility_type,
        ownership_type: seedRow.ownership_type,
        cet_relationship: seedRow.cet_relationship,
        portal_key: seedRow.portal_key,
        directory_source: seedRow.directory_source,
        is_global_template: true,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from("utility_providers")
        .update(patch)
        .eq("id", existing.id);

      if (updateErr) {
        throw Object.assign(new Error(updateErr.message || `Failed to update ${slug}`), {
          cause: updateErr,
          code: "PROVIDER_DIRECTORY_SEED_UPDATE_FAILED",
        });
      }
      providerActions.push({ slug, action: "update", id: String(existing.id) });
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("utility_providers")
        .insert({
          ...seedRow,
          automation_status: "placeholder",
        })
        .select("id, slug")
        .single();

      if (insertErr) {
        throw Object.assign(new Error(insertErr.message || `Failed to insert ${slug}`), {
          cause: insertErr,
          code: "PROVIDER_DIRECTORY_SEED_INSERT_FAILED",
        });
      }
      existingBySlug.set(slug, inserted);
      providerActions.push({ slug, action: "insert", id: String(inserted.id) });
    }
  }

  if (opts.dryRun) {
    for (const entry of UTILITY_PROVIDER_DIRECTORY) {
      for (const alias of expandCatalogAliases(entry)) {
        aliasActions.push({ alias_normalized: alias.alias_normalized, action: "upsert" });
      }
    }
    return { providerActions, aliasActions, dryRun: true };
  }

  const { data: allProviders, error: reloadErr } = await supabase
    .from("utility_providers")
    .select("id, slug")
    .is("tenant_id", null)
    .eq("is_global_template", true);

  if (reloadErr) {
    throw Object.assign(new Error(reloadErr.message || "Failed to reload providers"), {
      cause: reloadErr,
      code: "PROVIDER_DIRECTORY_SEED_RELOAD_FAILED",
    });
  }

  const idBySlug = new Map(
    (Array.isArray(allProviders) ? allProviders : []).map((row) => [
      String(row.slug).toLowerCase(),
      String(row.id),
    ]),
  );

  for (const entry of UTILITY_PROVIDER_DIRECTORY) {
    const slug = normalizeProviderSlug(entry.slug);
    const providerId = idBySlug.get(slug);
    if (!providerId) continue;

    for (const alias of expandCatalogAliases(entry)) {
      const { error: aliasErr } = await supabase.from("utility_provider_aliases").upsert(
        {
          provider_id: providerId,
          alias_display: alias.alias_display,
          alias_normalized: alias.alias_normalized,
          alias_source: alias.alias_source,
        },
        { onConflict: "alias_normalized", ignoreDuplicates: false },
      );

      if (aliasErr) {
        throw Object.assign(new Error(aliasErr.message || `Failed to upsert alias ${alias.alias_normalized}`), {
          cause: aliasErr,
          code: "PROVIDER_DIRECTORY_ALIAS_SEED_FAILED",
        });
      }
      aliasActions.push({ alias_normalized: alias.alias_normalized, action: "upsert" });
    }
  }

  return { providerActions, aliasActions, dryRun: false };
}

module.exports = {
  SEED_UPDATE_COLUMNS,
  buildProviderSeedRow,
  seedUtilityProviderDirectory,
};
