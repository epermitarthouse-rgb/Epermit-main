# UCI Execution Plan — Sprints and Phases

## Source Context

This plan is based on the UCI backend integration specification and the Cursor compatibility audit. The implementation direction is:

- Actual utility submission automation is in scope.
- Full `portal_credentials` encryption must be fixed first.
- Full UCI schema should be created now.
- A new `/uci` dashboard route is required.
- Placeholder support should be added for all priority utilities.
- Saved credential passwords must no longer be shown back in the UI.
- `/api/uci` auth is unknown, so it must be audited and locked before exposing UCI endpoints.

---

# 1. High-Level Build Order

| Phase | Goal | Must Complete Before Moving On? |
|---|---|---|
| Phase 0 | Security + auth prerequisites | Yes |
| Phase 1 | Full UCI database schema + RLS/project-access policies | Yes |
| Phase 2 | Utility credentials/settings support for all priority utilities | Yes |
| Phase 3 | `/api/uci` backend skeleton + access checks | Yes |
| Phase 4 | New `/uci` dashboard route + basic UI | Yes |
| Phase 5 | Utility provider placeholders + project coordination creation | Yes |
| Phase 6 | PEPCO/BGE portal discovery + login automation | Yes |
| Phase 7 | Application package model + human review flow | Yes |
| Phase 8 | Actual submission automation, guarded and idempotent | Yes |
| Phase 9 | Stage lifecycle, transitions, audit trail | Yes |
| Phase 10 | Tests, safety validation, client demo readiness | Yes |

---

# 2. Sprint Overview

| Sprint | Focus | Phases Covered | Outcome |
|---|---|---|---|
| Sprint 1 | Safety + schema | Phase 0, Phase 1 | Secure credential foundation and full UCI schema |
| Sprint 2 | Backend + settings | Phase 2, Phase 3, Phase 5 | Utility credentials, provider seed data, `/api/uci` APIs |
| Sprint 3 | UCI dashboard | Phase 4, part of Phase 9 | New `/uci` page, provider/project/stage visibility |
| Sprint 4 | Portal discovery | Phase 6 | PEPCO/BGE login and discovery automation |
| Sprint 5 | Application + real submit | Phase 7, Phase 8 | Human-reviewed application package and real submission automation |
| Sprint 6 | Hardening + demo readiness | Phase 9, Phase 10 | Lifecycle audit trail, tests, demo flow, safety validation |

---

# Sprint 1 — Safety + Schema

## Objective

Build the safe foundation before any UCI automation starts.

This sprint must fix the major compatibility risks:

1. `portal_credentials.portal_password` is stored in plaintext.
2. Saved passwords are currently shown back in the UI.
3. `/api/uci` auth pattern is unknown.
4. Server uses Supabase service role, so UCI routes must perform explicit access checks.
5. UCI full schema does not exist yet.

---

## Phase 0 — Mandatory Safety Prerequisites

### Files to Inspect / Touch

| Area | Files |
|---|---|
| Settings credential UI | `src/components/settings/PortalCredentialsManager.tsx` |
| Settings page | `src/pages/Settings.tsx` |
| Credential migration | `supabase/migrations/20260210000000_portal_credentials.sql` |
| Credential project link | `supabase/migrations/20260213000000_portal_credentials_project_id.sql` |
| Backend route/auth pattern | `scraper-service/app/register-execution-routes.js` |
| Modular route pattern | `scraper-service/app/routes/quickbooks.routes.js` |
| Supabase client usage | `scraper-service/app/register-execution-routes.js` |

### Work Items

| Task | Detail | Success Criteria |
|---|---|---|
| 0.1 | Audit backend custom route auth | We know whether routes verify Supabase JWT or rely on weak app/session assumptions |
| 0.2 | Create reusable server-side auth helper for `/api/uci` | UCI routes can identify authenticated user safely |
| 0.3 | Confirm current credential read/write path | Credential save/edit/update behavior is mapped |
| 0.4 | Add encryption for `portal_credentials.portal_password` | Stored passwords are encrypted at rest |
| 0.5 | Add migration/backfill path for existing credentials | Existing saved credentials still work |
| 0.6 | Stop returning saved passwords to frontend | UI never receives stored password value |
| 0.7 | Update UI to show credential status only | UI shows `Configured`, `Not configured`, `Update password` |
| 0.8 | Add safe credential update behavior | Blank password means keep existing encrypted password |
| 0.9 | Add logging safety | No credential values appear in logs |

