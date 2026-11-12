# Central Permit Repository & Automated Scraping — Master Plan

Status: **APPROVED DIRECTION (2026-11-05), REVISED 2026-11-11 (unified DC deep automation, §0)** · Owner: PermitPilot engineering · First jurisdiction: Washington DC (DOB ProjectDox 9.5)

## 0. Unified DC deep automation (revision 2026-11-11, D-055 to D-067)

This section supersedes the parts of §2, §6 and §9 that say the worker never loads the HTTP app, that DC is metadata only, and that Portal Harvest and the Repository stay separate for DC. Everything else below still holds.

Amended 2026-11-12 (D-080 to D-088): view-only DC files are captured through the viewer into the private bucket (D-082 revises D-056); report-identity values are exempt from deny patterns in deep mode (D-081); failed captures retry with bounded back-off (D-080); a deep job with open items ends `completed_with_warnings` (D-086).

### 0.1 Objective
Automate the existing manual DC deep scraper and the agent pipeline behind it. It is not replaced by a metadata-only system. One flow per job:

```
saved credential (permit_sync_sources)
  → claim job (queue, lease, checkpoint)                                  [kept]
  → ONE login: performLogin from app/register-execution-routes.js         [D-055, retires the copied login]
  → discovery of every dashboard page, reconciled to "of N records"      [kept, live 28/28]
  → per permit, same browser context:
       a. JSON structured pass (adapter.fetchPermit → apply_permit_sync_batch)        [kept]
       b. deep tab pass when needed (scrapeAll: status, files, tasks, info, reports)  [D-059]
          - files: only new/unstored FileIDs the portal marks downloadable           [D-056, D-059]
          - reports: SSRS PDF/Excel export, text + structured rows                    [D-067]
          - binaries to the PRIVATE bucket permit-documents/<permit_id>/…             [D-058]
       c. central persistence: record_permit_document_download, record_permit_report_content
       d. linked projects only: syncPortalDataToSupabase(forbidInsert, no credential re-point) [D-060]
       e. hash changed → intake-pipeline-agent in service mode, deduplicated          [D-063]
  → finish with metrics; events in permit_sync_events
```

### 0.2 Keep / adapt / retire
| Piece | Decision | Notes |
|---|---|---|
| Queue, leases, events, checkpoint (`permit_sync_jobs/events`) | Keep | Deep pass adds checkpoint fields `deep_done` |
| Central tables, RLS, history, snapshots, changes | Keep | Additive columns/table in a new migration (A-1b) |
| JSON adapter (`adapters/dc-projectdox`) | Keep as the structured pass | Comment-gap fix in Phase 2 if the cause is ours |
| Admin export, R-1 project links | Keep | Export gains report content and storage refs |
| Worker shell (`core/worker.js`, `worker-entry.js`) | Adapt | `PERMIT_SYNC_MODE=deep` wires the deep runner |
| Read guard (`core/safety.js`) | Adapt: per-mode policy (D-057) | `json` unchanged; `deep` allows file/report reads only |
| `permit_reports` | Adapt: content, refs, versions (D-067) | New `permit_report_contents` (append-only versions) |
| Copied login in `live-transport.js` | Retire for deep mode | Deep mode injects `performLogin`; the copy remains only for the deployed JSON-only worker until it is redeployed (A-W), then is deleted |
| `core/downloads.js` stub | Retire | Replaced by the change gate in `permit-sync/deep/` |

### 0.3 Affected components
- `scraper-service/app/register-execution-routes.js`: additive only. Exported `dcDeep` object; optional trailing parameters (`scrapeAll` `deepOptions`, `syncPortalDataToSupabase` `syncOptions.forbidInsert/skipCredentialRepoint`, `collectDcPlanReviewDashboardProjects` `{ allPages }`); credential-lock check on DC `/api/login` and `/api/scrape`; a dashboard pager hop in `openDcPlanReviewProjectPopup` only when the permit link is not on the current page. Default arguments keep HTTP behaviour identical.
- `scraper-service/permit-sync/deep/*` (new): deep runner, change gate, credential lock, central persistence, pipeline trigger.
- `scraper-service/permit-sync/{worker-entry,core/safety,adapters/dc-projectdox/live-transport}.js`: mode wiring, per-mode guard, injectable login and shared dashboard page.
- `supabase/migrations/20261111120000_permit_deep_capture.sql` (new, not applied).
- `supabase/functions/_shared/serviceExecution.ts` (new) and the five pipeline functions: service execution mode (not deployed).
- Frontend: Permit Queue (`/permit-queue`) becomes the central permit UI; "Permit Repository" nav entry removed; `/permits/*` redirect.
- Not touched: Arlington, Montgomery, Howard, PGC, UCI, other scrapers, Code Analyzer V2.

