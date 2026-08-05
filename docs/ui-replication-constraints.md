# UI Replication Constraints (Current → Future Lovable UI)

> Audit date: 2026-07-21  
> Purpose: Guardrails for a future page-by-page UI migration. Do **not** treat this as permission to rewrite backend behavior.

**Lovable audit inputs:** `docs/lovable-*` files were **missing** at audit time. Gap analysis (`lovable-vs-current-gap-analysis.md`), replication plan (`ui-replication-plan.md`), and route mapping JSON were **not** generated. Re-run comparison after Lovable docs exist.

---

## 1. Non-negotiable preserve list

Preserve without behavioral change unless explicitly redesigned with BE work:

| Layer | Preserve |
|-------|----------|
| Backend APIs | All `/api/*` scraper contracts, `/api/uci/*`, portal-credentials, filing, PermitWizard, OAuth callbacks |
| Edge Functions | Names, payloads, and auth expectations under `supabase/functions/` |
| Database | Tables, RLS helpers, triggers (esp. response approval), RPCs for invites/tenant access |
| Auth | Supabase email/password session, JWT to scraper, UCI refresh-on-401, admin via `user_roles` |
| Tenant / project access | `has_project_access*`, UCI `uci-access.service.js` checks |
| Scraper durability | Job statuses, Arlington worker, cancel/retry, file result lifecycle |
| Credentials | Encrypt-at-rest, no password echo to FE, server-side decrypt only |
| UCI lifecycle | Stage/state enums, transition APIs, PEPCO live-submit gate |
| Selected project | Continuity via context + URL/localStorage semantics |
| Document ingestion | Job queue + worker status machine |

---

## 2. Visual vs logic migration

| Safe to replace (visual) | Do not casually replace (logic) |
|--------------------------|----------------------------------|
| Page layouts, typography, spacing, marketing chrome | `lib/uciApi.ts`, `portalCredentialsApi.ts`, `ScrapeContext` polling contracts |
| Presentational components under `components/ui` restyles | Status string maps that drive BE (UCI stages, scrape statuses, comment response_status) |
| Sidebar/header appearance | Exact API request/response shapes |
| Empty/loading skeleton visuals | Auth guards and admin checks (may restyle, not remove) |
| Chart styling | Credential crypto / sanitizeRow behavior |

**Adapter rule:** New UI should call the same hooks/clients (`useProjects`, `uciAuthenticatedFetch`, scrape start helpers) or a thin adapter that preserves payloads. Avoid duplicating fetch logic inside Lovable-generated pages.

---

## 3. Safe migration phases

1. **Inventory lock** — Use `current-ui-inventory.json` + page architecture as the checklist (this audit).
2. **Shell swap** — Layout/nav/theme only; keep all page bodies wired to existing hooks.
3. **Page-by-page visual replace** — One route at a time; keep route paths stable unless redirects added.
4. **Marketing public pages** — Lowest risk (few BE deps); watch double-layout legacy behavior.
5. **High-risk last** — Portal Harvest, UCI, Response Matrix, Permit Wizard, Settings credentials.
6. **Do not** scatter partial visual changes across critical workflows without feature flags / route toggles.

---

## 4. Verification requirements (per page)

Before marking a page migrated:

- [ ] Same route path loads (or documented redirect)
- [ ] Auth gate behavior unchanged (public / protected / admin / token)
- [ ] Primary API calls fire with same payloads (network or unit)
- [ ] Loading / error / empty / success states still reachable
- [ ] Selected project still required where previously required
- [ ] Role-based nav visibility matches (`requiresAuth`, admin group)
- [ ] No plaintext portal passwords in network responses or DOM
- [ ] Scrape/UCI terminal statuses still rendered from real job state

---

## 5. Rollback boundaries

| Boundary | Rollback method |
|----------|-----------------|
| Single page | Revert page component import in `App.tsx` / restore previous page file |
| Layout shell | Swap `DashboardLayout` implementation behind same export |
| Feature flag | Prefer route-level flag if introducing parallel UI (not currently server-backed; `useFeatureFlags` is localStorage-only — do not rely on it for production cutover without a real flag) |
| Backend | **No UI migration should require DB migrations**; if one appears, stop and treat as separate BE change |

Never roll back by weakening RLS, removing JWT checks, or enabling `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` as a UI convenience.

---

## 6. Coupling hotspots (change carefully)

Exact cites:

| Hotspot | File / symbol |
|---------|----------------|
| Route table | `src/App.tsx` |
| Nav hrefs | `AppSidebar.tsx` nav arrays; `MobileBottomNav.tsx`; `CommandPalette.tsx` |
| Auth bootstrap | `useAuth.tsx` |
| Admin gate | `useRequireAdmin.ts` |
| Project selection | `SelectedProjectContext.tsx` |
| Scrape session | `ScrapeContext.tsx` |
| Scraper base URL | `scraperBaseUrl.ts` `getScraperBaseUrl` |
| UCI client | `uciApi.ts` `uciAuthenticatedFetch`, `getValidUciAccessToken` |
| Credential API | `portalCredentialsApi.ts` + `portal-credentials.routes.js` |
| UCI access | `uci-access.service.js` |
| Submit gate | `uci-application-submit.service.js`, `uci-pepco-submission.service.js` |
| Monolithic scrape | `register-execution-routes.js` |

---

## 7. Explicit non-goals for UI replication

- Do not reimplement Playwright scrapers in the browser
- Do not move portal passwords to client-side storage
- Do not replace Supabase Auth with a parallel auth system in the UI layer
- Do not treat Baltimore mock routes as production portal integration
- Do not assume UCI stages 7–10 have full FE parity with APIs
- Do not use stale `src/integrations/supabase/types.ts` as schema truth

---

## 8. Readiness for page-by-page planning

**Ready for planning** against current-system docs (items 1–7).  
**Not ready for Lovable gap mapping** until Lovable audit artifacts exist.
