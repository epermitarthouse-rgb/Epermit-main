# QuickBooks Production E2E Testing Guide

**Document date:** 2026-08-27  
**Deployed:** Backend `a7ef113`, frontend auth fix `46b00bb`  
**Target:** Real QuickBooks **production** company (not sandbox)  
**Architecture:** Railway `scraper-service` only — **n8n is not used**  
**No credentials, tokens, realm IDs, or client financial data in this document.**

Index: [README.md](./README.md) · Related: [QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md) · [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md)

---

## Executive status (2026-08-27)

QuickBooks core implementation, security hardening, production deployment and authenticated production dry-run are **complete**. The live production request reached the connected QuickBooks company, but customer/invoice creation is **externally blocked** because that company’s QuickBooks Online subscription is inactive or has a billing issue. **Final production invoice verification will resume once Ian restores the account.**

| Category | Status |
|----------|--------|
| **Completed** | Railway architecture, JWT auth, editor authorization, OAuth state, milestone claims, duplicate protection, customer/item resolution, frontend token refresh, deployment, production dry-run, connection + Item validation |
| **Verified in production** | Authenticated connection, `QB_ENV=production`, Item `Sales`, M1 calculation, due dates, dry-run payload, request reaching QuickBooks, QuickBooks rejecting writes (subscription) |
| **Blocked externally** | Live customer/invoice creation, duplicate-prevention live test, cleanup/void verification |
| **Not production-verified** | Successful live draft invoice creation |

**Test project ID:** `616e0577-0e7c-4438-9f08-910969e60e6e`

---

## 1. Architecture summary (deployed E2E path)

PermitPilot milestone invoicing (M1/M2/M3) runs entirely through the **Railway backend**. The browser never calls Intuit directly.

```
Tester (signed in on Vercel)
  → Projects UI → Project detail → Billing tab
  → BillingInvoicePanel
  → quickbooksApi.ts (`uciAuthenticatedFetch` — refreshes expired Supabase JWT, one retry on 401 INVALID_JWT)
  → Railway: POST /api/quickbooks/invoice/trigger
       ├─ getAuthenticatedUser (Supabase JWT)
       ├─ requireProjectEditorAccess (RPC has_project_editor_access)
       ├─ Load project row (service role)
       ├─ Validate contract_value, client_name/email, milestone state
       ├─ dryRun=true  → generateInvoicePayload only (no Intuit)
       └─ dryRun=false → claim_project_milestone_invoice RPC
                         → getValidConnection
                         → resolveProjectQbCustomerId (get/create QB customer)
                         → resolve QuickBooks Item ID
                         → generateInvoicePayload
                         → createDraftInvoice (QuickBooks API)
                         → completeMilestoneInvoice (update projects row)
```

**UCI passthrough** (`uci-qb-passthrough.service.js`) is a **separate** path triggered from utility cost workflows — **not** part of this milestone E2E unless explicitly tested later.

**Payment-status webhooks / paid-invoice sync:** not implemented — voiding an invoice in QuickBooks does **not** automatically reset PermitPilot milestone fields.

### Deployment evidence (2026-08-27, read-only checks)

| Layer | Expected commit | Evidence |
|-------|-----------------|----------|
| Git `main` | `a7ef113` (backend), `46b00bb` (frontend auth) | GitHub `main` tip |
| Railway backend | `a7ef113` | Deployed to PermitPilot production |
| Vercel frontend | `46b00bb` | Deployed; bundle uses `uciAuthenticatedFetch` for QuickBooks API |
| Supabase migration | Applied | `20260826120000_quickbooks_milestone_claim.sql` |

**Production URLs**

| Surface | URL |
|---------|-----|
| Frontend (Vercel) | `https://epermit-main-nine.vercel.app` |
| Backend (Railway) | `https://epermit-main-production.up.railway.app` |
| API base used by frontend | `VITE_API_BASE_URL` if set; otherwise defaults to Railway URL above (`src/lib/scraperBaseUrl.ts`) |

**Before testing:** confirm the billing panel shows **“QuickBooks backend environment: Production”** when signed in. If it shows Sandbox or Unknown, **stop** (see §13).

---

## 2. Deployment prerequisites

