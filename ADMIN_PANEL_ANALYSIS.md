# Admin Panel — Product & System Analysis

**Scope:** Admin-related pages, components, routes, APIs, database, auth/role flow, and feature audit.  
**Constraint:** Read-only analysis; no code changes.

---

## A. Admin Panel Architecture Overview

- **Entry:** Admin features live under the **protected layout** (authenticated users only). There is **no dedicated “Admin” section in the main sidebar** (`AppSidebar.tsx`). Admin routes are reached by:
  - Direct URL: `/admin`, `/admin/jurisdictions`, `/admin/feature-flags`, `/admin/shadow-mode`
  - In-app buttons: “Shadow Mode” and “Manage Jurisdictions” on the main Admin Panel page; “Back to Admin” on the Shadow Mode Dashboard.

- **Auth model:** Supabase Auth (email/password). `ProtectedLayoutRoute` in `src/App.tsx` only checks that a user is logged in; it does **not** check `app_role` or admin status. Each admin page that needs it performs its own **admin role check** by querying `public.user_roles` for `role = 'admin'`.

- **Backend:** No separate Node API. All admin data and actions go through:
  - **Supabase client** from the browser (RLS applies), and/or
  - **Supabase Edge Functions** (some use anon key + JWT and verify admin; some use service role only with no user/admin check).

- **Scraper:** The Node/Express scraper in `scraper-service/server.js` is **not** admin-specific; it is used by any authenticated user with portal credentials. No admin-only scraping controls were found in the admin UI.

---

## B. Route Map Table

| Route | Source file | Purpose | Guard | Status |
|-------|-------------|---------|--------|--------|
| `/admin` | `src/pages/AdminPanel.tsx` | Main admin: notifications, drip campaigns, activity log, email branding | ProtectedLayoutRoute (auth only) + page-level `isAdmin` check (but see **E** for bug) | Working (with caveat) |
| `/admin/jurisdictions` | `src/pages/JurisdictionAdmin.tsx` | Jurisdiction CRUD, CSV import | ProtectedLayoutRoute + page-level `isAdmin`; non-admin sees “Access Denied” | Working |
| `/admin/feature-flags` | `src/pages/FeatureFlagsAdmin.tsx` | Toggle feature flags (e.g. demo video) | ProtectedLayoutRoute + page-level `isAdmin` | Working (flags are localStorage-only) |
| `/admin/shadow-mode` | `src/pages/ShadowModeDashboard.tsx` | Shadow mode metrics, predictions, circuit breaker, export | ProtectedLayoutRoute **only** — **no admin check** | **Gap:** any logged-in user can access |

**Assumption:** There are no other admin-only routes (e.g. `/admin/users` or `/admin/coverage-requests`). The sidebar does not link to any of the above; they are reachable only via URL or the buttons noted above.

---

## C. Component / Module Inventory

### Pages (admin routes)

| File | Exports | Notes |
|------|---------|--------|
| `src/pages/AdminPanel.tsx` | `default function AdminPanel` | Tabs: Notifications, Drip Campaigns, Activity Log, Email Branding. Uses `DripCampaignManager`. |
| `src/pages/JurisdictionAdmin.tsx` | `default function JurisdictionAdmin` | Wraps `JurisdictionManager`; enforces `isAdmin` and shows “Access Denied” if not. |
| `src/pages/FeatureFlagsAdmin.tsx` | `default function FeatureFlagsAdmin` | Wraps `FeatureFlagsPanel`; enforces `isAdmin`. |
| `src/pages/ShadowModeDashboard.tsx` | `ShadowModeDashboardWrapper` (default), `ShadowModeDashboardInner` | No admin check. Uses `shadow-metrics`, `circuit-breaker-check`, `export-weekly-report`; reads `shadow_predictions`. |

### Admin-specific components

