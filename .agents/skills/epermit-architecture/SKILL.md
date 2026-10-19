---
name: epermit-architecture
description: Use when locating Epermit features, bugs, owning processes, data flows, or deciding which subsystem to edit.
---

# epermit-architecture

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

### S1: Epermit architecture navigation

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



## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
