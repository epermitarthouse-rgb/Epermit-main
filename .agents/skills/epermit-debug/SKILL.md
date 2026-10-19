---
name: epermit-debug
description: Use for Epermit tests, bug reproduction, production incident diagnosis, logs, and change validation.
---

# epermit-debug

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

### S12: Testing and debugging

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

---

### S13: Production incident investigation

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



## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
