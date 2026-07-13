"use strict";

/** @type {import("./utility-adapter.types.js").UtilityAdapter} */
const genericReadonlyAdapter = {
  providerSlug: "generic",

  normalizeApplication() {
    return null;
  },

  normalizeMessages() {
    return [];
  },

  normalizeStatusEvents() {
    return [];
  },

  getExternalApplicationId() {
    return null;
  },

  getExternalJobId() {
    return null;
  },

  mapPortalStatusToLifecycle() {
    return null;
  },
};

module.exports = {
  genericReadonlyAdapter,
};
