# UCI Compliance Checklist

**Living audit matrix against CET-2026-UCI-BACKEND-001**

Pre-filled from codebase gap analysis and PEPCO implementation review.  
**Active roadmap:** `UCI_DELIVERY_ROADMAP.md`

Re-audit before marking any item ✅ Pass.

---

## 0. Audit Legend

| Status | Meaning |
|--------|---------|
| ✅ Pass | Fully implemented and tested |
| ⚠️ Partial | Some work done; not complete or not production-ready |
| ❌ Missing | Not implemented |
| 🚫 Deferred | Client spec Phase 4/5 or explicit DEFER |
| 🔍 Verify | Needs codebase or live confirmation |
| 🧪 Needs Test | Built but not properly tested |

---

# 1. Product Vision / Scope Alignment

| # | Requirement | Status | Evidence / notes |
|---|-------------|--------|------------------|
| 1.1 | UCI separate module | ⚠️ Partial | `/api/uci`, `/uci` UI; distinct from county scrapers |
| 1.2 | Not county scraper | ⚠️ Partial | PEPCO under `scrapers/pepco/`; utility_providers table |
| 1.3 | Full lifecycle support | ⚠️ Partial | Stages 1–10 in DB; automation missing |
| 1.4 | Human in loop | ⚠️ Partial | Manual transitions; no submit/review flow yet |
| 1.5 | Routine work automated | ⚠️ Partial | PEPCO read-only sync only |
| 1.6 | Strategic decisions human | ⚠️ Partial | No auto-submit; no classifier auto-advance |
| 1.7 | Integrates PermitPilot | ⚠️ Partial | Auth, projects, credentials, Playwright reused |
| 1.8 | McDonald's pilot alignment | 🔍 Verify | Roadmap maps D1–D12 to client phases |

---

# 2. Architecture

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 2.1 | Backend conventions | ✅ Pass | Express router in scraper-service |
| 2.2 | Project model | ✅ Pass | `project_id` FK |
| 2.3 | Tenant model | ❌ Missing | `tenant_id` not propagated |
| 2.4 | User model | ⚠️ Partial | `user_id` on records; no `reviewed_by`/`submitted_by` writes |
| 2.5 | Shared agent runtime | ❌ Missing | Sync HTTP + in-memory sessions |
| 2.6 | No duplicate runtime | ✅ Pass | No second queue system |
| 2.7 | Stateless agents | ❌ Missing | No agents |
| 2.8 | State in Postgres | ⚠️ Partial | Lifecycle yes; PEPCO data in metadata |
| 2.9 | Queue not source of truth | ⚠️ Partial | No durable UCI jobs |
| 2.10 | Object storage | ❌ Missing | `debug/pepco-docs` only |
| 2.11 | Playwright infra reused | ✅ Pass | `playwright-launch-for-scraper.js` |
| 2.12 | Outbound email | ❌ Missing | |
| 2.13 | Inbound email pattern | ❌ Missing | |
| 2.14 | QuickBooks reuse | ❌ Missing | QB exists elsewhere, not UCI |
| 2.15 | Observability reuse | ⚠️ Partial | Console logs only |

---

# 3. Multi-Tenancy / Security

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | `tenant_id` on all tables | ❌ Missing | Nullable on records only; absent on children |
| 3.2 | RLS on all tables | ⚠️ Partial | Enabled; project-scoped not tenant-scoped |
| 3.3 | RLS matches spec pattern | ❌ Missing | Uses `has_project_access`, not `app.current_tenant_id` |
| 3.4 | Tenant A cannot read B | ❌ Missing | No cross-tenant tests |
| 3.5 | Tenant A cannot write B | ❌ Missing | |
| 3.6 | McDonald's isolation | ❌ Missing | |
| 3.7 | APIs enforce tenant | ⚠️ Partial | Project access only |
| 3.8 | Agents enforce tenant | ❌ Missing | |
| 3.9 | Prompts tenant-safe | ❌ Missing | No LLM agents |
| 3.10 | Credentials not in UI | ✅ Pass | Status only in Settings |
| 3.11 | No secrets in code | 🔍 Verify | |
| 3.12 | No secrets in .env.example | 🔍 Verify | |
| 3.13 | No secrets in logs | ⚠️ Partial | UCI services avoid token logging |
| 3.14 | `portal_credentials_ref` only | ⚠️ Partial | Uses `portal_credentials` table per user |
| 3.15 | QB tokens secure | 🔍 Verify | Not UCI |
| 3.16 | Anthropic key secure | 🔍 Verify | Not UCI yet |

