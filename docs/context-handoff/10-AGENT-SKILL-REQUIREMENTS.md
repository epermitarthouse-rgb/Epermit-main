# 10 — Agent skill requirements

**Extraction date:** 2026-10-19  
**Status:** specification only. Do not create `.cursor/skills` or `SKILL.md` files until this set is reviewed against the rest of `docs/context-handoff/`.

Skills are procedures plus prohibitions. They do not replace reading the file that is about to change.

Shared prohibitions for every skill:

- Do not use `https://github.com/D71404/Epermit` or merge facts from it.
- Do not print secret values, `.env` contents, service-role keys, portal passwords, or OAuth tokens.
- Do not apply migrations, deploy, or change Railway/Vercel/Supabase env vars unless the user explicitly asked for that operation and the skill’s checklist passed.
- Do not push to `main` unless the user asked.
- Do not update git config.
- GitHub CLI identity must be `epermitarthouse-rgb` before any `gh` write.

---

## S1 — Epermit architecture navigation

**Purpose:** Decide which process owns a change before editing.

**Activate when:** The task mentions a feature, bug, or “where does X live,” or before the first code edit in this repo.

**Required context:** [02-SYSTEM-ARCHITECTURE.md](./02-SYSTEM-ARCHITECTURE.md), [12-MASTER-CONTEXT-INDEX.md](./12-MASTER-CONTEXT-INDEX.md).

**Procedure:**

1. Classify the change: browser UI, Supabase schema/RLS, Edge Function, scraper/Playwright, analyzer worker, ingestion worker, or docs.
2. Open the owning directory only. Do not “fix” a worker bug by patching only the React page if the job is claimed server-side.
3. If the change crosses the worker and the scraper, trace `SCRAPER_SERVICE_URL` and the HTTP path.
4. Prefer `main` over `docs/diligence-readiness` when they disagree. Cite the disagreement.

**Verify:** The PR or summary names the process that must be redeployed (Vercel, `Epermit-main`, `code-analyzer-worker`, `document-ingestion-worker`, or `supabase functions`). “No deploy needed” is an acceptable answer.

**Prohibited:** Editing `Epermit-main-graph-egress-release` or `reference/lovable-ui` as if they were production. Starting a second app server for ordinary CRUD.

---

## S2 — Frontend and UI

**Purpose:** Change React routes and components without dropping working behavior or shipping Lovable mocks.

**Activate when:** Edits under `src/pages`, `src/components`, `src/hooks`, styling, or routing.

**Required context:** `src/App.tsx` guards, `src/lib/moduleFeatureFlags.ts`, `.cursor/rules/lovable-ui-development-workflow.mdc` if the task is visual parity.

**Procedure:**

1. Find the route and whether `ModuleFlagGate` can hide it.
2. Keep existing handlers, permissions, and options. Lovable screenshots are not a deletion list.
3. If the work is Lovable replication, use branch `feat/lovable-ui-replication` only.
4. For a web UI change, verify the flow in a browser (click, type, submit) when a dev server is available. A screenshot of a static render is not verification.
5. Run the nearest `npx tsx --test` file when one exists.

**Verify:** Route still behind the same guard. No new mock data on a production path. Typecheck or the relevant test command was run, or the reason it was not.

**Prohibited:** Merging Lovable work to `main` without approval. Changing Vercel production env vars. Reintroducing `PublicOnlyRoute` without a product request. Editing `capacitor.config.ts` Lovable URL as part of an unrelated UI task.

---

## S3 — Supabase migrations

**Purpose:** Change schema without destroying hosted data or applying files marked do-not-apply.

**Activate when:** Any task touches `supabase/migrations/` or claims a column is missing.

**Required context:** [04-DATABASE-AND-SUPABASE.md](./04-DATABASE-AND-SUPABASE.md).

**Procedure:**

1. Search migrations for the table and column before adding one.
2. Remember `projects.portal_data` and `profiles.subscription_*` may exist only in production.
3. Read headers of the seven do-not-apply files before `supabase db push`.
4. New project-scoped tables use the current `has_project_access` helpers, not a copied January 2026 owner-only policy, unless the task is specifically to narrow access.
5. RLS on by default. Service-role-only tables (OAuth tokens) get no anon policies.
6. Do not apply against the hosted project unless the user asked.

