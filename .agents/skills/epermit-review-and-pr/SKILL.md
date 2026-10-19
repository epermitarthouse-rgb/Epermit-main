---
name: epermit-review-and-pr
description: Use for Epermit GitHub branching, PRs, contract review, approvals, and deploy impact assessment.
---

# epermit-review-and-pr

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

### S14: Git branching and pull requests

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

---

### S15: Architecture consistency review

**Purpose:** Review a diff for contract breaks before merge.

**Activate when:** The user asks for review, or a change touches more than one of UI, SQL, and scraper.

**Required context:** [06-HISTORICAL-DECISIONS.md](./06-HISTORICAL-DECISIONS.md).

**Procedure:** Check the diff against: Baltimore `projectId`, saved-credential errors, V2-only analyzer, no new mock on production paths, RLS present, correct Railway service, `memory.md` updated if portal JSON changed, diligence docs not silently treated as current.

**Verify:** A short list of contracts checked and any that the diff violates.

**Prohibited:** Rewriting the feature during a review. Approving a migration that only exists as dashboard SQL.

---



## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
