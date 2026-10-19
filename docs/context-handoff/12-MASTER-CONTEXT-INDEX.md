# 12 — Master context index

**Extraction date:** 2026-10-19  
**Repository:** `epermitarthouse-rgb/Epermit-main`  
**Branch:** `main` @ `fc74c35bd3dd0818790d825cc694b069c7d4eaca` (2026-10-17)  
**Supabase:** `eeqxyjrcldivtpikcpvk`  
**Railway:** PermitPilot `41f0067a-ffb7-4b15-99e0-25ed8555438f`

Start here. Then open only the chapter that matches the task. Do not treat `docs/diligence-readiness/` (2026-08-27, commit `331fa80`) as newer than this folder.

## Read order for a new agent

1. This index.
2. [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) — what the product is and the constraints that are not optional.
3. [02-SYSTEM-ARCHITECTURE.md](./02-SYSTEM-ARCHITECTURE.md) — which process owns the change.
4. The one deeper chapter below that matches the task.
5. [11-CONTEXT-GAPS.md](./11-CONTEXT-GAPS.md) before claiming something is true in production.

## Chapter map

| File | Use it for |
|------|------------|
| [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) | Users, workflows, naming, exclusions |
| [02-SYSTEM-ARCHITECTURE.md](./02-SYSTEM-ARCHITECTURE.md) | Components, ports, data flows, diagrams |
| [03-FEATURE-INVENTORY.md](./03-FEATURE-INVENTORY.md) | Implemented vs partial vs placeholder |
| [04-DATABASE-AND-SUPABASE.md](./04-DATABASE-AND-SUPABASE.md) | Tables, RLS, storage, Edge Functions, cron |
| [05-RAILWAY-AND-DEPLOYMENT.md](./05-RAILWAY-AND-DEPLOYMENT.md) | Services, environments, what was online on 2026-10-19 |
| [06-HISTORICAL-DECISIONS.md](./06-HISTORICAL-DECISIONS.md) | Why the architecture looks like this |
| [07-CURSOR-RULES-AND-MEMORIES.md](./07-CURSOR-RULES-AND-MEMORIES.md) | Conflicting deploy rules, `memory.md`, transcript limits |
| [08-BUGS-AND-TECHNICAL-DEBT.md](./08-BUGS-AND-TECHNICAL-DEBT.md) | Confirmed defects vs old audits |
| [09-ROADMAP-AND-PRIORITIES.md](./09-ROADMAP-AND-PRIORITIES.md) | What is already done since August, what is next |
| [10-AGENT-SKILL-REQUIREMENTS.md](./10-AGENT-SKILL-REQUIREMENTS.md) | Skill specs. Not executable skills yet |
| [11-CONTEXT-GAPS.md](./11-CONTEXT-GAPS.md) | Unknowns and stale-doc conflicts |

## System in one paragraph

The browser app is a Vite/React SPA (Vercel) that reads and writes Supabase directly. Municipal portal automation, UCI HTTP, QuickBooks, Microsoft Graph, permit filing, and drawing-analysis HTTP live in one Railway service, `Epermit-main`, rooted at `scraper-service/` (`server.js`). Two other Railway services poll Postgres: `code-analyzer-worker` (production deploy message `fc74c35` on 2026-10-19) and `document-ingestion-worker` (last success 2026-08-04). Edge Functions handle email, Stripe, and the comment-agent pipeline. Local `npm run dev` is frontend `:5001`, scraper `:3002`, and the ingestion worker only.

## Task router