**Verify:** Migration is additive (`IF NOT EXISTS` where that matches local style). A one-line note of what a rollback would be (usually forward-fix, not a down migration). Types regeneration called out if columns changed.

**Prohibited:** `supabase db reset` on the hosted project. Editing applied migration files that are already on `main`. Putting seed passwords or keys in SQL.

---

## S4 — Auth and RLS

**Purpose:** Keep team, tenant, and admin rules intact.

**Activate when:** Policies, `has_project_*`, invites, `user_roles`, `access_status`, credential grants, or admin RPCs change.

**Required context:** [04](./04-DATABASE-AND-SUPABASE.md) access-control section. `docs/admin-dashboard/ADMIN_ROLE_AND_PERMISSION_MATRIX.md` for intended admin behavior.

**Procedure:**

1. State who can read and write before and after the change: owner, team editor, team admin, platform admin, super admin, deactivated user, demo tenant, service role.
2. Respect `is_user_active`, `can_access_tenant`, and the default-write override model.
3. Invitation tokens stay hashed (`token_hash`). Do not return raw tokens from list APIs.
4. Frontend `useRequireAdmin` is not sufficient. The table or RPC must enforce the same rule.

**Verify:** A deactivated user and a user without the role cannot perform the new operation. Demo tenant cannot read production tenant rows.

**Prohibited:** Disabling RLS to “make the UI work.” Granting `anon` execute on admin RPCs. Logging portal passwords.

---

## S5 — Edge Functions

**Purpose:** Ship Deno functions that authenticate callers even when `verify_jwt` is false.

**Activate when:** Files under `supabase/functions/`.

**Required context:** `supabase/config.toml` entry for that function. `_shared/` helpers.

**Procedure:**

1. If `verify_jwt = false`, implement user JWT, service-role, webhook signature, or cron-secret check in the handler. Say which one in the PR.
2. Reuse `_shared` auth helpers if they exist for that pattern.
3. Do not call the scraper without `SCRAPER_SERVICE_URL` documented by name.
4. Deploy only the named function, and only when asked: `supabase functions deploy <name>` after `supabase link --project-ref eeqxyjrcldivtpikcpvk`.

**Verify:** Unauthenticated request is rejected for user-scoped functions. Webhook rejects a bad signature. No new secret in source.

**Prohibited:** Setting `verify_jwt = false` on a new function without an in-code check. Deploying all 51 functions because one changed.

---

## S6 — Railway services and deployment

**Purpose:** Deploy the service that contains the change, to the environment the user named.

**Activate when:** The user asks to deploy, push to production, or `railway up`.

**Required context:** [05-RAILWAY-AND-DEPLOYMENT.md](./05-RAILWAY-AND-DEPLOYMENT.md), both deploy cursor rules.

**Procedure:**

1. `git branch --show-current` and `railway status`. Confirm project PermitPilot.
2. Map the diff to a service: scraper paths → `Epermit-main`; `code-analyzer-worker/` or root `nixpacks.toml` → `code-analyzer-worker`; `document-ingestion-worker/` → that service; `src/` only → Vercel, not Railway.
3. Pass `--environment production` or `--environment development` explicitly.
4. Lovable branch never targets production.
5. Analyzer deploys from the repo root so the root Nixpacks file and the `findingQuality.js` import are in context.
6. Report deployment id and status. Do not claim success from a local build.

**Verify:** `railway deployment list --limit 1` for that service shows SUCCESS, or the error is reported with GitHub push status separate.

**Prohibited:** `railway down`. Deploying all three services by habit. Printing variables. Redeploying the ingestion worker as a side effect. Assuming development has a code-analyzer service (it did not on 2026-10-19).

---

## S7 — Scraper development

**Purpose:** Change portal automation without breaking jurisdiction contracts.

**Activate when:** `scraper-service/` except pure UCI service edits that do not touch Playwright.

**Required context:** `memory.md` §3–7. The jurisdiction module being edited.

**Procedure:**

1. Identify portal type and subtype before editing shared login code.
2. Keep Baltimore `projectId` required, and PGC/Montgomery saved-credential checks, unless the task replaces the integrity strategy in writing.
3. Do not shorten waits without a trace.
4. Update the viewer or `memory.md` if JSON keys change.
5. Run the focused `node --test` file. Arlington-related changes should run the scraper `npm test` subset. UCI security changes run `npm run test:uci:security`.
6. Do not delete `downloads/`, `pgc-downloads/`, or debug images while a scrape is running.