### Recommended Encryption Approach

| Item | Recommendation |
|---|---|
| Encryption type | Application-level encryption |
| Algorithm | AES-256-GCM, or existing project crypto helper if available |
| Key source | Server env secret such as `PORTAL_CREDENTIALS_ENCRYPTION_KEY` |
| DB field | Temporarily keep `portal_password`, but store encrypted payload |
| Future cleanup | Later rename to `portal_password_encrypted` |
| Frontend | Never fetch/decrypt password into browser |
| Runtime scraper | Backend decrypts only during scrape/discovery/submission |

### Phase 0 Success Criteria

- Existing saved credentials still work after migration.
- Frontend never displays stored password.
- `/api/uci` has a clear auth guard before any UCI route is added.
- No credential value appears in logs.
- One test credential can be saved, updated, and used by a scraper without exposing the password.

### Do Not Touch

- Existing county scraper logic
- `pgc-eplan-scraper.js`
- Montgomery/Howard timing/waits
- `POST /api/scrape` behavior

---

## Phase 1 — Full UCI Schema

### Objective

Create the complete UCI database foundation now, not a temporary MVP schema.

### Migration File

```txt
supabase/migrations/YYYYMMDDHHMMSS_uci_foundation.sql
```

### Tables to Create

| Table | Purpose |
|---|---|
| `utility_providers` | Provider directory: PEPCO, BGE, Washington Gas, etc. |
| `coordination_records` | One row per project + utility/scope |
| `coordination_stage_transitions` | Audit log for every stage/state change |
| `coordination_applications` | Application package, draft/review/submission status |
| `coordination_communications` | Future inbound/outbound utility messages |
| `coordination_costs` | CIAC/application/meter/design costs |
| `coordination_equipment` | Transformer/meter/switchgear ETA tracking |
| `coordination_milestones` | Meter set, inspection release, energization, closeout milestones |

### Current App Adaptation

The current app does not have a true `tenant_id` on projects. It uses:

- `user_id`
- `project_team_members`
- `has_project_access`

So UCI should use:

| Field | Use Now |
|---|---|
| `project_id` | Required FK to `projects(id)` |
| `user_id` | Owner/creator/primary user |
| `tenant_id` | Nullable/future-compatible, but not relied on yet |
| RLS | Mirror existing `has_project_access(project_id)` pattern |

### Required Constraints

| Table | Constraint |
|---|---|
| `coordination_records` | `UNIQUE(project_id, utility_provider_id, scope_description)` |
| `coordination_stage_transitions` | FK to `coordination_records` |
| `coordination_applications` | FK to `coordination_records` |
| `coordination_costs` | FK to `coordination_records` |
| `coordination_equipment` | FK to `coordination_records` |
| `coordination_milestones` | FK to `coordination_records` |
| `coordination_records.current_stage` | Check 1–10 |
| State fields | Check allowed states |

### Required Stage States

```txt
NOT_STARTED
IN_PROGRESS
AWAITING_UTILITY
BLOCKED
ESCALATED
COMPLETED
```

### Required Lifecycle Stages

```txt
1 Provider Mapping
2 Load Profile / Service Sizing
3 Application Preparation
4 Submission
5 Acknowledgment
6 Class of Service / Design Review
7 CIAC / Cost Confirmed
8 Equipment & Long-Lead
9 Pre-Energization Coordination
10 Energization & Closeout
```

### Phase 1 Success Criteria

- Migration applies cleanly.
- All UCI tables exist.
- All tables have RLS enabled.
- User can only access UCI rows for projects they can access.
- Service-role backend still performs explicit project-access checks.
- No table name conflicts.

---

# Sprint 2 — Backend + Settings

## Objective

Add the UCI backend skeleton, utility credential support, and provider placeholders without touching existing permit scraper behavior.

---

## Phase 2 — Utility Credentials in Settings

### Objective

Add utility credential placeholders for all priority utilities in the existing Settings credential flow.

