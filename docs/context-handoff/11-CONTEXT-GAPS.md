# 11 — Context gaps

**Extraction date:** 2026-10-19  
Items here were not closed by repo reading or by the read-only Railway CLI calls. Do not fill them with guesses.

## Not verified against live systems

| Gap | Why it matters | How to close it without a write |
|-----|----------------|----------------------------------|
| Hosted migration list vs 160 git files | Feature flags, crons, and default project access may be code-only | Read-only query of `supabase_migrations.schema_migrations` |
| Whether `projects.portal_data` and `profiles.subscription_*` exist in production | App writes them; git does not create them | `information_schema.columns` |
| `governance` enforce mode value | Admin UI can be live while enforcement is still `legacy` | Read `governance_config` if the table exists |
| Vault secrets for cron (`supabase_project_url`, service role) present or not | Crons no-op or fail closed if missing | Supabase dashboard, do not copy values |
| Which of the 15 Edge Functions without a `config.toml` block were deployed with JWT verification on | Security boundary | `supabase functions list` and dashboard verify_jwt, plus a handler read |
| Per-function caller checks inside the 36 `verify_jwt = false` functions | Same | Read handlers. Not done in this pass |
| Vercel production deployment SHA and `VITE_CODE_ANALYZER_ASYNC_V2` | Analyzer UI can be off while the worker is on | Vercel dashboard, names only in notes |
| Vercel project id and team | Not in git | Dashboard |
| Exact git SHA inside Railway images | CLI message says `fc74c35` for scraper and analyzer; the JSON inspected had no `commitHash` field | Railway deployment source view |
| `document-ingestion-worker` root directory and start command in Railway settings | Last success is 2026-08-04. Wrong root would explain the stall | Service settings, read-only |
| `code-analyzer-worker` production env `SCRAPER_SERVICE_URL` | Wrong port fails sheet jobs | Confirm the variable is set. Do not print it |
| Railway development Supabase URL equals production | Documented as shared. Not compared | Compare variable **names and a hash**, not values, if a human approves |
| QuickBooks company still entitled to create invoices | August blocker | Intuit account status |
| Stripe live mode vs test mode | Billing status unknown | Stripe dashboard |
| UCI live-submit and Graph flags in production | Docs say default false | Presence check only |
| `pg_cron` jobs actually scheduled | SQL is conditional | `select jobname from cron.job` |
| External schedulers for inspection and deadline reminders | No cron row in migrations | Supabase or third-party scheduler list |
| Storage bucket `project-drawings` exists in production | Code path **verified**: `ensureStorageBucket` creates it public or updates it to public. Live bucket not listed | Storage API list |
| `contact_submissions` table | Not created in migrations | information_schema |
| Six-jurisdiction scraper UAT | No fresh log | Human UAT on demo projects |
| Portal harvest “synced = 0” and progress-widget bugs | July audits | Reproduce on a demo project |
| Full replay of 46 Cursor transcripts | Only opening prompts were indexed | Open a specific transcript id when a decision is disputed |
| User-level Cursor memory store | Not mined | Only if the human says those memories are in scope |
| `D71404/Epermit` contents | Excluded on purpose | Do not close this gap |

## Contradictions left in older docs (do not “fix” those files in this task)

| Older source | Conflict | Resolution used here |
|--------------|----------|----------------------|
| `docs/diligence-readiness/ARCHITECTURE.md` §6 | Analyzer v2 not on remote and not in production | Stale. Code and Railway disagree |
| `RAILWAY_PRODUCTION_STATUS.md` | Production scraper at `331fa80` | Stale. 2026-10-19 deploy message names `fc74c35` |
| `PERMITPILOT_360_PRODUCTION_AUDIT.md` | All 51 functions `verify_jwt = false` in config | Stale. 36 entries |
| `memory.md` and `docs/current-system-architecture.md` | `PublicOnlyRoute` exists | Component absent on `fc74c35` |
| `docs/current-system-architecture.md` | Feature flags are localStorage only | RPC `get_feature_flags` exists |
| `docs/admin-dashboard/IMPLEMENTATION.md` | Governance work uncommitted | Files are on `main` |
| Root `README.md` Node 18+ vs Nixpacks Node 20 | Engine mismatch | Follow Node 20 for workers and Docker |
| `deploy-github-railway.mdc` vs Lovable rule | Production `railway up` on every push vs never for Lovable | Branch-scoped. See [07](./07-CURSOR-RULES-AND-MEMORIES.md) |
| August QuickBooks “public status metadata” vs later route behavior | Payload may have been narrowed | Re-read `quickbooks.routes.js` before editing |

These older files were **not** rewritten. This handoff is the correction layer.

## Workspace noise

The Cursor workspace root `/Users/javerianaveed/epermit` contains the git repo **and** unrelated local material (demo PDFs, a McDonald’s demo package, `Epermit-main-graph-egress-release`, `uci-aspinhill docs`). Facts from those folders were not used. A future agent that greps the workspace root will mix them in unless it scopes to `Epermit-main/`.

## Second-pass notes

Review performed after the twelve documents were drafted, then checked against source:

- Railway service list in [05] matches a live CLI call, not only the user prompt.
- Analyzer “not in production” wording from August is contradicted on purpose and repeated in [02], [03], [06], and [09] so a single doc cannot reintroduce it.
- Feature status “IMPLEMENTED” in [03] means code path on `main`, and the production-proof column stays UNKNOWN where no live test was run.
- Recount: **51** function directories excluding `_shared`; **36** `verify_jwt = false` lines in `supabase/config.toml`.
- `OperationsBoard.tsx` imports both `operations-demo-data` and `operations-real-data`.
- `processSheetJob.js` and `processCodeModJob.js` default `SCRAPER_SERVICE_URL` to `http://localhost:3000`.
- `ensureStorageBucket` public-bucket behavior was re-read and [04] / [08] were corrected from “inferred” to that code path. Live bucket presence stays unknown.
- No secret values were copied from `src/lib/supabase.ts`, Railway, or `.env`.
- `uci.routes.js` handler count of 139 was **not** re-counted. It remains a 2026-08-27 figure.
- Transcript conclusions were not treated as production truth except where Railway CLI agreed (analyzer worker deploy on 2026-10-19).
- Application code, migrations, env vars, and deployments were not modified. Only `docs/context-handoff/` was written.

## Questions for a human

1. Should `document-ingestion-worker` be rebuilt from current `main`, and what is its Railway root directory?
2. Is `VITE_CODE_ANALYZER_ASYNC_V2` set on the Vercel production build?
3. Which migrations through `20260919010000` are already applied on `eeqxyjrcldivtpikcpvk`?
4. Is Railway development still pointed at the production Supabase project?
5. Is the QuickBooks Intuit subscription blocker still in force?
6. Should the seven “DO NOT apply” migrations be applied, rewritten, or left indefinitely?
7. Are the open UCI Track A/B branches still the delivery line, or has `main` superseded them?
8. May a later task edit `memory.md` and the July architecture doc to remove `PublicOnlyRoute`, or should those historical docs stay untouched?