### 0.4 Acceptance criteria (the user's 12) and how each is shown
| # | Criterion | Evidence required | Reachable locally? |
|---|---|---|---|
| 1 | All accessible DC projects discovered and reconciled with the live count | `metrics.discovered = expected_total` and `discovery_complete` on a supervised deep run | Offline fake portal only; live needs A-L2 |
| 2 | All available deep data captured, incl. structured reviews and authorized file/report contents | Section states ok; stored documents = permitted documents; report contents captured | Offline; live needs A-L1/A-L2 |
| 3 | Files and reports open in Permit Queue when captured | Signed URL from storage RLS; viewer only when `download_status='stored'` / content exists | Render tests; live needs A-1b + A-F |
| 4 | Permit Queue matches the portal's organisation | List columns + Tasks/Files/Status/Info/Reports/Reviews tabs | Render tests, local smoke |
| 5 | Manual scraping stays intact | Route list identical; default-argument tests; sync default still inserts | Yes |
| 6 | Linked projects auto-run the full agent pipeline with no browser | Service-mode trigger after a hash change | Offline (fake edge function); live needs A-E + A-L2 |
| 7 | Agent outputs accurate and deduplicated | Idempotency key `hash:<portal_data_hash>`, running-run dedupe, parser unchanged | Offline; live needs A-L2 |
| 8 | Central permits independent of project ownership | Permits written without projects; link grants nothing (D-006) | Yes (existing RLS tests) |
| 9 | No portal state change, no cross-tenant exposure | Deep guard mutation denies; private bucket + RLS; service mode owner + link checks | Offline; viewed-state check needs A-L1 |
| 10 | Unchanged data → no downloads, changes or agent runs | Second offline run: 0/0/0 | Yes (offline) |
| 11 | Deployed worker completes the deep workflow under supervision | Railway run | Needs A-W + A-L2 |
| 12 | Daily runs succeed and recover | Cron + 7 consecutive days | Needs A-4 (Phase 6, not ours) |

### 0.5 Approvals this revision needs (the authoritative ordered list, with commands and rollback, is HANDOFF.md "Approvals, in order"; it adds A-W0 scale-to-0 first and A-K project link before A-L2)
A-1b production migration `20261111120000_permit_deep_capture.sql` → A-E deploy the five pipeline edge functions + set `PERMITPILOT_SERVICE_PIPELINE_SECRET` → A-W scale the idle `permit-sync-worker` to 0 now; later redeploy it in deep mode → A-L1 supervised file/report retrieval test (1–2 permits) → A-L2 supervised deep run → A-F frontend deploy → A-6 flag → A-4 cron (Phase 6).

Phase status (2026-11-05): Phase 0 complete (`PHASE0_REPORT.md`). Phase 1 locally tested (`PHASE1_REPORT.md`); not applied to any Supabase project. Phase 2 locally tested against fixtures (`PHASE2_REPORT.md`); the live transport is implemented but has never run (A-3). Phase 3 implemented behind `module.central_permits` (OFF) with data layer and components tested (`PHASE3_REPORT.md`); project linking UI (P3.5 / R-1) implemented and locally tested; the flag stays OFF. Phase 4 blocked until the DC milestone, Priority 2 and Priority 3 are reviewed.

Sequencing change (2026-11-11, user priority: real automated DC scraping into production with a daily refresh; UI work and other jurisdictions paused): fix the credential-delete cascade and rename the permit migrations → A-1 production migrations (no staging exists, D-036) → A-3 one supervised run on the operator's Mac against production → A-5 Railway `permit-sync-worker` → A-4 pg_cron daily enqueue + `automation_enabled` → A-6 flag. Readiness audit and run plan: `HANDOFF.md`.

