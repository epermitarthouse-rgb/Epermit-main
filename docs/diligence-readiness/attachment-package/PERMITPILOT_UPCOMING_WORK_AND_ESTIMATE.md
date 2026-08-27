# PermitPilot Upcoming Work and Estimate

**Document date:** 2026-08-27  
**Code reference:** `main` @ `331fa80`  
**Parent audit:** [PERMITPILOT_360_PRODUCTION_AUDIT.md](./PERMITPILOT_360_PRODUCTION_AUDIT.md)  
**Feature matrix:** [PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md](./PERMITPILOT_FEATURE_CONNECTIVITY_MATRIX.md)

No hourly rate or financial totals — engineering hours only. Estimates include build, test, deploy, and documentation unless noted.

---

## 1. Prioritized backlog (P0–P3)

| ID | Priority | Workstream | Task | Root gap | Impact | Dependencies | Acceptance criteria | Evidence |
|----|----------|------------|------|----------|--------|--------------|---------------------|----------|
| PP-001 | **P0** | Reliability | Merge + deploy Supabase frontend env fix | Hardcoded `supabase.ts` on main | Config drift; wrong env in multi-stage deploys | Vercel value confirmation; `fix/frontend-supabase-env-config` | Env-only config on main; post-merge smoke test passes | `src/lib/supabase.ts`, backlog #6 |
| PP-002 | **P0** | Reliability | Supabase backup + Storage policy verification | RPO/RTO unknown | Data loss recovery risk | Dashboard access | Documented retention, PITR state, Storage recovery path | `RESTORE.md` |
| PP-003 | **P0** | Billing | Restore QuickBooks subscription + live invoice E2E | QB company subscription inactive | Cannot prove billing E2E | Ian restores Intuit account | One successful M1 draft invoice in production; duplicate protection verified | `QUICKBOOKS_PRODUCTION_E2E.md` |
| PP-004 | **P0** | Security | Edge Function auth audit (51 functions) | All `verify_jwt = false` in config | Webhook/agent exposure risk | Security review time | Per-function matrix: public vs JWT vs service-role; fixes for gaps | `supabase/config.toml` |
| PP-005 | **P0** | Ops | Minimum ops dashboard (scrape + ingest + QB health) | Controls scattered | Incidents discovered late | PP-001 optional | Single admin view: job queues, last errors, QB status | Audit §5.3 |
| PP-006 | **P1** | Scrapers | Production UAT pass — core 6 jurisdictions | No recorded live E2E | Silent portal UI breakage | Portal credentials; operator time | Signed UAT checklist per jurisdiction (DC, PGC, MoCo, Howard, Baltimore, Arlington) | Scraper inventory §2 |
| PP-007 | **P1** | Scrapers | Arlington regression in CI (extend default test script) | Default `npm test` subset only | Regressions slip | CI minutes | GitHub Action runs Arlington + PGC unit tests on PR | `package.json` test script |
| PP-008 | **P1** | RAG | Auto-enqueue ingestion after scrape uploads | Manual ingest trigger | Stale/missing RAG context | Ingestion worker stable | New scraper uploads create `document_ingestion_jobs` automatically | Pipeline §3 |
| PP-009 | **P1** | RAG | OCR path for low-text PDFs | `LOW_TEXT_MSG` only | Grounded responses fail on scans | OCR provider decision | Worker or Edge OCR stage; chunks for scan test set | `worker.js` |
| PP-010 | **P1** | Comments | Intake pipeline production smoke + monitoring | Stage timeouts | Incomplete classifications | OpenAI quota | Scheduled smoke on fixture project; alert on stage failure | `intake-pipeline-agent` |
| PP-011 | **P1** | Filing | Permit filing UAT — DC + one MD jurisdiction | Execution enabled but unproven | Wrong submissions risk | Portal creds; PP-006 | Documented pre-flight + execution run with human abort | `permitFilingWip.ts` |
| PP-012 | **P1** | Billing | QB void/webhook → milestone reset | Not implemented | Manual DB fixes | Intuit webhook design | Void in QB clears `qb_invoice_id_m*` when matched | QB E2E doc § |
| PP-013 | **P1** | Ops | Staging restore drill | No tested restore | Unknown recovery time | Staging Supabase project | Documented restore with verification checklist | `RESTORE.md` |
| PP-014 | **P2** | Product | Connect Permit Queue to real data | UI shell | No cross-project visibility | Scrape/filing job APIs | Queue shows real jobs; no mock rows | `PermitQueuePlaceholder.tsx` |
| PP-015 | **P2** | Product | Operations Board — replace mock workflow/scope | Mixed mock/real | Misleading ops view | PP-005 | Workflow/scope from Supabase or disabled with honest empty state | `operations-demo-data.ts` |
| PP-016 | **P2** | Scrapers | Extract `server.js` Washington/PGC mappers | Monolith blocker | Hard to test/maintain | PP-007 | Mappers in modules; regression tests green | `scrapers/README.md` blockers |
| PP-017 | **P2** | Code Mod | Merge Code Mod local WIP + deploy | Uncommitted fixes | Production analyzer gaps | Owner approval | Deployed; `code-modification.test.js` green | IN_FLIGHT_STATUS |
| PP-018 | **P2** | Admin | Admin authorizations backend or remove nav | UI shell | False affordance | Product decision | Real CRUD or route removed | Placeholder page |
| PP-019 | **P2** | CI | Frontend unit tests in CI | No PR gate | UI regressions | GitHub Actions | `tsx --test` on critical paths | 120+ frontend tests exist |
| PP-020 | **P3** | Demo | McDonald's demo — wire live CTAs or label static | Upcoming CTAs | Demo confusion | Product decision | CTAs route to real features or stay explicitly static | `DemoMcDonalds.tsx` |
| PP-021 | **P3** | Marketing | ROI calculator copy audit | Placeholder risk | Wrong client-facing numbers | Content review | No placeholder numbers in production | `memory.md` |
| PP-022 | **P3** | Infra | IaC for Railway/Vercel | Manual dashboards | Slow rebuild | Platform choice | Terraform/Pulumi or runbook parity | Remediation backlog |
| PP-023 | **P3** | UCI boundary | UCI live-data pilot (2–3 projects) | Synthetic only | UCI not client-ready | Ian documents; §B scope | Pilot report with extraction accuracy | `TECHNICAL_EFFORT_ESTIMATES.md` §B |