### File to Touch

```txt
src/components/settings/PortalCredentialsManager.tsx
```

Possible additional files:

```txt
src/pages/Settings.tsx
src/types/project.ts
src/types/credentials.ts
```

### Utility Credential Placeholders

| Utility | Label |
|---|---|
| PEPCO | `PEPCO` |
| BGE | `BGE (Exelon)` |
| Washington Gas | `Washington Gas` |
| Dominion | `Dominion Energy` |
| FPL | `FPL` |
| Con Edison | `Con Edison` |
| PSE&G | `PSE&G` |
| Eversource | `Eversource` |
| Duke Energy | `Duke Energy` |
| Georgia Power | `Georgia Power` |

### Required UI Behavior

| Current Problem | Required Behavior |
|---|---|
| Password can be shown back | Never display stored password |
| Edit form may contain password | Show blank password field |
| User leaves password blank | Keep existing encrypted password |
| User enters new password | Replace encrypted password |
| Frontend receives password | Should not happen |

### Optional Recommended Column

```sql
credential_category TEXT DEFAULT 'permit'
```

Allowed values:

```txt
permit
utility
```

### Phase 2 Success Criteria

- Settings shows all priority utility options.
- User can save utility credentials.
- User can see configured/missing status.
- Password never comes back from DB to UI.
- UCI backend can find credential by user/project/provider.

---

## Phase 3 — `/api/uci` Backend Skeleton

### Objective

Add UCI backend as a new modular route, following the QuickBooks-style router pattern.

### Files to Create

```txt
scraper-service/app/routes/uci.routes.js
scraper-service/app/services/uci/uci-access.service.js
scraper-service/app/services/uci/uci-records.service.js
scraper-service/app/services/uci/uci-transitions.service.js
scraper-service/app/services/uci/uci-providers.service.js
```

### File to Modify

```txt
scraper-service/app/register-execution-routes.js
```

Mount route:

```js
app.use('/api/uci', createUciRouter({ supabase }))
```

### Required Auth / Access Behavior

| Check | Required |
|---|---|
| User is authenticated | Yes |
| User has access to project | Yes |
| Project ID belongs to accessible project | Yes |
| Service-role query is not trusted alone | Yes |
| Any write action logs actor/user ID | Yes |

### Initial Routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/uci/providers` | List utility providers |
| `GET` | `/api/uci/projects/:projectId/coordination` | List UCI records for project |
| `POST` | `/api/uci/projects/:projectId/coordination/init` | Create default coordination records for selected utilities |
| `GET` | `/api/uci/coordination/:id` | Get one coordination record |
| `POST` | `/api/uci/coordination/:id/transition` | Manual stage/state transition |
| `GET` | `/api/uci/applications/:coordinationRecordId` | List application packages |
| `POST` | `/api/uci/applications/:coordinationRecordId/draft` | Create draft application record |
| `POST` | `/api/uci/applications/:applicationId/review` | Mark reviewed/needs changes |
| `POST` | `/api/uci/applications/:applicationId/submit` | Trigger actual submission automation later |

### Phase 3 Success Criteria

- `/api/uci/providers` works.
- `/api/uci/projects/:projectId/coordination` works only for accessible projects.
- Unauthorized request fails.
- Project without access fails.
- Route errors follow existing JSON style.

---

## Phase 5 — Utility Provider Seeding

### Objective

Seed all priority utility providers as placeholders.

### Seed Data Fields

| Field | Value |
|---|---|
| `slug` | lowercase stable key, e.g. `pepco` |
| `name` | display name |
| `utility_type` | electric/gas/water/etc. |
| `primary_portal_type` | `portal` |
| `portal_url` | nullable if unknown |
| `portal_credentials_ref` | match credential label/key |
| `is_active` | true |
| `automation_status` | `placeholder`, `discovery_ready`, `login_verified`, `submission_ready` |

### Priority Utility Providers

| Provider | Utility Type | Initial Automation Status |
|---|---|---|
| PEPCO | electric | placeholder |
| BGE | electric/gas | placeholder |
| Washington Gas | gas | placeholder |
| Dominion Energy | electric/gas depending region | placeholder |
| FPL | electric | placeholder |
| Con Edison | electric/gas | placeholder |
| PSE&G | electric/gas | placeholder |
| Eversource | electric/gas | placeholder |
| Duke Energy | electric | placeholder |
| Georgia Power | electric | placeholder |

