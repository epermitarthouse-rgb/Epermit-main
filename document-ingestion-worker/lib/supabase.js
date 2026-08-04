"use strict";

const dns = require("dns");
const { createClient } = require("@supabase/supabase-js");
const { redactFetchTarget, summarizeFetchError, formatFetchErrorLine } =
  require("./netErrors");

let adminClient = null;
let loggedDnsOrder = false;

/**
 * Prefer IPv4 on Railway — outbound IPv6 is unsupported / often ENETUNREACH.
 */
function preferIpv4Dns() {
  try {
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
      if (!loggedDnsOrder) {
        console.log("[worker] dns result order: ipv4first");
        loggedDnsOrder = true;
      }
    }
  } catch (err) {
    console.warn("[worker] could not set dns result order:", err.message);
  }
}

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

function trimEnv(name) {
  const raw = process.env[name];
  if (raw == null) return "";
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

function createInstrumentedFetch(baseUrl) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const defaultHost = redactFetchTarget(baseUrl).host;

  return async (input, init) => {
    const urlLike =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : baseUrl;

    try {
      const response = await nativeFetch(input, init);
      return response;
    } catch (err) {
      const summary = summarizeFetchError(err, urlLike || baseUrl);
      if (!summary.host) summary.host = defaultHost;
      err.workerFetchSummary = summary;
      throw err;
    }
  };
}

function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  preferIpv4Dns();

  const url = trimEnv("SUPABASE_URL");
  const key = trimEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const { host } = redactFetchTarget(url);
  if (!host || host === "(invalid-url)") {
    throw new Error("SUPABASE_URL is malformed");
  }

  const realtime = getRealtimeOptionsForNode();
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: createInstrumentedFetch(url),
    },
    ...(realtime ? { realtime } : {}),
  };

  adminClient = createClient(url, key, options);
  console.log("[worker] supabase client ready", { host, node: process.version });

  return adminClient;
}

/**
 * One-shot connectivity probe used at startup (no secrets logged).
 */
async function probeSupabaseConnectivity() {
  const url = trimEnv("SUPABASE_URL");
  const key = trimEnv("SUPABASE_SERVICE_ROLE_KEY");
  const { host } = redactFetchTarget(url);
  const target = `${url.replace(/\/$/, "")}/rest/v1/document_ingestion_jobs?select=id&limit=1`;

  console.log("[worker] connectivity probe starting", { host });

  try {
    const res = await fetch(target, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const body = await res.text();
    console.log("[worker] connectivity probe result", {
      host,
      httpStatus: res.status,
      bodyPrefix: body.slice(0, 120),
    });
    return res.ok || res.status === 200 || res.status === 206;
  } catch (err) {
    const summary = summarizeFetchError(err, target);
    console.error("[worker] connectivity probe failed:", formatFetchErrorLine(summary));
    console.error("[worker] connectivity probe detail:", JSON.stringify(summary));
    return false;
  }
}

module.exports = {
  getSupabaseAdmin,
  probeSupabaseConnectivity,
  preferIpv4Dns,
};
