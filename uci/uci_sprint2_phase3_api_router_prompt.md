# UCI Sprint 2 — Phase 3 Only: Add `/api/uci` Backend Router

We are ready to start UCI Sprint 2 Phase 3.

Do not build:
- `/uci` frontend dashboard
- PEPCO/BGE Playwright automation
- portal discovery
- actual submission automation
- QuickBooks UCI billing
- inbound email
- agents
- new migrations unless absolutely required

Do not touch county scraper internals or `/api/scrape`.

---

## Context

Completed:
- Sprint 1 Phase 0: credential security/encryption + UCI access helper
- Sprint 1 Phase 1: full UCI schema deployed
- Sprint 2 Phase 2: Settings now has separate Jurisdiction and Utility dropdowns
- Utility credentials are still stored in existing `portal_credentials.jurisdiction` text field using the selected display label.
- UCI provider rows already exist in `utility_providers`.

Use existing helper:
- `scraper-service/app/services/uci/uci-access.service.js`

Use current access model:
- no true `tenant_id` yet
- verify project access through existing `has_project_access` pattern / helper
- do not rely only on service-role queries

---

## Goal

Create a modular UCI backend router mounted at:

```txt
/api/uci
```

Follow the QuickBooks router pattern.

---

## Files to inspect

- `scraper-service/app/routes/quickbooks.routes.js`
- `scraper-service/app/register-execution-routes.js`
- `scraper-service/app/services/uci/uci-access.service.js`
- `supabase/migrations/20260509120000_uci_foundation.sql`

---

## Files to create

- `scraper-service/app/routes/uci.routes.js`
- `scraper-service/app/services/uci/uci-providers.service.js`
- `scraper-service/app/services/uci/uci-records.service.js`
- `scraper-service/app/services/uci/uci-transitions.service.js`
- `scraper-service/app/services/uci/uci-applications.service.js`

---

## File to update

- `scraper-service/app/register-execution-routes.js`

Mount:

```js
app.use("/api/uci", createUciRouter({ supabase }));
```

Adapt to existing style.

---

## Required endpoints

### 1. `GET /api/uci/providers`

Return active utility providers:

- `id`
- `slug`
- `name`
- `utility_type`
- `primary_portal_type`
- `portal_url`
- `automation_status`
- `is_active`

Requirements:
- authenticated user required
- no credential/password data

---

### 2. `GET /api/uci/projects/:projectId/coordination`

Return all coordination records for a project.

Requirements:
- authenticated user required
- verify user has access to project
- return provider info with each record
- return empty array if none exist

---

### 3. `POST /api/uci/projects/:projectId/coordination/init`

Body:

```json
{
  "providers": ["pepco", "bge"]
}
```

Requirements:
- authenticated user required
- verify project access
- validate provider slugs exist and are active
- create one `coordination_records` row per provider
- set:
  - `current_stage = 1`
  - `current_stage_state = "NOT_STARTED"`
  - `utility_type` from provider
  - `scope_description = ""`
  - `user_id = authenticated user id`
- idempotent: re-running must not create duplicates
- insert `coordination_stage_transitions` only for newly created records
- return created + existing records clearly

---

### 4. `GET /api/uci/coordination/:id`

Return one coordination record with:

- provider
- transitions newest first
- applications
- costs
- equipment
- milestones
- latest communications limited to 5

Requirements:
- authenticated user required
- verify access to record’s project

---

### 5. `POST /api/uci/coordination/:id/transition`

Body:

```json
{
  "to_stage": 2,
  "to_state": "IN_PROGRESS",
  "reason": "Manual update"
}
```

Requirements:
- authenticated user required
- verify access
- validate stage 1–10
- validate state:
  - `NOT_STARTED`
  - `IN_PROGRESS`
  - `AWAITING_UTILITY`
  - `BLOCKED`
  - `ESCALATED`
  - `COMPLETED`
- update `coordination_records`
- insert `coordination_stage_transitions`
- `triggered_by_type = "user"`
- `triggered_by_id = authenticated user id`
- return updated record + transition

---

### 6. `GET /api/uci/coordination/:id/applications`

Return application rows for a coordination record.

Requirements:
- authenticated user required
- verify access
- no drafting/submission logic yet

---

## Error handling

Use safe JSON errors:

- `401` missing auth
- `403` no project access
- `400` invalid body/stage/state/provider
- `404` not found
- `500` sanitized database/server error

Do not expose secrets or stack traces.

---

## Validation

Test with curl or API client:

1. `GET /api/uci/providers`
2. `GET /api/uci/projects/:projectId/coordination`
3. `POST /api/uci/projects/:projectId/coordination/init`
4. Re-run init and confirm no duplicates
5. `GET /api/uci/coordination/:id`
6. `POST /api/uci/coordination/:id/transition`
7. `GET /api/uci/coordination/:id/applications`
8. Confirm unauthorized request fails
9. Confirm inaccessible project fails

---

## Final report

Return:

1. Files created
2. Files changed
3. Routes added
4. Auth/project access approach used
5. Provider endpoint test result
6. Coordination init test result
7. Idempotency behavior
8. Manual transition test result
9. Blockers
10. Whether repo is ready for Sprint 3 `/uci` dashboard
