# Central comment processing: architecture investigation and proposal

Status 2026-11-18: investigation only. No code, migration, deploy or production write. Verified against `main` at
`8a09947` (= `origin/main`). Production figures are read-only counts and column names.

Goal: every readable permit in Permit Queue already has its review comments extracted, normalized, classified by
discipline and given preliminary code/reference context, with provenance and limitations, before any project exists.
Linking a permit to a project reuses that work and does only project-specific work (association, project context,
routing to real team members, Response Matrix rows), never overwriting human work (D-111).

## 1. Production baseline (read-only, 2026-11-18)

| Measure | Value |
|---|---|
| Permits (1 adapter `dc-projectdox`, 1 source, `visible_to_all` on) | 28 |
| Active review comments / permits with comments | 391 / 16 |
| Comments per permit | 81, 59, 53, 50, 38, 36, 18, 12, 10, 8, 6, 6, 6, 5, 2, 1 |
| Distinct comment bodies | 370 (21 exact duplicates) |
| Body length: average / max / total characters | 358 / 3,349 / 140,120 |
| Active repository responses (`permit_review_responses`) | 376 |
| `project_permits` links / linked projects / linked permits | 1 / 1 / 1 |
| Projects / tenants | 88 / 5 |
| `parsed_comments` rows / rows from the repository (`portal_permit_id` set) | 411 / 6 |
| Repository rows with response text / assigned / human-edited | 6 / 6 / 1 |
| `project_pipeline_runs` / `project_comment_pipeline_state` rows | 35 / 1 (completed) |
| `project_team_members` rows (all role `editor`) / projects with any | 49 / 49 |

`parsed_comments.project_id` is NOT NULL. Its four RLS policies are project-based ("accessible" / "editable projects").
`parsed_comments.assigned_to` is `text`.

## 2. Current downstream architecture: where it depends on a project

Nothing downstream of the scraper runs for a permit that has no linked project. The chain:

1. **Worker** (`scraper-service/permit-sync/deep/runner.js` `triggerPipelines`, about line 412) loops over the permit's
   *linked projects* (`repo.js` reads `project_permits`) and calls `commentDispatch.js` `trigger({ projectId })`,
   which POSTs `{action:"sweep", project_ids:[projectId]}` to `permit-comment-pipeline`. No link means no call.
   Comments are captured centrally regardless (`adapters/dc-projectdox/adapter.js` writes `permit_review_comments`
   and `permit_review_responses`, row `content_hash` = sha256 of the canonical fields, status included).
2. **Dispatcher** (`supabase/functions/permit-comment-pipeline/index.ts`) calls `permit_pipeline_claim`
   (migration `20261117100000`), which iterates `project_permits JOIN projects` and requires `projects.user_id`.
   The unit of work is a **project**. Its key is `_project_permit_comment_fingerprint(project)`: md5 over the
   linked permits the *owner* can read (`user_can_read_permit(owner, …)`) and each comment's md5(body, status,
   cycle, type, department, file, ref). State lives in `project_comment_pipeline_state` (PK `project_id`).
3. **Drive loop** (`_shared/permitCommentPipeline.ts` `driveClaimedProject`) calls `intake-pipeline-agent` with
   `{project_id, comment_source:"permit_repository", comment_fingerprint}` and the service headers
   (`serviceForwardHeaders`, acting user = project owner).
4. **Service-mode auth** (`_shared/serviceExecution.ts` `authorizeServiceExecution`). Every agent requires the pipeline
   secret, a service bearer, an acting user, a `project_id`, `projects.user_id = acting user`,
   `has_project_access`, and at least one `project_permits` row. **There is no service mode without a project.**
5. **Intake** (`intake-pipeline-agent/index.ts`) checks `has_project_access` and keys `project_pipeline_runs`
   on `comments:<fingerprint>`. It runs the stages in order: parser, classifier, enrichment, routing.

### What each agent actually reads and writes (from code)

