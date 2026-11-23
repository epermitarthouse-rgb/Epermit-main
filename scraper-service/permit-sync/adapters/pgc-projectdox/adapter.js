"use strict";

/**
 * Prince George's County ePlan adapter: the shared ProjectDox adapter (dc-projectdox/adapter.js) with the
 * PGC normalizer. Discovery, login and the WebUI session come from the manual scraper through the transport.
 */

const { createDcAdapter } = require("../dc-projectdox/adapter");
const pgc = require("./normalize");

function createPgcAdapter({ transport, accountDownload = null }) {
  return createDcAdapter({ transport, accountDownload, normalizer: pgc });
}

module.exports = { createPgcAdapter, ADAPTER_KEY: pgc.ADAPTER_KEY };
