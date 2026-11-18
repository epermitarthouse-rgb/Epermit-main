# Montgomery — Code Audit, Gaps, Rollout

Branch `feat/montgomery-adapter` (worktree `Epermit-montgomery`, from origin/main `fdf11a6`). Evidence levels:

- **I** — implemented
- **T** — locally tested
- **D** — deployed
- **P** — production-verified

## 1. Earlier figures re-checked (read-only production queries, 2026-11-18)
"11 projects / 244 parsed comments" **does not reproduce.** The actual figures:

- Only 3 `projects` rows have jurisdiction "Montgomery County": a8f43e55 COMBUILD-1154415 (41 comments), 7372196b "test 5" (0) and a840184f (0).
- Rows whose `permit_number` is a Montgomery portal permit:
  - COMBUILD-1154415 twice: a8f43e55 with 41 comments, and 9b57cccc "Mont-COMBUILD-1154415" with 41;
  - COMBUILD-1140088 (94dc5e40): 42;
  - COMBUILD-1073768 (6daf6610): 11;
  - SIGN-1159714 (c8e29771): 2.
- That is **5 rows covering 4 distinct portal permits and 137 comments, 96 of them unique** (the duplicate COMBUILD-1154415 holds the other 41).
- Rows that look related but are not Montgomery portal permits: B2600602 (56), COM-00333-2026 (10), COM-00317-2026 (62), and COMM-1140088 (0), which is a mistyped COMBUILD-1140088.
- `permits` has no Montgomery rows, and there is no Montgomery `permit_sync_sources` row.
- Two Montgomery credentials exist:
  - 93857549 is encrypted and is the one used by the capture;
  - eaf14fcc is **not encrypted**, and the worker refuses it.

## 2. Existing Montgomery code: reuse, adapt, missing

| Component | Verdict |
|---|---|
| `scrapers/montgomery/portal-login.js` `performMontgomeryPortalLogin` | **Reused** as the worker login (worked live twice, no MFA). |
| `scrapers/montgomery/dashboard-discovery.js` | **Not used.** It reads only the portal Home table (10 of 20). Replaced by the projects grid JSON. |
| `scrapers/montgomery/projectdox-scraper.js` (`runMontgomeryProductionPipeline`, about 3,000 lines of DOM scraping) | **Not used for the JSON pass.** The Web API returns the same data as JSON. It still holds the only Montgomery file-download and report-export code (see G-1). |
| `MONTGOMERY_REPORT_SPECS` | Confirmed against the live report list (132 to 135; 139 on one project). |
| `scrapeMontgomeryAll` (HTTP route) | Writes straight to a project and has no permit-sync hooks (file gate, private `storeFile`, `onReportEntry`, budget, cancel/lease). Cannot be used as the deep pass without changes (G-1). |
| Deterministic parsers: `lib/reviewCommentsExcelStructuredRows.js`, `normalize.correctionRowsFromReportExcel`, `_shared/montgomeryReviewCommentsExtract.ts`, `mapMontgomeryStructuredRowsToDeterministic.ts` | **Reused unchanged.** The Excel parser and the Excel-row → review mapping are shared with DC (D-103). The edge-function Montgomery parsers stay as they are for project-mode processing. |
| Central processing (`permit-comment-pipeline`, `permit_comment_insights`, budget ledger) | **Reused unchanged.** It is adapter-agnostic (the `adapter_key` regex accepts `montgomery-projectdox`). |
| Queue, worker loop, retries, leases, heartbeats, monitoring, schedule (`permit_sync_*` SQL) | **Reused unchanged.** No SQL hard-codes the adapter except the one-time D-120 backfill (`visible_to_all` for DC), so a new source defaults to hidden. |

## 3. What this branch implements (I + T)
- `adapters/projectdox-tenants.js` holds the tenant config for DC and Montgomery: hosts, open hosts, report hosts, report identity, extra routes.
- `core/safety.js` is tenant-aware: `evaluateRequest({tenant})` and `createRunGuard({tenant})`. With no tenant given it is DC, byte-identical to before (asserted). The deny list is shared.
- Routes and adapter:
  - `routes.js` adds `paged_active_projects` and `buildTenantUrl`;
  - `adapter.js` takes a `normalizer`, with DC as the default;
  - `live-transport.routeReadRequest` uses the guard's tenant.
- New `adapters/montgomery-projectdox/`, in three files:
  - `normalize.js`: grid rows, a permit-number identity check that refuses names like "Mont test", the status map;
  - `adapter.js`: the shared adapter;
  - `live-transport.js`: login injection, the "View All Projects" hop under the auth policy, page-fetch reads, discovery through the grid, per-project Info template, empty corrections JSON → report.
- `worker-entry.js`:
  - adapter registry (`ADAPTERS`); Montgomery reads `login_url`, used only when it is on the Montgomery portal host;
  - in JSON mode Montgomery runs the JSON pass; in deep mode the shared deep runner follows each permit with the Montgomery deep driver (G-1, D-139).
- `lib/dc-credential-lock.js` takes a per-portal lock (D-061), with DC as the default (its queries are unchanged, asserted). The manual HTTP flow checks the Montgomery lock too (`register-execution-routes.js`, two call sites).
- `deep/repo.js` takes `storedReviewReport` with an adapter key (DC is the default).
- Tests:
  - `tests/permit-sync-montgomery.test.js`: 19 tests over a synthetic Montgomery portal (`tests/helpers/montgomery-fixture-transport.js`, shapes from the capture, every value made up);
  - `tests/permit-sync-montgomery-deep.test.js`: 6 end-to-end tests of the deep pass on PGlite with the real migrations and capture RPCs (G-1), including a header-only Review Comments export and the unhandled-download crash;
  - full `test:permit-sync`: **326 / 326**; report-export suite 15 / 15;
  - Arlington, cancel and lock-related suites: 39 / 39;
  - `node --check app/register-execution-routes.js` passes.