---

# 4. Idempotency

| # | Requirement | Status |
|---|-------------|--------|
| 4.1 | Agent rerun safe | ❌ Missing |
| 4.2 | Submission idempotency | ❌ Missing |
| 4.3 | Email idempotency | ❌ Missing |
| 4.4 | QB idempotency | ❌ Missing |
| 4.5 | Claude idempotency | ❌ Missing |
| 4.6 | Transition idempotency | ⚠️ Partial | Audit always writes; no duplicate guard |
| 4.7 | Equipment ETA dedupe | ❌ Missing |
| 4.8 | Closeout package idempotency | ❌ Missing |
| 4.9 | Portal retry safe | ⚠️ Partial | UUID merge; session resume |
| 4.10 | Cron safe | ❌ Missing |

---

# 5. 10-Stage Lifecycle

## 5.1 Stage Model

| # | Requirement | Status |
|---|-------------|--------|
| 5.1.1 | Stages 1–10 | ✅ Pass | DB CHECK 1–10 |
| 5.1.2 | Stage names | ⚠️ Partial | Numbers only in UI |
| 5.1.3 | Completion meaning | ❌ Missing | No agent completion logic |
| 5.1.4 | Multiple records/project | ⚠️ Partial | One per provider default scope |
| 5.1.5 | Multiple scopes/utility | ⚠️ Partial | `scope_description` unique constraint |
| 5.1.6 | Flexible milestones | ❌ Missing | Table stub |

## 5.2 Stage States

| # | Requirement | Status |
|---|-------------|--------|
| 5.2.1–5.2.6 | All six states | ✅ Pass | DB + API validation |
| 5.2.7 | Explicit transitions | ⚠️ Partial | Manual + init only |
| 5.2.8 | agent/user/cron triggers | ⚠️ Partial | user + system init |
| 5.2.9 | Reason captured | ⚠️ Partial | Required for manual UI |
| 5.2.10 | Manual correction | ✅ Pass | POST transition |

## 5.3 Stage-by-Stage

| Stage | Status | Notes |
|-------|--------|-------|
| 1 Provider Mapping | ❌ Missing | Manual init only |
| 2 Load Profile | ❌ Missing | |
| 3 Application Prep | ❌ Missing | |
| 4 Submission | ❌ Missing | |
| 5 Acknowledgment | ❌ Missing | Column exists |
| 6 COS/Design Review | ❌ Missing | |
| 7 CIAC/Cost | ❌ Missing | |
| 8 Equipment | ❌ Missing | |
| 9 Pre-Energization | ❌ Missing | |
| 10 Energization/Closeout | ❌ Missing | |

---

# 6. Database Schema

## 6.1 `utility_providers`

| # | Field | Status |
|---|-------|--------|
| 6.1.1 | id | ✅ Pass |
| 6.1.2 | tenant_id | ❌ Missing | Global catalog |
| 6.1.3 | name | ✅ Pass |
| 6.1.4 | utility_type | ✅ Pass |
| 6.1.5 | ownership_type | ⚠️ Partial | Column nullable |
| 6.1.6 | service_territory | ⚠️ Partial | Column exists, unused |
| 6.1.7–6.1.12 | portal/SLA/active | ⚠️ Partial | Seeded; SLAs not operational |
| 6.1.13 | indexes | ⚠️ Partial | slug unique; no tenant index |
| 6.1.14 | RLS tenant | ❌ Missing | Read-all authenticated |

## 6.2 `coordination_records`

| # | Field | Status |
|---|-------|--------|
| 6.2.1 | tenant_id | ❌ Missing | Never written |
| 6.2.2–6.2.7 | core fields | ✅ Pass |
| 6.2.8–6.2.11 | timestamps/dates | ⚠️ Partial | Columns exist; not auto-set |
| 6.2.12 | agent_monitored | ✅ Pass | Default true |
| 6.2.13 | indexes | ✅ Pass |
| 6.2.14 | RLS | ⚠️ Partial | Project-scoped |

## 6.3–6.8 Child tables

