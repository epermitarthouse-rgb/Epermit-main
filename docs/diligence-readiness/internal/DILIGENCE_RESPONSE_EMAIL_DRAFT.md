# Diligence Response — Draft Email

**Document date:** 2026-08-27  
**Scope:** PermitPilot and UCI only — **Comprovare excluded**  
**Status:** Draft for sender review before send

---

## Email metadata

| Field | Value |
|-------|-------|
| **To** | `[PLACEHOLDER — Ian's email]` |
| **From** | `[PLACEHOLDER — sender email]` |
| **Subject** | PermitPilot & UCI — diligence package, estimates, and session availability |
| **Attachments** | See §Attachments below (Markdown folder/ZIP — sender to attach recordings separately) |

---

## Draft body

Hi Ian,

This email closes the PermitPilot and UCI diligence items from your two messages. **Comprovare is out of scope here** — we can schedule those walkthroughs separately.

---

### 1. Repository push — complete for PermitPilot/UCI

All PermitPilot and UCI work is in **`epermitarthouse-rgb/Epermit-main`**. You can review from your org login.

| Item | Status |
|------|--------|
| `main` (production) | Current — Railway SUCCESS on `331fa80` (2026-08-27) |
| Diligence documentation | Merged to `main` under `docs/diligence-readiness/` |
| WIP branches pushed | `wip/code-mod-uat-cleanup`, `feat/code-analyzer-async-v2` (experimental, **not deployed**) |
| `replit-agent` | Local git bundle archive — remote push failed due to unrelated history; no production dependency |
| Feature branches | UCI Track A+B, Supabase env fix, QuickBooks hardening — on org remote |

Nothing PermitPilot/UCI-critical remains only on a personal namespace or Replit.

---

### 2. Platform identity

| Platform | Account / project | Owner | Notes |
|----------|-------------------|-------|-------|
| GitHub | `epermitarthouse-rgb/Epermit-main` | `[PLACEHOLDER]` | Org repo — authoritative source |
| Railway | PermitPilot / Epermit-main | `[PLACEHOLDER]` | Production backend |
| Vercel | epermit-main | `[PLACEHOLDER]` | Production frontend |
| Supabase | InsightDC production | `[PLACEHOLDER]` | Postgres + Auth + Storage + Edge Functions |
| Intuit QuickBooks | Production company | `[PLACEHOLDER]` | OAuth connection verified; **subscription inactive** blocks live invoices |
| Shared vault | — | **Manually confirmed (client-side)** | Secrets stored in shared vault |

**Accounts/keys under developer email (migration list):** `[PLACEHOLDER — operator to insert]`

---

### 3. In-flight status — what breaks first

Full detail: `IN_FLIGHT_STATUS.md`

**PermitPilot:** External jurisdiction and utility **portals** break first — DOM changes, pagination, long attachment jobs, and session expiry. Verified risks include incomplete pagination, attachment timeouts, and overwrite regressions in some scrape modes. **QuickBooks** milestone invoicing depends on an active Intuit subscription (currently blocked). **Supabase Storage** is not included in database backups — separate recovery required. Documentation drift is an operational risk mitigated by this package.

**UCI:** **Not ready for client-team live use.** Synthetic/mock prototype only. Stalls first on **your documents** — we need 2–3 real projects' utility files before live-data validation. Mock pipeline lives in Railway UCI services and `/uci/*` frontend surfaces. All future live work uses **org repo + Railway + Supabase** — not Replit.

---

### 4. Four core docs (+ supporting package)

Delivered under `docs/diligence-readiness/`:

| Doc | Purpose |
|-----|---------|
| `ARCHITECTURE.md` | System map |
| `DEPLOY.md` | Deploy, verify, rollback |
| `RESTORE.md` | Backups, recovery gaps, restore order |
| `ENV.md` | Every env var and where values live |

Supporting audits, 360° production review, and estimates are in the same folder (see attachments).

---

### 5. QuickBooks / invoicing (30-minute walkthrough segment)

**Architecture:** Railway backend only — **no n8n** workflows, no n8n JSON exports in the repository.

**Implemented and deployed:**

- JWT + project-editor authorization on invoice trigger
- OAuth state validation (HMAC-signed, expiring)
- Encrypted token storage; shared company connection model
- Milestone claim RPC + duplicate protection
- Frontend token refresh (`46b00bb`)
- Production Item `Sales`; business-day due dates (weekdays; US holidays **not** excluded — confirm finance policy)

**Production dry-run verified (2026-08-27):**

- $10,000 contract → M1 40% → **$4,000** invoice
- Invoice date 2026-08-27; due date 2026-09-10
- $0 reimbursement line
- Authenticated request reached QuickBooks production company

**Live attempt:** QuickBooks rejected customer creation — **subscription period ended / billing problem**. No customer or invoice created. M1 remains safely failed/retryable. **Not an application defect.**

**After you restore the QuickBooks subscription:** we retry one controlled M1 live draft, verify duplicate protection, and confirm DB persistence. Payment-status webhooks remain out of scope.

**Recordings:** I will attach the earlier QuickBooks recording and a new recording through the hardened production dry-run.

Daniyal's Intuit email is **not** hardcoded — OAuth uses whichever authorized team member completes the flow.

---

### 6. Railway — Friday failures and current state