| File | Purpose |
|------|--------|
| `src/components/admin/DripCampaignManager.tsx` | Lists drip campaigns via `admin-drip-campaigns` (action: list), “Process Now” calls `process-drip-emails`. Fallback: direct `user_drip_campaigns` query. |
| `src/components/admin/FeatureFlagsPanel.tsx` | Uses `useFeatureFlags()`; toggles stored in **localStorage** only (key `permitpulse_feature_flags`). No backend. |
| `src/components/admin/JurisdictionManager.tsx` | Uses `useJurisdictions()`; CRUD + CSV import. All DB access via Supabase client (RLS: admins for write; read is active or admin). |
| `src/components/admin/JurisdictionFormDialog.tsx` | Create/Edit jurisdiction form (used by JurisdictionManager). |
| `src/components/admin/JurisdictionCsvImportDialog.tsx` | CSV import for jurisdictions; parses and inserts via Supabase client. |

### Shared hooks/contexts used by admin

| Hook/context | File | Admin usage |
|--------------|------|-------------|
| `useAuth` | `src/hooks/useAuth.tsx` | Admin pages use `user` and `loading`; no `isAdmin` in context. |
| `useJurisdictions` | `src/hooks/useJurisdictions.ts` | Used by JurisdictionManager. CRUD/verify go through Supabase; RLS enforces admin for jurisdictions write. |
| `useFeatureFlags` | `src/hooks/useFeatureFlags.ts` | Used by FeatureFlagsPanel. LocalStorage only; no role. |
| `useSelectedProject` | `src/contexts/SelectedProjectContext.tsx` | Used by ShadowModeDashboard for project filter. |

### Route/layout guards

| File | What it does |
|------|----------------|
| `src/components/auth/ProtectedRoute.tsx` | `ProtectedRoute`: auth only, wraps in `DashboardLayout`. `ProtectedLayoutRoute`: auth only, renders `<Outlet />` inside `DashboardLayout`. **Neither checks admin.** |
| `src/App.tsx` | All admin routes under `<Route element={<ProtectedLayoutRoute />}>`; no separate admin guard. |

---

## D. Real vs Mock Feature Audit

### Fully working (real backend + DB)

- **Admin Panel — Notifications tab:** Send/schedule jurisdiction notifications; in-app rows in `jurisdiction_notifications`; optional email via `send-jurisdiction-notification` (admin-checked). Activity logged to `admin_activity_log`. Subscriber list from `jurisdiction_subscriptions`. **Real.**
- **Admin Panel — Activity Log tab:** Reads `admin_activity_log` (RLS: admin only). **Real.**
- **Admin Panel — Email Branding tab:** CRUD `email_branding_settings` (RLS: admin only). **Real.**
- **Admin Panel — Scheduled Notifications:** Insert/delete in `scheduled_notifications` (RLS: admin). Cron (or similar) runs `process-scheduled-notifications` to send and update status. **Real.**
- **Jurisdiction Admin:** Full CRUD + CSV import on `jurisdictions` (RLS: admins for insert/update/delete; select for active or admin). `useJurisdictions` + `JurisdictionManager` + form/import dialogs. **Real.**
- **Drip Campaigns (list):** `admin-drip-campaigns` edge function checks admin, then uses service role to list `user_drip_campaigns`. **Real** (list). “Process Now” calls `process-drip-emails` — **real behavior** but edge function does **not** verify admin (see **E** and **G**).

### Partially implemented / mixed

- **Feature Flags admin:** UI is behind admin check and allows toggling flags. **Storage is per-browser localStorage only** — not server-side or global. So: “admin” only in the sense that only admins see the page; the flags are not system-wide. **Partially implemented** (no backend/DB for flags).
- **Shadow Mode Dashboard:** Data from `shadow_predictions` and edge functions is real. **No admin check** on the page or on `shadow-metrics`, `circuit-breaker-check`, or `export-weekly-report` — so any authenticated user can view and export. **Partially implemented** from a “admin-only” perspective.