| Table | Schema exists | Operational writes | RLS |
|-------|---------------|-------------------|-----|
| coordination_stage_transitions | ✅ Pass | ⚠️ Partial (manual/init) | ⚠️ Partial |
| coordination_applications | ✅ Pass | ❌ Missing | ⚠️ Partial |
| coordination_communications | ✅ Pass | ❌ Missing | ⚠️ Partial |
| coordination_costs | ✅ Pass | ❌ Missing | ⚠️ Partial |
| coordination_equipment | ✅ Pass | ❌ Missing | ⚠️ Partial |
| coordination_milestones | ✅ Pass | ❌ Missing | ⚠️ Partial |

---

# 7. Agent-by-Agent

| Agent | Status | Notes |
|-------|--------|-------|
| A1 Provider Mapper | ❌ Missing | Manual init ≠ agent |
| A2 Load Profile | ❌ Missing | |
| A3 Application Builder | ❌ Missing | |
| A4 Submission | ❌ Missing | PEPCO scrape ≠ submit |
| A5 Communication Parser | ❌ Missing | Messages in metadata only |
| A6 COS Analyst | ❌ Missing | |
| A7 Easement/ROW | 🚫 Deferred | |
| A8 CIAC/Cost | ❌ Missing | |
| A9 Equipment | ❌ Missing | |
| A10 Inspection Release | 🚫 Deferred | |
| A11 Meter Set | ❌ Missing | |
| A12 Energization/Closeout | ❌ Missing | |

*(Per-agent requirement rows A1.1–A12.12 inherit agent-level status unless noted in re-audit.)*

---

# 8. Predictive Energization

| # | Requirement | Status |
|---|-------------|--------|
| 8.1–8.4 | P50/P90 function | ❌ Missing | Columns exist |
| 8.5–8.6 | Baseline/delays | ❌ Missing |
| 8.7 | ML deferred | 🚫 Deferred |
| 8.8 | Portfolio display | ❌ Missing |

---

# 9. REST API

| # | Endpoint | Status |
|---|----------|--------|
| API.1 | List coordination | ✅ Pass |
| API.2 | Get coordination detail | ✅ Pass |
| API.3 | Manual transition | ✅ Pass |
| API.4 | Communication log | ❌ Missing | embedded recent only |
| API.5 | Trigger draft | ❌ Missing |
| API.6 | Review application | ❌ Missing |
| API.7 | Submit application | ❌ Missing |
| API.8 | Portfolio view | ❌ Missing |
| API.9 | Provider directory | ⚠️ Partial | global not tenant |
| API.10 | Escalate | ❌ Missing |
| API.11 | Needs attention | ❌ Missing |
| API.12 | Reclassify | ❌ Missing |
| API.13 | Auth required | ✅ Pass |
| API.14 | Tenant enforced | ❌ Missing |
| API.15 | API audit logging | ❌ Missing |
| API.16 | Validation | ✅ Pass | stage/state |
| API.17 | Error shape | ✅ Pass |

---

# 10. Event Bus

| Event | Status |
|-------|--------|
| E1–E16 all `uci.*` events | ❌ Missing |
| E17–E19 payload/bus integration | ❌ Missing |

---

# 11–12. Email Pipelines

| Area | Status |
|------|--------|
| Inbound (11.1–11.10) | ❌ Missing |
| Outbound (12.1–12.8) | ❌ Missing |

---

# 13. Portal Automation

| # | Requirement | Status |
|---|-------------|--------|
| 13.1 | Playwright infra | ✅ Pass |
| 13.2 | Per-utility versioned scripts | ⚠️ Partial | PEPCO only; not `uci/portals/` layout |
| 13.3–13.4 | Credentials secure | ✅ Pass |
| 13.5 | Login per utility | ⚠️ Partial | PEPCO only |
| 13.6 | Submission flow | ❌ Missing |
| 13.7–13.9 | Idempotency/confirmation/artifacts | ❌ Missing / ⚠️ Partial |
| 13.10–13.16 | Retry/fallback/tests/safe mode | ⚠️ Partial | MFA resume; limited tests |

## Priority Utility Coverage

| Utility | Portal automation | Email fallback | Smoke test |
|---------|-------------------|----------------|------------|
| PEPCO | ⚠️ Partial (read-only) | ❌ Missing | 🧪 Needs Test |
| BGE | ❌ Missing | ❌ Missing | ❌ Missing |
| Washington Gas | ❌ Missing | ❌ Missing | ❌ Missing |
| Dominion | ❌ Missing | ❌ Missing | ❌ Missing |
| FPL | ❌ Missing | ❌ Missing | ❌ Missing |
| Con Edison | ❌ Missing | ❌ Missing | ❌ Missing |
| PSE&G | ❌ Missing | ❌ Missing | ❌ Missing |
| Eversource | ❌ Missing | ❌ Missing | ❌ Missing |
| Duke Energy | ❌ Missing | ❌ Missing | ❌ Missing |
| Georgia Power | ❌ Missing | ❌ Missing | ❌ Missing |