- **Current production:** HEALTHY — SUCCESS deploy on `331fa80` (2026-08-27)
- **Friday failures:** Two failed builds reported — exact logs from that window are **unavailable** for root-cause attribution. Failures occurred during active deployment work; current production is on a good build.
- We **cannot prove** whether a partial deployment served traffic without serve-window metadata.

Detail: `RAILWAY_PRODUCTION_STATUS.md` (reference only — not a primary attachment).

---

### 7. Supabase backups

- **7 daily physical backups verified** — dates 2026-08-20 through 2026-08-26
- **PITR disabled** (paid add-on; not enabled)
- **Storage objects excluded** from database backups — separate Storage recovery still required
- **Restore drill:** not yet performed — scheduled in remaining diligence scope

---

### 8. Replit and Lovable

| Platform | Verdict |
|----------|---------|
| **Replit** | No production dependency. Historical `replit-agent` branch archived locally (git bundle). Safe to retire Replit workspace after bundle verified. |
| **Lovable** | Reference/archive only. No runtime import. Exact duplicate docs consolidated. |

---

### 9. UCI sequencing

Per your requested order:

1. **This diligence sprint** (docs, repo push, walkthroughs) — largely complete; remaining handover hours below
2. **PermitPilot session first** — including QuickBooks segment
3. **UCI live-data validation** — after sessions, on 2–3 projects you select, once documents released
4. UCI hardening documented into same ARCHITECTURE.md / ENV.md as built

UCI is **blocked on your documents**, not engineering. Environment confirmation: **org repo + Railway + Supabase**.

---

### 10. Estimates (three separate figures)

#### A. Diligence completed to date

`[MANUAL ENTRY REQUIRED — insert from time records]`

#### B. Remaining diligence / handover

**32–56 engineering hours** — restore drill, Storage policy review, vault reconciliation, Vercel value confirmation, Supabase fix merge + smoke test, live walkthrough, QuickBooks live proof after subscription restoration.

Fits ~3 weeks at 15–20 h/week if platform access is available week 1.

#### C. Upcoming PermitPilot production roadmap (separate from diligence)

From 360° audit — **not** bundled into diligence hours:

| Sprint option | Realistic hours | Calendar (30–40 h/wk) | Outcome |
|---------------|----------------:|----------------------:|---------|
| **A — Minimum reliability** | 80–120 h | 2–4 weeks | Env fix, backup/Storage verification, QB live proof, Edge Function auth audit, minimum ops dashboard |
| **B — Workflow completion** | ~316 h (P0+P1) | 8–11 weeks | + scraper UAT, auto-ingestion, OCR, filing UAT, monitoring |
| **C — Full roadmap** | ~492 h (P0–P2) | 12–16 weeks | + Permit Queue, ops board, scraper refactor |

**Recommended:** Option A first — platform is operational for current use but not production-grade end-to-end.

Detail: `PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md`, `PERMITPILOT_360_PRODUCTION_AUDIT.md`

#### D. UCI live-data pilot (separate line item)

**88–156 engineering hours** — unchanged breakdown. Starts after your documents; ~3–4 weeks full-time after intake.

---

### 11. Session availability

Five 60–90 minute slots (PermitPilot session first):

| Slot | Availability |
|------|--------------|
| 1 | `[PLACEHOLDER]` |
| 2 | `[PLACEHOLDER]` |
| 3 | `[PLACEHOLDER]` |
| 4 | `[PLACEHOLDER]` |
| 5 | `[PLACEHOLDER]` |

---

### 12. Standing conditions acknowledged

- Documentation kept current as standing delivery condition on new work
- 30-day transition-assistance provision — ready to add to agreement at hourly rate

---

### 13. Attachments

Sender will attach this folder (or ZIP) plus QuickBooks recordings:

1. `REPOSITORY_AND_ACCOUNT_INVENTORY.md`
2. `IN_FLIGHT_STATUS.md`
3. `ARCHITECTURE.md`
4. `DEPLOY.md`
5. `RESTORE.md`
6. `ENV.md`
7. `TECHNICAL_EFFORT_ESTIMATES.md`
8. `TECHNICAL_REMEDIATION_BACKLOG.md`
9. `REPLIT_RETIREMENT_AUDIT.md`
10. `LOVABLE_RETIREMENT_AUDIT.md`
11. `QUICKBOOKS_AUDIT_AND_WALKTHROUGH.md`
12. `QUICKBOOKS_PRODUCTION_E2E.md`
13. `PERMITPILOT_360_PRODUCTION_AUDIT.md`
14. `PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md`
15. `PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md`

**Excluded from attachments:** `.env` files, credentials, raw source, stale Railway-only snapshot (available in repo for reference), duplicate UAT doc unless needed.

**PDFs:** Not generated — no established safe conversion process in repo. Markdown folder/ZIP provided.

---

### 14. What we are not claiming

- Full production-grade multi-user platform readiness
- UCI ready for client-team live use
- Successful live QuickBooks invoice (subscription blocker)
- Completed restore drill or PITR
- All Comprovare diligence items

---

Best,  
`[PLACEHOLDER — sender signature]`

---

## Related

- [DILIGENCE_REQUIREMENT_COVERAGE_MATRIX.md](./DILIGENCE_REQUIREMENT_COVERAGE_MATRIX.md) — diligence asks mapped to this email and evidence
