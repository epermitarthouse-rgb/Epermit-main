"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MATCHER_METADATA_KEYS,
  MATCHER_RECORD_SELECT,
  MATCHER_APPLICATION_SELECT,
  scoreMatch,
  matchInboundToCoordination,
} = require("../app/services/uci/uci-communication-matcher.service.js");
const {
  ingestInboundEmailMessage,
  pollGraphInboundForUser,
  reprocessUnmatchedInboundMessage,
  shouldRematchUnmatched,
  EXISTING_COMM_SELECT,
  OUTBOUND_ECHO_SELECT,
} = require("../app/services/uci/uci-graph-inbound.service.js");
const {
  claimMailboxLeaseInStore,
  releaseMailboxLeaseInStore,
  computeGraphReceivedAfter,
  computeNextWatermark,
  DEFAULT_SKEW_MS,
  claimMailboxLease,
  claimedMailboxRow,
} = require("../app/services/uci/uci-graph-inbound-mailbox-state.service.js");

function createEgressMock(tables) {
  return {
    from(table) {
      const store = tables[table] || (tables[table] = []);
      /** @type {Array<{ column: string, value: unknown, op?: string }>} */
      const filters = [];
      const state = {
        mode: "select",
        updatePatch: null,
        insertRow: null,
        limit: null,
      };

      const applyFilters = () =>
        store.filter((row) =>
          filters.every((f) => {
            const actual = row[f.column];
            if (f.op === "in") {
              return /** @type {unknown[]} */ (f.value).map(String).includes(String(actual));
            }
            if (f.op === "lte") {
              return actual != null && new Date(String(actual)).getTime() <= new Date(String(f.value)).getTime();
            }
            if (f.op === "lt") {
              return actual != null && new Date(String(actual)).getTime() < new Date(String(f.value)).getTime();
            }
            if (f.op === "gt") {
              return actual != null && new Date(String(actual)).getTime() > new Date(String(f.value)).getTime();
            }
            return String(actual ?? "") === String(f.value ?? "");
          }),
        );

      const api = {
        select() {
          return api;
        },
        insert(row) {
          state.mode = "insert";
          state.insertRow = Array.isArray(row) ? row[0] : row;
          return api;
        },
        update(patch) {
          state.mode = "update";
          state.updatePatch = patch;
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        in(column, values) {
          filters.push({ column, value: values, op: "in" });
          return api;
        },
        lte(column, value) {
          filters.push({ column, value, op: "lte" });
          return api;
        },
        lt(column, value) {
          filters.push({ column, value, op: "lt" });
          return api;
        },
        gt(column, value) {
          filters.push({ column, value, op: "gt" });
          return api;
        },
        filter() {
          return api;
        },
        order() {
          return api;
        },
        limit(n) {
          state.limit = n;
          return api;
        },
        maybeSingle() {
          if (state.mode === "insert" && state.insertRow) {
            const row = { id: state.insertRow.id || `id-${store.length + 1}`, ...state.insertRow };
            store.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          let rows = applyFilters();
          if (state.mode === "update" && state.updatePatch) {
            for (const row of rows) Object.assign(row, state.updatePatch);
          }
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        single() {
          return api.maybeSingle().then((r) => {
            if (!r.data) return { data: null, error: { message: "not found" } };
            return r;
          });
        },
        then(resolve, reject) {
          if (state.mode === "insert" && state.insertRow) {
            const row = { id: state.insertRow.id || `id-${store.length + 1}`, ...state.insertRow };
            store.push(row);
            return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
          }
          let rows = applyFilters();
          if (state.mode === "update" && state.updatePatch) {
            for (const row of rows) Object.assign(row, state.updatePatch);
          }
          if (state.limit != null) rows = rows.slice(0, state.limit);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function matchingCandidateTables() {
  return {
    coordination_records: [
      {
        id: "coord-1",
        project_id: "proj-1",
        utility_provider_id: "prov-1",
        utility_account_number: "A-99",
        utility_contact_email: "pm@pepco.com",
        metadata: {
          project_address: "100 Main Street Highland Springs",
          lc_number: "451554",
          load_control_number: "451554",
          job_id: "JOB-1",
          stage_5_acknowledgment: { utility_contact_email: "pm@pepco.com" },
          unused_blob: "x".repeat(5000),
        },
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    coordination_applications: [
      {
        id: "app-1",
        coordination_record_id: "coord-1",
        utility_ticket_number: "WO-12345",
        external_application_id: "EXT-1",
        provider_slug: "pepco",
        agent_draft_metadata: { huge: "y".repeat(5000) },
      },
    ],
    utility_providers: [{ id: "prov-1", slug: "pepco" }],
    coordination_communications: [
      {
        id: "out-1",
        coordination_record_id: "coord-1",
        direction: "outbound",
        thread_id: "conv-1",
        raw_subject: "Utility Coordination Application Package — 100 Main Street - LC 451554",
        message_timestamp: "2026-09-01T00:00:00.000Z",
      },
    ],
    uci_unmatched_inbound_messages: [],
  };
}

describe("UCI Graph inbound egress — matcher field contract", () => {
  it("selects every metadata field matching uses and omits agent_draft_metadata", () => {
    for (const key of MATCHER_METADATA_KEYS) {
      if (key === "LC") {
        assert.match(MATCHER_RECORD_SELECT, /metadata->LC/);
      } else {
        assert.match(MATCHER_RECORD_SELECT, new RegExp(`metadata->${key}`));
      }
    }
    assert.doesNotMatch(MATCHER_RECORD_SELECT, /(?<![\w>])metadata(?!-)/);
    assert.doesNotMatch(MATCHER_APPLICATION_SELECT, /agent_draft_metadata/);
    assert.doesNotMatch(EXISTING_COMM_SELECT, /\*/);
    assert.doesNotMatch(OUTBOUND_ECHO_SELECT, /\*/);
  });

  it("keeps matching output unchanged for new messages with slim vs full metadata", async () => {
    const inbound = {
      raw_subject: "RE: Ticket WO-12345 LC 451554",
      raw_body: "100 Main Street Highland Springs account A-99",
      sender: "pm@pepco.com",
      thread_id: "conv-1",
      provider_slug: "pepco",
      message_timestamp: "2026-09-02T00:00:00.000Z",
    };
    const tables = matchingCandidateTables();
    const full = await matchInboundToCoordination(createEgressMock(tables), inbound, {
      projectId: "proj-1",
    });
    const slimTables = structuredClone(tables);
    slimTables.coordination_records[0].metadata = {
      project_address: "100 Main Street Highland Springs",
      lc_number: "451554",
      load_control_number: "451554",
      job_id: "JOB-1",
      stage_5_acknowledgment: { utility_contact_email: "pm@pepco.com" },
    };
    delete slimTables.coordination_applications[0].agent_draft_metadata;
    const slim = await matchInboundToCoordination(createEgressMock(slimTables), inbound, {
      projectId: "proj-1",
    });
    assert.equal(full.matched, true);
    assert.deepEqual(slim, full);
    const scored = scoreMatch(inbound, {
      utility_ticket_number: "WO-12345",
      utility_account_number: "A-99",
      utility_contact_email: "pm@pepco.com",
      thread_id: "conv-1",
      provider_slug: "pepco",
      project_address: "100 Main Street Highland Springs",
      lc_number: "451554",
      outbound_subject: tables.coordination_communications[0].raw_subject,
    });
    assert.ok(scored.score >= 25);
  });
});

describe("UCI Graph inbound egress — early duplicate detection", () => {
  it("does not call the matcher for previously processed messages", async () => {
    let matcherCalls = 0;
    const tables = {
      coordination_communications: [
        {
          id: "in-1",
          coordination_record_id: "coord-1",
          direction: "inbound",
          idempotency_key: "graph:already",
          classification: "acknowledgment",
        },
      ],
      uci_unmatched_inbound_messages: [],
    };
    const result = await ingestInboundEmailMessage(createEgressMock(tables), {
      normalized: {
        idempotency_key: "graph:already",
        external_message_id: "m-already",
        raw_subject: "hello",
        raw_body: "body",
        sender: "pm@pepco.com",
        message_timestamp: new Date().toISOString(),
      },
      deps: {
        matchInboundToCoordination: async () => {
          matcherCalls += 1;
          throw new Error("matcher should not run");
        },
      },
    });
    assert.equal(result.status, "skipped_duplicate");
    assert.equal(result.skipped_reason, "already_matched");
    assert.equal(matcherCalls, 0);
  });

  it("does not rematch existing unmatched messages every cycle", async () => {
    let matcherCalls = 0;
    const tables = {
      coordination_communications: [],
      uci_unmatched_inbound_messages: [
        {
          id: "um-1",
          idempotency_key: "graph:um",
          match_status: "unmatched",
          last_match_attempted_at: "2026-09-09T00:00:00.000Z",
          next_rematch_at: "2026-09-10T12:00:00.000Z",
          updated_at: "2026-09-09T00:00:00.000Z",
        },
      ],
    };
    const result = await ingestInboundEmailMessage(createEgressMock(tables), {
      normalized: {
        idempotency_key: "graph:um",
        external_message_id: "m-um",
        raw_subject: "hello",
        raw_body: "body",
        sender: "pm@pepco.com",
        message_timestamp: "2026-09-09T01:00:00.000Z",
      },
      deps: {
        nowMs: Date.parse("2026-09-09T02:00:00.000Z"),
        matchInboundToCoordination: async () => {
          matcherCalls += 1;
          return { matched: false, unmatched: true, candidates: [] };
        },
      },
    });
    assert.equal(result.status, "skipped_unmatched");
    assert.equal(result.skipped_reason, "backoff_pending");
    assert.equal(matcherCalls, 0);
  });

  it("still rematches unmatched on manual retry, data change, or backoff", async () => {
    const inbound = {
      idempotency_key: "graph:retry",
      external_message_id: "m-retry",
      raw_subject: "RE: Ticket WO-12345",
      raw_body: "update",
      sender: "pm@pepco.com",
      thread_id: "conv-1",
      message_timestamp: "2026-09-09T03:00:00.000Z",
    };

    const manualTables = {
      ...matchingCandidateTables(),
      uci_unmatched_inbound_messages: [
        {
          id: "um-retry",
          idempotency_key: "graph:retry",
          match_status: "unmatched",
          project_id: "proj-1",
          last_match_attempted_at: "2026-09-09T00:00:00.000Z",
          next_rematch_at: "2026-09-10T12:00:00.000Z",
        },
      ],
    };
    let matcherCalls = 0;
    const manual = await ingestInboundEmailMessage(createEgressMock(manualTables), {
      normalized: inbound,
      projectId: "proj-1",
      forceRematch: true,
      deps: {
        matchInboundToCoordination: async (...args) => {
          matcherCalls += 1;
          return matchInboundToCoordination(...args);
        },
      },
    });
    assert.equal(manual.status, "matched");
    assert.ok(matcherCalls >= 1);

    assert.equal(
      shouldRematchUnmatched(
        {
          match_status: "unmatched",
          last_match_attempted_at: "2026-09-09T00:00:00.000Z",
          next_rematch_at: "2026-09-10T12:00:00.000Z",
        },
        { latestCoordinationUpdatedAt: "2026-09-09T04:00:00.000Z" },
      ).reason,
      "data_change",
    );
    assert.equal(
      shouldRematchUnmatched(
        {
          match_status: "unmatched",
          last_match_attempted_at: "2026-09-09T00:00:00.000Z",
          next_rematch_at: "2026-09-09T01:00:00.000Z",
        },
        { nowMs: Date.parse("2026-09-09T02:00:00.000Z") },
      ).reason,
      "backoff",
    );

    const tables = matchingCandidateTables();
    tables.uci_unmatched_inbound_messages = [
      {
        id: "um-manual",
        idempotency_key: "graph:manual",
        match_status: "unmatched",
        project_id: "proj-1",
        raw_subject: inbound.raw_subject,
        raw_body: inbound.raw_body,
        sender: inbound.sender,
        conversation_id: inbound.thread_id,
        last_match_attempted_at: "2026-09-09T00:00:00.000Z",
        next_rematch_at: "2026-09-10T12:00:00.000Z",
      },
    ];
    const reprocessed = await reprocessUnmatchedInboundMessage(createEgressMock(tables), {
      unmatchedId: "um-manual",
      projectId: "proj-1",
    });
    assert.equal(reprocessed.status, "matched");
  });
});

describe("UCI Graph inbound egress — cursor and lease", () => {
  it("does not miss messages after a partial ingest failure", async () => {
    const watermark = { value: "2026-09-09T10:00:00.000Z" };
    const ingested = [];
    const store = new Map();
    store.set("user-1", {
      user_id: "user-1",
      watermark_received_at: watermark.value,
      lease_owner: null,
      lease_expires_at: null,
    });

    const messages = [
      { id: "m1", receivedDateTime: "2026-09-09T10:01:00.000Z", subject: "one", internetMessageId: "<1>" },
      { id: "m2", receivedDateTime: "2026-09-09T10:02:00.000Z", subject: "two", internetMessageId: "<2>" },
      { id: "m3", receivedDateTime: "2026-09-09T10:03:00.000Z", subject: "three", internetMessageId: "<3>" },
    ];

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: messages }),
    });

    let failSecond = true;
    const ingestFn = async (_sb, params) => {
      const id = params.normalized.external_message_id;
      if (failSecond && id === "m2") {
        throw new Error("transient ingest failure");
      }
      ingested.push(id);
      return { status: "matched", inserted: true };
    };

    const first = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      useCursor: true,
      deps: {
        getAccessTokenFn: async () => "token",
        fetchFn,
        ingestInboundEmailMessage: ingestFn,
        claimMailboxLeaseFn: async (_sb, args) => ({
          claimed: true,
          fallback: false,
          row: claimMailboxLeaseInStore(store, args),
        }),
        releaseMailboxLeaseFn: async (_sb, args) => {
          const released = releaseMailboxLeaseInStore(store, args);
          watermark.value = released.watermark_received_at;
          return { released: true, row: released };
        },
      },
    });

    assert.equal(first.had_failure, true);
    assert.deepEqual(ingested, ["m1"]);
    assert.equal(watermark.value, "2026-09-09T10:01:00.000Z");
    assert.ok(
      new Date(computeGraphReceivedAfter({ watermarkReceivedAt: watermark.value })).getTime() <=
        Date.parse("2026-09-09T10:01:00.000Z"),
    );

    failSecond = false;
    ingested.length = 0;
    const second = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      useCursor: true,
      deps: {
        getAccessTokenFn: async () => "token",
        fetchFn,
        ingestInboundEmailMessage: ingestFn,
        claimMailboxLeaseFn: async (_sb, args) => ({
          claimed: true,
          fallback: false,
          row: claimMailboxLeaseInStore(store, args),
        }),
        releaseMailboxLeaseFn: async (_sb, args) => {
          const released = releaseMailboxLeaseInStore(store, args);
          watermark.value = released.watermark_received_at;
          return { released: true, row: released };
        },
      },
    });

    assert.equal(second.had_failure, false);
    assert.deepEqual(ingested, ["m1", "m2", "m3"]);
    assert.equal(watermark.value, "2026-09-09T10:03:00.000Z");
  });

  it("computeNextWatermark never skips past a failed message", () => {
    assert.equal(
      computeNextWatermark({
        previousWatermark: "2026-09-09T10:00:00.000Z",
        successfulReceivedAts: ["2026-09-09T10:01:00.000Z"],
      }),
      "2026-09-09T10:01:00.000Z",
    );
    assert.equal(
      computeNextWatermark({
        previousWatermark: "2026-09-09T10:00:00.000Z",
        successfulReceivedAts: [],
      }),
      "2026-09-09T10:00:00.000Z",
    );
    const after = computeGraphReceivedAfter({
      watermarkReceivedAt: "2026-09-09T10:01:00.000Z",
      skewMs: DEFAULT_SKEW_MS,
    });
    assert.ok(Date.parse(after) < Date.parse("2026-09-09T10:01:00.000Z"));
  });

  it("prevents two pollers from claiming the same mailbox", async () => {
    const store = new Map();
    const first = claimMailboxLeaseInStore(store, { userId: "user-1", owner: "poller-a", ttlSeconds: 120 });
    const second = claimMailboxLeaseInStore(store, { userId: "user-1", owner: "poller-b", ttlSeconds: 120 });
    assert.ok(first);
    assert.equal(second, null);

    const held = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      deps: {
        getAccessTokenFn: async () => {
          throw new Error("should not fetch token while lease is held");
        },
        claimMailboxLeaseFn: async () => ({ claimed: false, reason: "lease_held", row: null }),
      },
    });
    assert.equal(held.skipped, true);
    assert.equal(held.reason, "mailbox_lease_held");
    assert.equal(held.polled, 0);
  });

  it("does not treat an empty RPC payload as a successful claim", async () => {
    assert.equal(claimedMailboxRow({}, "user-1", "poller-a"), null);
    assert.equal(claimedMailboxRow([], "user-1", "poller-a"), null);
    assert.equal(claimedMailboxRow(null, "user-1", "poller-a"), null);
    assert.equal(
      claimedMailboxRow({ user_id: "user-1", lease_owner: null }, "user-1", "poller-a"),
      null,
    );
    assert.equal(
      claimedMailboxRow({ user_id: "user-1", lease_owner: "other" }, "user-1", "poller-a"),
      null,
    );
    assert.ok(
      claimedMailboxRow(
        {
          user_id: "user-1",
          lease_owner: "poller-a",
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
        "user-1",
        "poller-a",
      ),
    );

    const emptyPayloads = [null, {}, [], { user_id: "user-1" }];
    for (const payload of emptyPayloads) {
      const result = await claimMailboxLease(
        {
          async rpc() {
            return { data: payload, error: null };
          },
        },
        { userId: "user-1", owner: "poller-a" },
      );
      assert.equal(result.claimed, false, `payload=${JSON.stringify(payload)}`);
      assert.equal(result.reason, "lease_held");
      assert.equal(result.row, null);
    }

    const held = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      deps: {
        getAccessTokenFn: async () => {
          throw new Error("should not fetch token for empty claim payload");
        },
        claimMailboxLeaseFn: async (supabase, args) =>
          claimMailboxLease(
            {
              async rpc() {
                return { data: {}, error: null };
              },
            },
            args,
          ),
      },
    });
    assert.equal(held.skipped, true);
    assert.equal(held.reason, "mailbox_lease_held");
    assert.equal(held.polled, 0);
  });

  it("keeps the existing manual Graph poll safe when a lease is held", async () => {
    const result = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      receivedAfterIso: "2026-09-08T00:00:00.000Z",
      useCursor: false,
      deps: {
        claimMailboxLeaseFn: async () => ({ claimed: false, reason: "lease_held", row: null }),
        getAccessTokenFn: async () => {
          throw new Error("manual poll must not run Graph while leased");
        },
      },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "mailbox_lease_held");
  });

  it("manual poll without a held lease still ingests and does not require a cursor", async () => {
    const ingested = [];
    const result = await pollGraphInboundForUser(createEgressMock({}), {
      userId: "user-1",
      receivedAfterIso: "2026-09-08T00:00:00.000Z",
      useCursor: false,
      skipLease: true,
      deps: {
        getAccessTokenFn: async () => "token",
        fetchFn: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              value: [{ id: "manual-1", receivedDateTime: "2026-09-09T00:00:00.000Z", subject: "hi" }],
            }),
        }),
        ingestInboundEmailMessage: async (_sb, params) => {
          ingested.push(params.normalized.external_message_id);
          return { status: "unmatched", inserted: true };
        },
      },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.watermark_received_at, null);
    assert.deepEqual(ingested, ["manual-1"]);
    assert.equal(result.metrics.messages_fetched, 1);
  });
});
