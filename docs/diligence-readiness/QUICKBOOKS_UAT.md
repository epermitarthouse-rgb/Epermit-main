# QuickBooks UAT Guide

**Document date:** 2026-08-27  
**Deployed on `main`:** Backend `a7ef113`, frontend `46b00bb`  
**No credentials or client financial data in this document.**

Index: [README.md](./README.md)

---

## Scope

This guide supports manual UAT for PermitPilot milestone (M1/M2/M3) draft invoicing through the **Railway backend** (`scraper-service`). **n8n is not used.** Payment-status webhooks and paid-invoice sync remain **out of scope**.

For production E2E results and continuation steps, see [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md).

| Stage | What it exercises | Production invoice? |
|-------|-------------------|---------------------|
| 1 | Authenticated **dry-run** | No |
| 2 | QuickBooks **sandbox** draft (if `QB_ENV=sandbox` and connected) | No (sandbox only) |
| 3 | Production **dry-run** (read-only payload) | No |
| 4 | Production **live draft** | **Only with explicit approval** |

---

## Production status summary (2026-08-27)

| Phase | Status |
|-------|--------|
| Hardening deployed (`a7ef113`) | **Complete** |
| Frontend auth refresh deployed (`46b00bb`) | **Complete** |
| Migration applied | **Complete** |
| Authenticated production dry-run | **Verified passed** |
| Live production draft invoice | **Blocked externally** — QuickBooks company subscription inactive/billing issue |
| Full live invoice flow production-verified | **Not yet** — resume after Ian restores QuickBooks billing |

See [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md) and [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md).

---

## Prerequisites

1. **`main` deployed** on Railway (`a7ef113`) and Vercel (`46b00bb` for auth fix).
2. **Supabase migration applied:** `20260826120000_quickbooks_milestone_claim.sql`.
3. **Signed-in PermitPilot user** with **project editor** access (owner/admin/editor — not viewer).
4. **Safe test project:**
   - Non-production client data preferred (internal/UAT project).
   - `contract_value` > 0.
   - `client_name` and/or `client_email` set.
   - Milestone not yet triggered (`m1_triggered` / `qb_invoice_id_m1` empty for the milestone under test).
5. **Backend env (Railway or local `scraper-service/.env`):**
   - `QB_TOKEN_ENCRYPTION_KEY` — required for OAuth state signing and token storage.
   - `QB_ENV` — `sandbox` for safe invoice tests; `production` only after explicit approval.
   - `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI` — for live (non-dry-run) tests.
   - Optional: `QB_DEFAULT_ITEM_ID` or `QB_DEFAULT_ITEM_NAME` if `service_type` does not match a QBO item.

**Sandbox unavailable?** If sandbox credentials are not configured, proceed with **dry-run UAT only** (Stages 1 and 3). The billing panel still shows the backend `environment` label from verified configuration.

---

## UI path — milestone dry-run (Stage 1)

1. Open **Projects** → select UAT project → **Billing** tab (`BillingInvoicePanel`).
2. Confirm the panel shows **QuickBooks backend environment** (Sandbox or Production) from `/api/quickbooks/status` (authenticated).
3. Click **Preview / Trigger M1** (or M2/M3).
4. Leave **Dry run / preview only** checked.
5. Click **Preview Payload**.
6. **Expected:**
   - Toast: “Dry-run preview ready.”
   - Modal shows TxnDate, DueDate (Net 10 **weekdays**, invoice date excluded), line items, total.
   - No QuickBooks API invoice created.
   - Network: `POST /api/quickbooks/invoice/trigger` with `Authorization: Bearer <jwt>`, body `{ dryRun: true, ... }`.
   - Response includes `environment` matching `QB_ENV`.

---

## UI path — sandbox draft invoice (Stage 2)

**Only when `QB_ENV=sandbox` and QuickBooks is connected.**

1. Complete OAuth: authenticated user opens `/api/quickbooks/oauth/start?format=json` (or future Settings link) → Intuit → callback.
2. Uncheck **Dry run / preview only**.
3. Click **Create Draft Invoice**.
4. **Expected:**
   - Draft invoice in **QuickBooks sandbox** company.
   - Project row updated: `m1_triggered=true`, `qb_invoice_id_m1=<id>`, `m1_invoice_trigger_status=completed`.
   - Repeat click → **409** `invoice_already_triggered` (no second sandbox invoice).

---

## Authorization tests

| Test | Steps | Expected |
|------|-------|----------|
| Missing JWT | `curl -X POST .../invoice/trigger` without `Authorization` | **401** `UNAUTHENTICATED` |
| Invalid JWT | Bearer garbage token | **401** `INVALID_JWT` |
| Viewer | User with viewer-only project access | **403** `PROJECT_EDITOR_ACCESS_DENIED` |
| Editor dry-run | Editor + `dryRun:true` | **200** payload preview |
| Dry-run bypass | Unauthenticated dry-run | **401** (dry-run does not bypass auth) |

---

## Duplicate-click / concurrency test

1. Open two browser tabs on the same milestone modal (live, not dry-run).
2. Click **Create Draft Invoice** in both tabs within ~1 second.
3. **Expected:** one succeeds; the other returns **409** `invoice_trigger_in_progress` or `invoice_already_triggered`.
4. Verify **one** invoice in QuickBooks and one `qb_invoice_id_m*` on the project.

---

## Failure-path tests

| Scenario | Expected |
|----------|----------|
| Missing contract value | UI gate message; API validation error if forced |
| Missing client name/email | Validation error |
| QuickBooks not connected (live) | **503** `quickbooks_not_connected` |
| Missing QBO item | **422** `quickbooks_item_missing` |
| QB created, DB save failed | **502** `invoice_trigger_uncertain` + `m*_qb_pending_invoice_id` — **do not retry** without reconciliation |

---

## Database fields to verify

**Project (milestone M1 example):**

| Column | After dry-run | After live success |
|--------|---------------|-------------------|
| `m1_triggered` | false | true |
| `qb_invoice_id_m1` | null | QuickBooks invoice id |
| `m1_invoice_trigger_status` | null | `completed` |
| `m1_qb_pending_invoice_id` | null | null (unless uncertain state) |

**UCI passthrough (unchanged):** `coordination_costs.quickbooks_invoice_id`, `qb_sync_status`, RequestId in `PrivateNote`.

---

## Rollback / cleanup

- **Dry-run:** no QuickBooks or DB milestone changes.
- **Sandbox draft:** void/delete draft in QuickBooks sandbox; reset project milestone columns only on UAT projects with DBA approval.
- **Uncertain state:** locate invoice in QuickBooks by id in `m*_qb_pending_invoice_id`, reconcile manually, then clear or complete project fields.

---

## Warning — production live draft (Stage 4)

**Do not run Stage 4 without written approval from Ian/ops.**

Production live creation uses real QuickBooks **production** (`QB_ENV=production`). Confirm environment label in UI before unchecking dry-run.

---

## Related

- [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md)
- [ENV.md](./ENV.md)
- [DEPLOY.md](./DEPLOY.md)