Status 2026-11-11 (~04:45 UTC, admin inspection): **Production config checked read-only: pass on every item. The 28 real DC permits can be inspected locally against production with the flag still OFF (D-052). The detail page shows all seven sections with an explicit extraction status and provenance. Admins can export one permit as JSON or all DC permits as a ZIP (D-053). Export counts equal production.** Reports are metadata only (D-054). Nothing deployed, no flag, migration or policy change, no commit. Next approvals: A-6, a frontend deploy (A-5), A-4.

Status 2026-11-11 (~04:10 UTC, A-5): **`permit-sync-worker` is online on Railway, headless, and idle.** No schedule. Deployment `1347f14a…` SUCCESS. It did not claim a job or log into the portal. Cron, `automation_enabled`, and `module.central_permits` were not changed. No commit. A-4 and A-6 stay blocked.

Status 2026-11-11 (~03:48 UTC, run 9): **A-3 run 9 completed.** D-050 drops non-GET page noise that is not a deny pattern, without failing the job. Dashboard 28, discovered 28, extracted 28, failed 0. 27 of 28 permits have all 7 sections ok (`TL2600008` has status and reviews absent). Tests 140/140. Permits stayed 28 with no duplicate groups. A-5, A-4 and A-6 were not touched.

Status 2026-11-11 (~03:32 UTC, run 8): **A-3 run 8 opened GET/HEAD on the one ProjectDox API host (D-049), logged in, and discovered 28 of 28. Extracted 0. The job then died `safety_violation` on POST `/cdn-cgi/rum` on `session.planreview.dob.dc.gov`.** POST stays refused. Tests 139/139. DB unchanged from run 7 (28 permits, no duplicates; 1 of 28 has all 7 sections). No second run and no further guard change. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~03:25 UTC, run 7): **A-3 run 7 allowed unnamed GET/HEAD on the two DC web hosts (D-048), logged in, and discovered 28 of 28. Extracted 0. The job then died `safety_violation` on GET `/User/GetSessionTimeout` on the API host, which still requires a named route.** Tests 137/137. DB unchanged from run 6 (28 permits, no duplicates; 1 of 28 has all 7 sections). No second run and no further guard change. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~03:15 UTC, run 6): **A-3 run 6 fixed the 401 (D-047) and extracted the first permit, 7 of 7 sections; then the read guard refused a `/Project/ProjectStatus` GET and the job ended `failed_unrecoverable` / `safety_violation`.** The API call now goes through the project page's own `fetch` with the `Sessionid` header and the browser's cookies, like the manual scrape. Tests 135/135. Dashboard 28, discovered 28, extracted 1. DB: 28 permits (no duplicates), 28 links, 7 snapshots, 38 changes. Next: the user decides how to treat that page-initiated GET; any further run needs a new job and approval. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~02:55 UTC, run 4): **A-3 run 4 stopped at login on the Okta page, before the new callback wait.** D-045 adds a 30-second wait on the exact Avolve `/Auth2/SsoCallback` page only, with no new host and no click. Tests 132/132. The one headed job never reached that page: `portal_changed`, "no password field", nothing blocked, no permit rows. No retry. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~02:48 UTC, run 3): **A-3 run 3 already stopped at login, after the password was submitted.** The DC source now uses credential `de8592f9…`, and the login phase allows the two exact Avolve hosts (D-044). The browser ended on the Avolve middleware's `/Auth2/SsoCallback`. The log and the job events name no blocked host or method. The user saw the page as blocked and said not to add more guards, so no third host and no further run. No permit data was written. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~02:25 UTC, run 2): **A-3 run 2 also stopped at login, at step 1, before any password was typed.** The diagnostics name the cause: the DC dashboard now redirects through two Avolve-hosted Azure hosts (`avolvecspiam-as-authmiddleware.azurewebsites.net`, `avolvecspiamsa.blob.core.windows.net`) that the login allowlist blocks (D-043). That is outside the one-domain approval, so nothing was changed or retried. Next: an approval to add those two exact hosts to the auth phase, then A-3 run 3. A-5, A-4 and A-6 stay blocked.