| Agent | Reads | Writes | AI | Needs a project? |
|---|---|---|---|---|
| `comment-parser-agent`, repository branch (lines 1017-1073, `_shared/permitRepositorySource.ts`, `permitRepositoryComments.ts`) | `project_permits`, `user_can_read_permit(owner)`, `permits(id, permit_number)`, `permit_section_state(reviews)`, `permit_review_comments`, `permit_review_responses` (counts), existing `parsed_comments` of the project | `parsed_comments` insert/update/soft-remove (identity, text, status, `portal_*`) | none (deterministic formatting and merge, D-118/D-119 thread rule) | **Extraction and normalization: no.** The merge into a project's rows: yes. |
| `discipline-classifier-agent` | `projects(user_id, is_shadow_mode)`; `parsed_comments(id, original_text, …)` where discipline is null, `General` or `Unclassified` | `parsed_comments.discipline` only (confidence is discarded except in shadow mode); `audit_trail`; `shadow_predictions` | gpt-4o, 45 comments per call, **50 rows per invocation** | **No.** Only `original_text` goes to the model. The project matters only for scoping rows and shadow mode. |
| `context-reference-engine` | `projects(user_id)`; `parsed_comments(id, original_text, discipline, code_reference, response_text)` where `code_reference` is empty | `code_reference`; `response_text` **only when empty** (generic AI draft) | gpt-4o, 20 per call, `max_rounds: 1` per invoke, intake loops | **No.** Only text and discipline go to the model. No address, scope, drawings or jurisdiction. |
| `auto-router-agent` | `parsed_comments(id, discipline)` where `assigned_to` is empty | `assigned_to` = a fixed role label (`DISCIPLINE_ROUTING`, for example "Project Manager") | none | It writes to the project, but it **does not route to team members**: it never reads `project_team_members`. |
| `generate-grounded-response` (user-triggered, not in the pipeline) | `parsed_comments`, `project_document_chunks`, `project_documents`, `match_document_chunks(p_project_id)` (RAG over project drawings and documents) | `grounded_*`, `ai_generated_response_text`, `required_action`, `missing_info_or_risk` | embeddings + LLM | **Yes, genuinely project-specific.** |

Findings that change the design:

- **Only routing, the grounded draft and the Response Matrix merge need a project.** Extraction, normalization,
  discipline classification and generic code references are permit-level. Their inputs are the comment text plus
  permit metadata (department, type, cycle, and potentially `permits.jurisdiction`), and none of it comes from the
  project.
- Context that people call "project-specific" (address, scope/description, job class, review type, jurisdiction) is
  mostly on **`permits`**, so central mode can use it. Today the context engine does not even receive jurisdiction,
  which matters for DCMR vs IBC references.
- Real project-specific context exists only where a project has its own documents (the grounded draft, RAG) or team.
- **Existing defect, project mode:** intake calls the classifier without `batch_limit`, so at most 50 rows are
  classified per run, and the stage is then marked completed. Routing still runs and assigns unclassified rows to
  "Project Manager". Because routing only picks unassigned rows, a later classification never re-routes them. In
  production, 3 permits have more than 50 comments (81, 59, 53). Central processing removes the cap from the reuse
  path, and the cap should be fixed regardless.
- **D-111 consequence:** `hasHumanWork` counts any `response_text` (the AI draft) and any `assigned_to` (the rule
  label) as work. After the first pipeline run every row counts as "worked" (production: 6 of 6), so later portal
  text changes always go beside the row (`portal_latest_text`) even when no person touched it. The safe default is
  right, but it is imprecise because there is no record of *who* wrote a field.

## 3. Answers

### 3.1 Which stages need project or owner context

