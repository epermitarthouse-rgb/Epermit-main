import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { __scraperBaseUrlTestHooks } from "./scraperBaseUrl.ts";
import { __uciApiTestHooks } from "./uciApi.ts";
import {
  ADMIN_API_PREFIX,
  buildAdminApiUrl,
  getAdminOverview,
  createAdminUser,
  listAdminUsers,
  deactivateAdminUser,
} from "./adminApi.ts";

type FetchCall = { url: string; init?: RequestInit };

describe("adminApi URL building and fetch", () => {
  let fetchCalls: FetchCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    __scraperBaseUrlTestHooks.setOverride("https://scraper.test");
    __uciApiTestHooks.setScraperBaseUrlOverride("https://scraper.test");

    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: typeof input === "string" ? input : input.toString(),
        init,
      });
      return new Response(JSON.stringify({ ok: true, users: [], pagination: { total: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __scraperBaseUrlTestHooks.setOverride(null);
    __uciApiTestHooks.setScraperBaseUrlOverride(null);
  });

  it("buildAdminApiUrl joins base, prefix, path, and query params", () => {
    assert.equal(
      buildAdminApiUrl("/overview"),
      `https://scraper.test${ADMIN_API_PREFIX}/overview`,
    );
    assert.equal(
      buildAdminApiUrl(`${ADMIN_API_PREFIX}/access/users`, {
        limit: 25,
        offset: 0,
        search: "acme",
      }),
      `https://scraper.test${ADMIN_API_PREFIX}/access/users?limit=25&offset=0&search=acme`,
    );
  });

  it("getAdminOverview calls the overview endpoint", async () => {
    __uciApiTestHooks.setAuthDepsOverride({
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
        error: null,
      }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });

    await getAdminOverview();
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes(`${ADMIN_API_PREFIX}/overview`));
    assert.equal(
      (fetchCalls[0].init?.headers as Record<string, string>)?.Authorization,
      "Bearer test-token",
    );

    __uciApiTestHooks.setAuthDepsOverride(null);
  });

  it("listAdminUsers encodes search query", async () => {
    __uciApiTestHooks.setAuthDepsOverride({
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
        error: null,
      }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });

    await listAdminUsers({ limit: 10, offset: 20, search: "Jane" });
    assert.ok(fetchCalls[0].url.includes("search=Jane"));
    assert.ok(fetchCalls[0].url.includes("limit=10"));
    assert.ok(fetchCalls[0].url.includes("offset=20"));

    __uciApiTestHooks.setAuthDepsOverride(null);
  });

  it("deactivateAdminUser sends POST with reason body", async () => {
    __uciApiTestHooks.setAuthDepsOverride({
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
        error: null,
      }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });

    globalThis.fetch = mock.fn(async (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, user_id: "u1", access_status: "deactivated" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await deactivateAdminUser("user-123", "offboarding");
    assert.ok(fetchCalls[0].url.includes("/access/users/user-123/deactivate"));
    assert.equal(fetchCalls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), { reason: "offboarding" });

    __uciApiTestHooks.setAuthDepsOverride(null);
  });

  it("createAdminUser sends POST without retaining password in response handling", async () => {
    __uciApiTestHooks.setAuthDepsOverride({
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
        error: null,
      }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    });

    globalThis.fetch = mock.fn(async (input, init) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "new-user",
          email: "new@example.com",
          full_name: "New User",
          must_change_password: true,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await createAdminUser({
      full_name: "New User",
      email: "new@example.com",
      temporary_password: "TempPass123",
    });
    assert.equal(result.user_id, "new-user");
    assert.equal(result.must_change_password, true);
    assert.ok(fetchCalls[0].url.endsWith("/access/users"));
    assert.equal(fetchCalls[0].init?.method, "POST");
    const body = JSON.parse(String(fetchCalls[0].init?.body));
    assert.equal(body.temporary_password, "TempPass123");
    assert.equal("password" in result, false);

    __uciApiTestHooks.setAuthDepsOverride(null);
  });
});