---

# 14–15. Claude & QuickBooks

| Area | Status |
|------|--------|
| Anthropic integration (14.1–14.12) | ❌ Missing |
| QuickBooks UCI (15.1–15.11) | ❌ Missing |

---

# 16. Dashboard / Reporting

| # | Requirement | Status |
|---|-------------|--------|
| 16.1 | Basic dashboards | ⚠️ Partial | `/uci` basic |
| 16.2 | Portfolio API | ❌ Missing |
| 16.3–16.8 | Rollups/risks/queue | ❌ Missing |
| 16.9–16.10 | Quarterly/McDonald's config | ❌ Missing |
| 16.11 | Tenant-scoped dashboard | ❌ Missing |

---

# 17. Testing

| Area | Status |
|------|--------|
| T1 unit tests | 🧪 Needs Test | PEPCO parse/session only |
| T2 integration | ❌ Missing |
| T3 security cross-tenant | ❌ Missing |
| T4 portal mock | ❌ Missing |
| T5 classifier | ❌ Missing |

---

# 18–20. Observability, Alerting, Runbooks

| Area | Status |
|------|--------|
| O1–O10 structured logs | ⚠️ Partial |
| P0–P2 alerts | ❌ Missing |
| R1–R9 runbooks | ❌ Missing |

---

# 21. Data Retention / Backup

| # | Requirement | Status |
|---|-------------|--------|
| D1–D7 | Retention/DR | 🔍 Verify | Platform-level assumed |

---

# 22. Implementation Sequence (Client 10-Week)

| Week item | Status |
|-----------|--------|
| Schema + RLS + seed | ⚠️ Partial |
| Cross-tenant CI | ❌ Missing |
| Agents 1–4, 8–9, 11–12 | ❌ Missing |
| Agents 5–6 | ❌ Missing |
| Portfolio + observability | ❌ Missing |
| UAT | ❌ Missing |

---

# 23. Deferred Scope

| Feature | Status |
|---------|--------|
| Agent 7 | 🚫 Deferred |
| Agent 10 | 🚫 Deferred |
| Conflict hunter full | 🚫 Deferred |
| ML prediction | 🚫 Deferred |
| Knowledge graph full | 🚫 Deferred |

---

# 24. Final Client Acceptance

| # | Acceptance | Status |
|---|------------|--------|
| C1 | Project with UCI scope | ⚠️ Partial |
| C2 | Identify providers | ⚠️ Partial | manual |
| C3 | Load summary | ❌ Missing |
| C4 | Draft package | ❌ Missing |
| C5 | Human review before submit | ❌ Missing |
| C6 | Submit portal/email | ❌ Missing |
| C7 | Acknowledgment tracking | ❌ Missing |
| C8 | Parse communication | ❌ Missing |
| C9 | COS analysis | ❌ Missing |
| C10 | CIAC/cost | ❌ Missing |
| C11 | Equipment ETA | ❌ Missing |
| C12 | Meter set | ❌ Missing |
| C13 | Closeout | ❌ Missing |
| C14 | Portfolio dashboard | ❌ Missing |
| C15 | Tenant-safe | ❌ Missing |
| C16 | Idempotent agents | ❌ Missing |
| C17 | Portal debug artifacts | ⚠️ Partial |
| C18 | Credentials secure | ✅ Pass |
| C19 | Alerts/runbooks | ❌ Missing |
| C20 | Deferred scope clear | ⚠️ Partial | this checklist + roadmap |

---

# 25. Critical Red Flags (Current)

| Red flag | Present? |
|----------|----------|
| Credentials hardcoded/logged | 🔍 Verify — encryption in place |
| No RLS on UCI tables | No — RLS exists (project-scoped) |
| No tenant RLS | **Yes — gap** |
| Agent duplicates | N/A — no agents |
| Human review skipped | N/A — no submit |
| Real portal test submissions | 🔍 Verify |
| Stage changes without audit | No — transitions logged |
| Classifier auto-advance | N/A |
| QB duplicate invoice | N/A |
| Deferred scope claimed done | **Risk** — UI empty sections look like features |

---

*Derived from `uci_module_audit_checklist.md` with statuses pre-filled. Update per milestone completion.*