1. **`main` includes `a7ef113`** on Railway and Vercel (see table above).
2. **Supabase migration applied:** milestone claim RPC + status columns.
3. **QuickBooks production connected** on Railway (`QB_ENV=production`, OAuth completed previously).
4. **Tester signed into PermitPilot** with an account that will **own** the test project (owners automatically pass `has_project_editor_access`).
5. **QuickBooks item mapping — verified 2026-08-27 (read-only):** Production company has active Item **`Sales`** (type **Service**, income account present). Railway `QB_DEFAULT_ITEM_ID` and `QB_DEFAULT_ITEM_NAME` are both configured and resolve to this item. Enter **`Sales`** in project **Service type** (free-text; case-insensitive match).
6. **Ian/accounting approval** for one real **production draft** invoice on a clearly labelled test project.

---

## 3. Exact test-project values

Use unmistakably synthetic data. **Do not** use a real client’s name, email, address, or contract.

**Naming pattern:** `QB E2E TEST — 2026-08-27 — DO NOT BILL`  
**Project ID (created 2026-08-27):** `616e0577-0e7c-4438-9f08-910969e60e6e`

### Important code-backed notes

| Topic | Actual behavior |
|-------|----------------|
| **Contract value storage** | Dollars (`NUMERIC(15,2)`), not cents |
| **Reimbursement storage** | Dollars; milestone modal can override project default at trigger time |
| **Email validation** | Standard email format (Zod); `@example.com` passes validation |
| **Address / jurisdiction** | Saved on project but **not** sent to QuickBooks milestone invoices |
| **`estimated_value`** | Separate from `contract_value`; **not** used for M1/M2/M3 |
| **QuickBooks customer** | If `qb_customer_id` is empty, backend **creates a real production customer** via `getOrCreateCustomer` — use a clearly labelled synthetic client name |
| **Reimbursement on milestone invoice** | Included **only when reimbursement amount &gt; 0 in the trigger modal** (not UCI passthrough) |
| **First E2E recommendation** | **Exclude reimbursement** (leave at `0` in modal) for a clean M1 baseline |

### Test data table

| Screen / section | Exact UI label | Exact test value | Required? | Why needed | Database column |
|------------------|----------------|------------------|-----------|------------|-----------------|
| Basic Information | **Project Name** * | `QB E2E TEST — 2026-08-27 — DO NOT BILL` | Yes | Identification; appears in QB CustomerMemo | `projects.name` |
| Basic Information | Project Type | `commercial` (or any valid type) | No | Not used by QB milestone code | `projects.project_type` |
| Basic Information | Jurisdiction | `QB E2E Test Jurisdiction` | No | Not used by QB milestone code | `projects.jurisdiction` |
| Location | Address | `9999 Synthetic Test Lane` | No | Not used by QB milestone code | `projects.address` |
| Location | City | `Testville` | No | Not used by QB milestone code | `projects.city` |
| Location | State | `VA` | No | Not used by QB milestone code | `projects.state` |
| Location | ZIP code | `00001` | No | Must match `/^(\d{5}(-\d{4})?)?$/` if set | `projects.zip_code` |
| Basic Information | Description | `Production QB E2E test — void after verification` | No | Not used by QB milestone code | `projects.description` |
| Financial (form) | Estimated value ($) | Leave blank | No | **Not** used for milestones (`contract_value` is) | `projects.estimated_value` |
| Portal (if shown) | Permit / application number | `QB-E2E-20260827` | No | Used in invoice CustomerMemo | `projects.permit_number` |
| **Client details** | **Client name** | `QB E2E TEST CUSTOMER — DO NOT BILL` | Yes* | QB customer display name (*need name **or** email) | `projects.client_name` |
| **Client details** | **Client email** | `qb-e2e-test-20260827@example.com` | Yes* | Customer email if created (*need name **or** email) | `projects.client_email` |
| **Billing** | **Service type** | **`Sales`** | Recommended | Maps to production QB Item (see below); free-text **Input** field | `projects.service_type` |
| **Billing** | **Contract value ($)** | `10000` | Yes | M1/M2/M3 base amount | `projects.contract_value` |
| Billing | Reimbursement ($) | `0` or leave blank | No | Keep zero for baseline E2E | `projects.reimbursement_amount` |
| Billing | Reimbursement description | Leave blank | No | — | `projects.reimbursement_description` |