Status 2026-11-11 (~02:30 UTC): **A-1 applied to production and verified** (route (a), D-041; history 24 rows). **A-3 run 1 stopped at login** with "unrecognised login page" after 16.5 s. The key opened the credential, but no dashboard, discovery or section data was read, and no guard violation was recorded (D-042). Login diagnostics are added and locally tested (122/122), not live-verified. Next: a new A-3 approval for run 2. A-5, A-4 and A-6 stay blocked until a clean A-3 run.

Status 2026-11-11 (later): cascade fix (D-039) and rename to `20261111100000/100100/100200` (D-040) are done and locally tested. A-1 is not applied: production's migration history lacks 149 applied migrations, so `supabase db push` would need `--include-all`, which is forbidden. Waiting on the user's choice of apply route (recommended: `supabase db query --linked -f` for the three files, then `migration repair` for those three versions). A-3 is approved to follow A-1, supervised.

Companion files (keep updated every session):

| File | Purpose |
|---|---|
| `PROGRESS.md` | Phase/task tracker with verification level per item |
| `DECISIONS.md` | Decision log (ADR-style, append-only) |
| `HANDOFF.md` | Current state, next action, open approvals — read this first in a new session |
| `EXTRACTION_SPEC_DC.md` | Verified DC portal extraction specification (Phase 0 output) |
| `DEPLOYMENT_RUNBOOK.md` | Deploy, feature flags, monitoring, disable/rollback procedures |

Verification vocabulary used everywhere: **Implemented** (code exists) · **Locally tested** (tests pass on a dev machine) · **Deployed** (running in a non-local environment) · **Production-verified** (observed working in production against the live portal). Nothing is promoted a level without evidence recorded in `PROGRESS.md`.

---

### 0.6 Continuous deep scraping rollout (revision 2026-11-13, D-093 to D-101)

Goal: the first user-initiated, continuously running full DC deep refresh, then scheduled refreshes. The first full
refresh does not depend on the agent pipeline and is started only by the user from the Permit Queue.

| Step | Scope | State |
|---|---|---|
| P0 | Orchestration migration `20261113100000`, worker shutdown/health/heartbeat, Railway worker config, DC source audit | Implemented, locally tested |
| P1 | Permit Queue Refresh all / Refresh / progress; Management Admin scheduling, workers, alerts, Retry | Implemented, locally tested |
| P2 | CI with baselines, Railway "Wait for CI", monitor + notifier, cron scripts (not run) | Implemented, locally tested |
| P3 | Verify the first full refresh from persisted data (`scripts/permit-repo/verify-full-refresh.sql`) | Waiting for the user's run |
| P4 | Agent service mode: hash stability (D-101, done locally); preserve human edits (D-088 keying); soft-mark unmatched comments; pipeline on new links; no duplicate runs; BCIV2500152's 6 comments first | Hash fix only |
| P5 | Project creation from the jurisdictions directory, multi-permit links, filing linkage | Not started |
| P6 | Code Analyzer V2 bridge (design below) | Design only |

Order of production steps (each needs approval): push branch → migration → worker variables and deploy → frontend
deploy → user's Refresh all → P3 verification → monitor cron (+ notifier) → schedule enable + sync cron.

**P6 design (no analyzer changes during the scraping rollout).** Permit files stay in the private `permit-documents`
bucket, keyed by `permit_documents` (sha256, rendition flag, permit version). A linked project offers "Analyze with
Code Analyzer V2" for stored drawings; the bridge creates analyzer source documents that reference the stored
object (signed URL at read time, no public copy) and records provenance (`permit_document_id`, sha256, portal
version, rendition). Findings keep their existing citations (`source_document_id`, page, bbox or `sheet_job_id`);
provenance maps them back to the permit file. Renditions are labelled as portal PDF renditions. New stored files
(capture hash change, D-085) mark the analysis outdated; they never start an analysis on their own.

## 1. Evidence base (summary)

Sources: codebase audits (Phase 1/2 audits, Nov 2026), live DC portal investigation (Nov 4 2026, read-only, logged-in browser), architecture plan (Nov 5 2026).