| Stage | Context needed | Where it should run |
|---|---|---|
| Extraction, comment/response capture, removal tracking | permit only | central (already: worker plus `permit_review_*`) |
| Normalization (formatting, ref, status mapping, thread vs comment, content hash) | permit only | central. Pure functions in `permitRepositoryComments.ts` are reusable as-is. |
| Discipline classification | comment text, department, type | central |
| Generic code reference with explicit/inferred basis, preliminary guidance | comment text, discipline, permit jurisdiction, permit job class/description | central |
| Association with a project (Response Matrix rows) | project, owner's permit read access | project |
| Routing to real people | `project_team_members` (+ roles), project | project |
| Project-specific draft (address, scope, drawings, RAG over project documents) | project documents | project (existing `generate-grounded-response`, unchanged) |
| Service-mode auth (secret, acting owner, owned linked project) | project | project mode only. Central mode needs a separate service-only path with no acting user. |

### 3.2 What can be generated once and reused, and how it is versioned

Reusable and accurate at permit level: discipline (plus confidence), the code reference(s) with a basis
(`explicit` = cited in the text, `inferred` = model guess), a short generic guidance/draft, and limitations
("inferred, no project documents read", "comment truncated", "low confidence").

Each result is keyed by:
- `input_hash`: sha256 over the normalized inputs actually sent to the model (whitespace-normalized body,
  department, comment type, and jurisdiction). Not the row `content_hash`, which includes status, because a status
  flip must not re-run AI.
- `processing_version`: one string per stage, for example `classifier@2026-11-18.1`, combining the prompt version
  and the model (`gpt-4o`). Stored separately as `model` and `prompt_version` for audit.
- `created_at`, `status` (`ready | failed | superseded`) and `is_current`.

A result is reused while `(comment_id, input_hash, processing_version)` is unchanged. Bumping the prompt or model
version makes results stale, and they are re-processed only when an operator chooses to (§3.6).

### 3.3 Linking central comments and project rows without duplicating the source

- The central comment stays the single source (`permit_review_comments`). `parsed_comments` already carries
  `portal_permit_id`, `portal_comment_key` and `portal_content_hash` (identity, D-110).
- Add `parsed_comments.central_insight_id` (FK to the central result row). The project row **copies** the few
  preliminary values (`discipline`, `code_reference`, and the draft, see 3.8) and **references** the central row for
  provenance and update detection.
- Copy-with-reference, not pure reference, because the Response Matrix query, the human-edit columns, RLS, the
  approval trigger and exports all read `parsed_comments` directly. A join-at-read model would change all of them.
- Overrides layer by field source: `discipline_source`, `code_reference_source` (`central | project_ai | human`).
  A small BEFORE UPDATE trigger sets `*_source = 'human'` when a signed-in user (`auth.uid()` not null) changes the
  field. This is the same pattern as `enforce_parsed_comment_response_approval`. Service writes never set
  `human`. A field whose source is `human` is never replaced by central output.

### 3.4 Portal updates

1. The worker writes `permit_review_comments` (unchanged).
2. A new per-permit central state (same shape as `project_comment_pipeline_state`) has a fingerprint over the
   `input_hash` of the permit's active comments plus the current processing versions. A changed fingerprint makes the
   permit due. Only comments without a current result for `(input_hash, version)` are sent to the model.
3. A new result supersedes the old one (`is_current` moves; the old row is kept as history).
4. The project fingerprint (`_project_permit_comment_fingerprint`) additionally covers the current
   `central_insight_id`s, so linked projects become due. Their run makes **no AI calls**: the merge applies the new
   central values.
5. Per project row:
   - Text: unchanged D-111/D-119 behaviour (replace only without human work; otherwise `portal_latest_text`).
   - Preliminary fields whose source is `central` and that a person has not edited are refreshed, and
     `central_insight_id` moves forward.
   - If any of those fields is `human`, nothing is overwritten. Set `central_update_at` (new column) so the Response
     Matrix shows "Updated preliminary analysis available", next to the existing "Updated on portal" marker.
   - With source tracking, `hasHumanWork` can become precise: the AI draft and the rule-based label stop counting as
     work. This revises D-111 and is a product decision (see §6).

### 3.5 Multi-org reuse and tenant isolation

- Central results are derived **only** from permit-level data (comment, responses count, permit fields). Central
  mode reads no project, team, document or user data. That makes central results exactly as sensitive as the
  comment itself.
