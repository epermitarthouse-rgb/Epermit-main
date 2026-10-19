# 09 — Roadmap and priorities

**Extraction date:** 2026-10-19  
**Code:** `main` @ `fc74c35`

This is not a new product plan. It reconciles the August 2026 backlog with what is already on `main`, then states what is still open. Hour estimates in `docs/diligence-readiness/PERMITPILOT_UPCOMING_WORK_AND_ESTIMATE.md` and `docs/admin-dashboard/ADMIN_IMPLEMENTATION_ROADMAP.md` are **HISTORICAL** and are not repeated as commitments.

## What changed after the August backlog

These items were open or “not merged” on 2026-08-27 and are now on `main`:

| August item | State on 2026-10-19 |
|-------------|---------------------|
| Code Analyzer async v2 “local only” | Worker, migrations, and UI gates are on `main`. Production Railway service online, deploy message `fc74c35` |
| Admin governance foundation | Migration `20260910120000_admin_governance_foundation.sql` and `/admin/access/users` are on `main`. Enforcement mode in the live database is still **UNKNOWN** |
| Platform feature flags and module flags | Migrations and `moduleFeatureFlags.ts` exist. Several of those SQL files say do not apply until reviewed. Hosted apply state **UNKNOWN** |
| Jurisdiction CSV RPC | Migration `20260918190000_jurisdiction_subscription_integrity_and_csv_rpc.sql` is in git (also a do-not-apply header). Branch `feat/platform-jurisdictions-phase-1` still exists at `fe2eb28` |
| Analyzer accuracy (evidence before pass, page size) | Latest commits on `main`, including `fc74c35` |

Do not re-implement those as if they were still design-only. Read the code and confirm the hosted migration before extending them.

## Still open, in dependency order

### P0 — safe operation of what already shipped

1. **Confirm hosted migrations vs the 160 files**, especially the seven “do not apply” files, `portal_data`, and `profiles.subscription_*`. Everything else in the backlog is unsafe while this is unknown.
2. **Confirm Vercel build flags and deploy SHA**, especially `VITE_CODE_ANALYZER_ASYNC_V2` and whether the SPA is `fc74c35`. The analyzer worker can be current while the UI still refuses to enqueue.
3. **Decide whether to redeploy `document-ingestion-worker`.** Production image is from 2026-08-04. Do not redeploy until the service root and env names are confirmed.
4. **Edge Function caller audit** (old PP-004). Start with functions that have `verify_jwt = false` and accept user input or webhooks: `stripe-webhook`, `epermit-submit`, `analyze-drawing`, `permitwizard-execute`, `ingest-project-document`.
5. **QuickBooks live invoice** remains externally blocked unless Intuit subscription status has changed since August. Code path exists. Do not treat status `connected: true` as proof of invoicing.

### P1 — product gaps already named by the team

| ID | Work | Dependency |
|----|------|------------|
| PP-001 | Merge Supabase env-var client (`fix/frontend-supabase-env-config`) only after Vercel values are confirmed | P0 item 2 |
| PP-006 | Six-jurisdiction scraper UAT (DC, PGC, Montgomery, Howard, Baltimore, Arlington/Fairfax) | Saved credentials, demo projects |
| PP-008 | Enqueue document ingestion when a scrape stores a new PDF | Ingestion worker currency (P0 item 3) |
| PP-009 | OCR for scanned sheets, or an explicit product limitation in the UI | Separate from analyzer evidence rules |
| PP-010 | Intake pipeline monitoring when discipline counts stay zero | `memory.md` §8 |
| PP-014 | Replace `PermitQueuePlaceholder` with real data, or remove it from nav | Product decision |
| PP-015 | Remove operations-board mocks or label every mock figure in the UI | New tables if the board should be real (`operations-board-future-schema.md`) |
| PP-018 | Admin authorizations beyond the redirect to access users | Governance enforce mode |
| PP-019 | Run frontend and worker tests in CI | None |
| UCI pilot | Real documents, live PEPCO/Graph only with explicit approval | Flags default off |

### P2 — structural

- Split `register-execution-routes.js` without changing portal behavior (PP-016). The `/__future` mount is the sandbox. Do not delete `server.js`.
- Finish or close `wip/code-mod-uat-cleanup` (`edc20c4`). V2 code-mod jobs already run from `main`; this branch is cleanup SQL, not the feature itself.
- Reconcile UCI Track A/B branches (`feat/uci-track-ab-*`) with `main` before more UCI UI work. Merge status was not fully traced.
- Lovable replication stays on `feat/lovable-ui-replication` until a human asks to merge.
- Infrastructure-as-code for Railway is still absent (PP-022 in the August list). Service roots live in the dashboard.

### P3 — explicit non-goals until requested

- Mobile Capacitor packaging.
- Replit revival.
- Full Monday-style operations board.
- Deleting `generate-response` in favor of only the grounded function.
- Applying the do-not-apply migrations as a batch.
- Using `D71404/Epermit` for anything.

## Active branches (local, tracking origin)

Observed 2026-10-19 with `git branch -vv`. Tips are not `main`.

| Branch | Tip | Use |
|--------|-----|-----|
| `main` | `fc74c35` | Production line |
| `feat/code-analyzer-async-v2` | `bf788bf` | Historical V2 line. Content may already be merged; do not reset `main` to this tip |
| `feat/code-analyzer-drawing-management` | `a831bf6` | Drawing discovery/hydration |
| `feat/lovable-ui-replication` | `f5d6fb9` | Visual work only |
| `feat/platform-jurisdictions-phase-1` | `fe2eb28` | Jurisdiction admin phase 1 |
| `feat/uci-load-profile-document-scope` | `0931536` | Load profile scoped to the current coordination record |
| `feat/uci-operator-surface-readiness` | `0853eaa` | `/uci` operator surfaces |
| `feat/uci-track-ab-backend` / `-frontend` / `-schema` | `7aef95b` / `bec374d` / `cdb40c3` | UCI track A/B |
| `fix/frontend-supabase-env-config` | `2a5bf81` | Unmerged client config fix |
| `fix/uci-d13-classify-mock-chain` | `4839e64` | Test mock chain |
| `fix/uci-graph-inbound-postgrest-egress` | `835b069` | Graph polling read size |
| `wip/code-mod-uat-cleanup` | `edc20c4` | Cleanup SQL |
| `replit-agent` | `d867472` | Archival |

## Suggested next engineering session

If the human does not name a feature, the highest-leverage read-only follow-up is:

1. Diff hosted migration history against `supabase/migrations` (read-only).
2. Read Vercel production env **names and presence** for `VITE_CODE_ANALYZER_ASYNC_V2` without pasting values into chat.
3. Record whether `document-ingestion-worker` should be rebuilt from current `main`.

Feature work that matches the October conversation history is Code Analyzer evidence quality, not a new module. Any change there must keep `assertNewAnalysisUsesV2()`, the sheet-evidence rule from `fc74c35`, and the worker → scraper HTTP contract.

## UCI roadmap pointer

Milestone list D1–D13 lives in `uci/UCI_DELIVERY_ROADMAP.md`. Treat it as the planning authority for UCI. `docs/uci-action-items-status.md` is the status tracker the August architecture doc points at. Both can lag `main`. Update them only when a human asks for doc maintenance.

## Admin roadmap pointer

`docs/admin-dashboard/ADMIN_IMPLEMENTATION_ROADMAP.md` describes a multi-hundred-hour governance program. WP-0 schema and a large part of the UI landed. Remaining work is enforcement cutover, authorizations that are still redirects, and monitoring — not a greenfield admin app.
