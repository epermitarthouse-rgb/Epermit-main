"use strict";

const dns = require("dns");
const { createClient } = require("@supabase/supabase-js");
const { redactFetchTarget, summarizeFetchError } = require("./netErrors");

let adminClient = null;

function preferIpv4Dns() {
  try {
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
    }
  } catch {
    /* ignore */
  }
}

function getRealtimeOptionsForNode() {
  if (typeof WebSocket !== "undefined") return undefined;
  const major = parseInt(String(process.versions?.node || "0").split(".")[0], 10);
  if (major >= 22) return undefined;
  return { transport: require("ws") };
}

function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  preferIpv4Dns();
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(getRealtimeOptionsForNode() ? { realtime: getRealtimeOptionsForNode() } : {}),
  });
  return adminClient;
}

module.exports = { getSupabaseAdmin, preferIpv4Dns };