Live DC portal facts (observed):
- Two hosts: ePlan dashboard `planreview.dob.dc.gov` → SSO handoff `/login/sso` → ProjectDox `session.planreview.dob.dc.gov`.
- Account "Commun-ET LLC" sees **28 projects** (dashboard 3 pages × 10; ProjectDox Home grid 4 pages × 9, server-paged `GetPagedActiveProjects`).
- Project page `Project/Index?ProjectID=N&tab=<tasksTab|filesTab|projectStatusTab|projectInfoTab|reportsTab|correctionsTab>`; direct deep links work; tabs load by AJAX.
- Tab set varies by state: Resubmit = 6 tabs incl. **Reviews**; Approved = 5 tabs (no Reviews).
- Reviews: Ref#, dept, reviewer, timestamp, cycle, status, type, text, response.
- Files: folder tree with counts; file IDs (`viewFile(id)`); versions; File History audit log (our views are logged by DOB).
- Approved projects: "Approved Drawings"/"Approved Supporting Documents" folders; Status "Total Number of Files" exceeds visible files (hidden prior files).
- State-changing controls adjacent to data: `AcceptTask`, `ProcessTask`, `launchEForm(...autoAssignTask=true)`, Upload/Move/Delete, "Mark as reviewed" (`File/ToggleViewed`), comment/response textareas, grid "Save Settings".
- Page JS uses a separate API origin `Globals.ApiUrl` (historically `washington-dc-us-projectdoxwebapi.avolvecloud.com`) with `File/GetFolderFiles`, `File/RetrieveFile`, `Project/GetProjectCorrectionTasks`, `MetaData/GetMetadataDefinition` (from saved frame `scraper-service/raw_frame_0.html`, 2026-03). PGC scraper uses `ProjectDoxWebAPI/WorkflowAggregate/GetProjectCorrectionsByCycleInstance`, `GetWorkflowTaskList`, `Workflow/GetWorkflowInstances`, `Folder/GetFolders`.

Codebase facts (code-supported): see `DECISIONS.md` D-001…D-010 and the gap list in §9.

---

## 2. Architecture and component boundaries

```
                ┌──────────────────────── Supabase (Postgres) ────────────────────────┐
 Admin UI  ───► │ permit_sync_sources (credential automation, admin-only)               │
 (Vercel)       │ permit_sync_jobs / permit_sync_events (additive durable queue)        │
                │ permits + permit_* child tables (central repository)                  │
 Dashboard ───► │ permit_source_links (credential provenance)                           │
 (Vercel, RLS)  │ permit_access_grants (Management-Admin-controlled visibility)          │
                │ permit_snapshots (raw evidence) · permit_changes (history)            │
                │ project_permits (optional link to client projects)                    │
                │ storage bucket permit-documents (PRIVATE, RLS by permit access)        │
                │ pg_cron → enqueue_permit_sync_runs()  (schedule OFF until approved)    │
                └───────────────▲───────────────────────────────▲──────────────────────┘
                                │ service role (claim/heartbeat/│apply RPCs)
                ┌───────────────┴──────────────── Railway ──────┴──────────────────────┐
                │ Service A (existing): scraper-service HTTP (manual scrapes, Arlington) │  ← unchanged
                │ Service B (new): permit-sync-worker (same image, different CMD)        │
                │   core: claim → adapter.login → discover → fetchPermit → ingest        │
                │         → downloads → finalize metrics → release                       │
                │   adapters/dc-projectdox (first); registry for future adapters         │
                │   safety: network allowlist + deny patterns + safeClick                │
                └────────────────────────────────────────────────────────────────────────┘
```

Boundaries:
- **Adapters** (`scraper-service/permit-sync/adapters/<key>/`) own portal navigation and raw payload capture only. They never write to Supabase.
- **Normalizers** (pure functions per adapter) convert raw payloads to canonical records. Fixture-tested.
- **Core** (`scraper-service/permit-sync/core/`) owns job lifecycle, ingest (diff + apply RPC), downloads, metrics, safety wiring. Jurisdiction-agnostic.
- **Database** owns integrity: unique portal keys, transactional apply, RLS, append-only evidence.
- **Existing systems** (manual scrape routes, Arlington durable worker, `scrape_jobs`, `projects.portal_data`, Code Analyzer V2, UCI) are not modified except where explicitly listed in §4 with regression tests.

---

## 3. Phases, tasks, dependencies

