#!/usr/bin/env node
"use strict";

/**
 * Reconcile EIA legal names against Row 3 canonical alias resolver.
 * stdin: JSON array of legal names
 * stdout: { resolved, ambiguous, unresolved, unsupported_manual, totals }
 */

const {
  reconcileTerritoryProviderNames,
} = require("../app/services/uci/territory/territory-provider-reconciliation.service.js");

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  const names = raw ? JSON.parse(raw) : [];
  const report = reconcileTerritoryProviderNames(names);
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