**Verify:** The jurisdiction’s existing test, or a stated reason a live portal test was not run. No credentials in the diff.

**Prohibited:** Committing `latest-run.log`, screenshots, or downloaded permit files. Pointing production at a personal tunnel. Using a real jurisdiction password in a test fixture.

---

## S8 — UCI and workflow orchestration

**Purpose:** Extend utility coordination without turning synthetic mode into a live submission.

**Activate when:** `src/pages/Uci*`, `src/lib/uci*`, `scraper-service` UCI routes or services, `uci/` docs.

**Required context:** `uci/README.md`, `ARCHITECTURE.md` §5 (historical gates), [03](./03-FEATURE-INVENTORY.md) UCI row.

**Procedure:**

1. Check env flags for live PEPCO submit and live Graph. Default is off. Do not flip them.
2. Keep synthetic fixtures labeled synthetic in the UI.
3. Follow the doc hierarchy before inventing a new stage model.
4. Track A/B branches may differ from `main`. Diff before editing.

**Verify:** A test in `scraper-service` UCI suite or a UI test if one covers the change. Confirmation that no live-submit flag was enabled.

**Prohibited:** Live utility submission, real client document deletion, or Graph send from development. Migrations bundled into a UI-only UCI task.

---

## S9 — Document processing (RAG ingestion)

**Purpose:** Change PDF/DOCX ingestion without confusing it with Code Analyzer.

**Activate when:** `document-ingestion-worker/`, `document_ingestion_jobs`, `project_document_chunks`, `ingest-project-document`.

**Required context:** [02](./02-SYSTEM-ARCHITECTURE.md) worker section. Production deploy date in [05](./05-RAILWAY-AND-DEPLOYMENT.md).

**Procedure:**

1. This worker does not OCR. If the task needs OCR, scope it explicitly (PP-009) instead of silently calling an external OCR API.
2. Chunk and embed failures must mark the job failed with a redacted error. Do not log storage URLs with tokens.
3. Remember production may still be the 2026-08-04 image until someone deploys.

**Verify:** A fixture PDF with text produces chunks in a test or a described manual run. A low-text PDF still returns the limited-text message.

**Prohibited:** Writing into `code_analyzer_*` tables from this worker. Deploying it without an explicit ask.

---

## S10 — Code Analyzer and code-modification analysis

**Purpose:** Change drawing analysis without restoring the V1 browser path or passing sheets that lack evidence.

**Activate when:** `code-analyzer-worker/`, `src/lib/codeAnalyzer/`, `src/lib/codeModification/`, `src/components/compliance/`, scraper `app/services/compliance/`.

**Required context:** `featureFlags.ts` (`assertNewAnalysisUsesV2`), commit `fc74c35` message, worker claim loop in `worker.js`.

**Procedure:**

1. New analysis stays on the async job path. Do not catch the V2 error and run a legacy in-browser analysis.
2. Sheet “pass” requires evidence on the sheet. Read `findingQuality.js` and the classifier before loosening that rule.
3. Worker changes that import scraper code must still build with the root Nixpacks context.
4. Set local `SCRAPER_SERVICE_URL` to the scraper port actually listening (3001 or 3002), not the worker’s `:3000` default, when testing.
5. Run `code-analyzer-worker` `npm test` and the related `src/lib` `tsx --test` files.

**Verify:** Tests cover the classification or evidence change. Summary states that V2 flag behavior is unchanged.

**Prohibited:** Disabling the evidence check to make a demo PDF pass. Deploying the worker to development (no such service on 2026-10-19) unless the user first asks to create it. Mutating customer analyzer rows while “auditing” a run.

---

## S11 — API integrations (Stripe, QuickBooks, Graph, Shovels, Resend)

**Purpose:** Change third-party calls without leaking tokens or widening public routes.

**Activate when:** Those integrations are in the diff.

**Required context:** `docs/diligence-readiness/ENV.md` for variable **names**. QuickBooks audit doc for invoice limits.

**Procedure:**

