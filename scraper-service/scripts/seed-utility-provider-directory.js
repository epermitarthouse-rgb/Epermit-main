#!/usr/bin/env node
"use strict";

/**
 * Idempotent Row 3 provider directory seed (global templates + aliases).
 * Usage: node scripts/seed-utility-provider-directory.js [--dry-run]
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const {
  seedUtilityProviderDirectory,
} = require("../app/services/uci/uci-provider-directory-seed.service.js");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const result = await seedUtilityProviderDirectory(supabase, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
