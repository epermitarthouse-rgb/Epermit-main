# QuickBooks Audit and Walkthrough

**Audit date:** 2026-08-26  
**Scope:** End-to-end trace of QuickBooks invoicing in PermitPilot. **No secret values included.**

---

## 1. Implementation status summary

| Capability | Status | Evidence |
|------------|--------|----------|
| QuickBooks OAuth connection | **Live in production** | `GET /api/quickbooks/status` → `connected: true`, `environment: production` |
| Milestone invoicing (M1/M2/M3) | **Implemented — manual trigger** | `BillingInvoicePanel.tsx` → `POST /api/quickbooks/invoice/trigger` |
| Draft invoice creation in QBO | **Implemented** | `qb-api.service.js` → `createDraftInvoice` |
| Dry-run preview (no Intuit call) | **Implemented** | `dryRun: true` in trigger body |
| UCI passthrough invoicing (post utility payment) | **Implemented — automated path** | `uci-qb-passthrough.service.js`, lifecycle scheduler retry |
| QuickBooks webhooks from Intuit | **Not implemented** | No webhook route in `quickbooks.routes.js` |
| n8n automation | **Not used** | No n8n workflows or exports in repository (see §12) |
| Payment sync / invoice paid status | **Not implemented** | One-way create only; no Intuit webhook handler |

**Classification:** **Partial live implementation** — OAuth + draft invoice creation work in production; milestone triggers are manual UI actions; UCI passthrough is backend-automated when costs are marked paid.

---

## 2. Frontend components

| Component | Path | Role |
|-----------|------|------|
| `BillingInvoicePanel` | `src/components/projects/BillingInvoicePanel.tsx` | M1/M2/M3 milestone UI, dry-run preview, live trigger, QB connection messaging |
| `ProjectFormDialog` | `src/components/projects/ProjectFormDialog.tsx` | Client name/email, contract value, service type (billing fields) |
| `ProjectDetailDialog` | `src/components/projects/ProjectDetailDialog.tsx` | Embeds billing panel |
| `OperationsReimbursablesPanel` | `src/components/operations/OperationsReimbursablesPanel.tsx` | Operations view of reimbursables |
| `UciD13WorkflowPanels` | `src/components/uci/UciD13WorkflowPanels.tsx` | Stage 7 cost rows; shows `quickbooks_invoice_id` when present |

**OAuth start URL (browser):** `{scraperBaseUrl}/api/quickbooks/oauth/start` (redirect to Intuit).

---

## 3. Railway backend routes and services

### Routes (`scraper-service/app/routes/quickbooks.routes.js`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/quickbooks/oauth/start` | Redirect to Intuit authorization |
| GET | `/api/quickbooks/oauth/callback` | Exchange code, store encrypted refresh token |
| GET | `/api/quickbooks/status` | Connection status (no secrets) |
| POST | `/api/quickbooks/invoice/trigger` | Milestone invoice dry-run or create |
| POST | `/api/quickbooks/dev/payload-preview` | Offline payload (dev; gated in production) |
| POST | `/api/quickbooks/dev/customer-test` | Live API test (dev flag) |
| GET | `/api/quickbooks/dev/items` | List QBO items (dev flag) |

Mounted in `register-execution-routes.js`: `app.use("/api/quickbooks", createQuickBooksRouter({ supabase }))`.

### Services

| Service | Path | Role |
|---------|------|------|
| `qb-config.js` | OAuth/API config from env | |
| `qb-oauth.service.js` | Authorization URL, token exchange, refresh | |
| `qb-token-store.js` | Persist connection in Supabase | |
| `qb-token-crypto.js` | AES-256-GCM for refresh tokens | |
| `qb-api.service.js` | QBO API: customers, items, invoices | |
| `qb-invoice-payload.js` | Build invoice JSON (lines, dates, memos) | |
| `qb-invoice-trigger.service.js` | Milestone trigger orchestration | |
| `qb-project-customer.service.js` | Resolve/create QBO customer from project | |
| `qb-due-dates.js` | Net 10 **business day** due date (Mon–Fri; no holidays) | |
| `uci-qb-passthrough.service.js` | UCI cost → QBO invoice after `paid_at` | |

---

## 4. Supabase tables and columns

