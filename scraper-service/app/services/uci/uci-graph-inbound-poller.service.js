"use strict";

/**
 * Background Microsoft Graph inbound mailbox poller for UCI.
 * Polls all connected microsoft_mailbox_connections on a fixed cadence and
 * runs the existing idempotent ingest pipeline (attachments → classify → Stage 6).
 *
 * This is the application-owned automatic path — not Cursor/manual HTTP poll.
 */

const crypto = require("crypto");
const {
  pollGraphInboundForUser,
} = require("./uci-graph-inbound.service.js");
const {
  markMailboxConnectionError,
} = require("../microsoft/microsoft-graph-auth.service.js");

const DEFAULT_INTERVAL_MS = 45_000;
const GRAPH_INBOUND_POLL_INTERVAL_MS = Number(
  process.env.UCI_GRAPH_INBOUND_POLL_MS || DEFAULT_INTERVAL_MS,
);
/** Default ON — product must ingest mail without manual poll. Set to "false" to disable. */
const POLLER_ENABLED = process.env.UCI_GRAPH_INBOUND_POLLER_ENABLED !== "false";
const LOOKBACK_HOURS = Math.min(
  Math.max(Number(process.env.UCI_GRAPH_INBOUND_LOOKBACK_HOURS || 48), 1),
  168,
);
const TOP_PER_MAILBOX = Math.min(
  Math.max(Number(process.env.UCI_GRAPH_INBOUND_TOP || 25), 5),
  50,
);

function newPollerId() {
  return `graph-inbound-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * List connected mailboxes eligible for Graph inbound polling.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function listConnectedMailboxesForInboundPoll(supabase) {
  const { data, error } = await supabase
    .from("microsoft_mailbox_connections")
    .select("user_id, mailbox_email, status, last_checked_at, last_error")
    .eq("status", "connected")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(50);

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to list mailbox connections"), {
      cause: error,
      code: "MAILBOX_LIST_FAILED",
    });
  }
  return Array.isArray(data) ? data : [];
}

/**
 * One poll cycle across all connected mailboxes.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [opts]
 */
async function runGraphInboundPollCycle(supabase, opts = {}) {
  const pollerId = opts.pollerId || "graph-inbound-cycle";
  const receivedAfterIso =
    opts.receivedAfterIso ||
    new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const top = opts.top != null ? Number(opts.top) : TOP_PER_MAILBOX;
  const pollFn =
    typeof opts.pollGraphInboundForUser === "function"
      ? opts.pollGraphInboundForUser
      : pollGraphInboundForUser;

  const mailboxes = await listConnectedMailboxesForInboundPoll(supabase);
  /** @type {Array<Record<string, unknown>>} */
  const results = [];

  for (const row of mailboxes) {
    const userId = row.user_id != null ? String(row.user_id) : "";
    if (!userId) continue;
    const started = Date.now();
    try {
      const poll = await pollFn(supabase, {
        userId,
        top,
        receivedAfterIso,
        deps: opts.deps || {},
      });
      results.push({
        user_id: userId,
        mailbox_email: row.mailbox_email || null,
        ok: true,
        polled: poll.polled ?? null,
        matched: poll.matched ?? null,
        unmatched: poll.unmatched ?? null,
        ingested: poll.ingested ?? null,
        inserted: Array.isArray(poll.results)
          ? poll.results.filter((r) => r && r.inserted === true).length
          : null,
        duration_ms: Date.now() - started,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[UCI][GraphInbound] poll failed user=${userId} mailbox=${row.mailbox_email || "?"} err=${message}`,
      );
      try {
        await markMailboxConnectionError(supabase, userId, message);
      } catch {
        // non-fatal
      }
      results.push({
        user_id: userId,
        mailbox_email: row.mailbox_email || null,
        ok: false,
        error: message,
        duration_ms: Date.now() - started,
      });
    }
  }

  const summary = {
    poller_id: pollerId,
    mailbox_count: mailboxes.length,
    ok_count: results.filter((r) => r.ok).length,
    error_count: results.filter((r) => !r.ok).length,
    inserted_total: results.reduce(
      (n, r) => n + (typeof r.inserted === "number" ? r.inserted : 0),
      0,
    ),
    results,
    at: new Date().toISOString(),
  };

  if (mailboxes.length > 0) {
    console.log(
      `[UCI][GraphInbound] cycle mailboxes=${summary.mailbox_count} ok=${summary.ok_count} errors=${summary.error_count} inserted=${summary.inserted_total}`,
    );
  }

  return summary;
}

/**
 * Start background Graph inbound poller (local scraper + Railway).
 *
 * @param {object} deps
 * @param {import("@supabase/supabase-js").SupabaseClient} deps.supabase
 */
function startUciGraphInboundPoller(deps) {
  if (!POLLER_ENABLED) {
    console.log(
      "[dev-worker][UCI][GraphInbound] background poller disabled (UCI_GRAPH_INBOUND_POLLER_ENABLED=false)",
    );
    return { stop: () => {}, pollerId: null, intervalMs: GRAPH_INBOUND_POLL_INTERVAL_MS };
  }

  const pollerId = newPollerId();
  let stopped = false;
  let inFlight = false;
  const intervalMs = Number.isFinite(GRAPH_INBOUND_POLL_INTERVAL_MS)
    ? Math.max(15_000, GRAPH_INBOUND_POLL_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;

  console.log(
    `[dev-worker][UCI][GraphInbound] background poller starting pollerId=${pollerId} intervalMs=${intervalMs}`,
  );

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await runGraphInboundPollCycle(deps.supabase, { pollerId });
    } catch (err) {
      console.warn(
        `[UCI][GraphInbound] cycle error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      inFlight = false;
    }
  };

  // Delay first tick slightly so server bind completes; then run on cadence.
  const initial = setTimeout(() => {
    void tick();
  }, 5_000);
  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    pollerId,
    intervalMs,
    stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
      console.log(
        `[dev-worker][UCI][GraphInbound] background poller stopped pollerId=${pollerId}`,
      );
    },
  };
}

module.exports = {
  POLLER_ENABLED,
  GRAPH_INBOUND_POLL_INTERVAL_MS,
  listConnectedMailboxesForInboundPoll,
  runGraphInboundPollCycle,
  startUciGraphInboundPoller,
};
