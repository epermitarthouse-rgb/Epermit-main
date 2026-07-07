"use strict";

const { pepcoAdapter } = require("./pepco.adapter.js");
const { genericReadonlyAdapter } = require("./generic-readonly.adapter.js");

/** @type {Map<string, import("./utility-adapter.types.js").UtilityAdapter>} */
const registry = new Map([
  ["pepco", pepcoAdapter],
]);

/**
 * @param {string} providerSlug
 * @returns {{ adapter: import("./utility-adapter.types.js").UtilityAdapter, warnings: string[] }}
 */
function resolveUtilityAdapter(providerSlug) {
  const slug = String(providerSlug || "").trim().toLowerCase();
  if (!slug) {
    return {
      adapter: genericReadonlyAdapter,
      warnings: ["Provider slug missing; using generic read-only adapter."],
    };
  }

  const adapter = registry.get(slug);
  if (adapter) {
    return { adapter, warnings: [] };
  }

  return {
    adapter: genericReadonlyAdapter,
    warnings: [
      `No dedicated adapter registered for provider "${slug}"; portal normalization skipped.`,
    ],
  };
}

module.exports = {
  resolveUtilityAdapter,
  registry,
};
