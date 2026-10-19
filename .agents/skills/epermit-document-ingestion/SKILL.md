---
name: epermit-document-ingestion
description: Use for Epermit document RAG worker, ingestion queues, PDF/DOCX chunks, embeddings, and OCR constraints.
---

# epermit-document-ingestion

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

### S9: Document processing (RAG ingestion)

**Purpose:** Change PDF/DOCX ingestion without confusing it with Code Analyzer.

**Activate when:** `document-ingestion-worker/`, `document_ingestion_jobs`, `project_document_chunks`, `ingest-project-document`.

**Required context:** [02](./02-SYSTEM-ARCHITECTURE.md) worker section. Production deploy date in [05](./05-RAILWAY-AND-DEPLOYMENT.md).

**Procedure:**

1. This worker does not OCR. If the task needs OCR, scope it explicitly (PP-009) instead of silently calling an external OCR API.
2. Chunk and embed failures must mark the job failed with a redacted error. Do not log storage URLs with tokens.
3. Remember production may still be the 2026-08-04 image until someone deploys.

**Verify:** A fixture PDF with text produces chunks in a test or a described manual run. A low-text PDF still returns the limited-text message.

**Prohibited:** Writing into `code_analyzer_*` tables from this worker. Deploying it without an explicit ask.

---

## Deployment currency
The older production ingestion worker is not an automatic incident and is not a release blocker for other work. Inspect the deployed image, root directory and run command only for relevant ingestion work or when explicitly asked.

## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