**Service type / QuickBooks Item — verified (2026-08-27, read-only)**

Resolution order in code (`qb-invoice-trigger.service.js`):

1. `project.service_type` → QuickBooks Item query (**case-insensitive** Display Name match)
2. Railway env `QB_DEFAULT_ITEM_ID` (configured on production — value not shown here)
3. Railway env `QB_DEFAULT_ITEM_NAME` (configured on production — value not shown here)

**Production verification results:**

| Check | Result |
|-------|--------|
| `QB_DEFAULT_ITEM_ID` configured | Yes (non-empty) |
| `QB_DEFAULT_ITEM_NAME` configured | Yes (non-empty) |
| Default resolves to active item | Yes |
| Item Display Name | **`Sales`** |
| Item type | **Service** (supported for invoice lines) |
| Income account on item | Present |
| Active items in company catalog | **`Sales`** only (1 active item observed) |
| Invoice line creatable without QB config change | **Yes** (existing item is sufficient) |

**UI field:** **Service type** is a **free-text** `<Input>` (not a dropdown). Spelling is flexible for matching (**case-insensitive**), but enter **`Sales`** to align the invoice line description with the mapped item.

**Fallback:** If **Service type** is left blank, live trigger still uses the configured default item id. For clearest E2E traceability, enter **`Sales`**.

Expected M1 line description: **`Initial / project setup milestone — Sales (M1)`**

---

## 4. Controlled invoice amounts (contract value $10,000)

| Milestone | % | Amount |
|-----------|---|--------|
| **M1** (first live test) | 40% | **$4,000.00** |
| M2 (reserve for later tests) | 40% | $4,000.00 |
| M3 (reserve for later tests) | 20% | $2,000.00 |

**Reimbursement (if tested later in modal):**

| Component | Formula | Example ($100 reimbursement) |
|-----------|---------|------------------------------|
| Reimbursement line | entered amount | $100.00 |
| Admin fee line | 15% of reimbursement | $15.00 |
| **Total** | base milestone + reimbursement + admin fee | M1: $4,000 + $100 + $15 = **$4,115.00** |

**Recommendation:** First production E2E uses **M1 only**, **reimbursement = 0** in the trigger modal.

---

## 5. Pre-trigger checklist

Complete **before** unchecking dry-run.

### UI / access checks

| Check | How to verify | Pass criteria |
|-------|---------------|---------------|
| Signed in | PermitPilot header shows your account | Not logged out |
| Project editor access | You **created** the project (owner) | Owner always passes `has_project_editor_access` |
| Billing gate | Billing tab → Manual invoice controls | No amber gate: *“Set a contract value…”* or *“Add a client name…”* |
| QB connected | Billing panel subtitle | “(connected)” after environment line |
| Environment | Billing panel | **“QuickBooks backend environment: Production”** |
| Milestone unused | M1 card | Badge **“Not triggered”**; button **Preview / Trigger M1** enabled |
| Dry-run default | M1 modal | **“Dry run / preview only”** checked |

### Database checks (read-only)

Replace `YOUR_PROJECT_UUID` with `616e0577-0e7c-4438-9f08-910969e60e6e` (or the project id from the URL).

```sql
SELECT
  id,
  name,
  client_name,
  client_email,
  service_type,
  contract_value,
  permit_number,
  qb_customer_id,
  m1_triggered,
  m1_triggered_at,
  m1_trigger_source,
  m1_invoice_trigger_status,
  m1_qb_pending_invoice_id,
  qb_invoice_id_m1
FROM public.projects
WHERE id = 'YOUR_PROJECT_UUID';
```

