"use strict";

/**
 * PGC deep driver. Files and report exports use the same contract as Montgomery (deep/montgomery-driver.js):
 * the runner calls scrapeAll, and the transport supplies fetchFile and exportReport. Login, dashboard
 * discovery and the SSO hop stay in the PGC transport, which calls the manual scraper.
 */

const { createMontgomeryDeepDriver } = require("./montgomery-driver");
const { PGC } = require("../adapters/projectdox-tenants");

function createPgcDeepDriver(opts) {
  const inner = createMontgomeryDeepDriver({ ...opts, tenant: PGC });
  return {
    ...inner,
    DEFAULT_DASHBOARD_URL: `${PGC.portalOrigin}/Portal/Home/Index`,
    deriveWebUiBase: () => `${PGC.uiOrigin}${PGC.uiBasePath}`,
    async syncPortalDataToSupabase() {
      throw new Error("PGC linked-project portal_data sync is not available (project linking is not approved)");
    },
  };
}

module.exports = { createPgcDeepDriver };
