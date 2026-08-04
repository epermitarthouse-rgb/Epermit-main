"use strict";

const { createClient } = require("@supabase/supabase-js");

let adminClient = null;

/**
 * Node.js < 22 has no native WebSocket. supabase-js always constructs a Realtime
 * client, so provide the `ws` transport when needed. The worker only uses REST +
 * Storage; Realtime is never subscribed to.
 */
function getRealtimeOptionsForNode() {
  if (typeof WebSocket !== "undefined") {
    return undefined;
  }

  const nodeVersion = process.versions?.node;
  if (!nodeVersion) {
    return undefined;
  }

  const major = parseInt(nodeVersion.replace(/^v/, "").split(".")[0], 10);
  if (!Number.isNaN(major) && major >= 22) {
    return undefined;
  }

  // eslint-disable-next-line global-require
  const WebSocketTransport = require("ws");
  return { transport: WebSocketTransport };
}

function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const realtime = getRealtimeOptionsForNode();
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(realtime ? { realtime } : {}),
  };

  adminClient = createClient(url, key, options);

  return adminClient;
}

module.exports = { getSupabaseAdmin };
