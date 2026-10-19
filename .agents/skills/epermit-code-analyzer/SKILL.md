---
name: epermit-code-analyzer
description: Use for Epermit Code Analyzer V2, async drawing jobs, classification, sheet evidence quality, and worker/scraper contracts.
---

# epermit-code-analyzer

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

### S10: Code Analyzer and code-modification analysis

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

## V2 work-in-progress context
The Vercel V2 frontend flag is still being worked on. Do not claim it is present or treat it as a prerequisite for unrelated development. For analyzer changes, preserve `assertNewAnalysisUsesV2()` and evidence-before-pass behavior from `fc74c35`. Trace worker HTTP to scraper and verify `SCRAPER_SERVICE_URL` rather than assuming localhost:3000.

## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
