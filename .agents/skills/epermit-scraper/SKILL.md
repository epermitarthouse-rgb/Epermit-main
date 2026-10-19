---
name: epermit-scraper
description: Use for Epermit portal scrapers, Playwright, jurisdiction-specific contracts, portal logins, credentials, and scrape debugging.
---

# epermit-scraper

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

### S7: Scraper development

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



## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