| Table / object | Role |
|----------------|------|
| `quickbooks_connections` | OAuth realm, encrypted refresh token, environment (`sandbox`/`production`) |
| `projects.qb_customer_id` | Linked QBO customer |
| `projects.qb_invoice_id_m1/m2/m3` | Created invoice IDs per milestone |
| `projects.m1/m2/m3_triggered*` | Trigger timestamps and source |
| `projects.contract_value`, `client_name`, `client_email`, `service_type` | Invoice inputs |
| `projects.reimbursement_amount`, `reimbursement_description` | Optional line items |
| `coordination_costs.quickbooks_invoice_id` | UCI passthrough invoice ID |
| `coordination_costs.qb_sync_status`, `qb_last_error` | UCI sync state (from UCI cost services) |

Migrations:

- `20260505120000_quickbooks_oauth_foundation.sql`
- `20260507200000_quickbooks_encrypted_refresh_tokens.sql`
- `20260508120000_quickbooks_connections_unique_environment.sql`

**RLS:** `quickbooks_connections` has RLS enabled with **no client policies** — backend service role only.

---

## 5. Request and payload structures (redacted)

### 5.1 Milestone trigger — `POST /api/quickbooks/invoice/trigger`

**Request body:**

```json
{
  "projectId": "<uuid>",
  "milestone": "M1",
  "dryRun": true,
  "reimbursementAmount": 0,
  "reimbursementDescription": "",
  "qbItemId": "<optional QBO Item Id>"
}
```

**Dry-run success response:**

```json
{
  "dryRun": true,
  "milestone": "M1",
  "payload": {
    "CustomerRef": { "value": "DRY_RUN_CUSTOMER" },
    "TxnDate": "YYYY-MM-DD",
    "DueDate": "YYYY-MM-DD",
    "CustomerMemo": { "value": "Permit <permit> — <project>" },
    "PrivateNote": "<audit string>",
    "Line": [
      {
        "DetailType": "SalesItemLineDetail",
        "Amount": 4000.0,
        "Description": "Initial / project setup milestone — <service> (M1)",
        "SalesItemLineDetail": {
          "ItemRef": { "value": "DRY_RUN_ITEM" },
          "Qty": 1,
          "UnitPrice": 4000.0
        }
      }
    ]
  },
  "totals": {
    "baseMilestoneAmount": 4000.0,
    "reimbursementAmount": 0,
    "adminFeeAmount": 0,
    "totalInvoiceAmount": 4000.0
  }
}
```

**Live success response:**

```json
{
  "dryRun": false,
  "milestone": "M1",
  "invoice": { "id": "<QBO Invoice Id>" },
  "totals": { "...": "..." }
}
```

**Error response shape:**

```json
{
  "error": "<code>",
  "message": "<human-readable>"
}
```

Common error codes: `invoice_trigger_validation_failed`, `invoice_already_triggered`, `quickbooks_not_connected`, `quickbooks_item_missing`, `invoice_trigger_failed`.

### 5.2 OAuth callback (Intuit → scraper)

Query parameters: `code`, `realmId`, `state` (state **not yet validated** — CSRF TODO), optional `error`.

Redirects to `QB_SUCCESS_REDIRECT_URL` or `QB_FAILURE_REDIRECT_URL` with `qb_error` query param on failure.

### 5.3 UCI passthrough (internal)

Triggered from `uci-cost-tracker.service.js` when `paid_at` set and no `quickbooks_invoice_id`. Uses `RequestId = coordination_costs.id` for idempotency query in QBO.

---

## 6. Processing and approval sequence

### Milestone billing (PermitPilot projects)

1. Operator sets **contract value** and **client name/email** on project.
2. Operator opens billing panel → checks QB status (frontend calls `/api/quickbooks/status`).
3. **Dry run:** POST trigger with `dryRun: true` → preview payload/totals.
4. **Live:** POST with `dryRun: false`:
   - Validate project fields and duplicate milestone guard
   - Ensure QB connection + refresh access token
   - Resolve/create QBO customer (`qb-project-customer.service.js`)
   - Resolve QBO Item (service_type name → `QB_DEFAULT_ITEM_ID` → `QB_DEFAULT_ITEM_NAME`)
   - Build payload (`qb-invoice-payload.js`): 40/40/20% split, optional reimbursement + 15% admin fee
   - POST draft invoice to QBO
   - Update `projects` milestone columns

**No multi-step human approval workflow** beyond operator clicking trigger. No manager sign-off in code.

### UCI passthrough billing

1. Utility cost marked paid (`paid_at`) in UCI cost tracker.
2. Lifecycle scheduler / cost update hook invokes `uci-qb-passthrough.service.js`.
3. Idempotency: query QBO by RequestId before create.
4. On success, store `quickbooks_invoice_id` on cost row.
5. On uncertain/retryable errors, scheduler retries per `UCI_QB_RETRY_MS` (default 5 min).