---

## 2. AI-assisted engineering estimates

Confidence: **Medium** — based on codebase size, existing tests, and prior diligence; **Low** where portal UI volatility or external accounts dominate.

Uncertainty drivers: portal UI changes, document quality, client review latency, Supabase/Railway dashboard access.

### 2.1 P0 reliability + security (PP-001 – PP-005)

| Task group | Optimistic (h) | Realistic (h) | Upper bound (h) | Confidence |
|------------|---------------:|--------------:|----------------:|------------|
| Supabase env fix merge + smoke | 4 | 8 | 12 | High |
| Backup/Storage verification + doc | 4 | 8 | 12 | Medium |
| QB live E2E (after subscription restored) | 4 | 8 | 16 | Medium |
| Edge Function auth audit + critical fixes | 24 | 40 | 64 | Low |
| Minimum ops dashboard | 24 | 40 | 56 | Medium |
| **Subtotal P0** | **60** | **104** | **160** | |

### 2.2 P1 workflow completion (PP-006 – PP-013)

| Task group | Optimistic (h) | Realistic (h) | Upper bound (h) | Confidence |
|------------|---------------:|--------------:|----------------:|------------|
| Scraper UAT (6 jurisdictions) | 24 | 48 | 80 | Low |
| Scraper CI expansion | 8 | 16 | 24 | High |
| Ingestion auto-enqueue | 8 | 16 | 24 | Medium |
| OCR integration (minimal) | 24 | 40 | 64 | Low |
| Intake monitoring | 8 | 16 | 24 | Medium |
| Permit filing UAT | 16 | 32 | 48 | Low |
| QB webhook/milestone sync | 16 | 24 | 40 | Medium |
| Restore drill | 12 | 20 | 28 | Medium |
| **Subtotal P1** | **116** | **212** | **332** | |

### 2.3 P2 product hardening (PP-014 – PP-019)

| Task group | Optimistic (h) | Realistic (h) | Upper bound (h) | Confidence |
|------------|---------------:|--------------:|----------------:|------------|
| Permit Queue backend + UI | 24 | 40 | 56 | Medium |
| Operations Board de-mock | 16 | 28 | 40 | Medium |
| server.js mapper extraction | 40 | 64 | 96 | Low |
| Code Mod merge + deploy | 8 | 16 | 32 | Medium |
| Admin authorizations decision | 4 | 12 | 24 | High |
| Frontend CI | 8 | 16 | 24 | High |
| **Subtotal P2** | **100** | **176** | **272** | |

