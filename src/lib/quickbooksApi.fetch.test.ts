import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-jwt-token" } },
      })),
    },
  },
}));

import { postInvoiceTrigger } from "@/lib/quickbooksApi";

describe("quickbooksApi.postInvoiceTrigger", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ dryRun: true, milestone: "M1" }),
        json: async () => ({ dryRun: true, milestone: "M1" }),
      })),
    );
  });

  it("sends Authorization Bearer token on invoice trigger", async () => {
    await postInvoiceTrigger({
      projectId: "proj-1",
      milestone: "M1",
      dryRun: true,
      reimbursementAmount: 0,
    });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-jwt-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
