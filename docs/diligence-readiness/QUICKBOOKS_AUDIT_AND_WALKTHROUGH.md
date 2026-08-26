# QuickBooks Audit and Walkthrough

**Document date:** 2026-08-26  
**No secret values included.**

Index: [README.md](./README.md)

---

## 1. Production status (precise)

| Statement | Classification |
|-----------|----------------|
| QuickBooks OAuth + invoice code exists on `main` and Railway | **Verified** (source) |
| Production `/api/quickbooks/status` returned HTTP 200 with `connected: true`, `environment: production` | **Verified** read-only (2026-08-26, pre-hardening) |
| Security hardening on branch `fix/quickbooks-core-hardening` | **Implemented locally** — JWT on trigger, OAuth state, status masking, milestone claim RPC |
| Hardening **deployed** to Railway | **Not verified** (no deploy in this task) |
| Hardening **production-verified** | **Not verified** |
| A **successful live production invoice** was created during this audit | **Not verified** |
| UCI passthrough invoice code exists | **Verified** (`uci-qb-passthrough.service.js`) |
| UCI passthrough **live invoice success** | **Not verified** |

**Wording:** Connection **state** is visible; **invoice creation success** is not proven by the status endpoint alone. The hardened flow is **not production-complete** until approved UAT including optional live production draft test.

---

## 2. Architecture — Railway backend (no n8n)

| Statement | Classification |
|-----------|----------------|
| QuickBooks orchestration runs in **Railway `scraper-service`** | **Verified** |
| n8n workflow or runtime dependency | **Intentionally not used** — not found in repository |
| Payment-status webhooks / paid-invoice sync | **Out of scope** — not implemented in this task |

External systems outside this repository were **not inspected**.

---

## 3. Implementation map

| Layer | Location |
|-------|----------|
| UI | `src/components/projects/BillingInvoicePanel.tsx`, `src/lib/quickbooksApi.ts` |
| Routes | `scraper-service/app/routes/quickbooks.routes.js` |
| Services | `scraper-service/app/services/quickbooks/*`, `uci-qb-passthrough.service.js` |
| OAuth state | `qb-oauth-state.service.js` (HMAC-signed, 15 min TTL, single-use nonce in-process) |
| Milestone idempotency | `qb-milestone-claim.service.js` + RPC `claim_project_milestone_invoice` |
| DB | `quickbooks_connections`, `projects.qb_*`, `projects.m*_invoice_trigger_status`, `coordination_costs.quickbooks_invoice_id` |

---

## 4. Security (branch `fix/quickbooks-core-hardening`)

| Control | Status |
|---------|--------|
| `POST /api/quickbooks/invoice/trigger` — Supabase JWT + `has_project_editor_access` | **Implemented locally** |
| OAuth `state` — signed, expiring, single-use nonce | **Implemented locally** |
| `GET /api/quickbooks/status` — public `{ connected }`; details require JWT; masked realm | **Implemented locally** |
| Milestone duplicate / concurrent claim | **Implemented locally** (RPC + status columns) |
| UCI RequestId idempotency | **Preserved** (existing passthrough service) |

---

## 5. Business-day logic

**Verified:** `qb-due-dates.js` — Net 10 **weekdays** (Mon–Fri); invoice date excluded; **US public holidays not excluded**.

**Pending business decision (Ian):** whether US federal holidays, observed holidays, or a custom Commun-ET calendar should apply. **No holiday logic was added in this task.**

---

## 6. Walkthrough / UAT

See **[QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md)** for step-by-step dry-run, sandbox, and authorization tests.

**Default for tomorrow:** authenticated dry-run → sandbox draft (if configured) → production dry-run → live production draft **only with explicit approval**.

---

## 7. Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ENV.md](./ENV.md)
- [QUICKBOOKS_UAT.md](./QUICKBOOKS_UAT.md)
- [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md)