### Phase 5 Success Criteria

- `/uci` can show all priority providers.
- Providers can be selected for a project.
- No credentials are required until user attempts discovery/submission.
- Missing credentials show cleanly.

---

# Sprint 3 — UCI Dashboard

## Objective

Create a new `/uci` dashboard route for UCI visibility and management.

---

## Phase 4 — New `/uci` Dashboard Route

### Files to Touch / Create

```txt
src/App.tsx
src/components/layout/AppSidebar.tsx
src/components/layout/MobileBottomNav.tsx
src/pages/UciDashboard.tsx
src/types/uci.ts
src/lib/scraperBaseUrl.ts
```

Possible new hook:

```txt
src/hooks/useUci.ts
```

### First Version UI Sections

| Section | Purpose |
|---|---|
| Header | `Utility Coordination Intelligence` |
| Provider setup status | Shows priority utilities and whether credentials exist |
| Project coordination table | Projects with UCI records |
| Stage summary | Counts by stages 1–10 |
| Risk summary | Blocked/escalated/awaiting utility |
| Action queue | Draft/review/submit actions |
| Placeholder portfolio cards | P50/P90, costs, equipment ETA later |

### Do Not Build Yet

- Full portfolio analytics
- Inbound communication triage
- QuickBooks CIAC dashboard
- ML prediction
- Email threading UI

### Phase 4 Success Criteria

- `/uci` route loads.
- Route is protected/authenticated.
- It reads from `/api/uci`.
- It does not break existing Dashboard/Projects/Portal Data routes.
- Sidebar/mobile nav includes UCI cleanly.

---

## Phase 9 — Stage Lifecycle UI Foundation

This sprint should include the first visible lifecycle pieces, but not all final lifecycle automation yet.

### UI Behavior

| UI | Purpose |
|---|---|
| Stage timeline | Shows stage 1–10 |
| Current state badge | `IN_PROGRESS`, `AWAITING_UTILITY`, `BLOCKED`, etc. |
| Transition history | Audit trail |
| Manual transition modal | Human correction |
| Block/escalate buttons | Human control |

### Success Criteria

- Dashboard shows coordination records by project/provider.
- Each record shows current stage and state.
- Manual transition writes an audit row.
- UI does not pretend future features are already complete.

---

# Sprint 4 — Portal Discovery

## Objective

Build safe utility portal discovery and login automation, starting with PEPCO and BGE.

Heavy Playwright belongs in `scraper-service`, not Supabase Edge Functions.

---

## Phase 6 — Portal Discovery + Login Automation

### Files / Folders to Create

```txt
scraper-service/uci/portals/pepco/index.js
scraper-service/uci/portals/pepco/login.js
scraper-service/uci/portals/pepco/discover.js

scraper-service/uci/portals/bge/index.js
scraper-service/uci/portals/bge/login.js
scraper-service/uci/portals/bge/discover.js

scraper-service/uci/portals/shared/browser.js
scraper-service/uci/portals/shared/credentials.js
scraper-service/uci/portals/shared/artifacts.js
scraper-service/uci/portals/shared/sanitize.js
```

### Placeholder Folders for Later Utilities

```txt
scraper-service/uci/portals/washington-gas/
scraper-service/uci/portals/dominion/
scraper-service/uci/portals/fpl/
scraper-service/uci/portals/con-edison/
scraper-service/uci/portals/pseg/
scraper-service/uci/portals/eversource/
scraper-service/uci/portals/duke-energy/
scraper-service/uci/portals/georgia-power/
```

### Discovery Route

| Method | Route |
|---|---|
| `POST` | `/api/uci/providers/:providerSlug/discover` |

Payload:

```json
{
  "projectId": "...",
  "credentialId": "...",
  "dryRun": true
}
```

### Discovery Must Do

