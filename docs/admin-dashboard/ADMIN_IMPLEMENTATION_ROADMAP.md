# Admin Dashboard Implementation Roadmap — Governance Scope

**Target:** Complete governance architecture in [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md)  
**Explicitly excludes:** 18-module product operations dashboard (superseded)

---

## Phase 0 — Foundations (week 1–2)

| Deliverable | Description |
|-------------|-------------|
| Migrations | `platform_audit_events`, `user_feature_permissions`, `user_scraped_data_scope`, `user_portal_credential_grants` |
| RPCs | `admin_append_audit_event`, `has_role` guards, skeleton `admin_get_effective_permissions` |
| Admin API | `/api/admin/v1` router + `requirePlatformAdmin` |
| Shell | Nav restructure: Overview, Access, Audit, Platform |
| Redirects | Legacy `/admin/members`, `/admin/jurisdictions` paths |

| Task | Build h | Test h | Deploy/docs h | Total h |
|------|--------:|-------:|--------------:|--------:|
| Schema + RPCs | 16 | 8 | 4 | 28 |
| Admin API skeleton | 12 | 6 | 2 | 20 |
| Nav + redirects | 12 | 4 | 2 | 18 |
| **Phase 0** | **40** | **18** | **8** | **66** |

---

## Phase 1 — Overview + Users directory (week 3–4)

| Deliverable | Description |
|-------------|-------------|
| Overview page | Metrics, risks, recent audit |
| Users directory | Extend AdminMembers → `/admin/access/users` |
| Effective permissions read | RPC returns JSON; read-only tab |
| Audit page v1 | Unified `platform_audit_events` + legacy log |

| Task | Build h | Test h | Deploy/docs h | Total h |
|------|--------:|-------:|--------------:|--------:|
| Overview | 10 | 4 | 2 | 16 |
| Directory polish | 12 | 6 | 2 | 20 |
| Effective permissions (read) | 14 | 8 | 2 | 24 |
| Audit expansion | 10 | 6 | 2 | 18 |
| **Phase 1** | **46** | **24** | **8** | **78** |

**Cumulative:** 144 h

---

## Phase 2 — Access writes + enforcement (week 5–7)

| Deliverable | Description |
|-------------|-------------|
| User detail editor | Project roles, feature matrix, scopes |
| Activate/deactivate | Supabase admin API wrapper |
| Platform role grant/revoke | Final-admin guard |
| Product enforcement | `assert_feature_access` in key Railway routes |
| Bulk review + export | ACC-012, ACC-013 |

| Task | Build h | Test h | Deploy/docs h | Total h |
|------|--------:|-------:|--------------:|--------:|
| Access write UI | 20 | 10 | 4 | 34 |
| Feature permission RPCs | 16 | 12 | 4 | 32 |
| Product route asserts (scrape, portal-data) | 18 | 12 | 4 | 34 |
| Bulk review/export | 8 | 4 | 2 | 14 |
| **Phase 2** | **62** | **38** | **14** | **114** |

**Cumulative:** 258 h

---

## Phase 3 — Portal credentials + scraped-data scope (week 8–9)

| Deliverable | Description |
|-------------|-------------|
| Credential grant UI | none/use/manage per user |
| Railway grant checks | `portal-credentials.routes.js`, scrape login paths |
| Scraped-data scope UI + RLS/RPC | PortalDataViewer enforcement |
| Credential use audit | Every decrypt path logs event |

| Task | Build h | Test h | Deploy/docs h | Total h |
|------|--------:|-------:|--------------:|--------:|
| Grant UI + RPCs | 14 | 8 | 2 | 24 |
| Backend credential enforcement | 16 | 12 | 4 | 32 |
| Scraped-data scope enforcement | 18 | 10 | 4 | 32 |
| **Phase 3** | **48** | **30** | **10** | **88** |

**Cumulative:** 346 h

---

## Phase 4 — Platform polish + cleanup (week 10)

| Deliverable | Description |
|-------------|-------------|
| Platform sub-routes | Split AdminPanel → notifications, branding, campaigns |
| Remove dev routes from nav | uci-action-tracker, authorizations, feature-flags |
| Authorization test suite | Full matrix coverage |
| Operator runbook | `docs/admin-dashboard/RUNBOOK.md` |

| Task | Build h | Test h | Deploy/docs h | Total h |
|------|--------:|-------:|--------------:|--------:|
| Platform route split | 12 | 4 | 4 | 20 |
| Cleanup + redirects | 6 | 4 | 2 | 12 |
| Auth test suite | 10 | 16 | 4 | 30 |
| Runbook | 4 | — | 8 | 12 |
| **Phase 4** | **32** | **24** | **18** | **74** |

**Cumulative:** 420 h

---

## Total AI-assisted estimate

| Metric | Hours |
|--------|------:|
| **Optimistic** | 320 |
| **Realistic** | **420** |
| **Upper bound** | 520 |

| Capacity | Calendar |
|----------|----------|
| 30–40 h/week | **10–12 weeks** |
| 15–20 h/week | **21–26 weeks** |

**Removed from v1 estimate:** ~360 h of operations modules (scrapers, ingestion, billing ops, UCI admin, system health).

---

## Critical path

```
Phase 0 (schema + API) → Phase 1 (read UI) → Phase 2 (writes + product asserts) → Phase 3 (credentials + scope) → Phase 4 (polish)
```

**Blockers:** PP-001 Supabase env fix (frontend reads); product route touch requires regression on scrape/filing paths.

---

## First implementation slice (after approval)

**Phase 0 + Phase 1** (~144 h realistic): New nav, Overview, Users directory with read-only effective permissions, expanded Audit — **no product enforcement yet**.

---

## Security and acceptance tests

| Phase | Required tests |
|-------|----------------|
| 0 | Admin API rejects non-admin JWT |
| 1 | Overview metrics match DB counts; audit lists merge legacy + new |
| 2 | Feature write denied without membership; final-admin guard |
| 3 | Credential password never in response; use audited; scope denies portal_data |
| 4 | E2E: grant editor scrape.run write → user can enqueue; revoke → 403 |

**Production smoke:** Platform admin → Users → open test user → effective permissions load → change feature → audit row appears.

---

## Documentation per phase

| Phase | Docs |
|-------|------|
| 0 | Migration notes |
| 2 | Feature key reference for operators |
| 3 | Credential grant runbook |
| 4 | RUNBOOK.md + update ARCHITECTURE.md admin section |
