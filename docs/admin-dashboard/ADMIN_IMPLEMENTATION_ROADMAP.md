# Admin Dashboard Implementation Roadmap — Governance Scope

**Version:** 2.1 (evidence-based)  
**Target:** [PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md](./PRODUCTION_ADMIN_DASHBOARD_ARCHITECTURE.md) v2.1  
**Excludes:** 18-module product ops dashboard; product module recreation inside admin

---

## 1. Repository evidence (2026-09-10)

Counts used to size work packages — no contingency buffers added.

| Asset | Count | Command / path |
|-------|------:|----------------|
| Admin pages | 8 | `Admin*.tsx`, `JurisdictionAdmin`, etc. |
| Admin components | 12 | `src/components/admin/` |
| Frontend `useRequireAdmin` / `isAdmin` gates | 13 files | `rg useRequireAdmin\|isAdmin src` |
| Frontend `has_project_*` refs | 6 | `src/**/*.tsx` |
| Railway `has_project_*` RPC calls | 23 | `scraper-service/**/*.js` |
| Railway `requireAuthenticatedUser` files | 7 | route + service files |
| Railway route handlers (`router.*`) | 166 | `scraper-service/app/routes/` |
| `register-execution-routes` handlers | 23 | `app.get/post/...` |
| Supabase RLS policies (migrations) | 314 | `CREATE POLICY` |
| Supabase functions (migrations) | 71 | `CREATE OR REPLACE FUNCTION` |
| Existing admin RPC | 1 | `admin_list_member_directory` |
| Portal credential HTTP routes | 4 | `portal-credentials.routes.js` |
| Portal credential decrypt / DB refs | 17 | `register-execution-routes.js` + services |
| Portal-data UI ecosystem | 34 files | `portal_data` / `PortalData` in `src/` |
| Priority product routes to assert | 14 | scrape(1) + filing(1) + documents(1) + portal-cred(4) + quickbooks(7) |
| New admin API endpoints (spec) | 14 | See data contracts doc |
| New tables + 1 column | 5 | 4 tables + `profiles.access_status` |
| New RPCs / functions (spec) | 14 | See data contracts doc |

---

## 2. Work packages

Hours: **Build** (implementation) · **Test** (automated) · **UAT** (manual acceptance).  
**Total** = sum of three columns per package.

### Phase 0 — Foundations

| ID | Package | Scope (evidence) | Build | Test | UAT | Total |
|----|---------|------------------|------:|-----:|----:|------:|
| WP-0.1 | Schema migration | 4 tables + `profiles.access_status` + TEXT enums | 10 | 6 | 2 | 18 |
| WP-0.2 | Core RPCs | 14 functions incl. `is_user_active`, audit append | 14 | 8 | 2 | 24 |
| WP-0.3 | Admin API skeleton | 14 endpoints + `requirePlatformAdmin` | 12 | 6 | 2 | 20 |
| WP-0.4 | Nav + redirects | 4-area tree; 8 pages rerouted; `hybridNav.ts` cleanup | 8 | 4 | 2 | 14 |
| | **Phase 0 subtotal** | | **44** | **24** | **8** | **76** |

### Phase 1 — Overview + directory (read-only)

| ID | Package | Scope (evidence) | Build | Test | UAT | Total |
|----|---------|------------------|------:|-----:|----:|------:|
| WP-1.1 | Overview page | KPIs + 6 risk rules + recent audit | 8 | 3 | 2 | 13 |
| WP-1.2 | Users directory | Extend `AdminMembers.tsx`; `admin_list_member_directory` | 10 | 5 | 2 | 17 |
| WP-1.3 | Effective permissions (read) | `admin_get_effective_permissions` + tab; legacy mode | 12 | 6 | 2 | 20 |
| WP-1.4 | Audit v1 | Merge `admin_activity_log` + `platform_audit_events`; filters | 10 | 5 | 2 | 17 |
| | **Phase 1 subtotal** | | **40** | **19** | **8** | **67** |

**Cumulative after Phase 1:** 143 h

### Phase 2 — Access writes + deactivation + product asserts

| ID | Package | Scope (evidence) | Build | Test | UAT | Total |
|----|---------|------------------|------:|-----:|----:|------:|
| WP-2.1 | User detail editor | 6 tabs; ACC-001–011 controls | 22 | 10 | 4 | 36 |
| WP-2.2 | Deactivate / activate | Auth ban + `access_status` + grant revoke; 7 middleware touchpoints | 10 | 8 | 3 | 21 |
| WP-2.3 | Feature permission writes + backfill | Role-default backfill script; 10 feature keys | 12 | 8 | 3 | 23 |
| WP-2.4 | Product route asserts | 14 priority routes (see §1) + shadow mode | 16 | 12 | 4 | 32 |
| WP-2.5 | Bulk review + export | ACC-012, ACC-013 | 6 | 3 | 2 | 11 |
| | **Phase 2 subtotal** | | **66** | **41** | **16** | **123** |