- Result RLS: `SELECT … USING (can_read_permit(permit_id))`, the same rule as `permit_review_comments`. D-120
  default access, per-user hide (`deny` grants) and `user_can_read_permit` therefore apply unchanged. No client
  writes; only the service role writes.
- Project rows stay project-scoped (`parsed_comments` RLS unchanged). The merge still only reads permits the
  **owner** can read (`loadRepositorySource`), so a hidden owner's project receives nothing (D-120, known effect 1).
- No write-back: project edits, responses, assignments and approvals are never promoted to central results. There
  are no cross-project aggregates ("N projects accepted"). A later reviewed feedback loop would be an explicit
  platform-admin action, out of scope.
- Hash-based dedupe across permits copies a result only when `input_hash` is equal, which includes jurisdiction.
  The caller is the service role, and the copy reveals nothing beyond the identical text.
- Pre-existing and separate: D-120 notes that under the default+override project model `has_project_access` gives
  cross-tenant access to non-demo projects. `parsed_comments` RLS uses it. Central reuse adds no new exposure, but
  this deserves its own decision before multi-org commercial use.

### 3.6 Cost control

Today, each linked project pays for its own AI calls. Per permit: classifier `ceil(n/45)` gpt-4o calls (capped at
50 rows per run), enrichment `ceil(n/20)`; routing and parser use none.

| Scenario (production comment counts) | Today (project mode) | Proposed |
|---|---|---|
| Process all 16 permits once | 48 gpt-4o calls (20 classifier + 28 enrichment) per *set of linking projects*, and only after linking | 29 calls once (9 + 20, batched across permits), or 48 if batched per permit; 0 per link |
| The same permit linked by K organizations | 48 × K | 29 once, 0 × K |
| Re-scrape, no text change | 0 (fingerprint) | 0 |
| One comment's text changes | 2 calls × each linked project | 2 calls total |
| Prompt/model version bump | not tracked (rows never re-classified) | opt-in re-run, budgeted |

Controls: one result per `(input_hash, version)` (the 21 duplicate bodies are deduped); batching of 45 and 20 across
permits; a per-sweep comment budget plus a daily budget (env, for example `CENTRAL_AI_DAILY_COMMENT_BUDGET`); the
existing back-off (5 min × 4^(n−1), up to 6 h, blocked after 5); a feature flag (`CENTRAL_PROCESSING_ENABLED`) and
cron on/off. Linking never triggers AI when central results exist.

**Backfill estimate for the 391 DC comments** (gpt-4o list price $2.50 per 1M input tokens and $10 per 1M output):
about 140 tokens per formatted comment. Classifier: about 61k input and 12k output. Enrichment: about 65k input and
39k output. Total about 126k input and 51k output, so **about $0.85** for one pass. Approve a ceiling of $5 to cover
retries and one prompt revision.

### 3.7 Keep the existing agents (no new agents)

- `discipline-classifier-agent` and `context-reference-engine` get `mode: "central"` with `{ permit_ids }`.
  Auth: `verifyProcessorRequest` (service bearer + pipeline secret), no acting user and no project. The function reads
  `permit_review_comments` (+ `permits.jurisdiction`) and writes the central result table. The prompt and parse
  logic move into `_shared/` modules used by both modes, so project and central output stay identical and share
  one `prompt_version`.
- Project mode stays the default and keeps its behaviour. It naturally skips rows already prefilled from central
  (the classifier picks only null/General/Unclassified; enrichment picks only rows without `code_reference`). It also
  remains the fallback when central results are missing (flag off, failure, a source not yet processed).
- `comment-parser-agent` (merge) copies current central values into new and refreshable rows (`permitRepositoryComments.ts`).
- `auto-router-agent`: gains real routing in project mode by reading `project_team_members` (and a role or discipline
  map), keeping the role label as the fallback. This is a product feature, independent of central processing.
  Production team roles are all `editor` today, so a discipline-to-person map is needed first.
