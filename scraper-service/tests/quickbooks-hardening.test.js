"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createQuickBooksRouter } = require("../app/routes/quickbooks.routes.js");
const {
  executeInvoiceTrigger,
  InvoiceTriggerError,
} = require("../app/services/quickbooks/qb-invoice-trigger.service.js");
const {
  createSignedQuickBooksOAuthState,
  verifySignedQuickBooksOAuthState,
  consumeQuickBooksOAuthNonce,
  maskRealmId,
} = require("../app/services/quickbooks/qb-oauth-state.service.js");
const {
  addBusinessDays,
  getNet10BusinessDayDueDate,
} = require("../app/services/quickbooks/qb-due-dates.js");
const { generateInvoicePayload } = require("../app/services/quickbooks/qb-invoice-payload.js");
const {
  requestIdForCost,
  createUciPassthroughInvoice,
} = require("../app/services/uci/uci-qb-passthrough.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

process.env.QB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.QB_ENV = "sandbox";

const PROJECT_ID = "proj-qb-1";
const EDITOR = "user-editor";
const VIEWER = "user-viewer";
const DENIED = "user-denied";

function baseProject(overrides = {}) {
  return {
    id: PROJECT_ID,
    name: "Test Project",
    permit_number: "P-100",
    client_name: "Client Co",
    client_email: "client@example.com",
    service_type: "Permit management",
    contract_value: 10000,
    qb_customer_id: "qb-cust-1",
    qb_invoice_id_m1: null,
    qb_invoice_id_m2: null,
    qb_invoice_id_m3: null,
    m1_triggered: false,
    m2_triggered: false,
    m3_triggered: false,
    m1_invoice_trigger_status: null,
    m2_invoice_trigger_status: null,
    m3_invoice_trigger_status: null,
    m1_qb_pending_invoice_id: null,
    m2_qb_pending_invoice_id: null,
    m3_qb_pending_invoice_id: null,
    m1_triggered_at: null,
    m2_triggered_at: null,
    m3_triggered_at: null,
    reimbursement_amount: 0,
    reimbursement_description: null,
    ...overrides,
  };
}

/**
 * @param {object} [opts]
 */
function makeTriggerSupabase(opts = {}) {
  let project = baseProject(opts.project || {});
  let claimCount = 0;
  const claimLock = { active: false };

  return {
    projectRef: () => project,
    setProject(p) {
      project = { ...project, ...p };
    },
    auth: {
      getUser(token) {
        if (token === "editor") return { data: { user: { id: EDITOR } }, error: null };
        if (token === "viewer") return { data: { user: { id: VIEWER } }, error: null };
        if (token === "bad") return { data: { user: null }, error: new Error("invalid") };
        return { data: { user: null }, error: null };
      },
    },
    from(table) {
      if (table !== "projects") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          update() {
            return this;
          },
          single: async () => ({ data: null, error: null }),
        };
      }

      const self = {
        _filters: {},
        _patch: null,
        select() {
          return self;
        },
        eq(col, val) {
          self._filters[col] = val;
          return self;
        },
        or() {
          return self;
        },
        is() {
          return self;
        },
        update(patch) {
          self._patch = patch;
          return self;
        },
        maybeSingle: async () => {
          if (self._filters.id && self._filters.id !== project.id) {
            return { data: null, error: null };
          }
          if (self._patch) {
            if (
              self._filters.m1_invoice_trigger_status === "processing" &&
              self._patch.m1_invoice_trigger_status === "completed"
            ) {
              project = { ...project, ...self._patch };
            } else if (!self._filters.m1_invoice_trigger_status) {
              project = { ...project, ...self._patch };
            }
            return { data: { id: project.id }, error: null };
          }
          return { data: project, error: null };
        },
      };
      return self;
    },
    async rpc(name, args) {
      if (name === "has_project_editor_access") {
        const uid = args._user_id;
        if (uid === EDITOR) return { data: true, error: null };
        return { data: false, error: null };
      }
      if (name === "claim_project_milestone_invoice") {
        if (claimLock.active && !opts.allowConcurrent) {
          return { data: { claimed: false, reason: "in_progress" }, error: null };
        }
        if (project.m1_triggered || project.qb_invoice_id_m1) {
          return { data: { claimed: false, reason: "already_triggered" }, error: null };
        }
        claimCount += 1;
        claimLock.active = true;
        project = {
          ...project,
          m1_invoice_trigger_status: "processing",
          m1_triggered_at: new Date().toISOString(),
        };
        return { data: { claimed: true }, error: null };
      }
      return { data: null, error: new Error(`unknown rpc ${name}`) };
    },
    get claimCount() {
      return claimCount;
    },
    releaseClaim() {
      claimLock.active = false;
    },
  };
}

