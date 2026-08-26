# QuickBooks Audit and Walkthrough

**Document date:** 2026-08-26  
**No secret values included.**

Index: [README.md](./README.md)

---

## 1. Production status (precise)

| Statement | Classification |
|-----------|----------------|
| QuickBooks OAuth + invoice code exists on `main` and Railway | **Verified** (source) |
| Production `/api/quickbooks/status` returned HTTP 200 with `connected: true`, `environment: production` | **Verified** read-only (2026-08-26) |
| A **successful live production invoice** was created during this audit | **Not verified** |
| UCI passthrough invoice code exists | **Verified** (`uci-qb-passthrough.service.js`) |
| UCI passthrough **live invoice success** | **Not verified** |

**Wording:** Connection **state** is visible; **invoice creation success** is not proven by the status endpoint alone.

---

## 2. n8n

| Statement | Classification |
|-----------|----------------|
| Application-runtime n8n integration | **Not found** in repository |
| n8n workflow JSON exports | **Not found** |
| n8n export for this implementation | **Not applicable** |

**Note:** External systems outside this repository were **not inspected**.

---

## 3. Implementation map

| Layer | Location |
|-------|----------|
| UI | `src/components/projects/BillingInvoicePanel.tsx`, UCI Stage 7 panels |
| Routes | `scraper-service/app/routes/quickbooks.routes.js` |
| Services | `scraper-service/app/services/quickbooks/*`, `uci-qb-passthrough.service.js` |
| DB | `quickbooks_connections`, `projects.qb_*`, `coordination_costs.quickbooks_invoice_id` |

See prior audit sections in git history `fd49b29` for payload shapes (redacted).

---

## 4. Security gaps (documentation only — see backlog)

| Gap | Severity |
|-----|----------|
| `POST /api/quickbooks/invoice/trigger` — **no JWT/auth** | **Critical** |
| OAuth `state` not validated | **High** |
| `GET /api/quickbooks/status` — public metadata | **Medium** — consider auth or minimal response |

**Not implemented in this task.** [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md)

---

## 5. Business-day logic

**Verified:** `qb-due-dates.js` — Net 10 **weekdays** (Mon–Fri); invoice date excluded; **US public holidays not excluded**.

**Requires manual confirmation:** whether finance policy requires holiday calendar.

---

## 6. Walkthrough agenda (75 min) — **default: dry-run / sandbox**

| Time | Topic |
|------|-------|
| 0:00–0:10 | System map — where QuickBooks fits |
| 0:10–0:20 | Accounts, vault, Intuit app ownership (**manual**) |
| 0:20–0:50 | **QuickBooks deep dive** — OAuth, M1/M2/M3, dry-run payload, UCI passthrough, tables, auth gaps |
| 0:50–1:00 | **Dry-run demo** — `dryRun: true` trigger only |
| 1:00–1:10 | Env vars on Railway (`QB_*`) |
| 1:10–1:15 | Q&A + backlog items |

**Live production invoice demo:** only with **explicit approval** — not default.

---

## 7. Related

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ENV.md](./ENV.md)