| Column | Before dry-run | After dry-run | After M1 live success |
|--------|----------------|---------------|------------------------|
| `contract_value` | `10000.00` | unchanged | unchanged |
| `client_name` / `client_email` | synthetic values | unchanged | unchanged |
| `m1_triggered` | `false` | `false` | **`true`** |
| `m1_invoice_trigger_status` | `NULL` | `NULL` | **`completed`** |
| `m1_qb_pending_invoice_id` | `NULL` | `NULL` | `NULL` |
| `qb_invoice_id_m1` | `NULL` | `NULL` | **QuickBooks invoice id** |
| `m1_triggered_at` | `NULL` | `NULL` | **timestamp** |
| `m1_trigger_source` | `NULL` | `NULL` | **`manual`** |
| `qb_customer_id` | `NULL` or existing | unchanged | **set if customer was created** |

Dry-run **must not** change milestone columns or create a QuickBooks invoice.

---

## 6. Step-by-step UI test journey

### A. Sign in and create project

1. Open **`https://epermit-main-nine.vercel.app`** and sign in.
2. Go to **Projects** (nav) or **`/projects`**.
3. Click **`New Project`** (page header or empty state).
   - Route may show **`/projects/new`**; same **Create New Project** dialog opens.
4. Fill fields from §3 table (all billing/client fields are available **during creation** — not edit-only).
5. Click **`Create Project`** (dialog footer).
6. Expect toast: **“Project created successfully”**.

### B. Reopen and confirm billing configuration

7. Open the new project (card click → project detail dialog).
8. Click the **`Billing`** tab (receipt icon).
9. Confirm **Billing summary** shows client name, email, service type, contract value **$10,000.00**.
10. Confirm **Manual invoice controls** shows:
    - **“QuickBooks backend environment: Production (connected)”** (wording may omit “connected” if status still loading — wait and refresh).

### C. Production dry-run (no QuickBooks invoice)

11. On **M1** card, click **`Preview / Trigger M1`**.
12. In the modal **“M1 milestone invoice (40%)”**:
    - Leave **Dry run / preview only** **checked**.
    - Set **Reimbursement amount** to **`0`**.
13. Click **`Preview Payload`** (button shows **Working…** while in progress).
14. Expect toast: **“Dry-run preview ready.”**
15. Validate preview panel:
    - **TxnDate** = today’s date (`YYYY-MM-DD`, local calendar)
    - **DueDate** = Net **10 weekdays** after TxnDate, **invoice date excluded**, **Mon–Fri only** (no US holidays)
    - One line: **“Initial / project setup milestone — {service_type} (M1)”** for **$4,000.00**
    - **Total** **$4,000.00**
16. **Confirm in QuickBooks:** no new draft invoice for this test customer yet.

### D. One controlled live production draft (M1 only — requires approval)

**Stop if dry-run totals differ from §4.**

17. **Uncheck** **“Dry run / preview only (no QuickBooks draft created)”**.
18. **`Create Draft Invoice`** becomes enabled; **`Preview Payload`** still available.
19. Click **`Create Draft Invoice`** once (button shows **Creating…** while processing).

**Actual result (2026-08-27):** QuickBooks rejected customer creation:

> Invalid Company Status: Subscription period has ended or cancelled or there was a billing problem.

PermitPilot authenticated the user, editor authorization passed, and the request reached the connected QuickBooks production company with valid Item configuration. **No draft invoice was created.** This is an **external QuickBooks subscription/billing blocker**, not an application defect.

20. Expect error toast (not success toast). M1 remains **not triggered** (`m1_triggered=false`).

### E. Verify PermitPilot state (verified 2026-08-27)

| Column | Verified value after live failure |
|--------|-----------------------------------|
| `m1_triggered` | `false` |
| `m1_triggered_at` | `2026-08-27T05:21:17.819192+00:00` (claim entered `processing`; **not** success) |
| `m1_invoice_trigger_status` | `failed` |
| `qb_invoice_id_m1` | `NULL` |
| `m1_qb_pending_invoice_id` | `NULL` |
| `qb_customer_id` | `NULL` |

**Retry:** Safe to retry **once** after Ian restores QuickBooks billing — status is `failed` with no invoice ID. **Do not** manually reset milestone fields. **Do not** retry while status is `processing` or `qb_uncertain`.

### F. Verify QuickBooks (verified read-only 2026-08-27)

| Check | Result |
|-------|--------|
| Customer `QB E2E TEST CUSTOMER — DO NOT BILL` | **Not found** |
| Invoice total `$4,000` matching test | **Not found** (0 matches) |

