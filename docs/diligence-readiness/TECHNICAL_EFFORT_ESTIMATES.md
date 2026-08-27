# Technical Effort Estimates

**Document date:** 2026-08-27  
**No hourly rate or financial total** — hours only.

---

## Summary — three separate figures

| Figure | Hours | Notes |
|--------|------:|-------|
| **1. Diligence completed to date** | `[MANUAL ENTRY REQUIRED]` | Use time records; repo shows extensive doc/audit delivery through 2026-08-27 |
| **2. Remaining diligence / handover** | **32–56 h** | Recalculated below — tasks genuinely still open after this package |
| **3. Upcoming PermitPilot production roadmap** | **316 h realistic** (P0+P1) | From 360° audit — **separate from diligence** — see [PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md](./PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md) |
| **UCI live-data pilot (separate)** | **88–156 h** | Unchanged — detailed breakdown still valid — §B below |

---

## A. PermitPilot diligence-readiness sprint

**Scope:** Ian's requested PermitPilot handover only.

### Completed (2026-08-27)

| Task | Status |
|------|--------|
| Repository/account inventory | **Done** |
| In-flight list + "what breaks first" | **Done** |
| Secret-location documentation (`ENV.md`) | **Done** — vault manually confirmed (client-side) |
| Architecture / Deploy / Restore / ENV | **Done** |
| QuickBooks walkthrough + production E2E docs | **Done** |
| Replit + Lovable retirement audits | **Done** |
| Documentation structure proposal | **Done** |
| Supabase frontend env fix preparation | **Done** (branch pushed; merge/deploy pending) |
| Supabase physical backup verification (7 daily) | **Done** |
| PITR status verification (disabled) | **Done** |
| WIP branch preservation (Code Mod, async-v2) | **Done** |
| 360° production audit + feature matrix + upcoming work | **Done** |
| Documentation merge to `main` | **Done** (this task) |
| Client email draft + requirement matrix | **Done** |

### Still open

| Task | Low (h) | High (h) |
|------|--------:|---------:|
| Supabase Storage policy / recovery path dashboard review | 2 | 4 |
| Safe staging restore drill (documented procedure) | 12 | 20 |
| Shared vault ↔ production env reconciliation (names only) | 4 | 8 |
| Vercel env **value** confirmation + Supabase fix merge coordination | 2 | 4 |
| Post-merge frontend smoke test | 2 | 4 |
| Live PermitPilot walkthrough (incl. QuickBooks dry-run segment) | 8 | 12 |
| QuickBooks live E2E after subscription restored (Ian action first) | 4 | 8 |
| Final cross-check / stakeholder Q&A | 2 | 4 |
| **Remaining total** | **36** | **64** |

**Recalculation note:** Prior **40–70 h** assumed backup verification, documentation merge, and WIP push were still open. With those complete, the realistic band is **32–56 h** at typical delivery efficiency (midpoint of adjusted tasks excluding overlap). Upper bound retains restore drill + walkthrough uncertainty.

### Dependencies (cannot complete without)

- Vercel dashboard access (values confirmation)
- Supabase dashboard (Storage policies)
- Staging Supabase or approved disposable project for restore drill
- Shared vault read access for env reconciliation
- Ian: QuickBooks subscription restoration for live invoice proof
- Ian/stakeholder time for walkthrough

### Three-week sprint fit

**Assumed capacity:** ≈15–20 engineering hours/week (≈45–60 h over three calendar weeks).

**Remaining 32–56 h** fits a **three-week sprint** if platform access is available in week 1. **Blocked** on QuickBooks live proof until subscription restored.

| Week | Focus (at 15–20 h/week) |
|------|-------------------------|
| 1 | Storage policy review; vault/env reconciliation; Vercel value confirmation |
| 2 | Staging restore drill; Supabase fix merge + smoke test (if approved) |
| 3 | Walkthrough; QuickBooks live retry (if unblocked); final Q&A |

---

## B. Initial UCI live-data validation and hardening (pilot)

**Scope:** 2–3 client-selected real projects only — **not** full rollout.

### Included

- Secure intake of 2–3 projects into approved environment (org repo + Railway + Supabase)
- Baseline run on existing extraction + stage flow
- Expected vs extracted comparison report
- Failure classification
- Fix **reusable** root causes found in pilot (parser/extraction/stage-flow only)
- Re-test selected projects
- Documentation and results report
- Client review allowance (calendar time, not all engineering hours)

### Excluded

All ten stages for all providers, Dominion portal adapter, firm-wide deployment, production certification, live submission rollout, unrelated features.

### Remaining hours (task breakdown — unchanged)

| Task | Low (h) | High (h) |
|------|--------:|---------:|
| Secure intake setup + document ingest (2–3 projects) | 8 | 16 |
| Baseline UCI runs per project | 12 | 20 |
| Expected-vs-extracted comparison + failure classification | 16 | 24 |
| Reusable extraction/parser fixes (pilot scope only) | 20 | 40 |
| Stage-flow fixes surfaced by pilot | 8 | 16 |
| Re-test on selected projects | 8 | 12 |
| Documentation updates + results report | 8 | 12 |
| Engineering buffer for unknowns | 8 | 16 |
| **Pilot engineering total** | **88** | **156** |

### Capacity and calendar timeline

| Assumption | Engineering hours | Calendar weeks |
|------------|------------------:|---------------:|
| Full-time engineering (~40 h/week) | 88–156 h | **≈3–4 weeks** after documents received |
| Part-time engineering (~20 h/week) + client review wait | 88–156 h | **≈5–8 calendar weeks** |

Client file delivery and document quality may extend **calendar** time but should not be counted as engineering hours in the table above.

---

## C. Optional future remediation (not in A or B)

See [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md).

**Separate scoping** when prioritized.

---

## D. Addendum — 360° production audit (2026-08-27)

Product-hardening estimates are **separate from diligence** (§A):

| Document | Scope |
|----------|-------|
| [PERMITPILOT_360_PRODUCTION_AUDIT.md](./PERMITPILOT_360_PRODUCTION_AUDIT.md) | Architecture, scrapers, RAG, security, ops |
| [PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md](./PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md) | Feature-level production status |
| [PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md](./PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md) | P0–P3 backlog + sprint options A/B/C |

**Recommended next sprint (Option A):** realistic **~80–120 h** — minimum production reliability.  
**Full P0+P1 roadmap:** realistic **~316 h** at 30–40 h/week ≈ **8–11 weeks**.