### Dummy / placeholder / not applicable

- **Scraping-related controls:** No admin-only scraping UI or admin-only API in the scraper service. Portal harvest is a normal app feature. **N/A** for admin panel.
- **Feature flag “Reset All”:** Resets flags in localStorage only; no server state. **Not dummy** but client-only.

### Broken or disconnected

- **AdminPanel when user is not admin:** In `AdminPanel.tsx` (around 561–563), if `!isAdmin` the code only logs a console warning and **still renders the full panel**. So non-admins can see and use all admin tabs if they open `/admin`. **Broken** access control on this page.
- **Coverage requests:** Table `coverage_requests` exists; RLS allows anyone to INSERT (public form in `CoverageRequestForm.tsx`); admins can SELECT/UPDATE/DELETE. There is **no admin UI** to list or manage coverage requests. **Disconnected** (backend ready, no admin screen).

---

## E. Auth / Role / Permission Flow

### 1. Frontend

- **Layout:** `ProtectedLayoutRoute` → requires `user` from `useAuth()`; else redirect to `/auth`. No role check.
- **Admin role check:** Done per page by:
  - Query: `supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle()`.
  - **AdminPanel:** Sets `isAdmin` but if `!isAdmin` still renders full UI (bug).
  - **JurisdictionAdmin, FeatureFlagsAdmin:** If `!isAdmin`, show “Access Denied” and do not render admin content.
  - **ShadowModeDashboard:** No admin check.
- **Sidebar:** No “Admin” or “/admin” link in `AppSidebar.tsx`. Admin entry is by URL or in-app buttons only.

### 2. Backend / API (Edge Functions)

- **send-jurisdiction-notification:** Verifies JWT and checks `user_roles` for `role = 'admin'`. Returns 403 if not admin. **Consistent.**
- **admin-drip-campaigns:** Verifies JWT and checks `user_roles` for `role = 'admin'`. Returns 403 if not admin. **Consistent.**
- **process-drip-emails:** Uses service role only; **does not** validate JWT or admin. Intended for cron; callable by anyone who can invoke the function (e.g. from frontend with anon key). **Inconsistent** — should be restricted to cron or require admin.
- **shadow-metrics:** Uses service role only; no JWT or admin check. **Inconsistent** — any authenticated client can request metrics.
- **circuit-breaker-check:** Service role; no user/admin check. **Inconsistent.**
- **export-weekly-report:** Service role; no user/admin check. **Inconsistent.**
- **process-scheduled-notifications:** Service role; invoked by cron (or similar). No user context. **OK** for cron; not meant to be called by end-users.

### 3. Database (RLS)

- **user_roles:** Users can read own rows; admins can manage all (SELECT/INSERT/UPDATE/DELETE via `has_role(auth.uid(), 'admin')`).
- **admin_activity_log:** SELECT and INSERT only for `has_role(auth.uid(), 'admin')`.
- **scheduled_notifications:** All operations require `has_role(auth.uid(), 'admin')`.
- **email_branding_settings:** SELECT/INSERT/UPDATE require admin.
- **jurisdictions:** SELECT if `is_active = true` OR admin; INSERT/UPDATE/DELETE admin only.
- **jurisdiction_notifications:** Admins can INSERT (for sending); users read own rows.
- **user_drip_campaigns:** No global admin policy in codebase; RLS is “own row” (and possibly no SELECT for other users). Admin list is via edge function with service role. **Assumption:** RLS does not allow regular users to list all drip campaigns; consistent with using `admin-drip-campaigns` for list.
- **shadow_predictions:** Not fully traced here; typically project-scoped. Edge function `shadow-metrics` uses service role and can read all. **Assumption:** RLS allows project members to read their project’s predictions; edge function bypasses RLS.
- **coverage_requests:** INSERT allowed for anyone; SELECT/UPDATE/DELETE admin only. No admin UI.

