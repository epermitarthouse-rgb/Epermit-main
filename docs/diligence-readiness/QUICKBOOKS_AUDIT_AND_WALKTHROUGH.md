# QuickBooks Audit and Walkthrough

**Document date:** 2026-08-27  
**No secret values included.**

Index: [README.md](./README.md) · Production E2E: [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md)

---

## 1. Production status (precise)

QuickBooks core implementation, security hardening, production deployment and authenticated production dry-run are **complete**. The live production request reached the connected QuickBooks company, but customer/invoice creation is **externally blocked** because that company’s QuickBooks Online subscription is inactive or has a billing issue. **Final production invoice verification will resume once the account is restored.**

| Statement | Classification |
|-----------|----------------|
| QuickBooks orchestration on Railway `scraper-service` only | **Verified deployed** (`a7ef113` on `main`) |
| n8n workflow or runtime dependency | **Intentionally not used** |
| Supabase migration `20260826120000_quickbooks_milestone_claim.sql` | **Applied** (tester confirmed) |
| JWT authentication on invoice trigger | **Deployed and verified** in production dry-run |
| Project-editor authorization | **Deployed and verified** in production dry-run |
| OAuth state validation | **Deployed** (`a7ef113`) |
| Atomic milestone claims + duplicate protection | **Deployed** |
| Frontend token refresh (`uciAuthenticatedFetch`) | **Deployed** (`46b00bb` on Vercel) |
| Frontend QuickBooks API tests | **2/2 pass** |
| Backend QuickBooks hardening tests | **15/15 pass** |
| Production build | **Pass** |
| Authenticated production dry-run (M1, $4,000) | **Verified passed** (2026-08-27) |
| Live production draft invoice created successfully | **Not verified** — blocked by QuickBooks company subscription |
| Payment-status webhooks / paid-invoice sync | **Out of scope** — not implemented |
| UCI passthrough invoice code | **Verified** in code — live success **not verified** |

**Do not** state that a production invoice was successfully created.

---

## 2. Deployment evidence

| Layer | Commit | Status |
|-------|--------|--------|
| Railway backend (QuickBooks hardening) | `a7ef113` | **Deployed** |
| Vercel frontend (auth refresh fix) | `46b00bb` | **Deployed** |
| Supabase milestone claim migration | `20260826120000_quickbooks_milestone_claim.sql` | **Applied** |

---

## 3. Architecture — Railway backend (no n8n)

| Statement | Classification |
|-----------|----------------|
| QuickBooks orchestration runs in **Railway `scraper-service`** | **Verified deployed** |
| Browser calls Railway only; never calls Intuit directly | **Verified** |
| Payment-status webhooks / paid-invoice sync | **Out of scope** |

### Shared OAuth connection model

| Statement | Classification |
|-----------|----------------|
| One centrally stored QuickBooks company connection per environment | **Verified** (`quickbooks_connections`) |
| Encrypted OAuth refresh token stored server-side | **Verified** |
| Authorized PermitPilot project editors use stored connection | **Verified** — no per-invoice QuickBooks login |
| Intuit authorizing user email is **not** hardcoded in application | **Verified** |
| Daniyal’s Intuit account was added to Ian’s QuickBooks team to authorize OAuth | **Client confirmed** |
| Adding a user to the QuickBooks team does **not** activate company subscription | **Verified** (live-test blocker) |
| Multi-tenant / per-organization QuickBooks companies | **Future enhancement** — not required for current single-company architecture |

---

## 4. Authentication root cause and fix (2026-08-27)

### Root cause

Production dry-run initially failed because:

- `quickbooksApi.ts` used `supabase.auth.getSession()`;
- an expired access token was sent without coordinated refresh;
- the backend correctly returned `401 INVALID_JWT`;
- QuickBooks API calls did not use the existing authenticated refresh/retry helper.

### Fix (`46b00bb`)

- QuickBooks frontend requests now use `uciAuthenticatedFetch`;
- expired Supabase tokens are refreshed;
- one safe retry occurs for `401 INVALID_JWT`;
- authentication was **not** weakened;
- backend authorization remains unchanged.

### Verification

| Check | Result |
|-------|--------|
| Frontend QuickBooks API tests | **2/2 pass** |
| Backend QuickBooks hardening tests | **15/15 pass** |
| Production build | **Pass** |
| Deployed frontend bundle | Contains corrected authentication path |
| Browser-authenticated production dry-run | **Pass** |

---

## 5. Implementation map

| Layer | Location |
|-------|----------|
| UI | `src/components/projects/BillingInvoicePanel.tsx` |
| Frontend API | `src/lib/quickbooksApi.ts` (uses `uciAuthenticatedFetch`) |
| Routes | `scraper-service/app/routes/quickbooks.routes.js` |
| Services | `scraper-service/app/services/quickbooks/*`, `uci-qb-passthrough.service.js` |
| OAuth state | `qb-oauth-state.service.js` (HMAC-signed, 15 min TTL, single-use nonce in-process) |
| Milestone idempotency | `qb-milestone-claim.service.js` + RPC `claim_project_milestone_invoice` |
| DB | `quickbooks_connections`, `projects.qb_*`, `projects.m*_invoice_trigger_status`, `coordination_costs.quickbooks_invoice_id` |

---

## 6. Security controls (deployed)