| Step | Required |
|---|---|
| 1 | Fetch encrypted credential |
| 2 | Decrypt server-side only |
| 3 | Launch Playwright |
| 4 | Navigate portal login URL |
| 5 | Login |
| 6 | Capture post-login URL |
| 7 | Detect dashboard/submission links |
| 8 | Take screenshot only if safe |
| 9 | Store sanitized artifact |
| 10 | Logout if possible |
| 11 | Write discovery result to DB |

### Discovery Must Not Do

- No application submission
- No file upload
- No payment
- No irreversible click
- No logging password/cookies/tokens
- No screenshot of pages containing visible password or sensitive account data unless sanitized

### Failure Handling

| Failure | Required Handling |
|---|---|
| Missing credential | Clean error: credential not configured |
| Wrong credential | Login failed state + sanitized artifact |
| MFA/CAPTCHA | Mark `human_required` |
| Portal layout unknown | Save sanitized discovery artifact |
| Timeout | Controlled retry once, then surface failure |

### Phase 6 Success Criteria

- PEPCO login discovery works.
- BGE login discovery works.
- Failed login produces sanitized screenshot/artifact.
- Missing credential gives clean error.
- MFA/CAPTCHA is detected and surfaced as human-required.

---

# Sprint 5 — Application + Real Submit

## Objective

Build reviewed application packages and real portal submission automation with hard safety gates.

---

## Phase 7 — Application Package + Human Review Flow

### Objective

Build the application model and human review workflow before actual submission.

### Tables Used

| Table | Use |
|---|---|
| `coordination_applications` | Draft/review/submission status |
| `coordination_records` | Current stage |
| `coordination_stage_transitions` | Audit |

### Backend Routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/uci/coordination/:id/applications/draft` | Create application draft |
| `POST` | `/api/uci/applications/:id/review` | Mark reviewed |
| `POST` | `/api/uci/applications/:id/needs-changes` | Send back |
| `GET` | `/api/uci/applications/:id` | Get application detail |

### Minimum Application Fields

| Field | Purpose |
|---|---|
| `application_type` | new service / service upgrade / temp power |
| `package_documents` | document refs |
| `load_summary` | structured JSON |
| `draft_status` | draft/reviewed/submitted |
| `agent_draft_metadata` | later LLM/template metadata |

### Frontend Additions

| UI | Purpose |
|---|---|
| Application draft panel | Shows missing data/docs |
| Review button | Human approves package |
| Needs changes button | Human rejects package |
| Submit button | Disabled until reviewed |

### Phase 7 Success Criteria

- Draft application row can be created.
- Review state works.
- Submit action is blocked unless `draft_status = reviewed`.
- Stage transition logs are written.

---

## Phase 8 — Actual Submission Automation

### Objective

Build real PEPCO/BGE submission automation safely.

### Required Safety Gates

| Gate | Required Behavior |
|---|---|
| Human reviewed | Required before submit |
| Production confirmation | Real submission requires explicit confirmation |
| Idempotency key | `coordination_applications.id` |
| Existing submitted check | If `submitted_at` exists, do not resubmit |
| Confirmation capture | Required for success |
| Failure artifact | Screenshot/HTML sanitized |
| Retry limit | Controlled, not infinite |
| Duplicate click protection | Backend rejects second submit |

### Backend Route

```txt
POST /api/uci/applications/:id/submit
```

Payload:

```json
{
  "submissionMode": "portal",
  "confirmRealSubmission": true
}
```

### Submission Workflow

| Step | Action |
|---|---|
| 1 | Verify user has project access |
| 2 | Verify application exists |
| 3 | Verify application is reviewed |
| 4 | Verify `submitted_at IS NULL` |
| 5 | Fetch provider + credential |
| 6 | Login portal |
| 7 | Navigate submission flow |
| 8 | Upload required docs |
| 9 | Fill required form fields |
| 10 | Final pre-submit checkpoint |
| 11 | Submit |
| 12 | Capture confirmation/ticket |
| 13 | Update application |
| 14 | Transition record to stage 4 completed |
| 15 | Transition record to stage 5 awaiting utility |

### First Real Submission Utilities

| Order | Utility |
|---|---|
| 1 | PEPCO |
| 2 | BGE |

Do not build real submission for all 10 at once.

### Phase 8 Success Criteria

- One reviewed test application can submit in a controlled environment.
- Confirmation/ticket captured.
- Second submit attempt is blocked.
- Failed submission gives debug artifact.
- Stage transition is correct.
- No credential leakage.

