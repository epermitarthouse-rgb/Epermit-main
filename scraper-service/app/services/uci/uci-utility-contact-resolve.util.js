"use strict";

/**
 * Resolve utility contact email from a single inbound communication (Stage 5 ack reconciliation).
 *
 * @param {Record<string, unknown> | null | undefined} communication
 * @param {{ allowTestDomains?: boolean }} [opts]
 */
function resolveTrustedEmailFromCommunication(communication, opts = {}) {
  if (!communication) return null;
  const { resolveUtilityContactFromCommunications } = require("./uci-utility-contact.service.js");
  const derived = resolveUtilityContactFromCommunications([communication], opts);
  return derived.email || null;
}

module.exports = {
  resolveTrustedEmailFromCommunication,
};