| Control | Status |
|---------|--------|
| `POST /api/quickbooks/invoice/trigger` — Supabase JWT + `has_project_editor_access` | **Deployed** |
| OAuth `state` — signed, expiring, single-use nonce | **Deployed** |
| `GET /api/quickbooks/status` — public `{ connected }`; details require JWT; masked realm | **Deployed** |
| Milestone duplicate / concurrent claim | **Deployed** (RPC + status columns) |
| UCI RequestId idempotency | **Preserved** |

---

## 7. Production configuration verified (2026-08-27)

| Check | Result |
|-------|--------|
| `QB_ENV` | `production` |
| QuickBooks connection | Connected |
| `QB_DEFAULT_ITEM_ID` | Configured (non-empty) |
| `QB_DEFAULT_ITEM_NAME` | Configured (non-empty) |
| Resolved production item | Display name **`Sales`**, type **Service**, active, income account present |
| `service_type=Sales` on test project | Resolves successfully |
| Customer resolution | Uses `project.client_name` |

---

## 8. Production E2E test project

| Field | Value |
|-------|-------|
| Project name | `QB E2E TEST — 2026-08-27 — DO NOT BILL` |
| Project ID | `616e0577-0e7c-4438-9f08-910969e60e6e` |
| Permit number | `QB-E2E-20260827` |
| Client | `QB E2E TEST CUSTOMER — DO NOT BILL` |
| Client email | `qb-e2e-test-20260827@example.com` |
| Service type | `Sales` |
| Contract value | `$10,000` |
| Reimbursement | `$0` |

Full journey: [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md).

---

## 9. Production dry-run result (verified)

Browser-authenticated production dry-run **passed**:

| Field | Value |
|-------|--------|
| Milestone | M1 (40%) |
| Base amount | `$4,000` |
| Total | `$4,000` |
| Invoice date | `2026-08-27` |
| Due date | `2026-09-10` (10 weekdays; invoice date excluded; weekends excluded; US holidays not excluded) |
| CustomerRef (dry-run) | `DRY_RUN_CUSTOMER` placeholder |
| Line | `Initial / project setup milestone — Sales (M1)` |
| QuickBooks customer created | **No** |
| QuickBooks invoice created | **No** |
| M1 remained untriggered after dry-run | **Yes** |

---

## 10. Live production attempt (externally blocked)

Tester selected **Create Draft Invoice**. QuickBooks rejected the write during customer resolution:

> Invalid Company Status: Subscription period has ended or cancelled or there was a billing problem.

**Interpretation:**

- PermitPilot authenticated the user successfully.
- Project-editor authorization passed.
- The request reached the connected QuickBooks production company.
- Item configuration was valid.
- QuickBooks blocked customer creation because the connected QuickBooks Online Simple Start company subscription is expired, cancelled, or has a billing problem.
- This is an **external QuickBooks account/billing blocker**, not an application authentication, calculation, or item-mapping defect.

### Verified post-failure state (read-only, 2026-08-27)

| Field | Verified value |
|-------|----------------|
| `m1_triggered` | `false` |
| `m1_triggered_at` | `2026-08-27T05:21:17.819192+00:00` (set when claim entered `processing`; **not** a successful completion timestamp) |
| `qb_invoice_id_m1` | `NULL` |
| `m1_invoice_trigger_status` | `failed` |
| `m1_qb_pending_invoice_id` | `NULL` |
| `qb_customer_id` | `NULL` |
| QuickBooks customer `QB E2E TEST CUSTOMER — DO NOT BILL` | **Not found** |
| QuickBooks invoice `$4,000` for test permit | **Not found** (0 matches) |

**Retry status:** `failed` with no invoice ID and no QuickBooks side-effects — **retryable** after Ian restores QuickBooks billing. **Do not** manually reset milestone fields.

---

## 11. Blocked externally / pending

| Item | Status |
|------|--------|
| First live production customer + draft invoice | **Blocked** — QuickBooks subscription |
| Duplicate-prevention live verification | **Blocked** — requires successful invoice first |
| Cleanup/void verification | **Blocked** — no invoice created |
| US holiday calendar policy | **Pending business decision** |
| Shared OAuth nonce storage (multi-instance Railway) | **Pending** — in-process today |
| Multi-tenant QuickBooks connections | **Future** — only if multiple independent billing orgs |
| Payment-status webhooks | **Out of scope** |

**Blocker:** Ian / QuickBooks Primary Admin must restore the connected QuickBooks Online Simple Start subscription or resolve its billing issue.

---

## 12. UAT continuation (after billing restored)

1. Confirm QuickBooks subscription active.
2. Confirm PermitPilot shows **Production (connected)**.
3. Confirm M1 is in safely retryable **`failed`** state and no matching customer/invoice exists in QuickBooks.
4. **Do not** manually reset milestone fields.
5. Retry **Create Draft Invoice** once.
6. Verify customer and exactly one **$4,000** invoice in QuickBooks.
7. Verify M1 completed state and stored invoice ID in PermitPilot.
8. Retry the completed milestone once to verify duplicate rejection.
9. Obtain accounting approval and void/delete the test invoice per Ian’s policy.
10. Document that QuickBooks cleanup does **not** automatically reset PermitPilot milestone state.

Details: [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md) §16.

---

## 13. Business-day logic

**Verified:** `qb-due-dates.js` — Net 10 **weekdays** (Mon–Fri); invoice date excluded; **US public holidays not excluded**.

**Pending business decision (Ian):** whether US federal holidays, observed holidays, or a custom Commun-ET calendar should apply.

---

## 14. Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ENV.md](./ENV.md)
- [QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md)
- [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md)
- [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md)