**Cumulative after Phase 2:** 266 h

### Phase 3 — Credentials + scraped-data scope

| ID | Package | Scope (evidence) | Build | Test | UAT | Total |
|----|---------|------------------|------:|-----:|----:|------:|
| WP-3.1 | Credential grant UI + RPCs | Grant-only model; revoke creator | 10 | 6 | 3 | 19 |
| WP-3.2 | Credential enforcement | 4 HTTP routes + 17 decrypt paths; replace owner RLS | 16 | 12 | 4 | 32 |
| WP-3.3 | Scraped-data scope | 34-file PortalDataViewer ecosystem + RLS wrapper | 14 | 8 | 4 | 26 |
| WP-3.4 | Credential use audit | Hook every decrypt path | 6 | 6 | 2 | 14 |
| | **Phase 3 subtotal** | | **46** | **32** | **13** | **91** |

**Cumulative after Phase 3:** 357 h

### Phase 4 — Platform polish + migration cutover

| ID | Package | Scope (evidence) | Build | Test | UAT | Total |
|----|---------|------------------|------:|-----:|----:|------:|
| WP-4.1 | Platform route split | `AdminPanel` → notifications, branding; `JurisdictionAdmin`; drip | 10 | 4 | 3 | 17 |
| WP-4.2 | Dev route cleanup | Remove 5 routes from nav; redirects | 4 | 2 | 1 | 7 |
| WP-4.3 | Auth test suite | 14 RPCs + 14 routes + deactivate + creator revoke | 8 | 14 | 4 | 26 |
| WP-4.4 | Migration cutover UAT | Phases B→C→D; legacy role golden tests | 4 | 4 | 8 | 16 |
| WP-4.5 | Runbook | `RUNBOOK.md` + architecture cross-links | 3 | 0 | 3 | 6 |
| | **Phase 4 subtotal** | | **29** | **24** | **19** | **72** |

**Cumulative after Phase 4:** 429 h

---

## 3. Total AI-assisted estimate

| Metric | Hours | Basis |
|--------|------:|-------|
| **Total** | **429** | Sum of 18 work packages (§2) |
| Build | 225 | |
| Test | 140 | |
| UAT | 64 | |

| Capacity | Calendar |
|----------|----------|
| 30–40 h/week | **11–14 weeks** |
| 15–20 h/week | **22–29 weeks** |

**Removed from v1:** ~360 h of operations modules.  
**No optimistic/upper-bound range** — totals derive from counted repo assets per package.

---

## 4. Critical path

```
WP-0.1 → WP-0.2 → WP-0.3 → WP-0.4
  → WP-1.* (read UI)
  → WP-2.2 deactivation before WP-2.4 enforce
  → WP-2.3 backfill before WP-2.4 shadow
  → WP-3.* credentials (depends on WP-0.2)
  → WP-4.4 cutover last
```

---

## 5. First implementation slice (after approval)

**Phase 0 + Phase 1 = 143 h:** four-area nav, Overview, read-only Users directory + effective permissions, Audit v1. **No product enforcement.**

---

## 6. Security and acceptance tests

| WP | Required tests |
|----|----------------|
| WP-0.3 | Non-admin JWT → 403 on all 14 admin endpoints |
| WP-1.3 | Effective JSON matches role defaults for viewer/editor/admin fixtures |
| WP-2.2 | Deactivated user: Auth ban, middleware 403, JWT refresh fails |
| WP-2.4 | Shadow logs match legacy access for 5 sample users |
| WP-3.2 | Creator with grant revoked → 403 on credential list/use |
| WP-3.2 | Password never in any response body |
| WP-4.3 | Full matrix: 10 feature keys × 4 project roles |
| WP-4.4 | Phase D: zero lockout vs Phase B baseline for production user sample |

**Production smoke:** Admin → deactivate test user → verify 403 → activate → verify login → confirm audit rows.

---

## 7. Documentation deliverables

| WP | Doc |
|----|-----|
| WP-0.1 | Migration notes (enum values, backfill order) |
| WP-2.3 | Role-default reference card |
| WP-3.2 | Credential grant runbook |
| WP-4.5 | `docs/admin-dashboard/RUNBOOK.md` |