---

# Sprint 6 — Hardening + Demo Readiness

## Objective

Make UCI safe, auditable, and demo-ready.

---

## Phase 9 — Lifecycle + Audit Trail Completion

### Required Backend Behavior

| Action | Required Result |
|---|---|
| Provider record created | Stage 1 transition logged |
| Application drafted | Stage 3 in progress/completed |
| Application reviewed | Review metadata stored |
| Application submitted | Stage 4 completed |
| Awaiting acknowledgment | Stage 5 awaiting utility |
| Manual update | Transition log required |
| Blocked state | Reason required |
| Escalated state | Reason/severity required |

### Required Frontend Behavior

| UI | Purpose |
|---|---|
| Stage timeline | Shows stage 1–10 |
| Current state badge | Shows lifecycle state |
| Transition history | Shows audit trail |
| Manual transition modal | Allows human correction |
| Block/escalate buttons | Allows human intervention |

### Phase 9 Success Criteria

- Every stage change creates a transition row.
- UI shows transition history.
- Manual correction works.
- No silent state changes.

---

## Phase 10 — Test + Demo Readiness

### Required Tests

| Area | Test |
|---|---|
| Credential encryption | Save, update, decrypt at runtime |
| UI password safety | Password never shown after save |
| Auth | Unauthenticated `/api/uci` denied |
| Project access | User cannot access another project’s UCI data |
| Provider seed | All 10 placeholders visible |
| Coordination records | Create/list/update works |
| Stage transitions | Audit row created |
| Discovery | PEPCO/BGE login discovery |
| Submission idempotency | Second submit blocked |
| Failure artifacts | Screenshot/HTML sanitized |
| Existing scrapers | Washington/PGC/Montgomery/Howard still unaffected |

### Client Demo Flow

| Step | Demo |
|---|---|
| 1 | Open Settings |
| 2 | Show utility credential options |
| 3 | Save/update utility credential without exposing password |
| 4 | Open `/uci` dashboard |
| 5 | Show provider list |
| 6 | Create coordination record for project |
| 7 | Run portal discovery |
| 8 | Draft application |
| 9 | Mark reviewed |
| 10 | Submit application |
| 11 | Show confirmation/ticket |
| 12 | Show lifecycle stage transition |

### Phase 10 Success Criteria

- UCI can be demoed safely end-to-end.
- Existing permit scrapers still work.
- Credentials are encrypted and hidden.
- PEPCO/BGE discovery works.
- Actual submission is guarded, reviewed, and idempotent.
- Client can understand the lifecycle progress from `/uci`.

---

# 3. Exact Build Sequence

## Sprint 1 — Safety + Schema

| Order | Work |
|---|---|
| 1 | Audit `/api` auth and create UCI auth helper |
| 2 | Encrypt existing `portal_credentials` |
| 3 | Stop password echo in Settings UI |
| 4 | Add full UCI migration |
| 5 | Add RLS/access policies |

Do not move forward until this is complete.

---

## Sprint 2 — Backend + Settings

| Order | Work |
|---|---|
| 1 | Add all utility credential placeholders |
| 2 | Add `createUciRouter` |
| 3 | Mount `/api/uci` |
| 4 | Add provider list API |
| 5 | Add project coordination APIs |
| 6 | Add manual transition API |
| 7 | Seed all priority utility providers |

---

## Sprint 3 — UCI Dashboard

| Order | Work |
|---|---|
| 1 | Add `/uci` protected route |
| 2 | Add sidebar/mobile nav |
| 3 | Add provider setup status |
| 4 | Add project coordination table |
| 5 | Add stage timeline |
| 6 | Add manual transition UI |

---

## Sprint 4 — Portal Discovery

| Order | Work |
|---|---|
| 1 | Add shared UCI Playwright helpers |
| 2 | Add PEPCO login/discovery |
| 3 | Add BGE login/discovery |
| 4 | Add discovery API |
| 5 | Add safe artifact capture |
| 6 | Show discovery result in `/uci` |

---

## Sprint 5 — Application + Real Submit

