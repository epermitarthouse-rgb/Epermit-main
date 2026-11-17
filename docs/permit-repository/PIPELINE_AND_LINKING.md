# Permit comments → Response Matrix, and project linking (Priorities 2, 3 and 4)

Status 2026-11-17: implemented and tested locally on `feat/central-permit-repository`, committed locally only.
Nothing is pushed, deployed, applied, scheduled or run against production. Decisions D-110..D-116.

## What this delivers

- **P2 – downstream pipeline.** Every review comment of every permit linked to a project (and readable by
  the project owner) is merged into that project's `parsed_comments`, then classified, enriched and routed by
  the existing agents, server-side, without anyone's browser. New or changed comments re-enter the pipeline;
  unchanged content does not, even when `portal_data_hash` flips (D-101).
- **P3 – project creation and linking.** "New project" can start from one or more permits (jurisdiction
  filter, search or browse, multi-select, prefill), or from no permit. Editors link and unlink permits later
  from Portal Harvest. Filings follow the project (`permit_filings.project_id`), so no schema change there.
- **P4 – Permit Queue and navigation.** The Permit Queue list shows a "Review comments" column (in Response
  Matrix / Queued / Processing / Retrying / Needs attention / No review comments). The permit page lists
  linked projects with Response Matrix and Portal Harvest buttons. The Response Matrix shows which permits
  feed it and flags comments that left the portal or changed after they were answered. Error details are
  admin-only.

## Flow

```
permit sync (sibling) ──► permits / permit_comments (central repository)
                               │
project_permits (link) ────────┤  _project_permit_comment_fingerprint(project)
                               ▼
project_comment_pipeline_state  (due → running → completed | due (released) | failed → blocked)
      ▲ claim/finish                       ▲ request_project_comment_processing (user "Process now")
      │                                    │
permit-comment-pipeline (edge) ◄── pg_cron sweep every 5 min, worker handoff, or user request
      │  service mode (D-063), acting user = project owner
      ▼
intake-pipeline-agent ─► comment-parser-agent (comment_source = permit_repository)
                       ─► discipline-classifier-agent ─► context-reference-engine ─► auto-router-agent
                               │
                               ▼
                    parsed_comments ─► Response Matrix
```

## Key pieces

| Piece | Where |
|---|---|
| Merge plan (pure) | `supabase/functions/_shared/permitRepositoryComments.ts` |
| Repository read + apply | `supabase/functions/_shared/permitRepositorySource.ts` |
| Legacy portal refresh, now soft-removing | `supabase/functions/_shared/portalCommentRefresh.ts` |
| Dispatcher | `supabase/functions/permit-comment-pipeline/index.ts`, `_shared/permitCommentPipeline.ts` |
| Schema, RPCs, state machine | `supabase/migrations/20261117100000_permit_pipeline_linking.sql` |
| Rollback | `scripts/permit-repo/rollback-20261117100000_permit_pipeline_linking.sql` |
| Cron on/off | `scripts/permit-repo/pipeline/01-enable-pipeline-cron.sql`, `99-disable-pipeline-cron.sql` |
| Test-project check (read-only) | `scripts/permit-repo/pipeline/02-verify-test-project.sql` |
| Worker handoff | `scraper-service/permit-sync/deep/commentDispatch.js` (used by `worker-entry.js`) |
| Frontend data | `src/lib/projectPermits.ts` |
| Frontend views | `src/components/permits/PermitPipelineViews.tsx`, `ProjectPermitPicker.tsx`, `ProjectPermitLinkPanel.tsx`, `PermitQueueCommentsCell.tsx`, `ResponseMatrixPermitStrip.tsx` |

## Human work is never overwritten (D-111)

A row has work on it when it has any response text (an AI draft counts, to be safe), a response status, an
approval or a human edit (`last_edited_by`). For such rows a portal text change goes to `portal_latest_text` /
`portal_changed_at` (shown as "Updated on portal" with the new text) instead of replacing `original_text`.
The status follows the portal only while it still equals what the parser last derived from the portal.
Comments that disappear from the portal are soft-marked `portal_removed_at` ("No longer on portal") and
only when the permit's Reviews section was read completely. Nothing is deleted except parser staging rows.
The downstream agents already only fill blanks: the classifier picks unclassified rows, enrichment writes a
response only when it is empty, the router picks unassigned rows.

The approval trigger refused any service-role update to an approved row; it now lets service-role updates
through when they leave `response_status`, `response_text`, `approved_at` and `approved_by` unchanged (D-114).

## Recovery without re-scraping (D-113)

Everything the pipeline needs is already in the central repository, so a retry never touches the portal.
Failures back off 5 min × 4^(n−1) up to 6 h and block after 5 failures (or 5 interrupted runs).
An interrupted run resumes from its `pipeline_run_id`. Editors use "Try again"; admins see the error.