- `permit-comment-pipeline`: adds `action: "central_sweep"` (claims permits), run before the project sweep in the
  same cron tick. The worker handoff (`commentDispatch.js`) also sends the permit id, so permits without links are
  processed.

### 3.8 Preliminary vs project-specific vs human-verified

| Level | Where stored | Marker | Shown in |
|---|---|---|---|
| Preliminary (central AI) | central result table | `processing_version`, `model`, `basis` (`explicit`/`inferred`), `confidence`, `limitations[]` | Permit Queue permit page, comments tab: discipline chip, code reference marked "Preliminary · AI · inferred", confidence, limitations. Read-only, with no response or assignment. |
| Project-specific | `parsed_comments` | `*_source = 'project_ai'`, `grounded_*` (RAG), routed assignee | Response Matrix (existing columns and grounded badge) |
| Human-verified | `parsed_comments` | `*_source = 'human'`, `last_edited_by`, `approved_by` / `response_status` | Response Matrix (existing approval UI); a small "Preliminary" badge on fields still `central` |

The central guidance text should go into `parsed_comments.ai_generated_response_text` (an existing column, already
shown as an AI suggestion), not `response_text`. That way `response_text` stays human-owned and D-111 can stop
treating AI drafts as work. This is a behaviour change from today's enrichment, which fills `response_text`, so it
needs a product decision. Until then, copy into `response_text` only when empty, exactly as today.

## 4. Options

**A. Central result table keyed by permit comment and version, which project mode copies with a reference
(recommended).** Add `permit_comment_insights` and a per-permit state. Agents get a central mode. The merge copies
the values and stores `central_insight_id` plus field sources.
- Pros: Response Matrix, RLS, approval trigger and exports unchanged. Clean tenant boundary (permit RLS vs project
  RLS). Per-version history. Zero AI on link. Reuses the dispatcher, state machine and agents.
- Cons: two tables and a few columns. Copied values must be refreshed by the merge (already its job). Field-source
  trigger to maintain.

**B. Central rows in `parsed_comments` with `project_id` null.**
- `project_id` is NOT NULL. All four RLS policies, the approval trigger (`has_project_admin_access(NEW.project_id)`),
  the identity index, the overview counts and every Response Matrix query assume a project. Central rows would need
  permit-based RLS mixed into a project table, and human-work columns would be meaningless on them. It also mixes
  tenant-scoped and shared data in one table, which is a leakage risk. **Rejected.**

**C. Stay project-only and cache agent outputs by content hash.** Add a cache `(input_hash, version) → output`
consulted by the classifier and enrichment.
- Pros: smallest change (one table, no dispatcher change). Cuts repeat cost for K linking organizations.
- Cons: **does not meet the goal**: nothing exists before a project links, and Permit Queue shows nothing. The cache
  table is effectively A's result table without permit RLS or provenance. A shared cache keyed only by hash also
  needs care to stay tenant-neutral.

**Recommendation: A**, built so that C falls out of it: the result table *is* the cache, keyed by `input_hash` and
version. It is the smallest option that meets the product goal while keeping one pipeline, the existing agents and
the existing Response Matrix.

### Data model sketch (option A)