### G. Duplicate prevention (sequential) — pending

Blocked until first successful live invoice. After billing restored, retry live trigger once, then attempt duplicate — expect UI disabled or **`invoice_already_triggered`**.

### H. Record results and cleanup — pending

Live invoice and cleanup verification remain **blocked externally**.

---

## 7. Expected invoice results (M1 baseline, $10,000 contract, $0 reimbursement)

Assuming test day **D** (local date when live trigger runs):

| Field | Expected |
|-------|----------|
| QB customer display name | `QB E2E TEST CUSTOMER — DO NOT BILL` (or existing mapped customer) |
| CustomerRef | QuickBooks internal customer id (stored in `projects.qb_customer_id` after first create) |
| Line 1 description | `Initial / project setup milestone — Sales (M1)` |
| Line 1 amount | **$4,000.00** |
| ItemRef | Resolved production Item id (from service_type or default env) |
| TxnDate | **D** (`YYYY-MM-DD`) |
| DueDate | **10 weekdays** starting day after D (Mon–Fri; **no holiday exclusion**) |
| CustomerMemo | `Permit QB-E2E-20260827 — QB E2E TEST — 2026-08-27 — DO NOT BILL` (if permit set) |
| PrivateNote | Contains project name, permit, milestone, service type, TxnDate, DueDate |
| Total | **$4,000.00** |
| PermitPilot `qb_invoice_id_m1` | Same id as QuickBooks invoice |
| `m1_invoice_trigger_status` | `completed` |
| Duplicate retry | UI blocked; API **`invoice_already_triggered`** |

**DueDate example (manual):** If TxnDate is **Wednesday 2026-08-27**, counting starts **2026-08-28** (Thu) as day 1 of 10 weekdays → DueDate approximately **2026-09-10** (verify with dry-run preview on test day).

---

## 8. Authentication and authorization tests

| Test | Result (2026-08-27) |
|------|---------------------|
| Expired Supabase JWT on QuickBooks API | **Fixed** — `uciAuthenticatedFetch` refreshes token; one retry on `401 INVALID_JWT` (`46b00bb`) |
| Editor dry-run | **Pass** — production dry-run succeeded |
| Editor live attempt | **Pass** through PermitPilot auth — blocked by QuickBooks subscription at customer create |
| Public status | Logged out: `{ connected: true }` only — no realm/environment |
| Authenticated status | Billing panel shows **Production (connected)** |

| Test | Safe method | Expected |
|------|-------------|----------|
| Logged-out trigger | Clear session; attempt billing action | UI prompts login; API **401** `UNAUTHENTICATED` |
| Viewer blocked | Viewer role on separate project | **403** `PROJECT_EDITOR_ACCESS_DENIED` |
| Bearer token | DevTools → Network → `invoice/trigger` | **Authorization header present** — **do not screenshot or share the token** |

---

## 9. Duplicate and concurrency tests

### Sequential duplicate (required)

- After successful M1 live invoice, UI **disables** M1 trigger button.
- Backend returns **`invoice_already_triggered`** if invoked again.
- QuickBooks must still show **exactly one** M1 invoice for this project.

### Concurrent double-click

Current UI (`BillingInvoicePanel.tsx`):

- While a request runs, **`pendingAction`** disables **Preview Payload** and **Create Draft Invoice** (`Working…` / `Creating…`).

**Safe verification:**

1. Rely on sequential duplicate test above for backend idempotency.
2. Optional: double-click **Create Draft Invoice** quickly — second click should be ignored while **Creating…**.
3. **Do not** replay captured network requests or paste JWTs into curl.

**Do not** reset milestone columns manually to “test again.” Use **M2** on the same project for a future approved test, or a **new project**.

---

## 10. Failure and uncertainty handling

