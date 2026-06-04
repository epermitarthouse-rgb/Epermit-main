# UCI Sprint 3 — `/uci` Dashboard Frontend

## Scope

Build the first frontend surface for the UCI module using the backend APIs already implemented and smoke-tested.

Do **not** implement:
- PEPCO/BGE Playwright automation
- portal discovery
- actual utility submission
- QuickBooks UCI billing
- inbound email
- agents
- new migrations
- county scraper changes

Do **not** touch:
- existing county scraper internals
- `/api/scrape`
- QuickBooks token/crypto paths
- credential encryption logic unless a tiny frontend compatibility fix is required

---

## Current Completed Backend

The following APIs are available under backend port/proxy:

- `GET /api/uci/providers`
- `GET /api/uci/projects/:projectId/coordination`
- `POST /api/uci/projects/:projectId/coordination/init`
- `GET /api/uci/coordination/:id`
- `POST /api/uci/coordination/:id/transition`
- `GET /api/uci/coordination/:id/applications`

These were smoke-tested locally on `localhost:3002`.

Important response behavior:
- `/providers` returns `{ providers: [...] }`
- `/projects/:projectId/coordination` returns `{ records: [...] }`
- `/coordination/init` returns `{ created, already_existed, records }`
- `/coordination/:id` returns:
  - `record`
  - `transitions`
  - `applications`
  - `costs`
  - `equipment`
  - `milestones`
  - `communications_recent`

Auth:
- Use the same Supabase bearer token approach already used by Portal Credentials API.
- Do not expose portal credentials or passwords anywhere in UCI UI.

---

## Goal

Create the first usable `/uci` dashboard page where users can:

1. Open `/uci`.
2. See the UCI module overview.
3. See seeded utility providers.
4. Select a project.
5. View existing utility coordination records for that project.
6. Initialize utility coordination records for selected providers.
7. View record stage/state.
8. Open a record detail panel/section.
9. Manually update lifecycle stage/state with a reason.
10. Confirm updated data refreshes from backend.

---

## Files to inspect first

- `src/App.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/components/layout/MobileBottomNav.tsx`
- `src/lib/scraperBaseUrl.ts`
- `src/lib/portalCredentialsApi.ts`
- project hooks/pages:
  - `src/hooks/*`
  - `src/pages/Projects.tsx`
  - `src/components/projects/*`
- existing UI components:
  - `src/components/ui/card*`
  - `src/components/ui/button*`
  - `src/components/ui/table*`
  - `src/components/ui/tabs*`
  - `src/components/ui/dialog*`
  - `src/components/ui/select*`
  - `src/components/ui/badge*`

Use existing styling/theme patterns. Keep it consistent with PermitPilot.

---

## Files to create

Create as needed:

- `src/pages/UciDashboard.tsx`
- `src/types/uci.ts`
- `src/lib/uciApi.ts`

Optional if project style prefers hooks:

- `src/hooks/useUci.ts`

---

## Files to update

Likely:

- `src/App.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/components/layout/MobileBottomNav.tsx`

Only update layout/nav files enough to add the UCI route/nav entry.

---

## Phase 4A — Add Protected `/uci` Route

Add a protected route:

- `/uci`

Use the existing protected route/auth layout style.

Expected:
- Logged-in users can access `/uci`.
- Logged-out users are redirected the same way as other protected app routes.
- Existing routes continue working.

Nav label:
- `Utility Coordination`
or
- `UCI`

Prefer:
- Sidebar: `Utility Coordination`
- Mobile bottom nav: only add if there is room and it does not clutter; otherwise skip mobile bottom nav and rely on menu/sidebar.

---

## Phase 4B — Add UCI Types + API Client

Create `src/types/uci.ts` with frontend-safe types for:

- `UtilityProvider`
- `CoordinationRecord`
- `CoordinationTransition`
- `CoordinationApplication`
- `CoordinationCost`
- `CoordinationEquipment`
- `CoordinationMilestone`
- `CoordinationCommunication`
- API response shapes:
  - `UciProvidersResponse`
  - `UciProjectCoordinationResponse`
  - `UciInitResponse`
  - `UciRecordDetailResponse`
  - `UciTransitionResponse`

Create `src/lib/uciApi.ts`.

Requirements:
- Use existing scraper base URL helper if appropriate.
- Include Supabase access token in `Authorization: Bearer`.
- Follow existing `portalCredentialsApi.ts` pattern.
- Use safe error messages.
- Do not include any credential/password logic.

