# Phase 0 report: DC live read-only verification

Date: 2026-11-05. Account: Commun-ET LLC, existing logged-in Chrome session. No new login.  
Result: **acceptance criteria met.** Items that need a new login or an approved live run are recorded as blockers, not assumed.

## Acceptance criteria (MASTER_PLAN)

| Criterion | Result | Evidence |
|---|---|---|
| Every spec section marked Observed / Code-supported / Unverified | Met | `EXTRACTION_SPEC_DC.md` |
| Fixtures redacted (no emails, phones, names beyond role labels) | Met, and enforced by a test | `scraper-service/tests/fixtures/permit-sync/dc/*.json`; `tests/permit-sync-dc-fixtures.test.js` scans for emails, phones and JWTs |
| Safety tests pass | Met (Locally tested) | `node --test tests/permit-sync-safety.test.js tests/permit-sync-dc-fixtures.test.js` → 24 pass, 0 fail |
| Inventory reconciled or deltas explained | Met | 28/28 across pages 1–3 (Approved 15, Upload 6, In Review 4, Resubmit 3). 4 ProjectIDs not written down; the adapter reads them from the `launchRemote` href |
| Non-verifiable items recorded as blockers | Met | See below |

## What was verified live

- **Auth path:** dashboard `launchRemote` → `/login/sso` → `session.planreview.dob.dc.gov/Project/Index`. A cold URL ends the session.
- **JSON API:** five GET routes with the `Sessionid` header, on In Review, Resubmit and Approved projects.
- **HTML partials:** Reviews (`ProjectCorrections`), Info (`ProjectInfo`), Tasks (`WorkflowTaskList`).
- **Tabs by status:** Reviews exists only on Resubmit (6 tabs). Upload, In Review and Approved have 5.
- **Comments:**
  - Resubmit projects: Reviews rows, with Ref, department, reviewer, date, cycle, Resolved / Info Only / Unresolved status, text and the response thread.
  - Other projects: SSRS Review Comments report.
  - Status JSON unresolved counts match the Reviews rows (fixture parity test).
- **Files:**
  - The folder and file JSON includes the Approved Drawings and Approved Supporting Documents folders.
  - The account has `DownloadFile: false`, so storage is metadata only.
  - Folder `DateUpdated` is a placeholder, so it cannot be used to detect changes.

## Read-only conduct

None of these controls were clicked: task Open/Accept/Process, Respond and Resubmit, Upload, Download Files, the Approved green Open, viewFile, Mark as reviewed, Save Settings, report export, or Log Out. Tab clicks, the dashboard pager, DevTools, and one ReportViewer popup (closed with cmd+w) were the only interactions. The Reviews response textarea was not focused.

## Changes in the repo

- `docs/permit-repository/EXTRACTION_SPEC_DC.md`: rewritten.
- `PROGRESS.md`, `HANDOFF.md`, `DECISIONS.md` (D-013, D-014): updated.
- `scraper-service/permit-sync/core/safety.js`:
  - The allowlist now contains only the observed routes.
  - The deny list is extended.
  - `ProjectEdit` is deliberately not allowlisted.
- `scraper-service/tests/permit-sync-safety.test.js`: updated (17 tests).
- `scraper-service/tests/permit-sync-dc-fixtures.test.js`: new (7 tests).
- `scraper-service/tests/fixtures/permit-sync/dc/`: inventory, Resubmit status JSON, Approved folders, Resubmit corrections.

Nothing is committed, deployed or applied to a database.

## Blockers and risks carried forward

1. **MFA / CAPTCHA on a fresh login:** unverified. Needs a new login, which is not approved.
2. **Session lifetime under automated API use:** unverified. Needs approval A-3.
3. **Selectors in the HTML partials:** the structure is observed, but exact selectors will be fixed against fixtures in Phase 2. Risk: a DOB template change breaks parsing. Mitigation: D-012 integrity guard plus the count-parity checks.
4. **`/Resubmit/i` deny rule:** blocks any URL or click text containing "Resubmit". Intended, because it prevents Respond and Resubmit. It also means the adapter must not click status cells, which it never needs to do.
5. **Policy:** DOB notification / ToS review (A-7) is still open.

## Next phase

Phase 1: central schema, RLS, ingest normalizer, differ and apply RPC, with PGlite SQL tests driven by these fixtures. No production changes.
