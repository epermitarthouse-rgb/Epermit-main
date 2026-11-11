# Phase 3 Report — Permit Repository pages and Management Admin

Date: 2026-11-07 · Branch `feat/central-permit-repository` (uncommitted) · Level: **Implemented**; data layer, components, SQL search and flag gating **Locally tested**. No page has been exercised in a browser against a database.

## Outcome
- `/permits` (search and list), `/permits/:id` (full record) and `/admin/permit-sync` (sources, jobs, access grants) exist behind `module.central_permits`, which is seeded OFF. With the flag off, the routes redirect to `/dashboard` and the nav entries are hidden.
- Search runs in Postgres with the caller's privileges (`search_permits`, SECURITY INVOKER), so users see only permits RLS lets them read, and comment-text matches only for those permits.
- Deferred: project ↔ permit linking UI (P3.5). The admin RPCs for it already exist.

## Components and changed files
New:
- `supabase/migrations/20261111100200_central_permits_ui.sql`: flag row and `search_permits` (D-026, D-027).
- `src/lib/centralPermits.ts`: data access and helpers.
- `src/components/permits/PermitRepositoryViews.tsx`: list table, section health, reviews, tasks, documents, reports, history, sources.
- `src/pages/permits/PermitsPage.tsx`, `src/pages/permits/PermitDetailPage.tsx`, `src/pages/admin/AdminPermitSync.tsx`.
- Tests: `src/lib/centralPermits.test.ts`, `src/components/permits/PermitRepositoryViews.test.tsx`, `scraper-service/tests/permit-repo-search.test.js`.

Modified shared files (additive):
- `src/App.tsx`: three routes.
- `src/components/layout/hybridNav.ts`: "Permit Repository" (Command group) and "Permit Sync" (Admin group).
- `src/lib/featureFlags.ts`: new key, default `false`, admin-panel label.
- `src/lib/moduleFeatureFlags.ts`: route rules and resolution order.
- `src/lib/featureFlags.test.ts`, `src/lib/moduleFeatureFlags.test.ts`: flag count 13 → 14; the "all modules default ON" assertion now exempts this flag; new gating test.
- Test harness: `feature_flags` stub and the UI migration in `permit-repo-db.js`; the chain test covers the third migration.

Not touched: `src/lib/supabaseAnalyzer/stage3EvidenceV2.test.ts` shows as modified in the working tree but was not changed by this work.

## Migration details and backward compatibility
- Additive: one `feature_flags` row (`ON CONFLICT DO NOTHING`), two new functions. No existing object changed.
- Chain replay (all existing migrations plus the three new ones): pre-existing columns, policies, triggers, functions and ACLs identical; every pre-existing `feature_flags` row identical; new row present and OFF. Re-applying is a schema no-op.
- `get_feature_flags` returns the new row automatically; `set_feature_flag` accepts it because the row exists. If the migration is not applied, the client default (`false`) keeps the module hidden.

## Tests
- `npm run test:permit-sync` (scraper-service): **86 pass** (adds 5 search tests: RLS scoping for admin, permit grantee, unrelated user and credential owner; permit-number prefix, permit text and comment-text matches; status/jurisdiction filters; paging and limit clamping; removed permits; tsquery-injection inputs; anon denied; flag seeded off).
- `node --import tsx --test src/lib/centralPermits.test.ts src/components/permits/PermitRepositoryViews.test.tsx src/lib/featureFlags.test.ts src/lib/moduleFeatureFlags.test.ts`: **80 pass**.
- Existing frontend tests that read routes, nav or flags: 88/89. The failure ("UCI Application Builder route wiring") fails identically with these changes stashed.
- `tsc -p tsconfig.app.json`: no errors in new or changed files except a pre-existing one in `featureFlags.ts` `getRpcClient` (present with the change stashed). The project has ~190 other pre-existing type errors.
- `vite build`: the app bundle compiles (5,499 modules). The PWA step then fails on a `workbox-build` / `pretty-bytes` ESM error in `node_modules`; not caused by these files, not checked against a clean checkout.
- Regression: scraper-service `npm test` 158/159 (pre-existing failure).

## Gaps (what these tests do not prove)
- No page was rendered in a browser with a signed-in user and real data. Interaction (tabs, selects, mutations, toasts, paging) is untested.
- Pages read tables the generated Supabase types do not know yet; queries go through a narrow structural client. Regenerate `src/integrations/supabase/types.ts` after migrations are applied (A-1).
- Grant form takes raw ids (permit id, credential id, user or tenant id); no pickers yet.
- Search quality is prefix full-text only (`simple` config); no ranking beyond last change.
- P3.5 project linking UI deferred.

## Security and data-integrity verification
- All reads go through RLS; the UI holds no access logic beyond hiding admin nav (server re-checks every admin RPC).
- The module fails closed: flag missing, off, or flag fetch error → no route, no nav.
- No personal names are rendered: comments show department and role labels; a test asserts the views never reference `reviewer_name` / `responder_name`.
- Documents show "Metadata only" unless a stored copy exists; no download links (DC has none).
- Admin "Sync now" only queues a job; with no worker deployed (A-5) nothing contacts the portal.

## Deployment readiness and outstanding approvals
Not deployable until A-1 (migrations), then A-6 to enable the flag. A-3/A-4/A-5 are needed before the pages contain data.

## Next phase
Phase 4 (local only): second ProjectDox jurisdiction mapped onto the adapter contract via fixtures, reliability tests, monitoring hooks, runbook and readiness checklist.