| Observed result | Likely state | What to inspect | Safe next action | Retry live? |
|-----------------|-------------|-----------------|------------------|-------------|
| **401** `UNAUTHENTICATED` | No/expired session | Browser login | Re-sign in | Yes, after auth fixed |
| **403** `PROJECT_EDITOR_ACCESS_DENIED` | Viewer role | Team membership | Use owner/editor account | Yes, with editor |
| Validation error | Missing contract/client | Billing summary + SQL | Fix project fields | Yes, after fix |
| Missing customer | No client name/email | Billing summary | Edit project client fields | Yes, after fix |
| **422** `quickbooks_item_missing` | Item not resolved | `service_type`; ops env defaults | Fix service type or env | Yes, after item resolved |
| **503** `quickbooks_not_connected` | OAuth/tokens | Authenticated status | Reconnect OAuth (ops) | Yes, after connected |
| Token refresh failure | Intuit/Railway tokens | Railway logs (ops) | Ops refresh OAuth | After ops fix |
| **409** `invoice_already_triggered` | Completed | `qb_invoice_id_m1` | None — expected | **No** |
| **409** `invoice_trigger_in_progress` | Claim held | `m1_invoice_trigger_status=processing` | Wait 15+ min or ops review | **No** until cleared |
| **`failed`** status | Claim released after error | Railway logs; QB for orphan invoice | Fix root cause | Yes, only if **no** QB invoice exists |
| Request timeout | Unknown | QuickBooks invoice list **first** | See **`qb_uncertain`** row | **No** immediate retry |
| **`502` `invoice_trigger_uncertain`** | QB created; DB save failed | `m1_qb_pending_invoice_id`; QB by id | Reconcile with ops | **No** auto retry |
| **`qb_uncertain`** | Same | SQL pending id + QB | Manual reconciliation | **Never** auto retry |

**`qb_uncertain` / timeout rule:** Search QuickBooks for the customer and today’s draft **before** any retry. If an invoice exists, record its id and coordinate with ops — **do not** trigger again.

---

## 11. Production evidence checklist

Capture (redact tokens and secrets):

- [ ] Create Project form with synthetic name visible
- [ ] Billing summary with contract value and client fields
- [ ] Environment line: **Production (connected)**
- [ ] Dry-run preview showing **$4,000.00** and DueDate
- [ ] Success toast with invoice id (id alone is OK)
- [ ] M1 card **Triggered** with QB invoice id
- [ ] QuickBooks draft invoice (customer name, amount, draft status)
- [ ] SQL snippet showing `m1_triggered` / `completed` (no secrets)
- [ ] Duplicate attempt blocked (UI or error message)
- [ ] Cleanup/void confirmation in QuickBooks

**Never capture:** Authorization headers, JWTs, Railway env values, OAuth tokens, full realm ids.

---

## 12. Cleanup plan

| Question | Answer (current architecture) |
|----------|-------------------------------|
| PermitPilot test-invoice cleanup UI? | **No dedicated “void invoice” flow** in UI |
| QuickBooks cleanup | **Manual** — void or delete **draft** invoice in QuickBooks production |
| Sync back to PermitPilot after void? | **No** — payment/void webhooks not implemented |
| Reset milestone in PermitPilot? | **Not supported** — do not manually clear columns unless ops provides a approved procedure |
| Test customer in QuickBooks | Likely **remains** — inactivate/delete only with **accounting approval** |
| Delete PermitPilot project? | Possible via UI, but milestone/invoice audit trail may be lost — prefer **archive** or retain with clear name |
| Requires Ian/accounting approval | **Live production invoice creation**, **voiding/deleting** production invoices, **customer inactivation** |

**Recommended cleanup order**

1. Void or delete the **draft** test invoice in QuickBooks.
2. Leave PermitPilot project marked triggered (audit trail) **or** archive project per ops policy.
3. Retain synthetic customer or inactivate per accounting policy.

---

## 13. Stop conditions (do not proceed to live trigger)

Stop if **any** of the following is true:

- Railway or Vercel is **not** on hardened `main` (`a7ef113` or later QB hardening).
- Billing panel environment is **not Production**.
- QuickBooks status shows **not connected**.
- You lack **project editor** access.
- Contract value ≠ **$10,000** or client fields missing.
- QuickBooks item **`Sales`** is missing or inactive (re-verify only if company catalog changed since 2026-08-27).
- Dry-run total ≠ **$4,000.00** for M1 (with $0 reimbursement).
- M1 already triggered, or `m1_qb_pending_invoice_id` is set, or `m1_invoice_trigger_status` is `processing` / `qb_uncertain`.
- QuickBooks already has a matching draft for this test customer from an earlier attempt.
- UI dry-run checkbox behavior is unclear, or you cannot distinguish dry-run from live.