### 2.4 P3 / optional (PP-020 – PP-023)

| Task group | Optimistic (h) | Realistic (h) | Upper bound (h) | Confidence |
|------------|---------------:|--------------:|----------------:|------------|
| Demo + marketing cleanup | 8 | 16 | 24 | High |
| IaC | 24 | 48 | 80 | Low |
| UCI pilot (separate scope) | 88 | 120 | 156 | Medium |

---

## 3. Calendar scenarios

Assumes single engineer; parallel work reduces calendar time but not hours.

### 3.1 PermitPilot core only (P0 + P1, excludes UCI pilot)

| Capacity | Optimistic | Realistic | Upper bound |
|----------|----------:|----------:|------------:|
| **Hours** | 176 | 316 | 492 |
| **15–20 h/week** | 9–12 weeks | 16–21 weeks | 25–33 weeks |
| **30–40 h/week** | 4–6 weeks | 8–11 weeks | 12–16 weeks |

### 3.2 Full roadmap (P0 through P2)

| Capacity | Optimistic | Realistic | Upper bound |
|----------|----------:|----------:|------------:|
| **Hours** | 276 | 492 | 764 |
| **15–20 h/week** | 14–18 weeks | 25–33 weeks | 38–51 weeks |
| **30–40 h/week** | 7–9 weeks | 12–16 weeks | 19–25 weeks |

### 3.3 Diligence-readiness sprint (recalculated 2026-08-27)

See [TECHNICAL_EFFORT_ESTIMATES.md](./TECHNICAL_EFFORT_ESTIMATES.md) §A — **32–56 h remaining** for handover tasks (restore drill, walkthrough, QB live proof after subscription). Orthogonal to product backlog above.

---

## 4. Next sprint options (recommendation: **Option A**)

### Option A — Minimum reliability (recommended)

**Scope:** PP-001, PP-002, PP-003 (when unblocked), PP-004 (triage + top 5 functions), PP-005 (MVP ops view), PP-007  
**Realistic effort:** ~**80–120 h**  
**Outcome:** Production config trustworthy, recovery documented, billing provable when QB active, critical security triaged, basic observability.

**Why recommend:** Highest risk reduction per hour before feature expansion. Aligns with diligence handover and investor confidence. Does not require UCI scope creep.

### Option B — Workflow completion

**Scope:** Option A + PP-006, PP-008, PP-010, PP-011  
**Realistic effort:** ~**180–260 h**  
**Outcome:** Core permit workflow (scrape → comments → RAG → filing) UAT-signed for primary jurisdictions.

**Tradeoff:** Depends on portal credential access and operator availability; calendar extends with client UAT participation.

### Option C — Full roadmap

**Scope:** P0 through P2 + optional P3  
**Realistic effort:** ~**490 h** (excludes UCI pilot §B)  
**Outcome:** Consolidated ops surfaces, CI gates, mapper refactor, Code Mod deployed.

**Tradeoff:** Multi-month calendar at part-time capacity; portal maintenance remains ongoing.

---

## 5. TECHNICAL_EFFORT_ESTIMATES.md revision note

**No revision required** to §A (diligence sprint) or §B (UCI pilot) — scopes remain accurate.

**Addendum (this audit):** PermitPilot **product hardening** beyond diligence is now quantified in §2–3 above. Prior §C "optional remediation" items partially **superseded** for QuickBooks auth (resolved on main). Update `TECHNICAL_REMEDIATION_BACKLOG.md` items #1–2 status when that file is next edited — not changed in this read-only audit pass.

---

## 6. Immediate actions (week 1)

1. Confirm Railway/Vercel deploy commits match `main` tip (`331fa80` era).
2. Ian: restore QuickBooks subscription → execute PP-003 live invoice test.
3. Dashboard: Supabase backup + Storage policy (PP-002).
4. Merge Supabase env fix after Vercel value check (PP-001).
5. Schedule 6-jurisdiction scraper UAT window (PP-006) — can run parallel to Option A.

---

## 7. Related documents

| Document | Role |
|----------|------|
| [TECHNICAL_EFFORT_ESTIMATES.md](./TECHNICAL_EFFORT_ESTIMATES.md) | Diligence + UCI pilot hours |
| [TECHNICAL_REMEDIATION_BACKLOG.md](./TECHNICAL_REMEDIATION_BACKLOG.md) | Known issues register |
| [QUICKBOOKS_PRODUCTION_E2E.md](./QUICKBOOKS_PRODUCTION_E2E.md) | Billing E2E status |