1. OAuth callbacks stay on the scraper (`/api/quickbooks/oauth/callback`, `/api/microsoft/oauth/callback`).
2. Tokens stay in service-role tables.
3. Stripe webhook must verify the Stripe signature.
4. Do not infer a successful invoice from `connected: true`.

**Verify:** Unauthenticated callers cannot trigger invoice creation or read token columns. Status payload stays minimal for anonymous callers.

**Prohibited:** Live invoice creation, live Graph send, or Stripe test charges unless the user explicitly requests that test and names the account.

---

## S12 — Testing and debugging

**Purpose:** Run the runner this repo actually uses.

**Activate when:** Any code change, or a bug report.

**Required context:** [03](./03-FEATURE-INVENTORY.md) test section.

**Procedure:**

1. Frontend: `npx tsx --test path/to/file.test.ts`.
2. Scraper: `cd scraper-service && node --test tests/<file>.test.js` or `npm run test:uci:security`.
3. Analyzer: `cd code-analyzer-worker && npm test`.
4. There is no root `npm test` and no app-level Vitest.
5. For UI, exercise the browser flow if tools exist.

**Verify:** Command and result in the task summary. CI workflow is updated only when the user wants new gates.

**Prohibited:** Adding Vitest as a drive-by. Hitting production scrapes as a test.

---

## S13 — Production incident investigation

**Purpose:** Explain a production failure without making it worse.

**Activate when:** “It’s down,” failed deploy, bad analyzer run, stuck scrape, missing cron.

**Required context:** [05](./05-RAILWAY-AND-DEPLOYMENT.md), [08](./08-BUGS-AND-TECHNICAL-DEBT.md).

**Procedure:**

1. Read-only first: `railway status`, deployment list, function logs if the user has granted access.
2. Separate Vercel, scraper, analyzer worker, ingestion worker, and Supabase.
3. For analyzer incidents, compare frontend flag, worker deploy date, and scraper deploy date. They can diverge (they did: ingestion is older).
4. Redact emails, addresses, and credentials in anything copied into chat.

**Verify:** Timeline with deployment ids and commits. No data mutation.

**Prohibited:** Restarting services, replaying webhooks, or re-running scrapes against live portals during diagnosis unless the user asks.

---

## S14 — Git branching and pull requests

**Purpose:** Land work on the right branch with the right GitHub user.

**Activate when:** Commit, push, or PR.

**Required context:** `.cursor/rules/epermitarthouse-github.mdc`. User git and PR rules.

**Procedure:**

1. `gh api user --jq .login` is `epermitarthouse-rgb` before `gh pr create`.
2. Lovable work: `feat/lovable-ui-replication` only.
3. Do not commit secrets or runtime scraper artifacts.
4. PR body includes test plan and which service must deploy.
5. Push only when asked. Deploy only when asked, using S6.

**Verify:** `git status` clean for the intended files. PR URL returned.

**Prohibited:** Force push to `main`. `--no-verify`. Amending commits that were not created in the current session. Using personal GitHub accounts.

---

## S15 — Architecture consistency review

**Purpose:** Review a diff for contract breaks before merge.

**Activate when:** The user asks for review, or a change touches more than one of UI, SQL, and scraper.

**Required context:** [06-HISTORICAL-DECISIONS.md](./06-HISTORICAL-DECISIONS.md).

**Procedure:** Check the diff against: Baltimore `projectId`, saved-credential errors, V2-only analyzer, no new mock on production paths, RLS present, correct Railway service, `memory.md` updated if portal JSON changed, diligence docs not silently treated as current.

**Verify:** A short list of contracts checked and any that the diff violates.

**Prohibited:** Rewriting the feature during a review. Approving a migration that only exists as dashboard SQL.

---

## Suggested skill file mapping (later)

| Spec | Future skill name |
|------|-------------------|
| S1 | `epermit-architecture` |
| S2 | `epermit-frontend` |
| S3 + S4 | `epermit-supabase` |
| S5 | `epermit-edge-functions` |
| S6 | `epermit-railway-deploy` |
| S7 | `epermit-scraper` |
| S8 | `epermit-uci` |
| S9 | `epermit-document-ingestion` |
| S10 | `epermit-code-analyzer` |
| S11 | `epermit-integrations` |
| S12 + S13 | `epermit-debug` |
| S14 + S15 | `epermit-review-and-pr` |

Create those files only after a human accepts this spec.
