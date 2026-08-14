import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  __uciApiTestHooks,
  analyzeCoordinationLoadProfile,
  extractCoordinationLoadCandidates,
  getValidUciAccessToken,
  importCoordinationDocumentFindings,
  uciAuthenticatedFetch,
  UciSessionExpiredError,
  UciTransportError,
} from "./uciApi.ts";

const FAR_FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const NEAR_EXPIRY_EXP = Math.floor(Date.now() / 1000) + 30;

function buildJwtWithExp(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchCall = { url: string; init?: RequestInit };

describe("uciAuthenticatedFetch auth refresh behavior", () => {
  let getSessionMock: ReturnType<typeof mock.fn>;
  let refreshSessionMock: ReturnType<typeof mock.fn>;
  let fetchCalls: FetchCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    __uciApiTestHooks.setScraperBaseUrlOverride("https://test.example");

    fetchCalls = [];
    getSessionMock = mock.fn(async () => ({
      data: {
        session: {
          access_token: buildJwtWithExp(FAR_FUTURE_EXP),
          expires_at: FAR_FUTURE_EXP,
        },
      },
      error: null,
    }));
    refreshSessionMock = mock.fn(async () => ({
      data: { session: { access_token: buildJwtWithExp(FAR_FUTURE_EXP + 60) } },
      error: null,
    }));

    __uciApiTestHooks.setAuthDepsOverride({
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
    });
    __uciApiTestHooks.resetRefreshInFlight();

    originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;
  });

  afterEach(() => {
    __uciApiTestHooks.setAuthDepsOverride(null);
    __uciApiTestHooks.setScraperBaseUrlOverride(null);
    __uciApiTestHooks.resetRefreshInFlight();
    globalThis.fetch = originalFetch;
  });

  it("uses a valid token without calling refreshSession", async () => {
    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 200);
    assert.equal(refreshSessionMock.mock.callCount(), 0);
    assert.equal(fetchCalls.length, 1);
    const headers = fetchCalls[0]?.init?.headers as Record<string, string> | undefined;
    assert.ok(headers?.Authorization?.startsWith("Bearer "));
  });

  it("does not proactively refresh when token is within the former 60-second lead window", async () => {
    getSessionMock.mock.mockImplementation(async () => ({
      data: {
        session: {
          access_token: buildJwtWithExp(NEAR_EXPIRY_EXP),
          expires_at: NEAR_EXPIRY_EXP,
        },
      },
      error: null,
    }));

    const tokenState = await getValidUciAccessToken();
    assert.equal(refreshSessionMock.mock.callCount(), 0);
    assert.ok(tokenState.token.includes("."));

    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 200);
    assert.equal(refreshSessionMock.mock.callCount(), 0);
    assert.equal(fetchCalls.length, 1);
  });

  it("refreshes once and retries exactly once on confirmed 401 INVALID_JWT", async () => {
    globalThis.fetch = mock.fn(async () => {
      fetchCalls.push({ url: "/api/uci/providers" });
      if (fetchCalls.length === 1) {
        return jsonResponse(401, { error: "INVALID_JWT" });
      }
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;

    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 200);
    assert.equal(refreshSessionMock.mock.callCount(), 1);
    assert.equal(fetchCalls.length, 2);
  });

  it("coordinates a single refresh across concurrent 401 INVALID_JWT requests", async () => {
    let refreshStarted = false;
    refreshSessionMock.mock.mockImplementation(async () => {
      refreshStarted = true;
      await new Promise((r) => setTimeout(r, 25));
      return {
        data: { session: { access_token: buildJwtWithExp(FAR_FUTURE_EXP + 120) } },
        error: null,
      };
    });

    const attemptCounts = new Map<string, number>();
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const count = (attemptCounts.get(url) ?? 0) + 1;
      attemptCounts.set(url, count);
      fetchCalls.push({ url });
      if (count === 1) {
        return jsonResponse(401, { error: "INVALID_JWT" });
      }
      return jsonResponse(200, { ok: true, url });
    }) as typeof fetch;

    const [resA, resB, resC] = await Promise.all([
      uciAuthenticatedFetch("/api/uci/providers"),
      uciAuthenticatedFetch("/api/uci/projects/p1/coordination"),
      uciAuthenticatedFetch("/api/uci/projects/p2/coordination"),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(resC.status, 200);
    assert.equal(refreshSessionMock.mock.callCount(), 1);
    assert.equal(refreshStarted, true);
    assert.equal(fetchCalls.length, 6);
  });

  it("rejects all waiters and resets single-flight state when refresh fails", async () => {
    refreshSessionMock.mock.mockImplementation(async () => ({
      data: { session: null },
      error: { message: "429 Too Many Requests" },
    }));

    globalThis.fetch = mock.fn(async () => jsonResponse(401, { error: "INVALID_JWT" })) as typeof fetch;

    await assert.rejects(
      () => uciAuthenticatedFetch("/api/uci/providers"),
      (err: unknown) => err instanceof UciSessionExpiredError,
    );
    assert.equal(refreshSessionMock.mock.callCount(), 1);

    refreshSessionMock.mock.resetCalls();
    refreshSessionMock.mock.mockImplementation(async () => ({
      data: { session: { access_token: buildJwtWithExp(FAR_FUTURE_EXP + 90) } },
      error: null,
    }));
    globalThis.fetch = mock.fn(async () => jsonResponse(200, { ok: true })) as typeof fetch;

    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 200);
    assert.equal(refreshSessionMock.mock.callCount(), 0);
  });

  it("rejects with UciSessionExpiredError when refresh returns no access token", async () => {
    refreshSessionMock.mock.mockImplementation(async () => ({
      data: { session: { access_token: undefined } },
      error: null,
    }));
    globalThis.fetch = mock.fn(async () => jsonResponse(401, { error: "INVALID_JWT" })) as typeof fetch;

    await assert.rejects(
      () => uciAuthenticatedFetch("/api/uci/providers"),
      (err: unknown) => err instanceof UciSessionExpiredError,
    );
  });

  it("does not refresh for non-auth HTTP statuses", async () => {
    for (const status of [403, 404, 409, 429, 500]) {
      refreshSessionMock.mock.resetCalls();
      const fetchMock = mock.fn(async () => jsonResponse(status, { error: "X" }));
      globalThis.fetch = fetchMock as typeof fetch;

      const res = await uciAuthenticatedFetch("/api/uci/providers");
      assert.equal(res.status, status);
      assert.equal(refreshSessionMock.mock.callCount(), 0);
      assert.equal(fetchMock.mock.callCount(), 1);
    }
  });

  it("does not refresh on network failure", async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await assert.rejects(
      () => uciAuthenticatedFetch("/api/uci/providers"),
      (err: unknown) =>
        err instanceof UciTransportError &&
        err.kind === "network" &&
        err.retryAttempted === false &&
        err.message.includes("Request ID:"),
    );
    assert.equal(refreshSessionMock.mock.callCount(), 0);
  });

  it("retries the idempotent Re-analyze action once with fresh auth/base URL state", async () => {
    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });
      if (fetchCalls.length === 1) {
        __uciApiTestHooks.setScraperBaseUrlOverride("https://recovered.example");
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { analysis_status: "preliminary" });
    }) as typeof fetch;

    const result = await analyzeCoordinationLoadProfile("coord-1");

    assert.equal(result.analysis_status, "preliminary");
    assert.equal(fetchCalls.length, 2);
    assert.equal(getSessionMock.mock.callCount(), 2);
    assert.equal(fetchCalls[0]?.url, "https://test.example/api/uci/coordination/coord-1/load-profile/analyze");
    assert.equal(
      fetchCalls[1]?.url,
      "https://recovered.example/api/uci/coordination/coord-1/load-profile/analyze",
    );
    const firstHeaders = fetchCalls[0]?.init?.headers as Record<string, string>;
    const retryHeaders = fetchCalls[1]?.init?.headers as Record<string, string>;
    assert.equal(firstHeaders["x-request-id"], retryHeaders["x-request-id"]);
    assert.equal(firstHeaders["x-uci-request-attempt"], "1");
    assert.equal(retryHeaders["x-uci-request-attempt"], "2");
  });

  it("does not auto-retry candidate extraction or findings import mutations", async () => {
    const fetchMock = mock.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await assert.rejects(
      () =>
        extractCoordinationLoadCandidates("coord-1", {
          external_application_id: "app-1",
        }),
      (err: unknown) => err instanceof UciTransportError && err.retryAttempted === false,
    );
    await assert.rejects(
      () =>
        importCoordinationDocumentFindings("coord-1", {
          external_application_id: "app-1",
        }),
      (err: unknown) => err instanceof UciTransportError && err.retryAttempted === false,
    );
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it("turns a request timeout into a recoverable transport error", async () => {
    globalThis.fetch = mock.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as typeof fetch;

    await assert.rejects(
      () =>
        uciAuthenticatedFetch(
          "/api/uci/coordination/coord-1/load-profile/analyze",
          { method: "POST" },
          { timeoutMs: 5 },
        ),
      (err: unknown) =>
        err instanceof UciTransportError &&
        err.kind === "timeout" &&
        err.retryAttempted === false,
    );
  });

  it("recovers normally on a subsequent action after a transport failure", async () => {
    let shouldFail = true;
    globalThis.fetch = mock.fn(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { analysis_status: "preliminary" });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        importCoordinationDocumentFindings("coord-1", {
          external_application_id: "app-1",
        }),
      UciTransportError,
    );
    const result = await analyzeCoordinationLoadProfile("coord-1");
    assert.equal(result.analysis_status, "preliminary");
  });

  it("does not refresh on generic 401 without confirmed INVALID_JWT", async () => {
    const fetchMock = mock.fn(async () => jsonResponse(401, { error: "UNAUTHENTICATED" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 401);
    assert.equal(refreshSessionMock.mock.callCount(), 0);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("does not retry again when the INVALID_JWT retry also returns 401", async () => {
    const fetchMock = mock.fn(async () => jsonResponse(401, { error: "INVALID_JWT" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await uciAuthenticatedFetch("/api/uci/providers");
    assert.equal(res.status, 401);
    assert.equal(refreshSessionMock.mock.callCount(), 1);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it("throws Not authenticated when no session exists before the request", async () => {
    getSessionMock.mock.mockImplementation(async () => ({
      data: { session: null },
      error: null,
    }));

    await assert.rejects(() => getValidUciAccessToken(), /Not authenticated/);
    assert.equal(refreshSessionMock.mock.callCount(), 0);
  });
});