```sql
-- Central, permit-scoped, service-written. One current row per comment per stage-set version.
permit_comment_insights (
  id uuid pk,
  permit_id uuid not null references permits on delete cascade,
  comment_id uuid not null references permit_review_comments on delete cascade,
  input_hash text not null,                 -- sha256(normalized body | department | comment_type | jurisdiction)
  processing_version text not null,         -- e.g. 'central-v1' (classifier + enrichment versions)
  discipline text, discipline_confidence real,
  code_reference text, code_references jsonb, code_basis text check (code_basis in ('explicit','inferred','none')),
  guidance_text text,                       -- generic, project-independent
  limitations text[] not null default '{}',
  model text, classifier_prompt_version text, enrichment_prompt_version text,
  status text not null check (status in ('ready','failed','superseded')),
  is_current boolean not null default true,
  error text, created_at timestamptz default now(), superseded_at timestamptz,
  unique (comment_id, input_hash, processing_version)
);
-- unique (comment_id) where is_current; index (input_hash, processing_version) for dedupe
-- RLS: SELECT using can_read_permit(permit_id); no INSERT/UPDATE/DELETE grants to authenticated

permit_comment_processing_state (            -- same columns/claim/finish semantics as project_comment_pipeline_state
  permit_id uuid pk references permits, status, requested_fingerprint, completed_fingerprint,
  attempts, next_attempt_at, lease_owner, lease_expires_at, last_error, ...
);
-- permit_central_claim / permit_central_finish (service role), get_permit_comment_insights(permit_ids) read model

parsed_comments
  + central_insight_id uuid references permit_comment_insights on delete set null
  + discipline_source text, code_reference_source text   -- 'central' | 'project_ai' | 'human'
  + central_update_at timestamptz                         -- newer central result not applied (human field)
  -- trigger: auth.uid() not null and field changed → *_source := 'human'
```

### Trigger flow and reuse path

```
worker deep pass ─► permit_review_comments (unchanged)
      │ commentDispatch: {action:"central_sweep", permit_ids:[p]} (+ project sweep as today)
      ▼
permit-comment-pipeline ─ central_sweep ─► permit_central_claim (fingerprint over input_hash + version)
      ├─► discipline-classifier-agent  mode=central  ─┐  only comments lacking (input_hash, version)
      └─► context-reference-engine     mode=central  ─┴► permit_comment_insights (is_current)
      ▼ permit_central_finish → linked projects' fingerprints change
permit-comment-pipeline ─ sweep (as today) ─► intake ─► comment-parser (merge copies insight values,
      sets central_insight_id / *_source='central'; human fields kept, central_update_at flagged)
      ─► classifier / enrichment (project mode: only rows still empty → normally 0 AI calls)
      ─► auto-router (project: team members when mapped, else role label) ─► Response Matrix
```

## 5. Implementation gap assessment

| Item | Reuse | Change needed | Effort |
|---|---|---|---|
| Comment capture, responses, removal, section completeness | worker, `permit_review_*`, `permit_section_state` | none | n/a |
| Normalization and hashing | `permitRepositoryComments.ts` (`formatRepositoryComment`, `normalizePortalStatus`, D-119 rule) | add `insightInputHash()` (sha256, normalized) | S |
| Migration: insights table, permit state, claim/finish, read RPC, `parsed_comments` columns, field-source trigger, project fingerprint covering insight ids | `20261117100000` patterns, rollback-script pattern, PGlite migration tests | new additive migration + rollback | M |
| Classifier central mode | prompt, chunking, enum | extract prompt to `_shared`, add central branch (processor auth, permit read, insight write, confidence kept), fix 50-row cap in project mode | M |
| Context engine central mode | prompt, batching | `_shared` prompt; add jurisdiction/permit fields to central input; `code_basis` and limitations in output | M |
| Dispatcher `central_sweep` | `permitCommentPipeline.ts` drive loop, back-off, lease | permit claim loop calling the two agents directly (no intake), budget env, flag | M |
| Worker handoff | `commentDispatch.js` | also send `permit_ids`; trigger even when unlinked | S |
| Parser merge reuse | `planRepositoryCommentMerge` | copy/refresh central values per field source, set `central_update_at` | M |
| Precise human-work rule (D-111 revision) | `hasHumanWork` | AI draft and rule label are not work when the source says so (decision first) | S |
| Router to real team members | `auto-router-agent` | read `project_team_members` + discipline map; settings UI for the map | M (separate track) |
| Permit Queue UI | `PermitDetailPage` comments tab, `centralPermits.ts` | show preliminary discipline, code ref, basis, limitations; per-permit processing state | M |
| Response Matrix UI | existing columns, `ResponseMatrixPermitStrip`, "Updated on portal" marker | "Preliminary" badge on `*_source='central'`; "Updated preliminary analysis available" marker with accept | S-M |
| Tests | PGlite chain, `permitRepositoryComments.test.ts`, `serviceExecution.test.ts` | central auth (no acting user), RLS (hidden user, other tenant), merge with human fields, budget stop | M |

