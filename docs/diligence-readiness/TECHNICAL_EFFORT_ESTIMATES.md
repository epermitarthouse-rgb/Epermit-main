# Technical Effort Estimates

**Document date:** 2026-08-26  
**No hourly rate or financial total** — hours only.

Work has already been completed on the initial documentation and audits. Actual completed hours must be inserted manually from time records before the estimate is sent to the client.

- **Actual hours completed:** `[MANUAL ENTRY REQUIRED]`

---

## A. PermitPilot diligence-readiness sprint

**Scope:** Ian’s requested PermitPilot handover only.

### Included

| Task | Status |
|------|--------|
| Repository/account inventory | **Done** (update as accounts confirmed) |
| In-flight list | **Done** |
| Secret-location documentation (`ENV.md`) | **Done** — vault reconciliation manual |
| Architecture / Deploy / Restore / ENV | **Done** |
| QuickBooks walkthrough agenda | **Done** |
| Replit + Lovable retirement audits | **Done** |
| Documentation structure proposal | **Done** |
| Supabase frontend env fix preparation | **Done** (branch pushed; merge/deploy pending) |
| Backup verification | **Remaining** — needs Supabase dashboard |
| Safe staging restore drill | **Remaining** — needs staging project |
| Documentation review + PR merge | **Remaining** |
| One live PermitPilot walkthrough (incl. ~30 min QuickBooks, dry-run/sandbox) | **Remaining** |
| Vercel env value confirmation + post-merge smoke test (after Supabase fix merge) | **Remaining** |

### Excluded

Replit/Lovable cleanup execution (unless separately approved), QuickBooks security implementation, PWA repair (not reproducible), new product work, portal regression engineering, account transfer execution, Code Analyzer development, UCI feature development, broad CI, optional remediation items (Section C).

### Remaining hours (task breakdown)

| Task | Low (h) | High (h) |
|------|--------:|---------:|
| Supabase backup / PITR + Storage policy dashboard review | 4 | 8 |
| Safe staging restore drill (documented procedure) | 12 | 20 |
| Shared vault ↔ production env reconciliation (names only; no values in docs) | 6 | 10 |
| Vercel env **value** confirmation + Supabase fix merge coordination | 2 | 4 |
| Post-merge frontend smoke test | 2 | 4 |
| Documentation review, PR merge, stakeholder Q&A | 4 | 8 |
| Live PermitPilot walkthrough (incl. QuickBooks dry-run segment) | 8 | 12 |
| Final cross-check / handover package | 2 | 4 |
| **Remaining total** | **40** | **70** |

### Dependencies (cannot complete without)

- Vercel dashboard access (names confirmed; values still need confirmation)
- Supabase dashboard (backups, migration list)
- Staging Supabase or approved disposable project for restore drill
- Shared vault read access for env reconciliation
- Ian/stakeholder time for walkthrough

### Three-week sprint fit

**Assumed capacity:** ≈15–20 engineering hours/week (≈45–60 h over three calendar weeks).

**Remaining 40–70 h** fits a **three-week sprint** if platform access is available in week 1. **Blocked** if Vercel/Supabase access or staging project is delayed.

| Week | Focus (at 15–20 h/week) |
|------|-------------------------|
| 1 | Supabase backup review; vault/env reconciliation; Vercel value confirmation |
| 2 | Staging restore drill; Supabase fix merge + smoke test (if approved) |
| 3 | Walkthrough; documentation PR merge; final handover |

---

## B. Initial UCI live-data validation and hardening (pilot)

**Scope:** 2–3 client-selected real projects only — **not** full rollout.

### Included

- Secure intake of 2–3 projects into approved environment
- Baseline run on existing extraction + stage flow
- Expected vs extracted comparison report
- Failure classification
- Fix **reusable** root causes found in pilot (parser/extraction/stage-flow only)
- Re-test selected projects
- Documentation and results report
- Client review allowance (calendar time, not all engineering hours)

### Excluded

All ten stages for all providers, Dominion portal adapter, firm-wide deployment, production certification, live submission rollout, unrelated features.

### Remaining hours (task breakdown)

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

### Variables affecting range

- Document quality (native PDF vs scan)
- Number of discrepancies requiring parser changes vs manual review
- Client review turnaround

---

## C. Optional future remediation (not in A or B)

See [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md):

- QuickBooks authorization + OAuth CSRF
- Holiday calendar decision
- Edge Function security review
- Infrastructure-as-code
- Wider scraper regression
- Account transfers
- Broader UCI rollout
- Backup automation hardening
- PWA/workbox — **monitoring only** (not reproducible locally; review Vercel history)

**Separate scoping** when prioritized.