function makeStatusSupabase(connected) {
  return {
    auth: {
      getUser(token) {
        if (token === "editor") return { data: { user: { id: EDITOR } }, error: null };
        return { data: { user: null }, error: null };
      },
    },
    from(table) {
      if (table !== "quickbooks_connections") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit: async () =>
          connected
            ? {
                data: [
                  {
                    realm_id: "1234567890",
                    environment: "sandbox",
                    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  },
                ],
                error: null,
              }
            : { data: [], error: null },
      };
    },
  };
}

async function withServer(supabase, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api/quickbooks", createQuickBooksRouter({ supabase }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("QuickBooks OAuth state", () => {
  it("accepts valid state once and rejects reuse", () => {
    const state = createSignedQuickBooksOAuthState({ userId: EDITOR });
    const decoded = verifySignedQuickBooksOAuthState(state);
    assert.ok(decoded);
    consumeQuickBooksOAuthNonce(decoded.nonce);
    assert.equal(verifySignedQuickBooksOAuthState(state), null);
  });

  it("rejects missing or tampered state", () => {
    assert.equal(verifySignedQuickBooksOAuthState(""), null);
    assert.equal(verifySignedQuickBooksOAuthState("abc.def"), null);
  });

  it("masks realm ids for status responses", () => {
    assert.equal(maskRealmId("1234567890"), "****7890");
    assert.equal(maskRealmId(""), null);
  });
});

describe("QuickBooks due dates", () => {
  it("counts weekdays with invoice date excluded", () => {
    assert.equal(addBusinessDays("2026-05-01", 0), "2026-05-01");
    assert.equal(addBusinessDays("2026-05-01", 1), "2026-05-04");
    assert.equal(getNet10BusinessDayDueDate("2026-05-05"), addBusinessDays("2026-05-05", 10));
  });

  it("crosses weekends without holiday logic", () => {
    assert.equal(addBusinessDays("2026-05-08", 1), "2026-05-11");
  });
});

describe("QuickBooks invoice payload validation", () => {
  it("uses M1 40% milestone math with reimbursement admin fee", () => {
    const { totals } = generateInvoicePayload({
      project: {
        name: "Site",
        permit_number: "P",
        contract_value: 10000,
        service_type: "Permit management",
      },
      milestone: "M1",
      milestonePct: 0.4,
      reimbursementAmount: 100,
      reimbursementDescription: "City fee",
      qbCustomerId: "1",
      qbItemId: "2",
      invoiceDate: "2026-05-05",
    });
    assert.equal(totals.baseMilestoneAmount, 4000);
    assert.equal(totals.adminFeeAmount, 15);
    assert.equal(totals.totalInvoiceAmount, 4115);
  });

  it("rejects zero contract value", () => {
    assert.throws(
      () =>
        generateInvoicePayload({
          project: { name: "X", contract_value: 0 },
          milestone: "M1",
          milestonePct: 0.4,
          reimbursementAmount: 0,
          qbCustomerId: "1",
          qbItemId: "2",
          invoiceDate: "2026-05-05",
        }),
      /contract_value/,
    );
  });
});