### Phase 0 — Live verification & extraction specification (no DB changes)
| ID | Task | Depends | Output |
|---|---|---|---|
| P0.1 | Resolve live `Globals.ApiUrl` origin and endpoint availability (GET only) | — | spec §API |
| P0.2 | Verify JSON for tasks, corrections (Reviews), folders/files, workflow instances on ≥1 active + ≥1 approved project | P0.1 | redacted fixtures |
| P0.3 | Verify discovery: grid paging mechanism & total; reconcile live inventory vs the 28 observed | — | inventory fixture |
| P0.4 | Document download & report mechanisms (observe only; no downloads that mutate) | P0.1 | spec §Files/Reports |
| P0.5 | Document auth/session behavior (SSO, timeouts, MFA presence) from code + observation | — | spec §Auth |
| P0.6 | Safety guard module (deny/allow patterns, request interceptor, safeClick) + tests from observed handler strings | — | `permit-sync/core/safety.js` |
| P0.7 | `EXTRACTION_SPEC_DC.md`; Phase 0 report | all | docs |
Acceptance: every section in spec marked Observed / Code-supported / Unverified; fixtures redacted (no emails/phones/names beyond role labels); safety tests pass; inventory reconciled or deltas explained. Items not verifiable without new login or approval are recorded as blockers, not assumed.

### Phase 1 — Central data architecture & ingestion
| ID | Task | Depends |
|---|---|---|
| P1.1 | Migration `…_central_permit_repository.sql` (additive tables, constraints, indexes, RLS, helper functions) | P0.7 |
| P1.2 | Access model: `can_read_permit()`, `permit_access_grants`, provenance via `permit_source_links`; admin RPCs with audit events | P1.1 |
| P1.3 | Transactional `apply_permit_sync_batch(...)` RPC (service role only) | P1.1 |
| P1.4 | JS canonical model + DC normalizers + differ + integrity guards (no-empty-overwrite) | P0 fixtures |
| P1.5 | Ingest service calling RPC; idempotency | P1.3, P1.4 |
| P1.6 | Private bucket + storage RLS | P1.1 |
| P1.7 | SQL tests (PGlite: schema, RLS matrix, apply idempotency) + JS unit tests | all |
Acceptance: re-applying the same batch yields zero changes; failed/partial sections never overwrite prior rows; RLS matrix (admin / granted user / credential-grant user / unrelated user / project member without grant / anon) passes; existing test suites pass unchanged.

### Phase 2 — Worker, DC adapter, scheduling, downloads
| ID | Task | Depends |
|---|---|---|
| P2.1 | Additive queue RPCs: claim/heartbeat/release for `permit_sync_jobs` (Arlington pattern, per-source concurrency) | P1.1 |
| P2.2 | DC adapter: login (reuse DC login helpers, no plaintext retention), discovery w/ pagination + total assertion, per-permit sections via JSON API (DOM fallback) | P0, P1.4 |
| P2.3 | Worker core: run loop, checkpoint cursor, retries/backoff, error taxonomy, metrics, safety wiring | P2.1 |
| P2.4 | Incremental downloads → private bucket (new (file_id, version) only), sha256, caps | P1.6 |
| P2.5 | Worker entrypoint (separate Railway service) + feature env flags | P2.3 |
| P2.6 | `enqueue_permit_sync_runs()` + admin "sync now" RPC; cron schedule **not enabled** | P2.1 |
| P2.7 | Tests: claim concurrency (PGlite), resume from checkpoint, retry/backoff, safety abort, adapter against fixtures | all |
Acceptance: local fixture-driven end-to-end run ingests all fixture permits; kill/resume completes without duplicates; safety violation aborts run; live run requires approval (A-3).