| If the task is about… | Open | Do not |
|------------------------|------|--------|
| A page or route | `src/App.tsx`, [03](./03-FEATURE-INVENTORY.md), skill S2 | Replace working controls with Lovable mocks |
| Portal login, scrape, `portal_data` | `memory.md`, `scraper-service/`, skill S7 | Drop Baltimore `projectId` or PGC credential checks |
| Code Analyzer results | `code-analyzer-worker/`, `src/lib/codeAnalyzer/featureFlags.ts`, skill S10 | Restore a V1 browser fallback or pass a sheet without evidence |
| Comment drafts / RAG | `document-ingestion-worker/`, `generate-grounded-response` | Assume OCR exists |
| SQL, RLS, auth | [04](./04-DATABASE-AND-SUPABASE.md), skills S3–S4 | `db push` the do-not-apply files without reading them |
| Deploy | [05](./05-RAILWAY-AND-DEPLOYMENT.md), skill S6 | `railway up` the wrong service or the Lovable branch to production |
| UCI | `uci/README.md`, skill S8 | Flip live-submit flags |
| Admin permissions | `docs/admin-dashboard/`, `src/pages/admin/` | Treat enforcement mode as known |
| “What should we build?” | [09](./09-ROADMAP-AND-PRIORITIES.md) | Re-implement V2 or admin governance from the August docs |

## Source hierarchy

1. Current code on `main` and a read-only check of the system you are about to change.
2. This `docs/context-handoff/` set (2026-10-19).
3. `memory.md` for scraper contracts, except where [11](./11-CONTEXT-GAPS.md) marks a section stale.
4. `docs/diligence-readiness/` for account inventory, env **names**, and restore procedure.
5. `docs/audits/` and `docs/current-*.md` as dated snapshots (mostly July–August 2026).
6. Cursor transcripts only for color, and only the thread you actually open.

Excluded: `D71404/Epermit`. Local folder `Epermit-main-graph-egress-release` is not `main`.

## Commands agents actually use

```bash
npm run dev                      # :5001, scraper :3002, ingestion worker
npm run dev:classic              # :5000 → :3001
npm run dev:code-analyzer-worker # not part of npm run dev
npx tsx --test src/lib/codeAnalyzer/featureFlags.test.ts
cd scraper-service && npm run test:uci:security
cd code-analyzer-worker && npm test
railway status                   # read-only; confirm PermitPilot and environment
```

There is no root `npm test`.

## Deploy map

| Diff location | Production target | 2026-10-19 note |
|---------------|-------------------|-----------------|
| `src/` | Vercel | SHA not rechecked |
| `scraper-service/` | Railway `Epermit-main` | Online. Deploy message `fc74c35` |
| `code-analyzer-worker/` or root `nixpacks.toml` | Railway `code-analyzer-worker` from **repo root** | Online. Same message |
| `document-ingestion-worker/` | Railway `document-ingestion-worker` | Online, image from 2026-08-04 |
| `supabase/functions/<name>` | Supabase CLI, that function only | Hosted verify_jwt not fully mapped |
| `supabase/migrations/` | Human-approved `db push` only | Apply state unknown |

Development Railway URL: `https://epermit-main-development.up.railway.app` (scraper deploy 2026-08-21). No analyzer service in that environment on 2026-10-19. Ingestion worker offline there.

## Non-negotiables

- GitHub user `epermitarthouse-rgb` for `gh`.
- No secrets in git, chat, or this folder.
- No production data changes, migration execution, or deploys unless the user asks.
- Baltimore scrapes need `projectId`. PGC and Montgomery need saved credentials.
- Code Analyzer new runs require `VITE_CODE_ANALYZER_ASYNC_V2=true`. No V1 fallback.
- A pass requires evidence on the sheet (`fc74c35`).
- Lovable UI work stays on `feat/lovable-ui-replication` and Railway development.

## Evidence standard

| Label | Meaning |
|-------|---------|
| VERIFIED | Seen in code, git, or a read-only CLI call on 2026-10-19 |
| HISTORICAL | Older doc or transcript |
| INFERRED | Reasonable reading, not independently proven |
| UNKNOWN | Not checked |

If a sentence in this set has no label, it is still tied to the file path cited in that chapter. Production behavior is UNKNOWN unless the chapter says a live check was made.