| Order | Work |
|---|---|
| 1 | Add application draft API |
| 2 | Add review/needs-changes API |
| 3 | Add submit API with hard safety gates |
| 4 | Add PEPCO submit implementation |
| 5 | Add BGE submit implementation |
| 6 | Add confirmation/ticket capture |
| 7 | Add idempotency tests |

---

## Sprint 6 — Hardening + Demo Readiness

| Order | Work |
|---|---|
| 1 | Complete lifecycle transition logging |
| 2 | Add transition history UI |
| 3 | Add blocked/escalated handling |
| 4 | Run credential/security tests |
| 5 | Run PEPCO/BGE discovery and submit tests |
| 6 | Verify existing scrapers still work |
| 7 | Prepare client demo path |

---

# 4. Files That Should Be Changed

| Area | Files |
|---|---|
| Settings credentials | `src/components/settings/PortalCredentialsManager.tsx` |
| Settings page | `src/pages/Settings.tsx` |
| UCI route | `src/App.tsx` |
| Sidebar/nav | `src/components/layout/AppSidebar.tsx`, `src/components/layout/MobileBottomNav.tsx` |
| New UCI page | `src/pages/UciDashboard.tsx` |
| UCI frontend types | `src/types/uci.ts` |
| Backend route | `scraper-service/app/routes/uci.routes.js` |
| Backend mount | `scraper-service/app/register-execution-routes.js` |
| UCI services | `scraper-service/app/services/uci/*.js` |
| UCI portals | `scraper-service/uci/portals/*` |
| UCI migration | `supabase/migrations/YYYYMMDDHHMMSS_uci_foundation.sql` |
| Credential encryption migration | `supabase/migrations/YYYYMMDDHHMMSS_encrypt_portal_credentials.sql` |

---

# 5. Files That Should Not Be Touched Initially

| File / Area | Reason |
|---|---|
| `scraper-service/pgc-eplan-scraper.js` | Too large/risky; unrelated |
| Montgomery scraper internals | Working ProjectDox behavior should not be disturbed |
| Howard scraper internals | Current login/bootstrap issues are separate |
| Washington scraper internals | Not related to UCI |
| `POST /api/scrape` branching | Existing permit scraping should remain stable |
| QuickBooks crypto/token files | UCI cost billing is later |
| Supabase inbound email functions | No inbound UCI email yet |

---

# 6. Biggest Risks

| Risk | Severity | Fix |
|---|---|---|
| Plaintext credentials | Critical | Phase 0 encryption |
| Password echo in UI | Critical | Hide stored password immediately |
| Weak `/api/uci` auth | Critical | Explicit auth + project access checks |
| Actual submission duplicates | Critical | Idempotency + reviewed-only submit |
| Portal MFA/CAPTCHA | High | Detect and surface human-required |
| No queue system | Medium | Use DB status + synchronous guarded HTTP first |
| Full schema increases effort | Medium | Build schema now, implement progressively |
| New `/uci` dashboard scope creep | Medium | Keep first UI operational, not fancy analytics |

---

# 7. Non-Negotiable Implementation Rules

1. Do not start portal automation before credential encryption and API auth are handled.
2. Do not store or log plaintext credentials.
3. Do not return saved passwords to the frontend.
4. Do not submit real utility applications until human review is enforced.
5. Do not allow duplicate submissions.
6. Do not refactor working county scrapers as part of UCI.
7. Do not overload existing project `status` for UCI lifecycle state.
8. Do not build all 10 utility submissions at once. Start real submission with PEPCO/BGE only.
9. Do not claim inbound email, QuickBooks CIAC billing, or ML prediction is complete unless built and tested.
10. Every stage change must create a transition audit row.

---

# 8. Final Recommendation

The correct build order is:

```txt
security → schema → API → dashboard → discovery → submission → lifecycle hardening
```

Do not let implementation start with PEPCO/BGE automation first. That would create working automation on top of weak credential/auth foundations.

The first stable client-demo milestone should be:

1. Settings utility credentials added and secured.
2. `/uci` dashboard visible.
3. All priority utility placeholders shown.
4. PEPCO/BGE discovery works.
5. One reviewed PEPCO/BGE application can be submitted safely.
6. Confirmation/ticket and stage transition appear in UCI dashboard.
