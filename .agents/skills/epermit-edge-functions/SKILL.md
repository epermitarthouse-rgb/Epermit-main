---
name: epermit-edge-functions
description: Use for Epermit Edge Function authentication, JWT bypass, webhooks, service-role calls, and function deployment.
---

# epermit-edge-functions

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

### S5: Edge Functions

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

## Audit watchlist, code-level only (2026-10-19)
- Repo `stripe-webhook`: Stripe signature verified; `create-checkout` and `customer-portal`: `auth.getUser`; `ingest-project-document`: shared `requireAuthProjectAccess`.
- Repo `analyze-drawing` and `epermit-submit`: no caller authentication identified in entry handlers, with hosted `verify_jwt=false`; investigate deployed code and actual access path before labeling an exploit.
- `epermit-submit` currently returns mock submission success/tracking; do not describe as live permit filing.
- For all handlers, examine auth, object-level authorization, service-role boundaries, cost exposure, and webhook/cron authenticity. No security configuration writes during audits.

## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
