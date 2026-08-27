import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { __uciApiTestHooks } from "./uciApi.ts";
import { getQuickBooksStatus, postInvoiceTrigger } from "./quickbooksApi.ts";

const FAR_FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

function buildJwtWithExp(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

type FetchCall = { url: string; init?: RequestInit };

describe("quickbooksApi authenticated fetch", () => {
  let fetchCalls: FetchCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      fetchCalls.push({
        url: String(input),
        init,
      });
      const path = String(input);
      if (path.includes("/api/quickbooks/invoice/trigger")) {
        return new Response(JSON.stringify({ dryRun: true, milestone: "M1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path.includes("/api/quickbooks/status")) {
        return new Response(JSON.stringify({ connected: true, environment: "production" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as typeof fetch;

    __uciApiTestHooks.setScraperBaseUrlOverride("https://example.test");
    __uciApiTestHooks.setAuthDepsOverride({
      getSession: async () => ({
        data: {
          session: {
            access_token: buildJwtWithExp(FAR_FUTURE_EXP),
            expires_at: FAR_FUTURE_EXP,
          },
        },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: null },
        error: new Error("refresh unavailable in test"),
      }),
    });
    __uciApiTestHooks.resetRefreshInFlight();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __uciApiTestHooks.setScraperBaseUrlOverride(null);
    __uciApiTestHooks.setAuthDepsOverride(null);
    __uciApiTestHooks.resetRefreshInFlight();
  });

  it("postInvoiceTrigger sends Authorization Bearer via uciAuthenticatedFetch", async () => {
    await postInvoiceTrigger({
      projectId: "proj-1",
      milestone: "M1",
      dryRun: true,
      reimbursementAmount: 0,
    });

    const triggerCall = fetchCalls.find((c) => c.url.includes("/api/quickbooks/invoice/trigger"));
    assert.ok(triggerCall);
    const headers = triggerCall.init?.headers as Record<string, string>;
    assert.match(headers.Authorization, /^Bearer /);
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("getQuickBooksStatus returns authenticated environment metadata", async () => {
    const status = await getQuickBooksStatus();
    assert.equal(status.connected, true);
    assert.equal(status.environment, "production");
    const statusCall = fetchCalls.find((c) => c.url.includes("/api/quickbooks/status"));
    assert.ok(statusCall);
    const headers = statusCall.init?.headers as Record<string, string>;
    assert.match(headers.Authorization, /^Bearer /);
  });
});