Unchanged: Code Analyzer V2 (six layers), the temporary Supabase analyzer, Portal Harvest, filing workflows, manual
scraping, manual comment letters (`parse-manual-comment-letter`), the grounded draft, and the Response Matrix main query.

## 6. Prioritized delivery plan

**Phase 0: decisions (no code).** Record D-121 (central results, option A), D-122 (field-source provenance; whether
AI drafts and rule labels still count as human work; central guidance into `ai_generated_response_text`) and the
version naming. Approvals: product owner.

**Phase 1: schema and read path (depends on 0).** Migration (insights, permit state, claim/finish, read RPC,
`parsed_comments` columns + trigger) with a rollback script and PGlite tests. Nothing writes yet.
- Acceptance: migration chain + rollback test green; a hidden user and a user with no read access get 0 insight rows;
  project RLS unchanged; approval trigger behaviour unchanged.
- Risk: the field-source trigger interacting with the approval trigger. Mitigation: separate trigger, ordered tests.
- Approval: migration apply (`supabase db query --linked -f …` + `migration repair`, never `db push`).

**Phase 2: central mode (depends on 1).** Shared prompt modules; classifier and context-engine central branch;
dispatcher `central_sweep`; budget env and flag `CENTRAL_PROCESSING_ENABLED` (default off). Fix the 50-row classifier
cap in project mode.
- Acceptance: on a local fixture, re-running with the same hashes makes 0 AI calls; a changed body re-processes only
  that comment; a version bump does nothing until requested; the budget stops cleanly and resumes; central mode
  refuses user JWTs and project ids.
- Risk: AI cost runaway. Mitigation: per-sweep and daily caps, back-off, flag.
- Approvals: deploy `permit-comment-pipeline`, `discipline-classifier-agent`, `context-reference-engine`; set the
  flag and budget env; **backfill of the 391 DC comments, about $0.85 at gpt-4o list price, ceiling $5**.

**Phase 3: reuse on link (depends on 2).** Parser merge copies and refreshes central values; project fingerprint
includes insight ids; `central_update_at` marker; D-122 human-work rule if approved.
- Acceptance: on the test project (ff193644 ↔ BCIV2500152), the 6 rows keep responses, approvals, assignment and the
  human edit (same `response_md5`), gain `central_insight_id`, and the project run makes 0 AI calls. A new link on a
  processed permit fills the Response Matrix with 0 AI calls. A human-edited discipline is never replaced, only
  flagged.
- Risk: refreshing a value a person relied on without editing it. Mitigation: refresh only `*_source='central'`
  fields and show the marker.
- Approvals: deploy `comment-parser-agent`, `intake-pipeline-agent`; one "Process comments now" on the test project.

**Phase 4: UI (can start after 1, ship after 2).** Permit Queue preliminary view and processing state; Response Matrix
"Preliminary" badge and the update marker.
- Acceptance: Permit Queue shows discipline, code ref, basis and limitations for every processed permit, read-only;
  no project names from other organizations appear; the Response Matrix distinguishes preliminary, project and
  human-verified values.
- Approval: frontend deploy (safe before the backend: reads return empty).

**Phase 5: worker handoff and cron (depends on 2).** `commentDispatch.js` sends permit ids; enable the central sweep in
the existing 5-minute cron.
- Approvals: worker deploy (sibling), cron script.

**Separate track: real routing.** Discipline-to-team-member map per project or tenant, router reads
`project_team_members`. It needs product input because production roles are all `editor`. Effort M.

Open risks: prompt and model drift between central and project modes (mitigated by shared modules and one version
string); multi-jurisdiction code references (jurisdiction in `input_hash` and in the prompt; limitations say
"inferred"); cross-tenant project readability under default+override (pre-existing, D-120 note); OpenAI outages
(back-off; project mode remains the fallback).