## Test results (local)

- `scraper-service`: `npm run test:permit-sync` 261/261 pass (includes the migration chain + rollback test
  and 11 linking/pipeline tests on PGlite).
- Analyzer suite (includes `supabase/functions` tests): 84 files, 0 unexpected failures.
- Frontend suite: 117 files, 0 unexpected failures (16 known).
- tsc 194 = baseline; eslint on touched files: no new errors.
- `npm run build` passes. `validate-migrations` passes. No Deno on this machine (`deno check` not run).

## Production steps (need the one consolidated approval)

Order matters. Each step is safe on its own: nothing processes until step 5 or a user request.

1. **Migration** `20261117100000_permit_pipeline_linking.sql` via
   `supabase db query --linked -f supabase/migrations/20261117100000_permit_pipeline_linking.sql`, then
   `supabase migration repair --status applied 20261117100000`. Never `supabase db push`.
   Adds nullable columns, one table, functions; replaces the approval trigger function.
   Rollback: `scripts/permit-repo/rollback-20261117100000_permit_pipeline_linking.sql`.
2. **Secret** `PERMITPILOT_SERVICE_PIPELINE_SECRET` on Edge Functions (optional `PERMIT_PIPELINE_BUDGET_MS`).
   Check vault secrets `supabase_project_url` and `supabase_service_role_key` exist (needed by the cron).
3. **Edge Functions** `permit-comment-pipeline` (new), `comment-parser-agent`, `intake-pipeline-agent`,
   `discipline-classifier-agent`, `context-reference-engine`, `auto-router-agent`.
4. **Frontend** deploy. Safe before or after step 1: the new reads return empty when the schema is missing.
5. **First run** on the test project (ff193644 ↔ BCIV2500152) with "Process comments now"; check with
   `02-verify-test-project.sql`. Expected: the 6 existing rows are adopted in place (identity set), no inserts,
   no removals, responses and approvals unchanged.
6. **Cron** `01-enable-pipeline-cron.sql` (every 5 minutes). Off: `99-disable-pipeline-cron.sql`.
7. Optional: the same secret on the worker, so the deep worker hands off right after a sync (sibling's deploy).

## Not done / next

- Code Analyzer V2 is untouched. The repository already keeps permit files and report exports per permit;
  a later analyzer can read them by `permit_id` without going through `parsed_comments`.
- The Response Matrix main query is unchanged; portal markers are a separate query.

## Redeploy after the "Conflicting API keys" fix (D-117)

Root cause: service-to-service calls mixed key kinds. The dispatcher sent `apikey: SUPABASE_ANON_KEY` with
`Authorization: Bearer <built-in service key>`, and intake did the same toward the stage agents; the gateway
rejects an `apikey` and Bearer that are different kinds of key. The worker's calls pass because it sends the
legacy service JWT as both. The built-in `SUPABASE_SERVICE_ROLE_KEY` differs from that JWT in production
(held as the `SERVICE_ROLE_KEY` secret, also accepted by `processorAuth`).

Fix (`_shared/serviceExecution.ts`, `serviceExecutionDeno.ts`, dispatcher): every service call carries one key as
both `apikey` and Bearer, the legacy JWT from env `SERVICE_ROLE_KEY` (built-in as fallback); receivers accept it
as Bearer in addition to the built-in key, still only with the pipeline secret, project owner and link checks.
No new secret, no migration, no frontend change. Regression tests in `serviceExecution.test.ts` (5 fail on the old code).

All six functions import the shared module, so all six change; none changes behaviour otherwise:

```
supabase functions deploy permit-comment-pipeline intake-pipeline-agent comment-parser-agent \
  discipline-classifier-agent context-reference-engine auto-router-agent --project-ref eeqxyjrcldivtpikcpvk
```

Deploy `permit-comment-pipeline`, then intake, then the four stage agents (a stage agent still on the old code
would reject the legacy Bearer with `bearer_mismatch`). Rollback: redeploy the previous code from
`exports.local/edge-backup-20261117/` (versions 42/62/44/25/25 for the five existing; the dispatcher has no
earlier version, so roll it back by disabling the secret or leaving the cron off).

Step-8 re-run: (1) run `scripts/permit-repo/pipeline/02-verify-test-project.sql`; the pipeline state is `failed`
with attempts > 0, so (2) click "Process comments now" on ff193644 (this resets attempts and forces a run);
(3) re-run `02-verify-test-project.sql`. Expected: same 6 ids, `adopted` and `has_key` true, response and
approval columns and `response_md5` unchanged, no removals, state `completed`, one `comments:`-keyed run.
