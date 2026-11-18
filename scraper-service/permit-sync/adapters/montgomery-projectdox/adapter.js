"use strict";

/**
 * Montgomery County MD ProjectDox adapter: the shared ProjectDox adapter logic (dc-projectdox/adapter.js) with
 * the Montgomery normalizer. Sections, failure handling, the report fallback (D-066) and parity checks are the
 * same code as DC; the transport (live-transport.js) supplies Montgomery discovery and reads.
 */

const { createDcAdapter } = require("../dc-projectdox/adapter");
const montgomery = require("./normalize");

function createMontgomeryAdapter({ transport, accountDownload = null }) {
  return createDcAdapter({ transport, accountDownload, normalizer: montgomery });
}

module.exports = { createMontgomeryAdapter, ADAPTER_KEY: montgomery.ADAPTER_KEY };