**Summary:** Role logic is **consistent** for: jurisdiction notifications (send + log), drip list API, and DB policies for admin-only tables. **Inconsistent** for: AdminPanel UI when `!isAdmin`, Shadow Mode Dashboard (no admin check), and edge functions `shadow-metrics`, `circuit-breaker-check`, `export-weekly-report`, `process-drip-emails` (no admin or no auth check).

---

## F. Data Flow (Text Diagram)

### Send jurisdiction notification (Admin Panel)

1. **Frontend:** `AdminPanel.tsx` → user selects jurisdiction, title, message, optional email, optional schedule.
2. **Immediate send:**  
   - Insert rows into `jurisdiction_notifications` (Supabase client; RLS: admin can insert).  
   - If email: `supabase.functions.invoke('send-jurisdiction-notification', { body: { jurisdictionId, jurisdictionName, title, message } })`.  
   - Edge function: JWT + `user_roles.role = 'admin'` → then service role to read subscribers + branding, Resend to send emails.  
   - Insert row into `admin_activity_log` (Supabase client; RLS: admin).
3. **Schedule:** Insert into `scheduled_notifications` (Supabase client; RLS: admin). Later, cron runs `process-scheduled-notifications` (service role), which sends and writes to `admin_activity_log`.

### Drip campaigns (Admin Panel)

1. **List:** `DripCampaignManager` → `supabase.functions.invoke('admin-drip-campaigns', { body: { action: 'list' } })` → edge function checks admin → service role reads `user_drip_campaigns` → returns list.
2. **Process Now:** `supabase.functions.invoke('process-drip-emails')` → edge function uses service role only; no admin check; processes drip logic and sends via Resend.

### Jurisdiction CRUD (Jurisdiction Admin)

1. **Frontend:** `JurisdictionAdmin` (admin check) → `JurisdictionManager` → `useJurisdictions()`.
2. **Data:** `supabase.from('jurisdictions').select|insert|update|delete(...)` with user’s JWT. RLS: read if active or admin; write only admin.
3. **CSV import:** `JurisdictionCsvImportDialog` parses file and inserts via same Supabase client (admin RLS).

### Feature flags (Feature Flags Admin)

1. **Frontend:** `FeatureFlagsAdmin` (admin check) → `FeatureFlagsPanel` → `useFeatureFlags()`.
2. **Storage:** `localStorage.getItem/setItem('permitpulse_feature_flags', JSON.stringify(flags))`. No API or DB.

### Shadow Mode Dashboard

1. **Frontend:** `ShadowModeDashboard.tsx` (no admin check) → fetches:  
   - `supabase.functions.invoke('shadow-metrics', { body })`  
   - `supabase.functions.invoke('circuit-breaker-check', { body })`  
   - `supabase.functions.invoke('export-weekly-report', { body })` for export  
   - `supabase.from('shadow_predictions').select(...)` (with optional project filter).
2. **Backend:** All three edge functions use service role; no JWT or admin verification. Data is real (shadow_predictions, etc.).

---

## G. Gaps, Risks, and Cleanup Recommendations

### Gaps

1. **No admin entry in sidebar** — Admins must know URLs or use the two buttons on `/admin`. Add an “Admin” nav item (e.g. only when `user_roles.role = 'admin'`) in `AppSidebar.tsx`.
2. **Shadow Mode not admin-only** — `/admin/shadow-mode` and the three edge functions (`shadow-metrics`, `circuit-breaker-check`, `export-weekly-report`) do not enforce admin. Any logged-in user can view and export. Add admin check on the page and optionally on the edge functions (or restrict invocation to admin JWT).
3. **process-drip-emails callable by anyone** — “Process Now” is only in the admin UI, but the function does not verify admin. Restrict to cron only or add admin (or service) check so only authorized callers can trigger it.
4. **Feature flags are client-only** — Stored in localStorage; not global. If “feature flags admin” is meant to control behavior for all users, introduce a server-side store (e.g. DB or config) and an admin-only API.
5. **No admin UI for coverage_requests** — Table and RLS support admin view/update/delete; no admin page to list or manage requests. Add an admin view (e.g. under `/admin` or `/admin/coverage-requests`).
6. **AdminPanel allows non-admins** — When `!isAdmin`, the page still renders the full panel. Fix by redirecting or showing “Access Denied” (like JurisdictionAdmin/FeatureFlagsAdmin).