---

## 7. Error handling and retry

| Path | Behavior |
|------|----------|
| Milestone trigger | HTTP status mapped from `InvoiceTriggerError`; no automatic retry |
| Token refresh failure | 503 `quickbooks_token_refresh_failed` |
| QBO API errors | Wrapped as `QuickBooksApiError` with Intuit fault message |
| UCI passthrough | Classifies retryable vs non-retryable; subscription inactive detected; scheduler retry |
| Partial failure | If QBO invoice created but Supabase update fails, error includes invoice id in message |

---

## 8. Authentication approach

| Layer | Mechanism |
|-------|-----------|
| Intuit OAuth 2.0 | Authorization code flow; refresh token encrypted at rest (`QB_TOKEN_ENCRYPTION_KEY`) |
| Access token | Process memory cache only; refreshed ~2 min before expiry |
| API routes | `/invoice/trigger` and `/status` are **not JWT-gated** in router — **callable without user auth** |
| OAuth start/callback | Browser redirects; callback stores connection globally (latest connection per environment) |

**Security gap (verified):** Invoice trigger endpoint lacks Bearer JWT / admin check. Mitigation required for diligence (network restriction, auth middleware, or internal-only routing).

---

## 9. Business-day and holiday logic

Implemented in `qb-due-dates.js`:

- **Net 10 business days** from invoice date
- Monday–Friday count; **Saturday/Sunday skipped**
- Invoice date itself **not counted**
- **US public holidays not excluded** (verified from code — weekdays only)

---

## 10. Gaps vs intended workflow

| Intended (inferred from UI copy / Lovable reference) | Actual |
|------------------------------------------------------|--------|
| Admin invoicing console | Project-level `BillingInvoicePanel` only |
| Automated milestone triggers on project events | Manual trigger only |
| Payment received / paid status sync | Not implemented |
| Multi-approver billing workflow | Not implemented |
| CSRF-safe OAuth | State not validated (TODO in code) |
| Authenticated invoice API | Open POST on scraper URL |
| Holiday-aware due dates | Weekday-only business days |
| n8n orchestration | Not present |

---

## 11. n8n usage

**n8n is not used** anywhere in the PermitPilot implementation for QuickBooks or other workflows.

Repository search found `n8n` only in unrelated `package-lock.json` metadata and a third-party HTML artifact — not application code.

---

## 12. n8n workflow exports

**Not applicable.** No n8n JSON export exists or is required for this codebase.

---

## 13. 60–90 minute PermitPilot walkthrough agenda

**Audience:** Incoming tech lead + finance/ops stakeholder  
**Duration:** 75 minutes (adjust ±15)

| Time | Topic | Activities |
|------|-------|------------|
| 0:00–0:10 | **System map** | Frontend (Vercel) → Supabase → Railway scraper; where QB fits |
| 0:10–0:20 | **Accounts & ownership** | GitHub, Railway, Vercel, Supabase, Intuit app ownership; shared vault env categories |
| 0:20–0:35 | **QuickBooks implementation (deep dive)** | OAuth flow demo; `/status`; milestone M1/M2/M3 math; dry-run vs live; UCI passthrough; tables touched; known auth gap |
| 0:35–0:45 | **Live demo path** | Project with contract value → dry-run → (optional sandbox) live draft; show QBO draft invoice |
| 0:45–0:55 | **UCI billing intersection** | Stage 7 costs, `paid_at`, passthrough idempotency, scheduler retry |
| 0:55–1:05 | **Deploy & env** | `QB_*` vars on Railway; rotation procedure; `DEPLOY.md` / `ENV.md` pointers |
| 1:05–1:12 | **Restore & risk** | What happens if QB tokens lost; re-OAuth procedure; no webhook replay |
| 1:12–1:15 | **Q&A and action items** | CSRF fix, API auth, holiday calendar decision, Vercel account transfer |

**QuickBooks segment (≈30 min):** Rows 0:20–0:45 above.

---

## 14. Production verification performed (read-only)

| Check | Result |
|-------|--------|
| `GET /api/quickbooks/status` on production Railway | `connected: true`, `environment: production` |
| QB env in production | **Inferred** production (not sandbox) from API response |
| Code on production deploy | Commit `da66200` includes QB routes |

**Manual confirmation still required:** Which QBO company (legal entity) the realm ID represents, and who owns the Intuit developer application.