---

## 14. Pass / fail criteria

### Pass (current milestone — dry-run and deployment)

- [x] Authenticated **production dry-run** matches §7 calculations.
- [x] Hardening deployed (`a7ef113`) and frontend auth fix deployed (`46b00bb`).
- [x] PermitPilot reached connected QuickBooks production company on live attempt.
- [x] Post-failure DB state is safely retryable (`failed`, no invoice ID, no QB customer).
- [x] No QuickBooks customer or `$4,000` invoice created (verified read-only).

### Not yet pass (blocked externally)

- [ ] Exactly **one** production **draft** invoice created for **M1**.
- [ ] PermitPilot `qb_invoice_id_m1`, `m1_triggered`, `m1_invoice_trigger_status=completed` align with QuickBooks.
- [ ] Sequential duplicate blocked after successful live invoice.
- [ ] Cleanup/void verification in QuickBooks.

**Do not** classify the complete live invoice flow as production-verified until Ian restores QuickBooks billing and steps in §16 complete successfully.

### Fail

- Unexpected invoice amount, customer, or item created without approval.
- Duplicate invoices in QuickBooks.
- Live trigger without editor auth.
- `qb_uncertain` or orphan QuickBooks invoice without reconciliation.
- Status stuck in `processing` (retry prohibited until ops reconciliation).

---

## 15. Shared QuickBooks connection architecture

| Topic | Detail |
|-------|--------|
| Connection storage | One centrally stored OAuth connection per environment in `quickbooks_connections` |
| Token handling | Encrypted refresh token server-side; access tokens in memory only |
| Who authorizes OAuth | Intuit user who completes OAuth connect flow (Daniyal added to Ian’s QuickBooks team — **client confirmed**) |
| Hardcoded Intuit email | **None** in application code |
| Day-to-day invoicing | Authorized PermitPilot project editors use stored connection — **no per-invoice QuickBooks login** |
| Team membership vs subscription | Adding a user to QuickBooks team **does not** activate company subscription (live-test blocker) |
| Multi-company / multi-tenant | **Future enhancement** if PermitPilot serves multiple independent billing organizations |

---

## 16. UAT continuation after Ian restores QuickBooks billing

1. Confirm QuickBooks Online subscription is **active** (Ian / Primary Admin).
2. Confirm PermitPilot billing panel shows **Production (connected)**.
3. Confirm test project `616e0577-0e7c-4438-9f08-910969e60e6e` has `m1_invoice_trigger_status=failed`, `m1_triggered=false`, no `qb_invoice_id_m1`, and **no** matching customer/invoice in QuickBooks.
4. **Do not** manually reset milestone fields.
5. Retry **Create Draft Invoice** **once**.
6. Verify customer **`QB E2E TEST CUSTOMER — DO NOT BILL`** and exactly one **$4,000** draft invoice in QuickBooks.
7. Verify PermitPilot: `m1_triggered=true`, `m1_invoice_trigger_status=completed`, `qb_invoice_id_m1` populated.
8. Retry completed milestone once — verify duplicate rejection (UI disabled or **409**).
9. Obtain accounting approval; void/delete test invoice per Ian’s policy.
10. Document that voiding in QuickBooks **does not** reset PermitPilot milestone fields (no payment/void webhook sync).

**Blocker until step 1:** QuickBooks company subscription inactive or billing problem.

---

## Quick reference — routes and labels

| Item | Value |
|------|-------|
| Frontend | `https://epermit-main-nine.vercel.app` |
| Create project | **Projects** → **New Project** → **Create New Project** |
| Billing | Project detail → **Billing** tab |
| M1 trigger | **Preview / Trigger M1** → **Preview Payload** / **Create Draft Invoice** |
| Backend status (public) | `GET /api/quickbooks/status` |
| Backend trigger | `POST /api/quickbooks/invoice/trigger` |

---

## Related documents

- [QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md](./QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md)
- [QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md)
- [ENV.md](./ENV.md)