## 4. Gaps and blockers

| ID | Gap | Impact | Proposed fix | Needs |
|---|---|---|---|---|
| **G-1** | Montgomery deep pass. **Live-verified on 200100, 195963 and 146267 (six supervised scoped jobs, 2026-11-18; HANDOFF table).** 25 files stored with sha256 provenance, reports 132–135 captured where renderable, Review Comments parsed (2 and 41 rows) and written as comments in the same job. | Remaining: originals from RetrieveFile are not usable, so every file is the PDF rendition (D-143); files beyond the 5-per-job test budget are still pending; only scoped runs so far. | Done: D-141 (parser), D-142 (same-job re-read), D-143 (in-page RetrieveFile), D-144 (reports without a workflow instance). | Approval for merge, worker redeploy and one supervised all-20 run. |
| G-2 | Two production rows for COMBUILD-1154415 (a8f43e55, 9b57cccc), plus non-portal permit numbers in `projects`. | Linking must not attach the wrong project. | Link only after validation (§6). | Your decision on which duplicate to keep. |
| G-3 | Credential eaf14fcc is unencrypted. | The worker refuses it (by design). | Use 93857549 for the source. Re-encrypt or retire eaf14fcc separately. | Approval for any credential change. |
| G-4 | `src/lib/centralPermits.ts:listExportPermits` and `permitExport.ts` default to `dc-projectdox`. | The repository export page lists DC only. | Pass the adapter key through (frontend change, small). | — |
| G-5 | `core/downloads.js` (legacy JSON-mode decision) names only DC. | None. It never downloads ("downloader_not_implemented"); deep capture uses `deep/policy.js`. | Leave as is. | — |
| G-6 | 146267 (PreApproval Corrections) has no workflow instance. | Status and reviews are `absent`; its workflow reports (133–135) are listed with an empty WFlowInstanceID and cannot render. | Live-verified: D-144 records `report_needs_workflow` once, does not open them and does not count them open; they are planned again when the listing gains an instance id. | — |
| G-7 | The DC report-HTML parser (`extractReviewCommentsReport`) on Montgomery HTML. | — | Live: 200100's one-page report gave the same 2 comments as its Excel export. Multi-page reports use the Excel path (D-142). | — |
| G-8 | Linked-project `portal_data` sync for Montgomery. | None while no Montgomery permit is linked. The driver refuses the sync, so a linked Montgomery permit fails its deep pass instead of writing an unmapped shape. | Map the stored capture to `portal_data` when linking is approved (§6). | Your linking decision. |

## 5. Rollout plan (each remaining step needs your approval)
1. **Merge** `feat/montgomery-adapter` after CI (no migration in this branch).
2. **Worker redeploy** with this code. This is the same deploy as DC's pending step 6; DC behaviour is unchanged (asserted).
3. **Source created** (2026-11-18, approved): credential 93857549, `montgomery-projectdox`, status inactive, automation off. `visible_to_all` stays false until you decide.
4. **First deep run happened** (job `3942a5ad`, cancelled after the exporter crash). Discovery wrote all 20 permits.
5. **Supervised scoped runs done** (approved loop, six jobs on 200100, 195963 and 146267; D-141 repair applied to 200100 report 133). Files, reports and comments verified (HANDOFF). Next: merge, redeploy, then one supervised all-20 deep run under the default budget.
6. **Linking** after §6 validation.
7. **Schedule**, only after steps 4–5 (and G-1 for deep) are verified and you approve:

```json
{"frequency": "daily", "time": "01:00", "timezone": "America/New_York"}
```

   This is 3 hours before DC's 04:00. One worker runs jobs one at a time, so a JSON Montgomery pass (about 10–15 minutes for 20 permits at the 1.5 s throttle) is long finished before DC starts. A different login means the D-061 lock never collides. If DC's run is ever still going, a queued Montgomery job just waits its turn; neither job fails.
8. **Budget:** a separate scope `montgomery-backfill` with a $5 cap. It would cover the full 20-permit comment set: DC processed 391 comments for $0.54, and Montgomery has at most a few hundred. The backfill takes its own scope: `central_backfill` with `adapter_key: "montgomery-projectdox"`, `budget_scope: "montgomery-backfill"` and `approved: true`, which `permit-comment-pipeline` reads per request. Cron sweeps keep using the project-wide `CENTRAL_AI_BUDGET_SCOPE` (`dc-backfill`, $4.46 left), so the incremental Montgomery changes after the backfill draw on that shared cap unless you change the secret.

## 6. Project-linking validation (before any link)
A project may be linked to a Montgomery permit only when all of these hold:

- its `permit_number` normalizes to a portal permit from discovery (`COMBUILD-…` / `SIGN-…`, `permit_number_normalized` equal);
- its owner has access through the source's credential (or an admin grant);
- there is exactly one candidate project per permit (duplicates resolved by you).

Candidates today:

| Project | Permit | Note |
|---|---|---|
| a8f43e55 / 9b57cccc | COMBUILD-1154415 | Choose one |
| 94dc5e40 | COMBUILD-1140088 | |
| 6daf6610 | COMBUILD-1073768 | |
| c8e29771 | SIGN-1159714 | |

Not eligible: B2600602, COM-00333-2026, COM-00317-2026, COMM-1140088 (typo), test rows.