API functions:

- `listUciProviders()`
- `listProjectCoordination(projectId)`
- `initProjectCoordination(projectId, providers)`
- `getCoordinationDetail(coordinationId)`
- `transitionCoordination(coordinationId, { to_stage, to_state, reason })`
- `listCoordinationApplications(coordinationId)`

---

## Phase 4C — Build Basic `/uci` Dashboard Layout

Create `UciDashboard.tsx`.

Sections:

### 1. Header
Title:
- `Utility Coordination Intelligence`

Subtitle:
- `Track utility provider coordination, lifecycle stages, and project readiness.`

Show a small status note:
- `Foundation mode: portal discovery and submission automation are not enabled yet.`

### 2. Provider Overview Cards
Show provider cards/table from `GET /api/uci/providers`.

Each provider should show:
- name
- utility type
- automation status
- portal type if available
- active status

For now:
- status `placeholder` should show as `Not automated yet` or `Placeholder`.

### 3. Project Selector
Allow selecting a project.

Use existing project fetching hook/service. If there is already a projects list hook, reuse it. Do not create duplicate project data logic unless needed.

Show:
- project name
- jurisdiction
- permit number if available

### 4. Project Coordination Records
When a project is selected, call:

- `GET /api/uci/projects/:projectId/coordination`

Show records in a table/card list:

- provider name
- utility type
- current stage
- current state
- last updated
- action button: `View`

If no records:
- show empty state:
  - `No utility coordination records yet. Initialize providers to begin.`

### 5. Initialize Providers
Allow user to select providers to initialize for selected project.

Minimum:
- checkboxes for PEPCO/BGE/all active providers
- button: `Initialize coordination`

Behavior:
- Calls `POST /api/uci/projects/:projectId/coordination/init`
- Refreshes coordination records
- Shows toast/success:
  - created count
  - already existing count

Do not initialize automatically on page load.

---

## Phase 4D — Coordination Detail Panel

When user clicks a record:

Show detail section or dialog/drawer.

Minimum detail:

- provider name
- utility type
- current stage
- current state
- application submitted date
- acknowledgment received date
- class of service issued date
- energization target date
- energization actual date
- last error if any

Show transitions:
- newest first
- from stage/state → to stage/state
- triggered by type
- reason
- created_at

Show child sections as empty-state cards:
- Applications
- Costs
- Equipment
- Milestones
- Recent communications

For now these can be read-only.

---

## Phase 4E — Manual Transition UI

Add a small manual update form in the detail panel.

Fields:
- `to_stage` select: 1–10
- `to_state` select:
  - `NOT_STARTED`
  - `IN_PROGRESS`
  - `AWAITING_UTILITY`
  - `BLOCKED`
  - `ESCALATED`
  - `COMPLETED`
- `reason` text input/textarea

Button:
- `Update stage`

Behavior:
- Calls `POST /api/uci/coordination/:id/transition`
- Refreshes detail
- Refreshes project coordination list
- Shows success/error toast

Validation:
- stage required
- state required
- reason recommended; if backend allows optional reason, still ask user to enter it

Do not add complex workflow rules yet. This is manual admin-style transition.

---

## Phase 4F — UI Smoke Testing

After implementation, test:

1. `/uci` route loads.
2. Unauthenticated users cannot access it.
3. Providers render.
4. Project selector renders.
5. Selecting a project loads coordination records.
6. Existing PEPCO/BGE records show if already initialized.
7. Init button does not duplicate records.
8. Detail view opens.
9. Manual transition updates stage/state.
10. Existing dashboard/projects/settings routes still work.

---

## UX Requirements

Keep UI clean and practical.

Do:
- Use existing cards, badges, tables, buttons.
- Use clear empty states.
- Mark placeholder automation status honestly.
- Keep manual transition visible but not overly prominent.

Do not:
- Overdesign advanced analytics yet.
- Show fake data.
- Claim automation is ready.
- Show PEPCO/BGE as submission-ready yet.
- Add unsupported “Run automation” buttons.

Suggested wording:
- `Portal automation: Not started`
- `Submission automation: Not enabled`
- `Manual coordination tracking is available`

---

## Final Report Required

Return:

1. Files created
2. Files changed
3. Routes/nav added
4. API client functions added
5. Dashboard sections built
6. Project selector behavior
7. Provider initialization behavior
8. Manual transition behavior
9. Local UI test results
10. Any blockers
11. Whether repo is ready for next sprint: portal discovery foundation
