---
name: epermit-railway-deploy
description: Use for Epermit Railway deployment planning, service selection, direct deployment, environment choice, and health checks.
---

# epermit-railway-deploy

## Shared operating rules (confirmed with Epermit owner, 2026-10-19)
- Source of truth: `epermitarthouse-rgb/Epermit-main` ONLY. Never consult, use, or merge facts from `D71404/Epermit`.
- Begin with `docs/context-handoff/12-MASTER-CONTEXT-INDEX.md`, then relevant handoff chapters and current code. Read `11-CONTEXT-GAPS.md` before making production claims. The handoff represents `main` at `fc74c35`; re-check newer code.
- Production is the default **environment context** unless the user explicitly selects development. Production default is NOT authorization to make a live change. A commit, push, merge, migration application, API send, Railway deployment, Vercel-triggering push, or production write must each be authorized by the user's requested task.
- Supabase project is `eeqxyjrcldivtpikcpvk`. NEVER execute `supabase db push` to replay the migration backlog. Only apply a single individually reviewed, explicitly approved migration after read-only hosted checks. Existing older migrations and seven DO NOT APPLY files are not to be auto-applied.
- GitHub is the code remote. Railway does NOT automatically pick up GitHub changes; the owner deploys the selected Railway service DIRECTLY. Vercel is GitHub-connected and can automatically release frontend commits on its configured production branch. Keep GitHub push, direct Railway deploy, migration application, and merge separate operations.
- Do not follow the old always-apply Cursor rule's blanket `railway up` on push. Task- and service-specific deploy approval takes precedence. Never force a Lovable visual change onto production.
- Code Analyzer V2 is active work; the Vercel `VITE_CODE_ANALYZER_ASYNC_V2` flag is not yet confirmed. No V1 browser fallback, no passing sheets without on-sheet evidence, no V2 rollback by default.
- The older ingestion-worker deployment is accepted. Do not rebuild/deploy just because its image predates `main`.
- Never expose .env contents, API secrets, service-role keys, OAuth tokens, passwords, customer documents or sensitive logs. Refer to variable NAMES, not secret values.
- A function with `verify_jwt = false` needs independent caller authentication or a legitimate alternative such as a validated webhook signature; do not blanket-enable JWT.
- Read-only diagnosis before change. Distinguish VERIFIED, HISTORICAL, INFERRED and UNKNOWN. Report affected components, validation, and approval needed.

## Procedure sourced from the reviewed handoff

### S6: Railway services and deployment

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

## Direct Railway workflow — overrides old Cursor deployment rule
- For Railway deployments, identify exact target among `Epermit-main`, `code-analyzer-worker`, and `document-ingestion-worker` in PermitPilot project `41f0067a-ffb7-4b15-99e0-25ed8555438f`.
- Keep direct Railway deployment separate from GitHub commit/push. Railway is not fetching the new code from GitHub automatically.
- Confirm target environment: production normally, development only when the owner says so. Explicit deployment permission is still mandatory.
- The frontend deploys through GitHub-connected Vercel; a push/merge on its production-linked branch can trigger deployment even without a Vercel CLI command.
- Do not redeploy ingestion worker due only to an old timestamp.

## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
