# 07 — Cursor rules, memories, and conventions

**Extraction date:** 2026-10-19

## Rules that always apply

Three files under `.cursor/rules/`. All are `alwaysApply: true`. They conflict. An agent must pick by task, not merge them into one deploy command.

### `epermitarthouse-github.mdc`

- Remote is `epermitarthouse-rgb/Epermit-main`.
- Before `gh` API calls, `gh api user --jq .login` must be `epermitarthouse-rgb`.
- Do not use `jiyanaveed` or `daniyalAMBL` for this repo.
- Do not change `git config` `user.name` / `user.email`.
- SSH push as `epermitarthouse-rgb` is the expected git identity.

### `deploy-github-railway.mdc`

When the user asks to commit, push, or deploy:

1. `git push -u origin HEAD`
2. `railway up -d -y -s Epermit-main`

Production URL in the rule: `https://epermit-main-production.up.railway.app`.

The rule also says GitHub-connected auto-deploy may happen on `main`, and the CLI upload is still required so intent is explicit.

Limits: no `railway down`, no force redeploy of the wrong service, no credential edits.

**Gap in the rule:** it does not name `code-analyzer-worker` or `document-ingestion-worker`. A scraper-only `railway up` does not ship worker changes. It also does not pass `--environment production`. On 2026-10-19 the CLI was linked to production. That is a machine state, not a guarantee.

### `lovable-ui-development-workflow.mdc`

Applies to Lovable visual alignment, not to every UI bug.

- Branch only: `feat/lovable-ui-replication` (current tip observed: `f5d6fb9`).
- Never commit that work to `main`. Never merge without explicit human approval.
- Vercel: `main` is production; the feature branch is Preview. Preview uses the Railway **development** URL via `VITE_API_BASE_URL`.
- Do not change Vercel Production env vars for this work.
- Railway: development environment only:

```bash
railway up --environment development --service Epermit-main -d -y
```

- Do not deploy Railway production for this workflow.
- Do not change backend behavior, auth, schema, RLS, scrapers, or UCI contracts unless the human approves.
- No migrations.
- Railway development is documented as sharing production Supabase. Demo accounts only.

Plans referenced by the rule: `docs/lovable-ui-frontend-implementation-plan.md`, `docs/lovable-ui-development-environment.md`.

### How to resolve the conflict

| Task | Rule to follow |
|------|----------------|
| User says commit/push/deploy and the branch is `main` or a non-Lovable fix | `deploy-github-railway.mdc`, and name the service that actually changed |
| User is doing Lovable visual replication | `lovable-ui-development-workflow.mdc` only. Do not run the production `railway up` |
| User says commit but not deploy | Commit and push if asked. Do not run `railway up` |
| User is silent on deploy | Do not deploy. The rule’s “always” applies when they asked to push or deploy |

GitHub identity rule applies in all cases.

## Engineering handbook (`memory.md`)

`memory.md` at the repo root is the scraper and contract handbook, rewritten 2026-04 from older session notes. It is not a Cursor “memory” product feature. Sections:

1. Product and stack.
2. Auth and RLS summary (partially stale: `PublicOnlyRoute`).
3. `detectPortalType`.
4. Per-jurisdiction scraper behavior.
5. `portal_data` contract.
6. HTTP essentials.
7. Gitignored runtime artifacts.
8. Edge deploy commands and secret **names**.
9. Caveats: hardcoded Supabase client, ROI placeholder copy.
10. Changelog pointing at git history for older session notes.

Update `memory.md` when scraper contracts change. Do not put secrets in it.

There is a second `memory.md` inside `Epermit-main-graph-egress-release/`. That tree is a local snapshot. Do not edit it as if it were `main`.

## Other standing conventions

| Topic | Convention | Where |
|-------|------------|--------|
| Doc authority | Diligence bundle for handover procedure. `memory.md` for scrapers. Code on `main` when they disagree | `docs/diligence-readiness/DOCUMENTATION_CLEANUP_AUDIT.md` |
| UCI doc order | Spec → delivery roadmap → architecture → compliance checklist. Status words: implemented / partial / stub / deferred | `uci/README.md` |
| UI replication | Preserve controls the Lovable mock omits | Audits under `docs/audits/resources-section-lovable-vs-permitpilot-plan.md` and the Lovable rule |
| Tests | Node’s test runner via `tsx --test` and `node --test`. Not Vitest in the app | `package.json` scripts, workflow file |
| Theme | `npm run theme:check` runs `scripts/check-theme-regressions.sh` | Root `package.json` |
| Commits | Only when the user asks. No git config changes. No `--no-verify` unless asked | User git rule, plus the GitHub identity rule |
| Secrets | Names in `docs/diligence-readiness/ENV.md`. Values nowhere in git | ENV.md |

## Accessible conversation history

Cursor project transcripts for this workspace are on disk under the local project’s `agent-transcripts` directory (46 parent conversation folders; a recursive walk also sees subagent transcripts, 246 JSONL files). This extraction **indexed the opening user prompt** of recent transcripts. It did **not** replay full threads, tool outputs, or decisions buried mid-conversation.

Recent parent themes (2026-10-17 to 2026-10-19), from those opening prompts:

- Forensic review of Code Analyzer runs.
- Whether specific PDFs are drawings.
- Accuracy audits after an evidence-backed scoring change.
- Page-size classification fixes.
- Reports that a production `code-analyzer-worker` deploy finished (consistent with the Railway SUCCESS deploy on 2026-10-19, not a substitute for the CLI record).
- A McDonald’s “NEXT 75 New York Ave” drawing-set investigation.

Older transcripts exist back to at least August 2026 (folder mtimes). They were not summarized one by one. If a future agent needs a specific past decision, open the transcript folder by id rather than trusting this paragraph.

No Cursor Memories product store was found as a structured memory list beyond `memory.md` and these transcripts. A user-level agent store path exists on this machine and was **not** mined for project facts.

## Practices worth promoting into skills

Specified in [10-AGENT-SKILL-REQUIREMENTS.md](./10-AGENT-SKILL-REQUIREMENTS.md). Do not create the skill files until that spec is reviewed.

Priority order:

1. Architecture navigation and “which process owns this change.”
2. Deploy service selection (scraper vs analyzer vs ingestion vs Vercel) and the Lovable exception.
3. Supabase migration safety, including out-of-band columns and do-not-apply headers.
4. RLS and Edge Function caller checks.
5. Scraper jurisdiction contracts.
6. Code Analyzer V2 flag, worker, and evidence-before-pass rule.
7. Document ingestion limits (no OCR, separate from the analyzer).
8. UCI synthetic-vs-live gates.

## Files that look like rules but are not

| Path | What it is |
|------|------------|
| `point-7-grounded-ai-implementation.md` | Historical build spec for RAG |
| `arlington_accela_implementation_prompts.md` | Historical prompt runbook |
| `uci/` prompt tickets | Planning tickets, not runtime |
| `docs/admin-dashboard/*` | Target architecture. Parts are now code. The “uncommitted” note is stale |
| `reference/lovable-ui/` | Frozen UI reference, excluded from the production bundle |
