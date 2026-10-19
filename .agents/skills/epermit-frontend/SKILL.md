---
name: epermit-frontend
description: Use for Epermit React UI, Vite routes, module gates, Lovable replication, and frontend change verification.
---

# epermit-frontend

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

### S2: Frontend and UI

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



## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
