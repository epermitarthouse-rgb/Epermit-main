# Progress Tracker

Branch: `feat/central-permit-repository` (from `main` @ `dca1f82`).
Levels: Implemented · Locally tested · Deployed · Production-verified. "—" = not reached.

| Phase | Item | Status | Level | Evidence / notes |
|---|---|---|---|---|
| Plan | Master plan, decisions, handoff | Done | n/a | `MASTER_PLAN.md`, `DECISIONS.md`, `HANDOFF.md` |
| 0 | P0.1 API origin | Observed live | Production-observed | 2026-11-05, project 9187 (B2508295) page source. `ApiUrl=https://washington-dc-us-projectdoxwebapi.avolvecloud.com`. Same origin as the earlier 29433 page. Details in `EXTRACTION_SPEC_DC.md`. |
| 0 | P0.2 JSON endpoints | Observed | Production-observed | Five GET routes with `Sessionid` header, captured in DevTools on In Review 28933, Resubmit 11854 and Approved 11105: `GetProjectFolders`, `GetFolderFiles`, `GetActiveWorkflowTaskList`, `GetWorkflowInstancesList`, `GetWorkflowInstanceStatusData`. HTML partials: `ProjectCorrections` (Reviews), `ProjectInfo`, `WorkflowTaskList`. |
| 0 | P0.3 Discovery | Observed, reconciled | Production-observed | All 3 pages read: 28/28 = Approved 15, Upload 6, In Review 4, Resubmit 3. Fixture `tests/fixtures/permit-sync/dc/inventory.json`. |
| 0 | P0.4 Downloads/reports | Observed | Production-observed | `DownloadFile: false` for this account, so metadata only (D-014). Review Comments = SSRS `ReportViewer.aspx?ReportID=14&...&ProjectID&WFlowInstanceID`, opened read-only; export not used. |
| 0 | P0.5 Auth | Observed | Production-observed | `launchRemote` → `/login/sso` → ProjectDox tab. A typed `session.planreview` URL ends the session. Azure SSO, timeout 360. MFA and lifetime under automation remain Unverified (need a new login or an approved run). |
| 0 | P0.6 Safety guard | Locally tested | Locally tested | Allowlist replaced with the observed routes; deny list adds viewFile, ApprovedPlans, Download Files, Resubmit, report export, SessionEnded, Log Out. `node --test tests/permit-sync-safety.test.js tests/permit-sync-dc-fixtures.test.js`: 24 pass. |
| 0 | P0.7 Spec + report | Done | n/a | `EXTRACTION_SPEC_DC.md` rewritten with Observed levels; redacted fixtures in `tests/fixtures/permit-sync/dc/`; `PHASE0_REPORT.md`. |
| 1 | P1.1 Migration | Locally tested | Locally tested | `supabase/migrations/20261111100000_central_permit_repository.sql`: 15 tables, RLS on all, private bucket. Additive; re-runnable. Applies on top of the full real chain (169 migrations, PGlite) with zero changes to pre-existing objects (`permit-repo-chain.test.js`). Not applied to any Supabase project. |
| 1 | P1.2 Access model | Locally tested | Locally tested | `user_can_read_permit` / `can_read_permit`; grants by permit, adapter, source credential, user or tenant; audited admin RPCs. 12-actor RLS matrix incl. anon, inactive, revoked, project member without grant (`permit-repo-rls.test.js`). Mutation-tested: opening the access function or the storage policy makes tests fail. |
| 1 | P1.3 Apply RPC | Locally tested | Locally tested | `apply_permit_sync_batch`, `apply_permit_discovery`, `record_permit_document_download` (service role only). DB-side diff (D-015), section semantics (D-016). |
| 1 | P1.4 Normalizers/guards | Locally tested | Locally tested | `permit-sync/core/{canonical,redact,ingest}.js`, `permit-sync/adapters/dc-projectdox/normalize.js`. Count-parity downgrade, failed-section field drop, ET→UTC (D-017). Active-task source field names other than `WFlowTaskID`/`GroupName` are Unverified. |
| 1 | P1.5 Idempotent ingest | Locally tested | Locally tested | 28/28 discovery, no duplicates; identical re-import → 0 changes, 0 snapshots, `updated_at` unchanged; single real change → exactly one `updated` row with before/after. |
| 1 | P1.6 Bucket + storage RLS | Locally tested | Locally tested | `permit-documents` private; object readable only with permit access AND a `stored` document row at that path. Storage schema is a stub of Supabase storage. |
| 1 | P1.7 Tests | Locally tested | Locally tested | `npm run test:permit-sync`: 55 pass. Regression: scraper-service `npm test` 158/159 and code-analyzer-worker `npm test` 75/76, same single pre-existing failures as before Phase 1; migration-reading suites 104/104 (scraper) and 134/134 (src, `node --import tsx --test`). |
| 1 | Phase 1 report | Done | n/a | `PHASE1_REPORT.md` |
| 1 | P1.8 Envelope check fix | Locally tested | Locally tested | Found in Phase 2: the encryption check never matched real envelopes. Fixed in the Phase 1 migration (still unapplied) via `_permit_credential_is_encrypted` (D-024); parity test against `encryptPortalPassword`. |
| 2 | P2.1 Queue migration | Locally tested | Locally tested | `supabase/migrations/20261111100100_permit_sync_queue.sql`: `permit_sync_jobs`, append-only `permit_sync_events`, enqueue/claim/heartbeat/finish/cancel/resume RPCs (D-021). Included in the chain replay; pre-existing objects unchanged. Not applied anywhere. |
| 2 | P2.2 DC adapter | Locally tested (fixtures) | Locally tested | `adapters/dc-projectdox/{adapter,routes,normalize}.js` against the fixture transport (every URL through the real guard). |
| 2 | P2.2b Live transport | Implemented | Implemented | `adapters/dc-projectdox/live-transport.js` (D-022). Pure policy/classifier/parsers unit-tested; Playwright flow never run. Reviews/Info/Reports/SSRS parsers `not_implemented`. Needs A-3. |
| 2 | P2.3 Worker core | Locally tested | Locally tested | `core/{worker,errors}.js`: checkpoints, resume, error taxonomy, metrics, lease-loss stop. 28-permit end-to-end on PGlite; re-run → 0 changes. |
| 2 | P2.4 Downloads | Implemented (policy only) | Locally tested | `core/downloads.js` deny-by-default; DC always skipped (D-014). No downloader. |
| 2 | P2.5 Entrypoint | Locally tested | Locally tested | `permit-sync/worker-entry.js`, two-flag gate, no HTTP app loaded (D-025). Decrypt path tested with real envelope. |
| 2 | P2.6 Enqueue/admin RPCs | Locally tested | Locally tested | `enqueue_permit_sync_runs`, `admin_request_permit_sync`, `admin_cancel_permit_sync_job`, `admin_resume_permit_sync_source`. No cron (A-4). |
| 2 | P2.7 Tests | Locally tested | Locally tested | `npm run test:permit-sync`: 81 pass. Regression: scraper-service 158/159, code-analyzer-worker 75/76 (same pre-existing failures). |
| 2 | Phase 2 report | Done | n/a | `PHASE2_REPORT.md` |
| 3 | P3.0 UI migration | Locally tested | Locally tested | `supabase/migrations/20261111100200_central_permits_ui.sql`: `module.central_permits` flag row (OFF) and `search_permits` (D-027). Chain replay: existing objects and existing flag rows unchanged. Not applied anywhere. |
| 3 | P3.1 Data access | Locally tested | Locally tested | `src/lib/centralPermits.ts` (RLS-scoped reads, audited admin RPCs). Unit tests with an injected client. |
| 3 | P3.2 `/permits` list | Implemented | Implemented | `src/pages/permits/PermitsPage.tsx`; search by permit #, address, description, department, comment text; status filter; removed toggle; paging. Table component render-tested; page not exercised in a browser. |
| 3 | P3.3 `/permits/:id` detail | Implemented | Implemented | `src/pages/permits/PermitDetailPage.tsx`: Overview (details, unresolved by department, section health), Reviews, Tasks, Documents, Reports, History, Sources. Tab bodies render-tested. |
| 3 | P3.4 Admin | Implemented | Implemented | `src/pages/admin/AdminPermitSync.tsx`: sources (Sync now, Resume), jobs (events, Cancel), access grants (grant, revoke). Data calls unit-tested; page not exercised in a browser. |
| 3 | P3.5 Project ↔ permit linking UI (R-1) | Locally tested | Locally tested | `src/lib/centralPermits.ts` (`loadProjectPermitLink`, `listPermitProjectLinks`, `linkProjectToPermit`, `unlinkProjectFromPermit` via the audited admin RPCs); `components/permits/ProjectPermitLinkPanel.tsx` (Portal Harvest "Permit record" panel with admin search-and-link; permit Overview "Linked projects" panel); `PermitLinkViews.tsx` (presentational). Flag-gated (renders nothing while `module.central_permits` is off). Tests: 7 data-layer tests, 9 view tests. Not run against a live Supabase stack; no migration applied. |
| 3 | P3.6 Flag gating + tests | Locally tested | Locally tested | Routes/nav gated (D-026). `node --import tsx --test` on the new and flag tests: 80 pass; existing route/nav/flag tests 88/89 (UCI Builder failure pre-existing). SQL search tests 5 pass. |
| 3 | Phase 3 report | Done | n/a | `PHASE3_REPORT.md` |
| DC | DC-1 Requirement doc | Done | n/a | `DC_DEEP_EXTRACTION_REQUIREMENTS.md` written from the read-only 11854 capture, before implementation. |
| DC | DC-2 Reviews | Locally tested | Locally tested | Source changed to `GetProjectCorrectionsByCycleInstance` JSON (`normalize.correctionRowsFromJson`): the raw `ProjectCorrections` partial holds templates only (live, 2026-11-06). Tested against the live-captured `corrections-json-11975.json` and the rendered Reviews tab (`tests/permit-sync-dc-json.test.js`). `extractCorrectionRows` kept for rendered-DOM parity. |
| DC | DC-3 Info extractor | Locally tested | Locally tested | `extractProjectInfoFields`. Allowlisted labels only. Dates to YYYY-MM-DD. "Project name" (permit number) is not mapped to the title. Raw partial confirmed server-rendered (15 rows, live). |
| DC | DC-4 Transport | Implemented | Implemented | `getCorrectionsRows` (JSON), `getReviewCommentsReport` (guarded GET + in-page `DOMParser`, refuses >1 page), `getProjectInfo`, `listReports` (JSON). Session id read from `Globals.Session` (was `window.Session`, undefined live). Refuses without A-3. Never run through Playwright against the portal. |
| DC | DC-5 Reports / ReportViewer | Locally tested | Locally tested | `GetReportList` → `reportListItems` (route `report_list`). `extractReviewCommentsReport` tested in Chromium on the redacted 11854 report; matches the JSON except two response times the report prints 2 min earlier (documented). Adapter: JSON primary, report fallback. |
| DC | DC-6 Tasks | Locally tested | Locally tested | Response is `{Tasks[]}`; adapter read `Items`/`Records` (fixed). Verified fields from one live 9187 task. |
| DC | DC-7 Time zone | Closed | — | JSON, report and tab share one clock; report clock = America/New_York (EST observed). D-017 confirmed. |
| DC | DC-8 Fixture correction | Done | — | Verbatim comment/response text; Ref 3 second discussion entry added. Counts updated: reviews rows 6 (3 comments + 3 responses). |
| DC | Test status | Locally tested | — | `npm run test:permit-sync` in the sandbox: 86 pass; the 13 DOM tests need Chromium (pass outside the sandbox: 13/13). permit-repo ingest 10/10 with updated counts. |
| DC | Offline re-verification (2026-11-06, later session) | Locally tested | — | Independent check of the live-evidence work: 115/115 tests (94 + 21 Chromium), fixture PII scan clean on all 10 DC fixtures, guard refuses export, `rs:Format`, and POST, report list maps to the 5 reports seen on the Reports tab, corrections JSON reproduces the Reviews-tab discussion times, report header matches the workflow selector. |
| P2 | Portal Harvest vs Repository | Done (recommendation); R-1 locally tested | n/a | `PORTAL_HARVEST_VS_REPOSITORY.md`, D-034: keep separate jobs, link via `project_permits`, converge per jurisdiction. R-1 (linking UI and both cross-links) implemented and locally tested 2026-11-06. R-2 to R-5 not started. |
| P3 | Local integration verification | Locally tested, plus a local browser pass | — | `PRIORITY3_INTEGRATION_REPORT.md` plus a later no-Docker browser pass (`scripts/local-dc-e2e/`). Permit-sync suite 114/115, then the chain test was updated for an interleaved migration and re-ran 3/3. Frontend permit/flag tests 115/115. Browser: list, comment search, D2500488 detail, both link directions, admin sync page, owner vs unrelated RLS. Not a live portal. |
| A-3 | Live-run readiness audit (2026-11-11) | Done (read-only) | — | Production (`eeqxyjrcldivtpikcpvk`) inspected over REST with the local service-role key, GET only; Railway via CLI, variable names only. DC credentials: 2 rows, same login; `0610eaa5…` encrypted envelope (recommended source), `de8592f9…` plaintext (legacy, 10 projects). Permit migrations: none applied; `20261106140000` is applied, so the permit files are out of order. Local and Railway encryption keys are identical (hash equality only). No staging Supabase exists. Details: `HANDOFF.md` "A-3 readiness audit". |
| A-3 | Worker fixes from the audit | Locally tested | Locally tested | Decrypt failure is a non-retryable `auth_failed` before any browser starts; `PERMIT_SYNC_WORKER_ONCE=true` claims one job and exits; transport codes (`login_ok`, `api_session_ok`) reach the console; guard violations record method and redacted path. `npm run test:permit-sync` (Chromium path set, outside sandbox): **117/117** (115 + 2 new). |
| A-1 | Credential-delete cascade defect (found in audit) | Fixed | Locally tested | D-039 (approved). `_permit_sync_events_guard`: delete only inside an FK cascade with the job already gone. `_permit_sync_jobs_delete_guard`: same rule with the source gone. TRUNCATE guards on both tables. Tests: credential delete as the service role (the app's route) succeeds after a claimed, finished job with events, and cascades source, jobs and events; direct UPDATE/DELETE/TRUNCATE on events, a direct job delete, and a trigger-nested delete all fail; permits, snapshots and changes survive the credential delete and stay append-only. Mutation-checked: the old trigger and a depth-only guard both fail the new test. |
| A-1 | Migration rename | Done | Locally tested | D-040 (approved). Now `20261111100000_central_permit_repository.sql`, `20261111100100_permit_sync_queue.sql`, `20261111100200_central_permits_ui.sql`. Helpers, chain test and docs updated; `scripts/local-dc-e2e` has no name references. `npm run test:permit-sync` 119/119 (Chromium, outside sandbox); frontend permit tests 27/27. |
| A-1 | Production apply (2026-11-11 02:08 UTC) | Applied and verified | Production-verified (schema) | Approved route (a), D-041. Baseline re-checked first: 16 credentials, 88 projects, 3 cron jobs, only `permit_filings` (+ its pkey). Each file run with `supabase db query --linked -f` from a `BEGIN;…COMMIT;` copy in `/tmp` (the endpoint already runs a file as one transaction: `txid_current_if_assigned()` matched across statements). All three exited 0. `migration repair --status applied` for the three versions only: history 21 → 24 rows, head `20261111100200`. Verified: 17 tables, RLS on all; worker RPCs (`claim`, `apply_permit_sync_batch`, `enqueue`, `finish`) EXECUTE for `postgres`/`service_role` only; admin RPCs and `search_permits` add `authenticated`; no anon/PUBLIC; all RPCs except `search_permits` are SECURITY DEFINER; `module.central_permits` one row, OFF; `permit-documents` bucket private; cron 3 (unchanged names); `portal_credentials` 16, `projects` 88. |
| A-3 | Supervised live run, job `2c71f817-45c1-4c90-82c9-1f9d8ce4d30c` (2026-11-11 02:10:56–02:11:14 UTC) | Stopped at login: `failed_unrecoverable` / `portal_changed`, "unrecognised login page" | — | Idle pre-check: worker exits 0; `claim_permit_sync_job` answers with the service-role key. Setup as admin `3d2b4632…`: source `0610eaa5…` registered, `automation_enabled=false`, `{"account_download": false}`; one job queued. Headed worker ran 16.5 s. The key opened the envelope (no `auth_failed`; Chromium launched). The login loop met a page none of its branches handle and stopped before discovery. Not reached: dashboard total, discovery, any section. Writes: 1 source, 1 job, 3 events (`enqueued`, `claimed`, `finished`); 0 permits/links/sections/snapshots/changes. No guard violation recorded (none on a DC host). No MFA/CAPTCHA classified. Not re-run (needs a new approval). Log `/tmp/a3-run.log` (codes only, no secrets). Root cause and fix: D-042. |
| A-3 | Login diagnostics (after the run) | Locally tested | Locally tested | D-042. Login errors now carry host+path (no query), step, classified state, whether the password was submitted, and up to 5 auth-phase navigations the policy dropped (`<type> <host>`). A per-step `login_step` trace reaches the console. Guard rules unchanged. Tests drive the real login loop through a network-free fake context: `npm run test:permit-sync` (Chromium, outside sandbox) **122/122** (119 + 3). Not live-verified. |
| A-3 | Supervised live run 2, job `c0a4476e-321f-4ba7-80ac-a3a40ec268d6` (2026-11-11 02:21:38–02:21:51 UTC) | Stopped at login: `failed_unrecoverable` / `portal_changed` | — | Pre-check (read-only): 1 source, `automation_enabled=false`, status inactive; no active job; flag OFF; cron 3. One job requested via `admin_request_permit_sync` (source reused, not re-registered). Headed, 11.6 s. Trace: `login_step 1, state unknown, at chrome-error://chromewebdata, blocked 2`. `last_error` names the two hosts the auth policy dropped on the first dashboard load: `xhr avolvecspiamsa.blob.core.windows.net` and `document avolvecspiam-as-authmiddleware.azurewebsites.net`. Password not submitted; no DC-host guard violation; no MFA/CAPTCHA. Two non-IdP hosts were blocked, which falls outside the one-domain approval, so the allowlist was not changed and there was no retry (D-043). Writes: 1 job, 3 events (totals 2 jobs, 6 events); 0 permits/links/sections/snapshots/changes. After the run: `portal_credentials` 16, `projects` 88, cron 3, flag OFF. Log `/tmp/a3-run2.log`. No code changed (tests still 122/122 from D-042). |
| A-3 | Source switch to `de8592f9-69fc-4c71-8544-cb22bbbd5813` (2026-11-11 ~02:38 UTC) | Done (approved) | Production-verified | D-044. `admin_set_permit_sync_source(…, 'dc-projectdox', false, {"account_download": false})` as admin `3d2b4632…`. The PK is `credential_id`, so a second source row was registered; `0610eaa5…` is unchanged. Read-back: both rows `automation_enabled=false`, status `inactive` (so `de8592f9…` is an encrypted envelope). |
| A-3 | Two exact login hosts (D-044) | Locally tested | Locally tested | `LOGIN_EXTRA_HOSTS` in `core/safety.js`, used by `evaluateAuthRequest` and `classifyLoginPage`. Middleware host: GET/HEAD/POST, password field = `login_form`. Blob host: GET/HEAD only. Exact hostnames; look-alikes and other Azure tenants refused; read guard unchanged. `tests/permit-sync-login-hosts.test.js` (5). `npm run test:permit-sync` (Chromium, outside sandbox) **127/127**. |
| A-3 | Login ported from the manual scrape (D-046) | Locally tested | Locally tested | `login()` in `live-transport.js` copies `performLogin` (`app/register-execution-routes.js`; not callable: not exported, inside the HTTP app module) with its selectors and waits. Removed: the classify-and-branch loop, the Avolve-only wait and the login-phase host/method allowlist. Kept: DC deny-pattern tripwire at login, MFA/CAPTCHA/refused stops, one password entry, the full read phase (`DC_READ_ALLOW`, no downloads). New fake-browser tests plus a rewritten login-hosts test. `npm run test:permit-sync` **131/131**. |
| A-3 | Supervised live run 5, job `e1132fea-d57b-41fa-9494-411a6b8b34e4` (2026-11-11 03:03:30–03:05:15 UTC) | Login OK, dashboard 28, discovered 28/28; then 401 on the first API call: `failed` / `session_ended`, job in `retry_wait` | Production-observed (login, discovery) | Exit 0, 102.6 s. B2C → Okta (Next once, password once) → SSOLanding → dashboard; `login_ok`, `api_session_ok`; 0 blocked; no MFA/CAPTCHA. Extracted 0 (no section ran). Writes: 28 permits, 28 links, 28 `created` changes, 1 job, 3 events; 0 sections/snapshots. Totals: 2 sources, 5 jobs, 15 events. Cron 3, flag OFF, automation false. Job left in `retry_wait` (no worker running; cancel with `admin_cancel_permit_sync_job`). Log `/tmp/a3-run5.log`. |
| A-3 | API session sent like the manual scrape (D-047) | Locally tested | Locally tested | `getJson` and `fetchPartial` use the project page's own `fetch` (`credentials: "include"`, `Sessionid` from `Globals.Session.SessionID`, `X-Requested-With`; cookies, `Origin`, `Referer` from the browser). No allowlist, host or classifier change. 4 new tests plus 2 passing mutation checks. `npm run test:permit-sync` **135/135**. |
| A-3 | Supervised live run 6, same job `e1132fea-d57b-41fa-9494-411a6b8b34e4`, attempt 2 (2026-11-11 03:10:44–03:12:24 UTC) | Login OK, API session OK, 401 gone. Permit `9187` extracted (7/7 sections ok). Then `failed_unrecoverable` / `safety_violation`: guard refused GET `/Project/ProjectStatus?projectID=9187&…` (no read allow rule) | Production-observed | Exit 0, 99 s. Dashboard 28, discovered 28, extracted 1, failed 0, 27 permits not started. Writes: 7 snapshots, 7 section states, 10 more changes (38 total), 1 workflow, 1 task, 2 folders, 5 reports, 0 documents; permits 28 and links 28 (updated, not duplicated, 0 duplicate groups). Cron 3, automation false, A-5/A-4/A-6 untouched. Log `/tmp/a3-run6.log`. No further run until the user decides. |
| A-3 | Portal-host GET/HEAD without a named route (D-048) | Locally tested | Locally tested | On `planreview.dob.dc.gov` and `session.planreview.dob.dc.gov` only, GET and HEAD pass after the deny patterns and the named routes. API hosts still need a named route. POST and the other write methods stay denied. Downloads, `viewFile`, and export stay denied and still fail the job. No new host. `npm run test:permit-sync` **137/137**. |
| A-3 | Supervised live run 7, new job `64ff4b4d-9bb4-44f2-9087-e635a65cd8a8` (2026-11-11 03:21:16–03:23:00 UTC) | Login OK, discovered 28/28, extracted 0. Then `failed_unrecoverable` / `safety_violation`: GET `/User/GetSessionTimeout` on the API host is `not_allowlisted` | Production-observed (login, discovery) | Exit 0, 103 s. Not a deny pattern and not a 401. The API host was left on named routes on purpose. No second run, no further guard change. DB unchanged from run 6 except jobs 6: 28 permits (0 duplicate groups), 28 links, 7 section states, 7 snapshots, 38 changes, 1 workflow, 1 task, 2 folders, 5 reports, 0 documents. 1 of 28 permits has all 7 sections ok. Cron 3, flag OFF, automation false. A-5, A-4, A-6 untouched. Log `/tmp/a3-run7.log`. |
| A-3 | Same GET/HEAD rule on the one ProjectDox API host (D-049) | Locally tested | Locally tested | `DC_OPEN_READ_HOSTS` adds exactly `washington-dc-us-projectdoxwebapi.avolvecloud.com` to the D-048 GET/HEAD rule. `projectdoxwebui` and `portalwebapi` stay on named routes. POST, downloads, `viewFile`, and export still fail the job. `npm run test:permit-sync` **139/139**. |
| A-3 | Supervised live run 8, new job `50a121be-5dc2-4548-9e86-443f5c3520e9` (2026-11-11 03:29:13–03:30:33 UTC) | Login OK, discovered 28/28, extracted 0. Then `failed_unrecoverable` / `safety_violation`: POST `/cdn-cgi/rum` on `session.planreview.dob.dc.gov` | Production-observed (login, discovery) | Exit 0, 80 s. The host is already open for GET/HEAD. POST stays refused, so the guard was not widened and there was no second run. DB unchanged from run 7 except jobs 7: 28 permits (0 duplicate groups), 28 links, 7 section states, 7 snapshots, 38 changes, 1 workflow, 1 task, 2 folders, 5 reports, 0 documents. 1 of 28 permits has all 7 sections ok. Cron 3, flag OFF, automation false. A-5, A-4, A-6 untouched. Log `/tmp/a3-run8.log`. |
| A-3 | Read-phase non-GET noise no longer fails the job (D-050) | Locally tested | Locally tested | A deny pattern still fails the job for every method. On the three open hosts, any other non-GET/HEAD is aborted and not sent, and the run continues. Other DC hosts still fail the job on a non-GET. Login can still POST. `npm run test:permit-sync` **140/140**. |
| A-3 | Supervised live run 9, new job `703659aa-42e7-40c8-86b5-d4f2e5754da1` (2026-11-11 03:37:59–03:46:10 UTC) | Completed. Dashboard 28, discovered 28, extracted 28, failed 0. 27 of 28 have all 7 sections ok | Production-observed | Exit 0, 490 s. `TL2600008` has `status` and `reviews` absent; its other five sections are ok. No safety violation, no 401. DB: 28 permits (0 duplicate groups), 28 links, 196 section states, 196 snapshots, 3135 changes, 29 workflows, 14 tasks, 66 folders, 140 reports, 2283 documents. Cron 3, flag OFF, automation false. A-5, A-4, A-6 untouched. Log `/tmp/a3-run9.log`. |
| A-5 | Railway `permit-sync-worker` (D-051) | Deployed, idle | Production | Remote build of `scraper-service/Dockerfile`. Start `node permit-sync/worker-entry.js`. Headless, worker enabled, A-3 set, once-only not set. Deployment `1347f14a…` SUCCESS, service online, no job claimed, no portal login. No cron, automation false, flag OFF, no commit. |
| A-3 | SSO callback wait (D-045; replaced by D-046) | Locally tested | Locally tested | Wait up to 30 s only on `avolvecspiam-as-authmiddleware.azurewebsites.net` path `/Auth2/SsoCallback` with no form fields. No click, no typing, no new host. A blocked navigation during the wait stops the job and records method and host. Other unknown pages still fail immediately. D-044 host rules unchanged. `npm run test:permit-sync` **132/132**. |
| A-3 | Supervised live run 4, job `1610408d-929f-4139-a219-ab093810a2ef` (2026-11-11 02:51:12–02:51:37 UTC) | Stopped at login: `failed_unrecoverable` / `portal_changed`, "no password field" | — | Worker exit 0, job 23.4 s. Step 1 B2C, step 2 `dcra.okta.com`, both `blocked: 0`. The callback wait never started. The username step's submit ran and the password field was still absent, so the password was not typed. No MFA/CAPTCHA, no blocked host. Writes: 1 job, 3 events (totals 2 sources, 4 jobs, 12 events); 0 permits/links/sections/snapshots/changes. Cron 3, flag OFF, automation false. No retry. Log `/tmp/a3-run4.log`. |
| A-3 | Supervised live run 3, job `1e4b02ec-78d1-458f-8c18-ce27f78d7366` (2026-11-11 02:40:24–02:40:56 UTC) | Stopped at login: `failed_unrecoverable` / `portal_changed` | — | Worker exit 0, job 28.7 s. B2C → Okta (password submitted once) → `avolvecspiam-as-authmiddleware.azurewebsites.net/Auth2/SsoCallback`, state unknown. Log `blocked: 0` at every step; events are `enqueued`, `claimed`, `finished` and name no host or method. The user saw the page as blocked after the credentials and said not to add more guards. No third host, no new rule, no second run. Writes: 1 source, 1 job, 3 events (totals 2 sources, 3 jobs, 9 events); 0 permits/links/sections/snapshots/changes. After: `portal_credentials` 16, `projects` 88, cron 3, flag OFF. Log `/tmp/a3-run3.log`. |
| A-1 | Production apply (earlier attempt) | Not applied: dry run not clean | — | CLI linked to `eeqxyjrcldivtpikcpvk`. `db push --dry-run` refuses and lists 149 older migrations for `--include-all`. They are applied but not recorded in production history (21 rows, head `20261106140000`; spot-checked 4 objects). Read-only baseline: `portal_credentials` 16, `projects` 88, no permit objects, 3 active cron jobs, pg_cron 1.6.4 / pg_net 0.19.5. Apply route needs the user's choice (HANDOFF "A-1 apply procedure"). |
| A-3 | Startup check | Pass | Production-verified (key) | `startupCheck` with the approved flags and `scraper-service/.env`: ok, host `eeqxyjrcldivtpikcpvk`, 32-byte key. Decrypt of `0610eaa5…` passed at claim time on 2026-11-11 (the job reached the browser), so A-2 is not needed. |
| Admin | Production config check (read-only, 2026-11-11 ~04:30 UTC) | Pass | Production-verified | Role-scoped SQL in `begin read only … rollback`. RLS on all 17 permit tables, 1 policy each, `authenticated` SELECT only, no anon grant. Platform admin reads every row (28 permits, 196 section states, 196 snapshots, 3135 changes, 29 workflows, 14 tasks, 66 folders, 2283 documents, 140 reports, 278 comments, 268 responses; `search_permits` total 28). Active non-admin with no grant reads 0 everywhere. anon: permission denied on tables and `search_permits`, 0 storage objects. All 8 admin RPCs refuse the non-admin (42501). `module.central_permits` OFF. `permit-documents` private. Cron 3, automation false, 0 active jobs. |
| Admin | Local read-only inspection + seven-section detail (D-052) | Locally tested | Locally tested | `src/lib/localPermitInspection.ts` (dev + env + loopback; compiled out of production builds, checked in the bundle). `src/lib/permitSections.ts`, `src/components/permits/PermitSectionViews.tsx`, rewritten `PermitDetailPage.tsx`: per-section extraction status, provenance (route, job id, captured time, snapshot id), deep data, files metadata only. Rendered with real production rows for B2508295, TL2600008, B2608367: every comment, response and file row shown, no links. Not clicked through in a browser (needs an admin login). |
| Admin | Admin export JSON / ZIP (D-053) | Locally tested; verified on production data | Production-verified (read) | `src/lib/permitExport.ts`, `PermitExportButtons.tsx`, `fflate`. `scripts/permit-repo/verify-export.tsx`: totals and all 28 per-permit counts equal production; ZIP 28 files + 28 CSV rows. Sample in `exports.local/dc-export-20261111T043626Z/` (git-ignored). Frontend permit tests **122/122**; `npm run test:permit-sync` **140/140**. |
| Admin | Reports finding (D-054) | Done | Production-observed | Reports are metadata only (5 per permit). ReportID=14 SSRS was not fetched in run 9 (Reviews came from JSON). |
| 4 | Second jurisdiction/hardening | Montgomery adapter implemented (JSON pass), see "Montgomery County MD" below | Locally tested | Branch `feat/montgomery-adapter` |

## Montgomery scheduling (2026-11-18, branch `feat/montgomery-scheduling`, D-146 to D-150)
Backend for an unattended nightly Montgomery run that the owner switches on in Management Admin → Permit Sync → Scheduling. Nothing is enabled, applied or deployed. Runbook, rollback and first-run SQL: HANDOFF.md "Montgomery scheduling".
| Item | Status | Level | Evidence / notes |
|---|---|---|---|
| Production state before (owner's figures; the CLI could not read production in this session) | 20 permits, 1,452 files listed, 1,443 stored, 9 failed with retries due; worker job efae063b and 8 manual jobs logged in on 2026-11-18 | Production-verified (owner) | Re-check with `scripts/permit-repo/scheduling/06-verify-montgomery-first-run.sql` (read-only) before enabling |
| Worker keyed on the job's adapter; adapter-qualified worker scope with `deferred_worker_scope` release | Done | Locally tested | D-146; `worker-entry.js`, `core/worker.js`, `deep/repo.js`; DC paths unchanged (permit-sync 354/354) |
| Scheduling tab, save, enqueue at 06:00 America/New_York (DST), no slot before enable | Generic already; proven for Montgomery | Locally tested | `permit-sync-montgomery-scheduling.test.js` (exact UI body, 11:00Z EST / 10:00Z EDT, two hours after DC) |
| DC + Montgomery overlap on one worker | Separate claims; the second waits; no false `queued_unclaimed` | Locally tested | D-148; migration `20261123100000` (monitor) |
| Central budget per source (`montgomery`, $3 proposed) | Done; budget row prepared, not created | Locally tested | D-147, D-149; `_shared/centralBudgetScopes.ts` + test; `scheduling/05-montgomery-budget.sql` |
| Monitoring | Generic: schedule_missed, job_stuck, retry_exhausted, no_recent_success, login_failure; added `central_budget_paused` | Locally tested | Alert text: jurisdiction label, adapter key, counts, short ids |
| 9 failed files | Retried by the normal plan when due (attempts < max) | Locally tested | D-149 |
| Merge, migration, worker and function deploy, budget, toggle | Not started | — | Approval list in HANDOFF.md |

## Montgomery County MD (2026-11-18, branch `feat/montgomery-adapter`, D-133 to D-144)
| Item | Status | Level | Evidence / notes |
|---|---|---|---|
| Browser investigation | Done | Production-observed | User's Chrome, background control, no state-changing clicks. MONTGOMERY_CAPABILITY_MAP.md |
| Supervised read-only capture | Done (approved) | Production-observed | `scripts/permit-repo/montgomery/phase0-capture.js`. 147 requests, 2 refused (blob logo), 0 state-changing. All DC JSON routes return 200 JSON on the Montgomery Web API. 20 projects via `GetPagedActiveProjects`. No MFA. |
| Earlier figures (11 projects / 244 comments) | Not reproducible | Production-observed (read) | 5 project rows, 4 distinct portal permits, 137 comments (96 unique). MONTGOMERY_GAPS.md §1 |
| Tenant config + tenant-aware guard | Done | Locally tested | `projectdox-tenants.js`, `core/safety.js`. DC policy asserted unchanged. |
| Montgomery adapter, normalizer, live transport | Done | Locally tested (transport policies and adapter over synthetic portal) | `adapters/montgomery-projectdox/*`. Live transport not yet run as a worker job. |
| Worker registry, per-portal login lock | Done | Locally tested | `worker-entry.js` `ADAPTERS`, `lib/dc-credential-lock.js` portals, 2 manual-flow call sites |
| Tests | 340/340 permit-sync | Locally tested | `permit-sync-montgomery.test.js` (19), `permit-sync-montgomery-deep.test.js` (12), `permit-sync-process-guard.test.js` (8) |
| Deep capture (file bodies, report exports, comments) | Done for 3 test permits (scoped) | Production-observed (local worker, supervised) | Jobs `80b3eefc`, `59f96b2c`, `9f183e1d`, `a55315ac`, `e9a26324`, `1514acd6`: 25 files stored (sha256, private paths, PDF renditions), reports 132–135 captured where renderable, 133 parsed into 2 and 41 rows, 41 comments + 50 responses written for 195963 in the same job. D-141 to D-144. |
| Source, first run, schedule, budget, linking | Not started | — | Each needs approval. MONTGOMERY_GAPS.md §5–6 |

## Unified DC deep automation (revision 2026-11-11, MASTER_PLAN §0)
| Phase | Item | Status | Level | Evidence / notes |
|---|---|---|---|---|
| R0 | Architecture reconciliation | Done | n/a | MASTER_PLAN §0; D-055 to D-067; D-014 superseded, D-025 and D-034 revised |
| R1 | `dcDeep` export, pager (D-062), credential lock (D-061), deep runner + `PERMIT_SYNC_MODE=deep`, injectable `performLogin` + shared dashboard in live transport | Done | Implemented, locally tested | Route list identical to HEAD; `permit-sync-deep*.test.js`; pager in real Chromium on offline pages (25 rows / 3 pages) |
| R2 | `deepOptions` file gate + private storage (D-058/D-059), report content (D-067), per-mode guard (D-057/D-069), migration `20261111120000_permit_deep_capture.sql` (+ D-068), comment gap (D-066 result) | Done | Implemented, locally tested; migration NOT applied (A-1b) | `permit-repo-deep-capture.test.js` 4/4, deep-state access checked in `permit-sync-deep-e2e.test.js`, chain 3/3; live file/report capture unproven until A-L1 |
| R3 | Service execution mode in 5 edge functions (D-063/D-071), worker pipeline driver with hash dedupe | Done | Implemented, locally tested; NOT deployed (A-E) | `serviceExecution.test.ts` 28/28; driver covered in deep E2E |
| R4 | Permit Queue as single central UI (D-064) | Done | Implemented, locally tested; NOT deployed (A-F) | Frontend permit tests 163/163 (coordinator run), `tsc --noEmit -p .` 0; data-backed browser smoke not done (needs admin login) |
| R5 | Offline E2E + all suites | Done | Locally tested | permit-sync 164/164; closure-touching scraper tests 39/39; edge 28/28; frontend 163/163; `npm test` 158/159 (pre-existing Code Analyzer failure, untouched) |
| R6 | pg_cron SQL + approvals | Prepared only | n/a | HANDOFF "Approvals, in order" |

## Deep capture corrections (2026-11-12, D-080 to D-088; local commits, no push)
| Item | Change | Status | Level | Evidence / notes |
|---|---|---|---|---|
| 3b | Deep download route passes on with `route.fallback` (guard sees every request) | Done | Locally tested | Real-Chromium closure probe; fails with `route.continue` |
| 3c | `reinitializeBrowser` refused in deep sessions → `session_ended` | Done | Locally tested | Closure probe + e2e |
| 3d | Lease heartbeat inside the deep pass; lost lease cancels the scrape | Done | Locally tested | e2e (`lease_lost`, beats during the pass) |
| 1a/1b | Guard identity exemption for report params (D-081) | Done | **Live verified** (report 4 captured; no new guard_denied on job `095d5d6f`) | Safety tests + live job |
| 1d/3a | Attempts + back-off + attempt cap (D-080), migration `20261112100000` | Done | **Applied to production** (history 25→26); live retries seen (attempts 1→2) | `11-apply-capture-retry.sh`; rerun job `74af8d1d` |
| 2b | Per-file limit, `deferred_oversize` (D-083) | Done | Locally tested; live used 200 MiB / 500 MB project limit | No `deferred_oversize` rows this run |
| 2c | View-only files via the viewer, private bucket only (D-082) | Done | **Live failed** | 33 Drawings `failed`/`viewer`/`download_failed`; 0 stored via viewer |
| 2d/3f | Originals first, provenance, body validation (D-084) | Done | Not exercised live (0 new file stores) | Prior 9 stored still null provenance columns |
| 3e | No orphan report uploads (D-087) | Done | Live: `report_objects_removed` 6; orphans 0 after | Job `095d5d6f` |
| 5a | `completed_with_warnings` + `deep_warnings` (D-086) | Done | **Live verified** both jobs | Warnings: files_failed, files_pending, files_failed_open |
| 2e | Capture-hash re-sync, hash kept (D-085) | Done | Live: hash changed only with report content (`5a283b80`→`13ac00b0`); rerun hash stable | ff193644 |
| 6b | `structuredRows` name fix | Done | **Live verified** report 14 v2 has 6 rows | Job `095d5d6f` |
| 5c | `04-inspect.sql` capture section | Done | Used live | |
| 4/5b | Tasks tab shows workflows; content pills; diagnostics admin-only | Done | Locally tested; NOT deployed | |
| 6c | Pipeline triggered when no completed run for the hash | Done | Agents off; pipeline runs stayed 0 | |
| 6d | Comment refresh keying | Done | Fingerprint unchanged `b4a09c21…` | |
| Live | Full-capture live test | **Partial pass** | Reports 5/5; files 9/72 stored | HANDOFF "Full-capture live test"; crash fix `ffec70b`; 27 permitted never attempted |
| Stop | Cancel job `74af8d1d` after viewer POST drop | Terminal already | Job `completed_with_warnings`; 0 active jobs; documents unchanged (9/27/33/3) | Workers already exited. `02-cancel-deep-job.sql` did not run (CLI login-role 403). Cause: POST `/File/FileViewer` is `method_dropped`, so the RetrieveFile GET fallback never runs. |
| 2c fix | Deep-mode blocked viewer popup falls back to GET RetrieveFile (D-089) | Done, not live | Locally tested | `npm run test:permit-sync` 204/204. POST FileViewer still `method_dropped`. Manual route list unchanged. Live check not run. |
| Live | One-file viewer retry (max 1, agents off) | **Rolled back** | Session ended before any file | Job `3865c23c` cancelled (`session_ended`). 33 retry times restored. Counts 9/27/33/3. Hash and parsed_comments unchanged. Viewer path not verified. |
| Diag | Session-end trail + `deep_trace` (method/host/path/step only) | Done | Used live | Commit `a10a83e`; named the Log Out link fetch as the trigger (job `099bb4e7`) |
| 2c fix 2 | Deep fallback uses DC Web API + page session id, no link scan (D-090) | Done | **Live verified** | Commit `babd024`, 208/208. Job `9c25736c` stored view-only 813992 as PDF rendition (85.7 MB vs 86.1 MB portal). No guard events. Original refused/unusable; 32 viewer rows remain. |
| 2c fix 3 | Deep runs never mini-reset the Files page (D-091) | Done | **Live verified** | Commit `416c97f`, 208/208. Job `795b06f7` lost the Files page after 10 files; retry `f60b7e0d` attempted 53 with 0 folder errors |
| Live | Remaining-files capture, BCIV2500152 | **Files complete** | 72/72 stored, accepted (D-092) | Renditions kept, including 3 view-only Supporting Documents. Do not re-download. Job `f60b7e0d` ended on the keepalive GET |
| Guard | Deep-mode GET/HEAD `/User/GetSessionTimeout` on the portal API host only (D-092) | Done, not live | Locally tested | Exact host and path. Other paths, POST, and look-alike hosts still refused. JSON mode unchanged. POST FileViewer still dropped |

## One-permit live test execution (2026-11-11 07:19–07:23 UTC)
| Step | Status | Evidence |
|---|---|---|
| 0 Pre-check | Pass | Rows 1–3 false, rest true; 24 migrations, `20261111120000` absent; baseline in HANDOFF.md. |
| 1 Railway worker to 0 | **Failed, stopped** | `railway service scale … us-west2=0` triggered a redeploy (`29f0703c`, same image/env, 1 replica) instead of scaling to 0. Worker idle, 0 active jobs. |
| 2–6 (attempt 1) | Not run | Stopped after step 1. |
| 1 (attempt 2) | Skipped by user | No further Railway changes; old worker `29f0703c` stays; safety relies on D-073. |
| 2 Migration `20261111120000` | Done, verified | History 24 → 25; pre-check all true; RLS on; two-argument claim hard-codes `'json'`; rollback-only DO block: old claim → NULL for a deep job, v2 deep → the job. Flag OFF, cron 3. |
| 3a Edge diff | **Stopped** | No production-only edits, but prod is behind base for comment-parser (1 commit), context-reference-engine (4), intake-pipeline (1); deploy would ship those too. No secret, no deploy. |
| 4–6 (attempt 2) | Not run | Awaiting user decision on the edge deploy. |
| 3 (attempt 3) | Skipped by user | Agent trigger off; no secret, no deploy. |
| 4 Link | Done | 1 project_permits row ff193644 ↔ 06fa082e; projects 88. |
| 5 Deep job | Done | `7815af2b`, unclaimed after 5 s; claimed only by the local worker. |
| 6 Run 1 (agents off) | **Stopped at safety rule** | 3 files stored (5,458,017 bytes, signed URL 206), 6 review comments; GET `/WebForms/ReportViewer.aspx?ReportID=4` ("All Uploaded Files…") hit deny `/Upload/i` → `safety_violation`. No report versions, no portal_data write, no pipeline run; 8 orphan report objects in storage. No retry, no idempotency rerun. |
| Guard-safe report fix (D-079) | Done | `a6eb159`, `cf414d1`; deny patterns unchanged; permit-sync 188/188. |
| 5–6 Rerun `70d2a366` (agents off) | **Passed** | Claimed only locally; 3 files stored; reports 12/14/15/16 v1 (PDF + XLSX); report 4 `guard_denied` (1 event), job continued; portal_data hash `31dba978358fcc6f` → `5a283b800b14d9b4`; 0 pipeline runs; parsed_comments unchanged. |
| Idempotency `d36f9344` | **Passed** (one expected deviation) | 0 content changes, 0 report versions, hash unchanged, 0 pipeline runs, 0 guard events; 3 more capped files stored (pending per D-074, not re-downloads). |
| Orphan cleanup | Done | 8 objects from job 7815af2b deleted (828,451 bytes); bucket 17 objects, all referenced. |

## One-permit live test readiness (2026-11-11, local only)
| Item | Status | Level | Evidence / notes |
|---|---|---|---|
| Content-only portal_data hash (D-072) | Done | Locally tested | `lib/portal-content-hash.js`; `permit-sync-content-hash.test.js` 5/5 (production key shape); closure probe: legacy hash kept, only `last_checked_at` + bookkeeping written, a real change writes the hash once; deep E2E run 4: forced deep pass with new stamps/URLs/render times → 0 downloads, 0 `permit_changes`, 0 report versions, 0 agent runs, hash unchanged. Mutation: removing the report-stamp normalisation fails the E2E. |
| Service mode re-verified, key format (D-075) | Done | Locally tested | All rejection paths audited after the secret check (wrong/missing secret and disabled mode: 401 without an audit row, by D-071). New test: `sb_secret` bearer and apikey-only calls refused. Production key in use: legacy `service_role` JWT. `serviceExecution.test.ts` 29/29. |
| Old worker cannot claim deep jobs (D-073) | Done | Locally tested | `permit-sync-worker-mode.test.js` 5/5 incl. a replica of the original claim function (would claim the deep job; the migrated one does not, queued or lease-expired). Chain test: wrapped apply equals replay; rollback script restores the pre-migration schema. |
| Downloads/reports safety, caps, Reports failure (D-074) | Done | Locally tested | Private `permit-documents` only (manual deep branch returns before the public upload); signed URLs 300 s; caps env + job (lower only); Reports tab failure non-fatal and not retried every job. E2E tests for caps and Reports failure. |
| One-permit scope (D-074) | Done | Locally tested | E2E: 28 discovered, 1 JSON + deep pass, 27 out of scope; `scope_not_found`; `scope_empty` before the portal opens. |
| Project linking | Done | Locally tested | Deep sync refuses without a project id before any request (closure probe); never inserts or re-points credentials; `admin_link_project_permit` inserts only `project_permits`. Prepared SQL tested on the replay with production ids (`permit-repo-live-test-sql.test.js`). |
| Test permit selection (read-only) | Done | Production-read | Permit `06fa082e-b942-4b54-b448-a1527f58df41` = BCIV2500152, ProjectID 6364, 72 documents: 36 `download_permitted` (folders "Approved Drawings" 33, "Approved Supporting Documents" 3; ~272 MB total, smallest 99 KB), 36 not permitted; 5 reports; 0 repository review comments. Project `ff193644-3e94-46d4-a1c0-4755fc65d0dd` (owner f1f84c83, has a hash, 6 parsed_comments, 0 pipeline runs, not linked). Only project with that permit number. Source de8592f9 inactive, automation off. |
| Permit Queue under read-only override | Done | Locally tested | Signing and queue reads do not call the write guard (test); dev server smoke on a separate port: `/permit-queue` served, `DEV` and `VITE_LOCAL_PERMIT_INSPECTION=read-only` injected. Browser click-through needs an admin login (not done). |
| Offline worker config check | Done | Locally verified | `scripts/permit-repo/check-deep-worker-config.js`: startupCheck ok, legacy service_role JWT, 32-byte encryption key, Chromium resolved, scope 6364, caps 3 files / 20 MiB, agent trigger off until the pipeline secret file exists. |
| Regression | Done | Locally tested | permit-sync 182/182 (Chromium, outside sandbox); `npm test` 158/159 (pre-existing analyze-drawing failure); edge 29/29; frontend permit + Portal Harvest + Response Matrix + Code Analyzer (incl. V2) 483/483; `tsc --noEmit -p .` clean; whole scraper-service `tests/*.test.js` 1761 tests, 88 failing in 21 UCI/drawing-analysis files — the same 21 files fail on a clean checkout of HEAD `dd08ed1`, none imports changed code; Arlington and manual DC route tests pass. |
| Commits (local, not pushed) | Done | n/a | `5f1e164` migrations, `e29ec90` worker, `6c63370` edge, `9284ab9` Permit Queue, `c964c9a` live-test scripts, then docs. `scripts/local-dc-e2e/` left uncommitted. |


## Continuous deep scraping rollout P0–P2 (2026-11-13)

Status levels: Implemented / Locally tested / Deployed / Production-verified. The first table is the local build; production status is in "Production rollout" below it.

| Item | Decision | Status | Evidence |
|---|---|---|---|
| Branch secured | — | Local bundle `../backups/feat-central-permit-repository-dd5eeb4.bundle` (verified), tag `backup/central-permit-repo-pre-orchestration` | Not pushed |
| One request path, deep default, coalescing, follow-up | D-093, D-094 | Locally tested | `permit-sync-orchestration.test.js` 14/14 |
| Claim lock, same-login lock | D-095 | Locally tested | same |
| Release on shutdown/defer, lease recovery, bounded retries | D-098 | Locally tested | `permit-sync-fault-injection.test.js` 11/11 |
| Per-permit progress, phases, counts | D-096 | Locally tested | orchestration + fault-injection tests; real counts only once a live job runs |
| Worker health, heartbeat, JSON logs, Railway toml | D-098 | Implemented, locally tested | `/health` and liveness tests; toml not applied |
| Schedule (per source, slot-based), cron scripts | D-097 | Locally tested; **not enabled, cron not installed** | scheduling-scripts test (stub pg_cron) |
| Monitor + alerts | D-099 | Locally tested | two monitor tests; not installed |
| Alert notifier (Resend) | D-099 | Locally tested | `permitSyncAlertEmail.test.ts` 6/6; not deployed |
| Permit Queue: Refresh all (confirmation), Refresh per row and detail, batch banner, progress | D-096 | Locally tested | `PermitSyncControls.test.tsx` 7/7, `permitSync.test.ts` 9/9, `centralPermits.test.ts` |
| Management Admin: schedule form, workers (scope, limits, version), alerts, Retry, confirmed Refresh all | D-097, D-099 | Locally tested | same |
| CI workflow + baselines | D-100 | Locally dry-run | frontend 115 files (16 known), analyzer 81 (1 known), permit-sync 23 (0), scraper 43 (6 known); tsc 194 = baseline; eslint 154 = baseline; migrations pass |
| Hash swap ff193644 | D-101 | Fixed locally; cause consistent with data, not proven | content-hash tests 7/7; live data: stored = old fn `10f7f34c…`, new fn `88470093…` |
| P3 verification query | — | Implemented; checked on replayed schema | `scripts/permit-repo/verify-full-refresh.sql` |
| DC sources 0610eaa5 / de8592f9 | D-095 | Audited | Same login; permit links only on de8592f9; recommend pausing 0610eaa5 (approval) |

### Production rollout (approved, 2026-11-12 ~19:40–20:25 UTC)

| Step | Status | Evidence |
|---|---|---|
| Push branch, fast-forward `main` dd08ed1 → 563cb9e → 14516b2 | Deployed | No other commits on `main`. Railway `Epermit-main` (HTTP scraper) build `fe059bae` and later wait in **NEEDS_APPROVAL** and are not live. `code-analyzer-worker` did not redeploy |
| Migration `20261113100000` | Production-verified (schema) | One transaction via `supabase db query --linked -f`, then `migration repair --status applied`. 3 tables with RLS, 9 functions, both in-flight indexes, anon has no EXECUTE, 20 jobs and 0 open, cron unchanged |
| Pause 0610eaa5 | Production-verified | Direct UPDATE plus `_permit_audit('permit_sync_source.pause')` in one transaction. 0610eaa5 `paused`, de8592f9 `inactive` (manual refresh allowed), automation false on both |
| Frontend (Vercel, from `main`) | Deployed | Vercel status `success` for 563cb9e |
| `module.central_permits` ON | Production-verified | Audited `feature_flag.enable`, `updated_at` 20:20:33 UTC |
| Worker `permit-sync-worker` deployment `b11446dd` | Deployed, idle | `railway up` of a clean `git archive` of `scraper-service` at 563cb9e with `railway.permit-sync-worker.toml` as `railway.toml`. Variables: mode deep, enabled, A-3, caps 5000 files / 20 GiB / 200 MiB per file; no record-id narrowing, no once mode. Heartbeat `idle`, scope `all`, agent_trigger false, 0 jobs run. `version` is null (CLI uploads have no `RAILWAY_GIT_COMMIT_SHA`): the code is 563cb9e |
| Monitor cron `permit-sync-monitor` (*/5) | Installed, ran once | One open alert: `guard_violation` for the earlier local job `f60b7e0d` (session-timeout poll, D-092; the keepalive rule is in the deployed worker). It resolves 24 h after 17:52 UTC |
| Alert notifier function + cron | **Not deployed** | Needs recipient emails and the app URL |
| Scheduling | **Off** | No sync cron, automation false, no schedule enabled |
| CI on `main` | Green except one scraper file | 14516b2: secret scan, tsc/eslint, frontend, analyzer, permit-sync, build pass. `reconcile-territory-provider-names.test.js` reads local territory data and is now listed as environment-dependent |
| First full DC refresh | Not started | Belongs to the user (Permit Queue → Refresh all). No job was enqueued |

### Nightly DC refresh readiness (2026-11-17, local commits only)

| Item | Decision | Level | Evidence |
|---|---|---|---|
| First full DC refresh `3b7e46a5` | — | Production-verified (ran) | 2026-11-12 20:31 → 11-13 16:11 UTC, completed_with_warnings, 28 permits (21 completed, 7 with warnings), 1 attempt |
| Report capture needs an exported file; repair script for 8 rows | D-102 | Locally tested | deep and e2e tests; repair script run offline (refusal + repair + recapture); production count 8 re-checked read-only |
| Reviews from the stored Review Comments export | D-103 | Locally tested | mapping test; production read-only: 6307→53, 15026→56, 9321→81 comments, 3168/25920 empty |
| Outstanding-items message, Permit Queue row | D-104 | Locally tested | worker test, e2e row message, `PermitSyncControls.test.tsx` |
| Worker version and heap in heartbeat; CI-gated deploy script | D-105 | Locally tested; script dry-run against production (no upload) | fault-injection test; dry-run refuses unpushed HEAD and passes for 7f070f0 |
| 04:00 America/New_York across DST | D-106 | Locally tested | orchestration test on a 5-minute tick, March and November 2026 |
| Elapsed counters out of hashes | D-107 | Locally tested | normalize and content-hash tests; production showed 12 permits with counter-only status changes |
| Suites | — | Locally tested | permit-sync 261/261; frontend 116 files (16 known, 0 unexpected); tsc 194 = baseline; build passes |
| Scheduling, worker redeploy, repair, notifier | — | **Not done (approval)** | see HANDOFF |

### Production rollout 2 (2026-11-17, approved; stopped at step 8)

| Step | Status | Evidence / rollback |
|---|---|---|
| 0 Pre-flight | Done | permit-sync 261/261, build ok, no active sync job |
| 1 PR #23 → main | Done 06:26 UTC | merge `15993f89d642`; CI green (PR and main). Vercel deployed from main; Railway HTTP scraper build waited for approval; no Supabase auto-deploy. Rollback: revert the merge |
| 2 Migration 20261117100000 | Production-verified (schema) 06:28 | recorded; 7 functions, 5 columns, anon no EXECUTE. Rollback script in `scripts/permit-repo/` |
| 3 Worker | Production-verified 06:31 | Railway `c78e20b2`, heartbeat version `15993f89d642`, idle, scope all. Rollback: `deploy-worker.sh 563cb9e…` |
| 4 HTTP scraper | Deployed 06:34 | Railway `fe292a37` SUCCESS, `/api/health/playwright` 200. Previous live `0f66d36c` |
| 5 D-102 repair | Production-verified | 8 repaired, captured 140 → 132, 0 text-only |
| 6 Pipeline secret | Done 06:37 | Edge + worker values match; worker redeploy `0961cbee` same version, agent_trigger true; Vault secrets present |
| 7 Edge Functions | Deployed 06:40 | versions 43/63/45/26/26 and permit-comment-pipeline 1; previous code in `exports.local/edge-backup-20261117/` |
| 8 First pipeline run ff193644 | **Failed** 06:42 | "Conflicting API keys" before intake; 0 runs; rows identical |
| 9–11 | Not done | stopped per the rule |

### D-117 fix rollout (2026-11-17 06:50–07:05 UTC, approved; stopped at the step-8 re-run check)

| Step | Status | Evidence / rollback |
|---|---|---|
| 1 Pre-flight | Done | tracked files clean; permit-sync 261/261; `serviceExecution.test.ts` 35/35; 0 active permit_sync jobs (21, all terminal) |
| 2 PR #24 → main | Done | branch `fix/service-call-key-kind` off `origin/main` with f4a0b61 + 522935b cherry-picked (tree identical to 522935b); PR #24 as epermitarthouse-rgb, all checks green; merged as `b56c111ded8e`; main CI green. Rollback: revert the merge |
| 3 Edge Functions | Deployed 06:58–06:59 | from a clean worktree at `b56c111`, `--use-api`, one by one: permit-comment-pipeline 1→2, intake 43→44, parser 63→64, classifier 45→46, context 26→27, router 26→27. Rollback: `exports.local/edge-backup-20261117/` |
| 4 Verify versions | Done | all six ACTIVE and bumped |
| 5 Step-8 re-run ff193644 | **Completed with one unexpected difference** 07:00–07:01 | no reset needed (state `failed`, attempts 1, back-off over, not blocked). One service-mode dispatcher call scoped to ff193644 → 202, claimed 1. After: same 6 ids, all `adopted` + `has_key`; `response_md5`, `response_status`, `status`, `approved` unchanged; 0 inserts, 0 removals; state `completed`, attempts 0, up to date; 1 run `completed`, `comments:`-keyed. **Difference:** `portal_changed_at` set on 5 of 6 rows (`portal_latest_text` present); repository text 211–295 chars vs `original_text` 700–1966, not equal after whitespace or alphanumeric normalisation. `original_text` was not replaced. Not retried |
| Cron, DC schedule, `module.central_permits`, worker secret, notifier | Not done | out of scope |

### Nightly schedule, alert email and Permit Queue readiness (2026-11-17, local commits only; no production writes)

| Item | Decision | Level | Evidence |
|---|---|---|---|
| Worker version and heartbeat | — | Production-verified (read-only) | one worker, idle, version `15993f89d642`, heartbeat about 17 s old, RSS 68 MB, agent trigger on; `scraper-service/` has no diff between `15993f8` and `origin/main` (`b56c111`), so no redeploy is needed |
| Nightly DC job behaviour | D-095, D-106 | Locally tested; production config read-only | scheduled jobs go through `_permit_sync_request` (deep unless `worker_mode='json'`; de8592f9 settings have no override); file/report gating, retry and back-off, the manual-vs-automated login lock and `schedule_missed` are covered by existing tests. de8592f9 inactive, no enqueue or notifier cron, no queued or running jobs |
| Audited enable/disable scripts for the DC schedule | D-108 | Locally tested | `03-enable-dc-schedule.sql`, `98-disable-dc-schedule.sql`; orchestration test (refuses a non-admin, enqueues nothing, 98 keeps the monitor and notifier) |
| Comment-pipeline alerts | D-109 | Locally tested | migration `20261117120000` + rollback; orchestration test (blocked → critical, failed ×2 → warning, no names or errors, repeat counts once, recovery resolves); chain test applies and rolls back the migration exactly |
| Alert URL setting and labelled test email | D-109 | Locally tested | `permitSyncAlertEmail.test.ts` 8/8; `send-test-alert-email.sh` refuses without `--i-have-approval`. `APP_BASE_URL` digest differs from both forms of https://www.commun-et.com (checked by digest only); `PERMIT_SYNC_ALERT_EMAILS` not set; notifier not deployed |
| Permit Queue data | — | Production-verified (read-only counts) | 28 DC permits, all active, all with progress rows; files 2,283 (2,282 stored); reports 140 (132 captured, 8 awaiting recapture after D-102); review comments 391; tasks 14; workflows 29; 1 project link; 1 pipeline state (completed) |
| `module.central_permits` | — | Production-verified (read-only) | one global switch in `feature_flags`, ON since 2026-11-12 20:20 UTC; no per-org or per-user override. Row access is separate: since A-8 (D-120) every active user reads the 28 permits by default; admins hide per user |
| Suites | — | Locally tested | permit-sync 266/266; frontend 117 files (16 known, 0 unexpected); tsc 194 = baseline; build passes; migration checks pass |
| Schedule, sync cron, migration, notifier deploy, secrets, test email | — | **Not done (approval)** | see HANDOFF |

### Production rollout 3 (2026-11-17 08:45–09:15 UTC, approved steps 1–7)

| Step | Status | Evidence / rollback |
|---|---|---|
| 1 Publish | Done | PR #26 merged as `d869e612` (PR #25 closed: secret-scan false positive fixed by renaming a variable); CI green on PR and main. Pre-flight: permit-sync 266/266, frontend 117 files (16 known, 0 unexpected), tsc 194 = baseline, build passes. Rollback: revert the merge |
| 2 comment-parser-agent | Deployed 64 → 65 | from `git archive d869e61`; backup `exports.local/edge-backup-20261117-v64/` |
| 3 D-118 marks | Cleared | preview 5/5/0, 1 project; after 0 of 6 marked, 5 audit rows; ids, statuses, responses, approvals, `response_md5` unchanged; 0 removals. Rollback in script header |
| 4 Monitor migration `20261117120000` | Applied + recorded | EXECUTE service_role only; fingerprint matches chain test; ticks succeed. Rollback script + `migration repair --status reverted` |
| 5 Notifier | Deployed v1, secrets set, test sent, cron on | test: HTTP 200 `test_sent: true`, 1 recipient; 09:07 tick sent the open warning. Rollback: unschedule + unset secrets |
| 6 Scheduler cron | Installed | 09:10 tick: 0 jobs, no source scheduled, no missed alert; DC schedule left for the owner to enable. Rollback: unschedule `permit-sync-enqueue` |
| 7 Comment-pipeline cron | Installed | 09:11 tick: HTTP 200, claimed 0; test project unchanged. Rollback: `99-disable-pipeline-cron.sql` |

### A-8 default access with project isolation (D-120, 2026-11-17 ~10:45–11:05 UTC, approved)

| Step | Status | Evidence / rollback |
|---|---|---|
| 1 Pre-flight | Done | rebased on `3f942f1`; permit-sync 279/279; frontend 118 files (16 known, 0 unexpected); tsc 194 = baseline; build passes; gitleaks clean |
| 2 PR #28 | Green | all checks green on the PR; not merged before the migration |
| 3 Pre-check | Done (read-only) | 1 DC source, 28 permits, 0 grants, 1 link, column absent, version not recorded, 0 active jobs, crons ok |
| 4 Migration `20261117130000` | Production-verified | one transaction + `migration repair --status applied`; `visible_to_all` default false, DC source true; `effect` column; 3 admin RPCs guarded, anon no EXECUTE; link policy and comment-pipeline overview replaced; 7 crons, 0 failures; ff193644 6 comments / 0 marks. Rollback: `scripts/permit-repo/rollback-20261117130000_permit_default_access.sql` + `migration repair --status reverted` |
| 5 Merge | Done | merge commit `245809d9f3f5`; CI on main green; Vercel production success. Rollback: revert the merge |
| 6 RLS post-check | Passed | 4/4 non-admin active users read 28/28 permits, 0 with `can_refresh`, 0 foreign link rows; anon has no table privilege |

### Duplicate DC source removed (2026-11-17 10:02:55 UTC)

| Item | Status | Evidence |
|---|---|---|
| Source `0610eaa5` and its credential | Removed | Paused, automation off, 0 permits / documents / reports / project links. 2 `failed_unrecoverable` jobs and 6 events deleted with the source. Credential was not shared with `de8592f9` and was deleted (1 grant cascaded). Password cannot be restored. Audit `5ed20872-ab8e-44c7-989a-2b72abf6c5a8` (`permit_sync_source.remove`) at 2026-11-17 10:02:55 UTC. Script `scripts/permit-repo/repairs/d119-remove-duplicate-dc-source.sql` |
| Source `de8592f9` | Unchanged | 28 permits, inactive, automation off, schedule daily 04:00 America/New_York, not enabled |
| Queue and crons | Unchanged | 0 queued or running jobs. `permit-sync-enqueue`, `permit-sync-monitor` and `permit-sync-alert-notifier` active; latest ticks succeeded. Schedule not enabled |

### Central comment processing rollout (2026-11-18 07:54–08:36 UTC, approved)

| Item | Status | Evidence |
|---|---|---|
| PR #31 schedule read-back | Merged `017dd6cc` | CI green, Vercel production success; its migration `20261118140000` not applied (step 7) |
| PR #32 central processing | Merged `42cf55cc` | Rebased, migration renamed to `20261118150000`; CI green on `a2cbf75`; Vercel production success |
| Migration `20261118150000` | Applied, verified | One transaction + `migration repair`; RLS, grants, policy, columns, trigger checked; crons 0 failures |
| Six functions | Deployed | classifier 48, router 29, context engine 29, intake 46, parser 67, dispatcher 4; backup of previous versions in `exports.local/edge-backup-20261118-central` |
| Flags and budget | Set | `CENTRAL_PROCESSING_ENABLED=true`, `CENTRAL_AI_BUDGET_SCOPE=dc-backfill`; budget `dc-backfill` $5.00 approved |
| DC backfill | Done | 391/391 processed, 0 pending/failed/needs attention/skipped; 46 calls; 90,519 in / 30,928 out tokens; $0.5356 (estimate ~$0.75) |
| Reconciliation | Holds for 16/16 permits | 81, 59 and 53-comment permits fully processed |
| ff193644 | Unchanged | 6 ids, approvals, response_md5 and row md5 identical; 0 marks; project run made 0 AI calls |
| Read rules | Hold | 10 users: visible insights = `can_read_permit`; unknown user 0; anon no SELECT |
| Worker redeploy, `20261118140000`, first-run check | Not started | After tonight's scheduled DC job (steps 6–8) |