describe("QuickBooks invoice trigger auth", () => {
  it("rejects missing auth context", async () => {
    const supabase = makeTriggerSupabase();
    await assert.rejects(
      () =>
        executeInvoiceTrigger(
          supabase,
          { projectId: PROJECT_ID, milestone: "M1", dryRun: true },
          undefined,
        ),
      (err) => err instanceof InvoiceTriggerError && err.code === "UNAUTHENTICATED",
    );
  });

  it("rejects viewer without editor access", async () => {
    const supabase = makeTriggerSupabase();
    await assert.rejects(
      () =>
        executeInvoiceTrigger(
          supabase,
          {
            projectId: PROJECT_ID,
            milestone: "M1",
            dryRun: true,
            reimbursementAmount: 0,
          },
          { userId: VIEWER },
        ),
      (err) =>
        err instanceof InvoiceTriggerError && err.code === "PROJECT_EDITOR_ACCESS_DENIED",
    );
  });

  it("allows editor dry-run without QuickBooks connection", async () => {
    const supabase = makeTriggerSupabase();
    const result = await executeInvoiceTrigger(
      supabase,
      {
        projectId: PROJECT_ID,
        milestone: "M1",
        reimbursementAmount: 0,
        dryRun: true,
      },
      { userId: EDITOR },
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.environment, "sandbox");
    assert.ok(result.payload);
  });
});

describe("QuickBooks HTTP routes", () => {
  it("returns 401 for unauthenticated invoice trigger", async () => {
    const supabase = makeTriggerSupabase();
    await withServer(supabase, async (base) => {
      const res = await fetch(`${base}/api/quickbooks/invoice/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: PROJECT_ID, milestone: "M1", dryRun: true }),
      });
      assert.equal(res.status, 401);
    });
  });

  it("returns public-safe status without auth", async () => {
    const supabase = makeStatusSupabase(true);
    await withServer(supabase, async (base) => {
      const res = await fetch(`${base}/api/quickbooks/status`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.connected, true);
      assert.equal(body.environment, undefined);
      assert.equal(body.realmId, undefined);
    });
  });

  it("returns masked status details when authenticated", async () => {
    const supabase = makeStatusSupabase(true);
    await withServer(supabase, async (base) => {
      const res = await fetch(`${base}/api/quickbooks/status`, {
        headers: { Authorization: "Bearer editor" },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.connected, true);
      assert.equal(body.environment, "sandbox");
      assert.equal(body.realmIdMasked, "****7890");
      assert.equal(body.realmId, undefined);
    });
  });
});

describe("QuickBooks milestone idempotency (mock claim)", () => {
  it("prevents duplicate milestone when already triggered", async () => {
    const supabase = makeTriggerSupabase({
      project: { m1_triggered: true, qb_invoice_id_m1: "QB-1" },
    });
    await assert.rejects(
      () =>
        executeInvoiceTrigger(
          supabase,
          { projectId: PROJECT_ID, milestone: "M1", dryRun: false, reimbursementAmount: 0 },
          { userId: EDITOR },
        ),
      (err) => err instanceof InvoiceTriggerError && err.code === "invoice_already_triggered",
    );
  });
});

describe("UCI QuickBooks passthrough RequestId", () => {
  it("reuses existing QuickBooks invoice by RequestId without create", async () => {
    const cost = {
      id: "cost-qb-idem",
      project_id: "proj-1",
      coordination_record_id: "coord-1",
      paid_at: "2026-08-10T00:00:00.000Z",
      actual_amount: 1500,
      cost_type: "CIAC",
      client_approval_status: "approved",
      qb_attempt_count: 0,
    };
    assert.equal(requestIdForCost(cost), "cost-qb-idem");
    const tables = {
      coordination_costs: [{ ...cost }],
      projects: [{ id: "proj-1", name: "Site A", client_name: "Client A" }],
      coordination_records: [stage6CompletedRecord()],
    };
    const supabase = createTrackBMockSupabase(tables);
    let createCalls = 0;
    const result = await createUciPassthroughInvoice(supabase, {
      cost,
      getValidConnectionFn: async () => ({}),
      getOrCreateCustomerFn: async () => ({ id: "cust-1" }),
      queryFn: async () => ({ QueryResponse: { Invoice: [{ Id: "QB-EXISTING" }] } }),
      createInvoiceFn: async () => {
        createCalls += 1;
        return { id: "QB-NEW" };
      },
    });
    assert.equal(createCalls, 0);
    assert.equal(result.reason, "reused_existing");
    assert.equal(result.invoice_id, "QB-EXISTING");
  });
});