### Phase 3 — Dashboard & management
| ID | Task | Depends |
|---|---|---|
| P3.1 | Data access hooks (Supabase client, RLS-respecting) | P1 |
| P3.2 | `/permits` list: search (permit #, address, description, status, reviewer, comment text), filters, freshness | P3.1 |
| P3.3 | `/permits/:id` detail: Overview/Status, Reviews, Tasks, Documents & versions, Reports, History, Sources | P3.1 |
| P3.4 | Admin: sources/credentials automation, access grants, sync runs & failures, data-quality metrics, manual sync | P2.6 |
| P3.5 | Project ↔ permit linking UI (link grants no data access by itself) | P1.2 |
| P3.6 | Feature flag gating; component tests | all |
Acceptance: pages render from RLS-scoped data only; unauthorized users see nothing; flag off = no navigation entry and routes 404/redirect; tests pass; existing pages unchanged.

### DC completion milestone (before Phase 4)
Goal: complete, accurate, structured extraction of every section the DC account can read for a permit, not just a successful job. Requirements: `DC_DEEP_EXTRACTION_REQUIREMENTS.md` (written from the read-only capture of project 11854 before any implementation).
| ID | Task | Status |
|---|---|---|
| DC-1 | Requirement document from read-only capture (Reviews, Info, Status, Tasks, Files, Reports) | Done |
| DC-2 | Reviews: from `GetProjectCorrectionsByCycleInstance` JSON (the HTML partial is a template shell, found 2026-11-06). DOM extractor kept for rendered-capture parity | Locally tested |
| DC-3 | Info DOM extractor with allowlisted labels only; emails and phones never read; raw partial confirmed server-rendered | Locally tested |
| DC-4 | Transport: corrections JSON, Info partial, report, report list through the read-only guard; `Globals.Session.SessionID` fix; A-3 gate unchanged | Implemented. A-3 run 1 (2026-11-11) stopped at login, so the read paths are still not run live (D-042) |
| DC-5 | Reports list (`GetReportList`) and Review Comments report parser (fallback Reviews source) | Locally tested (U-1, U-2 closed) |
| DC-6 | Tasks: `Tasks[]` shape and field names | Locally tested (U-3 closed for mapped fields) |
| DC-7 | Time zone of offset-less dates | Closed (U-4): America/New_York; EST observed |
| DC-8 | Fixtures corrected to verbatim portal text (were paraphrased; Ref 3 had two discussion entries missing) | Done |
Exit criteria: DC-2 to DC-7 tests pass; U-6 (MFA, session lifetime) accepted as the only blocker for the A-3 run; no live run. Phase 4 starts after this milestone is reviewed.

### Phase 4 — Multi-jurisdiction readiness & hardening
| ID | Task |
|---|---|
| P4.1 | Map a second existing ProjectDox implementation (Montgomery or Howard) onto the adapter contract using existing code + fixtures; generalize only shared pieces |
| P4.2 | Reliability tests (lease expiry, concurrent workers, partial failures), scale estimate |
| P4.3 | Monitoring (job health view, stale-permit detection, alert hooks via existing platform notifications) |
| P4.4 | Ops docs: runbook, readiness checklist, final coverage & security reports |

---

## 4. Database migrations & backward compatibility

Single additive migration per phase; **no ALTER of existing tables** in Phases 1–3 (decision D-004). Tables:

- `permit_sync_sources` (PK `credential_id` → `portal_credentials`; `adapter_key`, `automation_enabled` default false, `status`, `last_login_ok_at`, `last_error`, `consecutive_auth_failures`, `settings` jsonb). Admin-only RLS.
- `permits` (unique `(adapter_key, portal_record_id)`; identity, status, summary jsonb, `available_sections`, freshness timestamps, `removed_from_portal_at`, `search_tsv`).
- `permit_source_links` (`permit_id`, `credential_id`, first/last seen, `last_seen_run_id`, `unseen_since`).
- `permit_section_state` (per-section status, hash, last ok, consecutive failures; D-016).
- `permit_review_comments` + `permit_review_responses`, `permit_tasks`, `permit_workflows`, `permit_document_folders`, `permit_documents` (key `(permit_id, portal_file_id)`; ProjectDox issues a new FileID per version), `permit_reports`.
- `permit_snapshots` (append-only; insert when section hash changes), `permit_changes` (append-only).
- `permit_access_grants` (grantee user or tenant; scope permit / jurisdiction(adapter) / source credential).
- `project_permits` (link only).
- `permit_sync_jobs`, `permit_sync_events` (queue, additive; mirrors Arlington lease semantics) — Phase 2 migration (P2.1); `run_id` columns in Phase 1 tables are plain UUIDs with no FK so Phase 1 stands alone.
- Storage bucket `permit-documents` (private).

Backward compatibility: nothing existing reads these tables; manual scraping keeps writing `projects.portal_data`; Arlington untouched. Existing DC projects can later be linked via `project_permits` (suggested by normalized permit number, admin-confirmed).

**Rollback policy** (D-009): never drop tables containing collected data as a routine rollback. Disable in order: (1) unschedule cron / set `automation_enabled=false`, (2) scale worker service to 0 / `PERMIT_SYNC_WORKER_ENABLED=false`, (3) turn feature flag off, (4) revoke grants if a security issue. Schema reversal only via a reviewed forward migration after data export.

---

## 5. Access control

- **Management Admin** = existing `admin`/`super_admin` app roles (`has_role`, `is_super_admin`).
- **Default deny.** A user can read a permit iff: admin; OR holds `use`/`manage` grant on a credential in `permit_source_links` for that permit (provenance); OR has an explicit `permit_access_grants` row (user or tenant membership) for the permit, its adapter/jurisdiction, or its source credential.
- Linking a permit to a project **does not** grant access (D-006).
- Child tables, snapshots, changes, documents, storage objects all gate on `can_read_permit(permit_id)`.
- Writes only through service-role RPCs; no INSERT/UPDATE/DELETE policies for `authenticated` on repository tables.
- Governance `enforce_mode` is not consulted (it defaults to `legacy`, allow-all).
- Admin mutations append `platform_audit_events`.

## 6. Security & read-only enforcement

- Credentials: automation requires AES-GCM envelope (`pc_v:1`); plaintext rows are refused for automation (status `needs_encryption`). Password decrypted only within adapter login; never logged or stored on session objects.
- Portal safety layers: (1) navigation/API allowlist, (2) Playwright `context.route` blocking non-GET except exact allowlisted read endpoints and blocking deny patterns (`AcceptTask`, `ProcessTask`, `Eform.aspx`, `autoAssignTask`, `ToggleViewed`, `Upload`, `Delete`, `Move`, `SaveUserSettings`, correction save/response endpoints, …), (3) `safeClick` refusing elements whose href/onclick match deny patterns, (4) post-run task-state check, (5) any violation aborts run as `failed_unrecoverable`.
- DOB-visible footprint: daily runs avoid file-info dialogs and only download new versions.
- No MFA/CAPTCHA bypass; MFA → `waiting_user` + admin alert. Two consecutive auth failures pause the source.

## 7. Testing & acceptance (measurable)

- Unit: safety patterns, normalizers (fixtures), differ, integrity guards, job state machine.
- SQL (PGlite, real Postgres 16): schema applies; RLS matrix; apply idempotency; claim concurrency.
- Integration (local, fixtures): end-to-end ingest of all fixture permits.
- Live (approval A-3): 28/28 discovery (or reconciled delta), section coverage 100% of available tabs, count parity checks (unresolved comments, folder counts, task totals, file totals incl. hidden), zero safety violations, idempotent re-run, 7 consecutive daily runs before "production-verified".

## 8. Deployment, flags, monitoring

- Flags: `PERMIT_SYNC_WORKER_ENABLED` (worker env, default false), `PERMIT_SYNC_DOWNLOADS_ENABLED` (default false), per-source `automation_enabled` (default false), frontend flag `central_permits` (default off), cron schedule absent until approved.
- Monitoring: `permit_sync_jobs` status/heartbeat, `permit_sync_events`, per-run metrics JSON (discovery recall, section coverage, parity), stale-permit view.
- Approvals required (tracked in `HANDOFF.md`): A-1 production migration; A-2 production encryption key / credential re-encryption; A-3 first live automated run; A-4 enable schedule; A-5 deploy worker service; A-6 enable frontend flag in production; A-7 DOB/ToS policy for automated access.

## 9. Known gaps addressed (from audits)

Discovery page-1-only · Reviews never captured (`comments: []`) · single-row overwrite of `projects.portal_data` · owner-only credential checks · optional password encryption · public `project-drawings` bucket · governance legacy mode · scraped-data-scope default-allow · duplicate credentials (unique index pending) · worker in HTTP process · claim RPC Arlington-only · DC logic inside 14k-line route file · Info extractor false-skip · description cap · no history.

## 10. Risks & unresolved assumptions

See `DECISIONS.md` and `HANDOFF.md` (live list). Principal: DOB/ToS acceptance of automation (A-7); MFA introduction; Avolve UI/API changes; live API availability on new DC host (Phase 0); production config state unknown (encryption key, enforce mode, deployed revision).