### Risks

- **Information disclosure:** Shadow metrics and exports expose internal AI/shadow data to any authenticated user.
- **Privilege escalation:** Non-admin can open `/admin` and use notifications, branding, activity log, and drip (list + process now) if the bug is not fixed; RLS still blocks some writes (e.g. branding) for non-admin, but notifications and drip process are a concern.
- **Feature flags:** Misleading name if flags are per-browser only; users may expect system-wide toggles.

### Cleanup recommendations

- Unify admin check in one place: e.g. a wrapper component or hook `useRequireAdmin()` that redirects or shows “Access Denied” and use it on all four admin routes.
- Add admin check to Shadow Mode Dashboard and, if desired, to `shadow-metrics`, `circuit-breaker-check`, `export-weekly-report` (e.g. require valid JWT and `user_roles.role = 'admin'`).
- Restrict `process-drip-emails` to cron (e.g. via secret header or Supabase cron only) or add explicit admin/service authorization.
- Remove or change the “allow access for testing” behavior in AdminPanel and enforce `isAdmin` like the other admin pages.
- Document that feature flags are per-browser until a backend is added, or implement a small admin-only flags API/table.

---

## H. Exact Files to Modify (for improvement or rebuild)

### Must-fix (security / correctness)

| File | Change |
|------|--------|
| `src/pages/AdminPanel.tsx` | When `!isAdmin`, do not render admin content: redirect to `/dashboard` or show “Access Denied” (same pattern as JurisdictionAdmin). Remove or guard the `console.warn` that says “allowing access for testing”. |
| `src/pages/ShadowModeDashboard.tsx` | Add admin role check (same pattern as JurisdictionAdmin); if not admin, show “Access Denied” or redirect. |
| `supabase/functions/process-drip-emails/index.ts` | Either: (a) verify JWT and `user_roles.role = 'admin'` before running, or (b) document that the function must be invoked only by cron and ensure it is not callable with anon key from client (e.g. require a secret or call from cron only). |

### Should-fix (consistency and UX)

| File | Change |
|------|--------|
| `src/components/layout/AppSidebar.tsx` | Add an “Admin” nav item (e.g. under a “Settings” or “Admin” section) visible only when the user has `user_roles.role = 'admin'` (requires loading role in sidebar or context). Link to `/admin` or a first admin sub-route. |
| `supabase/functions/shadow-metrics/index.ts` | Optional: verify Authorization header and admin role before returning data. |
| `supabase/functions/circuit-breaker-check/index.ts` | Optional: same as shadow-metrics. |
| `supabase/functions/export-weekly-report/index.ts` | Optional: same as shadow-metrics. |

### Optional (features and clarity)

| File | Change |
|------|--------|
| `src/pages/AdminPanel.tsx` or new `src/pages/CoverageRequestsAdmin.tsx` | Add a tab or route to list and manage `coverage_requests` (SELECT/UPDATE/DELETE by admin). |
| `src/hooks/useFeatureFlags.ts` + backend | If flags should be global: add table or config and admin-only API to read/write flags; optionally keep localStorage as cache. |
| `src/components/auth/ProtectedRoute.tsx` or new `AdminRoute.tsx` | Introduce `useRequireAdmin()` (or similar) and an `<AdminRoute>` that redirects or shows “Access Denied” when not admin; use it in all four admin routes to avoid duplication. |

---

**End of analysis.** All references are to the current codebase; no code was changed.
