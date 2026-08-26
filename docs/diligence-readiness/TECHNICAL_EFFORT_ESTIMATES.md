# Technical Effort Estimates

**Document date:** 2026-08-26  
**No hourly rate or financial total** — hours only.

Work already completed in this diligence pass (~40–60 h equivalent): initial ten-document bundle, Replit/Lovable audits, corrections, Supabase fix preparation, remediation backlog.

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
| Backup verification | **Remaining** — needs Supabase dashboard |
| Safe staging restore drill | **Remaining** — needs staging project |
| Documentation review + PR merge | **Remaining** |
| One live PermitPilot walkthrough (incl. ~30 min QuickBooks, dry-run/sandbox) | **Remaining** |

### Excluded

QuickBooks security implementation, portal regression engineering, Vercel transfer execution, production migration execution, Code Analyzer development, UCI feature work, broad CI, optional remediation items (Section C).

### Hours

| | Low | High |
|---|-----|------|
| **Original total estimate** | 80 | 120 |
| **Already completed** | 40 | 60 |
| **Remaining** | 40 | 60 |

### Dependencies (cannot complete without)

- Vercel dashboard access
- Supabase dashboard (backups, migration list)
- Staging Supabase or approved disposable project for restore drill
- Shared vault read access for env reconciliation
- Ian/stakeholder time for walkthrough

### Three-week sprint fit

**Remaining 40–60 h fits a 3-week sprint** (≈15–20 h/week) if platform access is available in week 1. **Blocked** if Vercel/Supabase access delayed.

---

## B. Initial UCI live-data validation and hardening (pilot)

**Scope:** 2–3 client-selected real projects only — **not** full rollout.

### Included

- Secure intake of Ian’s documents into approved environment
- Validate existing extraction + stage flow on those projects
- Expected vs extracted comparison report
- Failure classification
- Fix **reusable** root causes found in pilot
- Re-test selected projects
- Update `ARCHITECTURE.md` / `ENV.md` with validated findings

### Excluded

All ten stages for all providers, Dominion portal adapter, firm-wide deployment, production certification, live submission rollout, unrelated features.

### Hours

| | Low | High |
|---|-----|------|
| **Estimate** | 120 | 200 |

### Assumptions

- Usable documents received within 1–2 weeks of kickoff
- Pilot projects represent typical electric/gas utility mix agreed with Ian
- Production/staging Supabase and Railway access available
- Synthetic paths remain disabled for pilot records

### Variables affecting range

- Document quality (native PDF vs scan)
- Number of discrepancies requiring parser changes vs manual review
- Client review turnaround

### Timeline after documents received

**6–10 weeks** engineering (120–200 h), overlapping client review.

---

## C. Optional future remediation (not in A or B)

See [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md):

- QuickBooks authorization + OAuth CSRF
- Holiday calendar decision
- PWA/workbox build fix
- Edge Function security review
- Infrastructure-as-code
- Wider scraper regression
- Account transfers
- Broader UCI rollout
- Backup automation hardening

**Separate scoping** when prioritized.
